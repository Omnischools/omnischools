"use server";
import { redirect } from "next/navigation";
import {
  signInWithPhone,
  verifyPhoneOtp,
  signInWithPassword,
  updatePassword,
  signOut,
} from "@/lib/auth";
import { requireUser, resolveActor } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";

export async function requestOtp(
  phone: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!phone || phone.length < 7)
    return { ok: false, error: "Enter a valid phone number." };
  return signInWithPhone(phone);
}

export async function verifyLogin(
  phone: string,
  token: string,
): Promise<{ ok: false; error: string }> {
  const res = await verifyPhoneOtp(phone, token);
  if (!res.ok) return { ok: false, error: res.error ?? "Invalid code." };
  redirect("/dashboard");
}

export async function passwordLogin(
  phone: string,
  password: string,
): Promise<{ ok: false; error: string }> {
  if (!phone || !password) return { ok: false, error: "Enter your phone and password." };
  const res = await signInWithPassword(phone, password);
  if (!res.ok) return { ok: false, error: res.error ?? "Invalid phone or password." };
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/");
}

/**
 * INCR-34 (L2a) — a signed-in user changes their OWN password. `requireUser` (not `requireSchool`) so
 * it works for staff AND parents. R264: require the current password first — re-auth via
 * `signInWithPassword` before `updatePassword` (which acts on the current session only, no target id, so
 * no admin/other-account path exists). Dev-bypass no-ops both auth calls. Audited (no value) when an
 * active school is resolved.
 */
export async function changeOwnPassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ ok: boolean; error?: string }> {
  const currentPassword = input?.currentPassword ?? "";
  const newPassword = input?.newPassword ?? "";
  if (newPassword.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters" };
  }
  const user = await requireUser();
  // Prove the current password before changing it (blocks a walk-up attacker on an unlocked session).
  const reauth = await signInWithPassword(user.phone, currentPassword);
  if (!reauth.ok) return { ok: false, error: "Current password is incorrect." };
  const res = await updatePassword(newPassword);
  if (!res.ok) return { ok: false, error: res.error ?? "Could not update your password." };
  // Security event — the value is NEVER recorded. Best-effort: only when an active school is resolved.
  if (user.schoolId) {
    const schoolId = user.schoolId;
    const actor = await resolveActor(schoolId);
    await withSchool(schoolId, (tx) =>
      recordAudit(tx, {
        schoolId,
        actorUserId: actor.id ?? user.id,
        actorRole: actor.role,
        actionType: "password_changed",
        entityType: "user_account",
        entityId: user.id,
        reason: "Self-service password change",
      }),
    );
  }
  return { ok: true };
}
