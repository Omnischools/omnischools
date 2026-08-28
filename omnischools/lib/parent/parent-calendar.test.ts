import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import { buildParentCalendar, type CalendarTermRow, type ParentCalendarHoliday } from "./parent-calendar-data";

/**
 * INCR-278 · the parent-portal School Calendar tab. Two guards:
 *  1. the PURE honest derivation (buildParentCalendar) — Kofi AC-CAL-06..10/16/17: current = today-in-term
 *     and ONLY that (no force-mark in a gap), next = first future term or none, holidays windowed to the
 *     reference year, progress only for the current term.
 *  2. source-shape — the reader stays inside withParentScope with no per-child / staff-PII column, and the
 *     nav is FOUR live routes with no inert "coming soon" spans (R234).
 */

// 2025/26: three ascending terms with a Christmas gap and an Easter gap.
const TERMS: CalendarTermRow[] = [
  { label: "Term 1", academicYear: "2025/26", startsOn: "2025-09-01", endsOn: "2025-12-19" },
  { label: "Term 2", academicYear: "2025/26", startsOn: "2026-01-06", endsOn: "2026-04-10" },
  { label: "Term 3", academicYear: "2025/26", startsOn: "2026-05-04", endsOn: "2026-08-07" },
];
const HOLIDAYS: ParentCalendarHoliday[] = [
  { name: "Old-year break", startsOn: "2024-12-20", endsOn: "2025-01-03", kind: "BREAK" }, // out of 2025/26
  { name: "Independence Day", startsOn: "2026-03-06", endsOn: "2026-03-06", kind: "PUBLIC" }, // in Term 2
];

describe("buildParentCalendar · honest derivation (AC-CAL-*)", () => {
  it("marks ONLY the term containing today as current, and gives day-progress for it", () => {
    const c = buildParentCalendar(TERMS, HOLIDAYS, "2026-02-15"); // inside Term 2
    expect(c.terms.map((t) => t.isCurrent)).toEqual([false, true, false]);
    expect(c.current?.label).toBe("Term 2");
    expect(c.current!.total).toBeGreaterThan(0);
    expect(c.current!.dayOf).toBeGreaterThan(0);
    expect(c.current!.dayOf).toBeLessThanOrEqual(c.current!.total);
    expect(c.academicYear).toBe("2025/26");
  });

  it("force-marks NO term current in an out-of-term gap (R90 — never snap to the nearest)", () => {
    const c = buildParentCalendar(TERMS, HOLIDAYS, "2025-12-25"); // Christmas gap, between Term 1 and 2
    expect(c.current).toBeNull();
    expect(c.terms.some((t) => t.isCurrent)).toBe(false);
    expect(c.nextTerm?.label).toBe("Term 2"); // the gap still points at the upcoming term
  });

  it("nextTerm is the first future term, and null once none remain", () => {
    expect(buildParentCalendar(TERMS, HOLIDAYS, "2026-02-15").nextTerm?.label).toBe("Term 3");
    const after = buildParentCalendar(TERMS, HOLIDAYS, "2026-09-01"); // past every term
    expect(after.nextTerm).toBeNull();
    expect(after.current).toBeNull();
    expect(after.academicYear).toBe("2025/26"); // most-recent term's year is the reference
  });

  it("windows holidays to the reference academic year (drops other years)", () => {
    const c = buildParentCalendar(TERMS, HOLIDAYS, "2026-02-15");
    expect(c.holidays.map((h) => h.name)).toEqual(["Independence Day"]); // the 2024 break is dropped
  });

  it("no terms → an all-empty calendar (AC-CAL-16), never an invented date", () => {
    const c = buildParentCalendar([], HOLIDAYS, "2026-02-15");
    expect(c.terms).toEqual([]);
    expect(c.current).toBeNull();
    expect(c.nextTerm).toBeNull();
    expect(c.academicYear).toBeNull();
    expect(c.holidays).toEqual([]); // no year window → no holidays surfaced
  });

  it("terms but no holidays → terms/progress stand, holidays empty (AC-CAL-17)", () => {
    const c = buildParentCalendar(TERMS, [], "2026-02-15");
    expect(c.current?.label).toBe("Term 2");
    expect(c.holidays).toEqual([]);
  });
});

describe("parent-calendar-data · reader stays in the parent boundary (source-shape)", () => {
  const reader = () => readCode("lib/parent/parent-calendar-data.ts");

  it("runs under withParentScope only — never withSchool / withoutTenantScope", () => {
    const s = reader();
    expect(s).toMatch(/withParentScope/);
    expect(s).not.toMatch(/withSchool|withoutTenantScope/);
  });

  it("excludes the SENIOR_F3 pseudo-period and never returns staff-PII / per-child columns", () => {
    const s = reader();
    expect(s).toMatch(/ne\(academicPeriod\.productLine, "SENIOR_F3"\)/); // AC-CAL-06
    expect(s).not.toMatch(/closedBy/i); // closed_by_user_id (staff PII) never selected — AC-CAL-11
    expect(s).not.toMatch(/productLine:/); // product_line filters in WHERE, never projected — AC-CAL-06
    expect(s).not.toMatch(/\bstudents\b/); // no per-child table at all — AC-CAL-11/12
    expect(s).not.toMatch(/boarding_calendar_event|boardingCalendar/i); // visiting days deferred — AC-CAL-12
  });
});

describe("parent-chrome · no inert tabs, calendar live (AC-CAL-01..04)", () => {
  const nav = () => readCode("app/(parent)/parent-chrome.tsx");
  const page = () => readCode("app/(parent)/calendar/page.tsx");

  // Count-robust: assert the #278 INTENT (the three inert tabs stay gone, calendar is a live route, no inert
  // spans) rather than pinning the whole TABS literal — so adding a later live tab can't red this test.
  it("the three inert tabs are gone and School calendar is a live route (no inert spans)", () => {
    const s = nav();
    // quoted → only TABS/HREF/the ParentTab union carry these, never the prose comment.
    expect(s).not.toMatch(/"Communications"/); // AC-CAL-01
    expect(s).not.toMatch(/"Billing"/);
    expect(s).not.toMatch(/"Boarding"/);
    expect(s).toMatch(/"School calendar": "\/calendar"/); // still a live route — AC-CAL-03
    expect(s).not.toMatch(/Partial<Record/); // HREF is total → no tab can be an inert span — AC-CAL-02
    expect(s).not.toMatch(/coming soon|disabled|greyed/i); // AC-CAL-04
    expect((s.match(/<span/g) ?? []).length).toBe(1); // the ONLY span is the active tab — AC-CAL-02
  });

  it("the calendar route is school-wide — active nav, no child gate", () => {
    const s = page();
    expect(s).toMatch(/ParentNav active="School calendar"/); // AC-CAL-03
    expect(s).not.toMatch(/NoChild/); // school-wide → no linked-child gate (fail-closes to Empty via RLS)
    expect(s).toMatch(/calendar\.terms\.length === 0/); // the one honest empty — AC-CAL-16
  });
});
