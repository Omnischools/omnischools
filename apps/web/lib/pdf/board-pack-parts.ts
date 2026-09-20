import type { RollupArm, PendingArm } from "@/lib/rollup/school-rollup";

/**
 * GOV-5 · the board pack's PURE honesty seams — no React, no @react-pdf, no server-only — so the
 * omit-not-fake convention is unit-testable off the presentational document (the boardTile / board-tiles
 * precedent). The document (`board-pack-document.tsx`) consumes these AT its single branch point per arm,
 * so `.data` is only ever reachable through a CAPTURED narrowing: fabricating a number for a NOT_CAPTURED /
 * NOT_APPLICABLE arm is a COMPILE ERROR, and the tested branch IS the branch the print layer runs.
 */

export type ArmView<T> = { shown: true; data: T } | { shown: false; reason: string };

/** Treatment A/B seam. CAPTURED → its data (a real zero survives — treatment B); NOT_CAPTURED /
 *  NOT_APPLICABLE → its reason and NO data (treatment A). */
export function armView<T>(arm: RollupArm<T>): ArmView<T> {
  return arm.status === "CAPTURED"
    ? { shown: true, data: arm.data }
    : { shown: false, reason: arm.reason };
}

export type TierView<T> =
  | { kind: "captured"; data: T }
  | { kind: "reason"; reason: string }
  | { kind: "omit" };

/** Performance-tier seam (R357). A NOT_APPLICABLE tier is OMITTED (omit-not-fake), NOT_CAPTURED shows a
 *  reason, CAPTURED shows its data — each tier honest-absence-gated on its OWN, never blended. */
export function tierView<T>(arm: RollupArm<T>): TierView<T> {
  if (arm.status === "NOT_APPLICABLE") return { kind: "omit" };
  return arm.status === "CAPTURED"
    ? { kind: "captured", data: arm.data }
    : { kind: "reason", reason: arm.reason };
}

/** A PendingArm is always NOT_CAPTURED at runtime; narrow to its forward-looking coming-soon reason
 *  (the `never` payload makes CAPTURED a compile error, so it can never carry a number). */
export function pendingReason(arm: PendingArm): string {
  return arm.status === "CAPTURED" ? "" : arm.reason;
}

// --- in-doc numeric formatters (board grain — no forced decimals, matching boardGhs) ---
/** GHS money label (en-GH grouping, no forced decimals): 0 → "GHS 0", 41200 → "GHS 41,200". */
export const ghs = (n: number) => `GHS ${n.toLocaleString("en-GH")}`;
export const num = (n: number) => n.toLocaleString("en-GH");
/** A term-windowed null renders "—", never a fabricated 0. */
export const dash = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-GH"));
/** A captured 0% renders "0%" (real zero); a null rate renders "—", never "0%". */
export const pct = (n: number | null) => (n == null ? "—" : `${n}%`);
