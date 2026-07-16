"use server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor, assertAnyRole } from "@/lib/auth/server";
import { SENIOR_LEDGER_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import type { Tx } from "@/lib/db";
import {
  classes,
  students,
  academicPeriod,
  seniorAssessments,
  seniorAssessmentScores,
  seniorScoreLedger,
  seniorLedgerPath,
  assessmentWeights,
} from "@/db/schema";
import {
  resolveWeights,
  compileComputableCategories,
  weightedTotalComplete,
  computedStatus,
  allCategoriesPresent,
  parseCategoryCell,
  type CategoryScores,
  type CategoryWeights,
  type EventMark,
  type ComputableCategory,
} from "@/lib/score-ledger/compute";
import { reasonRequiredForCommit, removalRejectsReGraded } from "@/lib/score-ledger/scan-diff";
import {
  grainHasChange,
  writeLedgerVersion,
  prunePriorPeriodVersions,
} from "@/lib/score-ledger/ledger-version";
import { ledgerCorrectionReasonEnum } from "@/db/schema/_enums";

const LEDGER_PATH = "/senior/score-ledger";
const CATEGORIES = [
  "ASSIGNMENT",
  "MID_SEM_EXAM",
  "END_SEM_EXAM",
  "PROJECT",
] as const;

type Ctx = { classId: string; subjectId: string; periodId: string };

/** A closed period is finalised — its scores are read-only. Returns an error label or null. */
async function closedPeriodError(schoolId: string, periodId: string): Promise<string | null> {
  const rows = await withSchool(schoolId, (tx) =>
    tx
      .select({ label: academicPeriod.periodLabel, closedAt: academicPeriod.closedAt })
      .from(academicPeriod)
      .where(
        and(eq(academicPeriod.periodId, periodId), eq(academicPeriod.schoolId, schoolId)),
      ),
  );
  if (rows[0]?.closedAt) {
    return `${rows[0].label} is closed — its scores are final. Reopen the semester in Settings → Academic to edit.`;
  }
  return null;
}

/** Resolve the five category weights for a (school × subject): subject row → school default → system. */
async function loadWeights(
  tx: Tx,
  schoolId: string,
  subjectId: string,
): Promise<CategoryWeights> {
  const rows = await tx
    .select()
    .from(assessmentWeights)
    .where(eq(assessmentWeights.schoolId, schoolId));
  const toW = (r: (typeof rows)[number]): CategoryWeights => ({
    asgn: r.asgnWeight,
    midSem: r.midSemWeight,
    endSem: r.endSemWeight,
    project: r.projectWeight,
    portfolio: r.portfolioWeight,
  });
  const subjectRow = rows.find((r) => r.subjectId === subjectId);
  const defaultRow = rows.find((r) => r.subjectId === null);
  return resolveWeights(subjectRow ? toW(subjectRow) : null, defaultRow ? toW(defaultRow) : null);
}

/**
 * The Path A auto-compile — the SHS analogue of the Basic gradebook's rollupContext.
 * For every ACTIVE student in a (class · subject · period): reduce their assessment events
 * to the four computable categories (compute.ts), keep the manually-entered portfolio,
 * apply the resolved weights, and upsert one senior_score_ledger row. The compile NEVER
 * overwrites portfolio_score/portfolio_manual (manual, spec §4.1) and preserves an explicit
 * STPSHS_READY sign-off while the ledger is still complete. Idempotent — the unique grain
 * (school, student, subject, period) guarantees one row per student.
 */
async function compileLedgerContext(
  tx: Tx,
  schoolId: string,
  actorId: string | undefined,
  ctx: Ctx,
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

  const events = await tx
    .select({
      id: seniorAssessments.id,
      category: seniorAssessments.category,
      maxMark: seniorAssessments.maxMark,
    })
    .from(seniorAssessments)
    .where(
      and(
        eq(seniorAssessments.schoolId, schoolId),
        eq(seniorAssessments.classId, ctx.classId),
        eq(seniorAssessments.subjectId, ctx.subjectId),
        eq(seniorAssessments.periodId, ctx.periodId),
      ),
    );
  const eventById = new Map(events.map((e) => [e.id, e]));

  const marks = events.length
    ? await tx
        .select({
          assessmentId: seniorAssessmentScores.assessmentId,
          studentId: seniorAssessmentScores.studentId,
          rawMark: seniorAssessmentScores.rawMark,
        })
        .from(seniorAssessmentScores)
        .where(
          and(
            eq(seniorAssessmentScores.schoolId, schoolId),
            inArray(
              seniorAssessmentScores.assessmentId,
              events.map((e) => e.id),
            ),
            inArray(seniorAssessmentScores.studentId, ids),
          ),
        )
    : [];

  // Existing ledger rows — portfolio (manual) and STPSHS_READY sign-off are preserved.
  const existing = await tx
    .select({
      studentId: seniorScoreLedger.studentId,
      portfolioScore: seniorScoreLedger.portfolioScore,
      portfolioManual: seniorScoreLedger.portfolioManual,
      status: seniorScoreLedger.status,
    })
    .from(seniorScoreLedger)
    .where(
      and(
        eq(seniorScoreLedger.schoolId, schoolId),
        eq(seniorScoreLedger.subjectId, ctx.subjectId),
        eq(seniorScoreLedger.periodId, ctx.periodId),
        inArray(seniorScoreLedger.studentId, ids),
      ),
    );
  const existingByStudent = new Map(existing.map((e) => [e.studentId, e]));

  const weights = await loadWeights(tx, schoolId, ctx.subjectId);

  // Group each student's marks into EventMark[] for the pure compiler.
  const marksByStudent = new Map<string, EventMark[]>();
  for (const id of ids) marksByStudent.set(id, []);
  for (const m of marks) {
    const ev = eventById.get(m.assessmentId);
    const bucket = marksByStudent.get(m.studentId);
    if (!ev || !bucket) continue;
    bucket.push({
      category: ev.category as ComputableCategory,
      maxMark: Number(ev.maxMark),
      rawMark: m.rawMark == null ? null : Number(m.rawMark),
    });
  }

  for (const id of ids) {
    const four = compileComputableCategories(marksByStudent.get(id) ?? []);
    const prev = existingByStudent.get(id);
    const portfolio = prev?.portfolioScore == null ? null : Number(prev.portfolioScore);
    const cats = { ...four, portfolio };
    const total = weightedTotalComplete(cats, weights);
    const complete = allCategoriesPresent(cats);
    const status =
      prev?.status === "STPSHS_READY" && complete ? "STPSHS_READY" : computedStatus(cats);

    const values = {
      schoolId,
      studentId: id,
      subjectId: ctx.subjectId,
      periodId: ctx.periodId,
      asgnScore: four.asgn == null ? null : four.asgn.toFixed(2),
      midSemScore: four.midSem == null ? null : four.midSem.toFixed(2),
      endSemScore: four.endSem == null ? null : four.endSem.toFixed(2),
      projectScore: four.project == null ? null : four.project.toFixed(2),
      weightedTotal: total == null ? null : total.toFixed(2),
      asgnWeightUsed: weights.asgn,
      midSemWeightUsed: weights.midSem,
      endSemWeightUsed: weights.endSem,
      projectWeightUsed: weights.project,
      portfolioWeightUsed: weights.portfolio,
      status: status as "DRAFT" | "COMPLETE" | "STPSHS_READY",
      compiledByUserId: actorId,
      compiledAt: new Date(),
      updatedAt: new Date(),
    };

    await tx
      .insert(seniorScoreLedger)
      .values(values)
      .onConflictDoUpdate({
        target: [
          seniorScoreLedger.schoolId,
          seniorScoreLedger.studentId,
          seniorScoreLedger.subjectId,
          seniorScoreLedger.periodId,
        ],
        // Portfolio (manual) is deliberately NOT in the update set — compile never touches it.
        set: {
          asgnScore: values.asgnScore,
          midSemScore: values.midSemScore,
          endSemScore: values.endSemScore,
          projectScore: values.projectScore,
          weightedTotal: values.weightedTotal,
          asgnWeightUsed: values.asgnWeightUsed,
          midSemWeightUsed: values.midSemWeightUsed,
          endSemWeightUsed: values.endSemWeightUsed,
          projectWeightUsed: values.projectWeightUsed,
          portfolioWeightUsed: values.portfolioWeightUsed,
          status: values.status,
          compiledByUserId: actorId,
          compiledAt: values.compiledAt,
          updatedAt: values.updatedAt,
        },
      });
  }
}

// ----------------------------------------------------------- assessment events
const CreateAssessmentSchema = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  periodId: z.string().uuid(),
  category: z.enum(CATEGORIES),
  title: z.string().trim().min(1, "Title is required.").max(80),
  // Ceiling is the numeric(5,2) column max (999.99), so max_mark can never overflow.
  maxMark: z.coerce.number().positive("Max mark must be greater than 0.").max(999.99),
});

