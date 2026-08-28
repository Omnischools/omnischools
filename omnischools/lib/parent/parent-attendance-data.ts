import "server-only";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { withParentScope } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { academicPeriod, attendanceRecords, schoolHolidays, students } from "@/db/schema";
import { isHoliday, type HolidayRange } from "@/lib/school-calendar";

/**
 * 🔴 INCR — the PARENT-facing ATTENDANCE reader (SHS module 4.4 × parent portal 4.3 · Kofi AC-PATT-*).
 * The 8th widening of the 19a parent boundary (24 → 25 parent_scope tables; Wells's prod-paste-0093 opens
 * the ROW on `attendance_record` scoped to the parent's OWN children). SERVER-ONLY — imports the db driver,
 * so a client component must never import it (only `pnpm build` catches that leak).
 *
 * RLS is ROW-level and CANNOT mask a column, so THIS PROJECTION is the ONLY column guard (the Sickbay R229
 * precedent). The reader reads `attendance_record` (+ `academic_period`/`school_holiday`, already
 * parent_scoped by INCR-278, for the term window and school-day classification, and one own-child
 * `students.programme` read to pick the CHILD's product line in a COMBINED school) — and joins NOTHING to
 * `users`, `attendance_correction`, or any comms table.
 *
 * OC-PARENT-ATT-KEYSET (Kofi, owner-confirmable — conservative defaults):
 *   • MEDICAL is FOLDED → EXCUSED in the SQL projection; the string "MEDICAL" NEVER leaves the DB. The fold
 *     costs zero rate accuracy (Medical and Excused both sit out of the numerator, both in the denominator).
 *   • `reason_code` / `note` (free-text — a DPA hazard) / `marked_by_user_id` / the `marked_at` CLOCK are
 *     NEVER selected. The only temporal field is the date-only `date`.
 * `studentId` is an INPUT filter resolved server-side from the session (never a URL param), NEVER returned;
 * the `parent_scope` RLS predicate independently restricts it to THIS parent's own children, so a forged id
 * yields zero rows (fail-closed). Read-only by construction — no write, no notify/SMS.
 *
 * "At school" = PRESENT + LATE (the canonical `rateOf` formula in lib/reports/attendance-summary-data.ts;
 * Kofi AC-PATT-12). A late student was at school. (The design surface's illustrative 61% counts present-only;
 * the domain ruling is present+late. Owner-widenable.)
 */

export type AttendanceBucket = "PRESENT" | "LATE" | "EXCUSED" | "ABSENT"; // MEDICAL folded → EXCUSED

export type ParentAttendanceDay = { date: string; bucket: AttendanceBucket };
export type ParentAttendanceWeekDay = {
  date: string;
  bucket: AttendanceBucket | null; // null = no mark (future/holiday/not marked)
  isToday: boolean;
  isSchoolDay: boolean; // Mon–Fri and not a school holiday
};
export type ParentAttendanceCounts = { present: number; late: number; excused: number; absent: number };
export type ParentAttendanceTerm = {
  label: string; // "Term 2 · 2025/26"
  startsOn: string;
  asOf: string; // min(today, term end)
  atSchoolDays: number; // present + late
  markedDays: number; // present + late + excused + absent
  atSchoolPct: number | null; // round(atSchoolDays / markedDays * 100); null when markedDays === 0
  counts: ParentAttendanceCounts;
};
export type ParentAttendancePriorTerm = {
  label: string;
  atSchoolPct: number | null;
  atSchoolDays: number;
  markedDays: number;
};

/** FROZEN KEY-SET (AC-PATT-07). No studentId/ids/reason/note/staff/clock ever crosses the wire. */
export type ParentAttendance = {
  today: ParentAttendanceDay | null; // null = no mark today / weekend / holiday
  week: ParentAttendanceWeekDay[]; // Mon–Fri of the current school week
  term: ParentAttendanceTerm | null; // null = no academic period configured
  priorTerm: ParentAttendancePriorTerm | null;
  recentAbsences: { date: string; bucket: "ABSENT" | "EXCUSED" }[]; // dates + bucket ONLY, most recent first
};

