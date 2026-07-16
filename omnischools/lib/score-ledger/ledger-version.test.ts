import { describe, it, expect } from "vitest";
import { nextVersion, grainHasChange } from "./ledger-version";
import type { CategoryScores } from "./compute";

// ---------------------------------------------------------------- nextVersion (AC B1/B2)
describe("nextVersion (supersedes chain)", () => {
  it("B1 genesis: no prior → v1, supersedes NULL", () => {
    expect(nextVersion(null)).toEqual({ versionNumber: 1, supersedesId: null });
    expect(nextVersion(undefined)).toEqual({ versionNumber: 1, supersedesId: null });
  });
  it("B2 increment: prior v3 → v4, supersedes the prior id", () => {
    expect(nextVersion({ id: "abc", versionNumber: 3 })).toEqual({
      versionNumber: 4,
      supersedesId: "abc",
    });
  });
});

// ---------------------------------------------------------------- grainHasChange (AC B6)
const cats = (o: Partial<CategoryScores>): CategoryScores => ({
  asgn: null,
  midSem: null,
  endSem: null,
  project: null,
  portfolio: null,
  ...o,
});

describe("grainHasChange (no empty churn)", () => {
  it("B6 no-op grain (payload == latest) → no version", () => {
    const same = cats({ asgn: 80, midSem: 70, endSem: 90, project: 60, portfolio: 8 });
    expect(grainHasChange(same, same)).toBe(false);
  });
  it("a single differing cell → version", () => {
    const before = cats({ asgn: 80, endSem: 90 });
    const after = cats({ asgn: 85, endSem: 90 });
    expect(grainHasChange(before, after)).toBe(true);
  });
  it("genesis with data (no ledger row yet) → version", () => {
    expect(grainHasChange(null, cats({ endSem: 90 }))).toBe(true);
  });
  it("genesis with an all-blank payload → no version", () => {
    expect(grainHasChange(null, cats({}))).toBe(false);
  });
  it("a filled cell going blank (gone-missing) → version", () => {
    expect(grainHasChange(cats({ midSem: 70 }), cats({}))).toBe(true);
  });
  it("0 is a real value, not blank — 0 vs null → version", () => {
    expect(grainHasChange(cats({ asgn: 0 }), cats({}))).toBe(true);
    expect(grainHasChange(cats({}), cats({ asgn: 0 }))).toBe(true);
  });
});
