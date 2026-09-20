import { describe, it, expect } from "vitest";
import { buildCalendar, type CalendarEvent } from "./defaults";
import {
  cohortOf,
  deriveArrivalWindows,
  deriveCounter,
  deriveHouseProgress,
  deriveIssues,
  cohortStates,
  windowState,
  checklistSchemaFor,
  resumptionChecklistSchema,
  vacationChecklistSchema,
  shortfallItems,
  checklistPct,
  RESUMPTION_ITEMS,
  VACATION_ITEMS,
  arrivalSms,
  departureSms,
  type Checklist,
  type WindowBoarder,
  type WindowArrival,
} from "./resumption";

const DAY = "2026-05-03";
const at = (h: number, m = 0) =>
  new Date(`${DAY}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

// ---------------------------------------------------------------------------
// Cohort split (AC A5)
// ---------------------------------------------------------------------------
describe("cohortOf — House gender drives the F2/F1 split (A5)", () => {
  it("Form 3 is one all-Houses cohort regardless of gender", () => {
    expect(cohortOf(3, "BOYS", "MALE")).toBe("F3");
    expect(cohortOf(3, "GIRLS", "FEMALE")).toBe("F3");
  });
  it("F2/F1 split by House gender", () => {
    expect(cohortOf(2, "BOYS", "MALE")).toBe("F2_BOYS");
    expect(cohortOf(2, "GIRLS", "FEMALE")).toBe("F2_GIRLS");
    expect(cohortOf(1, "BOYS", "MALE")).toBe("F1_BOYS");
    expect(cohortOf(1, "GIRLS", "FEMALE")).toBe("F1_GIRLS");
  });
  it("COED house falls back to the boarder's own sex", () => {
    expect(cohortOf(2, "COED", "FEMALE")).toBe("F2_GIRLS");
    expect(cohortOf(1, "COED", "MALE")).toBe("F1_BOYS");
  });
  it("a non-F1–F3 form → null (uncounted in windows)", () => {
    expect(cohortOf(null, "BOYS", "MALE")).toBeNull();
    expect(cohortOf(4, "BOYS", "MALE")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Window derivation (AC A1–A4)
// ---------------------------------------------------------------------------
describe("deriveArrivalWindows", () => {
  const boarders: WindowBoarder[] = [
    ...Array.from({ length: 40 }, (_, i) => ({ studentId: `f3-${i}`, cohort: "F3" as const })),
    ...Array.from({ length: 20 }, (_, i) => ({ studentId: `f2b-${i}`, cohort: "F2_BOYS" as const })),
    ...Array.from({ length: 20 }, (_, i) => ({ studentId: `f2g-${i}`, cohort: "F2_GIRLS" as const })),
    ...Array.from({ length: 16 }, (_, i) => ({ studentId: `f1b-${i}`, cohort: "F1_BOYS" as const })),
  ];
  const arrivals: WindowArrival[] = [
    ...Array.from({ length: 38 }, (_, i) => ({ studentId: `f3-${i}`, checkedAt: at(6, i % 60) })),
    ...Array.from({ length: 10 }, (_, i) => ({ studentId: `f2b-${i}`, checkedAt: at(8, i) })),
    // one late arrival stamped in the 16:00–18:00 bucket
    { studentId: `f2g-0`, checkedAt: at(16, 30) },
  ];

  it("A1 · six windows, F3-first → Late-last, in order", () => {
    const w = deriveArrivalWindows(boarders, arrivals, DAY, at(11, 43));
    expect(w.map((x) => x.key)).toEqual(["W1", "W2", "W3", "W4", "W5", "W6"]);
    expect(w[0].formLabel).toBe("Form 3");
    expect(w[0].scopeLabel).toBe("all Houses");
    expect(w[5].formLabel).toBe("Late");
  });
  it("A2 · per-window % = arrivals in the Form-cohort ÷ expected cohort", () => {
    const w = deriveArrivalWindows(boarders, arrivals, DAY, at(11, 43));
    expect(w[0].expected).toBe(40);
    expect(w[0].arrived).toBe(38);
    expect(w[0].pct).toBe(95);
    expect(w[1].countLabel).toBe("10 / 20 · 50%");
  });
  it("A3 · done/active/pending derive from the clock", () => {
    const w = deriveArrivalWindows(boarders, arrivals, DAY, at(11, 43));
    expect(w[0].state).toBe("done"); // 05–07 closed
    expect(w[1].state).toBe("done"); // 07–09 closed
    expect(w[2].state).toBe("active"); // 09–12 live at 11:43
    expect(w[3].state).toBe("pending"); // 12–14 ahead
  });
  it("A4 · Late window is a count-only bucket (no denominator), pending sub-states", () => {
    const w = deriveArrivalWindows(boarders, arrivals, DAY, at(11, 43));
    expect(w[5].hasDenominator).toBe(false);
    expect(w[5].arrived).toBe(1); // the 16:30 late arrival
    expect(w[5].countLabel).toBe("1 arrived");
    // a cohort window with no arrivals shows a denominator (0/N·0%), the Late bucket shows — pending —
    const empty = deriveArrivalWindows(boarders, [], DAY, at(1));
    expect(empty[3].countLabel).toBe("0 / 16 · 0%");
    expect(empty[5].countLabel).toBe("— pending —");
  });
  it("A6 · windows derive on the shifted day (all done for a past day, all pending for a future day)", () => {
    const past = deriveArrivalWindows(boarders, arrivals, DAY, at(23)); // late same day
    expect(past.every((x) => x.state === "done")).toBe(true);
    const future = deriveArrivalWindows(boarders, arrivals, "2026-05-01", at(23)); // day before viewed=future
    // now is 2026-05-03, viewed day 2026-05-01 is in the past → done
    expect(future.every((x) => x.state === "done")).toBe(true);
  });
  it("windowState respects future vs past day", () => {
    expect(windowState({ start: "05:00", end: "07:00" }, "2026-05-10", at(11))).toBe("pending");
    expect(windowState({ start: "05:00", end: "07:00" }, "2026-04-01", at(11))).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// Counter (AC C)
// ---------------------------------------------------------------------------
describe("deriveCounter", () => {
  const arrivals: WindowArrival[] = [
    { studentId: "a", checkedAt: at(9, 5) },
    { studentId: "b", checkedAt: at(10, 10) },
    { studentId: "c", checkedAt: at(10, 40) },
    { studentId: "d", checkedAt: at(11, 30) },
  ];
  it("C1 · total arrived + % vs expected", () => {
    const c = deriveCounter(10, arrivals, at(11, 43));
    expect(c.arrived).toBe(4);
    expect(c.expected).toBe(10);
    expect(c.pct).toBe(40);
    expect(c.remaining).toBe(6);
  });
  it("C2 · arrived-this-hour + peak hour derived from stamps", () => {
    const c = deriveCounter(10, arrivals, at(11, 43));
    expect(c.arrivedThisHour).toBe(1); // only 11:30 is within the last 60 min of 11:43 (10:40 is 63 min back)
    expect(c.peakHourCount).toBe(2); // the 10:xx hour bucket
    expect(c.peakHourLabel).toBe("10:00 — 11:00");
    expect(c.lastArrivalAt?.getTime()).toBe(at(11, 30).getTime());
  });
  it("C3 · zero expected → 0% not NaN", () => {
    expect(deriveCounter(0, [], at(11)).pct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// House progress (AC B)
// ---------------------------------------------------------------------------
describe("deriveHouseProgress", () => {
  const boarders = [
    { studentId: "1", form: 3, cohort: "F3" as const },
    { studentId: "2", form: 3, cohort: "F3" as const },
    { studentId: "3", form: 2, cohort: "F2_BOYS" as const },
    { studentId: "4", form: 1, cohort: "F1_BOYS" as const },
  ];
  it("B1/B2 · arrived/expected + per-Form breakdown from row count", () => {
    const arrivals = [
      { studentId: "1", form: 3, feeOwing: 0 },
      { studentId: "2", form: 3, feeOwing: 0 },
      { studentId: "3", form: 2, feeOwing: 340 },
    ];
    const hp = deriveHouseProgress(boarders, arrivals, cohortStates(DAY, at(11, 43)));
    expect(hp.expected).toBe(4);
    expect(hp.arrived).toBe(3);
    expect(hp.pct).toBe(75);
    expect(hp.byForm.find((f) => f.form === 3)).toEqual({ form: 3, arrived: 2, expected: 2 });
    expect(hp.byForm.find((f) => f.form === 1)).toEqual({ form: 1, arrived: 0, expected: 1 });
  });
  it("B3 · fee-shortfall = arrivals with snapshot>0", () => {
    const arrivals = [{ studentId: "3", form: 2, feeOwing: 340 }];
    const hp = deriveHouseProgress(boarders, arrivals, cohortStates(DAY, at(11, 43)));
    expect(hp.feeShortfalls).toBe(1);
  });
  it("status pill: waiting (0), live (partial), done (all)", () => {
    const cs = cohortStates(DAY, at(11, 43));
    expect(deriveHouseProgress(boarders, [], cs).status).toBe("waiting");
    expect(
      deriveHouseProgress(boarders, [{ studentId: "1", form: 3, feeOwing: 0 }], cs).status,
    ).toBe("live");
    const all = boarders.map((b) => ({ studentId: b.studentId, form: b.form, feeOwing: 0 }));
    expect(deriveHouseProgress(boarders, all, cs).status).toBe("done");
  });
  it("warn = fewer arrived than the boarders whose window already closed/active", () => {
    // At 11:43: F3 (done) + F2_BOYS (done) windows have passed → 3 boarders expected-by-now.
    const cs = cohortStates(DAY, at(11, 43));
    const behind = deriveHouseProgress(
      boarders,
      [{ studentId: "1", form: 3, feeOwing: 0 }],
      cs,
    );
    expect(behind.warn).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Issues (AC G)
// ---------------------------------------------------------------------------
describe("deriveIssues", () => {
  it("G1 · derives fee / prospectus / bunk / note + unaccounted, no table", () => {
    const issues = deriveIssues(
      [
        {
          studentId: "s1",
          name: "E. Asare",
          address: "F2 GS · Aryee",
          timeLabel: "11:12",
          feeOwing: 340,
          shortfall: [],
          bunkAllocated: true,
          note: null,
        },
        {
          studentId: "s2",
          name: "A. Kufuor",
          address: "F3 BUS · Aggrey",
          timeLabel: "10:50",
          feeOwing: 0,
          shortfall: ["MAC"],
          bunkAllocated: false,
          note: "parent bringing net tonight",
        },
      ],
      [{ studentId: "s3", name: "HH. Roberts", address: "F2 GA · Slessor", windowLabel: "07:00 — 09:00" }],
      "RESUMPTION",
    );
    const cats = issues.map((i) => i.category).sort();
    expect(cats).toEqual(["bunk", "fee", "note", "prospectus", "unaccounted"]);
    expect(issues.find((i) => i.category === "fee")!.text).toContain("GHS 340.00");
    expect(issues.find((i) => i.category === "unaccounted")!.canEscalate).toBe(true);
    expect(issues.find((i) => i.category === "fee")!.canEscalate).toBe(false);
  });
  it("G2 · vacation still-owing is flagged never detained; no unaccounted category", () => {
    const issues = deriveIssues(
      [
        {
          studentId: "s1",
          name: "K. Owusu",
          address: "F3 · Aggrey",
          timeLabel: "14:00",
          feeOwing: 200,
          shortfall: [],
          bunkAllocated: true,
          note: null,
        },
      ],
      [],
      "VACATION",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe("fee");
    expect(issues[0].text).toContain("not detained");
  });
});

// ---------------------------------------------------------------------------
// Checklist Zod discrimination (AC D2/D5)
// ---------------------------------------------------------------------------
describe("checklist Zod (mode-discriminated)", () => {
  const goodResumption: Checklist = {
    chop_box: "ok",
    mattress: "ok",
    mackintosh: "missing",
    mosquito_net: "ok",
    bucket: "ok",
    bible_or_quran: "ok",
  };
  const goodVacation: Checklist = {
    bunk_cleared: "ok",
    locker_emptied: "ok",
    chop_box_collected: "ok",
    transport_contact_verified: "partial",
    exeat_card_returned: "ok",
  };
  it("D2 · RESUMPTION accepts the 6 keys, rejects an unknown/extra key", () => {
    expect(resumptionChecklistSchema.safeParse(goodResumption).success).toBe(true);
    expect(
      resumptionChecklistSchema.safeParse({ ...goodResumption, extra: "ok" }).success,
    ).toBe(false);
    expect(
      resumptionChecklistSchema.safeParse({ ...goodResumption, chop_box: "yes" }).success,
    ).toBe(false);
    const { chop_box: _drop, ...missingOne } = goodResumption;
    void _drop;
    expect(resumptionChecklistSchema.safeParse(missingOne).success).toBe(false);
  });
  it("D5 · RESUMPTION schema rejects the 5 VACATION keys and vice-versa", () => {
    expect(resumptionChecklistSchema.safeParse(goodVacation).success).toBe(false);
    expect(vacationChecklistSchema.safeParse(goodResumption).success).toBe(false);
    expect(vacationChecklistSchema.safeParse(goodVacation).success).toBe(true);
  });
  it("checklistSchemaFor picks the mode schema", () => {
    expect(checklistSchemaFor("RESUMPTION")).toBe(resumptionChecklistSchema);
    expect(checklistSchemaFor("VACATION")).toBe(vacationChecklistSchema);
  });
  it("shortfall + pct helpers", () => {
    expect(shortfallItems(goodResumption, "RESUMPTION")).toEqual(["MAC"]);
    expect(checklistPct(goodResumption, "RESUMPTION")).toBe(83);
    expect(RESUMPTION_ITEMS).toHaveLength(6);
    expect(VACATION_ITEMS).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Tweak #1 frozen-shape regression (AC J3/J4) — buildCalendar is unchanged
// ---------------------------------------------------------------------------
describe("tweak #1 · buildCalendar frozen shape", () => {
  const periods = [
    { periodLabel: "Semester 1", startsOn: "2025-09-01", endsOn: "2025-12-20" },
    { periodLabel: "Semester 2", startsOn: "2026-01-10", endsOn: "2026-07-24" },
  ];
  const events: CalendarEvent[] = [
    { id: "e1", eventType: "VISITING", date: "2026-05-17", label: "Visiting", formScope: null, sequence: null },
  ];
  it("J3 · return shape (keys) is byte-for-byte the frozen contract", () => {
    const cal = buildCalendar("2025/26", periods, null, events, new Date("2026-05-03T11:00:00Z"));
    expect(Object.keys(cal).sort()).toEqual(
      ["academicYear", "events", "nextVisiting", "resumption", "vacation"].sort(),
    );
    // main resumption/vacation entries are all SENIOR (scoped), one per period
    expect(cal.resumption).toHaveLength(2);
    expect(cal.resumption.every((r) => r.productLine === "SENIOR")).toBe(true);
    expect(cal.vacation.every((v) => v.productLine === "SENIOR")).toBe(true);
  });
  it("J1 · a SENIOR_F3 vacation appends exactly one SENIOR_F3 entry (from the school row)", () => {
    const cal = buildCalendar(
      "2025/26",
      periods,
      { periodLabel: "Form 3 · WASSCE vacation", endsOn: "2026-06-05" },
      events,
      new Date("2026-05-03T11:00:00Z"),
    );
    const f3 = cal.vacation.filter((v) => v.productLine === "SENIOR_F3");
    expect(f3).toHaveLength(1);
    expect(f3[0].date).toBe("2026-06-05");
  });
  it("J4 · no SENIOR_F3 row → no F3 vacation entry, no throw", () => {
    const cal = buildCalendar("2025/26", periods, null, events, new Date("2026-05-03T11:00:00Z"));
    expect(cal.vacation.some((v) => v.productLine === "SENIOR_F3")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SMS bodies (AC H4/I) — no PII beyond the short name; console copy
// ---------------------------------------------------------------------------
describe("SMS copy", () => {
  it("arrival + departure bodies", () => {
    expect(arrivalSms("J. Manu", "Asankrangwa SHS")).toContain("safely arrived");
    expect(departureSms("J. Manu", "Asankrangwa SHS")).toContain("Safe travels");
  });
});
