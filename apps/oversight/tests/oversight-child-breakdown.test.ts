import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { scopeFor, type JurisdictionScope } from "@/lib/db/rls";
import { isOk, unavailable, type Reading } from "@/lib/oversight/reading";
import { getEnrolmentTotal } from "@/lib/oversight/enrolment";
import { getExamQualification } from "@/lib/oversight/performance";
import { getSchoolCoverage } from "@/lib/oversight/coverage";
import {
  childLevelFor,
  getChildBreakdown,
  rankEnds,
  spreadOf,
  RANK_CARD_MIN_CANDIDATES,
  type BreakdownRow,
  type ChildBreakdown,
} from "@/lib/oversight/breakdown";
import {
  breakdownChrome,
  breakdownFooter,
  buildBreakdownTitle,
  tierChrome,
} from "@/components/oversight/tier-chrome";
import {
  BreakdownTable,
  COVERAGE_BANDS,
  WASSCE_QUALIFICATION_BANDS,
  initialsOf,
} from "@/components/oversight/breakdown-table";
import { BreakdownSection } from "@/components/oversight/breakdown-section";
import { PTR_AXIS, SpreadPanel } from "@/components/oversight/breakdown-visuals";
import {
  JUR,
  OFFICER,
  PERIOD_ID_ANNUAL,
  PERIOD_ID_EXAM_COHORT,
  PERIOD_ID_TERM,
} from "./fixtures/ids";
import {
  adminAnalytics,
  districtOfficer,
  nationalOfficer,
  officerFixture,
  selectsStoredPtr,
} from "./helpers";

/**
 * INCREMENT I · SLICE 3 — THE PER-CHILD ROLL-UP, against Wells's SLICE-3-ROLLUP-RULING §7.
 *
 * WHAT THIS FILE IS FOR. The slice-1 reads were a `sum()` whose filters are not expressible as
 * constraints. This one adds a second, worse class of silent defect: an ATTRIBUTION. Each fact row
 * carries only its SCHOOL node, so every figure in the breakdown table is the result of walking up
 * `dim_jurisdiction` — and the two ways that walk goes wrong both produce output that looks correct:
 *
 *  1. AN INNER JOIN ON AN ANCESTOR HOP returns ZERO ROWS for a district officer, because RLS hides an
 *     officer's own ancestors — and passes every test written at the national tier, where the predicate
 *     short-circuits. It fails as a BLANK TABLE, in production, for one tier. `the LEFT-vs-INNER trap`
 *     below is the named regression for it, and it asserts the broken form really is broken rather than
 *     only that the shipped form works.
 *  2. A MISSING `level` PIN silently attributes a mis-parented school's figures to a REGION row sitting
 *     in a DISTRICT breakdown — a wrong number with a plausible name beside it. `the level pin` below
 *     runs the unpinned form for comparison and shows it inventing exactly that row.
 *
 * Both are tested as negative controls (the `facilities-read-annual-pin` precedent), and every assertion
 * runs through `withJurisdiction()` as the NON-OWNER `ov_app` role, so each one is also an RLS assertion.
 *
 * THE FIXTURE DECOYS. The shared analytics fixture has two clean enrolment rows and no exam rows. This
 * file plants, as the OWNER: a THIRD district under Western with a thin exam cohort (the rank-card
 * floor), a SECOND region with its own district and school (the cross-region isolation assertion), a
 * MIS-PARENTED school hanging straight off the region (the unattributed bucket), the sexed and per-form
 * inflation decoys, and an older sitting (the period pin). It removes all of them in `afterAll`:
 * `tests/rls-tier-matrix.test.ts` asserts GLOBAL counts over `fact_enrolment` and
 * `ref_emis_school_register`, and the suite runs with `fileParallelism: false`.
 */

// ── test-local spine, all under the fixture's own national node ───────────────────────────────────
const TINY_DISTRICT = "10000000-0000-4000-8000-0000000000b1";
const TINY_SCHOOL = "10000000-0000-4000-8000-0000000000b2";
const OTHER_REGION = "10000000-0000-4000-8000-0000000000b3";
const OTHER_REGION_DISTRICT = "10000000-0000-4000-8000-0000000000b4";
const OTHER_REGION_SCHOOL = "10000000-0000-4000-8000-0000000000b5";
/** ⚠ parent_id = a REGION. A school one level too high: the level pin's whole reason for existing. */
const MISPARENTED_SCHOOL = "10000000-0000-4000-8000-0000000000b6";
const OLDER_COHORT = "20000000-0000-4000-8000-0000000000b7";
const REG_TINY = "EMIS-BRK-901";
const REG_OTHER_ON = "EMIS-BRK-902";
const REG_OTHER_OFF = "EMIS-BRK-903";

const TINY_DISTRICT_NAME = "Thin Cohort District";
const OTHER_REGION_NAME = "Eastern Region";
const OTHER_REGION_DISTRICT_NAME = "Koforidua Municipal";

/** Every figure this file asserts, in one place, so a failure reads as arithmetic and not as a uuid. */
const F = {
  /** Wassa Amenfi West (the fixture district) — school …11 only. */
  wassaEnrolment: 410,
  wassaCandidates: 110,
  wassaQualified: 82,
  /** Sekondi-Takoradi Metro — school …18. */
  sekondiEnrolment: 720,
  sekondiCandidates: 400,
  sekondiQualified: 100,
  tinyEnrolment: 50,
  tinyCandidates: 10,
  tinyQualified: 10,
  otherRegionEnrolment: 900,
  otherRegionCandidates: 200,
  otherRegionQualified: 40,
  misparentedEnrolment: 77,
} as const;

let owner: postgres.Sql;

const districtScope = scopeFor(districtOfficer);
const nationalScope = scopeFor(nationalOfficer);
const regionOfficer = officerFixture({
  officerId: OFFICER.regionId,
  officerRole: OFFICER.regionRole,
  jurisdictionId: JUR.region,
  level: "REGION",
});
const regionScope: JurisdictionScope = scopeFor(regionOfficer);

beforeAll(async () => {
  owner = adminAnalytics();

  await owner`
    insert into dim_jurisdiction (jurisdiction_id, level, parent_id, name, ges_code, school_type, ownership_type, is_reporting)
    values
      (${TINY_DISTRICT}::uuid,         'DISTRICT', ${JUR.region}::uuid,              ${TINY_DISTRICT_NAME},          null,          null,  null,     false),
      (${TINY_SCHOOL}::uuid,           'SCHOOL',   ${TINY_DISTRICT}::uuid,           'Thin Cohort SHS',              ${REG_TINY},   'SHS', 'PUBLIC', true),
      (${OTHER_REGION}::uuid,          'REGION',   ${JUR.national}::uuid,            ${OTHER_REGION_NAME},           null,          null,  null,     false),
      (${OTHER_REGION_DISTRICT}::uuid, 'DISTRICT', ${OTHER_REGION}::uuid,            ${OTHER_REGION_DISTRICT_NAME},  null,          null,  null,     false),
      (${OTHER_REGION_SCHOOL}::uuid,   'SCHOOL',   ${OTHER_REGION_DISTRICT}::uuid,   'Koforidua SHS',                ${REG_OTHER_ON}, 'SHS', 'PUBLIC', true),
      -- ⚠ MIS-PARENTED ON PURPOSE: a SCHOOL whose parent is a REGION. No DB constraint forbids it
      -- (lib/etl/dimensions.ts says so), and assertSpineIntact does not assert depth = 4.
      (${MISPARENTED_SCHOOL}::uuid,    'SCHOOL',   ${JUR.region}::uuid,              'Mis-parented JHS',             null,          'JHS', 'PUBLIC', true)
  `;

  await owner`
    insert into dim_period (period_id, academic_year, term, period_type, starts_on, ends_on, is_current)
    values (${OLDER_COHORT}::uuid, '2024/25', null, 'EXAM_COHORT', '2025-05-05', '2025-06-27', false)
  `;

  await owner`
    insert into fact_enrolment (jurisdiction_id, period_id, stage, class_form, sex, headcount, source, as_of_date)
    values
      -- 'JHS' throughout: dim_stage carries exactly that one stage in the shared fixture, and the
      -- stage is not what this file is about.
      (${TINY_SCHOOL}::uuid,            ${PERIOD_ID_ANNUAL}::uuid, 'JHS', null,     'ALL',    ${F.tinyEnrolment},        'OPERATIONAL_AGG', now()),
      (${OTHER_REGION_SCHOOL}::uuid,    ${PERIOD_ID_ANNUAL}::uuid, 'JHS', null,     'ALL',    ${F.otherRegionEnrolment}, 'OPERATIONAL_AGG', now()),
      (${MISPARENTED_SCHOOL}::uuid,     ${PERIOD_ID_ANNUAL}::uuid, 'JHS', null,     'ALL',    ${F.misparentedEnrolment}, 'OPERATIONAL_AGG', now()),
      -- the class_form inflation decoy, on the SAME school, ANNUAL period and stage total as the clean
      -- row. The MALE/FEMALE triple-count decoy is NOT here: the shared seed owns the sex split on this
      -- school (190/220 on the ANNUAL period), and two writers of one grain key would duplicate it —
      -- fact_enrolment has no grain UNIQUE (enrolment-grain ruling §2.6).
      (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_ANNUAL}::uuid, 'JHS', 'Form 2', 'ALL',    150, 'OPERATIONAL_AGG', now())
  `;

  await owner`
    insert into fact_performance_exam
      (jurisdiction_id, period_id, exam, sex, candidates, qualified, qualification_rate, source, as_of_date)
    values
      (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_EXAM_COHORT}::uuid, 'WASSCE', 'ALL',    100,  80, 80.00, 'WAEC_EXTRACT', now()),
      (${JUR.schoolPublicNoConsent}::uuid, ${PERIOD_ID_EXAM_COHORT}::uuid, 'WASSCE', 'ALL',     10,   2, 20.00, 'WAEC_EXTRACT', now()),
      (${JUR.schoolOutsideSubtree}::uuid,  ${PERIOD_ID_EXAM_COHORT}::uuid, 'WASSCE', 'ALL',    400, 100, 25.00, 'WAEC_EXTRACT', now()),
      -- 10 candidates, all qualified: 100%, and BELOW the rank-card floor. Without the floor this child
      -- is named "Strongest district" on the strength of ten pupils.
      (${TINY_SCHOOL}::uuid,               ${PERIOD_ID_EXAM_COHORT}::uuid, 'WASSCE', 'ALL',     10,  10, 100.00,'WAEC_EXTRACT', now()),
      (${OTHER_REGION_SCHOOL}::uuid,       ${PERIOD_ID_EXAM_COHORT}::uuid, 'WASSCE', 'ALL',    200,  40, 20.00, 'WAEC_EXTRACT', now()),
      -- the sexed decoys (×3 inflation) and an OLDER sitting (the period pin)
      (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_EXAM_COHORT}::uuid, 'WASSCE', 'MALE',    50,  40, 80.00, 'WAEC_EXTRACT', now()),
      (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_EXAM_COHORT}::uuid, 'WASSCE', 'FEMALE',  50,  40, 80.00, 'WAEC_EXTRACT', now()),
      (${JUR.schoolPublicConsented}::uuid, ${OLDER_COHORT}::uuid,          'WASSCE', 'ALL',   9000,  10,  0.11, 'WAEC_EXTRACT', now())
  `;

  await owner`
    insert into ref_emis_school_register
      (emis_school_id, name, district_id, region_id, school_type, ownership_type, on_schoolup,
       operational_school_id, source, as_of_date)
    values
      (${REG_TINY},      'Thin Cohort SHS', ${TINY_DISTRICT}::uuid,         ${JUR.region}::uuid,  'SHS', 'PUBLIC', true,  null, 'EMIS_EXTRACT', current_date),
      (${REG_OTHER_ON},  'Koforidua SHS',   ${OTHER_REGION_DISTRICT}::uuid, ${OTHER_REGION}::uuid,'SHS', 'PUBLIC', true,  null, 'EMIS_EXTRACT', current_date),
      (${REG_OTHER_OFF}, 'Nsawam JHS',      ${OTHER_REGION_DISTRICT}::uuid, ${OTHER_REGION}::uuid,'JHS', 'PUBLIC', false, null, 'EMIS_EXTRACT', current_date)
  `;
});

