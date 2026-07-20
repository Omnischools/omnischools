"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor, assertAnyRole } from "@/lib/auth/server";
import { SENIOR_LEDGER_ROLES, WASSCE_SETUP_ROLES, hasAnyRole } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import {
  mockExams,
  mockResults,
  wassceCohort,
  wassceCandidates,
  wassceCandidateSubject,
  wassceSubjects,
} from "@/db/schema";
import { resolveAuthorizedWassceSubjectIds } from "@/lib/wassce/subject-authz";
import { isWassceGrade, type WassceGrade } from "@/lib/wassce/mock-grades";

/**
 * WASSCE mock write actions (SHS module 4.3 / INCR-16 + INCR-18) — three flows:
 *   • saveMockResult — TEACHER mark-entry, gated by the R5 `senior_subject_teacher` correspondence
 *     AND `mock_exams.marking_complete_at IS NULL`. It is deliberately NOT gated by the registration
 *     freeze (`wassce_cohort.setup_frozen_at`) — mock marking ≠ roster freeze (R3b key ruling).
 *   • moderateMockResult / clearMockModeration — the INCR-18 HoA moderation write (Decision 10).
 *   • scheduleMock / updateMock — ADMIN mock-config (WASSCE_SETUP_ROLES). Edit blocked once marked.
 * Every mutation is tenant-scoped (withSchool) + audit-logged. No projection / aggregate is computed.
 */

const SUBJECT_PATH = "/senior/wassce/subject";
const MOCKS_PATH = "/senior/wassce/mocks";
const COHORT_PATH = "/senior/wassce/cohort";

// ---------------------------------------------------------------- mark-entry (teacher)
const SaveMockResultSchema = z.object({
  mockId: z.string().uuid(),
  candidateId: z.string().uuid(),
  subjectId: z.string().uuid(),
  // Grade is validated as one of the 9 WAEC bands via isWassceGrade (AC6) — the select constrains it,
  // and the server re-checks so a hand-crafted POST of "G0" is rejected.
  grade: z.string().refine(isWassceGrade, "Grade must be one of A1–F9."),
  rawScore: z.string().optional(), // "" clears; a raw 0–100 diagnostic score otherwise
  maxScore: z.string().optional(),
});

export type SaveMockResultResult = { ok: true } | { ok: false; error: string };

