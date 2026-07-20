import { describe, it, expect } from "vitest";
import {
  aggregateHistogram,
  assessCandidateRisk,
  cohortSummary,
  cohortTier,
  compareRisk,
  meanAggregate,
  medianAggregate,
  subjectHeatTag,
  type RiskInput,
  type RiskTarget,
} from "./cohort";
import type { ProjectionResult } from "./projection";
import type { PrerequisiteCheck } from "./university-match";

/**
 * INCR-18 AC17. The canonical case is Y. Aidoo: aggregate 10 against a cut-off of 11 — a gap of −1,
 * comfortably INSIDE — who is nevertheless at risk, solely through an open SC-12. That case is the
 * whole point of the rule: at-risk widens beyond academics.
 */

const MET: PrerequisiteCheck = { met: true, status: "MET", unmet: [], pending: [] };
const UNMET: PrerequisiteCheck = { met: false, status: "UNMET", unmet: ["Chemistry"], pending: [] };
const PENDING: PrerequisiteCheck = {
  met: false,
  status: "PENDING",
  unmet: [],
  pending: ["Chemistry"],
};

const computable = (aggregate: number): ProjectionResult => ({
  computable: true,
  aggregate,
  band: "—",
  cores: [],
  electives: [],
  subjects: [],
});
const notComputable: ProjectionResult = { computable: false, reason: "INSUFFICIENT_CORES" };

const target = (cutOff: number, prerequisites: PrerequisiteCheck = MET): RiskTarget => ({
  cutOff,
  prerequisites,
});

const assess = (over: Partial<RiskInput>) =>
  assessCandidateRisk({
    name: "Test Candidate",
    projection: computable(18),
    targets: [],
    scForms: [],
    ...over,
  });

describe("assessCandidateRisk — lowest target = MAX(cut_off) (AC17)", () => {
  // The wording trap: "lowest target" is the LEAST AMBITIOUS school, i.e. the WORST cut-off number.
  const r = assess({
    projection: computable(28),
    targets: [target(22), target(17)],
  });

  it("picks 22 (the least-ambitious/safety school), not 17", () => {
    expect(r.lowestCutOff).toBe(22);
  });

  it("gaps +6 — the NEGATIVE of matchMargin's δ (28 − 22)", () => {
    expect(r.gap).toBe(6);
  });

  it("fires ABOVE_LOWEST_CUTOFF and nothing else", () => {
    expect(r.reasons).toEqual(["ABOVE_LOWEST_CUTOFF"]);
    expect(r.atRisk).toBe(true);
  });

  it("does NOT fire when the projection is inside the lowest cut-off", () => {
    const inside = assess({ projection: computable(16), targets: [target(22), target(17)] });
    expect(inside.gap).toBe(-6); // 16 − 22, measured against the LOWEST (22), never the 17

    expect(inside.reasons).toEqual([]);
    expect(inside.atRisk).toBe(false);
  });

  it("does NOT fire when the projection sits exactly ON the lowest cut-off (gap 0)", () => {
    const on = assess({ projection: computable(17), targets: [target(17)] });
    expect(on.gap).toBe(0);
    expect(on.atRisk).toBe(false);
  });
});

describe("assessCandidateRisk — Y. Aidoo · at risk on OPEN_SC12 alone (AC17)", () => {
  // Aggregate 10 vs cut-off 11 → gap −1, INSIDE. Academically fine; medically disrupted.
  const aidoo = assess({
    name: "Y. Aidoo",
    projection: computable(10),
    targets: [target(11)],
    scForms: [{ scForm: "SC-12", status: "APPROVED" }],
  });

  it("is inside her cut-off (gap −1)", () => {
    expect(aidoo.gap).toBe(-1);
  });

  it("is at risk with reasons exactly ['OPEN_SC12']", () => {
    expect(aidoo.atRisk).toBe(true);
    expect(aidoo.reasons).toEqual(["OPEN_SC12"]);
  });
});

