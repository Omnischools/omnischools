/**
 * PTA meeting lifecycle derivations (SHS module 4.7 / INCR-52 · R432) — PURE, DB-free, unit-tested
 * (meeting-clock.test.ts). The DIRECT PORT of lib/plc/session-clock.ts: the lifecycle state
 * (scheduled/held/closed), the four lifecycle pills, the elapsed/remaining clock and the register
 * write-lock ALL derive HERE from `meeting_date` + `start_time` + `end_time` + a per-tier grace — NOTHING
 * is stored (R432: no status / started_at / closed_at column). Ghana runs on GMT (UTC+0, no DST), so a
 * meeting_date + an "HH:MM" compose into a UTC instant with no offset maths (the plc_session / vlc_session
 * tz-boundary discipline).
 *
 * The write-lock is the END of the grace window — the Secretary may fix attendance/agenda through the live
 * meeting AND a `register_lock_grace_hours` tail (coalesced from tier_settings, default 24h), then it
 * settles. The SAME `closed` boundary drives the R435 parent polarity flip: an unmarked parent reads
 * "awaiting" while the register is open (held) and "absent" once it locks (closed) — a pure read-time
 * derivation, ZERO stored rows.
 */
import { formatClockTime } from "@/lib/senior/time";

const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

/** The frozen default register-lock grace (hours after end_time) when tier_settings does not override it. */
export const DEFAULT_REGISTER_LOCK_GRACE_HOURS = 24;

/** Compose a meeting_date ("YYYY-MM-DD") + an "HH:MM" bound into a UTC instant (Ghana = GMT). */
export function ptaMeetingInstant(meetingDate: string, hhmm: string): Date {
  return new Date(`${meetingDate}T${hhmm}:00.000Z`);
}

/**
 * Coalesce the per-tier register-lock grace: `tier_settings.register_lock_grace_hours` (an opaque string in
 * the spine's jsonb bag) → a non-negative number, default 24h. A blank / non-numeric / negative value falls
 * back to the frozen default rather than throwing (the coalescePtaTiers honesty discipline).
 */
export function coalesceGraceHours(tierSettings: Record<string, string> | null | undefined): number {
  const raw = Number.parseFloat(tierSettings?.register_lock_grace_hours ?? "");
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_REGISTER_LOCK_GRACE_HOURS;
}

export type PtaMeetingState = "scheduled" | "held" | "closed";
export type PtaPillState = "done" | "active" | "pending";

/** The capture status a register row renders — a person is present / late / absent / (parent-only) awaiting. */
export type RegisterStatus = "present" | "late" | "absent" | "awaiting";

/**
 * TEACHER register polarity (R435 · PLC-verbatim): PRESENT-by-default. No row ⇒ present; a stray PRESENT
 * row still reads present; LATE ⇒ late; anything else stored (ABSENT / E / M) ⇒ absent.
 */
export function deriveTeacherStatus(raw: string | undefined | null): RegisterStatus {
  if (raw === "LATE") return "late";
  if (raw == null || raw === "PRESENT") return "present";
  return "absent";
}

/**
 * PARENT register polarity (R435 · the honesty crux): ABSENT-by-default. A PRESENT/LATE row is an arrival;
 * NO row ⇒ "awaiting" while the register is open, flipping to "absent" once it is finalised (write-locked) —
 * a pure read-time derivation, ZERO stored absent rows.
 */
export function deriveParentStatus(raw: string | undefined | null, finalised: boolean): RegisterStatus {
  if (raw === "PRESENT") return "present";
  if (raw === "LATE") return "late";
  return finalised ? "absent" : "awaiting";
}

export interface PtaLifecyclePill {
  label: string;
  detail: string;
  state: PtaPillState;
}

export interface PtaMeetingClock {
  startLabel: string; // "10:00 AM"
  endLabel: string; // "12:00 PM"
  windowLabel: string; // "10:00 AM — 12:00 PM"
  totalMin: number;
  elapsedMin: number;
  remainingMin: number;
  startMs: number;
  endMs: number;
  /** end + grace hours (ms) — the register locks here; writes after are refused. */
  lockMs: number;
  graceHours: number;
  /** A full datetime for the lock instant, e.g. "Sun 31 May · 12:00 PM". */
  lockLabel: string;
  /** SCHEDULED (now < start) / HELD (start ≤ now < lock; the writable window) / CLOSED (now ≥ lock). */
  state: PtaMeetingState;
  /** The register (attendance + agenda + quorum) is read-only once the grace window has elapsed. */
  writeLocked: boolean;
  /** now ≥ lock — unmarked parents read "absent" (else "awaiting"); the R435 polarity flip. == writeLocked. */
  parentsFinalised: boolean;
  /** The 4 lifecycle pills (convened · live · grace · closed). */
  pills: PtaLifecyclePill[];
}

