"use server";
import { and, eq, inArray } from "drizzle-orm";
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
