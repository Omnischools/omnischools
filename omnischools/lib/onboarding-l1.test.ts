import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import { KNOWN_APP_ROLES } from "@/lib/auth";
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
const STAFF_ROLES_SRC = readCode("lib/staff-roles.ts");

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

  it("L1-5 · min-8 enforced client (wizard) AND server (schema), identical message", () => {
    expect(WIZARD).toContain("Password must be at least 8 characters");
    expect(WIZARD).toMatch(/form\.password\.length < 8/);
    expect(SCHEMA).toContain('password: z.string().min(8, "Password must be at least 8 characters")');
  });

  it("L1-6 · confirm-mismatch is blocked", () => {
    expect(WIZARD).toContain("form.confirmPassword");
    expect(WIZARD).toContain("Passwords don't match.");
  });

  it("L1-7 · password is MANDATORY (schema required, launch guards empty)", () => {
    // Required in the schema (not `.optional()`).
    expect(SCHEMA).not.toMatch(
      /password: z\.string\(\)\.min\(8, "Password must be at least 8 characters"\)\.optional/,
    );
    // Launch cannot proceed with an empty password.
    expect(WIZARD).toContain("!form.password");
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

describe("L1 · PROPRIETOR provisioned but INERT (Kofi R258)", () => {
  it("L1-11 · PROPRIETOR is a member of KNOWN_APP_ROLES", () => {
    expect(KNOWN_APP_ROLES).toContain("PROPRIETOR");
  });

  it("L1-12 · PROPRIETOR is in NONE of the access role-groups (widens no gate)", () => {
    const groups: Record<string, readonly string[]> = {
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
    };
    for (const [name, roles] of Object.entries(groups)) {
      expect(roles, `${name} must NOT contain PROPRIETOR`).not.toContain("PROPRIETOR");
    }
  });

  it("L1-13 · signup does not assign PROPRIETOR (only ADMIN + optional HEADMASTER)", () => {
    expect(ACTION).not.toContain("PROPRIETOR");
  });

  it("L1-14 · PROPRIETOR is not in the assignable /staff role picker (deferred to L2)", () => {
    expect(STAFF_ROLES_SRC).not.toContain("PROPRIETOR");
  });

  it("L1-15 · AUTH_DEV_ROLES=PROPRIETOR would not throw (it is a known role)", () => {
    // The dev-bypass unknown-role guard filters against KNOWN_APP_ROLES; membership (L1-11) is the proof.
    expect((KNOWN_APP_ROLES as readonly string[]).includes("PROPRIETOR")).toBe(true);
  });
});
