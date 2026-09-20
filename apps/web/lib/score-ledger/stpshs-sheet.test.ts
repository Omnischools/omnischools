import { describe, it, expect } from "vitest";
import {
  deScaleCap,
  categoryExport,
  isLedgerQualifying,
  rosterQualifies,
  overHundredCells,
  type StpshsCats,
} from "./stpshs-sheet";

const cats = (over: Partial<StpshsCats> = {}): StpshsCats => ({
  asgn: 72,
  midSem: 68,
  endSem: 81,
  project: 75,
  portfolio: 80,
  ...over,
});

// ---------------------------------------------------- B · de-scale + cap (AC §B1–B6, §G5)
describe("categoryExport — cap-to-100 then de-scale (Kofi Q2/Q5)", () => {
  it("B1 portfolio /10 stored 80 → '8'", () => {
    expect(categoryExport(80, 10)).toBe("8");
  });
  it("B2 assignment /100 stored 72 → '72'", () => {
    expect(categoryExport(72, 100)).toBe("72");
  });
  it("B3 portfolio /10 stored 100 → '10'; 50 → '5'", () => {
    expect(categoryExport(100, 10)).toBe("10");
    expect(categoryExport(50, 10)).toBe("5");
  });
  it("B4 no denom → falls back to 100 → identity (not a portfolio special-case)", () => {
    expect(categoryExport(72, 100)).toBe("72");
    expect(categoryExport(8, 100)).toBe("8");
  });
  it("B5 project /20 stored 90 → '18'", () => {
    expect(categoryExport(90, 20)).toBe("18");
  });
  it("B6 keeps 2dp, never rounds to integer: 71.43 /100 → '71.43'; 85 /10 → '8.5'", () => {
    expect(categoryExport(71.43, 100)).toBe("71.43");
    expect(categoryExport(85, 10)).toBe("8.5");
  });
  it("strips trailing zeros: 8.50 → '8.5', 8.00 → '8'", () => {
    expect(categoryExport(85, 10)).toBe("8.5");
    expect(categoryExport(80, 10)).toBe("8");
  });
  it("G5 acknowledged over-cap: portfolio 110 /10 → '10'; asgn 105 /100 → '100'", () => {
    expect(categoryExport(110, 10)).toBe("10");
    expect(categoryExport(105, 100)).toBe("100");
  });
  it("caps at 100 before de-scale (a bonus 120 /100 never prints >100)", () => {
    expect(deScaleCap(120, 100)).toBe(100);
    expect(categoryExport(120, 100)).toBe("100");
  });
  it("null (unfilled) → '—' (never reached on a gated sheet)", () => {
    expect(categoryExport(null, 10)).toBe("—");
  });
});

// ---------------------------------------------------- D · qualifying gate (AC §D)
describe("isLedgerQualifying / rosterQualifies (Kofi Q3)", () => {
  it("D1/D3 COMPLETE and STPSHS_READY both qualify", () => {
    expect(isLedgerQualifying("COMPLETE")).toBe(true);
    expect(isLedgerQualifying("STPSHS_READY")).toBe(true);
  });
  it("D2 DRAFT and a missing ledger row (null) do not qualify", () => {
    expect(isLedgerQualifying("DRAFT")).toBe(false);
    expect(isLedgerQualifying(null)).toBe(false);
  });
  it("rosterQualifies only when every active student is ready", () => {
    expect(rosterQualifies(["COMPLETE", "STPSHS_READY"])).toBe(true);
    expect(rosterQualifies(["COMPLETE", "DRAFT"])).toBe(false);
    expect(rosterQualifies(["COMPLETE", null])).toBe(false);
  });
  it("an empty roster never qualifies (nothing to submit)", () => {
    expect(rosterQualifies([])).toBe(false);
  });
});

// ---------------------------------------------------- G · over-100 gate (AC §G)
describe("overHundredCells (Kofi Q5)", () => {
  it("G2 flags every stored category >100, naming student + category", () => {
    const rows = [
      { studentId: "s1", name: "Ama Asante", cats: cats({ portfolio: 110 }) },
      { studentId: "s2", name: "Kojo Mensah", cats: cats({ asgn: 105 }) },
    ];
    expect(overHundredCells(rows)).toEqual([
      { studentId: "s1", name: "Ama Asante", category: "portfolio" },
      { studentId: "s2", name: "Kojo Mensah", category: "asgn" },
    ]);
  });
  it("G3 exactly 100 and below are clear (boundary is strict >)", () => {
    expect(overHundredCells([{ studentId: "s1", name: "A", cats: cats({ endSem: 100 }) }])).toEqual(
      [],
    );
  });
  it("clear when every category is ≤100 or null", () => {
    expect(
      overHundredCells([{ studentId: "s1", name: "A", cats: cats({ portfolio: null }) }]),
    ).toEqual([]);
  });
  it("reports multiple over-100 cells for one student", () => {
    const rows = [{ studentId: "s1", name: "A", cats: cats({ asgn: 101, portfolio: 200 }) }];
    expect(overHundredCells(rows).map((c) => c.category)).toEqual(["asgn", "portfolio"]);
  });
});
