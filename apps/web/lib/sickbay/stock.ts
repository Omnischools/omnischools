/**
 * PURE §3 shaping (SHS module 4.4 / INCR-24a) — the derived stock status, the derived reorder count,
 * and the derived controlled balance. No DB import, so it is unit-tested without a database and shared
 * safely by the server reader (stock-reads.ts) and the client console (stock-console.tsx): the client
 * imports these TYPES and formatters, never a `*-reads` module.
 *
 * 🔴 Nothing here carries a student. The controlled balance and the reorder count are numbers over
 * drug rows; a drug beside a student on the shared §3 screen is the Risk-4 re-identification (R162).
 */

export type StockStatus = "OK" | "LOW" | "REORDER";

/**
 * R161 — the stock status pill is DERIVED from `qty_on_hand` vs `reorder_point`, NEVER stored:
 *   qty < reorderPoint               → REORDER (terra · below the line, order now)
 *   reorderPoint ≤ qty ≤ rp × 1.25   → LOW     (warn · within margin)
 *   else                             → OK      (green)
 * A row with no reorder point set has nothing to be below → OK.
 *
 * ponytail: the 1.25 "Low" band is a tunable heuristic — a school may want its own margin later; it is
 * a single constant here, not a config column, until one asks.
 */
const LOW_MARGIN = 1.25;
export function stockStatus(qtyOnHand: number, reorderPoint: number | null): StockStatus {
  if (reorderPoint == null) return "OK";
  if (qtyOnHand < reorderPoint) return "REORDER";
  if (qtyOnHand <= reorderPoint * LOW_MARGIN) return "LOW";
  return "OK";
}

/**
 * N-DIV-1 — the "3 reorder alerts" on the surface is FABRICATED. The real count is DERIVED: the rows
 * BELOW their reorder point (i.e. the REORDER pills). Matches the surface's own terra pills exactly.
 */
export function reorderCount(
  items: readonly { qtyOnHand: number; reorderPoint: number | null }[],
): number {
  return items.filter((i) => stockStatus(i.qtyOnHand, i.reorderPoint) === "REORDER").length;
}

/**
 * R152 — the controlled-substance balance is DERIVED over the append-only movement ledger AND the MAR,
 * never stored (R10):  balance = Σ RECEIPT + Σ ADJUSTMENT(±) − Σ WASTAGE − Σ(controlled GIVEN MAR
 * dispensed_qty). ADJUSTMENT carries a signed delta (the ±). This term is PURE arithmetic — the reader
 * (`getControlledRegister`) sums the MAR `dispensed_qty` per stock item. R168 — 24b DID switch the
 * reader's MAR join key from the mutable `drug_name` snapshot to `stock_item_id` (the earlier
 * "24b needs no reader change" note was wrong); this function is join-key-agnostic and unchanged.
 */
export function deriveControlledBalance(x: {
  receipt: number;
  adjustment: number;
  wastage: number;
  administered: number;
}): number {
  return x.receipt + x.adjustment - x.wastage - x.administered;
}

export type ControlledMovementType = "RECEIPT" | "WASTAGE" | "ADJUSTMENT";
export type MovementWitnessError = "MISSING_WITNESS" | "SELF_WITNESS";

/**
 * 🔴 R152/D5.3 — the controlled-movement witness DECISION, pure so it has a committed tripwire.
 *
 * A controlled WASTAGE (the classic diversion point) MUST carry a witness, and no one witnesses
 * themselves. This is the require + self-witness logic Quinn's `&& false` mutation slipped past
 * (24a MINOR-2): the action's guards were only source-shape-tested, so disabling the whole
 * accountability rule left the suite green. The N&MC-clinician-in-this-school check is DB-backed
 * (`assertSchoolClinician`, verified live) and stays in the action; this pure fn is the part a unit
 * test can pin and a mutation must red.
 */
export function controlledMovementWitnessError(
  movementType: ControlledMovementType,
  witnessId: string | null,
  actorId: string | null,
): MovementWitnessError | null {
  if (movementType === "WASTAGE" && !witnessId) return "MISSING_WITNESS";
  if (witnessId && actorId && witnessId === actorId) return "SELF_WITNESS";
  return null;
}

// ---- View types (client-safe · pre-formatted strings / scalars, never a DB row) ----

export interface StandingOrderView {
  id: string;
  complaint: string;
  treatment: string;
  escalation: string | null;
  orderedByDoctorName: string | null;
  active: boolean;
}

export interface StockItemView {
  id: string;
  drugName: string;
  formLabel: string | null;
  unit: string | null;
  qtyOnHand: number;
  reorderPoint: number | null;
  lastRestockedAt: Date | null;
  isControlled: boolean;
  active: boolean;
  status: StockStatus;
}

/** One row in a controlled item's ledger — a movement, OR (24b) a MAR-derived administration. NO student. */
export interface ControlledMovementView {
  id: string;
  /** RECEIPT | WASTAGE | ADJUSTMENT | ADMINISTERED (the MAR-derived row). */
  kind: "RECEIPT" | "WASTAGE" | "ADJUSTMENT" | "ADMINISTERED";
  occurredAt: Date;
  /** Signed against the balance: +receipt/+adjustment, −wastage/−administration. */
  quantity: number;
  actorName: string | null;
  witnessName: string | null;
  /** R156 — a recorded override reason stands in for the witness on a controlled dose. */
  witnessOverrideReason: string | null;
  batchRef: string | null;
  reason: string | null;
}

export interface ControlledBlockView {
  stockItemId: string;
  drugName: string;
  formLabel: string | null;
  unit: string | null;
  balance: number;
  movements: ControlledMovementView[];
}
