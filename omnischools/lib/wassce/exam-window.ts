import { fmtSchedDate } from "@/lib/wassce/deepdive-view";

/**
 * WASSCE exam-window derivation — PURE, DB-free, unit-tested (exam-window.test.ts).
 *
 * 🔴 R90 (board plan) / Lucy F7, applied to the WASSCE timetable: a DRAWN date always loses to a
 * DERIVED one. `schoolup-wassce-setup.html` draws `Started Tue 13 May … Today (Wed 14 May)` — 13 May
 * 2026 is a WEDNESDAY and 14 May is a THURSDAY, so the mockup asserts two weekdays its own dates do
 * not have, and "Today" was true for exactly one day in the mockup's life. Both now derive here from
 * `wassce_papers` + the request instant, so neither can be wrong and neither can go stale.
 *
 * This is the ONE window derivation: `setup-data.ts` (the §1.2 live banner) and `cohort-data.ts` (the
 * §1 Day-N banner) both call it, so the two surfaces cannot disagree about which day it is.
 */

const DAY_MS = 86_400_000;

/**
 * Ghana keeps UTC+0 all year with no DST, so the UTC calendar date IS the Accra civil date — the
 * repo-wide idiom (`lib/sickbay/visits.ts` civilDate, `lib/auth/roles.ts`). Same reasoning, same call.
 * A LOCAL-time date would resolve to yesterday/tomorrow on any dev box west/east of Accra, which is
 * the same class of defect as the hardcoded date: a civil day nobody derived from the civil calendar.
 */
export function civilDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Whole days since the epoch for a bare 'YYYY-MM-DD' date column; null when it does not parse. */
function dayNumber(iso: string): number | null {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.round(t / DAY_MS);
}

/** `Thu 14 May` — the shipped short label, via the one formatter (deepdive-view's, UTC-based). */
export function examDayLabel(iso: string): string {
  const n = dayNumber(iso);
  return n == null ? iso : fmtSchedDate(new Date(n * DAY_MS));
}

/**
 * `09:30–12:00` from the stored start clock + duration. The bare start when the duration is unknown
 * (an end nobody stored is not invented), and a NAMED absence when there is no clock at all.
 */
export function paperWindow(start: string | null, mins: number | null): string {
  if (!start) return "time not scheduled";
  const [h, m] = start.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m) || mins == null) return start;
  const total = h * 60 + m + mins;
  return `${start}–${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** The projection of `wassce_papers` the window reads. `scheduled_date` is a bare date column. */
export type ExamPaperInput = {
  name: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  durationMinutes: number | null;
};

export type ExamWindowView = {
  startLabel: string; // "Tue 21 Apr" — the first dated paper
  startPapers: string; // "Social Studies 1 (Objective) + Social Studies 2 (Essay)"
  endLabel: string; // "Tue 16 Jun" — the last dated paper
  todayLabel: string; // "Thu 14 May" — the REQUEST's civil date, never a literal
  /** 1-based calendar day INSIDE the window; null before the first paper and after the last. */
  dayIndex: number | null;
  windowDays: number; // first → last inclusive
  todayPapers: { name: string; window: string }[]; // empty on a day with no paper
  nextPaper: { name: string; label: string; inDays: number } | null; // null once writing has ended
};

/**
 * The whole banner as a function of the cohort's papers and the request instant. Returns null when the
 * cohort has NO dated paper — the caller renders no banner at all rather than a window with no edges
 * (omit, never placeholder). Callers must pass a pinned `now`; nothing here reads the clock.
 */
export function examWindowView(
  papers: readonly ExamPaperInput[],
  now: Date,
): ExamWindowView | null {
  const dated = papers
    .filter((p) => p.scheduledDate != null && dayNumber(p.scheduledDate) != null)
    .map((p) => ({ ...p, scheduledDate: p.scheduledDate as string }))
    .sort(
      (a, b) =>
        a.scheduledDate.localeCompare(b.scheduledDate) ||
        (a.scheduledTime ?? "").localeCompare(b.scheduledTime ?? ""),
    );
  if (dated.length === 0) return null;

  const start = dated[0].scheduledDate;
  const end = dated[dated.length - 1].scheduledDate;
  const today = civilDay(now);
  const startN = dayNumber(start)!;
  const endN = dayNumber(end)!;
  const todayN = dayNumber(today)!;

  const next = dated.find((p) => p.scheduledDate > today) ?? null;

  return {
    startLabel: examDayLabel(start),
    startPapers: dated
      .filter((p) => p.scheduledDate === start)
      .map((p) => p.name)
      .join(" + "),
    endLabel: examDayLabel(end),
    todayLabel: examDayLabel(today),
    dayIndex: todayN >= startN && todayN <= endN ? todayN - startN + 1 : null,
    windowDays: endN - startN + 1,
    todayPapers: dated
      .filter((p) => p.scheduledDate === today)
      .map((p) => ({
        name: p.name,
        window: paperWindow(p.scheduledTime, p.durationMinutes),
      })),
    nextPaper: next
      ? {
          name: next.name,
          label: examDayLabel(next.scheduledDate),
          inDays: dayNumber(next.scheduledDate)! - todayN,
        }
      : null,
  };
}
