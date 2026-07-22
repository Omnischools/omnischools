/**
 * The TODAY BOARD's copy and its derived strings — PURE, DB-free, unit-tested (board-copy.test.ts).
 * SHS module 4.4 / INCR-22c. Character-compared against `Surfaces/schoolup-sickbay-today.html`
 * (AC O, the INCR-21 method: `===`, never a regex), and the OMITTED register at the bottom is the
 * other half of the same guarantee — each string is asserted to appear NOWHERE in the shipped board.
 *
 * 🔴 R90 — THE SURFACE'S OWN NUMBERS AND WEEKDAY ARE WRONG. Tile 3's `5 · 3 discharged · 1 admitted
 * · 1 awaiting` contradicts §03's own table AND excludes the three students standing in its own
 * queue (the honest value is 8 = 4 discharged · 1 admitted · 3 awaiting), and `Wed 14 May 2026` is a
 * THURSDAY. Every number on the board is DERIVED, the h1 date is formatted from the pinned `now`,
 * and neither the tally nor the weekday appears as an expected value in any fixture here — a
 * character-exact method that enshrined them would ship the defect it exists to prevent.
 *
 * 🔴 The board prints NO clinical assertion (R87 · Lucy A1/A12/A13). The one named exception is the
 * live queue's presenting complaint (A6, triage necessity) and it is a value, never copy — so there
 * is no clinical vocabulary in this file at all.
 */
import { civilDate } from "./visits";

// ============================================================================
// The frozen key-sets (R70 guard 1). TS interfaces ERASE at runtime; the object the reader
// returns does not. `Object.keys(row).sort()` is asserted against these live, over real rows, in
// `scripts/verify-sickbay-board.ts` — so a "helpful" extra column fails a check instead of shipping.
// ============================================================================

export const BOARD_ROW_KEYS = {
  queue: [
    "complaint",
    "formLabel",
    "houseName",
    "presentedAt",
    "studentCode",
    "studentName",
    "visitId",
  ],
  /** 🔴 R87 — NO `workingImpression`, NO `hydrationStatus`, NO `plan`. Not selected, not returned. */
  ward: [
    "admissionId",
    "admittedAt",
    "admittedByName",
    "bedNumber",
    "expectedDischargeAt",
    "firstPainScore",
    "formLabel",
    "houseName",
    "isIsolation",
    "latestVital",
    "studentCode",
    "studentName",
    "visitId",
  ],
  latestVital: [
    "diastolic",
    "painScore",
    "pulseBpm",
    "spo2Pct",
    "systolic",
    "takenAt",
    "tempC",
  ],
  bed: ["bedNumber", "isIsolation", "occupant"],
  bedOccupant: ["admittedAt", "formLabel", "houseName", "studentName"],
  /** No field to put a complaint in — the A12 leak cannot be reintroduced without a type error. */
  recent: [
    "disposition",
    "dispositionAt",
    "formLabel",
    "houseName",
    "presentedAt",
    "studentName",
    "visitId",
  ],
} as const;

// ============================================================================
// Time formatting — every wall-clock derivation takes the PINNED `now` as an argument (R68).
// Nothing in this file, or in anything it is called from, reads the clock itself.
// ============================================================================

/** Accra is UTC+0 all year, so the UTC clock IS the wall clock (the repo-wide idiom). */
export const hhmm = (d: Date): string =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

const DATE_LONG = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const DATE_SHORT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/**
 * The h1's date — `Thu 14 May 2026`, DERIVED from the pinned `now` (R90 · Lucy F7). en-GB emits
 * `Thu, 14 May 2026`; the comma is dropped to match the surface's own punctuation. The WEEKDAY is
 * never hardcoded: the surface asserts Wednesday for a date that is a Thursday.
 */
export const boardDate = (now: Date): string => DATE_LONG.format(now).replace(",", "");

/** `14 May` — the day a stamp fell on, when it was not today. */
export const shortDate = (d: Date): string => DATE_SHORT.format(d).replace(",", "");

/** §03's `.v-day`: the 24-hour window makes a third value impossible. */
export const dayLabel = (at: Date, now: Date): "Today" | "Yesterday" =>
  civilDate(at) === civilDate(now) ? "Today" : "Yesterday";

