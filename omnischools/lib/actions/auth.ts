"use server";
import { redirect } from "next/navigation";
import {
  signInWithPhone,
  verifyPhoneOtp,
  signInWithPassword,
  updatePassword,
  sendPasswordResetEmail,
  sessionAuthMethods,
  signOut,
  getSessionId,
} from "@/lib/auth";
import { requireUser, resolveActor } from "@/lib/auth/server";
import { passwordProblem } from "@/lib/password";
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
}): Promise<{ ok: boolean; error?: string; newSessionId?: string }> {
  const currentPassword = input?.currentPassword ?? "";
  const newPassword = input?.newPassword ?? "";
  const pwProblem = passwordProblem(newPassword);
  if (pwProblem) {
    return { ok: false, error: pwProblem };
  }
  const user = await requireUser();
  // Prove the current password before changing it (blocks a walk-up attacker on an unlocked session).
  const reauth = await signInWithPassword(user.phone, currentPassword);
  if (!reauth.ok) return { ok: false, error: "Current password is incorrect." };
  const res = await updatePassword(newPassword);
  if (!res.ok) return { ok: false, error: res.error ?? "Could not update your password." };
  // Security event — the value is NEVER recorded. Best-effort + FAIL-OPEN (Dex L2a finding): the password
  // already changed, so an audit-write failure must NOT surface as an error — else the user retries with
  // the now-invalid old password and gets a misleading "Current password is incorrect." Only attempted
  // when an active school resolves (the audit table is tenant-scoped).
  if (user.schoolId) {
    const schoolId = user.schoolId;
    try {
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
    } catch {
      // swallow — a missing audit row is acceptable; a false failure on a succeeded change is not.
    }
  }
  // INCR-39: the R264 re-auth above rotated the Supabase session_id — our offline-buffer partition
  // prefix (pwa-store recordKey). Return the NEW id so the self change-password form can re-key THIS
  // user's own pending scores old→new before the next PwaSession purge orphans them. session_id is a
  // non-secret partition key (getSessionId docblock), so returning it is safe.
  const newSessionId = await getSessionId();
  return { ok: true, newSessionId };
}

/**
 * INCR-36 (L3, R273) — request a password-reset EMAIL. NEUTRAL-ALWAYS: this ALWAYS returns { ok: true }
 * regardless of whether the email is on file, and swallows EVERY error server-side (logged, never
 * surfaced). Enumeration-resistance is OUR binding guarantee here — not a behaviour we borrow from
 * Supabase — so the UI can never tell a registered address from an unknown one. `redirectTo` is built
 * from NEXT_PUBLIC_SITE_URL, mirroring `createInvite`'s link (invites.ts).
 */
export async function requestPasswordReset(input: { email: string }): Promise<{ ok: true }> {
  const email = input?.email?.trim() ?? "";
  try {
    // The recovery link lands on a ROUTE HANDLER (not the /reset-password Server Component): only a
    // route handler / server action can PERSIST the exchanged session cookie (a Server Component's
    // cookie write is a silent no-op — lib/supabase/server.ts setAll catch, no refresh middleware).
    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/reset-callback`;
    const res = await sendPasswordResetEmail(email, redirectTo);
    if (res.error) console.error("[auth] reset email send error (swallowed for R273):", res.error);
  } catch (err) {
    console.error("[auth] requestPasswordReset threw (swallowed for R273):", err);
  }
  return { ok: true };
}

/**
 * INCR-36 (L3) — verify a phone OTP for the RESET flow. Wraps `verifyPhoneOtp` and returns the result
 * WITHOUT redirecting (unlike `verifyLogin`, which hard-redirects to /dashboard) so the reset card can
 * advance to the set-new-password step on the session the OTP just established.
 */
export async function verifyResetOtp(
  phone: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await verifyPhoneOtp(phone, token);
  if (!res.ok) return { ok: false, error: res.error ?? "Invalid code." };
  return { ok: true };
}

/**
 * INCR-36 (L3, R274) — complete a password reset on the CURRENT (proven) session. Takes ONLY
 * `newPassword` — NO target/user id anywhere, so it structurally cannot set another account's password
 * (the just-proven session IS the authorization, exactly like L2a's `updatePassword`). Distinct from
 * `changeOwnPassword`: it requires NO current password (identity was proven by the phone OTP or the
 * email recovery link, not by re-typing the old password). min-8 matches AcceptSchema.
 *
 * R276 walk-up guard: a reset must ride FRESH proof. We read the session's `amr`; a session that is
 * clearly password-method-only (non-empty AND every method === "password", i.e. someone reached this on
 * an ordinary password login with no OTP/recovery proof) is REFUSED. otp / recovery / magiclink proceed.
 *
 * ⚠️ FAIL-OPEN caveat (Sarah's to harden): when `amr` is empty or unreadable we PROCEED, so an
 * unexpected JWT shape (or dev-bypass) never locks out a legitimate reset. This trades strictness for
 * availability; the hardening is a verified decode / a server-side recovery-flag check. Flagged for Sarah.
 */
export async function completePasswordReset(input: {
  newPassword: string;
}): Promise<{ ok: boolean; error?: string }> {
  const newPassword = input?.newPassword ?? "";
  const pwProblem = passwordProblem(newPassword);
  if (pwProblem) {
    return { ok: false, error: pwProblem };
  }
  const methods = await sessionAuthMethods();
  const passwordOnly = methods.length > 0 && methods.every((m) => m === "password");
  if (passwordOnly) {
    return { ok: false, error: "Your reset link has expired — start again." };
  }
  const res = await updatePassword(newPassword);
  if (!res.ok) return { ok: false, error: res.error ?? "Could not update your password." };
  return { ok: true };
}
