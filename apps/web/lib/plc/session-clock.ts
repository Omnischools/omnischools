/**
 * PLC session lifecycle derivations (SHS module 4.6 / INCR-48 · R381/R390) — PURE, DB-free, unit-tested
 * (session-clock.test.ts). The lifecycle state (SCHEDULED/HELD/MISSED), the 4 lifecycle pills, the
 * elapsed/remaining clock, the reflection window [scheduled close, close + reflection_window_hours] and
 * the register write-lock ALL derive HERE from the coalesced programme cadence + the session date —
 * NOTHING is stored (R381/R390: no status / started_at / closed_at / held_at column). Ghana runs on GMT
 * (UTC+0, no DST), so a session_date + an "HH:MM" compose into a UTC instant with no offset maths (the
 * vlc_session / prep_attendance tz-boundary discipline).
 *
 * ponytail: the register write-lock is the END of the reflection window — a facilitator may fix
 * attendance/agenda through the live hour AND the 48h reflection tail, then it settles. `confirmReflection`
 * is deliberately NOT subject to this lock (R389 — the facilitator confirms in the NEXT session, days
 * later); tighten to scheduled-close if a school ever wants the register frozen at the bell.
 */
import { addMinutes, formatClockTime } from "@/lib/senior/time";
import type { PlcProgramme } from "./defaults";

const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

/** Compose a session_date ("YYYY-MM-DD") + an "HH:MM" window bound into a UTC instant (Ghana = GMT). */
export function plcSessionInstant(sessionDate: string, hhmm: string): Date {
  return new Date(`${sessionDate}T${hhmm}:00.000Z`);
}

/**
 * The "YYYY-MM-DD" of ISO weekday `sessionDay` (1=Mon…7=Sun) in the Mon–Sun week containing `now` (UTC).
 * The cadence date the landing links to for "this week's" register — the same visible weekly schedule VLC
 * derives, no cron / pre-materialised rows (R381).
 */
export function cadenceDateForWeek(sessionDay: number, now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const isoToday = ((d.getUTCDay() + 6) % 7) + 1; // JS 0=Sun → ISO 1=Mon…7=Sun
  d.setUTCDate(d.getUTCDate() + (sessionDay - isoToday));
  return d.toISOString().slice(0, 10);
}

export type PlcLifecycleState = "scheduled" | "held" | "missed";
export type PlcPillState = "done" | "active" | "pending";

export interface PlcLifecyclePill {
  label: string;
  detail: string;
  state: PlcPillState;
}

export interface PlcSessionClock {
  startLabel: string; // "3:30 PM"
  closeLabel: string; // "4:30 PM"
  totalMin: number;
  elapsedMin: number;
  remainingMin: number;
  /** The session close instant (ms) — the reflection window OPENS here. */
  closeMs: number;
  /** close + reflection_window_hours (ms) — reflections after this earn nothing; the register locks here. */
  reflectionWindowCloseMs: number;
  reflectionWindowHours: number;
  reflectionOpenLabel: string; // "4:30 PM" (the session close)
  reflectionCloseLabel: string; // "Sun 18 May · 4:30 PM"
  /** now within [close, reflectionClose] — the member submit window is open. */
  reflectionWindowOpen: boolean;
  /** The register (attendance + agenda) is read-only once the reflection window has fully elapsed. */
  writeLocked: boolean;
  /** SCHEDULED (cadence date, no row) / HELD (row exists) / MISSED (past cadence date, no row). */
  state: PlcLifecycleState;
  /** The 4 lifecycle pills (the surface's SMS pill removed per R394; the CPD pill is a derived preview). */
  pills: PlcLifecyclePill[];
}

/**
 * Derive the whole session clock from the coalesced programme + the session date. `held` distinguishes
 * SCHEDULED/MISSED (no row) from HELD (row exists) — the caller passes whether a plc_session row exists.
 */
