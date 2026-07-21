/**
 * Sickbay F0 contract — PURE, DB-free, unit-tested (defaults.test.ts). SHS module 4.4 / INCR-21.
 *
 * THE FROZEN CONTRACT (Kofi R24): every exported type and field name here is load-bearing —
 * increments 22–28 read the sickbay config through this shape and NEVER re-derive it, so a rename
 * later is a cross-increment break. FROZEN: the type/field names, both enum value sets, `bedNumber`
 * as bed identity, R16's anchor semantics. LIVE (per-school, editable): mode, staff pointers, the
 * visiting doctor, bed rows, slot times/labels/days/staffing.
 *
 * The server reader (lib/sickbay/config.ts) fetches rows through withSchool and delegates every
 * derivation to this file, so the tests never import the DB driver — the lib/boarding/{config,
 * defaults} split, verbatim.
 *
 * Two rules this file exists to enforce:
 *   • `capabilities` is DERIVED FROM MODE by a pure function — never stored, never hand-set (R4).
 *     FULL and FIRST_AID are capability-IDENTICAL; they differ in editorial copy only.
 *   • the day-type LABEL is DERIVED from (days_of_week, runs_on_holidays) — never stored beside the
 *     set (R14). Storing both is how three contradictory round schedules got into the surfaces.
 */

// ============================================================================
// Enums — mirror db/schema/_enums.ts (sickbay_mode / sickbay_slot_kind) exactly.
// ============================================================================

export type SickbayMode = "FULL" | "FIRST_AID" | "REFERRAL_ONLY";
export type SickbaySlotKind = "MEDICATION_ROUND" | "CLINIC" | "DOCTOR_VISIT" | "ON_CALL";

/** Which sickbay post a clinical-staff row occupies. NOT a role — all three sit on settings. */
export type SickbayStaffPost = "SENIOR_MATRON" | "ASSISTANT_MATRON" | "VISITING_DOCTOR";

// ============================================================================
// Contract shapes
// ============================================================================

/**
 * What the school's declared mode ALLOWS. An affordance filter, never a data filter (R3/R4): no row
 * is deleted, hidden or migrated when the mode changes — only the rendering changes.
 */
export interface SickbayCapabilities {
  beds: boolean;
  isolationBeds: boolean;
  admissions: boolean;
  scheduleSlots: boolean;
  medicationRounds: boolean;
  visitingDoctor: boolean;
  standingOrders: boolean;
  drugStock: boolean;
  referrals: boolean;
  chronicRegister: boolean;
  parentNotifications: boolean;
  healthPrefects: boolean;
}

/** One bed. `bedNumber` is the identity and is STABLE FOR LIFE (R8) — retiring 4 never renumbers 5. */
export interface SickbayBed {
  id: string;
  bedNumber: number;
  isIsolation: boolean;
  active: boolean;
}

/** Bed counts DERIVE from the active rows (R10) — there is deliberately no stored scalar. */
export interface SickbayBedCounts {
  general: number;
  isolation: number;
  total: number;
}

/**
 * One recurring slot. `endsAt` MAY be earlier than `startsAt` — the on-call window is 22:00 → 06:00
 * and wraps midnight (AC C8). Any `end > start` validation would reject the canonical config.
 */
export interface SickbaySlot {
  id: string;
  kind: SickbaySlotKind;
  label: string;
  description: string | null;
  startsAt: string; // "HH:MM"
  endsAt: string; // "HH:MM" — may be < startsAt (midnight wrap)
  staffing: string | null; // free text, deliberately NOT an FK
  daysOfWeek: number[]; // ISO 1 = Monday … 7 = Sunday
  runsOnHolidays: boolean;
  isAnchor: boolean;
  active: boolean;
}

/** The whole per-school config, coalesced. A missing settings row still returns this shape (R25). */
export interface SickbayConfig {
  schoolId: string;
  mode: SickbayMode;
  /** false when the school has never declared a mode — NOT the same as "declared REFERRAL_ONLY". */
  configured: boolean;
  capabilities: SickbayCapabilities;
  matronUserId: string | null;
  assistantMatronUserId: string | null;
  visitingDoctorName: string | null;
  visitingDoctorAffiliation: string | null;
  beds: SickbayBed[];
  bedCounts: SickbayBedCounts;
}

