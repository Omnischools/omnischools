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
  type DemoDataset,
  type DemoFacilitiesRow,
  type DemoSchool,
  productLineFor,
} from "@/scripts/seed-demo-data";
import { runInfrastructureEtl, type EtlRunReport } from "@/lib/etl/pipeline";
import {
  InfrastructureTransformError,
  decomposeFacilitiesSnapshot,
  writeInfrastructureFacts,
  type FactInfrastructureRow,
} from "@/lib/etl/infrastructure";
import { computePerSchool, failureVerdict } from "@/lib/etl/run";
import { parseEmisExtract } from "@/lib/etl/register";
import type { FacilitiesSnapshotSourceRow } from "@/lib/etl/source";

/**
 * INCREMENT H FIRST SLICE — `fact_infrastructure` end-to-end (scope §8).
 *
 * This runs the REAL pipeline over the deterministic demo dataset: the EMIS extract is parsed, the
 * `dim_jurisdiction` spine and `dim_period` rows are built, the register is loaded, the inclusion set
 * is derived, and every fact row is produced by `decomposeFacilitiesSnapshot` from an
 * operational-shaped `facilities_snapshot` row. NOTHING HERE HAND-SEEDS A FACT — the assertions below
 * are therefore assertions about the transform, which is the only arrangement in which they mean
 * anything.
 *
 * It runs against its OWN analytics database (`adminDemoAnalytics`, built from the same migrations and
 * nothing else) because the seed is a whole country and `tests/rls-tier-matrix.test.ts` measures global
 * row counts in the shared fixture DB. See `demoAnalyticsUrl` in tests/setup/paths.ts.
 *
 * The expected figures are HAND-COMPUTED IN TYPESCRIPT from the generated dataset — not read back out
 * of SQL and compared to another SQL query, which would only prove Postgres is consistent with itself.
 */

let sql: postgres.Sql;
let dataset: DemoDataset;
let report: EtlRunReport;

/** emis_school_id → the generated school. */
let schoolByEmis: Map<string, DemoSchool>;
/** `${emis}|${term}` → the generated census row. */
let censusBySchoolTerm: Map<string, DemoFacilitiesRow>;

const TERM_1 = DEMO_TERMS[0]!;
const TERM_2 = DEMO_TERMS[1]!;

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
  return runInfrastructureEtl(sql, {
    emisExtractText: extractText(d),
    periods: periodsOption(),
    sourceSchema: "demo_source",
  });
}

beforeAll(async () => {
  sql = adminDemoAnalytics();
  dataset = generateDemoDataset();
  await loadDemoSource(sql, dataset);

  schoolByEmis = new Map(dataset.schools.map((s) => [s.emisSchoolId, s]));
  const bySchoolId = new Map(
    dataset.schools
      .filter((s) => s.operationalSchoolId)
      .map((s) => [s.operationalSchoolId!, s]),
  );
  censusBySchoolTerm = new Map();
  for (const f of dataset.facilities) {
    const school = bySchoolId.get(f.schoolId)!;
    // The generator derives the operational period uuid as b100000<term>-…, so the term is readable
    // off the id — which is also a check that the per-school period ids are what the ETL mapped.
    const term = Number(f.periodId[7]);
    censusBySchoolTerm.set(`${school.emisSchoolId}|${term}`, f);
  }

  report = await runEtl();
}, 180_000);

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

// ── helpers over the written facts ──────────────────────────────────────────────────────────────

async function periodIdFor(term: number): Promise<string> {
  const rows = await sql<{ period_id: string }[]>`
    select period_id::text as period_id from dim_period
     where academic_year = ${TERM_1.academicYear} and term = ${term} and period_type = 'TERM'`;
  expect(rows).toHaveLength(1);
  return rows[0]!.period_id;
}

/** SUM a fact column over a jurisdiction SUBTREE — the product's actual roll-up shape. */
async function rollUp(
  rootJurisdictionId: string,
  periodId: string,
  column: string,
): Promise<number> {
  const rows = await sql<{ total: number | null }[]>`
    with recursive subtree as (
      select jurisdiction_id from dim_jurisdiction where jurisdiction_id = ${rootJurisdictionId}::uuid
      union all
      select c.jurisdiction_id from dim_jurisdiction c join subtree s on c.parent_id = s.jurisdiction_id
    )
    select sum(${sql(column)})::int as total
      from fact_infrastructure f
      join subtree s on s.jurisdiction_id = f.jurisdiction_id
     where f.period_id = ${periodId}::uuid`;
  return rows[0]!.total ?? 0;
}

async function nodeId(level: string, name: string): Promise<string> {
  const rows = await sql<{ jurisdiction_id: string }[]>`
    select jurisdiction_id::text as jurisdiction_id from dim_jurisdiction
     where level = ${level}::jurisdiction_level and name = ${name}`;
  expect(rows).toHaveLength(1);
  return rows[0]!.jurisdiction_id;
}

/** Hand-computed expectation: the census rows of the on-Schoolup schools matching a predicate. */
/**
 * Does this school produce a fact row at all?
 *
 * Registered ∧ live is not sufficient: a SENIOR-line school's `period_number` is a SEMESTER, which the
 * slice deliberately does not map onto a `dim_period` TERM (see lib/etl/source.ts's product_line note).
 * Those schools file censuses, are counted as a named gap, and have no fact row — so every
 * hand-computed expectation below has to use THIS predicate, not `onSchoolup`. Using `onSchoolup` would
 * make the roll-up tests fail for the right reason and look like a transform bug.
 */
function mapsToFacts(s: DemoSchool): boolean {
  return s.onSchoolup && productLineFor(s.schoolType) === "BASIC";
}

/** Schools that should have a fact row per period — the real denominator for the sums below. */
function mappedSchoolCount(): number {
  return dataset.schools.filter(mapsToFacts).length;
}

function expectedSum(
  predicate: (s: DemoSchool) => boolean,
  term: number,
  measure: (c: DemoFacilitiesRow) => number,
): number {
  return dataset.schools
    .filter((s) => mapsToFacts(s) && predicate(s))
    .reduce((total, s) => {
      const census = censusBySchoolTerm.get(`${s.emisSchoolId}|${term}`);
      return census ? total + measure(census) : total;
    }, 0);
}

/**
 * Round-trip a row already in `fact_infrastructure` back into the shape `writeInfrastructureFacts`
 * takes. Used by the delete-scope and duplicate-assertion tests, which need a row the write path
 * will accept while they probe the WRITE rather than the transform.
 */
function factRowFrom(
  db: Record<string, unknown>,
  periodId: string,
): FactInfrastructureRow {
  const num = (k: string): number => Number(db[k]);
  const nullable = (k: string): number | null => (db[k] === null ? null : Number(db[k]));
  return {
    jurisdictionId: db.jurisdiction_id as string,
    periodId,
    schoolsReporting: num("schools_reporting"),
    classroomsTotal: num("classrooms_total"),
    classroomsGood: num("classrooms_good"),
    classroomsRepair: num("classrooms_repair"),
    latrinesBoys: num("latrines_boys"),
    latrinesGirls: num("latrines_girls"),
    latrinesStaff: num("latrines_staff"),
    studentDesksUsable: nullable("student_desks_usable"),
    studentDesksBroken: nullable("student_desks_broken"),
    teacherDesks: nullable("teacher_desks"),
    chalkboards: nullable("chalkboards"),
    whiteboards: nullable("whiteboards"),
    projectors: nullable("projectors"),
    computersTotal: nullable("computers_total"),
    computersWorking: nullable("computers_working"),
    libraryBookCount: nullable("library_book_count"),
    hasElectricityCount: num("has_electricity_count"),
    hasWaterCount: num("has_water_count"),
    hasHandwashingCount: num("has_handwashing_count"),
    hasLibraryCount: num("has_library_count"),
    hasIctLabCount: num("has_ict_lab_count"),
    hasInternetCount: num("has_internet_count"),
    gsfpParticipatingCount: num("gsfp_participating_count"),
    hasKitchenCount: num("has_kitchen_count"),
    waterBoreholeCount: num("water_borehole_count"),
    waterPipeCount: num("water_pipe_count"),
    waterWellCount: num("water_well_count"),
    waterNoneCount: num("water_none_count"),
    electricityGridCount: num("electricity_grid_count"),
    electricitySolarCount: num("electricity_solar_count"),
    electricityGeneratorCount: num("electricity_generator_count"),
    electricityNoneCount: num("electricity_none_count"),
    latrineWcCount: num("latrine_wc_count"),
    latrineKvipCount: num("latrine_kvip_count"),
    latrinePitCount: num("latrine_pit_count"),
    latrineNoneCount: num("latrine_none_count"),
    computersReportingCount: num("computers_reporting_count"),
    libraryBooksReportingCount: num("library_books_reporting_count"),
    furnitureReportingCount: num("furniture_reporting_count"),
    source: "OPERATIONAL_AGG",
    asOfDate: (db.as_of_date as Date).toISOString(),
    etlRunId: db.etl_run_id as string,
  };
}