/** `09:14 today` / `09:14 14 May` — the admitted block's `.ab-meta` stamp. */
export const stampLabel = (at: Date, now: Date): string =>
  `${hhmm(at)} ${civilDate(at) === civilDate(now) ? "today" : shortDate(at)}`;

// ============================================================================
// §01 — the derived strings. `**bold**` fragments render through the shipped `splitBold()`.
// ============================================================================

/**
 * The lede, TRIMMED (Z3: the referral and cluster clauses advertise affordances that do not exist
 * until INCR-25/27). A zero clause is DROPPED, never rendered as `0`; all three zero renders the
 * authored quiet-day sentence. `admitted: null` is Mode C, where the clause is not "0" — it is not
 * a fact about a school with no beds.
 */
export function boardLede(c: {
  admitted: number | null;
  queued: number;
  visitsToday: number;
}): string {
  const parts: string[] = [];
  if (c.admitted) parts.push(`**${c.admitted} admitted**`);
  if (c.queued) parts.push(`**${c.queued} in queue**`);
  if (c.visitsToday) parts.push(`**${c.visitsToday} visits** today`);
  return parts.length ? parts.join(" · ") : QUIET_DAY;
}

/**
 * Live tile 1's meta — Lucy A2, the one-name rule. ONE admission prints the name and the bed; MORE
 * than one prints a COUNT and no names at all, because a list of admitted students on a
 * shoulder-surfed bench screen is a roll-call of who is unwell. Zero prints no meta line.
 * The condition never appears in any branch.
 */
export function admittedTileMeta(
  patients: readonly { shortName: string; bedNumber: number }[],
): string | null {
  if (patients.length === 0) return null;
  if (patients.length === 1) {
    return `**${patients[0].shortName}** · bed ${patients[0].bedNumber}`;
  }
  return `${patients.length} on the ward`;
}

/**
 * Live tile 2's meta. An EMPTY queue renders NO meta at all — `avg wait 0 min` asserts a measured
 * wait for a patient who does not exist (the false-zero shape).
 */
export function queueWaitMeta(waitsMs: readonly number[]): string | null {
  if (waitsMs.length === 0) return null;
  const mins = waitsMs.map((ms) => Math.floor(Math.max(0, ms) / 60_000));
  const avg = Math.floor(mins.reduce((a, b) => a + b, 0) / mins.length);
  return `avg wait **${avg} min** · oldest ${Math.max(...mins)} min`;
}

/**
 * The tile-3 breakdown and §03's head counts. 🔴 R74 PARTITION INVARIANT: the terms SUM to the
 * total, which is exactly what the surface's own tally violates (F5/R90). Zero terms are dropped;
 * all-zero renders nothing.
 */
export function visitBreakdown(
  c: { discharged: number; admitted: number; referred: number; open: number },
  openWord: "awaiting" | "open" = "awaiting",
): string | null {
  const parts: string[] = [];
  if (c.discharged) parts.push(`${c.discharged} discharged`);
  if (c.admitted) parts.push(`${c.admitted} admitted`);
  if (c.referred) parts.push(`${c.referred} referred`);
  if (c.open) parts.push(`${c.open} ${openWord}`);
  return parts.length ? parts.join(" · ") : null;
}

/** `1 / 8 · 7 empty`. With ZERO active beds the caller renders the setup link instead — never `0 / 0`. */
export const bedOccupancyMeta = (occupied: number, total: number): string =>
  `${occupied} / ${total} · ${total - occupied} empty`;

/** `Bed 03` — zero-padded at RENDER only; the stored number is the identity (R8). */
export const bedLabel = (bedNumber: number): string =>
  `Bed ${String(bedNumber).padStart(2, "0")}`;

/**
 * The admitted block's name line: `Adwoa Mensa · admitted bed 3` (+ ` · isolation`, AUTHORED — the
 * surface never draws an occupied isolation bed). The component prints the surname in an `<em>`, so
 * it renders the suffix beside its own two spans; the joined form is what the copy test compares.
 */
export const admittedBedSuffix = (bedNumber: number, isIsolation: boolean): string =>
  ` · admitted bed ${bedNumber}${isIsolation ? " · isolation" : ""}`;
