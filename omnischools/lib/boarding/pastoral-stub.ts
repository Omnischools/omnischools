/**
 * STUB — pastoral flags are owned by VLC (module 4.5), which has not shipped. F0 renders the
 * terra "pastoral-flag" bunk state honestly: it lights up only for the seeded demo case and is
 * absent otherwise (Kofi J-note). There is NO working VLC system behind this; the copy on the
 * detail card must not imply one.
 *
 * ponytail: hardcoded stub keyed on the stable demo student_code. Replace this whole module
 * with a join on `vlc_pastoral_flags` (school_id, student_id, active) when module 4.5 lands.
 */

/** Demo student codes with an active pastoral flag. Joseph Manu — the seeded bereavement case. */
const FLAGGED_STUDENT_CODES = new Set<string>(["ASK-24-0118"]);

export function isPastorallyFlagged(studentCode: string | null | undefined): boolean {
  return !!studentCode && FLAGGED_STUDENT_CODES.has(studentCode);
}
