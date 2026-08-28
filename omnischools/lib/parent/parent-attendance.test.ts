import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import {
  buildParentAttendance,
  type PatTermRow,
  type ParentAttendanceDay,
} from "./parent-attendance-data";
import type { HolidayRange } from "@/lib/school-calendar";

/**
 * INCR · parent-portal Attendance tab (Kofi AC-PATT-*). Two guards:
 *  1. the PURE honesty derivation (buildParentAttendance) — current-term rollup, present+late numerator,
 *     excused/(folded medical) out of the numerator, ratePct null (not 0/100) when nothing is marked, honest
 *     recent-absences, prior-term only when it has marks.
 *  2. source-shape — the reader stays inside withParentScope, folds MEDICAL→EXCUSED in SQL, and never selects
 *     reason/note/staff/clock or joins users/corrections; the nav is FIVE live tabs with no inert spans.
 */

// 2025/26, newest-first (as the reader orders academic_period): Term 2 current, Term 1 prior.
const T2: PatTermRow = { label: "Term 2", academicYear: "2025/26", startsOn: "2026-01-06", endsOn: "2026-04-10" };
const T1: PatTermRow = { label: "Term 1", academicYear: "2025/26", startsOn: "2025-09-01", endsOn: "2025-12-19" };
const TERMS = [T2, T1];
const TODAY = "2026-02-11"; // a Wednesday; its Mon–Fri week is 2026-02-09 … 2026-02-13

// buckets are already folded (MEDICAL→EXCUSED happens in SQL before the builder sees a row).
const ROWS: ParentAttendanceDay[] = [
  { date: "2026-01-15", bucket: "PRESENT" },
  { date: "2026-01-16", bucket: "ABSENT" },
  { date: "2026-02-09", bucket: "PRESENT" },
  { date: "2026-02-10", bucket: "LATE" },
  { date: "2026-02-11", bucket: "PRESENT" }, // today
  { date: "2026-02-12", bucket: "EXCUSED" },
  { date: "2026-02-13", bucket: "ABSENT" },
  // prior term
  { date: "2025-09-05", bucket: "PRESENT" },
  { date: "2025-09-06", bucket: "PRESENT" },
];
const HOLIDAYS: HolidayRange[] = [
  { name: "Mid-term", startsOn: "2026-02-12", endsOn: "2026-02-12", kind: "BREAK" },
];

describe("buildParentAttendance · honest derivation (AC-PATT-*)", () => {
  it("rolls up the current term: present+late numerator, excused+medical out of it (AC-PATT-12/14)", () => {
    const a = buildParentAttendance(TERMS, ROWS, HOLIDAYS, TODAY);
    expect(a.term).not.toBeNull();
    expect(a.term!.counts).toEqual({ present: 3, late: 1, excused: 1, absent: 2 });
    expect(a.term!.markedDays).toBe(7); // present+late+excused+absent
    expect(a.term!.atSchoolDays).toBe(4); // present+late ONLY — excused (incl folded medical) excluded
    expect(a.term!.atSchoolPct).toBe(57); // round(4/7*100)
    expect(a.term!.label).toBe("Term 2 · 2025/26");
    // the identity that proves the numerator choice + that excused sits in the denominator only:
    expect(a.term!.atSchoolDays).toBe(a.term!.counts.present + a.term!.counts.late);
    expect(a.term!.markedDays).toBe(
      a.term!.counts.present + a.term!.counts.late + a.term!.counts.excused + a.term!.counts.absent,
    );
  });

  it("ratePct is null (not 0/100) when nothing is marked (AC-PATT-13)", () => {
    const a = buildParentAttendance(TERMS, [], [], TODAY);
    expect(a.term).not.toBeNull(); // the term still resolves (by date) — it just has no marks
    expect(a.term!.markedDays).toBe(0);
    expect(a.term!.atSchoolPct).toBeNull();
    expect(a.recentAbsences).toEqual([]);
    expect(a.priorTerm).toBeNull(); // no prior-term marks → no fabricated 0%
  });

  it("no academic term → term null, never an invented rate (AC-PATT-20)", () => {
    const a = buildParentAttendance([], ROWS, [], TODAY);
    expect(a.term).toBeNull();
    expect(a.priorTerm).toBeNull();
  });

  it("today = the child's mark for today, else null; the hero fold never emits MEDICAL", () => {
    expect(buildParentAttendance(TERMS, ROWS, HOLIDAYS, TODAY).today).toEqual({
      date: "2026-02-11",
      bucket: "PRESENT",
    });
    // a today with no row → null (weekend/holiday/not-marked); the hero is omitted.
    const noMark = buildParentAttendance(TERMS, ROWS, HOLIDAYS, "2026-02-14");
    expect(noMark.today).toBeNull();
  });

  it("week strip is Mon–Fri, flags today, and marks a holiday as a non-school day", () => {
    const a = buildParentAttendance(TERMS, ROWS, HOLIDAYS, TODAY);
    expect(a.week).toHaveLength(5);
    expect(a.week.map((d) => d.date)).toEqual([
      "2026-02-09", "2026-02-10", "2026-02-11", "2026-02-12", "2026-02-13",
    ]);
    expect(a.week.filter((d) => d.isToday)).toHaveLength(1);
    expect(a.week.find((d) => d.isToday)!.date).toBe("2026-02-11");
    expect(a.week.find((d) => d.date === "2026-02-12")!.isSchoolDay).toBe(false); // holiday
    expect(a.week.find((d) => d.date === "2026-02-09")!.isSchoolDay).toBe(true);
  });

  it("recentAbsences = absent+excused of the current term, most recent first, dates+bucket only", () => {
    const a = buildParentAttendance(TERMS, ROWS, HOLIDAYS, TODAY);
    expect(a.recentAbsences).toEqual([
      { date: "2026-02-13", bucket: "ABSENT" },
      { date: "2026-02-12", bucket: "EXCUSED" },
      { date: "2026-01-16", bucket: "ABSENT" },
    ]);
  });

  it("priorTerm shows ONLY when it has marks (AC-PATT-17 honesty)", () => {
    const a = buildParentAttendance(TERMS, ROWS, HOLIDAYS, TODAY);
    expect(a.priorTerm).toEqual({ label: "Term 1 · 2025/26", atSchoolPct: 100, atSchoolDays: 2, markedDays: 2 });
  });

  it("the term window is inclusive of both the start and end dates (AC-PATT-16)", () => {
    const boundary: ParentAttendanceDay[] = [
      { date: T2.startsOn, bucket: "PRESENT" }, // exactly on term start
      { date: T2.endsOn, bucket: "ABSENT" }, // exactly on term end
    ];
    const a = buildParentAttendance(TERMS, boundary, [], TODAY);
    expect(a.term!.markedDays).toBe(2); // both boundary days fall inside the window
    expect(a.term!.counts).toEqual({ present: 1, late: 0, excused: 0, absent: 1 });
  });
});

