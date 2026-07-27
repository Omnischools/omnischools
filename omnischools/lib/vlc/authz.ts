/**
 * VLC write authorization (SHS module 4.5) — PURE, DB-free, unit-tested. NOT a "use server" module; the
 * page (for `canEdit`) and every session server action (as the real boundary) both import from here so
 * the write scope cannot drift between the UI and the mutation.
 *
 * The session-register writer diverges from the roster's Dean/Admin write (owner decision d, INCR-42a):
 * the attendance/register writer is the session's-class **Form Master, own-class** — the FM whose user id
 * is the class's `class_teacher_user_id` — with Dean/Admin as a school-wide fallback. "PG-first" is a UI
 * capture-order convention, NOT a write grant: no student or PG writes any 42a table. This mirrors
 * `canAccessHouse` exactly (school-scoped roles reach any unit; else an own-unit id match).
 */
import { hasAnyRole, VLC_CONFIG_WRITE_ROLES } from "@/lib/access";

/**
 * True when the user may WRITE the given class's session register (open it, mark P/L/A). Dean/Admin
 * (`VLC_CONFIG_WRITE_ROLES`) write any class as the school-wide fallback; otherwise the ONLY writer is
 * the class's own Form Master — the user assigned as its `class_teacher_user_id`. A Form Master of a
 * DIFFERENT class, a Headmaster (read-only), a student, a Peer Guide, or any other role is refused.
 */
export function canWriteSession(input: {
  roles: readonly string[];
  userId: string | null | undefined;
  classTeacherUserId: string | null | undefined;
}): boolean {
  if (hasAnyRole(input.roles, VLC_CONFIG_WRITE_ROLES)) return true; // Dean / Admin — school-wide
  return (
    !!input.userId &&
    !!input.classTeacherUserId &&
    input.userId === input.classTeacherUserId // the session's-class Form Master, own-class only
  );
}
