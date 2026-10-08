import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { scopeFor, type JurisdictionScope } from "@/lib/db/rls";
import { isOk, type Reading } from "@/lib/oversight/reading";
import {
  getTeacherCpd,
  type NtcProvenance,
  type StatusRate,
  type TeacherCpdPanel,
} from "@/lib/oversight/cpd";
import { CpdPanel, DemoChip, ABSENT_NTC_TITLE } from "@/components/oversight/cpd-visuals";
import { CpdSection } from "@/components/oversight/cpd-section";
import { DEMO_CHIP_TOOLTIP, isDemo } from "@/components/oversight/cpd-tone";
import { JUR, OFFICER, PERIOD_ID_ANNUAL, PERIOD_ID_TERM } from "./fixtures/ids";
import {
  adminAnalytics,
  districtOfficer,
  nationalOfficer,
  officerFixture,
} from "./helpers";

/**
 * TEACHER CPD & PLC — SURFACING TESTS (increment L; CPD-SURFACING-RULING + CPD-SURFACE-MAP).
 *
 * This file is the QA gate for the SURFACE half of the slice: `lib/oversight/cpd.ts` (the reader), the
 * `cpd-visuals` / `cpd-section` components and the page wiring. The ETL half has its own 77 tests
 * (tests/etl-plc.test.ts); nothing here re-tests the transform.
 *
 * The properties below are the ones a reviewer cannot see by reading the code:
 *
 *  1. THE RE-DERIVATION (AC-13). The fixture plants a 40-teacher school and a 400-teacher school in one
 *     district, with deliberately lopsided figures: participation 10% vs 80%, coverage 20% vs 90%, mean
 *     5 pts vs 20 pts. The weighted tier figures (73.6% / 83.6% / 18.6 pts) and the unweighted means of
 *     the children (45% / 55% / 12.5 pts) are far apart, so a reader that averaged child rates — or read
 *     the STORED `plc_participation_rate` / `cpd_points_mean` columns, which the fixture populates
 *     honestly for exactly this trap — would still print a plausible district figure.
 *  2. THE SEX-INVARIANT READ (AC-15). `sessions_held`, `schools_running_plc_count` and both targets are
 *     REPEATED identically on the MALE, FEMALE and ALL rows, so a read that summed the split returns
 *     EXACTLY 2× — and the derived session-coverage RATE still looks right because the doubling
 *     cancels. Only the COUNT exposes it, which is what these assertions check.
 *  3. NULL ≠ 0 ≠ DEMO (AC-10/11/12). An uncovered school sits BESIDE covered ones in the same district,
 *     and a whole second period carries no NTC columns at all, so the three states are proved as
 *     differences within one scope rather than as three separate worlds.
 *  4. THE ONE PROVENANCE SWITCH (AC-5/6). The chip is asserted present on every NTC figure and absent on
 *     every PLC figure in ONE render, then the switch is flipped on the SAME data and every chip must
 *     vanish with no other change.
 *  5. RLS ONLY (AC-23). The other district's school carries value-identifiable figures (100% everywhere,
 *     a 1,000-teacher roll), so a leak is visible AS A NUMBER, and the reader writes no jurisdiction
 *     WHERE that could have removed it — the only thing that did is `ov_in_subtree`.
 *  6. SMALL-CELL SUPPRESSION. This slice is `lib/oversight/suppression.ts`'s first consumer, so the
 *     complementary rule is exercised against a real scope denominator.
 *
 * Fixture discipline: every planted row and planted dim_period is removed in `afterAll`, so
 * tests/rls-tier-matrix.test.ts's global counts are untouched (`fileParallelism: false`).
 */

/* ══════════════════════════════════════ the fixture's arithmetic ══════════════════════════════════ */

/** A 40-teacher school in the officer's district — the one an averaged rate would over-weight. */
const SMALL = {
  id: JUR.schoolPublicConsented,
  term: {
    schoolsRunning: 1,
    sessionsHeld: 2,
    sessionsExpected: 10,
    ALL: { headcount: 40, inPlc: 8, events: 10, expected: 100 },
    MALE: { headcount: 20, inPlc: 3, events: 2, expected: 50 },
    FEMALE: { headcount: 20, inPlc: 5, events: 8, expected: 50 },
  },
  annual: {
    ALL: {
      headcount: 40,
      total: 100,
      teacherCount: 20,
      mean: 5,
      // ⚠ THE DENOMINATOR FLIP, PLANTED DELIBERATELY. 40 observed PLC points over FOUR observed PLC
      // earners = 10.0 PLC pts/teacher, which CLEARS this school's own 8-pt target. Spread over its
      // 20 ANY-CPD earners instead it reads 2.0 and the school is reported as MISSING a target its
      // PLC teachers met — the dilution Dex blocked. The points are strictly under both the
      // Mandatory class they are folded into (60) and the all-category total (100), per claim 10.
      plcEarned: 40,
      plcEarnedTeachers: 4,
      threshold: 10,
      mandatory: 60,
      specialised: 25,
      recommended: 15,
      mandatoryTeachers: 20,
      specialisedTeachers: 8,
      recommendedTeachers: 5,
    },
    MALE: {
      headcount: 20,
      total: 40,
      teacherCount: 10,
      mean: 4,
      plcEarned: 16,
      plcEarnedTeachers: 2,
      threshold: 4,
      mandatory: 24,
      specialised: 10,
      recommended: 6,
      mandatoryTeachers: 10,
      specialisedTeachers: 4,
      recommendedTeachers: 2,
    },
    FEMALE: {
      headcount: 20,
      total: 60,
      teacherCount: 10,
      mean: 6,
      plcEarned: 24, // MALE 16 + FEMALE 24 = ALL 40 — the column is ADDITIVE across sex
      plcEarnedTeachers: 2, // …and so is its denominator: MALE 2 + FEMALE 2 = ALL 4
      threshold: 6,
      mandatory: 36,
      specialised: 15,
      recommended: 9,
      mandatoryTeachers: 10,
      specialisedTeachers: 4,
      recommendedTeachers: 3,
    },
  },
} as const;

/** A 400-teacher school in the SAME district — ten times the roll, and far better figures. */
const BIG = {
  id: JUR.schoolPublicNoConsent,
  term: {
    schoolsRunning: 1,
    sessionsHeld: 9,
    sessionsExpected: 10,
    ALL: { headcount: 400, inPlc: 360, events: 800, expected: 1000 },
    MALE: { headcount: 200, inPlc: 180, events: 400, expected: 500 },
    FEMALE: { headcount: 200, inPlc: 180, events: 400, expected: 500 },
  },
  annual: {
    ALL: {
      headcount: 400,
      total: 4000,
      teacherCount: 200,
      mean: 20,
      // The counter-case to SMALL: 800 observed PLC points over 160 observed PLC earners = 5.0 PLC
      // pts/teacher, UNDER its own 8-pt target on the honest basis AND on the diluted one (4.0) —
      // while its 20-pt ALL-CATEGORY mean would have cleared it. So this school is "not met" under
      // both PLC bases and "met" under the all-category one.
      plcEarned: 800,
      plcEarnedTeachers: 160,
      threshold: 300,
      mandatory: 2400,
      specialised: 1000,
      recommended: 600,
      mandatoryTeachers: 200,
      specialisedTeachers: 80,
      recommendedTeachers: 50,
    },
    MALE: {
      headcount: 200,
      total: 2000,
      teacherCount: 100,
      mean: 20,
      plcEarned: 400,
      plcEarnedTeachers: 80,
      threshold: 150,
      mandatory: 1200,
      specialised: 500,
      recommended: 300,
      mandatoryTeachers: 100,
      specialisedTeachers: 40,
      recommendedTeachers: 25,
    },
    FEMALE: {
      headcount: 200,
      total: 2000,
      teacherCount: 100,
      mean: 20,
      plcEarned: 400,
      plcEarnedTeachers: 80,
      threshold: 150,
      mandatory: 1200,
      specialised: 500,
      recommended: 300,
      mandatoryTeachers: 100,
      specialisedTeachers: 40,
      recommendedTeachers: 25,
    },
  },
} as const;

