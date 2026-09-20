/**
 * Parent-portal claiming rules (SHS module 4.3 / INCR-19a) — the PURE app-layer invariants, with NO
 * DB import so they unit-test in claim.test.ts. The DB-touching seam lives in ./parent-data.
 *
 * The claiming flow is a school-issued, PER-CHILD invite (owner decision 2026-07-20): staff pick a
 * `student_guardian` row → invite; the guardian opens the token and the OTP/claim destination is the
 * guardian's STORED phone, never a number typed into the request. See lib/actions/invites.ts.
 */
export const PARENT_ROLE = "PARENT";

/** True when a role code is the parent-portal role (case-insensitive; the UI may send "PARENT"). */
export function isParentRole(role: string): boolean {
  return role.trim().toUpperCase() === PARENT_ROLE;
}

/**
 * AC C1 — a PARENT invite MUST name the child (`student_id`) AND identify the exact `student_guardian`
 * row it is for. Returns an error message, or null when the parent invite is well-formed. A no-op for
 * staff/teacher invites (role ≠ PARENT), which carry no student.
 */
export function parentInviteError(
  role: string,
  studentId: string | null | undefined,
  guardianId: string | null | undefined,
): string | null {
  if (!isParentRole(role)) return null;
  if (!studentId) return "A parent invite must name the student it is for.";
  if (!guardianId) return "Choose which guardian to invite to the portal.";
  return null;
}