afterAll(async () => {
  // Every delete is scoped to what THIS file inserted — never by shape, which would silently remove
  // fixture data the day the seed grows a row of the same shape (the afterAll ruling).
  await owner`
    delete from fact_performance_exam
     where period_id in (${PERIOD_ID_EXAM_COHORT}::uuid, ${OLDER_COHORT}::uuid)
  `;
  // ⚠ Scope by class_form, NOT by `sex <> 'ALL'`. The shared seed now owns the MALE/FEMALE split on the
  // ANNUAL period for schoolPublicConsented, so a `sex <> 'ALL'` delete would eat fixture data. The three
  // named schools are wholly test-owned, so all their rows go; on the shared school only the per-form
  // decoy (class_form is not null) is this file's.
  await owner`
    delete from fact_enrolment
     where period_id = ${PERIOD_ID_ANNUAL}::uuid
       and (jurisdiction_id in (
              ${TINY_SCHOOL}::uuid, ${OTHER_REGION_SCHOOL}::uuid, ${MISPARENTED_SCHOOL}::uuid
            )
            or (jurisdiction_id = ${JUR.schoolPublicConsented}::uuid
                and class_form is not null))
  `;
  await owner`delete from dim_period where period_id = ${OLDER_COHORT}::uuid`;
  await owner`
    delete from ref_emis_school_register
     where emis_school_id in (${REG_TINY}, ${REG_OTHER_ON}, ${REG_OTHER_OFF})
  `;
  // Children before parents.
  await owner`
    delete from dim_jurisdiction
     where jurisdiction_id in (
       ${TINY_SCHOOL}::uuid, ${OTHER_REGION_SCHOOL}::uuid, ${MISPARENTED_SCHOOL}::uuid,
       ${OTHER_REGION_DISTRICT}::uuid, ${TINY_DISTRICT}::uuid, ${OTHER_REGION}::uuid
     )
  `;
  await owner.end({ timeout: 5 });
});

/** A raw read run with the GUCs `withJurisdiction()` would set, as the APP role. Rolled back. */
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

function okValue<T>(reading: Reading<T>): T {
  expect(reading.status).toBe("ok");
  if (!isOk(reading)) throw new Error("expected an `ok` reading, got `unavailable`");
  return reading.value;
}

/** The read under test, with the two periods the dashboard pins resolved ONCE and passed in. */
async function readBreakdown(
  scope: JurisdictionScope,
  overrides: {
    examPeriodId?: string | null;
    termPeriodId?: string | null;
    annualPeriodId?: string | null;
  } = {},
): Promise<ChildBreakdown> {
  return okValue(
    await getChildBreakdown(scope, {
      childLevel: childLevelFor(scope.level),
      termPeriodId: PERIOD_ID_TERM,
      examPeriodId: PERIOD_ID_EXAM_COHORT,
      annualPeriodId: PERIOD_ID_ANNUAL,
      exam: "WASSCE",
      ...overrides,
    }),
  );
}

function named(breakdown: ChildBreakdown, name: string): BreakdownRow {
  const row = breakdown.children.find((r) => r.name === name);
  expect(row, `no child row named "${name}"`).toBeDefined();
  return row!;
}

const sum = (rows: BreakdownRow[], pick: (r: BreakdownRow) => number | null): number =>
  rows.reduce((acc, r) => acc + (pick(r) ?? 0), 0);