export type CreateAssessmentResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createSeniorAssessment(
  input: unknown,
): Promise<CreateAssessmentResult> {
  const { school } = await requireSchool();
  await assertAnyRole(SENIOR_LEDGER_ROLES);
  const parsed = CreateAssessmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid assessment." };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    const id = await withSchool(school.id, async (tx) => {
      const [ev] = await tx
        .insert(seniorAssessments)
        .values({
          schoolId: school.id,
          classId: d.classId,
          subjectId: d.subjectId,
          periodId: d.periodId,
          category: d.category,
          title: d.title,
          maxMark: d.maxMark.toFixed(2),
          createdByUserId: actor.id ?? undefined,
        })
        .returning();
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "senior_assessment",
        entityId: ev.id,
        after: { category: ev.category, title: ev.title, maxMark: ev.maxMark },
      });
      return ev.id;
    });
    safeRevalidate(LEDGER_PATH);
    return { ok: true, id };
  } catch {
    return {
      ok: false,
      error:
        "Could not add assessment. A mid-sem/end-sem exam may already exist, or the title is taken.",
    };
  }
}

const DeleteAssessmentSchema = z.object({ assessmentId: z.string().uuid() });

export async function deleteSeniorAssessment(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { school } = await requireSchool();
  await assertAnyRole(SENIOR_LEDGER_ROLES);
  const parsed = DeleteAssessmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const actor = await resolveActor(school.id);
  try {
    const result = await withSchool(
      school.id,
      async (tx): Promise<{ ok: true } | { ok: false; error: string }> => {
        const [ev] = await tx
          .select({
            id: seniorAssessments.id,
            classId: seniorAssessments.classId,
            subjectId: seniorAssessments.subjectId,
            periodId: seniorAssessments.periodId,
            title: seniorAssessments.title,
          })
          .from(seniorAssessments)
          .where(
            and(
              eq(seniorAssessments.schoolId, school.id),
              eq(seniorAssessments.id, parsed.data.assessmentId),
            ),
          );
        if (!ev) return { ok: true }; // already gone
        // Deleting recompiles the ledger — refuse on a closed (finalised) semester so
        // final scores can't be silently mutated (Sarah finding).
        const [pd] = await tx
          .select({ label: academicPeriod.periodLabel, closedAt: academicPeriod.closedAt })
          .from(academicPeriod)
          .where(
            and(
              eq(academicPeriod.schoolId, school.id),
              eq(academicPeriod.periodId, ev.periodId),
            ),
          );
        if (pd?.closedAt) {
          return {
            ok: false,
            error: `${pd.label} is closed — its scores are final. Reopen the semester in Settings → Academic to edit.`,
          };
        }
        await tx
          .delete(seniorAssessments)
          .where(
            and(
              eq(seniorAssessments.schoolId, school.id),
              eq(seniorAssessments.id, parsed.data.assessmentId),
            ),
          );
        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "deleted",
          entityType: "senior_assessment",
          entityId: ev.id,
          before: { title: ev.title },
        });
        await compileLedgerContext(tx, school.id, actor.id ?? undefined, {
          classId: ev.classId,
          subjectId: ev.subjectId,
          periodId: ev.periodId,
        });
        return { ok: true };
      },
    );
    if (!result.ok) return result;
    safeRevalidate(LEDGER_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not delete assessment. Please try again." };
  }
}

