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

/**
 * 🔴 INCR-42b — the CONFIDENTIAL pastoral-flag access gate (READ === WRITE, owner-locked b+c). PURE,
 * DB-free, unit-tested. THE INCREMENT'S ENTIRE SECURITY VALUE lives here: it is
 *
 *     DEAN_OF_STUDENTS ∈ roles  (school-wide pastoral authority)
 *   OR  caller IS the flagged student's class's OWN Form Master  (userId === classTeacherUserId)
 *
 * The FM arm is an IDENTITY match, NEVER `roles.includes("FORM_MASTER")`. A bare FORM_MASTER role check
 * would let EVERY form master read EVERY class's confidential flags — the exact IDOR this table exists to
 * prevent. `classTeacherUserId` is the flagged student's class teacher, loaded server-side (un-spoofable),
 * so an other-class FM, an ADMIN, a HEADMASTER, a Peer Guide, a student, and a parent are all refused.
 *
 * This mirrors `canWriteSession` (the 42a own-class identity match, Sarah-CLEARED) but ADDS the school-wide
 * Dean arm (the Dean reaches any class's flags; the FM only their own). The role gate VLC_PASTORAL_*_ROLES
 * = [FORM_MASTER, DEAN] is applied at the reader/action entry (who may reach the boundary); this function
 * is the own-class narrowing inside it.
 */
export function canAccessPastoralFlag(input: {
  roles: readonly string[];
  userId: string | null | undefined;
  classTeacherUserId: string | null | undefined;
}): boolean {
  if (input.roles.includes("DEAN_OF_STUDENTS")) return true; // school-wide pastoral authority
  return (
    !!input.userId &&
    !!input.classTeacherUserId &&
    input.userId === input.classTeacherUserId // the flagged student's class's OWN Form Master (identity)
  );
}

/**
 * The pastoral WRITE gate (create + resolve). Owner-locked to the SAME set as read (b+c), so it is exactly
 * `canAccessPastoralFlag`; aliased (not re-implemented) so the read and write scopes can never drift. Both
 * the page `canEdit` and BOTH server actions re-check it (the action is the real boundary).
 */
export const canWritePastoralFlag = canAccessPastoralFlag;
