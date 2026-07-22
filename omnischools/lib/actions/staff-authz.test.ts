import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { hasAnyRole, STAFF_ADMIN_ROLES } from "@/lib/access";
import { stripComments, readCode, TENANT_READ } from "@/lib/test-utils/source-shape";
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
const read = readCode;

const GUARD = /\bassertAnyRole\s*\(\s*STAFF_ADMIN_ROLES\s*\)/;
/**
 * Every export of a `"use server"` module is remotely callable — arrow consts and DEFAULT exports
 * included. Dex shipped an `export default async function grantAdminBackdoor` that matched neither
 * earlier branch, so it was invisible to both the exact-list check and the body sweep: a fully
 * ungated, self-service ADMIN grant with all 11 tests green.
 */
const EXPORTED_FN =
  /^export (?:default\s+async function (\w+)|async function (\w+)|const (\w+)\s*=\s*async)/gm;
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
    [...s.matchAll(EXPORTED_FN)].map((m) => ({ name: m[1] ?? m[2] ?? m[3], i: m.index! }));

  it("exposes no re-exports — a barrel would smuggle in actions this sweep never reads", () => {
    expect(src(), "`export {` / `export *` put a callable action outside this file").not.toMatch(
      /^export\s*(?:\{|\*)/m,
    );
  });

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

  it("the guard is unconditional — a gate behind an `if`, a flag or a block is not a gate", () => {
    // INDENTATION, not the matched line. My first version sliced back to the start of the guard's own
    // line, so `if (process.env.NODE_ENV !== "test") {\n    await assertAnyRole(...)\n }` read as
    // unconditional (Dex). A statement at the function body's base indent — exactly two spaces — is
    // nested inside nothing, which kills every wrapping variant at once instead of one at a time.
    const s = src();
    const all = [...s.matchAll(new RegExp(GUARD, "g"))];
    expect(all.length, "the guard must appear once per mutator").toBe(EXPECTED.length);
    for (const m of all) {
      const from = s.lastIndexOf("\n", m.index!) + 1;
      expect(
        s.slice(from, m.index! + m[0].length),
        "the role assertion must sit at the function's base indent, nested inside nothing",
      ).toMatch(/^ {2}await assertAnyRole\(STAFF_ADMIN_ROLES\)/);
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
  /**
   * SWEEP every /staff surface that touches the table — not one hardcoded path. The first version
   * pinned `/staff/compensation` alone, and `/staff/[id]` served the SAME salary, SSNIT and PAYE one
   * click away on any colleague's row, falsifying this very test's message (Dex). Two legal shapes:
   * gate the whole page, or never issue the query.
   */
  it("no /staff surface reads staffCompensation without proving STAFF_ADMIN_ROLES first", () => {
    const dir = resolve(cwd(), "app/(app)/staff");
    const pages: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".tsx")) pages.push(p);
      }
    };
    walk(dir);
    expect(pages.length, "the /staff sweep found no pages").toBeGreaterThan(3);

    const offenders: string[] = [];
    for (const p of pages) {
      const s = stripComments(readFileSync(p, "utf8"));
      const query = s.search(/\.from\(\s*staffCompensation\s*\)/);
      if (query === -1) continue; // this page never queries pay — nothing to gate
      // Shape A — the whole page is gated. `await` is required: `requireSchoolRole(...)` unawaited
      // throws inside a floating promise and the page renders anyway (Dex), and no type-aware lint
      // rule catches that here.
      const paged = s.search(/await requireSchoolRole\(\s*STAFF_ADMIN_ROLES\s*\)/);
      if (paged !== -1 && paged < query) continue;

      // Shape B — the query itself is conditional. Pin the guard's USE AT THE QUERY, not merely its
      // declaration somewhere in the file. Replacing `canAdmin ? tx.select()…` with `true ? …` left
      // `const canAdmin = hasAnyRole(...)` sitting untouched above and satisfied the old check — the
      // same "assert the expression, never the name" trap this file was written to stop, one level up.
      const decl = /const (\w+)\s*=\s*hasAnyRole\(\s*user\.roles\s*,\s*STAFF_ADMIN_ROLES\s*\)/.exec(s);
      const nearQuery = s.slice(Math.max(0, query - 200), query);
      if (!decl || !new RegExp(`\\b${decl[1]}\\b`).test(nearQuery)) {
        offenders.push(p.slice(p.indexOf("app/")));
      }
    }
    expect(offenders, "salaries, SSNIT and PAYE must not be readable by any staff member").toEqual([]);
  });

  /**
   * The second door, reproduced live by Quinn: `createInvite` accepted an arbitrary role string,
   * RETURNED the token to its caller, and `acceptInvite` needs no session — so a TEACHER invited
   * `ADMIN` to their own phone, accepted it, and `onConflictDoNothing` on `users.phone` stapled the
   * role onto their existing account. Closing `staff.ts` alone left the escalation fully open.
   */
  it("a STAFF invite takes the same gate as addStaff; only PARENT invites stay staff-wide", () => {
    const s = read("lib/actions/invites.ts");
    const fn = s.slice(s.indexOf("export async function createInvite"));
    const body = fn.slice(0, fn.indexOf("\nexport "));
    // Scoping this to ADMIN/HEADMASTER left MATRON (clinical write), VICE_HEADMASTER_ACADEMIC (the
    // WASSCE freeze co-signer), DEAN_OF_BOARDING and the finance roles mintable by any teacher — the
    // identical two-call exploit, one role over. The branch closes all of them with one rule.
    const check = body.search(
      /const canInvite = isParentRole\(d\.role\)\s*\?\s*isStaff\(user\.roles\)\s*:\s*hasAnyRole\(\s*user\.roles\s*,\s*STAFF_ADMIN_ROLES\s*\)/,
    );
    expect(check, "an invite creates a real role_assignment — minting staff needs admin").toBeGreaterThan(-1);
    // Consequence, not just condition (the PR #176 lesson): the check must REFUSE.
    expect(body.slice(check, check + 260)).toMatch(/if\s*\(\s*!canInvite\s*\)\s*\{[\s\S]{0,120}?return\s*\{\s*ok:\s*false/);
    // Unconditional — pin the REFUSAL's indent, not the const's. A dead outer `if (…) if (!canInvite)`
    // leaves the const at base indent and the pinned text intact while disabling the check entirely;
    // pinning `if (!canInvite)` to exactly two spaces makes the dangling wrapper visible.
    const refusal = body.search(/if\s*\(\s*!canInvite\s*\)/);
    expect(refusal, "createInvite must refuse when canInvite is false").toBeGreaterThan(-1);
    expect(
      body.slice(body.lastIndexOf("\n", refusal) + 1, refusal + 18),
      "the refusal must sit at the function's base indent, nested inside nothing",
    ).toMatch(/^ {2}if \(!canInvite\)/);
    // …and it must refuse BEFORE the invite row is written. No `if (write !== -1)` escape hatch:
    // this file forbids skip-hatches and then contained two of them.
    const write = body.search(/tx\.insert\(invites\)/);
    expect(write, "createInvite must still write the invite row").toBeGreaterThan(-1);
    expect(check).toBeLessThan(write);
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
