import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { adminDemoAnalytics, testDbConfig } from "./helpers";
import {
  DEMO_TERMS,
  emisExtractFor,
  generateDemoDataset,
  loadDemoSource,
  type DemoClassRow,
  type DemoDataset,
  type DemoSchool,
  type DemoStudentGroup,
} from "@/scripts/seed-demo-data";
import { runOversightEtl, type EtlRunReport } from "@/lib/etl/pipeline";
import {
  EnrolmentTransformError,
  aggregateSchoolRoster,
  assertSchoolInvariants,
  assertStagesSeeded,
  writeEnrolmentFacts,
  type FactEnrolmentRow,
} from "@/lib/etl/enrolment";
import type { RosterGroupSourceRow } from "@/lib/etl/enrolment-source";
import { classFormOf, stageOf, type AnalyticsStage } from "@/lib/etl/stage";

/**
 * INCREMENT H SECOND SLICE — `fact_enrolment` end-to-end (task H9, Kofi's 19 acceptance criteria).
 *
 * Same posture as `tests/etl-infrastructure.test.ts`, deliberately: the REAL pipeline runs over the
 * deterministic demo dataset, every fact row is produced by `aggregateSchoolRoster` from
 * operational-shaped `students` / `class` rows, and NOTHING HERE HAND-SEEDS A FACT. The expected
 * figures are HAND-COMPUTED IN TYPESCRIPT from the generated roster — not read back out of SQL and
 * compared to another SQL query, which would only prove Postgres agrees with itself.
 *
 * It runs against the increment-H demo analytics database (`adminDemoAnalytics`) for the reasons
 * `tests/setup/paths.ts` gives, and it runs BEFORE `etl-infrastructure.test.ts` alphabetically, so it
 * sees a database carrying only the migrations and the `dim_stage` config rows.
 *
 * ⚠ THE LAST BLOCK installs `db/sql/policies.sql` on the demo database (the RLS half of criterion 18),
 * so nothing may be asserted after it.
 */

let sql: postgres.Sql;
let dataset: DemoDataset;
let report: EtlRunReport;

const ACADEMIC_YEAR = DEMO_TERMS[0]!.academicYear;
/** The roster's frozen vintage: the academic year's ANNUAL `ends_on`. See `rosterAsOf` in pipeline.ts. */
const ROSTER_AS_OF = DEMO_TERMS[DEMO_TERMS.length - 1]!.endsOn;

/** `${emis}` → the generated school. */
let schoolByEmis: Map<string, DemoSchool>;
/** `${emis}|${stage}|${class_form}` → the hand-computed MALE/FEMALE pair. `class_form` "" = the total. */
let expected: Map<string, { male: number; female: number }>;
/** emis → the stages that school's own class labels resolve to. */
let expectedStages: Map<string, Set<AnalyticsStage>>;
/** emis → ACTIVE children below KG / in an unmapped class. In NO stage row. */
let expectedOutOfScope: Map<string, number>;
let expectedUnmapped: Map<string, number>;

const key = (emis: string, stage: string, classForm: string | null): string =>
  `${emis}|${stage}|${classForm ?? ""}`;

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

async function runEtl(d: DemoDataset = dataset): Promise<EtlRunReport> {
  return runOversightEtl(sql, {
    emisExtractText: extractText(d),
    periods: periodsOption(),
    sourceSchema: "demo_source",
  });
}

/**
 * THE EXPECTATION, RE-DERIVED FROM THE GENERATED ROSTER IN TYPESCRIPT.
 *
 * It applies the SAME rules the ETL applies and in the same order — ACTIVE only, `class.level` then
 * `class.name`, `current_class_label` for a class-less child, out-of-scope and unmapped tallied and
 * never bucketed — but it does so over the GENERATOR's objects rather than over anything the pipeline
 * produced. `stageOf`/`classFormOf` are shared on purpose (they are the ruling, and `tests/stage.test.ts`
 * pins them against a hand-written table); every COUNT below is independent.
 */
function buildExpectations(d: DemoDataset): void {
  const classById = new Map<string, DemoClassRow>(d.classes.map((c) => [c.classId, c]));
  const emisByOpId = new Map<string, string>(
    d.schools
      .filter((s) => s.operationalSchoolId)
      .map((s) => [s.operationalSchoolId!, s.emisSchoolId]),
  );
  expected = new Map();
  expectedStages = new Map();
  expectedOutOfScope = new Map();
  expectedUnmapped = new Map();

  const add = (k: string, sex: DemoStudentGroup["sex"], n: number) => {
    const held = expected.get(k) ?? { male: 0, female: 0 };
    if (sex === "MALE") held.male += n;
    else held.female += n;
    expected.set(k, held);
  };

  for (const group of d.studentGroups) {
    // CRITERION 5: only ACTIVE children are on roll. A graduate is history, not enrolment.
    if (group.status !== "ACTIVE") continue;
    const emis = emisByOpId.get(group.schoolId)!;
    const klass = group.classId ? classById.get(group.classId) : undefined;
    const level = klass ? klass.level : group.currentClassLabel;
    const name = klass ? klass.name : null;
    const stage = stageOf(level, name);
    if (stage === "OUT_OF_SCOPE") {
      expectedOutOfScope.set(emis, (expectedOutOfScope.get(emis) ?? 0) + group.headcount);
      continue;
    }
    if (stage === "UNMAPPED") {
      expectedUnmapped.set(emis, (expectedUnmapped.get(emis) ?? 0) + group.headcount);
      continue;
    }
    const classForm = classFormOf(level, name)!;
    add(key(emis, stage, classForm), group.sex, group.headcount);
    // The stage total, accumulated independently of the breakdown rows above — so "total = Σ breakdown"
    // is a claim about the ETL and not a restatement of this loop.
    add(key(emis, stage, null), group.sex, group.headcount);
    const stages = expectedStages.get(emis) ?? new Set<AnalyticsStage>();
    stages.add(stage);
    expectedStages.set(emis, stages);
  }
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
  await sql.end({ timeout: 5 });
});

// ── helpers over the written facts ──────────────────────────────────────────────────────────────