export function derivePlcSessionClock(
  programme: PlcProgramme,
  sessionDate: string,
  held: boolean,
  now: Date = new Date(),
): PlcSessionClock {
  const startHHMM = programme.sessionStart;
  const closeHHMM = addMinutes(startHHMM, programme.sessionLengthMin);
  const startMs = plcSessionInstant(sessionDate, startHHMM).getTime();
  const closeMs = plcSessionInstant(sessionDate, closeHHMM).getTime();
  const reflectionWindowCloseMs = closeMs + programme.reflectionWindowHours * HOUR_MS;
  const nowMs = now.getTime();

  const totalMin = programme.sessionLengthMin;
  const elapsedMin = Math.max(0, Math.min(totalMin, Math.floor((nowMs - startMs) / MIN_MS)));
  const remainingMin = Math.max(0, Math.ceil((closeMs - nowMs) / MIN_MS));
  const writeLocked = nowMs >= reflectionWindowCloseMs;
  const reflectionWindowOpen = nowMs >= closeMs && nowMs <= reflectionWindowCloseMs;
  const state: PlcLifecycleState = held ? "held" : nowMs >= closeMs ? "missed" : "scheduled";

  const start = formatClockTime(startHHMM);
  const close = formatClockTime(closeHHMM);
  const startLabel = `${start.time} ${start.meridiem}`;
  const closeLabel = `${close.time} ${close.meridiem}`;

  // Reflection-window-close label — a full datetime (the window end is `reflection_window_hours` past close).
  const reflClose = new Date(reflectionWindowCloseMs);
  const datePart = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(reflClose);
  const reflCloseTod = formatClockTime(
    `${String(reflClose.getUTCHours()).padStart(2, "0")}:${String(reflClose.getUTCMinutes()).padStart(2, "0")}`,
  );
  const reflectionCloseLabel = `${datePart} · ${reflCloseTod.time} ${reflCloseTod.meridiem}`;

  // pills — 4 (the surface's "SMS reminder" pill removed, R394; the CPD pill is a derived PREVIEW that
  // "posts" only at the INCR-49 ledger, never here). A held session is always past "Scheduled" (done).
  const pill = (before: number, after: number): PlcPillState =>
    nowMs >= after ? "done" : nowMs >= before ? "active" : "pending";
  const pills: PlcLifecyclePill[] = [
    {
      label: "Scheduled",
      detail: `${programme.dayName} · ${startLabel}`,
      state: held ? "done" : pill(startMs - 1, startMs),
    },
    { label: "Live · attendance + agenda", detail: `${startLabel} — ${closeLabel}`, state: pill(startMs, closeMs) },
    {
      label: "Reflection window",
      detail: `opens at close · ${programme.reflectionWindowHours}h`,
      state: pill(closeMs, reflectionWindowCloseMs),
    },
    {
      label: "CPD points preview",
      detail: "derived · posts to the ledger later",
      state: nowMs >= reflectionWindowCloseMs ? "done" : "pending",
    },
  ];

  return {
    startLabel,
    closeLabel,
    totalMin,
    elapsedMin,
    remainingMin,
    closeMs,
    reflectionWindowCloseMs,
    reflectionWindowHours: programme.reflectionWindowHours,
    reflectionOpenLabel: closeLabel,
    reflectionCloseLabel,
    reflectionWindowOpen,
    writeLocked,
    state,
    pills,
  };
}

/**
 * The register write-lock (R381), decoupled from the full clock for the server actions: attendance + agenda
 * edits are refused once the reflection window has fully elapsed. There is NO stored `locked`/`closed`
 * column — the boundary derives every time, so a write after the window is refused. `confirmReflection`
 * does NOT call this (R389 — one-way confirm is not window-bound).
 */
export function isPlcSessionWriteLocked(
  programme: PlcProgramme,
  sessionDate: string,
  now: Date = new Date(),
): boolean {
  const closeHHMM = addMinutes(programme.sessionStart, programme.sessionLengthMin);
  const closeMs = plcSessionInstant(sessionDate, closeHHMM).getTime();
  return now.getTime() >= closeMs + programme.reflectionWindowHours * HOUR_MS;
}

/** True when `now` is inside the member reflection-submit window [scheduled close, close + window hours] (R388). */
export function isPlcReflectionWindowOpen(
  programme: PlcProgramme,
  sessionDate: string,
  now: Date = new Date(),
): boolean {
  const closeHHMM = addMinutes(programme.sessionStart, programme.sessionLengthMin);
  const closeMs = plcSessionInstant(sessionDate, closeHHMM).getTime();
  const nowMs = now.getTime();
  return nowMs >= closeMs && nowMs <= closeMs + programme.reflectionWindowHours * HOUR_MS;
}
