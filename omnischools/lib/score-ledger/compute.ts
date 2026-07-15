/**
 * Pure score-ledger math — no DB, no I/O. This is the correctness core of the SHS
 * five-category ledger (SHS_SCORE_LEDGER_SPEC §2/§4.1). Kept side-effect-free so it is
 * directly unit-testable and so the same functions drive both the server-truth compile
 * (lib/actions/score-ledger.ts) and the live client-side "weighted total" preview in the
 * card view. Nothing here touches Postgres — the caller supplies already-fetched rows.
 */
import { round2 } from "@/lib/gradebook-helpers";

/** The five NaCCA category weights, as percentages that sum to 100. */
export interface CategoryWeights {
  asgn: number;
  midSem: number;
  endSem: number;
  project: number;
  portfolio: number;
}

/** System fallback when a school has configured no weights row (spec §2, Asankrangwa default). */
export const SYSTEM_DEFAULT_WEIGHTS: CategoryWeights = {
  asgn: 15,
  midSem: 15,
  endSem: 40,
  project: 15,
  portfolio: 15,
};

/**
 * The five per-category scan denominators (Path B / Item 4). A raw number the extractor read
 * is interpreted against its category's denominator before it becomes the 0–100 stored value:
 * raw 8 under a /10 portfolio denominator → 80. Same shape and resolution as the weights.
 */
export interface CategoryDenominators {
  asgn: number;
  midSem: number;
  endSem: number;
  project: number;
  portfolio: number;
}

/**
 * System fallback denominators — all 100 (identity). An unconfigured category never inflates
 * a mark (raw 8 under /100 → 8); only a smaller configured denominator scales up. The fallback
 * is deliberately the largest sane denominator so a missing config can never over-award.
 */
export const SYSTEM_DEFAULT_DENOMINATORS: CategoryDenominators = {
  asgn: 100,
  midSem: 100,
  endSem: 100,
  project: 100,
  portfolio: 100,
};

/** The four categories Path A auto-compiles from events; portfolio is entered manually. */
export type ComputableCategory = "ASSIGNMENT" | "MID_SEM_EXAM" | "END_SEM_EXAM" | "PROJECT";

/** One assessment event as it applies to a single student (their mark on that event). */
export interface EventMark {
  category: ComputableCategory;
  maxMark: number;
  rawMark: number | null; // null = blank cell (excluded from means — Kofi Q2)
}

/** The five compiled category values on a 0–100 scale (null = not yet computable). */
export interface CategoryScores {
  asgn: number | null;
  midSem: number | null;
  endSem: number | null;
  project: number | null;
  portfolio: number | null;
}

/**
 * Resolve the weights for a (school × subject) from the two candidate rows the caller
 * fetched: the exact per-subject override, then the school-wide default (subject_id NULL),
 * then the system constant. Pure — the caller does the DB lookup and passes what it found.
 */
export function resolveWeights(
  subjectRow: CategoryWeights | null | undefined,
  schoolDefaultRow: CategoryWeights | null | undefined,
): CategoryWeights {
  return subjectRow ?? schoolDefaultRow ?? SYSTEM_DEFAULT_WEIGHTS;
}

/**
 * Resolve the five scan denominators for a (school × subject) — identical precedence to
 * resolveWeights (subject override → school default → system 100), fed the SAME two
 * ref_assessment_weights rows the weight resolver already fetched (the denominators are
 * columns on those very rows, so no extra query). Pure — Kofi Q1b / Wells §5 handoff.
 */
export function resolveDenominators(
  subjectRow: CategoryDenominators | null | undefined,
  schoolDefaultRow: CategoryDenominators | null | undefined,
): CategoryDenominators {
  return subjectRow ?? schoolDefaultRow ?? SYSTEM_DEFAULT_DENOMINATORS;
}

/**
 * The ceiling for any stored score/percentage — the numeric(5,2) column max. Over-max
 * (bonus) marks are allowed and a category may exceed 100, but a pathological entry
 * (e.g. 500 out of 10 → 5000%) is capped here so the compile can never overflow the DB
 * column and fail the whole transaction (Quinn MAJOR). The UI already soft-warns on over-max.
 */
export const MAX_PERCENT = 999.99;

/** Convert a raw mark out of maxMark to a percentage (may exceed 100 for bonus marks).
 * Null if blank or max ≤ 0; capped at MAX_PERCENT so it always fits numeric(5,2). */
