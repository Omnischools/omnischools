import { describe, it, expect } from "vitest";
import {
  buildCalendar,
  coalesceSettings,
  toExeatPolicy,
  toInspectionPolicy,
  toVisitingPolicy,
  resolveScheduleTemplate,
  GES_DEFAULT_BOARDING_SETTINGS,
  CANONICAL_SCHEDULE_TEMPLATES,
  SEED_CALENDAR_EVENTS,
  type ScheduleTemplate,
  type CalendarEvent,
} from "./defaults";
import {
  DEBOARDINIZATION_LADDER,
  getDeboardinizationLadder,
} from "./deboardinization-ladder";
import {
  hasAnyRole,
  BOARDING_ROLES,
  BOARDING_SCHOOL_SCOPED_ROLES,
} from "@/lib/access";

// The seeded template set, shaped as the DB read would produce it.
const templates: ScheduleTemplate[] = CANONICAL_SCHEDULE_TEMPLATES.map((t) => ({
  ...t,
  active: true,
}));
const stringify = (t: ScheduleTemplate | null) => JSON.stringify(t?.activities ?? null);

describe("A2 · GES-default coalesce (missing settings row)", () => {
  it("a null row coalesces to the GES-default constant, never throws", () => {
    expect(coalesceSettings(null)).toEqual(GES_DEFAULT_BOARDING_SETTINGS);
    expect(coalesceSettings(undefined)).toEqual(GES_DEFAULT_BOARDING_SETTINGS);
  });
  it("policy getters over a missing row return the verbatim GES defaults", () => {
    expect(toExeatPolicy(null).scheduledPerTerm).toBe(3);
    expect(toExeatPolicy(null).returnByTime).toBe("16:00");
    expect(toExeatPolicy(null).dressCode).toBe("Uniform or outing dress");
    expect(toVisitingPolicy(null).cadence).toBe("2nd Sun · monthly");
    expect(toVisitingPolicy(null).hoursStart).toBe("12:00");
    expect(toInspectionPolicy(null).dailyStart).toBe("06:10");
    expect(toInspectionPolicy(null).dailyEnd).toBe("06:20");
  });
  it("a present row overrides the default (edit persists into the read)", () => {
    const edited = { ...GES_DEFAULT_BOARDING_SETTINGS, exeatScheduledPerTerm: 2 };
    expect(toExeatPolicy(edited).scheduledPerTerm).toBe(2);
  });
});

describe("C · schedule resolution (dayType,form) → (dayType,'ALL') → null", () => {
  it("C1 · WEEKDAY / SATURDAY / SUNDAY resolve to distinct templates", () => {
    const wk = stringify(resolveScheduleTemplate(templates, "WEEKDAY"));
    const sat = stringify(resolveScheduleTemplate(templates, "SATURDAY"));
    const sun = stringify(resolveScheduleTemplate(templates, "SUNDAY"));
    expect(wk).not.toBe(sat);
    expect(wk).not.toBe(sun);
    expect(sat).not.toBe(sun);
  });
  it("C2 · SUNDAY ≠ VISITING_SUNDAY", () => {
    const sun = stringify(resolveScheduleTemplate(templates, "SUNDAY"));
    const vis = stringify(resolveScheduleTemplate(templates, "VISITING_SUNDAY"));
    expect(sun).not.toBe(vis);
  });
  it("C3 · WEEKDAY/FORM_3 resolves the 22:00 lights-out variant", () => {
    const f3 = resolveScheduleTemplate(templates, "WEEKDAY", "FORM_3");
    expect(f3?.formScope).toBe("FORM_3");
    const lastActivity = [...(f3?.activities ?? [])]
      .reverse()
      .find((b) => b.kind === "activity");
    expect(lastActivity && lastActivity.kind === "activity" ? lastActivity.range : null).toBe(
      "22:00",
    );
  });
  it("C3 · FORM_1 (no row) falls back to the 'ALL' base", () => {
    const f1 = resolveScheduleTemplate(templates, "WEEKDAY", "FORM_1");
    expect(f1?.formScope).toBe("ALL");
  });
  it("C3 · an unseeded day_type returns null (never fabricated)", () => {
    const noWeekday = templates.filter((t) => t.dayType !== "WEEKDAY");
    expect(resolveScheduleTemplate(noWeekday, "WEEKDAY", "FORM_3")).toBeNull();
    expect(resolveScheduleTemplate([], "SUNDAY")).toBeNull();
  });
  it("C4 · activities_json preserves order + both block kinds", () => {
    const wk = resolveScheduleTemplate(templates, "WEEKDAY");
    const blocks = wk?.activities ?? [];
    expect(blocks[0]?.kind).toBe("section");
    expect(blocks[1]?.kind).toBe("activity");
    expect(blocks.filter((b) => b.kind === "section")).toHaveLength(4);
    expect(blocks.filter((b) => b.kind === "activity")).toHaveLength(15);
  });
});

