"use server";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { round2, gradeFor, weightedTotal } from "@/lib/gradebook-helpers";
import type { Tx } from "@/lib/db";
import {
  students,
  subjects,
  gradebookConfig,
  gradebookScores,
  gradebookColumns,
  gradebookColumnScores,
  gradeScale,
  reportCards,
} from "@/db/schema";

// ----------------------------------------------------------------- subjects
export async function createSubject(
  input: unknown,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { school } = await requireSchool();
  const parsed = z
    .object({
      name: z.string().min(1).max(80),
      code: z.string().max(20).optional().or(z.literal("")),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid subject name." };
  const actor = await resolveActor(school.id);
  try {
    const id = await withSchool(school.id, async (tx) => {
      const [s] = await tx
        .insert(subjects)
        .values({
          schoolId: school.id,
          name: parsed.data.name,
          code: parsed.data.code || null,
        })
        .returning();
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "subject",
        entityId: s.id,
        after: { name: s.name },
      });
      return s.id;
    });
    safeRevalidate("/gradebook");
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Could not create subject (name may already exist)." };
  }
}

async function getWeights(tx: Tx, schoolId: string): Promise<{ cw: number; ew: number }> {
  const [cfg] = await tx
    .select()
    .from(gradebookConfig)
    .where(eq(gradebookConfig.schoolId, schoolId));
  if (cfg) return { cw: cfg.classWeight, ew: cfg.examWeight };
  await tx.insert(gradebookConfig).values({ schoolId }).onConflictDoNothing();
  return { cw: 50, ew: 50 };
}

// ------------------------------------------------------------------- scores
const SaveScoresSchema = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  periodId: z.string().uuid(),
  entries: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        classScore: z.coerce.number().min(0).max(100).nullable().catch(null),
        examScore: z.coerce.number().min(0).max(100).nullable().catch(null),
      }),
    )
    .min(1, "No students"),
});

export type SaveScoresResult = { ok: true; saved: number } | { ok: false; error: string };

export async function saveScores(input: unknown): Promise<SaveScoresResult> {
  const { school } = await requireSchool();
  const parsed = SaveScoresSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid scores" };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const saved = await withSchool(school.id, async (tx) => {
      const { cw, ew } = await getWeights(tx, school.id);
      let n = 0;
      for (const e of d.entries) {
        const total = weightedTotal(e.classScore, e.examScore, cw, ew);
        await tx
          .insert(gradebookScores)
          .values({
            schoolId: school.id,
            studentId: e.studentId,
            subjectId: d.subjectId,
            periodId: d.periodId,
            classScore: e.classScore == null ? null : e.classScore.toFixed(2),
            examScore: e.examScore == null ? null : e.examScore.toFixed(2),
            total: total == null ? null : total.toFixed(2),
            grade: total == null ? null : gradeFor(total),
            updatedByUserId: actor.id ?? undefined,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              gradebookScores.schoolId,
              gradebookScores.studentId,
              gradebookScores.subjectId,
              gradebookScores.periodId,
            ],
            set: {
              classScore: e.classScore == null ? null : e.classScore.toFixed(2),
              examScore: e.examScore == null ? null : e.examScore.toFixed(2),
              total: total == null ? null : total.toFixed(2),
              grade: total == null ? null : gradeFor(total),
              updatedByUserId: actor.id ?? undefined,
              updatedAt: new Date(),
            },
          });
        n++;
      }
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "gradebook",
        entityId: d.subjectId,
        after: { periodId: d.periodId, scores: n, weights: `${cw}/${ew}` },
        reason: "Scores entered",
      });
      return n;
    });

    safeRevalidate("/gradebook");
    return { ok: true, saved };
  } catch {
    return { ok: false, error: "Could not save scores. Please try again." };
  }
}

// ---------------------------------------------------------- assessment columns
const CATEGORIES = ["CA", "EXAM"] as const;

const CreateColumnSchema = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  periodId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required.").max(80),
  category: z.enum(CATEGORIES).default("CA"),
  maxScore: z.coerce.number().positive("Max score must be greater than 0.").max(1000),
});

