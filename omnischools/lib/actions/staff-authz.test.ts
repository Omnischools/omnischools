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
/**
 * Deliberately WIDER than `withSchool(` — Quinn shipped a `grantRoleBackdoor` using
 * `withoutTenantScope` that typechecked, built, passed all 675 tests, and handed a TEACHER `ADMIN`
 * on a production build. `withoutTenantScope` is not a strawman: it is the idiom `invites.ts` and
 * `onboarding.ts` already use for the very `role_assignment` writes that ARE the escalation.
 */
const TENANT_READ = /\b(withSchool|withoutTenantScope|withParentScope|withStaffScope|db)\s*[.(]/;
/** Every export of a `"use server"` module is remotely callable — arrow consts included. */
const EXPORTED_FN = /^export (?:async function (\w+)|const (\w+)\s*=\s*async)/gm;
const EXPECTED = [
  "addStaff",
  "importStaff",
  "saveStaffProfile",
  "updateStaff",
  "deleteStaff",
  "deleteStaffBulk",
  "assignStaffRole",
  "removeStaffRole",
  "saveStaffCompensation",
];

describe("every staff mutator is gated to STAFF_ADMIN_ROLES", () => {
  const src = () => read(ACTIONS);
  const exportsOf = (s: string) =>
    [...s.matchAll(EXPORTED_FN)].map((m) => ({ name: m[1] ?? m[2], i: m.index! }));

  it("the mutator list is EXACT — a tenth action is a change to this file, not a silent addition", () => {
    // `toContain` + `>= 9` licensed exactly what it should have caught: Quinn added a 10th export
    // and every assertion stayed green. An allow-list makes a new action fail until someone rules
    // on whether it may be called by a non-administrator.
    expect(exportsOf(src()).map((e) => e.name).sort()).toEqual([...EXPECTED].sort());
  });

  it("no mutator touches the database before asserting the role", () => {
    const s = src();
    const marks = exportsOf(s);
    const offenders: string[] = [];
    marks.forEach((m, i) => {
      const body = s.slice(m.i, i + 1 < marks.length ? marks[i + 1].i : s.length);
      const guard = body.search(GUARD);
      const read = body.search(TENANT_READ);
      // NO "nothing to guard" SKIP. An exported server action whose data access this sweep cannot
      // recognise is an OFFENDER, not a pass — the old `if (read === -1) return` was the hatch
      // Quinn's backdoor walked through. Unrecognised shape ⇒ someone must look at it.
      if (guard === -1 || read === -1 || guard > read) offenders.push(m.name);
    });
    expect(offenders, "these mutate staff data without first asserting the role").toEqual([]);
  });

  it("the guard is a real call, not a locally-rebound no-op", () => {
    // `const assertAnyRole = async () => {}` above the mutators satisfies a name-shaped check.
    const s = src();
    expect(s, "assertAnyRole must come from the auth seam").toMatch(
      /import\s*\{[^}]*\bassertAnyRole\b[^}]*\}\s*from\s*"@\/lib\/auth\/server"/,
    );
    expect(s, "assertAnyRole must not be shadowed by a local binding").not.toMatch(
      /(?:const|let|var|function)\s+assertAnyRole\b/,
    );
  });

  it("the guard is unconditional — a gate behind an `if` or a flag is not a gate", () => {
    const s = src();
    for (const m of [...s.matchAll(new RegExp(GUARD, "g"))]) {
      const line = s.slice(s.lastIndexOf("\n", m.index!) + 1, m.index! + m[0].length);
      expect(line.trim(), "the role assertion must not be conditional").toMatch(
        /^await assertAnyRole\(STAFF_ADMIN_ROLES\)/,
      );
    }
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

describe("the other two doors onto role_assignment", () => {
  /**
   * Quinn reverted the compensation page to its exact pre-fix form and all 675 tests stayed green —
   * `app-shell-guard.test.ts` included, because `requireSchool` IS a guard and #176's sweep is
   * satisfied by the vulnerable version. Half the shipped fix had no regression coverage at all.
   */
  it("the payroll page requires STAFF_ADMIN_ROLES, before it reads", () => {
    const s = read("app/(app)/staff/compensation/page.tsx");
    const guard = s.search(/requireSchoolRole\(\s*STAFF_ADMIN_ROLES\s*\)/);
    expect(guard, "salaries, SSNIT and PAYE must not be readable by any staff member").toBeGreaterThan(-1);
    const readAt = s.search(TENANT_READ);
    if (readAt !== -1) expect(guard).toBeLessThan(readAt);
  });

  /**
   * The second door, reproduced live by Quinn: `createInvite` accepted an arbitrary role string,
   * RETURNED the token to its caller, and `acceptInvite` needs no session — so a TEACHER invited
   * `ADMIN` to their own phone, accepted it, and `onConflictDoNothing` on `users.phone` stapled the
   * role onto their existing account. Closing `staff.ts` alone left the escalation fully open.
   */
  it("createInvite refuses to mint a role the actor does not hold", () => {
    const s = read("lib/actions/invites.ts");
    const fn = s.slice(s.indexOf("export async function createInvite"));
    const body = fn.slice(0, fn.indexOf("\nexport "));
    const check = body.search(
      /hasAnyRole\(\s*\[\s*role\.code\s*\]\s*,\s*STAFF_ADMIN_ROLES\s*\)\s*&&\s*!\s*hasAnyRole\(\s*user\.roles\s*,\s*STAFF_ADMIN_ROLES\s*\)/,
    );
    expect(check, "an invite creates a real role_assignment — minting admin needs admin").toBeGreaterThan(-1);
    // Consequence, not just condition (the PR #176 lesson): the check must REFUSE.
    expect(body.slice(check, check + 220)).toMatch(/return\s*\{\s*ok:\s*false/);
    // …and it must refuse BEFORE the invite row is written.
    const write = body.search(/tx\.insert\(invites\)/);
    if (write !== -1) expect(check).toBeLessThan(write);
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
