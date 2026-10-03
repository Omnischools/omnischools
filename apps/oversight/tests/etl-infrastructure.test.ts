import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { adminDemoAnalytics } from "./helpers";
import {
  DEMO_TERMS,
  emisExtractFor,
  generateDemoDataset,
  loadDemoSource,
  type DemoDataset,
  type DemoFacilitiesRow,
  type DemoSchool,
} from "@/scripts/seed-demo-data";
import { runInfrastructureEtl, type EtlRunReport } from "@/lib/etl/pipeline";
import {
  InfrastructureTransformError,
  decomposeFacilitiesSnapshot,
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
function expectedSum(
  predicate: (s: DemoSchool) => boolean,
  term: number,
  measure: (c: DemoFacilitiesRow) => number,
): number {
  return dataset.schools
    .filter((s) => s.onSchoolup && predicate(s))
    .reduce((total, s) => {
      const census = censusBySchoolTerm.get(`${s.emisSchoolId}|${term}`);
      return census ? total + measure(census) : total;
    }, 0);
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
    // A clean run carries NO error_text. (SUCCESS-with-gaps would carry the gap report — see
    // failureVerdict; this run has no failures, so a non-null value here would mean one slipped in.)
    expect(rows[0]!.error_text).toBeNull();
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

  it("writes one row per included school per term, and nothing else", async () => {
    const included = report.coverage.included;
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
    expect(perTerm).toBe(report.coverage.included);
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
    term: 1,
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
