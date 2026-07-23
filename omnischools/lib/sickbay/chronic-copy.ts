/**
 * The CHRONIC REGISTER's copy and its derived strings — PURE, DB-free, unit-tested
 * (chronic-copy.test.ts). SHS module 4.4 / INCR-23a. The reader (chronic-reads.ts) fetches rows and
 * delegates every derivation here, so the tests never import the DB driver — the board-copy split,
 * verbatim.
 *
 * 🔴 R43/R94 — the string `diagnos` appears NOWHERE in this module. `condition` is a 7-value
 * vocabulary; everything else a matron writes is prose.
 *
 * 🔴 R120 / MEDIUM-3 — the reader returns a PINNED VIEW TYPE, never a chronic-entry row. The key-sets
 * below are the runtime pins (a TS interface erases at runtime; the returned object does not), so
 * 23b's per-scope column projection is added by pinning a NARROWER key-set, and a `select *` that
 * already leaked the whole entry would fail this pin instead of shipping.
 */
import { civilDate } from "./visits";
import type { SickbaySlot } from "./defaults";

// ============================================================================
// The enum vocabularies — mirror db/schema/_enums.ts exactly.
// ============================================================================

export type ChronicCondition =
  | "SICKLE_CELL"
  | "ASTHMA"
  | "EPILEPSY"
  | "ALLERGY"
  | "MENTAL_HEALTH"
  | "DIABETES"
  | "OTHER";

export type ChronicStatus = "STABLE" | "MONITOR" | "ACTIVE_CRISIS";

// ============================================================================
// The pinned view types — what the reader returns and the pages render. NEVER a chronic-entry row.
// ============================================================================

/** §01 — one register row. FULL name (C0), not the board's abbreviation tier. */
export interface ChronicRegisterRow {
  studentId: string;
  studentName: string;
  initials: string;
  formLabel: string;
  houseName: string | null;
  studentCode: string;
  condition: ChronicCondition;
  /** The words on the pill — a stored per-plan string, not the enum rendered. */
  conditionLabel: string | null;
  status: ChronicStatus;
  /** The second-axis overlay pill (R95) — NOT a status value. */
  referralManaged: boolean;
  /** The §01 bold daily-medication line, derived. `null` ⇒ render the cell EMPTY (C4/M4). */
  medicationLine: string | null;
  /** R125 — timestamp of the latest non-void visit; the page renders time + relative age. */
  lastVisitAt: Date | null;
  /** Derived from an OPEN admission — `admitted now`, tier-2 location, not a clinical assertion. */
  admittedNow: boolean;
  /** §04-adjacent access metadata — live grants the reader may see. */
  grantCount: number;
  /** Feeds the `Plans needing review` tile; never rendered per-row. */
  reviewedAt: Date | null;
}

/** One prescription row (entry × drug × slot | PRN) — the med grid pivots these. */
export interface ChronicMedView {
  drugName: string;
  doseLabel: string;
  isPrn: boolean;
  /** The MEDICATION_ROUND slot this dose is given at; `null` ⇔ `isPrn` (R99 XOR). */
  slotId: string | null;
  note: string | null;
}

/**
 * One care-plan entry, in FULL (23a readers are the default clinical roles — MATRON, or HEADMASTER
 * minus MENTAL_HEALTH). `hmRestricted` distinguishes the §03 pastoral layout from §02.
 *
 * 🔴 CHRONIC_ENTRY_KEYS pins this shape at runtime. 23b's scope projection returns a NARROWER
 * key-set for a PARTIAL / DIRECTIVE grantee; the pin makes a leaked clinical column a failing test.
 */
export interface ChronicPlanEntryView {
  entryId: string;
  condition: ChronicCondition;
  conditionLabel: string | null;
  status: ChronicStatus;
  referralManaged: boolean;
  onSiteTreatable: boolean;
  hmRestricted: boolean;
  version: number;
  reviewedAt: Date | null;
  reviewedByName: string | null;
  coReviewerNote: string | null;
  conditionDetail: string | null;
  baselineStatus: string | null;
  careGoals: string | null;
  emergencyProtocol: string | null;
  dischargeCriteria: string | null;
  // ---- HM tier (R98) — separately authored, for the dorm card, never a truncation of the clinical tier
  triggers: string | null;
  redFlags: string | null;
  firstAction: string | null;
  // ---- external care (R127) — text, no join, no VLC link
  externalClinicalHome: string | null;
  externalPastoralHome: string | null;
  externalCareCadence: string | null;
  externalNextVisitAt: Date | null;
  meds: ChronicMedView[];
}

