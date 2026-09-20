/**
 * Class-switcher predicates for the Score Ledger PWA bottom sheet (INCR-4 · Q6 / S1–S7).
 * Pure — the page computes each class's completion server-side (reusing `computeVhmTier`) and
 * passes the derived counts in; these helpers turn them into the chevron/pill presentation.
 *
 * Q6 / R5 scope guard: Item 5 ships the PLAIN chevron + "1 of N" pill + bottom sheet with a
 * factual `current` / `ready` / `behind` status pill only. The chevron COLOUR (gold within 7
 * days of an STPSHS deadline, warn-dot after 14 days inactive) is DEFERRED — it is VHM anomaly
 * surfacing and is blocked on an unmodelled STPSHS-window date (gold would be fabricated).
 */
export type SwitcherPill = "current" | "ready" | "behind";

/** A single-class teacher sees no chevron and no "1 of N" pill — the affordance is suppressed
 *  when it isn't useful (S2). Zero classes (nothing to switch) is suppressed too. */
export function chevronSuppressed(classCount: number): boolean {
  return classCount <= 1;
}

/** "1 of N" — the teacher's position among their classes for this subject/semester. */
export function classCountLabel(activeIndex: number, total: number): string {
  return `${activeIndex + 1} of ${total}`;
}

/**
 * The status pill for one class option (S4):
 *   - the active class always reads `current` (gold), even if incomplete;
 *   - any other class with all five categories entered by every student reads `ready` (green);
 *   - otherwise `behind` (warn).
 * `categoriesDone` is the `computeVhmTier` "n/5" for that class (categories every student has).
 */
export function switcherPill(isCurrent: boolean, categoriesDone: number): SwitcherPill {
  if (isCurrent) return "current";
  return categoriesDone >= 5 ? "ready" : "behind";
}
