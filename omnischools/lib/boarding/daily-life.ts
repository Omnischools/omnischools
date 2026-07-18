/**
 * Boarding daily life (SHS module 4.2 / INCR-10) — the PURE derivation core for surface 04.
 * No DB, no I/O: every function here is deterministic and unit-tested (daily-life.test.ts). The
 * server read layer (daily-data.ts) fetches rows and delegates the shaping here; the write actions
 * (lib/actions/boarding-daily.ts) validate findings + compute anomalies here. Keeping it pure means
 * the timeline / NOW / day-type / inspection / prep logic is display-and-write derivation with
 * ZERO storage (Kofi OQ4/OQ5): no slot-state row, no counter, no trigger.
 *
 * Time frame: Ghana runs on UTC (GMT+0), so a template's wall-clock time == UTC. Every derivation
 * against "the clock" uses UTC (AC B3 / traps T2/T3) — never the runtime machine's local zone.
 */
import { z } from "zod";
import type { BoardingDayType, ScheduleTemplate, ScheduleBlock } from "./defaults";

// ---------------------------------------------------------------------------
// Day-type + weekday resolution (UTC)
// ---------------------------------------------------------------------------

const DAY_TOKENS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** The UTC ISO date (yyyy-mm-dd) of an instant. */
export function isoUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The 3-letter weekday token (Sun..Sat) of a yyyy-mm-dd date, read in UTC (AC B3). */
export function weekdayToken(dateIso: string): (typeof DAY_TOKENS)[number] {
  return DAY_TOKENS[new Date(`${dateIso}T00:00:00Z`).getUTCDay()];
}

/**
 * Resolve the day-type of a date (AC B). Saturday → SATURDAY; a Sunday matching a VISITING calendar
 * event → VISITING_SUNDAY, else SUNDAY; every other weekday → WEEKDAY. Computed against UTC (T2:
 * a visiting Sunday is driven by the calendar event, not the weekday alone).
 */
export function resolveDayType(dateIso: string, visitingDates: ReadonlySet<string>): BoardingDayType {
  const dow = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  if (dow === 6) return "SATURDAY";
  if (dow === 0) return visitingDates.has(dateIso) ? "VISITING_SUNDAY" : "SUNDAY";
  return "WEEKDAY";
}

// ---------------------------------------------------------------------------
// Timeline + NOW (pure, no storage — AC A)
// ---------------------------------------------------------------------------

/** First / last HH:MM tokens of a range string ("04:30 — 05:00" or single "21:30"). */
function timesOf(range: string): { start: number; end: number } | null {
  const m = range.match(/(\d{1,2}):(\d{2})/g);
  if (!m || m.length === 0) return null;
  const toMin = (s: string) => {
    const [h, mm] = s.split(":").map(Number);
    return h * 60 + mm;
  };
  const start = toMin(m[0]);
  return { start, end: m.length > 1 ? toMin(m[1]) : start };
}

/** The HH:MM label of the first time token in a range ("19:00 — 21:40" → "19:00"). */
export function firstTimeLabel(range: string): string | null {
  const m = range.match(/\d{1,2}:\d{2}/);
  return m ? m[0].padStart(5, "0") : null;
}

export type SlotState = "done" | "now" | "upcoming";

export interface TimelineSlot {
  range: string;
  startLabel: string;
  short: string;
  activity: string;
  note?: string;
  who: string;
  state: SlotState;
}
export interface NowCard {
  activity: string;
  note?: string;
  who: string;
  startLabel: string;
  endLabel: string | null;
  minutesIn: number;
  minutesRemaining: number;
}
export interface NextUp {
  short: string;
  startLabel: string;
  minutesUntil: number;
}
export interface Timeline {
  slots: TimelineSlot[];
  now: NowCard | null;
  next: NextUp | null;
  live: boolean;
  lightsOutLabel: string | null;
}

/** The rail short label — the activity name up to its first "·" separator ("Siesta"). */
function shortLabel(activity: string): string {
  return activity.split("·")[0].trim();
}
const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * Mark every activity block done / now / upcoming purely from the clock (AC A1) — NO storage,
 * re-render recomputes from `now` alone. For the viewed date:
 *   - before today → every slot upcoming, NOW=null;
 *   - after today  → every slot done, NOW=null;
 *   - today        → compare `now` (UTC minutes) to each block's [start,end).
 * A ranged block is `now` while start ≤ t < end (A3 minutes-in/left); a single-time block
 * ("21:30 lights out") is upcoming before its minute, done after (A2). A gap or pre-day/after-
 * lights-out leaves `now` = null and (when there is one) surfaces the next block + time-until
 * (A4/A5); after the last block, next is null too (T3).
 */