describe("D · calendar derives (never duplicates the term model)", () => {
  const periods = [
    { periodLabel: "Semester 1", startsOn: "2025-09-09", endsOn: "2025-12-19" },
    { periodLabel: "Semester 2", startsOn: "2026-01-13", endsOn: "2026-07-10" },
  ];
  const f3 = { periodLabel: "Semester 2", endsOn: "2026-06-21" };
  const events: CalendarEvent[] = [
    { id: "e1", eventType: "VISITING", date: "2026-05-17", label: "Visiting Sunday", formScope: null, sequence: null },
    { id: "e2", eventType: "EXEAT_WINDOW", date: "2026-05-31", label: "Exeat 1 of 3", formScope: null, sequence: 1 },
  ];
  const cal = buildCalendar("2025/26", periods, f3, events, new Date("2026-05-01"));

  it("D1 · resumption/vacation == SENIOR academic_period dates", () => {
    expect(cal.resumption.map((r) => r.date)).toEqual(["2025-09-09", "2026-01-13"]);
    expect(cal.resumption.every((r) => r.productLine === "SENIOR")).toBe(true);
    const seniorVac = cal.vacation.filter((v) => v.productLine === "SENIOR").map((v) => v.date);
    expect(seniorVac).toEqual(["2025-12-19", "2026-07-10"]);
  });
  it("D2 · F3 vacation is the SENIOR_F3 date, distinct from F1/F2", () => {
    const f3vac = cal.vacation.find((v) => v.productLine === "SENIOR_F3");
    expect(f3vac?.date).toBe("2026-06-21");
    const f1f2Sem2 = cal.vacation.find(
      (v) => v.productLine === "SENIOR" && v.periodLabel === "Semester 2",
    );
    expect(f3vac?.date).not.toBe(f1f2Sem2?.date);
  });
  it("D3 · only VISITING/EXEAT_WINDOW events; no resumption/vacation leaks into events", () => {
    expect(cal.events.every((e) => e.eventType === "VISITING" || e.eventType === "EXEAT_WINDOW")).toBe(
      true,
    );
    // formScope + sequence round-trip through the shape.
    expect(cal.events.find((e) => e.id === "e2")?.sequence).toBe(1);
  });
  it("D · nextVisiting is the earliest future VISITING event", () => {
    expect(cal.nextVisiting?.id).toBe("e1");
    const past = buildCalendar("2025/26", periods, f3, events, new Date("2026-06-01"));
    expect(past.nextVisiting).toBeNull();
  });
  it("D · with no SENIOR_F3 default, no F3 vacation is fabricated", () => {
    const noF3 = buildCalendar("2025/26", periods, null, events, new Date("2026-05-01"));
    expect(noF3.vacation.some((v) => v.productLine === "SENIOR_F3")).toBe(false);
  });
});

describe("seed events — the surface's VISITING/EXEAT rows only (never resumption/vacation)", () => {
  it("stores 7 events, all VISITING/EXEAT_WINDOW, with the exeat sequence 1..3", () => {
    expect(SEED_CALENDAR_EVENTS).toHaveLength(7);
    expect(
      SEED_CALENDAR_EVENTS.every((e) => e.eventType === "VISITING" || e.eventType === "EXEAT_WINDOW"),
    ).toBe(true);
    const exeatSeq = SEED_CALENDAR_EVENTS.filter((e) => e.eventType === "EXEAT_WINDOW").map(
      (e) => e.sequence,
    );
    expect(exeatSeq).toEqual([1, 2, 3]);
  });
});

describe("F · deboardinization ladder (read-only from the constant)", () => {
  it("F1 · 5 ordered rungs, NOTE→WARNING→BOND→SUSPENSION→DEBOARDINIZATION", () => {
    expect(DEBOARDINIZATION_LADDER).toHaveLength(5);
    expect(DEBOARDINIZATION_LADDER.map((r) => r.stage)).toEqual([1, 2, 3, 4, 5]);
    expect(DEBOARDINIZATION_LADDER.map((r) => r.severity)).toEqual([
      "NOTE",
      "WARNING",
      "BOND",
      "SUSPENSION",
      "DEBOARDINIZATION",
    ]);
  });
  it("F2 · rung 5 = co-sign × 3 (HM, Senior HM, Headmaster), Board-only reversal", () => {
    const rung5 = DEBOARDINIZATION_LADDER[4];
    expect(rung5.coSignCount).toBe(3);
    expect(rung5.coSignRoles).toEqual(["HM", "Senior HM", "Headmaster"]);
    expect(rung5.reversalNote).toMatch(/board/i);
    expect(rung5.penaltyLabel).toBe("CO-SIGN × 3 · 3× FEE PENALTY");
  });
  it("getDeboardinizationLadder(schoolId) returns the canonical constant", () => {
    expect(getDeboardinizationLadder("any-school")).toBe(DEBOARDINIZATION_LADDER);
  });
});

describe("H · role gating (the write gate authorizeWrite() applies server-side)", () => {
  it("H2 · a plain HOUSEMASTER reads (BOARDING_ROLES) but cannot write (SCHOOL_SCOPED)", () => {
    expect(hasAnyRole(["HOUSEMASTER"], BOARDING_ROLES)).toBe(true);
    expect(hasAnyRole(["HOUSEMASTER"], BOARDING_SCHOOL_SCOPED_ROLES)).toBe(false);
  });
  it("H1 · ADMIN/HEADMASTER/DEAN all pass the write gate", () => {
    for (const r of ["ADMIN", "HEADMASTER", "DEAN_OF_BOARDING"]) {
      expect(hasAnyRole([r], BOARDING_SCHOOL_SCOPED_ROLES)).toBe(true);
    }
  });
  it("H3 · STUDENT/PARENT/TEACHER/MATRON/BURSAR fail the read gate", () => {
    for (const r of ["STUDENT", "PARENT", "TEACHER", "MATRON", "BURSAR"]) {
      expect(hasAnyRole([r], BOARDING_ROLES)).toBe(false);
    }
  });
});
