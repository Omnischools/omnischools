"use server";
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
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

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "BUNK_REASSIGNED",
        entityType: "student",
        entityId: studentId,
        before: { bunkId: stu.currentBunkId },
        after: { bunkId: targetBunkId },
        reason,
      });
      return { ok: true as const, houseId: stu.houseId };
    });

    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate(`/senior/boarding/houses/${outcome.houseId}/roster`);
    return { ok: true };
  } catch {
    // Lost the race for the bunk (partial-unique violation) or another DB error — clean message.
    return { ok: false, error: REASSIGN_MESSAGES.bunk_occupied };
  }
}
