/*
 * NO `import "server-only"` HERE, deliberately.
 *
 * That marker package is resolvable only inside the Next bundler graph; this module is also imported
 * by the vitest suite (and, for the provisioning modules, by a tsx CLI script), where the import
 * fails outright. The server-side boundary is therefore enforced the way this codebase already
 * enforces the read-back boundary — by an import-graph test with an explicit allow-list
 * (tests/auth-boundaries.test.ts, tests/provisioning-admin-gate.test.ts) plus the ESLint
 * no-restricted-imports rules — which catches a client component importing this at review time
 * rather than at bundle time, and which a test cannot silently lose.
 */
import { createClient } from "@/lib/supabase/server";
import { SupabaseAuthUnavailableError } from "@/lib/env";

/**
 * THE AUTH MECHANISM, behind `lib/auth` (increment G · Kofi R5 · Lucy G1).
 *
 * This is one of FOUR modules permitted to call `supabase.auth.*` — the others being
 * `lib/auth/index.ts` (session resolution), `lib/provisioning/admin-auth.ts` (the admin console's
 * own role gate) and `middleware.ts` (the deny-by-default route guard). Nothing else in the app may,
 * and in particular no feature code: the rule from the top of lib/auth/index.ts is what keeps the
 * session shape and the MFA policy in one place, so the sign-in surfaces call THESE functions and
 * never the SDK. tests/auth-boundaries.test.ts pins that four-module allow-list by name and
 * separately asserts that nothing anywhere calls `getSession()`.
 *
 * ── MFA IS MANDATORY, AND THIS MODULE CANNOT BE ASKED TO SKIP IT ──────────────────────────────────
 * There is deliberately no `rememberDevice`, no `skipMfa`, no "trusted device" parameter, and no
 * recovery-code path. An officer with no enrolled factor is given `enrolTotp()`; an officer with one
 * must pass `verifyTotp()`. Recovery is the PROVISIONING DESK (docs/PROVISIONING.md §4b), which is
 * the whole reason Oversight can afford to be stricter than apps/web here: there is a human who can
 * reset an officer's factor, so a lost phone is a support call rather than a lockout. Lucy R2 flags
 * the recovery posture for owner ratification; the safer default (administrator reset) is what is
 * built, which means: nothing is built here.
 *
 * ── ENUMERATION-SAFE ERRORS ───────────────────────────────────────────────────────────────────────
 * Every failure of the primary factor returns the SAME message whether the identity exists or not
 * (Lucy G1.a). The SDK's own error text distinguishes them, so it is deliberately not forwarded.
 */

export type AuthActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? Record<string, never> : T))
  | { ok: false; error: string; code: AuthErrorCode };

export type AuthErrorCode =
  | "BAD_CREDENTIALS"
  | "RATE_LIMITED"
  | "BAD_CODE"
  | "NO_FACTOR"
  | "UNAVAILABLE"
  | "UNKNOWN";

/** Lucy G1.a, authored (R8). Identical whether the identifier exists or not — no enumeration. */
export const BAD_CREDENTIALS_COPY =
  "That didn't match. Check the details GES issued you and try again.";
/** Lucy G1.a — GOLD, not terra, in the UI: the officer has done nothing wrong. */
export const RATE_LIMITED_COPY =
  "Too many attempts. For your security, sign-in is paused for a few minutes. If you've lost access to your device, contact your GES Oversight administrator.";
/** Lucy G1.b / G1.c, authored (R8). */
export const BAD_CODE_COPY =
  "That code didn't verify. Codes expire quickly — enter the current one.";
export const AUTH_UNAVAILABLE_COPY =
  "Sign-in is unavailable on this deployment — GES-staff auth is not configured. Contact the Oversight administrator.";

function classify(message: string): AuthErrorCode {
  const m = message.toLowerCase();
  if (m.includes("rate limit") || m.includes("too many")) return "RATE_LIMITED";
  if (m.includes("invalid") && (m.includes("code") || m.includes("totp")))
    return "BAD_CODE";
  return "BAD_CREDENTIALS";
}

function fail(code: AuthErrorCode): { ok: false; error: string; code: AuthErrorCode } {
  const copy =
    code === "RATE_LIMITED"
      ? RATE_LIMITED_COPY
      : code === "BAD_CODE"
        ? BAD_CODE_COPY
        : code === "UNAVAILABLE"
          ? AUTH_UNAVAILABLE_COPY
          : BAD_CREDENTIALS_COPY;
  return { ok: false, error: copy, code };
}

async function client() {
  try {
    return await createClient();
  } catch (err) {
    if (err instanceof SupabaseAuthUnavailableError) return null;
    throw err;
  }
}