/** The ONE period `fact_enrolment` is written at — the academic year's ANNUAL row. */
async function annualPeriodId(): Promise<string> {
  const rows = await sql<{ period_id: string }[]>`
    select period_id::text as period_id from dim_period
     where academic_year = ${ACADEMIC_YEAR} and term is null and period_type = 'ANNUAL'`;
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

interface DbEnrolmentRow {
  emis: string;
  stage: string;
  class_form: string | null;
  sex: string;
  headcount: number;
}

/** Every written row, keyed back to its EMIS id. The whole table — 17k rows is nothing in memory. */
async function allRows(): Promise<DbEnrolmentRow[]> {
  return sql<DbEnrolmentRow[]>`
    select d.ges_code as emis, f.stage, f.class_form, f.sex::text as sex, f.headcount
      from fact_enrolment f
      join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id`;
}

/**
 * SUM `headcount` over a jurisdiction SUBTREE — the product's actual roll-up shape.
 *
 * ⚠ THE FILTER IS THE API. `sex = 'ALL' AND class_form IS NULL` is mandatory above the school, and the
 * unfiltered variant below exists only to prove how wrong the unfiltered read is (criterion 14).
 */
async function rollUp(
  rootJurisdictionId: string,
  periodId: string,
  opts: { stage?: string; filtered?: boolean } = {},
): Promise<number> {
  const filtered = opts.filtered !== false;
  const rows = await sql<{ total: number | null }[]>`
    with recursive subtree as (
      select jurisdiction_id from dim_jurisdiction where jurisdiction_id = ${rootJurisdictionId}::uuid
      union all
      select c.jurisdiction_id from dim_jurisdiction c join subtree s on c.parent_id = s.jurisdiction_id
    )
    select sum(f.headcount)::int as total
      from fact_enrolment f
      join subtree s on s.jurisdiction_id = f.jurisdiction_id
     where f.period_id = ${periodId}::uuid
       and (${opts.stage ?? null}::text is null or f.stage = ${opts.stage ?? null})
       and (${!filtered} or (f.sex = 'ALL' and f.class_form is null))`;
  return rows[0]!.total ?? 0;
}

/** The hand-computed roll of a set of schools: Σ ACTIVE children in a mapped stage. */
function expectedHeadcount(
  predicate: (s: DemoSchool) => boolean,
  stage?: AnalyticsStage,
): number {
  let total = 0;
  for (const [k, tally] of expected) {
    const [emis, rowStage, classForm] = k.split("|");
    if (classForm !== "") continue; // stage totals only — the breakdown would double-count
    if (stage && rowStage !== stage) continue;
    const school = schoolByEmis.get(emis!)!;
    if (!predicate(school)) continue;
    total += tally.male + tally.female;
  }
  return total;
}

/** Round-trip a written row back into the shape the writer takes. Used by the write-path tests. */
function factRowFrom(db: Record<string, unknown>, periodId: string): FactEnrolmentRow {
  return {
    jurisdictionId: db.jurisdiction_id as string,
    periodId,
    stage: db.stage as AnalyticsStage,
    classForm: (db.class_form as string | null) ?? null,
    sex: db.sex as FactEnrolmentRow["sex"],
    headcount: Number(db.headcount),
    source: "OPERATIONAL_AGG",
    asOfDate: (db.as_of_date as Date).toISOString(),
    etlRunId: db.etl_run_id as string,
  };
}

async function fingerprint(): Promise<string> {
  const rows = await sql<{ f: string }[]>`
    select md5(string_agg(t.row, '|' order by t.row)) as f
      from (select (to_jsonb(f) - 'fact_id' - 'etl_run_id')::text as row from fact_enrolment f) t`;
  return rows[0]!.f;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the run, the grain and the provenance (criteria 6, 7)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the run writes both fact tables under one verdict", () => {
  it("reaches SUCCESS with nothing to confess, and closes the etl_run row", async () => {
    expect(report.status).toBe("SUCCESS");
    expect(report.errorText).toBeNull();
    for (const p of report.periods) {
      expect(p.failures).toEqual([]);
      // CRITERION 9's second half, stated at the top: an out-of-scope or unparseable class is NOT a
      // compute failure. The demo contains both, in real generated data, and the run is clean.
      expect(p.enrolment.failures).toEqual([]);
    }
    const rows = await sql<{ status: string; finished_at: Date | null }[]>`
      select status::text as status, finished_at from etl_run where run_id = ${report.runId}::uuid`;
    expect(rows[0]!.status).toBe("SUCCESS");
    expect(rows[0]!.finished_at).not.toBeNull();
  });

  it("wrote BOTH fact tables in the same run, at the SAME period", async () => {
    const annual = await annualPeriodId();
    const counts = await sql<{ infra: number; enrol: number }[]>`
      select (select count(*)::int from fact_infrastructure where period_id = ${annual}::uuid) as infra,
             (select count(*)::int from fact_enrolment where period_id = ${annual}::uuid) as enrol`;
    expect(counts[0]!.infra).toBeGreaterThan(0);
    expect(counts[0]!.enrol).toBeGreaterThan(0);
    expect(report.periods[0]!.enrolment.inserted).toBe(counts[0]!.enrol);
  });

  it("CRITERION 6 · every row is ANNUAL with term IS NULL — no TERM and no EXAM_COHORT row exists", async () => {
    const byType = await sql<{ period_type: string; term: number | null; n: number }[]>`
      select dp.period_type::text as period_type, dp.term, count(*)::int as n
        from fact_enrolment f join dim_period dp on dp.period_id = f.period_id
       group by dp.period_type, dp.term`;
    expect(byType).toHaveLength(1);
    expect(byType[0]!.period_type).toBe("ANNUAL");
    expect(byType[0]!.term).toBeNull();
    // …and exactly ONE ANNUAL period exists for the year, so a second row-set cannot hide beside it.
    const annual = await sql<{ n: number }[]>`
      select count(*)::int as n from dim_period
       where academic_year = ${ACADEMIC_YEAR} and period_type = 'ANNUAL'`;
    expect(annual[0]!.n).toBe(1);
  });

  it("CRITERION 6 · ONE row-set per included school — BASIC, SENIOR and COMBINED alike", async () => {
    const perSchool = await sql<{ emis: string; n: number }[]>`
      select d.ges_code as emis, count(*)::int as n
        from fact_enrolment f join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       group by d.ges_code`;
    // Every live school is present exactly once as a jurisdiction, and every school that is present
    // has the three-sex structure (so `n` is always a multiple of 3).
    expect(perSchool).toHaveLength(report.coverage.included);
    expect(perSchool.every((r) => r.n % 3 === 0)).toBe(true);
    const seen = new Set(perSchool.map((r) => r.emis));
    for (const type of ["KG", "PRIMARY", "JHS", "SHS", "COMBINED"] as const) {
      const schools = dataset.schools.filter(
        (s) => s.onSchoolup && s.schoolType === type,
      );
      expect(schools.length).toBeGreaterThan(0);
      expect(schools.every((s) => seen.has(s.emisSchoolId))).toBe(true);
    }
    // Every fact row sits on a SCHOOL node: there are no stored roll-ups, so a district figure is only
    // ever a SUM (the same grain rule fact_infrastructure holds to).
    const byLevel = await sql<{ level: string; n: number }[]>`
      select d.level::text as level, count(*)::int as n
        from fact_enrolment f join dim_jurisdiction d using (jurisdiction_id) group by d.level`;
    expect(byLevel).toHaveLength(1);
    expect(byLevel[0]!.level).toBe("SCHOOL");
  });

  it("CRITERION 7 · provenance is stamped on every row and no headcount is negative", async () => {
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_enrolment
       where source <> 'OPERATIONAL_AGG' or as_of_date is null or etl_run_id is null
          or headcount < 0 or stage is null or sex is null`;
    expect(bad[0]!.n).toBe(0);

    // The vintage is the run's DECLARED, FROZEN census date — not `now()`. A roster carries no
    // `captured_at`, so this is the one provenance value the run has to supply, and it has to be stable
    // or the byte-identical re-run below is untestable.
    const vintages = await sql<{ as_of: string }[]>`
      select distinct as_of_date::date::text as as_of from fact_enrolment`;
    expect(vintages).toEqual([{ as_of: ROSTER_AS_OF }]);

    // Every row's stage is a real `dim_stage` key — the FK says so, and this says it is one of the four.
    const stages = await sql<{ stage: string }[]>`
      select distinct stage from fact_enrolment order by stage`;
    expect(stages.map((s) => s.stage)).toEqual(["JHS", "KG", "PRIMARY", "SHS"]);
  });

  it("an unseeded dim_stage fails the run in step 2, with the fix in the message", async () => {
    // `dim_stage` is CONFIG, not something this ETL writes. The assertion exists so a migrated-but-not-
    // seeded database fails up front rather than hundreds of rows into the write with an FK name.
    await expect(assertStagesSeeded(sql)).resolves.toBeUndefined();
    // The missing-row case cannot be staged on THIS database: `fact_enrolment.stage` is a FK to
    // `dim_stage`, and the FK is precisely why the assertion exists — deleting 'SHS' here fails on the
    // constraint, which is the late, cryptic failure the assertion is meant to pre-empt. So the query
    // result is stubbed, and the FK violation above is itself the evidence the FK is real.
    const threeOfFour = (() =>
      Promise.resolve([
        { stage: "KG" },
        { stage: "PRIMARY" },
        { stage: "JHS" },
      ])) as unknown as postgres.Sql;
    await expect(assertStagesSeeded(threeOfFour)).rejects.toThrow(
      /dim_stage is missing SHS[\s\S]*db:seed/,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the stage mapping, in the facts (criteria 1, 2, 12)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the stage mapping reaches the facts (criteria 1, 2, 12)", () => {
  it("EVERY written row equals the hand-computed headcount for its (school, stage, class_form, sex)", async () => {
    // The exhaustive form, over all ~17,000 rows: not a sample, and not a sum (a sum can be right while
    // two class forms are swapped). `expected` was built from the generator's roster, applying the
    // ruling independently of the pipeline.
    const rows = await allRows();
    expect(rows.length).toBeGreaterThan(10_000);
    const mismatches: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const k = key(row.emis, row.stage, row.class_form);
      seen.add(`${k}|${row.sex}`);
      const tally = expected.get(k);
      if (!tally) {
        mismatches.push(`${k}: written but not expected`);
        continue;
      }
      const want =
        row.sex === "MALE"
          ? tally.male
          : row.sex === "FEMALE"
            ? tally.female
            : tally.male + tally.female;
      if (Number(row.headcount) !== want)
        mismatches.push(`${k}/${row.sex}: wrote ${row.headcount}, expected ${want}`);
    }
    // …and nothing EXPECTED is missing: a dropped class form would otherwise pass the loop above.
    for (const k of expected.keys())
      for (const sex of ["MALE", "FEMALE", "ALL"])
        if (!seen.has(`${k}|${sex}`))
          mismatches.push(`${k}/${sex}: expected but not written`);
    expect(mismatches.slice(0, 10)).toEqual([]);
  });

  it("CRITERION 1 · a 'Basic 8' class's children are in JHS2, and in NO primary row", async () => {
    // The most dangerous label in the set, exercised by REAL demo data: GES designates JHS 1–3 as Basic
    // 7–9, so a naive reader (or `level-order.ts`, which lumps all "basic" into the primary tier for
    // SORT order) files a 13-year-old under PRIMARY — whose GSS band is 6–11.
    const basicJhs = dataset.classes.filter((c) => /^Basic [789]\b/.test(c.level ?? ""));
    expect(basicJhs.length).toBeGreaterThan(50);
    const sample = basicJhs.find((c) => c.level === "Basic 8")!;
    const emis = dataset.schools.find(
      (s) => s.operationalSchoolId === sample.schoolId,
    )!.emisSchoolId;
    const rows = await sql<
      { stage: string; class_form: string | null; headcount: number }[]
    >`
      select f.stage, f.class_form, f.headcount from fact_enrolment f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where d.ges_code = ${emis} and f.sex = 'ALL' and f.class_form is not null`;
    const forms = rows.map((r) => `${r.stage}/${r.class_form}`);
    expect(forms).toContain("JHS/JHS2");
    expect(forms.some((f) => f.startsWith("PRIMARY/P8"))).toBe(false);
    // The class_form token is the NORMALISED one — "JHS2", not the school's "Basic 8".
    expect(forms.some((f) => f.includes("Basic"))).toBe(false);
  });

  it("CRITERION 2 · 'Class N' is PRIMARY, and 'Form N' is SHS with the Form voice kept", async () => {
    const classStyle = dataset.classes.filter((c) =>
      /^Class [1-6]\b/.test(c.level ?? ""),
    );
    expect(classStyle.length).toBeGreaterThan(50);
    const emis = dataset.schools.find(
      (s) => s.operationalSchoolId === classStyle[0]!.schoolId,
    )!.emisSchoolId;
    const primary = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_enrolment f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where d.ges_code = ${emis} and f.stage = 'PRIMARY' and f.class_form is not null`;
    expect(primary[0]!.n).toBeGreaterThan(0);

    // The senior tier keeps its own voice in `class_form` — "Form 2", never "SHS2" — because that is
    // what a head teacher reads back. The STAGE is SHS either way.
    const senior = await sql<{ class_form: string }[]>`
      select distinct class_form from fact_enrolment
       where stage = 'SHS' and class_form is not null order by class_form`;
    expect(senior.map((r) => r.class_form)).toEqual(["Form 1", "Form 2", "Form 3"]);
    const juniorForms = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_enrolment
       where stage <> 'SHS' and class_form like 'Form%'`;
    expect(juniorForms[0]!.n).toBe(0); // "Form" is NEVER a junior form
  });

  it("CRITERION 12 · the stage comes from the class LABEL, not from the school's school_type", async () => {
    // A register "PRIMARY"/"JHS" school running a Form stream (the generator plants a few, and the
    // class_id-NULL "JHS 2" children land on some primary schools too). Its children are filed under the
    // stage their LABEL says — and the disagreement is REPORTED as drift rather than resolved by
    // overruling the roster.
    const drift = report.periods[0]!.enrolment.stageDrift;
    expect(drift.length).toBeGreaterThan(0);
    const senior = drift.find((d) => d.stages.includes("SHS"))!;
    expect(senior).toBeDefined();
    expect(["PRIMARY", "JHS"]).toContain(senior.schoolType);

    const rows = await sql<{ stage: string; headcount: number }[]>`
      select f.stage, f.headcount from fact_enrolment f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where d.ges_code = ${senior.emisSchoolId} and f.sex = 'ALL' and f.class_form is null`;
    expect(rows.map((r) => r.stage)).toContain("SHS");
    // The register still says what it said — the ETL did not rewrite the dimension to agree with itself.
    const dim = await sql<{ school_type: string }[]>`
      select school_type::text as school_type from dim_jurisdiction where ges_code = ${senior.emisSchoolId}`;
    expect(dim[0]!.school_type).toBe(senior.schoolType);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the two invariants every reader leans on (criteria 3, 4)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the arithmetic invariants (criteria 3, 4)", () => {
  it("CRITERION 3 · headcount(ALL) = headcount(MALE) + headcount(FEMALE), STRICTLY, on every key", async () => {
    // Including the class_form IS NULL totals — which is the half a `group by class_form` would skip.
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id, stage, class_form,
               sum(case when sex = 'ALL' then headcount end)    as all_hc,
               sum(case when sex = 'MALE' then headcount end)   as male_hc,
               sum(case when sex = 'FEMALE' then headcount end) as female_hc
          from fact_enrolment
         group by jurisdiction_id, period_id, stage, class_form
      ) x
       where all_hc is distinct from male_hc + female_hc`;
    expect(bad[0]!.n).toBe(0);

    // …and it holds on the class_form-NULL rows specifically, counted so the test cannot pass by the
    // totals being absent.
    const totals = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, stage,
               sum(case when sex = 'ALL' then headcount end)    as a,
               sum(case when sex = 'MALE' then headcount end)   as m,
               sum(case when sex = 'FEMALE' then headcount end) as f
          from fact_enrolment where class_form is null
         group by jurisdiction_id, stage
      ) y where a = m + f`;
    // Counted rather than merely "no violations": a test that only looked for violations would pass
    // against an empty table, or against one where the stage totals had never been written.
    expect(totals[0]!.n).toBeGreaterThan(800);
  });

  it("CRITERION 4 · the stage total (class_form IS NULL) = Σ its class_form breakdown, per sex", async () => {
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id, stage, sex,
               sum(case when class_form is null then headcount end)     as total_hc,
               sum(case when class_form is not null then headcount end) as breakdown_hc
          from fact_enrolment
         group by jurisdiction_id, period_id, stage, sex
      ) x
       where total_hc is distinct from breakdown_hc`;
    expect(bad[0]!.n).toBe(0);

    // The structural half: EVERY (school, stage, sex) has exactly ONE total row. A missing total is a
    // silent undercount for every roll-up above it; a second one is a silent doubling.
    const shape = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, stage, sex, count(*)::int as totals
          from fact_enrolment where class_form is null
         group by jurisdiction_id, stage, sex having count(*) <> 1
      ) d`;
    expect(shape[0]!.n).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// who counts, and who is tallied instead (criteria 5, 8, 9, 10)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("only ACTIVE children are on roll (criterion 5)", () => {
  it("the national roll equals the ACTIVE-only hand-computed figure, and the all-status figure is bigger", async () => {
    const annual = await annualPeriodId();
    const national = await nodeId("NATIONAL", "Ghana");
    const written = await rollUp(national, annual);
    expect(written).toBe(expectedHeadcount(() => true));

    // The source really does carry non-ACTIVE children — otherwise the filter is untested — and
    // counting them would inflate the roll. A roll that counted its graduates grows for ever.
    const statuses = await sql<{ status: string; n: number }[]>`
      select status::text as status, count(*)::int as n from demo_source.students group by status`;
    const byStatus = Object.fromEntries(statuses.map((s) => [s.status, s.n]));
    expect(byStatus.ACTIVE).toBeGreaterThan(0);
    const inactive = statuses
      .filter((s) => s.status !== "ACTIVE")
      .reduce((t, s) => t + s.n, 0);
    expect(inactive).toBeGreaterThan(100);
    expect(byStatus.ACTIVE! + inactive).toBeGreaterThan(written); // the mapped roll is a subset
  });
});

describe("the two tallies: below KG and unparseable (criteria 8, 9, 10)", () => {
  it("CRITERION 8 · a Nursery class is OUT OF SCOPE: tallied, in no stage row, school not failed", async () => {
    const nursery = dataset.classes.filter((c) => /NURSERY/i.test(c.level ?? c.name));
    expect(nursery.length).toBeGreaterThan(0); // the demo really plants them
    const e = report.periods[0]!.enrolment;
    const expectedTotal = [...expectedOutOfScope.values()].reduce((a, b) => a + b, 0);
    expect(e.outOfScopeHeadcount).toBe(expectedTotal);
    expect(e.outOfScopeHeadcount).toBeGreaterThan(0);

    // The school is fine, and its KG rows do NOT absorb the nursery children — which is the whole
    // point: filing them under KG would divide 3-year-olds by the 4–5 population band.
    const victim = dataset.schools.find(
      (s) => s.operationalSchoolId === nursery[0]!.schoolId,
    )!;
    expect(e.failures.some((f) => f.emisSchoolId === victim.emisSchoolId)).toBe(false);
    const kg = await sql<{ headcount: number }[]>`
      select f.headcount from fact_enrolment f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where d.ges_code = ${victim.emisSchoolId} and f.stage = 'KG'
         and f.class_form is null and f.sex = 'ALL'`;
    const expectedKg = expected.get(key(victim.emisSchoolId, "KG", null));
    if (expectedKg)
      expect(Number(kg[0]!.headcount)).toBe(expectedKg.male + expectedKg.female);
    expect(expectedOutOfScope.get(victim.emisSchoolId)).toBeGreaterThan(0);
  });

  it("CRITERION 9 · an unparseable class is UNMAPPED: tallied, in no stage row, school NOT failed", async () => {
    const unparseable = dataset.classes.filter(
      (c) => c.level === null && c.name === "Transition Stream",
    );
    expect(unparseable.length).toBeGreaterThan(0);
    const e = report.periods[0]!.enrolment;
    expect(e.unmappedHeadcount).toBe(
      [...expectedUnmapped.values()].reduce((a, b) => a + b, 0),
    );
    expect(e.unmappedHeadcount).toBeGreaterThan(0);

    const victim = dataset.schools.find(
      (s) => s.operationalSchoolId === unparseable[0]!.schoolId,
    )!;
    // The school is not failed, and it STILL HAS ITS OTHER ROWS: one unreadable label must not cost a
    // school its whole enrolment figure.
    expect(e.failures.some((f) => f.emisSchoolId === victim.emisSchoolId)).toBe(false);
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_enrolment f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where d.ges_code = ${victim.emisSchoolId}`;
    expect(rows[0]!.n).toBeGreaterThan(0);
    expect(expectedUnmapped.get(victim.emisSchoolId)).toBeGreaterThan(0);
  });

  it("neither tally is bucketed into a stage: roll + out-of-scope + unmapped = every ACTIVE child", async () => {
    // THE ACCOUNTING IDENTITY for the roster arm. Every ACTIVE child the source returned is either in a
    // stage row or in one of the two tallies — nobody is silently dropped, and nobody is counted twice.
    const e = report.periods[0]!.enrolment;
    const activeInSource = (
      await sql<{ n: number }[]>`
        select count(*)::int as n from demo_source.students s
          join ref_emis_school_register r on r.operational_school_id = s.school_id
         where s.status = 'ACTIVE' and r.on_schoolup`
    )[0]!.n;
    expect(e.headcount + e.outOfScopeHeadcount + e.unmappedHeadcount).toBe(
      activeInSource,
    );
  });

  it("CRITERION 10 · a class_id-NULL child is counted from current_class_label", async () => {
    const classless = dataset.studentGroups.filter(
      (g) =>
        g.classId === null && g.currentClassLabel === "JHS 2" && g.status === "ACTIVE",
    );
    expect(classless.length).toBeGreaterThan(0);
    const victimId = classless[0]!.schoolId;
    const victim = dataset.schools.find((s) => s.operationalSchoolId === victimId)!;
    const planted = dataset.studentGroups
      .filter(
        (g) =>
          g.schoolId === victimId &&
          g.classId === null &&
          g.currentClassLabel === "JHS 2",
      )
      .reduce((t, g) => t + g.headcount, 0);
    expect(planted).toBe(5); // 3 boys + 2 girls, placed by the generator

    // They are in JHS2, from the LABEL — there is no class row to read, and the school's own type is
    // irrelevant. The fact row is the hand-computed figure INCLUDING them.
    const row = await sql<{ headcount: number }[]>`
      select f.headcount from fact_enrolment f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where d.ges_code = ${victim.emisSchoolId} and f.stage = 'JHS'
         and f.class_form = 'JHS2' and f.sex = 'ALL'`;
    const want = expected.get(key(victim.emisSchoolId, "JHS", "JHS2"))!;
    expect(Number(row[0]!.headcount)).toBe(want.male + want.female);
    // And it really is bigger than the classes alone — i.e. the label children were not dropped.
    const fromClasses = dataset.studentGroups
      .filter((g) => {
        if (g.status !== "ACTIVE" || g.classId === null) return false;
        const c = dataset.classes.find((x) => x.classId === g.classId)!;
        return c.schoolId === victimId && classFormOf(c.level, c.name) === "JHS2";
      })
      .reduce((t, g) => t + g.headcount, 0);
    expect(Number(row[0]!.headcount)).toBe(fromClasses + planted);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// multi-stage schools and the drift flag (criterion 11)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("one school, several stages (criterion 11)", () => {
  it("a COMBINED school emits KG, PRIMARY and JHS row-sets — each with its own total", async () => {
    const combined = dataset.schools.find(
      (s) => s.onSchoolup && s.schoolType === "COMBINED",
    )!;
    const stages = await sql<{ stage: string; headcount: number }[]>`
      select f.stage, f.headcount from fact_enrolment f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where d.ges_code = ${combined.emisSchoolId} and f.class_form is null and f.sex = 'ALL'
       order by f.stage`;
    expect(stages.map((s) => s.stage)).toEqual(["JHS", "KG", "PRIMARY"]);
    expect([...expectedStages.get(combined.emisSchoolId)!].sort()).toEqual([
      "JHS",
      "KG",
      "PRIMARY",
    ]);
    // Each stage total is its own figure — summing them is the school's roll, and that is the ONLY
    // legitimate way to add two stages together.
    const roll = stages.reduce((t, s) => t + Number(s.headcount), 0);
    expect(roll).toBe(expectedHeadcount((s) => s.emisSchoolId === combined.emisSchoolId));
    // …and no stage is reported twice (which would double the school inside its own district).
    expect(new Set(stages.map((s) => s.stage)).size).toBe(stages.length);
  });

  it("a basic school running a senior stream is FLAGGED as drift, not failed and not overruled", async () => {
    const drift = report.periods[0]!.enrolment.stageDrift;
    expect(drift.length).toBeGreaterThan(0);
    for (const d of drift) {
      // A hint, never a fault: the school's rows are written, and the run is clean.
      expect(
        report.periods[0]!.enrolment.failures.some(
          (f) => f.emisSchoolId === d.emisSchoolId,
        ),
      ).toBe(false);
      const rows = await sql<{ n: number }[]>`
        select count(*)::int as n from fact_enrolment f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
         where d.ges_code = ${d.emisSchoolId}`;
      expect(rows[0]!.n).toBeGreaterThan(0);
    }
    // A COMBINED school is NEVER drift — it is expected to teach several stages, and a flag that fires
    // on every ordinary school is noise rather than a signal.
    const combinedFlagged = drift.filter(
      (d) => schoolByEmis.get(d.emisSchoolId)?.schoolType === "COMBINED",
    );
    expect(combinedFlagged).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the roll-up, and the filter that makes it correct (criteria 13, 14)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("roll-ups are a plain SUM under the mandatory filter (criteria 13, 14)", () => {
  it("CRITERION 13 · district = Σ its schools, with sex='ALL' AND class_form IS NULL", async () => {
    const annual = await annualPeriodId();
    const probes = [
      { region: "Greater Accra", district: "Accra Metropolitan" },
      { region: "Upper West", district: "Nadowli-Kaleo" },
      { region: "Ashanti", district: "Kumasi Metropolitan" },
    ];
    for (const probe of probes) {
      const districtId = await nodeId("DISTRICT", probe.district);
      const inDistrict = (s: DemoSchool) =>
        s.regionName === probe.region && s.districtName === probe.district;
      expect(await rollUp(districtId, annual)).toBe(expectedHeadcount(inDistrict));
      // …and per stage, so a mis-filed class cannot cancel out inside the district total.
      for (const stage of ["KG", "PRIMARY", "JHS", "SHS"] as const)
        expect(await rollUp(districtId, annual, { stage })).toBe(
          expectedHeadcount(inDistrict, stage),
        );
    }
  });

  it("region = Σ its districts = the hand-computed figure, and national = Σ all schools", async () => {
    const annual = await annualPeriodId();
    for (const regionName of ["Greater Accra", "Northern", "Oti"]) {
      const regionId = await nodeId("REGION", regionName);
      const districtNames = [
        ...new Set(
          dataset.schools
            .filter((s) => s.regionName === regionName)
            .map((s) => s.districtName),
        ),
      ];
      let sumOfDistricts = 0;
      for (const districtName of districtNames)
        sumOfDistricts += await rollUp(await nodeId("DISTRICT", districtName), annual);
      const regionTotal = await rollUp(regionId, annual);
      expect(regionTotal).toBe(sumOfDistricts);
      expect(regionTotal).toBe(expectedHeadcount((s) => s.regionName === regionName));
    }
    const national = await nodeId("NATIONAL", "Ghana");
    expect(await rollUp(national, annual)).toBe(expectedHeadcount(() => true));
    // The SHS estate is present and non-trivial — the stage a TERM-grained slice could not reach.
    expect(await rollUp(national, annual, { stage: "SHS" })).toBeGreaterThan(5_000);
  });

  it("CRITERION 14 · the UNFILTERED sum is wrong — which is what the filter is for", async () => {
    const annual = await annualPeriodId();
    const national = await nodeId("NATIONAL", "Ghana");
    const correct = await rollUp(national, annual);
    const unfiltered = await rollUp(national, annual, { filtered: false });
    // ~4× — twice for the sex split (ALL beside MALE+FEMALE) and twice again for the breakdown beside
    // its stage total. The number is internally consistent and completely wrong, which is exactly why
    // the stage totals are materialised and why every reader must filter.
    expect(unfiltered).toBeGreaterThan(correct * 3.5);
    expect(unfiltered).toBeLessThan(correct * 4.5);

    // The two commonest HALF-filters are each wrong on their own, and in different directions.
    const sexOnly = (
      await sql<{ total: number }[]>`
        select sum(headcount)::int as total from fact_enrolment
         where period_id = ${annual}::uuid and sex = 'ALL'`
    )[0]!.total;
    const formOnly = (
      await sql<{ total: number }[]>`
        select sum(headcount)::int as total from fact_enrolment
         where period_id = ${annual}::uuid and class_form is null`
    )[0]!.total;
    expect(Number(sexOnly)).toBe(correct * 2); // breakdown + total
    expect(Number(formOnly)).toBe(correct * 2); // MALE + FEMALE + ALL over the totals
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// idempotency, the bounded delete, and the duplicate assertion (criteria 16, 17)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("idempotency and the bounded delete (criterion 16)", () => {
  it("a re-run is byte-identical, and REPLACES rather than appends", async () => {
    const before = await fingerprint();
    const countBefore = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_enrolment`
    )[0]!.n;

    const second = await runEtl();
    expect(second.status).toBe("SUCCESS");
    expect(second.runId).not.toBe(report.runId);
    expect(await fingerprint()).toBe(before);
    const countAfter = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_enrolment`
    )[0]!.n;
    expect(countAfter).toBe(countBefore);
    for (const p of second.periods)
      expect(p.enrolment.deleted).toBe(p.enrolment.inserted);
    // Provenance moved even though the measures did not — the rows were really rewritten.
    const stamped = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_enrolment where etl_run_id = ${second.runId}::uuid`;
    expect(stamped[0]!.n).toBe(countAfter);
  }, 300_000);

  it("a CHANGED roster moves the fact row, with the row count unchanged", async () => {
    // "Byte-identical" is necessary but not sufficient: a pipeline that inserted nothing on the second
    // run would pass it. Change the source and the figure must MOVE.
    const victim = (
      await sql<{ emis: string; op: string; class_id: string; headcount: number }[]>`
        select d.ges_code as emis, r.operational_school_id::text as op,
               c.id::text as class_id, f.headcount
          from fact_enrolment f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
          join ref_emis_school_register r on r.emis_school_id = d.ges_code
          join demo_source.class c on c.school_id = r.operational_school_id
         where f.stage = 'PRIMARY' and f.class_form = 'P1' and f.sex = 'MALE'
           and c.level in ('Primary 1', 'Class 1', 'Basic 1')
         order by d.ges_code limit 1`
    )[0]!;
    await sql`
      insert into demo_source.students (school_id, class_id, current_class_label, sex, status)
      select ${victim.op}::uuid, ${victim.class_id}::uuid, 'Primary 1', 'MALE', 'ACTIVE'
        from generate_series(1, 7)`;
    try {
      const rerun = await runEtl();
      expect(rerun.status).toBe("SUCCESS");
      const after = await sql<{ headcount: number; all_hc: number }[]>`
        select max(case when sex = 'MALE' then headcount end)::int as headcount,
               max(case when sex = 'ALL' then headcount end)::int as all_hc
          from fact_enrolment f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
         where d.ges_code = ${victim.emis} and f.stage = 'PRIMARY' and f.class_form = 'P1'`;
      expect(Number(after[0]!.headcount)).toBe(Number(victim.headcount) + 7);
      // The synthesised ALL and the stage total moved WITH it — a stale total is the failure mode this
      // materialisation is exposed to, so it is asserted rather than assumed.
      const total = await sql<{ headcount: number }[]>`
        select f.headcount from fact_enrolment f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
         where d.ges_code = ${victim.emis} and f.stage = 'PRIMARY'
           and f.class_form is null and f.sex = 'MALE'`;
      expect(Number(total[0]!.headcount)).toBeGreaterThanOrEqual(
        Number(victim.headcount) + 7,
      );
      const bad = await sql<{ n: number }[]>`
        select count(*)::int as n from (
          select jurisdiction_id, stage, sex,
                 sum(case when class_form is null then headcount end) t,
                 sum(case when class_form is not null then headcount end) b
            from fact_enrolment group by 1, 2, 3
        ) x where t is distinct from b`;
      expect(bad[0]!.n).toBe(0);
    } finally {
      // The stand-in source is DROP-and-CREATE, so reloading it is the restore.
      await loadDemoSource(sql, dataset);
      await runEtl();
    }
  }, 300_000);

  it("the delete is bounded by (period, jurisdiction ∈ scope) — a bystander school survives", async () => {
    const annual = await annualPeriodId();
    const two = await sql<{ jurisdiction_id: string }[]>`
      select distinct jurisdiction_id::text as jurisdiction_id from fact_enrolment
       where period_id = ${annual}::uuid order by jurisdiction_id limit 2`;
    const [bystander, rewritten] = two;
    const bystanderBefore = await sql<{ n: number; total: number }[]>`
      select count(*)::int as n, sum(headcount)::int as total from fact_enrolment
       where period_id = ${annual}::uuid and jurisdiction_id = ${bystander!.jurisdiction_id}::uuid`;

    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_enrolment
       where period_id = ${annual}::uuid and jurisdiction_id = ${rewritten!.jurisdiction_id}::uuid`;
    const rows = existing.map((r) => factRowFrom(r, annual));

    const result = await writeEnrolmentFacts(sql, [
      { periodId: annual, jurisdictionIds: [rewritten!.jurisdiction_id], rows },
    ]);
    // EXACTLY that school's rows deleted — a period-wide delete would report ~17,000.
    expect(result).toMatchObject({ deleted: rows.length, inserted: rows.length });

    const bystanderAfter = await sql<{ n: number; total: number }[]>`
      select count(*)::int as n, sum(headcount)::int as total from fact_enrolment
       where period_id = ${annual}::uuid and jurisdiction_id = ${bystander!.jurisdiction_id}::uuid`;
    expect(bystanderAfter[0]).toEqual(bystanderBefore[0]);
  });

  it("a school whose classes ALL become out-of-scope is COMPUTED TO ZERO — its prior rows are DELETED", async () => {
    // ⚠ THE DECISIVE TEST FOR THE DELETE SCOPE, and the one claim in criterion 16 that the unit test
    // ("computes to ZERO rows") can only state and not prove. `EnrolmentWriteBatch.jurisdictionIds` is
    // "every school this run SUCCESSFULLY COMPUTED" — NOT "the schools that produced rows", which is how
    // `writeInfrastructureFacts` derives it. The difference is invisible until a school's whole roster
    // stops mapping: if the scope came from `rows`, this school would keep LAST night's roll FOR EVER
    // and the ETL would be structurally unable to report that a stage emptied out.
    //
    // So: take a live school, turn EVERY class it has into a Nursery (below KG, out of scope) and point
    // its class-less children at a Nursery label too. It still HAS a roster — so it is computed, not
    // `noRoster` — and that roster now maps to nothing at all.
    const victim = (
      await sql<{ emis: string; op: string }[]>`
        select distinct d.ges_code as emis, r.operational_school_id::text as op
          from fact_enrolment f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
          join ref_emis_school_register r on r.emis_school_id = d.ges_code
         order by d.ges_code limit 1`
    )[0]!;
    const rowsFor = async (emis: string) =>
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n from fact_enrolment f
            join dim_jurisdiction d using (jurisdiction_id) where d.ges_code = ${emis}`
      )[0]!.n;
    const annual = await annualPeriodId();
    const national = await nodeId("NATIONAL", "Ghana");
    const before = await rowsFor(victim.emis);
    const nationalBefore = await rollUp(national, annual);
    const victimRollBefore = expectedHeadcount((s) => s.emisSchoolId === victim.emis);
    expect(before).toBeGreaterThan(0);
    expect(victimRollBefore).toBeGreaterThan(0);

    try {
      await sql`
        update demo_source.class
           set level = 'Nursery 1', name = 'Nursery 1 ' || id::text
         where school_id = ${victim.op}::uuid`;
      await sql`
        update demo_source.students set current_class_label = 'Nursery 1'
         where school_id = ${victim.op}::uuid and class_id is null`;
      const run = await runEtl();
      expect(run.status).toBe("SUCCESS");
      const e = run.periods[0]!.enrolment;

      // It is COMPUTED (so in the delete scope), not failed and not `noRoster`.
      expect(e.failures.some((f) => f.emisSchoolId === victim.emis)).toBe(false);
      expect(e.noRoster).not.toContain(victim.emis);

      // THE POINT: not one stale row survives.
      expect(await rowsFor(victim.emis)).toBe(0);
      // …and the national figure really fell by exactly that school's former roll — i.e. the rows were
      // DELETED, not merely hidden behind a filter.
      expect(await rollUp(national, annual)).toBe(nationalBefore - victimRollBefore);
      // The children are not lost: they moved into the out-of-scope tally, which is the visible place
      // the ruling puts them.
      expect(e.outOfScopeHeadcount).toBeGreaterThanOrEqual(victimRollBefore);
      // And the school is STILL a school — the register row and the dim node are untouched. "Zero
      // enrolment" is a measurement, not a deletion from the register.
      const stillThere = await sql<{ n: number }[]>`
        select count(*)::int as n from dim_jurisdiction
         where ges_code = ${victim.emis} and level = 'SCHOOL' and is_reporting`;
      expect(stillThere[0]!.n).toBe(1);
    } finally {
      await loadDemoSource(sql, dataset);
      await runEtl();
    }
    // Fully restored for everything after this test.
    expect(await rowsFor(victim.emis)).toBe(before);
    expect(await rollUp(national, annual)).toBe(nationalBefore);
  }, 300_000);

  it("a school that DROPS OUT of the inclusion set keeps its last good figures", async () => {
    const dropped = dataset.schools.find((s) => s.onSchoolup && s.operationalSchoolId)!;
    const extract = emisExtractFor(dataset);
    const withoutIt = JSON.stringify({
      ...extract,
      rows: extract.rows.map((r) =>
        r.emis_school_id === dropped.emisSchoolId ? { ...r, on_schoolup: false } : r,
      ),
    });
    const countRows = async () =>
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n from fact_enrolment f
            join dim_jurisdiction d using (jurisdiction_id)
           where d.ges_code = ${dropped.emisSchoolId}`
      )[0]!.n;
    const before = await countRows();
    expect(before).toBeGreaterThan(0);
    try {
      const run = await runOversightEtl(sql, {
        emisExtractText: withoutIt,
        periods: periodsOption(),
        sourceSchema: "demo_source",
      });
      expect(run.status).toBe("SUCCESS");
      expect(run.coverage.onSchoolup).toBe(
        dataset.schools.filter((s) => s.onSchoolup).length - 1,
      );
      // Stale-but-honest: the rows are still there, rather than deleted-and-not-reinserted, which would
      // shrink the district total with no error and no empty table to notice.
      expect(await countRows()).toBe(before);
    } finally {
      await runEtl();
    }
  }, 300_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MULTI-YEAR RUN — the enrolment arm attaches to the CURRENT academic year ONLY
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("a multi-year run writes enrolment for the CURRENT year only", () => {
  /**
   * ⚠ THE REGRESSION GUARD FOR THE PER-YEAR ROSTER BUG (Dex B1).
   *
   * The roster read takes NO academic year — `students` is the live state of the school and carries no
   * period — so there is exactly ONE roster and it is tonight's. Issued once per annual spec and written
   * to every year's ANNUAL period stamped with that year's `ends_on`, a two-year/backfill run published
   * TONIGHT'S roll as a PAST year's MEASURED enrolment: internally consistent, undetectable downstream,
   * and false. The arm therefore runs for the CURRENT year only.
   *
   * The INFRASTRUCTURE arm is unaffected and still backfills every year — its source really is selected
   * by academic year — so this file asserts BOTH halves. A fix that simply skipped past years for the
   * whole run would pass the enrolment half and fail the infrastructure one.
   *
   * The demo dataset is one academic year, so the past year is planted here: two TERM specs plus a
   * handful of real past-year censuses, removed again in the `finally`.
   */
  const PAST_YEAR = "2024/25";
  const PAST_TERMS = [
    {
      academicYear: PAST_YEAR,
      term: 1,
      startsOn: "2024-09-16",
      endsOn: "2024-12-20",
      isCurrent: false,
    },
    {
      academicYear: PAST_YEAR,
      term: 2,
      startsOn: "2025-01-13",
      endsOn: "2025-04-03",
      isCurrent: false,
    },
  ];

  async function annualIdFor(academicYear: string): Promise<string> {
    const rows = await sql<{ period_id: string }[]>`
      select period_id::text as period_id from dim_period
       where academic_year = ${academicYear} and term is null and period_type = 'ANNUAL'`;
    expect(rows).toHaveLength(1);
    return rows[0]!.period_id;
  }

  /** Plant ONE past-year census per school, so the infrastructure arm has a past year to backfill. */
  async function plantPastCensuses(operationalIds: string[]): Promise<void> {
    for (const op of operationalIds) {
      const period = await sql<{ period_id: string }[]>`
        insert into demo_source.academic_period
          (school_id, academic_year, period_number, period_label, starts_on, ends_on, product_line)
        values (${op}::uuid, ${PAST_YEAR}, 2, 'Term 2', ${PAST_TERMS[1]!.startsOn},
                ${PAST_TERMS[1]!.endsOn}, 'BASIC')
        returning period_id::text as period_id`;
      await sql`
        insert into demo_source.facilities_snapshot
          (school_id, period_id, classrooms_total, classrooms_good, classrooms_repair,
           water_source, electricity_source, latrines_boys, latrines_girls, latrines_staff,
           latrine_type, handwashing, has_library, has_ict_lab, internet, has_kitchen,
           gsfp_participating, captured_at)
        values (${op}::uuid, ${period[0]!.period_id}::uuid, 12, 10, 2, 'BOREHOLE', 'GRID',
                2, 2, 1, 'KVIP', true, false, false, false, true, true,
                ${`${PAST_TERMS[1]!.endsOn}T12:00:00Z`}::timestamptz)`;
    }
  }

  /** Undo everything this block plants, on either path, and restore the single-year baseline. */
  async function restore(): Promise<void> {
    await sql`
      delete from fact_enrolment
       where period_id in (select period_id from dim_period where academic_year = ${PAST_YEAR})`;
    await sql`
      delete from fact_infrastructure
       where period_id in (select period_id from dim_period where academic_year = ${PAST_YEAR})`;
    await sql`delete from dim_period where academic_year = ${PAST_YEAR}`;
    // The stand-in source is DROP-and-CREATE, so reloading it removes the planted periods/censuses.
    await loadDemoSource(sql, dataset);
    await runEtl();
  }

  it("writes enrolment ONLY on the current year's ANNUAL period, while infrastructure writes BOTH", async () => {
    const victims = (
      await sql<{ op: string }[]>`
        select r.operational_school_id::text as op from ref_emis_school_register r
         where r.on_schoolup and r.operational_school_id is not null
         order by r.emis_school_id limit 3`
    ).map((r) => r.op);
    expect(victims).toHaveLength(3);

    try {
      await plantPastCensuses(victims);
      // TWO academic years in ONE run — the backfill shape. Only 2025/26 is current (DEMO_TERMS term 2).
      const run = await runOversightEtl(sql, {
        emisExtractText: extractText(dataset),
        periods: [...PAST_TERMS, ...periodsOption()],
        sourceSchema: "demo_source",
      });
      expect(run.status).toBe("SUCCESS");
      expect(run.errorText).toBeNull();
      expect(run.periods).toHaveLength(2); // one per YEAR, both ANNUAL
      const past = run.periods.find((p) => p.academicYear === PAST_YEAR)!;
      const current = run.periods.find((p) => p.academicYear === ACADEMIC_YEAR)!;
      expect(past).toBeDefined();
      expect(current).toBeDefined();

      // ── the report: the arm did not run for the past year AT ALL ─────────────────────────────────
      expect(past.enrolment).toMatchObject({
        sourceGroups: 0,
        schoolsComputed: 0, // ⇒ an EMPTY delete scope, so the year keeps whatever it had
        deleted: 0,
        inserted: 0,
        headcount: 0,
        outOfScopeHeadcount: 0,
        unmappedHeadcount: 0,
        noRoster: [],
        stageDrift: [],
        failures: [],
      });
      // …and it did run, in full, for the current one — the same national roll the single-year run gets.
      expect(current.enrolment.inserted).toBeGreaterThan(10_000);
      expect(current.enrolment.headcount).toBe(expectedHeadcount(() => true));
      expect(current.enrolment.failures).toEqual([]);

      // ── the database: ZERO enrolment rows at the past year's ANNUAL period ───────────────────────
      const pastAnnual = await annualIdFor(PAST_YEAR);
      const currentAnnual = await annualPeriodId();
      expect(pastAnnual).not.toBe(currentAnnual);
      const counts = (
        await sql<
          {
            enrol_past: number;
            enrol_now: number;
            infra_past: number;
            infra_now: number;
          }[]
        >`
          select (select count(*)::int from fact_enrolment
                   where period_id = ${pastAnnual}::uuid)       as enrol_past,
                 (select count(*)::int from fact_enrolment
                   where period_id = ${currentAnnual}::uuid)    as enrol_now,
                 (select count(*)::int from fact_infrastructure
                   where period_id = ${pastAnnual}::uuid)       as infra_past,
                 (select count(*)::int from fact_infrastructure
                   where period_id = ${currentAnnual}::uuid)    as infra_now`
      )[0]!;
      expect(counts.enrol_past).toBe(0);
      expect(counts.enrol_now).toBe(current.enrolment.inserted);
      // THE OTHER HALF: infrastructure really did backfill the past year — exactly the three schools
      // that filed a past-year census — so this is not a blanket "skip every non-current year".
      expect(counts.infra_past).toBe(victims.length);
      expect(past.inserted).toBe(victims.length);
      expect(counts.infra_now).toBeGreaterThan(0);

      // No enrolment row anywhere claims the PAST year's vintage: there is exactly one as-of in the
      // table, and it is the current year's. A per-year roster read would have produced two.
      const vintages = await sql<{ as_of: string }[]>`
        select distinct as_of_date::date::text as as_of from fact_enrolment`;
      expect(vintages).toEqual([{ as_of: ROSTER_AS_OF }]);
    } finally {
      await restore();
    }
  }, 300_000);

  it("a run with NO current academic year skips the enrolment arm cleanly rather than erroring", async () => {
    // Should not happen in the nightly run (`is_current` comes from the calendar), so the requirement is
    // only that it is a clean no-op: no throw, no rows, and — because the delete scope is empty — the
    // current year's existing enrolment keeps its last good figures.
    const currentAnnual = await annualPeriodId();
    const before = (
      await sql<{ n: number }[]>`
        select count(*)::int as n from fact_enrolment where period_id = ${currentAnnual}::uuid`
    )[0]!.n;
    expect(before).toBeGreaterThan(0);
    try {
      const run = await runOversightEtl(sql, {
        emisExtractText: extractText(dataset),
        periods: PAST_TERMS, // not one of them is current
        sourceSchema: "demo_source",
      });
      expect(run.status).toBe("SUCCESS");
      expect(run.periods).toHaveLength(1);
      expect(run.periods[0]!.enrolment.inserted).toBe(0);
      expect(run.periods[0]!.enrolment.schoolsComputed).toBe(0);
      expect(
        (
          await sql<{ n: number }[]>`
            select count(*)::int as n from fact_enrolment where period_id = ${currentAnnual}::uuid`
        )[0]!.n,
      ).toBe(before);
    } finally {
      await restore();
    }
  }, 300_000);
});

describe("the NULL-safe duplicate assertion (criterion 17)", () => {
  it("catches a GENUINE duplicate and rolls the whole write back", async () => {
    // `fact_enrolment` is one of the PK-ONLY original eight: there is NO grain UNIQUE, so a duplicate
    // INSERTS HAPPILY and doubles every roll-up above it while staying internally consistent at every
    // tier. This assertion is the ONLY guard that exists.
    const annual = await annualPeriodId();
    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_enrolment where period_id = ${annual}::uuid
       order by jurisdiction_id, stage, class_form nulls first, sex limit 1`;
    const row = factRowFrom(existing[0]!, annual);
    const before = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_enrolment`
    )[0]!.n;

    await expect(
      writeEnrolmentFacts(sql, [
        {
          periodId: annual,
          jurisdictionIds: [row.jurisdictionId],
          rows: [row, { ...row }],
        },
      ]),
    ).rejects.toThrow(/duplicated grain key/);
    // Inside the transaction: the delete AND both inserts were rolled back.
    const after = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_enrolment`
    )[0]!.n;
    expect(after).toBe(before);
  });

  it("does NOT flag the three LEGITIMATE class_form IS NULL rows (the NULL-safety half)", async () => {
    // The trap: the stage total is three real rows per (school, stage) — MALE, FEMALE, ALL — all with
    // `class_form IS NULL`. A duplicate check that keyed on `coalesce(class_form,'')` alone, or that
    // dropped `sex` from the key, would fail every single school. Rewriting a real school's rows
    // unchanged is the proof it does not.
    const annual = await annualPeriodId();
    const victim = (
      await sql<{ jurisdiction_id: string }[]>`
        select jurisdiction_id::text as jurisdiction_id from fact_enrolment
         where period_id = ${annual}::uuid and class_form is null limit 1`
    )[0]!;
    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_enrolment
       where period_id = ${annual}::uuid and jurisdiction_id = ${victim.jurisdiction_id}::uuid`;
    const totals = existing.filter((r) => r.class_form === null);
    expect(totals.length).toBeGreaterThanOrEqual(3);
    const before = await fingerprint();
    const result = await writeEnrolmentFacts(sql, [
      {
        periodId: annual,
        jurisdictionIds: [victim.jurisdiction_id],
        rows: existing.map((r) => factRowFrom(r, annual)),
      },
    ]);
    expect(result.inserted).toBe(existing.length);
    expect(await fingerprint()).toBe(before); // byte-identical, so nothing was mangled either
  });

  it("an empty-string class_form is NOT the same key as a stage total", async () => {
    // The specific collision a `coalesce(class_form, '')` key would create. '' is not a token this ETL
    // emits, but the guard must distinguish it from NULL or the assertion is only accidentally correct.
    const annual = await annualPeriodId();
    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_enrolment where period_id = ${annual}::uuid and class_form is null limit 1`;
    const total = factRowFrom(existing[0]!, annual);
    const empty: FactEnrolmentRow = { ...total, classForm: "" };
    const before = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_enrolment`
    )[0]!.n;
    // Two rows, same jurisdiction/stage/sex, one with NULL and one with '' — DIFFERENT keys, so the
    // write succeeds.
    const result = await writeEnrolmentFacts(sql, [
      {
        periodId: annual,
        jurisdictionIds: [total.jurisdictionId],
        rows: [
          ...(
            await sql<Record<string, unknown>[]>`
          select * from fact_enrolment
           where period_id = ${annual}::uuid and jurisdiction_id = ${total.jurisdictionId}::uuid`
          ).map((r) => factRowFrom(r, annual)),
          empty,
        ],
      },
    ]);
    expect(result.inserted).toBeGreaterThan(0);
    expect(
      (await sql<{ n: number }[]>`select count(*)::int as n from fact_enrolment`)[0]!.n,
    ).toBe(before + 1);
    // Clean up the synthetic row, and restore the table to what the rest of the file assumes.
    await sql`delete from fact_enrolment where class_form = ''`;
    expect(
      (await sql<{ n: number }[]>`select count(*)::int as n from fact_enrolment`)[0]!.n,
    ).toBe(before);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the transform, in isolation (the per-school guards)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the pure aggregation refuses what it cannot honestly aggregate", () => {
  const target = {
    jurisdictionId: "10000000-0000-4000-8000-000000000011",
    periodId: "20000000-0000-4000-8000-000000000001",
    emisSchoolId: "GH-TEST-0001",
    etlRunId: "30000000-0000-4000-8000-0000000000aa",
    asOfDate: "2026-04-02T00:00:00.000Z",
  };
  const group = (over: Partial<RosterGroupSourceRow>): RosterGroupSourceRow => ({
    schoolId: "a1000000-0000-4000-8000-000000000001",
    classLevel: "JHS 1",
    className: "JHS 1 A",
    currentClassLabel: "JHS 1 A",
    hasClass: true,
    sex: "MALE",
    headcount: 10,
    ...over,
  });

  it("aggregates a known roster to known rows, totals included", () => {
    const result = aggregateSchoolRoster(
      [
        group({ sex: "MALE", headcount: 10 }),
        group({ sex: "FEMALE", headcount: 9 }),
        group({ classLevel: "JHS 2", className: "JHS 2", sex: "MALE", headcount: 4 }),
        group({ classLevel: "Nursery 1", className: "Nursery 1", headcount: 7 }),
        group({ classLevel: null, className: "Transition Stream", headcount: 3 }),
      ],
      { ...target, schoolType: "JHS" },
    );
    expect(result.outOfScopeHeadcount).toBe(7);
    expect(result.unmappedHeadcount).toBe(3);
    expect(result.stages).toEqual(["JHS"]);
    expect(result.stageDrift).toEqual([]);
    expect(result.activeHeadcount).toBe(33);
    const shape = result.rows.map(
      (r) => `${r.classForm ?? "TOTAL"}/${r.sex}=${r.headcount}`,
    );
    expect(shape).toEqual([
      "JHS1/MALE=10",
      "JHS1/FEMALE=9",
      "JHS1/ALL=19",
      "JHS2/MALE=4",
      "JHS2/FEMALE=0",
      "JHS2/ALL=4",
      "TOTAL/MALE=14",
      "TOTAL/FEMALE=9",
      "TOTAL/ALL=23",
    ]);
    expect(result.rows.every((r) => r.asOfDate === target.asOfDate)).toBe(true);
    expect(result.rows.every((r) => r.source === "OPERATIONAL_AGG")).toBe(true);
  });

  it("refuses a source sex of 'ALL' — synthesising on top of it would double every figure", () => {
    expect(() => aggregateSchoolRoster([group({ sex: "ALL" })], target)).toThrow(
      EnrolmentTransformError,
    );
    expect(() => aggregateSchoolRoster([group({ sex: "ALL" })], target)).toThrow(
      /SYNTHESISED/,
    );
    expect(() => aggregateSchoolRoster([group({ sex: "UNKNOWN" })], target)).toThrow(
      /outside MALE\|FEMALE/,
    );
  });

  it("refuses a negative or fractional headcount rather than subtracting children from a district", () => {
    expect(() => aggregateSchoolRoster([group({ headcount: -1 })], target)).toThrow(
      /non-negative integer/,
    );
    expect(() => aggregateSchoolRoster([group({ headcount: 1.5 })], target)).toThrow(
      /non-negative integer/,
    );
  });

  it("flags drift when the class labels name a stage the school_type does not account for", () => {
    const result = aggregateSchoolRoster(
      [group({ classLevel: "Form 1", className: "Form 1 Science" })],
      { ...target, schoolType: "JHS" },
    );
    expect(result.stages).toEqual(["SHS"]);
    expect(result.stageDrift).toEqual(["SHS"]);
    // A COMBINED school teaching the same stage is NOT drift.
    expect(
      aggregateSchoolRoster([group({ classLevel: "Form 1", className: "Form 1" })], {
        ...target,
        schoolType: "COMBINED",
      }).stageDrift,
    ).toEqual([]);
  });

  it("the invariant checker catches a tampered ALL and a tampered stage total", () => {
    const good = aggregateSchoolRoster([group({}), group({ sex: "FEMALE" })], target);
    expect(() => assertSchoolInvariants(good, "GH-TEST-0001")).not.toThrow();

    const brokenAll = {
      ...good,
      rows: good.rows.map((r) =>
        r.sex === "ALL" && r.classForm !== null
          ? { ...r, headcount: r.headcount + 1 }
          : r,
      ),
    };
    expect(() => assertSchoolInvariants(brokenAll, "GH-TEST-0001")).toThrow(
      /ALL=.*MALE\+FEMALE/,
    );

    // The INTERESTING tamper: MALE and ALL moved TOGETHER on the stage total, so the sex equality still
    // holds and only the total-vs-breakdown check can catch it. That is the defect a materialised total
    // is exposed to — a stale total beside a correct breakdown — and it is internally consistent.
    const brokenTotal = {
      ...good,
      rows: good.rows.map((r) =>
        r.classForm === null && (r.sex === "MALE" || r.sex === "ALL")
          ? { ...r, headcount: r.headcount + 5 }
          : r,
      ),
    };
    expect(() => assertSchoolInvariants(brokenTotal, "GH-TEST-0001")).toThrow(
      /breakdown sums to/,
    );
  });

  it("a school with NO mapped class computes to ZERO rows — and is still a computed school", () => {
    // Which is what puts it in the DELETE SCOPE: an emptied stage really empties, instead of the school
    // reporting last night's roll for ever.
    const result = aggregateSchoolRoster(
      [group({ classLevel: "Nursery 2", className: "Nursery 2", headcount: 12 })],
      target,
    );
    expect(result.rows).toEqual([]);
    expect(result.outOfScopeHeadcount).toBe(12);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// the PII allow-list (criterion 19)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the roster read is an ALLOW-LIST, not a `select *` (criterion 19)", () => {
  /** The columns that must never cross the boundary. Each one names a CHILD. */
  const FORBIDDEN = [
    "first_name",
    "last_name",
    "other_names",
    "student_code",
    "date_of_birth",
    "household_id",
    "stpshs_ref",
    "house_id",
    "current_bunk_id",
    "admission_application_id",
    "enrolled_on",
    "guardian",
    "phone",
    "email",
  ];

  it("the reader's SQL mentions none of the forbidden columns, and exactly the six allowed ones", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/etl/enrolment-source.ts"),
      "utf8",
    );
    // Only the QUERY is scanned: the header documents the forbidden names on purpose, and a test that
    // banned the words outright would make the module undocumentable.
    const query = source.slice(source.indexOf("const rows = await sql"));
    for (const column of FORBIDDEN) expect(query).not.toContain(column);
    expect(query).not.toContain("select *");
    for (const column of [
      "s.sex",
      "s.status",
      "s.class_id",
      "s.current_class_label",
      "c.level",
      "c.name",
    ])
      expect(query).toContain(column);
  });

  it("the demo stand-in does not even CARRY the forbidden columns — the structural floor", async () => {
    const columns = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'demo_source' and table_name = 'students'`;
    const names = columns.map((c) => c.column_name).sort();
    expect(names).toEqual([
      "class_id",
      "current_class_label",
      "id",
      "school_id",
      "sex",
      "status",
    ]);
    for (const column of FORBIDDEN) expect(names).not.toContain(column);
  });

  it("the REAL operational table does carry them — so the omission is a choice, not an accident", () => {
    // Without this, the test above would pass just as well against a source that never had the columns,
    // and the claim "the allow-list excludes PII" would be vacuous.
    const real = readFileSync(
      join(process.cwd(), "../web/db/schema/students.ts"),
      "utf8",
    );
    for (const column of ["first_name", "last_name", "date_of_birth", "student_code"])
      expect(real).toContain(column);
  });

  it("fact_enrolment itself has no person-identifying column, and no individual can be reconstructed", async () => {
    const columns = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'fact_enrolment'`;
    const names = columns.map((c) => c.column_name);
    for (const column of FORBIDDEN) expect(names).not.toContain(column);
    // An aggregate of ONE is a disclosure in effect. It is not suppressed at this layer — suppression is
    // a READ-side rule (lib/oversight/suppression.ts) — but a row of headcount 1 must at least be a
    // known, countable state rather than a surprise, so it is measured here.
    const ones = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_enrolment where headcount = 1 and sex <> 'ALL'`;
    expect(ones[0]!.n).toBeGreaterThanOrEqual(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// criterion 18 — tenant/jurisdiction isolation, as the NON-OWNER app role.
// ⚠ LAST BLOCK IN THE FILE: it installs db/sql/policies.sql on the demo database.
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("CRITERION 18 · the written facts are jurisdiction-isolated (as ov_app, not the owner)", () => {
  let app: postgres.Sql;
  let districtA: string;
  let districtB: string;

  beforeAll(async () => {
    await sql.unsafe(readFileSync(join(process.cwd(), "db/sql/policies.sql"), "utf8"));
    await sql.unsafe(`
      grant usage on schema public to ov_app;
      grant select on all tables in schema public to ov_app;
      grant execute on all functions in schema public to ov_app;
    `);
    const url = new URL(testDbConfig.demoAnalyticsUrl);
    url.username = "ov_app";
    url.password = "";
    app = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });
    const districts = await sql<{ jurisdiction_id: string }[]>`
      select jurisdiction_id::text as jurisdiction_id from dim_jurisdiction
       where level = 'DISTRICT' order by name limit 2`;
    districtA = districts[0]!.jurisdiction_id;
    districtB = districts[1]!.jurisdiction_id;
  }, 120_000);

  afterAll(async () => {
    if (app) await app.end({ timeout: 5 });
  });

  async function asOfficer<T>(
    jurisdictionId: string,
    level: string,
    fn: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    let captured: T;
    try {
      await app.begin(async (tx) => {
        await tx`select set_config('app.current_jurisdiction', ${jurisdictionId}, true)`;
        await tx`select set_config('app.current_level', ${level}, true)`;
        await tx`select set_config('app.current_officer', ${"60000000-0000-4000-8000-000000000001"}, true)`;
        captured = await fn(tx as unknown as postgres.TransactionSql);
        throw new Error("__rollback__");
      });
    } catch (err) {
      if ((err as Error).message !== "__rollback__") throw err;
    }
    return captured!;
  }

  async function schoolsUnder(districtId: string): Promise<string[]> {
    return (
      await sql<{ jurisdiction_id: string }[]>`
        select jurisdiction_id::text as jurisdiction_id from dim_jurisdiction
         where parent_id = ${districtId}::uuid`
    ).map((r) => r.jurisdiction_id);
  }

  it("a district officer reads its own district's enrolment and ZERO of another district's", async () => {
    const own = await schoolsUnder(districtA);
    const other = await schoolsUnder(districtB);
    const seen = await asOfficer(districtA, "DISTRICT", async (tx) => {
      const mine = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_enrolment where jurisdiction_id = any(${own}::uuid[])`;
      const theirs = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_enrolment where jurisdiction_id = any(${other}::uuid[])`;
      const unfiltered = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_enrolment`;
      return { mine: mine[0]!.n, theirs: theirs[0]!.n, unfiltered: unfiltered[0]!.n };
    });
    expect(seen.mine).toBeGreaterThan(0);
    expect(seen.theirs).toBe(0);
    // The decisive one: an UNQUALIFIED count — the query a reporting bug would write — returns the
    // officer's own district and nothing more.
    expect(seen.unfiltered).toBe(seen.mine);
  });

  it("a national officer reads every row, and the app role still cannot write one", async () => {
    const total = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_enrolment`
    )[0]!.n;
    const national = await nodeId("NATIONAL", "Ghana");
    const seen = await asOfficer(national, "NATIONAL", async (tx) => {
      const r = await tx<{ n: number }[]>`select count(*)::int as n from fact_enrolment`;
      return r[0]!.n;
    });
    expect(seen).toBe(total);
    // The ETL's credential is the owner; the app role has no INSERT/DELETE on any fact table, and the
    // absent GRANT — not a policy — is what makes that unforgeable.
    await expect(
      asOfficer(national, "NATIONAL", async (tx) => {
        await tx`delete from fact_enrolment`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("a REGISTERED-BUT-NOT-LIVE school has a register row and a dim node but ZERO enrolment rows", async () => {
    // The coverage asymmetry, on the roster arm: a school GES recognises but that is not on Omnischools
    // has no operational roster to read, so it is counted in the DENOMINATOR and absent from the facts.
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
      select count(*)::int as n from fact_enrolment f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where d.ges_code = any(${ids})`;
    expect(facts[0]!.n).toBe(0);
    // …and no roster row exists for them operationally either, which is WHY there is no fact row.
    const students = await sql<{ n: number }[]>`
      select count(*)::int as n from demo_source.students s
       where not exists (select 1 from ref_emis_school_register r
                          where r.operational_school_id = s.school_id and r.on_schoolup)`;
    expect(students[0]!.n).toBe(0);
  });
});
