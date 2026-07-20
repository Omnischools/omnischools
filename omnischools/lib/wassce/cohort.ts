import { type ProjectionResult } from "./projection";
import {
  matchMargin,
  TARGET_TIER_BANDS,
  type PrerequisiteCheck,
} from "./university-match";

/**
 * The WASSCE cohort-readiness pure lib (SHS module 4.3 / INCR-18 · Kofi R4/R6/R7). NO DB import —
 * safe on client or server, and the unit-tested core of every figure the HoA dashboard renders: the
 * tier ladder, the aggregate histogram, median/mean, the subject heat tag, and the CROWN JEWEL
 * `assessCandidateRisk`.
 *
 * NOTHING here re-derives what already ships:
 *   • the tier ladder is `TARGET_TIER_BANDS` (university-match.ts) — NOT a second band table, and NOT
 *     `AGGREGATE_BANDS` (that is the readiness-statement LABEL, a different axis).
 *   • the gap vs a cut-off is the shipped `matchMargin` δ with the LABEL flipped — `gap = projected −
 *     cutOff = −δ`. There is exactly ONE sign convention in this codebase; this file consumes it.
 *   • per-grade counts / credit predicates stay in `mock-grades.ts`.
 */

/* ------------------------------------------------------------------------------- tier ladder (R4b) */

export type CohortTier = (typeof TARGET_TIER_BANDS)[number];

/** The tier band an aggregate falls in. Tier 4 is open-ended (`max: null`) so it always matches. */
export function cohortTier(aggregate: number): CohortTier {
  const band = TARGET_TIER_BANDS.find(
    (b) => aggregate >= b.min && (b.max == null || aggregate <= b.max),
  );
  return band ?? TARGET_TIER_BANDS[TARGET_TIER_BANDS.length - 1];
}

/**
 * The four tier fills — SOLID hexes, zero alpha (repo memory `no-alpha-token-opacity`). Rendered via
 * inline `style`, never a slash-opacity utility on a raw-hex token.
 */
export const TIER_COLORS: Record<string, string> = {
  "tier-1": "#2F6B47", // --green
  "tier-2": "#C8975B", // --gold
  "tier-3": "#C58A2E", // --warn
  "tier-4": "#B84A39", // --terra
};

/* -------------------------------------------------------------------------------- histogram (R4f) */

export type HistogramBin = {
  label: string; // "6" … "24" · "25+"
  min: number;
  max: number | null; // null = the open terminal bin
  count: number;
  tierKey: string;
};

/**
 * The projected-aggregate distribution: 19 point bins (6…24, the aggregate floor is 6) plus ONE open
 * terminal "25+" — the surface's two overlapping terminals ("25+" AND "28+") are incoherent, so there
 * is exactly one (R4f). Only COMPUTABLE aggregates are passed in, so the bin counts always sum to the
 * computable N — never a partial number absorbed silently (INCR-17 Decision 12).
 */
export function aggregateHistogram(aggregates: readonly number[]): HistogramBin[] {
  const bins: HistogramBin[] = [];
  for (let a = 6; a <= 24; a += 1) {
    bins.push({ label: String(a), min: a, max: a, count: 0, tierKey: cohortTier(a).key });
  }
  bins.push({ label: "25+", min: 25, max: null, count: 0, tierKey: cohortTier(25).key });

  for (const a of aggregates) {
    const bin = bins.find((b) => a >= b.min && (b.max == null || a <= b.max));
    if (bin) bin.count += 1;
  }
  return bins;
}

/* ------------------------------------------------------------------------- median / mean (R4d) */

/**
 * The LOWER median (an aggregate is an integer — a 18.5 median would be a number no candidate can
 * hold). Null on an empty set: the tile renders an em-dash + the computable N, never 0.
 */
