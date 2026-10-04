import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { adminDemoAnalytics } from "./helpers";
import {
  DEMO_EXAM_COHORTS,
  DEMO_TERMS,
  emisExtractFor,
  examsPresentedBy,
  generateDemoDataset,
  loadDemoSource,
  type DemoDataset,
  type DemoExamCohort,
  type DemoSchool,
  type DemoTerminalExamRow,
} from "@/scripts/seed-demo-data";
import { runOversightEtl, type EtlRunReport } from "@/lib/etl/pipeline";
import {
  EXAMS,
  PerformanceTransformError,
  aggregateSchoolSitting,
  assertExamCohortPeriodsSeeded,
  assertSchoolExamInvariants,
  collapseBySourcePrecedence,
  qualificationRate,
  waecExtractFactRows,
  writePerformanceExamFacts,
  type Exam,
  type FactPerformanceExamRow,
} from "@/lib/etl/performance";
import {
  readTerminalExamResults,
  readWaecExtractCohort,
} from "@/lib/etl/performance-source";
import { examCohortAcademicYear } from "@/lib/etl/dimensions";

/**
 * INCREMENT H THIRD SLICE — `fact_performance_exam` end-to-end (task H14, Kofi's 21 acceptance
 * criteria).
 *
 * Same posture as `tests/etl-enrolment.test.ts`, deliberately: the REAL pipeline runs over the
 * deterministic demo dataset, every fact row is produced by `aggregateSchoolSitting` from
 * operational-shaped `terminal_exam_result` rows, and NOTHING HERE HAND-SEEDS A FACT except where a
 * write-path property can only be staged (the injected duplicate, the WAEC precedence). The expected
 * figures are HAND-COMPUTED IN TYPESCRIPT from the generated sittings — not read back out of SQL and
 * compared to another SQL query, which would only prove Postgres agrees with itself.
 *
 * It runs against the increment-H demo analytics database (`adminDemoAnalytics`), AFTER the two earlier
 * ETL files alphabetically, so it begins by reloading the stand-in source and re-running the whole
 * three-arm pipeline — which is also the statement that the third arm composes with the first two
 * rather than replacing them.
 */

let sql: postgres.Sql;
let dataset: DemoDataset;
let report: EtlRunReport;

/** The sitting the bulk of the file asserts against — the later of the two demo cohorts. */
const COHORT = DEMO_EXAM_COHORTS[DEMO_EXAM_COHORTS.length - 1]!;
const EARLIER_COHORT = DEMO_EXAM_COHORTS[0]!;

let schoolByEmis: Map<string, DemoSchool>;
/** `${emis}|${sittingYear}|${exam}` → the generated leaf counts. The independent expectation. */
let expected: Map<string, DemoTerminalExamRow>;

const key = (emis: string, year: number, exam: string): string =>
  `${emis}|${year}|${exam}`;

function extractText(d: DemoDataset): string {
  return JSON.stringify(emisExtractFor(d));
}

function periodsOption() {
  return DEMO_TERMS.map((t) => ({
    academicYear: t.academicYear,
    term: t.term,
    startsOn: t.startsOn,
    endsOn: t.endsOn,
    isCurrent: t.isCurrent,
  }));
}

function cohortsOption(cohorts: readonly DemoExamCohort[] = DEMO_EXAM_COHORTS) {
  return cohorts.map((c) => ({
    sittingYear: c.sittingYear,
    startsOn: c.startsOn,
    endsOn: c.endsOn,
  }));
}

async function runEtl(
  over: {
    d?: DemoDataset;
    cohorts?: readonly DemoExamCohort[];
    extractText?: string;
  } = {},
): Promise<EtlRunReport> {
  return runOversightEtl(sql, {
    emisExtractText: over.extractText ?? extractText(over.d ?? dataset),
    periods: periodsOption(),
    examCohorts: cohortsOption(over.cohorts),
    sourceSchema: "demo_source",
  });
}

/** THE EXPECTATION, re-derived from the generated sittings rather than from anything the ETL produced. */
function buildExpectations(d: DemoDataset): void {
  const emisByOpId = new Map<string, string>(
    d.schools
      .filter((s) => s.operationalSchoolId)
      .map((s) => [s.operationalSchoolId!, s.emisSchoolId]),
  );
  expected = new Map();
  for (const row of d.terminalExamResults)
    expected.set(key(emisByOpId.get(row.schoolId)!, row.year, row.examType), row);
}

beforeAll(async () => {
  sql = adminDemoAnalytics();
  dataset = generateDemoDataset();
  await loadDemoSource(sql, dataset);
  schoolByEmis = new Map(dataset.schools.map((s) => [s.emisSchoolId, s]));
  buildExpectations(dataset);
  report = await runEtl();
}, 300_000);

afterAll(async () => {
  // ⚠ LEAVE THE SHARED DEMO DATABASE AS FOUND. This file is the only one that declares exam cohorts, so
  // it is the only one that writes `fact_performance_exam` — and the 2025 sitting's EXAM_COHORT
  // `academic_year` is "2024/25", which `tests/etl-enrolment.test.ts` deletes outright as its past-year
  // fixture (`delete from dim_period where academic_year = '2024/25'`). A fact row still hanging off that
  // period turns that cleanup into a foreign-key error — and vitest does not guarantee alphabetical file
  // order, so "this file runs last" is not something to rely on. Both are removed here instead.
  await sql`delete from fact_performance_exam`;
  await sql`delete from dim_period where period_type = 'EXAM_COHORT'`;
  await sql.end({ timeout: 5 });
});

// ── helpers over the written facts ──────────────────────────────────────────────────────────────

/** The EXAM_COHORT period of one sitting year. Pins `period_type`: the ANNUAL row shares its year. */
async function cohortPeriodId(sittingYear: number): Promise<string> {
  const rows = await sql<{ period_id: string }[]>`
    select period_id::text as period_id from dim_period
     where academic_year = ${examCohortAcademicYear(sittingYear)}
       and term is null and period_type = 'EXAM_COHORT'`;
  expect(rows).toHaveLength(1);
  return rows[0]!.period_id;
}

async function nodeId(level: string, name: string): Promise<string> {
  const rows = await sql<{ jurisdiction_id: string }[]>`
    select jurisdiction_id::text as jurisdiction_id from dim_jurisdiction
     where level = ${level}::jurisdiction_level and name = ${name}`;
  expect(rows).toHaveLength(1);
  return rows[0]!.jurisdiction_id;
}

interface DbExamRow {
  emis: string;
  academic_year: string;
  exam: string;
  sex: string;
  candidates: number;
  qualified: number;
  qualification_rate: string;
  source: string;
}

/** Every written row, keyed back to its EMIS id and its sitting. The whole table. */
async function allRows(): Promise<DbExamRow[]> {
  return sql<DbExamRow[]>`
    select d.ges_code as emis, dp.academic_year, f.exam::text as exam, f.sex::text as sex,
           f.candidates, f.qualified, f.qualification_rate::text as qualification_rate,
           f.source::text as source
      from fact_performance_exam f
      join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
      join dim_period dp on dp.period_id = f.period_id`;
}

/**
 * SUM a measure over a jurisdiction SUBTREE — the product's actual roll-up shape.
 *
 * ⚠ THE FILTER IS THE API: one `period_id`, one `exam`, one `sex`. The unfiltered variants exist only to
 * prove how wrong the unfiltered read is (criterion 11).
 */
async function rollUp(
  rootJurisdictionId: string,
  periodId: string,
  opts: {
    exam?: Exam;
    sex?: string;
    column?: "candidates" | "qualified";
  } = {},
): Promise<number> {
  const column = opts.column ?? "candidates";
  const rows = await sql<{ total: number | null }[]>`
    with recursive subtree as (
      select jurisdiction_id from dim_jurisdiction where jurisdiction_id = ${rootJurisdictionId}::uuid
      union all
      select c.jurisdiction_id from dim_jurisdiction c join subtree s on c.parent_id = s.jurisdiction_id
    )
    select sum(case when ${sql(column)} is null then 0 else ${sql(column)} end)::int as total
      from fact_performance_exam f
      join subtree s on s.jurisdiction_id = f.jurisdiction_id
     where f.period_id = ${periodId}::uuid
       and (${opts.exam ?? null}::text is null or f.exam::text = ${opts.exam ?? null})
       and (${opts.sex ?? null}::text is null or f.sex::text = ${opts.sex ?? null})`;
  return rows[0]!.total ?? 0;
}

/** The hand-computed figure for a set of schools, for one sitting and one exam. */
function expectedFigure(
  predicate: (s: DemoSchool) => boolean,
  sittingYear: number,
  exam: Exam,
  column: "candidates" | "qualified",
): number {
  let total = 0;
  for (const [k, row] of expected) {
    const [emis, year, rowExam] = k.split("|");
    if (Number(year) !== sittingYear || rowExam !== exam) continue;
    if (!predicate(schoolByEmis.get(emis!)!)) continue;
    total +=
      column === "candidates"
        ? row.femaleCandidates + row.maleCandidates
        : row.femalePassed + row.malePassed;
  }
  return total;
}

/** Round-trip a written row back into the shape the writer takes. Used by the write-path tests. */
function factRowFrom(
  db: Record<string, unknown>,
  periodId: string,
): FactPerformanceExamRow {
  return {
    jurisdictionId: db.jurisdiction_id as string,
    periodId,
    exam: db.exam as Exam,
    sex: db.sex as FactPerformanceExamRow["sex"],
    candidates: Number(db.candidates),
    qualified: Number(db.qualified),
    qualificationRate: String(db.qualification_rate),
    source: db.source as FactPerformanceExamRow["source"],
    asOfDate: (db.as_of_date as Date).toISOString(),
    etlRunId: db.etl_run_id as string,
  };
}

async function fingerprint(): Promise<string> {
  const rows = await sql<{ f: string }[]>`
    select md5(string_agg(t.row, '|' order by t.row)) as f
      from (select (to_jsonb(f) - 'fact_id' - 'etl_run_id')::text as row
              from fact_performance_exam f) t`;
  return rows[0]!.f;
}

