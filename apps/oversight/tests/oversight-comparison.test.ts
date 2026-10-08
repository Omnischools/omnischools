import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BreakdownRow, ChildLevel } from "@/lib/oversight/breakdown";
import { childLevelFor } from "@/lib/oversight/breakdown";
import { withinTierCeiling } from "@/lib/auth/roles";
import {
  benchmarkContributorsOf,
  buildComparison,
  comparisonMetrics,
  meanBenchmark,
  rankMarks,
  weightedBenchmark,
  type ComparisonColumnInput,
} from "@/lib/oversight/comparison";
import type { ComparisonEntity, SchoolType } from "@/lib/oversight/comparison-entities";
import { examForSchoolType, pinSelectionToLevel } from "@/lib/oversight/comparison-entities";
import { ComparisonTable } from "@/components/oversight/comparison-table";
import { ComparisonPicker, entityMeta } from "@/components/oversight/comparison-picker";
import { MAX_ENTITIES } from "@/lib/oversight/comparison";

/**
 * INCREMENT I — THE COMPARISON WORKSPACE ENGINE (pure), against COMPARISON-WORKSPACE-DOMAIN-RULING.
 *
 * The surface reuses `getChildBreakdown` for data (the RLS and roll-up correctness is proven in
 * oversight-child-breakdown.test.ts). What is NEW, and proven here, is the three decisions the comparison
 * layers on top: the LIKE-FOR-LIKE benchmark (weighted Σ÷Σ for rates, mean-per-filer for counts, over
 * the population NOT the selection), and the direction-aware best/worst MARKING (floored, ≥2, ties,
 * nulls, benchmark excluded). Every property is a fold over literal rows — no db, no render.
 *
 * The sibling zero-rows property (a district officer must read no sibling-district rows) is an RLS fact,
 * proven in the db:rls-test matrix, not here — this file cannot forge a cross-subtree leak.
 */

/** A `BreakdownRow` factory — every measure null by default, so a test states only what it exercises. */
function row(over: Partial<BreakdownRow> & { childId: string }): BreakdownRow {
  return {
    name: over.childId,
    enrolment: null,
    schoolsFiling: null,
    candidates: null,
    qualified: null,
    wassceRate: null,
    schoolsReporting: null,
    schoolsRegistered: null,
    coverageRatio: null,
    ptr: null,
    staffEnrolment: null,
    teachers: null,
    presentDays: null,
    enrolledDays: null,
    attendanceRate: null,
    femaleEnrolment: null,
    girlsShare: null,
    postsEstablished: null,
    vacancyShortage: null,
    vacancySurplus: null,
    vacancyNet: null,
    vacancyRate: null,
    schoolsWithEstablishment: null,
    ...over,
  };
}

const col = (
  r: BreakdownRow | null,
  coverageAmbiguous = false,
  id = r?.childId ?? "absent",
): ComparisonColumnInput => ({ id, row: r, coverageAmbiguous });

describe("weightedBenchmark — Σnum ÷ Σden, never avg(stored rate)", () => {
  it("is candidate-weighted, not the unweighted mean of the rates", () => {
    const pop = [
      row({ childId: "big", candidates: 300, qualified: 240 }), // 0.80
      row({ childId: "small", candidates: 30, qualified: 15 }), // 0.50
    ];
    const weighted = weightedBenchmark(pop, (r) => r.qualified, (r) => r.candidates);
    expect(weighted).toBeCloseTo(255 / 330, 10); // 0.7727…
    // The naive mean a stored-rate average would give is 0.65 — the rule's whole point.
    expect(weighted).not.toBeCloseTo((0.8 + 0.5) / 2, 5);
  });

  it("returns null on a zero denominator (0/0 is not a measured zero)", () => {
    const pop = [row({ childId: "a", candidates: 0, qualified: 0 })];
    expect(weightedBenchmark(pop, (r) => r.qualified, (r) => r.candidates)).toBeNull();
  });

  it("skips rows missing either component and is null when none contribute", () => {
    const pop = [
      row({ childId: "a", candidates: 100, qualified: null }), // half-filed → skipped
      row({ childId: "b", candidates: null, qualified: 50 }), // half-filed → skipped
    ];
    expect(weightedBenchmark(pop, (r) => r.qualified, (r) => r.candidates)).toBeNull();
  });
});

describe("meanBenchmark — Σ ÷ n over FILERS", () => {
  it("matches the mock arithmetic (1284+1142+874)/3 = 1100", () => {
    const pop = [
      row({ childId: "as", enrolment: 1284 }),
      row({ childId: "am", enrolment: 1142 }),
      row({ childId: "wa", enrolment: 874 }),
    ];
    expect(meanBenchmark(pop, (r) => r.enrolment)).toBe(1100);
  });

  it("counts filers only — a non-filer does not drag the mean toward zero", () => {
    const pop = [
      row({ childId: "a", enrolment: 1000 }),
      row({ childId: "b", enrolment: 2000 }),
      row({ childId: "c", enrolment: null }), // filed nothing → excluded from n
    ];
    expect(meanBenchmark(pop, (r) => r.enrolment)).toBe(1500);
  });

  it("is null when no child filed (never 0)", () => {
    expect(meanBenchmark([row({ childId: "a" })], (r) => r.enrolment)).toBeNull();
  });
});

/**
 * THE BENCHMARK'S CONTRIBUTOR COUNT IS PER ROW, AND IT IS USUALLY SMALLER THAN THE POPULATION.
 *
 * The over-claim this closes: the surface computed "N schools" ONCE from `benchmarkPopulation.length`
 * and printed it as the base of EVERY benchmark figure — on the column header, in the footnote and on
 * the Provenance line. But both folds SKIP non-contributing rows, and which rows those are is a
 * per-METRIC fact: a PRIVATE school has no GES establishment at all (R3.5), so it is outside the
 * vacancy benchmark; a school that does not run the internal gradebook is outside the attendance one
 * (R9.5b); only sitters are inside qualification. The population numeral therefore over-stated the
 * base of most rows by exactly the rows the fold had already dropped.
 *
 * The population below is deliberately MIXED so the three cases separate in one build: one row filing
 * everything, one PRIVATE row with no establishment, one non-gradebook row with no attendance days.
 */
