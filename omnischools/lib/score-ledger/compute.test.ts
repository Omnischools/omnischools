import { describe, it, expect } from "vitest";
import {
  SYSTEM_DEFAULT_WEIGHTS,
  SYSTEM_DEFAULT_DENOMINATORS,
  MAX_PERCENT,
  resolveWeights,
  resolveDenominators,
  percent,
  exceedsMax,
  meanPercent,
  compileComputableCategories,
  allCategoriesPresent,
  weightedTotalComplete,
  provisionalTotal,
  computedStatus,
  type CategoryScores,
  type CategoryDenominators,
  type EventMark,
} from "./compute";

const W = SYSTEM_DEFAULT_WEIGHTS; // 15/15/40/15/15

describe("resolveWeights", () => {
  const subj = { asgn: 20, midSem: 10, endSem: 40, project: 15, portfolio: 15 };
  const school = { asgn: 25, midSem: 15, endSem: 30, project: 15, portfolio: 15 };
  it("prefers the per-subject override", () => {
    expect(resolveWeights(subj, school)).toBe(subj);
  });
  it("falls back to the school default when no subject row", () => {
    expect(resolveWeights(null, school)).toBe(school);
  });
  it("falls back to the system constant when neither exists", () => {
    expect(resolveWeights(null, null)).toEqual(W);
    expect(resolveWeights(undefined, undefined)).toEqual(W);
  });
});

describe("resolveDenominators (A · denominator resolution)", () => {
  const subj: CategoryDenominators = {
    asgn: 100,
    midSem: 100,
    endSem: 100,
    project: 100,
    portfolio: 20,
  };
  const school: CategoryDenominators = {
    asgn: 100,
    midSem: 100,
    endSem: 100,
    project: 100,
    portfolio: 10,
  };
  it("A4 prefers the per-subject override over the school default", () => {
    expect(resolveDenominators(subj, school)).toBe(subj);
  });
  it("falls back to the school default when there is no subject row", () => {
    expect(resolveDenominators(null, school)).toBe(school);
  });
  it("A3 falls back to the system 100s when neither row exists (never inflates)", () => {
    expect(resolveDenominators(null, null)).toEqual(SYSTEM_DEFAULT_DENOMINATORS);
    expect(SYSTEM_DEFAULT_DENOMINATORS).toEqual({
      asgn: 100,
      midSem: 100,
      endSem: 100,
      project: 100,
      portfolio: 100,
    });
  });
});

describe("percent", () => {
  it("computes a 0–100 percentage", () => {
    expect(percent(8, 10)).toBe(80);
    expect(percent(45, 50)).toBe(90);
  });
  it("returns null for a blank mark", () => {
    expect(percent(null, 10)).toBeNull();
  });
  it("returns null when max ≤ 0 (never divides by zero)", () => {
    expect(percent(5, 0)).toBeNull();
    expect(percent(5, -1)).toBeNull();
  });
  it("allows over-max (bonus) marks to exceed 100 rather than clamping", () => {
    expect(percent(12, 10)).toBe(120);
  });
  it("rounds to 2 dp", () => {
    expect(percent(1, 3)).toBe(33.33);
  });
  it("caps a pathological over-max at MAX_PERCENT so it never overflows numeric(5,2)", () => {
    // 500 out of 10 = 5000% → capped, not a DB overflow (Quinn MAJOR).
    expect(percent(500, 10)).toBe(MAX_PERCENT);
    expect(percent(999.99, 1)).toBe(MAX_PERCENT);
  });
});

describe("exceedsMax", () => {
  it("flags a mark above its event max (soft warn, never a block)", () => {
    expect(exceedsMax(12, 10)).toBe(true);
    expect(exceedsMax(10, 10)).toBe(false);
    expect(exceedsMax(null, 10)).toBe(false);
  });
});

describe("meanPercent — blank is not zero (Kofi Q2)", () => {
  it("averages only the non-blank events", () => {
    const events: EventMark[] = [
      { category: "ASSIGNMENT", maxMark: 10, rawMark: 8 }, // 80
      { category: "ASSIGNMENT", maxMark: 10, rawMark: null }, // excluded
    ];
    // Mean of [80], NOT (80+0)/2 = 40.
    expect(meanPercent(events)).toBe(80);
  });
  it("treats an explicit 0 as a real score, distinct from blank", () => {
    const events: EventMark[] = [
      { category: "ASSIGNMENT", maxMark: 10, rawMark: 8 }, // 80
      { category: "ASSIGNMENT", maxMark: 10, rawMark: 0 }, // 0 counts
    ];
    expect(meanPercent(events)).toBe(40);
  });
  it("returns null when there are no events or all are blank", () => {
    expect(meanPercent([])).toBeNull();
    expect(
      meanPercent([{ category: "ASSIGNMENT", maxMark: 10, rawMark: null }]),
    ).toBeNull();
  });
});

