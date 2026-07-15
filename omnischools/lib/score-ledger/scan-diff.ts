/**
 * Path B (scan-and-extract) diff + scale + confidence engine — pure, no DB, no I/O, no React
 * (SHS_SCORE_LEDGER_SPEC Item 4 / INCR-2, Kofi Q1b/Q2/Q3/Q5). Mirrors compute.ts: the same
 * functions drive the client verify UI (flags, low-conf shading) AND the server commit's
 * reason-required validation, so the two can never diverge. Nothing here is a DB trigger.
 *
 * The image never reaches this module — it takes already-extracted numbers + confidences and
 * compares them against the currently-committed senior_score_ledger cell (Q1: diff-against-
 * committed; there is no version/upload table).
 */
import { percent } from "./compute";

// Confidence bands (owner ruling 6 — named + retunable). ≥ FLAG accepted · [FLOOR,FLAG) shown
// but must be reviewed · < FLOOR dropped to blank (never show a possibly-wrong number).
export const LOW_CONF_FLAG = 0.85;
export const LOW_CONF_FLOOR = 0.6;

export type CellBand = "ACCEPTED" | "LOW_CONF" | "BLANK";

export interface BandedCell {
  band: CellBand;
  /** The value to seed the grid with — null when blank OR when a sub-floor guess is dropped. */
  value: number | null;
}

/**
 * Band one extracted cell by its confidence (Kofi Q2 / C1–C3). `value` is the already-scaled
 * 0–100 number (see scaleExtractedCell) or null for a blank read.
 *  - value null                → BLANK (nothing read)
 *  - confidence ≥ 0.85         → ACCEPTED (seed the value, no marker)
 *  - 0.60 ≤ confidence < 0.85  → LOW_CONF (seed the value, must be reviewed before commit)
 *  - confidence < 0.60         → BLANK, value dropped (never surface a sub-floor guess — C3)
 */
export function bandCell(value: number | null, confidence: number): BandedCell {
  if (value == null) return { band: "BLANK", value: null };
  if (confidence >= LOW_CONF_FLAG) return { band: "ACCEPTED", value };
  if (confidence >= LOW_CONF_FLOOR) return { band: "LOW_CONF", value };
  return { band: "BLANK", value: null };
}

/**
 * Scale one raw extracted number to the 0–100 stored scale by its category denominator
 * (Kofi Q1b / A1–A7). Delegates to compute.percent, which already returns null on a blank or
 * non-positive denominator and caps at MAX_PERCENT (999.99) so a pathological read can never
 * overflow numeric(5,2). raw 8 under /10 → 80; raw 72 under /100 → 72; raw blank → null.
 */
export function scaleExtractedCell(raw: number | null, denominator: number): number | null {
  return percent(raw, denominator);
}

// The four diff cases (Kofi Q3 / §7.2) plus the no-change case. Severity maps to the surface
// flag colours: gold = expected/low-stakes, warn = review, terra = highest (gone missing).
export type DiffKind =
  | "UNCHANGED" // committed == extracted, or both blank — no flag
  | "SILENT_ACCEPT" // committed blank → filled at ≥0.85 — commits with no action/reason
  | "REVIEW" // a change that must be acknowledged but needs no reason (score-up / low-conf change / blank→filled low-conf)
  | "SCORE_DOWN" // committed → lower value — must be confirmed WITH a reason
  | "GONE_MISSING"; // committed present → extracted blank — highest severity, never auto-nulled

export interface CellDiff {
  kind: DiffKind;
  /** True when accepting the *extracted* value at this cell requires a reason code (score-down). */
  reasonRequired: boolean;
  /** True when the cell cannot be silently committed — the teacher must act (Kofi Q3). */
  forcesReview: boolean;
  severity: "none" | "gold" | "warn" | "terra";
}

const UNCHANGED: CellDiff = {
  kind: "UNCHANGED",
  reasonRequired: false,
  forcesReview: false,
  severity: "none",
};

/**
 * Classify one cell: the committed 0–100 value vs the banded extracted cell (Kofi Q3 / B1–B9).
 * Low-confidence overrides silent-accept (B6/B7): a blank→filled or any change that is low-conf
 * is forced to REVIEW, never silent. A committed score going to blank is GONE_MISSING and is
 * never auto-nulled (B5).
 */