export function medianAggregate(aggregates: readonly number[]): number | null {
  if (aggregates.length === 0) return null;
  const sorted = [...aggregates].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** The arithmetic mean to 1dp (the tile's sub-line). Null on an empty set. */
export function meanAggregate(aggregates: readonly number[]): number | null {
  if (aggregates.length === 0) return null;
  return Math.round((aggregates.reduce((s, a) => s + a, 0) / aggregates.length) * 10) / 10;
}

/* ------------------------------------------------------------------------------ subject heat (R5) */

export type SubjectHeatTag = "CONCERN" | "WATCH" | null;

/**
 * The §2 concern/watch tag, keyed to the below-credit SHARE (Kofi R5): ≥30% CONCERN · 15–29.9% WATCH ·
 * below 15% none. A subject with fewer than 5 graded results carries NO tag — a 1-of-2 below-credit
 * "50%" is noise, not a cohort weakness.
 */
export function subjectHeatTag(belowCredit: number, graded: number): SubjectHeatTag {
  if (graded < 5) return null;
  const share = belowCredit / graded;
  if (share >= 0.3) return "CONCERN";
  if (share >= 0.15) return "WATCH";
  return null;
}

/* ------------------------------------------------------------- at-risk · the crown jewel (Kofi R6) */

/**
 * The five named reasons, in the FIXED order they are reported. `atRisk = reasons.length > 0` — there
 * is no hidden sixth clause and no severity weighting.
 */
export const RISK_REASONS = [
  "PROJECTION_NOT_COMPUTABLE",
  "NO_TARGET_TAGGED",
  "ABOVE_LOWEST_CUTOFF",
  "UNMET_PREREQUISITE",
  "OPEN_SC12",
] as const;

export type RiskReason = (typeof RISK_REASONS)[number];

export const RISK_REASON_LABEL: Record<RiskReason, string> = {
  PROJECTION_NOT_COMPUTABLE: "Projection not computable",
  NO_TARGET_TAGGED: "No target tagged",
  ABOVE_LOWEST_CUTOFF: "Above lowest cut-off",
  UNMET_PREREQUISITE: "Unmet prerequisite",
  OPEN_SC12: "Open SC-12",
};

/** One tagged target reduced to what the rule needs: its cut-off + its prerequisite verdict. */
export type RiskTarget = { cutOff: number; prerequisites: PrerequisiteCheck };

/** One WAEC special-consideration filing — `sc_form` + `status`, straight off the row. */
export type RiskScFiling = { scForm: string; status: string };

export type RiskInput = {
  name: string; // sort tie-break (codepoint compare — deterministic, no locale)
  projection: ProjectionResult;
  targets: readonly RiskTarget[];
  scForms: readonly RiskScFiling[];
};

export type RiskAssessment = {
  atRisk: boolean;
  reasons: RiskReason[];
  /** The LEAST AMBITIOUS target = MAX(cut_off). "Lowest" is rank, NOT the smaller numeral. */
  lowestCutOff: number | null;
  /** `projected − lowestCutOff`. Positive = above (worse than) the cut-off. Null when unassessable. */
  gap: number | null;
  /** Null-gap sorts first: `gap ?? +Infinity`, descending. */
  sortKey: number;
};

/** An SC filing is OPEN unless it has been completed or rejected. */
const scOpen = (status: string) => status !== "COMPLETED" && status !== "REJECTED";

/**
 * Assess one candidate against the five-clause at-risk rule (R6).
 *
 * The two traps this function exists to get right:
 *   • **"Lowest target" = `MAX(cutOff)`** — the candidate's least-ambitious/safety school. Reading it
 *     as the smallest numeral inverts the entire list.
 *   • **`gap` is the NEGATIVE of the shipped `matchMargin` δ.** We call `matchMargin` and flip the
 *     label rather than introducing a second sign convention.
 *
 * OPEN_SC12 is why the rule is not purely academic: Y. Aidoo projects 10 against a cut-off of 11 (gap
 * −1, comfortably INSIDE) and is still at risk — through a live medical disruption, not her marks.
 * SC-3 / SC-7 are GRANTED ACCOMMODATIONS, not disruptions, and never fire.
 */
export function assessCandidateRisk(input: RiskInput): RiskAssessment {
  const reasons: RiskReason[] = [];

  const computable = input.projection.computable;
  if (!computable) reasons.push("PROJECTION_NOT_COMPUTABLE");
  if (input.targets.length === 0) reasons.push("NO_TARGET_TAGGED");

  // The least-ambitious target: the WORST (largest) published cut-off across everything tagged.
  let lowest: RiskTarget | null = null;
  for (const t of input.targets) if (!lowest || t.cutOff > lowest.cutOff) lowest = t;

  let gap: number | null = null;
  if (computable && lowest) {
    const margin = matchMargin(input.projection.aggregate, lowest.cutOff);
    // δ = cutOff − projected; the HoA reads the other direction, so flip the label (never the lib).
    gap = margin.direction === "inside" ? -margin.points : margin.points;
    if (gap > 0) reasons.push("ABOVE_LOWEST_CUTOFF");
  }

  // Prerequisites are judged on the LOWEST target only — a stretch school's unmet chemistry rule is
  // not a risk signal, missing the safety school's is. PENDING (registered, ungraded) never fires.
  if (lowest && lowest.prerequisites.status === "UNMET") reasons.push("UNMET_PREREQUISITE");

  if (input.scForms.some((s) => s.scForm === "SC-12" && scOpen(s.status))) reasons.push("OPEN_SC12");

  return {
    atRisk: reasons.length > 0,
    reasons,
    lowestCutOff: lowest ? lowest.cutOff : null,
    gap,
    sortKey: gap ?? Number.POSITIVE_INFINITY,
  };
}

/**
 * The §3 sort contract (the surface's own caption, not its hand-arranged demo order): null-gap rows
 * first, then gap descending, then name ascending. Total and deterministic — the same input always
 * yields the same order.
 */
export function compareRisk(
  a: { sortKey: number; name: string },
  b: { sortKey: number; name: string },
): number {
  if (a.sortKey !== b.sortKey) return b.sortKey - a.sortKey;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/* ------------------------------------------------------------------- cohort roll-up (§1 + §4 cards) */

/** One candidate reduced to the two figures every roll-up needs. */
export type CohortEntry = { aggregate: number | null; atRisk: boolean };

export type CohortSummary = {
  total: number;
  computable: number;
  notComputable: number;
  median: number | null;
  mean: number | null;
  medianTier: CohortTier | null;
  /** Counts keyed by `TARGET_TIER_BANDS[].key`; every tier present, zeroes included. */
  tierCounts: Record<string, number>;
  atRisk: number;
};

/**
 * The §1 tiles AND the §4 house cards are the SAME roll-up over different slices — one function so a
 * house's median can never disagree with the cohort's. Median/mean/tiers are over COMPUTABLE
 * projections only, and the not-computable count is reported so the surface can state it (F.1).
 */
export function cohortSummary(entries: readonly CohortEntry[]): CohortSummary {
  const aggregates = entries
    .map((e) => e.aggregate)
    .filter((a): a is number => a != null);
  const tierCounts: Record<string, number> = {};
  for (const b of TARGET_TIER_BANDS) tierCounts[b.key] = 0;
  for (const a of aggregates) tierCounts[cohortTier(a).key] += 1;
  const median = medianAggregate(aggregates);
  return {
    total: entries.length,
    computable: aggregates.length,
    notComputable: entries.length - aggregates.length,
    median,
    mean: meanAggregate(aggregates),
    medianTier: median == null ? null : cohortTier(median),
    tierCounts,
    atRisk: entries.filter((e) => e.atRisk).length,
  };
}
