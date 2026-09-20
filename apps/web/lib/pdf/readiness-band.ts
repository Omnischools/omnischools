/**
 * Pure PDF hero-band copy — extracted from `readiness-statement-document.tsx` (which imports
 * `@react-pdf/renderer` + JSX and so can't be pulled into the pure vitest suite). Keeping this here
 * lets the register-parity rule below be unit-tested directly.
 */

/** Who the PDF is rendered for. A parent must NOT see the cohort-tier band vocabulary (INCR-19b R6). */
export type ReadinessAudience = "staff" | "parent";

/**
 * The hero sub-line under the projected aggregate. Staff see the cohort-tier band ("Top tier · 6–12 ·
 * …") — their working document; a PARENT sees only the plain "lower is better" gloss, the same strip
 * the on-screen portal applies (R6). The `band` label is exactly the `AGGREGATE_BANDS` cohort
 * vocabulary the parent boundary hides everywhere else, so it must not survive into the parent's PDF.
 */
export function heroBandText(projectedBand: string, audience: ReadinessAudience): string {
  const gloss = "lower is better (6 best · 54 worst)";
  return audience === "parent" ? gloss : `${projectedBand} · ${gloss}`;
}
