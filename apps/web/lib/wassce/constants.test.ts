import { describe, it, expect } from "vitest";
import { formatGhs, formatGhsCompact, WAEC_FEE_PER_CANDIDATE } from "./constants";

// The §4.3 "Total fees" tile derives as candidateCount × GES anchor, then compact-formats.
// Money display is a risk-list path (INCR-15 AC-B/E) — guard the exact "GHS 336k" render.
describe("wassce money format", () => {
  it("renders the 240-candidate fee tile as GHS 336k", () => {
    expect(formatGhsCompact(240 * WAEC_FEE_PER_CANDIDATE)).toBe("GHS 336k");
  });

  it("compacts to thousands only at/above 1000, full below", () => {
    expect(formatGhsCompact(1000)).toBe("GHS 1k");
    expect(formatGhsCompact(999)).toBe("GHS 999");
    expect(formatGhsCompact(0)).toBe("GHS 0");
  });

  it("formats the per-candidate anchor with a thousands separator", () => {
    expect(formatGhs(WAEC_FEE_PER_CANDIDATE)).toBe("GHS 1,400");
  });
});
