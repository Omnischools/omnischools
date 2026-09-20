import { gradeOrdinal, isCredit, type WassceGrade } from "./mock-grades";

/**
 * The WASSCE university-match engine (SHS module 4.3 / INCR-17b) — the CROWN JEWEL of 17b and a
 * PURE, DB-free module (safe on client or server). It answers two questions per tagged programme:
 * "how far inside/outside the published cut-off is this candidate?" and "does the candidate meet the
 * programme's subject prerequisites?" NOTHING here is stored: the §6 board derives on read, and the
 * only frozen copy is `readiness_statements.target_universities_json` (written once at statement
 * generation). No trigger, no `match_tier` column, no enum.
 *
 * THE BAND LADDER (Kofi R2, total + non-overlapping — the surface's five glosses OVERLAP, so the
 * ladder below is the single ratified truth). `δ = cutOff − projected`; the cut-off is the WORST
 * aggregate a programme admits, so a LOWER aggregate is stronger and a POSITIVE δ means "inside":
 *   • δ ≥ +4 → SAFETY        (comfort floor)
 *   • δ ≥ +2 → COMFORTABLE   (inside by a healthy band)
 *   • δ ≥ −1 → MATCH         (right at the line, either side)
 *   • else   → STRETCH       (a reach — the cut-off is harder than the projection)
 *
 * TARGET IS AN OVERLAY, NOT A BAND (the key insight): a `target_rank = FIRST_CHOICE` programme ALWAYS
 * renders TARGET regardless of its computed band — that is why the demo shows "1 target · 1 comfortable ·
 * 2 stretch · 1 safety" and NO tile shows MATCH (the only δ=+1 programme is the primary). The computed
 * band is still carried alongside so the tile's meta line can state the truth ("Match · 1 inside").
 *
 * PREREQUISITES ARE CHECKED, NOT DISPLAYED (Kofi R6): a rule is satisfied only when the candidate is
 * REGISTERED for the subject (`wassce_candidate_subject`) AND the predictor mock's effective grade is a
 * credit at/above the rule's minimum. Every seeded programme carries the universal English + Core-Maths
 * credit baseline, which is where the "pure best-3 vs Ghana admission rule" concern is encoded — in DATA,
 * not in a second aggregate (R3).
 *
 * ponytail: subject matching is by NAME (the INCR-16 FORWARD-1 seam) — the GLOBAL programme rules name
 * "Chemistry"/"English Language" and the tenant's `wassce_subjects.name` must agree. Upgrade to a
 * per-school alias table if vocabularies drift; flagged, not built.
 */

/** The four COMPUTED bands. TARGET is not here — it is the primary-choice overlay (see `matchTier`). */
export type MatchBand = "SAFETY" | "COMFORTABLE" | "MATCH" | "STRETCH";

/** What the badge renders: the computed band, or TARGET when the target is the candidate's primary. */
export type MatchTier = MatchBand | "TARGET";

/**
 * The band ladder — total and non-overlapping over every integer δ (Kofi R2 / AC1 / AC3).
 * δ = cutOff − projected; positive = inside the cut-off (admissible), negative = a reach.
 */
export function matchBand(projected: number, cutOff: number): MatchBand {
  const delta = cutOff - projected;
  if (delta >= 4) return "SAFETY";
  if (delta >= 2) return "COMFORTABLE";
  if (delta >= -1) return "MATCH";
  return "STRETCH";
}

/**
 * The rendered tier: a FIRST_CHOICE target is ALWAYS TARGET (the primary overlay), everything else is
 * its computed band (AC2). TARGET is deliberately NOT derivable from δ — it is the candidate's choice.
 */
export function matchTier(projected: number, cutOff: number, isPrimary: boolean): MatchTier {
  return isPrimary ? "TARGET" : matchBand(projected, cutOff);
}

/** How far inside / outside the cut-off, in aggregate points (AC5). δ = 0 → "on" the cut-off. */
export type MatchMargin = {
  direction: "inside" | "outside" | "on";
  points: number; // |δ|
};

export function matchMargin(projected: number, cutOff: number): MatchMargin {
  const delta = cutOff - projected;
  if (delta > 0) return { direction: "inside", points: delta };
  if (delta < 0) return { direction: "outside", points: -delta };
  return { direction: "on", points: 0 };
}

/**
 * The FROZEN `readiness_statements.target_universities_json` element (Kofi R4 / AC14). The §6 board is
 * LIVE (derived on every read); THIS is the immutable copy written ONCE at statement (re)generation.
 * A later cut-off or target edit changes the live board and NEVER this json (AC15); a candidate with no
 * targets freezes `[]`, not NULL. Target CRUD never writes it — only generation does (AC13).
 */