export async function saveMockResult(input: unknown): Promise<SaveMockResultResult> {
  const { user, school } = await requireSchool();
  await assertAnyRole(SENIOR_LEDGER_ROLES);
  const parsed = SaveMockResultSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid mark." };
  }
  const d = parsed.data;

  // Raw score is an optional 0–100 diagnostic (§C.1) — reject out-of-range up front with a clear
  // message, never a numeric overflow surfacing as the generic catch.
  const rawTrim = d.rawScore?.trim() ?? "";
  let rawValue: number | null = null;
  if (rawTrim !== "") {
    const n = Number(rawTrim);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return { ok: false, error: "Raw score must be between 0 and 100." };
    }
    rawValue = n;
  }
  const maxTrim = d.maxScore?.trim() ?? "";
  const maxValue = maxTrim === "" ? (rawValue != null ? 100 : null) : Number(maxTrim);
  if (maxValue != null && (!Number.isFinite(maxValue) || maxValue <= 0 || maxValue > 100)) {
    return { ok: false, error: "Max score must be between 1 and 100." };
  }

  const isOversight = hasAnyRole(user.roles, WASSCE_SETUP_ROLES);
  const actor = await resolveActor(school.id);

  try {
    const outcome = await withSchool(
      school.id,
      async (tx): Promise<SaveMockResultResult> => {
        // 1) The mock must exist in THIS school and marking must be OPEN (R3b / AC5) — never gated
        //    by the roster freeze.
        const [mock] = await tx
          .select({
            id: mockExams.id,
            cohortId: mockExams.cohortId,
            markingCompleteAt: mockExams.markingCompleteAt,
          })
          .from(mockExams)
          .where(and(eq(mockExams.schoolId, school.id), eq(mockExams.id, d.mockId)));
        if (!mock) return { ok: false, error: "That mock does not exist." };
        if (mock.markingCompleteAt != null) {
          return {
            ok: false,
            error: "Marking is complete for this mock — its results are read-only.",
          };
        }

        // 2) The R5 correspondence: the acting teacher must be assigned this subject (by name), OR
        //    hold an oversight role (HoA/admin who oversee). A plain teacher outside their assignment
        //    is rejected (AC4 — Physics-by-a-Chemistry-teacher, or no-assignment → 403).
        const authorized = await resolveAuthorizedWassceSubjectIds(tx, school.id, actor.id);
        const isAssigned = authorized.has(d.subjectId);
        if (!isAssigned && !isOversight) {
          return {
            ok: false,
            error: "You can only enter marks for a subject you are assigned to teach.",
          };
        }

        // 3) The candidate must belong to this mock's cohort (no cross-cohort mark).
        const [cand] = await tx
          .select({ cohortId: wassceCandidates.cohortId })
          .from(wassceCandidates)
          .where(and(eq(wassceCandidates.schoolId, school.id), eq(wassceCandidates.id, d.candidateId)));
        if (!cand || cand.cohortId !== mock.cohortId) {
          return { ok: false, error: "That candidate is not in this mock's cohort." };
        }

        // 4) The subject must be a real wassce_subject in this school (clean error before the FK).
        const [subj] = await tx
          .select({ id: wassceSubjects.id })
          .from(wassceSubjects)
          .where(and(eq(wassceSubjects.schoolId, school.id), eq(wassceSubjects.id, d.subjectId)));
        if (!subj) return { ok: false, error: "Unknown subject." };

        // 5) INCR-18 R3 CARRY-IN (Quinn): the candidate must be REGISTERED for this subject. The grid
        //    only lists registered candidates, so this is unreachable through the UI — but a crafted
        //    POST could otherwise store an off-roster grade that the cohort heatmap would then count.
        const registered = await assertRegistered(tx, school.id, d.candidateId, d.subjectId);
        if (!registered) return { ok: false, error: NOT_REGISTERED };

        // Existing row → before-state for the audit trail (corrections are new events, never silent).
        const [before] = await tx
          .select({ grade: mockResults.grade, rawScore: mockResults.rawScore })
          .from(mockResults)
          .where(
            and(
              eq(mockResults.schoolId, school.id),
              eq(mockResults.mockId, d.mockId),
              eq(mockResults.candidateId, d.candidateId),
              eq(mockResults.subjectId, d.subjectId),
            ),
          );

        // 6) INCR-18 R2 CARRY-IN (Sarah): oversight edits route through MODERATION, never through the
        //    teacher's `grade`. Evaluation order matters — an actor who is BOTH assigned and oversight
        //    writes as the teacher (assignment wins). An oversight-only actor may CREATE a missing mark
        //    (the surface's own case: French has no L1 teacher) but may never overwrite an existing one,
        //    which is what leaves a trail. A teacher grade is thus immutable to everyone but its teacher.
        if (!isAssigned && isOversight && before) {
          return {
            ok: false,
            error: "This subject already has a teacher mark — use Moderate to change it.",
          };
        }

        const rawStr = rawValue == null ? null : rawValue.toFixed(2);
        const maxStr = maxValue == null ? null : maxValue.toFixed(2);
        await tx
          .insert(mockResults)
          .values({
            schoolId: school.id,
            mockId: d.mockId,
            candidateId: d.candidateId,
            subjectId: d.subjectId,
            grade: d.grade,
            rawScore: rawStr,
            maxScore: maxStr,
            markedByUserId: actor.id ?? undefined,
            markedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              mockResults.schoolId,
              mockResults.mockId,
              mockResults.candidateId,
              mockResults.subjectId,
            ],
            // Moderation columns are DELIBERATELY untouched (R3 — moderation is an INCR-18 flow).
            set: {
              grade: d.grade,
              rawScore: rawStr,
              maxScore: maxStr,
              markedByUserId: actor.id ?? undefined,
              markedAt: new Date(),
            },
          });

        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: before ? "updated" : "created",
          entityType: "mock_result",
          entityId: d.candidateId,
          before: before ? { grade: before.grade, rawScore: before.rawScore } : undefined,
          after: { mockId: d.mockId, subjectId: d.subjectId, grade: d.grade, rawScore: rawStr },
          reason: "Mock mark entered",
        });
        return { ok: true };
      },
    );
    if (outcome.ok) safeRevalidate(SUBJECT_PATH);
    return outcome;
  } catch {
    return { ok: false, error: "Could not save the mark. Please try again." };
  }
}

// ---------------------------------------------------------------- moderation (HoA · INCR-18 R1)

const NOT_REGISTERED = "That candidate is not registered for this subject.";

/** True when a `wassce_candidate_subject` row exists for the triple (the R3 carry-in, both writes). */
async function assertRegistered(
  tx: Parameters<Parameters<typeof withSchool>[1]>[0],
  schoolId: string,
  candidateId: string,
  subjectId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: wassceCandidateSubject.id })
    .from(wassceCandidateSubject)
    .where(
      and(
        eq(wassceCandidateSubject.schoolId, schoolId),
        eq(wassceCandidateSubject.candidateId, candidateId),
        eq(wassceCandidateSubject.subjectId, subjectId),
      ),
    );
  return row != null;
}