/** The whole detail page for one student — patient header once, then a section per readable entry. */
export interface ChronicPlanView {
  studentId: string;
  studentName: string;
  firstName: string;
  lastName: string;
  initials: string;
  formLabel: string;
  houseName: string | null;
  studentCode: string;
  ageYears: number | null;
  guardian: { name: string; relationship: string } | null;
  matronName: string | null;
  matronPhone: string | null;
  /** The med-grid columns (active MEDICATION_ROUND slots, anchor first) — never the surface's 13:00. */
  roundColumns: RoundColumn[];
  /** The anchor slot's stored description — the round-timing note (R13). Null in Mode C. */
  anchorDescription: string | null;
  entries: ChronicPlanEntryView[];
}

/** A condition chip for the visit-record header (R124) — condition family only, the readable set. */
export interface ChronicChip {
  condition: ChronicCondition;
  label: string;
}

/** The runtime KEY-SET PINS (R70 generalised · MEDIUM-3). Asserted against `Object.keys(row).sort()`. */
export const CHRONIC_ROW_KEYS = {
  register: [
    "admittedNow",
    "condition",
    "conditionLabel",
    "formLabel",
    "grantCount",
    "houseName",
    "initials",
    "lastVisitAt",
    "medicationLine",
    "referralManaged",
    "reviewedAt",
    "status",
    "studentCode",
    "studentId",
    "studentName",
  ],
  entry: [
    "baselineStatus",
    "careGoals",
    "coReviewerNote",
    "condition",
    "conditionDetail",
    "conditionLabel",
    "dischargeCriteria",
    "emergencyProtocol",
    "entryId",
    "externalCareCadence",
    "externalClinicalHome",
    "externalNextVisitAt",
    "externalPastoralHome",
    "firstAction",
    "hmRestricted",
    "meds",
    "onSiteTreatable",
    "redFlags",
    "referralManaged",
    "reviewedAt",
    "reviewedByName",
    "status",
    "triggers",
    "version",
  ],
} as const;

// ============================================================================
// Condition pill — the ENUM drives the COLOUR, the stored label drives the WORDS (§3.4).
// ============================================================================

/** The pill's Tailwind classes per condition family. `MENTAL_HEALTH` navy = M11 (scoped readers only). */
export const CONDITION_PILL: Record<ChronicCondition, string> = {
  SICKLE_CELL: "bg-terra-bg text-terra",
  ASTHMA: "bg-warn-bg text-warn",
  EPILEPSY: "bg-condition-epilepsy-bg text-condition-epilepsy",
  ALLERGY: "bg-gold-bg text-gold",
  MENTAL_HEALTH: "bg-navy-2 text-bg",
  DIABETES: "bg-condition-diabetes-bg text-condition-diabetes",
  OTHER: "bg-bg text-navy-3",
};

/** The fallback words when a plan carries no `condition_label` — the enum, humanised. Never a diagnosis. */
const CONDITION_WORD: Record<ChronicCondition, string> = {
  SICKLE_CELL: "Sickle cell",
  ASTHMA: "Asthma",
  EPILEPSY: "Epilepsy",
  ALLERGY: "Allergy",
  MENTAL_HEALTH: "Mental health",
  DIABETES: "Diabetes",
  OTHER: "Other",
};

/** The pill's WORDS — the stored label if the matron wrote one, else the humanised enum. */
export function conditionLabel(condition: ChronicCondition, label: string | null): string {
  return label?.trim() ? label.trim() : CONDITION_WORD[condition];
}

// ============================================================================
// Status pill — a 3-value enum (R95). `Referral-managed` is a SECOND-AXIS overlay, not a status.
// ============================================================================

export type StatusTone = "crisis" | "monitor" | "stable";

export const STATUS_PILL: Record<StatusTone, string> = {
  crisis: "bg-terra-bg text-terra",
  monitor: "bg-warn-bg text-warn",
  stable: "bg-green-bg text-green",
};

/** The row's left-border tint per status — the surface's `tr.crisis / .monitor / .stable`. */
export const STATUS_ROW_BORDER: Record<ChronicStatus, string> = {
  ACTIVE_CRISIS: "border-l-terra",
  MONITOR: "border-l-warn",
  STABLE: "border-l-green",
};

export function statusPill(status: ChronicStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case "ACTIVE_CRISIS":
      return { label: "Active crisis", tone: "crisis" };
    case "MONITOR":
      return { label: "Monitor", tone: "monitor" };
    default:
      return { label: "Stable", tone: "stable" };
  }
}

/** The overlay pill (R95) — `Referral-managed`, navy-3, shown beside the status, never as a status. */
export const REFERRAL_OVERLAY = "Referral-managed";

// ============================================================================
// §01 derived cells
// ============================================================================