/** Children + the unattributed bucket: everything the table prints above its total row. */
function allRows(breakdown: ChildBreakdown): BreakdownRow[] {
  return breakdown.unattributed === null
    ? breakdown.children
    : [...breakdown.children, breakdown.unattributed];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (c) THE LEFT-vs-INNER TRAP — the one defect that fails as a blank table for ONE tier
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the LEFT-vs-INNER trap: a sub-national officer's breakdown is NOT empty", () => {
  it("a DISTRICT officer's own REGION row is invisible to them — the premise of the trap", async () => {
    const visible = await asOfficer(districtScope, async (tx) => {
      const rows = (await tx`
        select count(*)::int as n from dim_jurisdiction
         where jurisdiction_id = ${JUR.region}::uuid
      `) as unknown as { n: number }[];
      return Number(rows[0]!.n);
    });
    // `ov_in_subtree` admits the current node and its DESCENDANTS. An ancestor is not one.
    expect(visible).toBe(0);
  });

  it("REGRESSION: a DISTRICT officer's breakdown returns non-empty rows", async () => {
    const breakdown = await readBreakdown(districtScope);
    expect(breakdown.childLevel).toBe("SCHOOL");
    expect(breakdown.children.length).toBeGreaterThan(0);
    // One row per SCHOOL that filed something — the ruling's §3 district tier, not a degenerate
    // single-row table and not the sibling districts.
    expect(breakdown.children.map((r) => r.name).sort()).toEqual([
      "Amenfiman SHS",
      "Asankrangwa SHS",
    ]);
  });

  it("REGRESSION: a REGION officer's breakdown returns non-empty rows, one per district", async () => {
    const breakdown = await readBreakdown(regionScope);
    expect(breakdown.childLevel).toBe("DISTRICT");
    expect(breakdown.children.map((r) => r.name).sort()).toEqual([
      "Sekondi-Takoradi Metro",
      TINY_DISTRICT_NAME,
      "Wassa Amenfi West",
    ]);
  });

  it("the INNER-JOIN form really does return ZERO rows for that officer — the broken query, run", async () => {
    // Without this control the test above passes for a shape that was never at risk. The ONLY change
    // between the two statements is `left join` → `join` on the two ancestor hops.
    const counts = await asOfficer(districtScope, async (tx) => {
      const left = (await tx`
        select count(*)::int as n
          from fact_enrolment fe
          join      dim_jurisdiction s on s.jurisdiction_id = fe.jurisdiction_id and s.level = 'SCHOOL'
          left join dim_jurisdiction d on d.jurisdiction_id = s.parent_id        and d.level = 'DISTRICT'
          left join dim_jurisdiction r on r.jurisdiction_id = d.parent_id        and r.level = 'REGION'
         where fe.period_id = ${PERIOD_ID_ANNUAL}::uuid and fe.sex = 'ALL' and fe.class_form is null
      `) as unknown as { n: number }[];
      const inner = (await tx`
        select count(*)::int as n
          from fact_enrolment fe
          join dim_jurisdiction s on s.jurisdiction_id = fe.jurisdiction_id and s.level = 'SCHOOL'
          join dim_jurisdiction d on d.jurisdiction_id = s.parent_id        and d.level = 'DISTRICT'
          join dim_jurisdiction r on r.jurisdiction_id = d.parent_id        and r.level = 'REGION'
         where fe.period_id = ${PERIOD_ID_ANNUAL}::uuid and fe.sex = 'ALL' and fe.class_form is null
      `) as unknown as { n: number }[];
      return { left: Number(left[0]!.n), inner: Number(inner[0]!.n) };
    });
    expect(counts.left).toBeGreaterThan(0);
    expect(counts.inner).toBe(0);
  });

  it("…and the same INNER form looks perfectly healthy at NATIONAL, which is why it ships", async () => {
    const inner = await asOfficer(nationalScope, async (tx) => {
      const rows = (await tx`
        select count(*)::int as n
          from fact_enrolment fe
          join dim_jurisdiction s on s.jurisdiction_id = fe.jurisdiction_id and s.level = 'SCHOOL'
          join dim_jurisdiction d on d.jurisdiction_id = s.parent_id        and d.level = 'DISTRICT'
          join dim_jurisdiction r on r.jurisdiction_id = d.parent_id        and r.level = 'REGION'
         where fe.period_id = ${PERIOD_ID_ANNUAL}::uuid and fe.sex = 'ALL' and fe.class_form is null
      `) as unknown as { n: number }[];
      return Number(rows[0]!.n);
    });
    // `ov_is_national()` short-circuits the predicate, so every spine row resolves. A national-only
    // test suite cannot distinguish the two join styles at all.
    expect(inner).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (e) THE LEVEL PIN AND THE UNATTRIBUTED BUCKET
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the level pin sends a mis-parented school to the unattributed bucket", () => {
  it("the mis-parented school is real, visible to the region officer, and one level too high", async () => {
    const row = await asOfficer(regionScope, async (tx) => {
      const rows = (await tx`
        select dj.level::text as level, parent.level::text as parent_level
          from dim_jurisdiction dj
          join dim_jurisdiction parent on parent.jurisdiction_id = dj.parent_id
         where dj.jurisdiction_id = ${MISPARENTED_SCHOOL}::uuid
      `) as unknown as { level: string; parent_level: string }[];
      return rows[0]!;
    });
    expect(row.level).toBe("SCHOOL");
    // A SCHOOL under a REGION: the state the ruling says this query must survive.
    expect(row.parent_level).toBe("REGION");
  });

  it("its enrolment lands in the unattributed bucket, not in any district row", async () => {
    const breakdown = await readBreakdown(regionScope);
    expect(breakdown.unattributed).not.toBeNull();
    expect(breakdown.unattributed!.childId).toBeNull();
    expect(breakdown.unattributed!.enrolment).toBe(F.misparentedEnrolment);
    expect(breakdown.unattributed!.schoolsFiling).toBe(1);
    // …and no child row absorbed it.
    for (const child of breakdown.children) {
      expect(child.enrolment ?? 0).not.toBe(F.misparentedEnrolment);
    }
    expect(named(breakdown, "Wassa Amenfi West").enrolment).toBe(F.wassaEnrolment);
  });

  it("WITHOUT the level pin it becomes a REGION row inside a DISTRICT breakdown — the control", async () => {
    // The unpinned form attributes the mis-parented school to its parent, which is a REGION, and prints
    // it beside the real districts under a plausible name. This is the "wrong number that looks right".
    const rows = await asOfficer(regionScope, async (tx) => {
      return (await tx`
        select d.name as name, sum(fe.headcount)::int as headcount
          from fact_enrolment fe
          join      dim_jurisdiction s on s.jurisdiction_id = fe.jurisdiction_id and s.level = 'SCHOOL'
          -- NO level pin on the hop:
          left join dim_jurisdiction d on d.jurisdiction_id = s.parent_id
         where fe.period_id = ${PERIOD_ID_ANNUAL}::uuid and fe.sex = 'ALL' and fe.class_form is null
         group by d.name
      `) as unknown as { name: string | null; headcount: number }[];
    });
    const leaked = rows.find((r) => r.name === "Western Region");
    expect(leaked, "the unpinned form should invent a region-named child row").toBeDefined();
    expect(Number(leaked!.headcount)).toBe(F.misparentedEnrolment);
    // The shipped read has no such row: it is a district breakdown, and every name in it is a district.
    const breakdown = await readBreakdown(regionScope);
    expect(breakdown.children.map((r) => r.name)).not.toContain("Western Region");
  });

  it("the bucket is in the payload, never filtered away", async () => {
    // Filtering it is the tempting tidy-up, and it is the one that breaks the grain: Σchildren would
    // then be less than the total row, which no amount of UI can make honest.
    const breakdown = await readBreakdown(regionScope);
    expect(allRows(breakdown)).toHaveLength(breakdown.children.length + 1);
    expect(sum(allRows(breakdown), (r) => r.enrolment)).toBe(breakdown.total.enrolment);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (a) Σ(child rows) = THE `()` TOTAL ROW, AT ALL THREE TIERS
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("Σchildren = the total row, at every tier", () => {
  it("district", async () => {
    const b = await readBreakdown(districtScope);
    expect(sum(allRows(b), (r) => r.enrolment)).toBe(b.total.enrolment);
    expect(sum(allRows(b), (r) => r.candidates)).toBe(b.total.candidates);
    expect(sum(allRows(b), (r) => r.qualified)).toBe(b.total.qualified);
  });

  it("region — including the unattributed bucket, which is where the gap legitimately lives", async () => {
    const b = await readBreakdown(regionScope);
    expect(b.total.enrolment).toBe(
      F.wassaEnrolment + F.sekondiEnrolment + F.tinyEnrolment + F.misparentedEnrolment,
    );
    expect(sum(allRows(b), (r) => r.enrolment)).toBe(b.total.enrolment);
    expect(sum(allRows(b), (r) => r.candidates)).toBe(b.total.candidates);
    // Σ over the CHILDREN ALONE is short by exactly the bucket — the arithmetic the table has to show.
    expect(sum(b.children, (r) => r.enrolment)).toBe(
      b.total.enrolment! - F.misparentedEnrolment,
    );
  });

  it("national — and the register side reconciles too", async () => {
    const b = await readBreakdown(nationalScope);
    expect(sum(allRows(b), (r) => r.enrolment)).toBe(b.total.enrolment);
    expect(sum(allRows(b), (r) => r.candidates)).toBe(b.total.candidates);
    expect(sum(allRows(b), (r) => r.schoolsRegistered)).toBe(b.total.schoolsRegistered);
    expect(sum(allRows(b), (r) => r.schoolsReporting)).toBe(b.total.schoolsReporting);
  });

  it("a figure that cannot be stated degrades the whole section, never a partial total", async () => {
    // The reconciliation guard's own branch is, by design, unreachable while the unattributed bucket is
    // RETURNED rather than filtered — which is the property the three tests above assert. It is a belt
    // against a future edit that drops the bucket: the arithmetic would then fail and the section would
    // degrade to its banner instead of printing a total that is not the sum of the rows above it. What is
    // reachable, and asserted here, is the sibling rule: any unstateable read degrades the SECTION as a
    // whole, so no half-populated table with a confident total can ever render.
    expect(
      await getChildBreakdown(districtScope, {
        childLevel: "SCHOOL",
        termPeriodId: PERIOD_ID_TERM,
        examPeriodId: "not-a-uuid",
        annualPeriodId: PERIOD_ID_ANNUAL,
        exam: "WASSCE",
      }),
    ).toEqual(unavailable());
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (a2) GIRLS' SHARE — the FEMALE arm sums off the SAME ANNUAL period, and the share is the weighted ratio
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the girls'-share arm reads FEMALE off the same ANNUAL period as enrolment", () => {
  it("per child it is Σfemale ÷ Σenrolment, from the seed's ANNUAL sex split", async () => {
    // The seed carries the MALE/FEMALE split on the ANNUAL period: …0011 is 220/410, …0018 is 320/720.
    const b = await readBreakdown(regionScope);
    const wassa = named(b, "Wassa Amenfi West");
    const sekondi = named(b, "Sekondi-Takoradi Metro");
    expect(wassa.femaleEnrolment).toBe(220);
    expect(wassa.enrolment).toBe(410);
    expect(wassa.girlsShare).toBeCloseTo(220 / 410, 10);
    expect(sekondi.femaleEnrolment).toBe(320);
    expect(sekondi.girlsShare).toBeCloseTo(320 / 720, 10);
  });

  it("the total's share is the WEIGHTED Σfemale÷Σenrolment, never the mean of the children's", async () => {
    const b = await readBreakdown(regionScope);
    // The total row comes from the same GROUPING SETS scan, so it is the real Σ÷Σ.
    expect(b.total.girlsShare).toBeCloseTo(
      (b.total.femaleEnrolment ?? 0) / (b.total.enrolment ?? 1),
      10,
    );
    // …and it is NOT the unweighted mean of the districts' own shares.
    const shares = b.children
      .map((r) => r.girlsShare)
      .filter((v): v is number => v !== null);
    const mean = shares.reduce((a, v) => a + v, 0) / shares.length;
    expect(b.total.girlsShare).not.toBeCloseTo(mean, 4);
  });

  it("femaleEnrolment reconciles Σchildren + unattributed = total, like every additive measure", async () => {
    const b = await readBreakdown(regionScope);
    const summed = allRows(b).reduce((acc, r) => acc + (r.femaleEnrolment ?? 0), 0);
    expect(summed).toBe(b.total.femaleEnrolment);
    // The mis-parented school filed no FEMALE row, so the bucket's femaleEnrolment is a null, not a 0.
    expect(b.unattributed!.femaleEnrolment).toBeNull();
    expect(b.unattributed!.girlsShare).toBeNull();
  });

  it("the share is NOT clamped — a school whose FEMALE row is absent reads a null share, not 0", async () => {
    // TINY_SCHOOL filed only an ALL row (no FEMALE), so its district has enrolment but a null numerator.
    const b = await readBreakdown(regionScope);
    const tiny = named(b, TINY_DISTRICT_NAME);
    expect(tiny.enrolment).toBe(F.tinyEnrolment);
    expect(tiny.femaleEnrolment).toBeNull();
    expect(tiny.girlsShare).toBeNull();
  });

  it("class_form IS NULL is load-bearing on the FEMALE arm too — a per-form girls' row does NOT inflate", async () => {
    // The sex filter's load-bearingness on this arm is proved by the seed's MALE row (190 would land in
    // the numerator without it). The class_form filter had no FEMALE-shaped decoy anywhere in the suite,
    // so dropping it from the FEMALE arm alone changed no figure — the filter was correct but unproven.
    // Plant the missing shape: a per-form FEMALE row beside the stage total, on the same school, period
    // and stage, which is exactly what the ETL writes beside the class_form-NULL total.
    await owner`
      insert into fact_enrolment (jurisdiction_id, period_id, stage, class_form, sex, headcount, source, as_of_date)
      values (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_ANNUAL}::uuid, 'JHS', 'Form 2', 'FEMALE', 70, 'OPERATIONAL_AGG', now())
    `;
    try {
      const b = await readBreakdown(regionScope);
      const wassa = named(b, "Wassa Amenfi West");
      // The filtered figure is untouched by the per-form row.
      expect(wassa.femaleEnrolment).toBe(220);
      expect(wassa.girlsShare).toBeCloseTo(220 / 410, 10);
      // …and the decoy is really there, so the assertion above is the filter doing work: the same sum
      // without `class_form is null` reads 290 and the share would be a false 70.7%.
      const inflated = await asOfficer(regionScope, async (tx) => {
        const rows = (await tx`
          select sum(fe.headcount)::int as headcount
            from fact_enrolment fe
            join dim_jurisdiction s on s.jurisdiction_id = fe.jurisdiction_id and s.level = 'SCHOOL'
           where fe.period_id = ${PERIOD_ID_ANNUAL}::uuid and fe.sex = 'FEMALE'
             and s.parent_id = ${JUR.district}::uuid
        `) as unknown as { headcount: number }[];
        return Number(rows[0]!.headcount);
      });
      expect(inflated).toBe(220 + 70);
      expect(inflated).toBeGreaterThan(wassa.femaleEnrolment!);
    } finally {
      await owner`
        delete from fact_enrolment
         where period_id = ${PERIOD_ID_ANNUAL}::uuid
           and jurisdiction_id = ${JUR.schoolPublicConsented}::uuid
           and sex = 'FEMALE' and class_form = 'Form 2'
      `;
    }
  });

  it("a share ABOVE 1 SURFACES rather than being clamped — the only symptom of a lost filter", async () => {
    // The ruling's reason for forbidding a clamp: girlsShare > 1 means a duplicate grain row or a
    // dropped filter, and `Math.min(1, …)` would hide the only evidence of it. Force the broken state
    // (FEMALE > ALL, which the ETL asserts can never happen) and assert the read REPORTS it.
    await owner`
      insert into fact_enrolment (jurisdiction_id, period_id, stage, class_form, sex, headcount, source, as_of_date)
      values (${TINY_SCHOOL}::uuid, ${PERIOD_ID_ANNUAL}::uuid, 'JHS', null, 'FEMALE', ${F.tinyEnrolment + 10}, 'OPERATIONAL_AGG', now())
    `;
    try {
      const tiny = named(await readBreakdown(regionScope), TINY_DISTRICT_NAME);
      expect(tiny.enrolment).toBe(F.tinyEnrolment);
      expect(tiny.femaleEnrolment).toBe(F.tinyEnrolment + 10);
      expect(tiny.girlsShare).toBeGreaterThan(1);
      expect(tiny.girlsShare).toBeCloseTo((F.tinyEnrolment + 10) / F.tinyEnrolment, 10);
    } finally {
      await owner`
        delete from fact_enrolment
         where period_id = ${PERIOD_ID_ANNUAL}::uuid
           and jurisdiction_id = ${TINY_SCHOOL}::uuid and sex = 'FEMALE'
      `;
    }
  });

  it("femaleEnrolment is ANDed INTO `reconciles`, not computed and dropped", () => {
    // The same static guard the PTR components carry (oversight-ptr.test.ts): the conjunct can be
    // deleted without moving any figure, so the source is where it has to be asserted.
    const code = readCode("lib/oversight/breakdown.ts");
    const guard = code.slice(code.indexOf("const reconciles ="));
    expect(guard.slice(0, 600)).toContain("sumOf((r) => r.femaleEnrolment)");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (b) THE TOTAL ROW IS THE SLICE-1 KPI READ, FOR THE SAME SCOPE AND THE SAME PERIOD
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the total row equals the KPI strip above it", () => {
  for (const [name, scope] of [
    ["district", districtScope],
    ["region", regionScope],
    ["national", nationalScope],
  ] as const) {
    it(`${name}: enrolment, WASSCE and coverage all agree with the slice-1 reads`, async () => {
      const b = await readBreakdown(scope);
      const enrolment = okValue(await getEnrolmentTotal(scope, PERIOD_ID_ANNUAL));
      const wassce = okValue(
        await getExamQualification(scope, "WASSCE", PERIOD_ID_EXAM_COHORT),
      );
      // This is the cross-module commitment Lucy's map calls out: the table's total row IS the KPI
      // figure, computed from the same two periods — never a separate placeholder.
      expect(b.total.enrolment).toBe(enrolment.total);
      expect(b.total.candidates).toBe(wassce.candidates);
      expect(b.total.qualified).toBe(wassce.qualified);
      expect(b.total.wassceRate).toBeCloseTo(wassce.rate, 10);
      if (b.hasCoverage) {
        const coverage = okValue(await getSchoolCoverage(scope));
        expect(b.total.schoolsReporting).toBe(coverage.reporting);
        expect(b.total.schoolsRegistered).toBe(coverage.registered);
        expect(b.total.coverageRatio).toBeCloseTo(coverage.ratio, 10);
      }
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (d) ONE OFFICER'S CHILDREN ONLY — a second region's districts are absent, by name AND by id
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the row set is the officer's own children and nothing else", () => {
  it("a REGION officer sees their three districts; the other region's district is absent", async () => {
    const b = await readBreakdown(regionScope);
    const names = b.children.map((r) => r.name);
    expect(names).toContain("Wassa Amenfi West");
    expect(names).not.toContain(OTHER_REGION_DISTRICT_NAME);
    expect(names).not.toContain(OTHER_REGION_NAME);
    // Ids too, not only labels: a leak that returned the right names and the wrong ids is still a leak,
    // and the id is what a drill target would use.
    const payload = JSON.stringify(b);
    expect(payload).not.toContain(OTHER_REGION_DISTRICT);
    expect(payload).not.toContain(OTHER_REGION);
    expect(payload).not.toContain(OTHER_REGION_SCHOOL);
    // …and the other region's figures are in no total either.
    expect(b.total.enrolment).not.toBe(
      F.wassaEnrolment +
        F.sekondiEnrolment +
        F.tinyEnrolment +
        F.misparentedEnrolment +
        F.otherRegionEnrolment,
    );
  });

  it("a DISTRICT officer sees only their own schools", async () => {
    const b = await readBreakdown(districtScope);
    const payload = JSON.stringify(b);
    // Takoradi SHS is the fixture's out-of-district school, with 720 pupils and 400 candidates.
    expect(payload).not.toContain(JUR.schoolOutsideSubtree);
    expect(b.children.map((r) => r.name)).not.toContain("Takoradi SHS");
    expect(b.total.enrolment).toBe(F.wassaEnrolment);
    expect(b.total.candidates).toBe(F.wassaCandidates);
  });

  it("a NATIONAL officer sees both regions", async () => {
    const b = await readBreakdown(nationalScope);
    expect(b.children.map((r) => r.name).sort()).toEqual([
      OTHER_REGION_NAME,
      "Western Region",
    ]);
    expect(named(b, OTHER_REGION_NAME).enrolment).toBe(F.otherRegionEnrolment);
    expect(named(b, "Western Region").enrolment).toBe(
      F.wassaEnrolment + F.sekondiEnrolment + F.tinyEnrolment,
    );
  });

  it("no ancestor id reaches the payload — `parent_id` is never selected", async () => {
    for (const scope of [districtScope, regionScope, nationalScope]) {
      const payload = JSON.stringify(await readBreakdown(scope));
      // `parent_id` is readable on a visible row and may NAME AN INVISIBLE NODE, so it must not cross
      // into the app (Wells §2). The officer's own node is an ancestor of every child here, so its
      // absence is the observable form of that rule.
      if (scope.jurisdictionId !== null) {
        expect(payload, scope.level).not.toContain(scope.jurisdictionId);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (g) RATES ARE Σnum ÷ Σden, PER CHILD — never the mean of the children's (or the schools') rates
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("per-child rates are candidate-weighted", () => {
  it("a district's rate is Σqualified ÷ Σcandidates over its schools, not their mean", async () => {
    const b = await readBreakdown(regionScope);
    const wassa = named(b, "Wassa Amenfi West");
    expect(wassa.candidates).toBe(F.wassaCandidates);
    expect(wassa.qualified).toBe(F.wassaQualified);
    expect(wassa.wassceRate).toBeCloseTo(F.wassaQualified / F.wassaCandidates, 10); // 74.5%
    // The wrong query, for comparison: the unweighted mean of the two schools' stored rates (80% and
    // 20%) is 50% — 24.5 points away, and nothing in the output would signal it.
    const meanOfSchoolRates = await asOfficer(regionScope, async (tx) => {
      const rows = (await tx`
        select avg(fpe.qualification_rate)::float8 as r
          from fact_performance_exam fpe
          join dim_jurisdiction s on s.jurisdiction_id = fpe.jurisdiction_id and s.level = 'SCHOOL'
         where fpe.period_id = ${PERIOD_ID_EXAM_COHORT}::uuid and fpe.exam = 'WASSCE'
           and fpe.sex = 'ALL' and s.parent_id = ${JUR.district}::uuid
      `) as unknown as { r: number }[];
      return Number(rows[0]!.r) / 100;
    });
    expect(meanOfSchoolRates).toBeCloseTo(0.5, 10);
    expect(Math.abs(wassa.wassceRate! - meanOfSchoolRates)).toBeGreaterThan(0.2);
  });

  it("the total row's rate is not the mean of the CHILDREN's rates either", async () => {
    const b = await readBreakdown(regionScope);
    const rates = b.children.map((r) => r.wassceRate!).filter((r) => r !== null);
    const unweighted = rates.reduce((a, c) => a + c, 0) / rates.length;
    expect(b.total.wassceRate).toBeCloseTo(b.total.qualified! / b.total.candidates!, 10);
    expect(Math.abs(b.total.wassceRate! - unweighted)).toBeGreaterThan(0.1);
  });

  it("stored rates are structurally out of reach — none is in the allow-list", () => {
    const code = readCode("lib/oversight/breakdown.ts");
    expect(code).not.toMatch(/\bqualification_rate\b/);
    // This stored rate lives on a fact table this module never reads (fact_plc_participation), so the
    // column name must not appear at all.
    expect(code).not.toContain("plc_participation_rate");
    // PTR and ATTENDANCE are the exceptions that prove the rule: fact_staffing (aliased `fs`) and
    // fact_attendance (aliased `fa`) ARE read here, for the PTR and attendance numerator/denominator —
    // but their STORED per-school rate columns (`ptr`, `attendance_rate`) are NEVER selected. Each
    // roll-up is Σnum ÷ Σden, re-derived, never the stored rate. So the precise guard is "the stored
    // rate column is never selected under ANY alias", not "the substring never appears" (the re-derived
    // `row.ptr` / `row.attendanceRate` fields and the module's own prose legitimately contain them).
    // ALIAS-BLIND, over the module's SQL text only (`selectsStoredPtr`, tests/helpers.ts — shared with
    // the three other files asserting this rule). The former alias allow-list was evadable by a plain
    // re-alias (`select s.ptr`), which is the smuggling route it existed to close.
    expect(selectsStoredPtr(code)).toBe(false);
    expect(code).not.toMatch(/\b(fa|fact_attendance)\.attendance_rate\b/);
  });

  it("no cohort means NO RATE — never a confident 0%", async () => {
    const b = await readBreakdown(regionScope, { examPeriodId: null });
    for (const row of allRows(b)) {
      expect(row.candidates).toBeNull();
      expect(row.wassceRate).toBeNull();
    }
    // …and the enrolment column is untouched by the missing sitting.
    expect(b.total.enrolment).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (f) TRAPS 2–4: every mandatory filter, re-run without it, moves the figure
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("each mandatory filter is load-bearing per child, not only in the total", () => {
  it("the decoys are really there, on the same school and period as the clean rows", async () => {
    const rows = await asOfficer(districtScope, async (tx) => {
      return (await tx`
        select sex::text as sex, class_form from fact_enrolment
         where jurisdiction_id = ${JUR.schoolPublicConsented}::uuid
           and period_id = ${PERIOD_ID_ANNUAL}::uuid
      `) as unknown as { sex: string; class_form: string | null }[];
    });
    // 2 non-ALL rows (the seed's MALE 190 / FEMALE 220 split) and 1 per-form row (this file's decoy).
    expect(rows.filter((r) => r.sex !== "ALL")).toHaveLength(2);
    expect(rows.filter((r) => r.class_form !== null)).toHaveLength(1);
  });

  it("DROPPING sex='ALL' inflates the child's enrolment AND its candidate count", async () => {
    const b = await readBreakdown(regionScope);
    const inflated = await asOfficer(regionScope, async (tx) => {
      const rows = (await tx`
        select sum(fe.headcount)::int as headcount
          from fact_enrolment fe
          join dim_jurisdiction s on s.jurisdiction_id = fe.jurisdiction_id and s.level = 'SCHOOL'
         where fe.period_id = ${PERIOD_ID_ANNUAL}::uuid and fe.class_form is null
           and s.parent_id = ${JUR.district}::uuid
      `) as unknown as { headcount: number }[];
      const exam = (await tx`
        select sum(fpe.candidates)::int as candidates
          from fact_performance_exam fpe
          join dim_jurisdiction s on s.jurisdiction_id = fpe.jurisdiction_id and s.level = 'SCHOOL'
         where fpe.period_id = ${PERIOD_ID_EXAM_COHORT}::uuid and fpe.exam = 'WASSCE'
           and s.parent_id = ${JUR.district}::uuid
      `) as unknown as { candidates: number }[];
      return {
        enrolment: Number(rows[0]!.headcount),
        candidates: Number(exam[0]!.candidates),
      };
    });
    const wassa = named(b, "Wassa Amenfi West");
    expect(inflated.enrolment).toBe(F.wassaEnrolment + 190 + 220);
    expect(inflated.enrolment).toBeGreaterThan(wassa.enrolment!);
    // ⚠ The candidate count is 3× the cohort while the RATE still comes out right (the factor cancels),
    // which is what makes this the dangerous one: it would silently satisfy the rank-card floor.
    expect(inflated.candidates).toBe(F.wassaCandidates + 100);
    expect(inflated.candidates).toBeGreaterThan(wassa.candidates!);
  });

  it("DROPPING class_form IS NULL inflates the child's enrolment", async () => {
    const b = await readBreakdown(regionScope);
    const inflated = await asOfficer(regionScope, async (tx) => {
      const rows = (await tx`
        select sum(fe.headcount)::int as headcount
          from fact_enrolment fe
          join dim_jurisdiction s on s.jurisdiction_id = fe.jurisdiction_id and s.level = 'SCHOOL'
         where fe.period_id = ${PERIOD_ID_ANNUAL}::uuid and fe.sex = 'ALL'
           and s.parent_id = ${JUR.district}::uuid
      `) as unknown as { headcount: number }[];
      return Number(rows[0]!.headcount);
    });
    expect(inflated).toBe(F.wassaEnrolment + 150);
    expect(inflated).toBeGreaterThan(named(b, "Wassa Amenfi West").enrolment!);
  });

  it("the sitting is PINNED ONCE and passed in — the older cohort's 9,000 candidates are absent", async () => {
    const pinned = await readBreakdown(regionScope);
    expect(named(pinned, "Wassa Amenfi West").candidates).toBe(F.wassaCandidates);
    // The same read against the OTHER sitting: a different cohort entirely, which is exactly why two of
    // them must never be summed and why children must never resolve their own.
    const older = await readBreakdown(regionScope, { examPeriodId: OLDER_COHORT });
    expect(named(older, "Wassa Amenfi West").candidates).toBe(9000);
    expect(older.total.candidates).toBe(9000);
  });

  it("the module resolves no period of its own — it cannot rank children against two sittings", () => {
    const code = readCode("lib/oversight/breakdown.ts");
    expect(code).not.toMatch(/getCurrentPeriod|getLatestExamCohortPeriod/);
    expect(code).not.toMatch(/is_current/);
    // One period parameter per measure, bound once, applied to every child in the same scan.
    expect(code).toMatch(/termPeriodId/);
    expect(code).toMatch(/examPeriodId/);
    expect(code).toMatch(/annualPeriodId/);
  });

  it("the stocks bind the SAME annual parameter and attendance alone binds the term one", () => {
    // The enrolment-grain regression guard (enrolment-grain ruling §2.6/§3): the enrolment, girls'-share
    // and staffing arms are ANNUAL stocks pinned to the ONE annualPeriodId, and attendance is the only arm
    // on termPeriodId. The one place the enrolment grain is stated is this binding — so count it, cheaply
    // and durably, in the `facts` CTE. enrolment + ENROLMENT_FEMALE + staffing + ESTABLISHMENT = 4 annual bindings;
    // attendance = 1 term binding. Both enrolment arms binding the SAME parameter is what keeps the
    // girls'-share numerator and denominator from ever being pinned to different periods. The
    // ESTABLISHMENT arm (increment J — teacher vacancies) is a FOURTH annual binding: it reads the same
    // fact_staffing rows on the same ANNUAL period, filtered to the PUBLIC ones that carry a GES
    // establishment, so the vacancy figures can never describe a different year from the PTR beside them.
    const code = readCode("lib/oversight/breakdown.ts");
    const factsCte = code.slice(code.indexOf("facts as ("), code.indexOf("attributed as ("));
    const count = (needle: string) => factsCte.split(needle).length - 1;
    expect(count("${annualPeriodId}::uuid")).toBe(4);
    expect(count("${termPeriodId}::uuid")).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// COVERAGE COLUMNS: the register's own key, and the DISTRICT-tier drop
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the coverage columns come from the register, grouped on a key it already carries", () => {
  it("they are present at national and region, and ABSENT at district", async () => {
    expect((await readBreakdown(nationalScope)).hasCoverage).toBe(true);
    expect((await readBreakdown(regionScope)).hasCoverage).toBe(true);
    // The register is keyed on `emis_school_id` and carries no school-node uuid, so there is nothing to
    // group by when the child is a school. Bridging via `ges_code` would fan out: no UNIQUE index.
    const district = await readBreakdown(districtScope);
    expect(district.hasCoverage).toBe(false);
    for (const row of [...district.children, district.total]) {
      expect(row.coverageRatio).toBeNull();
      expect(row.schoolsRegistered).toBeNull();
    }
  });

  it("the module does not join the register to the spine on ges_code", () => {
    const code = readCode("lib/oversight/breakdown.ts");
    expect(code).not.toMatch(/ges_code/);
    expect(code).not.toMatch(/emis_school_id/);
  });

  it("a child in the register that filed no facts still appears, with a null enrolment", async () => {
    // Lucy §8.2 / Wells §3: the row set is register ∪ facts. "No return filed" is not "0 pupils".
    const REGISTER_ONLY_DISTRICT = "10000000-0000-4000-8000-0000000000b8";
    const REGISTER_ONLY_SCHOOL = "EMIS-BRK-904";
    await owner`
      insert into dim_jurisdiction (jurisdiction_id, level, parent_id, name, is_reporting)
      values (${REGISTER_ONLY_DISTRICT}::uuid, 'DISTRICT', ${JUR.region}::uuid, 'Filed Nothing District', false)
    `;
    await owner`
      insert into ref_emis_school_register
        (emis_school_id, name, district_id, region_id, school_type, ownership_type, on_schoolup,
         operational_school_id, source, as_of_date)
      values (${REGISTER_ONLY_SCHOOL}, 'Filed Nothing JHS', ${REGISTER_ONLY_DISTRICT}::uuid, ${JUR.region}::uuid, 'JHS', 'PUBLIC', false, null, 'EMIS_EXTRACT', current_date)
    `;
    try {
      const b = await readBreakdown(regionScope);
      const row = named(b, "Filed Nothing District");
      expect(row.schoolsRegistered).toBe(1);
      expect(row.schoolsReporting).toBe(0);
      expect(row.coverageRatio).toBe(0);
      // The measures it filed nothing for are NULL — the design's muted dash, never a fake 0 pupils
      // and never a confident 0%.
      expect(row.enrolment).toBeNull();
      expect(row.candidates).toBeNull();
      expect(row.wassceRate).toBeNull();
      // Its NAME still resolves, which is why the register side left-joins the spine by primary key.
      expect(row.name).toBe("Filed Nothing District");
      expect(sum(allRows(b), (r) => r.schoolsRegistered)).toBe(b.total.schoolsRegistered);
    } finally {
      await owner`delete from ref_emis_school_register where emis_school_id = ${REGISTER_ONLY_SCHOOL}`;
      await owner`delete from dim_jurisdiction where jurisdiction_id = ${REGISTER_ONLY_DISTRICT}::uuid`;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE RANK CARDS' CANDIDATE FLOOR, AND THE SPREAD
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the rank cards ignore children below the candidate floor", () => {
  it("the thin cohort really is the top of the table and really is below the floor", async () => {
    const b = await readBreakdown(regionScope);
    const tiny = named(b, TINY_DISTRICT_NAME);
    expect(tiny.wassceRate).toBe(1);
    expect(tiny.candidates).toBe(F.tinyCandidates);
    expect(tiny.candidates!).toBeLessThan(RANK_CARD_MIN_CANDIDATES);
    // Sorted by the active sort, so it IS first — the table hides nothing.
    expect(b.children[0]!.name).toBe(TINY_DISTRICT_NAME);
  });

  it("…and is NOT named 'Strongest' — ten pupils cannot carry a superlative", async () => {
    const ends = rankEnds(await readBreakdown(regionScope));
    expect(ends).not.toBeNull();
    expect(ends!.strongest.name).toBe("Wassa Amenfi West");
    expect(ends!.strongest.name).not.toBe(TINY_DISTRICT_NAME);
    expect(ends!.weakest.name).toBe("Sekondi-Takoradi Metro");
    for (const end of [ends!.strongest, ends!.weakest]) {
      expect(end.candidates!).toBeGreaterThanOrEqual(RANK_CARD_MIN_CANDIDATES);
    }
  });

  it("fewer than two children above the floor ⇒ NO rank cards, rather than ranking what is left", async () => {
    const b = await readBreakdown(districtScope);
    // The district tier's schools: 100 candidates and 10. Only one clears the floor.
    expect(
      b.children.filter((r) => (r.candidates ?? 0) >= RANK_CARD_MIN_CANDIDATES),
    ).toHaveLength(1);
    expect(rankEnds(b)).toBeNull();
  });

  it("the floor is a named constant, not an inline number", () => {
    expect(RANK_CARD_MIN_CANDIDATES).toBe(30);
    const code = readCode("lib/oversight/breakdown.ts");
    expect(code).toMatch(/RANK_CARD_MIN_CANDIDATES/);
    expect(code).not.toMatch(/candidates\s*>=\s*30/);
  });
});

describe("the spread is derived from the same rows, and its mean is the weighted one", () => {
  it("min/max are the children's extremes and the mean is the TOTAL's rate", async () => {
    const b = await readBreakdown(nationalScope);
    const wassce = spreadOf(b, (r) => r.wassceRate);
    expect(wassce).not.toBeNull();
    const rates = b.children.map((r) => r.wassceRate!);
    expect(wassce!.min).toBeCloseTo(Math.min(...rates), 10);
    expect(wassce!.max).toBeCloseTo(Math.max(...rates), 10);
    // Not the unweighted mean of the two children: the no-averaging rule does not stop applying because
    // the number is going on a bar.
    expect(wassce!.mean).toBeCloseTo(b.total.qualified! / b.total.candidates!, 10);
  });

  it("one child is not a spread — a zero-width bar would claim a range that is not one", async () => {
    const b = await readBreakdown(districtScope);
    // Only one district-tier school filed enrolment, so there is no enrolment-rate spread to draw.
    expect(spreadOf(b, (r) => r.coverageRatio)).toBeNull();
  });

  it("no seeded PTR value clamps against PTR_AXIS — the bar never under-draws the caption (Kofi §10.4)", async () => {
    // B3's defect was an axis too narrow for the data: a plotted min/max outside [lo,hi] clamps to a
    // rail while the §10.3 caption quotes the TRUE (max−min) gap, so the bar under-draws it. The axis is
    // sized to contain the whole §3 seeded range; prove it across the tiers the spread bar renders at.
    //
    // The ends come from PTR_AXIS itself, so this followed the widening to [8, 75] for free. What it
    // CANNOT see is the tail: this DB is the small fixture, and only the national/region tiers draw a
    // bar on it — the three demo schools that were clamping against the old `hi` are not here at all.
    // The containment check over every generated row lives in tests/etl-staffing.test.ts (CRITERION 7),
    // which has the full ~849-school estate; this one stays as the surface-level counterpart.
    for (const scope of [nationalScope, regionScope]) {
      const b = await readBreakdown(scope);
      const ptr = spreadOf(b, (r) => r.ptr);
      if (ptr === null) continue; // fewer than two children with a PTR at this tier — no bar drawn.
      for (const value of [ptr.min, ptr.max, ptr.mean]) {
        if (value === null) continue;
        expect(value, `seeded PTR ${value} clamps against PTR_AXIS [${PTR_AXIS.lo}, ${PTR_AXIS.hi}]`)
          .toBeGreaterThanOrEqual(PTR_AXIS.lo);
        expect(value).toBeLessThanOrEqual(PTR_AXIS.hi);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// FAIL-SOFT, AND THE CHOKEPOINT GUARDS (f, h)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

const ROOT = process.cwd();

/** Comments stripped, strings kept — the auth-boundaries idiom, since the patterns live in SQL. */
function readCode(file: string): string {
  return readFileSync(join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

describe("the roll-up cannot walk around the jurisdiction chokepoint", () => {
  const FILE = "lib/oversight/breakdown.ts";

  it("every statement runs inside withJurisdiction, and the raw db handle is never imported", () => {
    const code = readCode(FILE);
    expect(code).toMatch(
      /import\s*\{[^}]*withJurisdiction[^}]*\}\s*from\s*"@\/lib\/db\/rls"/,
    );
    expect(code).not.toMatch(/from\s*"@\/lib\/db"/);
    expect(code).not.toMatch(/\bdb\s*\.\s*(execute|transaction|select)\b/);
    // Two statements, one wrapper: the register read shares the fact read's transaction, so both see
    // the same GUCs and the same snapshot.
    expect((code.match(/tx\.execute\(/g) ?? []).length).toBe(2);
    expect((code.match(/withJurisdiction\(/g) ?? []).length).toBe(1);
    expect(code.indexOf("withJurisdiction(")).toBeLessThan(code.indexOf("tx.execute("));
  });

  it("it writes no ceiling of its own — no subtree WHERE, no GUC, no scope field", () => {
    const code = readCode(FILE);
    expect(code).not.toMatch(/ov_in_subtree/);
    expect(code).not.toMatch(/ov_is_national/);
    expect(code).not.toMatch(/app\.current_(jurisdiction|level|officer)/);
    // ⚠ Including `scope.jurisdictionId`: the home-row comparison is presentation and lives in the
    // component, precisely so this assertion can read the same here as for the slice-1 four.
    expect(code).not.toMatch(/scope\.(jurisdictionId|level)/);
  });

  it("`parent_id` is read ONLY as a join key, never selected into the payload", () => {
    const code = readCode(FILE);
    // It appears in the two `on … = s.parent_id` clauses and nowhere else — in particular in no
    // `select` list, because a parent_id may name a node the officer cannot see.
    const occurrences = code.match(/parent_id/g) ?? [];
    expect(occurrences).toHaveLength(2);
    expect(code).toMatch(/d\.jurisdiction_id = s\.parent_id/);
    expect(code).toMatch(/r\.jurisdiction_id = d\.parent_id/);
    expect(code).not.toMatch(/as\s+parent_id/);
  });

  it("NO NEW DB OBJECT, and no recursion — prod-paste-0006 is not triggered", () => {
    const code = readCode(FILE);
    expect(code).not.toMatch(/create\s+(or\s+replace\s+)?(view|table|function|index)/i);
    expect(code).not.toMatch(/with\s+recursive/i);
    expect(code).not.toMatch(/\bgrant\b/i);
    // The shape that replaces the recursion, asserted positively so a rewrite has to argue with it.
    expect(code).toMatch(/grouping sets/);
    expect(code).toMatch(/left join dim_jurisdiction d/);
    expect(code).toMatch(/left join dim_jurisdiction r/);
  });

  it("every hop pins a level", () => {
    const code = readCode(FILE);
    expect(code).toMatch(/s\.level = 'SCHOOL'/);
    expect(code).toMatch(/d\.level = 'DISTRICT'/);
    expect(code).toMatch(/r\.level = 'REGION'/);
  });

  it("it names no individual-level column", () => {
    const code = readCode(FILE);
    for (const column of ["full_name", "first_name", "surname", "ntc_licence", "captured_by"]) {
      expect(code).not.toContain(column);
    }
  });

  it("a read that raises yields unavailable, never a throw and never a zero", async () => {
    expect(
      await getChildBreakdown(districtScope, {
        childLevel: "SCHOOL",
        termPeriodId: "not-a-uuid",
        examPeriodId: PERIOD_ID_EXAM_COHORT,
        annualPeriodId: PERIOD_ID_ANNUAL,
        exam: "WASSCE",
      }),
    ).toEqual(unavailable());
  });

  it("an unreachable database degrades the section, not the page", async () => {
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
      const mod = await import("@/lib/oversight/breakdown");
      const reading = await mod.getChildBreakdown(districtScope, {
        childLevel: "SCHOOL",
        termPeriodId: PERIOD_ID_TERM,
        examPeriodId: PERIOD_ID_EXAM_COHORT,
        annualPeriodId: PERIOD_ID_ANNUAL,
        exam: "WASSCE",
      });
      expect(reading.status).toBe("unavailable");
      expect("value" in reading).toBe(false);
    } finally {
      vi.doUnmock("@/lib/db/rls");
      vi.resetModules();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SURFACE: per-tier strings, computed tones, and the fail-soft banner
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The sentence an officer reads, out of a MARKUP STRING. Tags are removed to a fixpoint (a tag split by
 * an earlier removal cannot survive one pass), then the handful of entities `renderToStaticMarkup`
 * emits are decoded in one left-to-right pass.
 */
function textOf(markup: string): string {
  let out = markup;
  let prev: string;
  do {
    prev = out;
    out = out.replace(/<[^>]*>/g, " ");
  } while (out !== prev);
  return out
    .replace(/&#x27;|&middot;|&quot;|&amp;/g, (entity) =>
      entity === "&#x27;"
        ? "'"
        : entity === "&middot;"
          ? "·"
          : entity === "&quot;"
            ? '"'
            : "&",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** The same, for a node — rendered first. ⚠ Never pass a markup STRING here: React would escape it. */
function renderText(node: ReactNode): string {
  return textOf(renderToStaticMarkup(createElement(Fragment, null, node)));
}

describe("the breakdown's per-tier strings live in the chrome config", () => {
  const NATIONAL = breakdownChrome("NATIONAL", "National · Ministry of Education");
  const REGION = breakdownChrome("REGION", "Western Region");
  const DISTRICT = breakdownChrome("DISTRICT", "Wassa Amenfi West");

  it("the child noun and the name-column header follow the tier", () => {
    expect([NATIONAL.childNounPlural, NATIONAL.childColumnHeader]).toEqual([
      "regions",
      "Region",
    ]);
    expect([REGION.childNounPlural, REGION.childColumnHeader]).toEqual([
      "districts",
      "District",
    ]);
    expect([DISTRICT.childNounPlural, DISTRICT.childColumnHeader]).toEqual([
      "schools",
      "School",
    ]);
  });

  it("the total row keeps BOTH of Lucy's shapes — the national one repeats the noun", () => {
    expect(NATIONAL.totalRowLabel(16)).toBe("Ghana · all 16 regions");
    // The national lead word is the literal "Ghana", the same special case as the h1's title lead.
    expect(NATIONAL.totalRowLabel(16)).not.toContain("Ministry");
    // The regional shape DROPS the noun, because the region's name already carries it.
    expect(REGION.totalRowLabel(14)).toBe("Western Region · all 14");
    expect(DISTRICT.totalRowLabel(40)).toBe("Wassa Amenfi West · all 40 schools");
  });

  it("the count in the title is DERIVED, never the mock's spelled-out 'sixteen'", () => {
    expect(renderText(buildBreakdownTitle(NATIONAL, 2))).toBe("The 2 regions.");
    expect(renderText(buildBreakdownTitle(REGION, 1_400))).toBe("The 1,400 districts.");
    // No count to state ⇒ a count-free lead, not an empty slot.
    expect(renderText(buildBreakdownTitle(REGION, null))).toBe("The districts.");
    const markup = renderToStaticMarkup(
      createElement(Fragment, null, buildBreakdownTitle(NATIONAL, 16)),
    );
    // The gold italic with the trailing period INSIDE the em, as everywhere else on this page.
    expect(markup).toContain('<em class="accent-italic">regions.</em>');
    expect(markup).not.toContain("sixteen");
  });

  it("the footer counts the returned rows and never fakes the mock's '6 of 16'", () => {
    expect(breakdownFooter(NATIONAL, 2, 2)).toBe(
      "Showing 2 of 2 regions · sorted by WASSCE qualification",
    );
    expect(breakdownFooter(REGION, 1, 1)).toBe(
      "Showing 1 of 1 district · sorted by WASSCE qualification",
    );
  });

  it("the fail-soft title names the tier's own child noun", () => {
    expect(NATIONAL.unavailableTitle).toBe(
      "Regional breakdown is temporarily unavailable",
    );
    expect(REGION.unavailableTitle).toBe("District breakdown is temporarily unavailable");
  });

  it("the drill hint is dropped where it would promise a surface that does not exist", () => {
    // Lucy's national tail invites a tap-through to a regional dashboard. There is no such route in this
    // slice (one `/` surface serves all tiers), so the sentence is omitted rather than made false.
    expect(NATIONAL.drillHint(null)).toBeNull();
    expect(NATIONAL.drillHint("Western Region")).toBeNull();
    // At region, the half that IS true survives — and only when a home row actually came back.
    expect(REGION.drillHint("Wassa Amenfi West")).toBe(
      "your home district Wassa Amenfi West is highlighted",
    );
    expect(REGION.drillHint(null)).toBeNull();
  });
});

describe("tones are COMPUTED from the ratio against the stated rule", () => {
  it("the coverage bands are the rule the provenance line states", () => {
    expect(COVERAGE_BANDS).toEqual({ green: 0.85, amber: 0.7 });
  });

  it("the WASSCE bands are a named, movable constant", () => {
    // Inferred, not stated by either mock — flagged for owner confirmation, and named so that moving it
    // is one edit rather than a search for hard-coded classes.
    expect(WASSCE_QUALIFICATION_BANDS).toEqual({ green: 0.67, amber: 0.6 });
  });

  it("the mock's inconsistent per-row classes are not copied: 85.0% is GREEN, 70.5% is AMBER", () => {
    const markup = renderToStaticMarkup(
      createElement(BreakdownTable, {
        chrome: breakdownChrome("NATIONAL", null),
        homeId: null,
        breakdown: {
          childLevel: "REGION",
          hasCoverage: true,
          unattributed: null,
          children: [
            row({ childId: "a", name: "Exactly At Green", coverageRatio: 0.85 }),
            row({ childId: "b", name: "Amber Band", coverageRatio: 0.705 }),
            row({ childId: "c", name: "Below Red", coverageRatio: 0.69 }),
          ],
          total: row({ name: null, coverageRatio: 0.8 }),
        },
      }),
    );
    // The regional mock paints 85.0% `warn` and 70.5% `low`, both against its own stated rule. The rule
    // wins: the cell's tone is a function of the number.
    expect(markup).toMatch(/text-green[^>]*>85\.0%/);
    expect(markup).toMatch(/text-warn[^>]*>70\.5%/);
    expect(markup).toMatch(/text-terra[^>]*>69\.0%/);
  });

  it("the badge is always derived from the name — there is no code column to read", () => {
    expect(initialsOf("Greater Accra")).toBe("GA");
    expect(initialsOf("Wassa Amenfi West")).toBe("WA");
    expect(initialsOf("Ashanti")).toBe("A");
    expect(initialsOf("St. Monica Mission SHS")).toBe("SM");
  });
});

/** A row literal for the presentation tests, so each one states only the fields it is about. */
function row(fields: Partial<BreakdownRow>): BreakdownRow {
  return {
    childId: null,
    name: null,
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
    ...fields,
  };
}

describe("the section renders the honest states", () => {
  it("an unavailable read renders a WARN banner and no table", () => {
    const markup = renderToStaticMarkup(
      createElement(BreakdownSection, {
        level: "REGION",
        jurisdictionName: "Western Region",
        homeId: JUR.region,
        breakdown: unavailable<ChildBreakdown>(),
        termLabel: "2025/26 Term 2",
        sittingLabel: "2026 WASSCE",
      }),
    );
    expect(textOf(markup)).toContain("District breakdown is temporarily unavailable");
    expect(textOf(markup)).toContain(
      "The per-district roll-up could not be read. The headline figures above are unaffected.",
    );
    // Warn, never terra: an unread roll-up is a data-availability state, not an error the officer caused.
    expect(markup).toContain("border-warn");
    expect(markup).not.toContain("<table");
  });

  it("an empty read renders the tier's empty copy, not a zero-filled table", () => {
    const markup = renderToStaticMarkup(
      createElement(BreakdownSection, {
        level: "NATIONAL",
        jurisdictionName: null,
        homeId: null,
        breakdown: {
          status: "ok",
          value: {
            childLevel: "REGION",
            hasCoverage: true,
            children: [],
            unattributed: null,
            total: row({}),
          },
        },
        termLabel: null,
        sittingLabel: null,
      }),
    );
    expect(textOf(markup)).toContain("No regions reporting yet");
    // No percentage anywhere in the TABLE — an empty read must not produce a 0% coverage or a 0% pill.
    // (Scoped to the table: the provenance row legitimately prints the threshold rule's own numbers.)
    const table = /<table[\s\S]*?<\/table>/.exec(markup)?.[0] ?? "";
    expect(table).not.toBe("");
    expect(textOf(table)).not.toContain("%");
    expect(textOf(markup)).toContain(
      "No spread to show yet — a range needs at least two regions with a measured figure.",
    );
  });

  it("a missing measure renders a muted dash, never a fabricated 0%", () => {
    const markup = renderToStaticMarkup(
      createElement(BreakdownTable, {
        chrome: breakdownChrome("REGION", "Western Region"),
        homeId: null,
        breakdown: {
          childLevel: "DISTRICT",
          hasCoverage: true,
          unattributed: null,
          children: [row({ childId: "a", name: "Filed Nothing District" })],
          total: row({}),
        },
      }),
    );
    const text = textOf(markup);
    expect(text).toContain("—");
    expect(text).not.toContain("0%");
    expect(text).not.toContain("0 pupils");
  });

  it("the unattributed bucket is rendered with its school count", () => {
    const markup = renderToStaticMarkup(
      createElement(BreakdownTable, {
        chrome: breakdownChrome("REGION", "Western Region"),
        homeId: null,
        breakdown: {
          childLevel: "DISTRICT",
          hasCoverage: false,
          unattributed: row({ enrolment: 77, schoolsFiling: 1 }),
          children: [row({ childId: "a", name: "A District", enrolment: 100 })],
          total: row({ enrolment: 177 }),
        },
      }),
    );
    const text = textOf(markup);
    expect(text).toContain("Unattributed — 1 school");
    expect(text).toContain("not placed under any district in the jurisdiction spine");
    // It is NOT counted as a child in the footer's "Showing N of M".
    expect(text).toContain("Showing 1 of 1 district");
  });

  it("PTR column is present now; still no drill arrow and no Compare chip — those have no target", () => {
    const markup = renderToStaticMarkup(
      createElement(BreakdownTable, {
        chrome: breakdownChrome("NATIONAL", null),
        homeId: null,
        breakdown: {
          childLevel: "REGION",
          hasCoverage: true,
          unattributed: null,
          children: [row({ childId: "a", name: "A Region", enrolment: 10, ptr: 24.8 })],
          total: row({ enrolment: 10, ptr: 24.8 }),
        },
      }),
    );
    const text = textOf(markup);
    // PTR now has an ETL producer, so its column header, sort chip and cells render (the cell as
    // `24.8:1`). Compare and the drill arrow stay absent — they point at surfaces that do not exist.
    expect(text).toContain("PTR");
    expect(text).toContain("24.8:1");
    expect(text).not.toContain("Compare");
    expect(text).not.toContain("→");
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("cursor-pointer");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE L2 FIX — a sub-national node whose label could not be read is NULL, not "Ghana Education Service"
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("a null jurisdictionName degrades per consumer instead of naming the institution", () => {
  it("lib/auth returns null below national, and keeps the national label", () => {
    const code = readCode("lib/auth/index.ts");
    // The defect: `node?.name ?? institutionLabel(resolved.level)` put "Ghana Education Service" where a
    // place name belongs — including into the provenance Scope line, which is a security claim.
    expect(code).not.toMatch(/jurisdictionName:\s*node\?\.name\s*\?\?\s*institutionLabel/);
    expect(code).toMatch(/resolved\.level === "NATIONAL"/);
    expect(code).toMatch(/jurisdictionName: string \| null/);
  });

  it("the dashboard chrome says 'this region' and drops the crumb's middle segment", () => {
    const degraded = tierChrome("REGION", null);
    expect(degraded.titleLead).toBe("This region");
    expect(degraded.scopeLine).toBe("this region · sibling regions not visible here");
    expect(degraded.crumb).toBe("Oversight · Regional dashboard");
    // The institution label must not reappear anywhere in the degraded chrome.
    expect(JSON.stringify(degraded)).not.toContain("Ghana Education Service");
    expect(JSON.stringify(tierChrome("DISTRICT", null))).not.toContain(
      "Ghana Education Service",
    );
  });

  it("the breakdown's total row degrades the same way", () => {
    expect(breakdownChrome("REGION", null).totalRowLabel(3)).toBe("This region · all 3");
    expect(breakdownChrome("REGION", null).totalRowLabel(3)).not.toContain(
      "Ghana Education Service",
    );
  });

  it("the national tier is unaffected — its headline never used this field", () => {
    expect(tierChrome("NATIONAL", null).titleLead).toBe("Ghana");
    expect(tierChrome("NATIONAL", null).crumb).toBe("Oversight · National dashboard");
    expect(breakdownChrome("NATIONAL", null).totalRowLabel(16)).toBe(
      "Ghana · all 16 regions",
    );
  });

  it("the shell chip picks its own wording, naming the tier it still knows", async () => {
    const { officerChrome } = await import("@/lib/auth");
    const chrome = officerChrome({
      ...regionOfficer,
      displayName: "Test Officer",
      jurisdictionName: null,
    });
    expect(chrome.jurisdiction).toBe("Region · name unavailable");
    expect(chrome.jurisdiction).not.toBe("Ghana Education Service");
    // The TIER is unaffected by the failed label read — it came from the database resolver.
    expect(chrome.tier).toBe("Region");
  });

  it("the slice-2 TODO comment at the tier-chrome param is gone", () => {
    const source = readFileSync(
      join(ROOT, "components/oversight/tier-chrome.tsx"),
      "utf8",
    );
    expect(source).not.toContain("DEFERRED TO SLICE 3");
    expect(source).not.toContain("So nothing changes this slice.");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PAGE WIRES IT — one route, the section below the strip, each tier's own rows
// ══════════════════════════════════════════════════════════════════════════════════════════════════

function chromeSession(base: unknown, jurisdictionName: string | null) {
  return { ...(base as object), displayName: "Test Officer", jurisdictionName };
}

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

describe("the dashboard renders the breakdown section at every tier", () => {
  it("national: regions, the spread panel, and no rank strip", async () => {
    const markup = await renderPage(
      chromeSession(nationalOfficer, "National · Ministry of Education"),
    );
    const text = textOf(markup);
    expect(text).toContain("Western Region");
    expect(text).toContain(OTHER_REGION_NAME);
    expect(text).toContain("Ghana · all 2 regions");
    expect(text).toContain("Showing 2 of 2 regions · sorted by WASSCE qualification");
    // The spread and the KPI strip now carry the PTR measure (the staffing ETL has landed). "all three"
    // is still never a literal (the caption is derived from the bars that rendered), and national still
    // has no rank strip.
    expect(text).toContain("The national spread");
    expect(text).toContain("WASSCE qualification");
    expect(text).toContain("School coverage");
    expect(text).toContain("Pupil-teacher ratio");
    expect(text).not.toContain("all three");
    expect(text).not.toContain("Strongest ·");
    // Every figure computed: the mock's placeholders must not appear.
    expect(text).not.toContain("sixteen");
    expect(text).not.toContain("2,410,000");
  });

  it("region: districts, the rank strip above the table, and no spread panel", async () => {
    const markup = await renderPage(chromeSession(regionOfficer, "Western Region"));
    const text = textOf(markup);
    expect(text).toContain("Wassa Amenfi West");
    expect(text).toContain("Western Region · all 3");
    expect(text).toContain("Strongest · WASSCE qualification");
    expect(text).toContain("Needs attention · WASSCE qualification");
    expect(text).not.toContain("The national spread");
    // The rank strip precedes the table (Lucy's reading order).
    expect(markup.indexOf("Strongest")).toBeLessThan(markup.indexOf("<table"));
    // The unattributed bucket is visible on the page, not only in the payload.
    expect(text).toContain("Unattributed");
    expect(text).not.toContain(OTHER_REGION_DISTRICT_NAME);
  });

  it("district: one row per SCHOOL, no coverage columns, neither visual", async () => {
    const markup = await renderPage(chromeSession(districtOfficer, "Wassa Amenfi West"));
    const text = textOf(markup);
    expect(text).toContain("Asankrangwa SHS");
    expect(text).toContain("Amenfiman SHS");
    expect(text).toContain("Wassa Amenfi West · all 2 schools");
    expect(text).not.toContain("Schools (on / total)");
    expect(text).not.toContain("The national spread");
    expect(text).not.toContain("Strongest ·");
    // …and no sibling district's school.
    expect(text).not.toContain("Takoradi SHS");
  });

  it("the breakdown states the sitting it ranks on", async () => {
    const markup = await renderPage(chromeSession(regionOfficer, "Western Region"));
    expect(textOf(markup)).toContain("2026 WASSCE");
  });

  it("no new route and no new nav link — one surface, as in slices 1 and 2", () => {
    const shell = readFileSync(join(ROOT, "components/oversight/shell.tsx"), "utf8");
    expect(shell).not.toContain("/breakdown");
    expect(shell).not.toContain("Regions");
    expect(shell).not.toContain("Districts");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// QUINN · SLICE-3 GATE ADDITIONS — the §7 properties the file did not yet kill by value
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("`child_level` is a DISPLAY DEPTH, never a second ceiling (Wells §1.4)", () => {
  /** The module doc's own claim, run: a mis-set depth cannot widen anything. */
  it("a DISTRICT officer who passes 'REGION' reads an unattributed-only FACT side", async () => {
    const b = okValue(
      await getChildBreakdown(districtScope, {
        childLevel: "REGION",
        termPeriodId: PERIOD_ID_TERM,
        examPeriodId: PERIOD_ID_EXAM_COHORT,
        annualPeriodId: PERIOD_ID_ANNUAL,
        exam: "WASSCE",
      }),
    );
    // Their own REGION is an ANCESTOR, so `r` is null for every visible fact row and nothing is
    // attributable: RLS bounded the rows before the `case` was evaluated.
    expect(b.unattributed).not.toBeNull();
    expect(b.unattributed!.enrolment).toBe(F.wassaEnrolment);
    // The one thing that must be true whatever the depth: the TOTAL cannot widen past the ceiling.
    expect(b.total.enrolment).toBe(F.wassaEnrolment);
    expect(b.total.candidates).toBe(F.wassaCandidates);
    // …and no ancestor's NAME is reachable at any depth — the spine's own policy, not this module's.
    const payload = JSON.stringify(b);
    expect(payload).not.toContain("Western Region");
    expect(b.children.every((r) => r.name === null)).toBe(true);
    /**
     * ⚠ OBSERVED, AND DELIBERATELY NOT PINNED (Quinn, slice-3 gate). The module doc says a mis-set
     * depth is "fail-closed-ish, ZERO DISCLOSURE". That is exactly true of the FACT arm and slightly
     * overstated for the REGISTER arm: `ref_emis_school_register` denormalises `region_id`, so a
     * district officer at a 'REGION' depth gets one child row keyed on their own OUT-OF-SUBTREE parent
     * region's bare uuid (with a null label, because `dim_jurisdiction`'s policy withholds the node,
     * and with their OWN coverage counts, so no figure widens). It is the same accepted bare-uuid
     * residual Wells §2 describes for `parent_id`, reached only on a path production cannot take:
     * `childLevelFor()` is total and is the only caller, so a DISTRICT officer's depth is always
     * 'SCHOOL'. Left as a note rather than an assertion so that tightening it later is not a
     * "failing" test.
     */
  });

  it("…and the DISTRICT depth still shows a district officer only their OWN node", async () => {
    const b = okValue(
      await getChildBreakdown(districtScope, {
        childLevel: "DISTRICT",
        termPeriodId: PERIOD_ID_TERM,
        examPeriodId: PERIOD_ID_EXAM_COHORT,
        annualPeriodId: PERIOD_ID_ANNUAL,
        exam: "WASSCE",
      }),
    );
    expect(b.children.map((r) => r.name)).toEqual(["Wassa Amenfi West"]);
    expect(b.total.enrolment).toBe(F.wassaEnrolment);
    // No sibling district, by name OR by id, at a depth that is not this tier's.
    const payload = JSON.stringify(b);
    expect(payload).not.toContain("Sekondi-Takoradi Metro");
    expect(payload).not.toContain(TINY_DISTRICT);
    expect(payload).not.toContain(OTHER_REGION_DISTRICT);
  });
});

describe("the REGISTER side's null-ancestor row is bucketed too, never filtered", () => {
  /**
   * The fact side's unattributed bucket is covered above. The register side has its own: `region_id`
   * and `district_id` are both NULLABLE (db/schema/ref.ts), so a register row that names no ancestor
   * groups to `child_id IS NULL` — and dropping it would make Σ(schoolsRegistered) < the total row,
   * which is the same arithmetic failure in the coverage columns.
   */
  const ORPHAN = "EMIS-BRK-905";

  it("a register row with NO region lands in the visible bucket and is in the total", async () => {
    await owner`
      insert into ref_emis_school_register
        (emis_school_id, name, district_id, region_id, school_type, ownership_type, on_schoolup,
         operational_school_id, source, as_of_date)
      values (${ORPHAN}, 'No Ancestor JHS', null, null, 'JHS', 'PUBLIC', true, null, 'EMIS_EXTRACT', current_date)
    `;
    try {
      const b = await readBreakdown(nationalScope);
      expect(b.unattributed).not.toBeNull();
      // It is COUNTED, in the bucket, and the bucket is in the row set the table prints.
      expect(b.unattributed!.schoolsRegistered).toBeGreaterThanOrEqual(1);
      expect(sum(allRows(b), (r) => r.schoolsRegistered)).toBe(b.total.schoolsRegistered);
      expect(sum(allRows(b), (r) => r.schoolsReporting)).toBe(b.total.schoolsReporting);
      // …and it is not attributed to any named region.
      for (const child of b.children) {
        expect(child.name).not.toBeNull();
      }
      // The bucket carries no name, so it can never be mistaken for a sibling (Wells §2 belt 3).
      expect(b.unattributed!.name).toBeNull();
    } finally {
      await owner`delete from ref_emis_school_register where emis_school_id = ${ORPHAN}`;
    }
  });
});

describe("a null label never becomes a sibling's name", () => {
  it("the bucket's name is null, and every child name is distinct and its own", async () => {
    const b = await readBreakdown(regionScope);
    expect(b.unattributed!.name).toBeNull();
    const names = b.children.map((r) => r.name);
    // No child inherited the bucket's figures, and no two children share a label (which is what a
    // fan-out or a mis-keyed merge would produce).
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain(null);
    // The mis-parented school's enrolment appears EXACTLY ONCE in the whole row set.
    expect(
      allRows(b).filter((r) => r.enrolment === F.misparentedEnrolment),
    ).toHaveLength(1);
  });
});

describe("the coverage columns are PRESENT above the district tier", () => {
  /** The positive half of Wells §3 — the absence at district is already asserted above. */
  it("national and region render the two register columns; district renders neither", () => {
    const withCoverage = renderToStaticMarkup(
      createElement(BreakdownTable, {
        chrome: breakdownChrome("NATIONAL", null),
        homeId: null,
        breakdown: {
          childLevel: "REGION",
          hasCoverage: true,
          unattributed: null,
          children: [
            row({
              childId: "a",
              name: "A Region",
              schoolsReporting: 8,
              schoolsRegistered: 10,
              coverageRatio: 0.8,
            }),
          ],
          total: row({ schoolsReporting: 8, schoolsRegistered: 10, coverageRatio: 0.8 }),
        },
      }),
    );
    expect(textOf(withCoverage)).toContain("Schools (on / total)");
    expect(textOf(withCoverage)).toContain("Coverage");
    expect(textOf(withCoverage)).toContain("8 / 10");

    const withoutCoverage = renderToStaticMarkup(
      createElement(BreakdownTable, {
        chrome: breakdownChrome("DISTRICT", "Wassa Amenfi West"),
        homeId: null,
        breakdown: {
          childLevel: "SCHOOL",
          hasCoverage: false,
          unattributed: null,
          children: [row({ childId: "a", name: "A School", enrolment: 10 })],
          total: row({ enrolment: 10 }),
        },
      }),
    );
    expect(textOf(withoutCoverage)).not.toContain("Schools (on / total)");
    expect(textOf(withoutCoverage)).not.toContain("Coverage");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SPREAD CAPTION — a derived sentence, so it must still read like prose (capital lead, right article)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the spread caption lists the gaps as a grammatical sentence", () => {
  /**
   * The caption was inline fragments in slice 3; PTR made it a derived `gapSentence`. The refactor must
   * NOT lose the leading capital (it opens a new sentence after the "best and worst" full stop) and must
   * pick "a"/"an" by the figure's spoken form — a PTR or WASSCE gap of 18 or 8 is "an", not "a".
   */
  const two = (): ChildBreakdown => ({
    childLevel: "REGION",
    hasCoverage: true,
    unattributed: null,
    // WASSCE 52%→70% = an 18-point gap; coverage 60%→90% = a 30-point gap; PTR 10→28 = an 18.0-point
    // spread in pupil-teacher ratio (Kofi §10.3 phrasing: "spread in…", not "gap").
    children: [
      row({ childId: "a", name: "A", wassceRate: 0.7, coverageRatio: 0.9, ptr: 10, candidates: 100 }),
      row({ childId: "b", name: "B", wassceRate: 0.52, coverageRatio: 0.6, ptr: 28, candidates: 100 }),
    ],
    total: row({ wassceRate: 0.61, coverageRatio: 0.75, ptr: 19 }),
  });

  it("opens the disparity sentence with a capital and uses 'an' before 18 / 8", () => {
    const text = textOf(
      renderToStaticMarkup(
        createElement(SpreadPanel, { breakdown: two(), chrome: breakdownChrome("NATIONAL", null) }),
      ),
    );
    // The lead clause is capitalised (WASSCE leads and 18 → "an" → "An"); the regression was a lowercase
    // "a" sitting directly after the preceding sentence's full stop.
    expect(text).toContain("An 18-point WASSCE gap");
    expect(text).not.toMatch(/\.\s+a 18-point WASSCE gap/);
    // Mid-sentence clauses keep their lower case and their own article.
    expect(text).toContain("a 30-point coverage gap");
    expect(text).toContain("an 18.0-point spread in pupil-teacher ratio");
    // The PTR clause is a DISPERSION phrasing, never a "gap" and never a geography claim (Kofi §10.3) —
    // the struck mock line "northern regions sit at the low end" must not return through PTR.
    expect(text).not.toContain("pupil-teacher-ratio gap");
    expect(text).not.toMatch(/northern/i);
    expect(text).toContain("are the disparities national policy exists to close.");
  });
});
