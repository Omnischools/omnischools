import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { scopeFor } from "@/lib/db/rls";
import { isOk, type Reading } from "@/lib/oversight/reading";
import { getTeacherCpd, type TeacherCpdPanel } from "@/lib/oversight/cpd";
import { ABSENT_NTC_TITLE, CpdPanel } from "@/components/oversight/cpd-visuals";
import { DEMO_CHIP_TOOLTIP } from "@/components/oversight/cpd-tone";
import { JUR } from "./fixtures/ids";
import { adminAnalytics, districtOfficer } from "./helpers";

/**
 * TEACHER CPD & PLC — THE QA GATE'S ADVERSARIAL ADDENDUM (Quinn, increment L).
 *
 * `tests/oversight-cpd.test.ts` proves the slice's main claims. This file closes the places that file
 * leaves to inspection rather than to an executed check, and attacks the three figures a faked
 * implementation would most plausibly fake:
 *
 *  1. THE THREE-WAY ON `teachers_meeting_cpd_threshold` (AC-10/11). The sibling file proves ABSENT and
 *     DEMO. It does NOT prove the third state, nor the hardest case of all: a DEMO-populated genuine
 *     ZERO, which must render as a definite "0 of N … met" WITH the chip and must still be
 *     distinguishable from the unsourced em-dash. Both are proved here.
 *  2. THE `?? 0` FALLBACKS IN `cpd-visuals.tsx` (AC-11). Every figure in that file is formatted as
 *     `value ?? 0` inside a status branch. The branch is the only thing standing between a NULL NTC
 *     column and a rendered "0%" — so a fully-ABSENT panel is rendered here and its VISIBLE TEXT is
 *     asserted to contain no zero figure at all. A mutation that dropped any ABSENT branch would print
 *     a zero and fail this test; reading the code cannot tell you that.
 *  3. THE DEMO SIGNATURE (C5(ii), AC-7). The signature is "an OPERATIONAL_AGG row with a non-null NTC
 *     column". Proved here from EACH of the three signature columns ALONE, and — the adversarial case —
 *     against a row stamped with a DIFFERENT external `ov_source` (`EMIS_EXTRACT`), which must NOT be
 *     mistaken for the future `NTC_CPD_EXTRACT` LIVE feed by a loose text comparison.
 *  4. SUPPRESSION FAIL-CLOSED ON A MISSING SEX ROW. The sibling file proves the below-threshold case
 *     (3 female teachers). The NULL-denominator case — the sexed rows absent entirely — is the one the
 *     module documents as fail-closed, and is proved here.
 *  5. THE TWO PLC-ONLY FIELDS (`plcEarnedPoints` C8/AC-9, `plcTargetMet` B4/AC-16), which now read
 *     the OBSERVED `plc_earned_points_total` column and are therefore published in EVERY data state.
 *     Two things a code reading cannot show are proved here: that neither figure carries a DEMO chip
 *     in the demo state (they are real measurements sitting beside stand-in figures), and that B4's
 *     basis really did move to the PLC-earned mean — the fixture is built so the old all-category
 *     basis AND the diluted any-CPD denominator each give a DIFFERENT answer to the same question
 *     ("1 of 2" and "0 of 2" against the honest "2 of 2"), so the count the panel prints says which
 *     of the three bases the reader actually used.
 *  6. AC-21, which no test referenced: the breakdown columns (C17) and comparison rows (C18) are
 *     DEFERRED by E-CPD-4, so they must be wholly ABSENT — never a `—` row standing in for them.
 *
 * Fixture discipline, as the sibling file's: every planted fact row and `dim_period` row is removed in
 * `afterAll`, so the suite's global row counts (tests/rls-tier-matrix.test.ts) are untouched.
 */

/* ══════════════════════════════════════ planted periods ══════════════════════════════════════════ */

/** DEMO, with a school whose threshold is a genuine, SOURCED 0 (a demo zero — chipped, not absent). */
const P_DEMO_ZERO = "20000000-0000-4000-8000-0000000000b1";
/** Live-no-feed: no NTC column anywhere. Two schools, one over and one under its own PLC target. */
const P_NOFEED = "20000000-0000-4000-8000-0000000000b2";
/** The signature from ONE column only — `teachers_meeting_cpd_threshold`. */
const P_SIG_THRESHOLD = "20000000-0000-4000-8000-0000000000b3";
/** The signature from ONE column only — `cpd_points_specialised_total`, on an EMIS_EXTRACT row. */
const P_SIG_SPECIALISED = "20000000-0000-4000-8000-0000000000b4";
/** The signature from ONE column only — `cpd_points_recommended_total`. */
const P_SIG_RECOMMENDED = "20000000-0000-4000-8000-0000000000b5";
/** Only an ALL row: the sexed denominators are missing, so suppression must fail CLOSED. */
const P_NO_SEX_ROWS = "20000000-0000-4000-8000-0000000000b6";
/**
 * ⚠ THE MIGRATION-0006 WINDOW, EVERY SCHOOL: both new columns still NULL on every row, because
 * `0006` landed them nullable on the pre-existing rows and only the NEXT PLC ETL run fills them.
 * The migration file asserts both figures render ABSENT until then; this is where that is checked.
 */
const P_UNRUN = "20000000-0000-4000-8000-0000000000b7";
/**
 * ⚠ THE SAME WINDOW, HALF-CLOSED — and it is NOT only a migration window. `writePlcFactsTx` deletes
 * and re-inserts ONLY the jurisdictions it computed, and `computePerSchool` drops a school whose
 * invariants fail while the run still closes SUCCESS inside its 1% failure budget. So a school can
 * keep a row with both columns NULL beside neighbours that carry values, in an ordinarily successful
 * run. The published figures must degrade honestly rather than silently narrow.
 */
const P_PARTIAL = "20000000-0000-4000-8000-0000000000b8";
/**
 * A school with a configured PLC target and ZERO observed PLC earners, beside one with earners. The
 * `nullif(plc_earned_teacher_count, 0)` guard drops it from BOTH sides of B4 — so it must not be
 * counted as having missed its target, and N ≤ Y must survive.
 */
const P_ZERO_EARNERS = "20000000-0000-4000-8000-0000000000b9";

const PLANTED = [
  P_DEMO_ZERO,
  P_NOFEED,
  P_SIG_THRESHOLD,
  P_SIG_SPECIALISED,
  P_SIG_RECOMMENDED,
  P_NO_SEX_ROWS,
  P_UNRUN,
  P_PARTIAL,
  P_ZERO_EARNERS,
];

const NTC_TARGET = 20;
const PLC_TARGET = 8;

const districtScope = scopeFor(districtOfficer);
let owner: postgres.Sql;

type Sex = "ALL" | "MALE" | "FEMALE";
const SEXES: Sex[] = ["ALL", "MALE", "FEMALE"];