/**
 * The §01 `Daily medication` bold line, DERIVED from the plan's med rows — never a stored duplicate.
 * The first non-PRN scheduled drug leads (a PRN-only plan falls back to its first PRN drug); the
 * sub-lines the surface draws are DROPPED (C3 — no common binding, two are disclosures).
 *
 * 🔴 C4/M4 — a `MENTAL_HEALTH` plan renders the cell EMPTY (`null`), never `no on-site medication`:
 * an explicit absence in a medication column is the schedule-gap tell. The caller passes `null` meds
 * for such a row, or an empty list resolves the same way.
 */
export function medicationLine(
  meds: readonly { drugName: string; doseLabel: string; isPrn: boolean }[],
): string | null {
  if (meds.length === 0) return null;
  const lead = meds.find((m) => !m.isPrn) ?? meds[0];
  const dose = lead.doseLabel.trim();
  return dose ? `${lead.drugName} ${dose}` : lead.drugName;
}

const MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC", // Accra is UTC+0 all year
});
const HHMM = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

/** `12 May 18:40` — the §01 last-visit timestamp (R125). The reason fragment is OMITTED (A12/C5). */
export function lastVisitStamp(at: Date): string {
  return `${MONTH.format(at).replace(",", "")} ${HHMM(at)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `2 days ago` / `today` — the §01 relative-age sub-line (R125), computed from the PINNED `now`.
 * Whole civil days apart, so a visit at 23:00 last night reads `yesterday`, not `1 hour ago`.
 */
export function relativeVisitAge(at: Date, now: Date): string {
  const a = Date.parse(`${civilDate(at)}T00:00:00Z`);
  const n = Date.parse(`${civilDate(now)}T00:00:00Z`);
  const days = Math.round((n - a) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} wk ago`;
}

/** The §01 grant-count cell: `3 staff`, `1 member of staff`, or the authored `No grants` (§3.4). */
export function grantCountLabel(n: number): string {
  if (n <= 0) return NO_GRANTS;
  if (n === 1) return "1 member of staff";
  return `${n} staff`;
}

// ============================================================================
// §01 counts + lede — computed over the READER'S VISIBLE SET (§4.4). A HEADMASTER sees 5 of 6.
// ============================================================================

export interface RegisterCounts {
  all: number;
  crisis: number;
  monitor: number;
  stable: number;
  referralManaged: number;
  /** `status = ACTIVE_CRISIS` — the tile. */
  crisesToday: number;
  /** `reviewed_at < now − PLAN_REVIEW_DAYS OR IS NULL` — the tile. A never-reviewed plan is overdue. */
  needingReview: number;
}

/** Frozen policy, NOT per-school config (§3.5 · the R26 policy-anchor idiom). */
export const PLAN_REVIEW_DAYS = 30;

/**
 * The four filter-strip counts + the two tiles, derived (R74 partition invariant: crisis + monitor +
 * stable = all). `referralManaged` is a SECOND axis and does NOT partition (§3.3). Computed over the
 * rows passed — which are already the reader's visible set.
 */
export function registerCounts(
  rows: readonly Pick<ChronicRegisterRow, "status" | "referralManaged" | "reviewedAt">[],
  now: Date,
): RegisterCounts {
  const reviewCutoff = now.getTime() - PLAN_REVIEW_DAYS * DAY_MS;
  const c: RegisterCounts = {
    all: rows.length,
    crisis: 0,
    monitor: 0,
    stable: 0,
    referralManaged: 0,
    crisesToday: 0,
    needingReview: 0,
  };
  for (const r of rows) {
    if (r.status === "ACTIVE_CRISIS") c.crisis++;
    else if (r.status === "MONITOR") c.monitor++;
    else c.stable++;
    if (r.referralManaged) c.referralManaged++;
    if (r.status === "ACTIVE_CRISIS") c.crisesToday++;
    if (r.reviewedAt === null || r.reviewedAt.getTime() < reviewCutoff) c.needingReview++;
  }
  return c;
}

const REGISTER_DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/**
 * The §01 lede — `**{n} active** care plans · last review **{EEE d MMM}** · admin-private by default`
 * (§3.1). The `last review` clause is `max(reviewed_at)` over the visible set and DROPS when nothing
 * has ever been reviewed. `next monthly review` is DROPPED — nothing schedules a review (STPSHS shape).
 * `{n}` is the visible-set count (a HEADMASTER's five, never six).
 */
export function registerLede(activeCount: number, lastReview: Date | null): string {
  const plural = activeCount === 1 ? "care plan" : "care plans";
  const review = lastReview
    ? ` · last review **${REGISTER_DATE.format(lastReview).replace(",", "")}**`
    : "";
  return `**${activeCount} active** ${plural}${review} · **admin-private** by default`;
}

// ============================================================================
// §02 / §03 detail helpers
// ============================================================================

