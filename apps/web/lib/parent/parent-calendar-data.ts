import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import { withParentScope } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { academicPeriod, schoolHolidays } from "@/db/schema";
import { termDayProgress, type HolidayRange } from "@/lib/school-calendar";

/**
 * INCR-278 · the PARENT-facing SCHOOL CALENDAR reader (SHS module 4.3) — the SEVENTH widening of the 19a
 * parent boundary (22 → 24 parent_scope tables; Wells's prod-paste-0092). SERVER-ONLY — imports the db
 * driver, so a client component must never import it (only `pnpm build` catches that leak; the
 * parent-portal-data / reports-data precedent).
 *
 * 🔴 THE SAFEST PARENT READ IN THE PORTAL — NO PER-CHILD DATA. `academic_period` + `school_holiday` are
 * SCHOOL-WIDE: the calendar is identical for every child and carries ZERO per-student columns, so the
 * parent_scope grant needs (and this reader selects) NO per-child filter — there is nothing child-shaped to
 * leak. Runs under `withParentScope` ONLY (the D10 parent-loader rule — never `withSchool` /
 * `withoutTenantScope`, both of which bypass the parent boundary). Read-only by construction.
 *
 * Column guard: `academic_period.closed_by_user_id` (staff PII) and `product_line` are NEVER returned —
 * product_line is read ONLY (in the WHERE) to exclude the SENIOR_F3 boarding pseudo-period (migration 0048).
 *
 * Honesty (R90 omit-not-fake) lives in the PURE `buildParentCalendar` below (unit-tested): the "current"
 * term is the one CONTAINING today and ONLY that (no force-mark in an out-of-term gap); `nextTerm` is
 * omitted when none is upcoming; holidays are windowed to the reference academic year so old breaks don't
 * accumulate.
 */

export type ParentCalendarTerm = {
  label: string; // periodLabel — "Term 2" / "Semester 1"
  academicYear: string;
  startsOn: string; // "YYYY-MM-DD"
  endsOn: string;
  isCurrent: boolean;
};

export type ParentCalendarHoliday = {
  name: string;
  startsOn: string;
  endsOn: string;
  kind: string; // PUBLIC | BREAK | EVENT | EXAM
};

export type ParentCalendar = {
  academicYear: string | null; // the reference year (current term's, else the most recent) — heading label
  terms: ParentCalendarTerm[]; // chronological (ascending)
  current: { label: string; dayOf: number; total: number } | null; // only when today is inside a term
  nextTerm: ParentCalendarTerm | null; // earliest term starting after today, else null
  holidays: ParentCalendarHoliday[]; // within the reference academic year, ascending
};

/** A term row as read from `academic_period` (ascending by start). */
export type CalendarTermRow = { label: string; academicYear: string; startsOn: string; endsOn: string };

/**
 * PURE — the honest calendar derivation (no db, client/server safe, unit-tested). `termRows` MUST be
 * ascending by start (SENIOR_F3 already excluded by the caller's WHERE). Marks the term containing `today`
 * as current and ONLY that (AC-CAL-07); picks the first future term as `nextTerm` else null (AC-CAL-08);
 * windows holidays to the reference year (AC-CAL-10); day-progress only for the current term (AC-CAL-09).
 */
export function buildParentCalendar(
  termRows: CalendarTermRow[],
  holidayRows: ParentCalendarHoliday[],
  today: string,
): ParentCalendar {
  const currentIdx = termRows.findIndex((t) => t.startsOn <= today && today <= t.endsOn);
  const current = currentIdx >= 0 ? termRows[currentIdx] : null;
  const terms: ParentCalendarTerm[] = termRows.map((t, i) => ({
    label: t.label,
    academicYear: t.academicYear,
    startsOn: t.startsOn,
    endsOn: t.endsOn,
    isCurrent: i === currentIdx,
  }));

  const nextTerm = terms.find((t) => t.startsOn > today) ?? null; // ascending → first future term

  // Reference academic year (OC-CAL-HOLIDAY-WINDOW): current term's year, else the most recent term's.
  const refYear = current?.academicYear ?? termRows[termRows.length - 1]?.academicYear ?? null;
  const yearTerms = refYear ? termRows.filter((t) => t.academicYear === refYear) : [];
  const yearStart = yearTerms[0]?.startsOn ?? null;
  const yearEnd = yearTerms[yearTerms.length - 1]?.endsOn ?? null;

  const holidays =
    yearStart && yearEnd
      ? holidayRows.filter((h) => h.startsOn <= yearEnd && h.endsOn >= yearStart)
      : [];

  const progress = current
    ? termDayProgress(current.startsOn, current.endsOn, today, holidays as HolidayRange[])
    : null;

  return {
    academicYear: refYear,
    terms,
    current:
      current && progress ? { label: current.label, dayOf: progress.dayOf, total: progress.total } : null,
    nextTerm,
    holidays,
  };
}

/** MUST run on a `tx` already scoped by `withParentScope` (see `loadParentCalendar`). */
export async function loadParentCalendarTx(
  tx: Tx,
  schoolId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<ParentCalendar> {
  // Real terms only — SENIOR_F3 is a boarding pseudo-period, not a calendar term (AC-CAL-06). Ascending so
  // "current"/"next"/the year window read straight off order. product_line filters in the WHERE, never shown.
  const termRows = await tx
    .select({
      label: academicPeriod.periodLabel,
      academicYear: academicPeriod.academicYear,
      startsOn: academicPeriod.startsOn,
      endsOn: academicPeriod.endsOn,
    })
    .from(academicPeriod)
    .where(and(eq(academicPeriod.schoolId, schoolId), ne(academicPeriod.productLine, "SENIOR_F3")))
    .orderBy(asc(academicPeriod.startsOn), asc(academicPeriod.periodNumber));

  const holidayRows = await tx
    .select({
      name: schoolHolidays.name,
      startsOn: schoolHolidays.startsOn,
      endsOn: schoolHolidays.endsOn,
      kind: schoolHolidays.kind,
    })
    .from(schoolHolidays)
    .where(eq(schoolHolidays.schoolId, schoolId))
    .orderBy(asc(schoolHolidays.startsOn));

  return buildParentCalendar(termRows, holidayRows, today);
}

/** Entry point — the parent's school calendar under `withParentScope` (never `withSchool`). */
export async function loadParentCalendar(schoolId: string, userId: string): Promise<ParentCalendar> {
  return withParentScope(schoolId, userId, (tx) => loadParentCalendarTx(tx, schoolId));
}
