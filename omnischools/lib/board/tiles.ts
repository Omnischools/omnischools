import type { RollupArm } from "@/lib/rollup/school-rollup";

/**
 * GOV-2 · the board landing's honesty seam (R339 / GOV2-14/15). A PURE helper (no server-only, no DB) so
 * the omit-not-fake convention is unit-testable off the server-only page.
 *
 * It narrows a `RollupArm<T>` on `status` before touching `.data`, so `value(data)` is only ever called
 * on a CAPTURED arm — a NOT_CAPTURED / NOT_APPLICABLE arm renders its `reason` string and NO number
 * (fabricating a zero for it would be a compile error, since `.data` is unreachable). A CAPTURED arm with
 * a real zero (e.g. `collected: 0` → "GHS 0") renders that true zero, never a NOT_CAPTURED tile.
 */
export type BoardTile =
  | { status: "CAPTURED"; value: string }
  | { status: "NOT_CAPTURED"; reason: string };

export function boardTile<T>(arm: RollupArm<T>, value: (data: T) => string): BoardTile {
  return arm.status === "CAPTURED"
    ? { status: "CAPTURED", value: value(arm.data) }
    : { status: "NOT_CAPTURED", reason: arm.reason };
}

/** GHS money label (en-GH grouping, no forced decimals): 0 → "GHS 0", 42000 → "GHS 42,000". */
export const boardGhs = (n: number): string => `GHS ${n.toLocaleString("en-GH")}`;
