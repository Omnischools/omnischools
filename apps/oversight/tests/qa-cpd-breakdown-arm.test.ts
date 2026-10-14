import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { scopeFor, type JurisdictionScope } from "@/lib/db/rls";
import { isOk, type Reading } from "@/lib/oversight/reading";
import {
  childLevelFor,
  getChildBreakdown,
  type BreakdownRow,
  type ChildBreakdown,
} from "@/lib/oversight/breakdown";
import { getTeacherCpd } from "@/lib/oversight/cpd";
import { BreakdownTable } from "@/components/oversight/breakdown-table";
import { breakdownChrome } from "@/components/oversight/tier-chrome";
import { JUR, OFFICER, PERIOD_ID_EXAM_COHORT } from "./fixtures/ids";
import {
  adminAnalytics,
  districtOfficer,
  nationalOfficer,
  officerFixture,
} from "./helpers";

/**
 * QA GATE — THE TWO CPD/PLC ARMS OF THE CHILD BREAKDOWN (increment L / E-CPD-4, C17).
 *
 * `tests/oversight-cpd.test.ts` is the QA gate for the PANEL. This file is the gate for the BREAKDOWN
 * TABLE's two new cells, and it is deliberately adversarial about the five ways the arms could be
 * wrong while still printing a plausible percentage:
 *
 *  1. WEIGHTING (C12/C13, AC-13). The fixture is a 40-teacher school beside a 400-teacher one, plus
 *     three smaller schools, and the unweighted mean of the child cells (40.0%) is nowhere near the
 *     honest Σnum÷Σden (73.65%). An averaged tier rate would still look like a rate.
 *  2. NULL ≠ 0 (C10/C11, AC-10/11). Three distinct absences sit side by side IN ONE SCOPE: a child
 *     with no ANNUAL PLC row at all ("No PLC data"), a child WITH annual rows whose threshold is NULL
 *     (the ⚠ SOURCING GATE — "Not yet sourced from NTC"), and a child whose threshold is sourced. The
 *     first two must never be a 0%.
 *  3. REAL ZERO vs ABSENT on coverage. A school with 50 teachers and none in a PLC is a MEASURED 0%;
 *     a school with no TERM PLC row is an absence. Both would be `null`/`0` under a careless coalesce.
 *  4. THE DENOMINATORS (C12/AC-14). Every school's TERM headcount differs from its ANNUAL headcount,
 *     and `cpd_points_teacher_count` is planted at a value that would make compliance exceed 100% if
 *     it were ever used as the denominator.
 *  5. sex='ALL' ONLY (C12/AC-15). MALE and FEMALE rows are planted beside ALL and sum to it exactly,
 *     so a read that forgot the sex pin returns a clean, plausible, EXACTLY-2×-inflated count whose
 *     derived RATE still looks right — the trap the schema wrote its sex-invariance note about.
 *
 * Plus C19 (the breakdown total row equals `getTeacherCpd`'s panel figure over the same scope and
 * periods, from the two independent readers), the sumOf reconciliation, the RLS/static guards
 * (AC-23/24) and byte-stability (AC-25).
 *
 * FIXTURE DISCIPLINE. Two OWN dim_period rows (so no other file's facts can enter this file's reads),
 * one OWN mis-parented school, and PLC rows only on this file's periods. Everything is removed in
 * `afterAll`; `fileParallelism: false` and `tests/rls-tier-matrix.test.ts`'s global counts stay true.
 */

/* ══════════════════════════════════════ the fixture ══════════════════════════════════════════════ */

const QA_TERM = "20000000-0000-4000-8000-00000000c101";
const QA_ANNUAL = "20000000-0000-4000-8000-00000000c102";
/** ⚠ A SCHOOL whose parent is the REGION: the mis-levelled hop, which must land in `unattributed`. */
const QA_MISPARENTED = "10000000-0000-4000-8000-00000000c103";
const QA_MISPARENTED_NAME = "QA Mis-parented PLC JHS";

/** Every figure this file asserts, in one place, so a failure reads as arithmetic, not as a uuid. */
const SMALL = { id: JUR.schoolPublicConsented, name: "Asankrangwa SHS" } as const;
const BIG = { id: JUR.schoolPublicNoConsent, name: "Amenfiman SHS" } as const;
/** 50 teachers on roll, NONE in a PLC — a measured 0%, and no NTC threshold (the sourcing gate). */
const ZERO = { id: JUR.schoolPrivateConsented, name: "St. Monica Mission SHS" } as const;
/** A TERM PLC row and NO ANNUAL row at all — "No PLC data" on compliance. */
const TERM_ONLY = { id: JUR.schoolPublicStale, name: "Wassa Akropong JHS" } as const;
/** An ANNUAL PLC row and NO TERM row — "No PLC data" on coverage, a real rate on compliance. */
const ANNUAL_ONLY = { id: JUR.schoolPublicRevoked, name: "Manso Amenfi JHS" } as const;
/** In the OTHER district: 100% on everything, so an RLS leak is identifiable BY VALUE. */
const OTHER = { id: JUR.schoolOutsideSubtree, name: "Takoradi SHS" } as const;

