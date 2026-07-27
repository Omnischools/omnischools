/**
 * VLC F0 frozen contract (SHS module 4.5 / INCR-40) — PURE, DB-free, unit-tested (vlc-f0.test.ts).
 *
 * THE SOURCE OF TRUTH for the whole Values Learning Communities config spine: the Wednesday cadence,
 * the five locked phases, the three-term arc, the eleven canonical values (English + Twi), and each
 * value's two session templates (slot A intro / slot B application). Every string here is copied
 * VERBATIM from Surfaces/schoolup-vlc-programme-setup.html — the Twi diacritics are locked content
 * (Asɛyɛde, Akwankyerɛ, Boasetɔ, Mmɔborɔhunu, Ɔman dɔ). Do not simplify.
 *
 * The server reader (lib/vlc/setup-data.ts) fetches rows through withSchool and coalesces to these
 * defaults when a school has no vlc_programme row (the sickbay defaults/config split, verbatim), so
 * the tests never import the DB driver.
 *
 * Two disciplines this file enforces (mirroring the schema's "no derived / no frozen-lib duplicate"):
 *   • counts are DERIVED, never stored — `vlcSessionCount(values)` gives 22, `VLC_VALUES.length` gives
 *     11; nothing anywhere stores "11" or "22".
 *   • the five phase NAMES/roles and the three arc phases are frozen editorial here, identical for
 *     every school — the DB stores only the editable durations + value/prompt text.
 */

// ============================================================================
// Cadence — Wednesday, 2:30 PM (the frozen defaults; a school may adjust both)
// ============================================================================

/** ISO weekday 3 = Wednesday; "HH:MM" start. Wednesday specifically because PLC is Friday. */
export const VLC_CADENCE = { sessionDay: 3, sessionStart: "14:30" } as const;

/** ISO weekday 1 = Monday … 7 = Sunday. */
export const VLC_DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

// ============================================================================
// The five phases — names/roles/order LOCKED; only the durations are editable
// ============================================================================

/** `field` maps 1:1 onto the editable vlc_programme duration column. */
export interface VlcPhase {
  field: "openerMin" | "smallGroupMin" | "plenaryMin" | "reflectionMin" | "closeMin";
  name: string;
  who: string;
  description: string;
  defaultMin: number;
}

export const VLC_PHASES: readonly VlcPhase[] = [
  {
    field: "openerMin",
    name: "Opener",
    who: "FM frames",
    description: "Value of the week introduced · today's focus question posed",
    defaultMin: 5,
  },
  {
    field: "smallGroupMin",
    name: "Small groups",
    who: "PGs lead",
    description:
      "Class splits in two · each Peer Guide leads 4-5 students through the discussion prompts",
    defaultMin: 25,
  },
  {
    field: "plenaryMin",
    name: "Plenary",
    who: "FM moderates",
    description: "Each group shares back · class hears the range of perspectives",
    defaultMin: 15,
  },
  {
    field: "reflectionMin",
    name: "Reflection",
    who: "Silent · journal",
    description: "Each student writes a private journal entry · append-only",
    defaultMin: 10,
  },
  {
    field: "closeMin",
    name: "Close",
    who: "FM closes",
    description: "Next week's value previewed · session formally closed",
    defaultMin: 5,
  },
];

// ============================================================================
// The three-term arc — names + subtitles frozen; sequence LOCKED (read-only in F0)
// ============================================================================

export interface VlcArc {
  group: 1 | 2 | 3;
  name: string;
  /** The italic accent, e.g. "· self-formation". */
  subtitle: string;
  termLab: string;
  valuesSub: string;
  accent: "gold" | "green" | "terra";
}

export const VLC_TERM_ARCS: readonly VlcArc[] = [
  {
    group: 1,
    name: "Foundations",
    subtitle: "· self-formation",
    termLab: "Semester 1 · Sept — Dec",
    valuesSub: "Values 1—4 · weeks 1—9 · 4 values × 2 sessions = 8 sessions",
    accent: "gold",
  },
  {
    group: 2,
    name: "Interpersonal",
    subtitle: "· toward others",
    termLab: "Semester 2 · Jan — Apr",
    valuesSub: "Values 5—8 · weeks 14—22 · 4 values × 2 sessions = 8 sessions",
    accent: "green",
  },
  {
    group: 3,
    name: "Integration",
    subtitle: "· into community",
    termLab: "Semester 2 · May — Aug",
    valuesSub: "Values 9—11 · weeks 26—30 · 3 values × 2 sessions = 6 sessions",
    accent: "terra",
  },
];

