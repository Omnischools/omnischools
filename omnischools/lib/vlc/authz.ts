/**
 * VLC write authorization (SHS module 4.5) — PURE, DB-free, unit-tested. NOT a "use server" module; the
 * page (for `canEdit`) and every session server action (as the real boundary) both import from here so
 * the write scope cannot drift between the UI and the mutation.
 *
 * Owner decision (d), INCR-42a: the session-register writer is the session's-class **Form Master,
 * own-class ONLY** — the user whose id is the class's `class_teacher_user_id`. There is NO Dean/Admin/HM
 * school-wide write in 42a ("no break-glass co-writer; loosening later is safe" — owner). Dean/Admin/HM
 * still READ via VLC_CONFIG_READ_ROLES. "PG-first" is a UI capture-order convention, NOT a write grant:
 * no student or Peer Guide writes any 42a table.
 */

/**
 * True when the user may WRITE the given class's session register (open it, mark P/L/A): ONLY the class's
 * own Form Master — the user assigned as its `class_teacher_user_id`. A Form Master of a DIFFERENT class,
 * a Dean of Students, an Admin, a Headmaster (read-only), a student, or a Peer Guide is refused.
 *
 * `roles` is accepted but unused today: the owner anticipated a later break-glass widen (a Dean/Admin
 * co-writer), so keeping it on the signature makes that a one-line change here without re-threading
 * every caller. Until then, write is purely the own-class identity match.
 */
export function canWriteSession(input: {
  roles: readonly string[];
  userId: string | null | undefined;
  classTeacherUserId: string | null | undefined;
}): boolean {
  return (
    !!input.userId &&
    !!input.classTeacherUserId &&
    input.userId === input.classTeacherUserId // the session's-class Form Master, own-class only
  );
}
