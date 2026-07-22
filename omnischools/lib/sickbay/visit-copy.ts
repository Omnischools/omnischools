/**
 * The visit record's STATIC editorial — PURE, DB-free, and character-compared against
 * `Surfaces/schoolup-sickbay-visit-record.html` in visit-copy.test.ts (AC O4, the INCR-21 method:
 * `===`, never a regex). The components hold no copy of their own, so a surface-fidelity regression
 * is a failing test rather than a screenshot someone has to notice.
 *
 * The OMITTED register at the bottom is the other half of the same guarantee (AC O1–O3): each string
 * is asserted to appear NOWHERE in the shipped source. Omit-not-fake means no shell, no badge, no
 * zero and no anchor target — not "rendered but hidden".
 */

/** §01 status strip — the four `.st-lbl` tiles, surface order. */
export const STATUS_TILE_LABELS = [
  "Disposition",
  "Time on ward",
  "Pain · current",
  "Expected discharge",
] as const;

/** §01 status tile 4's `.st-sub`. */
export const EXPECTED_DISCHARGE_SUB = "if criteria met";

/** §01 vitals table `th`s, surface order. */
export const VITALS_COLUMNS = ["Time", "Temp", "BP", "HR", "SpO₂", "Pain", "Taken by"] as const;

/** §01 complaint block `.cb-lbl`. */
export const COMPLAINT_LABEL = "Presenting complaint · as recorded";

/**
 * §02 assessment `.ar-lbl`s. The surface draws SIX; the last (`Recorded by`) is DERIVED — it renders
 * as the card's meta line (actor + N&MC number), not as a stored row, and its trailing per-case
 * clause ("within scope of practice for first-line vaso-occlusive management") is trimmed as
 * editorial that merely restates the impression.
 */
export const ASSESSMENT_ROW_LABELS = [
  "Working impression",
  "Red flags screened",
  "Hydration status",
  "Plan",
  "Escalation triggers",
] as const;

/** §04 `.dc-eyebrow` + the three `.f-lbl`s the 0057 columns can actually back. */
export const DISPOSITION_EYEBROW = "Current disposition";
export const DISPOSITION_FIELD_LABELS = [
  "Admitted",
  "Target discharge",
  "Fallback overnight plan",
] as const;

/**
 * §04 `.cluster-note`, TRIMMED at 22 (Lucy §V4.5). The two removed clauses — "on the Matron's task
 * list" (a task list, INCR-26) and "with the parent re-notified" (the Tier-2 chain, INCR-26) —
 * restore verbatim at 26. `No silent overnight stays.` is the encodable half and it stays.
 */
export const CLUSTER_NOTE_TAIL = "No silent overnight stays.";

/**
 * R65 — the ONE honest attendance line in the §04 disposition card (INCR-22b), and the only place the
 * R52/R53 skip warning renders. AUTHORED copy (Lucy Q12), derived on every render from the stored
 * attendance row rather than from a flag written at admit time, so it cannot drift from the truth.
 *
 * It names a **DAY**, never periods: `uniq_attendance_student_day` means per-period attendance does
 * not exist (R30), and the surface's `5 periods · all classes` is a claim the schema cannot back. It
 * carries no clinical content — it is read beside a patient's name.
 */
export function attendanceLine(a: {
  /** `Wed 14 May` — the civil day the disposition was recorded. */
  dayLabel: string;
  /** The stored status' label (`Medical`, `Absent`, …), or null when there is no row for that day. */
  markedLabel: string | null;
  /** Why no row exists, in the caller's words (`Y. Aidoo has no class assigned`). */
  skipReason: string | null;
}): string {
  if (a.markedLabel === "Medical") {
    return `Attendance · ${a.dayLabel} is marked Medical for the whole day. Class teachers see M, not A — no medical detail leaves this module.`;
  }
  if (a.markedLabel) {
    return `Attendance · ${a.dayLabel} reads ${a.markedLabel} — changed since the sickbay marked it.`;
  }
  return `Attendance · ${a.dayLabel} was not marked${
    a.skipReason ? ` — ${a.skipReason}` : ""
  }. The visit record is unaffected.`;
}

/**
 * 🔒 OMITTED AT INCR-22a — asserted absent from the shipped source (AC O1–O3). Each carries the
 * increment that earns it back. Nothing here is placeholdered: no `0/0`, no `—`, no greyed row, no
 * disabled control standing in for a capability the school does not have.
 */
export const OMITTED_AT_22A: readonly { text: string; why: string }[] = [
  { text: "Sickle cell · HbSS", why: "chronic register → INCR-23; and it is adjacency leak A1/A3" },
  { text: "Sickle cell pain crisis protocol", why: "SCD banner → INCR-23 (leaks by name AND by drug, A4)" },
  { text: "hydroxyurea", why: "A4 — the drug re-identifies the condition even without naming it" },
  { text: "View care plan", why: "no target until INCR-23" },
  { text: "No chronic flag", why: "a false NEGATIVE — asserts safety about a register that does not exist yet" },
  { text: "NHIS · active", why: "no field; owner D3's shape is ruled at INCR-25" },
  { text: "bed S-12-B", why: "B1 — boarding_bunk has no upper/lower axis; never conflate it with a sickbay bed" },
  { text: "3 of 4 met", why: "the structured criteria checklist needs per-condition templates → INCR-23" },
  { text: "Print summary", why: "no print artefact" },
  { text: "Print day sheet", why: "no print artefact — and it carries every complaint string out of the room (A6)" },
  { text: "Add note", why: "no note entity — the assessment card IS the note" },
  { text: "refresh 15s", why: "polls nothing" },
  { text: "Routine", why: "R62 — a hardcoded pill is an unassessed clinical-urgency assertion" },
  { text: "auto-applied to roll-call", why: "prep_attendance is not written at 22" },
  {
    text: "Referral note",
    why: "no column stores it — sickbay_visit has none, and a box whose text survives only in audit_log.after_state is a control that appears to record and does not. R34 already requires working_impression for a REFER; the referral EVENT (and any note on it) is INCR-25",
  },
];
