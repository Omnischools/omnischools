"use server";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { requireSchool, resolveActor, assertAnyRole } from "@/lib/auth/server";
import { signInWithPhone } from "@/lib/auth";
import { sendSms } from "@/lib/sms";
import { USER_ADMIN_ROLES, canManageTarget } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { safeRevalidate } from "@/lib/revalidate";
import { users, roleAssignments, roles, userSchoolBlock } from "@/db/schema";
import type { Tx } from "@/lib/db";

type Result = { ok: boolean; error?: string };

/**
 * INCR-35 (L2b) — admin user-management: block / activate / reset OTHER users (Kofi R262/R263/R265/R266).
 * Every action is DOUBLE-GATED: (1) `assertAnyRole(USER_ADMIN_ROLES)` — are you a manager at all — then
 * (2) `canManageTarget(...)` — do you STRICTLY outrank THIS target (an ADMIN can never act on a PROPRIETOR
 * or a peer, nor on themselves). The block state lives ONLY on `user_school_block` (presence = blocked),
 * enforced per-school at the single `getCurrentUser` chokepoint — never on `ref_user`/`role_assignment`.
 * Reset NEVER sets or reveals a password: it dispatches an OTP to the target's STORED phone so the target
 * sets their own password (via L2a). The admin's free-text block reason is stored on `user_school_block`
 * (gated), NEVER written to the all-staff audit feed (the INCR-30 R240 reason-channel discipline).
 */

/** The target's active role codes at this school + their stored phone. Empty roles ⇒ not a school member. */
async function targetContext(
  tx: Tx,
  schoolId: string,
  targetUserId: string,
): Promise<{ roles: string[]; phone: string | null }> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await tx
    .select({ code: roles.code, phone: users.phone })
    .from(roleAssignments)
    .innerJoin(users, eq(users.id, roleAssignments.userId))
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(
      and(
        eq(roleAssignments.schoolId, schoolId),
        eq(roleAssignments.userId, targetUserId),
        lte(roleAssignments.startDate, today),
        or(isNull(roleAssignments.endDate), gte(roleAssignments.endDate, today)),
      ),
    );
  const roleCodes = Array.from(new Set(rows.map((r) => r.code)));
  return { roles: roleCodes, phone: rows[0]?.phone ?? null };
}

/** Both gates. Returns the target's phone on success, or an error Result to return as-is. */
async function gateTarget(
  tx: Tx,
  schoolId: string,
  actor: { id: string; roles: readonly string[] },
  targetUserId: string,
): Promise<{ ok: true; phone: string | null } | { ok: false; error: string }> {
  const target = await targetContext(tx, schoolId, targetUserId);
  if (target.roles.length === 0) return { ok: false, error: "That user is not at this school." };
  // The privilege-inversion guard (R265) — strictly outrank + not self.
  if (!canManageTarget(actor.roles, target.roles, actor.id, targetUserId)) {
    return { ok: false, error: "You cannot manage this user." };
  }
  return { ok: true, phone: target.phone };
}

export async function blockUser(input: { targetUserId: string; reason?: string }): Promise<Result> {
  const { user, school } = await requireSchool();
  await assertAnyRole(USER_ADMIN_ROLES);
  const targetUserId = input?.targetUserId ?? "";
  const reason = (input?.reason ?? "").trim().slice(0, 280) || null;
  const actor = await resolveActor(school.id);

  return withSchool(school.id, async (tx) => {
    const gate = await gateTarget(tx, school.id, { id: user.id, roles: user.roles }, targetUserId);
    if (!gate.ok) return gate;
    await tx
      .insert(userSchoolBlock)
      .values({ schoolId: school.id, userId: targetUserId, blockedBy: actor.id ?? undefined, reason })
      .onConflictDoNothing({ target: [userSchoolBlock.schoolId, userSchoolBlock.userId] });
    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? user.id,
      actorRole: actor.role,
      actionType: "blocked",
      entityType: "user_block",
      entityId: targetUserId,
      // Fixed reason — the admin's free-text stays on user_school_block, never the all-staff feed (R240).
      reason: "Account blocked",
    });
    safeRevalidate("/settings/users");
    return { ok: true };
  });
}

export async function activateUser(input: { targetUserId: string }): Promise<Result> {
  const { user, school } = await requireSchool();
  await assertAnyRole(USER_ADMIN_ROLES);
  const targetUserId = input?.targetUserId ?? "";
  const actor = await resolveActor(school.id);

  return withSchool(school.id, async (tx) => {
    const gate = await gateTarget(tx, school.id, { id: user.id, roles: user.roles }, targetUserId);
    if (!gate.ok) return gate;
    // Activate = remove the block row (the exact inverse; role_assignments are never touched, so the
    // user's original roles return intact on their next request).
    await tx
      .delete(userSchoolBlock)
      .where(and(eq(userSchoolBlock.schoolId, school.id), eq(userSchoolBlock.userId, targetUserId)));
    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? user.id,
      actorRole: actor.role,
      actionType: "activated",
      entityType: "user_block",
      entityId: targetUserId,
      reason: "Account reactivated",
    });
    safeRevalidate("/settings/users");
    return { ok: true };
  });
}

export async function initiatePasswordReset(input: { targetUserId: string }): Promise<Result> {
  const { user, school } = await requireSchool();
  await assertAnyRole(USER_ADMIN_ROLES);
  const targetUserId = input?.targetUserId ?? "";
  const actor = await resolveActor(school.id);

  // Gate + resolve the STORED phone (never a caller-supplied destination) inside the tenant scope.
  const gated = await withSchool(school.id, async (tx) => {
    const gate = await gateTarget(tx, school.id, { id: user.id, roles: user.roles }, targetUserId);
    if (!gate.ok) return gate;
    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? user.id,
      actorRole: actor.role,
      actionType: "reset_initiated",
      entityType: "user_account",
      entityId: targetUserId,
      reason: "Password reset initiated by an administrator",
    });
    return { ok: true as const, phone: gate.phone };
  });
  if (!gated.ok) return gated;
  if (!gated.phone) return { ok: false, error: "That user has no phone on file to send a code to." };

  // Dispatch a one-time code to the target's OWN stored phone; they sign in and set a new password
  // themselves (L2a). The admin never sets or sees a password. Console-degrades with no SMS creds.
  await signInWithPhone(gated.phone);
  await sendSms(
    gated.phone,
    `${school.name}: an administrator has started a password reset for your account. Sign in with the one-time code sent to this number, then set a new password in Settings.`,
  );
  return { ok: true };
}