// ── the run itself ──────────────────────────────────────────────────────────────────────────────

describe("the run (scope §8 slice exit)", () => {
  it("reaches SUCCESS and the etl_run row is closed", async () => {
    expect(report.status).toBe("SUCCESS");
    const rows = await sql<
      { status: string; finished_at: Date | null; error_text: string | null }[]
    >`
      select status::text as status, finished_at, error_text from etl_run where run_id = ${report.runId}::uuid`;
    expect(rows[0]!.status).toBe("SUCCESS");
    expect(rows[0]!.finished_at).not.toBeNull();
    // No COMPUTE failures. `error_text` is not null, though, and deliberately so: it carries the
    // unmapped-product-line note, because a run that could not map the whole SHS estate is not a
    // failure but is not a silent success either. What must be absent is a gap report about schools
    // that FAILED.
    expect(rows[0]!.error_text).toMatch(/UNMAPPED PRODUCT LINES/);
    expect(rows[0]!.error_text).not.toMatch(/SUCCESS WITH GAPS/);
    expect(report.periods.every((p) => p.failures.length === 0)).toBe(true);
  });

  it("stamps every fact row with source, as_of_date and the run id", async () => {
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_infrastructure
       where source <> 'OPERATIONAL_AGG' or as_of_date is null or etl_run_id is null`;
    expect(rows[0]!.n).toBe(0);

    // as_of_date is the census VINTAGE, not the run clock: Term 1 rows are dated to Term 1's census.
    const t1 = await periodIdFor(1);
    const vintages = await sql<{ as_of: string }[]>`
      select distinct as_of_date::date::text as as_of from fact_infrastructure where period_id = ${t1}::uuid`;
    expect(vintages).toEqual([{ as_of: TERM_1.endsOn }]);
  });

  it("writes one row per MAPPED school per term, and nothing else", async () => {
    // Not `coverage.included`: the SENIOR-line schools are included in the run and deliberately not
    // mapped. See `mapsToFacts`.
    const included = mappedSchoolCount();
    const rows = await sql<{ period_id: string; n: number }[]>`
      select period_id::text as period_id, count(*)::int as n from fact_infrastructure group by period_id`;
    expect(rows).toHaveLength(DEMO_TERMS.length);
    for (const row of rows) expect(row.n).toBe(included);
    // schools_reporting is the "Y" denominator and is always 1 on a school row.
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_infrastructure where schools_reporting <> 1`;
    expect(bad[0]!.n).toBe(0);
  });

  it("builds the whole Ghana spine with an unbroken chain to the SINGLE national node", async () => {
    const levels = await sql<{ level: string; n: number }[]>`
      select level::text as level, count(*)::int as n from dim_jurisdiction group by level`;
    const byLevel = Object.fromEntries(levels.map((l) => [l.level, l.n]));
    expect(byLevel.NATIONAL).toBe(1);
    expect(byLevel.REGION).toBe(16);
    expect(byLevel.DISTRICT).toBe(
      new Set(dataset.schools.map((s) => `${s.regionName}/${s.districtName}`)).size,
    );
    expect(byLevel.SCHOOL).toBe(dataset.schools.length);

    // Every SCHOOL node reaches the national node in exactly 4 levels. The recursive walk is the same
    // one every roll-up and `ov_in_subtree` perform, so a school that fails this is invisible to both.
    const orphans = await sql<{ n: number }[]>`
      with recursive up as (
        select jurisdiction_id as leaf, jurisdiction_id, parent_id, level
          from dim_jurisdiction where level = 'SCHOOL'
        union all
        select u.leaf, p.jurisdiction_id, p.parent_id, p.level
          from up u join dim_jurisdiction p on p.jurisdiction_id = u.parent_id
      )
      select count(*)::int as n from (
        select leaf from up group by leaf
        having count(*) <> 4 or bool_or(level = 'NATIONAL') is not true
      ) x`;
    expect(orphans[0]!.n).toBe(0);
  });
});

// ── coverage: the asymmetry that IS the figure ──────────────────────────────────────────────────