/** A frozen regulatory anchor card (R26) — identical static editorial for every school. */
export interface PolicyAnchor {
  eyebrow: string;
  title: string;
  titleEm: string;
  /** `**bold**` fragments render as <b>; split with splitBold(). */
  body: string;
}

// ============================================================================
// Capabilities — DERIVED from mode, never stored (R4 · AC A2/A3)
// ============================================================================

/** FULL and FIRST_AID are capability-IDENTICAL (AC A2) — one object serves both. */
const CLINICAL_CAPABILITIES: SickbayCapabilities = Object.freeze({
  beds: true,
  isolationBeds: true,
  admissions: true,
  scheduleSlots: true,
  medicationRounds: true,
  visitingDoctor: true,
  standingOrders: true,
  drugStock: true,
  referrals: true,
  chronicRegister: true,
  parentNotifications: true,
  healthPrefects: true,
});

/**
 * Mode C keeps everything that does NOT need on-site clinical capacity (R4): referrals, the chronic
 * register, parent notifications and the School Health Prefect roster — which in a Mode-C school IS
 * the entire first-response capability, not a leftover.
 */
const REFERRAL_ONLY_CAPABILITIES: SickbayCapabilities = Object.freeze({
  beds: false,
  isolationBeds: false,
  admissions: false,
  scheduleSlots: false,
  medicationRounds: false,
  visitingDoctor: false,
  standingOrders: false,
  drugStock: false,
  referrals: true,
  chronicRegister: true,
  parentNotifications: true,
  healthPrefects: true,
});

/** The ONLY way to obtain capabilities. Never store this object; never hand-set a field. */
export function sickbayCapabilities(mode: SickbayMode): SickbayCapabilities {
  return mode === "REFERRAL_ONLY" ? REFERRAL_ONLY_CAPABILITIES : CLINICAL_CAPABILITIES;
}

// ============================================================================
// Day-type formatter — ONE function reproduces all five surface labels (R14 · AC C6/C7)
// ============================================================================

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const normaliseDays = (days: readonly number[]): number[] =>
  Array.from(new Set(days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))).sort(
    (a, b) => a - b,
  );

/**
 * The day-applicability label. NEVER stored beside the set (R14) — INCR-23's chronic-med grid and
 * INCR-24's rounds render the same slot from the same set without a copy fork.
 *
 * The five canonical strings, character-for-character (AC C6):
 *   Mon–Fri, term calendar     → `Every school day`
 *   Mon–Fri, runs on holidays  → `Mon · Tue · Wed · Thu · Fri`   (literal weekdays)
 *   one weekday                → `Thursdays`                      (AC C7 — boarding_day_type cannot express it)
 *   all 7, term calendar       → `Every day incl. weekend`
 *   all 7, runs on holidays    → `Every day · 365`
 *
 * `kind` is part of the frozen input shape so callers can pass a slot straight through; the label
 * itself is a function of the day set alone.
 */
export function formatDayType(
  slot: Pick<SickbaySlot, "daysOfWeek" | "runsOnHolidays" | "kind">,
): string {
  const days = normaliseDays(slot.daysOfWeek);
  if (days.length === 0) return "Never";
  if (days.length === 7) {
    return slot.runsOnHolidays ? "Every day · 365" : "Every day incl. weekend";
  }
  if (days.length === 5 && days.every((d, i) => d === i + 1)) {
    return slot.runsOnHolidays ? "Mon · Tue · Wed · Thu · Fri" : "Every school day";
  }
  if (days.length === 1) return `${DAY_LONG[days[0] - 1]}s`;
  return days.map((d) => DAY_SHORT[d - 1]).join(" · ");
}

/** The mono time window exactly as the surface prints it — en-dash U+2013, spaced. */
export function formatTimeWindow(slot: Pick<SickbaySlot, "startsAt" | "endsAt">): string {
  return `${slot.startsAt} – ${slot.endsAt}`;
}