/**
 * A moderation reason is MANDATORY at the app layer even though the column is nullable — the trail is
 * an audit record, and a moderation with no rationale is precisely the hole Sarah's carry-forward names.
 */
const reasonField = z
  .string()
  .trim()
  .min(5, "Give a reason of at least 5 characters — the moderation trail is an audit record.")
  .max(500, "Keep the reason under 500 characters.");

const ModerateSchema = z.object({
  mockId: z.string().uuid(),
  candidateId: z.string().uuid(),
  subjectId: z.string().uuid(),
  moderatedGrade: z.string().refine(isWassceGrade, "Grade must be one of A1–F9."),
  reason: reasonField,
});

const ClearModerationSchema = z.object({
  mockId: z.string().uuid(),
  candidateId: z.string().uuid(),
  subjectId: z.string().uuid(),
  reason: reasonField,
});

export type ModerationResult = { ok: true } | { ok: false; error: string };

/** The four columns a moderation touches — NEVER `grade`, `marked_*`, `raw_score` or `max_score`. */
type ModerationColumns = {
  moderatedGrade: WassceGrade | null;
  moderatorUserId: string | null;
  moderatedAt: Date | null;
  moderationReason: string | null;
};

/**
 * Moderate a mock result (SHS module 4.3 / INCR-18 · Decision 10 · Kofi R1).
 *
 * Role = `WASSCE_SETUP_ROLES` (ADMIN / HEADMASTER / VICE_HEADMASTER_ACADEMIC). That set can ALREADY
 * overwrite `grade` today, so routing them into moderation strictly REDUCES privilege while adding a
 * trail. TEACHER / FORM_MASTER may NEVER moderate — **including their own subject**: Decision 10 exists
 * to check self-marking from OUTSIDE, so an assignment is not a licence here.
 *
 * It writes EXACTLY four columns. The teacher's `grade`, `marked_by_user_id`, `marked_at`, `raw_score`
 * and `max_score` are byte-unchanged, which is what makes the original-vs-moderated cell honest. The
 * same-row CHECK `mock_results_moderation_trail` makes a half-populated moderation unrepresentable.
 *
 * It is deliberately NOT gated by `mock_exams.marking_complete_at` — moderation is precisely the write
 * that SURVIVES marking closing (Decision 10 cross-checks the distribution, which is only meaningful
 * once marking is done). Teacher `saveMockResult` stays locked. It is not gated by `setup_frozen_at`.
 */
export async function moderateMockResult(input: unknown): Promise<ModerationResult> {
  const { school } = await requireSchool();
  await assertAnyRole(WASSCE_SETUP_ROLES);
  const parsed = ModerateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid moderation." };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const outcome = await withSchool(school.id, async (tx): Promise<ModerationResult> => {
      const target = await loadModerationTarget(tx, school.id, d);
      if (!target.ok) return target;
      if (target.row.grade === d.moderatedGrade) {
        return {
          ok: false,
          error:
            "The moderated grade must differ from the teacher's grade. To undo a moderation, use Clear moderation.",
        };
      }

      const after: ModerationColumns = {
        moderatedGrade: d.moderatedGrade,
        moderatorUserId: actor.id ?? null,
        moderatedAt: new Date(),
        moderationReason: d.reason,
      };
      await writeModeration(tx, school.id, d, after);
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "mock_result_moderation",
        entityId: d.candidateId,
        before: {
          mockId: d.mockId,
          subjectId: d.subjectId,
          teacherGrade: target.row.grade,
          moderatedGrade: target.row.moderatedGrade,
          moderationReason: target.row.moderationReason,
        },
        after: {
          mockId: d.mockId,
          subjectId: d.subjectId,
          teacherGrade: target.row.grade, // unchanged — recorded so the trail proves it
          moderatedGrade: d.moderatedGrade,
          moderationReason: d.reason,
        },
        reason: d.reason,
      });
      return { ok: true };
    });
    if (outcome.ok) {
      safeRevalidate(SUBJECT_PATH);
      safeRevalidate(COHORT_PATH);
    }
    return outcome;
  } catch {
    return { ok: false, error: "Could not save the moderation. Please try again." };
  }
}

/**
 * Reverse a moderation — NULLs all four columns together so the row is never half-populated (the CHECK
 * would reject that anyway). The history lives in the append-only `audit_log`, never in a partial row,
 * so a clear ALSO requires its own reason. Clearing an un-moderated row is rejected, and a clear is NOT
 * restricted to the original moderator (an HoA on leave must not block a correction).
 */