// ============================================================================
// The eleven canonical values + their two session templates — VERBATIM
// ============================================================================

/** slot A = intro, slot B = application. `prompt` is the subtitle after the "·" on the surface. */
export interface VlcSessionDefault {
  slot: "A" | "B";
  title: string;
  prompt: string;
}

/**
 * `descriptor` is the vc-twi tail on the surface ("foundation value") — frozen editorial, NOT a
 * stored column (the schema keeps only name_twi). `capstone` is a static property of value 11.
 */
export interface VlcValueDefault {
  ordinal: number;
  nameEn: string;
  nameTwi: string;
  descriptor: string;
  termGroup: 1 | 2 | 3;
  capstone: boolean;
  sessions: readonly [VlcSessionDefault, VlcSessionDefault];
}

export const VLC_VALUES: readonly VlcValueDefault[] = [
  {
    ordinal: 1,
    nameEn: "Respect",
    nameTwi: "Obu",
    descriptor: "foundation value",
    termGroup: 1,
    capstone: false,
    sessions: [
      { slot: "A", title: "What is respect?", prompt: "for self, for elders, for peers" },
      { slot: "B", title: "Respect in practice", prompt: "how we speak, listen, disagree" },
    ],
  },
  {
    ordinal: 2,
    nameEn: "Integrity",
    nameTwi: "Nokwaredi",
    descriptor: "honesty & consistency",
    termGroup: 1,
    capstone: false,
    sessions: [
      { slot: "A", title: "Truth-telling", prompt: "why it costs, why it matters" },
      { slot: "B", title: "When no one is watching", prompt: "who you are alone" },
    ],
  },
  {
    ordinal: 3,
    nameEn: "Responsibility",
    nameTwi: "Asɛyɛde",
    descriptor: "ownership of self & tasks",
    termGroup: 1,
    capstone: false,
    sessions: [
      { slot: "A", title: "What's mine to own", prompt: "circles of responsibility" },
      { slot: "B", title: "Excuses and accountability", prompt: "catching the slip" },
    ],
  },
  {
    ordinal: 4,
    nameEn: "Discipline",
    nameTwi: "Akwankyerɛ",
    descriptor: "self-direction",
    termGroup: 1,
    capstone: false,
    sessions: [
      { slot: "A", title: "Doing what must be done", prompt: "even when hard" },
      { slot: "B", title: "Habit and routine", prompt: "small choices, big results" },
    ],
  },
  {
    ordinal: 5,
    nameEn: "Perseverance",
    nameTwi: "Boasetɔ",
    descriptor: "endurance under difficulty",
    termGroup: 2,
    capstone: false,
    sessions: [
      { slot: "A", title: "When things are hard", prompt: "stories of endurance" },
      { slot: "B", title: "Failing forward", prompt: "how to fail and continue" },
    ],
  },
  {
    ordinal: 6,
    nameEn: "Compassion",
    nameTwi: "Mmɔborɔhunu",
    descriptor: "seeing the other's burden",
    termGroup: 2,
    capstone: false,
    sessions: [
      { slot: "A", title: "Noticing the unseen", prompt: "who is left out" },
      { slot: "B", title: "Compassion in action", prompt: "what helping really looks like" },
    ],
  },
  {
    ordinal: 7,
    nameEn: "Patriotism",
    nameTwi: "Ɔman dɔ",
    descriptor: "love of country, civic duty",
    termGroup: 2,
    capstone: false,
    sessions: [
      { slot: "A", title: "What Ghana means to me", prompt: "belonging beyond family" },
      { slot: "B", title: "Service project planning", prompt: "today · what we will do" },
    ],
  },
  {
    ordinal: 8,
    nameEn: "Tolerance",
    nameTwi: "Asomdwoe",
    descriptor: "peaceful difference",
    termGroup: 2,
    capstone: false,
    sessions: [
      { slot: "A", title: "Tribe, faith, region", prompt: "the diversity we live with" },
      { slot: "B", title: "Disagreeing well", prompt: "making space without losing self" },
    ],
  },
  {
    ordinal: 9,
    nameEn: "Service",
    nameTwi: "Adwumayɛ",
    descriptor: "using what you have for others",
    termGroup: 3,
    capstone: false,
    sessions: [
      { slot: "A", title: "What service is not", prompt: "service vs charity vs duty" },
      { slot: "B", title: "Service project execution", prompt: "paired with Value 7B" },
    ],
  },
  {
    ordinal: 10,
    nameEn: "Excellence",
    nameTwi: "Papayɛ",
    descriptor: "doing what is good, well",
    termGroup: 3,
    capstone: false,
    sessions: [
      { slot: "A", title: "The whole work", prompt: "finishing what you start, well" },
      { slot: "B", title: "Quiet excellence", prompt: "without praise, without audience" },
    ],
  },
  {
    ordinal: 11,
    nameEn: "Wisdom",
    nameTwi: "Nyansa",
    descriptor: "capstone · integration",
    termGroup: 3,
    capstone: true,
    sessions: [
      { slot: "A", title: "What the year taught me", prompt: "pulling threads together" },
      { slot: "B", title: "Carrying forward", prompt: "what stays with you after this year" },
    ],
  },
];