/** One med-grid column — an active MEDICATION_ROUND slot; the render label is the slot's stored one. */
export interface RoundColumn {
  slotId: string;
  time: string; // "06:30"
  label: string; // the stored slot label, e.g. "Morning medication round"
}

/** The med-grid columns from the round schedule (R101) — never the surface's 13:00 (F6). */
export function roundColumns(rounds: readonly SickbaySlot[]): RoundColumn[] {
  return rounds.map((s) => ({ slotId: s.id, time: s.startsAt, label: s.label }));
}

/** The version-meta line: `v4 · 21 Apr 2026 · Mrs A. Bediako`, or the authored not-yet-reviewed form. */
export function planVersionMeta(
  version: number,
  reviewedAt: Date | null,
  reviewerName: string | null,
): string {
  if (!reviewedAt) return `plan version v${version} · not yet reviewed`;
  const date = MONTH.format(reviewedAt).replace(",", "");
  const year = reviewedAt.getUTCFullYear();
  return `v${version} · ${date} ${year}${reviewerName ? ` · ${reviewerName}` : ""}`;
}

// ============================================================================
// AUTHORED copy (owner sign-off · Lucy Q13) — never re-typed inside a component.
// ============================================================================

export const H1_LIST_LEAD = "Chronic ";
export const H1_LIST_EM = "register.";
export const H1_PLAN_LEAD = "Care ";
export const H1_PLAN_EM = "plan.";
export const H1_PASTORAL_LEAD = "Pastoral ";
export const H1_PASTORAL_EM = "cross-reference.";

/** §3.2 — the RE-AUTHORED privacy banner (F9: `Deputy Head (Welfare)`/`School Nurse` do not exist). */
export const PRIVACY_BANNER_TITLE_LEAD = "Admin-private · ";
export const PRIVACY_BANNER_TITLE_EM = "per-grant access only";
export const PRIVACY_BANNER_BODY =
  "Chronic medical records are visible to **the Matron and the Headmaster** by default. " +
  "Housemasters and other staff see **only what the matron explicitly grants**, scoped per " +
  "student. Every read and write is recorded in the audit trail.";
/** R42 — the mental-health carve-out, stated on the banner. */
export const PRIVACY_BANNER_MH =
  "Records with a mental-health condition are visible to the Matron only, unless she grants " +
  "access explicitly.";

/** §01 filter labels. A bucket with ZERO rows for this reader does NOT render (C8/M3). */
export const FILTER_LABELS = {
  all: "All",
  crisis: "Active crisis",
  monitor: "Monitor",
  stable: "Stable",
  referralManaged: "Referral-managed",
} as const;

export const REGISTER_COLUMNS = [
  "Student",
  "Condition",
  "Status",
  "Daily medication",
  "Last visit",
  "HM grants",
  "Plan",
] as const;

export const OPEN_PLAN = "Open ›";
export const ADMITTED_NOW = "admitted now";
export const NO_GRANTS = "No grants";

export const EMPTY_REGISTER = "No chronic care plans on the register yet.";
export const EMPTY_REGISTER_CTA = "Add the first one →";
export const NO_MEDICATION = "No scheduled medication on this plan.";

/** §5.4 — the med-grid PRN column head + the round-timing note framing (R13). */
export const PRN_COLUMN = { head: "PRN", label: "As needed" } as const;
export const ROUND_TIMING_LEAD = "Round timing rule. ";
export const ROUND_TIMING_TAIL = "Meds are recorded at the round, not retrospectively.";

/** §5.6 — the dorm-side card. The foot copy is the physical-adjacency control and ships VERBATIM. */
export const DORM_CARD_LABEL = "DORM-SIDE COPY";
export const DORM_CARD_SUB = "Dorm-side reference · **HM-only** · reprint on every plan revision";
export const DORM_CARD_FOOT =
  "Print this card and post inside the HM's cabinet door. **Do not display in dorm common area** — " +
  "medical privacy applies. Replaced each term and on plan revision.";

/** §6.2 — the pastoral block's frozen editorial (identical for every school · the R26 idiom). */
export const PASTORAL_EYEBROW = "Why mental health sits here this way";
export const PASTORAL_TITLE_LEAD = "No on-site treatment · ";
export const PASTORAL_TITLE_EM = "referral-managed only.";
export const PASTORAL_BODY =
  "A real Ghanaian SHS sickbay does not provide mental health treatment. The matron is not a " +
  "psychiatrist or counsellor, and pretending otherwise creates harm.";

/** R124 — the neutral marker the visit record / today queue may render for a reader-visible plan. */
export const CARE_PLAN_MARKER = "Care plan on file";
export const VIEW_CARE_PLAN = "View care plan →";