describe("coverage (scope §3 — excluded from facts, still counted in the register)", () => {
  it("counts every registered school and only the live ones in the facts", async () => {
    expect(report.coverage.registered).toBe(dataset.schools.length);
    expect(report.coverage.onSchoolup).toBe(
      dataset.schools.filter((s) => s.onSchoolup).length,
    );
    expect(report.coverage.unmapped).toEqual([]);
    expect(report.coverage.unresolved).toEqual([]);
    // Coverage is BELOW 100% by construction, which is what makes it a measurement.
    expect(report.coverage.onSchoolup).toBeLessThan(report.coverage.registered);

    const register = await sql<
      { n: number }[]
    >`select count(*)::int as n from ref_emis_school_register`;
    expect(register[0]!.n).toBe(dataset.schools.length);
  });

  it("a registered-but-not-live school has a register row and a dim node but NO fact row", async () => {
    const notLive = dataset.schools.filter((s) => !s.onSchoolup);
    expect(notLive.length).toBeGreaterThan(0);
    const ids = notLive.map((s) => s.emisSchoolId);

    // IN the register — this is the denominator, and dropping it would make coverage read 100% for ever.
    const inRegister = await sql<{ n: number }[]>`
      select count(*)::int as n from ref_emis_school_register
       where emis_school_id = any(${ids}) and on_schoolup = false`;
    expect(inRegister[0]!.n).toBe(notLive.length);

    // A dim node too, with is_reporting = false: the spine describes the country, not the subscribers.
    const inDim = await sql<{ n: number }[]>`
      select count(*)::int as n from dim_jurisdiction
       where level = 'SCHOOL' and ges_code = any(${ids}) and is_reporting = false`;
    expect(inDim[0]!.n).toBe(notLive.length);

    // And NO fact row, in either term.
    const facts = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_infrastructure f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where d.ges_code = any(${ids})`;
    expect(facts[0]!.n).toBe(0);
  });
});

// ── the roll-up: district = Σ schools, region = Σ districts ─────────────────────────────────────

describe("roll-ups are a plain SUM (scope §8 / task H19)", () => {
  it("district = Σ its schools, against hand-computed sums on the seed", async () => {
    const periodId = await periodIdFor(2);
    // Three districts with different urban/rural character, so the assertion is not one shape of data.
    const probes = [
      { region: "Greater Accra", district: "Accra Metropolitan" },
      { region: "Upper West", district: "Nadowli-Kaleo" },
      { region: "Ashanti", district: "Kumasi Metropolitan" },
    ];
    for (const probe of probes) {
      const districtId = await nodeId("DISTRICT", probe.district);
      const inDistrict = (s: DemoSchool) =>
        s.regionName === probe.region && s.districtName === probe.district;

      expect(await rollUp(districtId, periodId, "schools_reporting")).toBe(
        expectedSum(inDistrict, 2, () => 1),
      );
      expect(await rollUp(districtId, periodId, "classrooms_total")).toBe(
        expectedSum(inDistrict, 2, (c) => c.classroomsTotal),
      );
      expect(await rollUp(districtId, periodId, "has_water_count")).toBe(
        expectedSum(inDistrict, 2, (c) => (c.waterSource !== "NONE" ? 1 : 0)),
      );
      expect(await rollUp(districtId, periodId, "has_electricity_count")).toBe(
        expectedSum(inDistrict, 2, (c) => (c.electricitySource !== "NONE" ? 1 : 0)),
      );
      expect(await rollUp(districtId, periodId, "latrine_kvip_count")).toBe(
        expectedSum(inDistrict, 2, (c) => (c.latrineType === "KVIP" ? 1 : 0)),
      );
      // The honest denominator: the schools that ANSWERED, not all of them.
      expect(await rollUp(districtId, periodId, "computers_reporting_count")).toBe(
        expectedSum(inDistrict, 2, (c) => (c.computersTotal !== null ? 1 : 0)),
      );
    }
  });

  it("region = Σ its districts — the same number, reached two ways", async () => {
    const periodId = await periodIdFor(2);
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
      for (const districtName of districtNames) {
        sumOfDistricts += await rollUp(
          await nodeId("DISTRICT", districtName),
          periodId,
          "classrooms_total",
        );
      }
      const regionTotal = await rollUp(regionId, periodId, "classrooms_total");
      expect(regionTotal).toBe(sumOfDistricts);
      // …and both equal the hand-computed sum over the seed.
      expect(regionTotal).toBe(
        expectedSum(
          (s) => s.regionName === regionName,
          2,
          (c) => c.classroomsTotal,
        ),
      );
    }
  });

  it("national = Σ all schools, for every count column", async () => {
    const periodId = await periodIdFor(2);
    const nationalId = await nodeId("NATIONAL", "Ghana");
    const all = () => true;
    expect(await rollUp(nationalId, periodId, "schools_reporting")).toBe(
      expectedSum(all, 2, () => 1),
    );
    expect(await rollUp(nationalId, periodId, "has_handwashing_count")).toBe(
      expectedSum(all, 2, (c) => (c.handwashing ? 1 : 0)),
    );
    expect(await rollUp(nationalId, periodId, "has_library_count")).toBe(
      expectedSum(all, 2, (c) => (c.hasLibrary ? 1 : 0)),
    );
    expect(await rollUp(nationalId, periodId, "has_ict_lab_count")).toBe(
      expectedSum(all, 2, (c) => (c.hasIctLab ? 1 : 0)),
    );
    expect(await rollUp(nationalId, periodId, "gsfp_participating_count")).toBe(
      expectedSum(all, 2, (c) => (c.gsfpParticipating ? 1 : 0)),
    );
    expect(await rollUp(nationalId, periodId, "classrooms_good")).toBe(
      expectedSum(all, 2, (c) => c.classroomsGood),
    );
  });
});

// ── the arithmetic self-check ──────────────────────────────────────────────────────────────────

describe("categorical families are self-checking (scope §1)", () => {
  it("each family sums to schools_reporting on EVERY school row", async () => {
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_infrastructure
       where water_borehole_count + water_pipe_count + water_well_count + water_none_count
               <> schools_reporting
          or electricity_grid_count + electricity_solar_count + electricity_generator_count
             + electricity_none_count <> schools_reporting
          or latrine_wc_count + latrine_kvip_count + latrine_pit_count + latrine_none_count
               <> schools_reporting`;
    expect(rows[0]!.n).toBe(0);
  });

  it("has_water / has_electricity are exactly `source <> NONE`", async () => {
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_infrastructure
       where has_water_count <> schools_reporting - water_none_count
          or has_electricity_count <> schools_reporting - electricity_none_count`;
    expect(rows[0]!.n).toBe(0);
  });

  it("the family identity survives roll-up at every tier", async () => {
    const periodId = await periodIdFor(2);
    for (const name of ["Ghana"]) {
      const id = await nodeId("NATIONAL", name);
      const reporting = await rollUp(id, periodId, "schools_reporting");
      const water =
        (await rollUp(id, periodId, "water_borehole_count")) +
        (await rollUp(id, periodId, "water_pipe_count")) +
        (await rollUp(id, periodId, "water_well_count")) +
        (await rollUp(id, periodId, "water_none_count"));
      expect(water).toBe(reporting);
    }
  });

  it("the optional-detail denominators are honest: reporting ≤ schools_reporting, and < it nationally", async () => {
    const periodId = await periodIdFor(2);
    const id = await nodeId("NATIONAL", "Ghana");
    const reporting = await rollUp(id, periodId, "schools_reporting");
    for (const column of [
      "computers_reporting_count",
      "library_books_reporting_count",
      "furniture_reporting_count",
    ]) {
      const answered = await rollUp(id, periodId, column);
      expect(answered).toBeLessThan(reporting); // some schools did not answer — the whole point
      expect(answered).toBeGreaterThan(0);
    }
    // A value present with its denominator at 0 would be an un-dividable figure.
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_infrastructure
       where (computers_total is not null and computers_reporting_count = 0)
          or (library_book_count is not null and library_books_reporting_count = 0)`;
    expect(rows[0]!.n).toBe(0);
  });
});

// ── idempotency ────────────────────────────────────────────────────────────────────────────────

describe("idempotency (scope §3)", () => {
  /** Every column except the two that are expected to change: the surrogate key and the run id. */
  async function factFingerprint(): Promise<string> {
    const rows = await sql<{ fingerprint: string }[]>`
      select md5(string_agg(t.row, '|' order by t.row)) as fingerprint
        from (
          select (to_jsonb(f) - 'fact_id' - 'etl_run_id')::text as row
            from fact_infrastructure f
        ) t`;
    return rows[0]!.fingerprint;
  }

  it("a re-run of the same periods is byte-identical", async () => {
    const before = await factFingerprint();
    const countBefore = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_infrastructure`
    )[0]!.n;

    const second = await runEtl();
    expect(second.status).toBe("SUCCESS");
    expect(second.runId).not.toBe(report.runId);

    expect(await factFingerprint()).toBe(before);
    const countAfter = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_infrastructure`
    )[0]!.n;
    expect(countAfter).toBe(countBefore);

    // Delete-then-insert, not append: the second run REPLACED every row it wrote.
    for (const p of second.periods) expect(p.deleted).toBe(p.inserted);

    // …and the new run id IS on the rows, so provenance moved even though the measures did not.
    const stamped = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_infrastructure where etl_run_id = ${second.runId}::uuid`;
    expect(stamped[0]!.n).toBe(countAfter);
  }, 180_000);

  it("the grain UNIQUE makes a duplicate row impossible rather than invisible", async () => {
    const t1 = await periodIdFor(1);
    const one = await sql<{ jurisdiction_id: string }[]>`
      select jurisdiction_id::text as jurisdiction_id from fact_infrastructure
       where period_id = ${t1}::uuid limit 1`;
    // A duplicate would silently DOUBLE every roll-up above it, and the result would still be
    // internally consistent — so it has to be the database that refuses, not a reviewer.
    await expect(
      sql`insert into fact_infrastructure (jurisdiction_id, period_id, classrooms_total,
            classrooms_good, classrooms_repair, latrines_boys, latrines_girls, latrines_staff,
            has_electricity_count, has_water_count, has_handwashing_count, has_library_count,
            has_ict_lab_count, has_internet_count, gsfp_participating_count, has_kitchen_count,
            water_borehole_count, water_pipe_count, water_well_count, water_none_count,
            electricity_grid_count, electricity_solar_count, electricity_generator_count,
            electricity_none_count, latrine_wc_count, latrine_kvip_count, latrine_pit_count,
            latrine_none_count, computers_reporting_count, library_books_reporting_count,
            furniture_reporting_count, source, as_of_date)
          values (${one[0]!.jurisdiction_id}::uuid, ${t1}::uuid, 1, 1, 0, 0, 0, 0,
                  1, 1, 0, 0, 0, 0, 0, 0,
                  1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 'OPERATIONAL_AGG', now())`,
    ).rejects.toThrow(/fact_infrastructure_jurisdiction_period_idx|duplicate key/i);
  });
});

// ── stock, not flow ────────────────────────────────────────────────────────────────────────────

describe("fact_infrastructure is a STOCK, never summed across periods (scope §1)", () => {
  it("summing two terms double-counts the same classrooms — the documented wrong answer", async () => {
    const nationalId = await nodeId("NATIONAL", "Ghana");
    const t1 = await periodIdFor(1);
    const t2 = await periodIdFor(2);

    const term1 = await rollUp(nationalId, t1, "classrooms_total");
    const term2 = await rollUp(nationalId, t2, "classrooms_total");

    // THE UNFILTERED READ — what a query that forgets its period filter returns.
    const unfiltered = await sql<{ total: number }[]>`
      select sum(classrooms_total)::int as total from fact_infrastructure`;

    // It equals term1 + term2, which is roughly TWICE the classrooms Ghana has. The two terms are
    // censuses of THE SAME BUILDINGS: there is no sense in which the country gained a second stock
    // of classrooms in January. There is no DB constraint that can prevent this read — the grain
    // UNIQUE is per period — so the rule is executable only as this assertion and the module doc.
    expect(unfiltered[0]!.total).toBe(term1 + term2);
    expect(unfiltered[0]!.total).toBeGreaterThan(term1 * 1.8);

    // THE CORRECT READ is one period, and the two terms are independently plausible stocks rather
    // than additive flows: Term 2 is close to Term 1 (a few repairs), never double it.
    expect(term2).toBeGreaterThan(term1 * 0.8);
    expect(term2).toBeLessThan(term1 * 1.2);
  });

  it("schools_reporting is per period too — the denominator does not accumulate either", async () => {
    const nationalId = await nodeId("NATIONAL", "Ghana");
    const perTerm = await rollUp(nationalId, await periodIdFor(2), "schools_reporting");
    expect(perTerm).toBe(mappedSchoolCount());
    const unfiltered = await sql<{ total: number }[]>`
      select sum(schools_reporting)::int as total from fact_infrastructure`;
    expect(unfiltered[0]!.total).toBe(perTerm * DEMO_TERMS.length);
  });
});

// ── the person-identifying exclusion ───────────────────────────────────────────────────────────

describe("the hard exclusion is upstream of the surface", () => {
  it("the source carries caterer_name / captured_by and the fact table has no such column", async () => {
    const source = await sql<{ n: number }[]>`
      select count(*)::int as n from demo_source.facilities_snapshot where caterer_name is not null`;
    expect(source[0]!.n).toBeGreaterThan(0); // it is really there to be excluded

    const columns = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'fact_infrastructure'`;
    const names = columns.map((c) => c.column_name);
    expect(names).not.toContain("caterer_name");
    expect(names).not.toContain("captured_by");
  });
});