/** The OTHER district's school — 100% on everything, so a leak is identifiable BY VALUE. */
const OUTSIDE = {
  id: JUR.schoolOutsideSubtree,
  term: {
    schoolsRunning: 1,
    sessionsHeld: 7,
    sessionsExpected: 7,
    ALL: { headcount: 1000, inPlc: 1000, events: 5000, expected: 5000 },
    MALE: { headcount: 500, inPlc: 500, events: 2500, expected: 2500 },
    FEMALE: { headcount: 500, inPlc: 500, events: 2500, expected: 2500 },
  },
  annual: {
    ALL: {
      headcount: 1000,
      total: 20000,
      teacherCount: 1000,
      mean: 20,
      plcEarned: 5000,
      plcEarnedTeachers: 400,
      threshold: 1000,
      mandatory: 12000,
      specialised: 5000,
      recommended: 3000,
      mandatoryTeachers: 1000,
      specialisedTeachers: 500,
      recommendedTeachers: 400,
    },
    MALE: {
      headcount: 500,
      total: 10000,
      teacherCount: 500,
      mean: 20,
      plcEarned: 2500,
      plcEarnedTeachers: 200,
      threshold: 500,
      mandatory: 6000,
      specialised: 2500,
      recommended: 1500,
      mandatoryTeachers: 500,
      specialisedTeachers: 250,
      recommendedTeachers: 200,
    },
    FEMALE: {
      headcount: 500,
      total: 10000,
      teacherCount: 500,
      mean: 20,
      plcEarned: 2500,
      plcEarnedTeachers: 200,
      threshold: 500,
      mandatory: 6000,
      specialised: 2500,
      recommended: 1500,
      mandatoryTeachers: 500,
      specialisedTeachers: 250,
      recommendedTeachers: 200,
    },
  },
} as const;

/** The district's THIRD school: the NTC source does not cover it, so its NTC columns are NULL. */
const UNCOVERED = { id: JUR.schoolPrivateConsented } as const;

const NTC_TARGET = 20;
const PLC_TARGET = 8;

// ── the district's honest (weighted) figures, and the WRONG answers an average would give ─────────
const D = {
  participation: (10 + 800) / (100 + 1000), // 0.73636…
  participationAvg: (0.1 + 0.8) / 2, // 0.45 — the banned unweighted mean
  coverage: (8 + 360) / (40 + 400), // 0.83636…
  coverageAvg: (0.2 + 0.9) / 2, // 0.55
  sessions: (2 + 9) / (10 + 10 + 0), // 0.55
  mean: (100 + 4000) / (20 + 200), // 18.636…
  meanAvg: (5 + 20) / 2, // 12.5
  thresholdRate: (10 + 300) / (40 + 400), // 0.70454…
  headcount: 440,
  pointsTeachers: 220,
} as const;

/** The region (= the nation, in this fixture): the district's schools PLUS the other district's. */
const R = {
  participation: (10 + 800 + 5000) / (100 + 1000 + 5000),
  coverage: (8 + 360 + 1000) / (40 + 400 + 1000),
  sessions: (2 + 9 + 7) / (10 + 10 + 7),
  headcount: 1440,
} as const;

/* ══════════════════════════════════════ planted periods ══════════════════════════════════════════ */

/** A SECOND academic year with NO NTC columns anywhere — the live-no-feed world (C10 state 3). */
const PERIOD_NOFEED_ANNUAL = "20000000-0000-4000-8000-0000000000a1";
const PERIOD_NOFEED_TERM = "20000000-0000-4000-8000-0000000000a2";
/** A THIRD year whose only school has 3 female teachers — the small-cell suppression case. */
const PERIOD_SMALLCELL = "20000000-0000-4000-8000-0000000000a3";

const districtScope = scopeFor(districtOfficer);
const nationalScope = scopeFor(nationalOfficer);
const regionOfficer = officerFixture({
  officerId: OFFICER.regionId,
  officerRole: OFFICER.regionRole,
  jurisdictionId: JUR.region,
  level: "REGION",
});
const regionScope: JurisdictionScope = scopeFor(regionOfficer);

let owner: postgres.Sql;

type Sex = "ALL" | "MALE" | "FEMALE";
const SEXES: Sex[] = ["ALL", "MALE", "FEMALE"];

interface TermSexVals {
  headcount: number;
  inPlc: number;
  events: number;
  expected: number;
}
interface AnnualSexVals {
  headcount: number;
  total: number;
  teacherCount: number;
  mean: number;
  /**
   * `plc_earned_points_total` — the OBSERVED PLC-earned points, the one CPD column outside the NTC
   * sourcing gate. Used as-is when the NTC categories are populated; when they are NOT, the ETL
   * invariant is `plc_earned_points_total = cpd_points_total`, so `plantAnnual` plants the total
   * instead (see there) and this field is ignored.
   */
  plcEarned: number;
  /**
   * `plc_earned_teacher_count` — the PLC-earned mean's OWN denominator (the observed PLC earners).
   * ⚠ NOT `teacherCount`, which counts ANY-category earners: a PLC-only numerator over an any-CPD
   * denominator spreads the points across teachers who earned none. `<= teacherCount` always, and
   * `= teacherCount` when the categories are absent — so `plantAnnual` plants the teacher count
   * instead in that state (see there) and this field is ignored.
   */
  plcEarnedTeachers: number;
  threshold: number;
  mandatory: number;
  specialised: number;
  recommended: number;
  mandatoryTeachers: number;
  specialisedTeachers: number;
  recommendedTeachers: number;
}

/** Plant one school's THREE TERM rows. The sex-invariant columns are COPIED, exactly as the ETL does. */
async function plantTerm(
  periodId: string,
  school: {
    id: string;
    term: {
      schoolsRunning: number;
      sessionsHeld: number;
      sessionsExpected: number;
      ALL: TermSexVals;
      MALE: TermSexVals;
      FEMALE: TermSexVals;
    };
  },
): Promise<void> {
  for (const sex of SEXES) {
    const v = school.term[sex];
    // The STORED per-school rate — populated honestly, as the ETL does, so "the reader never reads it"
    // is a choice this fixture can actually catch rather than an absence.
    const stored = v.expected === 0 ? null : Number(((v.events / v.expected) * 100).toFixed(2));
    await owner`
      insert into fact_plc_participation
        (jurisdiction_id, period_id, sex, schools_running_plc_count, teacher_headcount,
         sessions_held, sessions_expected, attendance_events, attendance_expected,
         plc_participation_rate, teachers_in_plc, source, as_of_date)
      values
        (${school.id}::uuid, ${periodId}::uuid, ${sex}::ov_sex,
         ${school.term.schoolsRunning}, ${v.headcount},
         ${school.term.sessionsHeld}, ${school.term.sessionsExpected},
         ${v.events}, ${v.expected}, ${stored}, ${v.inPlc}, 'OPERATIONAL_AGG', now())
    `;
  }
}

