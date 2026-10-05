import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
import {
  buildLedeFragments,
  buildTitle,
  childCountOf,
  pluralise,
  rollupClause,
  sourceLine,
  tierChrome,
} from "@/components/oversight/tier-chrome";
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
const regionOfficer = officerFixture({
  officerId: OFFICER.regionId,
  officerRole: OFFICER.regionRole,
  jurisdictionId: JUR.region,
  level: "REGION",
});
const regionScope: JurisdictionScope = scopeFor(regionOfficer);

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

  // ── slice 2: the distinct-DISTRICT count the region tier's chrome names ────────────────────────

  it("districts counts the distinct districts in the VISIBLE register, and scopes with RLS", async () => {
    // A district officer sees one district; a region officer sees both of theirs. This is the scalar
    // the regional chrome says "rolled up from N districts" with — and the fact that it moves with the
    // officer's ceiling is the whole reason it is read per request rather than configured.
    expect(okValue(await getSchoolCoverage(districtScope)).districts).toBe(1);
    expect(okValue(await getSchoolCoverage(regionScope)).districts).toBe(2);
    expect(okValue(await getSchoolCoverage(nationalScope)).districts).toBe(2);
  });

  it("districts agrees with a direct count under the same ceiling", async () => {
    const coverage = okValue(await getSchoolCoverage(regionScope));
    const direct = await asOfficer(regionScope, async (tx) => {
      const rows = (await tx`
        select count(distinct district_id)::int as n from ref_emis_school_register
      `) as unknown as { n: number }[];
      return Number(rows[0]!.n);
    });
    expect(coverage.districts).toBe(direct);
  });

  it("it is a SCALAR off the register, not the slice-3 child roll-up", async () => {
    // Lucy §3.3's warning, pinned: the count must come from the register the coverage read already
    // scans, NOT from walking dim_jurisdiction children. If it ever did the walk it would count
    // districts with no registered schools too, and these two numbers would diverge.
    const coverage = okValue(await getSchoolCoverage(nationalScope));
    const districtsInSpine = (await owner`
      select count(*)::int as n from dim_jurisdiction where level = 'DISTRICT'
    `) as unknown as { n: number }[];
    const districtsInRegister = (await owner`
      select count(distinct district_id)::int as n from ref_emis_school_register
    `) as unknown as { n: number }[];
    expect(coverage.districts).toBe(Number(districtsInRegister[0]!.n));
    expect(Number(districtsInSpine[0]!.n)).toBeGreaterThanOrEqual(coverage.districts!);
    // And the query names exactly one table — no join, no recursion, no children. Comments stripped,
    // because the doc comment NAMES `dim_jurisdiction` to say the walk is what this is not.
    const code = readCode("lib/oversight/coverage.ts");
    expect(code).not.toMatch(/dim_jurisdiction/);
    expect(code).not.toMatch(/with recursive/i);
    expect(code).not.toMatch(/\bjoin\b/i);
  });

  it("districts is NULL, never 0, when the visible register names no district", async () => {
    // Same discipline as `regions`, and for the same reason: `district_id` is nullable, so 0 means the
    // register names none. A region officer whose only register row has no district must not read
    // "rolled up from 0 districts".
    const DISTRICTLESS_SCHOOL = "EMIS-KPI-904";
    const OTHER_REGION = "10000000-0000-4000-8000-0000000000e4";
    await owner`
      insert into dim_jurisdiction (jurisdiction_id, level, parent_id, name, is_reporting)
      values (${OTHER_REGION}::uuid, 'REGION', ${JUR.national}::uuid, 'District-less Region', false)
    `;
    await owner`
      insert into ref_emis_school_register
        (emis_school_id, name, district_id, region_id, school_type, ownership_type, on_schoolup,
         operational_school_id, source, as_of_date)
      values (${DISTRICTLESS_SCHOOL}, 'District-less JHS', null, ${OTHER_REGION}::uuid, 'JHS', 'PUBLIC', true, null, 'EMIS_EXTRACT', current_date)
    `;
    try {
      const scope = scopeFor(
        officerFixture({
          officerId: OFFICER.regionId,
          officerRole: OFFICER.regionRole,
          jurisdictionId: OTHER_REGION,
          level: "REGION",
        }),
      );
      // ⚠ A district_id of NULL means `ov_in_subtree(district_id)` cannot place the row, so RLS hides
      // it from everyone except a NATIONAL officer (whose predicate short-circuits). That is correct
      // and is exactly the state the null guard exists for: the row is in the register and in no
      // district, so no non-national officer can count a district for it.
      const visible = await asOfficer(scope, async (tx) => {
        const rows = (await tx`
          select count(*)::int as n from ref_emis_school_register
        `) as unknown as { n: number }[];
        return Number(rows[0]!.n);
      });
      expect(visible).toBe(0);
      expect((await getSchoolCoverage(scope)).status).toBe("unavailable");

      // The national officer DOES see it, so assert the null-vs-zero rule where it is observable: the
      // district-less row contributes to `registered` but to no district count.
      const national = okValue(await getSchoolCoverage(nationalScope));
      expect(national.registered).toBeGreaterThan(0);
      expect(national.districts).not.toBe(0);
      const distinctDistricts = (await owner`
        select count(distinct district_id)::int as n from ref_emis_school_register
      `) as unknown as { n: number }[];
      expect(national.districts).toBe(Number(distinctDistricts[0]!.n));
    } finally {
      await owner`delete from ref_emis_school_register where emis_school_id = ${DISTRICTLESS_SCHOOL}`;
      await owner`delete from dim_jurisdiction where jurisdiction_id = ${OTHER_REGION}::uuid`;
    }
  });

  it("districts is NULL, never 0, when NO visible register row names a district (Quinn L1)", async () => {
    // ⚠ THE CASE ABOVE NEVER REACHES THE GUARD. One district-less row beside rows that DO name
    // districts leaves `count(distinct district_id)` ≥ 1, so `districts === 0` — the only input the
    // null guard converts — is never produced, and deleting the guard would not fail it. This one
    // produces that input: every district_id on the register is nulled as the OWNER, so a NATIONAL
    // officer (whose `ov_in_subtree` short-circuits, so the rows stay visible) reads a register that
    // is fully populated and names no district at all.
    const before = (await owner`
      select emis_school_id, district_id from ref_emis_school_register
    `) as unknown as { emis_school_id: string; district_id: string | null }[];
    expect(before.length).toBeGreaterThan(0);
    try {
      await owner`update ref_emis_school_register set district_id = null`;

      const national = okValue(await getSchoolCoverage(nationalScope));
      // Not the empty-register path: the rows are all still there and still counted.
      expect(national.registered).toBe(before.length);
      expect(national.reporting).toBeGreaterThan(0);
      // …and the count came back as an ABSENCE. Without the `districts === 0 ? null` guard this is 0,
      // and the chrome below then states "Rolled up from 0 districts" — a false claim, not a missing
      // one — and sources the page to "0 district rollups".
      expect(national.districts).toBeNull();
      expect(national.districts).not.toBe(0);
      // `regions` is untouched by the same update, which proves the null is this column's and not a
      // whole-read collapse.
      expect(national.regions).not.toBeNull();

      // The structural consequence, asserted on the chrome the page actually renders with.
      const regionChrome = tierChrome("REGION", "Western Region");
      expect(childCountOf(regionChrome, national)).toBeNull();
      expect(rollupClause(regionChrome, null)).toBeNull();
      expect(sourceLine(regionChrome, null)).toBe("Omnischools analytics DB");
      expect(sourceLine(regionChrome, null)).not.toContain("0");
    } finally {
      // Restore from the SNAPSHOT, row by row — not from a pattern over `emis_school_id`, which would
      // silently stop restoring rows the day the seed grows a new id shape (the afterAll ruling).
      for (const row of before) {
        await owner`
          update ref_emis_school_register
             set district_id = ${row.district_id}::uuid
           where emis_school_id = ${row.emis_school_id}
        `;
      }
      const restored = (await owner`
        select count(*)::int as n from ref_emis_school_register where district_id is not null
      `) as unknown as { n: number }[];
      expect(Number(restored[0]!.n)).toBe(before.filter((r) => r.district_id !== null).length);
    }
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

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// INCREMENT I · SLICE 2 — TIER-AWARE CHROME (Lucy's tier design map §1)
//
// The figures were already each officer's own (the tier matrix above proves it). What slice 2 fixes is
// the WORDING around them: a regional director reading their region's numbers under the headline
// "Ghana · national dashboard" is the one error class a dashboard must not make, because a figure
// labelled with the wrong jurisdiction is actionable rather than merely missing.
//
// These assert the chrome against Lucy's per-tier tables STRING BY STRING, not shape-by-shape: the
// whole value of the spec is the exact copy, and "contains the region name somewhere" would pass for a
// crumb that says "Oversight · Western Region · National dashboard". The two ReactNode builders are
// rendered with `renderToStaticMarkup` so the gold-italic em, the trailing period inside it and the
// bolded stat spans are checked as MARKUP rather than as intentions.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** Render a fragment list the way the PageHead lede composes it: " · " between, "." after. */
function renderNodes(nodes: ReactNode[]): string {
  return renderToStaticMarkup(createElement(Fragment, null, ...nodes));
}

/** Markup with tags stripped, so a copy assertion reads like the sentence an officer sees. */
function renderText(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&middot;/g, "·")
    .replace(/&amp;/g, "&");
}

const NATIONAL_CHROME = tierChrome("NATIONAL", "National · Ministry of Education");
const REGION_CHROME = tierChrome("REGION", "Western Region");
const DISTRICT_CHROME = tierChrome("DISTRICT", "Wassa Amenfi West");

describe("the crumb names the jurisdiction at region and district, and does not at national", () => {
  it("national keeps the two-part crumb — there is no node to insert", () => {
    expect(NATIONAL_CHROME.crumb).toBe("Oversight · National dashboard");
  });

  it("region and district insert their own node name as the middle segment", () => {
    expect(REGION_CHROME.crumb).toBe("Oversight · Western Region · Regional dashboard");
    expect(DISTRICT_CHROME.crumb).toBe(
      "Oversight · Wassa Amenfi West · District dashboard",
    );
  });
});

describe("the title's lead word — and the national special case", () => {
  it("national leads with the literal 'Ghana', NOT the session's jurisdictionName", () => {
    // The national session's node label is "National · Ministry of Education"; using it would render
    // "National · Ministry of Education · national dashboard." The literal is the fix, and it is the
    // one place in the chrome where the session value is deliberately ignored.
    expect(NATIONAL_CHROME.titleLead).toBe("Ghana");
    expect(NATIONAL_CHROME.titleLead).not.toContain("Ministry");
    expect(renderText(buildTitle(NATIONAL_CHROME))).toBe("Ghana · national dashboard.");
  });

  it("region and district lead with their own jurisdictionName", () => {
    expect(renderText(buildTitle(REGION_CHROME))).toBe(
      "Western Region · regional dashboard.",
    );
    expect(renderText(buildTitle(DISTRICT_CHROME))).toBe(
      "Wassa Amenfi West · district dashboard.",
    );
  });

  it("the gold italic and the trailing period INSIDE the em survive at every tier", () => {
    for (const chrome of [NATIONAL_CHROME, REGION_CHROME, DISTRICT_CHROME]) {
      const markup = renderToStaticMarkup(
        createElement(Fragment, null, buildTitle(chrome)),
      );
      // Lucy §1.2: `<em className="accent-italic">… dashboard.</em>` — the period is inside the em,
      // which is a typographic decision (the gold accent closes the sentence), not an accident.
      expect(markup, chrome.tierAdjective).toMatch(
        /<em class="accent-italic">[a-z]+ dashboard\.<\/em>/,
      );
    }
  });
});

describe("the lede's child noun, and the district's different shape", () => {
  const coverage = {
    reporting: 431,
    registered: 508,
    ratio: 431 / 508,
    regions: 16,
    districts: 14,
  };
  const enrolment = { total: 198_400, schoolsCounted: 431 };

  it("national rolls up from REGIONS", () => {
    const text = renderText(
      createElement(
        Fragment,
        null,
        ...buildLedeFragments(NATIONAL_CHROME, coverage, enrolment),
      ),
    );
    expect(text).toContain("Rolled up from 16 regions");
    expect(text).not.toContain("districts");
  });

  it("region rolls up from DISTRICTS — the same pattern, the child noun swapped", () => {
    const text = renderText(
      createElement(
        Fragment,
        null,
        ...buildLedeFragments(REGION_CHROME, coverage, enrolment),
      ),
    );
    expect(text).toContain("Rolled up from 14 districts");
    // The number must be the DISTRICT count, not the region count the same read also carries.
    expect(text).not.toContain("16");
    expect(text).not.toContain("regions");
    // …and the other two fragments are unchanged from national.
    expect(text).toContain("431 of 508 schools");
    expect(text).toContain("198,400 pupils");
  });

  it("district drops the rolled-up-from clause and states its own schools instead", () => {
    const fragments = buildLedeFragments(DISTRICT_CHROME, coverage, enrolment);
    const text = renderText(createElement(Fragment, null, ...fragments));
    expect(text).toBe("Reporting on 431 schools that report into Omnischools");
    expect(text).not.toContain("Rolled up from");
    // One clause, so the lede reads as a sentence rather than a dot-separated list.
    expect(fragments).toHaveLength(1);
  });

  it("the superseded data-sharing-agreement wording is NOT reintroduced at district", () => {
    // The district mock says "schools in the district that have signed the GES data-sharing
    // agreement". The DSA concept was removed (there is no agreement to sign), so the sentence would
    // be describing a gate that does not exist — Lucy §1.3 supersedes it explicitly.
    const text = renderText(
      createElement(
        Fragment,
        null,
        ...buildLedeFragments(DISTRICT_CHROME, coverage, enrolment),
      ),
    );
    expect(text).not.toMatch(/data.sharing/i);
    expect(text).not.toMatch(/agreement/i);
  });

  it("the unbuildable basic/SHS split is omitted, not placeholdered", () => {
    // The district mock's "31 of 37 basic schools and 3 of 3 senior high schools" needs the register
    // counted by school level, which no read produces. A shorter true sentence beats a fabricated one.
    const text = renderText(
      createElement(
        Fragment,
        null,
        ...buildLedeFragments(DISTRICT_CHROME, coverage, enrolment),
      ),
    );
    expect(text).not.toMatch(/basic/i);
    expect(text).not.toMatch(/senior high/i);
  });

  it("the stat fragments are still bolded spans at every tier (Lucy's `.lede b`)", () => {
    for (const chrome of [NATIONAL_CHROME, REGION_CHROME, DISTRICT_CHROME]) {
      const markup = renderNodes(buildLedeFragments(chrome, coverage, enrolment));
      expect(markup, chrome.tierAdjective).toContain('<b class="text-navy-2">');
    }
  });

  it("an unavailable read drops its own fragment and leaves the rest standing", () => {
    expect(
      renderText(
        createElement(
          Fragment,
          null,
          ...buildLedeFragments(REGION_CHROME, coverage, null),
        ),
      ),
    ).not.toContain("pupils");
    // Coverage gone takes both of its fragments with it, including the child-noun clause, because the
    // count rides on the same read.
    const noCoverage = buildLedeFragments(REGION_CHROME, null, enrolment);
    expect(renderText(createElement(Fragment, null, ...noCoverage))).toBe(
      "198,400 pupils",
    );
    // And a district with no coverage read has nothing left to say at all, rather than a stub.
    expect(buildLedeFragments(DISTRICT_CHROME, null, enrolment)).toEqual([]);
  });

  it("a null child count drops the clause rather than pluralising a zero", () => {
    const regionless = { ...coverage, regions: null, districts: null };
    const text = renderText(
      createElement(
        Fragment,
        null,
        ...buildLedeFragments(REGION_CHROME, regionless, enrolment),
      ),
    );
    expect(text).not.toContain("Rolled up from");
    expect(text).not.toContain("0 districts");
    // The fragments that do not depend on the child count are untouched.
    expect(text).toContain("431 of 508 schools");
  });
});

describe("the period banner's child-rollup sentence", () => {
  it("names regions at national and districts at region", () => {
    expect(rollupClause(NATIONAL_CHROME, 16)).toBe(
      "Every figure is the sum or mean of 16 regions.",
    );
    expect(rollupClause(REGION_CHROME, 14)).toBe(
      "Every figure is the sum or mean of 14 districts.",
    );
  });

  it("is OMITTED at district — a district has no child jurisdictions (Lucy §1.4)", () => {
    // Null however many children were counted: the absence is a property of the tier, not of the data,
    // so no count can talk the clause back into existence.
    for (const count of [14, 1, 0, null]) {
      expect(rollupClause(DISTRICT_CHROME, count), `count=${String(count)}`).toBeNull();
    }
  });

  it("is omitted when there is nothing to roll up — one child, or no count", () => {
    // "The sum or mean of 1 district" is not a roll-up, it is the same number restated.
    expect(rollupClause(REGION_CHROME, 1)).toBeNull();
    expect(rollupClause(REGION_CHROME, null)).toBeNull();
  });
});

describe("the provenance Scope line states the ceiling per tier", () => {
  it("national — no ceiling, and it says so", () => {
    expect(NATIONAL_CHROME.scopeLine).toBe(
      "national · no jurisdiction ceiling — all regions visible",
    );
  });

  it("region names the region; district uses the GENERIC word, and the asymmetry is the mock's", () => {
    expect(REGION_CHROME.scopeLine).toBe(
      "Western Region · sibling regions not visible here",
    );
    expect(DISTRICT_CHROME.scopeLine).toBe(
      "district-ceiling · you cannot see other districts here",
    );
    // Lucy §1.5: the district line deliberately does NOT carry the district's name.
    expect(DISTRICT_CHROME.scopeLine).not.toContain("Wassa");
  });

  it("the slice-1 generic placeholder is gone from every tier", () => {
    for (const chrome of [NATIONAL_CHROME, REGION_CHROME, DISTRICT_CHROME]) {
      expect(chrome.scopeLine, chrome.tierAdjective).not.toContain(
        "scoped to your jurisdiction subtree",
      );
    }
    expect(readFileSync(join(ROOT, DASHBOARD_PAGE), "utf8")).not.toContain(
      "scoped to your jurisdiction subtree",
    );
  });
});

describe("the provenance Source line counts the right children", () => {
  it("national and region count their own child tier", () => {
    expect(sourceLine(NATIONAL_CHROME, 16)).toBe(
      "Omnischools analytics DB · 16 region rollups",
    );
    expect(sourceLine(REGION_CHROME, 14)).toBe(
      "Omnischools analytics DB · 14 district rollups",
    );
  });

  it("district names its sources instead, because it has no child rollups", () => {
    expect(sourceLine(DISTRICT_CHROME, null)).toBe(
      "Omnischools analytics DB · school feeds + WAEC & EMIS reference extracts",
    );
    // And a stray count cannot turn it into a rollup claim.
    expect(sourceLine(DISTRICT_CHROME, 14)).toBe(
      "Omnischools analytics DB · school feeds + WAEC & EMIS reference extracts",
    );
  });

  it("a null count falls back to the plain source, never '0 rollups'", () => {
    expect(sourceLine(NATIONAL_CHROME, null)).toBe("Omnischools analytics DB");
    expect(sourceLine(REGION_CHROME, null)).toBe("Omnischools analytics DB");
  });

  it("singular and plural are both right", () => {
    expect(sourceLine(REGION_CHROME, 1)).toBe(
      "Omnischools analytics DB · 1 district rollup",
    );
    expect(pluralise(1, "district")).toBe("1 district");
    expect(pluralise(2, "district")).toBe("2 districts");
    expect(pluralise(1_200, "school")).toBe("1,200 schools");
  });
});

describe("the WASSCE sub-line's tier word, and the one tier config behind it", () => {
  it("reads National / Regional / District", () => {
    expect(NATIONAL_CHROME.tierAdjective).toBe("National");
    expect(REGION_CHROME.tierAdjective).toBe("Regional");
    expect(DISTRICT_CHROME.tierAdjective).toBe("District");
  });

  it("the page reads the tier word from the chrome config, not a second table", () => {
    // Slice 1 had a local TIER_LABEL beside it; two sources for one word is how they drift.
    const code = readCode(DASHBOARD_PAGE);
    expect(code).not.toContain("TIER_LABEL");
    expect(code).toContain("chrome.tierAdjective");
  });

  it("the page hand-rolls no pluralisation of its own either (Dex N2)", () => {
    // Same argument as the tier word, applied to the OTHER rule this slice claims to have written
    // once: `pluralNoun()`. The enrolment card used to inline `n === 1 ? "school" : "schools"`, which
    // is a second copy — and the second copy is the one that is wrong when the rule changes.
    const code = readCode(DASHBOARD_PAGE);
    expect(code).not.toMatch(/\?\s*"[a-z]+"\s*:\s*"[a-z]+s"/);
    expect(code).toContain('pluralNoun(enrolment.value.schoolsCounted, "school")');
  });
});

describe("the child-noun selection reads the right count off the one coverage read", () => {
  const coverage = {
    reporting: 8,
    registered: 11,
    ratio: 8 / 11,
    regions: 16,
    districts: 14,
  };

  it("national takes regions, region takes districts, district takes neither", () => {
    expect(childCountOf(NATIONAL_CHROME, coverage)).toBe(16);
    expect(childCountOf(REGION_CHROME, coverage)).toBe(14);
    expect(childCountOf(DISTRICT_CHROME, coverage)).toBeNull();
  });

  it("an unavailable coverage read yields no count at any tier", () => {
    for (const chrome of [NATIONAL_CHROME, REGION_CHROME, DISTRICT_CHROME]) {
      expect(childCountOf(chrome, null), chrome.tierAdjective).toBeNull();
    }
  });

  it("a null count on the chosen column survives selection instead of collapsing to 0", () => {
    expect(childCountOf(REGION_CHROME, { ...coverage, districts: null })).toBeNull();
    // …and the OTHER column's value must not be substituted for it.
    expect(childCountOf(REGION_CHROME, { ...coverage, districts: null })).not.toBe(16);
  });
});

describe("SCHOOL is handled, though no session can carry it", () => {
  it("is a total function — never 'undefined dashboard'", () => {
    // `ref_oversight_officer` refuses a SCHOOL-node officer (Kofi R1, asserted by the fixture
    // self-checks), so this branch is unreachable today. It exists so that relaxing that guard
    // degrades to the TIGHTEST ceiling rather than to a broken headline.
    const school = tierChrome("SCHOOL", "Asankrangwa SHS");
    expect(renderText(buildTitle(school))).toBe("Asankrangwa SHS · school dashboard.");
    expect(school.crumb).toBe("Oversight · Asankrangwa SHS · School dashboard");
    expect(school.childNoun).toBeNull();
    expect(rollupClause(school, 12)).toBeNull();
    expect(school.scopeLine).toContain("you cannot see other schools");
    expect(JSON.stringify(school)).not.toContain("undefined");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 2 · THE PAGE ACTUALLY WIRES THE CONFIG TO THE RIGHT SLOT (Quinn M1)
//
// Everything above tests `tierChrome()` and its builders in isolation. That leaves one hole, and it is
// the hole that matters on a security-relevant surface: a page that passed `chrome.scopeLine` into the
// provenance SOURCE slot, or `buildTitle()` into the crumb, or that kept slice 1's hard-coded national
// strings beside the new config and never read it, satisfies every unit assertion in this file.
//
// So these RENDER the real server component — `await OversightHome()` with `getOfficerSession` mocked
// per tier, against the real database as the real app role — and read the markup back. They are the
// only cases here that can distinguish "the config is right" from "the config is USED".
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The CHROME session the page consumes: `lib/auth`'s `OfficerSession`, which extends the branded gate
 * session with `displayName`/`jurisdictionName`. SPREAD, never re-minted, so the resolution brand
 * `scopeFor()` requires survives (tests/helpers.ts).
 */
function chromeSession(base: unknown, jurisdictionName: string) {
  return { ...(base as object), displayName: "Test Officer", jurisdictionName };
}

/** The page's own markup, produced by invoking the server component and rendering its tree. */
async function renderPage(officer: unknown): Promise<string> {
  vi.resetModules();
  vi.doMock("@/lib/auth", async (orig) => ({
    ...(await orig<typeof import("@/lib/auth")>()),
    getOfficerSession: async () => officer,
  }));
  try {
    const mod = await import("@/app/(oversight)/page");
    const tree = await (mod.default as () => Promise<unknown>)();
    return renderToStaticMarkup(createElement(Fragment, null, tree as never));
  } finally {
    vi.doUnmock("@/lib/auth");
    vi.resetModules();
  }
}

/** Entity-decoded text of a markup fragment — the sentence an officer actually reads. */
function decode(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** The crumb, read out of PageHead's own gold eyebrow rather than from the page text at large. */
function crumbOf(markup: string): string {
  return decode(/text-gold">([^<]*)<\/p>/.exec(markup)?.[1] ?? "");
}

/** The h1's inner markup, so the gold-italic em is still visible to an assertion. */
function titleMarkupOf(markup: string): string {
  return /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(markup)?.[1] ?? "";
}

/**
 * ONE provenance term's `<dd>`, keyed by its `<dt>` — the assertion that makes a slot SWAP visible.
 * Asserting on the whole page text cannot: both lines are present either way round.
 */
function provenanceOf(markup: string, term: string): string {
  const found = new RegExp(`<dt[^>]*>${term}</dt><dd[^>]*>([^<]*)</dd>`).exec(markup);
  expect(found, `no provenance <dd> for "${term}"`).not.toBeNull();
  return decode(found![1]!);
}

describe("the page renders each tier's chrome into the right slot", () => {
  /** Rendered once per tier — three server-component invocations, each a real round of DB reads. */
  let NATIONAL = "";
  let REGION = "";
  let DISTRICT = "";

  beforeAll(async () => {
    // The national session's node label is deliberately the MINISTRY string, which is what
    // `lib/auth` puts there: it is the value the title's "Ghana" special case has to override.
    NATIONAL = await renderPage(chromeSession(nationalOfficer, "National · Ministry of Education"));
    REGION = await renderPage(chromeSession(regionOfficer, "Western Region"));
    DISTRICT = await renderPage(chromeSession(districtOfficer, "Wassa Amenfi West"));
  });

  it("the crumb is the tier's crumb, in the crumb slot", () => {
    expect(crumbOf(NATIONAL)).toBe("Oversight · National dashboard");
    expect(crumbOf(REGION)).toBe("Oversight · Western Region · Regional dashboard");
    expect(crumbOf(DISTRICT)).toBe("Oversight · Wassa Amenfi West · District dashboard");
    // The failure a "contains the name somewhere" assertion would wave through: slice 1's hard-coded
    // national crumb surviving beside the config.
    expect(crumbOf(REGION)).not.toContain("National dashboard");
    expect(crumbOf(DISTRICT)).not.toContain("National dashboard");
    expect(crumbOf(DISTRICT)).not.toContain("Regional dashboard");
    // …and the crumb slot is not the title slot.
    expect(crumbOf(NATIONAL)).not.toContain("Ghana");
  });

  it("the title leads with the tier's lead — 'Ghana' at national, the node's own name below", () => {
    expect(decode(titleMarkupOf(NATIONAL))).toBe("Ghana · national dashboard.");
    expect(decode(titleMarkupOf(REGION))).toBe("Western Region · regional dashboard.");
    expect(decode(titleMarkupOf(DISTRICT))).toBe("Wassa Amenfi West · district dashboard.");
    // The whole point of the national special case: the session's own label is NOT the headline.
    expect(titleMarkupOf(NATIONAL)).not.toContain("Ministry of Education");
    // The gold italic, with the trailing period inside it, survives the wiring at every tier.
    for (const [name, markup, word] of [
      ["NATIONAL", NATIONAL, "national"],
      ["REGION", REGION, "regional"],
      ["DISTRICT", DISTRICT, "district"],
    ] as const) {
      expect(markup, name).toContain(`<em class="accent-italic">${word} dashboard.</em>`);
    }
  });

  it("Scope and Source are DISTINCT slots, each carrying its own line", async () => {
    // The expected Source line is derived from the same coverage read the page makes, so this does not
    // hard-code a fixture count — but it is still the page's wiring under test: a page that sourced the
    // Scope string here, or counted the wrong child tier, fails.
    const sourceFor = async (
      chrome: ReturnType<typeof tierChrome>,
      scope: JurisdictionScope,
    ): Promise<string> =>
      sourceLine(chrome, childCountOf(chrome, okValue(await getSchoolCoverage(scope))));

    expect(provenanceOf(NATIONAL, "Source")).toBe(
      await sourceFor(NATIONAL_CHROME, nationalScope),
    );
    expect(provenanceOf(NATIONAL, "Source")).toMatch(/^Omnischools analytics DB · \d+ region rollup/);
    expect(provenanceOf(REGION, "Source")).toMatch(
      /^Omnischools analytics DB · \d+ district rollup/,
    );
    // District has no child jurisdictions to count, so it names its feeds instead.
    expect(provenanceOf(DISTRICT, "Source")).toBe(
      "Omnischools analytics DB · school feeds + WAEC & EMIS reference extracts",
    );
    expect(provenanceOf(DISTRICT, "Source")).not.toContain("rollup");

    // The Scope slot carries the ceiling claim — VERBATIM, and only in this slot.
    expect(provenanceOf(NATIONAL, "Scope")).toBe(
      "national · no jurisdiction ceiling — all regions visible",
    );
    expect(provenanceOf(REGION, "Scope")).toBe("Western Region · sibling regions not visible here");
    expect(provenanceOf(DISTRICT, "Scope")).toBe(
      "district-ceiling · you cannot see other districts here",
    );
    // The two slots cannot have been swapped or aliased.
    for (const [name, markup] of [
      ["NATIONAL", NATIONAL],
      ["REGION", REGION],
      ["DISTRICT", DISTRICT],
    ] as const) {
      expect(provenanceOf(markup, "Scope"), name).not.toContain("Omnischools analytics DB");
      expect(provenanceOf(markup, "Source"), name).not.toContain("visible here");
      expect(provenanceOf(markup, "Source"), name).not.toContain("ceiling");
      // Slice 1's generic placeholder is gone from the rendered page, not merely from the config.
      expect(markup, name).not.toContain("scoped to your jurisdiction subtree");
    }
    // The district Scope line is deliberately GENERIC: it must not name the district (Lucy §1.5).
    expect(provenanceOf(DISTRICT, "Scope")).not.toContain("Wassa Amenfi West");
  });

  it("the no-session backstop renders TIER-NEUTRAL chrome, never the widest tier", async () => {
    const markup = await renderPage(null);
    expect(crumbOf(markup)).toBe("Oversight · Dashboard");
    expect(markup).toContain('<em class="accent-italic">dashboard.</em>');
    expect(decode(markup)).toContain("Sign in required.");
    // The regression this exists for: reverting to slice 1's headline would claim the widest ceiling
    // on the very screen that is refusing to show anything.
    expect(decode(markup)).not.toContain("Ghana");
    expect(decode(markup)).not.toContain("national");
    expect(decode(markup)).not.toContain("Scope");
  });

  it("the tab title stays tier-neutral, because one route serves three tiers", async () => {
    vi.resetModules();
    const mod = await import("@/app/(oversight)/page");
    expect((mod.metadata as { title: string }).title).toBe("Oversight dashboard");
    vi.resetModules();
  });
});