export type CreateColumnResult =
  | { ok: true; columnId: string }
  | { ok: false; error: string };

export async function createGradebookColumn(input: unknown): Promise<CreateColumnResult> {
  const { school } = await requireSchool();
  const parsed = CreateColumnSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid column." };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const columnId = await withSchool(school.id, async (tx) => {
      const [agg] = await tx
        .select({ maxPos: max(gradebookColumns.position) })
        .from(gradebookColumns)
        .where(
          and(
            eq(gradebookColumns.schoolId, school.id),
            eq(gradebookColumns.classId, d.classId),
            eq(gradebookColumns.subjectId, d.subjectId),
            eq(gradebookColumns.periodId, d.periodId),
          ),
        );
      const nextPos = (agg?.maxPos ?? -1) + 1;
      const [col] = await tx
        .insert(gradebookColumns)
        .values({
          schoolId: school.id,
          classId: d.classId,
          subjectId: d.subjectId,
          periodId: d.periodId,
          name: d.name,
          category: d.category,
          maxScore: d.maxScore.toFixed(2),
          position: nextPos,
          createdByUserId: actor.id ?? undefined,
        })
        .returning();
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "gradebook_column",
        entityId: col.id,
        after: { name: col.name, category: col.category, maxScore: col.maxScore },
      });
      return col.id;
    });
    safeRevalidate("/gradebook");
    return { ok: true, columnId };
  } catch {
    return { ok: false, error: "Could not add column (name may already exist)." };
  }
}

const TemplateSchema = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  periodId: z.string().uuid(),
});

/** The standard JHS shape: 3 quizzes, 2 assignments, 1 term exam. */
const COLUMN_TEMPLATE: { name: string; category: (typeof CATEGORIES)[number]; max: number }[] =
  [
    { name: "Quiz 1", category: "CA", max: 10 },
    { name: "Quiz 2", category: "CA", max: 10 },
    { name: "Quiz 3", category: "CA", max: 10 },
    { name: "Assignment 1", category: "CA", max: 10 },
    { name: "Assignment 2", category: "CA", max: 10 },
    { name: "Term Exam", category: "EXAM", max: 100 },
  ];

export type ApplyTemplateResult =
  | { ok: true; created: number }
  | { ok: false; error: string };

export async function applyColumnTemplate(input: unknown): Promise<ApplyTemplateResult> {
  const { school } = await requireSchool();
  const parsed = TemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const created = await withSchool(school.id, async (tx) => {
      const [agg] = await tx
        .select({ maxPos: max(gradebookColumns.position) })
        .from(gradebookColumns)
        .where(
          and(
            eq(gradebookColumns.schoolId, school.id),
            eq(gradebookColumns.classId, d.classId),
            eq(gradebookColumns.subjectId, d.subjectId),
            eq(gradebookColumns.periodId, d.periodId),
          ),
        );
      let pos = (agg?.maxPos ?? -1) + 1;
      const inserted = await tx
        .insert(gradebookColumns)
        .values(
          COLUMN_TEMPLATE.map((t) => ({
            schoolId: school.id,
            classId: d.classId,
            subjectId: d.subjectId,
            periodId: d.periodId,
            name: t.name,
            category: t.category,
            maxScore: t.max.toFixed(2),
            position: pos++,
            createdByUserId: actor.id ?? undefined,
          })),
        )
        .onConflictDoNothing({
          target: [
            gradebookColumns.schoolId,
            gradebookColumns.classId,
            gradebookColumns.subjectId,
            gradebookColumns.periodId,
            gradebookColumns.name,
          ],
        })
        .returning({ id: gradebookColumns.id });
      if (inserted.length > 0) {
        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "created",
          entityType: "gradebook_column",
          entityId: d.subjectId,
          after: { template: "jhs-standard", created: inserted.length },
          reason: "Applied column template",
        });
      }
      return inserted.length;
    });
    safeRevalidate("/gradebook");
    return { ok: true, created };
  } catch {
    return { ok: false, error: "Could not apply template. Please try again." };
  }
}