describe("assessCandidateRisk — SC scope (AC17)", () => {
  it("SC-3 and SC-7 NEVER fire — they are granted accommodations, not disruptions", () => {
    const sc3 = assess({ scForms: [{ scForm: "SC-3", status: "APPROVED" }], targets: [target(22)] });
    const sc7 = assess({ scForms: [{ scForm: "SC-7", status: "FILED" }], targets: [target(22)] });
    expect(sc3.atRisk).toBe(false);
    expect(sc7.atRisk).toBe(false);
  });

  it("a COMPLETED or REJECTED SC-12 does not fire", () => {
    for (const status of ["COMPLETED", "REJECTED"]) {
      const r = assess({ scForms: [{ scForm: "SC-12", status }], targets: [target(22)] });
      expect(r.reasons).toEqual([]);
    }
  });

  it("every other SC-12 status is open and fires", () => {
    for (const status of ["DRAFT", "FILED", "ACKNOWLEDGED", "APPROVED"]) {
      const r = assess({ scForms: [{ scForm: "SC-12", status }], targets: [target(22)] });
      expect(r.reasons).toEqual(["OPEN_SC12"]);
    }
  });
});

describe("assessCandidateRisk — no target / not computable (AC17)", () => {
  it("no targets → NO_TARGET_TAGGED, gap null, sortKey +Infinity (sorts first)", () => {
    const r = assess({ projection: computable(31), targets: [] });
    expect(r.reasons).toEqual(["NO_TARGET_TAGGED"]);
    expect(r.lowestCutOff).toBeNull();
    expect(r.gap).toBeNull();
    expect(r.sortKey).toBe(Number.POSITIVE_INFINITY);
  });

  it("not computable → PROJECTION_NOT_COMPUTABLE, gap null even with a target", () => {
    const r = assess({ projection: notComputable, targets: [target(22)] });
    expect(r.reasons).toEqual(["PROJECTION_NOT_COMPUTABLE"]);
    expect(r.lowestCutOff).toBe(22);
    expect(r.gap).toBeNull();
  });

  it("reports the five reasons in their fixed order, never insertion order", () => {
    const r = assess({
      projection: notComputable,
      targets: [],
      scForms: [{ scForm: "SC-12", status: "FILED" }],
    });
    expect(r.reasons).toEqual(["PROJECTION_NOT_COMPUTABLE", "NO_TARGET_TAGGED", "OPEN_SC12"]);
  });
});

describe("assessCandidateRisk — prerequisites, lowest target only (AC17)", () => {
  it("UNMET on the lowest (MAX cut-off) target fires", () => {
    const r = assess({ projection: computable(12), targets: [target(11), target(22, UNMET)] });
    expect(r.reasons).toEqual(["UNMET_PREREQUISITE"]);
  });

  it("UNMET on a NON-lowest target does not fire", () => {
    const r = assess({ projection: computable(12), targets: [target(11, UNMET), target(22)] });
    expect(r.reasons).toEqual([]);
  });

  it("PENDING never fires — registered but ungraded is not a verdict", () => {
    const r = assess({ projection: computable(12), targets: [target(22, PENDING)] });
    expect(r.reasons).toEqual([]);
  });
});

describe("compareRisk — deterministic sort (AC17)", () => {
  const rows = [
    { name: "B. Boakye", sortKey: 2 },
    { name: "Z. Zuberu", sortKey: Number.POSITIVE_INFINITY },
    { name: "A. Anokye", sortKey: 6 },
    { name: "A. Aidoo", sortKey: Number.POSITIVE_INFINITY },
    { name: "C. Chinery", sortKey: 6 },
    { name: "D. Donkor", sortKey: -1 },
  ];
  const order = () => [...rows].sort(compareRisk).map((r) => r.name);

  it("puts null-gap rows first, then gap desc, then name asc", () => {
    expect(order()).toEqual([
      "A. Aidoo",
      "Z. Zuberu",
      "A. Anokye",
      "C. Chinery",
      "B. Boakye",
      "D. Donkor",
    ]);
  });

  it("is stable across runs and across input permutations", () => {
    const first = order();
    expect(order()).toEqual(first);
    expect([...rows].reverse().sort(compareRisk).map((r) => r.name)).toEqual(first);
  });
});

describe("aggregateHistogram (AC12)", () => {
  const aggregates = [6, 6, 7, 18, 24, 25, 31, 54];
  const bins = aggregateHistogram(aggregates);

  it("is 19 point bins (6…24) plus ONE open terminal 25+", () => {
    expect(bins).toHaveLength(20);
    expect(bins[0].label).toBe("6");
    expect(bins[18].label).toBe("24");
    expect(bins[19].label).toBe("25+");
    expect(bins[19].max).toBeNull();
  });

  it("bins sum to the computable N — nothing falls off either end", () => {
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(aggregates.length);
  });

  it("puts every 25+ aggregate in the single terminal bin", () => {
    expect(bins[19].count).toBe(3); // 25, 31, 54
    expect(bins[0].count).toBe(2); // 6, 6
  });

  it("tags each bin with its TARGET_TIER_BANDS tier", () => {
    expect(bins[0].tierKey).toBe("tier-1"); // 6
    expect(bins[7].tierKey).toBe("tier-2"); // 13
    expect(bins[13].tierKey).toBe("tier-3"); // 19
    expect(bins[19].tierKey).toBe("tier-4"); // 25+
  });

  it("is all zeroes for an empty cohort (never a fabricated bar)", () => {
    expect(aggregateHistogram([]).every((b) => b.count === 0)).toBe(true);
  });
});

