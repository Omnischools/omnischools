/**
 * INCR-254 (deferred half) — the pure decision for a school's "Require two-factor for administrators"
 * security setting (ref_school.require_2fa). Kept free of next/navigation + Supabase so the decision
 * matrix (and the critical NO-LOCKOUT / fail-safe call) is unit-testable without a live session. The
 * wiring (read the amr, read the setting, redirect) lives in lib/auth/server.ts::enforceRequireTwoFactor.
 */

/**
 * The `amr` (Authentication Methods References) methods that count as a completed OTP factor. Our live
 * login path is Supabase phone-OTP (`verifyOtp({ type: "sms" })`), which GoTrue records as method
 * `"otp"`; the rest are tolerated so a future MFA/TOTP enrolment (or a GoTrue label change) still
 * satisfies the requirement rather than silently forcing a redundant step-up.
 * ponytail: small allow-list, widen only if a new second factor ships with a different amr label.
 */
export const OTP_AMR_METHODS = ["otp", "sms", "mfa", "totp"] as const;

/** Did the session complete a phone-OTP (or MFA) factor, as opposed to password-only? */
export function hasOtpFactor(amr: readonly string[]): boolean {
  return amr.some((m) => (OTP_AMR_METHODS as readonly string[]).includes(m.toLowerCase()));
}

/**
 * `true` ⇒ this signed-in session must be sent to complete phone-OTP (step-up) before it may use an
 * admin surface. Fires ONLY when every condition holds:
 *
 *  - `require2fa` falsey (off / null / undefined) ⇒ false — the school never opted in (DEFAULT OFF).
 *  - `!isAdmin`                                    ⇒ false — the setting only covers the admin tier.
 *  - `!otpDeliverable`                             ⇒ false — 🔴 THE NO-LOCKOUT / FAIL-SAFE GATE.
 *  - otherwise                                     ⇒ block unless the session already did OTP.
 *
 * 🔴 FAIL-SAFE, the deliberate INVERSE of `sessionAgeExceeded` (which fails CLOSED). `otpDeliverable`
 * is `otpLoginRequired()` — the SAME gate that decides whether OTP is even required at login (auth live
 * AND the SMS provider switched on). If OTP cannot actually be delivered (pre-#260: SMS/OTP still
 * console-only), forcing an OTP that will never arrive would permanently LOCK OUT the school's only
 * admins — a bricked school. A password-only admin session is a strictly better outcome than that, so
 * here AVAILABILITY WINS: no deliverable OTP ⇒ do not block. (session-age can fail closed because its
 * worst case is a harmless re-login; this must fail safe because its worst case is a lockout with no
 * recovery path.) Default-OFF plus this gate is why shipping now is inert until the phone-OTP go-live.
 *
 * NOTE the asymmetry with amr-readability: when OTP *is* deliverable, an unreadable/absent amr (`[]`)
 * DOES block — but that is safe, not a lockout, because the user can complete the very OTP we redirect
 * them to. Deliverability, not amr-readability, is the lockout gate; so everything downstream of it
 * stays strict.
 */
export function twoFactorStepUpRequired(a: {
  require2fa: boolean | null | undefined;
  isAdmin: boolean;
  otpDeliverable: boolean;
  amr: readonly string[];
}): boolean {
  if (!a.require2fa) return false;
  if (!a.isAdmin) return false;
  if (!a.otpDeliverable) return false; // no-lockout: never force an undeliverable OTP
  return !hasOtpFactor(a.amr);
}
