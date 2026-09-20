/**
 * PURE MAR shaping (SHS module 4.4 / INCR-24b) — the witness/override decision, the source↔pointer
 * decision, the derived round status, and the append-only amendment arrangement. No DB import, so it is
 * unit-tested without a database and shared safely by the server readers (med-admin-reads.ts) and the
 * client consoles (rounds / mar-log): the client imports these TYPES and formatters, never a `*-reads`
 * module (repo memory `reports-data-is-server-only`).
 *
 * 🔴 The MAR carries `student_id` for the clinical/rounds path — but NONE of it reaches §3 (R162): the
 * §3 controlled register is derived in stock-reads.ts with the patient column deliberately never in its
 * projection. These view types are the clinical surfaces' (rounds / visit MAR), where a drug beside a
 * name is the record itself (R164).
 */

export type MedSource = "CHRONIC" | "STANDING_ORDER" | "DOCTOR_ORDERED" | "AD_HOC";
export type MedStatus = "GIVEN" | "REFUSED" | "HELD" | "OMITTED";

// ============================================================================
// 🔴 R174 (D5.3 crux) — the witness/override DECISION, pure so it has a committed tripwire.
// ============================================================================

export type MedAdminWitnessError = "MISSING_WITNESS_OR_OVERRIDE" | "SELF_WITNESS";

/**
 * 🔴 R174/D5.3 — the controlled-GIVEN witness rule, the accountability that justifies the whole
 * controlled layer, extracted PURE (the `controlledMovementWitnessError` sibling in stock.ts, and the
 * 24a MINOR-2 lesson: a source-shape-only authz suite left a `&& false` mutation green). This is the
 * part a unit test pins and a mutation must red.
 *
 *   • A CONTROLLED dose recorded as GIVEN reaches the MAR ONLY with a witness OR a documented override
 *     reason — never silently (the DB CHECK `med_admin_controlled_given_witness` is the backstop).
 *   • No one witnesses themselves: a witness equal to the administering actor is refused, for ANY row
 *     (the DB CHECK `med_admin_witness_not_self` is the backstop).
 *
 * The witness IDENTITY (a real in-school N&MC clinician ≠ actor) is DB-backed (`assertSchoolClinician`,
 * verified live) and stays in the action; this fn decides only the require + self-witness shape.
 */
export function medAdminWitnessError(x: {
  isControlled: boolean;
  status: MedStatus;
  witnessId: string | null;
  overrideReason: string | null;
  actorId: string | null;
}): MedAdminWitnessError | null {
  const controlledGiven = x.isControlled && x.status === "GIVEN";
  if (controlledGiven && !x.witnessId && !x.overrideReason) return "MISSING_WITNESS_OR_OVERRIDE";
  if (x.witnessId && x.actorId && x.witnessId === x.actorId) return "SELF_WITNESS";
  return null;
}

/**
 * R171 — the source↔pointer contract, mirroring the DB `med_admin_source_pointer_match` CHECK so the app
 * refuses a mismatch FIRST with a clear message. Returns true when the pointer set is invalid for the
 * source. CHRONIC's `chronic_med_id` is OPTIONAL (R163 patient-own-bottle); the other three forbid it.
 */
export function sourcePointerMismatch(
  source: MedSource,
  p: { chronicMedId: string | null; standingOrderId: string | null; consultId: string | null },
): boolean {
  switch (source) {
    case "CHRONIC":
      return p.standingOrderId !== null || p.consultId !== null;
    case "STANDING_ORDER":
      return p.standingOrderId === null || p.chronicMedId !== null || p.consultId !== null;
    case "DOCTOR_ORDERED":
      return p.consultId === null || p.chronicMedId !== null || p.standingOrderId !== null;
    case "AD_HOC":
      return p.chronicMedId !== null || p.standingOrderId !== null || p.consultId !== null;
  }
}

// ============================================================================
// R175 — the derived round status (OVERDUE derived at READ; nothing auto-writes OMITTED)
// ============================================================================

/** DONE = all due doses terminal · DUE/PENDING = window not yet passed · OVERDUE = window passed, ≥1
 *  open · NONE_DUE = nothing scheduled this weekday (a legitimate state, never `—`, never an error). */
export type RoundStatus = "DONE" | "DUE" | "OVERDUE" | "PENDING" | "NONE_DUE";

/**
 * R175 — a single round's status from three derived facts. `DUE` vs `PENDING` (which future round is
 * "due next") is decided by the READER over the anchor-first-ordered list, so this returns the neutral
 * `OPEN_FUTURE`; overdue is derived HERE at read time (no scheduler, nothing auto-writes OMITTED).
 */
