"use server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { requireSchool, resolveActor, assertWriteAccess } from "@/lib/auth/server";
import { recordAudit } from "@/lib/db/audit";
import { safeRevalidate } from "@/lib/revalidate";
import { currentAcademicYearLabel } from "@/lib/onboarding";
import {
  GRADUATE,
  nextLevel,
  nextAcademicYear,
  shiftYearIso,
  sectionSuffix,
} from "@/lib/academic/promotion";
import type { Tx } from "@/lib/db";
import { students, classes, academicPeriod, academicPeriodConfig } from "@/db/schema";

export type PromotionAction = "PROMOTE" | "GRADUATE" | "NO_TARGET" | "UNMATCHED";
export type PromotionRow = {
  studentId: string;
  name: string;
  code: string;
  fromClass: string;
  fromLevel: string | null;
  action: PromotionAction;
  toClassId: string | null;
  toClass: string | null;
};
export type PromotionPreview = {
  rows: PromotionRow[];
  currentYear: string;
  nextYear: string;
  nextYearExists: boolean;
  counts: { promote: number; graduate: number; noTarget: number; unmatched: number };
};

/** Build the promotion plan for every active student from the class ladder. */
async function buildPlan(tx: Tx, schoolId: string): Promise<PromotionRow[]> {
  const cls = await tx
    .select({ id: classes.id, name: classes.name, level: classes.level })
    .from(classes)
    .where(and(eq(classes.schoolId, schoolId), eq(classes.active, true)));
  const clsById = new Map(cls.map((c) => [c.id, c]));
  const byLevel = new Map<string, typeof cls>();
  for (const c of cls) {
    if (!c.level) continue;
    const arr = byLevel.get(c.level) ?? [];
    arr.push(c);
    byLevel.set(c.level, arr);
  }

  const studs = await tx
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      code: students.studentCode,
      classId: students.classId,
    })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.status, "ACTIVE")))
    .orderBy(asc(students.currentClassLabel), asc(students.lastName));

  return studs.map((s): PromotionRow => {
    const name = `${s.firstName} ${s.lastName}`.trim();
    const from = s.classId ? clsById.get(s.classId) : undefined;
    const base = {
      studentId: s.id,
      name,
      code: s.code,
      fromClass: from?.name ?? "—",
      fromLevel: from?.level ?? null,
      toClassId: null as string | null,
      toClass: null as string | null,
    };
    const nl = nextLevel(from?.level);
    if (!from || nl === null) return { ...base, action: "UNMATCHED" };
    if (nl === GRADUATE) return { ...base, action: "GRADUATE" };
    const targets = byLevel.get(nl) ?? [];
    if (targets.length === 0) return { ...base, action: "NO_TARGET" };
    const suffix = sectionSuffix(from.name, from.level);
    const target =
      (suffix ? targets.find((t) => sectionSuffix(t.name, nl) === suffix) : undefined) ??
      targets[0];
    return { ...base, action: "PROMOTE", toClassId: target.id, toClass: target.name };
  });
}

/** Resolve the school's current academic year and whether the next year already exists. */
async function resolveYears(
  tx: Tx,
  schoolId: string,
): Promise<{ currentYear: string; nextYear: string; nextYearExists: boolean }> {
  const configs = await tx
    .select({ academicYear: academicPeriodConfig.academicYear })
    .from(academicPeriodConfig)
    .where(eq(academicPeriodConfig.schoolId, schoolId));
  const years = configs.map((c) => c.academicYear);
  const label = currentAcademicYearLabel();
  const currentYear =
    years.find((y) => y === label) ??
    years.slice().sort().reverse()[0] ??
    label;
  const nextYear = nextAcademicYear(currentYear);
  return { currentYear, nextYear, nextYearExists: years.includes(nextYear) };
}

export async function previewPromotion(): Promise<
  { ok: true; preview: PromotionPreview } | { ok: false; error: string }
