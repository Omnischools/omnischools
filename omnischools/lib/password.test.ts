import { describe, it, expect } from "vitest";
import { passwordSchema, passwordProblem, PASSWORD_MIN } from "@/lib/password";

/**
 * Audit item #5 — the app-side password policy: min-8 + at least one letter + at least one number.
 * This is the behavioural proof; the source-pin tests (onboarding-l1 / auth-l2a / auth-l3) only assert
 * that the call sites route through this shared policy.
 */
describe("password policy · min-8 + a letter + a number", () => {
  it("PASSWORD_MIN is 8", () => {
    expect(PASSWORD_MIN).toBe(8);
  });

  it("accepts a compliant password (letters + a number, ≥8)", () => {
    for (const ok of ["abcd1234", "Str0ngpass", "kwame2024", "passw0rd"]) {
      expect(passwordProblem(ok)).toBeNull();
      expect(passwordSchema.safeParse(ok).success).toBe(true);
    }
  });

  it("rejects too-short (< 8), even with a letter and a number", () => {
    expect(passwordProblem("ab12")).toMatch(/at least 8/i);
    expect(passwordSchema.safeParse("a1b2c3").success).toBe(false);
  });

  it("rejects all-letters — no number (e.g. 'password')", () => {
    expect(passwordProblem("password")).toMatch(/number/i);
    expect(passwordProblem("onlyletters")).toMatch(/number/i);
  });

  it("rejects all-digits — no letter (e.g. '12345678')", () => {
    expect(passwordProblem("12345678")).toMatch(/letter/i);
  });

  it("passwordProblem returns null exactly when the schema passes (they agree)", () => {
    for (const pw of ["short", "12345678", "password", "abcd1234", "", "ok1"]) {
      expect(passwordProblem(pw) === null).toBe(passwordSchema.safeParse(pw).success);
    }
  });
});