interface AnnualRow {
  school: string;
  period: string;
  sex: Sex;
  headcount: number;
  total: number | null;
  teacherCount: number | null;
  mean: number | null;
  threshold: number | null;
  mandatory: number | null;
  specialised: number | null;
  recommended: number | null;
  mandatoryTeachers: number | null;
  specialisedTeachers: number | null;
  recommendedTeachers: number | null;
  /**
   * `plc_earned_points_total` — the OBSERVED PLC-earned points. ALWAYS populated on an ANNUAL row
   * (it is outside the NULL-never-0 sourcing gate: PLC points always have an operational feed), and
   * never greater than the Mandatory class it is folded into. With the categories ABSENT the ETL
   * invariant is that it EQUALS `cpd_points_total`.
   */
  plcEarned: number | null;
  /**
   * `plc_earned_teacher_count` — the PLC-earned mean's OWN denominator (the observed PLC earners).
   * ⚠ NOT `teacherCount`, which counts ANY-category earners and would spread the PLC points across
   * teachers who earned none. Same discipline as the points beside it: always populated on an
   * ANNUAL row, `<= teacherCount` always, and `= teacherCount` when the categories are absent.
   */
  plcEarnedTeachers: number | null;
  ntcTarget: number | null;
  plcTarget: number | null;
  source?: string;
}