const DeleteColumnSchema = z.object({ columnId: z.string().uuid() });

export type DeleteColumnResult = { ok: true } | { ok: false; error: string };

export async function deleteGradebookColumn(input: unknown): Promise<DeleteColumnResult> {
  const { school } = await requireSchool();
  const parsed = DeleteColumnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    await withSchool(school.id, async (tx) => {
      const [col] = await tx
        .select({
          id: gradebookColumns.id,
          classId: gradebookColumns.classId,
          subjectId: gradebookColumns.subjectId,
          periodId: gradebookColumns.periodId,
          name: gradebookColumns.name,
        })
        .from(gradebookColumns)
        .where(
          and(
            eq(gradebookColumns.schoolId, school.id),
            eq(gradebookColumns.id, d.columnId),
          ),
        );
      if (!col) return;
      await tx
        .delete(gradebookColumns)
        .where(
          and(
            eq(gradebookColumns.schoolId, school.id),
            eq(gradebookColumns.id, d.columnId),
          ),
        );
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "deleted",
        entityType: "gradebook_column",
        entityId: col.id,
        before: { name: col.name },
      });
      await rollupContext(tx, school.id, actor.id ?? undefined, {
        classId: col.classId,
        subjectId: col.subjectId,
        periodId: col.periodId,
      });
    });
    safeRevalidate("/gradebook");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not delete column. Please try again." };
  }
}

const SaveColumnScoresSchema = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  periodId: z.string().uuid(),
  scores: z.array(
    z.object({
      columnId: z.string().uuid(),
      studentId: z.string().uuid(),
      raw: z.string(), // "" → clear; otherwise a number string
    }),
  ),
});

export type SaveColumnScoresResult =
  | { ok: true; saved: number }
  | { ok: false; error: string };

export async function saveColumnScores(input: unknown): Promise<SaveColumnScoresResult> {
  const { school } = await requireSchool();
  const parsed = SaveColumnScoresSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid scores." };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const saved = await withSchool(school.id, async (tx) => {
      // Load the columns for this context so we can clamp to each maxScore and
      // ignore any stray columnId that does not belong here.
      const cols = await tx
        .select({
          id: gradebookColumns.id,
          maxScore: gradebookColumns.maxScore,
        })
        .from(gradebookColumns)
        .where(
          and(
            eq(gradebookColumns.schoolId, school.id),
            eq(gradebookColumns.classId, d.classId),
            eq(gradebookColumns.subjectId, d.subjectId),
            eq(gradebookColumns.periodId, d.periodId),
          ),
        );
      const maxById = new Map(cols.map((c) => [c.id, Number(c.maxScore)]));

      let n = 0;
      for (const s of d.scores) {
        const ceiling = maxById.get(s.columnId);
        if (ceiling == null) continue; // column not in this context
        const trimmed = s.raw.trim();
        if (trimmed === "") {
          await tx
            .delete(gradebookColumnScores)
            .where(
              and(
                eq(gradebookColumnScores.schoolId, school.id),
                eq(gradebookColumnScores.columnId, s.columnId),
                eq(gradebookColumnScores.studentId, s.studentId),
              ),
            );
          n++;
          continue;
        }
        const num = Number(trimmed);
        if (!Number.isFinite(num)) continue;
        const clamped = Math.min(Math.max(num, 0), ceiling);
        await tx
          .insert(gradebookColumnScores)
          .values({
            schoolId: school.id,
            columnId: s.columnId,
            studentId: s.studentId,
            rawScore: clamped.toFixed(2),
            updatedByUserId: actor.id ?? undefined,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              gradebookColumnScores.schoolId,
              gradebookColumnScores.columnId,
              gradebookColumnScores.studentId,
            ],
            set: {
              rawScore: clamped.toFixed(2),
              updatedByUserId: actor.id ?? undefined,
              updatedAt: new Date(),
            },
          });
        n++;
      }

      await rollupContext(tx, school.id, actor.id ?? undefined, {
        classId: d.classId,
        subjectId: d.subjectId,
        periodId: d.periodId,
      });

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "gradebook",
        entityId: d.subjectId,
        after: { periodId: d.periodId, cells: n },
        reason: "Column scores entered",
      });
      return n;
    });

    safeRevalidate("/gradebook");
    return { ok: true, saved };
  } catch {
    return { ok: false, error: "Could not save scores. Please try again." };
  }
}