describe("parent-attendance-data · reader stays in the parent boundary (source-shape)", () => {
  const reader = () => readCode("lib/parent/parent-attendance-data.ts");

  it("runs under withParentScope only — never withSchool / withoutTenantScope", () => {
    const s = reader();
    expect(s).toMatch(/withParentScope/);
    expect(s).not.toMatch(/withSchool|withoutTenantScope/);
  });

  it("folds MEDICAL→EXCUSED in SQL; the bucket type never carries MEDICAL", () => {
    const s = reader();
    expect(s).toMatch(/when 'MEDICAL' then 'EXCUSED'/); // the fold happens in the projection
    expect(s).toMatch(/AttendanceBucket = "PRESENT" \| "LATE" \| "EXCUSED" \| "ABSENT"/); // no MEDICAL bucket
  });

  it("never selects reason/note/staff/clock, and joins nothing (column guard)", () => {
    const s = reader();
    // target actual Drizzle column access (comments legitimately name these columns as the deny-list).
    expect(s).not.toMatch(/attendanceRecords\.reasonCode/);
    expect(s).not.toMatch(/attendanceRecords\.note/);
    expect(s).not.toMatch(/attendanceRecords\.markedByUserId/);
    expect(s).not.toMatch(/attendanceRecords\.markedAt/);
    expect(s).not.toMatch(/attendanceCorrections/); // the corrections table is never imported/used
    expect(s).not.toMatch(/Join\(/); // no join at all → no users/staff-name reaches the wire
  });
});

describe("parent-chrome · Attendance is the 5th live tab (source-shape)", () => {
  const nav = () => readCode("app/(parent)/parent-chrome.tsx");
  const page = () => readCode("app/(parent)/attendance-summary/page.tsx");

  it("TABS/HREF/ParentTab carry Attendance → /attendance, still no inert span", () => {
    const s = nav();
    expect(s).toMatch(/const TABS = \["WASSCE", "Attendance", "Sickbay", "PTA", "School calendar"\] as const;/);
    expect(s).toMatch(/ParentTab = "WASSCE" \| "Attendance" \| "Sickbay" \| "PTA" \| "School calendar"/);
    expect(s).toMatch(/Attendance: "\/attendance-summary"/); // unique parent URL (/attendance is the staff route)
    expect(s).not.toMatch(/Partial<Record/);
    expect((s.match(/<span/g) ?? []).length).toBe(1); // only the active tab is a span
  });

  it("the attendance route is child-gated and renders its own active nav", () => {
    const s = page();
    expect(s).toMatch(/ParentNav active="Attendance"/);
    expect(s).toMatch(/NoChild/); // per-child surface → linked-child gate (unlike the school-wide calendar)
    expect(s).toMatch(/child\.studentId/); // studentId resolved server-side, passed to the reader
  });
});
