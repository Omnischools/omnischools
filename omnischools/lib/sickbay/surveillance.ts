/**
 * Sickbay SURVEILLANCE — PURE, DB-free, unit-tested (surveillance.test.ts). SHS module 4.4 /
 * INCR-27. The syndromic-surveillance vocabulary (the 7-value bucket a MATRON sets at assessment) and
 * every derivation the outbreak monitor renders: the rolling-window status ladder, the week-over-week
 * trend, and the counts-only lede. `lib/sickbay/surveillance-reads.ts` is the thin server shell that
 * fetches rows and hands them to these; the client imports these TYPES/formatters, never a reader.
 *
 * 🔴 It is a SURVEILLANCE bucket, NOT a diagnosis (R215/R43/Decision-12). The string that begins with
 * "diagno…" appears in no identifier, key or label here (grep-clean, surveillance.test.ts pins it) —
 * it AGGREGATES (the outbreak monitor + the 30-day mix, both derived-at-read), it does not name a
 * condition. `working_impression` stays a separate free-text field.
 *
 * 🔴 Thresholds are `lib/` CONSTANTS, not config (R216 / F-27C): a stored per-school threshold is the
 * "Configure thresholds" editor, which is DEFERRED. Counts/trends/status are DERIVED every read, never
 * stored — a stored outbreak flag that can disagree with its rows is the STPSHS-matrix failure again.
 */

/** Mirrors db/schema/_enums.ts `sickbay_surveillance_category` (0063) EXACTLY. */
export type SurveillanceCategory =
  | "MALARIA"
  | "RESPIRATORY"
  | "DIARRHOEA"
  | "SKIN"
  | "EYE"
  | "INJURY"
  | "OTHER";

/** The enum values as a tuple — the zod source of truth for the assessment write (F-27A). */
export const SURVEILLANCE_CATEGORY_VALUES = [
  "MALARIA",
  "RESPIRATORY",
  "DIARRHOEA",
  "SKIN",
  "EYE",
  "INJURY",
  "OTHER",
] as const satisfies readonly SurveillanceCategory[];

/**
 * Per-category editorial. `label` is the SYNDROMIC label (what the student presented with —
 * "Malaria suspected", never "malaria") shown on the picker and the monitor; `short` is the compact
 * label the 30-day mix bar prints; `sub` is the monitor row's description. Every string is verbatim
 * from `Surfaces/schoolup-sickbay-today.html` §05 (the six district-aligned rows) plus OTHER's own.
 */
export const SURVEILLANCE_CATEGORY_META: Record<
  SurveillanceCategory,
  { label: string; short: string; sub: string }
> = {
  RESPIRATORY: {
    label: "Upper respiratory tract",
    short: "Respiratory",
    sub: "cough, sore throat, mild fever, runny nose",
  },
  MALARIA: {
    label: "Malaria suspected",
    short: "Malaria",
    sub: "fever ≥ 38°C with RDT or referral for blood film",
  },
  DIARRHOEA: {
    label: "Diarrhoea / vomiting",
    short: "Diarrhoea",
    sub: "acute GI symptoms · key sentinel for food-related outbreak",
  },
  SKIN: {
    label: "Skin · rash, scabies, ringworm",
    short: "Skin",
    sub: "dorm-spread risk · monthly inspection in boarding",
  },
  EYE: {
    label: "Eye · conjunctivitis",
    short: "Eye",
    sub: "“Apollo” · high contagion risk in boarding houses",
  },
  INJURY: {
    label: "Sports injury · sprain, strain, fracture",
    short: "Injury",
    sub: "tracked separately from infectious watch · safety review trigger",
  },
  OTHER: {
    label: "Other presenting syndrome",
    short: "Other",
    sub: "outside the district-aligned surveillance set",
  },
};

/**
 * The rows the OUTBREAK MONITOR renders, in the surface's order: infectious first, sports-injury last
 * (§O5.3). OTHER is deliberately EXCLUDED — it is a catch-all, not a district-aligned syndrome, so it
 * belongs on the 30-day mix (which walks all 7) but not the surveillance board. The full set always
 * renders, including the zero rows (a category at 0 is a measured baseline, never an omission).
 */