// ============================================================================
// Coalesce — a missing settings row is legal and meaningful (R25 · AC A5)
// ============================================================================

/** The columns the reader selects off sickbay_settings. */
export interface SickbaySettingsRow {
  mode: SickbayMode;
  matronUserId: string | null;
  assistantMatronUserId: string | null;
  visitingDoctorName: string | null;
  visitingDoctorAffiliation: string | null;
  configuredAt: Date | null;
}

/** Counts over the ACTIVE bed rows (AC B1) — retired beds are inventory history, not capacity. */
export function countBeds(beds: readonly SickbayBed[]): SickbayBedCounts {
  const active = beds.filter((b) => b.active);
  const isolation = active.filter((b) => b.isIsolation).length;
  return { general: active.length - isolation, isolation, total: active.length };
}

/**
 * A missing row coalesces to REFERRAL_ONLY + configured:false + zero counts (R25 · AC A5) — never
 * null, never a throw, never a fabricated capacity. Defaulting to FULL-with-8-beds would assert
 * clinical capacity a school never declared; REFERRAL_ONLY is both the safe default and the
 * statistical one (~49% of public SHS have no sickbay).
 */
export function coalesceSickbayConfig(
  schoolId: string,
  row: SickbaySettingsRow | null | undefined,
  beds: readonly SickbayBed[] = [],
): SickbayConfig {
  const mode = row?.mode ?? "REFERRAL_ONLY";
  return {
    schoolId,
    mode,
    configured: !!row?.configuredAt,
    capabilities: sickbayCapabilities(mode),
    matronUserId: row?.matronUserId ?? null,
    assistantMatronUserId: row?.assistantMatronUserId ?? null,
    visitingDoctorName: row?.visitingDoctorName ?? null,
    visitingDoctorAffiliation: row?.visitingDoctorAffiliation ?? null,
    beds: [...beds],
    bedCounts: countBeds(beds),
  };
}

// ============================================================================
// Slot ordering + anchor rules (R16 · AC C4/C5)
// ============================================================================

