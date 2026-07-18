/**
 * The 5-rung deboardinization ladder (SHS module 4.2 / INCR-8) — the canonical discipline
 * escalation contract, rendered READ-ONLY on the programme surface. NOTE → WARNING → BOND →
 * SUSPENSION → DEBOARDINIZATION, copy verbatim from surface 01's navy ladder block.
 *
 * Per Kofi OQ6: no per-school store and no editing in INCR-8. `getDeboardinizationLadder(schoolId)`
 * carries the schoolId only so INCR-13 can later swap in a per-school override without a signature
 * change (a cross-increment break). The editable store, Board-reversal model, co-sign ENFORCEMENT
 * and the 3× fee-penalty billing write all belong to INCR-13, the ladder's real consumer.
 *
 * Pure module (no DB, no I/O) — safe to import from tests and from the server contract.
 */

export type DeboardinizationSeverity =
  | "NOTE"
  | "WARNING"
  | "BOND"
  | "SUSPENSION"
  | "DEBOARDINIZATION";

export interface DeboardinizationRung {
  /** 1..5 — the ladder position (rendered "01".."05"). */
  stage: number;
  severity: DeboardinizationSeverity;
  /** Display name (surface verbatim), e.g. "Bond of good behaviour". */
  name: string;
  /** The plain-text description shown on the rung card. */
  description: string;
  /** The uppercase penalty chip, surface verbatim. */
  penaltyLabel: string;
  /** How many staff must co-sign this rung (0 for the lower rungs). */
  coSignCount: number;
  /** The roles that co-sign, in signing order. */
  coSignRoles: string[];
  /** Who (if anyone) may reverse this rung — null unless the rung sets a reversal authority. */
  reversalNote: string | null;
}

/**
 * The canonical ladder. Rung 5's co-sign data (× 3 · HM + Senior HM + Headmaster) and the
 * Board-only reversal note are the load-bearing facts INCR-13 enforces (AC F2); co-sign counts
 * on the lower rungs come from the rung copy (rung 3 is "witnessed by HM and Senior HM").
 */
export const DEBOARDINIZATION_LADDER: readonly DeboardinizationRung[] = [
  {
    stage: 1,
    severity: "NOTE",
    name: "Verbal note",
    description:
      "First instance of a minor infraction. Logged in the student record as a NOTE. No external sanction. FM & HM aware.",
    penaltyLabel: "NO PENALTY",
    coSignCount: 0,
    coSignRoles: [],
    reversalNote: null,
  },
  {
    stage: 2,
    severity: "WARNING",
    name: "Written warning",
    description:
      "Repeat infraction. 1-day internal suspension. Sometimes paired with forfeiture of exeat for the rest of the term. Parents are notified by SMS.",
    penaltyLabel: "1-DAY INT · EXEAT BLOCK",
    coSignCount: 0,
    coSignRoles: [],
    reversalNote: null,
  },
  {
    stage: 3,
    severity: "BOND",
    name: "Bond of good behaviour",
    description:
      "Signed commitment by the student. Witnessed by HM and Senior HM. Logged as artefact. Counselling sessions begin. Parents in writing.",
    penaltyLabel: "SIGNED ARTEFACT · COUNSELLING",
    coSignCount: 2,
    coSignRoles: ["HM", "Senior HM"],
    reversalNote: null,
  },
  {
    stage: 4,
    severity: "SUSPENSION",
    name: "External suspension",
    description:
      "2 weeks external. Student is sent home formally. Counselling continues. Re-entry conditional on bond re-affirmation. School board notified at next meeting.",
    penaltyLabel: "2 WK EXT · CONDITIONAL RE-ENTRY",
    coSignCount: 0,
    coSignRoles: [],
    reversalNote: null,
  },
  {
    stage: 5,
    severity: "DEBOARDINIZATION",
    name: "Deboardinization",
    description:
      "Removed from the boarding house, becomes a day student. Reversible only by the Board. 3× boarding fee penalty for any unauthorised days. HM + Senior HM + Headmaster all co-sign.",
    penaltyLabel: "CO-SIGN × 3 · 3× FEE PENALTY",
    coSignCount: 3,
    coSignRoles: ["HM", "Senior HM", "Headmaster"],
    reversalNote: "Reversible only by the Board",
  },
] as const;

/**
 * Contract getter (INCR-13 reads this). Read-only in INCR-8 — returns the canonical constant.
 * `schoolId` is accepted (unused today) so a future per-school override is not a signature change.
 */
export function getDeboardinizationLadder(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  schoolId: string,
): readonly DeboardinizationRung[] {
  return DEBOARDINIZATION_LADDER;
}