> {
  const { school } = await requireSchool();
  try {
    const preview = await withSchool(school.id, async (tx): Promise<PromotionPreview> => {
      const rows = await buildPlan(tx, school.id);
      const { currentYear, nextYear, nextYearExists } = await resolveYears(tx, school.id);
      const counts = {
        promote: rows.filter((r) => r.action === "PROMOTE").length,
        graduate: rows.filter((r) => r.action === "GRADUATE").length,
        noTarget: rows.filter((r) => r.action === "NO_TARGET").length,
        unmatched: rows.filter((r) => r.action === "UNMATCHED").length,
      };
      return { rows, currentYear, nextYear, nextYearExists, counts };
    });
    return { ok: true, preview };
  } catch {
    return { ok: false, error: "Could not build the promotion preview." };
  }
}

export type RunPromotionResult =
  | {
      ok: true;
      promoted: number;
      graduated: number;
      heldBack: number;
      skipped: number;
      nextYearCreated: boolean;
    }
  | { ok: false; error: string };

const RunSchema = z.object({
  holdBackIds: z.array(z.string().uuid()).default([]),
});

/**
 * Commit the year-end promotion. Recomputes the plan server-side (the client only supplies
 * the hold-back list), promotes each student up a class, graduates the exit year and creates
 * next year's period calendar (this year's dates shifted +1 year). Audited.
 */
export async function runPromotion(input: unknown): Promise<RunPromotionResult> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = RunSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const hold = new Set(parsed.data.holdBackIds);
  const actor = await resolveActor(school.id);

  try {
    const out = await withSchool(school.id, async (tx) => {
      const rows = await buildPlan(tx, school.id);
      const { currentYear, nextYear, nextYearExists } = await resolveYears(tx, school.id);

      let promoted = 0;
      let graduated = 0;
      let heldBack = 0;
      let skipped = 0;

      for (const r of rows) {
        if (hold.has(r.studentId)) {
          heldBack++;
          continue;
        }
        if (r.action === "PROMOTE" && r.toClassId) {
          await tx
            .update(students)
            .set({ classId: r.toClassId, currentClassLabel: r.toClass })
            .where(and(eq(students.id, r.studentId), eq(students.schoolId, school.id)));
          promoted++;
        } else if (r.action === "GRADUATE") {
          await tx
            .update(students)
            .set({ status: "GRADUATED" })
            .where(and(eq(students.id, r.studentId), eq(students.schoolId, school.id)));
          graduated++;
        } else {
          skipped++; // NO_TARGET / UNMATCHED — left as-is for manual handling
        }
      }

      // Create next year's calendar from this year's periods (dates shifted +1 year).
      let nextYearCreated = false;
      if (!nextYearExists) {
        const [cfg] = await tx
          .select()
          .from(academicPeriodConfig)
          .where(
            and(
              eq(academicPeriodConfig.schoolId, school.id),
              eq(academicPeriodConfig.academicYear, currentYear),
            ),
          );
        const curPeriods = await tx
          .select()
          .from(academicPeriod)
          .where(
            and(
              eq(academicPeriod.schoolId, school.id),
              eq(academicPeriod.academicYear, currentYear),
            ),
          )
          .orderBy(asc(academicPeriod.periodNumber));
        if (cfg && curPeriods.length > 0) {
          await tx.insert(academicPeriodConfig).values({
            schoolId: school.id,
            academicYear: nextYear,
            periodType: cfg.periodType,
            periodCount: cfg.periodCount,
            source: "SCHOOL_OVERRIDE",
            configuredBy: actor.id ?? undefined,
          });
          await tx.insert(academicPeriod).values(
            curPeriods.map((p) => ({
              schoolId: school.id,
              academicYear: nextYear,
              periodNumber: p.periodNumber,
              periodLabel: p.periodLabel,
              startsOn: shiftYearIso(String(p.startsOn)),
              endsOn: shiftYearIso(String(p.endsOn)),
            })),
          );
          nextYearCreated = true;
        }
      }

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "promoted",
        entityType: "school_year",
        entityId: school.id,
        after: { currentYear, nextYear, promoted, graduated, heldBack, skipped, nextYearCreated },
        reason: `Year-end promotion ${currentYear} → ${nextYear}`,
      });

      return { promoted, graduated, heldBack, skipped, nextYearCreated };
    });

    safeRevalidate("/students");
    safeRevalidate("/settings/academic");
    return { ok: true, ...out };
  } catch {
    return { ok: false, error: "Could not run the promotion. No changes were made." };
  }
}