describe("benchmarkContributors — the per-row honest base of the benchmark figure", () => {
  const full = row({
    childId: "full",
    enrolment: 900,
    femaleEnrolment: 450,
    postsEstablished: 40,
    vacancyNet: 6,
    presentDays: 9000,
    enrolledDays: 10_000,
  });
  // PRIVATE: GES sets no establishment, so `postsEstablished`/`vacancyNet` are null-not-zero — outside
  // the vacancy benchmark, but a perfectly ordinary enrolment filer.
  const privateSchool = row({
    childId: "private",
    enrolment: 500,
    femaleEnrolment: 260,
    postsEstablished: null,
    vacancyNet: null,
    presentDays: 4000,
    enrolledDays: 5000,
  });
  // A PUBLIC school that does not run the internal gradebook: no attendance days to roll up.
  const noGradebook = row({
    childId: "nogradebook",
    enrolment: 700,
    femaleEnrolment: 350,
    postsEstablished: 30,
    vacancyNet: -2,
    presentDays: null,
    enrolledDays: null,
  });
  const population = [full, privateSchool, noGradebook];

  const metrics = comparisonMetrics({ exam: "WASSCE", hasCoverage: true });
  const rowFor = (key: string) => {
    const model = buildComparison({
      metrics,
      benchmarkPopulation: population,
      columns: population.map((r) => col(r)),
    });
    const found = model.sections.flatMap((s) => s.rows).find((r) => r.metric.key === key);
    expect(found, `no ${key} row`).toBeDefined();
    return found!;
  };

  it("vacancies and attendance count FEWER than the population; enrolment counts all of it", () => {
    expect(population.length).toBe(3);
    // The private row is not in the vacancy fold, so the row's own base is 2 of 3 — NOT the 3 the old
    // population-wide label printed here.
    const vacancies = rowFor("teacherVacancies");
    expect(vacancies.benchmarkContributors).toBe(2);
    expect(vacancies.benchmarkContributors).toBeLessThan(population.length);
    // The non-gradebook row is not in the attendance fold — likewise 2 of 3.
    const attendance = rowFor("attendance");
    expect(attendance.benchmarkContributors).toBe(2);
    expect(attendance.benchmarkContributors).toBeLessThan(population.length);
    // Enrolment every one of them filed, so here — and ONLY here — the population count is the base.
    // That it is EQUAL on this row is what makes the two inequalities above a real finding rather than
    // a count that is simply always short.
    expect(rowFor("enrolment").benchmarkContributors).toBe(population.length);
    expect(rowFor("girlsShare").benchmarkContributors).toBe(population.length);
  });

  it("the figures themselves really are over those contributors, not over the population", () => {
    // Vacancy benchmark = Σnet ÷ Σposts over the TWO public rows: (6 − 2) ÷ 70. The private row adds
    // nothing to either side, which is precisely why its presence must not be counted.
    expect(rowFor("teacherVacancies").benchmark).toBeCloseTo(4 / 70, 10);
    // Attendance = Σpresent ÷ Σenrolled over the TWO gradebook filers: 13,000 ÷ 15,000. Note it is NOT
    // the mean of their two stored rates (0.90 and 0.80 → 0.85) — the fold is day-weighted.
    expect(rowFor("attendance").benchmark).toBeCloseTo(13_000 / 15_000, 10);
    expect(rowFor("attendance").benchmark).not.toBeCloseTo(0.85, 4);
    // …and the enrolment mean IS over all three, the one row whose base is the whole population.
    expect(rowFor("enrolment").benchmark).toBeCloseTo((900 + 500 + 700) / 3, 10);
  });

  it("0 contributors ⇔ a null benchmark, for EVERY spec kind (never a confident 0)", () => {
    // Over this population every spec resolves one way or the other, so the biconditional can be
    // checked on the whole catalogue rather than on a hand-picked row. (`none`-kind — coverage — has no
    // benchmark at all and must land on the 0/null side. The one shape that would break the ⇐ half is a
    // degenerate Σden = 0 — contributors present, dividing to nothing — which no denominator here is.)
    for (const r of buildComparison({
      metrics,
      benchmarkPopulation: population,
      columns: population.map((c) => col(c)),
    }).sections.flatMap((s) => s.rows)) {
      expect(
        r.benchmarkContributors === 0,
        `${r.metric.key}: contributors=${r.benchmarkContributors} benchmark=${r.benchmark}`,
      ).toBe(r.benchmark === null);
    }
    // …and the same holds on the EMPTY population, where every kind has 0 contributors at once.
    for (const r of buildComparison({
      metrics,
      benchmarkPopulation: [],
      columns: [col(full)],
    }).sections.flatMap((s) => s.rows)) {
      expect(r.benchmarkContributors).toBe(0);
      expect(r.benchmark, r.metric.key).toBeNull();
    }
    // The spec-level helper agrees with the assembled row, over the same population.
    for (const m of metrics)
      expect(benchmarkContributorsOf(population, m.benchmark), m.key).toBe(
        rowFor(m.key).benchmarkContributors,
      );
    // A `none`-kind benchmark has no contributors by construction — coverage, which renders `—`.
    expect(benchmarkContributorsOf(population, { kind: "none" })).toBe(0);
  });
});