/** Frozen editorial (descriptor / capstone) keyed by ordinal — attached to stored rows by the reader. */
export const VLC_VALUE_BY_ORDINAL: ReadonlyMap<number, VlcValueDefault> = new Map(
  VLC_VALUES.map((v) => [v.ordinal, v]),
);

/** The number of session templates the value set implies — DERIVED, never stored (22 for the canon). */
export function vlcSessionCount(values: readonly { sessions: readonly unknown[] }[]): number {
  return values.reduce((n, v) => n + v.sessions.length, 0);
}

// ============================================================================
// Programme coalesce — a missing vlc_programme row is legal and meaningful
// ============================================================================

/** The columns the reader selects off vlc_programme. */
export interface VlcProgrammeRow {
  sessionDay: number;
  sessionStart: string;
  openerMin: number;
  smallGroupMin: number;
  plenaryMin: number;
  reflectionMin: number;
  closeMin: number;
  configuredAt: Date | null;
}

export interface VlcProgrammePhase {
  field: VlcPhase["field"];
  name: string;
  who: string;
  description: string;
  min: number;
}

export interface VlcProgramme {
  sessionDay: number;
  sessionStart: string;
  dayName: string;
  phases: VlcProgrammePhase[];
  totalMin: number;
  /** "HH:MM" — start + totalMin (DERIVED, never stored: schema omits session_end / total_minutes). */
  endTime: string;
  /** false when the school has never declared a schedule — NOT a freeze. */
  configured: boolean;
}

/**
 * A missing row coalesces to the frozen Wednesday-2:30 defaults + configured:false (mirrors
 * coalesceSickbayConfig) — never null, never a throw, never a fabricated row. `configured` reads
 * `configured_at`, which distinguishes "declared" from "never configured".
 */
export function coalesceVlcProgramme(row: VlcProgrammeRow | null | undefined): VlcProgramme {
  const sessionDay = row?.sessionDay ?? VLC_CADENCE.sessionDay;
  const sessionStart = row?.sessionStart ?? VLC_CADENCE.sessionStart;
  const phases: VlcProgrammePhase[] = VLC_PHASES.map((p) => ({
    field: p.field,
    name: p.name,
    who: p.who,
    description: p.description,
    min: row ? row[p.field] : p.defaultMin,
  }));
  const totalMin = phases.reduce((n, p) => n + p.min, 0);
  return {
    sessionDay,
    sessionStart,
    dayName: VLC_DAY_NAMES[Math.min(Math.max(sessionDay, 1), 7) - 1],
    phases,
    totalMin,
    endTime: addMinutes(sessionStart, totalMin),
    configured: !!row?.configuredAt,
  };
}

// ============================================================================
// Time formatters — "14:30" → "2:30" + "PM" exactly as the cal-block prints it
// ============================================================================

/** Split "HH:MM" into a 12-hour clock time + meridiem. "14:30" → { time: "2:30", meridiem: "PM" }. */
export function formatVlcTime(hhmm: string): { time: string; meridiem: "AM" | "PM" } {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const hour = Number.isFinite(h) ? h : 0;
  const min = Number.isFinite(m) ? m : 0;
  const meridiem = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 || 12;
  return { time: `${twelve}:${String(min).padStart(2, "0")}`, meridiem };
}

/** Add minutes to an "HH:MM" clock time, wrapping at 24h. */
export function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const total = (((h || 0) * 60 + (m || 0) + mins) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** The cal-block / heading label, e.g. "2:30 — 3:30 PM" (en-dash, spaced — surface-exact). */
export function formatVlcWindow(start: string, end: string): string {
  const s = formatVlcTime(start);
  const e = formatVlcTime(end);
  return `${s.time} — ${e.time} ${e.meridiem}`;
}
