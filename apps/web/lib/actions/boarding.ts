"use server";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { withSchool, isUniqueViolation } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, BOARDING_ROLES, canAccessHouse } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import {
  students,
  houses,
  boardingBunk,
  boardingDormitory,
  bunkAllocation,
} from "@/db/schema";
import {
  decideReassign,
  REASSIGN_MESSAGES,
  type HouseGender,
  type Sex,
} from "@/lib/boarding/reassign-decision";

type Result = { ok: boolean; error?: string };

const ReassignSchema = z.object({
  studentId: z.string().uuid(),
  targetBunkId: z.string().uuid(),
  reason: z.string().trim().min(1, "Enter a reason for the move").max(280),
});

/**
 * Move a boarder to a vacant bunk within their own House, in ONE transaction (AC C1): close the
 * open bunk_allocation row (to_at = now), insert a new open row (reason required, actor recorded),
 * and move students.current_bunk_id — all-or-nothing. The partial unique on current_bunk_id is the
 * race backstop (AC D2): a concurrent claim of the same bunk loses on commit, the whole tx rolls
 * back, and the loser gets a clean "bunk was just taken" message. Gated to BOARDING_ROLES, and a
 * plain HOUSEMASTER only for their own House (G3/G4). Writes a BUNK_REASSIGNED audit row (AC H).
 */
export async function reassignBunk(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  // Server-side role gate (AC G3) — never trust the client to have hidden the control.
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, BOARDING_ROLES)) {
    return { ok: false, error: "Your role cannot reassign bunks." };
  }
  // AC C4 — reason (and shape) validated BEFORE any write.
  const parsed = ReassignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { studentId, targetBunkId, reason } = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const outcome = await withSchool(school.id, async (tx) => {
      const [stu] = await tx
        .select({
          id: students.id,
          houseId: students.houseId,
          sex: students.sex,
          currentBunkId: students.currentBunkId,
        })
        .from(students)
        .where(and(eq(students.schoolId, school.id), eq(students.id, studentId)));
      if (!stu || !stu.houseId) return { error: "That boarder is not in a House." };

      // G4 — a plain HOUSEMASTER may only act on the House they master.
      const [studentHouse] = await tx
        .select({ hmUserId: houses.hmUserId })
        .from(houses)
        .where(and(eq(houses.schoolId, school.id), eq(houses.id, stu.houseId)));
      if (!canAccessHouse(user.roles, user.id, studentHouse?.hmUserId)) {
        return { error: "You can only manage the House you are assigned to." };
      }

      // Resolve target bunk → dorm → House (its gender is the J3 guard input).
      const [target] = await tx
        .select({
          bunkId: boardingBunk.id,
          houseId: boardingDormitory.houseId,
          houseGender: houses.gender,
        })
        .from(boardingBunk)
        .innerJoin(
          boardingDormitory,
          and(
            eq(boardingDormitory.schoolId, boardingBunk.schoolId),
            eq(boardingDormitory.id, boardingBunk.dormitoryId),
          ),
        )
        .innerJoin(
          houses,
          and(
            eq(houses.schoolId, boardingDormitory.schoolId),
            eq(houses.id, boardingDormitory.houseId),
          ),
        )
        .where(and(eq(boardingBunk.schoolId, school.id), eq(boardingBunk.id, targetBunkId)));

      // Is the target already held by a DIFFERENT student? (friendly pre-check; DB unique is final)
      const occ = target
        ? await tx
            .select({ id: students.id })
            .from(students)
            .where(
              and(
                eq(students.schoolId, school.id),
                eq(students.currentBunkId, targetBunkId),
                ne(students.id, studentId),
              ),
            )
            .limit(1)
        : [];

      const decision = decideReassign({
        reason,
        student: {
          houseId: stu.houseId,
          sex: stu.sex as Sex,
          currentBunkId: stu.currentBunkId,
        },
        target: target
          ? {
              bunkId: target.bunkId,
              houseId: target.houseId,
              houseGender: target.houseGender as HouseGender | null,
              occupiedByOther: occ.length > 0,
            }
          : null,
      });
      if (!decision.ok) return { error: REASSIGN_MESSAGES[decision.reason] };

      // Atomic release-then-claim (AC C1/C2) — append-only history, prior row kept.
      await tx
        .update(bunkAllocation)
        .set({ toAt: new Date() })
        .where(
          and(
            eq(bunkAllocation.schoolId, school.id),
            eq(bunkAllocation.studentId, studentId),
            isNull(bunkAllocation.toAt),
          ),
        );
      await tx.insert(bunkAllocation).values({
        schoolId: school.id,
        studentId,
        bunkId: targetBunkId,
        reason,
        allocatedByUserId: actor.id ?? undefined,
      });
      // The move that trips the partial unique on a lost race → whole-tx rollback (AC D2).
      await tx
        .update(students)
        .set({ currentBunkId: targetBunkId })
        .where(and(eq(students.schoolId, school.id), eq(students.id, studentId)));

      // AC-A8 — a prefect tag lives on the BUNK, so carry it with its holder. Without this the
      // title strands on the vacated bunk (silently re-attributed to whoever fills it next, and
      // the SICKBAY derived read would follow the wrong occupant). Same tx as the move.
      if (stu.currentBunkId) {
        const [src] = await tx
          .select({ role: boardingBunk.prefectRole })
          .from(boardingBunk)
          .where(and(eq(boardingBunk.schoolId, school.id), eq(boardingBunk.id, stu.currentBunkId)));
        if (src?.role) {
          await tx
            .update(boardingBunk)
            .set({ prefectRole: src.role })
            .where(and(eq(boardingBunk.schoolId, school.id), eq(boardingBunk.id, targetBunkId)));
          await tx
            .update(boardingBunk)
            .set({ prefectRole: null })
            .where(and(eq(boardingBunk.schoolId, school.id), eq(boardingBunk.id, stu.currentBunkId)));
        }
      }

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "BUNK_REASSIGNED",
        entityType: "student",
        entityId: studentId,
        before: { bunkId: stu.currentBunkId },
        after: { bunkId: targetBunkId },
        // 🔴 R245.3 — free-text operator input under the non-redacted `student` audit can carry a
        // safeguarding/medical justification (the render redaction is entity-keyed, R240). Neutralize
        // here; the justification stays on the BOARDING_ROLES-gated `bunk_allocation.reason`.
        reason: "Bunk reassigned",
      });
      return { ok: true as const, houseId: stu.houseId };
    });

    if (!outcome.ok) return { ok: false, error: outcome.error };
    safeRevalidate(`/senior/boarding/houses/${outcome.houseId}/roster`);
    return { ok: true };
  } catch (err) {
    // A lost race for the bunk trips the partial unique `uniq_student_current_bunk` (SQLSTATE 23505)
    // → whole-tx rollback; that's the one expected failure, so surface the honest "just taken" (AC D2).
    // Any OTHER error (connection drop, unrelated constraint) is genuinely unexpected — don't mask it
    // as a bunk conflict; rethrow so it's logged/surfaced.
    // MUST go through `isUniqueViolation`: Drizzle wraps the driver error and hangs the real
    // PostgresError off `.cause`, so reading `.code` off the THROWN error always missed and this
    // expected race threw instead of returning the message.
    if (isUniqueViolation(err)) {
      return { ok: false, error: REASSIGN_MESSAGES.bunk_occupied };
    }
    throw err;
  }
}