/** Chronological, the order the surface's hours table prints. */
export function sortSlots(slots: readonly SickbaySlot[]): SickbaySlot[] {
  return [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** The medication-round subset, ANCHOR FIRST, then chronological (R24 · getRoundSchedule). */
export function roundSchedule(slots: readonly SickbaySlot[]): SickbaySlot[] {
  return slots
    .filter((s) => s.kind === "MEDICATION_ROUND")
    .sort((a, b) => Number(b.isAnchor) - Number(a.isAnchor) || a.startsAt.localeCompare(b.startsAt));
}

/**
 * The anchor's TIME is editable (05:45 is still anchored) but it must start no later than every
 * other medication round (R16 · AC C5) — otherwise "morning round" sorts after the evening one and
 * INCR-24's ordering is nonsense. Returns a named error, or null when the move is legal.
 */
export function validateAnchorStart(
  slots: readonly SickbaySlot[],
  anchorId: string,
  newStartsAt: string,
): string | null {
  const later = slots.filter(
    (s) => s.id !== anchorId && s.kind === "MEDICATION_ROUND" && s.active && s.startsAt < newStartsAt,
  );
  if (later.length === 0) return null;
  const names = later.map((s) => `${s.label} (${s.startsAt})`).join(", ");
  return `The anchor round must start no later than every other medication round. ${names} already starts before ${newStartsAt}.`;
}

// ============================================================================
// Bed capacity reconcile — target, never delete (R11 · AC B4/B5)
// ============================================================================

export interface BedReconcilePlan {
  /** New rows to insert, numbered max+1 upward — never a reused gap (R8 · AC B4). */
  insert: { bedNumber: number; isIsolation: boolean }[];
  /** Bed ids to set active=false. A bed is NEVER hard-deleted. */
  deactivate: string[];
}

/**
 * Plan a capacity save as a TARGET RECONCILE. Increasing inserts `max+1…`; decreasing deactivates
 * the highest-numbered UNOCCUPIED beds in that pool. The two pools NEVER merge (R9) — a full
 * general pool does not overflow into isolation.
 *
 * If the target is unreachable without deactivating an occupied bed the WHOLE save is rejected with
 * a named error and NOTHING is applied (R11 · AC B5) — no partial application.
 *
 * `occupiedBedIds` is empty at INCR-21 (no admission table exists yet); INCR-22 passes the open
 * admissions' bed ids and the reject path lights up with no change here.
 */
export function planBedReconcile(
  beds: readonly SickbayBed[],
  target: { general: number; isolation: number },
  occupiedBedIds: readonly string[] = [],
): BedReconcilePlan | { error: string } {
  const occupied = new Set(occupiedBedIds);
  const plan: BedReconcilePlan = { insert: [], deactivate: [] };
  // max over ALL beds, active or retired, both pools — bed_number is unique per school and stable
  // for life, so the next number is always max+1 (AC B4: retire bed 4 → the next bed is 9).
  let nextNumber = beds.reduce((m, b) => Math.max(m, b.bedNumber), 0) + 1;

  for (const pool of ["general", "isolation"] as const) {
    const isIsolation = pool === "isolation";
    const want = target[pool];
    const active = beds
      .filter((b) => b.active && b.isIsolation === isIsolation)
      .sort((a, b) => a.bedNumber - b.bedNumber);
    if (want > active.length) {
      for (let i = active.length; i < want; i++) {
        plan.insert.push({ bedNumber: nextNumber++, isIsolation });
      }
    } else if (want < active.length) {
      const free = active.filter((b) => !occupied.has(b.id));
      const needed = active.length - want;
      if (free.length < needed) {
        const label = isIsolation ? "isolation" : "general";
        return {
          error:
            `Cannot reduce to ${want} ${label} bed${want === 1 ? "" : "s"} — only ${free.length} of ` +
            `the ${active.length} are unoccupied. Discharge or move those patients first. Nothing was saved.`,
        };
      }
      // Highest-numbered free beds retire first; the low numbers a visit record cites stay.
      plan.deactivate.push(
        ...free
          .slice(-needed)
          .map((b) => b.id),
      );
    }
  }
  return plan;
}

// ============================================================================
// Canonical config — the 7 slots of R13, VERBATIM from setup §02
// ============================================================================

/** A slot before it has a row id — the seed and `Reset to defaults` both insert these. */
export type CanonicalSlot = Omit<SickbaySlot, "id">;

/**
 * The canonical Mode-A/B day (R13). The setup surface IS the config spine, so the `today` surface's
 * 17:00 round and the chronic register's 13:00 column are demo drift and LOSE. The canonical
 * medication rounds are THREE: 06:30 / 12:30 / 21:00. Descriptions are STORED — when the matron is
 * on leave the description is the handoff document.
 */
export const CANONICAL_SICKBAY_SLOTS: readonly CanonicalSlot[] = [
  {
    kind: "MEDICATION_ROUND",
    label: "Morning medication round",
    description: "Chronic-condition students collect dose · sickle cell hydration check",
    startsAt: "06:30",
    endsAt: "07:00",
    staffing: "Matron + Prefect",
    daysOfWeek: [1, 2, 3, 4, 5],
    runsOnHolidays: false, // → "Every school day"
    isAnchor: true,
    active: true,
  },
  {
    kind: "CLINIC",
    label: "Morning clinic",
    description: "Walk-in · students before assembly",
    startsAt: "07:00",
    endsAt: "08:00",
    staffing: "Matron",
    daysOfWeek: [1, 2, 3, 4, 5],
    runsOnHolidays: false, // → "Every school day"
    isAnchor: false,
    active: true,
  },
  {
    kind: "CLINIC",
    label: "Daytime clinic",
    description: "Walk-ins with HM exeat slip from class",
    startsAt: "10:00",
    endsAt: "17:00",
    staffing: "Matron",
    daysOfWeek: [1, 2, 3, 4, 5],
    runsOnHolidays: true, // → "Mon · Tue · Wed · Thu · Fri" (literal weekdays, not the term calendar)
    isAnchor: false,
    active: true,
  },
  {
    kind: "MEDICATION_ROUND",
    label: "Noon medication round",
    description: "Mid-day chronic doses · post-lunch",
    startsAt: "12:30",
    endsAt: "13:00",
    staffing: "Matron",
    daysOfWeek: [1, 2, 3, 4, 5],
    runsOnHolidays: false, // → "Every school day"
    isAnchor: false,
    active: true,
  },
  {
    kind: "DOCTOR_VISIT",
    label: "Visiting doctor",
    description: "Admissions reviewed",
    startsAt: "14:00",
    endsAt: "17:00",
    staffing: "Doctor + Matron",
    daysOfWeek: [4],
    runsOnHolidays: false, // → "Thursdays"
    isAnchor: false,
    active: true,
  },
  {
    kind: "MEDICATION_ROUND",
    label: "Evening medication round",
    description: "After prep · pre-bed doses",
    startsAt: "21:00",
    endsAt: "21:30",
    staffing: "Matron or Asst.",
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    runsOnHolidays: false, // → "Every day incl. weekend"
    isAnchor: false,
    active: true,
  },
  {
    kind: "ON_CALL",
    label: "On-call overnight",
    description: "Asst. Matron sleeps in adjoining room",
    startsAt: "22:00",
    endsAt: "06:00", // wraps midnight — VALID (AC C8)
    staffing: "Asst. Matron",
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    runsOnHolidays: true, // → "Every day · 365"
    isAnchor: false,
    active: true,
  },
];

// ============================================================================
// Static editorial (R26/R28) — verbatim surface copy, never computed, never stored
// ============================================================================

export interface SickbayModeCard {
  mode: SickbayMode;
  tag: string;
  name: string;
  nameEm: string;
  desc: string;
  /** `**bold**` fragments render as <b>; split with splitBold(). */
  stat: string;
}

/**
 * The three mode cards, surface §01 verbatim. The percentages ship AS WRITTEN (R28): they do NOT
 * sum to 105% — the third is a percentage of the ~49% of schools *without* a sickbay, a different
 * denominator. Never computed, never stored, never a seed column.
 */
export const SICKBAY_MODE_CARDS: readonly SickbayModeCard[] = [
  {
    mode: "FULL",
    tag: "Mode A",
    name: "Full ",
    nameEm: "sickbay",
    desc: "Beds, isolation ward, resident matron, visiting doctor, drug stock. Can admit overnight, manage outbreaks on-site, run scheduled medication rounds.",
    stat: "Typical for **Cat. A** schools · ~16% of public SHS",
  },
  {
    mode: "FIRST_AID",
    tag: "Mode B",
    name: "First-aid ",
    nameEm: "station",
    desc: "Matron on-site, basic capacity for short-stay observation, drug stock, weekly visiting doctor. Refers serious cases to district hospital within hours.",
    stat: "Typical for **Cat. B–C** schools · ~30% of public SHS",
  },
  {
    mode: "REFERRAL_ONLY",
    tag: "Mode C",
    name: "Referral ",
    nameEm: "only",
    desc: "No sickbay. School Health Prefect roster handles first response, all cases route to nearest hospital. SHEP-coordinated, no on-site clinical capacity.",
    stat: "~59% of public SHS without sickbays use this",
  },
];

/**
 * The two §5 policy anchors — FROZEN CONSTANTS, not a per-school `notes_json` (R26). Identical
 * static editorial for every school: a per-tenant free-text column invites drift in a regulatory
 * citation (LI 683, 1971). Both cards render in EVERY mode — SHEP is *more* relevant to a Mode-C
 * school, whose prefect roster is the entire front line.
 */
export const SICKBAY_POLICY_ANCHORS: readonly PolicyAnchor[] = [
  {
    eyebrow: "GES side",
    title: "SHEP · ",
    titleEm: "School Health Education Programme",
    body: "The Ghana Education Service's unit responsible for school-based health promotion and delivery. SHEP coordinates the **School Health Prefect roster**, sets the curriculum for health education, and links public schools to district health teams. The sickbay's prefects, drug stock guidance, and outbreak reporting all sit under SHEP.",
  },
  {
    eyebrow: "MoH side",
    title: "N&MC · ",
    titleEm: "Scope of Practice",
    body: "Nursing and Midwifery Council of Ghana, the statutory regulator (LI 683, 1971). The **Matron's clinical authority** derives from her N&MC license and her registered standing orders with the visiting doctor. Anything outside scope routes to Dr Mensah or the hospital. The N&MC license number is captured on the staff record and shows on every dispensary action she signs.",
  },
];

/** Fixed editorial labels on the two bed tiles — copy, not data. */
export const BED_TILE_COPY = {
  general: { label: "General beds", desc: "Mixed-use · short observation" },
  isolation: { label: "Isolation beds", desc: "Cross-infection containment" },
} as const;

/**
 * Mode C's §2 substitute (R5) — ONE explanatory panel that NAMES why the section is absent.
 * Assembled from Mode C's own card copy so the voice stays the surface's. Never `0/0`, never `—`,
 * never a disabled control, never a PLACEHOLDER badge.
 */
export const MODE_C_CAPACITY_PANEL = {
  heading: "Capacity & hours",
  body: "Referral-only operation · no on-site beds, no medication rounds, no admissions. The School Health Prefect roster is first response; every case routes to a referral hospital.",
} as const;

/**
 * The clinical-staff card title per post. Mode C keeps the same `matron_user_id` pointer and the
 * same MATRON role but renames the post — a Mode-C school designates a health focal person, not a
 * matron (owner escalation E1, defaulted to the recommendation).
 */
export function staffDesignation(post: SickbayStaffPost, mode: SickbayMode): string {
  if (post === "VISITING_DOCTOR") return "Visiting doctor";
  if (mode === "REFERRAL_ONLY") {
    return post === "SENIOR_MATRON"
      ? "School Health Coordinator · SHEP"
      : "Assistant Health Coordinator · SHEP";
  }
  return post === "SENIOR_MATRON" ? "Senior Matron" : "Assistant Matron";
}

// ============================================================================
// Tiny render helpers (pure — the components hold no copy of their own)
// ============================================================================

/** Split `a **b** c` into ["a ", "b", " c"] — ODD indices render bold. */
export function splitBold(s: string): string[] {
  return s.split(/\*\*(.+?)\*\*/);
}

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "rev", "madam"]);