/** A term row as read from `academic_period` (newest-first, SENIOR_F3 excluded). */
export type PatTermRow = { label: string; academicYear: string; startsOn: string; endsOn: string };

const termLabel = (t: PatTermRow): string => `${t.label} · ${t.academicYear}`;

/** Newest-first term containing today, else the most recent started, else the newest (the report default). */
function pickTerm(terms: PatTermRow[], today: string): PatTermRow | null {
  if (terms.length === 0) return null;
  return (
    terms.find((t) => t.startsOn <= today && today <= t.endsOn) ??
    terms.find((t) => t.startsOn <= today) ??
    terms[0]
  );
}

/** The chronologically-previous term to `term` (terms newest-first), else null. */
function priorOf(terms: PatTermRow[], term: PatTermRow): PatTermRow | null {
  // terms are single-product-line here (the reader filters academic_period to the child's line), so a strict
  // startsOn comparison is a clean key — no two terms share a start.
  const older = terms.filter((t) => t.startsOn < term.startsOn);
  return older[0] ?? null; // newest-first → first older entry is the closest previous term
}

function tally(rows: ParentAttendanceDay[]): ParentAttendanceCounts {
  const c: ParentAttendanceCounts = { present: 0, late: 0, excused: 0, absent: 0 };
  for (const r of rows) {
    if (r.bucket === "PRESENT") c.present += 1;
    else if (r.bucket === "LATE") c.late += 1;
    else if (r.bucket === "EXCUSED") c.excused += 1;
    else if (r.bucket === "ABSENT") c.absent += 1;
  }
  return c;
}
const markedOf = (c: ParentAttendanceCounts) => c.present + c.late + c.excused + c.absent;
const atSchoolOf = (c: ParentAttendanceCounts) => c.present + c.late; // Kofi AC-PATT-12
const pctOf = (c: ParentAttendanceCounts): number | null =>
  markedOf(c) > 0 ? Math.round((atSchoolOf(c) / markedOf(c)) * 100) : null;