export function diffCell(committed: number | null, extracted: BandedCell): CellDiff {
  const ev = extracted.value;
  const lowConf = extracted.band === "LOW_CONF";

  if (committed == null) {
    if (ev == null) return UNCHANGED; // both blank
    // blank → filled
    if (lowConf) {
      // B7: not a silent-accept — low-conf forces review.
      return { kind: "REVIEW", reasonRequired: false, forcesReview: true, severity: "warn" };
    }
    // B1: silent-accept.
    return { kind: "SILENT_ACCEPT", reasonRequired: false, forcesReview: false, severity: "gold" };
  }

  // committed present
  if (ev == null) {
    // B5: score went missing — highest severity, never auto-null.
    return { kind: "GONE_MISSING", reasonRequired: false, forcesReview: true, severity: "terra" };
  }
  if (ev === committed) return UNCHANGED; // B2
  if (ev < committed) {
    // B3: score-down — confirm WITH a reason. Compound low-conf (B6) is still a score-down.
    return { kind: "SCORE_DOWN", reasonRequired: true, forcesReview: true, severity: "warn" };
  }
  // ev > committed — score-up. B4: review, NO reason. B6: low-conf still forces review.
  return { kind: "REVIEW", reasonRequired: false, forcesReview: true, severity: "warn" };
}

/**
 * The authoritative server-side check (Kofi Q4 / B8): does committing this FINAL value over the
 * committed value require a reason code? Reason is mandatory ONLY on a score-down and on a
 * Case-D keep-blank (committed → blank). Never on a score-up, a blank→filled, or unchanged.
 * The commit action recomputes this from what the teacher actually submitted — it does not trust
 * a client flag, and it needs no extraction/image to decide.
 */
export function reasonRequiredForCommit(
  committed: number | null,
  final: number | null,
): boolean {
  if (committed == null) return false; // was blank → up/new, never a reason
  if (final == null) return true; // committed → blank = keep-blank / gone-missing (Case D)
  return final < committed; // score-down
}

// ------------------------------------------------------------- roster mapping (Kofi Q5 / D1–D5)

export interface RosterStudent {
  id: string;
  firstName: string;
  lastName: string;
}

/** One extracted row before it is confirmed to a student: the handwritten name the model read,
 * plus its best-guess student id (may be wrong or absent — never trusted for an ambiguous name). */
export interface ExtractedNameRow {
  readName: string;
  studentId?: string | null;
}

export type RowMapping =
  | { status: "mapped"; studentId: string }
  | { status: "ambiguous"; candidateIds: string[] } // >1 roster student fits the name — must confirm
  | { status: "unmapped" }; // no active student fits — map by hand or discard

export interface RosterMappingResult {
  rows: RowMapping[];
  /** Student ids that two or more rows resolved to — a right mark on the wrong student (D4). */
  duplicateStudentIds: string[];
  /** True only when every row maps to exactly one active student and no student is doubled (D5). */
  ok: boolean;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Roster students whose name plausibly fits a handwritten read (last name + first initial). */
function candidatesFor(readName: string, roster: RosterStudent[]): string[] {
  const tokens = norm(readName).split(" ").filter(Boolean);
  if (tokens.length === 0) return [];
  const last = tokens[tokens.length - 1];
  const firstTok = tokens[0];
  const firstInitial = firstTok[0];
  return roster
    .filter((r) => {
      if (norm(r.lastName) !== last) return false;
      const rf = norm(r.firstName);
      // "Akwasi" matches full "akwasi"; "A." (abbreviated) matches on the initial.
      return firstTok.length === 1 ? rf.startsWith(firstInitial) : rf === firstTok;
    })
    .map((r) => r.id);
}

/**
 * Propose a name→student mapping for extracted rows and flag every ambiguity (Kofi Q5 / D1–D5).
 * Never auto-picks an ambiguous name: a read that fits two roster students (e.g. "A. Boateng"
 * with Akwasi AND Abena on the roster) is `ambiguous` and blocks commit until the teacher picks.
 * A read that fits none is `unmapped`. Two rows resolving to the same student is a duplicate.
 * The model's own studentId guess is honoured ONLY when the name is unambiguous.
 */
export function mapRosterRows(
  rows: ExtractedNameRow[],
  roster: RosterStudent[],
): RosterMappingResult {
  const byId = new Set(roster.map((r) => r.id));
  const mapped: RowMapping[] = rows.map((row) => {
    const candidates = candidatesFor(row.readName, roster);
    if (candidates.length === 1) return { status: "mapped", studentId: candidates[0] };
    if (candidates.length > 1) return { status: "ambiguous", candidateIds: candidates };
    // No name match — accept an explicit, in-roster model guess only if it is unambiguous,
    // otherwise leave unmapped for the teacher.
    if (row.studentId && byId.has(row.studentId)) {
      return { status: "mapped", studentId: row.studentId };
    }
    return { status: "unmapped" };
  });

  // D4: two rows → one student.
  const seen = new Map<string, number>();
  for (const m of mapped) {
    if (m.status === "mapped") seen.set(m.studentId, (seen.get(m.studentId) ?? 0) + 1);
  }
  const duplicateStudentIds = Array.from(seen.entries())
    .filter(([, n]) => n > 1)
    .map(([id]) => id);

  const ok =
    mapped.every((m) => m.status === "mapped") && duplicateStudentIds.length === 0;
  return { rows: mapped, duplicateStudentIds, ok };
}