export const admittedName = (
  fullName: string,
  bedNumber: number,
  isIsolation: boolean,
): string => `${fullName}${admittedBedSuffix(bedNumber, isIsolation)}`;

/**
 * The admitted block's meta line. Identity + LOCATION + duration — tiers 1 and 2 of the disclosure
 * ladder and nothing above them. The House clause drops for a day student; the `by {actor}` clause
 * drops when the pointer is dangling. `Adm. #…`'s `#` is demo chrome, not data (F2).
 */
export function admittedMeta(p: {
  formLabel: string;
  houseName: string | null;
  studentCode: string;
  admittedStamp: string;
  admittedByName: string | null;
  elapsed: string;
}): string {
  const parts = [p.formLabel];
  if (p.houseName) parts.push(`**${p.houseName} House**`);
  parts.push(`Adm. ${p.studentCode}`);
  parts.push(
    `admitted **${p.admittedStamp}**${p.admittedByName ? ` by ${p.admittedByName}` : ""}`,
  );
  parts.push(`${p.elapsed} on bed`);
  return parts.join(" · ");
}

/** The queue / §03 student meta: `F2 SCI · **Aggrey House** · #…` — code verbatim, no added `#` (F2). */
export function studentMeta(
  formLabel: string,
  houseName: string | null,
  studentCode: string | null,
  houseWord: boolean,
): string {
  const parts = [formLabel];
  if (houseName) parts.push(`**${houseName}${houseWord ? " House" : ""}**`);
  if (studentCode) parts.push(studentCode);
  return parts.join(" · ");
}

// ============================================================================
// §03 — the 24-hour log
// ============================================================================

export type PillTone = "discharge" | "admit" | "refer" | "open";

/**
 * R77 — `ON_WARD_DISCHARGED` still reads `Admitted`: the disposition is IMMUTABLE (R36) and the bed
 * board 200px above answers "still on a bed" authoritatively. An undisposed visit reads the
 * AUTHORED neutral `Open` — without it an IN_PROGRESS visit appears nowhere on the board at all.
 */
export function dispositionPill(
  disposition: "DISCHARGE" | "ADMIT" | "REFER" | null,
  dispositionAt: Date | null,
): { label: string; tone: PillTone } {
  switch (disposition) {
    case "DISCHARGE":
      return {
        label: dispositionAt ? `Discharged ${hhmm(dispositionAt)}` : "Discharged",
        tone: "discharge",
      };
    case "ADMIT":
      return { label: "Admitted", tone: "admit" };
    case "REFER":
      return { label: "Referred", tone: "refer" };
    default:
      return { label: "Open", tone: "open" };
  }
}

/** §03's derived head count line. Null at zero — the empty-state line renders instead. */
export function recentLede(c: {
  total: number;
  discharged: number;
  admitted: number;
  referred: number;
  open: number;
}): string | null {
  if (c.total === 0) return null;
  const rest = visitBreakdown(c, "open");
  return `**${c.total} visits** in last 24 hours${rest ? ` · ${rest}` : ""}`;
}

/**
 * R75b — the shipped open-visit collision error, ENRICHED. Until 22c there was no board, so
 * "this student already has an open visit" left the matron with nowhere to go looking. It now names
 * the day in the R11 grammar; the caller returns the visit id beside it so the form can link it.
 */
export function openVisitCollisionError(presentedAt: Date, now: Date): string {
  return (
    "This student already has an open sickbay visit — opened " +
    `${stampLabel(presentedAt, now)}. Open that visit to close or void it first.`
  );
}

// ============================================================================
// Static copy — compared `===` against the surface (AC O)
// ============================================================================

/** The h1: `Today's <em>sickbay</em> · {derived date}`. The date is NEVER part of the fixture. */
export const H1_LEAD = "Today's ";
export const H1_EM = "sickbay";

/** The three live tiles that survive. `Active referrals` (25) and `Cluster watch` (27) are OMITTED. */
export const LIVE_TILE_LABELS = ["Admitted now", "In queue", "Visits today"] as const;

/** `.ab-vitals` ×5 — the VISIT RECORD's vocabulary wins (`Pulse`→`HR`, `Pain score`→`Pain`). */
export const WARD_VITAL_LABELS = ["Temp", "BP", "HR", "SpO₂", "Pain"] as const;