/**
 * Recompute the per-category percentages and weighted total for every ACTIVE
 * student in a (class · subject · period) context from their column scores, and
 * upsert the result into `gradebook_score` so report cards / reports stay in sync.
 *
 * caPct  = round( Σ(CA raw)   / Σ(CA max)   * 100, 2 )  when Σ(CA max)   > 0, else null
 * examPct= round( Σ(EXAM raw) / Σ(EXAM max) * 100, 2 )  when Σ(EXAM max) > 0, else null
 * total  = round( (caPct ?? 0) * cw/100 + (examPct ?? 0) * ew/100, 2 )  when either is non-null
 * grade  = gradeScale row with the greatest minScore <= total (null if no scale / null total)
 */
async function rollupContext(
  tx: Tx,
  schoolId: string,
  actorId: string | undefined,
  ctx: { classId: string; subjectId: string; periodId: string },
): Promise<void> {
  const roster = await tx
    .select({ id: students.id })
    .from(students)
    .where(
      and(
        eq(students.schoolId, schoolId),
        eq(students.classId, ctx.classId),
        eq(students.status, "ACTIVE"),
      ),
    );
  if (roster.length === 0) return;
  const ids = roster.map((r) => r.id);

  const cols = await tx
    .select({
      id: gradebookColumns.id,
      category: gradebookColumns.category,
      maxScore: gradebookColumns.maxScore,
    })
    .from(gradebookColumns)
    .where(
      and(
        eq(gradebookColumns.schoolId, schoolId),
        eq(gradebookColumns.classId, ctx.classId),
        eq(gradebookColumns.subjectId, ctx.subjectId),
        eq(gradebookColumns.periodId, ctx.periodId),
      ),
    );
  const colById = new Map(cols.map((c) => [c.id, c]));

  const rawScores = cols.length
    ? await tx
        .select({
          columnId: gradebookColumnScores.columnId,
          studentId: gradebookColumnScores.studentId,
          rawScore: gradebookColumnScores.rawScore,
        })
        .from(gradebookColumnScores)
        .where(
          and(
            eq(gradebookColumnScores.schoolId, schoolId),
            inArray(
              gradebookColumnScores.columnId,
              cols.map((c) => c.id),
            ),
            inArray(gradebookColumnScores.studentId, ids),
          ),
        )
    : [];

  const { cw, ew } = await getWeights(tx, schoolId);

  // Grade scale, highest threshold first.
  const scale = await tx
    .select({ grade: gradeScale.grade, minScore: gradeScale.minScore })
    .from(gradeScale)
    .where(eq(gradeScale.schoolId, schoolId))
    .orderBy(asc(gradeScale.minScore));
  const gradeForTotal = (total: number): string | null => {
    let best: string | null = null;
    for (const g of scale) {
      if (Number(g.minScore) <= total) best = g.grade;
    }
    return best;
  };

  // Per-student accumulators. A column's max counts toward a student's category
  // total only when that student has an actual mark for it — an unscored cell is
  // a dash, not a zero, so it neither helps nor hurts (matches the surface copy).
  const acc = new Map<
    string,
    { caRaw: number; caMax: number; exRaw: number; exMax: number }
  >();
  for (const id of ids) acc.set(id, { caRaw: 0, caMax: 0, exRaw: 0, exMax: 0 });
  for (const r of rawScores) {
    const a = acc.get(r.studentId);
    const col = colById.get(r.columnId);
    if (!a || !col || r.rawScore == null) continue;
    const raw = Number(r.rawScore);
    const m = Number(col.maxScore);
    if (col.category === "EXAM") {
      a.exRaw += raw;
      a.exMax += m;
    } else {
      a.caRaw += raw;
      a.caMax += m;
    }
  }

  for (const id of ids) {
    const a = acc.get(id)!;
    const caPct = a.caMax > 0 ? round2((a.caRaw / a.caMax) * 100) : null;
    const examPct = a.exMax > 0 ? round2((a.exRaw / a.exMax) * 100) : null;
    const total =
      caPct == null && examPct == null
        ? null
        : round2(((caPct ?? 0) * cw) / 100 + ((examPct ?? 0) * ew) / 100);
    const grade = total == null ? null : gradeForTotal(total);
    await tx
      .insert(gradebookScores)
      .values({
        schoolId,
        studentId: id,
        subjectId: ctx.subjectId,
        periodId: ctx.periodId,
        classScore: caPct == null ? null : caPct.toFixed(2),
        examScore: examPct == null ? null : examPct.toFixed(2),
        total: total == null ? null : total.toFixed(2),
        grade,
        updatedByUserId: actorId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          gradebookScores.schoolId,
          gradebookScores.studentId,
          gradebookScores.subjectId,
          gradebookScores.periodId,
        ],
        set: {
          classScore: caPct == null ? null : caPct.toFixed(2),
          examScore: examPct == null ? null : examPct.toFixed(2),
          total: total == null ? null : total.toFixed(2),
          grade,
          updatedByUserId: actorId,
          updatedAt: new Date(),
        },
      });
  }
}