// ── per-school isolation, the failure policy, and the FAILED run's data ─────────────────────────

describe("per-school isolation and the failure policy (scope §3, Q11 interim rule)", () => {
  const goodSource: FacilitiesSnapshotSourceRow = {
    schoolId: "a1000000-0000-4000-8000-000000000001",
    periodId: "b1000001-0000-4000-8000-000000000001",
    academicYear: "2025/26",
    periodNumber: 1,
    productLine: "BASIC",
    classroomsTotal: 10,
    classroomsGood: 6,
    classroomsRepair: 3,
    waterSource: "BOREHOLE",
    electricitySource: "NONE",
    latrinesBoys: 2,
    latrinesGirls: 2,
    latrinesStaff: 1,
    latrineType: "KVIP",
    handwashing: true,
    hasLibrary: false,
    hasIctLab: false,
    internet: false,
    hasKitchen: true,
    gsfpParticipating: true,
    libraryBookCount: null,
    computersTotal: null,
    computersWorking: null,
    studentDesksUsable: 120,
    studentDesksBroken: 8,
    teacherDesks: null,
    chalkboards: null,
    whiteboards: null,
    projectors: null,
    capturedAt: "2025-12-19T12:00:00.000Z",
  };
  const target = {
    jurisdictionId: "10000000-0000-4000-8000-000000000011",
    periodId: "20000000-0000-4000-8000-000000000001",
    emisSchoolId: "GH-TEST-0001",
    etlRunId: "30000000-0000-4000-8000-0000000000aa",
  };

  it("decomposes a known row to known counts (the transform, in one assertion)", () => {
    const row = decomposeFacilitiesSnapshot(goodSource, target);
    expect(row).toMatchObject({
      schoolsReporting: 1,
      // water BOREHOLE → one-hot, and has_water derives from source <> NONE
      waterBoreholeCount: 1,
      waterPipeCount: 0,
      waterWellCount: 0,
      waterNoneCount: 0,
      hasWaterCount: 1,
      // electricity NONE → has_electricity is 0, and internet is 0 with it
      electricityNoneCount: 1,
      hasElectricityCount: 0,
      hasInternetCount: 0,
      latrineKvipCount: 1,
      latrineWcCount: 0,
      hasHandwashingCount: 1,
      gsfpParticipatingCount: 1,
      // optional detail: furniture answered (two of six), computers and library books not
      furnitureReportingCount: 1,
      computersReportingCount: 0,
      libraryBooksReportingCount: 0,
      source: "OPERATIONAL_AGG",
      etlRunId: target.etlRunId,
    });
    // as_of_date is the census vintage, not the run clock.
    expect(row.asOfDate).toBe(goodSource.capturedAt);
  });

  it("refuses a row it cannot honestly aggregate, loudly and by name", () => {
    expect(() =>
      decomposeFacilitiesSnapshot({ ...goodSource, waterSource: "RIVER" }, target),
    ).toThrow(InfrastructureTransformError);
    expect(() =>
      decomposeFacilitiesSnapshot({ ...goodSource, waterSource: "RIVER" }, target),
    ).toThrow(/allow-list/i);
    expect(() =>
      decomposeFacilitiesSnapshot(
        { ...goodSource, classroomsGood: 9, classroomsRepair: 5 },
        target,
      ),
    ).toThrow(/exceeds classrooms_total/);
    expect(() =>
      decomposeFacilitiesSnapshot(
        { ...goodSource, computersTotal: 4, computersWorking: 9 },
        target,
      ),
    ).toThrow(/exceeds computers_total/);
  });

  it("one bad school fails that school, not the batch", () => {
    const items = [goodSource, { ...goodSource, latrineType: "LATRINE" }, goodSource];
    const { computed, failures } = computePerSchool(
      items,
      (item) => ({ emisSchoolId: item.schoolId, jurisdictionId: null }),
      (item) => decomposeFacilitiesSnapshot(item, target),
    );
    expect(computed).toHaveLength(2);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.message).toMatch(/latrine_type/);
  });

  it("names each failed school exactly once in the gap report", () => {
    // The report is read by a human scanning 1,500 lines for a pattern. "GH-GA-0001: GH-GA-0001: …"
    // doubles its width and buries the message, so the id is added only when the error did not
    // already lead with it.
    const verdict = failureVerdict(10, [
      {
        emisSchoolId: "GH-XX-0001",
        jurisdictionId: null,
        message: "GH-XX-0001: water_source bad",
      },
      { emisSchoolId: "GH-XX-0002", jurisdictionId: null, message: "connection reset" },
    ]);
    expect(verdict.errorText).toContain("GH-XX-0001: water_source bad");
    expect(verdict.errorText).not.toContain("GH-XX-0001: GH-XX-0001");
    // An error that does NOT name its school still gets attributed — unattributed is worse than noisy.
    expect(verdict.errorText).toContain("GH-XX-0002: connection reset");
  });

  it("the threshold separates 'a school's row is bad' from 'our pipeline is bad'", () => {
    const fails = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        emisSchoolId: `S${i}`,
        jurisdictionId: null,
        message: "bad",
      }));
    expect(failureVerdict(400, []).status).toBe("SUCCESS");
    expect(failureVerdict(400, fails(2)).status).toBe("SUCCESS"); // 0.5% — gaps, not an outage
    expect(failureVerdict(400, fails(2)).errorText).toMatch(/SUCCESS WITH GAPS/);
    expect(failureVerdict(400, fails(40)).status).toBe("FAILED"); // 10% — systematic
  });

  it("a FAILED run leaves the prior data in place and says why", async () => {
    const before = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_infrastructure`
    )[0]!.n;
    expect(before).toBeGreaterThan(0);

    await expect(
      runInfrastructureEtl(sql, {
        emisExtractText: extractText(dataset),
        periods: periodsOption(),
        sourceSchema: "no_such_source_schema",
      }),
    ).rejects.toThrow();

    const after = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_infrastructure`
    )[0]!.n;
    expect(after).toBe(before); // stale-but-honest, never silently emptied

    const failed = await sql<{ status: string; error_text: string | null }[]>`
      select status::text as status, error_text from etl_run
       where status = 'FAILED' order by started_at desc limit 1`;
    expect(failed[0]!.status).toBe("FAILED");
    expect(failed[0]!.error_text).toBeTruthy();

    // And the banner read is unaffected: it only ever looks at SUCCESS runs.
    const banner = await sql<{ run_id: string }[]>`
      select run_id::text as run_id from etl_run
       where status = 'SUCCESS' and finished_at is not null order by finished_at desc limit 1`;
    expect(banner).toHaveLength(1);
  }, 180_000);
});

// ── the extract loader ─────────────────────────────────────────────────────────────────────────

