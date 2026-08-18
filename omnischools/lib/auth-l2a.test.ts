import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import { isRedactedAuditEntity } from "@/lib/audit/redaction";

/**
 * INCR-34 · Module L / L2a — self change-password (Kofi R264, AC L2-1..L2-5). Source-shape assertions:
 * the security-relevant properties are the ORDER (re-auth before update), the GATE (requireUser, not
 * requireSchool), min-8 before any auth call, no target id, and that the password value never reaches
 * the audit. `readCode` strips comments so the docblocks don't self-trip the greps.
 */
const ACTION = readCode("lib/actions/auth.ts");
const SEAM = readCode("lib/auth/index.ts");
const FORM = readCode("components/auth/change-password-form.tsx");

describe("L2a · self change-password action", () => {
  it("L2-1 · re-auths with the current password, THEN updates; current-session only (no target id)", () => {
    expect(ACTION).toContain("signInWithPassword(user.phone, currentPassword)");
    expect(ACTION).toContain("updatePassword(newPassword)");
    expect(ACTION.indexOf("signInWithPassword(user.phone, currentPassword)")).toBeLessThan(
      ACTION.indexOf("updatePassword(newPassword)"),
    );
    // the action input is {currentPassword, newPassword} only — no admin/other-account target.
    expect(ACTION).not.toContain("targetUserId");
    expect(ACTION).not.toContain("targetId");
  });

  it("L2-2 · a wrong current password is refused before the password is updated", () => {
    expect(ACTION).toContain("!reauth.ok");
    expect(ACTION).toContain("Current password is incorrect.");
    expect(ACTION.indexOf("!reauth.ok")).toBeLessThan(ACTION.indexOf("updatePassword(newPassword)"));
  });

  it("L2-3 · the password policy is enforced BEFORE any auth call", () => {
    expect(ACTION).toContain("passwordProblem(newPassword)");
    // scope to changeOwnPassword's own re-auth call (signInWithPassword( also appears in passwordLogin)
    expect(ACTION.indexOf("passwordProblem(newPassword)")).toBeLessThan(
      ACTION.indexOf("signInWithPassword(user.phone, currentPassword)"),
    );
  });

  it("L2-4 · the updatePassword primitive is a dev-bypass no-op, current-session only", () => {
    const idx = SEAM.indexOf("export async function updatePassword");
    expect(idx).toBeGreaterThan(-1);
    const block = SEAM.slice(idx, idx + 400);
    expect(block).toContain("if (!authIsLive()) return { ok: true }");
    expect(block).toContain("updateUser({ password: newPassword })");
    // single param — takes no target id
    expect(block).toMatch(/updatePassword\(\s*newPassword: string,?\s*\)/);
  });

  it("L2-5 · gated by requireUser (works for parents), NOT requireSchool", () => {
    expect(ACTION).toContain("requireUser()");
    expect(ACTION).not.toContain("requireSchool");
  });

  it("L2 · the password value is never written to the audit", () => {
    const idx = ACTION.indexOf("recordAudit(tx");
    expect(idx).toBeGreaterThan(-1);
    const block = ACTION.slice(idx, idx + 400);
    expect(block).toContain('actionType: "password_changed"');
    expect(block).toContain('entityType: "user_account"');
    expect(block).not.toContain("newPassword");
    expect(block).not.toContain("password:");
  });

  it("L2 · the user_account audit entity is classified SHOWN (not redacted) — INCR-31 guard", () => {
    expect(isRedactedAuditEntity("user_account")).toBe(false);
  });

  it("L2a form · current + new + confirm inputs, min-8 + mismatch, no target field", () => {
    expect(FORM).toContain("Current password");
    expect(FORM).toContain("New password");
    expect(FORM).toContain("Confirm new password");
    expect(FORM).toContain("changeOwnPassword({ currentPassword: current, newPassword: next })");
    expect(FORM).toContain("Passwords don't match.");
    expect((FORM.match(/type="password"/g) ?? []).length).toBe(3);
  });
});
