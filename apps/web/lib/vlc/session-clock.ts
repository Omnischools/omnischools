/**
 * VLC session lifecycle derivations (SHS module 4.5 / INCR-42a) — PURE, DB-free, unit-tested. The
 * lifecycle bar, the agenda windows, the phase state (done/active/pending), the "auto-locked at 3:33"
 * write guard and the present/late/absent counts ALL derive HERE from the F0 programme + the session
 * date — NOTHING is stored (R311/R312/R315: no started_at, no phase/status/locked column, no
 * present_count/rate/late_count). The windows key off the *scheduled* start (owner-call minor,
 * DEFAULTED — a truthful live clock with a real started_at can be added later with no migration pain).
 *
 * Ghana runs on GMT (UTC+0, no DST), so the school's "14:30" is 14:30Z — a session_date + an "HH:MM"
 * window compose into a UTC instant with no offset maths (the prep_attendance tz-boundary discipline).
 */
import { addMinutes, formatVlcTime, type VlcProgramme } from "./defaults";

export type PhaseState = "done" | "active" | "pending";

export interface PhaseWindow {
  field: VlcProgramme["phases"][number]["field"];
  name: string;
  who: string;
  description: string;
  min: number;
  /** "HH:MM" (24h) window bounds, accumulated from the programme's scheduled start. */
  startHHMM: string;
  endHHMM: string;
  /** "2:33 — 2:38" (12h, en-dash) — surface-exact via formatVlcTime. */
  windowLabel: string;
}

/** "2:33" (drop the meridiem — the lifecycle stage-time prints bare times). */
function bare(hhmm: string): string {
  return formatVlcTime(hhmm).time;
}

/**
 * The five phase windows, accumulated from `programme.sessionStart` + each phase's minutes (the F0
 * `endTime` derivation, per-phase). Order is LOCKED by VLC_PHASES; no window is stored.
 */
export function derivePhaseWindows(programme: VlcProgramme): PhaseWindow[] {
  let cursor = programme.sessionStart;
  return programme.phases.map((p) => {
    const startHHMM = cursor;
    const endHHMM = addMinutes(cursor, p.min);
    cursor = endHHMM;
    return {
      field: p.field,
      name: p.name,
      who: p.who,
      description: p.description,
      min: p.min,
      startHHMM,
      endHHMM,
      windowLabel: `${bare(startHHMM)} — ${bare(endHHMM)}`,
    };
  });
}

/** Compose a session_date ("YYYY-MM-DD") + an "HH:MM" window bound into a UTC instant (Ghana = GMT). */
export function sessionInstant(sessionDate: string, hhmm: string): Date {
  return new Date(`${sessionDate}T${hhmm}:00.000Z`);
}

export interface PhaseClock {
  windows: (PhaseWindow & { state: PhaseState })[];
  /** Index of the LIVE phase, or -1 (before start / after close). */
  activeIndex: number;
  /** Whole minutes since the scheduled start (clamped ≥ 0; capped at the total). */
  elapsedMin: number;
  /** Whole minutes until the scheduled close (clamped ≥ 0). */
  remainingMin: number;
  /** Count of phases whose window has fully elapsed. */
  phasesComplete: number;
  totalMin: number;
  /** The Close-phase end ("3:33 PM") — the auto-lock anchor. */
  closeLabel: string;
}

/**
 * Resolve each phase to done/active/pending against `now`, keyed to the session's scheduled windows on
 * `sessionDate`. Before the start every phase is pending; after the close every phase is done. Elapsed /
 * remaining / phasesComplete derive from the same instants — never stored.
 */
export function derivePhaseClock(
  programme: VlcProgramme,
  sessionDate: string,
  now: Date = new Date(),
): PhaseClock {
  const windows = derivePhaseWindows(programme);
  const nowMs = now.getTime();
  const startMs = sessionInstant(sessionDate, programme.sessionStart).getTime();
  const endMs = sessionInstant(sessionDate, programme.endTime).getTime();

  let activeIndex = -1;
  const resolved = windows.map((w, i) => {
    const s = sessionInstant(sessionDate, w.startHHMM).getTime();
    const e = sessionInstant(sessionDate, w.endHHMM).getTime();
    let state: PhaseState;
    if (nowMs >= e) state = "done";
    else if (nowMs >= s) {
      state = "active";
      if (activeIndex === -1) activeIndex = i;
    } else state = "pending";
    return { ...w, state };
  });

  const elapsedMin = Math.max(0, Math.min(programme.totalMin, Math.floor((nowMs - startMs) / 60000)));
  const remainingMin = Math.max(0, Math.ceil((endMs - nowMs) / 60000));
  const phasesComplete = resolved.filter((w) => w.state === "done").length;
  const close = formatVlcTime(programme.endTime);
  return {
    windows: resolved,
    activeIndex,
    elapsedMin,
    remainingMin,
    phasesComplete,
    totalMin: programme.totalMin,
    closeLabel: `${close.time} ${close.meridiem}`,
  };
}

/**
 * The R312 auto-lock: a session's register is READ-ONLY once its derived programme window has fully
 * elapsed (session_date + the derived Close-phase end < now). App-layer late-edit guard — there is NO
 * stored `locked`/`closed` column; the boundary derives every time, so a write after 3:33 is refused.
 */
export function isSessionWriteLocked(
  programme: VlcProgramme,
  sessionDate: string,
  now: Date = new Date(),
): boolean {
  return now.getTime() >= sessionInstant(sessionDate, programme.endTime).getTime();
}

export interface AttendanceCounts {
  enrolled: number;
  present: number;
  late: number;
  absent: number;
  /** Whole-percent present of enrolled (0 when the class is empty). */
  presentPct: number;
}

/**
 * Present-by-default derivation (R315): present = enrolled − ABSENT rows; LATE is a PRESENT sub-state, so
 * a late student still counts present. Every count derives from the enrolled roster + the not-present
 * rows — nothing is stored.
 */
export function deriveAttendanceCounts(enrolled: number, lateCount: number, absentCount: number): AttendanceCounts {
  const present = Math.max(0, enrolled - absentCount);
  return {
    enrolled,
    present,
    late: lateCount,
    absent: absentCount,
    presentPct: enrolled > 0 ? Math.round((present / enrolled) * 100) : 0,
  };
}