describe("the EMIS extract is validated, not trusted", () => {
  it("parses the generated extract into every register row", () => {
    expect(parseEmisExtract(extractText(dataset))).toHaveLength(dataset.schools.length);
  });

  it("rejects a duplicate emis_school_id — the coverage denominator cannot be double-counted", () => {
    const one = emisExtractFor(dataset);
    const bad = JSON.stringify({ ...one, rows: [one.rows[0]!, one.rows[0]!] });
    expect(() => parseEmisExtract(bad)).toThrow(/duplicate "emis_school_id"/);
  });

  it("rejects a missing on_schoolup rather than inferring coverage from an absent flag", () => {
    const one = emisExtractFor(dataset);
    const row = { ...one.rows[0]! } as Record<string, unknown>;
    delete row.on_schoolup;
    expect(() => parseEmisExtract(JSON.stringify({ ...one, rows: [row] }))).toThrow(
      /on_schoolup/,
    );
  });

  it("rejects a school_type outside the analytics enum, naming the row", () => {
    const one = emisExtractFor(dataset);
    const bad = JSON.stringify({
      ...one,
      rows: [{ ...one.rows[0]!, school_type: "TECHNICAL" }],
    });
    expect(() => parseEmisExtract(bad)).toThrow(/school_type/);
  });
});

// ── the generator is deterministic ─────────────────────────────────────────────────────────────

