/**
 * PERIOD filter for the Reports module — pure date logic, no DB imports, so it's
 * safe to import from both server pages and the client <PeriodBar>.
 *
 * A selected period resolves to a half-open [start, end) window. Server pages pass
 * the window into the data layer (invoices by issue date, payments by paid date).
 */

export type PeriodKey = "week" | "month" | "term" | "year" | "custom";

export const PERIOD_KEYS: PeriodKey[] = ["week", "month", "term", "year", "custom"];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  week: "This week",
  month: "This month",
  term: "This term",
  year: "Academic year",
  custom: "Custom…",
};

export type TermInfo = {
  label: string; // e.g. "Term 3"
  academicYear: string; // e.g. "2025/26"
  start: Date;
  end: Date;
} | null;

export type ResolvedPeriod = {
  key: PeriodKey;
  label: string; // display label for the active state
  start: Date;
  end: Date;
  from?: string; // echoed custom inputs (YYYY-MM-DD)
  to?: string;
};

const DAY = 86_400_000;
const midnightUTC = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const parseISO = (s?: string) => {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(+d) ? null : d;
};

/** Sep–Aug academic-year window containing `now`. */
export function academicYearWindow(now: Date): { start: Date; end: Date; label: string } {
  const y = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 8 ? y : y - 1; // Sep (month 8) rolls the year
  const start = new Date(Date.UTC(startYear, 8, 1));
  const end = new Date(Date.UTC(startYear + 1, 8, 1));
  return { start, end, label: `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}` };
}

/** Number of (partial) weeks a window spans. */
export function weeksIn(start: Date, end: Date): number {
  return Math.max(1, Math.ceil((+end - +start) / (7 * DAY)));
}

/**
 * Resolve the active period from query params + the school's current term.
 * Defaults to "term" when a term is configured, else "year".
 */
export function resolvePeriod(
  params: { period?: string; from?: string; to?: string },
  term: TermInfo,
  now: Date,
): ResolvedPeriod {
  const raw = (params.period ?? "").toLowerCase();
  let key: PeriodKey = (PERIOD_KEYS as string[]).includes(raw)
    ? (raw as PeriodKey)
    : term
      ? "term"
      : "year";
  // "term" is only meaningful when a term exists; fall back to year otherwise.
  if (key === "term" && !term) key = "year";

  const today = midnightUTC(now);

  if (key === "week") {
    const dow = (today.getUTCDay() + 6) % 7; // Monday = 0
    const start = new Date(+today - dow * DAY);
    return { key, label: "This week", start, end: new Date(+start + 7 * DAY) };
  }
  if (key === "month") {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    return { key, label: "This month", start, end };
  }
  if (key === "term" && term) {
    // inclusive end → half-open by adding a day
    return {
      key,
      label: `${term.label} · ${term.academicYear}`,
      start: term.start,
      end: new Date(+term.end + DAY),
    };
  }
  if (key === "custom") {
    const from = parseISO(params.from);
    const to = parseISO(params.to);
    if (from && to && +to >= +from) {
      return {
        key,
        label: "Custom",
        start: from,
        end: new Date(+to + DAY),
        from: params.from,
        to: params.to,
      };
    }
    // invalid/empty custom → fall through to academic year
  }

  const ay = academicYearWindow(now);
  return { key: "year", label: `Academic year ${ay.label}`, start: ay.start, end: ay.end };
}