export function roundStatusOf(x: {
  hasAnyDue: boolean;
  openCount: number;
  nowPastStart: boolean;
}): "DONE" | "OVERDUE" | "OPEN_FUTURE" | "NONE_DUE" {
  if (!x.hasAnyDue) return "NONE_DUE";
  if (x.openCount === 0) return "DONE";
  return x.nowPastStart ? "OVERDUE" : "OPEN_FUTURE";
}

/** "HH:MM" → minutes since midnight, for the nowPastStart comparison (Ghana is UTC+0, civil = UTC). */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// ============================================================================
// R176 — the append-only amendment arrangement (a correction renders after its byte-unchanged original)
// ============================================================================

/** One MAR row, pre-formatted for a client surface — never a DB row (R120). NO raw actor ids. */
export interface MarRowView {
  id: string;
  administeredAtISO: string;
  administeredAtHHMM: string;
  drugName: string;
  doseLabel: string;
  route: string | null;
  source: MedSource;
  /** For a STANDING_ORDER tag ("Standing · {complaint}") — null otherwise. */
  standingComplaint: string | null;
  /** For a DOCTOR_ORDERED row — the consult id the tag hyperlinks (attribution, never a gate). */
  consultId: string | null;
  status: MedStatus;
  isControlled: boolean;
  administeredByName: string | null;
  witnessName: string | null;
  witnessOverrideReason: string | null;
  notes: string | null;
  /** The row this one corrects (R146) — the amendment back-reference. */
  correctsAdminId: string | null;
  amendmentNote: string | null;
  /** True when a LATER row corrects THIS one — the original gets the `amended ↓` chip. */
  amended: boolean;
}

/**
 * R176 — arrange the MAR so every correcting row renders IMMEDIATELY AFTER the byte-unchanged original it
 * amends (chains render each link in order); mark each corrected row `amended`. Roots (no
 * `correctsAdminId`) are emitted in administered-time order; each row's correctors follow it recursively.
 * Nothing is ever removed or greyed to "voided" — a visible correction beside its intact original is the
 * whole point.
 */
export function arrangeAmendments(rows: readonly MarRowView[]): MarRowView[] {
  const byTime = [...rows].sort(
    (a, b) => new Date(a.administeredAtISO).getTime() - new Date(b.administeredAtISO).getTime(),
  );
  const childrenOf = new Map<string, MarRowView[]>();
  const correctedIds = new Set<string>();
  for (const r of byTime) {
    if (r.correctsAdminId) {
      correctedIds.add(r.correctsAdminId);
      const list = childrenOf.get(r.correctsAdminId) ?? [];
      list.push(r);
      childrenOf.set(r.correctsAdminId, list);
    }
  }
  const out: MarRowView[] = [];
  const emit = (r: MarRowView) => {
    out.push({ ...r, amended: correctedIds.has(r.id) });
    for (const child of childrenOf.get(r.id) ?? []) emit(child);
  };
  for (const r of byTime) if (!r.correctsAdminId) emit(r);
  return out;
}

// ============================================================================
// Copy — the source tag + status label vocabulary (client-safe, authored per the surface map §4.3)
// ============================================================================

export const MED_STATUS_LABEL: Record<MedStatus, string> = {
  GIVEN: "Given",
  REFUSED: "Refused",
  HELD: "Held",
  OMITTED: "Omitted",
};

/** §4.3 — the four source tags. STANDING_ORDER carries its complaint; the rest are fixed words. */
export function medSourceTag(source: MedSource, standingComplaint: string | null): string {
  switch (source) {
    case "STANDING_ORDER":
      return standingComplaint ? `Standing · ${standingComplaint}` : "Standing order";
    case "CHRONIC":
      return "Chronic";
    case "DOCTOR_ORDERED":
      return "Doctor-ordered";
    case "AD_HOC":
      return "Ad-hoc";
  }
}

// ============================================================================
// Round view types (R175) — the derived worklist. FULL patient names (Q4, clinical-gated).
// ============================================================================

export interface RoundDoseView {
  chronicMedId: string;
  studentId: string;
  studentName: string;
  drugName: string;
  doseLabel: string;
  note: string | null;
  /** A terminal MAR row exists for this (chronic_med, civil-day) — the dose has left the worklist. */
  done: boolean;
  /** The terminal status, when done (GIVEN/REFUSED/HELD/OMITTED). */
  status: MedStatus | null;
}

export interface MedRoundView {
  slotId: string;
  startsAt: string; // "HH:MM"
  label: string;
  isAnchor: boolean;
  status: RoundStatus;
  doses: RoundDoseView[];
  givenCount: number;
  openCount: number;
  /** The last terminal administration's civil "HH:MM" — the `✓ Done · 06:47` pill; null until any. */
  lastGivenAtHHMM: string | null;
}
