import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { scopeFor, type JurisdictionScope } from "@/lib/db/rls";
import { isOk, type Reading } from "@/lib/oversight/reading";
import {
  getCurrentPeriod,
  getLatestExamCohortPeriod,
  sittingYearOf,
} from "@/lib/oversight/period";
import { getEnrolmentTotal } from "@/lib/oversight/enrolment";
import { getSchoolCoverage } from "@/lib/oversight/coverage";
import { getExamQualification } from "@/lib/oversight/performance";
import { JUR, OFFICER, PERIOD_ID_EXAM_COHORT, PERIOD_ID_TERM } from "./fixtures/ids";
import {
  adminAnalytics,
  districtOfficer,
  nationalOfficer,
  officerFixture,
} from "./helpers";

/**
 * INCREMENT I · SLICE 1 — the National Overview KPI reads, against Kofi's ACs.
 *
 * WHAT THIS FILE IS FOR. Three of the four reads behind this dashboard are a `sum()` whose
 * correctness is not expressible as a DB constraint: `fact_enrolment` and `fact_performance_exam`
 * store TOTALS BESIDE THEIR PARTS, so a query that forgets a filter returns a number that is wrong by
 * a FACTOR and still looks like a plausible national figure. Nothing in the output signals it, no
 * CHECK can catch it, and a reviewer cannot see it either. So each guard is tested by RE-RUNNING the
 * query WITHOUT it (the negative controls below) and asserting the figure moves — which proves the
 * filter is load-bearing rather than decoration. That is the `facilities-read-annual-pin` precedent
 * applied to the three sums.
 *
 * THE FIXTURE DECOYS. The shared analytics fixture (tests/fixtures/analytics-seed.sql) has exactly one
 * clean enrolment row per district and no exam rows at all — nothing to get wrong. This file plants
 * the inflating shapes beside them (MALE/FEMALE rows beside ALL, per-form rows beside the stage total,
 * a second sitting, two non-reporting register rows) in `beforeAll` as the OWNER, and removes them in
 * `afterAll`. It must leave the database as it found it: `tests/rls-tier-matrix.test.ts` asserts
 * GLOBAL counts over `fact_enrolment` and `ref_emis_school_register`, and vitest runs this suite with
 * `fileParallelism: false`, so the clean-up is what keeps those measurements measurements.
 *
 * EVERY READ GOES THROUGH `withJurisdiction()`, so every assertion here is also an RLS assertion: the
 * district officer's total is not "the total filtered in TypeScript", it is the sum of the rows the
 * policy let through. There is no subtree `WHERE` clause in any of the four modules — see the
 * static guard at the bottom.
 */

const districtScope = scopeFor(districtOfficer);
const nationalScope = scopeFor(nationalOfficer);
/** The middle tier — derived from a fixture session so the resolution brand survives (helpers.ts). */
const regionScope: JurisdictionScope = scopeFor(
  officerFixture({
    officerId: OFFICER.regionId,
    officerRole: OFFICER.regionRole,
    jurisdictionId: JUR.region,
    level: "REGION",
  }),
);

/** A SECOND sitting cohort, older than the fixture's. Data rows only — no new DB object. */
const OLDER_EXAM_COHORT = "20000000-0000-4000-8000-0000000000e1";
const TEST_REGISTER_IN = "EMIS-KPI-901";
const TEST_REGISTER_OUT = "EMIS-KPI-902";

let owner: postgres.Sql;

