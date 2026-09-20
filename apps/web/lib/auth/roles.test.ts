import { describe, it, expect } from "vitest";
import { scopeRolesToActiveSchool, isCurrentlyActive } from "./roles";

/**
 * These pin a PRIVILEGE ESCALATION, so they assert the negative explicitly: the role held at the
 * OTHER school must be absent, not merely "the array looks right".
 *
 * The escalation: roles were flattened across every school a user belonged to, so a TEACHER at
 * school A who was ADMIN at school B carried "ADMIN" while operating at A — passing
 * requireSchoolRole/assertAnyRole there. RLS still scoped the DATA to A, so this was never a
 * cross-tenant leak; it was an escalation WITHIN A.
 */

const SCHOOL_A = "aaaaaaaa-0000-0000-0000-000000000001";
const SCHOOL_B = "bbbbbbbb-0000-0000-0000-000000000002";
const SCHOOL_C = "cccccccc-0000-0000-0000-000000000003";

describe("scopeRolesToActiveSchool — the cross-school role union", () => {
  it("does NOT carry a role held at another school (THE escalation)", () => {
    // Ordered as getCurrentUser orders: earliest assignment first → school A is active.
    const scoped = scopeRolesToActiveSchool([
      { code: "TEACHER", schoolId: SCHOOL_A },
      { code: "ADMIN", schoolId: SCHOOL_B },
    ]);

    expect(scoped.schoolId).toBe(SCHOOL_A);
    expect(scoped.roles).toEqual(["TEACHER"]);
    // The assertion that matters — the old code returned ["TEACHER","ADMIN"] here:
    expect(scoped.roles).not.toContain("ADMIN");
  });

  it("keeps every role genuinely held AT the active school", () => {
    const scoped = scopeRolesToActiveSchool([
      { code: "TEACHER", schoolId: SCHOOL_A },
      { code: "VICE_HEADMASTER_ACADEMIC", schoolId: SCHOOL_A },
      { code: "ADMIN", schoolId: SCHOOL_B },
    ]);
    expect(scoped.roles.sort()).toEqual(["TEACHER", "VICE_HEADMASTER_ACADEMIC"]);
    expect(scoped.roles).not.toContain("ADMIN");
  });

  it("is driven by ORDER, not by which school appears most (first row is active)", () => {
    // School B has more assignments, but A is first → A is active and B contributes nothing.
    const scoped = scopeRolesToActiveSchool([
      { code: "TEACHER", schoolId: SCHOOL_A },
      { code: "ADMIN", schoolId: SCHOOL_B },
      { code: "HEADMASTER", schoolId: SCHOOL_B },
    ]);
    expect(scoped.schoolId).toBe(SCHOOL_A);
    expect(scoped.roles).toEqual(["TEACHER"]);
  });

  it("scopes to ONE school even when the user belongs to three", () => {
    // Two roles at the active school C, plus a role at each of two others — neither leaks.
    const scoped = scopeRolesToActiveSchool([
      { code: "BURSAR", schoolId: SCHOOL_C },
      { code: "TEACHER", schoolId: SCHOOL_C },
      { code: "ADMIN", schoolId: SCHOOL_A },
      { code: "HEADMASTER", schoolId: SCHOOL_B },
    ]);
    expect(scoped.schoolId).toBe(SCHOOL_C);
    expect(scoped.roles.sort()).toEqual(["BURSAR", "TEACHER"]);
    expect(scoped.roles).not.toContain("ADMIN");
    expect(scoped.roles).not.toContain("HEADMASTER");
  });

  it("collapses a role assigned more than once at the active school", () => {
    // Same role, two scopes (e.g. per class) — must not appear twice.
    const scoped = scopeRolesToActiveSchool([
      { code: "TEACHER", schoolId: SCHOOL_A },
      { code: "TEACHER", schoolId: SCHOOL_A },
    ]);
    expect(scoped.roles).toEqual(["TEACHER"]);
  });

  it("grants nothing when the user holds no currently-active assignment", () => {
    // getCurrentUser filters out expired/not-yet-started rows, so this is the empty case.
    const scoped = scopeRolesToActiveSchool([]);
    expect(scoped.schoolId).toBeUndefined();
    expect(scoped.roles).toEqual([]);
  });

  it("single-school users are completely unaffected (the common case)", () => {
    const scoped = scopeRolesToActiveSchool([
      { code: "ADMIN", schoolId: SCHOOL_A },
      { code: "HEADMASTER", schoolId: SCHOOL_A },
    ]);
    expect(scoped.schoolId).toBe(SCHOOL_A);
    expect(scoped.roles.sort()).toEqual(["ADMIN", "HEADMASTER"]);
  });
});