/** TERM cut: [teacher_headcount, teachers_in_plc] on the sex='ALL' row. */
const TERM: Record<string, { hc: number; inPlc: number }> = {
  [SMALL.id]: { hc: 40, inPlc: 8 }, // 20.0%
  [BIG.id]: { hc: 400, inPlc: 360 }, // 90.0%
  [ZERO.id]: { hc: 50, inPlc: 0 }, // a MEASURED 0.0%
  [TERM_ONLY.id]: { hc: 30, inPlc: 15 }, // 50.0%
  [OTHER.id]: { hc: 100, inPlc: 100 }, // the other district — 100%
  [QA_MISPARENTED]: { hc: 7, inPlc: 7 }, // the unattributed bucket — 100%
};

/**
 * ANNUAL cut: teacher_headcount (DELIBERATELY ≠ the TERM headcount on the same school),
 * teachers_meeting_cpd_threshold (`null` = the ⚠ SOURCING GATE), and cpd_points_teacher_count —
 * planted at a value that would push compliance ABOVE 100% if it were ever the denominator (AC-14).
 */
const ANNUAL: Record<string, { hc: number; thr: number | null; pointsTeachers: number }> =
  {
    [SMALL.id]: { hc: 60, thr: 10, pointsTeachers: 20 }, // 16.67%
    [BIG.id]: { hc: 400, thr: 300, pointsTeachers: 200 }, // 75.0%
    [ZERO.id]: { hc: 50, thr: null, pointsTeachers: 25 }, // NULL — never 0%
    [ANNUAL_ONLY.id]: { hc: 20, thr: 5, pointsTeachers: 10 }, // 25.0%
    [OTHER.id]: { hc: 100, thr: 100, pointsTeachers: 100 },
    [QA_MISPARENTED]: { hc: 7, thr: 7, pointsTeachers: 7 },
  };

/** The honest district figures, and the WRONG answers each defect would print. */
const D = {
  inPlc: 8 + 360 + 0 + 15, // 383
  termHeadcount: 40 + 400 + 50 + 30, // 520
  coverage: 383 / 520, // 0.73653…
  /** The BANNED unweighted mean of the four non-null child cells. */
  coverageAvg: (0.2 + 0.9 + 0 + 0.5) / 4, // 0.40
  threshold: 10 + 300 + 5, // 315 — the NULL contributes nothing, not a 0
  annualHeadcount: 60 + 400 + 50 + 20, // 530
  compliance: 315 / 530, // 0.59433…
  complianceAvg: (10 / 60 + 300 / 400 + 5 / 20) / 3, // 0.38888…
  /** What dividing by `cpd_points_teacher_count` would print — an impossible 123.5%. */
  complianceWrongDen: 315 / (20 + 200 + 25 + 10),
  /** What dividing compliance by the TERM headcount would print. */
  complianceTermDen: 315 / 520,
} as const;

/** The region: both districts PLUS the mis-parented school in the unattributed bucket. */
const R = {
  inPlc: 383 + 100 + 7, // 490
  termHeadcount: 520 + 100 + 7, // 627
  coverage: 490 / 627,
  coverageAvg: (383 / 520 + 1 + 1) / 3, // the banned mean of the three printed rows
  threshold: 315 + 100 + 7, // 422
  annualHeadcount: 530 + 100 + 7, // 637
  compliance: 422 / 637,
} as const;

let owner: postgres.Sql;

const districtScope = scopeFor(districtOfficer);
const nationalScope = scopeFor(nationalOfficer);
const regionScope: JurisdictionScope = scopeFor(
  officerFixture({
    officerId: OFFICER.regionId,
    officerRole: OFFICER.regionRole,
    jurisdictionId: JUR.region,
    level: "REGION",
  }),
);

type Sex = "ALL" | "MALE" | "FEMALE";

/**
 * Plant one school's TERM row(s). `sexed` adds MALE/FEMALE rows that sum EXACTLY to the ALL row — the
 * AC-15 trap: a read that dropped the `sex = 'ALL'` pin returns exactly 2× with a correct-looking rate.
 * The STORED `plc_participation_rate` is planted at a value that matches nothing, so "the reader never
 * reads the stored rate" is a claim this fixture can actually catch.
 */
async function plantTerm(id: string, sexed: boolean): Promise<void> {
  const v = TERM[id]!;
  const rows: [Sex, number, number][] = sexed
    ? [
        ["ALL", v.hc, v.inPlc],
        ["MALE", Math.floor(v.hc / 2), Math.floor(v.inPlc / 2)],
        ["FEMALE", v.hc - Math.floor(v.hc / 2), v.inPlc - Math.floor(v.inPlc / 2)],
      ]
    : [["ALL", v.hc, v.inPlc]];
  for (const [sex, hc, inPlc] of rows) {
    await owner`
      insert into fact_plc_participation
        (jurisdiction_id, period_id, sex, schools_running_plc_count, teacher_headcount,
         sessions_held, sessions_expected, attendance_events, attendance_expected,
         plc_participation_rate, teachers_in_plc, source, as_of_date)
      values
        (${id}::uuid, ${QA_TERM}::uuid, ${sex}::ov_sex, 1, ${hc},
         4, 8, 11, 22, 99.00, ${inPlc}, 'OPERATIONAL_AGG', now())
    `;
  }
}