const PrefectRoleSchema = z.enum(["HEAD", "DINING", "SANITATION", "PREP", "SICKBAY"]);
const AppointSchema = z.object({
  studentId: z.string().uuid(),
  role: PrefectRoleSchema,
});
const RevokeSchema = z.object({ studentId: z.string().uuid() });

/**
 * Load a boarder + their House's HM pointer and run the shared appoint/revoke gate: BOARDING_ROLES,
 * and a plain HOUSEMASTER only for their own House (AC-A5 — identical to reassignBunk, no widening).
 * Returns the student row on success, or an error string. Keeps both actions honest to one gate.
 */
async function loadGatedBoarder(
  tx: Tx,
  schoolId: string,
  studentId: string,
  user: { roles: string[]; id: string },
) {
  const [stu] = await tx
    .select({
      id: students.id,
      houseId: students.houseId,
      status: students.status,
      residency: students.residency,
      currentBunkId: students.currentBunkId,
    })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)));
  if (!stu || !stu.houseId) {
    return { ok: false as const, error: "That boarder is not in a House." };
  }
  const [house] = await tx
    .select({ hmUserId: houses.hmUserId })
    .from(houses)
    .where(and(eq(houses.schoolId, schoolId), eq(houses.id, stu.houseId)));
  if (!canAccessHouse(user.roles, user.id, house?.hmUserId)) {
    return { ok: false as const, error: "You can only manage the House you are assigned to." };
  }
  return { ok: true as const, stu };
}

/**
 * Appoint a boarder to a prefect role (INCR #298 part A). The prefect tag is a nullable enum on the
 * occupant's CURRENT bunk (Kofi's zero-schema ruling): appointing SETS it, so both existing readers
 * (buildPrefectStrip, the SICKBAY-prefect derived read in lib/sickbay) stay byte-unchanged. One holder
 * per (House × role): the prior holder in this House is cleared in the SAME transaction (AC-A2). A
 * student holds at most one role — a single column can only carry one (AC-A4). Requires the boarder be
 * ACTIVE, resident, and already allocated a bunk (AC-A3/A7). Gated to BOARDING_ROLES + own-House.
 */
