import type { CensusArm } from "@/lib/reports/census/schema";

/**
 * GOV-9 · the census PDF's PURE honesty seams — no React, no @react-pdf, no server-only — so the
 * omit-not-fake convention is unit-testable off the presentational document (the GOV-5 `board-pack-parts`
 * precedent). `census-document.tsx` consumes these AT its single branch point per section, so `.data` is only
 * reachable through a CAPTURED (FULL/PARTIAL) narrowing: **a numeric render for a NONE / NOT_APPLICABLE
 * section is a COMPILE ERROR** (GOV9-10), and an un-entered hand section prints a hatched blank, never a 0.
 */

export type ArmView<T> = { shown: true; data: T } | { shown: false; reason: string };

/** A snapshot section seam. FULL/PARTIAL → its frozen data (a real captured 0 survives — R413); NONE /
 *  NOT_APPLICABLE → its reason and NO data (the hatched hand-fill blank). */
export function armView<T>(arm: CensusArm<T>): ArmView<T> {
  return arm.coverage === "FULL" || arm.coverage === "PARTIAL"
    ? { shown: true, data: arm.data }
    : { shown: false, reason: arm.reason };
}

export type HandView<T> = { filled: true; data: T } | { filled: false };

/** A hand-fill section seam (R422): an entered value → its data; NULL/absent → a hatched blank for the pen
 *  (never a fabricated 0). */
export function handView<T>(v: T | null | undefined): HandView<T> {
  return v == null ? { filled: false } : { filled: true, data: v };
}

// --- in-doc numeric formatters (en-GH grouping, no forced decimals) ---
export const num = (n: number) => n.toLocaleString("en-GH");
/** A term-windowed null renders "—", never a fabricated 0. */
export const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-GH"));
/** A captured 0% renders "0%" (a real zero); a null rate renders "—", never "0%". */
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);
