import type { NtcProvenance } from "@/lib/oversight/cpd";

/**
 * THE CPD TONE, IN ONE PLACE (CPD-SURFACING-RULING C6/C9; surface map §2) — the `vacancy-tone.ts`
 * sibling for the CPD/PLC surface.
 *
 * ⚠ NEVER GREEN, AND NEVER TERRA ON A SYNTHETIC FIGURE. Synthetic / NTC-sourced figures are neither
 * good nor bad — they are ILLUSTRATIVE — so they take no valence at all: their only tone is the
 * neutral navy figure plus the amber DEMO chip. Crowning a demo compliance figure green ("most
 * compliant district") is exactly the misread the chip exists to prevent, and terra would read as a
 * measured failure the data cannot support. The brand terra stays reserved for a genuinely MEASURED
 * adverse PLC state, if one is ever toned; the brand green is simply not used on this surface.
 *
 * The sex split is likewise untoned: it is a PARITY frame, not a ranking — neither sex is "better",
 * the signal is the GAP (C14), so both figures are navy and the band between them carries the gold-soft
 * accent rather than a good/bad end.
 *
 * There is deliberately NO `cpdTone(n)` valence function: there is no good/bad direction to encode,
 * which is the whole point of the paragraph above. What lives here instead is the one DEMO/LIVE
 * decision and the one tooltip string, so no surface re-decides either.
 */

/**
 * The DEMO chip's tooltip — VERBATIM from C6 / surface map §2. One exported constant, so the chip, any
 * future export and the provenance prose cannot drift from each other.
 */
export const DEMO_CHIP_TOOLTIP =
  "Illustrative NTC data for the GES demo — not a measured figure. The live NTC CPD feed is not yet connected.";

/**
 * THE ONE GATE for every DEMO marker on the surface (C5/C6, AC-6).
 *
 * The reader resolves `ntcProvenance` ONCE and the surface only asks this question, so flipping the
 * switch to "LIVE" (the real NTC feed) or "ABSENT" (live, no feed) removes every chip with no other
 * change — there is no second branch to maintain.
 */
export function isDemo(provenance: NtcProvenance): boolean {
  return provenance === "DEMO";
}