export type FrozenTargetUniversity = {
  universityName: string;
  shortName: string;
  universityType: string;
  programmeName: string;
  qualification: string;
  location: string;
  cutOff: number;
  cutOffReferenceYear: number;
  targetRank: string | null;
  isPrimary: boolean;
  projectedAggregate: number;
  matchBand: MatchBand; // the COMPUTED band (never the overlay)
  displayTier: MatchTier; // what the badge rendered (TARGET when primary)
  margin: MatchMargin;
  prerequisites: PrerequisiteCheck;
};

/* ------------------------------------------------------------------ display copy (§6 tiles + legend) */

/** Badge copy per tier. The TARGET/STRETCH suffixes come from `tierLabel` (primary / gap magnitude). */
export const MATCH_TIER_LABEL: Record<MatchTier, string> = {
  TARGET: "Target",
  COMFORTABLE: "Comfortable",
  MATCH: "Match",
  STRETCH: "Stretch",
  SAFETY: "Safety",
};

/**
 * The five badge tints (Lucy Part F). EVERY one is a SOLID background — no alpha, no slash-opacity on a
 * raw-hex token (repo memory `no-alpha-token-opacity`). MATCH's text `#1E5A35` and SAFETY's background
 * `#E5EAF2` are BESPOKE hexes (Palette-A A1 / the Slessor House pill), rendered as arbitrary values.
 */
export const MATCH_TIER_CLASS: Record<MatchTier, string> = {
  TARGET: "bg-gold text-navy",
  COMFORTABLE: "bg-green-bg text-green",
  MATCH: "bg-green-bg text-[#1E5A35]",
  STRETCH: "bg-warn-bg text-warn",
  SAFETY: "bg-[#E5EAF2] text-navy-2",
};

/** "Target · primary choice" / "Stretch · highly competitive" / "Comfortable" — the surface's badge copy. */
export function tierLabel(tier: MatchTier, margin: MatchMargin): string {
  if (tier === "TARGET") return "Target · primary choice";
  if (tier === "STRETCH" && margin.points >= 4) return "Stretch · highly competitive";
  return MATCH_TIER_LABEL[tier];
}

/** "Margin · 1 inside" / "Gap · 2 outside" / "Margin · on the cut-off" (the surface's meta chip). */
export function marginLabel(margin: MatchMargin): string {
  if (margin.direction === "on") return "Margin · on the cut-off";
  const word = margin.direction === "inside" ? "Margin" : "Gap";
  return `${word} · ${margin.points} ${margin.direction}`;
}

/** The derived "Likely outcome" chip — only rendered when the candidate is OUTSIDE the cut-off. */
export function likelyOutcomeLabel(margin: MatchMargin): string | null {
  if (margin.direction !== "outside") return null;
  return margin.points >= 4
    ? "Likely outcome · unlikely · interview required"
    : "Likely outcome · waitlist";
}

/**
 * The §6 header tally — "1 target · 1 comfortable · 2 stretch · 1 safety" (AC4). Reconstructed from the
 * rendered tiers in badge order, zero-count tiers omitted.
 */
const TALLY_ORDER: MatchTier[] = ["TARGET", "COMFORTABLE", "MATCH", "STRETCH", "SAFETY"];

