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

/**
 * The two period/class label helpers live in the Item 8 pure module (the earlier shared code) so
 * the Trap-1 fix ("S2", never "T2"/"Term") has ONE definition across both printed artifacts;
 * re-exported here for this module's consumers (the builder, the PDF doc, and the test).
 */
export { semLabel, yearLabel } from "./stpshs-sheet";

/** A pre-printed roster row on the blank book — name ONLY, zero score fields (the book is blank). */
export type BookRow = { name: string };

/**
 * Assemble the pre-printed roster rows from the ACTIVE roster — one row per student, name only.
 * No score columns exist (AC B2/B5): the five-category grid is filled on paper, never by us.
 */
export function assembleBookRows(roster: { firstName: string; lastName: string }[]): BookRow[] {
  return roster.map((r) => ({ name: `${r.firstName} ${r.lastName}` }));
}