beforeAll(async () => {
  owner = adminAnalytics();

  // ── enrolment decoys, all on the SAME school and the SAME pinned TERM period ──────────────────
  // MALE/FEMALE beside the ALL row (the triple-count shape) and two per-form rows beside the stage
  // total (the double-count shape). The in-district school already carries ALL/null = 410.
  await owner`
    insert into fact_enrolment (jurisdiction_id, period_id, stage, class_form, sex, headcount, source, as_of_date)
    values
      (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_TERM}::uuid, 'JHS', null,     'MALE',   200, 'OPERATIONAL_AGG', now()),
      (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_TERM}::uuid, 'JHS', null,     'FEMALE', 210, 'OPERATIONAL_AGG', now()),
      (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_TERM}::uuid, 'JHS', 'Form 2', 'ALL',    150, 'OPERATIONAL_AGG', now()),
      (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_TERM}::uuid, 'JHS', 'Form 3', 'ALL',    160, 'OPERATIONAL_AGG', now()),
      (${JUR.schoolOutsideSubtree}::uuid,  ${PERIOD_ID_TERM}::uuid, 'JHS', 'Form 2', 'ALL',     90, 'OPERATIONAL_AGG', now())
  `;

  // ── a second, OLDER sitting cohort, so "the latest sitting" is a choice and not the only option ──
  await owner`
    insert into dim_period (period_id, academic_year, term, period_type, starts_on, ends_on, is_current)
    values (${OLDER_EXAM_COHORT}::uuid, '2024/25', null, 'EXAM_COHORT', '2025-05-05', '2025-06-27', false)
  `;

  // ── WASSCE rows. Candidate counts differ by a LOT between the two in-district schools, which is
  // what makes Σ/Σ and avg-of-rates diverge: 80% of 100 beside 20% of 10 is 82/110 = 74.5%, while the
  // unweighted mean of the two stored rates is 50%. The MALE/FEMALE rows are the triple-count decoy.
  await owner`
    insert into fact_performance_exam
      (jurisdiction_id, period_id, exam, sex, candidates, qualified, qualification_rate, source, as_of_date)
    values
      (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_EXAM_COHORT}::uuid, 'WASSCE', 'ALL',    100,  80, 80.00, 'WAEC_EXTRACT', now()),
      (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_EXAM_COHORT}::uuid, 'WASSCE', 'MALE',    50,  40, 80.00, 'WAEC_EXTRACT', now()),
      (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_EXAM_COHORT}::uuid, 'WASSCE', 'FEMALE',  50,  40, 80.00, 'WAEC_EXTRACT', now()),
      (${JUR.schoolPublicNoConsent}::uuid, ${PERIOD_ID_EXAM_COHORT}::uuid, 'WASSCE', 'ALL',     10,   2, 20.00, 'WAEC_EXTRACT', now()),
      (${JUR.schoolOutsideSubtree}::uuid,  ${PERIOD_ID_EXAM_COHORT}::uuid, 'WASSCE', 'ALL',    400, 100, 25.00, 'WAEC_EXTRACT', now()),
      -- The OLDER sitting: different children, absurd values, so summing the two sittings would be
      -- unmistakable in the result rather than a plausible drift.
      (${JUR.schoolPublicConsented}::uuid, ${OLDER_EXAM_COHORT}::uuid,     'WASSCE', 'ALL',   9000,  10,  0.11, 'WAEC_EXTRACT', now())
  `;

  // ── two NON-REPORTING register rows, one each side of the district boundary. Without these every
  // seeded school is on_schoolup, coverage is 100%, and "the denominator is the register" is untested.
  await owner`
    insert into ref_emis_school_register
      (emis_school_id, name, district_id, region_id, school_type, ownership_type, on_schoolup,
       operational_school_id, source, as_of_date)
    values
      (${TEST_REGISTER_IN},  'Not-yet-onboarded JHS (in district)', ${JUR.district}::uuid,      ${JUR.region}::uuid, 'JHS', 'PUBLIC', false, null, 'EMIS_EXTRACT', current_date),
      (${TEST_REGISTER_OUT}, 'Not-yet-onboarded JHS (other)',       ${JUR.otherDistrict}::uuid, ${JUR.region}::uuid, 'JHS', 'PUBLIC', false, null, 'EMIS_EXTRACT', current_date)
  `;
});

afterAll(async () => {
  // Leave the shared fixture exactly as it was found — see THE FIXTURE DECOYS above.
  //
  // EVERY DELETE IS SCOPED TO WHAT THIS FILE INSERTED (Dex's test-cleanup ruling). The first two used
  // to be unqualified / by-SHAPE — "all exam rows", "any row that is sexed or per-form" — which is a
  // clean-up that works only because the seed happens not to contain such rows today. The day
  // analytics-seed.sql grows a per-form or MALE/FEMALE enrolment row, a shape-based delete silently
  // removes fixture data and the file that notices is some other test, three runs later.
  await owner`
    delete from fact_performance_exam
     where period_id in (${PERIOD_ID_EXAM_COHORT}::uuid, ${OLDER_EXAM_COHORT}::uuid)
  `;
  await owner`
    delete from fact_enrolment
     where period_id = ${PERIOD_ID_TERM}::uuid
       and jurisdiction_id in (${JUR.schoolPublicConsented}::uuid, ${JUR.schoolOutsideSubtree}::uuid)
       and (class_form is not null or sex <> 'ALL')
  `;
  await owner`delete from dim_period where period_id = ${OLDER_EXAM_COHORT}::uuid`;
  await owner`delete from ref_emis_school_register where emis_school_id in (${TEST_REGISTER_IN}, ${TEST_REGISTER_OUT})`;
  await owner.end({ timeout: 5 });
});