/** Plant one school's ANNUAL row(s). A `null` threshold IS the ⚠ SOURCING GATE, never a 0. */
async function plantAnnual(id: string, sexed: boolean): Promise<void> {
  const v = ANNUAL[id]!;
  const half = (n: number | null): number | null =>
    n === null ? null : Math.floor(n / 2);
  const rest = (n: number | null): number | null =>
    n === null ? null : n - Math.floor(n / 2);
  const rows: [Sex, number, number | null, number][] = sexed
    ? [
        ["ALL", v.hc, v.thr, v.pointsTeachers],
        ["MALE", Math.floor(v.hc / 2), half(v.thr), Math.floor(v.pointsTeachers / 2)],
        [
          "FEMALE",
          v.hc - Math.floor(v.hc / 2),
          rest(v.thr),
          v.pointsTeachers - Math.floor(v.pointsTeachers / 2),
        ],
      ]
    : [["ALL", v.hc, v.thr, v.pointsTeachers]];
  for (const [sex, hc, thr, teachers] of rows) {
    await owner`
      insert into fact_plc_participation
        (jurisdiction_id, period_id, sex, schools_running_plc_count, teacher_headcount,
         cpd_points_total, cpd_points_teacher_count, cpd_points_mean,
         teachers_meeting_cpd_threshold, annual_plc_target, ntc_cpd_target,
         plc_earned_points_total, plc_earned_teacher_count,
         source, as_of_date)
      values
        (${id}::uuid, ${QA_ANNUAL}::uuid, ${sex}::ov_sex, 1, ${hc},
         ${teachers * 10}, ${teachers}, 10.00,
         ${thr}, 8, 20,
         ${teachers * 10}, ${teachers},
         'OPERATIONAL_AGG', now())
    `;
  }
}

beforeAll(async () => {
  owner = adminAnalytics();

  await owner`
    insert into dim_period (period_id, academic_year, term, period_type, is_current) values
      (${QA_TERM}::uuid,   '2014/15', 1,    'TERM',   false),
      (${QA_ANNUAL}::uuid, '2014/15', null, 'ANNUAL', false)
  `;
  await owner`
    insert into dim_jurisdiction
      (jurisdiction_id, level, parent_id, name, ges_code, school_type, ownership_type, is_reporting)
    values
      -- ⚠ parent_id = a REGION. The level pin must refuse to attribute it to a district row.
      (${QA_MISPARENTED}::uuid, 'SCHOOL', ${JUR.region}::uuid, ${QA_MISPARENTED_NAME},
       null, 'JHS', 'PUBLIC', true)
  `;

  for (const id of [SMALL.id, BIG.id, OTHER.id]) {
    await plantTerm(id, true);
    await plantAnnual(id, true);
  }
  await plantTerm(ZERO.id, false);
  await plantAnnual(ZERO.id, false);
  await plantTerm(TERM_ONLY.id, false); // no ANNUAL row — "No PLC data" on compliance
  await plantAnnual(ANNUAL_ONLY.id, false); // no TERM row — "No PLC data" on coverage
  await plantTerm(QA_MISPARENTED, false);
  await plantAnnual(QA_MISPARENTED, false);
});

afterAll(async () => {
  await owner`
    delete from fact_plc_participation
     where period_id in (${QA_TERM}::uuid, ${QA_ANNUAL}::uuid)
  `;
  await owner`delete from dim_jurisdiction where jurisdiction_id = ${QA_MISPARENTED}::uuid`;
  await owner`
    delete from dim_period where period_id in (${QA_TERM}::uuid, ${QA_ANNUAL}::uuid)
  `;
  await owner.end({ timeout: 5 });
});

/* ══════════════════════════════════════ helpers ══════════════════════════════════════════════════ */

function okValue<T>(reading: Reading<T>): T {
  expect(reading.status).toBe("ok");
  if (!isOk(reading)) throw new Error("expected an `ok` reading, got `unavailable`");
  return reading.value;
}

async function readBreakdown(scope: JurisdictionScope): Promise<ChildBreakdown> {
  return okValue(
    await getChildBreakdown(scope, {
      childLevel: childLevelFor(scope.level),
      termPeriodId: QA_TERM,
      examPeriodId: PERIOD_ID_EXAM_COHORT,
      annualPeriodId: QA_ANNUAL,
      exam: "WASSCE",
    }),
  );
}

function named(breakdown: ChildBreakdown, name: string): BreakdownRow {
  const found = breakdown.children.find((r) => r.name === name);
  expect(found, `no child row named "${name}"`).toBeDefined();
  return found!;
}

/** Children + the unattributed bucket: everything the table prints above its total row. */
function allRows(breakdown: ChildBreakdown): BreakdownRow[] {
  return breakdown.unattributed === null
    ? breakdown.children
    : [...breakdown.children, breakdown.unattributed];
}

const sumOf = (rows: BreakdownRow[], pick: (r: BreakdownRow) => number | null): number =>
  rows.reduce((acc, r) => acc + (pick(r) ?? 0), 0);

const ROOT = process.cwd();