// --------------------------------------------------- assessment marks (Path A)
const SaveMarksSchema = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  periodId: z.string().uuid(),
  scores: z.array(
    z.object({
      assessmentId: z.string().uuid(),
      studentId: z.string().uuid(),
      raw: z.string(), // "" → clear; otherwise a number string
    }),
  ),
});

export type SaveMarksResult = { ok: true; saved: number } | { ok: false; error: string };

export async function saveAssessmentScores(input: unknown): Promise<SaveMarksResult> {
  const { school } = await requireSchool();
  await assertAnyRole(SENIOR_LEDGER_ROLES);
  const parsed = SaveMarksSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid scores." };
  }
  const d = parsed.data;
  // Reject out-of-range marks up front with a clear message, so a bad entry can never
  // reach the DB as a numeric(5,2) overflow that surfaces as the generic catch (Quinn MAJOR).
  for (const s of d.scores) {
    const t = s.raw.trim();
    if (t === "") continue;
    const num = Number(t);
    if (Number.isFinite(num) && (num < 0 || num > 999.99)) {
      return { ok: false, error: "Each mark must be between 0 and 999.99." };
    }
  }
  const closed = await closedPeriodError(school.id, d.periodId);
  if (closed) return { ok: false, error: closed };
  const actor = await resolveActor(school.id);

  try {
    const saved = await withSchool(school.id, async (tx) => {
      // Only accept marks for events in this exact context.
      const valid = await tx
        .select({ id: seniorAssessments.id })
        .from(seniorAssessments)
        .where(
          and(
            eq(seniorAssessments.schoolId, school.id),
            eq(seniorAssessments.classId, d.classId),
            eq(seniorAssessments.subjectId, d.subjectId),
            eq(seniorAssessments.periodId, d.periodId),
          ),
        );
      const validIds = new Set(valid.map((v) => v.id));

      let n = 0;
      for (const s of d.scores) {
        if (!validIds.has(s.assessmentId)) continue;
        const trimmed = s.raw.trim();
        if (trimmed === "") {
          await tx
            .delete(seniorAssessmentScores)
            .where(
              and(
                eq(seniorAssessmentScores.schoolId, school.id),
                eq(seniorAssessmentScores.assessmentId, s.assessmentId),
                eq(seniorAssessmentScores.studentId, s.studentId),
              ),
            );
          n++;
          continue;
        }
        const num = Number(trimmed);
        // Non-negative and finite; over-max (bonus) is allowed — the UI soft-warns (Kofi Q3).
        if (!Number.isFinite(num) || num < 0) continue;
        await tx
          .insert(seniorAssessmentScores)
          .values({
            schoolId: school.id,
            assessmentId: s.assessmentId,
            studentId: s.studentId,
            rawMark: num.toFixed(2),
            updatedByUserId: actor.id ?? undefined,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              seniorAssessmentScores.schoolId,
              seniorAssessmentScores.assessmentId,
              seniorAssessmentScores.studentId,
            ],
            set: {
              rawMark: num.toFixed(2),
              updatedByUserId: actor.id ?? undefined,
              updatedAt: new Date(),
            },
          });
        n++;
      }

      // Path A auto-compile — the just-entered marks flow into the ledger.
      await compileLedgerContext(tx, school.id, actor.id ?? undefined, {
        classId: d.classId,
        subjectId: d.subjectId,
        periodId: d.periodId,
      });

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "senior_score_ledger",
        entityId: d.subjectId,
        after: { periodId: d.periodId, cells: n, path: "A" },
        reason: "Assessment marks entered (auto-compile)",
      });
      return n;
    });
    safeRevalidate(LEDGER_PATH);
    return { ok: true, saved };
  } catch {
    return { ok: false, error: "Could not save marks. Please try again." };
  }
}