export function matchTally(tiers: readonly MatchTier[]): string {
  return TALLY_ORDER.map((t) => ({ t, n: tiers.filter((x) => x === t).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${MATCH_TIER_LABEL[x.t].toLowerCase()}`)
    .join(" · ");
}

/**
 * Marker position on the ONE linear aggregate scale (6 best → 54 worst) as a 0–100 percentage. The
 * surface hard-codes hand-tuned `left:` values that do NOT fit a single scale (Lucy A.8/Part G) — this
 * replaces them so "You" and "Cut-off" are visually comparable across every tile.
 */
export const AGGREGATE_MIN = 6;
export const AGGREGATE_MAX = 54;

export function aggregateScalePct(value: number): number {
  const pct = ((value - AGGREGATE_MIN) / (AGGREGATE_MAX - AGGREGATE_MIN)) * 100;
  return Math.min(100, Math.max(0, pct));
}

/* -------------------------------------------------------------- cut-off snapshot honesty (Lucy Part E) */

/** One year of a programme's published cut-off — the `cut_off_history_json` element. */
export type CutOffHistoryEntry = { year: number; cutOff: number };

/** True when the value looks like a history array (jsonb arrives untyped). */
export function parseCutOffHistory(json: unknown): CutOffHistoryEntry[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter(
      (e): e is CutOffHistoryEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as CutOffHistoryEntry).year === "number" &&
        typeof (e as CutOffHistoryEntry).cutOff === "number",
    )
    .sort((a, b) => a.year - b.year);
}

/**
 * The "Trend" chip — derived ONLY from the seeded multi-year history, never asserted from a single-year
 * snapshot (Lucy Part E honesty). Returns null when there is no history to back a trend claim.
 */
export function cutOffTrendLabel(history: readonly CutOffHistoryEntry[]): string | null {
  if (history.length < 2) return null;
  const first = history[0];
  const last = history[history.length - 1];
  const years = history.length;
  const flat = history.every((h) => h.cutOff === first.cutOff);
  const figures = history.map((h) => `${h.cutOff} (${h.year})`).join(" · ");
  return flat
    ? `Trend · stable ${years} yrs · ${figures}`
    : `Trend · ${first.cutOff} (${first.year}) → ${last.cutOff} (${last.year}) over ${years} yrs`;
}

/** Every cut-off renders its reference year — NEVER a bare number (Lucy Part E). */
export function cutOffLabel(cutOff: number, referenceYear: number): string {
  return `${cutOff} (${referenceYear})`;
}

/**
 * The §3 cut-off-table colour, DIFFICULTY-coded and deliberately INVERTED from the usual green=good
 * semantics: terra = the lowest/hardest cut-offs (6–8), warn = mid (9–19), green = the highest/easiest
 * (20+). Documented so a later pass does not "fix" it (Lucy Part G).
 */
export function cutOffDifficultyClass(cutOff: number): string {
  if (cutOff <= 8) return "text-terra";
  if (cutOff <= 19) return "text-warn";
  return "text-green";
}

/* ------------------------------------------------------------------------------ prerequisites (R6) */

/** A prerequisite rule: one named subject, or an `anyOf` alternation ("Physics OR Elective Maths"). */
export type PrerequisiteRule =
  | { subject: string; minGrade: WassceGrade }
  | { anyOf: string[]; minGrade: WassceGrade };

export type PrerequisiteStatus = "MET" | "PENDING" | "UNMET";

export type PrerequisiteCheck = {
  met: boolean; // no unmet AND no pending
  status: PrerequisiteStatus; // any unmet → UNMET; else any pending → PENDING; else MET
  unmet: string[]; // below-credit OR not registered
  pending: string[]; // registered but no predictor grade yet
};

/** "Chemistry" / "Physics or Elective Mathematics" — the rule's display label. */
export function ruleLabel(rule: PrerequisiteRule): string {
  return "anyOf" in rule ? rule.anyOf.join(" or ") : rule.subject;
}

/** Parse the jsonb `prerequisite_subjects_json` into rules, dropping anything malformed. */
export function parsePrerequisiteRules(json: unknown): PrerequisiteRule[] {
  if (!Array.isArray(json)) return [];
  return json.filter((r): r is PrerequisiteRule => {
    if (typeof r !== "object" || r === null) return false;
    const rule = r as Partial<PrerequisiteRule> & { anyOf?: unknown; subject?: unknown };
    if (typeof (rule as { minGrade?: unknown }).minGrade !== "string") return false;
    if (Array.isArray(rule.anyOf)) return rule.anyOf.every((s) => typeof s === "string");
    return typeof rule.subject === "string";
  });
}

/**
 * Check a programme's prerequisites against the candidate's REGISTERED subjects + predictor effective
 * grades (R6 / AC16 / AC17). Per rule (an `anyOf` group is satisfied by ANY member):
 *   • satisfied — registered AND the effective grade is a credit at/above `minGrade`
 *   • pending   — registered but no predictor grade yet (nothing to judge)
 *   • unmet     — the grade is below credit/below the minimum, OR the candidate is not registered
 * The programme is UNMET if any rule is unmet, else PENDING if any rule is pending, else MET.
 */
export function checkPrerequisites(
  rules: readonly PrerequisiteRule[],
  effectiveGrades: Readonly<Record<string, WassceGrade>>,
  registered: readonly string[],
): PrerequisiteCheck {
  const unmet: string[] = [];
  const pending: string[] = [];

  for (const rule of rules) {
    const subjects = "anyOf" in rule ? rule.anyOf : [rule.subject];
    const min = gradeOrdinal(rule.minGrade);
    let satisfied = false;
    let anyPending = false;

    for (const subject of subjects) {
      if (!registered.includes(subject)) continue; // not sitting it — cannot satisfy the rule
      const grade = effectiveGrades[subject];
      if (grade == null) {
        anyPending = true;
        continue;
      }
      if (isCredit(grade) && gradeOrdinal(grade) <= min) {
        satisfied = true;
        break;
      }
    }

    if (satisfied) continue;
    if (anyPending) pending.push(ruleLabel(rule));
    else unmet.push(ruleLabel(rule));
  }

  const status: PrerequisiteStatus = unmet.length ? "UNMET" : pending.length ? "PENDING" : "MET";
  return { met: status === "MET", status, unmet, pending };
}

/** The universal admission baseline every seeded programme carries (R6/AC17) — encoded in DATA. */
export const UNIVERSAL_PREREQUISITE_SUBJECTS = ["English Language", "Mathematics (Core)"] as const;

/**
 * The §6 tile's prerequisite chip. `verbose` (the primary/TARGET tile) names the programme-SPECIFIC
 * subjects — the universal English + Core-Maths baseline is elided so the chip stays readable.
 */
export function prerequisiteLabel(
  check: PrerequisiteCheck,
  rules: readonly PrerequisiteRule[],
  verbose = false,
): string {
  if (check.status === "UNMET") return `Prerequisites · ${check.unmet.join(" + ")} · not met`;
  if (check.status === "PENDING") return `Prerequisites · ${check.pending.join(" + ")} · pending`;
  if (!verbose) return "Prerequisites · met";
  const specific = rules
    .filter(
      (r) =>
        !("subject" in r) ||
        !(UNIVERSAL_PREREQUISITE_SUBJECTS as readonly string[]).includes(r.subject),
    )
    .map(ruleLabel);
  return specific.length
    ? `Prerequisites · ${specific.join(" + ")} credit · met`
    : "Prerequisites · met";
}

/* ------------------------------------------------------------- setup §3 cohort tier bands (B.2 strip) */

/**
 * The §3 tier-band strip — the cohort's projected-AGGREGATE distribution, a DIFFERENT axis from the
 * five match tiers above (Lucy B.2: do not conflate). `max: null` = the open-ended 25+ band.
 */
export const TARGET_TIER_BANDS: {
  key: string;
  range: string;
  name: string;
  min: number;
  max: number | null;
  copy: string;
}[] = [
  {
    key: "tier-1",
    range: "6 – 12",
    name: "Tier 1",
    min: 6,
    max: 12,
    copy: "Medicine, Pharmacy, Engineering, Law. KNUST/Legon competitive.",
  },
  {
    key: "tier-2",
    range: "13 – 18",
    name: "Tier 2",
    min: 13,
    max: 18,
    copy: "Most degrees at top 3 unis. Business Admin, Sciences, Education.",
  },
  {
    key: "tier-3",
    range: "19 – 24",
    name: "Tier 3",
    min: 19,
    max: 24,
    copy: "Less competitive programmes, teacher training, second-tier unis.",
  },
  {
    key: "tier-4",
    range: "25 +",
    name: "Tier 4",
    min: 25,
    max: null,
    copy: "Technical universities, polytechnics, vocational paths, work track.",
  },
];

/** The §3 five-step "How the match works" explainer — static surface copy, verbatim (Lucy B.4). */
export const MATCH_EXPLAINER_STEPS: { heading: string; body: string }[] = [
  {
    heading: "Programme cut-off published by university.",
    body: "KNUST Biochemistry = 11. Legon Medicine = 6. UCC Nursing = 12. The cut-off table is a published snapshot, re-verified each admission cycle from every university's admissions page — each figure is stamped with the year it was published.",
  },
  {
    heading: "Subject prerequisites checked.",
    body: "KNUST Biochem requires credits in English, Math, Int Sci, Biology, Chemistry + Physics or Elec Math. The system checks that the student is registered for every required subject (set at registration) and is projected to credit it.",
  },
  {
    heading: "Mock 2 aggregate compared to cut-off.",
    body: "Student's projected aggregate vs programme cut-off. Margin reported in points. Less than 2 points = “tight”; 2–5 points = “comfortable”; more than 5 = “very comfortable”.",
  },
  {
    heading: "Three target programmes per student.",
    body: "The “stretch” (top choice), the “match” (most likely), and the “safety” (back-up). Three ranked choices is the maximum; some students tag fewer, and further unranked programmes may be tagged alongside.",
  },
  {
    heading: "Dean reviews mismatches.",
    body: "Any student whose top 2 targets exceed their Mock 2 aggregate gets a guidance interview. The Dean has reviewed 87 such cases across the 2024/25 academic year.",
  },
];

/** The §6 match-logic legend — the five badges + their gloss, rendered verbatim under the tile grid. */
export const MATCH_LEGEND: { tier: MatchTier; gloss: string }[] = [
  { tier: "TARGET", gloss: "The primary choice; the candidate's own first-ranked programme." },
  { tier: "COMFORTABLE", gloss: "Cut-off 2–3 above projected aggregate." },
  { tier: "MATCH", gloss: "Cut-off equal to projected +1 / −1." },
  { tier: "STRETCH", gloss: "Cut-off 2+ below projected. Worth applying; not a realistic outcome." },
  { tier: "SAFETY", gloss: "Cut-off 4+ above projected. Comfort floor." },
];