/** A raw read run with the GUCs `withJurisdiction()` would have set, as the APP role. Rolled back. */
async function asOfficer<T>(
  scope: JurisdictionScope,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const { testDbConfig } = await import("./helpers");
  const app = postgres(testDbConfig.analyticsUrl, { max: 1, prepare: false });
  try {
    let captured: T;
    try {
      await app.begin(async (tx) => {
        await tx`select set_config('app.current_jurisdiction', ${scope.jurisdictionId ?? ""}, true)`;
        await tx`select set_config('app.current_level', ${scope.level}, true)`;
        await tx`select set_config('app.current_officer', ${scope.officerId ?? ""}, true)`;
        captured = await fn(tx as unknown as postgres.TransactionSql);
        throw new Error("__rollback__");
      });
    } catch (err) {
      if ((err as Error).message !== "__rollback__") throw err;
    }
    return captured!;
  } finally {
    await app.end({ timeout: 5 });
  }
}

/** Assert a read succeeded and hand back its value, so a test reads about figures and not states. */
function okValue<T>(reading: Reading<T>): T {
  expect(reading.status).toBe("ok");
  if (!isOk(reading)) throw new Error("expected an `ok` reading, got `unavailable`");
  return reading.value;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (d) THE PERIOD PIN NAMES period_type
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("getCurrentPeriod pins period_type — is_current alone is ambiguous", () => {
  it("TERM and ANNUAL are BOTH is_current for the same year: the pin is the only discriminator", async () => {
    const ambiguous = await asOfficer(districtScope, async (tx) => {
      return (await tx`
        select period_id::text as id, period_type::text as period_type
          from dim_period where is_current = true order by period_type
      `) as unknown as { id: string; period_type: string }[];
    });
    // If this ever returns one row, the ambiguity this module exists for has gone away and the rest
    // of this describe is vacuous — so assert the hazard itself, not just the handling of it.
    expect(ambiguous.map((r) => r.period_type)).toEqual(["ANNUAL", "TERM"]);
  });

  it("asking for TERM returns the TERM row, with its term number", async () => {
    const period = okValue(await getCurrentPeriod(districtScope, "TERM"));
    expect(period.periodId).toBe(PERIOD_ID_TERM);
    expect(period.periodType).toBe("TERM");
    expect(period.term).toBe(2);
  });

  it("asking for ANNUAL returns the OTHER row — same year, same is_current, different period", async () => {
    const annual = okValue(await getCurrentPeriod(districtScope, "ANNUAL"));
    expect(annual.periodType).toBe("ANNUAL");
    expect(annual.term).toBeNull();
    expect(annual.periodId).not.toBe(PERIOD_ID_TERM);
  });

  it("the enrolment total is computed on the TERM period the pin resolved, not the ANNUAL one", async () => {
    const term = okValue(await getCurrentPeriod(districtScope, "TERM"));
    const annual = okValue(await getCurrentPeriod(districtScope, "ANNUAL"));
    const onTerm = await getEnrolmentTotal(districtScope, term.periodId);
    const onAnnual = await getEnrolmentTotal(districtScope, annual.periodId);
    expect(okValue(onTerm).total).toBe(410);
    // No enrolment hangs off the ANNUAL cut: that is "no measurement", NOT a measured zero.
    expect(onAnnual.status).toBe("unavailable");
  });
});

describe("the WASSCE sitting is resolved by latest-with-rows, never by is_current", () => {
  it("no EXAM_COHORT period is is_current — a current-based lookup would never find a sitting", async () => {
    const currentCohorts = await asOfficer(districtScope, async (tx) => {
      return (await tx`
        select count(*)::int as n from dim_period
         where period_type = 'EXAM_COHORT' and is_current = true
      `) as unknown as { n: number }[];
    });
    // This is WHY getCurrentPeriod's type excludes EXAM_COHORT (lib/etl/dimensions.ts: a sitting is
    // never "current"). If it ever becomes non-zero, the resolver below can be simplified.
    expect(Number(currentCohorts[0]!.n)).toBe(0);
  });

  it("resolves the NEWEST sitting that carries WASSCE rows, not the older one", async () => {
    const cohort = okValue(await getLatestExamCohortPeriod(districtScope, "WASSCE"));
    expect(cohort.periodId).toBe(PERIOD_ID_EXAM_COHORT);
    expect(cohort.academicYear).toBe("2025/26");
    expect(cohort.periodType).toBe("EXAM_COHORT");
  });

  it("BECE has no rows in any sitting, so it resolves to nothing rather than to WASSCE's period", async () => {
    // The two exams share the cohort period and are separated only by the fact's `exam` column, so a
    // resolver that looked at dim_period alone would hand the BECE card the WASSCE sitting.
    expect((await getLatestExamCohortPeriod(districtScope, "BECE")).status).toBe(
      "unavailable",
    );
  });

  it("the sitting year is derived from the academic_year, never typed", () => {
    expect(sittingYearOf("2025/26")).toBe(2026);
    expect(sittingYearOf("2024/25")).toBe(2025);
    expect(sittingYearOf("2099/00")).toBe(2100);
    expect(sittingYearOf("not a year")).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (a) ENROLMENT — the two mandatory filters, each proved load-bearing
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("getEnrolmentTotal — sex = 'ALL' and class_form IS NULL are both load-bearing", () => {
  it("the decoy rows really are there, beside the stage total, on the same period and school", async () => {
    const rows = await asOfficer(districtScope, async (tx) => {
      return (await tx`
        select sex::text as sex, class_form, headcount from fact_enrolment
         where jurisdiction_id = ${JUR.schoolPublicConsented}::uuid
           and period_id = ${PERIOD_ID_TERM}::uuid
         order by headcount
      `) as unknown as { sex: string; class_form: string | null; headcount: number }[];
      // ⇒ ALL/null 410, MALE/null 200, FEMALE/null 210, ALL/'Form 2' 150, ALL/'Form 3' 160
    });
    expect(rows).toHaveLength(4 + 1);
    expect(rows.filter((r) => r.sex !== "ALL")).toHaveLength(2);
    expect(rows.filter((r) => r.class_form !== null)).toHaveLength(2);
  });

  it("the total is the stage total alone", async () => {
    const total = okValue(await getEnrolmentTotal(districtScope, PERIOD_ID_TERM));
    expect(total.total).toBe(410);
    expect(total.schoolsCounted).toBe(1);
  });

  it("DROPPING sex = 'ALL' inflates it — the ALL row is stored beside MALE and FEMALE", async () => {
    const inflated = await asOfficer(districtScope, async (tx) => {
      const rows = (await tx`
        select coalesce(sum(headcount), 0)::int as n from fact_enrolment
         where period_id = ${PERIOD_ID_TERM}::uuid and class_form is null
      `) as unknown as { n: number }[];
      return Number(rows[0]!.n);
    });
    expect(inflated).toBe(410 + 200 + 210);
    expect(inflated).toBeGreaterThan(410);
  });

  it("DROPPING class_form IS NULL inflates it — per-form rows sit beside the stage total", async () => {
    const inflated = await asOfficer(districtScope, async (tx) => {
      const rows = (await tx`
        select coalesce(sum(headcount), 0)::int as n from fact_enrolment
         where period_id = ${PERIOD_ID_TERM}::uuid and sex = 'ALL'
      `) as unknown as { n: number }[];
      return Number(rows[0]!.n);
    });
    expect(inflated).toBe(410 + 150 + 160);
    expect(inflated).toBeGreaterThan(410);
  });

  it("dropping BOTH is wrong in both directions at once", async () => {
    const inflated = await asOfficer(districtScope, async (tx) => {
      const rows = (await tx`
        select coalesce(sum(headcount), 0)::int as n from fact_enrolment
         where period_id = ${PERIOD_ID_TERM}::uuid
      `) as unknown as { n: number }[];
      return Number(rows[0]!.n);
    });
    expect(inflated).toBe(410 + 200 + 210 + 150 + 160);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (b) WASSCE — Σqualified ÷ Σcandidates, never the mean of the stored rates
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("getExamQualification re-derives the rate from summed inputs", () => {
  it("is the candidate-weighted Σ/Σ, which differs from the unweighted mean of per-school rates", async () => {
    const q = okValue(
      await getExamQualification(districtScope, "WASSCE", PERIOD_ID_EXAM_COHORT),
    );
    expect(q.candidates).toBe(110);
    expect(q.qualified).toBe(82);
    expect(q.rate).toBeCloseTo(82 / 110, 10); // 74.5%

    // The wrong query, run for comparison: avg() over the stored rates weights a 10-candidate school
    // equally with a 100-candidate one and lands 24.5 points away.
    const meanOfRates = await asOfficer(districtScope, async (tx) => {
      const rows = (await tx`
        select avg(qualification_rate)::float8 as r from fact_performance_exam
         where period_id = ${PERIOD_ID_EXAM_COHORT}::uuid and exam = 'WASSCE' and sex = 'ALL'
      `) as unknown as { r: number }[];
      return Number(rows[0]!.r) / 100;
    });
    expect(meanOfRates).toBeCloseTo(0.5, 10);
    expect(Math.abs(q.rate - meanOfRates)).toBeGreaterThan(0.2);
  });

  it("never reads qualification_rate at all — the column is absent from the allow-list", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/oversight/performance.ts"),
      "utf8",
    );
    const code = source
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/\bqualification_rate\b/);
  });

  it("DROPPING sex = 'ALL' triples both sums — and the RATE still looks right, which is the trap", async () => {
    const tripled = await asOfficer(districtScope, async (tx) => {
      const rows = (await tx`
        select sum(candidates)::int as c, sum(qualified)::int as q from fact_performance_exam
         where period_id = ${PERIOD_ID_EXAM_COHORT}::uuid and exam = 'WASSCE'
      `) as unknown as { c: number; q: number }[];
      return { candidates: Number(rows[0]!.c), qualified: Number(rows[0]!.q) };
    });
    expect(tripled.candidates).toBe(110 + 100); // the MALE + FEMALE decoys, double-counting one school
    expect(tripled.candidates).toBeGreaterThan(110);
  });

  it("pins ONE sitting — the older cohort's 9,000 candidates are not in the figure", async () => {
    const q = okValue(
      await getExamQualification(districtScope, "WASSCE", PERIOD_ID_EXAM_COHORT),
    );
    expect(q.candidates).toBe(110);
    const acrossSittings = await asOfficer(districtScope, async (tx) => {
      const rows = (await tx`
        select sum(candidates)::int as c from fact_performance_exam
         where exam = 'WASSCE' and sex = 'ALL'
      `) as unknown as { c: number }[];
      return Number(rows[0]!.c);
    });
    expect(acrossSittings).toBe(110 + 9000);
  });

  it("a sitting with no candidates yields unavailable, never 0%", async () => {
    // The older cohort for BECE: a real period, zero rows. 0/0 is not "every candidate failed".
    expect(
      (await getExamQualification(districtScope, "BECE", OLDER_EXAM_COHORT)).status,
    ).toBe("unavailable");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (c) COVERAGE — the denominator is the REGISTER, which is why it is below 100%
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("getSchoolCoverage divides by the EMIS register", () => {
  it("reporting is strictly below registered, because non-reporting schools exist in the register", async () => {
    const coverage = okValue(await getSchoolCoverage(districtScope));
    expect(coverage.registered).toBeGreaterThan(coverage.reporting);
    expect(coverage.ratio).toBeLessThan(1);
    expect(coverage.ratio).toBeCloseTo(coverage.reporting / coverage.registered, 10);
  });

  it("a fact-derived numerator-and-denominator would be 100% by construction — the negative control", async () => {
    // `fact_infrastructure.schools_reporting` only exists for schools that FILED, so reading coverage
    // from a fact makes the two counts the same set and the ratio always 1. That is the mistake the
    // register-based denominator exists to prevent, and it is invisible in the output.
    const fromFact = await asOfficer(districtScope, async (tx) => {
      const rows = (await tx`
        select sum(schools_reporting)::int as reporting, count(*)::int as rows
          from fact_infrastructure
      `) as unknown as { reporting: number; rows: number }[];
      return rows[0]!;
    });
    expect(Number(fromFact.reporting)).toBe(Number(fromFact.rows));
  });

  it("counts BOTH sides from the register, so the gap is nameable", async () => {
    const coverage = okValue(await getSchoolCoverage(districtScope));
    const direct = await asOfficer(districtScope, async (tx) => {
      const rows = (await tx`
        select count(*) filter (where on_schoolup)::int as reporting, count(*)::int as registered
          from ref_emis_school_register
      `) as unknown as { reporting: number; registered: number }[];
      return rows[0]!;
    });
    expect(coverage.reporting).toBe(Number(direct.reporting));
    expect(coverage.registered).toBe(Number(direct.registered));
    expect(coverage.registered - coverage.reporting).toBeGreaterThan(0);
  });

  it("an EMPTY register yields unavailable — never 0%, never NaN% (Quinn L3)", async () => {
    // The `registered === 0` branch was the only unreachable one in the four libs, because every
    // fixture subtree has register rows. A brand-new district that EMIS has not extracted yet is the
    // real-world shape, so this test makes one: an empty DISTRICT node under Western Region, scoped to
    // by a district officer. Inserted and removed inside the test so the shared spine is untouched.
    const EMPTY_DISTRICT = "10000000-0000-4000-8000-0000000000e2";
    await owner`
      insert into dim_jurisdiction (jurisdiction_id, level, parent_id, name, is_reporting)
      values (${EMPTY_DISTRICT}::uuid, 'DISTRICT', ${JUR.region}::uuid, 'Not-yet-extracted District', false)
    `;
    try {
      const emptyScope = scopeFor(
        officerFixture({
          officerId: OFFICER.districtId,
          officerRole: OFFICER.role,
          jurisdictionId: EMPTY_DISTRICT,
          level: "DISTRICT",
        }),
      );
      // The premise: this scope really does see zero register rows, so the branch under test is the
      // one actually being exercised.
      const visible = await asOfficer(emptyScope, async (tx) => {
        const rows = (await tx`
          select count(*)::int as n from ref_emis_school_register
        `) as unknown as { n: number }[];
        return Number(rows[0]!.n);
      });
      expect(visible).toBe(0);

      const coverage = await getSchoolCoverage(emptyScope);
      expect(coverage.status).toBe("unavailable");
      // 0 ÷ 0 is NaN and `0 of 0` is a sentence that reads like a measurement. Neither may escape:
      // without the guard this returns `ok` with `ratio: NaN`, and the card renders "NaN%".
      expect("value" in coverage).toBe(false);
    } finally {
      await owner`delete from dim_jurisdiction where jurisdiction_id = ${EMPTY_DISTRICT}::uuid`;
    }
  });

  it("regions is NULL, never 0, when the visible register names no region (Quinn L2)", async () => {
    // `region_id` is NULLABLE on the register, so `count(distinct region_id)` can be 0 while schools
    // exist — and "Rolled up from 0 regions" is a false claim, not a missing one. The shape is built
    // honestly: a district whose only register row has no region, read by that district's officer.
    const REGIONLESS_DISTRICT = "10000000-0000-4000-8000-0000000000e3";
    const REGIONLESS_SCHOOL = "EMIS-KPI-903";
    await owner`
      insert into dim_jurisdiction (jurisdiction_id, level, parent_id, name, is_reporting)
      values (${REGIONLESS_DISTRICT}::uuid, 'DISTRICT', ${JUR.region}::uuid, 'Region-less District', false)
    `;
    await owner`
      insert into ref_emis_school_register
        (emis_school_id, name, district_id, region_id, school_type, ownership_type, on_schoolup,
         operational_school_id, source, as_of_date)
      values (${REGIONLESS_SCHOOL}, 'Region-less JHS', ${REGIONLESS_DISTRICT}::uuid, null, 'JHS', 'PUBLIC', true, null, 'EMIS_EXTRACT', current_date)
    `;
    try {
      const scope = scopeFor(
        officerFixture({
          officerId: OFFICER.districtId,
          officerRole: OFFICER.role,
          jurisdictionId: REGIONLESS_DISTRICT,
          level: "DISTRICT",
        }),
      );
      const coverage = okValue(await getSchoolCoverage(scope));
      // The register IS readable — one row, fully reporting — so this is not the empty-register path.
      expect(coverage.registered).toBe(1);
      expect(coverage.reporting).toBe(1);
      expect(coverage.ratio).toBe(1);
      // …and the region count came back as an ABSENCE, which is what makes the page drop the clause
      // instead of pluralising a zero.
      expect(coverage.regions).toBeNull();
      expect(coverage.regions).not.toBe(0);
    } finally {
      await owner`delete from ref_emis_school_register where emis_school_id = ${REGIONLESS_SCHOOL}`;
      await owner`delete from dim_jurisdiction where jurisdiction_id = ${REGIONLESS_DISTRICT}::uuid`;
    }
  });

  it("regions is a real count when the register DOES name regions", async () => {
    // The other half of the contract: null must mean "none named", not "never populated".
    const coverage = okValue(await getSchoolCoverage(districtScope));
    expect(coverage.regions).toBe(1); // every fixture school sits in Western Region
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (e) THE RLS TIER MATRIX — NATIONAL sees all, a region/district scope sees a strict subset
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the tier matrix, measured through the KPI reads themselves", () => {
  it("enrolment: district ⊂ region = national, and the national total is every visible row", async () => {
    const district = okValue(await getEnrolmentTotal(districtScope, PERIOD_ID_TERM));
    const region = okValue(await getEnrolmentTotal(regionScope, PERIOD_ID_TERM));
    const national = okValue(await getEnrolmentTotal(nationalScope, PERIOD_ID_TERM));
    // 410 in Wassa Amenfi West; 720 in Sekondi-Takoradi. The VALUES are asserted, not just the
    // ordering: a leak that returned the wrong district's row would still satisfy a `<` assertion.
    expect(district.total).toBe(410);
    expect(national.total).toBe(410 + 720);
    expect(region.total).toBe(national.total); // both districts are in Western Region
    expect(district.total).toBeLessThan(national.total);
    expect(district.schoolsCounted).toBe(1);
    expect(national.schoolsCounted).toBe(2);
  });

  it("the national Σ IS the whole table — no subtree WHERE is needed or wanted", async () => {
    const national = okValue(await getEnrolmentTotal(nationalScope, PERIOD_ID_TERM));
    const ownerRows = (await owner`
      select coalesce(sum(headcount), 0)::int as n from fact_enrolment
       where period_id = ${PERIOD_ID_TERM}::uuid and sex = 'ALL' and class_form is null
    `) as unknown as { n: number }[];
    // Owner = RLS-exempt. Equal means `ov_is_national()` short-circuited the predicate rather than
    // the app having filtered anything itself.
    expect(national.total).toBe(Number(ownerRows[0]!.n));
  });

  it("WASSCE: the district's weighted rate is NOT the national one", async () => {
    const district = okValue(
      await getExamQualification(districtScope, "WASSCE", PERIOD_ID_EXAM_COHORT),
    );
    const national = okValue(
      await getExamQualification(nationalScope, "WASSCE", PERIOD_ID_EXAM_COHORT),
    );
    expect(district.candidates).toBe(110);
    expect(national.candidates).toBe(110 + 400);
    expect(national.qualified).toBe(82 + 100);
    expect(national.rate).toBeCloseTo(182 / 510, 10);
    expect(district.rate).not.toBeCloseTo(national.rate, 3);
  });

  it("coverage: the district sees a strict subset of the national register", async () => {
    const district = okValue(await getSchoolCoverage(districtScope));
    const national = okValue(await getSchoolCoverage(nationalScope));
    expect(district.registered).toBeLessThan(national.registered);
    const ownerRows = (await owner`
      select count(*) filter (where on_schoolup)::int as reporting, count(*)::int as registered
        from ref_emis_school_register
    `) as unknown as { reporting: number; registered: number }[];
    expect(national.registered).toBe(Number(ownerRows[0]!.registered));
    expect(national.reporting).toBe(Number(ownerRows[0]!.reporting));
  });

  it("the out-of-district school's rows are absent from the district figures entirely", async () => {
    const district = okValue(await getEnrolmentTotal(districtScope, PERIOD_ID_TERM));
    // 720 is Takoradi SHS's headcount; 90 is its per-form decoy. Neither may appear in any sum.
    expect(district.total).not.toBe(410 + 720);
    expect(district.total).not.toBe(410 + 90);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (g) FAIL-SOFT — a failed read yields "unavailable", never 0 and never a thrown page
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("fail-soft, and the fallback lives in the lib", () => {
  it("a read that RAISES yields unavailable, not a rejected promise", async () => {
    // A malformed period id is a real failure mode (Postgres raises on the ::uuid cast), so this
    // exercises the `catch` rather than a tidy "no rows" path.
    const bad = "not-a-uuid";
    expect((await getEnrolmentTotal(districtScope, bad)).status).toBe("unavailable");
    expect((await getExamQualification(districtScope, "WASSCE", bad)).status).toBe(
      "unavailable",
    );
  });

  it("every one of the four reads degrades when the DB is unreachable — none throws, none returns 0", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db/rls", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/db/rls")>();
      return {
        ...actual,
        withJurisdiction: async () => {
          throw new Error("analytics DB unreachable");
        },
      };
    });
    try {
      const [period, enrolment, coverage, performance] = await Promise.all([
        import("@/lib/oversight/period"),
        import("@/lib/oversight/enrolment"),
        import("@/lib/oversight/coverage"),
        import("@/lib/oversight/performance"),
      ]);
      const readings = await Promise.all([
        period.getCurrentPeriod(districtScope, "TERM"),
        period.getLatestExamCohortPeriod(districtScope, "WASSCE"),
        enrolment.getEnrolmentTotal(districtScope, PERIOD_ID_TERM),
        coverage.getSchoolCoverage(districtScope),
        performance.getExamQualification(districtScope, "WASSCE", PERIOD_ID_EXAM_COHORT),
      ]);
      expect(readings.map((r) => r.status)).toEqual([
        "unavailable",
        "unavailable",
        "unavailable",
        "unavailable",
        "unavailable",
      ]);
      // And nothing smuggled a figure through: there is no `value` on the failure case at all, so a
      // call site cannot `?? 0` its way to a fabricated zero.
      for (const reading of readings) expect("value" in reading).toBe(false);
    } finally {
      vi.doUnmock("@/lib/db/rls");
      vi.resetModules();
    }
  });

  it("the page states no-successful-run in words, and never a bare dash or a zero", () => {
    const page = readFileSync(join(process.cwd(), "app/(oversight)/page.tsx"), "utf8");
    expect(page).toContain("No successful run yet");
    expect(page).toContain("Unavailable");
    // The scaffold's two honesty violations, gone: the provisioning pill and the `"— of —"` card.
    expect(page).not.toContain("not yet provisioned");
    expect(page).not.toContain("— of —");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (f) EVERY READ GOES THROUGH withJurisdiction, and (h) the dashboard path imports no named-record path
// ══════════════════════════════════════════════════════════════════════════════════════════════════

const ROOT = process.cwd();
const DASHBOARD_LIBS = [
  "lib/oversight/period.ts",
  "lib/oversight/enrolment.ts",
  "lib/oversight/coverage.ts",
  "lib/oversight/performance.ts",
];
const DASHBOARD_PAGE = "app/(oversight)/page.tsx";

/** Comments stripped, strings kept — the auth-boundaries idiom, since the patterns live in SQL. */
function readCode(file: string): string {
  return readFileSync(join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

describe("the dashboard reads cannot walk around the jurisdiction chokepoint", () => {
  it("every module imports withJurisdiction and none imports the raw db handle", () => {
    for (const file of DASHBOARD_LIBS) {
      const code = readCode(file);
      expect(code, file).toMatch(
        /import\s*\{[^}]*withJurisdiction[^}]*\}\s*from\s*"@\/lib\/db\/rls"/,
      );
      // A bare `db.execute` runs with NO GUCs set, which for an `ov_is_national()`-tolerant predicate
      // can mean MORE than the officer should see (lib/db/rls.ts's rule for future authors).
      expect(code, file).not.toMatch(/from\s*"@\/lib\/db"/);
      expect(code, file).not.toMatch(/\bdb\s*\.\s*(execute|transaction|select)\b/);
    }
  });

  it("every tx.execute in them sits inside a withJurisdiction callback", () => {
    for (const file of DASHBOARD_LIBS) {
      const code = readCode(file);
      const executes = code.match(/tx\.execute\(/g) ?? [];
      const wrappers = code.match(/withJurisdiction\(/g) ?? [];
      expect(executes.length, file).toBeGreaterThan(0);
      // One wrapper per read, and no execute that is not inside one: the first `withJurisdiction(`
      // always precedes the first `tx.execute(`, and the counts match one-for-one.
      expect(wrappers.length, file).toBe(executes.length);
      expect(code.indexOf("withJurisdiction(")).toBeLessThan(code.indexOf("tx.execute("));
    }
  });

  it("no module writes a subtree WHERE of its own — RLS is the only ceiling", () => {
    for (const file of DASHBOARD_LIBS) {
      const code = readCode(file);
      // A hand-written ceiling is redundant when it agrees with the policy and a boundary bug when it
      // does not, so there must be no second copy of it in app SQL.
      expect(code, file).not.toMatch(/ov_in_subtree/);
      expect(code, file).not.toMatch(/app\.current_(jurisdiction|level|officer)/);
      expect(code, file).not.toMatch(/scope\.(jurisdictionId|level)/);
    }
  });

  it("the page itself runs no SQL — it composes the libs", () => {
    const code = readCode(DASHBOARD_PAGE);
    expect(code).not.toMatch(/from\s*"drizzle-orm"/);
    expect(code).not.toMatch(/tx\.execute\(/);
  });
});

describe("the dashboard path reaches no named-record machinery, even transitively", () => {
  const FORBIDDEN = [
    "lib/db/readback.ts",
    "lib/oversight/named-record-access.ts",
    "lib/oversight/consent.ts",
    "lib/oversight/staff-projection.ts",
  ];

  function resolveSpecifier(fromFile: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
    else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
    else return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        /* not this one */
      }
    }
    return null;
  }

  function graphFrom(entry: string, seen = new Set<string>()): Set<string> {
    if (seen.has(entry)) return seen;
    seen.add(entry);
    const text = readFileSync(entry, "utf8");
    const re = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const resolved = resolveSpecifier(entry, m[1]!);
      if (resolved) graphFrom(resolved, seen);
    }
    return seen;
  }

  it("neither the page nor any of its four reads pulls in the gated path", () => {
    for (const entry of [DASHBOARD_PAGE, ...DASHBOARD_LIBS]) {
      const reached = [...graphFrom(join(ROOT, entry))].map((f) =>
        relative(ROOT, f).replaceAll("\\", "/"),
      );
      for (const forbidden of FORBIDDEN) {
        expect(reached, `${entry} → ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("the libs directory this slice added contains no individual-level column anywhere", () => {
    // The analytics DB holds no individuals by design (§9); this is the textual half — a read that
    // selected a name would have to name it, and these four files are allow-lists of aggregates.
    for (const file of DASHBOARD_LIBS) {
      const code = readCode(file);
      for (const column of [
        "full_name",
        "first_name",
        "surname",
        "ntc_licence",
        "captured_by",
      ]) {
        expect(code, `${file} / ${column}`).not.toContain(column);
      }
    }
  });
});