/** Comments stripped, strings kept — the house idiom for a static check over shipped SQL. */
function readCode(file: string): string {
  return readFileSync(join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
}

/** A fully-null `BreakdownRow`, so a render test states only the fields it is about. */
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
    plcInPlc: null,
    plcTermHeadcount: null,
    plcCoverage: null,
    plcThreshold: null,
    plcAnnualHeadcount: null,
    plcThresholdRows: 0,
    plcAnnualRows: 0,
    cpdCompliance: null,
    ...fields,
  };
}

function renderTable(
  rows: BreakdownRow[],
  ntcProvenance: "DEMO" | "LIVE" | "ABSENT",
  level: "NATIONAL" | "DISTRICT" = "DISTRICT",
): string {
  return renderToStaticMarkup(
    createElement(BreakdownTable, {
      ntcProvenance,
      chrome: breakdownChrome(level, level === "DISTRICT" ? "Wassa Amenfi West" : null),
      homeId: null,
      breakdown: {
        childLevel: "SCHOOL",
        children: rows,
        unattributed: null,
        total: row({ name: null }),
        hasCoverage: false,
      } satisfies ChildBreakdown,
    }),
  );
}

/* ════════════════════════════════ 1 · TEACHER-WEIGHTED ROLL-UP (C12/C13, AC-13) ══════════════════ */

describe("PLC coverage and CPD compliance are Σnum ÷ Σden, never an average of the child cells", () => {
  it("the DISTRICT total is the teacher-weighted rate — the 40-teacher school is NOT equally weighted", async () => {
    const b = await readBreakdown(districtScope);
    expect(b.childLevel).toBe("SCHOOL");

    // The child cells, each re-derived over its own school's rows.
    expect(named(b, SMALL.name).plcCoverage).toBeCloseTo(0.2, 12);
    expect(named(b, BIG.name).plcCoverage).toBeCloseTo(0.9, 12);
    expect(named(b, ZERO.name).plcCoverage).toBe(0);
    expect(named(b, TERM_ONLY.name).plcCoverage).toBeCloseTo(0.5, 12);

    // The TOTAL row. 383 ÷ 520, not the 40.0% an unweighted mean of those four cells would print.
    expect(b.total.plcInPlc).toBe(D.inPlc);
    expect(b.total.plcTermHeadcount).toBe(D.termHeadcount);
    expect(b.total.plcCoverage).toBeCloseTo(D.coverage, 12);
    expect(b.total.plcCoverage).not.toBeCloseTo(D.coverageAvg, 3);
    // …and it sits beside the 400-teacher school, not halfway between the two schools' rates.
    expect(Math.abs(b.total.plcCoverage! - 0.9)).toBeLessThan(
      Math.abs(b.total.plcCoverage! - 0.2),
    );

    expect(named(b, SMALL.name).cpdCompliance).toBeCloseTo(10 / 60, 12);
    expect(named(b, BIG.name).cpdCompliance).toBeCloseTo(0.75, 12);
    expect(b.total.plcThreshold).toBe(D.threshold);
    expect(b.total.plcAnnualHeadcount).toBe(D.annualHeadcount);
    expect(b.total.cpdCompliance).toBeCloseTo(D.compliance, 12);
    expect(b.total.cpdCompliance).not.toBeCloseTo(D.complianceAvg, 3);
  });

  it("the REGION total weights the two districts AND the unattributed bucket by their teachers", async () => {
    const b = await readBreakdown(regionScope);
    expect(b.childLevel).toBe("DISTRICT");

    const wassa = named(b, "Wassa Amenfi West");
    const sekondi = named(b, "Sekondi-Takoradi Metro");
    expect(wassa.plcCoverage).toBeCloseTo(D.coverage, 12);
    expect(sekondi.plcCoverage).toBeCloseTo(1, 12);
    // The mis-levelled hop is VISIBLE as the unattributed bucket, never folded into a sibling's name.
    expect(b.unattributed).not.toBeNull();
    expect(b.unattributed!.plcInPlc).toBe(7);
    expect(b.unattributed!.plcCoverage).toBeCloseTo(1, 12);

    expect(b.total.plcCoverage).toBeCloseTo(R.coverage, 12);
    expect(b.total.plcCoverage).not.toBeCloseTo(R.coverageAvg, 3);
    expect(b.total.cpdCompliance).toBeCloseTo(R.compliance, 12);
  });

  it("the NATIONAL total is the same pooled figure, from the same single scan", async () => {
    const b = await readBreakdown(nationalScope);
    expect(b.childLevel).toBe("REGION");
    expect(b.total.plcInPlc).toBe(R.inPlc);
    expect(b.total.plcTermHeadcount).toBe(R.termHeadcount);
    expect(b.total.plcCoverage).toBeCloseTo(R.coverage, 12);
    expect(b.total.plcThreshold).toBe(R.threshold);
    expect(b.total.plcAnnualHeadcount).toBe(R.annualHeadcount);
    expect(b.total.cpdCompliance).toBeCloseTo(R.compliance, 12);
    // The region child row carries its two districts; the mis-parented school is unattributed here too.
    const west = named(b, "Western Region");
    expect(west.plcInPlc).toBe(383 + 100);
    expect(b.unattributed!.plcInPlc).toBe(7);
  });

  it("the STORED per-school rate is never read: it is planted at 99.00 and appears nowhere", async () => {
    const b = await readBreakdown(districtScope);
    for (const r of allRows(b)) expect(r.plcCoverage).not.toBeCloseTo(0.99, 6);
    expect(readCode("lib/oversight/breakdown.ts")).not.toContain(
      "plc_participation_rate",
    );
  });
});

