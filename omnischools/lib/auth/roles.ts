import type { AppRole } from "./index";

/**
 * Role scoping — PURE (no db, no env), so the security property is unit-testable.
 *
 * THE BUG THIS FIXES. `getCurrentUser()` used to flatten EVERY role assignment the user holds at ANY
 * school into one `roles` array, and separately pick `schoolId` as `ra[0]?.schoolId` from an unordered
 * query. A user who is TEACHER at school A and ADMIN at school B therefore carried "ADMIN" while
 * operating at school A, passing `requireSchoolRole(...)`/`assertAnyRole(...)` there — enough to read
 * school A's whole-cohort PII and moderate its grades holding only a teacher role at A.
 *
 * It was never a cross-tenant DATA leak (RLS still scoped every row to the active school, and the
 * active school is not attacker-selectable) — it was a privilege ESCALATION WITHIN the active school.
 *
 * THE FIX IS AT THE SOURCE, NOT THE CALL SITES. There are ~129 `hasAnyRole`/`assertAnyRole`/
 * `requireSchoolRole` checks across ~41 files. Threading a school id through all of them would be a
 * huge diff and would leave every future call site able to reintroduce the bug by forgetting it.
 * Instead `AppUser.roles` is now, by construction, ONLY the roles held at the active school — so every
 * existing check becomes correct with zero changes, and so does every check written later.
 *
 * ponytail: "active school" is the earliest still-current assignment. That is deterministic and
 * sensible (your first/home school), but it is NOT a user choice — a genuine multi-school user cannot
 * switch. A school switcher is a real feature (session-pinned selection); this function is where it
 * would plug in. Deliberately not built here: the fix is a security correction, not a feature.
 */

/** One currently-active role assignment, already time-filtered and ordered by the caller. */
export type RoleAssignmentRow = {
  code: string;
  schoolId: string;
};

export type ScopedRoles = {
  /** The active school, or undefined when the user holds no currently-active assignment. */
  schoolId?: string;
  /** ONLY the roles held at `schoolId`. Never a union across schools. */
  roles: AppRole[];
};

/**
 * Pick the active school from the caller's ORDERED assignment list (first row wins) and return only
 * the roles held there. The caller is responsible for having already excluded expired/not-yet-started
 * assignments and for supplying a deterministic order — see `getCurrentUser`.
 *
 * Duplicate role codes at the active school are collapsed, so a user assigned the same role twice
 * (e.g. once per class scope) does not carry it twice.
 */
export function scopeRolesToActiveSchool(assignments: readonly RoleAssignmentRow[]): ScopedRoles {
  const activeSchoolId = assignments[0]?.schoolId;
  if (!activeSchoolId) return { roles: [] };

  const codes = new Set<string>();
  for (const a of assignments) {
    if (a.schoolId === activeSchoolId) codes.add(a.code);
  }
  return { schoolId: activeSchoolId, roles: [...codes] as AppRole[] };
}