export async function clearMockModeration(input: unknown): Promise<ModerationResult> {
  const { school } = await requireSchool();
  await assertAnyRole(WASSCE_SETUP_ROLES);
  const parsed = ClearModerationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const outcome = await withSchool(school.id, async (tx): Promise<ModerationResult> => {
      const target = await loadModerationTarget(tx, school.id, d);
      if (!target.ok) return target;
      if (target.row.moderatedGrade == null) {
        return { ok: false, error: "That result is not moderated — there is nothing to clear." };
      }

      const after: ModerationColumns = {
        moderatedGrade: null,
        moderatorUserId: null,
        moderatedAt: null,
        moderationReason: null,
      };
      await writeModeration(tx, school.id, d, after);
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "mock_result_moderation",
        entityId: d.candidateId,
        before: {
          mockId: d.mockId,
          subjectId: d.subjectId,
          teacherGrade: target.row.grade,
          moderatedGrade: target.row.moderatedGrade,
          moderationReason: target.row.moderationReason,
        },
        after: { mockId: d.mockId, subjectId: d.subjectId, teacherGrade: target.row.grade, moderatedGrade: null },
        reason: d.reason,
      });
      return { ok: true };
    });
    if (outcome.ok) {
      safeRevalidate(SUBJECT_PATH);
      safeRevalidate(COHORT_PATH);
    }
    return outcome;
  } catch {
    return { ok: false, error: "Could not clear the moderation. Please try again." };
  }
}

type ModerationTargetKey = { mockId: string; candidateId: string; subjectId: string };

/**
 * The shared pre-flight for BOTH moderation writes: the mock, candidate, subject and REGISTRATION all
 * resolve inside this school (a cross-tenant id is a plain not-found, never a leak), and the teacher's
 * result row must already exist — there is nothing to moderate otherwise.
 */
async function loadModerationTarget(
  tx: Parameters<Parameters<typeof withSchool>[1]>[0],
  schoolId: string,
  d: ModerationTargetKey,
): Promise<
  | { ok: true; row: { grade: string; moderatedGrade: string | null; moderationReason: string | null } }
  | { ok: false; error: string }
> {
  const [mock] = await tx
    .select({ id: mockExams.id, cohortId: mockExams.cohortId })
    .from(mockExams)
    .where(and(eq(mockExams.schoolId, schoolId), eq(mockExams.id, d.mockId)));
  if (!mock) return { ok: false, error: "That mock does not exist." };

  const [cand] = await tx
    .select({ cohortId: wassceCandidates.cohortId })
    .from(wassceCandidates)
    .where(and(eq(wassceCandidates.schoolId, schoolId), eq(wassceCandidates.id, d.candidateId)));
  if (!cand || cand.cohortId !== mock.cohortId) {
    return { ok: false, error: "That candidate is not in this mock's cohort." };
  }

  const [subj] = await tx
    .select({ id: wassceSubjects.id })
    .from(wassceSubjects)
    .where(and(eq(wassceSubjects.schoolId, schoolId), eq(wassceSubjects.id, d.subjectId)));
  if (!subj) return { ok: false, error: "Unknown subject." };

  if (!(await assertRegistered(tx, schoolId, d.candidateId, d.subjectId))) {
    return { ok: false, error: NOT_REGISTERED };
  }

  const [row] = await tx
    .select({
      grade: mockResults.grade,
      moderatedGrade: mockResults.moderatedGrade,
      moderationReason: mockResults.moderationReason,
    })
    .from(mockResults)
    .where(
      and(
        eq(mockResults.schoolId, schoolId),
        eq(mockResults.mockId, d.mockId),
        eq(mockResults.candidateId, d.candidateId),
        eq(mockResults.subjectId, d.subjectId),
      ),
    );
  if (!row) return { ok: false, error: "There is no teacher mark to moderate for this subject." };
  return { ok: true, row };
}

/** The ONLY statement in the codebase that writes the moderation columns — exactly four, no others. */
async function writeModeration(
  tx: Parameters<Parameters<typeof withSchool>[1]>[0],
  schoolId: string,
  d: ModerationTargetKey,
  set: ModerationColumns,
): Promise<void> {
  await tx
    .update(mockResults)
    .set(set)
    .where(
      and(
        eq(mockResults.schoolId, schoolId),
        eq(mockResults.mockId, d.mockId),
        eq(mockResults.candidateId, d.candidateId),
        eq(mockResults.subjectId, d.subjectId),
      ),
    );
}