// -------------------------------------------------------- portfolio (manual)
const SavePortfolioSchema = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  periodId: z.string().uuid(),
  scores: z.array(
    z.object({
      studentId: z.string().uuid(),
      value: z.string(), // "" → clear; otherwise 0–999.99 (parseCategoryCell, shared with Paths A/B/C)
    }),
  ),
});

export type SavePortfolioResult =
  | { ok: true; saved: number }
  | { ok: false; error: string };

/**
 * Enter the portfolio score by hand — the one category Omnischools cannot auto-compile
 * (spec §2/§4.1). Writes portfolio_score + portfolio_manual onto the ledger, then re-runs
 * the compile so the weighted total and status pick up the new fifth category.
 */
export async function savePortfolioScores(input: unknown): Promise<SavePortfolioResult> {
  const { school } = await requireSchool();
  await assertAnyRole(SENIOR_LEDGER_ROLES);
  const parsed = SavePortfolioSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid scores." };
  }
  const d = parsed.data;
  const closed = await closedPeriodError(school.id, d.periodId);
  if (closed) return { ok: false, error: closed };

  // Validate + parse EVERY portfolio cell up-front through the SAME parseCategoryCell path Paths
  // A/B/C use (0–MAX_PERCENT / 999.99, INCR-2 Option A) so the paths can't disagree. An
  // out-of-range value REJECTS with an error — never silently dropped then falsely reported as
  // saved (Quinn MAJOR / B6 / R4): the PWA buffer's bufferReject then drives the red errored cell.
  const parsedScores: { studentId: string; value: number | null }[] = [];
  for (const s of d.scores) {
    const v = parseCategoryCell(s.value);
    if (v === "invalid") {
      return { ok: false, error: "Portfolio score must be between 0 and 999.99." };
    }
    parsedScores.push({ studentId: s.studentId, value: v });
  }
  const actor = await resolveActor(school.id);

  try {
    const saved = await withSchool(school.id, async (tx) => {
      // Only accept portfolio scores for students actually in this class — symmetry with
      // saveAssessmentScores, which validates against the context (Sarah/Dex finding). The
      // composite FK + RLS already confine writes to this school; this stops a same-school
      // student outside the roster getting an orphan portfolio row.
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
      const validStudents = new Set(roster.map((r) => r.id));
      let n = 0;
      for (const { studentId, value: num } of parsedScores) {
        if (!validStudents.has(studentId)) continue;
        await tx
          .insert(seniorScoreLedger)
          .values({
            schoolId: school.id,
            studentId,
            subjectId: d.subjectId,
            periodId: d.periodId,
            portfolioScore: num == null ? null : num.toFixed(2),
            portfolioManual: num != null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              seniorScoreLedger.schoolId,
              seniorScoreLedger.studentId,
              seniorScoreLedger.subjectId,
              seniorScoreLedger.periodId,
            ],
            set: {
              portfolioScore: num == null ? null : num.toFixed(2),
              portfolioManual: num != null,
              updatedAt: new Date(),
            },
          });
        n++;
      }
      // Recompute totals/status now that the fifth category may be present.
      await compileLedgerContext(tx, school.id, actor.id ?? undefined, {
        classId: d.classId,
        subjectId: d.subjectId,
        periodId: d.periodId,
      });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "senior_score_ledger",
        entityId: d.subjectId,
        after: { periodId: d.periodId, portfolioCells: n },
        reason: "Portfolio scores entered (manual)",
      });
      return n;
    });
    safeRevalidate(LEDGER_PATH);
    return { ok: true, saved };
  } catch {
    return { ok: false, error: "Could not save portfolio scores. Please try again." };
  }
}

// ------------------------------------------------------ capture path (§4.4)
const CAPTURE_PATHS = ["AUTO_COMPILE", "SCAN_EXTRACT", "DIRECT_ENTRY"] as const;

const SetPathSchema = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  periodId: z.string().uuid(),
  path: z.enum(CAPTURE_PATHS),
});

export type SetPathResult = { ok: true } | { ok: false; error: string };

/** Choose the capture path for a (class × subject × period). Switchable per spec §4.4. */
export async function setLedgerPath(input: unknown): Promise<SetPathResult> {
  const { school } = await requireSchool();
  await assertAnyRole(SENIOR_LEDGER_ROLES);
  const parsed = SetPathSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid path." };
  const d = parsed.data;
  // Don't switch the capture medium of a closed (finalised) semester.
  const closed = await closedPeriodError(school.id, d.periodId);
  if (closed) return { ok: false, error: closed };
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await tx
        .insert(seniorLedgerPath)
        .values({
          schoolId: school.id,
          classId: d.classId,
          subjectId: d.subjectId,
          periodId: d.periodId,
          path: d.path,
          updatedByUserId: actor.id ?? undefined,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            seniorLedgerPath.schoolId,
            seniorLedgerPath.classId,
            seniorLedgerPath.subjectId,
            seniorLedgerPath.periodId,
          ],
          set: { path: d.path, updatedByUserId: actor.id ?? undefined, updatedAt: new Date() },
        });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "senior_ledger_path",
        entityId: d.classId,
        after: { subjectId: d.subjectId, periodId: d.periodId, path: d.path },
        reason: "Capture path changed",
      });
    });
    safeRevalidate(LEDGER_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not change the path. Please try again." };
  }
}