export async function appointPrefect(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, BOARDING_ROLES)) {
    return { ok: false, error: "Your role cannot appoint prefects." };
  }
  const parsed = AppointSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { studentId, role } = parsed.data;
  const actor = await resolveActor(school.id);

  const outcome = await withSchool(school.id, async (tx) => {
    const gated = await loadGatedBoarder(tx, school.id, studentId, user);
    if (!gated.ok) return gated;
    const { stu } = gated;
    if (stu.status !== "ACTIVE") return { ok: false as const, error: "That boarder is not active." };
    if (stu.residency !== "BOARDER") {
      return { ok: false as const, error: "Only a resident boarder can be a prefect." };
    }
    const bunkId = stu.currentBunkId;
    if (!bunkId) {
      return { ok: false as const, error: "Allocate this boarder a bunk before appointing them." };
    }

    // AC-A2 — clear the current holder of this role in this House (bunk tag lives via dorm→house).
    // ponytail: the one-holder-per-(House×role) rule is app-enforced (clear-prior then set) with no DB
    // backstop — Kofi's zero-schema ruling forbids the partial-unique that would close it, because
    // `boarding_bunk` has no house_id (house is via the dorm join). Two concurrent same-role appoints at
    // READ COMMITTED can transiently double-tag; readers tolerate it (buildPrefectStrip is first-wins,
    // getHealthPrefects would list two, the next appoint self-heals). Low contention, self-healing.
    // Upgrade path: add house_id to boarding_bunk + a partial-unique on (school_id, house_id, prefect_role).
    const priorBunks = await tx
      .select({ id: boardingBunk.id })
      .from(boardingBunk)
      .innerJoin(
        boardingDormitory,
        and(
          eq(boardingDormitory.schoolId, boardingBunk.schoolId),
          eq(boardingDormitory.id, boardingBunk.dormitoryId),
        ),
      )
      .where(
        and(
          eq(boardingBunk.schoolId, school.id),
          eq(boardingDormitory.houseId, stu.houseId!),
          eq(boardingBunk.prefectRole, role),
          ne(boardingBunk.id, bunkId),
        ),
      );
    if (priorBunks.length > 0) {
      const priorBunkIds = priorBunks.map((b) => b.id);
      const priorHolders = await tx
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.schoolId, school.id), inArray(students.currentBunkId, priorBunkIds)));
      await tx
        .update(boardingBunk)
        .set({ prefectRole: null })
        .where(and(eq(boardingBunk.schoolId, school.id), inArray(boardingBunk.id, priorBunkIds)));
      for (const h of priorHolders) {
        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "BOARDING_PREFECT_REVOKED",
          entityType: "student",
          entityId: h.id,
          before: { prefectRole: role },
          after: { prefectRole: null },
          reason: "Prefect role reassigned",
        });
      }
    }

    // AC-A1/A4 — set the tag on the appointee's own bunk (a single column carries exactly one role).
    const [before] = await tx
      .select({ role: boardingBunk.prefectRole })
      .from(boardingBunk)
      .where(and(eq(boardingBunk.schoolId, school.id), eq(boardingBunk.id, bunkId)));
    await tx
      .update(boardingBunk)
      .set({ prefectRole: role })
      .where(and(eq(boardingBunk.schoolId, school.id), eq(boardingBunk.id, bunkId)));
    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "BOARDING_PREFECT_APPOINTED",
      entityType: "student",
      entityId: studentId,
      before: { prefectRole: before?.role ?? null },
      after: { prefectRole: role },
      reason: "Prefect appointed",
    });
    return { ok: true as const, houseId: stu.houseId! };
  });

  if (!outcome.ok) return { ok: false, error: outcome.error };
  safeRevalidate(`/senior/boarding/houses/${outcome.houseId}/roster`);
  return { ok: true };
}

/**
 * Revoke a boarder's prefect role (AC-A6): clear the tag on their current bunk. Idempotent — clearing
 * a boarder who holds no role is a no-op success. Gated to BOARDING_ROLES + own-House.
 */
export async function revokePrefect(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, BOARDING_ROLES)) {
    return { ok: false, error: "Your role cannot revoke prefects." };
  }
  const parsed = RevokeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { studentId } = parsed.data;
  const actor = await resolveActor(school.id);

  const outcome = await withSchool(school.id, async (tx) => {
    const gated = await loadGatedBoarder(tx, school.id, studentId, user);
    if (!gated.ok) return gated;
    const { stu } = gated;
    const bunkId = stu.currentBunkId;
    if (!bunkId) return { ok: true as const, houseId: stu.houseId! };
    const [bunk] = await tx
      .select({ role: boardingBunk.prefectRole })
      .from(boardingBunk)
      .where(and(eq(boardingBunk.schoolId, school.id), eq(boardingBunk.id, bunkId)));
    if (bunk?.role) {
      await tx
        .update(boardingBunk)
        .set({ prefectRole: null })
        .where(and(eq(boardingBunk.schoolId, school.id), eq(boardingBunk.id, bunkId)));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "BOARDING_PREFECT_REVOKED",
        entityType: "student",
        entityId: studentId,
        before: { prefectRole: bunk.role },
        after: { prefectRole: null },
        reason: "Prefect revoked",
      });
    }
    return { ok: true as const, houseId: stu.houseId! };
  });

  if (!outcome.ok) return { ok: false, error: outcome.error };
  safeRevalidate(`/senior/boarding/houses/${outcome.houseId}/roster`);
  return { ok: true };
}