// ---------------------------------------------------------------- mock config (admin)
const dateStr = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")
  .optional()
  .or(z.literal(""));

const ScheduleMockSchema = z.object({
  cohortId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required.").max(60),
  mockNumber: z.coerce.number().int().min(1, "Mock number must be ≥ 1.").max(20),
  isPredictor: z.coerce.boolean().optional(),
  scheduledStart: dateStr,
  scheduledEnd: dateStr,
});

export type MockConfigResult = { ok: true; id?: string } | { ok: false; error: string };

/** Schedule / create a mock for a cohort — admin-config (WASSCE_SETUP_ROLES; subject-teacher denied — AC2). */
export async function scheduleMock(input: unknown): Promise<MockConfigResult> {
  const { school } = await requireSchool();
  await assertAnyRole(WASSCE_SETUP_ROLES);
  const parsed = ScheduleMockSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid mock." };
  }
  const d = parsed.data;
  const start = d.scheduledStart || null;
  const end = d.scheduledEnd || null;
  if (start && end && end < start) {
    return { ok: false, error: "The end date can't be before the start date." };
  }
  const actor = await resolveActor(school.id);
  try {
    const outcome = await withSchool(school.id, async (tx): Promise<MockConfigResult> => {
      const [cohort] = await tx
        .select({ id: wassceCohort.id })
        .from(wassceCohort)
        .where(and(eq(wassceCohort.schoolId, school.id), eq(wassceCohort.id, d.cohortId)));
      if (!cohort) return { ok: false, error: "Unknown cohort." };

      const [row] = await tx
        .insert(mockExams)
        .values({
          schoolId: school.id,
          cohortId: d.cohortId,
          name: d.name,
          mockNumber: d.mockNumber,
          isPredictor: d.isPredictor ?? false,
          scheduledStart: start,
          scheduledEnd: end,
        })
        .returning({ id: mockExams.id });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "mock_exam",
        entityId: row.id,
        after: { cohortId: d.cohortId, name: d.name, mockNumber: d.mockNumber, isPredictor: d.isPredictor ?? false },
        reason: "Mock scheduled",
      });
      return { ok: true, id: row.id };
    });
    if (outcome.ok) safeRevalidate(MOCKS_PATH);
    return outcome;
  } catch {
    // Unique conflicts: a mock number already used for this cohort, or a 2nd predictor.
    return {
      ok: false,
      error: "Could not schedule the mock. The mock number may already exist, or a predictor is already set.",
    };
  }
}

const UpdateMockSchema = z.object({
  mockId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required.").max(60),
  mockNumber: z.coerce.number().int().min(1).max(20),
  isPredictor: z.coerce.boolean().optional(),
  scheduledStart: dateStr,
  scheduledEnd: dateStr,
});

/** Edit an UNLOCKED mock — blocked once `marking_complete_at` is set (AC3). Admin-config. */
export async function updateMock(input: unknown): Promise<MockConfigResult> {
  const { school } = await requireSchool();
  await assertAnyRole(WASSCE_SETUP_ROLES);
  const parsed = UpdateMockSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid mock." };
  }
  const d = parsed.data;
  const start = d.scheduledStart || null;
  const end = d.scheduledEnd || null;
  if (start && end && end < start) {
    return { ok: false, error: "The end date can't be before the start date." };
  }
  const actor = await resolveActor(school.id);
  try {
    const outcome = await withSchool(school.id, async (tx): Promise<MockConfigResult> => {
      const [mock] = await tx
        .select({ id: mockExams.id, markingCompleteAt: mockExams.markingCompleteAt })
        .from(mockExams)
        .where(and(eq(mockExams.schoolId, school.id), eq(mockExams.id, d.mockId)));
      if (!mock) return { ok: false, error: "That mock does not exist." };
      if (mock.markingCompleteAt != null) {
        return { ok: false, error: "Marking is complete — this mock is locked and can't be edited." };
      }
      await tx
        .update(mockExams)
        .set({
          name: d.name,
          mockNumber: d.mockNumber,
          isPredictor: d.isPredictor ?? false,
          scheduledStart: start,
          scheduledEnd: end,
        })
        .where(and(eq(mockExams.schoolId, school.id), eq(mockExams.id, d.mockId)));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "mock_exam",
        entityId: d.mockId,
        after: { name: d.name, mockNumber: d.mockNumber, isPredictor: d.isPredictor ?? false },
        reason: "Mock edited",
      });
      return { ok: true };
    });
    if (outcome.ok) safeRevalidate(MOCKS_PATH);
    return outcome;
  } catch {
    return { ok: false, error: "Could not update the mock. Please try again." };
  }
}