export function buildTimeline(template: ScheduleTemplate, viewedDateIso: string, now: Date): Timeline {
  const activities = template.activities.filter(
    (b): b is Extract<ScheduleBlock, { kind: "activity" }> => b.kind === "activity",
  );
  const nowIso = isoUtcDate(now);
  const isPast = viewedDateIso < nowIso;
  const isFuture = viewedDateIso > nowIso;
  const live = viewedDateIso === nowIso;
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();

  const stateFor = (range: string): SlotState => {
    if (isPast) return "done";
    if (isFuture) return "upcoming";
    const t = timesOf(range);
    if (!t) return "upcoming";
    if (t.end === t.start) {
      // single-time (point) block
      if (nowMin > t.start) return "done";
      return nowMin === t.start ? "now" : "upcoming";
    }
    if (nowMin >= t.end) return "done";
    return nowMin >= t.start ? "now" : "upcoming";
  };

  const slots: TimelineSlot[] = activities.map((a) => ({
    range: a.range,
    startLabel: firstTimeLabel(a.range) ?? a.range,
    short: shortLabel(a.activity),
    activity: a.activity,
    note: a.note,
    who: a.who,
    state: stateFor(a.range),
  }));

  let nowCard: NowCard | null = null;
  let next: NextUp | null = null;
  if (live) {
    const idx = slots.findIndex((s) => s.state === "now");
    if (idx >= 0) {
      const t = timesOf(slots[idx].range)!;
      nowCard = {
        activity: slots[idx].activity,
        note: slots[idx].note,
        who: slots[idx].who,
        startLabel: hhmm(t.start),
        endLabel: t.end === t.start ? null : hhmm(t.end),
        minutesIn: Math.max(0, nowMin - t.start),
        minutesRemaining: Math.max(0, t.end - nowMin),
      };
    } else {
      const up = slots.find((s) => s.state === "upcoming");
      if (up) {
        const t = timesOf(up.range)!;
        next = { short: up.short, startLabel: hhmm(t.start), minutesUntil: Math.max(0, t.start - nowMin) };
      }
    }
  }

  const last = activities[activities.length - 1];
  return {
    slots,
    now: nowCard,
    next,
    live,
    lightsOutLabel: last ? firstTimeLabel(last.range) : null,
  };
}

// ---------------------------------------------------------------------------
// F3 prep-extension accent (AC A7) — a derived delta, NOT a whole-timeline swap
// ---------------------------------------------------------------------------

export interface F3Accent {
  prepRange: string | null;
  lightsOutAll: string;
  lightsOutF3: string;
}

/** The last activity's start label of a template — the lights-out time. */
function lightsOutOf(t: ScheduleTemplate): string | null {
  const acts = t.activities.filter((b) => b.kind === "activity");
  const last = acts[acts.length - 1];
  return last && last.kind === "activity" ? firstTimeLabel(last.range) : null;
}

/**
 * The Form-3 prep-extension accent (AC A7): the delta of the FORM_3 variant's lights-out vs the
 * ALL base. Returns null when there is no FORM_3 variant, or its lights-out matches ALL (no accent
 * to show) — the main rail is always the ALL template, this is only an accent card.
 */
export function deriveF3Accent(
  allTemplate: ScheduleTemplate,
  f3Template: ScheduleTemplate | null,
): F3Accent | null {
  if (!f3Template) return null;
  const loAll = lightsOutOf(allTemplate);
  const loF3 = lightsOutOf(f3Template);
  if (!loAll || !loF3 || loAll === loF3) return null;
  const prep = f3Template.activities.find(
    (b): b is Extract<ScheduleBlock, { kind: "activity" }> =>
      b.kind === "activity" && b.activity.toLowerCase().startsWith("prep"),
  );
  return { prepRange: prep?.range ?? null, lightsOutAll: loAll, lightsOutF3: loF3 };
}

// ---------------------------------------------------------------------------
// Scrubbing / washing accents (AC A8) — weekday-token-gated policy labels
// ---------------------------------------------------------------------------

/** True when a policy string names the given weekday token ("Wed & Fri afternoons" ∋ Wed). */
export function policyHasDay(policy: string, token: string): boolean {
  const found = new Set((policy.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g) ?? []).map((s) => s.slice(0, 3)));
  return found.has(token);
}

/** The time-range fragment of a policy string ("Wed 16:00 — 17:00" → "16:00 — 17:00"), or null. */
export function policyTimeRange(policy: string): string | null {
  const m = policy.match(/\d{1,2}:\d{2}(?:\s*[—-]\s*\d{1,2}:\d{2})?/);
  return m ? m[0] : null;
}

// ---------------------------------------------------------------------------
// Inspection findings — Zod-validated by `type` in lib/ (NO DB CHECK — Kofi OQ1)
// ---------------------------------------------------------------------------

