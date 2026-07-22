/**
 * WASSCE module constants (SHS module 4.3 / INCR-15) — the WAEC/GES reference vocabulary that
 * the setup surface renders but that is NOT a spine table (Kofi rulings 2026-07-19 · Lucy map
 * §1.5/§5.2/§5.3). Single source: the A1–F9 grading band + aggregate rule appears in §1.5 AND
 * §5.2; the programme track colours drive §1.4 cards AND §4.5 pills. Pure module — no DB import,
 * safe on client or server.
 *
 * NO-ALPHA DISCIPLINE (repo memory `no-alpha-token-opacity`): the General Arts track colour
 * `#7B4A8A` and its 12%-tint pill are NOT design tokens (mirrors the boarding House-hex drift).
 * They render via inline `style` with a solid hex / explicit `rgba(...)` — never slash-opacity.
 * The other three tracks map cleanly to solid tokens (terra / gold / green).
 *
 * NO PROJECTION (AC-G): nothing here computes an aggregate or a university tier. The A1–F9 scale
 * and the "best-3-cores + best-3-electives" text are a static WAEC explainer, not a formula.
 */

/** The fixed programme-enum keys this school offers (surface / filter display order). */
export type WassceProgrammeKey =
  | "GENERAL_SCIENCE"
  | "BUSINESS"
  | "GENERAL_ARTS"
  | "HOME_ECONOMICS";

/**
 * Per-programme track metadata keyed by the fixed `programme` enum (surface Open Q8: colour is a
 * constant, not a per-school column, because the programme set is fixed). `color` is the solid hex
 * for the §1.4 card `border-top` and the §4.5 pill text; `pillBg` is the pill tint. Science/Business/
 * Home Ec map to token hexes; General Arts is the bespoke `#7B4A8A` (rendered inline, never tokenised).
 */
export const PROGRAMME_TRACKS: Record<
  WassceProgrammeKey,
  {
    /** Card name split — `namePre` normal + `nameEm` gold italic <em> (surface §1.4). */
    namePre: string;
    nameEm: string;
    /** Short roster-pill label (§4.5) — "Gen. Arts" / "Home Ec." vs the full card name. */
    shortLabel: string;
    /** Solid track hex — card border-top + pill text. */
    color: string;
    /** Pill background tint (solid token class OR explicit rgba for the bespoke purple). */
    pillBgStyle: string | null; // null → use pillBgClass instead (token tint)
    pillBgClass: string | null; // token tint class (sci/bus/he); null for ga (inline rgba)
    /** Electives block heading (surface §1.4 — Arts differs: "choose 4"). */
    electivesLabel: string;
    /** Whether OPTIONAL subjects render a " (or)" suffix (Business/Home Ec yes; Arts no). */
    optSuffix: string | null;
  }
> = {
  GENERAL_SCIENCE: {
    namePre: "General ",
    nameEm: "Science",
    shortLabel: "Science",
    color: "#B84A39", // --terra
    pillBgStyle: null,
    pillBgClass: "bg-terra-bg text-terra",
    electivesLabel: "Electives (4 required)",
    optSuffix: null,
  },
  BUSINESS: {
    namePre: "",
    nameEm: "Business",
    shortLabel: "Business",
    color: "#C8975B", // --gold
    pillBgStyle: null,
    pillBgClass: "bg-gold-bg text-gold",
    electivesLabel: "Electives (4 required)",
    optSuffix: "(or)",
  },
  GENERAL_ARTS: {
    namePre: "General ",
    nameEm: "Arts",
    shortLabel: "Gen. Arts",
    color: "#7B4A8A", // BESPOKE — no token, inline style only
    pillBgStyle: "rgba(123,74,138,0.12)", // explicit rgba, NEVER bg-[#7B4A8A]/12 slash-opacity
    pillBgClass: null,
    electivesLabel: "Electives (choose 4)",
    optSuffix: null,
  },
  HOME_ECONOMICS: {
    namePre: "Home ",
    nameEm: "Economics",
    shortLabel: "Home Ec.",
    color: "#2F6B47", // --green
    pillBgStyle: null,
    pillBgClass: "bg-green-bg text-green",
    electivesLabel: "Electives (4 required)",
    optSuffix: null,
  },
};

/** Surface / filter display order for the four tracks. */
export const PROGRAMME_ORDER: WassceProgrammeKey[] = [
  "GENERAL_SCIENCE",
  "BUSINESS",
  "GENERAL_ARTS",
  "HOME_ECONOMICS",
];

/**
 * The WAEC 9-grade band (§1.5 + §5.2, single source). `opacity` ports the surface's inline
 * `opacity:0.85/0.72/…` to an `opacity-N` utility (repo memory: never `bg-green/85` slash-opacity).
 */