export const ADMITTED_TAG = "Admitted";
export const QUEUE_CARD_TITLE = "Queue · ";
export const QUEUE_CARD_EM = "waiting now";
export const BEDS_CARD_TITLE = "Beds · ";
export const BEDS_CARD_EM = "occupancy";
export const BED_EMPTY_STATE = "Empty";
export const ISO_TAG = "Iso";
export const LOG_CARD_EM = "visits";
export const LOG_CARD_TAIL = " · chronological";
export const LOG_HEAD_NOTE =
  "Most recent at top · click any row to open the full visit record";

// ── AUTHORED (owner sign-off E10 / Lucy Q8) ─────────────────────────────────
export const QUIET_DAY = "A quiet day so far — no visits recorded yet.";
export const EMPTY_QUEUE = "No one waiting.";
export const EMPTY_LOG = "No visits in the last 24 hours.";
export const NO_BEDS = "No beds configured — add capacity in **Sickbay setup**.";
export const NO_READINGS = "No readings yet.";
export const EXPECTED_DISCHARGE = "Expected discharge";
export const REASSESSMENT_OVERDUE = "reassessment overdue";
export const OPEN_RECORD = "Open record →";
/** R89 — the R25 distinction, shown to every reader and orthogonal to the mode. */
export const NOT_CONFIGURED =
  "Sickbay not set up yet — declare your school's mode in **Sickbay setup**.";
/** The honesty marker in place of the surface's pulsing dot beside a frozen server timestamp. */
export const asOf = (now: Date): string => `as of ${hhmm(now)} GMT`;

/**
 * 🔒 OMITTED AT INCR-22c — asserted absent from every shipped board file (AC O). Nothing here is
 * placeholdered: no shell, no badge, no disabled control, no `0 / 0`, no `—` standing in for an
 * unrecorded clinical value.
 *
 * ⚠️ R76 is the ruling most likely to be "helpfully" reverted by a future implementer who sees an
 * empty-looking log: §03's complaint fragment is gone because A11 is the threat model — the reader
 * gate decides who logs in, not who is standing behind the matron at a bench-side screen.
 */
export const OMITTED_AT_22C: readonly { text: string; why: string }[] = [
  { text: "Active referrals", why: "no referral artefact → INCR-25 (Z1)" },
  { text: "Cluster watch", why: "no surveillance table → INCR-27 (Z2)" },
  {
    text: "URTI",
    why: "a condition name on the landing page; the tile itself is INCR-27",
  },
  {
    text: "active referral",
    why: "the lede clause advertises an absent affordance (Z3)",
  },
  {
    text: "Housemaster awareness",
    why: "no notification row — 'notified' asserts an unsent message (Z4)",
  },
  { text: "Sickle cell SS", why: "A3 — condition beside a name, above the fold" },
  {
    text: "SCD",
    why: "A1 — the map's central ruling: the bed tile prints a duration, never a condition",
  },
  {
    text: "hydroxyurea",
    why: "A4 — the drug re-identifies the condition without naming it",
  },
  {
    text: "Hydration started",
    why: "A13 — the .ab-line narrative comes OFF the board entirely (R87)",
  },
  {
    text: "No chronic flag",
    why: "R61 — a false NEGATIVE: asserts safety per a register that does not exist",
  },
  {
    text: "Routine",
    why: "R62 — a hardcoded pill is an unassessed clinical-urgency assertion",
  },
  { text: "refresh 15s", why: "F11 — a polling promise nothing implements" },
  {
    text: "Print day sheet",
    why: "no print artefact, and it carries every complaint out of the room (A6)",
  },
  {
    text: "Export day report",
    why: "same — an export carries every row out of the gate",
  },
  {
    text: "Filter by house",
    why: "6 rows need no filter, and it prototypes the HM boundary R41 defers to 28",
  },
  {
    text: "Admit patient",
    why: "R83 — an admission is a DISPOSITION of an open visit; omit-not-fake covers affordances",
  },
];
// The demo sidebar's `Visit records` sub-item is NOT in this register: the app nav is flat and the
// sub-nav is simply not built (the row count is unchanged, R84), and the phrase legitimately occurs
// in the ADMIN restriction panel's prose. A sweep for it would fail on that sentence.