const fmtLockDateTime = (ms: number): string => {
  const d = new Date(ms);
  const datePart = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
  const tod = formatClockTime(
    `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
  );
  return `${datePart} · ${tod.time} ${tod.meridiem}`;
};

/**
 * Derive the whole meeting clock from the stored times + the coalesced grace. A convened meeting always
 * exists (unlike a PLC session, which may be un-held), so "scheduled/held/closed" describes where NOW sits
 * against this meeting's window — no `held` boolean is threaded.
 */
export function derivePtaMeetingClock(
  meetingDate: string,
  startTime: string,
  endTime: string,
  graceHours: number,
  now: Date = new Date(),
): PtaMeetingClock {
  const startMs = ptaMeetingInstant(meetingDate, startTime).getTime();
  const endMs = ptaMeetingInstant(meetingDate, endTime).getTime();
  const lockMs = endMs + graceHours * HOUR_MS;
  const nowMs = now.getTime();

  const totalMin = Math.max(0, Math.round((endMs - startMs) / MIN_MS));
  const elapsedMin = Math.max(0, Math.min(totalMin, Math.floor((nowMs - startMs) / MIN_MS)));
  const remainingMin = Math.max(0, Math.ceil((endMs - nowMs) / MIN_MS));
  const writeLocked = nowMs >= lockMs;
  const state: PtaMeetingState = nowMs < startMs ? "scheduled" : nowMs < lockMs ? "held" : "closed";

  const start = formatClockTime(startTime);
  const end = formatClockTime(endTime);
  const startLabel = `${start.time} ${start.meridiem}`;
  const endLabel = `${end.time} ${end.meridiem}`;
  const windowLabel = `${start.time} — ${end.time} ${end.meridiem}`;
  const lockLabel = fmtLockDateTime(lockMs);

  const pill = (before: number, after: number): PtaPillState =>
    nowMs >= after ? "done" : nowMs >= before ? "active" : "pending";
  const pills: PtaLifecyclePill[] = [
    // A convened meeting row exists → step 1 is always complete (State-1 SMS-scheduling is DEFERRED).
    { label: "Convened", detail: "register open", state: "done" },
    { label: "Live · dual register", detail: windowLabel, state: pill(startMs, endMs) },
    {
      label: "Closing · grace window",
      detail: `${graceHours}h to finalise · locks ${lockLabel}`,
      state: pill(endMs, lockMs),
    },
    // Minutes / resolutions (INCR-53) open once the meeting ends; this pill tracks the register locking.
    { label: "Closed · register locked", detail: "minutes open here", state: writeLocked ? "done" : "pending" },
  ];

  return {
    startLabel,
    endLabel,
    windowLabel,
    totalMin,
    elapsedMin,
    remainingMin,
    startMs,
    endMs,
    lockMs,
    graceHours,
    lockLabel,
    state,
    writeLocked,
    parentsFinalised: writeLocked,
    pills,
  };
}

/**
 * The register write-lock (R432), decoupled from the full clock for the server actions: attendance /
 * agenda / quorum edits are refused once the grace window has fully elapsed. There is NO stored
 * `locked`/`closed_at` column — the boundary derives every time, so a late write is refused.
 */
export function isPtaMeetingWriteLocked(
  meetingDate: string,
  endTime: string,
  graceHours: number,
  now: Date = new Date(),
): boolean {
  const lockMs = ptaMeetingInstant(meetingDate, endTime).getTime() + graceHours * HOUR_MS;
  return now.getTime() >= lockMs;
}

/**
 * The meeting has ENDED (now ≥ end_time), independent of the grace tail (R450). The INCR-53 minutes
 * draft-create gate: a Secretary can start minuting once the bell has rung, DURING the grace window (the
 * register is still editable, but the meeting is over). Distinct from the write-lock (end + grace), which
 * gates ADOPTION. Derived every time — no stored `closed_at`.
 */
export function isPtaMeetingEnded(
  meetingDate: string,
  endTime: string,
  now: Date = new Date(),
): boolean {
  return now.getTime() >= ptaMeetingInstant(meetingDate, endTime).getTime();
}