async function rowCount(): Promise<number> {
  return (
    await sql<{ n: number }[]>`select count(*)::int as n from fact_performance_exam`
  )[0]!.n;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the run, the grain, the period and the provenance (criteria 1, 6, 7)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the run writes a THIRD fact table under one verdict (criteria 1, 6, 7)", () => {
  it("reaches SUCCESS with nothing to confess, and the exam arm reports every declared cohort", async () => {
    expect(report.status).toBe("SUCCESS");
    expect(report.errorText).toBeNull();
    expect(report.examCohorts).toHaveLength(DEMO_EXAM_COHORTS.length);
    for (const c of report.examCohorts) {
      expect(c.failures).toEqual([]);
      expect(c.periodType).toBe("EXAM_COHORT");
      expect(c.inserted).toBeGreaterThan(0);
      expect(c.sourceRows).toBeGreaterThan(0);
    }
    // All THREE arms wrote in the same run — the slice extends the pipeline rather than forking it.
    const counts = await sql<{ infra: number; enrol: number; exam: number }[]>`
      select (select count(*)::int from fact_infrastructure)   as infra,
             (select count(*)::int from fact_enrolment)        as enrol,
             (select count(*)::int from fact_performance_exam) as exam`;
    expect(counts[0]!.infra).toBeGreaterThan(0);
    expect(counts[0]!.enrol).toBeGreaterThan(0);
    expect(counts[0]!.exam).toBeGreaterThan(0);
  });

  it("CRITERION 1 · a filed sitting is exactly 3 rows per (school, cohort, exam) — MALE/FEMALE/ALL, SCHOOL_ENTERED", async () => {
    const shape = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select f.jurisdiction_id, f.period_id, f.exam, count(*)::int as sexes,
               count(distinct f.sex)::int as distinct_sexes
          from fact_performance_exam f
         group by f.jurisdiction_id, f.period_id, f.exam
        having count(*) <> 3 or count(distinct f.sex) <> 3
      ) bad`;
    expect(shape[0]!.n).toBe(0);
    // …counted rather than merely "no violations": a test that only looked for violations would pass
    // against an empty table.
    const groups = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select 1 from fact_performance_exam group by jurisdiction_id, period_id, exam
      ) g`;
    expect(groups[0]!.n).toBeGreaterThan(400);

    const sexes = await sql<{ sex: string }[]>`
      select distinct sex::text as sex from fact_performance_exam order by sex`;
    expect(sexes.map((s) => s.sex)).toEqual(["ALL", "FEMALE", "MALE"]);
    const sources = await sql<{ source: string }[]>`
      select distinct source::text as source from fact_performance_exam`;
    expect(sources.map((s) => s.source)).toEqual(["SCHOOL_ENTERED"]);

    // Every row sits on a SCHOOL node: no stored roll-ups, so a district figure is only ever a SUM.
    const byLevel = await sql<{ level: string }[]>`
      select distinct d.level::text as level from fact_performance_exam f
        join dim_jurisdiction d using (jurisdiction_id)`;
    expect(byLevel.map((r) => r.level)).toEqual(["SCHOOL"]);
  });

  it("CRITERION 6 · every row's period is EXAM_COHORT with term NULL and academic_year '(N-1)/N'", async () => {
    const byType = await sql<
      { period_type: string; term: number | null; academic_year: string; n: number }[]
    >`
      select dp.period_type::text as period_type, dp.term, dp.academic_year, count(*)::int as n
        from fact_performance_exam f join dim_period dp on dp.period_id = f.period_id
       group by dp.period_type, dp.term, dp.academic_year
       order by dp.academic_year`;
    expect(byType.every((r) => r.period_type === "EXAM_COHORT")).toBe(true);
    expect(byType.every((r) => r.term === null)).toBe(true);
    expect(byType.map((r) => r.academic_year)).toEqual(
      DEMO_EXAM_COHORTS.map((c) => examCohortAcademicYear(c.sittingYear)),
    );
    // The mapping itself, stated: sitting year N → "(N-1)/N".
    expect(examCohortAcademicYear(2026)).toBe("2025/26");
    expect(examCohortAcademicYear(2025)).toBe("2024/25");

    // ONE EXAM_COHORT period per sitting year — a second would split the sitting across two
    // indistinguishable periods — and it is a DIFFERENT period from the ANNUAL row of the same year.
    for (const c of DEMO_EXAM_COHORTS) {
      const n = await sql<{ n: number }[]>`
        select count(*)::int as n from dim_period
         where academic_year = ${examCohortAcademicYear(c.sittingYear)}
           and period_type = 'EXAM_COHORT'`;
      expect(n[0]!.n).toBe(1);
    }
    const annual = await sql<{ period_id: string }[]>`
      select period_id::text as period_id from dim_period
       where academic_year = ${DEMO_TERMS[0]!.academicYear} and period_type = 'ANNUAL'`;
    expect(annual[0]!.period_id).not.toBe(await cohortPeriodId(2026));
    // Both exams of one sitting live on the SAME period — the `exam` column separates them, not time.
    const examsOnOnePeriod = await sql<{ exam: string }[]>`
      select distinct exam::text as exam from fact_performance_exam
       where period_id = ${await cohortPeriodId(2026)}::uuid order by exam`;
    expect(examsOnOnePeriod.map((r) => r.exam)).toEqual(["BECE", "WASSCE"]);
  });

  it("CRITERION 6 · an UNSEEDED sitting year fails the run UP FRONT with the naming rule, not a late FK error", async () => {
    // A sitting present in the SOURCE that no EXAM_COHORT period was declared for. The honest failure is
    // loud and up front: never a raw FK violation deep inside the write, and never a silent drop that
    // leaves the sitting missing from the dashboard with nothing to point at.
    const victim = (
      await sql<{ op: string }[]>`
        select r.operational_school_id::text as op from ref_emis_school_register r
          join demo_source.terminal_exam_result t on t.school_id = r.operational_school_id
         where r.on_schoolup order by r.emis_school_id limit 1`
    )[0]!;
    const before = await fingerprint();
    try {
      await sql`
        insert into demo_source.terminal_exam_result
          (school_id, exam_type, year, female_candidates, male_candidates, female_passed, male_passed)
        values (${victim.op}::uuid, 'BECE', 2027, 20, 22, 15, 14)`;
      await expect(runEtl()).rejects.toThrow(
        /no EXAM_COHORT row for sitting year\(s\) 2027 \(academic_year "2026\/27"\)/,
      );
      // The message carries the FIX, and nothing was written.
      await expect(runEtl()).rejects.toThrow(/period_type = 'EXAM_COHORT'/);
      expect(await fingerprint()).toBe(before);
      const failed = await sql<{ status: string; error_text: string | null }[]>`
        select status::text as status, error_text from etl_run order by started_at desc limit 1`;
      expect(failed[0]!.status).toBe("FAILED");
      expect(failed[0]!.error_text).toMatch(/EXAM_COHORT/);
    } finally {
      await sql`delete from demo_source.terminal_exam_result where year = 2027`;
      report = await runEtl();
    }
    expect(await fingerprint()).toBe(before);
  }, 300_000);

  it("CRITERION 7 · as_of_date is the COHORT's frozen vintage (the sitting's ends_on), never now()", async () => {
    const vintages = await sql<{ academic_year: string; as_of: string }[]>`
      select distinct dp.academic_year, f.as_of_date::date::text as as_of
        from fact_performance_exam f join dim_period dp on dp.period_id = f.period_id
       order by dp.academic_year`;
    expect(vintages).toEqual(
      DEMO_EXAM_COHORTS.map((c) => ({
        academic_year: examCohortAcademicYear(c.sittingYear),
        as_of: c.endsOn,
      })),
    );
    // One vintage per sitting, and both are in the PAST relative to the run — `now()` would collapse
    // the two cohorts onto one timestamp and make the byte-identical re-run below untestable.
    expect(new Set(vintages.map((v) => v.as_of)).size).toBe(DEMO_EXAM_COHORTS.length);
    const stamped = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_performance_exam
       where as_of_date is null or etl_run_id is null or source is null
          or candidates < 0 or qualified < 0 or qualified > candidates`;
    expect(stamped[0]!.n).toBe(0);
    for (const c of report.examCohorts)
      expect(c.asOfDate).toBe(
        DEMO_EXAM_COHORTS.find((d) => d.sittingYear === c.sittingYear)!.endsOn,
      );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the measures: the leaves, the synthesised total and the rate (criteria 2, 3, 4)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the measures map from the leaves (criteria 2, 3, 4)", () => {
  it("EVERY written row equals the hand-computed figure for its (school, sitting, exam, sex)", async () => {
    // The exhaustive form, over every row: not a sample and not a sum (a sum can be right while two
    // schools are swapped). `expected` was built from the generator's sittings.
    const rows = await allRows();
    expect(rows.length).toBeGreaterThan(1_000);
    const yearOf = new Map(
      DEMO_EXAM_COHORTS.map((c) => [
        examCohortAcademicYear(c.sittingYear),
        c.sittingYear,
      ]),
    );
    const mismatches: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const year = yearOf.get(row.academic_year)!;
      const k = key(row.emis, year, row.exam);
      seen.add(`${k}|${row.sex}`);
      const leaves = expected.get(k);
      if (!leaves) {
        mismatches.push(`${k}: written but not expected`);
        continue;
      }
      const want =
        row.sex === "MALE"
          ? { candidates: leaves.maleCandidates, qualified: leaves.malePassed }
          : row.sex === "FEMALE"
            ? { candidates: leaves.femaleCandidates, qualified: leaves.femalePassed }
            : {
                // CRITERION 2 · strict ALL = MALE + FEMALE, on BOTH measures.
                candidates: leaves.maleCandidates + leaves.femaleCandidates,
                // CRITERION 3 · qualified IS passed: the ENTERED, unthresholded count.
                qualified: leaves.malePassed + leaves.femalePassed,
              };
      if (Number(row.candidates) !== want.candidates)
        mismatches.push(
          `${k}/${row.sex}: candidates ${row.candidates}, expected ${want.candidates}`,
        );
      if (Number(row.qualified) !== want.qualified)
        mismatches.push(
          `${k}/${row.sex}: qualified ${row.qualified}, expected ${want.qualified}`,
        );
      // CRITERION 4 · the rate is re-derived from THIS row's own two counts.
      const wantRate = qualificationRate(want.qualified, want.candidates);
      if (row.qualification_rate !== wantRate)
        mismatches.push(
          `${k}/${row.sex}: rate ${row.qualification_rate}, expected ${wantRate}`,
        );
    }
    // …and nothing EXPECTED is missing: a dropped sitting would otherwise pass the loop above.
    for (const k of expected.keys())
      for (const sex of ["MALE", "FEMALE", "ALL"])
        if (!seen.has(`${k}|${sex}`))
          mismatches.push(`${k}/${sex}: expected but not written`);
    expect(mismatches.slice(0, 10)).toEqual([]);
  });

  it("CRITERION 2 · ALL = MALE + FEMALE, STRICTLY, on candidates AND qualified, over every key", async () => {
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id, exam,
               sum(case when sex = 'ALL' then candidates end)    as all_c,
               sum(case when sex = 'MALE' then candidates end)   as male_c,
               sum(case when sex = 'FEMALE' then candidates end) as female_c,
               sum(case when sex = 'ALL' then qualified end)     as all_q,
               sum(case when sex = 'MALE' then qualified end)    as male_q,
               sum(case when sex = 'FEMALE' then qualified end)  as female_q
          from fact_performance_exam
         group by jurisdiction_id, period_id, exam
      ) x
       where all_c is distinct from male_c + female_c
          or all_q is distinct from male_q + female_q`;
    expect(bad[0]!.n).toBe(0);
  });

  it("CRITERION 3 · qualified IS the ENTERED pass count — no grade scale is recomputed anywhere", () => {
    // The structural half of GOV6-03: the operational system applies NO threshold, and there is no grade
    // scale in the source to recompute from. So the transform must not mention one — a module that
    // referenced grades would be inventing a credit rule nobody ruled on.
    const code = stripComments(moduleText("lib/etl/performance.ts"));
    for (const forbidden of ["A1", "C6", "grade", "threshold"])
      expect(code).not.toContain(forbidden);
    // And the figure really is the sum of the two stored pass leaves, exercised on a real school.
    const sample = [...expected.entries()][0]!;
    const [, row] = sample;
    const result = aggregateSchoolSitting(
      [
        {
          schoolId: row.schoolId,
          examType: row.examType,
          year: row.year,
          femaleCandidates: row.femaleCandidates,
          maleCandidates: row.maleCandidates,
          femalePassed: row.femalePassed,
          malePassed: row.malePassed,
        },
      ],
      unitTarget,
    );
    const all = result.rows.find((r) => r.sex === "ALL")!;
    expect(all.qualified).toBe(row.femalePassed + row.malePassed);
  });

  it("CRITERION 4 · a ZERO-CANDIDATE sex row is 0.00 — never NaN, never a division error", async () => {
    // The planted single-sex school: `female_candidates = 0` is legal operationally (only the SUM is
    // CHECKed ≥ 1), so the zero-denominator sex row is a NORMAL row.
    const singleSex = dataset.terminalExamResults.filter((r) => r.femaleCandidates === 0);
    expect(singleSex.length).toBeGreaterThan(0);
    const emis = dataset.schools.find(
      (s) => s.operationalSchoolId === singleSex[0]!.schoolId,
    )!.emisSchoolId;
    const rows = await sql<
      { sex: string; candidates: number; qualification_rate: string }[]
    >`
      select f.sex::text as sex, f.candidates, f.qualification_rate::text as qualification_rate
        from fact_performance_exam f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
        join dim_period dp on dp.period_id = f.period_id
       where d.ges_code = ${emis} and f.exam::text = ${singleSex[0]!.examType}
         and dp.academic_year = ${examCohortAcademicYear(singleSex[0]!.year)}
       order by f.sex`;
    const female = rows.find((r) => r.sex === "FEMALE")!;
    expect(Number(female.candidates)).toBe(0);
    expect(female.qualification_rate).toBe("0.00");
    // The pure function, directly — and `0/0` is 0.00 rather than NaN or a throw.
    expect(qualificationRate(0, 0)).toBe("0.00");
    expect(qualificationRate(0, 10)).toBe("0.00");
    expect(qualificationRate(1, 3)).toBe("33.33");
    expect(qualificationRate(2, 3)).toBe("66.67");
    expect(qualificationRate(10, 10)).toBe("100.00");

    // CRITERION 4's other half: sex='ALL' ALWAYS has candidates ≥ 1 (the operational CHECK guarantees
    // the two leaves sum to ≥ 1), so the headline figure never divides by zero.
    const zeroAll = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_performance_exam where sex = 'ALL' and candidates < 1`;
    expect(zeroAll[0]!.n).toBe(0);
    // …and no stored rate is NaN-shaped or out of range.
    const badRate = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_performance_exam
       where qualification_rate < 0 or qualification_rate > 100`;
    expect(badRate[0]!.n).toBe(0);
  });

  it("CRITERION 4 · the ALL rate is RE-DERIVED from ALL's counts, not averaged from the splits", async () => {
    // The arithmetic that makes this non-trivial: with unequal denominators the mean of the two sex
    // rates is NOT the combined rate, so a school where they differ proves the ETL did not average.
    const row = (
      await sql<
        {
          emis: string;
          exam: string;
          male_c: number;
          male_q: number;
          female_c: number;
          female_q: number;
          all_c: number;
          all_q: number;
          all_rate: string;
          male_rate: string;
          female_rate: string;
        }[]
      >`
        select d.ges_code as emis, f.exam::text as exam,
               max(case when f.sex = 'MALE' then f.candidates end)::int as male_c,
               max(case when f.sex = 'MALE' then f.qualified end)::int as male_q,
               max(case when f.sex = 'FEMALE' then f.candidates end)::int as female_c,
               max(case when f.sex = 'FEMALE' then f.qualified end)::int as female_q,
               max(case when f.sex = 'ALL' then f.candidates end)::int as all_c,
               max(case when f.sex = 'ALL' then f.qualified end)::int as all_q,
               max(case when f.sex = 'ALL' then f.qualification_rate end)::text as all_rate,
               max(case when f.sex = 'MALE' then f.qualification_rate end)::text as male_rate,
               max(case when f.sex = 'FEMALE' then f.qualification_rate end)::text as female_rate
          from fact_performance_exam f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
         group by d.ges_code, f.exam, f.period_id
        having max(case when f.sex = 'MALE' then f.candidates end)
             <> max(case when f.sex = 'FEMALE' then f.candidates end)
           and max(case when f.sex = 'MALE' then f.qualification_rate end)
             <> max(case when f.sex = 'FEMALE' then f.qualification_rate end)
         limit 1`
    )[0]!;
    expect(row.all_rate).toBe(qualificationRate(row.all_q, row.all_c));
    const averaged = (Number(row.male_rate) + Number(row.female_rate)) / 2;
    expect(Number(row.all_rate)).not.toBeCloseTo(averaged, 2);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the exam allow-list and per-school isolation (criterion 5)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the exam allow-list is per-school fatal, never run-fatal (criterion 5)", () => {
  it("CRITERION 5 · exam is the operational exam_type, mapped 1:1", async () => {
    const exams = await sql<{ exam: string }[]>`
      select distinct exam::text as exam from fact_performance_exam order by exam`;
    expect(exams.map((e) => e.exam)).toEqual(["BECE", "WASSCE"]);
    expect([...EXAMS]).toEqual(["BECE", "WASSCE"]);
    // The operational CHECK really is the same closed domain — so the 1:1 claim is about two allow-lists
    // that agree, not about one the ETL invented.
    const real = moduleText("../web/db/schema/terminal-results.ts");
    expect(real).toContain("IN ('BECE', 'WASSCE')");
    // Every school's exams are the ones its register school_type presents candidates for.
    for (const sittingYear of [COHORT.sittingYear]) {
      const rows = await sql<{ emis: string; exams: string[] }[]>`
        select d.ges_code as emis, array_agg(distinct f.exam::text order by f.exam::text) as exams
          from fact_performance_exam f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
         where f.period_id = ${await cohortPeriodId(sittingYear)}::uuid
         group by d.ges_code`;
      expect(rows.length).toBeGreaterThan(200);
      for (const row of rows)
        expect(row.exams).toEqual(
          examsPresentedBy(schoolByEmis.get(row.emis)!.schoolType),
        );
    }
  });

  it("CRITERION 5 · the transform THROWS on an exam_type outside {BECE, WASSCE}", () => {
    expect(() =>
      aggregateSchoolSitting([sourceRow({ examType: "WASSCE_PRIVATE" })], unitTarget),
    ).toThrow(PerformanceTransformError);
    expect(() =>
      aggregateSchoolSitting([sourceRow({ examType: "NOVDEC" })], unitTarget),
    ).toThrow(/outside the allow-list BECE\|WASSCE/);
    // Naming the drift is the point: the operational CHECK and the analytics enum must agree.
    expect(() =>
      aggregateSchoolSitting([sourceRow({ examType: "bece" })], unitTarget),
    ).toThrow(/drifted/);
  });

  it("ONE bad school fails ITSELF: the run survives, keeps that school's PRIOR rows, and names it", async () => {
    // The allow-list-drift discipline end to end. The CHECK has to come off to stage it, which is itself
    // the statement that the demo stand-in carries the real constraint.
    const victim = (
      await sql<{ emis: string; op: string }[]>`
        select r.emis_school_id as emis, r.operational_school_id::text as op
          from ref_emis_school_register r
          join demo_source.terminal_exam_result t on t.school_id = r.operational_school_id
         where r.on_schoolup and t.year = ${COHORT.sittingYear}
         order by r.emis_school_id limit 1`
    )[0]!;
    const rowsFor = async (emis: string) =>
      sql<{ exam: string; sex: string; candidates: number }[]>`
        select f.exam::text as exam, f.sex::text as sex, f.candidates
          from fact_performance_exam f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
          join dim_period dp on dp.period_id = f.period_id
         where d.ges_code = ${emis} and dp.academic_year = ${examCohortAcademicYear(COHORT.sittingYear)}
         order by f.exam, f.sex`;
    const before = await rowsFor(victim.emis);
    expect(before.length).toBeGreaterThan(0);

    try {
      await sql.unsafe(`
        alter table demo_source.terminal_exam_result
          drop constraint terminal_exam_result_exam_type_valid`);
      await sql`
        update demo_source.terminal_exam_result set exam_type = 'NOVDEC'
         where school_id = ${victim.op}::uuid and year = ${COHORT.sittingYear}`;
      const run = await runEtl();
      // The RUN survives — SUCCESS WITH GAPS — and the gap names the school and the reason.
      expect(run.status).toBe("SUCCESS");
      expect(run.errorText).toMatch(/SUCCESS WITH GAPS/);
      const cohort = run.examCohorts.find((c) => c.sittingYear === COHORT.sittingYear)!;
      expect(cohort.failures.map((f) => f.emisSchoolId)).toContain(victim.emis);
      expect(
        cohort.failures.find((f) => f.emisSchoolId === victim.emis)!.message,
      ).toMatch(/outside the allow-list/);
      // A failed school is NOT in the delete scope: it keeps its last good figures, stale but honest.
      expect(await rowsFor(victim.emis)).toEqual(before);
      // …and every OTHER school was still written: one bad row costs one school, not the country.
      const others = await sql<{ n: number }[]>`
        select count(*)::int as n from fact_performance_exam f
         where f.etl_run_id = ${run.runId}::uuid`;
      expect(others[0]!.n).toBeGreaterThan(1_000);
    } finally {
      await loadDemoSource(sql, dataset);
      report = await runEtl();
    }
    expect(await rowsFor(victim.emis)).toEqual(before);
  }, 300_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// idempotency, the bounded delete and the duplicate assertion (criteria 8, 9, 10)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("idempotency and the bounded delete (criteria 8, 9)", () => {
  it("CRITERION 8 · a second identical run is byte-identical, and REPLACES rather than appends", async () => {
    const before = await fingerprint();
    const countBefore = await rowCount();
    const second = await runEtl();
    expect(second.status).toBe("SUCCESS");
    expect(second.runId).not.toBe(report.runId);
    expect(await fingerprint()).toBe(before);
    expect(await rowCount()).toBe(countBefore);
    for (const c of second.examCohorts) expect(c.deleted).toBe(c.inserted);
    // Provenance moved even though the measures did not — the rows were really rewritten.
    const stamped = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_performance_exam
       where etl_run_id = ${second.runId}::uuid`;
    expect(stamped[0]!.n).toBe(countBefore);
    report = second;
  }, 300_000);

  it("a CHANGED sitting moves the fact row, with the row count unchanged", async () => {
    // "Byte-identical" is necessary but not sufficient: a pipeline that inserted nothing on the second
    // run would pass it. Change the source and the figure must MOVE — including the synthesised ALL and
    // the re-derived rate.
    const victim = (
      await sql<{ emis: string; op: string; male_candidates: number }[]>`
        select r.emis_school_id as emis, r.operational_school_id::text as op, t.male_candidates
          from demo_source.terminal_exam_result t
          join ref_emis_school_register r on r.operational_school_id = t.school_id
         where t.exam_type = 'BECE' and t.year = ${COHORT.sittingYear}
         order by r.emis_school_id limit 1`
    )[0]!;
    const countBefore = await rowCount();
    try {
      await sql`
        update demo_source.terminal_exam_result
           set male_candidates = male_candidates + 9
         where school_id = ${victim.op}::uuid and exam_type = 'BECE'
           and year = ${COHORT.sittingYear}`;
      const rerun = await runEtl();
      expect(rerun.status).toBe("SUCCESS");
      const after = await sql<
        { sex: string; candidates: number; qualified: number; rate: string }[]
      >`
        select f.sex::text as sex, f.candidates, f.qualified, f.qualification_rate::text as rate
          from fact_performance_exam f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
          join dim_period dp on dp.period_id = f.period_id
         where d.ges_code = ${victim.emis} and f.exam = 'BECE'
           and dp.academic_year = ${examCohortAcademicYear(COHORT.sittingYear)}
         order by f.sex`;
      const male = after.find((r) => r.sex === "MALE")!;
      const female = after.find((r) => r.sex === "FEMALE")!;
      const all = after.find((r) => r.sex === "ALL")!;
      expect(Number(male.candidates)).toBe(Number(victim.male_candidates) + 9);
      // The synthesised ALL moved WITH it, and so did ALL's rate — a stale total or a stale rate beside
      // a moved leaf is the failure mode a materialised figure is exposed to.
      expect(Number(all.candidates)).toBe(
        Number(male.candidates) + Number(female.candidates),
      );
      expect(all.rate).toBe(
        qualificationRate(Number(all.qualified), Number(all.candidates)),
      );
      expect(await rowCount()).toBe(countBefore);
    } finally {
      await loadDemoSource(sql, dataset);
      report = await runEtl();
    }
  }, 300_000);

  it("CRITERION 9 · the delete is bounded by (period, jurisdiction ∈ scope) — a bystander survives", async () => {
    const periodId = await cohortPeriodId(COHORT.sittingYear);
    const two = await sql<{ jurisdiction_id: string }[]>`
      select distinct jurisdiction_id::text as jurisdiction_id from fact_performance_exam
       where period_id = ${periodId}::uuid order by jurisdiction_id limit 2`;
    const [bystander, rewritten] = two;
    const snapshot = async (jurisdictionId: string) =>
      sql<{ n: number; total: number }[]>`
        select count(*)::int as n, sum(candidates)::int as total from fact_performance_exam
         where period_id = ${periodId}::uuid and jurisdiction_id = ${jurisdictionId}::uuid`;
    const bystanderBefore = await snapshot(bystander!.jurisdiction_id);

    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_performance_exam
       where period_id = ${periodId}::uuid and jurisdiction_id = ${rewritten!.jurisdiction_id}::uuid`;
    const result = await writePerformanceExamFacts(sql, [
      {
        periodId,
        jurisdictionIds: [rewritten!.jurisdiction_id],
        rows: existing.map((r) => factRowFrom(r, periodId)),
      },
    ]);
    // EXACTLY that school's rows deleted — a period-wide delete would report thousands.
    expect(result).toMatchObject({
      deleted: existing.length,
      inserted: existing.length,
      superseded: 0,
    });
    expect((await snapshot(bystander!.jurisdiction_id))[0]).toEqual(bystanderBefore[0]);

    // The OTHER sitting is untouched too: the delete is bounded by period as well as jurisdiction, which
    // is what stops a re-run of 2026 from emptying 2025 (a sitting is immutable, so it must survive).
    const earlier = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_performance_exam
       where period_id = ${await cohortPeriodId(EARLIER_COHORT.sittingYear)}::uuid`;
    expect(earlier[0]!.n).toBeGreaterThan(0);
  });

  it("CRITERION 9 · a school that filed NO sitting is NOT in the delete scope and keeps its prior rows", async () => {
    // A KG/PRIMARY school never presents candidates, so the source returns nothing for it. Its prior
    // rows — however they got there — must SURVIVE the run: deleting them on the strength of an absence
    // would empty a published sitting. (A hand-written row is the only way to stage "prior rows" for a
    // school the ETL will never compute.)
    const periodId = await cohortPeriodId(COHORT.sittingYear);
    const bystanderSchool = dataset.schools.find(
      (s) => s.onSchoolup && examsPresentedBy(s.schoolType).length === 0,
    )!;
    const jurisdictionId = (
      await sql<{ jurisdiction_id: string }[]>`
        select jurisdiction_id::text as jurisdiction_id from dim_jurisdiction
         where level = 'SCHOOL' and ges_code = ${bystanderSchool.emisSchoolId}`
    )[0]!.jurisdiction_id;
    // It really has no rows of its own, and really is reported as having filed nothing.
    const cohort = report.examCohorts.find((c) => c.sittingYear === COHORT.sittingYear)!;
    expect(cohort.noResults).toContain(bystanderSchool.emisSchoolId);
    expect(cohort.failures).toEqual([]);
    const mine = async () =>
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n from fact_performance_exam
           where period_id = ${periodId}::uuid and jurisdiction_id = ${jurisdictionId}::uuid`
      )[0]!.n;
    expect(await mine()).toBe(0);

    try {
      await sql`
        insert into fact_performance_exam
          (jurisdiction_id, period_id, exam, sex, candidates, qualified, qualification_rate,
           source, as_of_date, etl_run_id)
        values (${jurisdictionId}::uuid, ${periodId}::uuid, 'BECE', 'ALL', 40, 30, 75.00,
                'SCHOOL_ENTERED', ${`${COHORT.endsOn}T00:00:00Z`}::timestamptz, null)`;
      expect(await mine()).toBe(1);
      const run = await runEtl();
      expect(run.status).toBe("SUCCESS");
      // THE POINT: the row is still there. Not in the scope, not deleted.
      expect(await mine()).toBe(1);
    } finally {
      await sql`
        delete from fact_performance_exam
         where jurisdiction_id = ${jurisdictionId}::uuid and etl_run_id is null`;
      report = await runEtl();
    }
    expect(await mine()).toBe(0);
  }, 300_000);
});

