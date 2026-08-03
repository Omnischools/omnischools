import { describe, it, expect } from "vitest";
import { passRateOf } from "./grade-band";

/**
 * GOV-4a · the single pass-rate definition shared by the per-subject (subject-performance) and the
 * school-wide (class-performance) figures: the whole-% share of graded scores at/above PASS_MARK,
 * `null` (never 0) when nothing is graded. A mutation to the ratio — dropping the ×100, flipping
 * passed/graded, or removing the graded>0 guard — reds one of these.
 */
describe("passRateOf · whole-% share of graded scores ≥ PASS_MARK", () => {
  it("rounds passed/graded to a whole %", () => {
    expect(passRateOf(68, 100)).toBe(68);
    expect(passRateOf(2, 3)).toBe(67); // 66.66… → 67
    expect(passRateOf(1, 8)).toBe(13); // 12.5 → 13
  });

  it("all graded pass → 100; none pass with graded>0 → a real 0 (not null)", () => {
    expect(passRateOf(40, 40)).toBe(100);
    expect(passRateOf(0, 40)).toBe(0);
  });

  it("nothing graded → null, never 0", () => {
    expect(passRateOf(0, 0)).toBeNull();
  });
});