/* ════════════════════════════════ 2 · NULL ≠ 0 (C10/C11, AC-10/11) ═══════════════════════════════ */

describe("the three CPD-compliance states are distinguishable in ONE scope — and none is a 0%", () => {
  it("no ANNUAL PLC row → cpdCompliance null, plcAnnualRows 0 (surface: 'No PLC data')", async () => {
    const r = named(await readBreakdown(districtScope), TERM_ONLY.name);
    expect(r.plcAnnualRows).toBe(0);
    expect(r.plcThresholdRows).toBe(0);
    expect(r.cpdCompliance).toBeNull();
    expect(r.plcThreshold).toBeNull();
    expect(r.plcAnnualHeadcount).toBeNull();
    // …and it is NOT an absence of PLC data altogether: its TERM coverage is a real figure.
    expect(r.plcCoverage).toBeCloseTo(0.5, 12);
  });

  it("ANNUAL rows but a NULL threshold (the ⚠ SOURCING GATE) → null rate, annualRows > 0", async () => {
    const r = named(await readBreakdown(districtScope), ZERO.name);
    expect(r.plcAnnualRows).toBeGreaterThan(0);
    expect(r.plcThresholdRows).toBe(0); // nothing was sourced from NTC
    expect(r.plcThreshold).toBeNull(); // ⚠ NOT 0
    expect(r.cpdCompliance).toBeNull(); // ⚠ NOT 0, and never 0%
    // The denominator IS known (50 teachers on roll) — so a careless `?? 0` on the numerator would
    // have produced a perfectly plausible, perfectly false 0.0% compliant.
    expect(r.plcAnnualHeadcount).toBe(50);
  });

  it("a sourced threshold → the real rate (and these three states differ from each other)", async () => {
    const b = await readBreakdown(districtScope);
    const sourced = named(b, ANNUAL_ONLY.name);
    expect(sourced.plcThresholdRows).toBe(1);
    expect(sourced.plcThreshold).toBe(5);
    expect(sourced.cpdCompliance).toBeCloseTo(0.25, 12);

    const states = [TERM_ONLY, ZERO, ANNUAL_ONLY].map((s) => {
      const r = named(b, s.name);
      return `${r.plcAnnualRows}/${r.plcThresholdRows}/${r.cpdCompliance}`;
    });
    expect(new Set(states).size).toBe(3);
  });

  it("the reader never coalesces a NULL threshold to 0 — the arm emits it nullable", () => {
    const code = readCode("lib/oversight/breakdown.ts");
    // The PLC_ANNUAL arm selects the threshold as a NULLABLE bigint and every non-PLC arm fills the
    // slot with `null::bigint`, never `0::bigint` — a 0 there would be summed into the numerator and
    // would report "0 of N met the national CPD requirement" for every school in the country.
    expect(code).toContain("fpp.teachers_meeting_cpd_threshold::bigint");
    expect(code).not.toMatch(/coalesce\s*\(\s*[^)]*teachers_meeting_cpd_threshold/i);
    expect(code).not.toMatch(/coalesce\s*\(\s*[^)]*teachers_in_plc/i);
    // The TS fold keeps the null too — the sum is only `Number(...)`-ed when it is non-null.
    expect(code).toMatch(/plcThreshold:\s*row\.plc_threshold === null \? null :/);
  });
});

/* ════════════════════════════════ 3 · REAL ZERO vs ABSENT ON COVERAGE ════════════════════════════ */

describe("a measured 0% coverage is not the same value as an absent one", () => {
  it("teachers on roll but none in a PLC → 0; no TERM PLC row → null", async () => {
    const b = await readBreakdown(districtScope);
    const measuredZero = named(b, ZERO.name);
    expect(measuredZero.plcTermHeadcount).toBe(50);
    expect(measuredZero.plcInPlc).toBe(0);
    expect(measuredZero.plcCoverage).toBe(0); // a MEASUREMENT, not an absence
    expect(measuredZero.plcCoverage).not.toBeNull();

    const absent = named(b, ANNUAL_ONLY.name);
    expect(absent.plcInPlc).toBeNull();
    expect(absent.plcTermHeadcount).toBeNull();
    expect(absent.plcCoverage).toBeNull(); // an ABSENCE, not a 0
    // …while the SAME child's compliance is a real figure: the two cuts are independent.
    expect(absent.cpdCompliance).toBeCloseTo(0.25, 12);
  });
});

/* ════════════════════════════════ 4 · THE DENOMINATORS (C12/AC-14) ═══════════════════════════════ */