describe("compileComputableCategories", () => {
  it("means assignments/projects and takes the single mid/end event", () => {
    const events: EventMark[] = [
      { category: "ASSIGNMENT", maxMark: 20, rawMark: 16 }, // 80
      { category: "ASSIGNMENT", maxMark: 10, rawMark: 6 }, // 60 → mean 70
      { category: "MID_SEM_EXAM", maxMark: 40, rawMark: 28 }, // 70
      { category: "END_SEM_EXAM", maxMark: 100, rawMark: 55 }, // 55
      { category: "PROJECT", maxMark: 50, rawMark: 45 }, // 90
      { category: "PROJECT", maxMark: 50, rawMark: 35 }, // 70 → mean 80
    ];
    expect(compileComputableCategories(events)).toEqual({
      asgn: 70,
      midSem: 70,
      endSem: 55,
      project: 80,
    });
  });
  it("leaves a category null when it has no events", () => {
    const events: EventMark[] = [
      { category: "MID_SEM_EXAM", maxMark: 40, rawMark: 20 },
    ];
    expect(compileComputableCategories(events)).toEqual({
      asgn: null,
      midSem: 50,
      endSem: null,
      project: null,
    });
  });
  it("returns all null for a student with only blank marks (a DRAFT row, no total)", () => {
    const events: EventMark[] = [
      { category: "ASSIGNMENT", maxMark: 20, rawMark: null },
      { category: "MID_SEM_EXAM", maxMark: 40, rawMark: null },
    ];
    const four = compileComputableCategories(events);
    expect(four).toEqual({ asgn: null, midSem: null, endSem: null, project: null });
    expect(computedStatus({ ...four, portfolio: null })).toBe("DRAFT");
  });
  it("ignores a 0-max event (never divides by zero)", () => {
    const events: EventMark[] = [
      { category: "PROJECT", maxMark: 0, rawMark: 25 },
      { category: "PROJECT", maxMark: 50, rawMark: 40 }, // 80
    ];
    expect(compileComputableCategories(events).project).toBe(80);
  });
});

describe("weightedTotalComplete", () => {
  const full: CategoryScores = {
    asgn: 80,
    midSem: 70,
    endSem: 60,
    project: 90,
    portfolio: 100,
  };
  it("computes the weighted total with the Asankrangwa default weights", () => {
    // 80*.15 + 70*.15 + 60*.40 + 90*.15 + 100*.15 = 12 + 10.5 + 24 + 13.5 + 15 = 75
    expect(weightedTotalComplete(full, W)).toBe(75);
  });
  it("returns 100 when every category is 100 (weights sum to 100)", () => {
    expect(
      weightedTotalComplete(
        { asgn: 100, midSem: 100, endSem: 100, project: 100, portfolio: 100 },
        W,
      ),
    ).toBe(100);
  });
  it("returns null unless all five categories are present", () => {
    expect(weightedTotalComplete({ ...full, portfolio: null }, W)).toBeNull();
    expect(weightedTotalComplete({ ...full, asgn: null }, W)).toBeNull();
  });
  it("honours a non-default weighting", () => {
    // End-sem heavy: 10/10/60/10/10
    const heavy = { asgn: 10, midSem: 10, endSem: 60, project: 10, portfolio: 10 };
    // 80*.1 + 70*.1 + 60*.6 + 90*.1 + 100*.1 = 8 + 7 + 36 + 9 + 10 = 70
    expect(weightedTotalComplete(full, heavy)).toBe(70);
  });
  it("allows a bonus (over-100) category to push the total above 100", () => {
    // Assignments at 110% (bonus) with the rest at 100 → total exceeds 100, no clamp here.
    const bonus: CategoryScores = {
      asgn: 110,
      midSem: 100,
      endSem: 100,
      project: 100,
      portfolio: 100,
    };
    // 110*.15 + 100*.15 + 100*.40 + 100*.15 + 100*.15 = 16.5 + 15 + 40 + 15 + 15 = 101.5
    expect(weightedTotalComplete(bonus, W)).toBe(101.5);
  });
});

describe("provisionalTotal (card-view preview only)", () => {
  it("sums entered categories and reports the weight accounted for", () => {
    const partial: CategoryScores = {
      asgn: 80,
      midSem: 70,
      endSem: null,
      project: null,
      portfolio: null,
    };
    // 80*.15 + 70*.15 = 12 + 10.5 = 22.5, over 30% of weight
    expect(provisionalTotal(partial, W)).toEqual({ total: 22.5, weightEntered: 30 });
  });
  it("matches the complete total once all five are in", () => {
    const full: CategoryScores = {
      asgn: 80,
      midSem: 70,
      endSem: 60,
      project: 90,
      portfolio: 100,
    };
    expect(provisionalTotal(full, W)).toEqual({ total: 75, weightEntered: 100 });
  });
});

describe("allCategoriesPresent / computedStatus", () => {
  const full: CategoryScores = {
    asgn: 80,
    midSem: 70,
    endSem: 60,
    project: 90,
    portfolio: 100,
  };
  it("is COMPLETE only when all five are present", () => {
    expect(allCategoriesPresent(full)).toBe(true);
    expect(computedStatus(full)).toBe("COMPLETE");
  });
  it("is DRAFT while any category (incl. manual portfolio) is missing", () => {
    expect(computedStatus({ ...full, portfolio: null })).toBe("DRAFT");
    expect(allCategoriesPresent({ ...full, midSem: null })).toBe(false);
  });
});