async function plant(row: AnnualRow): Promise<void> {
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
      (${row.school}::uuid, ${row.period}::uuid, ${row.sex}::ov_sex, 1, ${row.headcount},
       ${row.total}, ${row.teacherCount}, ${row.mean},
       ${row.threshold}, ${row.plcTarget}, ${row.ntcTarget},
       ${row.mandatory}, ${row.specialised}, ${row.recommended},
       ${row.mandatoryTeachers}, ${row.specialisedTeachers}, ${row.recommendedTeachers},
       ${row.plcEarned}, ${row.plcEarnedTeachers},
       ${(row.source ?? "OPERATIONAL_AGG") as string}::ov_source, now())
  `;
}

/** The sex-split shape every planted school uses: half the roll each, so suppression clears. */
function split(n: number): { ALL: number; MALE: number; FEMALE: number } {
  return { ALL: n, MALE: n / 2, FEMALE: n / 2 };
}

beforeAll(async () => {
  owner = adminAnalytics();

  await owner`
    insert into dim_period (period_id, academic_year, term, period_type, is_current) values
      (${P_DEMO_ZERO}::uuid,        '2010/11', null, 'ANNUAL', false),
      (${P_NOFEED}::uuid,           '2011/12', null, 'ANNUAL', false),
      (${P_SIG_THRESHOLD}::uuid,    '2012/13', null, 'ANNUAL', false),
      (${P_SIG_SPECIALISED}::uuid,  '2013/14', null, 'ANNUAL', false),
      (${P_SIG_RECOMMENDED}::uuid,  '2014/15', null, 'ANNUAL', false),
      (${P_NO_SEX_ROWS}::uuid,      '2015/16', null, 'ANNUAL', false),
      (${P_UNRUN}::uuid,            '2016/17', null, 'ANNUAL', false),
      (${P_PARTIAL}::uuid,          '2017/18', null, 'ANNUAL', false),
      (${P_ZERO_EARNERS}::uuid,     '2018/19', null, 'ANNUAL', false)
  `;

  // ── P_DEMO_ZERO: school A is fully covered; school B is covered and SOURCED a genuine 0 ──────────
  // Both carry the whole NTC set, so the scope's provenance is DEMO and school B's zero is a DEMO
  // zero: a figure the stand-in supplied that happens to be 0, which must render as a definite 0 WITH
  // the chip — not as the sourcing-gate em-dash (the hardest of the four states to get right).
  for (const sex of SEXES) {
    const h = split(100)[sex];
    await plant({
      school: JUR.schoolPublicConsented,
      period: P_DEMO_ZERO,
      sex,
      headcount: h,
      total: h * 10,
      teacherCount: h / 2,
      mean: 20,
      threshold: h / 2,
      mandatory: h * 6,
      specialised: h * 3,
      recommended: h * 1,
      mandatoryTeachers: h / 2,
      specialisedTeachers: h / 5,
      recommendedTeachers: h / 10,
      // ⚠ ALL THREE CANDIDATE BASES DISAGREE ABOUT THIS SCHOOL, DELIBERATELY:
      //     300 PLC pts ÷ 30 PLC earners     = 10.0  ≥ 8  → MET      (the honest basis)
      //     300 PLC pts ÷ 50 any-CPD earners =  6.0  < 8  → missing  (the DILUTED denominator)
      //     the stored all-category mean     = 20.0  ≥ 8  → met, but for Specialised and
      //                                                     Recommended points its PLC target
      //                                                     never covered (the C13 substitution)
      // So the verdict is "met" only on the honest basis AND for the right reason.
      plcEarned: h * 3,
      plcEarnedTeachers: (h * 3) / 10,
      ntcTarget: NTC_TARGET,
      plcTarget: PLC_TARGET,
    });
    const g = split(60)[sex];
    await plant({
      school: JUR.schoolPublicNoConsent,
      period: P_DEMO_ZERO,
      sex,
      headcount: g,
      // Nobody here met the requirement, and the SOURCE says so: 0 is a measurement, not an absence.
      total: g * 2,
      teacherCount: g,
      mean: 2,
      threshold: 0,
      mandatory: g * 2,
      specialised: 0,
      recommended: 0,
      mandatoryTeachers: g,
      specialisedTeachers: 0,
      recommendedTeachers: 0,
      // Specialised and Recommended are a sourced 0, so there are no non-PLC points: the observed
      // floor IS the whole total. ⚠ ITS DENOMINATOR IS NOT, THOUGH — only a FIFTH of this school's
      // CPD earners earned a PLC point, which is the second verdict flip:
      //     120 PLC pts ÷ 12 PLC earners     = 10.0  ≥ 8  → MET      (the honest basis)
      //     120 PLC pts ÷ 60 any-CPD earners =  2.0  < 8  → missing  (the DILUTED denominator)
      //     the stored all-category mean     =  2.0  < 8  → missing
      plcEarned: g * 2,
      plcEarnedTeachers: g / 5,
      ntcTarget: NTC_TARGET,
      plcTarget: PLC_TARGET,
    });
  }

  // ── P_NOFEED: the live-no-feed world. Mandatory is the stated PLC-only partial; the mean IS the
  // PLC-only mean, so B4's per-row comparison is honest. School A's mean (10) clears its own PLC
  // target of 8; school B's (6) does not → "1 of 2 schools met their own PLC target".
  const noFeed: [string, number, number, number][] = [
    // school, headcount(ALL), points total(ALL), mean
    [JUR.schoolPublicConsented, 100, 500, 10],
    [JUR.schoolPublicNoConsent, 100, 300, 6],
  ];
  for (const [school, headcount, total, mean] of noFeed)
    for (const sex of SEXES) {
      const h = split(headcount)[sex];
      const t = split(total)[sex];
      await plant({
        school,
        period: P_NOFEED,
        sex,
        headcount: h,
        total: t,
        teacherCount: t / mean,
        mean,
        threshold: null,
        mandatory: t,
        specialised: null,
        recommended: null,
        mandatoryTeachers: t / mean,
        specialisedTeachers: null,
        recommendedTeachers: null,
        // Categories ABSENT → the ETL invariants are plc_earned_points_total = cpd_points_total AND
        // plc_earned_teacher_count = cpd_points_teacher_count, so the PLC-earned mean and the stored
        // all-category mean are the SAME number in this state. The basis switch is a no-op here.
        plcEarned: t,
        plcEarnedTeachers: t / mean,
        ntcTarget: null,
        plcTarget: PLC_TARGET,
      });
    }

  // ── the three SIGNATURE periods: exactly ONE non-null NTC column each ────────────────────────────
  const signature = async (
    period: string,
    column: "threshold" | "specialised" | "recommended",
    source?: string,
  ): Promise<void> => {
    for (const sex of SEXES) {
      const h = split(80)[sex];
      await plant({
        school: JUR.schoolPublicConsented,
        period,
        sex,
        headcount: h,
        total: h * 4,
        teacherCount: h,
        mean: 4,
        threshold: column === "threshold" ? h / 4 : null,
        mandatory: h * 4,
        specialised: column === "specialised" ? h : null,
        recommended: column === "recommended" ? h : null,
        mandatoryTeachers: h,
        specialisedTeachers: null,
        recommendedTeachers: null,
        // Only one NTC column is non-null here, so the categories read ABSENT and the PLC-earned
        // pair coincides with its all-category counterpart: 4.0 pts/teacher, under the 8-pt target.
        plcEarned: h * 4,
        plcEarnedTeachers: h,
        ntcTarget: column === "threshold" ? NTC_TARGET : null,
        plcTarget: PLC_TARGET,
        source,
      });
    }
  };
  await signature(P_SIG_THRESHOLD, "threshold");
  // ⚠ THE ADVERSARIAL ONE: a row stamped with a DIFFERENT external extract. `source::text =
  // 'NTC_CPD_EXTRACT'` must not match it — a loose comparison (LIKE '%EXTRACT%', or a check for "any
  // non-OPERATIONAL_AGG source") would silently flip the scope LIVE and drop every DEMO chip.
  await signature(P_SIG_SPECIALISED, "specialised", "EMIS_EXTRACT");
  await signature(P_SIG_RECOMMENDED, "recommended");

  // ── P_NO_SEX_ROWS: an ALL row and nothing else. The sexed denominators are NULL → fail CLOSED ────
  await plant({
    school: JUR.schoolPublicConsented,
    period: P_NO_SEX_ROWS,
    sex: "ALL",
    headcount: 90,
    total: 900,
    teacherCount: 90,
    mean: 10,
    threshold: 45,
    mandatory: 540,
    specialised: 240,
    recommended: 120,
    mandatoryTeachers: 90,
    specialisedTeachers: 40,
    recommendedTeachers: 20,
    plcEarned: 450,
    plcEarnedTeachers: 50, // 9.0 PLC pts/teacher over its PLC earners (450 ÷ 50)
    ntcTarget: NTC_TARGET,
    plcTarget: PLC_TARGET,
  });

  /* ── the three PLC-EARNED COLUMN-POPULATION states (Quinn, the 0006 follow-up) ────────────────
   * The columns are nullable in DDL BECAUSE a TERM row must carry NULL, so a NULL on an ANNUAL row
   * is unrepresentable as a constraint and is reachable from the database even though the ETL never
   * writes one: migration 0006 lands both columns NULL on every pre-existing row, and
   * `writePlcFactsTx` only re-inserts the jurisdictions the run computed. Every other fixture here
   * has both columns populated, so these three are the only place the reader's behaviour on a NULL
   * is observed — which is the state the two figures were un-withheld INTO. */

  // Both columns NULL on every school: the state migration 0006 documents between the hand-apply and
  // the next PLC ETL run.
  const unrunOrPartial = async (period: string, fill: boolean): Promise<void> => {
    for (const sex of SEXES) {
      const h = split(100)[sex];
      // School A: re-run by the ETL in the PARTIAL case, not yet in the UNRUN case.
      await plant({
        school: JUR.schoolPublicConsented,
        period,
        sex,
        headcount: h,
        total: h * 5,
        teacherCount: h / 2,
        mean: 10,
        threshold: null,
        mandatory: h * 5,
        specialised: null,
        recommended: null,
        mandatoryTeachers: h / 2,
        specialisedTeachers: null,
        recommendedTeachers: null,
        // 500 ÷ 50 = 10.0 ≥ 8 → this school MET its own target, once it is measurable at all.
        plcEarned: fill ? h * 5 : null,
        plcEarnedTeachers: fill ? h / 2 : null,
        ntcTarget: null,
        plcTarget: PLC_TARGET,
      });
      // School B: NEVER re-run in either case — its row predates the two columns.
      await plant({
        school: JUR.schoolPublicNoConsent,
        period,
        sex,
        headcount: h,
        total: h * 2,
        teacherCount: h / 2,
        mean: 4,
        threshold: null,
        mandatory: h * 2,
        specialised: null,
        recommended: null,
        mandatoryTeachers: h / 2,
        specialisedTeachers: null,
        recommendedTeachers: null,
        plcEarned: null,
        plcEarnedTeachers: null,
        ntcTarget: null,
        plcTarget: PLC_TARGET,
      });
    }
  };
  await unrunOrPartial(P_UNRUN, false);
  await unrunOrPartial(P_PARTIAL, true);

  // A measurable school beside one with a target and ZERO observed PLC earners.
  for (const sex of SEXES) {
    const h = split(100)[sex];
    await plant({
      school: JUR.schoolPublicConsented,
      period: P_ZERO_EARNERS,
      sex,
      headcount: h,
      total: h * 5,
      teacherCount: h / 2,
      mean: 10,
      threshold: null,
      mandatory: h * 5,
      specialised: null,
      recommended: null,
      mandatoryTeachers: h / 2,
      specialisedTeachers: null,
      recommendedTeachers: null,
      plcEarned: h * 5,
      plcEarnedTeachers: h / 2,
      ntcTarget: null,
      plcTarget: PLC_TARGET,
    });
    await plant({
      school: JUR.schoolPublicNoConsent,
      period: P_ZERO_EARNERS,
      sex,
      headcount: h,
      // A MEASURED nothing on both halves — the legitimate 0 the two columns are outside the
      // NULL-never-0 gate to permit. There is no mean to form, so no verdict to publish.
      total: 0,
      teacherCount: 0,
      mean: 0,
      threshold: null,
      mandatory: 0,
      specialised: null,
      recommended: null,
      mandatoryTeachers: 0,
      specialisedTeachers: null,
      recommendedTeachers: null,
      plcEarned: 0,
      plcEarnedTeachers: 0,
      ntcTarget: null,
      plcTarget: PLC_TARGET,
    });
  }
});

