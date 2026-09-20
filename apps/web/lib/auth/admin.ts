import "server-only";
import { authIsLive, normalizeGhanaPhone } from "./index";

/**
 * INCR-303 — the SERVICE-ROLE auth seam. Kept in its OWN file, apart from `lib/auth/index.ts`, so the
 * AUTH-OTP-05 guarantee holds visibly: the account-CREATION path (`createPasswordUser` in index.ts) still
 * uses ONLY the anonymous `signUp` and constructs no admin client — see create-password-user-anon.test.ts.
 * The one privileged capability here is SENDING an OTP, which is the OPPOSITE of confirming a phone: the
 * target must still complete the code, so OTP-first is never voided. `admin-otp-send.test.ts` re-asserts
 * that this file NEVER touches a confirm-on-create method (admin.createUser / updateUserById / *_confirm).
 */

/** Minimal view of the service-role auth client — only the send-OTP method, nothing that can confirm. */
type AdminAuthApi = {
  signInWithOtp(creds: { phone: string }): Promise<{ error: { message: string } | null }>;
};

/**
 * Admin-INITIATED OTP send. An admin resetting ANOTHER user's password (see `initiatePasswordReset`) is an
 * AUTHENTICATED, role-gated action: the target isn't present to solve a captcha, and the admin can't solve
 * one on their behalf. GoTrue's captcha middleware BYPASSES validation for service-role (admin) credentials,
 * so this dispatches the target's own OTP SMS with Turnstile enforced — WITHOUT a caller-supplied token and
 * WITHOUT weakening the PUBLIC login/reset flows (those keep calling the anon, captcha-gated `signInWithPhone`).
 * The admin never sets or sees a password: the target signs in with the code and sets their own (L2a).
 * Dev-bypass no-op; a real error (never a swallowed lie — this is an authenticated actor, no enumeration
 * oracle to protect) if the send fails or the service key isn't configured.
 * ponytail: rests on GoTrue skipping captcha for service-role requests — confirm once in a live captcha env.
 */
export async function adminSendPhoneOtp(phone: string): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeGhanaPhone(phone);
  if (!authIsLive()) {
    console.info(`[auth:dev] admin OTP requested for ${normalized} (bypass enabled)`);
    return { ok: true };
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const client = createAdminClient();
  if (!client) {
    return { ok: false, error: "Password reset is unavailable — the auth service is not configured." };
  }
  const { error } = await (client.auth as unknown as AdminAuthApi).signInWithOtp({ phone: normalized });
  if (error) {
    console.error("[auth] admin OTP send error:", error.message);
    return { ok: false, error: "Could not send the reset code. Please try again." };
  }
  return { ok: true };
}
