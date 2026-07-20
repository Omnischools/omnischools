import { describe, it, expect } from "vitest";
import { scopeRolesToActiveSchool } from "./roles";

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