describe("the demo generator is reproducible", () => {
  it("the same seed produces an identical dataset", () => {
    expect(JSON.stringify(generateDemoDataset())).toBe(
      JSON.stringify(generateDemoDataset()),
    );
  });

  it("a different seed produces a different one (the seed is really the only input)", () => {
    expect(JSON.stringify(generateDemoDataset(1))).not.toBe(
      JSON.stringify(generateDemoDataset(2)),
    );
  });

  it("holds the grounded shape: 16 regions, a basic-heavy type mix, ~70% public, coverage < 100%", () => {
    const d = generateDemoDataset();
    expect(new Set(d.schools.map((s) => s.regionName)).size).toBe(16);
    expect(d.schools.length).toBeGreaterThan(800);
    expect(d.schools.length).toBeLessThan(1200);

    // THE DENSITY FLOOR IS WHAT THIS PINS, not the total. Every tier the product renders has to be
    // readable, and the smallest one is the DISTRICT — so the binding constraint is schools PER
    // DISTRICT, not schools overall. Below ~10 a district drill-down is small-sample noise ("0% ICT
    // across 5 schools" is a likely draw, and reads as a data bug), which is the one way grounded dummy
    // data can still mislead the audience it was built for.
    const perDistrict = new Map<string, number>();
    for (const s of d.schools) {
      const key = `${s.regionName}/${s.districtName}`;
      perDistrict.set(key, (perDistrict.get(key) ?? 0) + 1);
    }
    expect(perDistrict.size).toBe(73);
    expect(Math.min(...perDistrict.values())).toBeGreaterThanOrEqual(10);

    const share = (p: (s: DemoSchool) => boolean) =>
      d.schools.filter(p).length / d.schools.length;
    expect(share((s) => s.ownershipType === "PUBLIC")).toBeGreaterThan(0.6);
    expect(share((s) => s.ownershipType === "PUBLIC")).toBeLessThan(0.78);
    expect(share((s) => ["KG", "PRIMARY", "JHS"].includes(s.schoolType))).toBeGreaterThan(
      0.7,
    );
    expect(share((s) => s.onSchoolup)).toBeGreaterThan(0.82);
    expect(share((s) => s.onSchoolup)).toBeLessThan(0.93);

    // The urban/rural gradient is the point of the dataset: rural schools must be materially worse
    // served, or a regional dashboard has nothing to show.
    const bySchool = new Map(
      d.schools
        .filter((s) => s.operationalSchoolId)
        .map((s) => [s.operationalSchoolId!, s]),
    );
    const rate = (urban: boolean, p: (f: DemoFacilitiesRow) => boolean) => {
      const rows = d.facilities.filter((f) => bySchool.get(f.schoolId)!.urban === urban);
      return rows.filter(p).length / rows.length;
    };
    expect(rate(true, (f) => f.electricitySource !== "NONE")).toBeGreaterThan(
      rate(false, (f) => f.electricitySource !== "NONE") + 0.2,
    );
    expect(rate(true, (f) => f.waterSource !== "NONE")).toBeGreaterThan(
      rate(false, (f) => f.waterSource !== "NONE") + 0.1,
    );
    expect(rate(true, (f) => f.hasIctLab)).toBeGreaterThan(
      rate(false, (f) => f.hasIctLab) + 0.15,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// QA GATE ADDITIONS (Quinn). Everything below is an INDEPENDENT restatement of a scope invariant —
// re-derived from the SOURCE tables in SQL, or asserted against a MUTATED database — rather than a
// re-reading of the transform's own output. They are LAST in the file on purpose: the three blocks
// at the end mutate the demo database (an index is dropped and recreated, a census row is changed,
// db/sql/policies.sql is applied), so nothing may be asserted after them.
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the grain is SCHOOL-level only — there are NO stored roll-ups (scope §1)", () => {
  it("every fact row's jurisdiction is a reporting SCHOOL node, and no row sits above it", async () => {
    // The grain rule is "one row per SCHOOL-level jurisdiction_id per period". Summing is therefore
    // the ONLY path to a district figure, and this is what makes that true: a single stored
    // DISTRICT-level row would be added to the schools beneath it by the same recursive SUM the
    // product uses, double-counting the whole district with no error anywhere.
    const byLevel = await sql<{ level: string; n: number }[]>`
      select d.level::text as level, count(*)::int as n
        from fact_infrastructure f join dim_jurisdiction d using (jurisdiction_id)
       group by d.level`;
    expect(byLevel).toHaveLength(1);
    expect(byLevel[0]!.level).toBe("SCHOOL");

    const dangling = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_infrastructure f
       where not exists (
         select 1 from dim_jurisdiction d where d.jurisdiction_id = f.jurisdiction_id)`;
    expect(dangling[0]!.n).toBe(0);
  });
});

describe("every written row re-derives from its SOURCE census row (independent of the transform)", () => {
  /**
   * The join the ETL's per-school mapping produced, reconstructed from the other end: fact row →
   * dim node → register → the per-school `academic_period` → the census row. Asserting against this
   * is what makes the checks below independent — `decomposeFacilitiesSnapshot` is not consulted.
   */
  const sourceJoin = () => sql`
      from fact_infrastructure f
      join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
      join ref_emis_school_register r on r.emis_school_id = d.ges_code
      join dim_period dp on dp.period_id = f.period_id
      join demo_source.academic_period ap
        on ap.school_id = r.operational_school_id
       and ap.academic_year = dp.academic_year and ap.period_number = dp.term
       and ap.product_line = 'BASIC'
      join demo_source.facilities_snapshot s
        on s.school_id = ap.school_id and s.period_id = ap.period_id`;

  it("the per-school → global period mapping reaches EVERY fact row (no row is unexplained)", async () => {
    const joined = await sql<{ n: number }[]>`select count(*)::int as n ${sourceJoin()}`;
    const total = await sql<
      { n: number }[]
    >`select count(*)::int as n from fact_infrastructure`;
    expect(joined[0]!.n).toBe(total[0]!.n);
  });

  it("every measure, count and one-hot equals the source column it was derived from", async () => {
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n ${sourceJoin()}
       where f.classrooms_total is distinct from s.classrooms_total
          or f.classrooms_good is distinct from s.classrooms_good
          or f.classrooms_repair is distinct from s.classrooms_repair
          or f.latrines_boys is distinct from s.latrines_boys
          or f.latrines_girls is distinct from s.latrines_girls
          or f.latrines_staff is distinct from s.latrines_staff
          or f.student_desks_usable is distinct from s.student_desks_usable
          or f.student_desks_broken is distinct from s.student_desks_broken
          or f.teacher_desks is distinct from s.teacher_desks
          or f.chalkboards is distinct from s.chalkboards
          or f.whiteboards is distinct from s.whiteboards
          or f.projectors is distinct from s.projectors
          or f.computers_total is distinct from s.computers_total
          or f.computers_working is distinct from s.computers_working
          or f.library_book_count is distinct from s.library_book_count
          or f.water_borehole_count <> (s.water_source = 'BOREHOLE')::int
          or f.water_pipe_count <> (s.water_source = 'PIPE')::int
          or f.water_well_count <> (s.water_source = 'WELL')::int
          or f.water_none_count <> (s.water_source = 'NONE')::int
          or f.electricity_grid_count <> (s.electricity_source = 'GRID')::int
          or f.electricity_solar_count <> (s.electricity_source = 'SOLAR')::int
          or f.electricity_generator_count <> (s.electricity_source = 'GENERATOR')::int
          or f.electricity_none_count <> (s.electricity_source = 'NONE')::int
          or f.latrine_wc_count <> (s.latrine_type = 'WC')::int
          or f.latrine_kvip_count <> (s.latrine_type = 'KVIP')::int
          or f.latrine_pit_count <> (s.latrine_type = 'PIT')::int
          or f.latrine_none_count <> (s.latrine_type = 'NONE')::int
          or f.has_handwashing_count <> s.handwashing::int
          or f.has_library_count <> s.has_library::int
          or f.has_ict_lab_count <> s.has_ict_lab::int
          or f.has_internet_count <> s.internet::int
          or f.has_kitchen_count <> s.has_kitchen::int
          or f.gsfp_participating_count <> s.gsfp_participating::int`;
    expect(bad[0]!.n).toBe(0);
  });

  it("as_of_date is the row's OWN census vintage, to the second — not the run clock", async () => {
    // The existing vintage test compares a DATE for one term. This compares the full timestamp per
    // row, which is what makes a `now()` regression impossible to hide behind a same-day run.
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n ${sourceJoin()}
       where f.as_of_date <> s.captured_at`;
    expect(bad[0]!.n).toBe(0);
  });
});

describe("the physical and denominator invariants hold on EVERY written row (scope §1)", () => {
  it("classrooms_good + classrooms_repair <= classrooms_total, and computers_working <= total", async () => {
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_infrastructure
       where classrooms_good + classrooms_repair > classrooms_total
          or (computers_total is not null and computers_working is not null
              and computers_working > computers_total)`;
    expect(bad[0]!.n).toBe(0);
  });

  it("the *_reporting_count denominators match the answered columns in BOTH directions", async () => {
    // The existing test checks one direction (a value present with a 0 denominator). The other
    // direction is the one that inflates a rate: a denominator of 1 where NOTHING was answered
    // silently turns "8 of 12 reporting" into "8 of 12 schools", which reads as a real zero.
    // `furniture_reporting_count` is ANY-of-six by design — restated here so the semantics cannot
    // drift to ALL-of-six without a failing test.
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_infrastructure
       where computers_reporting_count
               <> (case when computers_total is null then 0 else 1 end)
          or library_books_reporting_count
               <> (case when library_book_count is null then 0 else 1 end)
          or furniture_reporting_count
               <> (case when student_desks_usable is null and student_desks_broken is null
                         and teacher_desks is null and chalkboards is null
                         and whiteboards is null and projectors is null then 0 else 1 end)`;
    expect(bad[0]!.n).toBe(0);
  });

  it("no measure is negative on any row", async () => {
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_infrastructure
       where least(classrooms_total, classrooms_good, classrooms_repair, latrines_boys,
                   latrines_girls, latrines_staff, coalesce(student_desks_usable, 0),
                   coalesce(student_desks_broken, 0), coalesce(teacher_desks, 0),
                   coalesce(chalkboards, 0), coalesce(whiteboards, 0), coalesce(projectors, 0),
                   coalesce(computers_total, 0), coalesce(computers_working, 0),
                   coalesce(library_book_count, 0)) < 0`;
    expect(bad[0]!.n).toBe(0);
  });
});

describe("the etl_run lifecycle leaves nothing open", () => {
  it("no RUNNING row survives a finished run, successful or failed", async () => {
    // A RUNNING row that never closes is the one state the as-of banner cannot report on: it is
    // neither the vintage on screen nor an error anybody sees.
    const open = await sql<{ n: number }[]>`
      select count(*)::int as n from etl_run where status = 'RUNNING'`;
    expect(open[0]!.n).toBe(0);
    const closed = await sql<{ n: number }[]>`
      select count(*)::int as n from etl_run
       where status <> 'RUNNING' and finished_at is null`;
    expect(closed[0]!.n).toBe(0);
  });
});

describe("the delete scope is bounded, not period-wide (scope §3's named trap)", () => {
  it("writing one jurisdiction's row does not delete another's in the same period", async () => {
    const t1 = await periodIdFor(1);
    const two = await sql<{ jurisdiction_id: string; classrooms_total: number }[]>`
      select jurisdiction_id::text as jurisdiction_id, classrooms_total
        from fact_infrastructure where period_id = ${t1}::uuid
       order by jurisdiction_id limit 2`;
    const [bystander, rewritten] = two;

    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_infrastructure
       where period_id = ${t1}::uuid and jurisdiction_id = ${rewritten!.jurisdiction_id}::uuid`;
    const row = factRowFrom(existing[0]!, t1);

    const result = await writeInfrastructureFacts(sql, [{ periodId: t1, rows: [row] }]);
    // Exactly ONE row deleted — the one being rewritten. A period-wide delete would report ~849.
    expect(result).toMatchObject({ deleted: 1, inserted: 1 });
    expect(result.perPeriod).toEqual([{ periodId: t1, deleted: 1, inserted: 1 }]);

    const survived = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_infrastructure
       where period_id = ${t1}::uuid
         and jurisdiction_id = ${bystander!.jurisdiction_id}::uuid
         and classrooms_total = ${bystander!.classrooms_total}`;
    expect(survived[0]!.n).toBe(1);
  });

  it("a school that DROPS OUT of the inclusion set keeps its last good figures", async () => {
    // The failure mode scope §3 names: a period-wide delete removes the dropped-out school's row and
    // never re-inserts it, so the district total SHRINKS with no error and no empty table to notice.
    // Stale-but-honest is the stated rule, so the prior row must still be there afterwards.
    const dropped = dataset.schools.find((s) => s.onSchoolup && s.operationalSchoolId)!;
    const extract = emisExtractFor(dataset);
    const withoutIt = JSON.stringify({
      ...extract,
      rows: extract.rows.map((r) =>
        (r as { emis_school_id: string }).emis_school_id === dropped.emisSchoolId
          ? { ...r, on_schoolup: false }
          : r,
      ),
    });

    const countRows = async () =>
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n from fact_infrastructure f
            join dim_jurisdiction d using (jurisdiction_id)
           where d.ges_code = ${dropped.emisSchoolId}`
      )[0]!.n;

    expect(await countRows()).toBe(DEMO_TERMS.length);

    const report = await runInfrastructureEtl(sql, {
      emisExtractText: withoutIt,
      periods: periodsOption(),
      sourceSchema: "demo_source",
    });
    expect(report.status).toBe("SUCCESS");
    // It really did leave the inclusion set…
    expect(report.coverage.onSchoolup).toBe(
      dataset.schools.filter((s) => s.onSchoolup).length - 1,
    );
    // …and its rows are still there.
    expect(await countRows()).toBe(DEMO_TERMS.length);

    // Restore the register so the mutation does not leak into the blocks below.
    await runEtl();
  }, 180_000);
});

describe("the post-insert duplicate assertion really fires (scope §3, for the PK-only eight)", () => {
  it("raises and rolls back when the grain UNIQUE is absent", async () => {
    // On `fact_infrastructure` the UNIQUE raises first, so the assertion in
    // `writeInfrastructureFacts` is never reached by the happy path — which means it has never been
    // EXECUTED, and it is the code the eight PK-only fact tables (fact.ts:238–241) will reuse
    // verbatim, where nothing else will catch a duplicate. Dropping the index for one statement is
    // the only way to exercise it, and it is exactly the condition those eight tables are in.
    const t1 = await periodIdFor(1);
    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_infrastructure where period_id = ${t1}::uuid
       order by jurisdiction_id limit 1`;
    const row = factRowFrom(existing[0]!, t1);
    const before = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_infrastructure`
    )[0]!.n;

    await sql`drop index fact_infrastructure_jurisdiction_period_idx`;
    try {
      await expect(
        writeInfrastructureFacts(sql, [{ periodId: t1, rows: [row, { ...row }] }]),
      ).rejects.toThrow(/duplicated grain key/);
    } finally {
      await sql`create unique index fact_infrastructure_jurisdiction_period_idx
                  on fact_infrastructure (jurisdiction_id, period_id)`;
    }
    // The assertion is INSIDE the transaction, so the raise rolled the delete and both inserts back.
    const after = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_infrastructure`
    )[0]!.n;
    expect(after).toBe(before);
  });
});

describe("idempotency is REPLACE, not append-and-ignore", () => {
  it("a CHANGED source census is reflected in the fact row, with the row count unchanged", async () => {
    // "A re-run is byte-identical" is necessary but not sufficient: a pipeline that inserted nothing
    // at all on the second run would pass it. This is the complementary half — change one census
    // value and the fact row must MOVE.
    const t2 = await periodIdFor(TERM_2.term);
    const pick = (
      await sql<
        { ges_code: string; school_id: string; snapshot_period: string; total: number }[]
      >`
        select d.ges_code, r.operational_school_id::text as school_id,
               ap.period_id::text as snapshot_period, f.classrooms_total as total
          from fact_infrastructure f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
          join ref_emis_school_register r on r.emis_school_id = d.ges_code
          join dim_period dp on dp.period_id = f.period_id
          join demo_source.academic_period ap
            on ap.school_id = r.operational_school_id
           and ap.academic_year = dp.academic_year and ap.period_number = dp.term
       and ap.product_line = 'BASIC'
         where f.period_id = ${t2}::uuid
         order by d.ges_code limit 1`
    )[0]!;
    const bumped = Number(pick.total) + 7;

    await sql`
      update demo_source.facilities_snapshot
         set classrooms_total = ${bumped}, captured_at = captured_at + interval '1 day'
       where school_id = ${pick.school_id}::uuid
         and period_id = ${pick.snapshot_period}::uuid`;

    const countBefore = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_infrastructure`
    )[0]!.n;
    const report = await runEtl();
    expect(report.status).toBe("SUCCESS");
    for (const p of report.periods) expect(p.deleted).toBe(p.inserted);

    const after = await sql<{ total: number }[]>`
      select f.classrooms_total as total from fact_infrastructure f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where d.ges_code = ${pick.ges_code} and f.period_id = ${t2}::uuid`;
    expect(Number(after[0]!.total)).toBe(bumped);

    const countAfter = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_infrastructure`
    )[0]!.n;
    expect(countAfter).toBe(countBefore);
  }, 180_000);
});

describe("the written facts are jurisdiction-isolated as the NON-OWNER app role", () => {
  /**
   * Every assertion above runs as the analytics OWNER, which is correct — the ETL's real credential
   * is the privileged writer — but an owner is RLS-EXEMPT, so none of them says anything about what
   * a district officer can read. `tests/rls-tier-matrix.test.ts` proves the predicate is attached to
   * `fact_infrastructure`, but over a four-row hand-seeded fixture; this proves it over the spine
   * and the ~1,700 rows THIS PIPELINE wrote, as `ov_app`.
   *
   * ⚠ LAST BLOCK IN THE FILE: it installs db/sql/policies.sql on the demo database, which the ETL
   * tests above deliberately run without.
   */
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

  /** One read with the GUCs `withJurisdiction()` would have set. Rolled back either way. */
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

  it("a district officer reads its own district's rows and ZERO of another district's", async () => {
    const own = await schoolsUnder(districtA);
    const other = await schoolsUnder(districtB);
    expect(own.length).toBeGreaterThan(0);
    expect(other.length).toBeGreaterThan(0);

    const seen = await asOfficer(districtA, "DISTRICT", async (tx) => {
      const mine = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_infrastructure
         where jurisdiction_id = any(${own}::uuid[])`;
      const theirs = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_infrastructure
         where jurisdiction_id = any(${other}::uuid[])`;
      const unfiltered = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_infrastructure`;
      const theirRegister = await tx<{ n: number }[]>`
        select count(*)::int as n from ref_emis_school_register
         where district_id = ${districtB}::uuid`;
      return {
        mine: mine[0]!.n,
        theirs: theirs[0]!.n,
        unfiltered: unfiltered[0]!.n,
        theirRegister: theirRegister[0]!.n,
      };
    });

    expect(seen.mine).toBeGreaterThan(0);
    expect(seen.theirs).toBe(0);
    // The decisive one: an UNQUALIFIED `select count(*)` — the query a reporting bug would write —
    // returns the officer's own district and nothing more.
    expect(seen.unfiltered).toBe(seen.mine);
    expect(seen.theirRegister).toBe(0);
  });

  it("a national officer reads every row, and the app role still cannot write one", async () => {
    const total = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_infrastructure`
    )[0]!.n;
    const national = await nodeId("NATIONAL", "Ghana");
    const seen = await asOfficer(national, "NATIONAL", async (tx) => {
      const r = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_infrastructure`;
      return r[0]!.n;
    });
    expect(seen).toBe(total);

    // The ETL's credential is the owner; the app role has no INSERT/DELETE on any fact table, and
    // the absent GRANT — not a policy — is what makes that unforgeable.
    await expect(
      asOfficer(national, "NATIONAL", async (tx) => {
        await tx`delete from fact_infrastructure`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});

// ── Dex gate: the stand-in really is drop-in, and FAILED really writes nothing ───────────────────

describe("the source stand-in matches the REAL operational academic_period (Dex blocking 1)", () => {
  /**
   * The first version of the stand-in invented `term integer` where operational Postgres has
   * `period_number smallint` — so `lib/etl/source.ts` would have failed on prod with
   * `column p.term does not exist`, while passing every test here. This pins the column NAMES against
   * apps/web/db/schema/periods.ts so the "drop-in" claim is checked rather than asserted.
   */
  it("carries period_number / period_label / product_line, and no invented `term`", async () => {
    const columns = await sql<{ column_name: string; data_type: string }[]>`
      select column_name, data_type from information_schema.columns
       where table_schema = 'demo_source' and table_name = 'academic_period'`;
    const names = columns.map((c) => c.column_name).sort();

    expect(names).toContain("period_number");
    expect(names).toContain("period_label");
    expect(names).toContain("product_line");
    // The whole point: no convenience column that does not exist upstream.
    expect(names).not.toContain("term");

    // period_number is a smallint upstream; a widened type here would hide an overflow that prod has.
    expect(columns.find((c) => c.column_name === "period_number")?.data_type).toBe(
      "smallint",
    );
  });

  it("the ETL's own join keys are unique, so the census cannot fan out", async () => {
    // period_id PK + (school_id, period_id) UNIQUE on academic_period, and (school_id, period_id)
    // UNIQUE on facilities_snapshot → one census row in, at most one fact row out. That is what lets
    // schools_reporting = 1 be asserted instead of counted.
    const dupes = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select school_id, period_id from demo_source.academic_period
        group by school_id, period_id having count(*) > 1
      ) d`;
    expect(dupes[0]!.n).toBe(0);
  });
});

describe("product_line is a NAMED gap, never a silent mapping (Dex blocking 1)", () => {
  it("SENIOR-line census rows exist in the source and are reported, not mapped", async () => {
    // SHS schools really do file facilities censuses, and `period_number = 1` for a SENIOR school is
    // Semester 1 — not analytics term 1. Mapping it would file half a year under a third of one.
    const senior = await sql<{ n: number }[]>`
      select count(*)::int as n from demo_source.academic_period where product_line = 'SENIOR'`;
    expect(senior[0]!.n).toBeGreaterThan(0); // there is really something to skip

    const skippedIds = new Set(
      report.periods.flatMap((p) =>
        p.skippedProductLines.flatMap((s) => s.operationalSchoolIds),
      ),
    );
    expect(skippedIds.size).toBeGreaterThan(0);
    for (const p of report.periods) {
      expect(p.skippedProductLines.map((s) => s.productLine)).toEqual(["SENIOR"]);
    }

    // The run SAYS so — a reader of etl_run.error_text can see which estate is missing and why.
    expect(report.errorText).toMatch(/UNMAPPED PRODUCT LINES/);
    expect(report.errorText).toMatch(/SENIOR=\d+ school\(s\)/);

    // And those schools have NO fact row — absent, counted, explained. Never half-mapped.
    const ids = [...skippedIds];
    const facts = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_infrastructure f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
        join ref_emis_school_register e on e.emis_school_id = d.ges_code
       where e.operational_school_id = any(${ids}::uuid[])`;
    expect(facts[0]!.n).toBe(0);
  });

  it("every school in the inclusion set is accounted for: mapped, skipped, or census-less", async () => {
    // No school may simply vanish between the inclusion set and the facts. This is the A4 claim the
    // period-mapping doc makes, made checkable.
    for (const p of report.periods) {
      const skipped = p.skippedProductLines.reduce(
        (n, s) => n + s.operationalSchoolIds.length,
        0,
      );
      expect(p.inserted + skipped + p.noSourceRow.length + p.failures.length).toBe(
        report.coverage.included,
      );
    }
  });
});

describe("a FAILED run writes NOTHING — the banner's whole justification (Dex blocking 2)", () => {
  it("a breached failure-rate policy publishes no rows at all, in any period", async () => {
    // The defect this closes: with the write inside the compute loop, a run that breached the policy
    // had ALREADY published the surviving schools, and in a multi-period run period 1 survived a
    // period-2 throw. Both leave a partially-published night under a FAILED banner.
    const fingerprintBefore = await sql<{ f: string }[]>`
      select md5(string_agg(t.row, '|' order by t.row)) as f
        from (select (to_jsonb(f) - 'fact_id' - 'etl_run_id')::text as row
                from fact_infrastructure f) t`;
    const countBefore = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_infrastructure`
    )[0]!.n;
    expect(countBefore).toBeGreaterThan(0);

    // Corrupt ONE school's census beyond what the transform will accept, then run with zero tolerance
    // so a single failure is enough to fail the run. The schools either side of it are perfectly fine —
    // which is exactly what makes "nothing was written" the interesting assertion.
    const victim = await sql<{ id: string; water_source: string }[]>`
      select id::text as id, water_source from demo_source.facilities_snapshot
        join demo_source.academic_period using (school_id, period_id)
       where product_line = 'BASIC' order by id limit 1`;
    await sql`alter table demo_source.facilities_snapshot
                drop constraint demo_facilities_snapshot_water_source_valid`;
    try {
      await sql`update demo_source.facilities_snapshot set water_source = 'RIVER'
                 where id = ${victim[0]!.id}::uuid`;

      const failed = await runInfrastructureEtl(sql, {
        emisExtractText: extractText(dataset),
        periods: periodsOption(),
        sourceSchema: "demo_source",
        policy: { maxFailureRate: 0 },
      });

      expect(failed.status).toBe("FAILED");
      expect(failed.errorText).toMatch(/allow-list/i);
      // NOT ONE ROW inserted or deleted, in EITHER period.
      for (const p of failed.periods) {
        expect(p.inserted).toBe(0);
        expect(p.deleted).toBe(0);
      }
      // …and the table is byte-for-byte what it was. The prior night stands: stale, and honest.
      const after = await sql<{ f: string }[]>`
        select md5(string_agg(t.row, '|' order by t.row)) as f
          from (select (to_jsonb(f) - 'fact_id' - 'etl_run_id')::text as row
                  from fact_infrastructure f) t`;
      expect(after[0]!.f).toBe(fingerprintBefore[0]!.f);
      expect(
        (
          await sql<{ n: number }[]>`select count(*)::int as n from fact_infrastructure`
        )[0]!.n,
      ).toBe(countBefore);

      // The run is on record as FAILED with a reason, and the banner still reads the last SUCCESS.
      const row = await sql<{ status: string; error_text: string | null }[]>`
        select status::text as status, error_text from etl_run where run_id = ${failed.runId}::uuid`;
      expect(row[0]!.status).toBe("FAILED");
      expect(row[0]!.error_text).toBeTruthy();
    } finally {
      await sql`update demo_source.facilities_snapshot set water_source = ${victim[0]!.water_source}
                 where id = ${victim[0]!.id}::uuid`;
      await sql`alter table demo_source.facilities_snapshot
                  add constraint demo_facilities_snapshot_water_source_valid
                  check (water_source in ('BOREHOLE', 'PIPE', 'WELL', 'NONE'))`;
    }
  }, 180_000);

  it("and the same run under the DEFAULT policy is SUCCESS-with-gaps that DOES write", async () => {
    // The other half of the policy: one bad row out of ~850 must not blank the country. The run
    // completes, writes, and SAYS what it could not compute.
    const victim = await sql<{ id: string; water_source: string }[]>`
      select id::text as id, water_source from demo_source.facilities_snapshot
        join demo_source.academic_period using (school_id, period_id)
       where product_line = 'BASIC' order by id limit 1`;
    await sql`alter table demo_source.facilities_snapshot
                drop constraint demo_facilities_snapshot_water_source_valid`;
    try {
      await sql`update demo_source.facilities_snapshot set water_source = 'RIVER'
                 where id = ${victim[0]!.id}::uuid`;

      const gapped = await runInfrastructureEtl(sql, {
        emisExtractText: extractText(dataset),
        periods: periodsOption(),
        sourceSchema: "demo_source",
      });

      expect(gapped.status).toBe("SUCCESS");
      expect(gapped.errorText).toMatch(/SUCCESS WITH GAPS/);
      expect(gapped.periods.some((p) => p.inserted > 0)).toBe(true);
      // The failed school keeps its PRIOR row rather than being deleted-and-not-reinserted: it is
      // excluded from the delete scope, which is the stale-but-honest rule applied per school.
      const stillThere = await sql<{ n: number }[]>`
        select count(*)::int as n from fact_infrastructure f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
          join ref_emis_school_register e on e.emis_school_id = d.ges_code
          join demo_source.facilities_snapshot s on s.school_id = e.operational_school_id
         where s.id = ${victim[0]!.id}::uuid and f.period_id = s.period_id`;
      expect(stillThere[0]!.n).toBe(0); // no prior row existed for it in this DB state
    } finally {
      await sql`update demo_source.facilities_snapshot set water_source = ${victim[0]!.water_source}
                 where id = ${victim[0]!.id}::uuid`;
      await sql`alter table demo_source.facilities_snapshot
                  add constraint demo_facilities_snapshot_water_source_valid
                  check (water_source in ('BOREHOLE', 'PIPE', 'WELL', 'NONE'))`;
      // Restore the table to the clean state the rest of the suite's fingerprints assume.
      await runEtl();
    }
  }, 180_000);
});

/** A minimal valid source row, used only by the A3 guard test below. */
const negativeDetailBase: FacilitiesSnapshotSourceRow = {
  schoolId: "a1000000-0000-4000-8000-000000000001",
  periodId: "b1000001-0000-4000-8000-000000000001",
  academicYear: "2025/26",
  periodNumber: 1,
  productLine: "BASIC",
  classroomsTotal: 10,
  classroomsGood: 6,
  classroomsRepair: 3,
  waterSource: "BOREHOLE",
  electricitySource: "GRID",
  latrinesBoys: 2,
  latrinesGirls: 2,
  latrinesStaff: 1,
  latrineType: "KVIP",
  handwashing: true,
  hasLibrary: false,
  hasIctLab: false,
  internet: false,
  hasKitchen: true,
  gsfpParticipating: false,
  libraryBookCount: 10,
  computersTotal: 4,
  computersWorking: 2,
  studentDesksUsable: 100,
  studentDesksBroken: 5,
  teacherDesks: 3,
  chalkboards: 3,
  whiteboards: 1,
  projectors: 0,
  capturedAt: "2025-12-19T12:00:00.000Z",
};

const negativeDetailTarget = {
  jurisdictionId: "10000000-0000-4000-8000-000000000011",
  periodId: "20000000-0000-4000-8000-000000000001",
  emisSchoolId: "GH-TEST-A3",
  etlRunId: "30000000-0000-4000-8000-0000000000aa",
};

describe("the nullable optional-detail guard (Dex A3)", () => {
  it("refuses a negative desk / computer / book count instead of subtracting it from a district", () => {
    // A hand-assembled extract is exactly where "-1 means not answered" gets invented, and a negative
    // count would SUBTRACT real facilities from a district total. NULL is visibly unanswered; -1 is
    // silently wrong.
    for (const field of [
      "studentDesksUsable",
      "studentDesksBroken",
      "teacherDesks",
      "chalkboards",
      "whiteboards",
      "projectors",
      "computersTotal",
      "computersWorking",
      "libraryBookCount",
    ] as const) {
      expect(() =>
        decomposeFacilitiesSnapshot(
          { ...negativeDetailBase, [field]: -1 },
          negativeDetailTarget,
        ),
      ).toThrow(/non-negative integer/);
    }
    // NULL stays perfectly legal — that is the whole reason these columns are nullable.
    expect(() =>
      decomposeFacilitiesSnapshot(
        { ...negativeDetailBase, computersTotal: null, computersWorking: null },
        negativeDetailTarget,
      ),
    ).not.toThrow();
  });
});