// ----------------------------------------- class switch audit (PWA · INCR-4)
const SwitchClassSchema = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  periodId: z.string().uuid(),
});

/**
 * Record a class-context switch from the PWA bottom sheet (INCR-4 / S5). The switch is
 * "who looked at which class, when" — the same class-context audit trail every other
 * class action writes, so the phone adds no new audit surface. Tenant-scoped: the class
 * must belong to the caller's school (RLS + the existence check) or nothing is logged.
 * Read-only navigation — never touches senior_score_ledger.
 */
export async function logClassSwitch(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { school } = await requireSchool();
  await assertAnyRole(SENIOR_LEDGER_ROLES);
  const parsed = SwitchClassSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid class." };
  const d = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      const [cls] = await tx
        .select({ id: classes.id })
        .from(classes)
        .where(and(eq(classes.schoolId, school.id), eq(classes.id, d.classId)));
      if (!cls) return; // not this school's class — RLS-safe no-op
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "viewed",
        entityType: "senior_score_ledger",
        entityId: d.classId,
        after: { subjectId: d.subjectId, periodId: d.periodId, via: "pwa_switcher" },
        reason: "Class switched (PWA)",
      });
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not record the switch." };
  }
}

// ------------------------------------------- Path C — direct digital entry
const DirectRowSchema = z.object({
  studentId: z.string().uuid(),
  asgn: z.string(),
  midSem: z.string(),
  endSem: z.string(),
  project: z.string(),
  portfolio: z.string(),
});
const SaveDirectSchema = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  periodId: z.string().uuid(),
  scores: z.array(DirectRowSchema),
});

export type SaveDirectResult = { ok: true; saved: number } | { ok: false; error: string };

/**
 * Path C (spec §4.3) — the teacher types the five category scores straight onto the
 * ledger; the entered values ARE the record (no assessment events, no compile). Each
 * category is a 0–100 score. The context must be set to DIRECT_ENTRY first (the path
 * chooser does this) so a Path A ledger can't be overwritten by direct entry.
 */