export const OUTBREAK_CATEGORY_ORDER = [
  "RESPIRATORY",
  "MALARIA",
  "DIARRHOEA",
  "SKIN",
  "EYE",
  "INJURY",
] as const satisfies readonly SurveillanceCategory[];

// ============================================================================
// Thresholds — CONSTANTS, never config (R216 / F-27C). "Configure thresholds" is deferred (inert).
// ============================================================================

/** The rolling window every count and trend is measured over. */
export const OUTBREAK_WINDOW_DAYS = 7;
/** 4+ cases / 7 days → Monitor (warn). */
export const OUTBREAK_MONITOR_THRESHOLD = 4;
/** 8+ cases / 7 days → Amber (terra). */
export const OUTBREAK_AMBER_THRESHOLD = 8;
/** …OR a week-over-week rise of ≥ this percent (once already at Monitor) → Amber. */
export const OUTBREAK_WOW_RISE_PCT = 50;

export type OutbreakStatus = "NORMAL" | "MONITOR" | "AMBER";

/**
 * The status ladder, DERIVED from the current count and (when a prior window exists) the WoW rise:
 *   count < 4                         → NORMAL
 *   4 ≤ count < 8                     → MONITOR — unless a ≥50% WoW rise escalates it to AMBER
 *   count ≥ 8                         → AMBER
 *
 * The WoW-rise amber path is GATED on already being at Monitor: a jump 2→3 is a +50% rise on tiny
 * numbers, not an outbreak, so amber never fires below the monitor floor. `prior === null` means no
 * prior window exists yet (the first 14 days) — the rise is simply not evaluated.
 */
export function outbreakStatus(count: number, prior: number | null): OutbreakStatus {
  if (count >= OUTBREAK_AMBER_THRESHOLD) return "AMBER";
  if (count >= OUTBREAK_MONITOR_THRESHOLD) {
    if (prior !== null && prior > 0 && (count - prior) / prior >= OUTBREAK_WOW_RISE_PCT / 100) {
      return "AMBER";
    }
    return "MONITOR";
  }
  return "NORMAL";
}

export interface OutbreakTrend {
  direction: "up" | "down" | "flat";
  /** `↑ from 2` / `↓ from 4` / `↔ steady` / `↔ baseline`. */
  label: string;
}

/**
 * The trend arrow, this-7d vs prior-7d. 🔴 BLANK (null) until a prior window exists — never a
 * fabricated `↔ steady` for a school in its first 14 days (§9, F-27). `↔ baseline` is a measured
 * both-zero week; `↔ steady` is a measured equal-nonzero week.
 */
export function outbreakTrend(
  count: number,
  prior: number,
  priorWindowExists: boolean,
): OutbreakTrend | null {
  if (!priorWindowExists) return null;
  if (count > prior) return { direction: "up", label: `↑ from ${prior}` };
  if (count < prior) return { direction: "down", label: `↓ from ${prior}` };
  return { direction: "flat", label: count === 0 ? "↔ baseline" : "↔ steady" };
}

/** The highest status present, for the lede + the amber-action highlight. */
export function topOutbreakStatus(statuses: readonly OutbreakStatus[]): OutbreakStatus {
  if (statuses.includes("AMBER")) return "AMBER";
  if (statuses.includes("MONITOR")) return "MONITOR";
  return "NORMAL";
}

/**
 * The DERIVED lede (§O5.1). Reads the highest-status category and phrases it; a clean week is the good
 * empty state, never a hidden section. `**bold**` fragments render via splitBold.
 */
export function outbreakLede(
  rows: readonly { label: string; count: number; status: OutbreakStatus }[],
): string {
  const amber = rows.filter((r) => r.status === "AMBER").sort((a, b) => b.count - a.count)[0];
  if (amber) {
    return `${amber.label} cluster at **${amber.count} cases** past ${OUTBREAK_WINDOW_DAYS} days · amber alert — notify Wassa Amenfi GHS.`;
  }
  const monitor = rows.filter((r) => r.status === "MONITOR").sort((a, b) => b.count - a.count)[0];
  if (monitor) {
    return `${monitor.label} cluster at **${monitor.count} cases** past ${OUTBREAK_WINDOW_DAYS} days · above the ${OUTBREAK_MONITOR_THRESHOLD}-case threshold for "monitor".`;
  }
  return "No clusters this week — all categories at baseline.";
}