export const WASSCE_GRADING_BANDS: {
  grade: string;
  caption: string;
  bgClass: string; // solid token bg
  textClass: string;
  opacity: string | null; // opacity-N utility or null (100%)
}[] = [
  { grade: "A1", caption: "Excellent · 1pt", bgClass: "bg-green", textClass: "text-bg", opacity: null },
  { grade: "B2", caption: "V. Good · 2pt", bgClass: "bg-green", textClass: "text-bg", opacity: "opacity-90" },
  { grade: "B3", caption: "Good · 3pt", bgClass: "bg-green", textClass: "text-bg", opacity: "opacity-75" },
  { grade: "C4", caption: "Credit · 4pt", bgClass: "bg-gold", textClass: "text-navy", opacity: null },
  { grade: "C5", caption: "Credit · 5pt", bgClass: "bg-gold", textClass: "text-navy", opacity: "opacity-90" },
  { grade: "C6", caption: "Credit · 6pt", bgClass: "bg-gold", textClass: "text-navy", opacity: "opacity-75" },
  { grade: "D7", caption: "Pass · 7pt", bgClass: "bg-warn", textClass: "text-surface", opacity: null },
  { grade: "E8", caption: "Pass · 8pt", bgClass: "bg-warn", textClass: "text-surface", opacity: "opacity-90" },
  { grade: "F9", caption: "Fail · 9pt", bgClass: "bg-terra", textClass: "text-bg", opacity: null },
];

/** Aggregate explainer (§1.5) — static WAEC rule, NOT a computed value (AC-G). */
export const AGGREGATE_RANGE_LABEL = "6 (best) → 54 (worst)";

/** WAEC special-consideration form vocabulary (§5.2; referenced by §4.5 accommodation notes). */
export const SC_FORMS: { code: string; scope: string }[] = [
  { code: "SC-3", scope: "sensory/physical" },
  { code: "SC-7", scope: "known chronic condition" },
  { code: "SC-12", scope: "exam-day medical" },
];

/**
 * GES Free-SHS per-candidate WAEC fee anchor (§5.3). Drives the §4.3 fee tile + §1.6 fee copy as a
 * static `candidateCount × fee` read — NOT a billing-ledger pull, and NEVER a fee-gating code path
 * (Kofi K3: fee is display-only; "no candidate denied for fees"). Ghana cedis.
 */
export const WAEC_FEE_PER_CANDIDATE = 1400;

/** Currency format — "GHS 1,400" (space after unit, never GH₵/Ghc — design-tokens convention). */
export function formatGhs(amount: number): string {
  return `GHS ${amount.toLocaleString("en-GH")}`;
}

/** Compact currency — "GHS 336k" for the §4.3 total-fees tile. */
export function formatGhsCompact(amount: number): string {
  if (amount >= 1000) return `GHS ${Math.round(amount / 1000)}k`;
  return formatGhs(amount);
}

/**
 * WAEC policy-anchor copy (§5.2) — static reference text, not a table. Centre code is per-school
 * config and is injected by the caller (it is real data off the cohort's candidates).
 */
export function waecPolicyAnchors(centreCode: string): { heading: string; body: string }[] {
  return [
    {
      heading: "Centre code",
      body: `${centreCode} · Asankrangwa Senior High School · Western Region · Wassa Amenfi West District. Reviewed annually before registration window opens (Jan).`,
    },
    {
      heading: "2026 calendar return",
      body: "First International WASSCE since 2019. Ghana on Ghana-only calendar 2020–2025 due to COVID disruption. 21 Apr → 19 Jun 2026.",
    },
    {
      heading: "Special consideration forms",
      body: "SC-3 (sensory/physical), SC-7 (known chronic condition), SC-12 (exam-day medical). Filed via WAEC online portal; medical cert from registered facility required.",
    },
    {
      heading: "Grading + aggregate",
      body: "A1=1, B2=2, B3=3, C4=4, C5=5, C6=6, D7=7, E8=8, F9=9. Aggregate = best 3 cores + best 3 electives. Lower = better.",
    },
  ];
}

/** GES operational-anchor copy (§5.3) — static reference text, not a table. */
export const GES_POLICY_ANCHORS: { heading: string; body: string }[] = [
  {
    heading: "Free SHS coverage",
    body: "All WASSCE fees for school candidates covered by GES (2017 Free SHS policy). GHS 1,400 per candidate for core registration. Specialist electives may incur add-ons; school reconciles with GES district office.",
  },
  {
    heading: '"No candidate denied"',
    body: "No student can be denied WASSCE registration for fee reasons. If district reconciliation lags, school carries the receivable. Omnischools billing module flags this; WASSCE module ignores it.",
  },
  {
    heading: "Calendar alignment",
    body: "Per the GES SHS 2025/26 academic calendar, F3 Semester 2 runs 3 May → 21 Jun 2026 for single-track schools (a shortened Semester 2 since F3 ends earlier than F1–F2 to make way for WASSCE). F3 students complete WASSCE during Semester 2; F1–F2 students continue Semester 2 through 21 Aug 2026 per the same calendar. School-leaver ceremony scheduled for 26 Jun (week after WASSCE ends).",
  },
  {
    heading: "Discipline pause",
    body: "F3 disciplinary actions paused during WASSCE writing period unless safety-related. Boarding discipline ladder pauses for F3 from Apr 21 — penalty fees still accrue, but suspension and deboardinization on hold. Resumes Jun 22.",
  },
];