export async function saveDirectLedgerScores(input: unknown): Promise<SaveDirectResult> {
  const { school } = await requireSchool();
  await assertAnyRole(SENIOR_LEDGER_ROLES);
  const parsed = SaveDirectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid scores." };
  }
  const d = parsed.data;
  const closed = await closedPeriodError(school.id, d.periodId);
  if (closed) return { ok: false, error: closed };

  // Validate + parse EVERY cell up-front, before opening the transaction, so a single
  // out-of-range cell can never leave earlier rows committed (atomicity — Quinn MAJOR).
  const parsedRows: { studentId: string; cats: CategoryScores }[] = [];
  for (const s of d.scores) {
    const vals = {
      asgn: parseCategoryCell(s.asgn),
      midSem: parseCategoryCell(s.midSem),
      endSem: parseCategoryCell(s.endSem),
      project: parseCategoryCell(s.project),
      portfolio: parseCategoryCell(s.portfolio),
    };
    if (Object.values(vals).some((v) => v === "invalid")) {
      return { ok: false, error: "Each category score must be between 0 and 999.99." };
    }
    parsedRows.push({ studentId: s.studentId, cats: vals as CategoryScores });
  }

  const actor = await resolveActor(school.id);

  try {
    const outcome = await withSchool(
      school.id,
      async (tx): Promise<{ ok: true; saved: number } | { ok: false; error: string }> => {
        // The context must be on the direct-entry path.
        const [pathRow] = await tx
          .select({ path: seniorLedgerPath.path })
          .from(seniorLedgerPath)
          .where(
            and(
              eq(seniorLedgerPath.schoolId, school.id),
              eq(seniorLedgerPath.classId, d.classId),
              eq(seniorLedgerPath.subjectId, d.subjectId),
              eq(seniorLedgerPath.periodId, d.periodId),
            ),
          );
        if (pathRow?.path !== "DIRECT_ENTRY") {
          return { ok: false, error: "Switch this class to Direct entry (Path C) first." };
        }

        // Only students in this class.
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
        const validStudents = new Set(roster.map((r) => r.id));
        const ids = roster.map((r) => r.id);

        // Preserve an explicit STPSHS_READY sign-off across a re-save (mirrors the Path A
        // compile, which never silently downgrades a signed-off complete row — Dex).
        const existing = ids.length
          ? await tx
              .select({
                studentId: seniorScoreLedger.studentId,
                status: seniorScoreLedger.status,
              })
              .from(seniorScoreLedger)
              .where(
                and(
                  eq(seniorScoreLedger.schoolId, school.id),
                  eq(seniorScoreLedger.subjectId, d.subjectId),
                  eq(seniorScoreLedger.periodId, d.periodId),
                  inArray(seniorScoreLedger.studentId, ids),
                ),
              )
          : [];
        const prevStatus = new Map(existing.map((e) => [e.studentId, e.status]));

        const weights = await loadWeights(tx, school.id, d.subjectId);
        let n = 0;
        for (const { studentId, cats } of parsedRows) {
          if (!validStudents.has(studentId)) continue;
          const total = weightedTotalComplete(cats, weights);
          const status =
            prevStatus.get(studentId) === "STPSHS_READY" && allCategoriesPresent(cats)
              ? ("STPSHS_READY" as const)
              : computedStatus(cats);
          await tx
            .insert(seniorScoreLedger)
            .values({
              schoolId: school.id,
              studentId,
              subjectId: d.subjectId,
              periodId: d.periodId,
              asgnScore: cats.asgn == null ? null : cats.asgn.toFixed(2),
              midSemScore: cats.midSem == null ? null : cats.midSem.toFixed(2),
              endSemScore: cats.endSem == null ? null : cats.endSem.toFixed(2),
              projectScore: cats.project == null ? null : cats.project.toFixed(2),
              portfolioScore: cats.portfolio == null ? null : cats.portfolio.toFixed(2),
              weightedTotal: total == null ? null : total.toFixed(2),
              asgnWeightUsed: weights.asgn,
              midSemWeightUsed: weights.midSem,
              endSemWeightUsed: weights.endSem,
              projectWeightUsed: weights.project,
              portfolioWeightUsed: weights.portfolio,
              portfolioManual: cats.portfolio != null,
              status,
              compiledByUserId: actor.id ?? undefined,
              compiledAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                seniorScoreLedger.schoolId,
                seniorScoreLedger.studentId,
                seniorScoreLedger.subjectId,
                seniorScoreLedger.periodId,
              ],
              set: {
                asgnScore: cats.asgn == null ? null : cats.asgn.toFixed(2),
                midSemScore: cats.midSem == null ? null : cats.midSem.toFixed(2),
                endSemScore: cats.endSem == null ? null : cats.endSem.toFixed(2),
                projectScore: cats.project == null ? null : cats.project.toFixed(2),
                portfolioScore: cats.portfolio == null ? null : cats.portfolio.toFixed(2),
                weightedTotal: total == null ? null : total.toFixed(2),
                asgnWeightUsed: weights.asgn,
                midSemWeightUsed: weights.midSem,
                endSemWeightUsed: weights.endSem,
                projectWeightUsed: weights.project,
                portfolioWeightUsed: weights.portfolio,
                portfolioManual: cats.portfolio != null,
                status,
                compiledByUserId: actor.id ?? undefined,
                compiledAt: new Date(),
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
          entityType: "senior_score_ledger",
          entityId: d.subjectId,
          after: { periodId: d.periodId, rows: n, path: "C" },
          reason: "Direct ledger entry (Path C)",
        });
        return { ok: true, saved: n };
      },
    );
    if (outcome.ok) safeRevalidate(LEDGER_PATH);
    return outcome;
  } catch {
    return { ok: false, error: "Could not save scores. Please try again." };
  }
}

// ------------------------------------------- Path B — scan verify & commit (Item 4 / INCR-2)
const SCAN_PATH = "/senior/score-ledger/scan";
const SCAN_CATS = ["asgn", "midSem", "endSem", "project", "portfolio"] as const;
type ScanCat = (typeof SCAN_CATS)[number];
const CAT_LABEL: Record<ScanCat, string> = {
  asgn: "assignment",
  midSem: "mid-sem",
  endSem: "end-sem",
  project: "project",
  portfolio: "portfolio",
};
// The authoritative reason domain IS the DB enum ledger_correction_reason (db/schema/_enums.ts) —
// derived, not re-declared, so the Zod domain can never drift from the column (Dex-1). The chosen
// code rides audit_log.reason (Kofi Q1/Q4); there is no ledger column and no image reference.
const REASON_CODES = ledgerCorrectionReasonEnum.enumValues;

const CommitScanSchema = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  periodId: z.string().uuid(),
  // Real provenance (Kofi final decision 3 / F4): SCAN_EXTRACT if any cell came from the scan,
  // DIRECT_ENTRY if extraction failed wholesale and the teacher typed a blank grid in place.
  origin: z.enum(["SCAN_EXTRACT", "DIRECT_ENTRY"]),
  scores: z.array(DirectRowSchema),
  reasons: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        category: z.enum(SCAN_CATS),
        code: z.enum(REASON_CODES),
        note: z.string().trim().max(280).optional(),
      }),
    )
    .default([]),
});

export type CommitScanResult = { ok: true; saved: number } | { ok: false; error: string };

const numOrNull = (v: string | null) => (v == null ? null : Number(v));

/**
 * Path B commit (spec §4.2 / Kofi Q6 / E2) — the teacher has verified the extracted grid and
 * settled every cell; commit writes the confirmed five category values to senior_score_ledger
 * (the SAME rows Paths A/C write) in ONE transaction, records the real path used + every
 * correction reason on audit_log, and returns. There is no scan record and no image — the photo
 * lived only in the browser + in-flight to Claude and is discarded on the client at this point
 * (owner ruling 3 / G4). A reason is enforced server-side for every score-down and every
 * committed→blank keep-blank (Q4 / B8), recomputed here from what was actually submitted — never
 * trusting a client flag. Uncovered students (multi-page partial / D3 / E3) are simply not in the
 * payload, so their committed rows are untouched, never blanked.
 */