describe("each rate divides by the right denominator", () => {
  it("PLC coverage divides by the TERM teacher_headcount, not the ANNUAL one", async () => {
    const b = await readBreakdown(districtScope);
    expect(b.total.plcCoverage).toBeCloseTo(383 / 520, 12);
    expect(b.total.plcCoverage).not.toBeCloseTo(383 / 530, 6);
    // Per child, where the two headcounts differ most loudly (40 TERM vs 60 ANNUAL).
    expect(named(b, SMALL.name).plcCoverage).toBeCloseTo(8 / 40, 12);
    expect(named(b, SMALL.name).plcCoverage).not.toBeCloseTo(8 / 60, 6);
  });

  it("CPD compliance divides by the ANNUAL teacher_headcount — never cpd_points_teacher_count", async () => {
    const b = await readBreakdown(districtScope);
    expect(b.total.cpdCompliance).toBeCloseTo(D.compliance, 12);
    expect(b.total.cpdCompliance).not.toBeCloseTo(D.complianceTermDen, 6);
    // The planted `cpd_points_teacher_count` would make the district 123.5% compliant.
    expect(D.complianceWrongDen).toBeGreaterThan(1);
    expect(b.total.cpdCompliance).not.toBeCloseTo(D.complianceWrongDen, 6);
    expect(named(b, SMALL.name).cpdCompliance).toBeCloseTo(10 / 60, 12);
    expect(named(b, SMALL.name).cpdCompliance).not.toBeCloseTo(10 / 20, 6);
  });

  it("the mean-only denominator is structurally out of reach — the column is never selected", () => {
    const code = readCode("lib/oversight/breakdown.ts");
    expect(code).not.toContain("cpd_points_teacher_count");
    expect(code).not.toContain("cpd_points_mean");
  });
});

/* ════════════════════════════════ 5 · sex = 'ALL' ONLY (C12/AC-15) ═══════════════════════════════ */

