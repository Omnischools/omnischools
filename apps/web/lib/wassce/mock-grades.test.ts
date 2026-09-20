import { describe, it, expect } from "vitest";
import {
  WASSCE_GRADES,
  isWassceGrade,
  gradeOrdinal,
  isCredit,
  isDistinction,
  isFocusBand,
  effectiveGrade,
  trajectory,
  gradeDistribution,
  creditRate,
  distinctionRate,
  toPct,
  meanGrade,
  benchmarkDot,
  type WassceGrade,
} from "./mock-grades";

// The exact Mock-2 Chemistry distribution the surface (§B.1.4) renders — 4/8/9/4/2/1 across the top
// six bands = 28 candidates. Every derived figure below must fall out of THIS array, never a literal.
const MOCK2_28: WassceGrade[] = [
  ...Array<WassceGrade>(4).fill("A1"),
  ...Array<WassceGrade>(8).fill("B2"),
  ...Array<WassceGrade>(9).fill("B3"),
  ...Array<WassceGrade>(4).fill("C4"),
  ...Array<WassceGrade>(2).fill("C5"),
  ...Array<WassceGrade>(1).fill("C6"),
];

describe("wassce grade order + validation (AC6)", () => {
  it("orders A1 best (0) → F9 worst (8), matching the wassce_grade enum", () => {
    expect(WASSCE_GRADES.length).toBe(9);
    expect(gradeOrdinal("A1")).toBe(0);
    expect(gradeOrdinal("C6")).toBe(5);
    expect(gradeOrdinal("F9")).toBe(8);
  });
  it("accepts the 9 bands and rejects anything else", () => {
    expect(isWassceGrade("A1")).toBe(true);
    expect(isWassceGrade("F9")).toBe(true);
    expect(isWassceGrade("A")).toBe(false);
    expect(isWassceGrade("G0")).toBe(false);
    expect(isWassceGrade(4)).toBe(false);
    expect(isWassceGrade(null)).toBe(false);
  });
  it("bands credit (≤C6), distinction (≤B2) and focus (C5–C6)", () => {
    expect(isCredit("C6")).toBe(true);
    expect(isCredit("D7")).toBe(false);
    expect(isDistinction("B2")).toBe(true);
    expect(isDistinction("B3")).toBe(false);
    expect(isFocusBand("C5")).toBe(true);
    expect(isFocusBand("C6")).toBe(true);
    expect(isFocusBand("C4")).toBe(false);
    expect(isFocusBand("A1")).toBe(false);
  });
});

describe("predicted / effective grade — COALESCE on read (AC7 / AC10)", () => {
  it("uses the teacher grade when un-moderated", () => {
    expect(effectiveGrade({ grade: "B2", moderatedGrade: null })).toBe("B2");
  });
  it("supersedes with the moderated grade, original preserved separately", () => {
    expect(effectiveGrade({ grade: "C5", moderatedGrade: "C4" })).toBe("C4");
  });
});

describe("trajectory Mock 1 → Mock 2 (AC8)", () => {
  it("↑ N grade when improved (lower ordinal in Mock 2)", () => {
    expect(trajectory("B2", "A1")).toMatchObject({ dir: "up", steps: 1, label: "↑ 1 grade" });
    expect(trajectory("C4", "B3")).toMatchObject({ dir: "up", steps: 1 });
  });
  it("↓ N grade when slipped", () => {
    expect(trajectory("C4", "C5")).toMatchObject({ dir: "down", steps: -1, label: "↓ 1 grade" });
    expect(trajectory("C5", "C6")).toMatchObject({ dir: "down", label: "↓ 1 grade" });
  });
  it("→ holding when flat and B3 or better; → stuck when flat and borderline", () => {
    expect(trajectory("A1", "A1")).toMatchObject({ dir: "flat", label: "→ holding" });
    expect(trajectory("B2", "B2")).toMatchObject({ dir: "flat", label: "→ holding" });
    expect(trajectory("C5", "C5")).toMatchObject({ dir: "flat", label: "→ stuck" });
  });
  it("renders an em-dash when Mock 1 is missing", () => {
    expect(trajectory(null, "A1").label).toBe("—");
  });
});

describe("histogram + rates derive from the 28 real grades (AC9)", () => {
  it("counts per grade match the surface histogram (4/8/9/4/2/1, empty D7–F9)", () => {
    const d = gradeDistribution(MOCK2_28);
    expect(d).toMatchObject({ A1: 4, B2: 8, B3: 9, C4: 4, C5: 2, C6: 1, D7: 0, E8: 0, F9: 0 });
    expect(Object.values(d).reduce((a, b) => a + b, 0)).toBe(28);
  });
  it("credit rate = 100% and distinction rate = 43% (12/28 at A1/B2)", () => {
    expect(toPct(creditRate(MOCK2_28))).toBe(100);
    expect(toPct(distinctionRate(MOCK2_28))).toBe(43);
  });
  it("cohort mean grade is B3", () => {
    expect(meanGrade(MOCK2_28)).toBe("B3");
  });
  it("empty cohort → 0 rates, null mean", () => {
    expect(creditRate([])).toBe(0);
    expect(meanGrade([])).toBeNull();
  });
});

describe("benchmark provenance dot (AC11)", () => {
  it("maps quality tiers to the strong/mod/weak dots", () => {
    expect(benchmarkDot("STRONG").dotClass).toBe("bg-green");
    expect(benchmarkDot("MODERATE").dotClass).toBe("bg-gold");
    expect(benchmarkDot("DIRECTIONAL")).toMatchObject({ key: "weak", dotClass: "bg-warn" });
  });
});