describe("rankMarks — direction-aware, floored, ties, nulls", () => {
  const allEligible = (n: number) => Array(n).fill(true);

  it("higher-better marks the max best and min worst", () => {
    expect(rankMarks([0.71, 0.6, 0.62], allEligible(3), "higher-better")).toEqual([
      "best",
      "worst",
      null,
    ]);
  });

  it("lower-better inverts (PTR: fewest pupils-per-teacher is best)", () => {
    expect(rankMarks([21.4, 27.8, 24.6], allEligible(3), "lower-better")).toEqual([
      "best",
      "worst",
      null,
    ]);
  });

  it("never marks a none-direction row (size carries no valence)", () => {
    expect(rankMarks([1284, 1142, 874], allEligible(3), "none")).toEqual([null, null, null]);
  });

  it("excludes an ineligible (sub-floor / thin-coverage) entity from the crown", () => {
    // The 100% entity is ineligible (below the candidate floor); the crown goes to the eligible ones.
    const marks = rankMarks([1.0, 0.71, 0.6], [false, true, true], "higher-better");
    expect(marks).toEqual([null, "best", "worst"]);
  });

  it("marks nothing with fewer than two eligible entities (a profile, not a ranking)", () => {
    expect(rankMarks([0.9, 0.5], [true, false], "higher-better")).toEqual([null, null]);
    expect(rankMarks([0.9], [true], "higher-better")).toEqual([null]);
  });

  it("marks nothing when every eligible value ties (no spread)", () => {
    expect(rankMarks([0.6, 0.6, 0.6], allEligible(3), "higher-better")).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("marks ALL entities sharing an extreme, never an arbitrary one", () => {
    expect(rankMarks([0.8, 0.8, 0.5], allEligible(3), "higher-better")).toEqual([
      "best",
      "best",
      "worst",
    ]);
  });

  it("never marks a null value", () => {
    expect(rankMarks([0.8, null, 0.5], [true, true, true], "higher-better")).toEqual([
      "best",
      null,
      "worst",
    ]);
  });
});

describe("comparisonMetrics — the catalogue honours the ship/defer scope", () => {
  it("omits the performance section when the level sits no exam", () => {
    const keys = comparisonMetrics({ exam: null, hasCoverage: false }).map((m) => m.key);
    expect(keys).toEqual([
      "enrolment",
      "girlsShare",
      "attendance",
      "ptr",
      "teacherVacancies",
    ]);
  });

  it("includes WASSCE qualification + candidates when an exam is pinned", () => {
    const keys = comparisonMetrics({ exam: "WASSCE", hasCoverage: false }).map((m) => m.key);
    expect(keys).toEqual([
      "enrolment",
      "girlsShare",
      "qualification",
      "candidates",
      "attendance",
      "ptr",
      "teacherVacancies",
    ]);
  });

  it("adds the coverage row only when the tier has coverage", () => {
    const keys = comparisonMetrics({ exam: "WASSCE", hasCoverage: true }).map((m) => m.key);
    expect(keys).toContain("coverage");
  });

  it("never ranks enrolment or candidates (size is not quality)", () => {
    const metrics = comparisonMetrics({ exam: "WASSCE", hasCoverage: false });
    expect(metrics.find((m) => m.key === "enrolment")!.direction).toBe("none");
    expect(metrics.find((m) => m.key === "candidates")!.direction).toBe("none");
    expect(metrics.find((m) => m.key === "ptr")!.direction).toBe("lower-better");
    expect(metrics.find((m) => m.key === "qualification")!.direction).toBe("higher-better");
  });
});

describe("buildComparison — benchmark + marks assembled over population vs selection", () => {
  const as = row({
    childId: "as",
    enrolment: 1284,
    candidates: 300,
    qualified: 213,
    wassceRate: 0.71,
    staffEnrolment: 1284,
    teachers: 60,
    ptr: 1284 / 60,
  });
  const am = row({
    childId: "am",
    enrolment: 1142,
    candidates: 280,
    qualified: 168,
    wassceRate: 0.6,
    staffEnrolment: 1142,
    teachers: 41,
    ptr: 1142 / 41,
  });
  const wa = row({
    childId: "wa",
    enrolment: 874,
    candidates: 220,
    qualified: 136,
    wassceRate: 136 / 220,
    staffEnrolment: 874,
    teachers: 36,
    ptr: 874 / 36,
  });
  const population = [as, am, wa];
  const metrics = comparisonMetrics({ exam: "WASSCE", hasCoverage: false });

  function rowsByKey(columns: ComparisonColumnInput[]) {
    const model = buildComparison({ metrics, benchmarkPopulation: population, columns });
    const map = new Map<string, { benchmark: number | null; cells: (number | null)[]; marks: (string | null)[] }>();
    for (const section of model.sections) {
      for (const r of section.rows) {
        map.set(r.metric.key, {
          benchmark: r.benchmark,
          cells: r.cells.map((c) => c.value),
          marks: r.cells.map((c) => c.mark),
        });
      }
    }
    return map;
  }

  it("AC10 — the enrolment benchmark is the mean per filer over the population", () => {
    const m = rowsByKey([col(as), col(am), col(wa)]);
    expect(m.get("enrolment")!.benchmark).toBe(1100); // 3300/3
  });

  it("AC9 — the WASSCE benchmark is candidate-weighted, not the unweighted mean of the shown rates", () => {
    const m = rowsByKey([col(as), col(am), col(wa)]);
    const totalQual = 213 + 168 + 136;
    const totalCand = 300 + 280 + 220;
    expect(m.get("qualification")!.benchmark).toBeCloseTo(totalQual / totalCand, 10);
    const naive = (0.71 + 0.6 + 136 / 220) / 3;
    expect(m.get("qualification")!.benchmark).not.toBeCloseTo(naive, 4);
  });

  it("AC11 — deselecting an entity does NOT move the benchmark (it is over the population, not the selection)", () => {
    const three = rowsByKey([col(as), col(am), col(wa)]);
    const two = rowsByKey([col(as), col(am)]); // wa deselected, still in population
    expect(two.get("enrolment")!.benchmark).toBe(three.get("enrolment")!.benchmark);
    expect(two.get("qualification")!.benchmark).toBe(three.get("qualification")!.benchmark);
    expect(two.get("ptr")!.benchmark).toBe(three.get("ptr")!.benchmark);
  });

  it("AC13 — PTR is ranked lowest-best, WASSCE highest-best; the benchmark is never in a cell", () => {
    const m = rowsByKey([col(as), col(am), col(wa)]);
    // AS has the lowest PTR (best), AM the highest (worst).
    expect(m.get("ptr")!.marks).toEqual(["best", "worst", null]);
    // AS has the highest WASSCE rate (best), AM the lowest (worst).
    expect(m.get("qualification")!.marks).toEqual(["best", "worst", null]);
    // Enrolment carries no marks.
    expect(m.get("enrolment")!.marks).toEqual([null, null, null]);
  });

  it("a selected-but-absent entity is a null column, never dropped", () => {
    const m = rowsByKey([col(as), col(null, false, "ghost")]);
    expect(m.get("enrolment")!.cells).toEqual([1284, null]);
    // One real entity + one absent = fewer than two eligible → no marks.
    expect(m.get("qualification")!.marks).toEqual([null, null]);
  });

  it("the candidate floor excludes a thin cohort from the WASSCE crown but still shows its value", () => {
    const thin = row({ childId: "thin", wassceRate: 1.0, candidates: 7, qualified: 7 });
    const popWithThin = [as, am, thin];
    const model = buildComparison({
      metrics,
      benchmarkPopulation: popWithThin,
      columns: [col(as), col(am), col(thin)],
    });
    const qual = model.sections
      .flatMap((s) => s.rows)
      .find((r) => r.metric.key === "qualification")!;
    // thin's 100% is shown…
    expect(qual.cells[2]!.value).toBe(1.0);
    // …but it is not crowned best; AS (eligible, highest of the eligible) is.
    expect(qual.cells[2]!.mark).toBeNull();
    expect(qual.cells[0]!.mark).toBe("best");
  });

  it("a thin-coverage column is excluded from rate marking (coverage-ambiguity gate)", () => {
    const metricsCov = comparisonMetrics({ exam: "WASSCE", hasCoverage: true });
    const a = row({ childId: "a", wassceRate: 0.9, candidates: 100, qualified: 90, coverageRatio: 0.95 });
    const b = row({ childId: "b", wassceRate: 0.5, candidates: 100, qualified: 50, coverageRatio: 0.6 });
    const c = row({ childId: "c", wassceRate: 0.7, candidates: 100, qualified: 70, coverageRatio: 0.95 });
    const model = buildComparison({
      metrics: metricsCov,
      benchmarkPopulation: [a, b, c],
      columns: [col(a), col(b, true), col(c)], // b is thin-coverage
    });
    const qual = model.sections.flatMap((s) => s.rows).find((r) => r.metric.key === "qualification")!;
    // b has the lowest rate but is coverage-ambiguous → not crowned worst; c (the lowest eligible) is.
    expect(qual.cells[1]!.mark).toBeNull();
    expect(qual.cells[0]!.mark).toBe("best");
    expect(qual.cells[2]!.mark).toBe("worst");
    // Coverage has no benchmark cell.
    const cov = model.sections.flatMap((s) => s.rows).find((r) => r.metric.key === "coverage")!;
    expect(cov.benchmark).toBeNull();
  });
});

describe("examForSchoolType — the like-for-level exam pin", () => {
  it("SHS→WASSCE, JHS→BECE, everything else none", () => {
    expect(examForSchoolType("SHS")).toBe("WASSCE");
    expect(examForSchoolType("JHS")).toBe("BECE");
    expect(examForSchoolType("PRIMARY")).toBeNull();
    expect(examForSchoolType("COMBINED")).toBeNull();
    expect(examForSchoolType(null)).toBeNull();
  });
});

describe("entityMeta — the picker/column chrome line", () => {
  const ent = (over: Partial<ComparisonEntity>): ComparisonEntity => ({
    jurisdictionId: "x",
    name: "X",
    schoolType: null,
    ownershipType: null,
    foundedYear: null,
    ...over,
  });
  it("joins ownership and founding year", () => {
    expect(entityMeta(ent({ ownershipType: "PUBLIC", foundedYear: 1960 }))).toBe("public · est. 1960");
  });
  it("is null when a district carries neither", () => {
    expect(entityMeta(ent({}))).toBeNull();
  });
});

describe("render smoke — the surface draws without throwing and keeps its honesty", () => {
  const as = row({ childId: "as", name: "Asankrangwa SHS", enrolment: 1284, candidates: 300, qualified: 213, wassceRate: 0.71, staffEnrolment: 1284, teachers: 60, ptr: 1284 / 60 });
  const am = row({ childId: "am", name: "Amenfiman SHS", enrolment: 1142, candidates: 280, qualified: 168, wassceRate: 0.6, staffEnrolment: 1142, teachers: 41, ptr: 1142 / 41 });
  const metrics = comparisonMetrics({ exam: "WASSCE", hasCoverage: false });

  it("ComparisonTable renders the benchmark column, a rank label and a `—` for an absent entity", () => {
    const model = buildComparison({
      metrics,
      benchmarkPopulation: [as, am],
      columns: [col(as), col(null, false, "ghost")],
    });
    const html = renderToStaticMarkup(
      createElement(ComparisonTable, {
        model,
        columns: [
          { id: "as", name: "Asankrangwa SHS", meta: "public · est. 1960", anchor: true },
          { id: "ghost", name: "Ghost SHS", meta: null },
        ],
        benchmarkLabel: "District average",
        benchmarkPopulation: { count: 2, noun: "SHS" },
        footnote: "read across to compare",
      }),
    );
    expect(html).toContain("District average");
    expect(html).toContain("Asankrangwa SHS");
    expect(html).toContain("—"); // the absent ghost column's cells
    expect(html).toContain("Pupil-teacher ratio");
  });

  /**
   * THE RENDERED HALF OF THE CONTRIBUTOR COUNT (QA gate addition). `benchmarkContributors` is proved
   * on the MODEL above, but the point of the nit is what the officer READS: a neutral population
   * header, and each benchmark cell stating its OWN base. Without this the prop rename and the "k of
   * N" line are untested at the render level — the component could drop either and stay green.
   *
   * The population is deliberately mixed the same way as the model-level block: a PRIVATE school has
   * no GES establishment, so it is outside the VACANCY fold but inside the ENROLMENT one. So the same
   * render must show BOTH a short base and a full one.
   */
  it("each benchmark cell states its OWN 'k of N' base, and the header names the population neutrally", () => {
    const pub = row({
      childId: "pub", name: "Public SHS", enrolment: 900,
      postsEstablished: 40, vacancyNet: 6,
    });
    const priv = row({
      childId: "priv", name: "Private SHS", enrolment: 500,
      postsEstablished: null, vacancyNet: null,
    });
    const population = [pub, priv];
    const model = buildComparison({
      metrics: comparisonMetrics({ exam: "WASSCE", hasCoverage: false }),
      benchmarkPopulation: population,
      columns: [col(pub), col(priv)],
    });

    // The premise: the two metrics really do have DIFFERENT bases on this population, so the two
    // assertions below cannot both be satisfied by one hard-coded string.
    const rowOf = (key: string) =>
      model.sections.flatMap((s) => s.rows).find((r) => r.metric.key === key)!;
    expect(rowOf("enrolment").benchmarkContributors).toBe(2);
    expect(rowOf("teacherVacancies").benchmarkContributors).toBe(1);

    const html = renderToStaticMarkup(
      createElement(ComparisonTable, {
        model,
        columns: [
          { id: "pub", name: "Public SHS", meta: null, anchor: true },
          { id: "priv", name: "Private SHS", meta: null },
        ],
        benchmarkLabel: "District average",
        benchmarkPopulation: { count: 2, noun: "SHS" },
        footnote: "x",
      }),
    );
    // The header NAMES the group; it does not assert it as every row's divisor.
    expect(html).toContain("like-for-like: 2 SHS");
    // Both bases are rendered — the full one for enrolment, the SHORT one for vacancies. The second
    // is the whole point: the old surface printed "2 SHS" beside this figure, which 1 school filed.
    expect(html).toContain("2 of 2 SHS");
    expect(html).toContain("1 of 2 SHS");
  });

  it("ComparisonPicker shows the active tier, a disabled tier and a removable chip", () => {
    const entities: ComparisonEntity[] = [
      { jurisdictionId: "as", name: "Asankrangwa SHS", schoolType: "SHS", ownershipType: "PUBLIC", foundedYear: 1960 },
      { jurisdictionId: "am", name: "Amenfiman SHS", schoolType: "SHS", ownershipType: "PUBLIC", foundedYear: 1991 },
      { jurisdictionId: "jhs", name: "Some JHS", schoolType: "JHS", ownershipType: "PUBLIC", foundedYear: 2001 },
    ];
    const html = renderToStaticMarkup(
      createElement(ComparisonPicker, {
        basePath: "/comparison",
        childLevel: "SCHOOL",
        entities,
        selectedIds: ["as"],
        benchmarkLabel: "District average",
      }),
    );
    expect(html).toContain("Schools");
    expect(html).toContain('aria-disabled="true"'); // Districts / Regions disabled for a district officer
    expect(html).toContain("Asankrangwa SHS");
    expect(html).toContain("District average"); // the pinned benchmark chip
    // Level pinned to SHS by the first pick → the JHS is NOT offered to add.
    expect(html).not.toContain("Some JHS");
    expect(MAX_ENTITIES).toBe(8);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * QA GATE ADDITIONS (increment I) — the acceptance criteria the first 30 tests left unproven.
 * Each block names the AC it discharges, and each is a fold over literal rows or a static render.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

/** The tier-toggle states as rendered: label → disabled?. Parsed off the markup, not re-derived. */
function tierToggleStates(childLevel: ChildLevel): Record<string, boolean> {
  const html = renderToStaticMarkup(
    createElement(ComparisonPicker, {
      basePath: "/comparison",
      childLevel,
      entities: [],
      selectedIds: [],
      benchmarkLabel: "District average",
    }),
  );
  const out: Record<string, boolean> = {};
  for (const m of html.matchAll(/aria-disabled="(true|false)"[^>]*>(Schools|Districts|Regions)</g)) {
    out[m[2]!] = m[1] === "true";
  }
  return out;
}

describe("AC1/AC2/AC4 — the tier toggle is gated on the officer's CHILD level, NOT withinTierCeiling", () => {
  it("childLevelFor is the singleton that drives the toggle (one level below, always in-subtree)", () => {
    expect(childLevelFor("DISTRICT")).toBe("SCHOOL");
    expect(childLevelFor("REGION")).toBe("DISTRICT");
    expect(childLevelFor("NATIONAL")).toBe("REGION");
  });

  it("withinTierCeiling WOULD have enabled the un-servable sibling tier — so it must not be the gate", () => {
    // The catch this build is defending against: the UI-affordance predicate says a district officer
    // may pick DISTRICT (its own tier), but those rows are outside ov_in_subtree → an empty table.
    expect(withinTierCeiling("DISTRICT", "DISTRICT")).toBe(true);
    // …yet the district officer's toggle offers Schools only (below), with Districts disabled.
    expect(tierToggleStates("SCHOOL")).toEqual({
      Schools: false,
      Districts: true,
      Regions: true,
    });
  });

  it("a REGIONAL officer gets Districts active; sibling Regions and down-tier Schools disabled", () => {
    expect(tierToggleStates("DISTRICT")).toEqual({
      Schools: true,
      Districts: false,
      Regions: true,
    });
  });

  it("a NATIONAL officer gets Regions active and nothing else", () => {
    expect(tierToggleStates("REGION")).toEqual({
      Schools: true,
      Districts: true,
      Regions: false,
    });
  });
});

describe("AC5/AC6 — like-for-level: the exam is pinned by level, the section omitted when none applies", () => {
  it("a JHS set reads BECE, an SHS set WASSCE — labels and sections follow the pin", () => {
    const bece = comparisonMetrics({ exam: examForSchoolType("JHS"), hasCoverage: false });
    const qual = bece.find((m) => m.key === "qualification")!;
    expect(qual.label).toBe("BECE qualification");
    expect(qual.section).toBe("Performance · BECE");
    const wassce = comparisonMetrics({ exam: examForSchoolType("SHS"), hasCoverage: false });
    expect(wassce.find((m) => m.key === "qualification")!.label).toBe("WASSCE qualification");
  });

  it("a PRIMARY/KG/COMBINED set renders NO performance row at all — not a `—`-filled one", () => {
    const metrics = comparisonMetrics({ exam: examForSchoolType("PRIMARY"), hasCoverage: false });
    expect(metrics.map((m) => m.key)).toEqual([
      "enrolment",
      "girlsShare",
      "attendance",
      "ptr",
      "teacherVacancies",
    ]);
    const a = row({ childId: "a", name: "Aboi Primary", enrolment: 300, staffEnrolment: 300, teachers: 10, ptr: 30 });
    const b = row({ childId: "b", name: "Beppo Primary", enrolment: 400, staffEnrolment: 400, teachers: 10, ptr: 40 });
    const model = buildComparison({ metrics, benchmarkPopulation: [a, b], columns: [col(a), col(b)] });
    expect(model.sections.map((s) => s.title)).toEqual(["Enrolment", "Attendance", "Staffing"]);
    const html = renderToStaticMarkup(
      createElement(ComparisonTable, {
        model,
        columns: [
          { id: "a", name: "Aboi Primary", meta: null, anchor: true },
          { id: "b", name: "Beppo Primary", meta: null },
        ],
        benchmarkLabel: "District average",
        benchmarkPopulation: { count: 2, noun: "PRIMARY" },
        footnote: "x",
      }),
    );
    // No exam row is claimed into existence, in either direction.
    expect(html).not.toContain("qualification");
    expect(html).not.toContain("WASSCE");
    expect(html).not.toContain("BECE");
    expect(html).not.toContain("Candidates");
  });
});

describe("AC8 — the benchmark column is pinned and NEVER marked, even when it holds the extreme", () => {
  const metrics = comparisonMetrics({ exam: "WASSCE", hasCoverage: false });
  // Both entities are WORSE (higher PTR) than the benchmark, so the benchmark is the row's extreme.
  const a = row({ childId: "a", name: "A SHS", staffEnrolment: 900, teachers: 30, ptr: 30 });
  const b = row({ childId: "b", name: "B SHS", staffEnrolment: 800, teachers: 20, ptr: 40 });
  const lean = row({ childId: "lean", name: "Lean SHS", staffEnrolment: 1000, teachers: 100, ptr: 10 });

  it("the model carries no mark field on the benchmark, and the extreme benchmark draws no rank dot", () => {
    const model = buildComparison({
      metrics,
      benchmarkPopulation: [a, b, lean], // `lean` is in the population but NOT selected
      columns: [col(a), col(b)],
    });
    const ptr = model.sections.flatMap((s) => s.rows).find((r) => r.metric.key === "ptr")!;
    expect(ptr.benchmark).toBeCloseTo(2700 / 150, 10); // 18 — lower (better) than either column
    expect(ptr.cells.map((c) => c.mark)).toEqual(["best", "worst"]);
    const html = renderToStaticMarkup(
      createElement(ComparisonTable, {
        model,
        columns: [
          { id: "a", name: "A SHS", meta: null, anchor: true },
          { id: "b", name: "B SHS", meta: null },
        ],
        benchmarkLabel: "District average",
        benchmarkPopulation: { count: 3, noun: "SHS" },
        footnote: "x",
      }),
    );
    // Exactly ONE "best" dot and ONE "worst" dot — the benchmark cell adds neither.
    expect(html.match(/>best</g)!.length).toBe(1);
    expect(html.match(/>worst</g)!.length).toBe(1);
    // The benchmark cell is the shaded one and carries a value but no dot markup.
    const benchmarkCells = [...html.matchAll(/<td class="[^"]*bg-navy\/5[^"]*">([\s\S]*?)<\/td>/g)].map(
      (m) => m[1]!,
    );
    expect(benchmarkCells.length).toBeGreaterThan(0);
    for (const cell of benchmarkCells) {
      expect(cell).not.toContain("best");
      expect(cell).not.toContain("worst");
      expect(cell).not.toContain("highest");
      expect(cell).not.toContain("lowest");
    }
  });
});

describe("AC11 — the benchmark is over the POPULATION: a non-selected child still counts", () => {
  const metrics = comparisonMetrics({ exam: "WASSCE", hasCoverage: false });
  const strong = row({ childId: "s", enrolment: 1000, candidates: 200, qualified: 160, wassceRate: 0.8, staffEnrolment: 1000, teachers: 50, ptr: 20 });
  const mid = row({ childId: "m", enrolment: 600, candidates: 100, qualified: 60, wassceRate: 0.6, staffEnrolment: 600, teachers: 30, ptr: 20 });
  const weak = row({ childId: "w", enrolment: 200, candidates: 100, qualified: 20, wassceRate: 0.2, staffEnrolment: 200, teachers: 5, ptr: 40 });

  function bench(population: BreakdownRow[], columns: ComparisonColumnInput[]) {
    const model = buildComparison({ metrics, benchmarkPopulation: population, columns });
    const rows = model.sections.flatMap((s) => s.rows);
    return {
      enrolment: rows.find((r) => r.metric.key === "enrolment")!.benchmark,
      qualification: rows.find((r) => r.metric.key === "qualification")!.benchmark,
      ptr: rows.find((r) => r.metric.key === "ptr")!.benchmark,
    };
  }

  it("deselecting the weakest child does NOT improve the district average", () => {
    const population = [strong, mid, weak];
    const all = bench(population, [col(strong), col(mid), col(weak)]);
    const dropped = bench(population, [col(strong), col(mid)]); // weak deselected, still in population
    expect(dropped).toEqual(all);
    // And the figure is the POPULATION's, not the selection's: the selection-only average would differ.
    const selectionOnly = bench([strong, mid], [col(strong), col(mid)]);
    expect(selectionOnly.enrolment).not.toBe(all.enrolment);
    expect(selectionOnly.qualification).not.toBe(all.qualification);
    expect(selectionOnly.ptr).not.toBe(all.ptr);
  });

  it("a ONE-entity profile still reads against the whole-population benchmark, with no marks", () => {
    const population = [strong, mid, weak];
    const one = buildComparison({ metrics, benchmarkPopulation: population, columns: [col(strong)] });
    const rows = one.sections.flatMap((r) => r.rows);
    const enrol = rows.find((r) => r.metric.key === "enrolment")!;
    expect(enrol.benchmark).toBe(1800 / 3); // 600 — unchanged by selecting one
    for (const r of rows) expect(r.cells.map((c) => c.mark)).toEqual([null]);
  });
});

describe("AC9/AC22 — every benchmark rate is Σnum÷Σden off its own inputs, never a stored-rate average", () => {
  it("the PTR benchmark is enrolment-weighted and differs from the mean of the stored ptr values", () => {
    const metrics = comparisonMetrics({ exam: "WASSCE", hasCoverage: false });
    const a = row({ childId: "a", staffEnrolment: 1284, teachers: 60, ptr: 1284 / 60 }); // 21.4
    const b = row({ childId: "b", staffEnrolment: 1142, teachers: 41, ptr: 1142 / 41 }); // 27.85
    const c = row({ childId: "c", staffEnrolment: 874, teachers: 36, ptr: 874 / 36 }); // 24.28
    const model = buildComparison({ metrics, benchmarkPopulation: [a, b, c], columns: [col(a), col(b), col(c)] });
    const ptr = model.sections.flatMap((s) => s.rows).find((r) => r.metric.key === "ptr")!;
    const weighted = (1284 + 1142 + 874) / (60 + 41 + 36);
    expect(ptr.benchmark).toBeCloseTo(weighted, 10); // 24.26…
    const naive = (1284 / 60 + 1142 / 41 + 874 / 36) / 3; // 24.51… — the forbidden figure
    expect(ptr.benchmark).not.toBeCloseTo(naive, 2);
  });

  it("a 0-candidate cohort is `—` not 0%, and contributes no laundered zero to the benchmark", () => {
    const metrics = comparisonMetrics({ exam: "WASSCE", hasCoverage: false });
    // `zero` sat the exam with zero candidates (0/0): rate null. `real` filed a MEASURED zero rate.
    const zero = row({ childId: "zero", name: "Zero SHS", candidates: 0, qualified: 0, wassceRate: null });
    const real = row({ childId: "real", name: "Real SHS", candidates: 50, qualified: 0, wassceRate: 0 });
    const model = buildComparison({
      metrics,
      benchmarkPopulation: [zero],
      columns: [col(zero), col(real)],
    });
    const rows = model.sections.flatMap((s) => s.rows);
    const qual = rows.find((r) => r.metric.key === "qualification")!;
    expect(qual.cells[0]!.value).toBeNull(); // 0/0 → null
    expect(qual.cells[1]!.value).toBe(0); // a measured zero stays 0
    expect(qual.benchmark).toBeNull(); // Σden = 0 → null, never 0
    const html = renderToStaticMarkup(
      createElement(ComparisonTable, {
        model,
        columns: [
          { id: "zero", name: "Zero SHS", meta: null, anchor: true },
          { id: "real", name: "Real SHS", meta: null },
        ],
        benchmarkLabel: "District average",
        benchmarkPopulation: { count: 1, noun: "SHS" },
        footnote: "x",
      }),
    );
    expect(html).toContain("—"); // the 0/0 cell and the absent benchmark
    expect(html).toContain("0%"); // the measured zero is stated, not hidden
  });
});

describe("AC15/AC16/AC17 — the floor, the thin cohort's visible count, all-null rows, coverage marking", () => {
  const metrics = comparisonMetrics({ exam: "WASSCE", hasCoverage: false });

  it("a sub-floor cohort shows BOTH its rate and its candidate count, and is marked on neither row", () => {
    const strong = row({ childId: "s", candidates: 300, qualified: 213, wassceRate: 0.71 });
    const mid = row({ childId: "m", candidates: 280, qualified: 168, wassceRate: 0.6 });
    const thin = row({ childId: "t", candidates: 7, qualified: 7, wassceRate: 1.0 });
    const model = buildComparison({
      metrics,
      benchmarkPopulation: [strong, mid, thin],
      columns: [col(strong), col(mid), col(thin)],
    });
    const rows = model.sections.flatMap((s) => s.rows);
    const qual = rows.find((r) => r.metric.key === "qualification")!;
    const cand = rows.find((r) => r.metric.key === "candidates")!;
    expect(qual.cells.map((c) => c.value)).toEqual([0.71, 0.6, 1.0]);
    expect(qual.cells.map((c) => c.mark)).toEqual(["best", "worst", null]);
    // The ranking weight is visible for the thin cohort — the AC15 "listed with counts" requirement.
    expect(cand.cells.map((c) => c.value)).toEqual([300, 280, 7]);
    expect(cand.cells.map((c) => c.mark)).toEqual([null, null, null]);
    // The thin cohort DOES still weight the benchmark (it is a real cohort, just not crownable).
    expect(qual.benchmark).toBeCloseTo((213 + 168 + 7) / (300 + 280 + 7), 10);
  });

  it("a row nobody filed carries no marks and every cell is `—`", () => {
    const a = row({ childId: "a", enrolment: 500 });
    const b = row({ childId: "b", enrolment: 600 });
    const model = buildComparison({ metrics, benchmarkPopulation: [a, b], columns: [col(a), col(b)] });
    const qual = model.sections.flatMap((s) => s.rows).find((r) => r.metric.key === "qualification")!;
    expect(qual.cells.map((c) => c.value)).toEqual([null, null]);
    expect(qual.cells.map((c) => c.mark)).toEqual([null, null]);
    expect(qual.benchmark).toBeNull();
  });

  it("with only ONE floor-clearing entity the rate row is unmarked entirely", () => {
    const ok30 = row({ childId: "ok", candidates: 40, qualified: 30, wassceRate: 0.75 });
    const thin = row({ childId: "thin", candidates: 10, qualified: 9, wassceRate: 0.9 });
    const model = buildComparison({
      metrics,
      benchmarkPopulation: [ok30, thin],
      columns: [col(ok30), col(thin)],
    });
    const qual = model.sections.flatMap((s) => s.rows).find((r) => r.metric.key === "qualification")!;
    expect(qual.cells.map((c) => c.mark)).toEqual([null, null]);
  });

  it("the thin-coverage entity is uncrowned on the RATE but still ranked on COVERAGE itself", () => {
    const metricsCov = comparisonMetrics({ exam: "WASSCE", hasCoverage: true });
    const a = row({ childId: "a", wassceRate: 0.9, candidates: 100, qualified: 90, coverageRatio: 0.95, schoolsReporting: 38, schoolsRegistered: 40 });
    const thinCov = row({ childId: "b", wassceRate: 0.5, candidates: 100, qualified: 50, coverageRatio: 22 / 36 });
    const c = row({ childId: "c", wassceRate: 0.7, candidates: 100, qualified: 70, coverageRatio: 0.8 });
    const model = buildComparison({
      metrics: metricsCov,
      benchmarkPopulation: [a, thinCov, c],
      columns: [col(a), col(thinCov, true), col(c)],
    });
    const rows = model.sections.flatMap((s) => s.rows);
    const qual = rows.find((r) => r.metric.key === "qualification")!;
    const cov = rows.find((r) => r.metric.key === "coverage")!;
    // Its low rate is shown but NOT crowned worst (ambiguous, not confirmed under-performance).
    expect(qual.cells[1]!.value).toBe(0.5);
    expect(qual.cells[1]!.mark).toBeNull();
    expect(qual.cells.map((c) => c.mark)).toEqual(["best", null, "worst"]);
    // Coverage is itself a measured fact about the register, so it IS ranked — thinnest is named.
    expect(cov.cells.map((c) => c.mark)).toEqual(["best", "worst", null]);
    expect(cov.metric.markLabel).toEqual({ best: "fullest", worst: "thinnest" });
    expect(cov.benchmark).toBeNull(); // R3.6 — coverage has no benchmark cell
  });

  it("AC19 — a SCHOOL-depth comparison has NO coverage row at all", () => {
    expect(comparisonMetrics({ exam: "WASSCE", hasCoverage: false }).map((m) => m.key)).not.toContain(
      "coverage",
    );
  });
});

describe("AC20/AC21 — the cap counts real entities only; deferred metrics are absent", () => {
  it("8 entities + the pinned benchmark = 9 value columns (10 cells with the metric label)", () => {
    const metrics = comparisonMetrics({ exam: "WASSCE", hasCoverage: false });
    const rows = Array.from({ length: MAX_ENTITIES }, (_, i) =>
      row({ childId: `s${i}`, name: `School ${i}`, enrolment: 500 + i * 10 }),
    );
    const model = buildComparison({
      metrics,
      benchmarkPopulation: rows,
      columns: rows.map((r) => col(r)),
    });
    const html = renderToStaticMarkup(
      createElement(ComparisonTable, {
        model,
        columns: rows.map((r, i) => ({ id: r.childId!, name: `School ${i}`, meta: null, anchor: i === 0 })),
        benchmarkLabel: "District average",
        benchmarkPopulation: { count: 8, noun: "SHS" },
        footnote: "x",
      }),
    );
    expect(html.match(/<th /g)!.length).toBe(1 + MAX_ENTITIES + 1);
    // The section-header row spans the same width the header does.
    expect(html).toMatch(new RegExp(`colspan="${1 + MAX_ENTITIES + 1}"`, "i"));
  });

  it("at the cap the picker offers no further add links and says why", () => {
    const entities: ComparisonEntity[] = Array.from({ length: MAX_ENTITIES + 2 }, (_, i) => ({
      jurisdictionId: `id-${i}`,
      name: `School ${i}`,
      schoolType: "SHS",
      ownershipType: "PUBLIC",
      foundedYear: 1990 + i,
    }));
    const html = renderToStaticMarkup(
      createElement(ComparisonPicker, {
        basePath: "/comparison",
        childLevel: "SCHOOL",
        entities,
        selectedIds: entities.slice(0, MAX_ENTITIES).map((e) => e.jurisdictionId),
        benchmarkLabel: "District average",
      }),
    );
    expect(html).toContain(`Maximum of ${MAX_ENTITIES} schools selected`);
    expect(html).not.toContain("+ School 8"); // the 9th is not offerable
    // The benchmark chip is still present — it never counted toward the cap.
    expect(html).toContain("benchmark · pinned");
  });

  it("AC3/AC4/AC23 — the picker's entity read is SELECT-only, RLS-wrapped, and hand-rolls no ceiling", () => {
    // The boundary is `ov_in_subtree()`; a second, hand-written `parent_id` ceiling in app SQL is the
    // defect this pins (it would diverge from the policy and invite widening). The zero-rows PROPERTY
    // itself is a database fact and is asserted as `ov_app` in tests/rls-tier-matrix.test.ts.
    const raw = readFileSync(join(process.cwd(), "lib/oversight/comparison-entities.ts"), "utf8");
    // Comments DISCUSS the forbidden `parent_id` ceiling (and must keep doing so) — the assertions
    // below are about the CODE, so the commentary is stripped before they run.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(raw).toMatch(/import\s*\{[^}]*withJurisdiction[^}]*\}\s*from\s*"@\/lib\/db\/rls"/);
    expect((code.match(/withJurisdiction\(/g) ?? []).length).toBe(1);
    expect(code.indexOf("withJurisdiction(")).toBeLessThan(code.indexOf("tx.execute("));
    // SELECT-only: no write verb anywhere in the module's SQL.
    expect(code).not.toMatch(/\b(insert|update|delete|create|grant|alter|drop)\s+(into|table|on|from|role|policy|view)\b/i);
    // No hand-rolled ceiling, and `parent_id` is not even selected into the payload.
    expect(code).not.toContain("parent_id =");
    expect(code).not.toContain("as parent_id");
    // The child level is a DISPLAY DEPTH derived from the officer's own tier — never a request value.
    expect(code).toContain("childLevelFor(scope.level)");
  });

  it("the still-deferred measures are ABSENT, not rendered as empty rows claiming a measure", () => {
    const keys = comparisonMetrics({ exam: "WASSCE", hasCoverage: true }).map((m) => m.key);
    // Attendance, girls' share and TEACHER VACANCIES are now BUILT (vacancies in increment J, as an
    // UNRANKED signed-net row against a weighted vacancy-rate benchmark); fees and the rest stay deferred.
    for (const deferred of ["fees", "coreMaths", "trend", "population"]) {
      expect(keys.some((k) => k.toLowerCase().includes(deferred.toLowerCase()))).toBe(false);
    }
    expect(keys).toEqual([
      "enrolment",
      "girlsShare",
      "qualification",
      "candidates",
      "attendance",
      "ptr",
      "teacherVacancies",
      "coverage",
    ]);
  });
});

describe("RED-fix 1 — pinSelectionToLevel enforces like-for-level on the URL path", () => {
  const e = (id: string, schoolType: SchoolType | null): ComparisonEntity => ({
    jurisdictionId: id,
    name: id,
    schoolType,
    ownershipType: null,
    foundedYear: null,
  });

  it("drops off-level picks at SCHOOL depth — ?e=<SHS>,<JHS> cannot assemble a mixed set", () => {
    const { pinnedType, selected } = pinSelectionToLevel(
      [e("shs", "SHS"), e("jhs", "JHS"), e("shs2", "SHS")],
      "SCHOOL",
    );
    expect(pinnedType).toBe("SHS");
    expect(selected.map((s) => s.jurisdictionId)).toEqual(["shs", "shs2"]);
  });

  it("the FIRST valid pick pins the level — ?e=<JHS>,<SHS> keeps the JHS and drops the SHS", () => {
    const { pinnedType, selected } = pinSelectionToLevel([e("jhs", "JHS"), e("shs", "SHS")], "SCHOOL");
    expect(pinnedType).toBe("JHS");
    expect(selected.map((s) => s.jurisdictionId)).toEqual(["jhs"]);
  });

  it("keeps every entity above SCHOOL depth (all districts/regions are one type)", () => {
    const { pinnedType, selected } = pinSelectionToLevel([e("d1", null), e("d2", null)], "DISTRICT");
    expect(pinnedType).toBeNull();
    expect(selected).toHaveLength(2);
  });
});

describe("RED-fix 2 — the thin-coverage flag is RENDERED, not silently swallowed", () => {
  const a = row({ childId: "a", name: "Settled District", wassceRate: 0.9, candidates: 100, qualified: 90, coverageRatio: 0.95 });
  const b = row({ childId: "b", name: "Thin District", wassceRate: 0.5, candidates: 100, qualified: 50, coverageRatio: 0.6 });
  const metricsCov = comparisonMetrics({ exam: "WASSCE", hasCoverage: true });

  it("ComparisonTable shows a `thin coverage` tag on a flagged column header", () => {
    const model = buildComparison({
      metrics: metricsCov,
      benchmarkPopulation: [a, b],
      columns: [col(a), col(b, true)],
    });
    const html = renderToStaticMarkup(
      createElement(ComparisonTable, {
        model,
        columns: [
          { id: "a", name: "Settled District", meta: null, anchor: true, coverageAmbiguous: false },
          { id: "b", name: "Thin District", meta: null, coverageAmbiguous: true },
        ],
        benchmarkLabel: "Region average",
        benchmarkPopulation: { count: 2, noun: "districts" },
        footnote: "x",
      }),
    );
    expect(html).toContain("thin coverage");
    // The flagged district's rate is still shown (0.5 → 50%)…
    expect(html).toContain("50%");
    // …but it is not crowned worst (the engine excluded it); the only marks are on the settled column.
    const worstCount = (html.match(/>worst</g) ?? []).length;
    expect(worstCount).toBeLessThanOrEqual(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * QA RE-VERIFICATION OF THE TWO RED FIXES (second gate pass). The fixes are sound; what these add is
 * the adversarial edges the fix-tests did not reach — the null-school-type column, the all-untyped
 * set, and a THREE-column thin-coverage table where marks genuinely exist to be withheld.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("RED-fix 1 re-verified — the level pin holds on the awkward selections too", () => {
  const e = (id: string, schoolType: SchoolType | null): ComparisonEntity => ({
    jurisdictionId: id,
    name: id,
    schoolType,
    ownershipType: null,
    foundedYear: null,
  });

  it("a school whose dim row carries NO type is dropped once a level is pinned (it is unprovable as like-for-like)", () => {
    const { pinnedType, selected } = pinSelectionToLevel(
      [e("shs", "SHS"), e("untyped", null), e("shs2", "SHS")],
      "SCHOOL",
    );
    expect(pinnedType).toBe("SHS");
    expect(selected.map((s) => s.jurisdictionId)).toEqual(["shs", "shs2"]);
  });

  it("an untyped FIRST pick does not pin null — the first TYPED pick does, and the untyped one goes", () => {
    const { pinnedType, selected } = pinSelectionToLevel(
      [e("untyped", null), e("jhs", "JHS")],
      "SCHOOL",
    );
    expect(pinnedType).toBe("JHS");
    expect(selected.map((s) => s.jurisdictionId)).toEqual(["jhs"]);
  });

  it("an entirely untyped set pins nothing, keeps everything, and so reads NO exam (never a guessed one)", () => {
    const { pinnedType, selected } = pinSelectionToLevel([e("x", null), e("y", null)], "SCHOOL");
    expect(pinnedType).toBeNull();
    expect(selected).toHaveLength(2);
    // The downstream consequence the page relies on: no exam pin ⇒ no performance section at all.
    expect(examForSchoolType(pinnedType)).toBeNull();
    expect(comparisonMetrics({ exam: examForSchoolType(pinnedType), hasCoverage: false }).map((m) => m.key))
      .toEqual(["enrolment", "girlsShare", "attendance", "ptr", "teacherVacancies"]);
  });

  it("the pinned selection is what drives the exam — a mixed request can never reach a second exam", () => {
    // `?e=<JHS>,<SHS>`: the SHS is gone before the exam is chosen, so BECE is read against JHS only.
    const mixed = pinSelectionToLevel([e("jhs", "JHS"), e("shs", "SHS")], "SCHOOL");
    expect(examForSchoolType(mixed.pinnedType)).toBe("BECE");
    expect(mixed.selected.every((s) => s.schoolType === "JHS")).toBe(true);
    // …and the reverse order reads WASSCE against SHS only. One exam per table, always.
    const reverse = pinSelectionToLevel([e("shs", "SHS"), e("jhs", "JHS")], "SCHOOL");
    expect(examForSchoolType(reverse.pinnedType)).toBe("WASSCE");
    expect(reverse.selected.every((s) => s.schoolType === "SHS")).toBe(true);
  });

  it("the page routes its URL selection THROUGH the pin before pinning the exam or the benchmark", () => {
    // The fix is only a fix if the page actually uses it, and uses it BEFORE the exam/benchmark are
    // derived — otherwise an off-level column would still be read against the wrong exam.
    const page = readFileSync(
      join(process.cwd(), "app/(oversight)/comparison/page.tsx"),
      "utf8",
    );
    expect(page).toContain("pinSelectionToLevel(");
    expect(page.indexOf("pinSelectionToLevel(")).toBeLessThan(page.indexOf("examForSchoolType("));
    // The picker and the table are fed the PINNED set, so a dropped id cannot linger as a chip.
    expect(page).toContain("selectedIds={effectiveIds}");
  });
});

describe("RED-fix 2 re-verified — the flag is on the right column, and the caveat exists in the surface", () => {
  const metricsCov = comparisonMetrics({ exam: "WASSCE", hasCoverage: true });
  const settled = row({ childId: "a", name: "Settled District", wassceRate: 0.9, candidates: 100, qualified: 90, coverageRatio: 0.95 });
  const thin = row({ childId: "b", name: "Thin District", wassceRate: 0.2, candidates: 100, qualified: 20, coverageRatio: 22 / 36 });
  const middling = row({ childId: "c", name: "Middling District", wassceRate: 0.6, candidates: 100, qualified: 60, coverageRatio: 0.9 });

  it("with THREE columns the marks exist, the thin one is skipped, and only it carries the tag", () => {
    const model = buildComparison({
      metrics: metricsCov,
      benchmarkPopulation: [settled, thin, middling],
      columns: [col(settled), col(thin, true), col(middling)],
    });
    const qual = model.sections.flatMap((s) => s.rows).find((r) => r.metric.key === "qualification")!;
    // The thin district has the LOWEST rate and would have been crowned worst; it is not.
    expect(qual.cells.map((c) => c.mark)).toEqual(["best", null, "worst"]);
    const html = renderToStaticMarkup(
      createElement(ComparisonTable, {
        model,
        columns: [
          { id: "a", name: "Settled District", meta: null, anchor: true, coverageAmbiguous: false },
          { id: "b", name: "Thin District", meta: null, coverageAmbiguous: true },
          { id: "c", name: "Middling District", meta: null, coverageAmbiguous: false },
        ],
        benchmarkLabel: "Region average",
        benchmarkPopulation: { count: 3, noun: "districts" },
        footnote: "x",
      }),
    );
    // EXACTLY ONE tag, and it sits inside the flagged column's own header cell — not the table at large.
    expect((html.match(/thin coverage/g) ?? []).length).toBe(1);
    const headerCells = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1]!);
    const tagged = headerCells.filter((h) => h.includes("thin coverage"));
    expect(tagged).toHaveLength(1);
    expect(tagged[0]).toContain("Thin District");
    // Its rate is still stated (20%), and the laggard label went to the lowest ELIGIBLE district.
    expect(html).toContain("20%");
    // The qualification row's dot words are highest/lowest (best/worst is PTR's wording), so the
    // single `lowest` dot in this markup is the proof that the crown moved off the flagged column.
    expect((html.match(/>lowest</g) ?? []).length).toBe(1);
    expect((html.match(/>highest</g) ?? []).length).toBe(1);
  });

  it("the page renders the `cannot yet show` caveat, naming the flagged entities", () => {
    // The Banner lives in an async server component, so the honest executable check at this layer is
    // that the surface carries the caveat and derives it from the SAME flag the engine suppresses on.
    const page = readFileSync(
      join(process.cwd(), "app/(oversight)/comparison/page.tsx"),
      "utf8",
    );
    expect(page).toContain("What this comparison cannot yet show");
    expect(page).toMatch(/thinCoverage[\s\S]*coverageAmbiguous/);
    expect(page).toMatch(/thinCoverage\.map\(\(e\) => e\.name\)/); // the entities are NAMED, not counted
    expect(page).toContain("not ranked");
    // And the flag reaches the table header from the same column inputs, not a second computation.
    expect(page).toContain("coverageAmbiguous: columns[i]?.coverageAmbiguous ?? false");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * FAST-FOLLOW (increment I) — attendance (R9) and girls' share (R10) SHIP. Fees (R11) stays DEFERRED:
 * girls' share unblocked once the enrolment grain was settled as ANNUAL (enrolment-grain ruling); fees is
 * billed-not-collected distributional data with no pupil denominator. Every property here is a fold over
 * literal rows; the attendance and girls'-share SQL arms are proven in the breakdown + RLS integration
 * tests, not here.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("attendance — weighted Σpresent÷Σenrolled, higher-better, floored (R9 / AC24–AC26)", () => {
  it("benchmark is day-weighted, never the mean of stored rates (AC24/AC25)", () => {
    const pop = [
      row({ childId: "big", presentDays: 22080, enrolledDays: 24000 }), // 92.0%
      row({ childId: "small", presentDays: 870, enrolledDays: 1000 }), // 87.0%
    ];
    const weighted = weightedBenchmark(pop, (r) => r.presentDays, (r) => r.enrolledDays);
    expect(weighted).toBeCloseTo(22950 / 25000, 10); // 0.918 — pulled toward the big school
    // The unweighted mean of the two rates is 0.895 — what avg(stored rate) would wrongly give.
    expect(weighted).not.toBeCloseTo((0.92 + 0.87) / 2, 5);
  });

  it("ranks higher = best, lower = worst, but only above the enrolled-days floor (AC26)", () => {
    const metrics = comparisonMetrics({ exam: null, hasCoverage: false });
    const attendance = metrics.find((m) => m.key === "attendance");
    expect(attendance?.direction).toBe("higher-better");
    // A tiny-cohort 100%% school is below ATT_MIN_ENROLLED_DAYS and must not be crowned best.
    const columns: ComparisonColumnInput[] = [
      col(row({ childId: "tiny", attendanceRate: 1.0, enrolledDays: 500 })), // below floor
      col(row({ childId: "a", attendanceRate: 0.9, enrolledDays: 30000 })),
      col(row({ childId: "b", attendanceRate: 0.8, enrolledDays: 30000 })),
    ];
    const model = buildComparison({ metrics: [attendance!], benchmarkPopulation: [], columns });
    const cells = model.sections[0]!.rows[0]!.cells;
    expect(cells[0]!.mark).toBeNull(); // sub-floor: listed, not crowned
    expect(cells[1]!.mark).toBe("best"); // 0.9 is the best ELIGIBLE
    expect(cells[2]!.mark).toBe("worst"); // 0.8 the worst eligible
  });

  it("a school that filed no gradebook attendance is a null cell and is never marked (AC27)", () => {
    const metrics = comparisonMetrics({ exam: null, hasCoverage: false });
    const attendance = metrics.find((m) => m.key === "attendance")!;
    const columns: ComparisonColumnInput[] = [
      col(row({ childId: "filed", attendanceRate: 0.9, enrolledDays: 30000 })),
      col(row({ childId: "none" })), // no attendance at all → null rate, null enrolledDays
    ];
    const model = buildComparison({ metrics: [attendance], benchmarkPopulation: [], columns });
    const cells = model.sections[0]!.rows[0]!.cells;
    expect(cells[1]!.value).toBeNull();
    expect(cells[1]!.mark).toBeNull();
    // <2 eligible once the null drops out → the lone eligible school is a profile, not crowned.
    expect(cells[0]!.mark).toBeNull();
  });
});

describe("the catalogue (comparisonMetrics) — attendance + girls' share present, fees absent (R9/R10/R11)", () => {
  it("includes enrolment, girls' share, attendance, ptr — and the exam rows only with an exam", () => {
    const withExam = comparisonMetrics({ exam: "WASSCE", hasCoverage: true }).map((m) => m.key);
    expect(withExam).toEqual([
      "enrolment",
      "girlsShare",
      "qualification",
      "candidates",
      "attendance",
      "ptr",
      "teacherVacancies",
      "coverage",
    ]);
    const noExam = comparisonMetrics({ exam: null, hasCoverage: false }).map((m) => m.key);
    expect(noExam).toEqual([
      "enrolment",
      "girlsShare",
      "attendance",
      "ptr",
      "teacherVacancies",
    ]);
  });

  it("carries a girls'-share row in every configuration, and NO fees row (fees DEFERRED)", () => {
    for (const exam of ["WASSCE", "BECE", null] as const) {
      for (const hasCoverage of [true, false]) {
        const keys = comparisonMetrics({ exam, hasCoverage }).map((m) => m.key);
        expect(keys).toContain("girlsShare");
        expect(keys).not.toContain("fees");
      }
    }
  });

  it("enrolment, girls' share and candidates are unranked; attendance ranks (R9)", () => {
    const metrics = comparisonMetrics({ exam: "WASSCE", hasCoverage: true });
    const none = metrics.filter((m) => m.direction === "none").map((m) => m.key).sort();
    // Girls' share is PARITY, not a maximum, so it joins enrolment and candidates as unranked — and so
    // does TEACHER VACANCIES, where both signs are adverse in different ways (a shortage understaffs, a
    // surplus misallocates), so neither end can be crowned (VACANCY-SURFACING-RULING V10).
    expect(none).toEqual([
      "candidates",
      "enrolment",
      "girlsShare",
      "teacherVacancies",
    ]);
    expect(metrics.find((m) => m.key === "attendance")!.direction).toBe("higher-better");
  });
});

describe("girls' share — weighted Σfemale÷Σtotal, PARITY (unranked), null-honest (R10)", () => {
  // The spec's own accessors, read off the catalogue so a swap to kind:"mean" or a wrong accessor fails
  // here rather than silently shipping the unweighted mean.
  const girls = () =>
    comparisonMetrics({ exam: null, hasCoverage: false }).find((m) => m.key === "girlsShare")!;

  it("valueOf reads the row's girlsShare, and the benchmark is the weighted Σfemale÷Σtotal (AC)", () => {
    const g = girls();
    // valueOf points at the precomputed share (computed in the breakdown merge — proven against the DB in
    // oversight-child-breakdown): assert it reads that field and not, say, a re-derivation of its own.
    expect(g.valueOf(row({ childId: "wassa", girlsShare: 220 / 410 }))).toBe(220 / 410);
    expect(g.valueOf(row({ childId: "none" }))).toBeNull(); // no enrolment → null, never a 0/0
    // The BENCHMARK is the real Σfemale ÷ Σtotal over the like-for-like population, on the two numerator/
    // denominator accessors — 540/1130 = 47.79% for the two fixture-shaped districts.
    expect(g.benchmark.kind).toBe("weighted");
    const wassa = row({ childId: "wassa", enrolment: 410, femaleEnrolment: 220 });
    const sekondi = row({ childId: "sekondi", enrolment: 720, femaleEnrolment: 320 });
    const bench = weightedBenchmark([wassa, sekondi], (r) => r.femaleEnrolment, (r) => r.enrolment);
    expect(bench).toBeCloseTo(540 / 1130, 10);
    // …and it is NOT the unweighted mean of the two shares (49.05%) — the no-averaging rule.
    expect(bench).not.toBeCloseTo((220 / 410 + 320 / 720) / 2, 5);
    // ⚠ The three lines above use THIS test's own accessors, so they prove `weightedBenchmark` and the
    // arithmetic but NOT that the catalogue points it at the right two fields: num/den could both be
    // `enrolment` (a flat 1.0) and they would still pass. Drive the SPEC's own accessors, through the
    // real assembly path, and pin the figure — this is the assertion that fails on a wrong accessor.
    if (g.benchmark.kind !== "weighted") throw new Error("unreachable: asserted above");
    expect(weightedBenchmark([wassa, sekondi], g.benchmark.num, g.benchmark.den)).toBeCloseTo(
      540 / 1130,
      10,
    );
    const model = buildComparison({
      metrics: [g],
      benchmarkPopulation: [wassa, sekondi],
      columns: [col(wassa), col(sekondi)],
    });
    expect(model.sections[0]!.rows[0]!.benchmark).toBeCloseTo(540 / 1130, 10);
    expect(model.sections[0]!.rows[0]!.benchmark).not.toBeCloseTo((220 / 410 + 320 / 720) / 2, 5);
  });

  it("is PARITY: direction 'none', so it is never crowned and carries no mark label", () => {
    const g = girls();
    expect(g.direction).toBe("none");
    expect(g.markLabel).toBeUndefined();
    // Assembled over two columns, neither is marked — more girls is not "better".
    const model = buildComparison({
      metrics: [g],
      benchmarkPopulation: [],
      columns: [
        col(row({ childId: "a", enrolment: 400, femaleEnrolment: 280, girlsShare: 0.7 })),
        col(row({ childId: "b", enrolment: 400, femaleEnrolment: 200, girlsShare: 0.5 })),
      ],
    });
    const cells = model.sections[0]!.rows[0]!.cells;
    expect(cells.map((c) => c.mark)).toEqual([null, null]);
  });
});