export const CHECK_KEYS = ["bunks", "lockers", "attire"] as const;
const checkResult = z.enum(["OK", "ISSUE"]);

export const dailyFindingsSchema = z.object({
  kind: z.literal("DAILY"),
  checks: z.object({
    bunks: checkResult,
    lockers: checkResult,
    attire: checkResult,
  }),
  flaggedBunks: z.array(z.number().int().positive()).max(60).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export const weeklyFindingsSchema = z.object({
  kind: z.literal("WEEKLY"),
  areas: z
    .array(
      z.object({
        area: z.string().trim().min(1).max(120),
        result: checkResult,
        note: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(30),
  notes: z.string().trim().max(1000).optional(),
});
/** Discriminated by `type` — a DAILY payload never validates as WEEKLY and vice-versa (AC C1/D1). */
export const findingsSchema = z.discriminatedUnion("kind", [dailyFindingsSchema, weeklyFindingsSchema]);
export type DailyFindings = z.infer<typeof dailyFindingsSchema>;
export type WeeklyFindings = z.infer<typeof weeklyFindingsSchema>;
export type InspectionFindings = z.infer<typeof findingsSchema>;

/**
 * Anomalies recorded on a PARTIAL/FAIL (Kofi OQ1 — computed in lib at write, NOT a DB derivation).
 * DAILY = ISSUE checks + flagged bunks; WEEKLY = areas whose result is ISSUE. This feeds
 * anomalies_count only — it NEVER writes a discipline row (escalation is STUBBED to INCR-13, AC E).
 */
export function computeAnomalies(findings: InspectionFindings): number {
  if (findings.kind === "DAILY") {
    const issues = CHECK_KEYS.filter((k) => findings.checks[k] === "ISSUE").length;
    return issues + (findings.flaggedBunks?.length ?? 0);
  }
  return findings.areas.filter((a) => a.result === "ISSUE").length;
}

// ---------------------------------------------------------------------------
// Prep attendance — the exception-log summary (AC F) — pure, no counter
// ---------------------------------------------------------------------------

/** The statuses the prep exception log may carry — PRESENT is NEVER one (present-by-default, F3). */
export const PREP_EXCEPTION_STATUSES = ["LATE", "ABSENT", "EXCUSED", "MEDICAL"] as const;
export type PrepExceptionStatus = (typeof PREP_EXCEPTION_STATUSES)[number];

export function isPrepExceptionStatus(v: string): v is PrepExceptionStatus {
  return (PREP_EXCEPTION_STATUSES as readonly string[]).includes(v);
}

export interface PrepBoarder {
  id: string;
  formLabel: string | null;
}
export interface PrepSummary {
  rosterCount: number; // boarders expected on-premises tonight = boarders − on-exeat (T5)
  present: number; // roster − ABSENT (LATE counts present; F4)
  late: number;
  absent: number;
  excused: number; // explicit EXCUSED + on-exeat auto-EXCUSED (T5)
  medical: number;
  onExeat: number;
  byForm: { form: string; count: number }[]; // roster grouped by form (surface prep rooms)
}

/**
 * Derive tonight's prep summary from the BOARDER set + the exception rows + who is on a DEPARTED
 * exeat (AC F/T5). A boarder on exeat is EXCLUDED from the expected roster and auto-EXCUSED
 * (off-premises), never ABSENT. present = roster − ABSENT (LATE still counts present). No stored
 * counter — recomputed each read.
 */
export function computePrepSummary(
  boarders: PrepBoarder[],
  exceptions: ReadonlyMap<string, PrepExceptionStatus>,
  onExeat: ReadonlySet<string>,
): PrepSummary {
  const roster = boarders.filter((b) => !onExeat.has(b.id));
  let late = 0;
  let absent = 0;
  let excused = onExeat.size; // on-exeat boarders are auto-EXCUSED (off-premises)
  let medical = 0;
  for (const b of roster) {
    switch (exceptions.get(b.id)) {
      case "LATE":
        late += 1;
        break;
      case "ABSENT":
        absent += 1;
        break;
      case "EXCUSED":
        excused += 1;
        break;
      case "MEDICAL":
        medical += 1;
        break;
      default:
        break;
    }
  }
  const byFormMap = new Map<string, number>();
  for (const b of roster) {
    const f = b.formLabel ?? "Unassigned";
    byFormMap.set(f, (byFormMap.get(f) ?? 0) + 1);
  }
  return {
    rosterCount: roster.length,
    present: roster.length - absent,
    late,
    absent,
    excused,
    medical,
    onExeat: onExeat.size,
    byForm: Array.from(byFormMap, ([form, count]) => ({ form, count })).sort((a, b) =>
      a.form.localeCompare(b.form),
    ),
  };
}