/**
 * The time window used to live ONLY in a drizzle WHERE clause, which no test could reach: mistyping
 * `gte(endDate, today)` as `gt` would lock out every member of staff whose assignment ends today and
 * leave the whole suite green. These pin both endpoints as INCLUSIVE.
 */
const TODAY = "2026-07-20";
const YESTERDAY = "2026-07-19";
const TOMORROW = "2026-07-21";

describe("isCurrentlyActive — the assignment time window", () => {
  it("grants on the LAST day of service (end_date === today)", () => {
    // The `gte` -> `gt` typo this test exists to catch.
    expect(isCurrentlyActive("2020-01-01", TODAY, TODAY)).toBe(true);
  });

  it("grants on the FIRST day of service (start_date === today)", () => {
    expect(isCurrentlyActive(TODAY, null, TODAY)).toBe(true);
  });

  it("grants a single-day assignment (start === end === today)", () => {
    expect(isCurrentlyActive(TODAY, TODAY, TODAY)).toBe(true);
  });

  it("denies once the assignment has ended (end_date === yesterday)", () => {
    expect(isCurrentlyActive("2020-01-01", YESTERDAY, TODAY)).toBe(false);
  });

  it("denies before the assignment starts (start_date === tomorrow)", () => {
    expect(isCurrentlyActive(TOMORROW, null, TODAY)).toBe(false);
  });

  it("treats an open-ended assignment as active (end_date null)", () => {
    expect(isCurrentlyActive("2020-01-01", null, TODAY)).toBe(true);
  });

  it("treats a row with no dates as active (callers that pre-filter lose nothing)", () => {
    expect(isCurrentlyActive(null, null, TODAY)).toBe(true);
    expect(isCurrentlyActive(undefined, undefined, TODAY)).toBe(true);
  });
});

describe("scopeRolesToActiveSchool — expired assignments never confer a role", () => {
  it("skips an ENDED assignment when picking the active school", () => {
    // The expired HEADMASTER is first, but it must not select the school OR grant the role.
    const scoped = scopeRolesToActiveSchool(
      [
        { code: "HEADMASTER", schoolId: SCHOOL_B, startDate: "2019-01-01", endDate: "2019-12-31" },
        { code: "TEACHER", schoolId: SCHOOL_A, startDate: "2020-01-01", endDate: null },
      ],
      TODAY,
    );
    expect(scoped.schoolId).toBe(SCHOOL_A);
    expect(scoped.roles).toEqual(["TEACHER"]);
    expect(scoped.roles).not.toContain("HEADMASTER");
  });

  it("drops an expired role held at the ACTIVE school", () => {
    const scoped = scopeRolesToActiveSchool(
      [
        { code: "TEACHER", schoolId: SCHOOL_A, startDate: "2020-01-01", endDate: null },
        { code: "ADMIN", schoolId: SCHOOL_A, startDate: "2020-01-01", endDate: YESTERDAY },
      ],
      TODAY,
    );
    expect(scoped.roles).toEqual(["TEACHER"]);
    expect(scoped.roles).not.toContain("ADMIN");
  });

  it("grants nothing when EVERY assignment has ended (ex-staff → no school)", () => {
    const scoped = scopeRolesToActiveSchool(
      [{ code: "ADMIN", schoolId: SCHOOL_A, startDate: "2019-01-01", endDate: YESTERDAY }],
      TODAY,
    );
    expect(scoped.schoolId).toBeUndefined();
    expect(scoped.roles).toEqual([]);
  });
});