export async function commitScanLedger(input: unknown): Promise<CommitScanResult> {
  const { school } = await requireSchool();
  await assertAnyRole(SENIOR_LEDGER_ROLES);
  const parsed = CommitScanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid scores." };
  }
  const d = parsed.data;
  const closed = await closedPeriodError(school.id, d.periodId);
  if (closed) return { ok: false, error: closed };

  // A free-text note is mandatory on OTHER (Kofi Q4) — validated before the DB.
  for (const r of d.reasons) {
    if (r.code === "OTHER" && !(r.note && r.note.length > 0)) {
      return { ok: false, error: "Add a short note explaining the 'Other' reason." };
    }
  }

  // Validate + parse every cell up-front, before the transaction (atomicity — same as Path C).
  const parsedRows: { studentId: string; cats: CategoryScores }[] = [];
  for (const s of d.scores) {
    const vals = {
      asgn: parseCategoryCell(s.asgn),
      midSem: parseCategoryCell(s.midSem),
      endSem: parseCategoryCell(s.endSem),
      project: parseCategoryCell(s.project),
      portfolio: parseCategoryCell(s.portfolio),
    };
    if (Object.values(vals).some((v) => v === "invalid")) {
      return { ok: false, error: "Each category score must be between 0 and 999.99." };
    }
    parsedRows.push({ studentId: s.studentId, cats: vals as CategoryScores });
  }

  const reasonByKey = new Map(
    d.reasons.map((r) => [`${r.studentId}:${r.category}`, r] as const),
  );
  const actor = await resolveActor(school.id);

  try {
    const outcome = await withSchool(
      school.id,
      async (tx): Promise<{ ok: true; saved: number } | { ok: false; error: string }> => {
        // The context must be on Path B (the /scan screen is only reachable then).
        const [pathRow] = await tx
          .select({ path: seniorLedgerPath.path })
          .from(seniorLedgerPath)
          .where(
            and(
              eq(seniorLedgerPath.schoolId, school.id),
              eq(seniorLedgerPath.classId, d.classId),
              eq(seniorLedgerPath.subjectId, d.subjectId),
              eq(seniorLedgerPath.periodId, d.periodId),
            ),
          );
        if (pathRow?.path !== "SCAN_EXTRACT") {
          return { ok: false, error: "Switch this class to Scan & extract (Path B) first." };
        }

        // Only ACTIVE students in this class (tenant + roster scope).
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
        const validStudents = new Set(roster.map((r) => r.id));
        const ids = roster.map((r) => r.id);

        // The currently-committed cells — the diff baseline (Kofi Q1) and the STPSHS_READY carry.
        const existing = ids.length
          ? await tx
              .select({
                studentId: seniorScoreLedger.studentId,
                asgnScore: seniorScoreLedger.asgnScore,
                midSemScore: seniorScoreLedger.midSemScore,
                endSemScore: seniorScoreLedger.endSemScore,
                projectScore: seniorScoreLedger.projectScore,
                portfolioScore: seniorScoreLedger.portfolioScore,
                status: seniorScoreLedger.status,
              })
              .from(seniorScoreLedger)
              .where(
                and(
                  eq(seniorScoreLedger.schoolId, school.id),
                  eq(seniorScoreLedger.subjectId, d.subjectId),
                  eq(seniorScoreLedger.periodId, d.periodId),
                  inArray(seniorScoreLedger.studentId, ids),
                ),
              )
          : [];
        const committedByStudent = new Map(
          existing.map((e) => [
            e.studentId,
            {
              asgn: numOrNull(e.asgnScore),
              midSem: numOrNull(e.midSemScore),
              endSem: numOrNull(e.endSemScore),
              project: numOrNull(e.projectScore),
              portfolio: numOrNull(e.portfolioScore),
            } as CategoryScores,
          ]),
        );
        const prevStatus = new Map(existing.map((e) => [e.studentId, e.status]));

        // Enforce a reason for every score-down and every committed→blank (Q4 / B8), recomputed
        // from committed-vs-final. Collect the corrections for the before/after audit trail (B9).
        type Correction = {
          studentId: string;
          cat: ScanCat;
          before: number | null;
          after: number | null;
          code: string;
          note?: string;
        };
        const corrections: Correction[] = [];
        for (const { studentId, cats } of parsedRows) {
          if (!validStudents.has(studentId)) continue;
          const committed = committedByStudent.get(studentId) ?? null;
          for (const cat of SCAN_CATS) {
            const before = committed ? committed[cat] : null;
            const after = cats[cat];
            if (!reasonRequiredForCommit(before, after)) continue;
            const reason = reasonByKey.get(`${studentId}:${cat}`);
            if (!reason) {
              return {
                ok: false,
                error: `A reason is required to ${
                  after == null ? "remove" : "lower"
                } a ${CAT_LABEL[cat]} score. Review the flagged change before committing.`,
              };
            }
            // Server teeth (Kofi Q2 / Q2-c…e): a removed score can't be re-graded — a re-grade
            // yields a score, never a blank. Recomputed here, never trusting the client default.
            if (removalRejectsReGraded(before, after, reason.code)) {
              return {
                ok: false,
                error: `A removed ${CAT_LABEL[cat]} score can't be re-graded — pick why the score is gone (transcription error, or 'Other' with a note).`,
              };
            }
            corrections.push({ studentId, cat, before, after, code: reason.code, note: reason.note });
          }
        }

        const weights = await loadWeights(tx, school.id, d.subjectId);
        // One shared batch_id for every grain versioned by THIS commit (AC B3); a partial
        // re-upload's batch spans only its covered+changed grains (B5).
        const versionBatchId = crypto.randomUUID();
        let n = 0;
        for (const { studentId, cats } of parsedRows) {
          if (!validStudents.has(studentId)) continue;
          const total = weightedTotalComplete(cats, weights);
          const status =
            prevStatus.get(studentId) === "STPSHS_READY" && allCategoriesPresent(cats)
              ? ("STPSHS_READY" as const)
              : computedStatus(cats);
          const row = {
            asgnScore: cats.asgn == null ? null : cats.asgn.toFixed(2),
            midSemScore: cats.midSem == null ? null : cats.midSem.toFixed(2),
            endSemScore: cats.endSem == null ? null : cats.endSem.toFixed(2),
            projectScore: cats.project == null ? null : cats.project.toFixed(2),
            portfolioScore: cats.portfolio == null ? null : cats.portfolio.toFixed(2),
            weightedTotal: total == null ? null : total.toFixed(2),
            asgnWeightUsed: weights.asgn,
            midSemWeightUsed: weights.midSem,
            endSemWeightUsed: weights.endSem,
            projectWeightUsed: weights.project,
            portfolioWeightUsed: weights.portfolio,
            // A scanned portfolio is still human-written → manual (spec §4.1).
            portfolioManual: cats.portfolio != null,
            status,
            compiledByUserId: actor.id ?? undefined,
            compiledAt: new Date(),
            updatedAt: new Date(),
          };
          await tx
            .insert(seniorScoreLedger)
            .values({
              schoolId: school.id,
              studentId,
              subjectId: d.subjectId,
              periodId: d.periodId,
              ...row,
            })
            .onConflictDoUpdate({
              target: [
                seniorScoreLedger.schoolId,
                seniorScoreLedger.studentId,
                seniorScoreLedger.subjectId,
                seniorScoreLedger.periodId,
              ],
              set: row,
            });
          // Item 7 (INCR-6) — purely ADDITIVE version write. The senior_score_ledger upsert
          // above is byte-unchanged from Item 4 (A4/H1). Append one immutable snapshot only for
          // a grain this commit actually changed vs the live latest (B6 — no empty churn);
          // writeLedgerVersion resolves the grain's prior VERSION and sets version_number +
          // supersedes (B1/B2), guarded on uniq_ledger_version_grain_number (I1).
          if (grainHasChange(committedByStudent.get(studentId) ?? null, cats)) {
            await writeLedgerVersion(
              tx,
              { schoolId: school.id, studentId, subjectId: d.subjectId, periodId: d.periodId },
              {
                asgnScore: row.asgnScore,
                midSemScore: row.midSemScore,
                endSemScore: row.endSemScore,
                projectScore: row.projectScore,
                portfolioScore: row.portfolioScore,
                weightedTotal: row.weightedTotal,
                status,
                // Real provenance: SCAN_EXTRACT, or DIRECT_ENTRY when extraction failed wholesale
                // and the teacher typed a blank grid in place (same origin the audit summary logs).
                pathUsed: d.origin,
                committedByUserId: actor.id ?? undefined,
                batchId: versionBatchId,
              },
            );
          }
          n++;
        }

        // Lazy period-scoped prune (F) — a commit into an OPEN period sweeps CLOSED-period
        // version snapshots in the same tx; tenant-scoped, never touches senior_score_ledger.
        await prunePriorPeriodVersions(tx, school.id);

        // Commit summary — path_used lives here (no ledger column exists; single migration 0041
        // is denominators + reason enum only). Never carries the image or a reference to it (B9/G1).
        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "updated",
          entityType: "senior_score_ledger",
          entityId: d.subjectId,
          after: {
            periodId: d.periodId,
            rows: n,
            pathUsed: d.origin,
            corrections: corrections.length,
          },
          reason: "Scan verified & committed (Path B)",
        });
        // One before/after row per correction, carrying the reason code (Kofi Q4 / B9).
        for (const c of corrections) {
          await recordAudit(tx, {
            schoolId: school.id,
            actorUserId: actor.id ?? undefined,
            actorRole: actor.role,
            actionType: "updated",
            entityType: "senior_score_ledger",
            entityId: c.studentId,
            before: { category: c.cat, value: c.before },
            after: { category: c.cat, value: c.after },
            reason: c.note ? `${c.code}: ${c.note}` : c.code,
          });
        }
        return { ok: true, saved: n };
      },
    );
    if (outcome.ok) {
      safeRevalidate(LEDGER_PATH);
      safeRevalidate(SCAN_PATH);
    }
    return outcome;
  } catch {
    return { ok: false, error: "Could not commit the scan. Please try again." };
  }
}
