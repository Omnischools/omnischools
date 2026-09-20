/**
 * Shared senior-tier clock helpers — PURE, DB-free. Extracted from lib/vlc/defaults.ts (INCR-47,
 * Dex-directed DRY) so VLC (Wednesday cadence) and PLC (Friday cadence) derive session windows from
 * ONE copy rather than two. lib/vlc/defaults.ts re-exports these under its historical names
 * (`formatVlcTime` / `addMinutes` / `formatVlcWindow`) so VLC's public API and behaviour are
 * byte-unchanged; PLC imports the generic names directly.
 *
 * The [[lib/senior/form.ts]] precedent — a bare senior-tier shared module for a rule that would
 * otherwise drift between two modules.
 */

/** Split "HH:MM" (24h) into a 12-hour clock time + meridiem. "14:30" → { time: "2:30", meridiem: "PM" }. */
export function formatClockTime(hhmm: string): { time: string; meridiem: "AM" | "PM" } {
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
  const total = ((((h || 0) * 60 + (m || 0) + mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** A spaced en-dash window label, e.g. "2:30 — 3:30 PM" (surface-exact). */
export function formatClockWindow(start: string, end: string): string {
  const s = formatClockTime(start);
  const e = formatClockTime(end);
  return `${s.time} — ${e.time} ${e.meridiem}`;
}

/** A "start to end" range with both meridiems, e.g. "3:30 PM to 4:30 PM" (the PLC cadence idiom). */
export function formatClockRange(start: string, end: string): string {
  const s = formatClockTime(start);
  const e = formatClockTime(end);
  return `${s.time} ${s.meridiem} to ${e.time} ${e.meridiem}`;
}
