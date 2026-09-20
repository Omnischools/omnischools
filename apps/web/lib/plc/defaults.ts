/**
 * PLC programme-setup frozen contract (SHS module 4.6 / INCR-47) — PURE, DB-free, unit-tested
 * (plc-defaults.test.ts). The Friday counterpart to VLC's Wednesday F0 (lib/vlc/defaults.ts), but
 * DELIBERATELY THINNER: staff CPD has NO frozen value/canon library (R375 — a school's term focus
 * starts BLANK, the sharp difference from VLC's 11 seeded values). This file holds exactly two things:
 *   • `coalescePlcProgramme` — a missing plc_programme row → the frozen Friday defaults + configured:false,
 *     never null/throw (R370); session_end & max_pts_per_session are DERIVED here, never stored (R371).
 *   • `PLC_TYPE_SEMANTICS` — mandatoriness / cadence / accent DERIVE from `plc.type` (R376 — pure map,
 *     NO mandatory/voluntary/induction column). NTC induction (new-teacher) is DEFERRED / omitted.
 *
 * Time-of-day maths (session end) comes from the shared lib/senior/time.ts (the same helpers VLC uses).
 */
import { addMinutes, formatClockTime, formatClockRange } from "@/lib/senior/time";

/** ISO weekday 1 = Monday … 7 = Sunday. Friday (5) is the frozen PLC default (R370). */
export const PLC_DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** The frozen cadence + CPD-contract defaults (R370/R371) — mirror the plc_programme column defaults. */
export const PLC_DEFAULTS = {
  sessionDay: 5, // Friday
  sessionStart: "15:30",
  sessionLengthMin: 60,
  weeksPerSemester: 12,
  ptsPerAttendedSession: 0.5,
  ptsPerReflection: 0.5,
  reflectionWindowHours: 48,
  annualPlcTarget: 8,
} as const;

// ============================================================================
// PLC type semantics — mandatoriness / cadence / accent DERIVE from `type` (R376). NO stored columns.
// ============================================================================

export const PLC_TYPES = ["subject", "cross-cutting", "new-teacher"] as const;
export type PlcType = (typeof PLC_TYPES)[number];

export interface PlcTypeSemantics {
  /** Human label for the card's type row, e.g. "Subject-based". */
  label: string;
  /** DERIVED (R376): subject & new-teacher are mandatory; cross-cutting is voluntary. */
  mandatory: boolean;
  /** DERIVED: subject/new-teacher run weekly; a cross-cutting group may meet weekly OR biweekly. */
  cadence: "weekly" | "weekly-or-biweekly";
  /** The card border/icon accent — maps to a solid brand token, never a raw-hex slash-opacity. */
  accent: "navy" | "gold" | "green";
}

export const PLC_TYPE_SEMANTICS: Record<PlcType, PlcTypeSemantics> = {
  subject: { label: "Subject-based", mandatory: true, cadence: "weekly", accent: "navy" },
  "cross-cutting": {
    label: "Cross-cutting",
    mandatory: false,
    cadence: "weekly-or-biweekly",
    accent: "gold",
  },
  // NTC induction milestone (new-teacher) is DEFERRED — omitted here, never faked.
  "new-teacher": { label: "New-teacher support", mandatory: true, cadence: "weekly", accent: "green" },
};

/** Narrow an arbitrary stored string to a known PlcType, defaulting to "subject" (the DB CHECK guards it). */
export function plcTypeOf(type: string): PlcType {
  return (PLC_TYPES as readonly string[]).includes(type) ? (type as PlcType) : "subject";
}

// ============================================================================
// The 3 FIXED post-session CPD reflection questions (R387, SHS module 4.6 / INCR-48) — school-generic,
// NOT configurable, NOT stored. The plc_session_reflection q1/q2/q3 columns hold the ANSWERS; these are
// the PROMPTS, frozen here so the live register (48) and any later CPD statement render identical
// wording. Surface-exact (schoolup-plc-session-register.html, the reflection-prompt block).
// ============================================================================
export const PLC_REFLECTION_QUESTIONS = [
  "What's the most useful thing you learned in this session that you can use in your classroom next week?",
  "What's one action you commit to taking before the next session?",
  "What's one question or topic you'd like to raise at the next session?",
] as const;