/**
 * Avatar glyph — the honorific is dropped, then first initial + surname initial:
 * "Mrs Akua Bediako" → `AB`, "Ms Grace Antwi" → `GA` (both surface-exact). The surface draws `DM`
 * for "Dr K. Mensah" (honorific + surname); this rule yields `KM` — one glyph's deviation, taken so
 * that ONE rule covers every name rather than a special case for titled clinicians.
 */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p && !HONORIFICS.has(p.replace(/\./g, "").toLowerCase()));
  if (parts.length === 0) return "—";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

const PROGRAMME_ABBR: Record<string, string> = {
  GENERAL_ARTS: "GA",
  GENERAL_SCIENCE: "GS",
  BUSINESS: "BUS",
  AGRICULTURE: "AGRIC",
  VISUAL_ARTS: "VA",
  HOME_ECONOMICS: "HE",
  TECHNICAL: "TECH",
};

/**
 * The prefect row's form label — `F3 BUS` (form + programme short code), else `F3`, else the class
 * name, else `—`. Mirrors the boarding roster's grammar so the two surfaces read alike.
 */
export function formLabel(
  level: string | null,
  className: string | null,
  programme: string | null,
): string {
  const m = `${level ?? ""} ${className ?? ""}`.match(/(?:Form|F)\s*([123])/i);
  const form = m ? Number(m[1]) : null;
  if (form && programme) return `F${form} ${PROGRAMME_ABBR[programme] ?? programme}`;
  if (form) return `F${form}`;
  return className ?? "—";
}
