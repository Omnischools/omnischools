import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * INCR-36 · Module L / L3 — forgot-password at login (Kofi R271–R278). Source-shape assertions: the
 * security-relevant properties are NEUTRAL-ALWAYS (R273 enumeration resistance), current-session-only
 * completion with NO target id (R274), the R276 walk-up guard, the reset OTP verify NOT redirecting,
 * and SEAM-ONLY (every Supabase recovery call goes through `lib/auth`, never feature code). `readCode`
 * strips comments so docblocks don't self-trip the greps.
 */
const SEAM = readCode("lib/auth/index.ts");
const ACTION = readCode("lib/actions/auth.ts");
const LOGIN = readCode("components/auth/login-form.tsx");
const RESET_FORM = readCode("components/auth/reset-form.tsx");
const RESET_PAGE = readCode("app/(marketing)/reset/page.tsx");
const RESET_PW_PAGE = readCode("app/(marketing)/reset-password/page.tsx");
const SETPW = readCode("components/auth/set-new-password.tsx");

/** The body of an `export async function NAME`, up to the next top-level `export`. */
function body(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  if (start === -1) return "";
  const after = src.indexOf("\nexport ", start + 1);
  return src.slice(start, after === -1 ? undefined : after);
}

describe("L3 · forgot-password", () => {
  it("L3-1 · the forgot link lives on the Password tab, below the password input", () => {
    expect(LOGIN).toContain('href="/reset"');
    expect(LOGIN).toContain("Forgot password?");
    // right-aligned 12px gold, hover underline — the authored `.forgot` port
    expect(LOGIN).toContain("text-right text-xs font-medium text-gold hover:underline");
    // below the password input (password flow is the only place type="password" appears in login)
    expect(LOGIN.indexOf('href="/reset"')).toBeGreaterThan(LOGIN.indexOf('type="password"'));
  });

  it("L3-2/L3-3 · verifyResetOtp does NOT redirect (unlike verifyLogin)", () => {
    const reset = body(ACTION, "verifyResetOtp");
    const login = body(ACTION, "verifyLogin");
    expect(reset).toContain("verifyPhoneOtp(phone, token)");
    expect(reset).not.toContain("redirect(");
    // contrast: the login verify DOES hard-redirect — the property under test is real
    expect(login).toContain('redirect("/dashboard")');
  });

  it("L3-6 · requestPasswordReset is NEUTRAL-ALWAYS — returns { ok: true }, never surfaces existence", () => {
    const b = body(ACTION, "requestPasswordReset");
    expect(b).toContain("return { ok: true }");
    // no unknown-email / error branch may leak back to the caller
    expect(b).not.toContain("return { ok: false");
    // errors are swallowed server-side, not surfaced
    expect(b).toContain("swallowed");
  });

  it("L3-10 · completePasswordReset takes newPassword ONLY — no target/user id (R274)", () => {
    const b = body(ACTION, "completePasswordReset");
    expect(b).toMatch(/completePasswordReset\(input:\s*\{\s*newPassword: string;?\s*\}\)/);
    expect(b).not.toContain("userId");
    expect(b).not.toContain("targetId");
    expect(b).not.toContain("targetUserId");
  });

  it("L3-11 · completePasswordReset enforces the password policy", () => {
    const b = body(ACTION, "completePasswordReset");
    expect(b).toContain("passwordProblem(newPassword)");
  });

  it("L3-12 · completePasswordReset requires NO current password (distinct from changeOwnPassword)", () => {
    const reset = body(ACTION, "completePasswordReset");
    const change = body(ACTION, "changeOwnPassword");
    expect(reset).not.toContain("currentPassword");
    expect(reset).not.toContain("signInWithPassword");
    // contrast: the Settings self-serve change KEEPS its current-password re-auth
    expect(change).toContain("currentPassword");
    expect(change).toContain("signInWithPassword(user.phone, currentPassword)");
  });

  it("R276 · completePasswordReset reads amr and refuses a password-only session", () => {
    const b = body(ACTION, "completePasswordReset");
    expect(b).toContain("sessionAuthMethods()");
    expect(b).toContain('every((m) => m === "password")');
    expect(b).toContain("Your reset link has expired — start again.");
    // the refusal must gate BEFORE the password is updated
    expect(b.indexOf("Your reset link has expired")).toBeLessThan(
      b.indexOf("updatePassword(newPassword)"),
    );
  });

  it("L3-15/L3-16 · SEAM-ONLY — raw Supabase recovery calls live ONLY in lib/auth", () => {
    expect(SEAM).toContain("resetPasswordForEmail");
    expect(SEAM).toContain("exchangeCodeForSession");
    // feature code goes through the seam primitives only, never the raw Supabase methods
    for (const feature of [ACTION, RESET_FORM, RESET_PAGE, RESET_PW_PAGE, SETPW]) {
      expect(feature).not.toContain("resetPasswordForEmail");
      expect(feature).not.toContain("exchangeCodeForSession");
      expect(feature).not.toContain("supabase.auth");
    }
    // seam-only: no new table/migration is introduced by any L3 feature file
    for (const feature of [ACTION, RESET_FORM, RESET_PAGE, RESET_PW_PAGE, SETPW]) {
      expect(feature).not.toContain("pgTable");
      expect(feature).not.toContain("CREATE TABLE");
    }
  });

  it("L3 · the new seam primitives are dev-bypass no-ops", () => {
    const send = SEAM.slice(SEAM.indexOf("export async function sendPasswordResetEmail"));
    expect(send.slice(0, 400)).toContain("if (!authIsLive()) return { ok: true }");
    const est = SEAM.slice(SEAM.indexOf("export async function establishRecoverySession"));
    expect(est.slice(0, 400)).toContain("if (!authIsLive()) return { ok: true }");
    const amr = SEAM.slice(SEAM.indexOf("export async function sessionAuthMethods"));
    expect(amr.slice(0, 300)).toContain("if (!authIsLive()) return []");
  });

  it("L3 · the reset flow reuses the login-card idioms + set-new-password has no current-password field", () => {
    // both prove-identity paths are offered (owner: BOTH), not auto-routed
    expect(RESET_FORM).toContain("requestOtp(phone,"); // + optional captchaToken (INCR-AUTH-CAPTCHA)
    expect(RESET_FORM).toContain("requestPasswordReset({ email,");
    expect(RESET_FORM).toContain("verifyResetOtp(phone, otp)");
    // the OTP input reuses the login-card mono treatment
    expect(RESET_FORM).toContain("text-center font-mono text-lg tracking-[0.3em]");
    // set-new-password: New + Confirm only, NO current-password (accept-form-shaped)
    expect((SETPW.match(/type="password"/g) ?? []).length).toBe(2);
    expect(SETPW).not.toContain("Current password");
    expect(SETPW).toContain("completePasswordReset({ newPassword: next })");
  });

  it("L3 · the email recovery exchange runs in a Route Handler, NOT the Server Component (cookie-persist fix)", () => {
    const CALLBACK = readCode("app/auth/reset-callback/route.ts");
    // the reset email lands on the route handler, not the page (so the exchanged cookie persists)
    expect(ACTION).toContain("/auth/reset-callback");
    // the route handler does the exchange via the seam...
    expect(CALLBACK).toContain("establishRecoverySession(code)");
    expect(CALLBACK).toMatch(/export async function GET/);
    // ...and the Server Component page NO LONGER exchanges — it only reads the session the handler set
    expect(RESET_PW_PAGE).not.toContain("establishRecoverySession");
    expect(RESET_PW_PAGE).toContain("getCurrentUser()");
  });
});