// ------------------------------------------------------------- report cards
const ReportSchema = z.object({
  classId: z.string().uuid(),
  periodId: z.string().uuid(),
  remark: z.string().max(500).optional().or(z.literal("")),
});

export type GenerateReportsResult =
  | { ok: true; generated: number }
  | { ok: false; error: string };

export async function generateReportCards(
  input: unknown,
): Promise<GenerateReportsResult> {
  const { school } = await requireSchool();
  const parsed = ReportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const generated = await withSchool(school.id, async (tx) => {
      const roster = await tx
        .select({ id: students.id })
        .from(students)
        .where(
          and(
            eq(students.schoolId, school.id),
            eq(students.classId, d.classId),
            eq(students.status, "ACTIVE"),
          ),
        );
      if (roster.length === 0) return 0;

      const ids = roster.map((r) => r.id);
      const scores = await tx
        .select({
          studentId: gradebookScores.studentId,
          total: gradebookScores.total,
        })
        .from(gradebookScores)
        .where(
          and(
            eq(gradebookScores.schoolId, school.id),
            eq(gradebookScores.periodId, d.periodId),
            inArray(gradebookScores.studentId, ids),
          ),
        );

      let count = 0;
      for (const r of roster) {
        const totals = scores
          .filter((s) => s.studentId === r.id && s.total != null)
          .map((s) => Number(s.total));
        const overall = totals.length
          ? round2(totals.reduce((a, b) => a + b, 0) / totals.length)
          : null;
        await tx
          .insert(reportCards)
          .values({
            schoolId: school.id,
            studentId: r.id,
            periodId: d.periodId,
            overallTotal: overall == null ? null : overall.toFixed(2),
            overallGrade: overall == null ? null : gradeFor(overall),
            subjectCount: totals.length,
            remark: d.remark || null,
            generatedByUserId: actor.id ?? undefined,
            generatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [reportCards.schoolId, reportCards.studentId, reportCards.periodId],
            set: {
              overallTotal: overall == null ? null : overall.toFixed(2),
              overallGrade: overall == null ? null : gradeFor(overall),
              subjectCount: totals.length,
              remark: d.remark || null,
              generatedByUserId: actor.id ?? undefined,
              generatedAt: new Date(),
            },
          });
        count++;
      }
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "generated",
        entityType: "report_cards",
        entityId: d.classId,
        after: { periodId: d.periodId, count },
        reason: "Term report cards generated",
      });
      return count;
    });

    safeRevalidate("/gradebook/reports");
    return { ok: true, generated };
  } catch {
    return { ok: false, error: "Could not generate report cards." };
  }
}
