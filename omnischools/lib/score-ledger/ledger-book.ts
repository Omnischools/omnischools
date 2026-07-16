/**
 * Pure ledger-book logic — no DB, no I/O (INCR-5 · Score Ledger Item 6). The Omnischools blank
 * paper book carries NO scores, so this holds only the two label helpers, the spare-row count and
 * the roster→row assembly. Side-effect-free so it drives the server data builder
 * (lib/data/ledger-book-data) and the PDF document, and stays directly unit-testable. This is the
 * shape of lib/score-ledger/stpshs-sheet.ts MINUS every de-scale / cap / gate concern — the book
 * is blank (AC B5), so there is nothing to compute.
 */

/**
 * ~4 blank UNLABELED handwriting rows appended after the roster on the final page (AC §I,
 * owner-adopted). Slack for hand-adding late-enrolled students without a reprint — they are NOT
 * students and are excluded from the active count (A1) and the audit payload (I2).
 */
export const SPARE_ROWS = 4;

/** "Semester 2" → "S2" (Trap 1 / AC C2 — SHS is semesters; NEVER print "T2"/"Term", even if a
 * stray label read "Term"). Reused from the Item 8 helper so the domain fix is identical. */
export function semLabel(periodLabel: string): string {
  const m = periodLabel.match(/(\d)/);
  return m ? `S${m[1]}` : periodLabel;
}

/** "Form 2 Science" → "Y2"; falls back to the class name when it carries no form digit. */
export function yearLabel(className: string): string {
  const m = className.match(/(\d)/);
  return m ? `Y${m[1]}` : className;
}

/** A pre-printed roster row on the blank book — name ONLY, zero score fields (the book is blank). */
export type BookRow = { name: string };

/**
 * Assemble the pre-printed roster rows from the ACTIVE roster — one row per student, name only.
 * No score columns exist (AC B2/B5): the five-category grid is filled on paper, never by us.
 */
export function assembleBookRows(roster: { firstName: string; lastName: string }[]): BookRow[] {
  return roster.map((r) => ({ name: `${r.firstName} ${r.lastName}` }));
}
