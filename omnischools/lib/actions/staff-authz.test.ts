import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { hasAnyRole, STAFF_ADMIN_ROLES } from "@/lib/access";
import { STAFF_ROLES } from "@/lib/staff-roles";

/**
 * 🔴 Staff administration is ADMIN/HEADMASTER-only — a regression guard for a LIVE privilege
 * escalation.
 *
 * Every mutator in `lib/actions/staff.ts` was gated by `requireSchool()` alone, which since PR #176
 * means "authenticated + is staff" and nothing more. `ADMIN` is on the same assignable list that
 * `/staff` renders for every row, so ANY staff member — a teacher, a librarian, a sports master —
 * could open /staff, find their own row and make themselves Administrator in three clicks. No
 * crafted request, no SQL. `saveStaffCompensation` and the compensation page leaked the school's
 * whole payroll by the same gap.
 *
 * `role_assignment` is the authorization ROOT: `requireSchool`→`isStaff`, `requireSchoolRole`,
 * `isFinanceOnly` and the sickbay clinical boundary all read it. An actor who can write it can grant
 * themselves anything downstream — which is why this file pins the guard rather than trusting it.
 *
 * Three lessons from the PR #176 gate are baked in, each learned by getting it wrong first:
 *  1. ASSERT THE CALL, NEVER THE NAME — a bare identifier also matches the import.
 *  2. ASSERT THE CONSEQUENCE, NOT ONLY THE CONDITION — Quinn kept a pinned `if` and deleted the
 *     `redirect` inside it; the leak reopened and every test stayed green. So test 3 below pins that
 *     `assertAnyRole`'s check actually THROWS.
 *  3. READ CODE, NOT COMMENTS — a docblock naming the guard must never satisfy the guard check.
 */
const ACTIONS = "lib/actions/staff.ts";
const SERVER = "lib/auth/server.ts";
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|(?<!:)\/\/.*$/gm, "");
const read = (p: string) => stripComments(readFileSync(resolve(cwd(), p), "utf8"));

const GUARD = /\bassertAnyRole\s*\(\s*STAFF_ADMIN_ROLES\s*\)/;
const TENANT_READ = /\bwithSchool\s*\(/;

describe("every staff mutator is gated to STAFF_ADMIN_ROLES", () => {
  const src = () => read(ACTIONS);

  it("finds the mutators it claims to check (the sweep is not vacuous)", () => {
    const names = [...src().matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
    // 9 today. If a refactor moves or renames them this must fail loudly, not pass over an empty set.
    expect(names).toContain("assignStaffRole");
    expect(names.length).toBeGreaterThanOrEqual(9);
  });

  it("no mutator opens a tenant transaction before asserting the role", () => {
    const s = src();
    const marks = [...s.matchAll(/^export async function (\w+)/gm)];
    const offenders: string[] = [];
    marks.forEach((m, i) => {
      const body = s.slice(m.index!, i + 1 < marks.length ? marks[i + 1].index! : s.length);
      const guard = body.search(GUARD);
      const tenantRead = body.search(TENANT_READ);
      if (tenantRead === -1) return; // nothing to guard
      if (guard === -1 || guard > tenantRead) offenders.push(m[1]);
    });
    expect(offenders, "these mutate staff data without first asserting the role").toEqual([]);
  });

  it("assertAnyRole REFUSES — the condition is not enough, it must throw", () => {
    // The exact mutation that defeated the PR #176 guard: keep the `if`, delete its consequence.
    const body = read(SERVER);
    const fn = body.slice(body.indexOf("export async function assertAnyRole"));
    const decl = fn.slice(0, fn.indexOf("\n}"));
    expect(decl, "assertAnyRole must test the roles").toMatch(/!\s*hasAnyRole\s*\(/);
    expect(decl, "assertAnyRole must THROW when the check fails").toMatch(
      /if\s*\([\s\S]*?\)\s*\{[\s\S]*?\bthrow\b/,
    );
  });
});

describe("STAFF_ADMIN_ROLES has the polarity an authorization root needs", () => {
  // hasAnyRole is the predicate assertAnyRole actually calls, so this is the real logic, not a proxy.
  it("admits exactly the two administrator roles", () => {
    expect(hasAnyRole(["ADMIN"], STAFF_ADMIN_ROLES)).toBe(true);
    expect(hasAnyRole(["HEADMASTER"], STAFF_ADMIN_ROLES)).toBe(true);
  });

  it("refuses every other assignable staff role — including the ones that look senior", () => {
    const admin = new Set<string>(STAFF_ADMIN_ROLES);
    const others = STAFF_ROLES.map((r) => r.code).filter((c) => !admin.has(c));
    expect(others.length).toBeGreaterThan(10); // the list is real, not empty
    for (const role of others) {
      expect(hasAnyRole([role], STAFF_ADMIN_ROLES), `${role} must not administer staff`).toBe(false);
    }
  });

  it("refuses non-staff and empty sessions", () => {
    expect(hasAnyRole(["TEACHER", "MATRON", "HOUSEMASTER"], STAFF_ADMIN_ROLES)).toBe(false);
    expect(hasAnyRole(["PARENT"], STAFF_ADMIN_ROLES)).toBe(false);
    expect(hasAnyRole([], STAFF_ADMIN_ROLES)).toBe(false);
  });

  it("an administrator who also teaches still administers", () => {
    expect(hasAnyRole(["TEACHER", "ADMIN"], STAFF_ADMIN_ROLES)).toBe(true);
  });
});