/**
 * The PRIMARY factor.
 *
 * ⚠ OWNER-RATIFY (Lucy R1). The onboarding mock signs an officer in with a PHONE OTP ("the phone
 * number on your GES appointment record"); increment G's fixed decision is "Supabase Auth with
 * mandatory TOTP MFA" and settles the SECOND factor only. The primary factor is built here as the
 * GES work email + the credential the provisioner issues, because it needs no SMS provider and no
 * per-officer phone number on record, and because the mock's phone-OTP + a mandatory TOTP second
 * factor would be two one-time-code steps in a row — the same ceremony twice. If the owner ratifies
 * phone-OTP primary, THIS function is the only thing that changes: swap it for
 * `signInWithOtp({ phone })` + `verifyOtp({ type: "sms" })`; the MFA half, the session policy, the
 * resolver and the step-up are all independent of it. The field COPY on the sign-in card carries the
 * same flag.
 */
export async function signInWithCredentials(
  email: string,
  password: string,
): Promise<AuthActionResult> {
  const supabase = await client();
  if (!supabase) return fail("UNAVAILABLE");
  if (!email.trim() || !password) return fail("BAD_CREDENTIALS");

  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) return fail(classify(error.message));
  return { ok: true } as AuthActionResult;
}

export interface MfaStatus {
  /** An enrolled, verified TOTP factor — the officer is challenged against this one. */
  verifiedFactorId: string | null;
  /** A half-finished enrolment, reused rather than piling up new factors on every page load. */
  unverifiedFactorId: string | null;
  /** The session has already reached aal2 — no challenge needed right now. */
  aal2: boolean;
}

/** What MFA step this session needs. Reads the factor list from the auth server, not a cookie. */
export async function mfaStatus(): Promise<MfaStatus | null> {
  const supabase = await client();
  if (!supabase) return null;
  const [{ data: factors }, { data: aal }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  const totp = factors?.all?.filter((f) => f.factor_type === "totp") ?? [];
  return {
    verifiedFactorId: totp.find((f) => f.status === "verified")?.id ?? null,
    unverifiedFactorId: totp.find((f) => f.status === "unverified")?.id ?? null,
    aal2: aal?.currentLevel === "aal2",
  };
}

export interface TotpEnrolment {
  factorId: string;
  /** An SVG data URI from Supabase — rendered as the QR code (Lucy G1.b). */
  qrCode: string;
  /** The manual secret, for an officer who cannot scan (Lucy G1.b keeps this path). */
  secret: string;
}

/**
 * Begin (or resume) TOTP enrolment. Lucy G1.b.
 *
 * An existing UNVERIFIED factor is removed first rather than accumulated: Supabase allows several,
 * and an officer who refreshes the enrol page three times would otherwise end up with three pending
 * factors and a list that nobody can reconcile against the one QR code they actually scanned.
 */
export async function enrolTotp(): Promise<
  AuthActionResult<{ enrolment: TotpEnrolment }>
> {
  const supabase = await client();
  if (!supabase) return fail("UNAVAILABLE");

  const status = await mfaStatus();
  if (status?.unverifiedFactorId) {
    await supabase.auth.mfa.unenroll({ factorId: status.unverifiedFactorId });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Oversight ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data) return fail("UNKNOWN");
  return {
    ok: true,
    enrolment: {
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    },
  } as AuthActionResult<{ enrolment: TotpEnrolment }>;
}

/**
 * Challenge + verify a TOTP code. Used by BOTH the sign-in challenge (G1.c), the enrolment
 * confirmation (G1.b) and the §6 step-up (G7) — one code path, so there is no "verify but weaker"
 * variant for the step-up.
 *
 * On success GoTrue issues a new access token at aal2 with a FRESH `amr` entry, which is what the
 * step-up window is measured against (lib/auth/session-policy.ts). That is the reason the step-up
 * needs no server-side state of its own: the freshness lives in the signed token.
 */
export async function verifyTotp(
  factorId: string,
  code: string,
): Promise<AuthActionResult> {
  const supabase = await client();
  if (!supabase) return fail("UNAVAILABLE");
  if (!factorId) return fail("NO_FACTOR");
  if (!/^\d{6}$/.test(code)) return fail("BAD_CODE");

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error)
    return fail(classify(error.message) === "RATE_LIMITED" ? "RATE_LIMITED" : "BAD_CODE");
  return { ok: true } as AuthActionResult;
}

/** Sign out (Lucy G3). Best-effort: the cookies are cleared either way. */
export async function signOutSession(): Promise<void> {
  const supabase = await client();
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch {
    // A failed network call must not leave the officer staring at a dead "Signing out…" button.
    // The session cookies are dropped by the SDK before the request is made.
  }
}