/** Monday-based Mon–Fri ISO dates of the week containing `today` (UTC). */
function schoolWeek(today: string): string[] {
  const t = new Date(`${today}T00:00:00Z`);
  const dow = t.getUTCDay(); // 0=Sun … 6=Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(t);
  monday.setUTCDate(t.getUTCDate() + mondayOffset);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/**
 * PURE — the honest attendance derivation (no db, unit-tested). `termRows` newest-first (SENIOR_F3 already
 * excluded); `dayRows` are the child's records across the current + prior term window, each already folded
 * (MEDICAL→EXCUSED) and date-only. Everything the surface shows is derived here from real rows only (R90):
 * no fabricated rate/day/streak; `atSchoolPct` is null (not 0/100) when nothing is marked.
 */
export function buildParentAttendance(
  termRows: PatTermRow[],
  dayRows: ParentAttendanceDay[],
  holidays: HolidayRange[],
  today: string,
): ParentAttendance {
  const byDate = new Map<string, AttendanceBucket>();
  for (const r of dayRows) byDate.set(r.date, r.bucket);

  const week: ParentAttendanceWeekDay[] = schoolWeek(today).map((date) => ({
    date,
    bucket: byDate.get(date) ?? null,
    isToday: date === today,
    isSchoolDay: !isHoliday(date, holidays), // Mon–Fri by construction; a holiday makes it a non-school day
  }));

  const todayBucket = byDate.get(today);
  const todayDay: ParentAttendanceDay | null = todayBucket ? { date: today, bucket: todayBucket } : null;

  const current = pickTerm(termRows, today);
  if (!current) {
    return { today: todayDay, week, term: null, priorTerm: null, recentAbsences: [] };
  }

  const inTerm = (t: PatTermRow) => dayRows.filter((r) => r.date >= t.startsOn && r.date <= t.endsOn);
  const termDaysRows = inTerm(current);
  const counts = tally(termDaysRows);
  const term: ParentAttendanceTerm = {
    label: termLabel(current),
    startsOn: current.startsOn,
    asOf: today < current.endsOn ? today : current.endsOn,
    atSchoolDays: atSchoolOf(counts),
    markedDays: markedOf(counts),
    atSchoolPct: pctOf(counts),
    counts,
  };

  const prior = priorOf(termRows, current);
  let priorTerm: ParentAttendancePriorTerm | null = null;
  if (prior) {
    const pc = tally(inTerm(prior));
    // Only show a prior-term summary when it actually has marks (an empty prior term is not a "0%").
    if (markedOf(pc) > 0) {
      priorTerm = { label: termLabel(prior), atSchoolPct: pctOf(pc), atSchoolDays: atSchoolOf(pc), markedDays: markedOf(pc) };
    }
  }

  const recentAbsences = termDaysRows
    .filter((r) => r.bucket === "ABSENT" || r.bucket === "EXCUSED")
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((r) => ({ date: r.date, bucket: r.bucket as "ABSENT" | "EXCUSED" }));

  return { today: todayDay, week, term, priorTerm, recentAbsences };
}

/** MUST run on a `tx` already scoped by `withParentScope`. `studentId` is an input filter, never returned. */
export async function loadParentAttendanceTx(
  tx: Tx,
  schoolId: string,
  studentId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<ParentAttendance> {
  // The CHILD's product line: SHS students carry a `programme`; Basic students don't (own-child read under
  // parent_scope). Filtering academic_period to this line makes a COMBINED school's term pick land on the
  // child's OWN terms — for a per-child surface the window sets the counts, not just a label (Dex MED-1).
  // It also excludes the SENIOR_F3 boarding pseudo-period (its product_line is neither SENIOR nor BASIC).
  const [stu] = await tx
    .select({ programme: students.programme })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
    .limit(1);
  const childLine = stu?.programme ? "SENIOR" : "BASIC";

  // Real terms for the child's line, newest-first.
  const termRows: PatTermRow[] = await tx
    .select({
      label: academicPeriod.periodLabel,
      academicYear: academicPeriod.academicYear,
      startsOn: academicPeriod.startsOn,
      endsOn: academicPeriod.endsOn,
    })
    .from(academicPeriod)
    .where(and(eq(academicPeriod.schoolId, schoolId), eq(academicPeriod.productLine, childLine)))
    .orderBy(desc(academicPeriod.academicYear), desc(academicPeriod.periodNumber));

  // Window = the current + prior term (so the prior-term summary has its rows); fall back to all if unknown.
  const current = pickTerm(termRows, today);
  const prior = current ? priorOf(termRows, current) : null;
  const windowStart = prior?.startsOn ?? current?.startsOn ?? null;
  const windowEnd = current?.endsOn ?? null;

  // The child's records, MEDICAL folded → EXCUSED IN SQL so "MEDICAL" never leaves the DB. reason_code /
  // note / marked_by_user_id / the marked_at clock are NEVER selected (the projection is the column guard).
  const dayRows: ParentAttendanceDay[] = await tx
    .select({
      date: attendanceRecords.date,
      bucket: sql<AttendanceBucket>`case ${attendanceRecords.status} when 'MEDICAL' then 'EXCUSED' else ${attendanceRecords.status} end`,
    })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.studentId, studentId),
        windowStart ? gte(attendanceRecords.date, windowStart) : undefined,
        windowEnd ? lte(attendanceRecords.date, windowEnd) : undefined,
      ),
    );

  // Holidays for the week-strip school-day classification (school_holiday is parent_scoped since INCR-278).
  const holidays: HolidayRange[] = await tx
    .select({
      name: schoolHolidays.name,
      startsOn: schoolHolidays.startsOn,
      endsOn: schoolHolidays.endsOn,
      kind: schoolHolidays.kind,
    })
    .from(schoolHolidays)
    .where(eq(schoolHolidays.schoolId, schoolId))
    .orderBy(asc(schoolHolidays.startsOn));

  return buildParentAttendance(termRows, dayRows, holidays, today);
}

/** Entry point — ONE child's attendance under `withParentScope` (never `withSchool`). */
export async function loadParentAttendance(
  schoolId: string,
  userId: string,
  studentId: string,
): Promise<ParentAttendance> {
  return withParentScope(schoolId, userId, (tx) => loadParentAttendanceTx(tx, schoolId, studentId));
}