// ============================================================================
// Programme coalesce — a missing plc_programme row is legal and meaningful (R370)
// ============================================================================

/** The columns the reader selects off plc_programme. numeric() columns come back as strings from pg. */
export interface PlcProgrammeRow {
  sessionDay: number;
  sessionStart: string;
  sessionLengthMin: number;
  weeksPerSemester: number;
  ptsPerAttendedSession: string | number;
  ptsPerReflection: string | number;
  reflectionWindowHours: number;
  annualPlcTarget: string | number;
  configuredAt: Date | null;
}

export interface PlcProgramme {
  sessionDay: number;
  sessionStart: string; // "HH:MM" (24h)
  sessionLengthMin: number;
  weeksPerSemester: number;
  dayName: string; // "Friday"
  startLabel: string; // "3:30 PM"
  endLabel: string; // "4:30 PM" — DERIVED (start + length), never stored
  windowLabel: string; // "3:30 PM to 4:30 PM"
  ptsPerAttendedSession: number;
  ptsPerReflection: number;
  reflectionWindowHours: number;
  annualPlcTarget: number;
  /** DERIVED (R371): attended + reflection, 1.0 by default. Never stored. */
  maxPtsPerSession: number;
  /** false when the school has never declared a schedule (configured_at IS NULL) — NOT a freeze. */
  configured: boolean;
}

const num = (v: string | number | null | undefined, fallback: number): number => {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Round a points sum to 2dp so 0.5 + 0.5 prints as 1 (not 1.0000000002). */
const pts = (n: number): number => Math.round(n * 100) / 100;

/**
 * A missing row coalesces to the frozen Friday-3:30 defaults + configured:false (mirrors
 * coalesceVlcProgramme) — never null, never a throw, never a fabricated row. `configured` reads
 * `configured_at`, which distinguishes "declared" from "never configured".
 */
export function coalescePlcProgramme(row: PlcProgrammeRow | null | undefined): PlcProgramme {
  const sessionDay = row?.sessionDay ?? PLC_DEFAULTS.sessionDay;
  const sessionStart = row?.sessionStart ?? PLC_DEFAULTS.sessionStart;
  const sessionLengthMin = row?.sessionLengthMin ?? PLC_DEFAULTS.sessionLengthMin;
  const endHHMM = addMinutes(sessionStart, sessionLengthMin);
  const start = formatClockTime(sessionStart);
  const end = formatClockTime(endHHMM);
  const ptsAttended = pts(num(row?.ptsPerAttendedSession, PLC_DEFAULTS.ptsPerAttendedSession));
  const ptsReflection = pts(num(row?.ptsPerReflection, PLC_DEFAULTS.ptsPerReflection));
  return {
    sessionDay,
    sessionStart,
    sessionLengthMin,
    weeksPerSemester: row?.weeksPerSemester ?? PLC_DEFAULTS.weeksPerSemester,
    dayName: PLC_DAY_NAMES[Math.min(Math.max(sessionDay, 1), 7) - 1],
    startLabel: `${start.time} ${start.meridiem}`,
    endLabel: `${end.time} ${end.meridiem}`,
    windowLabel: formatClockRange(sessionStart, endHHMM),
    ptsPerAttendedSession: ptsAttended,
    ptsPerReflection: ptsReflection,
    reflectionWindowHours: row?.reflectionWindowHours ?? PLC_DEFAULTS.reflectionWindowHours,
    annualPlcTarget: pts(num(row?.annualPlcTarget, PLC_DEFAULTS.annualPlcTarget)),
    maxPtsPerSession: pts(ptsAttended + ptsReflection),
    configured: !!row?.configuredAt,
  };
}