describe("medianAggregate / meanAggregate", () => {
  it("takes the LOWER median on an even-length set (an aggregate is an integer)", () => {
    expect(medianAggregate([12, 18])).toBe(12);
    expect(medianAggregate([10, 12, 18, 20])).toBe(12);
  });

  it("takes the middle value on an odd-length set, unsorted input included", () => {
    expect(medianAggregate([24, 6, 18])).toBe(18);
  });

  it("means to 1dp", () => {
    expect(meanAggregate([18, 19])).toBe(18.5);
    expect(meanAggregate([10, 11, 13])).toBe(11.3);
  });

  it("returns null on an empty set — the tile shows an em-dash, never 0", () => {
    expect(medianAggregate([])).toBeNull();
    expect(meanAggregate([])).toBeNull();
  });
});

describe("subjectHeatTag boundaries (AC16)", () => {
  it("≥30% below credit is CONCERN", () => {
    expect(subjectHeatTag(3, 10)).toBe("CONCERN"); // 30.0%
    expect(subjectHeatTag(35, 86)).toBe("CONCERN"); // 40.7% — the true Elective-Math share
  });

  it("15–29.9% is WATCH", () => {
    expect(subjectHeatTag(3, 20)).toBe("WATCH"); // 15.0%
    expect(subjectHeatTag(44, 240)).toBe("WATCH"); // 18.3% — Core Maths
    expect(subjectHeatTag(299, 1000)).toBe("WATCH"); // 29.9%
  });

  it("below 15% carries no tag", () => {
    expect(subjectHeatTag(14, 100)).toBeNull();
    expect(subjectHeatTag(0, 60)).toBeNull();
  });

  it("carries no tag at all below 5 graded results — 1 of 2 is noise", () => {
    expect(subjectHeatTag(2, 2)).toBeNull();
    expect(subjectHeatTag(4, 4)).toBeNull();
    expect(subjectHeatTag(4, 5)).toBe("CONCERN");
  });
});

describe("cohortTier (R4b — the shipped TARGET_TIER_BANDS, not a new table)", () => {
  it("maps the four bands, with tier 4 open-ended", () => {
    expect(cohortTier(6).key).toBe("tier-1");
    expect(cohortTier(12).key).toBe("tier-1");
    expect(cohortTier(13).key).toBe("tier-2");
    expect(cohortTier(24).key).toBe("tier-3");
    expect(cohortTier(25).key).toBe("tier-4");
    expect(cohortTier(54).key).toBe("tier-4");
  });
});

describe("cohortSummary (AC12/AC18)", () => {
  const summary = cohortSummary([
    { aggregate: 10, atRisk: true },
    { aggregate: 14, atRisk: false },
    { aggregate: 20, atRisk: false },
    { aggregate: 28, atRisk: true },
    { aggregate: null, atRisk: true }, // not computable — excluded from median/mean/tiers
  ]);

  it("counts the whole slice but medians over computable projections only", () => {
    expect(summary.total).toBe(5);
    expect(summary.computable).toBe(4);
    expect(summary.notComputable).toBe(1);
    expect(summary.median).toBe(14);
    expect(summary.mean).toBe(18);
  });

  it("distributes tiers over computable projections, zeroes included", () => {
    expect(summary.tierCounts).toEqual({
      "tier-1": 1,
      "tier-2": 1,
      "tier-3": 1,
      "tier-4": 1,
    });
    expect(summary.medianTier?.key).toBe("tier-2");
  });

  it("counts at-risk over the WHOLE slice, not just the computable ones", () => {
    expect(summary.atRisk).toBe(3);
  });

  it("is safe on an empty slice (a house with no candidates)", () => {
    const empty = cohortSummary([]);
    expect(empty.total).toBe(0);
    expect(empty.median).toBeNull();
    expect(empty.medianTier).toBeNull();
  });
});