/** Plant one school's THREE ANNUAL rows. `ntc = false` closes the sourcing gate (NULL, never 0). */
async function plantAnnual(
  periodId: string,
  school: {
    id: string;
    annual: { ALL: AnnualSexVals; MALE: AnnualSexVals; FEMALE: AnnualSexVals };
  },
  options: { ntc: boolean; schoolsRunning?: number } = { ntc: true },
): Promise<void> {
  for (const sex of SEXES) {
    const v = school.annual[sex];
    await owner`
      insert into fact_plc_participation
        (jurisdiction_id, period_id, sex, schools_running_plc_count, teacher_headcount,
         cpd_points_total, cpd_points_teacher_count, cpd_points_mean,
         teachers_meeting_cpd_threshold, annual_plc_target, ntc_cpd_target,
         cpd_points_mandatory_total, cpd_points_specialised_total, cpd_points_recommended_total,
         cpd_mandatory_teacher_count, cpd_specialised_teacher_count, cpd_recommended_teacher_count,
         plc_earned_points_total, plc_earned_teacher_count,
         source, as_of_date)
      values
        (${school.id}::uuid, ${periodId}::uuid, ${sex}::ov_sex,
         ${options.schoolsRunning ?? 1}, ${v.headcount},
         ${v.total}, ${v.teacherCount}, ${v.mean},
         ${options.ntc ? v.threshold : null}, ${PLC_TARGET},
         ${options.ntc ? NTC_TARGET : null},
         ${v.mandatory},
         ${options.ntc ? v.specialised : null}, ${options.ntc ? v.recommended : null},
         ${v.mandatoryTeachers},
         ${options.ntc ? v.specialisedTeachers : null},
         ${options.ntc ? v.recommendedTeachers : null},
         -- ⚠ THE PLC-EARNED PAIR. ALWAYS POPULATED on an ANNUAL row — a NULL in either would be an
         -- ETL defect, not an absence (both columns are OUTSIDE the NULL-never-0 gate: PLC points
         -- always have an operational feed). With the categories ABSENT the ETL's invariants are
         -- that the points EQUAL cpd_points_total (there, the total IS the PLC-only subtotal) and
         -- the earners EQUAL cpd_points_teacher_count (there, the only CPD earners ARE the PLC
         -- earners) — which is exactly why the reader's switch to this denominator is a no-op in the
         -- live-today state. With them populated both are the smaller observed figures.
         ${options.ntc ? v.plcEarned : v.total},
         ${options.ntc ? v.plcEarnedTeachers : v.teacherCount},
         'OPERATIONAL_AGG', now())
    `;
  }
}

const PLANTED_PERIODS = [
  PERIOD_ID_TERM,
  PERIOD_ID_ANNUAL,
  PERIOD_NOFEED_TERM,
  PERIOD_NOFEED_ANNUAL,
  PERIOD_SMALLCELL,
];

beforeAll(async () => {
  owner = adminAnalytics();

  await owner`
    insert into dim_period (period_id, academic_year, term, period_type, is_current) values
      (${PERIOD_NOFEED_ANNUAL}::uuid, '2018/19', null, 'ANNUAL', false),
      (${PERIOD_NOFEED_TERM}::uuid,   '2018/19', 2,    'TERM',   false),
      (${PERIOD_SMALLCELL}::uuid,     '2017/18', null, 'ANNUAL', false)
  `;

  // ── the DEMO world, on the fixture's own current TERM/ANNUAL periods ──
  await plantTerm(PERIOD_ID_TERM, SMALL);
  await plantTerm(PERIOD_ID_TERM, BIG);
  await plantTerm(PERIOD_ID_TERM, OUTSIDE);
  // The third school in the district: runs no PLC, has no teachers on roll, and is NOT covered by the
  // NTC source — so its NTC columns are NULL beside two schools whose are populated (the "mix").
  await plantTerm(PERIOD_ID_TERM, {
    id: UNCOVERED.id,
    term: {
      schoolsRunning: 0,
      sessionsHeld: 0,
      sessionsExpected: 0,
      ALL: { headcount: 0, inPlc: 0, events: 0, expected: 0 },
      MALE: { headcount: 0, inPlc: 0, events: 0, expected: 0 },
      FEMALE: { headcount: 0, inPlc: 0, events: 0, expected: 0 },
    },
  });
  await plantAnnual(PERIOD_ID_ANNUAL, SMALL);
  await plantAnnual(PERIOD_ID_ANNUAL, BIG);
  await plantAnnual(PERIOD_ID_ANNUAL, OUTSIDE);
  const zeroAnnual: AnnualSexVals = {
    headcount: 0,
    total: 0,
    teacherCount: 0,
    mean: 0,
    plcEarned: 0,
    plcEarnedTeachers: 0,
    threshold: 0,
    mandatory: 0,
    specialised: 0,
    recommended: 0,
    mandatoryTeachers: 0,
    specialisedTeachers: 0,
    recommendedTeachers: 0,
  };
  await plantAnnual(
    PERIOD_ID_ANNUAL,
    { id: UNCOVERED.id, annual: { ALL: zeroAnnual, MALE: zeroAnnual, FEMALE: zeroAnnual } },
    { ntc: false, schoolsRunning: 0 },
  );
  // `cpd_points_mean` must be NULL for a school where nobody earned anything (a mean over an empty
  // set is not 0.00) — and that is also what keeps it out of the PLC-target comparison.
  await owner`
    update fact_plc_participation set cpd_points_mean = null
     where jurisdiction_id = ${UNCOVERED.id}::uuid and period_id = ${PERIOD_ID_ANNUAL}::uuid
  `;

  // ── the LIVE-NO-FEED world: the SAME schools, no NTC columns, and a REAL ZERO on attendance ──
  await plantTerm(PERIOD_NOFEED_TERM, {
    id: SMALL.id,
    term: {
      schoolsRunning: 1,
      sessionsHeld: 5,
      sessionsExpected: 10,
      // Sessions RAN and nobody's attendance was logged: a measured 0, not an absence (C12).
      ALL: { headcount: 40, inPlc: 8, events: 0, expected: 100 },
      MALE: { headcount: 20, inPlc: 3, events: 0, expected: 50 },
      FEMALE: { headcount: 20, inPlc: 5, events: 0, expected: 50 },
    },
  });
  await plantAnnual(PERIOD_NOFEED_ANNUAL, SMALL, { ntc: false });
  await plantAnnual(PERIOD_NOFEED_ANNUAL, BIG, { ntc: false });

  // ── the SMALL-CELL world: one school, 9 male and 3 female teachers ──
  const smallCell = (headcount: number, total: number, teachers: number): AnnualSexVals => ({
    headcount,
    total,
    teacherCount: teachers,
    mean: teachers === 0 ? 0 : Number((total / teachers).toFixed(2)),
    // No non-PLC points here (Specialised and Recommended are a sourced 0), so the observed floor
    // IS the whole total and its earners ARE the whole any-CPD population — the invariants permit
    // equality exactly when nothing non-PLC exists.
    plcEarned: total,
    plcEarnedTeachers: teachers,
    threshold: Math.min(headcount, teachers),
    mandatory: total,
    specialised: 0,
    recommended: 0,
    mandatoryTeachers: teachers,
    specialisedTeachers: 0,
    recommendedTeachers: 0,
  });
  await plantAnnual(PERIOD_SMALLCELL, {
    id: SMALL.id,
    annual: {
      ALL: smallCell(12, 120, 12),
      MALE: smallCell(9, 90, 9),
      FEMALE: smallCell(3, 30, 3),
    },
  });
});

afterAll(async () => {
  for (const periodId of PLANTED_PERIODS)
    await owner`delete from fact_plc_participation where period_id = ${periodId}::uuid`;
  await owner`
    delete from dim_period
     where period_id in (${PERIOD_NOFEED_ANNUAL}::uuid, ${PERIOD_NOFEED_TERM}::uuid,
                         ${PERIOD_SMALLCELL}::uuid)
  `;
  await owner.end({ timeout: 5 });
});

/* ══════════════════════════════════════ helpers ══════════════════════════════════════════════════ */

function okValue<T>(reading: Reading<T>): T {
  expect(reading.status).toBe("ok");
  if (!isOk(reading)) throw new Error("expected an `ok` reading, got `unavailable`");
  return reading.value;
}

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