export function percent(rawMark: number | null, maxMark: number): number | null {
  if (rawMark == null) return null;
  if (!(maxMark > 0)) return null;
  return Math.min(round2((rawMark / maxMark) * 100), MAX_PERCENT);
}

/** Does a raw mark exceed its event max? Drives the soft warn (Kofi Q3) — never a hard block. */
export function exceedsMax(rawMark: number | null, maxMark: number): boolean {
  return rawMark != null && maxMark > 0 && rawMark > maxMark;
}

/**
 * Mean of the non-null event percentages (blank cells excluded, not treated as 0 —
 * Kofi Q2). Equal-weight mean is the default; weight-by-max-mark is deferred (spec §4.1,
 * Kofi Q5). Returns null when there are no events or every event is blank.
 */
export function meanPercent(events: EventMark[]): number | null {
  const pcts = events
    .map((e) => percent(e.rawMark, e.maxMark))
    .filter((p): p is number => p != null);
  if (pcts.length === 0) return null;
  return round2(pcts.reduce((a, b) => a + b, 0) / pcts.length);
}

/**
 * Compile the four computable category values for one student from their event marks.
 * Assignments and projects are means of their events' percentages (Kofi Q9); mid-sem and
 * end-sem are the single event's percentage (single-event enforced at the DB by partial
 * unique indexes — Kofi Q1). Portfolio is never computed here.
 */
export function compileComputableCategories(
  events: EventMark[],
): Omit<CategoryScores, "portfolio"> {
  const byCat = (c: ComputableCategory) => events.filter((e) => e.category === c);
  return {
    asgn: meanPercent(byCat("ASSIGNMENT")),
    midSem: meanPercent(byCat("MID_SEM_EXAM")),
    endSem: meanPercent(byCat("END_SEM_EXAM")),
    project: meanPercent(byCat("PROJECT")),
  };
}

/** True when all five category values are present — the ledger can be COMPLETE. */
export function allCategoriesPresent(cat: CategoryScores): boolean {
  return (
    cat.asgn != null &&
    cat.midSem != null &&
    cat.endSem != null &&
    cat.project != null &&
    cat.portfolio != null
  );
}

/**
 * The weighted total out of 100, using the resolved weights. Returns null unless all five
 * categories are present — a partial ledger has no meaningful weighted total (the weights
 * assume all five). Mirrors the Basic gradebook's weightedTotal(null → null) contract.
 * The live card-view preview computes its own provisional figure; the *stored* total is
 * only ever this complete value.
 */
export function weightedTotalComplete(
  cat: CategoryScores,
  w: CategoryWeights,
): number | null {
  if (!allCategoriesPresent(cat)) return null;
  return round2(
    (cat.asgn! * w.asgn) / 100 +
      (cat.midSem! * w.midSem) / 100 +
      (cat.endSem! * w.endSem) / 100 +
      (cat.project! * w.project) / 100 +
      (cat.portfolio! * w.portfolio) / 100,
  );
}

/**
 * A provisional running total for the card-view preview only — sums the entered categories
 * against their weights and reports how much of the 100% weight is accounted for. Never
 * stored; purely a UI affordance so a teacher sees the total grow as they enter scores.
 */
export function provisionalTotal(
  cat: CategoryScores,
  w: CategoryWeights,
): { total: number; weightEntered: number } {
  const parts: Array<[number | null, number]> = [
    [cat.asgn, w.asgn],
    [cat.midSem, w.midSem],
    [cat.endSem, w.endSem],
    [cat.project, w.project],
    [cat.portfolio, w.portfolio],
  ];
  let total = 0;
  let weightEntered = 0;
  for (const [value, weight] of parts) {
    if (value != null) {
      total += (value * weight) / 100;
      weightEntered += weight;
    }
  }
  return { total: round2(total), weightEntered };
}

/**
 * The computed lifecycle status. COMPLETE once all five categories are present; otherwise
 * DRAFT. STPSHS_READY is never computed — it is an explicit teacher sign-off action (spec
 * §11 Item 1), so it is preserved by the caller, not derived here.
 */
export function computedStatus(cat: CategoryScores): "DRAFT" | "COMPLETE" {
  return allCategoriesPresent(cat) ? "COMPLETE" : "DRAFT";
}