describe("the PLAIN duplicate assertion (criterion 10)", () => {
  it("CRITERION 10 · an injected duplicate FAILS the run inside the txn and rolls everything back", async () => {
    // `fact_performance_exam` is one of the PK-ONLY original eight: there is NO grain UNIQUE, so a
    // duplicate INSERTS HAPPILY and doubles every roll-up above it — while the stored RATE still reads
    // correctly, because the doubling cancels in the ratio. This assertion is the only guard that exists.
    //
    // The duplicate is planted on a school OUTSIDE the delete scope (one that filed no sitting), because
    // a duplicate inside the scope would simply be deleted and rewritten — which is the right behaviour
    // and the wrong test.
    const periodId = await cohortPeriodId(COHORT.sittingYear);
    const bystanderSchool = dataset.schools.find(
      (s) => s.onSchoolup && examsPresentedBy(s.schoolType).length === 0,
    )!;
    const jurisdictionId = (
      await sql<{ jurisdiction_id: string }[]>`
        select jurisdiction_id::text as jurisdiction_id from dim_jurisdiction
         where level = 'SCHOOL' and ges_code = ${bystanderSchool.emisSchoolId}`
    )[0]!.jurisdiction_id;
    const before = await fingerprint();
    const countBefore = await rowCount();

    try {
      for (let i = 0; i < 2; i++)
        await sql`
          insert into fact_performance_exam
            (jurisdiction_id, period_id, exam, sex, candidates, qualified, qualification_rate,
             source, as_of_date, etl_run_id)
          values (${jurisdictionId}::uuid, ${periodId}::uuid, 'WASSCE', 'ALL', 10, 5, 50.00,
                  'SCHOOL_ENTERED', ${`${COHORT.endsOn}T00:00:00Z`}::timestamptz, null)`;
      await expect(runEtl()).rejects.toThrow(/duplicated grain key/);
      // The whole three-arm write rolled back: the run wrote NOTHING, so the duplicate (inserted outside
      // the transaction) is all that changed.
      expect(await rowCount()).toBe(countBefore + 2);
      const failed = await sql<{ status: string; error_text: string | null }[]>`
        select status::text as status, error_text from etl_run order by started_at desc limit 1`;
      expect(failed[0]!.status).toBe("FAILED");
      expect(failed[0]!.error_text).toMatch(/jurisdiction_id, period_id, exam, sex/);
    } finally {
      await sql`
        delete from fact_performance_exam
         where jurisdiction_id = ${jurisdictionId}::uuid and etl_run_id is null`;
      report = await runEtl();
    }
    expect(await fingerprint()).toBe(before);
    expect(await rowCount()).toBe(countBefore);
  }, 300_000);

  it("does NOT flag the three LEGITIMATE sex rows — the plain group-by is correct, not merely lax", async () => {
    // The grain's three sex rows per (school, period, exam) are legitimate and distinct. Rewriting a real
    // school's rows unchanged is the proof the assertion's key includes `sex` (and that it needs no
    // NULL-safe dance: every grain column here is NOT NULL).
    const periodId = await cohortPeriodId(COHORT.sittingYear);
    const victim = (
      await sql<{ jurisdiction_id: string }[]>`
        select jurisdiction_id::text as jurisdiction_id from fact_performance_exam
         where period_id = ${periodId}::uuid order by jurisdiction_id limit 1`
    )[0]!;
    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_performance_exam
       where period_id = ${periodId}::uuid and jurisdiction_id = ${victim.jurisdiction_id}::uuid`;
    expect(existing.length).toBeGreaterThanOrEqual(3);
    const before = await fingerprint();
    const result = await writePerformanceExamFacts(sql, [
      {
        periodId,
        jurisdictionIds: [victim.jurisdiction_id],
        rows: existing.map((r) => factRowFrom(r, periodId)),
      },
    ]);
    expect(result.inserted).toBe(existing.length);
    expect(await fingerprint()).toBe(before);
    // And every grain column really is NOT NULL, which is WHY the assertion is a plain group-by.
    const nullable = await sql<{ column_name: string; is_nullable: string }[]>`
      select column_name, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'fact_performance_exam'
         and column_name in ('jurisdiction_id', 'period_id', 'exam', 'sex')`;
    expect(nullable).toHaveLength(4);
    expect(nullable.every((c) => c.is_nullable === "NO")).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the roll-up, and the filters that make it correct (criterion 11)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("roll-ups sum SPATIALLY under the mandatory filters (criterion 11)", () => {
  it("CRITERION 11 · district = Σ its schools, with sex='ALL' AND one exam AND one period", async () => {
    const periodId = await cohortPeriodId(COHORT.sittingYear);
    const probes = [
      { region: "Greater Accra", district: "Accra Metropolitan" },
      { region: "Upper West", district: "Nadowli-Kaleo" },
      { region: "Ashanti", district: "Kumasi Metropolitan" },
    ];
    for (const probe of probes) {
      const districtId = await nodeId("DISTRICT", probe.district);
      const inDistrict = (s: DemoSchool) =>
        s.regionName === probe.region && s.districtName === probe.district;
      for (const exam of EXAMS)
        for (const column of ["candidates", "qualified"] as const)
          expect(await rollUp(districtId, periodId, { exam, sex: "ALL", column })).toBe(
            expectedFigure(inDistrict, COHORT.sittingYear, exam, column),
          );
    }
    // Region = Σ its districts = the hand-computed figure; national = Σ all schools.
    const regionId = await nodeId("REGION", "Greater Accra");
    const districts = [
      ...new Set(
        dataset.schools
          .filter((s) => s.regionName === "Greater Accra")
          .map((s) => s.districtName),
      ),
    ];
    let sumOfDistricts = 0;
    for (const district of districts)
      sumOfDistricts += await rollUp(await nodeId("DISTRICT", district), periodId, {
        exam: "BECE",
        sex: "ALL",
      });
    expect(await rollUp(regionId, periodId, { exam: "BECE", sex: "ALL" })).toBe(
      sumOfDistricts,
    );
    const national = await nodeId("NATIONAL", "Ghana");
    expect(await rollUp(national, periodId, { exam: "WASSCE", sex: "ALL" })).toBe(
      expectedFigure(() => true, COHORT.sittingYear, "WASSCE", "candidates"),
    );
  });

  it("CRITERION 11 · the UNFILTERED sums are wrong — omitting sex DOUBLES, omitting exam MIXES", async () => {
    const periodId = await cohortPeriodId(COHORT.sittingYear);
    const national = await nodeId("NATIONAL", "Ghana");
    const correctBece = await rollUp(national, periodId, { exam: "BECE", sex: "ALL" });
    const correctWassce = await rollUp(national, periodId, {
      exam: "WASSCE",
      sex: "ALL",
    });

    // 1 · NO SEX FILTER → exactly 2× (ALL is stored beside MALE+FEMALE). Internally consistent, and
    //     completely wrong.
    expect(await rollUp(national, periodId, { exam: "BECE" })).toBe(correctBece * 2);

    // 2 · NO EXAM FILTER → the two sittings' candidates MIXED into one figure. It is not a double-count
    //     — nothing is counted twice — it is worse: a count over a cohort that does not exist, since JHS 3
    //     and SHS 3 leavers are different children.
    const mixed = await rollUp(national, periodId, { sex: "ALL" });
    expect(mixed).toBe(correctBece + correctWassce);
    expect(mixed).not.toBe(correctBece);
    expect(mixed).not.toBe(correctWassce);
    // …and the RATE derived from that mixed pair is neither exam's rate: the number a reader would print.
    const mixedQualified = await rollUp(national, periodId, {
      sex: "ALL",
      column: "qualified",
    });
    const mixedRate = qualificationRate(mixedQualified, mixed);
    const beceRate = qualificationRate(
      await rollUp(national, periodId, { exam: "BECE", sex: "ALL", column: "qualified" }),
      correctBece,
    );
    const wassceRate = qualificationRate(
      await rollUp(national, periodId, {
        exam: "WASSCE",
        sex: "ALL",
        column: "qualified",
      }),
      correctWassce,
    );
    expect(mixedRate).not.toBe(beceRate);
    expect(mixedRate).not.toBe(wassceRate);

    // 3 · NO PERIOD FILTER → two SITTINGS summed. Different candidates in different years: a trend is a
    //     SERIES of per-sitting figures, never a sum. (Stated here as the arithmetic a reader would get.)
    const acrossSittings = (
      await sql<{ total: number }[]>`
        select sum(f.candidates)::int as total from fact_performance_exam f
         where f.exam = 'BECE' and f.sex = 'ALL'`
    )[0]!.total;
    const earlierBece = await rollUp(
      national,
      await cohortPeriodId(EARLIER_COHORT.sittingYear),
      { exam: "BECE", sex: "ALL" },
    );
    expect(Number(acrossSittings)).toBe(correctBece + earlierBece);
    expect(Number(acrossSittings)).toBeGreaterThan(correctBece);
  });

  it("the sex SPLIT is complete on the school-entered arm: MALE + FEMALE = ALL at every tier", async () => {
    const periodId = await cohortPeriodId(COHORT.sittingYear);
    const national = await nodeId("NATIONAL", "Ghana");
    for (const exam of EXAMS) {
      const all = await rollUp(national, periodId, { exam, sex: "ALL" });
      const male = await rollUp(national, periodId, { exam, sex: "MALE" });
      const female = await rollUp(national, periodId, { exam, sex: "FEMALE" });
      expect(male + female).toBe(all);
      expect(all).toBeGreaterThan(0);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the TWO SOURCES: precedence, the empty WAEC arm and its documented asymmetry (criteria 12, 13, 17)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("WAEC_EXTRACT > SCHOOL_ENTERED, resolved at WRITE time (criterion 12)", () => {
  it("CRITERION 12 · both sources for ONE COHORT collapse to ONE row: WAEC wins the WHOLE cohort", async () => {
    // THE COLLAPSE UNIT IS THE COHORT `(jurisdiction, period, exam)` — sex is NOT part of the precedence
    // decision (Kofi's follow-up ruling). So feeding both sources for one cohort leaves exactly ONE row:
    // WAEC's sex='ALL'. The school-entered MALE, FEMALE *and* ALL rows are all dropped, because keeping
    // the split beside an authoritative total would attribute that total to a split WAEC never published
    // AND break `ALL = MALE + FEMALE` by construction.
    const periodId = await cohortPeriodId(COHORT.sittingYear);
    // A school that actually HAS a BECE cohort: the first jurisdiction in the table may be an SHS one
    // (WASSCE only), and which school that is depends on run order.
    const jurisdictionId = (
      await sql<{ jurisdiction_id: string }[]>`
        select jurisdiction_id::text as jurisdiction_id from fact_performance_exam
         where period_id = ${periodId}::uuid and exam = 'BECE'
         order by jurisdiction_id limit 1`
    )[0]!.jurisdiction_id;
    const cohortRows = (
      await sql<Record<string, unknown>[]>`
        select * from fact_performance_exam
         where period_id = ${periodId}::uuid and jurisdiction_id = ${jurisdictionId}::uuid
           and exam = 'BECE' order by sex`
    ).map((r) => factRowFrom(r, periodId));
    expect(cohortRows).toHaveLength(3); // MALE, FEMALE, ALL — the school-entered shape
    const waec: FactPerformanceExamRow = {
      ...cohortRows.find((r) => r.sex === "ALL")!,
      candidates: 777,
      qualified: 555,
      qualificationRate: qualificationRate(555, 777),
      source: "WAEC_EXTRACT",
    };
    const countBefore = await rowCount();

    // The PURE collapse first, and order must not matter.
    for (const order of [
      [...cohortRows, waec],
      [waec, ...cohortRows],
    ]) {
      const survivors = collapseBySourcePrecedence(order);
      expect(survivors).toHaveLength(1);
      expect(survivors[0]!.sex).toBe("ALL");
      expect(survivors[0]!.source).toBe("WAEC_EXTRACT");
      expect(survivors[0]!.candidates).toBe(777);
      expect(survivors[0]!.qualified).toBe(555);
      // NOT ONE school-entered row survives the cohort.
      expect(survivors.some((r) => r.source === "SCHOOL_ENTERED")).toBe(false);
    }
    // A cohort WAEC does NOT cover is untouched — the collapse is per cohort, not per table, so the
    // school-entered split of the school's OTHER exam survives in full.
    const otherExam: FactPerformanceExamRow[] = cohortRows.map((r) => ({
      ...r,
      exam: "WASSCE",
    }));
    const mixedBatch = collapseBySourcePrecedence([...cohortRows, waec, ...otherExam]);
    expect(mixedBatch.filter((r) => r.exam === "WASSCE")).toHaveLength(3);
    expect(mixedBatch.filter((r) => r.exam === "BECE")).toHaveLength(1);

    try {
      // …and through the real write path, which is where the collapse has to happen.
      const result = await writePerformanceExamFacts(sql, [
        {
          periodId,
          jurisdictionIds: [jurisdictionId],
          rows: [
            ...(
              await sql<Record<string, unknown>[]>`
                select * from fact_performance_exam
                 where period_id = ${periodId}::uuid
                   and jurisdiction_id = ${jurisdictionId}::uuid`
            ).map((r) => factRowFrom(r, periodId)),
            waec,
          ],
        },
      ]);
      // All THREE school-entered rows of that cohort were superseded by the one WAEC row.
      expect(result.superseded).toBe(3);
      const survived = await sql<{ source: string; candidates: number; sex: string }[]>`
        select source::text as source, candidates, sex::text as sex from fact_performance_exam
         where period_id = ${periodId}::uuid and jurisdiction_id = ${jurisdictionId}::uuid
           and exam = 'BECE' order by sex`;
      expect(survived).toHaveLength(1);
      expect(survived[0]!.sex).toBe("ALL");
      expect(survived[0]!.source).toBe("WAEC_EXTRACT");
      expect(Number(survived[0]!.candidates)).toBe(777);
      // NO SCHOOL_ENTERED row for that cohort remains…
      const leftovers = await sql<{ n: number }[]>`
        select count(*)::int as n from fact_performance_exam
         where period_id = ${periodId}::uuid and jurisdiction_id = ${jurisdictionId}::uuid
           and exam = 'BECE' and source = 'SCHOOL_ENTERED'`;
      expect(leftovers[0]!.n).toBe(0);
      // …and the row count FELL by exactly the two dropped split rows: the two sources did not BOTH
      // insert (the doubling this collapse exists to prevent), and the cohort is now ALL-only.
      expect(await rowCount()).toBe(countBefore - 2);
    } finally {
      report = await runEtl();
    }
    expect(await rowCount()).toBe(countBefore);
  }, 300_000);

  it("`source` is NOT part of any uniqueness key — the table has no grain UNIQUE at all", async () => {
    // The structural statement: if `source` were part of a unique key, both sources could insert the same
    // cohort and every roll-up would double, internally consistently. There is no such index — the guard
    // is the collapse plus the post-insert assertion.
    const unique = (
      await sql<{ indexdef: string }[]>`
        select indexdef from pg_indexes
         where schemaname = 'public' and tablename = 'fact_performance_exam'`
    )
      .filter((i) => /create unique index/i.test(i.indexdef))
      // Only the COLUMN LIST is inspected — the TABLE NAME itself contains "exam".
      .map((i) => i.indexdef.slice(i.indexdef.lastIndexOf("(")));
    // EXACTLY ONE unique index, and it is the primary key on the surrogate `fact_id`: no natural-key
    // UNIQUE of any kind, and in particular none mentioning `source`.
    expect(unique).toHaveLength(1);
    expect(unique[0]).toMatch(/\(fact_id\)/);
    expect(unique[0]).not.toMatch(/source|sex|period_id/);
  });
});

describe("the WAEC_EXTRACT arm is an explicitly-EMPTY documented path (criteria 13, 17)", () => {
  it("CRITERION 13 · it reads ZERO rows from an empty/absent ref_waec_results_extract, and writes none", async () => {
    const empty = await sql<{ n: number }[]>`
      select count(*)::int as n from ref_waec_results_extract`;
    expect(empty[0]!.n).toBe(0);
    const read = await readWaecExtractCohort(sql, {
      academicYear: examCohortAcademicYear(COHORT.sittingYear),
      emisSchoolIds: dataset.schools.slice(0, 50).map((s) => s.emisSchoolId),
    });
    expect(read.rows).toEqual([]);
    for (const c of report.examCohorts) expect(c.waecRows).toBe(0);
    const written = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_performance_exam where source = 'WAEC_EXTRACT'`;
    expect(written[0]!.n).toBe(0);
    // An ABSENT table is a clean zero too, not a "relation does not exist" — the path must survive a
    // database older than the reference table.
    const guarded = (
      await sql<{ ok: boolean }[]>`
      select to_regclass('public.ref_waec_results_extract') is not null as ok`
    )[0]!;
    expect(guarded.ok).toBe(true);
    expect(moduleText("lib/etl/performance-source.ts")).toContain("to_regclass");
  });

  it("the arm writes sex='ALL' ONLY — a split is never synthesised from a total", () => {
    const rows = waecExtractFactRows(
      [
        {
          emisSchoolId: "GH-TEST-0001",
          academicYear: "2025/26",
          exam: "WASSCE",
          candidates: 120,
          qualified: 90,
          asOfDate: "2026-08-01",
        },
      ],
      {
        periodId: unitTarget.periodId,
        etlRunId: unitTarget.etlRunId,
        asOfDate: unitTarget.asOfDate,
        jurisdictionOf: () => unitTarget.jurisdictionId,
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sex: "ALL",
      source: "WAEC_EXTRACT",
      candidates: 120,
      qualified: 90,
      qualificationRate: "75.00",
    });
    // A school the extract covers but the run does not include is SKIPPED, not guessed at.
    expect(
      waecExtractFactRows(
        [
          {
            emisSchoolId: "GH-NOT-INCLUDED",
            academicYear: "2025/26",
            exam: "BECE",
            candidates: 10,
            qualified: 4,
            asOfDate: "2026-08-01",
          },
        ],
        {
          periodId: unitTarget.periodId,
          etlRunId: unitTarget.etlRunId,
          asOfDate: unitTarget.asOfDate,
          jurisdictionOf: () => undefined,
        },
      ),
    ).toEqual([]);
  });

  it("CRITERION 17 · over a WAEC-only cohort the sex SPLIT returns NOTHING while sex='ALL' is complete", async () => {
    // THE DOCUMENTED ASYMMETRY, made executable by actually loading the extract for two schools. The
    // extract carries NO sex column, so MALE/FEMALE rows are ABSENT rather than zero — absent is the
    // honest encoding, because zeros would report "no girls sat the exam", which is a measurement and a
    // false one.
    const periodId = await cohortPeriodId(COHORT.sittingYear);
    // Two victim shapes, and under the PER-COHORT collapse they end up IDENTICAL — which is the ruling:
    //   · a school the extract covers that filed NOTHING (a KG/PRIMARY school never presents candidates);
    //   · a school that filed school-entered figures AND is covered by the extract — WAEC wins its WHOLE
    //     cohort, so its school-entered split is dropped too (asserted at the foot of this test).
    const victims = dataset.schools
      .filter((s) => s.onSchoolup && examsPresentedBy(s.schoolType).length === 0)
      .slice(0, 2);
    expect(victims).toHaveLength(2);
    const ids = (
      await sql<{ jurisdiction_id: string }[]>`
        select jurisdiction_id::text as jurisdiction_id from dim_jurisdiction
         where level = 'SCHOOL' and ges_code = any(${victims.map((v) => v.emisSchoolId)})`
    ).map((r) => r.jurisdiction_id);
    expect(ids).toHaveLength(2);
    // A school that filed school-entered figures AND is then covered by the extract — the second half.
    const alsoFiled = (
      await sql<{ emis: string; jurisdiction_id: string }[]>`
        select distinct d.ges_code as emis, d.jurisdiction_id::text as jurisdiction_id
          from fact_performance_exam f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
         where f.period_id = ${periodId}::uuid and f.exam = 'BECE'
         order by d.ges_code limit 1`
    )[0]!;

    try {
      for (const emis of [...victims.map((v) => v.emisSchoolId), alsoFiled.emis])
        await sql`
          insert into ref_waec_results_extract
            (emis_school_id, academic_year, exam, subject, candidates, qualified, source, as_of_date)
          values (${emis}, ${examCohortAcademicYear(COHORT.sittingYear)}, 'BECE', null,
                  200, 150, 'WAEC_EXTRACT', ${COHORT.endsOn}::date)`;
      const run = await runEtl();
      expect(run.status).toBe("SUCCESS");
      const cohort = run.examCohorts.find((c) => c.sittingYear === COHORT.sittingYear)!;
      expect(cohort.waecRows).toBe(3);
      // The school that ALSO filed loses its WHOLE school-entered BECE cohort — all THREE sex rows — to
      // the one WAEC row. The two WAEC-only schools had nothing to supersede.
      expect(cohort.superseded).toBe(3);

      const bySex = await sql<{ sex: string; source: string; n: number }[]>`
        select sex::text as sex, source::text as source, count(*)::int as n
          from fact_performance_exam
         where period_id = ${periodId}::uuid and exam = 'BECE'
           and jurisdiction_id = any(${ids}::uuid[])
         group by sex, source order by sex`;
      // sex='ALL' is complete AND it is the WAEC figure.
      expect(bySex).toHaveLength(1);
      const all = bySex[0]!;
      expect(all.sex).toBe("ALL");
      expect(all.n).toBe(2);
      expect(all.source).toBe("WAEC_EXTRACT");
      const waecAll = await sql<{ candidates: number }[]>`
        select candidates from fact_performance_exam
         where period_id = ${periodId}::uuid and exam = 'BECE' and sex = 'ALL'
           and jurisdiction_id = any(${ids}::uuid[])`;
      expect(waecAll.every((r) => Number(r.candidates) === 200)).toBe(true);
      // …and the SPLIT is simply ABSENT for those schools: a `sex IN ('MALE','FEMALE')` read returns
      // NOTHING (a NULL sum, not a zero), which is what a reader assuming the split is always present
      // would silently report as "no candidates".
      const split = await sql<{ total: number | null }[]>`
        select sum(candidates)::int as total from fact_performance_exam
         where period_id = ${periodId}::uuid and exam = 'BECE'
           and jurisdiction_id = any(${ids}::uuid[]) and sex in ('MALE', 'FEMALE')`;
      expect(split[0]!.total).toBeNull();

      // ── A COHORT IS NEVER HALF ONE SOURCE AND HALF THE OTHER (the per-cohort ruling) ──────────────
      // The school that ALSO filed its own figures ends up ALL-ONLY too: WAEC won the whole cohort, so no
      // school-entered row of it survives. Keeping the split would have attributed WAEC's authoritative
      // total to a split WAEC never published, and made `ALL = MALE + FEMALE` false by construction.
      const covered = await sql<{ sex: string; source: string; candidates: number }[]>`
        select sex::text as sex, source::text as source, candidates
          from fact_performance_exam
         where period_id = ${periodId}::uuid and exam = 'BECE'
           and jurisdiction_id = ${alsoFiled.jurisdiction_id}::uuid
         order by sex`;
      expect(covered.map((r) => `${r.sex}:${r.source}`)).toEqual(["ALL:WAEC_EXTRACT"]);
      expect(Number(covered[0]!.candidates)).toBe(200);
      // Its OTHER exam, which the extract does NOT cover, keeps its full school-entered split — the
      // collapse is per cohort, not per school. (COMBINED schools are the ones that have one.)
      const uncovered = await sql<{ sex: string; source: string }[]>`
        select sex::text as sex, source::text as source from fact_performance_exam
         where period_id = ${periodId}::uuid and exam = 'WASSCE'
           and jurisdiction_id = ${alsoFiled.jurisdiction_id}::uuid
         order by sex`;
      if (uncovered.length > 0) {
        expect(uncovered).toHaveLength(3);
        expect(uncovered.every((r) => r.source === "SCHOOL_ENTERED")).toBe(true);
      }
      // AND THE INVARIANT HOLDS EVERYWHERE IN THE TABLE: every cohort either carries all three sex rows
      // with ALL = MALE + FEMALE, or carries ALL alone (and satisfies it vacuously). Nothing in between.
      const badShape = await sql<{ n: number }[]>`
        select count(*)::int as n from (
          select jurisdiction_id, period_id, exam,
                 count(*)::int as rows_n,
                 sum(case when sex = 'ALL' then candidates end)    as all_c,
                 sum(case when sex = 'MALE' then candidates end)   as male_c,
                 sum(case when sex = 'FEMALE' then candidates end) as female_c
            from fact_performance_exam
           group by jurisdiction_id, period_id, exam
        ) x
         where rows_n not in (1, 3)
            or (rows_n = 1 and all_c is null)
            or (rows_n = 3 and all_c is distinct from male_c + female_c)`;
      expect(badShape[0]!.n).toBe(0);
    } finally {
      await sql`delete from ref_waec_results_extract`;
      // ⚠ WITHDRAWING THE FEED DOES NOT DELETE WHAT IT PUBLISHED, and that is the bounded delete working:
      // the two WAEC-ONLY schools file no sitting, so once the extract is empty they are in NO delete
      // scope and keep their last good figures (stale-but-honest — the same rule a school that drops out
      // of the inclusion set gets). Removed explicitly here so the rest of the file sees the baseline.
      await sql`delete from fact_performance_exam where source = 'WAEC_EXTRACT'`;
      report = await runEtl();
    }
    // Restored: the school-entered split is back, because the WAEC row no longer supersedes it.
    const restored = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_performance_exam
       where source = 'WAEC_EXTRACT'`;
    expect(restored[0]!.n).toBe(0);
  }, 300_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the source seam, the allow-list and the inclusion set (criteria 14, 15, 16)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the source read is scoped, bounded and an ALLOW-LIST (criteria 14, 15)", () => {
  /** The two columns that must never cross the boundary. One is free text; one names a person. */
  const FORBIDDEN = ["note", "captured_by"];
  const ALLOWED = [
    "school_id",
    "exam_type",
    "year",
    "female_candidates",
    "male_candidates",
    "female_passed",
    "male_passed",
  ];

  it("CRITERION 14 · the read goes through the per-school seam and is bounded by the inclusion set", async () => {
    const operationalIds = (
      await sql<{ op: string }[]>`
        select r.operational_school_id::text as op from ref_emis_school_register r
         where r.on_schoolup and r.operational_school_id is not null
         order by r.emis_school_id limit 5`
    ).map((r) => r.op);
    const read = await readTerminalExamResults(sql, {
      schemaName: "demo_source",
      sittingYear: COHORT.sittingYear,
      operationalSchoolIds: operationalIds,
    });
    expect(read.rows.length).toBeGreaterThan(0);
    expect(read.rows.every((r) => operationalIds.includes(r.schoolId))).toBe(true);
    expect(read.rows.every((r) => r.year === COHORT.sittingYear)).toBe(true);

    // AN EMPTY ID SET READS ZERO ROWS — and does not issue an unbounded query. An unbounded read would
    // return schools the run cannot resolve to a jurisdiction node at all.
    expect(
      (
        await readTerminalExamResults(sql, {
          schemaName: "demo_source",
          sittingYear: COHORT.sittingYear,
          operationalSchoolIds: [],
        })
      ).rows,
    ).toEqual([]);
    // The seam is a PARAMETER, not a hard-coded schema: `demo_source` here, `public` on an
    // `oversight_etl` connection, with no change to the query.
    const query = sourceQueryText();
    expect(query).toContain("${sql(query.schemaName)}.terminal_exam_result");
    expect(query).toContain("= any(${query.operationalSchoolIds}::uuid[])");
  });

  it("CRITERION 15 · the reader SELECTs only the seven allow-listed columns, and never note/captured_by", () => {
    const code = stripComments(moduleText("lib/etl/performance-source.ts"));
    // Comments are stripped, not banned: the header documents the forbidden names on purpose, and a test
    // that banned the words outright would make the module undocumentable.
    for (const column of FORBIDDEN)
      expect(code).not.toMatch(new RegExp(`\\b${column}\\b`));
    expect(code).not.toContain("select *");
    for (const column of ALLOWED) expect(code).toContain(column);
  });

  it("CRITERION 15 · the demo stand-in does not even CARRY note/captured_by — the structural floor", async () => {
    const columns = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'demo_source' and table_name = 'terminal_exam_result'`;
    const names = columns.map((c) => c.column_name).sort();
    expect(names).toEqual([...ALLOWED, "id"].sort());
    for (const column of FORBIDDEN) expect(names).not.toContain(column);

    // Without this, the test above would pass just as well against a source that never had the columns,
    // and the claim "the allow-list excludes them" would be vacuous: the REAL table does carry both.
    const real = moduleText("../web/db/schema/terminal-results.ts");
    expect(real).toContain('text("note")');
    expect(real).toContain('uuid("captured_by")');

    // …and the fact table itself carries neither, nor anything else person-identifying.
    const factColumns = (
      await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'fact_performance_exam'`
    ).map((c) => c.column_name);
    for (const column of [...FORBIDDEN, "student", "name", "candidate_list"])
      expect(factColumns).not.toContain(column);
  });
});

describe("only inclusion-set schools produce rows (criterion 16)", () => {
  it("CRITERION 16 · a REGISTERED-BUT-NOT-LIVE school has a register row and a dim node but ZERO exam rows", async () => {
    const notLive = dataset.schools.filter((s) => !s.onSchoolup);
    expect(notLive.length).toBeGreaterThan(0);
    const ids = notLive.map((s) => s.emisSchoolId);
    const inRegister = await sql<{ n: number }[]>`
      select count(*)::int as n from ref_emis_school_register
       where emis_school_id = any(${ids}) and on_schoolup = false`;
    expect(inRegister[0]!.n).toBe(notLive.length);
    const inDim = await sql<{ n: number }[]>`
      select count(*)::int as n from dim_jurisdiction
       where level = 'SCHOOL' and ges_code = any(${ids}) and is_reporting = false`;
    expect(inDim[0]!.n).toBe(notLive.length);
    const facts = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_performance_exam f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where d.ges_code = any(${ids})`;
    expect(facts[0]!.n).toBe(0);
    // …and no sitting exists for them operationally either, which is WHY there is no fact row: the
    // coverage asymmetry (counted in the denominator, absent from the facts) rather than a silent drop.
    const sittings = await sql<{ n: number }[]>`
      select count(*)::int as n from demo_source.terminal_exam_result t
       where not exists (select 1 from ref_emis_school_register r
                          where r.operational_school_id = t.school_id and r.on_schoolup)`;
    expect(sittings[0]!.n).toBe(0);
  });

  it("every exam-presenting included school IS present, and every absent one is reported as such", async () => {
    const periodId = await cohortPeriodId(COHORT.sittingYear);
    const present = new Set(
      (
        await sql<{ emis: string }[]>`
          select distinct d.ges_code as emis from fact_performance_exam f
            join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
           where f.period_id = ${periodId}::uuid`
      ).map((r) => r.emis),
    );
    const shouldPresent = dataset.schools.filter(
      (s) => s.onSchoolup && examsPresentedBy(s.schoolType).length > 0,
    );
    expect(shouldPresent.length).toBeGreaterThan(200);
    expect(shouldPresent.every((s) => present.has(s.emisSchoolId))).toBe(true);
    // THE ACCOUNTING IDENTITY for this arm: computed + filed-nothing = the inclusion set, so no school
    // vanished quietly between the inclusion set and the facts.
    const cohort = report.examCohorts.find((c) => c.sittingYear === COHORT.sittingYear)!;
    expect(
      cohort.schoolsComputed + cohort.noResults.length + cohort.failures.length,
    ).toBe(report.coverage.included);
    expect(cohort.noResults.every((emis) => !present.has(emis))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the landmines: what these numbers are NOT (criteria 18, 19, 20, 21)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the landmines are encoded, not assumed (criteria 18, 19, 20, 21)", () => {
  it("CRITERION 18 · the slice does NOT reconcile candidates against fact_enrolment", async () => {
    // `candidates` is PRESENTED candidates, not final-year enrolment: absentees, withdrawals, repeaters
    // and private entries all move it away from any roll figure. So no module in this slice reads
    // fact_enrolment, and the gap is NOT treated as an anomaly.
    for (const module of ["lib/etl/performance.ts", "lib/etl/performance-source.ts"]) {
      const code = stripComments(moduleText(module));
      expect(code).not.toContain("fact_enrolment");
      expect(code).not.toContain("headcount");
    }
    // The documented statement is present where a reader will meet it.
    const header = moduleText("lib/etl/performance.ts");
    expect(header).toMatch(/NOT[\s*]+final-year enrolment/);
    expect(header).toMatch(/DOES NOT RECONCILE/);
    // And the gap really is there in the data — so a reader who DID reconcile would raise a false alarm
    // on an ordinary school. (JHS 3 roll vs BECE candidates, for a real school, both from the facts.)
    const periodId = await cohortPeriodId(COHORT.sittingYear);
    const annualPeriod = (
      await sql<{ period_id: string }[]>`
        select period_id::text as period_id from dim_period
         where academic_year = ${DEMO_TERMS[0]!.academicYear} and period_type = 'ANNUAL'`
    )[0]!.period_id;
    const gap = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select f.jurisdiction_id, f.candidates,
               (select e.headcount from fact_enrolment e
                 where e.jurisdiction_id = f.jurisdiction_id and e.period_id = ${annualPeriod}::uuid
                   and e.stage = 'JHS' and e.class_form = 'JHS3' and e.sex = 'ALL') as roll
          from fact_performance_exam f
         where f.period_id = ${periodId}::uuid and f.exam = 'BECE' and f.sex = 'ALL'
      ) x where roll is not null and roll <> candidates`;
    expect(gap[0]!.n).toBeGreaterThan(0); // normal, not an anomaly
    expect(report.status).toBe("SUCCESS"); // and the run does not care
  });

  it("CRITERION 19 · 'candidates − qualified' is documented as NOT 'failed', and no such column exists", async () => {
    const columns = (
      await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'fact_performance_exam'`
    ).map((c) => c.column_name);
    // There is deliberately NO failed / absent / withheld column: the source has no field for any of
    // them, so a column would have to be derived by subtraction — which is exactly the conflation.
    for (const column of ["failed", "absent", "withheld", "not_qualified"])
      expect(columns).not.toContain(column);
    expect(moduleText("lib/etl/performance.ts")).toMatch(
      /IS NOT "FAILED"[\s\S]*absent, whose results were withheld or cancelled/,
    );
    // The arithmetic really is a gap, not zero, on real data — so the label matters in practice.
    const notQualified = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_performance_exam
       where sex = 'ALL' and candidates > qualified`;
    expect(notQualified[0]!.n).toBeGreaterThan(0);
  });

  it("CRITERION 20 · SCHOOL_ENTERED is the REGULAR sitting only — no NovDec/private rows anywhere", async () => {
    // One row per (school, exam, year) is the whole source shape: there is no sitting-window column to
    // model, so NovDec and private-candidate figures are not representable rather than filtered out.
    const columns = (
      await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
         where table_schema = 'demo_source' and table_name = 'terminal_exam_result'`
    ).map((c) => c.column_name);
    for (const column of ["sitting", "series", "diet", "private_candidates", "novdec"])
      expect(columns).not.toContain(column);
    const perKey = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select school_id, exam_type, year from demo_source.terminal_exam_result
         group by school_id, exam_type, year having count(*) > 1
      ) d`;
    expect(perKey[0]!.n).toBe(0);
    const years = await sql<{ year: number }[]>`
      select distinct year from demo_source.terminal_exam_result order by year`;
    expect(years.map((y) => Number(y.year))).toEqual(
      DEMO_EXAM_COHORTS.map((c) => c.sittingYear),
    );
    expect(moduleText("lib/etl/performance.ts")).toMatch(
      /REGULAR MAY\/JUNE SITTING ONLY/,
    );
  });

  it("CRITERION 21 · a COMBINED school's BECE and WASSCE rows are DIFFERENT PUPILS, never one rate", async () => {
    const combined = dataset.schools.find(
      (s) => s.onSchoolup && s.schoolType === "COMBINED",
    )!;
    const periodId = await cohortPeriodId(COHORT.sittingYear);
    const rows = await sql<
      { exam: string; candidates: number; qualified: number; rate: string }[]
    >`
      select f.exam::text as exam, f.candidates, f.qualified, f.qualification_rate::text as rate
        from fact_performance_exam f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where d.ges_code = ${combined.emisSchoolId} and f.period_id = ${periodId}::uuid
         and f.sex = 'ALL' order by f.exam`;
    // BOTH exams, in the SAME sitting year, as SEPARATE rows with SEPARATE rates.
    expect(rows.map((r) => r.exam)).toEqual(["BECE", "WASSCE"]);
    for (const row of rows)
      expect(row.rate).toBe(
        qualificationRate(Number(row.qualified), Number(row.candidates)),
      );
    // The pooled rate a reader would get by forgetting the exam filter is NEITHER exam's rate — and it
    // describes a cohort that does not exist (JHS 3 leavers plus SHS 3 leavers).
    const pooledCandidates = rows.reduce((t, r) => t + Number(r.candidates), 0);
    const pooledQualified = rows.reduce((t, r) => t + Number(r.qualified), 0);
    const pooled = qualificationRate(pooledQualified, pooledCandidates);
    expect(rows.map((r) => r.rate)).not.toContain(pooled);
    // The reader rule, structurally: the source read GROUPS BY exam_type, so the two can never be summed
    // into one pair of counts upstream of the fact table either.
    expect(sourceQueryText()).toContain("group by t.school_id, t.exam_type, t.year");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the transform, in isolation (the per-school guards)
// ════════════════════════════════════════════════════════════════════════════════════════════════

const unitTarget = {
  jurisdictionId: "10000000-0000-4000-8000-000000000011",
  periodId: "20000000-0000-4000-8000-000000000003",
  emisSchoolId: "GH-TEST-0001",
  etlRunId: "30000000-0000-4000-8000-0000000000aa",
  asOfDate: "2026-06-26T00:00:00.000Z",
};

// `examType` is widened to `string` on purpose: the ALLOW-LIST is the transform's job, so a test must be
// able to hand it a value the operational CHECK would have refused.
function sourceRow(
  over: Omit<Partial<DemoTerminalExamRow>, "examType"> & { examType?: string } = {},
) {
  return {
    schoolId: "a1000000-0000-4000-8000-000000000001",
    examType: "BECE",
    year: 2026,
    femaleCandidates: 40,
    maleCandidates: 50,
    femalePassed: 30,
    malePassed: 35,
    ...over,
  };
}

/** Read a module's text, relative to the app root — the posture the enrolment suite uses. */
function moduleText(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

/** Block and line comments removed, so a documented name is not mistaken for a referenced one. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Just the SCHOOL_ENTERED reader's query text. */
function sourceQueryText(): string {
  const source = moduleText("lib/etl/performance-source.ts");
  return source.slice(source.indexOf("const rows = await sql"));
}

describe("the pure aggregation refuses what it cannot honestly aggregate", () => {
  it("aggregates a known sitting to known rows, ALL and rates included", () => {
    const result = aggregateSchoolSitting(
      [
        sourceRow({}),
        sourceRow({
          examType: "WASSCE",
          femaleCandidates: 10,
          maleCandidates: 10,
          femalePassed: 5,
          malePassed: 4,
        }),
      ],
      unitTarget,
    );
    expect(result.exams).toEqual(["BECE", "WASSCE"]);
    expect(
      result.rows.map(
        (r) => `${r.exam}/${r.sex}=${r.candidates}:${r.qualified}@${r.qualificationRate}`,
      ),
    ).toEqual([
      "BECE/MALE=50:35@70.00",
      "BECE/FEMALE=40:30@75.00",
      "BECE/ALL=90:65@72.22",
      "WASSCE/MALE=10:4@40.00",
      "WASSCE/FEMALE=10:5@50.00",
      "WASSCE/ALL=20:9@45.00",
    ]);
    // ALL's rate (72.22) is NOT the mean of 70.00 and 75.00 (72.50) — it is re-derived from ALL's counts.
    expect(result.rows.every((r) => r.source === "SCHOOL_ENTERED")).toBe(true);
    expect(result.rows.every((r) => r.asOfDate === unitTarget.asOfDate)).toBe(true);
    expect(result.candidates).toBe(110);
    expect(result.qualified).toBe(74);
  });

  it("refuses a negative, fractional or impossible count rather than publishing a rate above 100%", () => {
    expect(() =>
      aggregateSchoolSitting([sourceRow({ malePassed: -1 })], unitTarget),
    ).toThrow(/non-negative integer/);
    expect(() =>
      aggregateSchoolSitting([sourceRow({ femaleCandidates: 1.5 })], unitTarget),
    ).toThrow(/non-negative integer/);
    expect(() =>
      aggregateSchoolSitting([sourceRow({ malePassed: 51 })], unitTarget),
    ).toThrow(/exceeds male_candidates/);
    expect(() =>
      aggregateSchoolSitting([sourceRow({ femalePassed: 41 })], unitTarget),
    ).toThrow(/exceeds female_candidates/);
  });

  it("refuses a SECOND row for the same exam — it would double that cohort", () => {
    expect(() =>
      aggregateSchoolSitting([sourceRow({}), sourceRow({})], unitTarget),
    ).toThrow(/would double this cohort/);
  });

  it("the invariant checker catches a tampered ALL and a stale rate", () => {
    const good = aggregateSchoolSitting([sourceRow({})], unitTarget);
    expect(() => assertSchoolExamInvariants(good, "GH-TEST-0001")).not.toThrow();

    const brokenTotal = {
      ...good,
      rows: good.rows.map((r) =>
        r.sex === "ALL"
          ? {
              ...r,
              candidates: r.candidates + 1,
              qualificationRate: qualificationRate(r.qualified, r.candidates + 1),
            }
          : r,
      ),
    };
    expect(() => assertSchoolExamInvariants(brokenTotal, "GH-TEST-0001")).toThrow(
      /candidates\(ALL\)=91 but MALE\+FEMALE=90/,
    );

    const brokenQualified = {
      ...good,
      rows: good.rows.map((r) =>
        r.sex === "ALL"
          ? {
              ...r,
              qualified: r.qualified + 2,
              qualificationRate: qualificationRate(r.qualified + 2, r.candidates),
            }
          : r,
      ),
    };
    expect(() => assertSchoolExamInvariants(brokenQualified, "GH-TEST-0001")).toThrow(
      /qualified\(ALL\)=67 but MALE\+FEMALE=65/,
    );

    // THE INTERESTING TAMPER: an AVERAGED rate on the ALL row. Both counts are untouched, so only the
    // re-derivation check can catch it — and this is exactly the mistake the ruling forbids.
    const averaged = {
      ...good,
      rows: good.rows.map((r) =>
        r.sex === "ALL" ? { ...r, qualificationRate: "72.50" } : r,
      ),
    };
    expect(() => assertSchoolExamInvariants(averaged, "GH-TEST-0001")).toThrow(
      /never summed and never averaged/,
    );
  });

  it("a WAEC ALL-ONLY cohort satisfies the strict equality VACUOUSLY, and half a split does not", () => {
    // The per-cohort precedence ruling's other half: a WAEC cohort has no MALE/FEMALE rows at all, so the
    // invariant must not demand a split — it must hold vacuously. (And `ALL` is still never optional.)
    const waecOnly = waecExtractFactRows(
      [
        {
          emisSchoolId: "GH-TEST-0001",
          academicYear: "2025/26",
          exam: "BECE",
          candidates: 200,
          qualified: 150,
          asOfDate: "2026-08-01",
        },
      ],
      {
        periodId: unitTarget.periodId,
        etlRunId: unitTarget.etlRunId,
        asOfDate: unitTarget.asOfDate,
        jurisdictionOf: () => unitTarget.jurisdictionId,
      },
    );
    const asResult = {
      rows: waecOnly,
      exams: ["BECE" as const],
      candidates: 200,
      qualified: 150,
    };
    expect(() => assertSchoolExamInvariants(asResult, "GH-TEST-0001")).not.toThrow();

    // HALF a split is neither legal shape, and is a defect in the transform rather than a source state.
    const half = aggregateSchoolSitting([sourceRow({})], unitTarget);
    expect(() =>
      assertSchoolExamInvariants(
        { ...half, rows: half.rows.filter((r) => r.sex !== "FEMALE") },
        "GH-TEST-0001",
      ),
    ).toThrow(/written as a WHOLE or not at all/);
    // …and a cohort with NO total at all is refused outright.
    expect(() =>
      assertSchoolExamInvariants(
        { ...half, rows: half.rows.filter((r) => r.sex !== "ALL") },
        "GH-TEST-0001",
      ),
    ).toThrow(/no sex='ALL' row/);
  });

  it("the seeded-period assertion names the fix, and passes once the period exists", async () => {
    await expect(
      assertExamCohortPeriodsSeeded(sql, [2026, 2025], examCohortAcademicYear),
    ).resolves.toBeUndefined();
    await expect(
      assertExamCohortPeriodsSeeded(sql, [2031], examCohortAcademicYear),
    ).rejects.toThrow(/sitting year\(s\) 2031 \(academic_year "2030\/31"\)/);
    await expect(
      assertExamCohortPeriodsSeeded(sql, [2031], examCohortAcademicYear),
    ).rejects.toThrow(/examCohorts/);
    // An empty list is a clean no-op — there is nothing to resolve.
    await expect(
      assertExamCohortPeriodsSeeded(sql, [], examCohortAcademicYear),
    ).resolves.toBeUndefined();
  });

  it("an UNDECLARED run skips the arm cleanly and keeps the published sittings", async () => {
    // `examCohorts` omitted ⇒ zero rows, an EMPTY delete scope, and nothing attempted — the same clean
    // no-op the enrolment arm takes when no academic year is current. It must NOT empty a published
    // sitting, and it must NOT fail.
    const before = await fingerprint();
    const countBefore = await rowCount();
    const run = await runOversightEtl(sql, {
      emisExtractText: extractText(dataset),
      periods: periodsOption(),
      sourceSchema: "demo_source",
    });
    expect(run.status).toBe("SUCCESS");
    expect(run.examCohorts).toEqual([]);
    expect(await rowCount()).toBe(countBefore);
    expect(await fingerprint()).toBe(before);
    report = await runEtl();
  }, 300_000);
});