describe("the PLC arms read sex='ALL' only — summing the split would be exactly 2×", () => {
  it("the MALE/FEMALE rows exist and sum to the ALL row, so the trap is armed", async () => {
    const rows = (await owner`
      select sex::text as sex, sum(teacher_headcount)::int as hc, sum(teachers_in_plc)::int as in_plc
        from fact_plc_participation
       where period_id = ${QA_TERM}::uuid
         and jurisdiction_id in (${SMALL.id}::uuid, ${BIG.id}::uuid)
       group by sex
    `) as unknown as { sex: string; hc: number; in_plc: number }[];
    const by = Object.fromEntries(rows.map((r) => [r.sex, r]));
    expect(by.MALE!.hc + by.FEMALE!.hc).toBe(by.ALL!.hc);
    expect(by.MALE!.in_plc + by.FEMALE!.in_plc).toBe(by.ALL!.in_plc);
  });

  it("the breakdown returns the true figure, not 2× — on BOTH cuts", async () => {
    const b = await readBreakdown(districtScope);
    // SMALL and BIG are the sexed schools: an unpinned sum would add 40+400 and 8+360 a second time.
    expect(b.total.plcTermHeadcount).toBe(520);
    expect(b.total.plcTermHeadcount).not.toBe(520 + 440);
    expect(b.total.plcInPlc).toBe(383);
    expect(b.total.plcInPlc).not.toBe(383 + 368);
    expect(b.total.plcAnnualHeadcount).toBe(530);
    expect(b.total.plcAnnualHeadcount).not.toBe(530 + 460);
    expect(b.total.plcThreshold).toBe(315);
    expect(b.total.plcThreshold).not.toBe(315 + 310);
    // And the derived RATE would still have looked plausible under the doubling — which is exactly
    // why the COUNTS above are the assertion that catches it.
    expect((383 * 2) / (520 * 2)).toBeCloseTo(D.coverage, 12);
  });

  it("both arms carry the sex pin in the shipped SQL", () => {
    const code = readCode("lib/oversight/breakdown.ts");
    const facts = code.slice(code.indexOf("facts as ("), code.indexOf("attributed as ("));
    const plcArms = facts.split("from fact_plc_participation fpp").slice(1);
    expect(plcArms).toHaveLength(2);
    for (const arm of plcArms) expect(arm).toContain("fpp.sex = 'ALL'::ov_sex");
    // …and no `sex in (` split read anywhere in this module.
    expect(facts).not.toMatch(/sex\s+in\s*\(/i);
  });
});

/* ════════════════════════════════ 6 · C19 — THE CROSS-MODULE MATCH ═══════════════════════════════ */

describe("C19: the breakdown total row IS the CPD panel's own figure", () => {
  for (const [label, scope] of [
    ["DISTRICT", districtScope],
    ["REGION", regionScope],
    ["NATIONAL", nationalScope],
  ] as const) {
    it(`${label}: plcCoverage and cpdCompliance equal getTeacherCpd's panel rates`, async () => {
      const b = await readBreakdown(scope);
      const panel = okValue(await getTeacherCpd(scope, QA_TERM, QA_ANNUAL));

      expect(panel.plcCoverage.num).toBe(b.total.plcInPlc);
      expect(panel.plcCoverage.den).toBe(b.total.plcTermHeadcount);
      expect(panel.plcCoverage.rate).toBeCloseTo(b.total.plcCoverage!, 12);

      expect(panel.threshold.value).toBe(b.total.plcThreshold);
      expect(panel.thresholdRate.den).toBe(b.total.plcAnnualHeadcount);
      expect(panel.thresholdRate.rate).toBeCloseTo(b.total.cpdCompliance!, 12);
    });
  }
});

/* ════════════════════════════════ 7 · RECONCILIATION ═════════════════════════════════════════════ */

describe("every additive CPD component reconciles children (+unattributed) to the total row", () => {
  for (const [label, scope] of [
    ["DISTRICT", districtScope],
    ["REGION", regionScope],
    ["NATIONAL", nationalScope],
  ] as const) {
    it(`${label}: Σ of the printed rows equals the total row, component by component`, async () => {
      const b = await readBreakdown(scope);
      const rows = allRows(b);
      expect(sumOf(rows, (r) => r.plcInPlc)).toBe(b.total.plcInPlc);
      expect(sumOf(rows, (r) => r.plcTermHeadcount)).toBe(b.total.plcTermHeadcount);
      expect(sumOf(rows, (r) => r.plcThreshold)).toBe(b.total.plcThreshold);
      expect(sumOf(rows, (r) => r.plcAnnualHeadcount)).toBe(b.total.plcAnnualHeadcount);
      // The module returns `unavailable` when any of these disagree, so an `ok` reading is itself the
      // guarantee — assert that too, so a future arm that breaks the identity fails HERE and loudly.
      expect(rows.length).toBeGreaterThan(0);
    });
  }

  it("the reconciliation really is enforced: the four CPD components are in the guard", () => {
    const code = readCode("lib/oversight/breakdown.ts");
    for (const field of [
      "plcInPlc",
      "plcTermHeadcount",
      "plcThreshold",
      "plcAnnualHeadcount",
    ])
      expect(code).toContain(`sumOf((r) => r.${field})`);
  });
});

/* ════════════════════════════════ 8 · RLS / TIER (AC-23) + AGGREGATE-ONLY (AC-24) ════════════════ */

describe("the CPD cells are bounded by RLS alone, and carry no identifying column", () => {
  it("a district officer's CPD figures cover only that district's schools", async () => {
    const b = await readBreakdown(districtScope);
    // Takoradi SHS (the other district) is 100 in / 100 on roll. A leak would show as 483 / 620.
    expect(b.total.plcInPlc).toBe(383);
    expect(b.total.plcTermHeadcount).toBe(520);
    expect(b.total.plcThreshold).toBe(315);
    expect(b.children.map((r) => r.name)).not.toContain(OTHER.name);
    expect(b.children.map((r) => r.name)).not.toContain("Sekondi-Takoradi Metro");
    // The mis-parented school hangs off the REGION, so it is outside the district subtree entirely.
    expect(b.unattributed).toBeNull();
  });

  it("a region officer sees both districts; the national officer sees the same pooled whole", async () => {
    const region = await readBreakdown(regionScope);
    const national = await readBreakdown(nationalScope);
    expect(region.total.plcInPlc).toBe(R.inPlc);
    expect(national.total.plcInPlc).toBe(R.inPlc);
    // No sibling jurisdiction's NAME appears at the district tier.
    const district = await readBreakdown(districtScope);
    for (const r of district.children) expect(r.name).not.toBe(QA_MISPARENTED_NAME);
  });

  it("the PLC arms write no app-side jurisdiction filter (the ptr.ts precedent)", () => {
    const code = readCode("lib/oversight/breakdown.ts");
    const facts = code.slice(code.indexOf("facts as ("), code.indexOf("attributed as ("));
    const plcArms = facts.split("from fact_plc_participation fpp").slice(1);
    expect(plcArms).toHaveLength(2);
    for (const arm of plcArms) {
      const where = arm.slice(
        0,
        arm.indexOf("union all") === -1 ? undefined : arm.indexOf("union all"),
      );
      expect(where).not.toMatch(/fpp\.jurisdiction_id\s*(=|in)/);
      expect(where).not.toMatch(/scope\./);
    }
    // The module-wide guard: no scope.jurisdictionId reaches this read at all — RLS is the only ceiling.
    expect(code).not.toContain("scope.jurisdictionId");
  });

  it("the CPD read is aggregate-only: no teacher id, name or per-teacher column (AC-24)", () => {
    const code = readCode("lib/oversight/breakdown.ts");
    const facts = code.slice(code.indexOf("facts as ("), code.indexOf("attributed as ("));
    const plcArms = facts.split("from fact_plc_participation fpp").slice(1);
    const allowed = [
      "fpp.jurisdiction_id",
      "fpp.teachers_in_plc",
      "fpp.teacher_headcount",
      "fpp.teachers_meeting_cpd_threshold",
      "fpp.period_id",
      "fpp.sex",
    ];
    for (const arm of plcArms) {
      for (const ref of arm.match(/fpp\.[a-z_]+/g) ?? [])
        expect(allowed, `unexpected column ${ref} in a PLC arm`).toContain(ref);
    }
    // No identifying column anywhere in the fact scan. (`staff` is excluded from this list on
    // purpose: `fact_staffing` is an AGGREGATE fact this module legitimately reads for PTR.)
    for (const forbidden of [
      "user_id",
      "teacher_id",
      "licence",
      "full_name",
      "staff_profile",
    ])
      expect(facts).not.toContain(forbidden);
  });
});

/* ════════════════════════════════ 9 · THE SURFACE (C17 / C6 / C10-C11) ═══════════════════════════ */

describe("the table renders the DEMO chip, the two absences, and never a fabricated 0%", () => {
  const sourced = row({
    childId: JUR.schoolPublicConsented,
    name: "Sourced SHS",
    plcInPlc: 8,
    plcTermHeadcount: 40,
    plcCoverage: 0.2,
    plcThreshold: 10,
    plcAnnualHeadcount: 40,
    plcThresholdRows: 1,
    plcAnnualRows: 1,
    cpdCompliance: 0.25,
  });
  const notSourced = row({
    childId: JUR.schoolPublicNoConsent,
    name: "Unsourced SHS",
    plcInPlc: 0,
    plcTermHeadcount: 50,
    plcCoverage: 0,
    plcThresholdRows: 0,
    plcAnnualRows: 1,
  });
  const noPlc = row({ childId: JUR.schoolPrivateConsented, name: "No PLC SHS" });

  it("DEMO: the compliance figure carries the chip, ON the figure", () => {
    const markup = renderTable([sourced], "DEMO");
    expect(markup).toContain("25.0%");
    expect(markup).toContain(">DEMO<");
    // …on the figure's own line: the chip is INSIDE the same span as the percentage.
    expect(markup).toMatch(/25\.0%<span[^>]*>DEMO<\/span>/);
  });

  for (const provenance of ["LIVE", "ABSENT"] as const) {
    it(`${provenance}: the same data renders the same figure with NO chip`, () => {
      const markup = renderTable([sourced], provenance);
      expect(markup).toContain("25.0%");
      expect(markup).not.toContain(">DEMO<");
    });
  }

  it("the PLC-coverage figure is NEVER chipped — it is a real operational aggregate", () => {
    const markup = renderTable([sourced], "DEMO");
    expect(markup).toMatch(/20\.0%<\/span>/); // coverage span closes with no chip inside
    expect((markup.match(/>DEMO</g) ?? []).length).toBe(1); // the compliance cell, once
  });

  it("the compliance cell is never toned green or terra, in any state", () => {
    for (const provenance of ["DEMO", "LIVE", "ABSENT"] as const) {
      const markup = renderTable([sourced, notSourced, noPlc], provenance);
      expect(markup).not.toContain("text-green");
      expect(markup).not.toContain("text-terra");
    }
  });

  it("'No PLC data' and 'Not yet sourced from NTC' render as the em-dash, never 0%", () => {
    const markup = renderTable([notSourced, noPlc], "DEMO");
    expect(markup).toContain('title="No PLC data"');
    expect(markup).toContain("Not yet sourced from NTC");
    expect(markup).toContain("—");
    // The ONLY percentage in these two rows is the MEASURED 0.0% coverage of `notSourced` — a real
    // zero, which must read as a figure. Neither absence became a 0%.
    expect((markup.match(/0\.0%/g) ?? []).length).toBe(1);
    // …and no absent cell smuggled a chip in beside its dash.
    expect(markup).not.toContain(">DEMO<");
  });

  it("both columns appear at EVERY tier — there is no fees-style district-only gate (AC-21)", () => {
    for (const level of ["NATIONAL", "DISTRICT"] as const) {
      const markup = renderTable([sourced], "DEMO", level);
      expect(markup, level).toContain("PLC coverage");
      expect(markup, level).toContain("CPD compliance");
    }
  });

  it("the real-zero coverage and the absent coverage render differently", () => {
    const zeroMarkup = renderTable([notSourced], "ABSENT");
    const absentMarkup = renderTable([noPlc], "ABSENT");
    expect(zeroMarkup).toContain("0.0%");
    expect(absentMarkup).not.toContain("0.0%");
    expect(absentMarkup).toContain('title="No PLC data"');
  });

  it("the live breakdown's own rows render the three states side by side", async () => {
    const b = await readBreakdown(districtScope);
    const markup = renderToStaticMarkup(
      createElement(BreakdownTable, {
        ntcProvenance: "DEMO" as const,
        chrome: breakdownChrome("DISTRICT", "Wassa Amenfi West"),
        homeId: null,
        breakdown: b,
      }),
    );
    expect(markup).toContain("PLC coverage");
    expect(markup).toContain("CPD compliance");
    expect(markup).toContain('title="No PLC data"');
    expect(markup).toContain("Not yet sourced from NTC");
    // the weighted total, and the measured zero, both printed
    expect(markup).toContain("73.7%");
    expect(markup).toContain("59.4%");
    expect(markup).toContain("0.0%");
    // the banned unweighted means are nowhere on the surface
    expect(markup).not.toContain("40.0%");
    expect(markup).not.toContain("38.9%");
  });
});

/* ════════════════════════════════ 10 · DETERMINISM (AC-25) ═══════════════════════════════════════ */

describe("the read is byte-stable on byte-identical input", () => {
  it("two consecutive reads of the same scope and periods are identical", async () => {
    const first = await readBreakdown(districtScope);
    const second = await readBreakdown(districtScope);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("no now() / random() / current_date reaches the breakdown read", () => {
    const code = readCode("lib/oversight/breakdown.ts");
    expect(code).not.toMatch(/\bnow\s*\(\)/);
    expect(code).not.toMatch(/\brandom\s*\(\)/);
    expect(code).not.toMatch(/\bcurrent_date\b/);
    expect(code).not.toMatch(/Date\.now|Math\.random/);
  });
});
