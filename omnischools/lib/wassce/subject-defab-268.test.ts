import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";

/**
 * INCR #268 — the WASSCE subject-teacher page rendered two FABRICATIONS every teacher saw as their own
 * cohort: §03's hardcoded `TOPIC_HEATMAP` (fake per-topic grade counts) and §04's `INTERVENTION_TIERS`
 * (invented tutoring schedule + dates + parent SMS). No per-topic data exists in the schema, so Kofi
 * ruled omit-not-fake: delete both, keep an honest zero-number shell. This locks that — a reintroduced
 * constant or any fabricated figure fails here.
 */

const src = readFileSync(resolve(cwd(), "app/(app)/senior/wassce/subject/page.tsx"), "utf8");

describe("#268 · the WASSCE subject-teacher fabrications are gone", () => {
  it("the fabricated constants + their render helper no longer exist (AC-268-02)", () => {
    expect(src).not.toMatch(/TOPIC_HEATMAP/);
    expect(src).not.toMatch(/INTERVENTION_TIERS/);
    expect(src).not.toMatch(/\bHeatCell\b/);
    expect(src).not.toMatch(/HEAT_COLORS/); // the import is dropped too
  });

  it("no fabricated per-topic content survives (AC-268-01)", () => {
    for (const fake of ["Organic chemistry", "transition metals", "Stoichiometry", "Le Chatelier", "% of paper"]) {
      expect(src, `fabricated topic string "${fake}" must be gone`).not.toContain(fake);
    }
  });

  it("no fabricated intervention content survives (AC-268-04)", () => {
    for (const fake of ["after-school tutoring", "parent SMS", "past-paper", "5 Jun", "24 May", "boost session"]) {
      expect(src, `fabricated plan string "${fake}" must be gone`).not.toContain(fake);
    }
    // the §04 heading no longer asserts an invented day-count ("The final 24 days" — days-to-paper is "—").
    expect(src).not.toMatch(/final<\/em>\s*\d+\s*days/);
  });

  it("the §03 and §04 shells survive with an honest, zero-number placeholder (AC-268-03)", () => {
    expect(src).toMatch(/id="heatmap"/); // shell kept (OC-268-A)
    expect(src).toMatch(/id="plan"/);
    expect(src).toMatch(/not yet captured/);
    expect(src).toMatch(/not yet built/);
    expect(src).toMatch(/stays empty/);
  });
});