afterAll(async () => {
  for (const period of PLANTED)
    await owner`delete from fact_plc_participation where period_id = ${period}::uuid`;
  await owner`delete from dim_period where period_id in ${owner(PLANTED)}`;
  await owner.end({ timeout: 5 });
});

/* ══════════════════════════════════════ helpers ══════════════════════════════════════════════════ */

function okValue<T>(reading: Reading<T>): T {
  expect(reading.status).toBe("ok");
  if (!isOk(reading)) throw new Error("expected an `ok` reading, got `unavailable`");
  return reading.value;
}

function markupOf(data: TeacherCpdPanel): string {
  return renderToStaticMarkup(
    createElement(CpdPanel, {
      data,
      termLabel: "Term 2",
      annualLabel: "2025/26",
      tierNoun: "district",
    }),
  );
}

/** The panel's VISIBLE TEXT — tags, titles and class names stripped, entities decoded. */
function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&") // decode the ampersand LAST so no entity is double-unescaped
    .replace(/\s+/g, " ")
    .trim();
}

function readCode(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8");
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (1) THE THREE-WAY ON `teachers_meeting_cpd_threshold` — the figure a fake would fake (AC-10/11)
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("the threshold's four states are four DIFFERENT renders (AC-10/11/12)", () => {
  it("DEMO: a figure with the chip, and the statutory target stated beside it", async () => {
    const p = okValue(await getTeacherCpd(districtScope, null, P_DEMO_ZERO));
    expect(p.ntcProvenance).toBe("DEMO");
    // Σ over the two covered schools: 50 met, 0 met.
    expect(p.threshold).toEqual({ status: "DEMO", value: 50 });
    expect(p.headcount).toBe(160);
    const text = visibleText(markupOf(p));
    expect(text).toContain("50 of 160 teachers met the national CPD requirement (20 pts)");
    expect(markupOf(p)).toContain(`title="${DEMO_CHIP_TOOLTIP}"`);
  });

  it("a DEMO-populated ZERO is a definite 0 WITH the chip — not the sourcing-gate em-dash", async () => {
    // The whole scope, restricted to the school whose SOURCED threshold is 0. The reader has no
    // per-school entry point, so the claim is made at the figure: status DEMO + value 0 renders the
    // definite zero sentence, and the ABSENT title must NOT appear on that line.
    const zeroDemo: TeacherCpdPanel = {
      ...okValue(await getTeacherCpd(districtScope, null, P_DEMO_ZERO)),
      threshold: { status: "DEMO", value: 0 },
      thresholdRate: { status: "DEMO", rate: 0, num: 0, den: 160 },
    };
    const markup = markupOf(zeroDemo);
    const text = visibleText(markup);
    expect(text).toContain("0 of 160 teachers met the national CPD requirement (20 pts)");
    // The definite zero carries the chip (it is still a stand-in figure)…
    const line = markup.slice(markup.indexOf("0 of 160"));
    expect(line.slice(0, 400)).toContain(">DEMO<");
    // …and is NOT the absence. The two must never be the same pixels.
    expect(line.slice(0, 400)).not.toContain(ABSENT_NTC_TITLE);
  });

  it("ABSENT: the em-dash with the NTC title, and NO zero figure on the line", async () => {
    const p = okValue(await getTeacherCpd(districtScope, null, P_NOFEED));
    expect(p.ntcProvenance).toBe("ABSENT");
    expect(p.threshold).toEqual({ status: "ABSENT" });
    expect(p.threshold.value).toBeUndefined();
    const markup = markupOf(p);
    expect(markup).toContain(`title="${ABSENT_NTC_TITLE}"`);
    const text = visibleText(markup);
    expect(text).not.toMatch(/\d+ of \d+ teachers met/);
    expect(text).not.toMatch(/0(\.0)?% of teachers on roll/);
    expect(markup).not.toContain(">DEMO<");
  });

  it("REAL_ZERO (the future live feed): '0 teachers met …', adverse, un-chipped, not an em-dash", async () => {
    // The state the data cannot reach today — `ov_source` has no NTC_CPD_EXTRACT member (E-CPD-2), so
    // a non-null threshold is DEMO by signature. The RENDER path is nonetheless the one AC-10 names,
    // so it is proved at the figure with the provenance the future feed will carry.
    const live: TeacherCpdPanel = {
      ...okValue(await getTeacherCpd(districtScope, null, P_DEMO_ZERO)),
      ntcProvenance: "LIVE",
      threshold: { status: "REAL_ZERO", value: 0 },
      thresholdRate: { status: "REAL_ZERO", rate: 0, num: 0, den: 160 },
    };
    const markup = markupOf(live);
    const text = visibleText(markup);
    expect(text).toContain("0 teachers met the national CPD requirement (20 pts)");
    expect(markup).not.toContain(">DEMO<");
    const line = markup.slice(markup.indexOf("0 teachers met"));
    expect(line.slice(0, 300)).not.toContain(ABSENT_NTC_TITLE);
    // The three renders of the SAME underlying figure are three different strings.
    expect(text).not.toMatch(/0 of 160 teachers met/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (2) THE `?? 0` FALLBACKS CANNOT REACH THE SURFACE (AC-11 — behavioural, not static)
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

const ALL_ABSENT: TeacherCpdPanel = {
  ntcProvenance: "ABSENT",
  schoolsRunning: { count: 0, schools: 0 },
  plcCoverage: { status: "ABSENT" },
  participation: { status: "ABSENT" },
  sessionCoverage: { status: "ABSENT" },
  pointsMean: { status: "ABSENT" },
  pointsTotal: { status: "ABSENT" },
  plcEarnedPoints: { status: "ABSENT" },
  mandatory: { status: "ABSENT" },
  specialised: { status: "ABSENT" },
  recommended: { status: "ABSENT" },
  mandatoryCov: { status: "ABSENT" },
  specialisedCov: { status: "ABSENT" },
  recommendedCov: { status: "ABSENT" },
  threshold: { status: "ABSENT" },
  thresholdRate: { status: "ABSENT" },
  categoriesReconcile: false,
  ntcCpdTarget: null,
  annualPlcTarget: null,
  plcTargetMet: { status: "ABSENT", schools: 0 },
  headcount: 0,
  annualSchools: 0,
  ntcSchools: 0,
  termAvailable: false,
  suppressionCaveat: null,
};

describe("a wholly-ABSENT panel prints no zero anywhere (AC-11)", () => {
  it("renders, and its visible text contains NO numeral but the two vintage labels", () => {
    // The vintages ("Term 2", "2025/26") are the panel's own chrome, not figures, so they are the
    // only numerals a wholly-absent panel is allowed to print. Everything else must be an em-dash:
    // any `?? 0` that escaped its ABSENT branch would show up as a digit here.
    const text = visibleText(markupOf(ALL_ABSENT))
      .replace("Term 2", "Term")
      .replace("2025/26", "this year");
    expect(text).not.toMatch(/\d/);
    expect(text).not.toContain("0%");
    expect(text).not.toContain("0 pts");
  });

  it("every absence carries a TITLE that says why, so the em-dashes are not interchangeable", () => {
    const markup = markupOf(ALL_ABSENT);
    const titles = [...markup.matchAll(/title="([^"]+)"/g)].map((m) => m[1]!);
    expect(titles.length).toBeGreaterThan(5);
    expect(new Set(titles).size).toBeGreaterThan(2);
    expect(titles).toContain(ABSENT_NTC_TITLE);
    for (const title of titles) expect(title).not.toMatch(/^\s*$/);
  });

  it("…and the same panel under a DEMO stamp still prints no figure it does not have", () => {
    const text = visibleText(markupOf({ ...ALL_ABSENT, ntcProvenance: "DEMO" }))
      .replace("Term 2", "Term")
      .replace("2025/26", "this year");
    expect(text).not.toMatch(/\d/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (2b) ⚠ RED — THE SEXED CPD-POINTS MEAN IS RENDERED AS A PERCENTAGE (AC-14 / C14)
 *
 * `ParityRow` formats EVERY sexed figure with `pctText(rate)` = `rate × 100` + "%". That is right for
 * the four sexed RATES (coverage, participation, threshold rate, category coverage — all 0..1
 * fractions) and WRONG for the fifth sexed metric, `pointsMean`, whose `rate` is points-per-teacher
 * (the reader's own Σcpd_points_total ÷ Σcpd_points_teacher_count). So a mean of 10.18 pts renders in
 * the parity row as "1018.2%", and the gap caption reports a 0.0-"point" gap on the ×100 scale.
 * The headline B1 figure is correct (`formatPoints`); only the sexed sub-figures are not.
 *
 * This is the surfacing honesty bug the slice's own `StatusRate` doc comment predicts ("Σnum ÷ Σden,
 * as a 0..1 fraction") — `pointsMean` is the one field that is not a fraction. It needs a source fix
 * (a unit on `ParityRow`, or points-formatting at the B1 call site), which is NOT this gate's lane, so
 * the test below is left FAILING as the reproduction.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("⚠ RED · the sexed CPD-points mean must read in POINTS, not as a percentage", () => {
  it("the B1 parity row states women's/men's mean in pts — never rate × 100 as a %", async () => {
    const p = okValue(await getTeacherCpd(districtScope, null, P_DEMO_ZERO));
    // The reader's figure is honest: points per teacher, re-derived Σtotal ÷ Σteacher_count.
    expect(p.pointsMean.rate).toBeCloseTo(1120 / 110, 6);
    expect(p.pointsMean.bySex!.female.rate).toBeCloseTo(560 / 55, 6);
    const markup = markupOf(p);
    const parity = markup.slice(markup.indexOf("mean cpd points".replace("cpd", "CPD")));
    const block = parity.slice(0, 2500);
    // The bug: "1018.2%" — a points mean multiplied by 100 and labelled a percentage.
    expect(block, "the sexed points mean is rendered as a percentage").not.toMatch(/\d{3,}(\.\d)?%/);
    // What it should say instead (the B1 headline's own idiom).
    expect(block).toMatch(/10\.18/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (3) THE DEMO SIGNATURE, FROM EACH COLUMN ALONE — AND NOT FROM A DIFFERENT EXTRACT (AC-7)
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("ntcProvenance is the C5(ii) signature, resolved from the three columns only (AC-7)", () => {
  it("a non-null threshold ALONE is the signature", async () => {
    const p = okValue(await getTeacherCpd(districtScope, null, P_SIG_THRESHOLD));
    expect(p.ntcProvenance).toBe("DEMO");
    expect(p.threshold.status).toBe("DEMO");
    // The columns the stand-in did NOT supply stay ABSENT under the same stamp — the switch marks
    // provenance, it does not manufacture figures.
    expect(p.specialised.status).toBe("ABSENT");
    expect(p.recommended.status).toBe("ABSENT");
  });

  it("a non-null Specialised ALONE is the signature", async () => {
    const p = okValue(await getTeacherCpd(districtScope, null, P_SIG_SPECIALISED));
    expect(p.ntcProvenance).toBe("DEMO");
    expect(p.specialised.status).toBe("DEMO");
    expect(p.threshold.status).toBe("ABSENT");
  });

  it("a non-null Recommended ALONE is the signature", async () => {
    const p = okValue(await getTeacherCpd(districtScope, null, P_SIG_RECOMMENDED));
    expect(p.ntcProvenance).toBe("DEMO");
    expect(p.recommended.status).toBe("DEMO");
  });

  it("a row stamped EMIS_EXTRACT is NOT mistaken for the NTC extract (no loose match)", async () => {
    // P_SIG_SPECIALISED's rows carry source = 'EMIS_EXTRACT'. The LIVE branch compares the text to
    // 'NTC_CPD_EXTRACT' exactly, so this scope must still read DEMO — and every chip must stay on.
    const rows = (await owner`
      select distinct source::text as source
        from fact_plc_participation where period_id = ${P_SIG_SPECIALISED}::uuid
    `) as unknown as { source: string }[];
    expect(rows.map((r) => r.source)).toEqual(["EMIS_EXTRACT"]);
    const p = okValue(await getTeacherCpd(districtScope, null, P_SIG_SPECIALISED));
    expect(p.ntcProvenance).toBe("DEMO");
    expect(markupOf(p)).toContain(">DEMO<");
    // …and the comparison really is an equality on the enum's text, not a pattern.
    const code = readCode("lib/oversight/cpd.ts");
    expect(code).toMatch(/source::text = 'NTC_CPD_EXTRACT'/);
    expect(code).not.toMatch(/source::text\s+like/i);
    expect(code).not.toMatch(/source::text\s*(<>|!=)/);
  });

  it("no NTC column anywhere is ABSENT, and the categories are not reconciled", async () => {
    const p = okValue(await getTeacherCpd(districtScope, null, P_NOFEED));
    expect(p.ntcProvenance).toBe("ABSENT");
    expect(p.categoriesReconcile).toBe(false);
    // C7's "stated PLC-only partial": Mandatory is published and UN-chipped, which is the only way
    // the live-no-feed state can be honest about the PLC half it does observe.
    expect(p.mandatory.status).toBe("MEASURED");
    expect(p.mandatory.value).toBe(800);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (4) SUPPRESSION FAILS CLOSED WHEN THE SEXED DENOMINATOR IS MISSING ENTIRELY
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("the sex split fails CLOSED on a NULL denominator, not open", () => {
  it("a scope with an ALL row but no MALE/FEMALE rows publishes no split, and says so", async () => {
    const p = okValue(await getTeacherCpd(districtScope, null, P_NO_SEX_ROWS));
    // Nothing sexed is published — the denominators are unknown, which is not the same as large.
    for (const [name, rate] of [
      ["pointsMean", p.pointsMean],
      ["thresholdRate", p.thresholdRate],
      ["mandatoryCov", p.mandatoryCov],
      ["specialisedCov", p.specialisedCov],
      ["recommendedCov", p.recommendedCov],
    ] as const)
      expect(rate.bySex, name).toBeUndefined();
    // The ALL figures are still published, and the caveat explains the withheld split.
    expect(p.pointsMean.rate).toBeCloseTo(10, 10);
    expect(p.suppressionCaveat).toContain("fewer than 5 teachers");
    expect(visibleText(markupOf(p))).toContain("fewer than 5 teachers");
    // No parity row reached the surface.
    expect(markupOf(p)).not.toContain("parity read");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (5) THE TWO DELIBERATELY-DEFERRED FIELDS ARE HONEST ABSENCES, NOT SILENT GAPS (AC-9/AC-16)
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("plcEarnedPoints (C8) and plcTargetMet (B4) in both data states", () => {
  it("DEMO: both are MEASURED from the observed column, and NEITHER is chipped", async () => {
    const p = okValue(await getTeacherCpd(districtScope, null, P_DEMO_ZERO));
    expect(p.ntcProvenance).toBe("DEMO");
    // School A's observed floor is 300 pts, school B's 120 — read off `plc_earned_points_total`,
    // which is sourced ONLY from the operational PLC aggregate. So it is a real measurement even
    // here, where every NTC category beside it is a stand-in figure.
    expect(p.plcEarnedPoints).toEqual({ status: "MEASURED", value: 420 });
    // NOT the total relabelled: strictly below `pointsTotal` (1,120), i.e. genuinely new information.
    expect(p.pointsTotal.value).toBe(1120);
    expect(p.plcEarnedPoints.value!).toBeLessThan(p.pointsTotal.value!);
    // ⚠ NO DEMO CHIP ON EITHER FIGURE. A chip here would report a measurement as fabricated. The
    // guarantee is structural — `plcValue` has no DEMO arm — and is asserted on the rendered markup.
    const markup = markupOf(p);
    const lineAt = (needle: string): string => {
      const at = markup.indexOf(needle);
      expect(at, `${needle} did not render`).toBeGreaterThan(-1);
      return markup.slice(at, markup.indexOf("</p>", at));
    };
    expect(lineAt("of which PLC-earned")).not.toContain(">DEMO<");
    expect(lineAt("of which PLC-earned")).not.toContain(DEMO_CHIP_TOOLTIP);
    expect(lineAt("met their own PLC target")).not.toContain(">DEMO<");
    expect(lineAt("met their own PLC target")).not.toContain(DEMO_CHIP_TOOLTIP);
    // …and neither carries the old "not stateable / not recorded apart from" excuse any more.
    expect(markup).not.toContain("not recorded apart from");
    expect(markup).not.toContain("Not stateable while CPD points");

    const text = visibleText(markup);
    expect(text).toContain("of which PLC-earned: 420 pts");
    expect(text).not.toContain("of which PLC-earned: —");

    /* ⚠ THE BASIS, PROVED BY THREE DIFFERENT ANSWERS TO ONE QUESTION. Both schools are planted so
     * that the three candidate per-school bases disagree, and the count the panel prints says which
     * one the reader used:
     *                                       school A   school B   →  "N of 2"
     *   PLC pts ÷ PLC earners  (honest)       10.0 ✓     10.0 ✓      2  ← what must render
     *   PLC pts ÷ any-CPD earners (diluted)    6.0 ✗      2.0 ✗      0  ← Dex's blocker
     *   stored cpd_points_mean (all-category) 20.0 ✓      2.0 ✗      1  ← the C13 substitution
     * The diluted denominator understates the mean by spreading PLC points over teachers who earned
     * none, so it reports BOTH schools as missing targets their PLC teachers met. */
    expect(p.plcTargetMet).toEqual({ status: "MEASURED", count: 2, schools: 2 });
    expect(text).toContain("2 of 2 schools met their own PLC target (8 PLC pts)");
    expect(text).not.toContain("1 of 2 schools met their own PLC target");
    expect(text).not.toContain("No school met its own PLC target");
  });

  it("a REAL_ZERO count renders the definite, adverse zero — un-chipped, not an em-dash", async () => {
    // The state the fixture deliberately no longer produces (both schools clear their targets), and
    // the one a diluted denominator WOULD produce — so the render is proved at the figure.
    const zero: TeacherCpdPanel = {
      ...okValue(await getTeacherCpd(districtScope, null, P_DEMO_ZERO)),
      plcTargetMet: { status: "REAL_ZERO", count: 0, schools: 2 },
    };
    const markup = markupOf(zero);
    const text = visibleText(markup);
    expect(text).toContain("No school met its own PLC target (0 of 2) (8 PLC pts)");
    // A measured zero, not an absence and not a stand-in figure: no em-dash title, no chip.
    const line = markup.slice(markup.indexOf("No school met its own PLC target"));
    expect(line.slice(0, 400)).not.toContain(ABSENT_NTC_TITLE);
    expect(line.slice(0, 400)).not.toContain(">DEMO<");
  });

  it("LIVE-no-feed: both are MEASURED on the same PLC-only arithmetic, unchanged", async () => {
    const p = okValue(await getTeacherCpd(districtScope, null, P_NOFEED));
    // With the categories NULL the ETL invariant makes `plc_earned_points_total` equal to
    // `cpd_points_total`, so the subset is that figure — 500 + 300 over the district's two schools.
    expect(p.plcEarnedPoints).toEqual({ status: "MEASURED", value: 800 });
    expect(p.pointsTotal.value).toBe(800);
    // B4's per-ROW predicate on the PLC-earned mean: 500 ÷ 50 = 10 ≥ 8 (met), 300 ÷ 50 = 6 < 8 (not)
    // — and here the PLC earners ARE the any-CPD earners and the PLC points ARE the total, so all
    // three candidate bases coincide. The switch is a no-op in the live-today state, which is why
    // the dilution went unnoticed until the demo state was looked at.
    expect(p.plcTargetMet).toEqual({ status: "MEASURED", count: 1, schools: 2 });
    expect(p.annualPlcTarget).toBe(PLC_TARGET);
    const text = visibleText(markupOf(p));
    expect(text).toContain("of which PLC-earned: 800 pts");
    expect(text).toContain("1 of 2 schools met their own PLC target (8 PLC pts)");
    // …and the target is NEVER summed: two schools × three sex rows each carrying 8 would print 48.
    expect(text).not.toContain("48 PLC pts");
    expect(text).not.toContain("16 PLC pts");
  });

  it("the genuine absence survives: an unmeasurable PLC target is an em-dash, not '0 of 0'", async () => {
    // The ONE state B4 is still withheld in, and it is a REAL absence rather than a deferral. Note
    // there are now TWO ways to reach it — no configured `annual_plc_target`, or no PLC earners to
    // form the mean — and the title must name BOTH, or an officer reads "nobody set a target" when
    // the truth is "nobody here has earned a PLC point yet". Every planted period carries a target,
    // so the claim is made at the figure: a zero DENOMINATOR renders the em-dash with its own
    // reason, never "0 of 0 schools met".
    const absent: TeacherCpdPanel = {
      ...okValue(await getTeacherCpd(districtScope, null, P_DEMO_ZERO)),
      plcTargetMet: { status: "ABSENT", schools: 0 },
    };
    const markup = markupOf(absent);
    expect(markup).toContain(
      'title="No school here has a PLC target that can be measured — none is configured, or none has any PLC-earning teachers yet"',
    );
    const text = visibleText(markup);
    expect(text).not.toContain("0 of 0");
    expect(text).not.toMatch(/\d+ of \d+ schools? met their own PLC target/);
  });

  it("the reader documents WHY the figures are now un-chipped, at the field", () => {
    const code = readCode("lib/oversight/cpd.ts");
    // The honesty claim lives beside the field it governs, so the next editor cannot "tidy" the
    // un-chipped PLC constructor into the NTC one without reading why it is not that.
    const field = code.slice(code.indexOf("plcEarnedPoints: StatusValue") - 1200, code.indexOf("plcEarnedPoints: StatusValue"));
    expect(field).toContain("NEVER CHIPPED");
    expect(field).toContain("plcValue");
    // And the SQL states the PLC-only basis beside the two filters it governs — including WHY the
    // denominator is the PLC earners and not the any-CPD ones, which is the half a reader is most
    // likely to "simplify" back to `cpd_points_teacher_count`.
    expect(code).toMatch(/PLC-EARNED MEAN[\s\S]{0,1500}annual_plc_target/);
    expect(code).toMatch(/plc_earned_teacher_count[\s\S]{0,400}NOT cpd_points_teacher_count/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE PLC-EARNED COLUMNS WHEN THEY ARE NOT POPULATED (Quinn, the 0006 follow-up).
 *
 * Both columns are NULLABLE in DDL and must be — a TERM row carries NULL in both, so "NOT NULL on
 * an ANNUAL row" is not expressible as a constraint, only as `assertPlcInvariants` claims 10 and 11.
 * That makes an ANNUAL NULL unreachable from the ETL and REACHABLE from the database, by two routes
 * the migration and the writer each name:
 *   · migration 0006 lands both columns NULL on every pre-existing row, and only the next PLC ETL
 *     run fills them (the file's own ⚠ "APPLY IT IMMEDIATELY BEFORE A PLC ETL RUN");
 *   · `writePlcFactsTx` deletes and re-inserts ONLY the jurisdictions the run computed, while
 *     `computePerSchool` drops a school whose invariants fail and the run still closes SUCCESS
 *     inside its 1% failure budget — so ONE school can keep a NULL row beside populated neighbours
 *     in an ordinarily successful run, with no migration window involved.
 * Every other fixture in this file and its sibling populates both columns, so this is the only place
 * the reader is observed on the input it was un-withheld INTO.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("the PLC-earned columns unpopulated — the state migration 0006 lands in", () => {
  it("EVERY row NULL · both figures are ABSENT, with no invented zero and no '0 of 0'", async () => {
    // The claim migration 0006 makes in prose ("render as ABSENT … the correct, fail-honest
    // behaviour"), asserted. `plcValue` returns ABSENT on `nonNullRows = 0`, and B4's Y collapses to
    // 0 because the quotient is NULL on every row.
    const p = okValue(await getTeacherCpd(districtScope, null, P_UNRUN));
    expect(p.plcEarnedPoints).toEqual({ status: "ABSENT" });
    expect(p.plcEarnedPoints.value).toBeUndefined();
    expect(p.plcTargetMet).toEqual({ status: "ABSENT", schools: 0 });
    expect(p.plcTargetMet.count).toBeUndefined();
    // ⚠ AND THE REST OF THE PANEL STANDS — the all-category total is still readable, so the two new
    // columns being unpopulated must not take the CPD section down with them.
    expect(p.pointsTotal).toEqual({ status: "MEASURED", value: 700 });
    const text = visibleText(markupOf(p));
    expect(text).toContain("of which PLC-earned: —");
    expect(text).not.toMatch(/of which PLC-earned: [\d,]/);
    expect(text).not.toContain("0 of 0");
    expect(text).not.toMatch(/\d+ of \d+ schools? met their own PLC target/);
    expect(text).not.toContain("No school met its own PLC target");
  });

  it("⚠ HALF the rows NULL · B4's Y narrows to the MEASURABLE schools and says so, N ≤ Y", async () => {
    // School A measurable (500 ÷ 50 = 10.0 ≥ 8, met); school B's row predates the columns. The
    // verdict must cover ONE school and SAY one — "1 of 1", never "1 of 2" (which would assert a
    // school was measured that was not) and never "0 of 2" (which would call it adverse).
    const p = okValue(await getTeacherCpd(districtScope, null, P_PARTIAL));
    expect(p.plcTargetMet).toEqual({ status: "MEASURED", count: 1, schools: 1 });
    expect(p.plcTargetMet.count!).toBeLessThanOrEqual(p.plcTargetMet.schools);
    // Y is the count of MEASURABLE schools, which is strictly below the schools in the subtree —
    // the honest narrowing, because a NULL row cannot be said to have met or missed anything.
    expect(p.annualSchools).toBe(2);
    expect(p.plcTargetMet.schools).toBeLessThan(p.annualSchools);
    const text = visibleText(markupOf(p));
    // `pluralNoun` agrees with Y, so a Y of 1 reads "1 of 1 school".
    expect(text).toContain("1 of 1 school met their own PLC target (8 PLC pts)");
    expect(text).not.toContain("1 of 2 schools met their own PLC target");
    expect(text).not.toContain("0 of 2 schools met their own PLC target");
  });

  it("⚠ HALF the rows NULL · the subset is the Σ of the rows that HAVE it, never a coalesced 0", async () => {
    // ⚠ A KNOWN AND ACCEPTED NARROWING, PINNED SO IT STAYS A DECISION. The subset sums only the
    // non-null rows, so during this window it is school A's 500 against an all-category total of 700
    // that includes school B — i.e. it UNDERSTATES "of which PLC-earned" and the panel carries no
    // caption saying the subset covers fewer schools than the total (the NTC half has one:
    // `ntcSchools` vs `annualSchools`). It is accepted because the alternative is worse in both
    // directions — coalescing school B to 0 would publish a fabricated measurement, and withholding
    // the whole figure whenever ANY school lags would make it unreadable on the 1%-failure path —
    // and because no reconciliation claim is published against it (`categoriesReconcile` covers the
    // three NTC categories only, never this column). If a coverage caption is ever added for it,
    // this is the test that should change.
    const p = okValue(await getTeacherCpd(districtScope, null, P_PARTIAL));
    expect(p.plcEarnedPoints).toEqual({ status: "MEASURED", value: 500 });
    expect(p.pointsTotal).toEqual({ status: "MEASURED", value: 700 });
    // NOT coalesced: school B's unknown split contributes nothing rather than a 0.
    expect(p.plcEarnedPoints.value!).toBeLessThan(p.pointsTotal.value!);
    // …and the figure is NOT chipped even here: a partial measurement is still a measurement.
    expect(p.plcEarnedPoints.status).not.toBe("DEMO");
    expect(p.categoriesReconcile).toBe(false);
  });

  it("ZERO PLC earners · the school leaves BOTH sides of B4, so it is not reported as missing", async () => {
    // `nullif(plc_earned_teacher_count, 0)` makes the quotient NULL, which drops the school from Y as
    // well as from N. The alternative — counting it in Y only — would publish "1 of 2 schools met"
    // and assert that a school with no PLC earners MISSED a target, which is a verdict the data
    // cannot support. Its MEASURED 0.00 points still roll into the subset, because that part IS
    // observed.
    const p = okValue(await getTeacherCpd(districtScope, null, P_ZERO_EARNERS));
    expect(p.plcTargetMet).toEqual({ status: "MEASURED", count: 1, schools: 1 });
    expect(p.plcTargetMet.count!).toBeLessThanOrEqual(p.plcTargetMet.schools);
    expect(p.annualSchools).toBe(2);
    // The 0-earner school contributes its observed 0.00 to the subset and nothing to the verdict.
    expect(p.plcEarnedPoints).toEqual({ status: "MEASURED", value: 500 });
    const text = visibleText(markupOf(p));
    expect(text).toContain("1 of 1 school met their own PLC target");
    expect(text).not.toContain("1 of 2 schools met their own PLC target");
  });

  it("⚠ N ≤ Y ON EVERY PLANTED PERIOD — a school cannot 'meet' a target it was not counted for", async () => {
    // The structural guarantee is that B4's two `count(*) filter`s share one basis and the N filter
    // CONJOINS the target comparison onto Y's exact predicate list, so N's rows are a subset of Y's.
    // Asserted across every data state in the file so that editing the two filters apart — the one
    // change that could break it — fails here rather than in production.
    for (const period of PLANTED) {
      const p = okValue(await getTeacherCpd(districtScope, null, period));
      const { status, count: met, schools } = p.plcTargetMet;
      expect(met ?? 0, `N ≤ Y violated on ${period}`).toBeLessThanOrEqual(schools);
      // And the status/number pairing holds: ABSENT iff Y is 0, and never a number without a Y.
      if (status === "ABSENT") {
        expect(schools, `ABSENT with a non-zero Y on ${period}`).toBe(0);
        expect(met, `ABSENT carrying a count on ${period}`).toBeUndefined();
      } else {
        expect(schools, `a published verdict with Y = 0 on ${period}`).toBeGreaterThan(0);
        expect(met, `a published verdict with no N on ${period}`).not.toBeUndefined();
      }
    }
  });

  it("the two filters share ONE basis, which is what makes N ≤ Y structural (static)", () => {
    // The guarantee above is only as good as the two filters staying coupled: N's `where` must be
    // Y's `where` plus the comparison, on the SAME quotient. Read as text because it is a property
    // of the SQL's shape, not of any one fixture.
    const code = readCode("lib/oversight/cpd.ts");
    const basis =
      /fpp\.annual_plc_target is not null\s*\n\s*and fpp\.plc_earned_points_total\s*\n\s*\/ nullif\(fpp\.plc_earned_teacher_count, 0\) is not null/g;
    // Once for Y, once for N — the N filter re-states Y's predicates verbatim before adding its own.
    expect(code.match(basis)?.length).toBe(2);
    // …and N adds exactly one thing to that basis: the comparison, on the SAME quotient.
    expect(code).toMatch(
      /and fpp\.plc_earned_points_total\s*\n\s*\/ nullif\(fpp\.plc_earned_teacher_count, 0\) >= fpp\.annual_plc_target/,
    );
    // Neither side may reach for the any-CPD denominator or the stored all-category mean. (Matched
    // as `fpp.`-qualified COLUMN references: the module's prose discusses both by name on purpose.)
    expect(code).not.toMatch(/nullif\(fpp\.cpd_points_teacher_count/);
    expect(code).not.toMatch(/fpp\.cpd_points_mean/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (6) AC-21 — THE DEFERRED BREAKDOWN COLUMNS AND COMPARISON ROWS ARE ABSENT, NOT A DASH
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("the deferred C17/C18 surfaces are wholly absent (AC-21, E-CPD-4)", () => {
  it("the breakdown table gained no CPD or PLC column", () => {
    for (const file of [
      "components/oversight/breakdown-visuals.tsx",
      "components/oversight/breakdown-section.tsx",
    ]) {
      const code = readCode(file);
      expect(code, file).not.toMatch(/\bPLC\b/);
      expect(code, file).not.toMatch(/\bCPD\b/);
      expect(code, file).not.toMatch(/cpd[A-Z_]/);
    }
  });

  it("the comparison workspace gained no CPD or PLC row", () => {
    const code = readCode("lib/oversight/comparison.ts");
    expect(code).not.toMatch(/\bPLC\b/);
    expect(code).not.toMatch(/cpd/i);
    expect(code).not.toMatch(/teachers_meeting/);
  });

  it("no CPD figure is ranked anywhere: the panel has no direction and no rank language", async () => {
    const markup = markupOf(okValue(await getTeacherCpd(districtScope, null, P_DEMO_ZERO)));
    // "not a ranking" is the panel's own disclaimer and is expected; what must not appear is any
    // language that CROWNS a figure (C18's ban on ranking demo compliance).
    for (const banned of ["best", "worst", "ranked", "league", "on track", "most compliant"])
      expect(markup.toLowerCase(), banned).not.toContain(banned);
    // Nor a valence colour on a synthetic figure (cpd-tone.ts's documented rule).
    expect(markup).not.toContain("green");
    expect(markup).not.toContain("terra");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * (7) AC-22 — THE PROVENANCE LEDGER HAS ALL THREE STATES, INCLUDING THE LIVE SWAP
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe("the CPD provenance line switches on the one stamp (AC-22)", () => {
  it("the ledger carries a DEMO, an ABSENT and a measured-source LIVE variant", () => {
    const page = readCode("app/(oversight)/page.tsx");
    const ledger = page.slice(page.indexOf('"CPD points (NTC)"'));
    expect(ledger).toContain("ILLUSTRATIVE DEMO figures");
    expect(ledger).toContain("not yet sourced");
    // The LIVE fall-through: the measured-source line, with no demo language in it.
    expect(ledger).toMatch(/sourced from the NTC CPD extract/);
    const live = ledger.slice(ledger.indexOf("sourced from the NTC CPD extract"));
    expect(live.slice(0, 200)).not.toMatch(/DEMO|illustrative/i);
  });

  it("the PLC line is unconditional whenever the panel renders, and states the re-derivation", () => {
    const page = readCode("app/(oversight)/page.tsx");
    const plc = page.slice(page.indexOf('"PLC participation"'));
    expect(plc.slice(0, 1200)).toContain("never an average of school rates");
    // It is NOT gated on the NTC stamp — only on the reading itself.
    const gate = page.slice(page.indexOf("...(isOk(cpd)"), page.indexOf('"PLC participation"'));
    expect(gate).not.toContain("ntcProvenance");
  });
});