function render(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

/** The DEMO-state panel the component tests render, read from the database once. */
let demoPanel: TeacherCpdPanel;

async function demo(): Promise<TeacherCpdPanel> {
  demoPanel ??= okValue(
    await getTeacherCpd(districtScope, PERIOD_ID_TERM, PERIOD_ID_ANNUAL),
  );
  return demoPanel;
}

function panelMarkup(data: TeacherCpdPanel, provenance?: NtcProvenance): string {
  return render(
    createElement(CpdPanel, {
      data: provenance === undefined ? data : { ...data, ntcProvenance: provenance },
      termLabel: "Term 2",
      annualLabel: "2025/26",
      tierNoun: "district",
    }),
  );
}

/** The panel's VISIBLE TEXT — tags, titles and class names stripped, entities decoded. */
function visibleTextOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&") // decode the ampersand LAST so no entity is double-unescaped
    .replace(/\s+/g, " ")
    .trim();
}

/** The two sub-sections, split so a chip can be attributed to A (PLC) or B (CPD/NTC). */
function subSections(markup: string): { plc: string; cpd: string } {
  const start = markup.indexOf("PLC participation ·");
  const split = markup.indexOf("CPD points &amp; national compliance");
  expect(start, "no PLC sub-section rendered").toBeGreaterThan(-1);
  expect(split, "no CPD sub-section rendered").toBeGreaterThan(start);
  return { plc: markup.slice(start, split), cpd: markup.slice(split) };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (1) THE RE-DERIVATION — Σnum ÷ Σden, never the average of child rates (AC-13/AC-14)
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("every tier figure is re-derived from summed counts (AC-13)", () => {
  it("the fixture really is lopsided — the two answers are far apart", () => {
    expect(Math.abs(D.participation - D.participationAvg)).toBeGreaterThan(0.25);
    expect(Math.abs(D.coverage - D.coverageAvg)).toBeGreaterThan(0.25);
    expect(Math.abs(D.mean - D.meanAvg)).toBeGreaterThan(5);
  });

  it("DISTRICT: a 40-teacher school is NOT weighted like a 400-teacher one", async () => {
    const p = await demo();
    expect(p.participation.rate).toBeCloseTo(D.participation, 10);
    expect(p.plcCoverage.rate).toBeCloseTo(D.coverage, 10);
    expect(p.pointsMean.rate).toBeCloseTo(D.mean, 10);
    expect(p.thresholdRate.rate).toBeCloseTo(D.thresholdRate, 10);
    // The mutations these catch: avg(plc_participation_rate), avg(cpd_points_mean).
    expect(Math.abs(p.participation.rate! - D.participationAvg)).toBeGreaterThan(0.25);
    expect(Math.abs(p.plcCoverage.rate! - D.coverageAvg)).toBeGreaterThan(0.25);
    expect(Math.abs(p.pointsMean.rate! - D.meanAvg)).toBeGreaterThan(5);
  });

  it("REGION and NATIONAL re-derive over their own, wider subtree", async () => {
    for (const scope of [regionScope, nationalScope]) {
      const p = okValue(await getTeacherCpd(scope, PERIOD_ID_TERM, PERIOD_ID_ANNUAL));
      expect(p.participation.rate).toBeCloseTo(R.participation, 10);
      expect(p.plcCoverage.rate).toBeCloseTo(R.coverage, 10);
      expect(p.sessionCoverage.rate).toBeCloseTo(R.sessions, 10);
      expect(p.headcount).toBe(R.headcount);
    }
  });

  it("each rate divides by its OWN denominator (AC-14)", async () => {
    const p = await demo();
    // The mean's denominator is cpd_points_teacher_count (220), NEVER teacher_headcount (440).
    expect(p.pointsMean.den).toBe(D.pointsTeachers);
    expect(p.pointsMean.den).not.toBe(D.headcount);
    // Coverage and threshold rates divide by teacher_headcount.
    expect(p.plcCoverage.den).toBe(D.headcount);
    expect(p.thresholdRate.den).toBe(D.headcount);
    expect(p.mandatoryCov.den).toBe(D.headcount);
    expect(p.specialisedCov.den).toBe(D.headcount);
    expect(p.recommendedCov.den).toBe(D.headcount);
    // Participation divides attendance_expected, which is NOT the headcount.
    expect(p.participation.den).toBe(1100);
    // Session coverage divides sessions_expected.
    expect(p.sessionCoverage.den).toBe(20);
  });

  it("the stored per-school rate columns are structurally out of reach", () => {
    const code = readCode("lib/oversight/cpd.ts");
    // The columns exist in the fixture and are honest; the reader must still never aggregate them.
    expect(code).not.toMatch(/sum\(\s*fpp\.plc_participation_rate/);
    expect(code).not.toMatch(/sum\(\s*fpp\.cpd_points_mean/);
    expect(code).not.toMatch(/avg\s*\(/i);
    // …while the SUMS the Σ÷Σ form needs are all there.
    for (const column of [
      "attendance_events",
      "attendance_expected",
      "teachers_in_plc",
      "teacher_headcount",
      "cpd_points_total",
      "cpd_points_teacher_count",
      "teachers_meeting_cpd_threshold",
      // The observed PLC-earned points are SUMMED exactly like the other point totals — the column
      // is additive, so "of which PLC-earned" at a district is Σ over its schools and nothing else.
      "plc_earned_points_total",
    ])
      expect(code, column).toMatch(new RegExp(`sum\\(fpp\\.${column}\\)`));
  });

  it("the three category totals reconcile to the total, and the counts do NOT sum (AC-17)", async () => {
    const p = await demo();
    expect(p.categoriesReconcile).toBe(true);
    expect(p.mandatory.value! + p.specialised.value! + p.recommended.value!).toBeCloseTo(
      p.pointsTotal.value!,
      6,
    );
    // The three coverage numerators OVERLAP: their sum exceeds the headcount here, which is exactly
    // why they are three independent rates and never a stacked bar.
    const summed = p.mandatoryCov.num! + p.specialisedCov.num! + p.recommendedCov.num!;
    expect(summed).toBeGreaterThan(p.mandatoryCov.num!);
    expect(p.mandatoryCov.rate! + p.specialisedCov.rate! + p.recommendedCov.rate!).toBeGreaterThan(
      p.mandatoryCov.rate!,
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (2) THE SEX-INVARIANT COLUMNS ARE READ AT sex='ALL' ONLY (AC-15/AC-16/AC-18)
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("the sex-invariant columns are never summed under the MALE/FEMALE split (AC-15)", () => {
  it("the trap is real: the fixture repeats the identical value on all three sex rows", async () => {
    const rows = (await owner`
      select sex::text as sex, sessions_held, schools_running_plc_count
        from fact_plc_participation
       where period_id = ${PERIOD_ID_TERM}::uuid and jurisdiction_id = ${SMALL.id}::uuid
       order by sex::text
    `) as unknown as { sex: string; sessions_held: number; schools_running_plc_count: number }[];
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.sessions_held))).toEqual(new Set([2]));
    expect(new Set(rows.map((r) => r.schools_running_plc_count))).toEqual(new Set([1]));
  });

  it("sessions and schools-running come back as the TRUE count, not 2×", async () => {
    const p = await demo();
    expect(p.sessionCoverage.num).toBe(11); // not 22
    expect(p.sessionCoverage.den).toBe(20); // not 40
    expect(p.schoolsRunning).toEqual({ count: 2, schools: 3 }); // not 4 of 6
  });

  it("neither target is summed across schools or sex (AC-16)", async () => {
    const p = await demo();
    // Three schools × three sex rows each carry 20.00 / 8.00. A summed read would print 180 / 72.
    expect(p.ntcCpdTarget).toBe(NTC_TARGET);
    expect(p.annualPlcTarget).toBe(PLC_TARGET);
    const code = readCode("lib/oversight/cpd.ts");
    expect(code).not.toMatch(/sum\(\s*fpp\.ntc_cpd_target/);
    expect(code).not.toMatch(/sum\(\s*fpp\.annual_plc_target/);
  });

  it("the sex split is attached ONLY to the sexed metrics (AC-18)", async () => {
    const p = await demo();
    // Sexed — the parity frame.
    for (const [name, rate] of [
      ["plcCoverage", p.plcCoverage],
      ["participation", p.participation],
      ["pointsMean", p.pointsMean],
      ["thresholdRate", p.thresholdRate],
      ["specialisedCov", p.specialisedCov],
    ] as [string, StatusRate][])
      expect(rate.bySex, name).toBeDefined();
    // Sex-INVARIANT — no split exists to show, and none is invented.
    expect(p.sessionCoverage.bySex).toBeUndefined();
  });

  it("the panel renders NO parity row for sessions, schools-running or either target", async () => {
    const { plc, cpd } = subSections(panelMarkup(await demo()));
    // The parity caption appears beside the sexed metrics…
    expect(plc).toContain("parity read");
    expect(cpd).toContain("parity read");
    // …and the session-coverage sentence carries no "women"/"men" figures of its own.
    const sessions = plc.slice(plc.indexOf("planned PLC sessions"));
    expect(sessions).not.toContain("women");
    // The target sentences are counts/thresholds, never a sexed split.
    const target = cpd.slice(cpd.indexOf("met their own PLC target"));
    expect(target).not.toContain("women");
  });

  it("each parity row states its metric's OWN unit — points for B1, percentages for the rest", async () => {
    // Quinn RED-1: `pointsMean.rate` is POINTS PER TEACHER (Σtotal ÷ Σteacher_count), not a fraction,
    // so a percentage formatter printed the district's 18.64-pt mean as "1863.6%" on the GES-facing,
    // DEMO-chipped figure. `ParityRow` now REQUIRES a unit, so the next non-fraction sexed metric is a
    // type error rather than a silent percentage.
    const markup = panelMarkup(await demo());
    const b1 = markup.slice(markup.indexOf("mean CPD points"));
    const block = b1.slice(0, 1200);
    // No three-or-more-digit percentage anywhere near the sexed mean…
    expect(block).not.toMatch(/\d{3,}(\.\d+)?%/);
    // …and the sexed figures carry the headline's own points idiom, with the gap in CPD points.
    expect(block).toContain("pts");
    expect(block).toContain("CPD points");
    // The four fraction metrics keep their percentages, with the gap in percentage points.
    const { plc } = subSections(markup);
    expect(plc).toContain("percentage points");
    expect(plc).toMatch(/\d+\.\d%/);
  });

  it("the parity figures are re-derived per sex from summed inputs", async () => {
    const p = await demo();
    // Women: (8 + 400) ÷ (50 + 500); men: (2 + 400) ÷ (50 + 500) — each its own Σ÷Σ.
    expect(p.participation.bySex!.female.rate).toBeCloseTo(408 / 550, 10);
    expect(p.participation.bySex!.male.rate).toBeCloseTo(402 / 550, 10);
    // …and the ALL figure is not the mean of the two (different denominators would make it so).
    expect(p.participation.rate).toBeCloseTo(810 / 1100, 10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (3) NULL ≠ 0 ≠ DEMO — the four display states (AC-10/11/12)
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("the sourcing gate is never laundered into a zero (AC-10/11)", () => {
  it("the live-no-feed period returns ABSENT for every NTC figure — never 0, never 0%", async () => {
    const p = okValue(
      await getTeacherCpd(districtScope, PERIOD_NOFEED_TERM, PERIOD_NOFEED_ANNUAL),
    );
    expect(p.ntcProvenance).toBe("ABSENT");
    for (const [name, figure] of [
      ["threshold", p.threshold],
      ["specialised", p.specialised],
      ["recommended", p.recommended],
    ] as const) {
      expect(figure.status, name).toBe("ABSENT");
      expect(figure.value, name).toBeUndefined();
      expect(figure.value, name).not.toBe(0);
    }
    expect(p.thresholdRate.status).toBe("ABSENT");
    expect(p.thresholdRate.rate).toBeUndefined();
    // The reconciliation is NOT asserted when the categories are absent (C8/AC-9).
    expect(p.categoriesReconcile).toBe(false);
    // …while the PLC-operational half of the same period still states its figures.
    expect(p.plcCoverage.status).toBe("MEASURED");
    expect(p.mandatory.status).toBe("MEASURED"); // the stated PLC-only partial, un-chipped
    // The observed PLC-earned column is outside the gate entirely: it is measured here, and in this
    // state the ETL invariant makes it equal to `cpd_points_total` (SMALL 100 + BIG 4,000).
    expect(p.plcEarnedPoints).toEqual({ status: "MEASURED", value: 4100 });
    expect(p.pointsTotal.value).toBe(4100);
  });

  it("the panel renders the ABSENT threshold as the NTC em-dash, with NO 0 and NO 0%", async () => {
    const p = okValue(
      await getTeacherCpd(districtScope, PERIOD_NOFEED_TERM, PERIOD_NOFEED_ANNUAL),
    );
    const { cpd } = subSections(panelMarkup(p));
    expect(cpd).toContain(`title="${ABSENT_NTC_TITLE}"`);
    expect(cpd).not.toMatch(/0 of [\d,]+ teachers met/);
    expect(cpd).not.toContain("0.0% of teachers on roll");
    // …and no DEMO chip anywhere, because the switch is not DEMO.
    expect(cpd).not.toContain(">DEMO<");
  });

  it("a REAL ZERO is a definite 0 with its word, distinct from an absence (AC-12)", async () => {
    const p = okValue(
      await getTeacherCpd(districtScope, PERIOD_NOFEED_TERM, PERIOD_NOFEED_ANNUAL),
    );
    // Sessions RAN (5 of 10 held) and zero attendance was logged — a measurement, not absence.
    expect(p.participation.status).toBe("REAL_ZERO");
    expect(p.participation.rate).toBe(0);
    const { plc } = subSections(panelMarkup(p));
    expect(plc).toContain("0% — sessions ran but no attendance was logged.");
    // The two states are visibly different: the real zero is NOT the muted em-dash.
    const zeroLine = plc.slice(plc.indexOf("sessions ran but"));
    expect(zeroLine).not.toContain(ABSENT_NTC_TITLE);
  });

  it("a mix inside one scope: covered schools state a figure, the uncovered one is absent", async () => {
    const p = await demo();
    // Two of the district's three schools are NTC-covered; the third's columns are NULL.
    expect(p.annualSchools).toBe(3);
    expect(p.ntcSchools).toBe(2);
    // The figure is the Σ over the covered rows — NOT a 0-padded Σ over all three.
    expect(p.threshold.value).toBe(310);
    const markup = panelMarkup(p);
    expect(markup).toContain("cover 2 of 3 schools");
  });

  it("the two PLC-only figures are published with the categories POPULATED, un-chipped (C8/B4)", async () => {
    // Both figures used to be withheld whenever the NTC categories were populated, because the only
    // PLC-earned number in the row was `cpd_points_total` (all-category in that state). They now read
    // `plc_earned_points_total`, which is observed from the operational PLC aggregate ONLY — so it is
    // a real measurement in the demo state too, and must be stated there.
    const demoState = await demo();
    expect(demoState.specialised.status).not.toBe("ABSENT"); // the categories really ARE populated
    // SMALL 40 + BIG 800 + the uncovered school's observed 0.
    expect(demoState.plcEarnedPoints).toEqual({ status: "MEASURED", value: 840 });
    // ⚠ GENUINELY NEW INFORMATION, not the total relabelled: it is strictly below `pointsTotal`
    // (4,100), which is what a reader that re-published the total would get wrong.
    expect(demoState.plcEarnedPoints.value!).toBeLessThan(demoState.pointsTotal.value!);
    // NOT CHIPPED. `plcValue` cannot produce a DEMO status, so no chip can render on the figure…
    expect(demoState.plcEarnedPoints.status).not.toBe("DEMO");
    const earnedLine = (markup: string): string => {
      const at = markup.indexOf("of which PLC-earned");
      expect(at, "the PLC-earned line did not render").toBeGreaterThan(-1);
      return markup.slice(at, markup.indexOf("</p>", at));
    };
    const markup = panelMarkup(demoState);
    expect(earnedLine(markup)).toContain("840 pts");
    expect(earnedLine(markup)).not.toContain(">DEMO<");
    expect(earnedLine(markup)).not.toContain(DEMO_CHIP_TOOLTIP);

    // B4 is the PLC-EARNED mean — Σ PLC points ÷ PLC EARNERS, per row — against each school's own
    // PLC target, so Y and N share ONE wholly PLC-only basis: SMALL earns 40 ÷ 4 = 10.0 PLC
    // pts/teacher (≥ 8, MET), BIG earns 800 ÷ 160 = 5.0 (< 8, not met).
    expect(demoState.plcTargetMet).toEqual({ status: "MEASURED", count: 1, schools: 2 });
    expect(visibleTextOf(markup)).toContain(
      "1 of 2 schools met their own PLC target (8 PLC pts)",
    );

    /* ⚠ THE DENOMINATOR IS THE PLC EARNERS, NOT THE ANY-CPD EARNERS (Dex's blocker, behavioural).
     *
     * SMALL is planted as a verdict FLIP, so the two candidate denominators disagree about it:
     *     40 PLC pts ÷  4 PLC earners      = 10.0  ≥ 8  → MET      (the honest basis)
     *     40 PLC pts ÷ 20 any-CPD earners  =  2.0  < 8  → missing  (the diluted basis)
     * A PLC-only numerator over an any-CPD denominator spreads the points across teachers who
     * earned none, understates the mean, and reports a school as missing a target its PLC teachers
     * met. BIG agrees under both (5.0 and 4.0, missing either way), so on the diluted denominator
     * this district would read "No school met its own PLC target (0 of 2)" — a different, adverse
     * and FALSE answer, which is what the assertions above would catch. */
    const flip = SMALL.annual.ALL;
    expect(flip.plcEarned / flip.plcEarnedTeachers).toBeGreaterThanOrEqual(PLC_TARGET);
    expect(flip.plcEarned / flip.teacherCount).toBeLessThan(PLC_TARGET);
    expect(flip.plcEarnedTeachers).toBeLessThan(flip.teacherCount); // a strict SUBSET, as planted
    expect(visibleTextOf(markup)).not.toContain("No school met its own PLC target");
    // …and the all-category mean is a third, different number again: 18.6 pts/teacher against the
    // district's honest PLC-earned mean of 840 ÷ 164 = 5.1.
    const plcMean =
      demoState.plcEarnedPoints.value! /
      (SMALL.annual.ALL.plcEarnedTeachers + BIG.annual.ALL.plcEarnedTeachers);
    expect(demoState.pointsMean.rate! - plcMean).toBeGreaterThan(1);

    // …and with the categories ABSENT nothing moves, because there the ETL invariants make BOTH
    // halves of the basis equal their all-category counterparts (points = `cpd_points_total`,
    // earners = `cpd_points_teacher_count`) — the switch is a no-op in the live-today state.
    const noFeed = okValue(
      await getTeacherCpd(districtScope, PERIOD_NOFEED_TERM, PERIOD_NOFEED_ANNUAL),
    );
    expect(noFeed.plcEarnedPoints).toEqual({ status: "MEASURED", value: 4100 });
    expect(noFeed.plcTargetMet.count).toBe(1); // only the 400-teacher school clears 8 PLC pts

    // THE PINS. The subset is built with the UN-CHIPPED PLC constructor, never `ntcValue`; the
    // per-school comparison divides the PLC points by the PLC EARNERS, never by the any-CPD earners
    // and never using the stored all-category mean; and no figure branches on the provenance value.
    const code = readCode("lib/oversight/cpd.ts");
    expect(code).toMatch(/plcEarnedPoints: plcValue\(/);
    expect(code).not.toMatch(/plcEarnedPoints: ntcValue/);
    expect(code).toMatch(
      /fpp\.plc_earned_points_total\s*\n?\s*\/ nullif\(fpp\.plc_earned_teacher_count, 0\) >= fpp\.annual_plc_target/,
    );
    expect(code).not.toMatch(/nullif\(fpp\.cpd_points_teacher_count/);
    expect(code).not.toMatch(/cpd_points_mean >= fpp\.annual_plc_target/);
    expect(code).not.toMatch(/ntcProvenance === "DEMO"/);
  });

  it("under LIVE with the categories populated the captions state the measured NCPD half", async () => {
    const live = panelMarkup(await demo(), "LIVE");
    // The LIVE arm of the Mandatory caption — never the no-feed "PLC-only partial" wording, and never
    // the demo "illustrative" wording.
    expect(live).toContain("includes both the school-based PLC provision and the NCPD half");
    expect(live).not.toContain("a PLC-only partial");
    expect(live).not.toContain("is illustrative");
    // The two PLC-only figures are stated under LIVE exactly as under DEMO — the observed column is
    // the same measurement either way, so the flip changes NOTHING about them…
    const text = visibleTextOf(live);
    expect(text).toContain("of which PLC-earned: 840 pts");
    expect(text).toContain("1 of 2 schools met their own PLC target (8 PLC pts)");
    // …and neither carries, or excuses itself with, any demo language under a live feed.
    expect(live).not.toContain("demo NTC top-up");
    expect(live).not.toContain("Not stateable while CPD points");
    // …and no chip and no demo prose survive the flip.
    expect(live).not.toContain(">DEMO<");
    expect(live).not.toContain("illustrative demo data");
    // The categories-absent world still gets its own honest wording.
    const noFeed = okValue(
      await getTeacherCpd(districtScope, PERIOD_NOFEED_TERM, PERIOD_NOFEED_ANNUAL),
    );
    expect(panelMarkup(noFeed)).toContain("a PLC-only partial");
  });

  it("the reader coalesces no NTC column, anywhere (AC-11, static)", () => {
    const code = readCode("lib/oversight/cpd.ts");
    expect(code).not.toMatch(/coalesce/i);
    // The discriminated status is what reaches the surface.
    expect(code).toContain('status: "ABSENT"');
  });

  it("the reader returns a discriminated status, and the renderer has no numeric fallback", () => {
    const visuals = readCode("components/oversight/cpd-visuals.tsx");
    // Every state is branched; `renderCpdStatus` cannot print a figure for an ABSENT status.
    expect(visuals).toContain('if (status === "ABSENT")');
    expect(visuals).toContain('if (status === "REAL_ZERO")');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (4) THE DEMO CHIP AND THE ONE PROVENANCE SWITCH (AC-5/AC-6)
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("every NTC-derived figure is chipped ON THE FIGURE; no PLC figure is (AC-5)", () => {
  it("the demo state is what the fixture produces, by the C5(ii) signature", async () => {
    const p = await demo();
    expect(p.ntcProvenance).toBe("DEMO");
    expect(isDemo(p.ntcProvenance)).toBe(true);
    for (const [name, status] of [
      ["threshold", p.threshold.status],
      ["specialised", p.specialised.status],
      ["recommended", p.recommended.status],
      ["mandatory", p.mandatory.status],
      ["pointsMean", p.pointsMean.status],
      ["thresholdRate", p.thresholdRate.status],
      ["specialisedCov", p.specialisedCov.status],
    ] as const)
      expect(status, name).toBe("DEMO");
    // The PLC-operational half is NEVER stamped DEMO — it is a real-shape aggregate.
    for (const [name, status] of [
      ["plcCoverage", p.plcCoverage.status],
      ["participation", p.participation.status],
      ["sessionCoverage", p.sessionCoverage.status],
    ] as const)
      expect(status, name).toBe("MEASURED");
  });

  it("the chips are in sub-section B and NOWHERE in sub-section A", async () => {
    const { plc, cpd } = subSections(panelMarkup(await demo()));
    expect(plc).not.toContain(">DEMO<");
    expect(plc).not.toContain(DEMO_CHIP_TOOLTIP);
    // On the figure, with the word and the verbatim tooltip — never colour alone.
    expect(cpd).toContain(">DEMO<");
    expect(cpd).toContain(`title="${DEMO_CHIP_TOOLTIP}"`);
    expect(cpd).toContain("bg-warn-bg");
    // The chip count: the mean, the three category totals, the three coverage rates, the threshold and
    // its rate, plus each sexed sub-figure — many, and certainly more than a single header marker.
    expect((cpd.match(/>DEMO</g) ?? []).length).toBeGreaterThan(8);
  });

  it("the chip is never green and never terra", async () => {
    const markup = panelMarkup(await demo());
    expect(markup).not.toContain("text-green");
    expect(markup).not.toContain("bg-green");
    expect(markup).not.toContain("text-terra");
    expect(markup).not.toContain("bg-terra");
  });

  it("flipping the ONE switch to LIVE drops every chip, with no other change (AC-6)", async () => {
    const p = await demo();
    const demoMarkup = panelMarkup(p);
    for (const provenance of ["LIVE", "ABSENT"] as const) {
      const flipped = panelMarkup(p, provenance);
      expect(flipped).not.toContain(">DEMO<");
      expect(flipped).not.toContain(DEMO_CHIP_TOOLTIP);
      // The figures themselves are untouched — the switch moves the MARKER, not the data.
      expect(flipped).toContain("18.64"); // the re-derived mean, still stated
      expect(demoMarkup).toContain("18.64");
    }
  });

  it("DemoChip renders null for anything but DEMO — one gate, no second branch", () => {
    expect(render(createElement(DemoChip, { provenance: "DEMO" }))).toContain("DEMO");
    expect(render(createElement(DemoChip, { provenance: "LIVE" }))).toBe("");
    expect(render(createElement(DemoChip, { provenance: "ABSENT" }))).toBe("");
  });

  it("the provenance is resolved ONCE, from one place (static)", () => {
    const code = readCode("lib/oversight/cpd.ts");
    // One assignment of the switch, propagated — not re-decided per figure.
    expect((code.match(/const ntcProvenance:/g) ?? []).length).toBe(1);
    // …and the scaffolded LIVE branch exists so the future feed flips it without a surface change.
    expect(code).toContain("NTC_CPD_EXTRACT");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (5) SMALL-CELL SUPPRESSION — this slice is suppression.ts's first consumer
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("the sexed parity figures are routed through applySexedStaffSuppression", () => {
  it("a scope with 3 female teachers suppresses BOTH sexes and keeps the ALL figure", async () => {
    const p = okValue(await getTeacherCpd(districtScope, null, PERIOD_SMALLCELL));
    // Complementary: publishing MALE beside ALL would state FEMALE exactly as loudly.
    expect(p.pointsMean.bySex).toBeUndefined();
    expect(p.thresholdRate.bySex).toBeUndefined();
    expect(p.mandatoryCov.bySex).toBeUndefined();
    // The ALL figure is still published, and the caveat says why the split is not.
    expect(p.pointsMean.rate).toBeCloseTo(10, 10);
    expect(p.suppressionCaveat).toContain("fewer than 5 teachers");
    expect(panelMarkup(p)).toContain("fewer than 5 teachers");
  });

  it("a scope whose both sexes clear the threshold publishes the split and no caveat", async () => {
    const p = await demo();
    expect(p.pointsMean.bySex).toBeDefined();
    expect(p.suppressionCaveat).toBeNull();
    expect(panelMarkup(p)).not.toContain("fewer than 5 teachers");
  });

  it("the decision is taken from the TEACHER HEADCOUNT denominators, through the shared module", () => {
    const code = readCode("lib/oversight/cpd.ts");
    expect(code).toContain("applySexedStaffSuppression");
    expect(code).toContain("sexedStaffDisclosureDecision");
    // The denominators are headcounts, not the measure being displayed (the module's instruction).
    expect(code).toMatch(/MALE: headcountFor\("MALE"\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (6) RLS ONLY — no app-side jurisdiction ceiling (AC-23) — and aggregate-only (AC-24)
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("isolation is RLS's, and the read writes no ceiling of its own (AC-23)", () => {
  it("DISTRICT: the other district's school is not in any Σ", async () => {
    const p = await demo();
    expect(p.headcount).toBe(D.headcount);
    expect(p.schoolsRunning.schools).toBe(3);
    // A leak would be identifiable BY VALUE — the outside school is 100% on everything.
    expect(p.participation.rate).not.toBeCloseTo(1, 3);
    expect(p.participation.rate).not.toBeCloseTo(R.participation, 6);
    expect(p.headcount).not.toBe(R.headcount);
  });

  it("REGION sees both districts; NATIONAL sees the country; neither is the district's figure", async () => {
    const region = okValue(await getTeacherCpd(regionScope, PERIOD_ID_TERM, PERIOD_ID_ANNUAL));
    const national = okValue(
      await getTeacherCpd(nationalScope, PERIOD_ID_TERM, PERIOD_ID_ANNUAL),
    );
    expect(region.headcount).toBe(R.headcount);
    expect(national.headcount).toBe(R.headcount);
    expect(region.schoolsRunning).toEqual({ count: 3, schools: 4 });
    expect(region.participation.rate).not.toBeCloseTo(D.participation, 6);
  });

  it("there is no jurisdiction WHERE in the read, and no second copy of the ceiling (static)", () => {
    const code = readCode("lib/oversight/cpd.ts");
    // The ceiling is RLS's `ov_in_subtree`, applied by `withJurisdiction` — not re-written here.
    expect(code).toContain("withJurisdiction(scope");
    expect(code).not.toMatch(/ov_in_subtree/);
    expect(code).not.toMatch(/jurisdiction_id\s*=\s*\$/);
    expect(code).not.toMatch(/jurisdiction_id\s*in\s*\(/i);
    expect(code).not.toMatch(/parent_id/);
    expect(code).not.toMatch(/scope\.jurisdictionId/);
    // The only use of the column is the honest "how many schools" denominator.
    const uses = code.match(/fpp\.jurisdiction_id/g) ?? [];
    expect(uses.length).toBe(2);
    expect(code).toMatch(/count\(distinct fpp\.jurisdiction_id\)/);
  });

  it("the allow-list carries no identifying column (AC-24, static)", () => {
    const code = readCode("lib/oversight/cpd.ts");
    const ALLOWED = new Set([
      "sex",
      "jurisdiction_id",
      "period_id",
      "source",
      "schools_running_plc_count",
      "teacher_headcount",
      "sessions_held",
      "sessions_expected",
      "attendance_events",
      "attendance_expected",
      "teachers_in_plc",
      "cpd_points_total",
      "cpd_points_teacher_count",
      "plc_earned_points_total",
      "plc_earned_teacher_count",
      "teachers_meeting_cpd_threshold",
      "annual_plc_target",
      "ntc_cpd_target",
      "cpd_points_mandatory_total",
      "cpd_points_specialised_total",
      "cpd_points_recommended_total",
      "cpd_mandatory_teacher_count",
      "cpd_specialised_teacher_count",
      "cpd_recommended_teacher_count",
    ]);
    // EVERY column the SQL names must be on the list — so a widened select is a failing test, not a
    // review miss. (`cpd_points_mean` is deliberately OFF the list now: the per-ROW PLC-target
    // predicate was its last reader, and that predicate is on the PLC-earned mean instead — so
    // naming the stored all-category mean anywhere in this file is a failing test.)
    for (const match of code.matchAll(/fpp\.([a-z_]+)/g))
      expect(ALLOWED.has(match[1]!), `fpp.${match[1]} is not on the allow-list`).toBe(true);
    // The named-record vocabulary must not appear at all.
    for (const forbidden of [
      /\buser_id\b/,
      /teacher_id/,
      /full_name/,
      /ref_user/,
      /plc_membership/,
      /email/,
      /readback/,
    ])
      expect(code).not.toMatch(forbidden);
    // No join to any other table: this is a single-fact aggregate read.
    expect(code).not.toMatch(/\bjoin\b/i);
  });

  it("re-reading byte-identical data yields byte-identical figures (AC-25)", async () => {
    const first = okValue(await getTeacherCpd(regionScope, PERIOD_ID_TERM, PERIOD_ID_ANNUAL));
    const second = okValue(await getTeacherCpd(regionScope, PERIOD_ID_TERM, PERIOD_ID_ANNUAL));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const code = readCode("lib/oversight/cpd.ts");
    expect(code).not.toMatch(/now\(\)/);
    expect(code).not.toMatch(/random/i);
    expect(code).not.toMatch(/Date\./);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (7) THE TWO PERIOD CUTS, FAIL-SOFT AND TIER-POLYMORPHISM (AC-20)
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("the panel is tier-polymorphic, fail-soft, and labels its two vintages (AC-20)", () => {
  it("the TERM and ANNUAL cuts are two DIFFERENT period ids, and are not confused", async () => {
    // Handing the ANNUAL id to the TERM parameter: the session columns are NULL on an ANNUAL row, so
    // sub-section A empties while sub-section B stands — proof the two reads are pinned separately.
    const swapped = okValue(
      await getTeacherCpd(districtScope, PERIOD_ID_ANNUAL, PERIOD_ID_ANNUAL),
    );
    expect(swapped.sessionCoverage.status).toBe("ABSENT");
    expect(swapped.participation.status).toBe("ABSENT");
    expect(swapped.pointsMean.status).toBe("DEMO");
    // …and the reverse: the ANNUAL cut pinned to the TERM id has no CPD columns at all.
    const term = okValue(await getTeacherCpd(districtScope, PERIOD_ID_TERM, PERIOD_ID_TERM));
    expect(term.pointsMean.status).toBe("ABSENT");
    expect(term.threshold.status).toBe("ABSENT");
    expect(term.participation.rate).toBeCloseTo(D.participation, 10);
  });

  it("a NULL annual period is `unavailable`, never a panel of zeroes", async () => {
    expect(await getTeacherCpd(districtScope, PERIOD_ID_TERM, null)).toEqual({
      status: "unavailable",
    });
  });

  it("a period with no PLC rows at all is `unavailable`", async () => {
    const empty = "20000000-0000-4000-8000-0000000000af";
    expect(await getTeacherCpd(districtScope, empty, empty)).toEqual({
      status: "unavailable",
    });
  });

  it("an unreadable read renders the fail-soft note and never throws", () => {
    const html = render(
      createElement(CpdSection, {
        reading: { status: "unavailable" } as Reading<TeacherCpdPanel>,
        tierNoun: "district",
        termLabel: "Term 2",
        annualLabel: "2025/26",
      }),
    );
    expect(html).toContain("could not be read");
    expect(html).toContain("The rest of this dashboard is unaffected");
    expect(html).not.toMatch(/\b0%/);
  });

  it("the section renders at every tier, with no tier gate and no drill-down note", async () => {
    const p = await demo();
    for (const tierNoun of ["country", "region", "district"]) {
      const html = render(
        createElement(CpdSection, {
          reading: { status: "ok", value: p } as Reading<TeacherCpdPanel>,
          tierNoun,
          termLabel: "Term 2",
          annualLabel: "2025/26",
        }),
      );
      expect(html).toContain("Teacher ");
      expect(html).toContain("PLC participation ·");
      expect(html).toContain("CPD points &amp; national compliance");
      // The fees-style tier gate must NOT appear here: CPD rolls up honestly at every tier.
      expect(html).not.toContain("Drill into");
    }
  });

  it("the two vintages are labelled distinctly", async () => {
    const markup = panelMarkup(await demo());
    expect(markup).toContain("PLC participation · Term 2");
    expect(markup).toContain("2025/26 · annual");
  });

  it("the CpdSection is mounted exactly once, outside the breakdown gate", () => {
    const page = readCode("app/(oversight)/page.tsx");
    expect((page.match(/<CpdSection/g) ?? []).length).toBe(1);
    // It is a page-level sibling, not nested in BreakdownSection (which is not given a `cpd` prop).
    const breakdown = readCode("components/oversight/breakdown-section.tsx");
    expect(breakdown).not.toContain("CpdSection");
    // …and the reader is handed the TERM id and the ANNUAL id, in that order — never one twice.
    expect(page).toMatch(/getTeacherCpd\(\s*scope,\s*isOk\(termPeriod\)/);
    expect(page).toMatch(/annualPeriod\.value\.periodId,/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (8) THE PAGE: FOUR KPI CARDS (AC-19) AND THE TWO PROVENANCE LINES (AC-22)
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

function chromeSession(base: unknown, jurisdictionName: string) {
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

describe("the page keeps four KPI cards and carries the two CPD provenance lines", () => {
  it("the KPI strip is still xl:grid-cols-4 with exactly four cards — no CPD card (AC-19)", async () => {
    const markup = await renderPage(chromeSession(nationalOfficer, "Ghana"));
    const anchor = markup.indexOf('aria-label="Headline indicators"');
    expect(anchor).toBeGreaterThan(-1);
    const start = markup.lastIndexOf("<section", anchor);
    const end = markup.indexOf("<section", anchor);
    const strip = markup.slice(start, end === -1 ? undefined : end);
    expect(strip).toContain("xl:grid-cols-4");
    for (const label of [
      "Total enrolment",
      "School coverage",
      "WASSCE qualification",
      "Pupil-teacher ratio",
    ])
      expect(strip, label).toContain(label);
    // No fifth card, and nothing CPD/PLC in the strip at all.
    expect(strip).not.toContain("CPD");
    expect(strip).not.toContain("PLC");
    expect(strip).not.toContain("xl:grid-cols-5");
  });

  it("the panel renders on the page, and the two C20 lines are in the provenance ledger (AC-22)", async () => {
    const markup = await renderPage(chromeSession(nationalOfficer, "Ghana"));
    expect(markup).toContain("PLC participation ·");
    // The PLC line — always, whenever the panel can render.
    expect(markup).toContain("PLC participation</dt>");
    expect(markup).toContain("aggregated from schools&#x27; own Professional Learning Community");
    expect(markup).toContain("never an average of school rates");
    // The CPD/NTC line — the demo variant, with the stated statutory threshold.
    expect(markup).toContain("CPD points (NTC)</dt>");
    expect(markup).toContain("ILLUSTRATIVE DEMO figures");
    expect(markup).toContain(`(${NTC_TARGET} points)`);
    expect(markup).toContain("Every such figure is marked DEMO");
  });

  it("the ledger's CPD lines are gated on the CPD reading, not printed unconditionally (static)", () => {
    const page = readCode("app/(oversight)/page.tsx");
    expect(page).toMatch(/\.\.\.\(isOk\(cpd\)/);
    expect(page).toContain('ntcProvenance === "DEMO"');
    expect(page).toContain('ntcProvenance === "ABSENT"');
  });
});
