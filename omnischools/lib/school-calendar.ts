/**
 * School-day maths over a term, excluding weekends and holidays. Pure +
 * client/server safe. Powers the "Day 47 of 62" counter, the trend denominator,
 * and weekend/holiday cells in the term grid. Dates are ISO "YYYY-MM-DD".
 */
export type HolidayRange = {
  name: string;
  startsOn: string;
  endsOn: string;
  kind: string;
};

const isWeekend = (d: Date) => {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
};

/** True when the ISO date falls inside any holiday range (inclusive). */
export function isHoliday(iso: string, holidays: HolidayRange[]): HolidayRange | null {
  return holidays.find((h) => iso >= h.startsOn && iso <= h.endsOn) ?? null;
}

/** School days (Mon–Fri, minus holidays) in [startIso, endIso] inclusive. */
export function schoolDaysInRange(
  startIso: string,
  endIso: string,
  holidays: HolidayRange[] = [],
): number {
  if (!startIso || !endIso || startIso > endIso) return 0;
  let count = 0;
  const end = new Date(endIso + "T00:00:00Z");
  for (
    const d = new Date(startIso + "T00:00:00Z");
    d <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    if (isWeekend(d)) continue;
    const iso = d.toISOString().slice(0, 10);
    if (isHoliday(iso, holidays)) continue;
    count++;
  }
  return count;
}

/**
 * Term progress: school days elapsed up to `today` (capped at term end) and the
 * total school days in the term — i.e. "Day {dayOf} of {total}".
 */
export function termDayProgress(
  termStart: string,
  termEnd: string,
  today: string,
  holidays: HolidayRange[] = [],
): { dayOf: number; total: number } {
  const upTo = today < termEnd ? today : termEnd;
  return {
    dayOf: today < termStart ? 0 : schoolDaysInRange(termStart, upTo, holidays),
    total: schoolDaysInRange(termStart, termEnd, holidays),
  };
}
