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
 *  5. THE TWO DELIBERATELY-DEFERRED FIELDS (`plcEarnedPoints` C8/AC-9, `plcTargetMet` B4/AC-16).
 *     Returned ABSENT in the DEMO state rather than invented. Proved to be an HONEST absence: absent
 *     with its own explanatory title, carrying NO number, in the demo — and genuinely MEASURED and
 *     arithmetically correct in the live-no-feed state, where the fact table can support them.
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

const PLANTED = [
  P_DEMO_ZERO,
  P_NOFEED,
  P_SIG_THRESHOLD,
  P_SIG_SPECIALISED,
  P_SIG_RECOMMENDED,
  P_NO_SEX_ROWS,
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
       source, as_of_date)
    values
      (${row.school}::uuid, ${row.period}::uuid, ${row.sex}::ov_sex, 1, ${row.headcount},
       ${row.total}, ${row.teacherCount}, ${row.mean},
       ${row.threshold}, ${row.plcTarget}, ${row.ntcTarget},
       ${row.mandatory}, ${row.specialised}, ${row.recommended},
       ${row.mandatoryTeachers}, ${row.specialisedTeachers}, ${row.recommendedTeachers},
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
      (${P_NO_SEX_ROWS}::uuid,      '2015/16', null, 'ANNUAL', false)
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
    ntcTarget: NTC_TARGET,
    plcTarget: PLC_TARGET,
  });
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
  it("DEMO: both are ABSENT with their OWN explanatory titles, and carry no number", async () => {
    const p = okValue(await getTeacherCpd(districtScope, null, P_DEMO_ZERO));
    expect(p.plcEarnedPoints).toEqual({ status: "ABSENT" });
    expect(p.plcTargetMet.status).toBe("ABSENT");
    expect(p.plcTargetMet.count).toBeUndefined();
    const markup = markupOf(p);
    // Each absence states its OWN reason — not the generic NTC-sourcing title, because the reason is
    // different: the figure is unDERIVABLE in this state, not unsourced.
    expect(markup).toContain(
      "PLC-earned points are not recorded apart from the demo NTC top-up in the Mandatory class",
    );
    expect(markup).toContain(
      "Not stateable while CPD points carry the demo NTC top-up — the school&#x27;s own target is PLC-only",
    );
    // And no number was invented beside either label.
    const text = visibleText(markup);
    expect(text).toContain("of which PLC-earned: —");
    expect(text).not.toMatch(/of which PLC-earned: [\d,]/);
    expect(text).not.toMatch(/\d+ of \d+ schools? met their own PLC target/);
  });

  it("LIVE-no-feed: both become MEASURED, and the arithmetic is the PLC-only one", async () => {
    const p = okValue(await getTeacherCpd(districtScope, null, P_NOFEED));
    // C8's fallback: with the categories NULL, `cpd_points_total` IS the PLC-only subtotal, so the
    // subset is that figure — 500 + 300 over the district's two schools.
    expect(p.plcEarnedPoints).toEqual({ status: "MEASURED", value: 800 });
    expect(p.pointsTotal.value).toBe(800);
    // B4 is the per-ROW predicate `cpd_points_mean >= annual_plc_target`: 10 ≥ 8 (met), 6 < 8 (not).
    expect(p.plcTargetMet).toEqual({ status: "MEASURED", count: 1, schools: 2 });
    expect(p.annualPlcTarget).toBe(PLC_TARGET);
    const text = visibleText(markupOf(p));
    expect(text).toContain("of which PLC-earned: 800 pts");
    expect(text).toContain("1 of 2 schools met their own PLC target (8 PLC pts)");
    // …and the target is NEVER summed: two schools × three sex rows each carrying 8 would print 48.
    expect(text).not.toContain("48 PLC pts");
    expect(text).not.toContain("16 PLC pts");
  });

  it("the deferral is documented at the field, so the gap is a decision and not an oversight", () => {
    const code = readCode("lib/oversight/cpd.ts");
    // Both forks are named FORKs in the reader's own doc comments, beside the field they govern.
    const plcEarned = code.slice(code.indexOf("plcEarnedPoints: StatusValue") - 1200);
    expect(plcEarned.slice(0, 1200)).toContain("FORK");
    expect(code).toMatch(/⚠ FORK[\s\S]{0,900}annual_plc_target/);
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
