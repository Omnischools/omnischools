import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import {
  canGrantRole,
  USER_ADMIN_ROLES,
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
  FINANCE_ROLES,
} from "@/lib/access";

/**
 * INCR-37 · PROPRIETOR full design (Kofi R279–R285 + owner LOCKED decisions). Composable governance
 * model (Option A): PROPRIETOR joins ONLY the grant root (STAFF_ADMIN_ROLES) on top of USER_ADMIN_ROLES,
 * never an operational/clinical group. The crux (P2) is `canGrantRole` — the R280 escalation guard that
 * closes a LIVE bug: `resolveRole` turns a free-text "PROPRIETOR" into a real ref_role, so without the
 * guard an ADMIN could self-mint the top rank at any of the four grant-writing sites.
 *
 * Pure guards run at RUNTIME (the strongest coverage); the per-site write ordering is SOURCE-SHAPE
 * (a behavioural version needs a DB + a session per role). `readCode` strips comments so a docblock
 * naming the guard can't satisfy the grep.
 */

const STAFF = readCode("lib/actions/staff.ts");
const INVITES = readCode("lib/actions/invites.ts");
const ONBOARD = readCode("lib/actions/onboarding.ts");
const ACCESS = readCode("lib/access.ts");

/** Body of a top-level `export async function name` up to the next top-level export (or EOF). */
function fnBody(src: string, decl: string): string {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(`decl not found: ${decl}`);
  const end = src.indexOf("\nexport ", start + decl.length);
  return src.slice(start, end === -1 ? src.length : end);
}

/** Does `canGrantRole(` appear in this body BEFORE the given write? */
function guardsBefore(body: string, write: RegExp): boolean {
  const g = body.search(/canGrantRole\(/);
  const w = body.search(write);
  return g > -1 && w > -1 && g < w;
}

describe("P1 · PROPRIETOR group membership (governance Option A)", () => {
  it("is a member of USER_ADMIN_ROLES AND STAFF_ADMIN_ROLES", () => {
    expect(USER_ADMIN_ROLES).toContain("PROPRIETOR");
    expect(STAFF_ADMIN_ROLES).toContain("PROPRIETOR");
  });

  it("is in NONE of the operational / clinical / finance groups", () => {
    const groups: Record<string, readonly string[]> = {
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
      FINANCE_ROLES,
    };
    for (const [name, g] of Object.entries(groups)) {
      expect(g, `${name} must NOT contain PROPRIETOR`).not.toContain("PROPRIETOR");
    }
  });
});

describe("P2 🔴 · canGrantRole — the R280 escalation guard (THE crux)", () => {
  it("a role that OUTRANKS the actor is refused (ADMIN/HEADMASTER cannot grant PROPRIETOR)", () => {
    expect(canGrantRole(["ADMIN"], "PROPRIETOR")).toBe(false);
    expect(canGrantRole(["HEADMASTER"], "PROPRIETOR")).toBe(false);
  });

  it("a role at OR BELOW the actor's rank is allowed (peers mint peers; proprietor mints anything)", () => {
    expect(canGrantRole(["ADMIN"], "ADMIN")).toBe(true);
    expect(canGrantRole(["PROPRIETOR"], "PROPRIETOR")).toBe(true);
    expect(canGrantRole(["ADMIN"], "TEACHER")).toBe(true);
  });

  it("addStaff & assignStaffRole call canGrantRole before the assign() write", () => {
    expect(guardsBefore(fnBody(STAFF, "export async function addStaff"), /assign\(tx/)).toBe(true);
    expect(guardsBefore(fnBody(STAFF, "export async function assignStaffRole"), /assign\(tx/)).toBe(
      true,
    );
  });

  it("importStaff guards PER ROW before BOTH the assign AND the invite write", () => {
    const body = fnBody(STAFF, "export async function importStaff");
    expect(guardsBefore(body, /assign\(tx/)).toBe(true);
    expect(guardsBefore(body, /tx\.insert\(invites\)/)).toBe(true);
  });

  it("createInvite guards canGrantRole before it inserts the invite row", () => {
    expect(
      guardsBefore(fnBody(INVITES, "export async function createInvite"), /tx\.insert\(invites\)/),
    ).toBe(true);
  });

  it("acceptInvite checks the INVITER's rank (defense-in-depth for a directly-inserted row)", () => {
    const body = fnBody(INVITES, "export async function acceptInvite");
    expect(body).toContain("inv.invitedByUserId");
    expect(body).toMatch(/canGrantRole\(inviterRoles/);
  });
});

describe("signup (R281) · owned schools seat a PROPRIETOR, PUBLIC/GES stays ADMIN-only", () => {
  it("onboardSchool pushes PROPRIETOR gated INSIDE `ownership !== \"PUBLIC\"`", () => {
    const gate = ONBOARD.indexOf('d.ownership !== "PUBLIC"');
    const push = ONBOARD.indexOf('roleId("PROPRIETOR")');
    expect(gate, "the ownership gate must exist").toBeGreaterThan(-1);
    expect(push, "the PROPRIETOR assignment must exist").toBeGreaterThan(-1);
    expect(push, "the PROPRIETOR push must sit after (inside) the ownership gate").toBeGreaterThan(
      gate,
    );
  });
});

describe("P9 · L1/L2b invariants unchanged (rankOf / canManageTarget byte-identical)", () => {
  it("rankOf keeps its ladder and canManageTarget keeps its strict-outrank + non-self rule", () => {
    expect(ACCESS).toContain('r === "PROPRIETOR"');
    expect(ACCESS).toContain("if (n > rank) rank = n;");
    expect(ACCESS).toContain(
      "return actorId !== targetId && rankOf(actorRoles) > rankOf(targetRoles);",
    );
  });
});

describe("P10 · seam / catalog-only — no schema or migration in the INCR-37 diff", () => {
  it("no touched INCR-37 file defines a table or embeds DDL", () => {
    const files = [
      "lib/access.ts",
      "lib/staff-roles.ts",
      "lib/actions/staff.ts",
      "lib/actions/invites.ts",
      "lib/actions/onboarding.ts",
    ];
    for (const f of files) {
      const s = readCode(f);
      expect(s, `${f} must not define a table`).not.toMatch(/pgTable\(/);
      expect(s, `${f} must not embed raw DDL`).not.toMatch(/CREATE TABLE/i);
    }
  });
});
