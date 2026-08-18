import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import { KNOWN_APP_ROLES } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/staff-roles";
import {
  FINANCE_ROLES,
  STAFF_ADMIN_ROLES,
  SENIOR_LEDGER_ROLES,
  SENIOR_MANAGEMENT_ROLES,
  WASSCE_SETUP_ROLES,
  BOARDING_ROLES,
  BOARDING_SCHOOL_SCOPED_ROLES,
  SICKBAY_ROLES,
  SICKBAY_CONFIG_WRITE_ROLES,
  SICKBAY_STOCK_WRITE_ROLES,
  SICKBAY_CLINICAL_READ_ROLES,
  SICKBAY_CLINICAL_WRITE_ROLES,
  SICKBAY_RECON_READ_ROLES,
} from "@/lib/access";

/**
 * INCR-33 · Module L / L1 — signup rework + PROPRIETOR provisioning (Kofi R256–R261).
 * Runtime assertions for the role registry (the inertness invariant), source-shape for the wizard /
 * action / schema (`readCode` strips comments so the docblocks don't self-trip the greps).
 */
const WIZARD = readCode("components/onboarding/wizard.tsx");
const ACTION = readCode("lib/actions/onboarding.ts");
const SCHEMA = readCode("lib/onboarding.ts");
const SETTINGS = readCode("components/settings/school-info-form.tsx");

describe("L1 · CSSPS removed from signup, kept in Settings", () => {
  it("L1-1 · the signup wizard has NO CSSPS field", () => {
    expect(WIZARD).not.toContain("csspsCode");
    expect(WIZARD).not.toContain("CSSPS");
  });

  it("L1-2 · the action still null-defaults cssps at creation (absent field → NULL)", () => {
    // With the wizard field gone, `d.csspsCode` is undefined → nz(undefined) → null persisted.
    expect(ACTION).toContain("csspsCode: nz(d.csspsCode)");
  });

  it("L1-3 · Settings › School remains the sole CSSPS entry point (regression)", () => {
    expect(SETTINGS).toContain("csspsCode");
  });
});

describe("L1 · the signup password step", () => {
  it("L1-4 · a password step with password + confirm inputs exists", () => {
    expect(WIZARD).toContain("PasswordStep");
    expect(WIZARD).toContain("Set a password");
    expect(WIZARD).toContain("Confirm password");
    expect(WIZARD).toContain('set("password"');
    expect(WIZARD).toContain('set("confirmPassword"');
    // both fields are masked
    expect((WIZARD.match(/type="password"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("L1-5 · policy enforced client (wizard) AND server (schema) via the shared passwordProblem/passwordSchema", () => {
    // Single-sourced in lib/password (audit #5: min-8 + a letter + a number). The behavioural proof is
    // lib/password.test.ts; here we pin that both the client and the server route through it.
    expect(WIZARD).toMatch(/passwordProblem\(/);
    expect(SCHEMA).toContain("password: passwordSchema");
  });

  it("L1-6 · confirm-mismatch is blocked", () => {
    expect(WIZARD).toContain("form.confirmPassword");
    expect(WIZARD).toContain("Passwords don't match.");
  });

  it("L1-7 · password is MANDATORY (schema required, launch guards empty)", () => {
    // Required in the schema (passwordSchema, not `.optional()`).
    expect(SCHEMA).toContain("password: passwordSchema");
    expect(SCHEMA).not.toMatch(/password: passwordSchema\.optional/);
    // Launch cannot proceed with an empty password: passwordError → passwordProblem("") returns an error.
    expect(WIZARD).toMatch(/identityError\(\) \?\? passwordError\(\)/);
  });

  it("L1-8 · live-mode signup creates the Supabase password credential (before the tx)", () => {
    expect(ACTION).toContain("createPasswordUser(adminPhone, d.password)");
    // ordered BEFORE the DB transaction (mirrors acceptInvite — no orphaned school on auth failure)
    expect(ACTION.indexOf("createPasswordUser(adminPhone")).toBeLessThan(
      ACTION.indexOf("await withoutTenantScope"),
    );
  });

  it("L1-9 · post-signup routes to sign-in; onboardSchool establishes NO session", () => {
    expect(WIZARD).toContain("/login?accepted=1");
    expect(ACTION).not.toContain("setSession");
    expect(ACTION).not.toContain("signInWith");
  });

  it("L1-10 · the wizard has no live-auth branch (works in dev-bypass)", () => {
    expect(WIZARD).not.toContain("authIsLive");
  });
});

describe("L1 · PROPRIETOR provisioning (Kofi R258; INCR-37 lifts the inertness — see proprietor-l37)", () => {
  it("L1-11 · PROPRIETOR is a member of KNOWN_APP_ROLES", () => {
    expect(KNOWN_APP_ROLES).toContain("PROPRIETOR");
  });

  it("L1-12 · PROPRIETOR is in no OPERATIONAL role-group; INCR-37 seats it in STAFF_ADMIN_ROLES only", () => {
    // The governance model (owner Option A): the proprietor's power is role-granting, so it joins the
    // authorization root (STAFF_ADMIN_ROLES) and NONE of the operational/clinical groups.
    const operational: Record<string, readonly string[]> = {
      FINANCE_ROLES,
      SENIOR_LEDGER_ROLES,
      SENIOR_MANAGEMENT_ROLES,
      WASSCE_SETUP_ROLES,
      BOARDING_ROLES,
      BOARDING_SCHOOL_SCOPED_ROLES,
      SICKBAY_ROLES,
      SICKBAY_CONFIG_WRITE_ROLES,
      SICKBAY_STOCK_WRITE_ROLES,
      SICKBAY_CLINICAL_READ_ROLES,
      SICKBAY_CLINICAL_WRITE_ROLES,
      SICKBAY_RECON_READ_ROLES,
    };
    for (const [name, roles] of Object.entries(operational)) {
      expect(roles, `${name} must NOT contain PROPRIETOR`).not.toContain("PROPRIETOR");
    }
    expect(STAFF_ADMIN_ROLES, "INCR-37 seats PROPRIETOR in the grant root").toContain("PROPRIETOR");
  });

  it("L1-13 · signup assigns PROPRIETOR only for owned (non-PUBLIC) schools; PUBLIC/GES stays ADMIN-only", () => {
    // INCR-37 (R281) lifts L1's "never assigned at signup": an owned school's creator gets PROPRIETOR + ADMIN.
    expect(ACTION).toContain("PROPRIETOR");
    expect(ACTION).toContain('d.ownership !== "PUBLIC"');
  });

  it("L1-14 · PROPRIETOR is not in the assignable /staff role picker (R282 — free-text + R280 grant it)", () => {
    expect(STAFF_ROLES.map((r) => r.code)).not.toContain("PROPRIETOR");
  });

  it("L1-15 · AUTH_DEV_ROLES=PROPRIETOR would not throw (it is a known role)", () => {
    // The dev-bypass unknown-role guard filters against KNOWN_APP_ROLES; membership (L1-11) is the proof.
    expect((KNOWN_APP_ROLES as readonly string[]).includes("PROPRIETOR")).toBe(true);
  });
});
