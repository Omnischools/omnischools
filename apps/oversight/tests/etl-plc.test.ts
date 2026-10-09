import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { adminDemoAnalytics } from "./helpers";
import {
  DEMO_TERMS,
  emisExtractFor,
  generateDemoDataset,
  loadDemoSource,
  makeRng,
  type DemoDataset,
  type DemoNtcCpdRow,
} from "@/scripts/seed-demo-data";
import { runOversightEtl, type EtlRunReport, type PlcOutcome } from "@/lib/etl/pipeline";
import {
  OV_SEXES,
  PlcTransformError,
  assertPlcInvariants,
  buildSchoolPlcRows,
  expectedSessionsFor,
  makePlcRng,
  plcRateOf,
  plcSexShares,
  plcSeed,
  pointsOf,
  splitBySex,
  type FactPlcParticipationRow,
  type OvSex,
  type PlcSchoolSource,
  type PlcTarget,
  type PlcTermInput,
} from "@/lib/etl/plc";
import {
  NTC_CPD_SUMMARY_TABLE,
  readNtcCpdSummaries,
  ntcCpdSourcePresent,
} from "@/lib/etl/ntc-cpd-source";

/**
 * THE SEVENTH FACT ARM — `fact_plc_participation` end-to-end, against Kofi's
 * `CPD-SURFACING-RULING.md` (C1–C9 and the acceptance criteria named on each test).
 *
 * Same posture as the six arms before it: the REAL pipeline runs over the deterministic demo dataset,
 * every fact row is produced by `buildSchoolPlcRows`, and NOTHING HERE HAND-SEEDS A FACT. The NTC
 * stand-in rows are not facts and not columns of one — they are an operational-SHAPED source read
 * through the swappable seam, exactly as `facilities_snapshot` rows are.
 *
 * ⚠ THE HEADLINE ASSERTIONS ARE MADE IN SQL AGAINST THE WRITTEN ROWS, not against the transform's
 * return value: an in-memory assertion would still pass if the writer dropped a column or swapped two
 * of them (there are twenty-five of them here, eight of which are nullable for a REASON).
 *
 * ⚠ THE TWO PROVENANCE STATES ARE BOTH EXERCISED AGAINST THE SAME BUILDER. The demo state (the NTC
 * seam pointed at `demo_ntc_source`) is the `beforeAll` run; the LIVE-TODAY state (the seam pointed at
 * a schema that does not exist) is the LAST describe in this file, because it rewrites every PLC row.
 * That ordering is load-bearing and is restated at the describe itself.
 *
 * ⚠ NOTHING IN THIS FILE READS A TEACHER. `teachers_in_plc` is a count of teachers, never a teacher,
 * and the allow-list test below pins that against `lib/etl/plc-source.ts`'s own text.
 */

let sql: postgres.Sql;
let dataset: DemoDataset;
let report: EtlRunReport;

const CURRENT = DEMO_TERMS.find((t) => t.isCurrent)!;
const ACADEMIC_YEAR = CURRENT.academicYear;
/** The ANNUAL cut's own window — the year's first term's open to its last term's close. */
const YEAR_TERMS = DEMO_TERMS.filter((t) => t.academicYear === CURRENT.academicYear);
const YEAR_STARTS_ON = YEAR_TERMS.map((t) => t.startsOn).sort()[0]!;
const YEAR_ENDS_ON = YEAR_TERMS.map((t) => t.endsOn).sort().at(-1)!;
/** A schema that is not there. THE CLOSED GATE — the state the real product is in today. */
const ABSENT_SCHEMA = "ntc_not_connected";
/** A second schema with the SAME shape, to prove the seam is a seam and not a hard-coded name. */
const LIVE_SHAPED_SCHEMA = "ntc_live_shaped";

interface PlcRow {
  jurisdiction_id: string;
  period_id: string;
  emis_school_id: string;
  academic_year: string;
  term: number | null;
  period_type: string;
  sex: OvSex;
  schools_running_plc_count: number;
  teacher_headcount: number;
  sessions_held: number | null;
  sessions_expected: number | null;
  attendance_events: number | null;
  attendance_expected: number | null;
  plc_participation_rate: string | null;
  teachers_in_plc: number | null;
  cpd_points_total: string | null;
  cpd_points_teacher_count: number | null;
  cpd_points_mean: string | null;
  teachers_meeting_cpd_threshold: number | null;
  annual_plc_target: string | null;
  ntc_cpd_target: string | null;
  cpd_points_mandatory_total: string | null;
  cpd_points_specialised_total: string | null;
  cpd_points_recommended_total: string | null;
  cpd_mandatory_teacher_count: number | null;
  cpd_specialised_teacher_count: number | null;
  cpd_recommended_teacher_count: number | null;
  plc_earned_points_total: string | null;
  plc_earned_teacher_count: number | null;
  source: string;
  as_of_date: string;
  etl_run_id: string;
}

let rows: PlcRow[];
let annualRows: PlcRow[];
let termRows: PlcRow[];
let plc: PlcOutcome;
/** `${emis}\0${sex}` → the NTC stand-in row, for the "populated FROM the source" comparison. */
let ntcBySchoolSex: Map<string, DemoNtcCpdRow>;

function periodsOption() {
  return DEMO_TERMS.map((t) => ({
    academicYear: t.academicYear,
    term: t.term,
    startsOn: t.startsOn,
    endsOn: t.endsOn,
    isCurrent: t.isCurrent,
  }));
}

async function runEtl(over: { ntcSourceSchema?: string } = {}): Promise<EtlRunReport> {
  return runOversightEtl(sql, {
    emisExtractText: JSON.stringify(emisExtractFor(dataset)),
    periods: periodsOption(),
    sourceSchema: "demo_source",
    ...(over.ntcSourceSchema ? { ntcSourceSchema: over.ntcSourceSchema } : {}),
  });
}

/** Every written row, joined out to the register and the period spine so both cuts are assertable. */
async function readPlc(): Promise<PlcRow[]> {
  return sql<PlcRow[]>`
    select fp.jurisdiction_id::text                 as jurisdiction_id,
           fp.period_id::text                       as period_id,
           r.emis_school_id,
           d.academic_year,
           d.term,
           d.period_type::text                      as period_type,
           fp.sex::text                             as sex,
           fp.schools_running_plc_count,
           fp.teacher_headcount,
           fp.sessions_held,
           fp.sessions_expected,
           fp.attendance_events,
           fp.attendance_expected,
           fp.plc_participation_rate::text          as plc_participation_rate,
           fp.teachers_in_plc,
           fp.cpd_points_total::text                as cpd_points_total,
           fp.cpd_points_teacher_count,
           fp.cpd_points_mean::text                 as cpd_points_mean,
           fp.teachers_meeting_cpd_threshold,
           fp.annual_plc_target::text               as annual_plc_target,
           fp.ntc_cpd_target::text                  as ntc_cpd_target,
           fp.cpd_points_mandatory_total::text      as cpd_points_mandatory_total,
           fp.cpd_points_specialised_total::text    as cpd_points_specialised_total,
           fp.cpd_points_recommended_total::text    as cpd_points_recommended_total,
           fp.cpd_mandatory_teacher_count,
           fp.cpd_specialised_teacher_count,
           fp.cpd_recommended_teacher_count,
           fp.plc_earned_points_total::text         as plc_earned_points_total,
           fp.plc_earned_teacher_count,
           fp.source::text                          as source,
           fp.as_of_date::text                      as as_of_date,
           fp.etl_run_id::text                      as etl_run_id
      from fact_plc_participation fp
      join dim_period d        on d.period_id = fp.period_id
      join dim_jurisdiction j  on j.jurisdiction_id = fp.jurisdiction_id
      join ref_emis_school_register r on r.emis_school_id = j.ges_code
     order by r.emis_school_id, d.period_type, d.term nulls first, fp.sex`;
}

function plcOutcomeOf(r: EtlRunReport): PlcOutcome {
  const period = r.periods.find((p) => p.academicYear === ACADEMIC_YEAR);
  expect(period, `the run declares no ANNUAL period for ${ACADEMIC_YEAR}`).toBeTruthy();
  return period!.plc;
}

beforeAll(async () => {
  sql = adminDemoAnalytics();
  dataset = generateDemoDataset();
  await loadDemoSource(sql, dataset);
  // ⚠ THIS FILE OWNS `fact_plc_participation`'S STATE, AND HAS TO SAY SO EXPLICITLY.
  //
  // `oversight_test_demo` is SHARED by every ETL test file and `loadDemoSource` rebuilds only the
  // SOURCE schemas — the fact tables persist across files. Several files (etl-attendance, notably)
  // re-run the pipeline with VARIANT period declarations: edited term dates, different registers. The
  // PLC arm now runs in EVERY pipeline invocation, so those runs write PLC rows at period_ids that
  // this file never declares, and this arm's delete scope is bounded by (period, jurisdiction ∈
  // computed) — deliberately, because that bound is what makes an uncomputed school's rows
  // STALE-BUT-HONEST rather than deleted. Those variant-period rows are therefore not ours to
  // replace, and they would inflate every whole-table assertion below if they survived into it.
  //
  // So the table is emptied HERE, once, before this file's first run. A bounded delete is the right
  // behaviour for the ETL and the wrong basis for a whole-table count in a shared database; the fix
  // belongs in the test, not in the writer. (This file's own runs are deterministic and declare the
  // same periods every time, so it leaves no orphan behind for a later file.)
  await sql`delete from fact_plc_participation`;
  report = await runEtl();
  expect(report.status).toBe("SUCCESS");
  rows = await readPlc();
  annualRows = rows.filter((r) => r.period_type === "ANNUAL");
  termRows = rows.filter((r) => r.period_type === "TERM");
  plc = plcOutcomeOf(report);
  ntcBySchoolSex = new Map(
    dataset.ntcCpd
      .filter((n) => n.academicYear === ACADEMIC_YEAR)
      .map((n) => [`${n.emisSchoolId}\u0000${n.teacherSex}`, n]),
  );
}, 900_000);

afterAll(async () => {
  if (sql) await sql.end({ timeout: 5 });
});

// ── the pure transform, before anything touches the database ─────────────────────────────────────

const FIX_SESSIONS = [
  {
    schoolId: "s",
    plcId: "g1",
    sessionsHeld: 10,
    nonPresentEvents: 8,
    lastSessionDate: "2025-12-05",
  },
];
const FIX_TERM_PERIOD = "0f0f0f0f-0000-4000-8000-0000000000a1";
const FIX_TERM: PlcTermInput = {
  periodId: FIX_TERM_PERIOD,
  term: 1,
  startsOn: "2025-09-15",
  endsOn: "2025-12-19",
  sessions: FIX_SESSIONS,
};
const FIX_ANNUAL_PERIOD = "0f0f0f0f-0000-4000-8000-0000000000ff";

function fixNtcRow(sex: "MALE" | "FEMALE") {
  // Small counts on purpose: every one of them must fit INSIDE that sex's share of a 20-teacher roll,
  // so these tests measure the arithmetic rather than the clamp. The clamp has its own test.
  return {
    emisSchoolId: "GH-FIX-0001",
    academicYear: ACADEMIC_YEAR,
    teacherSex: sex,
    specialisedHundredths: sex === "MALE" ? 1_250 : 975,
    recommendedHundredths: sex === "MALE" ? 400 : 325,
    ncpdHundredths: sex === "MALE" ? 600 : 550,
    mandatoryTeachers: 5,
    specialisedTeachers: 3,
    recommendedTeachers: 2,
    teachersMeetingThreshold: 4,
    cpdTargetHundredths: 2_000,
  } as const;
}

function fixSource(over: Partial<PlcSchoolSource> = {}): PlcSchoolSource {
  return {
    programme: { schoolId: "s", weeksPerSemester: 12, annualPlcTarget: "8.00" },
    groups: [{ schoolId: "s", plcId: "g1", overrideFrequency: null, activeMembers: 12 }],
    distinctMembers: 12,
    annualPoints: {
      schoolId: "s",
      pointsHundredths: 4_000,
      teachersWithPoints: 12,
      lastSettledAt: "2026-06-30 18:00:00+00",
    },
    ntc: {
      emisSchoolId: "GH-FIX-0001",
      academicYear: ACADEMIC_YEAR,
      bySex: { MALE: fixNtcRow("MALE"), FEMALE: fixNtcRow("FEMALE") },
    },
    ...over,
  };
}

/**
 * THE SAME SCHOOL WITH FEWER PLC EARNERS — four, against the NTC stand-in's Mandatory count of five
 * per sex. It is the fixture in which `cpd_points_teacher_count` (the ANY-category earner
 * population) is STRICTLY WIDER than the PLC-earner count, which is the only state where using it
 * as the PLC mean's denominator is visibly wrong. The default fixture's twelve earners already
 * exceed every NTC category count, so there the two collapse onto each other — which is precisely
 * why the diluted denominator shipped unnoticed.
 */
const FEW_EARNERS = {
  annualPoints: {
    schoolId: "s",
    pointsHundredths: 4_000,
    teachersWithPoints: 4,
    lastSettledAt: "2026-06-30 18:00:00+00",
  },
} as const satisfies Partial<PlcSchoolSource>;

function fixTarget(over: Partial<PlcTarget> = {}): PlcTarget {
  return {
    jurisdictionId: "0f0f0f0f-0000-4000-8000-000000000001",
    emisSchoolId: "GH-FIX-0001",
    etlRunId: "0f0f0f0f-0000-4000-8000-000000000002",
    academicYear: ACADEMIC_YEAR,
    annualPeriodId: FIX_ANNUAL_PERIOD,
    annualEndsOn: "2026-07-31",
    teachersOnRoll: 20,
    terms: [FIX_TERM],
    ...over,
  };
}

const annualOf = (built: { rows: FactPlcParticipationRow[] }, sex: OvSex) =>
  built.rows.find((r) => r.periodId === FIX_ANNUAL_PERIOD && r.sex === sex)!;
const termOf = (built: { rows: FactPlcParticipationRow[] }, sex: OvSex) =>
  built.rows.find((r) => r.periodId === FIX_TERM.periodId && r.sex === sex)!;
const h = (literal: string | null): number =>
  literal === null ? Number.NaN : Math.round(Number(literal) * 100);

describe("the generator is the demo's own deterministic PRNG, not Math.random()", () => {
  it("mulberry32 in lib/etl/plc.ts is byte-identical to the demo seed's makeRng", () => {
    // The copy exists because `lib/` must not import `scripts/`. This is what stops the two drifting:
    // a one-character change in either stream re-rolls every sexed PLC figure in the country, silently.
    for (const seed of [0, 1, 42, 0x4845_4d49, 0x504c_4344, 0xffff_ffff]) {
      const a = makeRng(seed);
      const b = makePlcRng(seed);
      for (let i = 0; i < 8; i++) expect(b()).toBe(a());
    }
  });

  it("gives the same school the same seed on every run, and different schools different seeds", () => {
    expect(plcSeed("GH-GA-0001", ACADEMIC_YEAR)).toBe(plcSeed("GH-GA-0001", ACADEMIC_YEAR));
    expect(plcSeed("GH-GA-0001", ACADEMIC_YEAR)).not.toBe(plcSeed("GH-GA-0002", ACADEMIC_YEAR));
    // The academic year is in the seed, so a future multi-year run cannot file identical figures twice.
    expect(plcSeed("GH-GA-0001", "2025/26")).not.toBe(plcSeed("GH-GA-0001", "2026/27"));
  });

  it("the PLC salt is its OWN: the same school's PLC shares do not follow the staffing stream", () => {
    // Not a cryptographic claim — just that the two arms' per-school streams are not the same stream,
    // so re-rolling one arm's demo figures cannot move another arm's bytes.
    const shares = plcSexShares("GH-GA-0001", ACADEMIC_YEAR);
    expect(shares.headPerMille).toBeGreaterThanOrEqual(280);
    expect(shares.headPerMille).toBeLessThanOrEqual(580);
    expect(plcSeed("GH-GA-0001", ACADEMIC_YEAR)).not.toBe(
      // the FNV hash WITHOUT the PLC salt — i.e. what a shared-salt implementation would produce
      (() => {
        let x = 0x811c9dc5;
        for (const ch of `GH-GA-0001\u0000${ACADEMIC_YEAR}`) {
          x ^= ch.codePointAt(0)!;
          x = Math.imul(x, 0x01000193);
        }
        return x >>> 0;
      })(),
    );
  });
});

describe("exact arithmetic: hundredths in, numeric literals out", () => {
  it("splitBySex rounds FEMALE and takes MALE as the remainder, so the two always sum to ALL", () => {
    for (const total of [0, 1, 7, 13, 4_001, 99_999]) {
      for (const share of [0, 1, 333, 500, 501, 999, 1000]) {
        const { male, female } = splitBySex(total, share);
        expect(male + female).toBe(total);
        expect(male).toBeGreaterThanOrEqual(0);
        expect(female).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("caps bound each sex and the remainder is RE-DERIVED, so the sum survives the cap", () => {
    const { male, female } = splitBySex(10, 900, { female: 4, male: 20 });
    expect(female).toBe(4);
    expect(male).toBe(6);
  });

  it("refuses a total that exceeds both caps rather than quietly losing the difference", () => {
    expect(() => splitBySex(10, 500, { female: 3, male: 3 })).toThrow(PlcTransformError);
  });

  it("plcRateOf throws on a zero denominator instead of publishing 0.00", () => {
    // 0.00 reads as "nobody attended"; the truth is "no session was held to attend", which is NULL.
    expect(() => plcRateOf(0, 0)).toThrow(PlcTransformError);
    expect(plcRateOf(112, 120)).toBe("93.33");
    expect(plcRateOf(1, 2)).toBe("50.00");
    expect(plcRateOf(0, 7)).toBe("0.00");
  });

  it("expectedSessionsFor reads the school's OWN cadence and refuses an unknown one", () => {
    expect(expectedSessionsFor(12, null)).toBe(12);
    expect(expectedSessionsFor(12, "WEEKLY")).toBe(12);
    expect(expectedSessionsFor(13, "BIWEEKLY")).toBe(7);
    // A new operational frequency must be a deliberate ETL change, not a silent weekly.
    expect(() => expectedSessionsFor(12, "FORTNIGHTLY")).toThrow(PlcTransformError);
    expect(() => expectedSessionsFor(0, null)).toThrow(PlcTransformError);
  });
});

describe("AC1 · with NO NTC source the NTC columns are NULL, never 0", () => {
  const built = () => buildSchoolPlcRows(fixSource({ ntc: null }), fixTarget());

  it("leaves all five NTC-sourced columns NULL on every sex row of the ANNUAL cut", () => {
    const b = built();
    for (const sex of OV_SEXES) {
      const row = annualOf(b, sex);
      expect(row.cpdPointsSpecialisedTotal).toBeNull();
      expect(row.cpdPointsRecommendedTotal).toBeNull();
      expect(row.cpdSpecialisedTeacherCount).toBeNull();
      expect(row.cpdRecommendedTeacherCount).toBeNull();
      expect(row.teachersMeetingCpdThreshold).toBeNull();
      expect(row.ntcCpdTarget).toBeNull();
      // The negative half of the claim, said explicitly: none of them degraded to a zero.
      expect(row.cpdPointsSpecialisedTotal).not.toBe("0.00");
      expect(row.cpdSpecialisedTeacherCount).not.toBe(0);
      expect(row.teachersMeetingCpdThreshold).not.toBe(0);
    }
  });

  it("still publishes the OBSERVED half — Mandatory, the total, the mean and the school's target", () => {
    const b = built();
    const all = annualOf(b, "ALL");
    // The schema's explicitly permitted PLC-ONLY PARTIAL. Absence of the NTC feed must not cost the
    // product the one CPD figure it genuinely measures.
    expect(all.cpdPointsMandatoryTotal).toBe("40.00");
    expect(all.cpdPointsTotal).toBe("40.00");
    expect(all.cpdMandatoryTeacherCount).toBe(12);
    expect(all.annualPlcTarget).toBe("8.00");
    expect(all.source).toBe("OPERATIONAL_AGG");
  });

  it("AC7 · never produces a non-null CATEGORY column it did not read from a source", () => {
    // The live-today transform's whole obligation: an OPERATIONAL_AGG row may carry Mandatory (it is
    // observed) and must carry NOTHING in the two categories this product cannot see.
    for (const points of [0, 4_000, 100_000]) {
      const b = buildSchoolPlcRows(
        fixSource({
          ntc: null,
          annualPoints: {
            schoolId: "s",
            pointsHundredths: points,
            teachersWithPoints: 12,
            lastSettledAt: "2026-06-30 18:00:00+00",
          },
        }),
        fixTarget(),
      );
      for (const row of b.rows) {
        expect(row.source).toBe("OPERATIONAL_AGG");
        expect(row.cpdPointsSpecialisedTotal).toBeNull();
        expect(row.cpdPointsRecommendedTotal).toBeNull();
      }
    }
  });

  it("a school that earned NOTHING gets a real 0.00, because zero is a measurement", () => {
    const b = buildSchoolPlcRows(fixSource({ ntc: null, annualPoints: null }), fixTarget());
    const all = annualOf(b, "ALL");
    expect(all.cpdPointsTotal).toBe("0.00");
    expect(all.cpdPointsMandatoryTotal).toBe("0.00");
    expect(all.cpdPointsTeacherCount).toBe(0);
    // ... and the MEAN is NULL, because a mean over an empty set is not 0.00.
    expect(all.cpdPointsMean).toBeNull();
  });
});

describe("AC8/AC9 · the Mandatory SPLIT and the reconciliation (C7/C8)", () => {
  it("Mandatory is the OBSERVED PLC floor plus the NCPD topup, and is never below the floor", () => {
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    const male = annualOf(b, "MALE");
    const female = annualOf(b, "FEMALE");
    const all = annualOf(b, "ALL");
    // 4000 observed hundredths, split by the school's own points share; + 600/550 NCPD topup.
    const plcSplit = splitBySex(4_000, plcSexShares("GH-FIX-0001", ACADEMIC_YEAR).pointsPerMille);
    expect(h(male.cpdPointsMandatoryTotal)).toBe(plcSplit.male + 600);
    expect(h(female.cpdPointsMandatoryTotal)).toBe(plcSplit.female + 550);
    expect(h(all.cpdPointsMandatoryTotal)).toBe(4_000 + 1_150);
    // AC8, stated as the inequality the ruling states: the topup can only ADD to the floor.
    expect(h(male.cpdPointsMandatoryTotal)).toBeGreaterThanOrEqual(plcSplit.male);
    expect(h(female.cpdPointsMandatoryTotal)).toBeGreaterThanOrEqual(plcSplit.female);
    expect(h(all.cpdPointsMandatoryTotal)).toBeGreaterThanOrEqual(4_000);
  });

  it("a zero NCPD topup leaves Mandatory EQUAL to the floor — the boundary of the same claim", () => {
    const ntcRow = (sex: "MALE" | "FEMALE") => ({ ...fixNtcRow(sex), ncpdHundredths: 0 });
    const b = buildSchoolPlcRows(
      fixSource({
        ntc: {
          emisSchoolId: "GH-FIX-0001",
          academicYear: ACADEMIC_YEAR,
          bySex: { MALE: ntcRow("MALE"), FEMALE: ntcRow("FEMALE") },
        },
      }),
      fixTarget(),
    );
    expect(h(annualOf(b, "ALL").cpdPointsMandatoryTotal)).toBe(4_000);
  });

  it("AC9 · mandatory + specialised + recommended = cpd_points_total, EXACTLY, on every sex row", () => {
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    for (const sex of OV_SEXES) {
      const row = annualOf(b, sex);
      expect(
        h(row.cpdPointsMandatoryTotal) +
          h(row.cpdPointsSpecialisedTotal) +
          h(row.cpdPointsRecommendedTotal),
      ).toBe(h(row.cpdPointsTotal));
    }
  });

  it("AC9 · the FALLBACK: with the gate closed the total is the PLC-only subtotal, not a 2-term sum", () => {
    const b = buildSchoolPlcRows(fixSource({ ntc: null }), fixTarget());
    for (const sex of OV_SEXES) {
      const row = annualOf(b, sex);
      expect(row.cpdPointsTotal).toBe(row.cpdPointsMandatoryTotal);
      // And the identity is NOT asserted of three terms, because two of them do not exist.
      expect(row.cpdPointsSpecialisedTotal).toBeNull();
    }
  });

  it("refuses an extract that states two different statutory targets for one school", () => {
    expect(() =>
      buildSchoolPlcRows(
        fixSource({
          ntc: {
            emisSchoolId: "GH-FIX-0001",
            academicYear: ACADEMIC_YEAR,
            bySex: {
              MALE: fixNtcRow("MALE"),
              FEMALE: { ...fixNtcRow("FEMALE"), cpdTargetHundredths: 1_800 },
            },
          },
        }),
        fixTarget(),
      ),
    ).toThrow(/national POLICY VARIABLE/);
  });
});

/**
 * `plc_earned_points_total` — the OBSERVED PLC floor, carried out of the Mandatory fold so "of which
 * PLC-earned: X" is readable in BOTH data states. Every claim here is about HONESTY of provenance,
 * not arithmetic: the figure must be the operational one in the demo state too, must survive the
 * fold into Mandatory, and must be a MEASURED 0.00 rather than a NULL when a school earned nothing.
 */
describe("plc_earned_points_total · the observed PLC floor, kept separable (C8)", () => {
  it("is written on the ANNUAL rows and NULL on every TERM row", () => {
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    for (const sex of OV_SEXES) {
      expect(annualOf(b, sex).plcEarnedPointsTotal).not.toBeNull();
      // NULL on a TERM row, not 0.00 — the CPD ledger settles per YEAR, so a term figure would be a
      // measurement of a window nothing was measured over.
      expect(termOf(b, sex).plcEarnedPointsTotal).toBeNull();
    }
    expect(annualOf(b, "ALL").plcEarnedPointsTotal).toBe("40.00");
  });

  it("CATEGORIES ABSENT · equals cpd_points_total on every sex row", () => {
    const b = buildSchoolPlcRows(fixSource({ ntc: null }), fixTarget());
    for (const sex of OV_SEXES) {
      const row = annualOf(b, sex);
      expect(row.plcEarnedPointsTotal).toBe(row.cpdPointsTotal);
      // There the total IS the PLC subtotal, so it also coincides with the Mandatory partial.
      expect(row.plcEarnedPointsTotal).toBe(row.cpdPointsMandatoryTotal);
    }
  });

  it("CATEGORIES POPULATED · is <= cpd_points_mandatory_total and < cpd_points_total", () => {
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    for (const sex of OV_SEXES) {
      const row = annualOf(b, sex);
      expect(h(row.plcEarnedPointsTotal)).toBeLessThanOrEqual(h(row.cpdPointsMandatoryTotal));
      // And it is STRICTLY below the all-category total here (the fixture has a non-zero NCPD topup
      // plus two sourced categories), which is the whole reason the column has to exist: the figure
      // is not recoverable from cpd_points_total once the categories are populated.
      expect(h(row.plcEarnedPointsTotal)).toBeLessThan(h(row.cpdPointsTotal));
    }
  });

  it("⚠ is the OPERATIONAL figure even in the demo state — never a slice of the NTC stand-in", () => {
    // The same 4_000 observed hundredths, split by the school's own points share. IDENTICAL whether
    // the NTC stand-in is present or absent: this is the claim that would break first if the build
    // ever started sourcing the column from `demo_ntc_source`.
    const plcSplit = splitBySex(4_000, plcSexShares("GH-FIX-0001", ACADEMIC_YEAR).pointsPerMille);
    const sourced = buildSchoolPlcRows(fixSource(), fixTarget());
    const unsourced = buildSchoolPlcRows(fixSource({ ntc: null }), fixTarget());
    for (const b of [sourced, unsourced]) {
      expect(h(annualOf(b, "MALE").plcEarnedPointsTotal)).toBe(plcSplit.male);
      expect(h(annualOf(b, "FEMALE").plcEarnedPointsTotal)).toBe(plcSplit.female);
      expect(h(annualOf(b, "ALL").plcEarnedPointsTotal)).toBe(4_000);
    }
    // Said as the equality between the two states, so a future demo-only path cannot pass this file.
    for (const sex of OV_SEXES)
      expect(annualOf(sourced, sex).plcEarnedPointsTotal).toBe(
        annualOf(unsourced, sex).plcEarnedPointsTotal,
      );
    // Meanwhile the all-category total DOES differ between the states — which proves the fixture
    // actually exercises both and that the equality above is not comparing two identical runs.
    expect(annualOf(sourced, "ALL").cpdPointsTotal).not.toBe(
      annualOf(unsourced, "ALL").cpdPointsTotal,
    );
  });

  it("⚠ is NOT under the NULL-never-0 gate: a school that earned nothing stores a MEASURED 0.00", () => {
    // BOTH data states, because the gate is what differs between them and this column ignores it.
    for (const over of [{ ntc: null, annualPoints: null }, { annualPoints: null }] as const) {
      const b = buildSchoolPlcRows(fixSource(over), fixTarget());
      for (const sex of OV_SEXES) {
        expect(annualOf(b, sex).plcEarnedPointsTotal).toBe("0.00");
        expect(annualOf(b, sex).plcEarnedPointsTotal).not.toBeNull();
      }
    }
  });

  it("rolls up as a SUM: MALE + FEMALE = ALL, exactly, in both data states", () => {
    for (const b of [
      buildSchoolPlcRows(fixSource(), fixTarget()),
      buildSchoolPlcRows(fixSource({ ntc: null }), fixTarget()),
    ]) {
      expect(
        h(annualOf(b, "MALE").plcEarnedPointsTotal) +
          h(annualOf(b, "FEMALE").plcEarnedPointsTotal),
      ).toBe(h(annualOf(b, "ALL").plcEarnedPointsTotal));
    }
  });

  it("the PLC-earned MEAN — the honest basis for 'met their own PLC target' — is NOT the all-category mean", () => {
    // ⚠ THE BASIS CLAIM, asserted on the DATA the reader divides rather than in the reader (the
    // comparison itself is a read-side aggregate in lib/oversight/cpd.ts). The school's own
    // annual_plc_target is PLC-ONLY, so the mean it is compared against must be PLC-only too.
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    const all = annualOf(b, "ALL");
    const denominator = all.cpdPointsTeacherCount!;
    const plcMean = h(all.plcEarnedPointsTotal) / denominator;
    const allCategoryMean = h(all.cpdPointsTotal) / denominator;
    expect(plcMean).toBeLessThan(allCategoryMean);
    // THE SIZE OF THE DISHONESTY, in the unit the target is set in: the all-category basis credits
    // this school with over a POINT per teacher that its PLC provision never earned. Any
    // annual_plc_target in that band flips the verdict from "missed" to "met" — which is exactly
    // the false "N of Y schools met their own PLC target" the deferred field was deferred over.
    expect(allCategoryMean - plcMean).toBeGreaterThan(100);
    // The target itself is the school's OWN PLC-only figure, unchanged by any of this.
    expect(all.annualPlcTarget).toBe("8.00");
    // In the categories-ABSENT state the two bases COINCIDE — which is why the all-category basis
    // went unnoticed, and why switching the reader to this one changes nothing there.
    const absent = annualOf(buildSchoolPlcRows(fixSource({ ntc: null }), fixTarget()), "ALL");
    expect(absent.plcEarnedPointsTotal).toBe(absent.cpdPointsTotal);
  });

  it("refuses a row whose PLC-earned figure is not the observed floor", () => {
    // The invariant has to be the thing that fails, not the INSERT. Reached by hand-corrupting a
    // built row, because no source input can produce this state.
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    const corrupt = {
      ...b,
      rows: b.rows.map((r) =>
        r.periodId === FIX_ANNUAL_PERIOD && r.sex === "ALL"
          ? { ...r, plcEarnedPointsTotal: "999.00" }
          : r,
      ),
    };
    expect(() => assertPlcInvariants(corrupt, invariantContextFixture())).toThrow(
      /operational PLC aggregate and NOTHING ELSE/,
    );
  });

  it("refuses a NULL on an ANNUAL row — an absence here is an ETL defect, not a measurement", () => {
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    const corrupt = {
      ...b,
      rows: b.rows.map((r) =>
        r.periodId === FIX_ANNUAL_PERIOD && r.sex === "MALE"
          ? { ...r, plcEarnedPointsTotal: null }
          : r,
      ),
    };
    expect(() => assertPlcInvariants(corrupt, invariantContextFixture())).toThrow(
      /NOT under the NULL-never-0 sourcing gate/,
    );
  });
});

/**
 * `plc_earned_teacher_count` — THE OTHER HALF OF THE PLC-EARNED MEAN. A PLC-only numerator over
 * `cpd_points_teacher_count` is not a PLC mean: that count is the ANY-category earner population, so
 * the division spreads PLC points across teachers who earned none — and it does so ONLY while the
 * NTC categories are populated, i.e. the figure would move on whether a feed exists. These tests
 * pin the denominator to the same operational aggregate the numerator comes from.
 */
describe("plc_earned_teacher_count · the PLC-earned mean's own denominator (C8)", () => {
  it("is written on the ANNUAL rows and NULL on every TERM row", () => {
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    for (const sex of OV_SEXES) {
      expect(annualOf(b, sex).plcEarnedTeacherCount).not.toBeNull();
      expect(termOf(b, sex).plcEarnedTeacherCount).toBeNull();
    }
    // The fixture's 12 PLC earners, as the operational aggregate reports them.
    expect(annualOf(b, "ALL").plcEarnedTeacherCount).toBe(12);
  });

  it("CATEGORIES ABSENT · equals cpd_points_teacher_count — the same people", () => {
    // There the only CPD points anybody can have earned ARE PLC points, so the two populations
    // coincide. This is what makes the reader's switch of denominator a NO-OP in the live-today
    // state: nothing on the current product's dashboards changes value.
    const b = buildSchoolPlcRows(fixSource({ ntc: null }), fixTarget());
    for (const sex of OV_SEXES) {
      const row = annualOf(b, sex);
      expect(row.plcEarnedTeacherCount).toBe(row.cpdPointsTeacherCount);
    }
  });

  it("⚠ CATEGORIES POPULATED · is STRICTLY below cpd_points_teacher_count — the bug this fixes", () => {
    // THE WHOLE POINT, on a school whose NTC categories reach MORE teachers than its PLC does (four
    // PLC earners against an NTC Mandatory count of five per sex). The default fixture has 12 PLC
    // earners, which already EXCEEDS every NTC category count, so there the any-CPD denominator
    // collapses onto the PLC one and the defect is invisible — which is exactly why it shipped.
    const b = buildSchoolPlcRows(fixSource(FEW_EARNERS), fixTarget());
    const all = annualOf(b, "ALL");
    expect(all.plcEarnedTeacherCount).toBe(4);
    expect(all.plcEarnedTeacherCount!).toBeLessThan(all.cpdPointsTeacherCount!);
    // And the two means genuinely differ: dividing the SAME PLC points by the wider denominator
    // UNDERSTATES the PLC mean, which is what could report a school as missing a target it met.
    const honest = h(all.plcEarnedPointsTotal) / all.plcEarnedTeacherCount!;
    const diluted = h(all.plcEarnedPointsTotal) / all.cpdPointsTeacherCount!;
    expect(diluted).toBeLessThan(honest);
    // Against this school's own 8.00 PLC target the verdict actually FLIPS — met on the honest
    // basis, missed on the diluted one. That flip IS the B4 defect, in one assertion.
    const target = h(all.annualPlcTarget);
    expect(honest).toBeGreaterThanOrEqual(target);
    expect(diluted).toBeLessThan(target);
  });

  it("is a SUBSET of cpd_points_teacher_count on every sex row, in both data states", () => {
    for (const b of [
      buildSchoolPlcRows(fixSource(), fixTarget()),
      buildSchoolPlcRows(fixSource({ ntc: null }), fixTarget()),
    ])
      for (const sex of OV_SEXES) {
        const row = annualOf(b, sex);
        // Every PLC point IS a CPD point, so a PLC earner is always an any-CPD earner.
        expect(row.plcEarnedTeacherCount!).toBeLessThanOrEqual(row.cpdPointsTeacherCount!);
      }
  });

  it("⚠ is the OPERATIONAL count in BOTH states — never the NTC stand-in's category counts", () => {
    // Same FEW_EARNERS school, because it is the one where cpd_points_teacher_count DOES move
    // between the states — so the equality below is a real claim rather than two identical runs.
    const sourced = buildSchoolPlcRows(fixSource(FEW_EARNERS), fixTarget());
    const unsourced = buildSchoolPlcRows(
      fixSource({ ...FEW_EARNERS, ntc: null }),
      fixTarget(),
    );
    for (const sex of OV_SEXES)
      expect(annualOf(sourced, sex).plcEarnedTeacherCount).toBe(
        annualOf(unsourced, sex).plcEarnedTeacherCount,
      );
    // Meanwhile cpd_points_teacher_count DOES move between the states — the negative control, and
    // the reason it cannot be the PLC mean's denominator: the denominator would move with the feed.
    expect(annualOf(sourced, "ALL").cpdPointsTeacherCount).not.toBe(
      annualOf(unsourced, "ALL").cpdPointsTeacherCount,
    );
    expect(annualOf(sourced, "ALL").plcEarnedTeacherCount).toBe(4);
  });

  it("⚠ is NOT under the NULL-never-0 gate: a school where nobody earned stores a MEASURED 0", () => {
    for (const over of [{ ntc: null, annualPoints: null }, { annualPoints: null }] as const) {
      const b = buildSchoolPlcRows(fixSource(over), fixTarget());
      for (const sex of OV_SEXES) {
        expect(annualOf(b, sex).plcEarnedTeacherCount).toBe(0);
        expect(annualOf(b, sex).plcEarnedTeacherCount).not.toBeNull();
      }
    }
  });

  it("rolls up as a SUM: MALE + FEMALE = ALL, exactly, in both data states", () => {
    for (const b of [
      buildSchoolPlcRows(fixSource(), fixTarget()),
      buildSchoolPlcRows(fixSource({ ntc: null }), fixTarget()),
    ])
      expect(
        annualOf(b, "MALE").plcEarnedTeacherCount! +
          annualOf(b, "FEMALE").plcEarnedTeacherCount!,
      ).toBe(annualOf(b, "ALL").plcEarnedTeacherCount);
  });

  it("refuses a count that is not the observed PLC-earner count", () => {
    // ⚠ CORRUPTED TO EXACTLY THE WRONG COLUMN — cpd_points_teacher_count, the mistake under review
    // — on the FEW_EARNERS school, where the two genuinely differ. The invariant must catch the
    // PLAUSIBLE substitution, not only an absurd value.
    const b = buildSchoolPlcRows(fixSource(FEW_EARNERS), fixTarget());
    const corrupt = {
      ...b,
      rows: b.rows.map((r) =>
        r.periodId === FIX_ANNUAL_PERIOD && r.sex === "ALL"
          ? { ...r, plcEarnedTeacherCount: r.cpdPointsTeacherCount }
          : r,
      ),
    };
    expect(() => assertPlcInvariants(corrupt, invariantContextFixture(4))).toThrow(
      /OBSERVED PLC earners are/,
    );
  });

  it("refuses a NULL on an ANNUAL row — an absence here is an ETL defect, not a measurement", () => {
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    const corrupt = {
      ...b,
      rows: b.rows.map((r) =>
        r.periodId === FIX_ANNUAL_PERIOD && r.sex === "FEMALE"
          ? { ...r, plcEarnedTeacherCount: null }
          : r,
      ),
    };
    expect(() => assertPlcInvariants(corrupt, invariantContextFixture())).toThrow(
      /it is OUTSIDE the NULL-never-0 gate/,
    );
  });
});

/**
 * The fixture's observed PLC figures per sex — the `floor` and the earner count the invariants are
 * checked against (claims 6, 7, 10 and 11). Mirrors the transform's own splits exactly, which is
 * what makes the hand-corrupted rows below fail on the CLAIM rather than on a mismatched fixture.
 */
function invariantContextFixture(earners = 12): {
  emisSchoolId: string;
  plcPointsOf: Record<OvSex, number>;
  plcTeachersOf: Record<OvSex, number>;
  annualPeriodId: string;
} {
  const shares = plcSexShares("GH-FIX-0001", ACADEMIC_YEAR);
  const points = splitBySex(4_000, shares.pointsPerMille);
  const head = splitBySex(20, shares.headPerMille);
  const teachers = splitBySex(earners, shares.pointsPerMille, {
    female: head.female,
    male: head.male,
  });
  return {
    emisSchoolId: "GH-FIX-0001",
    plcPointsOf: { MALE: points.male, FEMALE: points.female, ALL: 4_000 },
    plcTeachersOf: {
      MALE: teachers.male,
      FEMALE: teachers.female,
      ALL: teachers.male + teachers.female,
    },
    annualPeriodId: FIX_ANNUAL_PERIOD,
  };
}

describe("AC14 · every rate divides the denominator the schema names", () => {
  it("cpd_points_mean divides by cpd_points_teacher_count, NOT by teacher_headcount", () => {
    const b = buildSchoolPlcRows(fixSource({ ntc: null }), fixTarget());
    const all = annualOf(b, "ALL");
    expect(all.cpdPointsTeacherCount).toBe(12);
    expect(all.cpdPointsMean).toBe("3.33"); // 40.00 ÷ 12 — not ÷ 20, the roll
    // The negative assertion: the roll WOULD give a different number, so this test is sensitive to
    // the substitution it exists to catch.
    expect(all.cpdPointsMean).not.toBe("2.00");
    expect(all.teacherHeadcount).toBe(20);
  });

  it("the mean is NULL — not 0.00 — when nobody earned anything", () => {
    const b = buildSchoolPlcRows(fixSource({ ntc: null, annualPoints: null }), fixTarget());
    expect(annualOf(b, "ALL").cpdPointsMean).toBeNull();
  });

  it("plc_participation_rate is re-derived from the row's OWN two counts", () => {
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    for (const sex of OV_SEXES) {
      const row = termOf(b, sex);
      expect(row.attendanceExpected).not.toBeNull();
      if (row.attendanceExpected! > 0)
        expect(row.plcParticipationRate).toBe(
          plcRateOf(row.attendanceEvents!, row.attendanceExpected!),
        );
      else expect(row.plcParticipationRate).toBeNull();
    }
    // The ALL row: 12 members × 10 sessions = 120 expected, minus 8 non-present = 112 events.
    expect(termOf(b, "ALL").attendanceExpected).toBe(120);
    expect(termOf(b, "ALL").attendanceEvents).toBe(112);
    expect(termOf(b, "ALL").plcParticipationRate).toBe("93.33");
  });

  it("sessions_expected is NULL — not 0 — for a school that configured no programme", () => {
    const b = buildSchoolPlcRows(fixSource({ programme: null }), fixTarget());
    expect(termOf(b, "ALL").sessionsExpected).toBeNull();
    expect(termOf(b, "ALL").sessionsHeld).toBe(10); // held is still MEASURED
    expect(annualOf(b, "ALL").annualPlcTarget).toBeNull(); // and no target is invented either
  });

  it("the sexed rates genuinely DIFFER, which is what the parity frame reads", () => {
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    expect(termOf(b, "MALE").plcParticipationRate).not.toBe(
      termOf(b, "FEMALE").plcParticipationRate,
    );
    // ... and neither exceeds 100%, because each sex's events are bounded by its own expectation.
    for (const sex of ["MALE", "FEMALE"] as const)
      expect(Number(termOf(b, sex).plcParticipationRate)).toBeLessThanOrEqual(100);
  });
});

describe("AC15/AC17 · the sex rows roll up, and the sex-invariant ones are REPEATED", () => {
  const SEX_INVARIANT = [
    "schoolsRunningPlcCount",
    "sessionsHeld",
    "sessionsExpected",
    "annualPlcTarget",
    "ntcCpdTarget",
  ] as const;

  it("AC15 · a sex-invariant column carries the IDENTICAL value on all three rows", () => {
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    for (const periodId of [FIX_TERM.periodId, FIX_ANNUAL_PERIOD]) {
      const group = b.rows.filter((r) => r.periodId === periodId);
      expect(group).toHaveLength(3);
      for (const column of SEX_INVARIANT) {
        const values = new Set(group.map((r) => JSON.stringify(r[column] ?? null)));
        expect(values.size, `${column} is not repeated identically`).toBe(1);
      }
    }
  });

  it("AC15 · so summing a sex-invariant column across the three rows would be exactly 2× the truth", () => {
    // Said as an arithmetic fact rather than a prohibition, so the next reader sees the size of the
    // mistake: the ALL row is stored BESIDE the split, so ALL + MALE + FEMALE = 2 × ALL.
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    const group = b.rows.filter((r) => r.periodId === FIX_TERM.periodId);
    expect(group.reduce((t, r) => t + (r.sessionsHeld ?? 0), 0)).toBe(
      3 * termOf(b, "ALL").sessionsHeld!,
    );
    expect(termOf(b, "MALE").sessionsHeld).toBe(termOf(b, "ALL").sessionsHeld);
  });

  it("AC17 · every ADDITIVE column satisfies MALE + FEMALE = ALL, exactly", () => {
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    const counts = [
      "teacherHeadcount",
      "attendanceEvents",
      "attendanceExpected",
      "teachersInPlc",
      "cpdPointsTeacherCount",
      // Additive exactly like the any-CPD count beside it — the PLC mean's denominator has to roll
      // up or a district's "met their own PLC target" would divide by the wrong population.
      "plcEarnedTeacherCount",
      "teachersMeetingCpdThreshold",
      "cpdMandatoryTeacherCount",
      "cpdSpecialisedTeacherCount",
      "cpdRecommendedTeacherCount",
    ] as const;
    const money = [
      "cpdPointsTotal",
      "cpdPointsMandatoryTotal",
      "cpdPointsSpecialisedTotal",
      "cpdPointsRecommendedTotal",
      // The PLC-earned subtotal is additive exactly like the other point totals — it is SUMMED from
      // the split, never re-derived, which is what lets a district's "of which PLC-earned" be read.
      "plcEarnedPointsTotal",
    ] as const;
    for (const periodId of [FIX_TERM.periodId, FIX_ANNUAL_PERIOD]) {
      const male = b.rows.find((r) => r.periodId === periodId && r.sex === "MALE")!;
      const female = b.rows.find((r) => r.periodId === periodId && r.sex === "FEMALE")!;
      const all = b.rows.find((r) => r.periodId === periodId && r.sex === "ALL")!;
      for (const column of counts) {
        if (all[column] === null) {
          expect(male[column]).toBeNull();
          expect(female[column]).toBeNull();
          continue;
        }
        expect(male[column]! + female[column]!, `${column} does not roll up`).toBe(all[column]);
      }
      for (const column of money) {
        if (all[column] === null) {
          expect(male[column]).toBeNull();
          expect(female[column]).toBeNull();
          continue;
        }
        expect(h(male[column]) + h(female[column]), `${column} does not roll up`).toBe(
          h(all[column]),
        );
      }
    }
  });

  it("AC17 · the three CATEGORY teacher counts OVERLAP, so they are never summed to each other", () => {
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    const all = annualOf(b, "ALL");
    const sumOfThree =
      all.cpdMandatoryTeacherCount! +
      all.cpdSpecialisedTeacherCount! +
      all.cpdRecommendedTeacherCount!;
    // Their SUM exceeds the mean's denominator — which is the proof that they overlap and that the
    // denominator is NOT their sum. Each of them is still bounded by the roll.
    expect(sumOfThree).toBeGreaterThan(all.cpdPointsTeacherCount!);
    for (const c of [
      all.cpdMandatoryTeacherCount!,
      all.cpdSpecialisedTeacherCount!,
      all.cpdRecommendedTeacherCount!,
    ])
      expect(c).toBeLessThanOrEqual(all.teacherHeadcount);
    // And the denominator is at least the largest of them: the tightest figure counts permit.
    expect(all.cpdPointsTeacherCount!).toBeGreaterThanOrEqual(
      Math.max(
        all.cpdMandatoryTeacherCount!,
        all.cpdSpecialisedTeacherCount!,
        all.cpdRecommendedTeacherCount!,
      ),
    );
  });

  it("a COVERED school's missing sex row contributes ZERO, and never a half-populated ALL", () => {
    const b = buildSchoolPlcRows(
      fixSource({
        ntc: {
          emisSchoolId: "GH-FIX-0001",
          academicYear: ACADEMIC_YEAR,
          bySex: { FEMALE: fixNtcRow("FEMALE") },
        },
      }),
      fixTarget(),
    );
    expect(annualOf(b, "MALE").cpdPointsSpecialisedTotal).toBe("0.00");
    expect(annualOf(b, "FEMALE").cpdPointsSpecialisedTotal).toBe("9.75");
    expect(annualOf(b, "ALL").cpdPointsSpecialisedTotal).toBe("9.75");
    // The gate is per SCHOOL: a covered school has NO null NTC column anywhere in its three rows.
    for (const sex of OV_SEXES) expect(annualOf(b, sex).ntcCpdTarget).toBe("20.00");
  });
});

describe("teacher_headcount is on BOTH cuts and is PINNED to fact_staffing.teachers_on_roll", () => {
  it("the ALL row carries the pinned roll at the ANNUAL cut AND at every TERM cut", () => {
    const b = buildSchoolPlcRows(fixSource(), fixTarget({ teachersOnRoll: 37 }));
    for (const row of b.rows.filter((r) => r.sex === "ALL")) expect(row.teacherHeadcount).toBe(37);
    // Both cuts are actually present, so the loop above is not vacuously satisfied by one of them.
    expect(new Set(b.rows.map((r) => r.periodId)).size).toBe(2);
  });

  it("the two cuts use the SAME sex split of the SAME roll", () => {
    const b = buildSchoolPlcRows(fixSource(), fixTarget({ teachersOnRoll: 37 }));
    for (const sex of OV_SEXES)
      expect(termOf(b, sex).teacherHeadcount).toBe(annualOf(b, sex).teacherHeadcount);
  });

  it("refuses a school whose pin did not resolve, rather than publishing a rate with no denominator", () => {
    expect(() => buildSchoolPlcRows(fixSource(), fixTarget({ teachersOnRoll: -1 }))).toThrow(
      PlcTransformError,
    );
  });

  it("an NTC count above this warehouse's own roll is CLAMPED to it and the clamp is REPORTED", () => {
    const over = (sex: "MALE" | "FEMALE") => ({
      ...fixNtcRow(sex),
      teachersMeetingThreshold: 999,
    });
    const b = buildSchoolPlcRows(
      fixSource({
        ntc: {
          emisSchoolId: "GH-FIX-0001",
          academicYear: ACADEMIC_YEAR,
          bySex: { MALE: over("MALE"), FEMALE: over("FEMALE") },
        },
      }),
      fixTarget(),
    );
    expect(b.ntcCountsClamped).toBeGreaterThan(0);
    for (const sex of OV_SEXES) {
      const row = annualOf(b, sex);
      // The schema's own single-row invariant, which only exists because the headcount is on both cuts.
      expect(row.teachersMeetingCpdThreshold!).toBeLessThanOrEqual(row.teacherHeadcount);
    }
    expect(annualOf(b, "ALL").teachersMeetingCpdThreshold).toBe(fixTarget().teachersOnRoll);
  });
});

describe("a school that runs NO PLC is a MEASUREMENT, not an absence", () => {
  it("writes real rows with schools_running_plc_count = 0", () => {
    const b = buildSchoolPlcRows(
      fixSource({ groups: [], distinctMembers: 0, annualPoints: null }),
      fixTarget({ terms: [{ ...FIX_TERM, sessions: [] }] }),
    );
    expect(b.runsPlc).toBe(false);
    expect(b.rows).toHaveLength(6);
    for (const row of b.rows) expect(row.schoolsRunningPlcCount).toBe(0);
    // Its own session expectation is 0 — it HAS a programme row, so the denominator exists and is zero.
    expect(termOf(b, "ALL").sessionsExpected).toBe(0);
    expect(termOf(b, "ALL").attendanceExpected).toBe(0);
    // ... and with no denominator there is no rate. NULL, not 0.00.
    expect(termOf(b, "ALL").plcParticipationRate).toBeNull();
  });

  it("sessions of an ARCHIVED PLC are counted in NO fact column, and are not silently dropped", () => {
    const b = buildSchoolPlcRows(
      fixSource({ groups: [], distinctMembers: 0 }),
      fixTarget({ terms: [FIX_TERM] }),
    );
    expect(termOf(b, "ALL").sessionsHeld).toBe(0);
    expect(b.terms[0]!.orphanSessions).toBe(10);
  });
});

describe("the as_of_date is a DATA vintage, never now()", () => {
  it("the TERM row stamps its latest session, the ANNUAL row its latest settled award", () => {
    const b = buildSchoolPlcRows(fixSource(), fixTarget());
    expect(termOf(b, "ALL").asOfDate).toBe("2025-12-05");
    expect(annualOf(b, "ALL").asOfDate).toBe("2026-06-30 18:00:00+00");
  });

  it("falls back to the period's own close when the school held nothing / earned nothing", () => {
    const b = buildSchoolPlcRows(
      fixSource({ groups: [], distinctMembers: 0, annualPoints: null }),
      fixTarget({ terms: [{ ...FIX_TERM, sessions: [] }] }),
    );
    expect(termOf(b, "ALL").asOfDate).toBe(FIX_TERM.endsOn);
    expect(annualOf(b, "ALL").asOfDate).toBe("2026-07-31");
  });

  it("is IDEMPOTENT: the same source and target build byte-identical rows", () => {
    const a = buildSchoolPlcRows(fixSource(), fixTarget());
    const c = buildSchoolPlcRows(fixSource(), fixTarget());
    expect(JSON.stringify(c.rows)).toBe(JSON.stringify(a.rows));
  });
});

// ── AC24's ETL half: the aggregate reader cannot read a teacher ──────────────────────────────────

function moduleText(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

/** Block and line comments removed, so a DOCUMENTED name is not mistaken for a REFERENCED one. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("AC24 (ETL half) · the PLC source reader selects NO teacher identity", () => {
  const source = stripComments(moduleText("lib/etl/plc-source.ts"));

  it("names every column it reads — there is no `select *` anywhere in the reader", () => {
    expect(source).not.toMatch(/select\s+\*/i);
    expect(source).not.toMatch(/select\s+[a-z]\.\*/i);
  });

  it("mentions `user_id` ONLY inside a count(distinct …) — never as a selected value", () => {
    // `teachers_in_plc` is a COUNT OF TEACHERS. The moment a teacher's id can reach a fact row's
    // neighbourhood, the analytics warehouse has an individual in it; this is the check that says so
    // before a reviewer has to notice.
    const occurrences = [...source.matchAll(/user_id/g)];
    expect(occurrences.length).toBeGreaterThan(0); // the test must be able to fail
    for (const match of occurrences) {
      const at = match.index ?? 0;
      const before = source.slice(Math.max(0, at - 40), at);
      expect(
        /count\s*\(\s*distinct\s+[\w.]*$/i.test(before),
        `user_id at offset ${String(at)} is not inside a count(distinct …): …${before}`,
      ).toBe(true);
    }
  });

  it("selects no name, email, phone, staff number or any other identity column", () => {
    for (const forbidden of [
      "first_name",
      "last_name",
      "full_name",
      "display_name",
      "email",
      "phone",
      "staff_id",
      "staff_number",
      "licence_number",
      "license_number",
      "ghana_card",
      "date_of_birth",
    ])
      expect(source, `${forbidden} must not appear in the PLC source reader`).not.toContain(
        forbidden,
      );
  });

  it("the NTC seam reads a SCHOOL × YEAR × SEX aggregate and no person either", () => {
    const ntc = stripComments(moduleText("lib/etl/ntc-cpd-source.ts"));
    expect(ntc).not.toMatch(/select\s+\*/i);
    for (const forbidden of ["user_id", "teacher_id", "email", "licence_number", "staff_id"])
      expect(ntc).not.toContain(forbidden);
  });

  it("the fact table itself has no person column and no identity-shaped column", async () => {
    // Belt to the allow-list's braces, asserted against the LIVE schema rather than the source text.
    const cols = await sql<{ column_name: string }[]>`
      select column_name
        from information_schema.columns
       where table_schema = 'public' and table_name = 'fact_plc_participation'`;
    const names = cols.map((c) => c.column_name);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).not.toMatch(/user|teacher_id|person|email|name$/);
    // ... and the two counts that ARE teachers are COUNTS, by name.
    expect(names).toContain("teachers_in_plc");
    expect(names).toContain("teacher_headcount");
  });
});

// ── AC4: this slice mints no enum member and adds no migration ──────────────────────────────────

describe("AC4 · source = OPERATIONAL_AGG, and no new ov_source value was minted", () => {
  it("every written row is OPERATIONAL_AGG, at BOTH cuts", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.source).toBe("OPERATIONAL_AGG");
    expect(annualRows.length).toBeGreaterThan(0);
    expect(termRows.length).toBeGreaterThan(0);
  });

  it("ov_source still has exactly the seven members it was created with", async () => {
    const members = await sql<{ label: string }[]>`
      select e.enumlabel as label
        from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = 'ov_source'
       order by e.enumsortorder`;
    expect(members.map((m) => m.label)).toEqual([
      "OPERATIONAL_AGG",
      "SCHOOL_ENTERED",
      "SCHOOL_GRADEBOOK",
      "WAEC_EXTRACT",
      "EMIS_EXTRACT",
      "GSS_CENSUS",
      "GES_ESTABLISHMENT",
    ]);
  });

  it("the ONE migration this follow-up added is ADD COLUMNs only, and no migration alters ov_source", () => {
    // The original slice added NO migration at all. The follow-up that surfaces "of which PLC-earned"
    // adds exactly one FILE — `0006_dashing_bloodstorm`, two nullable ADD COLUMNs (the PLC-earned
    // points and their own denominator, which ship together because neither is usable alone) — and
    // the claim this test actually defends is unchanged: NO new `ov_source` member is minted to mark
    // a demo figure (C4). The demo state is recognised by its SIGNATURE, never by an enum value.
    const files = readdirSync(join(process.cwd(), "db/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files).toHaveLength(7);
    expect(files[6]).toBe("0006_dashing_bloodstorm.sql");
    const latest = readFileSync(
      join(process.cwd(), "db/migrations", "0006_dashing_bloodstorm.sql"),
      "utf8",
    )
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .trim();
    // ⚠ PURELY ADDITIVE, AND PINNED AS SUCH. A CREATE TABLE / SEQUENCE / ROUTINE here would oblige a
    // re-paste of prod-paste-0006 (docs/PROVISIONING.md §2a step 3); a bare nullable ADD COLUMN on a
    // table whose `jurisdiction_scope` policy has no column list needs no paste at all. If this
    // assertion ever fails, the paste rule applies again — read §2a before shipping it.
    expect(latest.split("--> statement-breakpoint").map((x) => x.trim())).toEqual([
      'ALTER TABLE "fact_plc_participation" ADD COLUMN "plc_earned_points_total" numeric(7, 2);',
      'ALTER TABLE "fact_plc_participation" ADD COLUMN "plc_earned_teacher_count" integer;',
    ]);
    for (const file of files) {
      // ⚠ `--` COMMENTARY STRIPPED FIRST. These migrations carry long hand-appended headers that
      // DISCUSS `ALTER TYPE ... ADD VALUE` and `ov_source` by name; matching raw text would make a
      // documented hazard indistinguishable from an executed statement.
      const text = readFileSync(join(process.cwd(), "db/migrations", file), "utf8")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n");
      // A demo/presentation slice must not reach the analytics DDL at all — least of all by adding an
      // enum member to mark a demo figure, which C4 refuses by name. (0005 legitimately adds a value
      // to `record_type`, so the check is about ov_source specifically, not about ADD VALUE.)
      expect(text).not.toMatch(/ALTER\s+TYPE\s+"?public"?"?\.?"?ov_source/i);
      for (const added of text.match(/ALTER\s+TYPE[^;]*ADD\s+VALUE[^;]*/gi) ?? [])
        expect(added).not.toMatch(/ov_source/i);
    }
  });

  it("and the DEMO state is recognised by its SIGNATURE, not by a source value", () => {
    // C5(ii): a non-null NTC column ON an OPERATIONAL_AGG row IS the demo signature.
    const sourced = annualRows.filter((r) => r.cpd_points_specialised_total !== null);
    expect(sourced.length).toBeGreaterThan(0);
    for (const row of sourced) expect(row.source).toBe("OPERATIONAL_AGG");
    expect(plc.ntcProvenance).toBe("DEMO");
  });
});

// ── the written rows, in SQL ─────────────────────────────────────────────────────────────────────

describe("the two period cuts are written at DIFFERENT periods, both fully sexed", () => {
  it("writes exactly three sex rows per (jurisdiction, period), with no duplicate grain key", async () => {
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id
          from fact_plc_participation
         group by jurisdiction_id, period_id
        having count(*) <> 3
            or count(distinct sex) <> 3
      ) d`;
    expect(bad[0]!.n).toBe(0);
  });

  it("puts the CPD figures on the ANNUAL period only, and participation on the TERMs only", () => {
    for (const row of termRows) {
      expect(row.cpd_points_total).toBeNull();
      expect(row.cpd_points_mandatory_total).toBeNull();
      expect(row.ntc_cpd_target).toBeNull();
      expect(row.annual_plc_target).toBeNull();
      expect(row.plc_earned_points_total).toBeNull();
      expect(row.plc_earned_teacher_count).toBeNull();
      expect(row.sessions_held).not.toBeNull();
    }
    for (const row of annualRows) {
      expect(row.sessions_held).toBeNull();
      expect(row.attendance_events).toBeNull();
      expect(row.plc_participation_rate).toBeNull();
      expect(row.teachers_in_plc).toBeNull();
      expect(row.cpd_points_total).not.toBeNull();
      // ⚠ ALWAYS populated on an ANNUAL row, in the demo state as in the live one — it is the
      // observed PLC figure, so no sourcing gate applies to it.
      expect(row.plc_earned_points_total).not.toBeNull();
      expect(row.plc_earned_teacher_count).not.toBeNull();
    }
  });

  it("runs for the CURRENT academic year only — a non-current year is a clean no-op", () => {
    expect(new Set(rows.map((r) => r.academic_year))).toEqual(new Set([ACADEMIC_YEAR]));
    for (const period of report.periods) {
      if (period.academicYear === ACADEMIC_YEAR) continue;
      expect(period.plc.schoolsComputed).toBe(0);
      expect(period.plc.annual.inserted).toBe(0);
      // Zero computed is also an EMPTY delete scope, so that year keeps exactly what it had.
      expect(period.plc.annual.deleted).toBe(0);
      expect(period.plc.terms).toEqual([]);
    }
  });

  it("covers every declared TERM of the current year", () => {
    expect(plc.terms.map((t) => t.term).sort()).toEqual(
      DEMO_TERMS.filter((t) => t.academicYear === ACADEMIC_YEAR)
        .map((t) => t.term)
        .sort(),
    );
    for (const term of plc.terms) expect(term.inserted).toBe(3 * plc.schoolsComputed);
    expect(plc.annual.inserted).toBe(3 * plc.schoolsComputed);
  });
});

describe("teacher_headcount, in SQL, is the staffing arm's own roll (the PIN)", () => {
  it("the ALL row of EVERY cut equals fact_staffing.teachers_on_roll for that school and year", async () => {
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_plc_participation fp
        join dim_period dp on dp.period_id = fp.period_id
        join dim_period ds on ds.academic_year = dp.academic_year
                          and ds.period_type = 'ANNUAL'
        join fact_staffing fs on fs.jurisdiction_id = fp.jurisdiction_id
                             and fs.period_id = ds.period_id
       where fp.sex = 'ALL'
         and fp.teacher_headcount <> fs.teachers_on_roll`;
    expect(bad[0]!.n).toBe(0);
  });

  it("and the pin reaches BOTH cuts — the check above is not satisfied by the ANNUAL rows alone", async () => {
    const checked = await sql<{ period_type: string; n: number }[]>`
      select dp.period_type::text as period_type, count(*)::int as n
        from fact_plc_participation fp
        join dim_period dp on dp.period_id = fp.period_id
        join dim_period ds on ds.academic_year = dp.academic_year
                          and ds.period_type = 'ANNUAL'
        join fact_staffing fs on fs.jurisdiction_id = fp.jurisdiction_id
                             and fs.period_id = ds.period_id
       where fp.sex = 'ALL' and fp.teacher_headcount = fs.teachers_on_roll
       group by 1`;
    const byType = new Map(checked.map((c) => [c.period_type, c.n]));
    expect(byType.get("ANNUAL")).toBe(plc.schoolsComputed);
    expect(byType.get("TERM")).toBe(plc.schoolsComputed * plc.terms.length);
  });

  it("a school the staffing arm produced no row for has no PLC row either", async () => {
    const orphans = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_plc_participation fp
        join dim_period dp on dp.period_id = fp.period_id
       where not exists (
             select 1
               from fact_staffing fs
               join dim_period ds on ds.period_id = fs.period_id
              where fs.jurisdiction_id = fp.jurisdiction_id
                and ds.academic_year = dp.academic_year)`;
    expect(orphans[0]!.n).toBe(0);
  });
});

describe("AC15/AC17, in SQL, over every written row", () => {
  it("AC15 · the sex-invariant columns are repeated identically within each (jurisdiction, period)", async () => {
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id
          from fact_plc_participation
         group by jurisdiction_id, period_id
        having count(distinct schools_running_plc_count) > 1
            or count(distinct coalesce(sessions_held, -1)) > 1
            or count(distinct coalesce(sessions_expected, -1)) > 1
            or count(distinct coalesce(annual_plc_target, -1)) > 1
            or count(distinct coalesce(ntc_cpd_target, -1)) > 1
      ) d`;
    expect(bad[0]!.n).toBe(0);
  });

  it("AC17 · MALE + FEMALE = ALL on every additive column, at both cuts", async () => {
    const bad = await sql<{ n: number }[]>`
      with g as (
        select jurisdiction_id, period_id,
               sum(teacher_headcount) filter (where sex <> 'ALL')              as s_head,
               max(teacher_headcount) filter (where sex = 'ALL')               as a_head,
               sum(attendance_events) filter (where sex <> 'ALL')              as s_ev,
               max(attendance_events) filter (where sex = 'ALL')               as a_ev,
               sum(attendance_expected) filter (where sex <> 'ALL')            as s_exp,
               max(attendance_expected) filter (where sex = 'ALL')             as a_exp,
               sum(teachers_in_plc) filter (where sex <> 'ALL')                as s_tip,
               max(teachers_in_plc) filter (where sex = 'ALL')                 as a_tip,
               sum(cpd_points_total) filter (where sex <> 'ALL')               as s_tot,
               max(cpd_points_total) filter (where sex = 'ALL')                as a_tot,
               sum(cpd_points_teacher_count) filter (where sex <> 'ALL')       as s_cnt,
               max(cpd_points_teacher_count) filter (where sex = 'ALL')        as a_cnt,
               sum(cpd_points_mandatory_total) filter (where sex <> 'ALL')     as s_man,
               max(cpd_points_mandatory_total) filter (where sex = 'ALL')      as a_man,
               sum(cpd_points_specialised_total) filter (where sex <> 'ALL')   as s_spe,
               max(cpd_points_specialised_total) filter (where sex = 'ALL')    as a_spe,
               sum(cpd_points_recommended_total) filter (where sex <> 'ALL')   as s_rec,
               max(cpd_points_recommended_total) filter (where sex = 'ALL')    as a_rec,
               sum(teachers_meeting_cpd_threshold) filter (where sex <> 'ALL') as s_thr,
               max(teachers_meeting_cpd_threshold) filter (where sex = 'ALL')  as a_thr,
               sum(cpd_mandatory_teacher_count) filter (where sex <> 'ALL')    as s_mtc,
               max(cpd_mandatory_teacher_count) filter (where sex = 'ALL')     as a_mtc,
               sum(cpd_specialised_teacher_count) filter (where sex <> 'ALL')  as s_stc,
               max(cpd_specialised_teacher_count) filter (where sex = 'ALL')   as a_stc,
               sum(cpd_recommended_teacher_count) filter (where sex <> 'ALL')  as s_rtc,
               max(cpd_recommended_teacher_count) filter (where sex = 'ALL')   as a_rtc
          from fact_plc_participation
         group by 1, 2
      )
      select count(*)::int as n from g
       where s_head is distinct from a_head
          or s_ev   is distinct from a_ev
          or s_exp  is distinct from a_exp
          or s_tip  is distinct from a_tip
          or s_tot  is distinct from a_tot
          or s_cnt  is distinct from a_cnt
          or s_man  is distinct from a_man
          or s_spe  is distinct from a_spe
          or s_rec  is distinct from a_rec
          or s_thr  is distinct from a_thr
          or s_mtc  is distinct from a_mtc
          or s_stc  is distinct from a_stc
          or s_rtc  is distinct from a_rtc`;
    expect(bad[0]!.n).toBe(0);
  });

  it("the RATES are NOT additive, and are therefore not asserted to be", () => {
    // Stated as a test so nobody "fixes" the query above by adding the two rate columns to it.
    const group = termRows.filter(
      (r) => r.jurisdiction_id === termRows[0]!.jurisdiction_id && r.period_id === termRows[0]!.period_id,
    );
    expect(group).toHaveLength(3);
    const all = group.find((r) => r.sex === "ALL")!;
    if (all.plc_participation_rate !== null) {
      const split = group
        .filter((r) => r.sex !== "ALL")
        .reduce((t, r) => t + Number(r.plc_participation_rate ?? 0), 0);
      expect(split).not.toBe(Number(all.plc_participation_rate));
    }
  });
});

describe("AC14, in SQL · Postgres agrees with the transform's own rounding", () => {
  it("plc_participation_rate = round(100 × events ÷ expected, 2) on every TERM row", async () => {
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_plc_participation
       where (attendance_expected > 0
              and plc_participation_rate
                  is distinct from round(100.0 * attendance_events / attendance_expected, 2))
          or (attendance_expected = 0 and plc_participation_rate is not null)`;
    expect(bad[0]!.n).toBe(0);
  });

  it("cpd_points_mean = round(total ÷ cpd_points_teacher_count, 2) — never ÷ teacher_headcount", async () => {
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_plc_participation
       where (cpd_points_teacher_count > 0
              and cpd_points_mean
                  is distinct from round(cpd_points_total / cpd_points_teacher_count, 2))
          or (cpd_points_teacher_count = 0 and cpd_points_mean is not null)`;
    expect(bad[0]!.n).toBe(0);
  });

  it("... and the two denominators really do differ, so the test above is sensitive", async () => {
    const differ = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_plc_participation
       where cpd_points_teacher_count > 0
         and teacher_headcount > 0
         and cpd_points_teacher_count <> teacher_headcount
         and round(cpd_points_total / cpd_points_teacher_count, 2)
             <> round(cpd_points_total / teacher_headcount, 2)`;
    expect(differ[0]!.n).toBeGreaterThan(0);
  });

  it("the threshold count never exceeds its own row's headcount (the schema's invariant)", async () => {
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_plc_participation
       where teachers_meeting_cpd_threshold > teacher_headcount
          or attendance_events > attendance_expected
          or sessions_held < 0`;
    expect(bad[0]!.n).toBe(0);
  });
});

describe("AC9, in SQL · the reconciliation holds in the demo state", () => {
  it("mandatory + specialised + recommended = cpd_points_total wherever the categories are populated", async () => {
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_plc_participation
       where cpd_points_specialised_total is not null
         and cpd_points_recommended_total is not null
         and cpd_points_mandatory_total + cpd_points_specialised_total
             + cpd_points_recommended_total <> cpd_points_total`;
    expect(bad[0]!.n).toBe(0);
  });

  it("the five NTC-sourced columns are ALL non-null or ALL null on a row — never half", async () => {
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_plc_participation
       where period_id in (select period_id from dim_period where period_type = 'ANNUAL')
         and (
           (cpd_points_specialised_total is null)::int
         + (cpd_points_recommended_total is null)::int
         + (cpd_specialised_teacher_count is null)::int
         + (cpd_recommended_teacher_count is null)::int
         + (teachers_meeting_cpd_threshold is null)::int
         ) not in (0, 5)`;
    expect(bad[0]!.n).toBe(0);
  });

  it("Mandatory is ≥ the observed PLC floor: it is ≥ the PLC-only subtotal the report states", () => {
    // The per-school floor is asserted inside the transform (`assertPlcInvariants`, claim 6). Here the
    // national figures are compared, which is the one place a systematic inversion would show.
    expect(Number(plc.annual.cpdPointsTotal)).toBeGreaterThanOrEqual(Number(plc.annual.plcPoints));
    expect(Number(plc.annual.plcPoints)).toBeGreaterThan(0);
  });

  it("plc_earned_points_total ≤ cpd_points_mandatory_total on EVERY written row, in SQL", async () => {
    // The PLC floor is one PART of NTC's Mandatory class. Asserted over the whole table rather than
    // per fixture, because an inversion would be a systematic sourcing error, not a one-school one.
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_plc_participation
       where plc_earned_points_total is not null
         and plc_earned_points_total > cpd_points_mandatory_total`;
    expect(bad[0]!.n).toBe(0);
  });

  it("plc_earned_points_total is STRICTLY below cpd_points_total wherever ANY non-PLC points exist", async () => {
    // Which is the whole reason the column exists: once the categories are populated the observed PLC
    // figure is NOT recoverable from cpd_points_total. Said as the EXACT identity rather than a
    // blanket `<`, because the two legitimately COINCIDE on a row with no non-PLC points at all — a
    // covered school's empty sex row contributes zeros in all three NTC arms, and there the total
    // still IS the PLC subtotal. The gap is (mandatory − plc_earned) + specialised + recommended, so
    // "strictly below" must hold on exactly the rows where that is positive, and nowhere else.
    const r = await sql<{ n: number; with_gap: number; strictly_below: number }[]>`
      select count(*)::int                                                       as n,
             count(*) filter (
               where (cpd_points_mandatory_total - plc_earned_points_total)
                   + cpd_points_specialised_total + cpd_points_recommended_total > 0
             )::int                                                              as with_gap,
             count(*) filter (
               where plc_earned_points_total < cpd_points_total
             )::int                                                              as strictly_below
        from fact_plc_participation
       where cpd_points_specialised_total is not null
         and cpd_points_recommended_total is not null`;
    expect(r[0]!.n).toBeGreaterThan(0);
    // The demo state genuinely exercises the case — most rows DO carry non-PLC points.
    expect(r[0]!.with_gap).toBeGreaterThan(r[0]!.n / 2);
    expect(r[0]!.strictly_below).toBe(r[0]!.with_gap);
  });

  it("plc_earned_teacher_count ≤ cpd_points_teacher_count on EVERY written row, in SQL", async () => {
    // The subset claim, over the whole table: PLC earners are a SUBSET of any-CPD earners, so the
    // PLC mean's denominator is provably the tighter of the two and never divides by strangers.
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_plc_participation
       where plc_earned_teacher_count is not null
         and plc_earned_teacher_count > cpd_points_teacher_count`;
    expect(bad[0]!.n).toBe(0);
  });

  it("the national PLC-earned sum equals the run report's own observed PLC points", async () => {
    // The roll-up property, end to end: summing the stored column over the ALL rows reproduces the
    // figure the report states independently, so "of which PLC-earned" aggregates honestly.
    const summed = await sql<{ total: string }[]>`
      select coalesce(sum(fp.plc_earned_points_total), 0)::text as total
        from fact_plc_participation fp
        join dim_period d on d.period_id = fp.period_id
       where d.period_type = 'ANNUAL'
         and fp.sex = 'ALL'`;
    expect(Number(summed[0]!.total)).toBe(Number(plc.annual.plcPoints));
  });
});

describe("AC2 · the NTC columns are populated FROM the source, school by school", () => {
  it("has no clamps in the demo (the generator draws within the roll), so the figures are exact", () => {
    expect(plc.ntcCountsClamped).toBe(0);
  });

  it("every covered school's sexed NTC columns equal that school's own extract rows", () => {
    let compared = 0;
    for (const row of annualRows) {
      if (row.sex === "ALL") continue;
      const source = ntcBySchoolSex.get(`${row.emis_school_id}\u0000${row.sex}`);
      if (!source) continue;
      compared += 1;
      expect(row.cpd_points_specialised_total).toBe(pointsOf(source.specialisedHundredths));
      expect(row.cpd_points_recommended_total).toBe(pointsOf(source.recommendedHundredths));
      expect(row.cpd_specialised_teacher_count).toBe(source.specialisedTeachers);
      expect(row.cpd_recommended_teacher_count).toBe(source.recommendedTeachers);
      expect(row.teachers_meeting_cpd_threshold).toBe(source.teachersMeetingThreshold);
      expect(row.ntc_cpd_target).toBe(pointsOf(source.cpdTargetHundredths));
    }
    expect(compared).toBeGreaterThan(0);
    // The run's own count of sourced schools must agree with what the extract covers.
    expect(plc.annual.ntcSourcedSchools).toBe(compared / 2);
  });

  it("a school the extract does NOT cover keeps every NTC column NULL — absence is not a zero", () => {
    const uncovered = annualRows.filter(
      (r) => r.sex === "ALL" && !ntcBySchoolSex.has(`${r.emis_school_id}\u0000MALE`),
    );
    expect(uncovered.length).toBeGreaterThan(0); // the demo deliberately leaves a coverage gap
    for (const row of uncovered) {
      expect(row.cpd_points_specialised_total).toBeNull();
      expect(row.teachers_meeting_cpd_threshold).toBeNull();
      expect(row.ntc_cpd_target).toBeNull();
      // ... and it still carries its OBSERVED half, which no feed is needed for.
      expect(row.cpd_points_mandatory_total).not.toBeNull();
      expect(row.cpd_points_total).toBe(row.cpd_points_mandatory_total);
    }
  });

  it("the OBSERVED half comes from the operational ledger, not from the NTC stand-in", async () => {
    // Σ `attended_pts + reflection_pts` over the current ACADEMIC YEAR's sessions (the ANNUAL cut's
    // window, not one term's), read straight from the operational stand-in — the figure the report
    // calls `plcPoints`.
    const ledger = await sql<{ hundredths: string }[]>`
      select coalesce(sum((l.attended_pts + l.reflection_pts) * 100), 0)::bigint as hundredths
        from demo_source.plc_cpd_ledger l
        join demo_source.plc_session s on s.id = l.session_id
       where s.session_date between ${YEAR_STARTS_ON}::date and ${YEAR_ENDS_ON}::date`;
    // The ETL's figure is Σ over the schools it COMPUTED, so it can only be ≤ the whole ledger, and in
    // this dataset (every school is computed) it is equal. Both halves of that are asserted.
    expect(Number(plc.annual.plcPoints) * 100).toBeLessThanOrEqual(Number(ledger[0]!.hundredths));
    expect(plc.annual.plcPoints).toBe(pointsOf(Number(ledger[0]!.hundredths)));
  });
});

describe("the present-by-default PLC register is a SUBTRACTION, and LATE is PRESENT", () => {
  it("attendance_events = expected − non-present, with LATE rows deducting NOTHING", async () => {
    // Recomputed in SQL from the operational stand-in for one term, independently of the transform's
    // per-PLC loop: members × sessions held, minus the ABSENT/EXCUSED/MEDICAL rows only.
    const term = plc.terms[0]!;
    const expected = await sql<{ expected: number; non_present: number }[]>`
      with held as (
        select s.plc_id, s.school_id, count(*)::int as sessions_held
          from demo_source.plc_session s
          join demo_source.plc p on p.id = s.plc_id and p.archived_at is null
         where s.session_date between ${term.startsOn}::date and ${term.endsOn}::date
         group by 1, 2
      ), cohort as (
        select m.plc_id, count(distinct m.user_id)::int as members
          from demo_source.plc_membership m
         where m.left_at is null
         group by 1
      )
      select coalesce(sum(h.sessions_held * c.members), 0)::int as expected,
             (select count(*)::int
                from demo_source.plc_session_attendance a
                join demo_source.plc_session s on s.id = a.session_id
                join demo_source.plc p on p.id = s.plc_id and p.archived_at is null
               where s.session_date between ${term.startsOn}::date and ${term.endsOn}::date
                 and a.status in ('ABSENT', 'EXCUSED', 'MEDICAL')) as non_present
        from held h join cohort c on c.plc_id = h.plc_id`;
    expect(term.attendanceExpected).toBe(expected[0]!.expected);
    expect(term.attendanceEvents).toBe(expected[0]!.expected - expected[0]!.non_present);

    // And LATE rows exist in this window, so the claim "LATE deducts nothing" is not vacuous.
    const late = await sql<{ n: number }[]>`
      select count(*)::int as n
        from demo_source.plc_session_attendance a
        join demo_source.plc_session s on s.id = a.session_id
       where a.status = 'LATE'
         and s.session_date between ${term.startsOn}::date and ${term.endsOn}::date`;
    expect(late[0]!.n).toBeGreaterThan(0);
  });

  it("teachers_in_plc counts DISTINCT people, not memberships", async () => {
    const distinct = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select m.school_id, count(distinct m.user_id) as people, count(*) as memberships
          from demo_source.plc_membership m
          join demo_source.plc p on p.id = m.plc_id and p.archived_at is null
         where m.left_at is null
         group by 1
        having count(distinct m.user_id) < count(*)
      ) d`;
    // The dataset HAS teachers in two PLCs, so a Σ-of-per-PLC-counts implementation would differ.
    expect(distinct[0]!.n).toBeGreaterThan(0);
    const term = plc.terms[0]!;
    const people = await sql<{ n: number }[]>`
      select count(*)::int as n
        from (select distinct m.school_id, m.user_id
                from demo_source.plc_membership m
                join demo_source.plc p on p.id = m.plc_id and p.archived_at is null
               where m.left_at is null) d`;
    expect(term.teachersInPlc).toBe(people[0]!.n);
  });
});

describe("the run reports BOTH provenance halves apart, and never pools them", () => {
  it("names the NTC state once, with its own coverage denominator", () => {
    expect(plc.ntcProvenance).toBe("DEMO");
    expect(plc.annual.ntcSourcedSchools).toBeGreaterThan(0);
    expect(plc.annual.ntcSourcedSchools).toBeLessThan(plc.schoolsComputed);
    expect(plc.annual.teachersMeetingCpdThreshold).not.toBeNull();
  });

  it("lists the schools that run no PLC rather than leaving them to a subtraction", () => {
    expect(plc.noPlc.length).toBeGreaterThan(0);
    const zeroRows = annualRows.filter((r) => r.sex === "ALL" && r.schools_running_plc_count === 0);
    expect(zeroRows.map((r) => r.emis_school_id).sort()).toEqual([...plc.noPlc].sort());
    // They are COMPUTED, so "N of Y" has its denominator.
    expect(plc.annual.schoolsRunningPlc + plc.noPlc.length).toBe(plc.schoolsComputed);
  });

  it("reports sessions of archived PLCs, which are in no fact column", () => {
    expect(plc.terms.some((t) => t.orphanSessions > 0)).toBe(true);
    for (const term of plc.terms) {
      expect(term.sessionsHeld).toBeLessThanOrEqual(term.sessionsExpected);
      expect(term.schoolsWithoutCadence).toBeGreaterThan(0); // the planted no-programme case
    }
  });
});

describe("AC3 · the NTC source is a SEAM, not a hard-coded schema name", () => {
  it("reads IDENTICAL summaries from a second, live-SHAPED schema through the same reader", async () => {
    const emisIds = [...ntcBySchoolSex.keys()].map((k) => k.split("\u0000")[0]!).slice(0, 40);
    const fromDemo = await readNtcCpdSummaries(sql, {
      schemaName: "demo_ntc_source",
      academicYear: ACADEMIC_YEAR,
      emisSchoolIds: emisIds,
    });

    // The "live" connection, stood up with the SAME shape and the SAME rows. Nothing about the reader
    // changes — only the schema it is pointed at, which is the whole claim C2 makes.
    await sql`drop schema if exists ${sql(LIVE_SHAPED_SCHEMA)} cascade`;
    await sql`create schema ${sql(LIVE_SHAPED_SCHEMA)}`;
    await sql`
      create table ${sql(LIVE_SHAPED_SCHEMA)}.${sql(NTC_CPD_SUMMARY_TABLE)} as
      select * from demo_ntc_source.ntc_cpd_summary`;

    const fromLive = await readNtcCpdSummaries(sql, {
      schemaName: LIVE_SHAPED_SCHEMA,
      academicYear: ACADEMIC_YEAR,
      emisSchoolIds: emisIds,
    });
    expect(fromLive.sourcePresent).toBe(true);
    expect(fromLive.bySchool.size).toBe(fromDemo.bySchool.size);
    expect(fromLive.bySchool.size).toBeGreaterThan(0);
    for (const [emis, summary] of fromDemo.bySchool)
      expect(fromLive.bySchool.get(emis)).toEqual(summary);

    await sql`drop schema ${sql(LIVE_SHAPED_SCHEMA)} cascade`;
  });

  it("an ABSENT schema is a normal outcome: sourcePresent false, no rows, and NO throw", async () => {
    expect(await ntcCpdSourcePresent(sql, ABSENT_SCHEMA)).toBe(false);
    const result = await readNtcCpdSummaries(sql, {
      schemaName: ABSENT_SCHEMA,
      academicYear: ACADEMIC_YEAR,
      emisSchoolIds: ["GH-GA-0001"],
    });
    expect(result.sourcePresent).toBe(false);
    expect(result.bySchool.size).toBe(0);
  });

  it("a PRESENT feed that mentions none of the run's schools is a DIFFERENT state", async () => {
    const result = await readNtcCpdSummaries(sql, {
      schemaName: "demo_ntc_source",
      academicYear: ACADEMIC_YEAR,
      emisSchoolIds: ["GH-NOT-A-SCHOOL"],
    });
    // Connected, covering nobody — an actionable coverage problem, not an unconnected feed.
    expect(result.sourcePresent).toBe(true);
    expect(result.bySchool.size).toBe(0);
  });

  it("refuses an extract row whose teacher_sex is not MALE or FEMALE — ALL is SYNTHESISED", async () => {
    await sql`drop schema if exists ${sql(LIVE_SHAPED_SCHEMA)} cascade`;
    await sql`create schema ${sql(LIVE_SHAPED_SCHEMA)}`;
    // Deliberately WITHOUT the demo source's CHECK, because a live feed has no such constraint — which
    // is exactly why the reader validates at the boundary.
    await sql`
      create table ${sql(LIVE_SHAPED_SCHEMA)}.${sql(NTC_CPD_SUMMARY_TABLE)} as
      select 'GH-GA-0001'::text as emis_school_id, ${ACADEMIC_YEAR}::text as academic_year,
             'ALL'::text as teacher_sex, 1.00::numeric(9,2) as specialised_points,
             1.00::numeric(9,2) as recommended_points, 1.00::numeric(9,2) as ncpd_points,
             1 as mandatory_teachers, 1 as specialised_teachers, 1 as recommended_teachers,
             1 as teachers_meeting_threshold, 20.00::numeric(5,2) as cpd_target_points`;
    await expect(
      readNtcCpdSummaries(sql, {
        schemaName: LIVE_SHAPED_SCHEMA,
        academicYear: ACADEMIC_YEAR,
        emisSchoolIds: ["GH-GA-0001"],
      }),
    ).rejects.toThrow(/SYNTHESISED/);
    await sql`drop schema ${sql(LIVE_SHAPED_SCHEMA)} cascade`;
  });
});

describe("AC25 · a re-run over unchanged sources is byte-identical", () => {
  it("rewrites every row with the same values and only a new etl_run_id", async () => {
    const before = rows;
    const second = await runEtl();
    expect(second.status).toBe("SUCCESS");
    expect(second.runId).not.toBe(report.runId);
    const after = await readPlc();

    expect(after).toHaveLength(before.length);
    const strip = (r: PlcRow) => {
      const { etl_run_id: _ignored, ...rest } = r;
      return rest;
    };
    expect(after.map(strip)).toEqual(before.map(strip));
    // The whole scope was REPLACED, not appended to: the delete count equals the insert count.
    const secondPlc = plcOutcomeOf(second);
    expect(secondPlc.annual.deleted).toBe(secondPlc.annual.inserted);
    for (const term of secondPlc.terms) expect(term.deleted).toBe(term.inserted);
    // ... and every row now carries the SECOND run's id, which is the honest part of "byte-identical".
    expect(new Set(after.map((r) => r.etl_run_id))).toEqual(new Set([second.runId]));

    rows = after;
    annualRows = rows.filter((r) => r.period_type === "ANNUAL");
    termRows = rows.filter((r) => r.period_type === "TERM");
    report = second;
    plc = secondPlc;
  }, 900_000);
});

/**
 * ⚠ LAST IN THE FILE ON PURPOSE. This describe RE-RUNS THE WHOLE ETL with the NTC seam pointed at a
 * schema that does not exist, which rewrites every `fact_plc_participation` row in the database. Every
 * assertion above is made against the DEMO state, so this must not run before them.
 *
 * This is the state the real product is in TODAY (ruling C1/C5: no NTC feed), and it is the one that
 * proves the demo did not quietly become the transform's assumption.
 */
describe("AC1/AC7, end to end · the gate CLOSED leaves the NTC columns NULL, never 0", () => {
  it("runs successfully with no NTC source at all — an absent feed is a normal run", async () => {
    const absentRun = await runEtl({ ntcSourceSchema: ABSENT_SCHEMA });
    expect(absentRun.status).toBe("SUCCESS");
    const absentPlc = plcOutcomeOf(absentRun);
    expect(absentPlc.ntcProvenance).toBe("ABSENT");
    expect(absentPlc.annual.ntcSourcedSchools).toBe(0);
    expect(absentPlc.annual.teachersMeetingCpdThreshold).toBeNull();
    // The OBSERVED half is untouched by the gate — the same measured points as the demo run.
    expect(absentPlc.annual.plcPoints).toBe(plc.annual.plcPoints);
    // ... and the all-category total has FALLEN BACK to the PLC-only subtotal.
    expect(absentPlc.annual.cpdPointsTotal).toBe(absentPlc.annual.plcPoints);
    expect(absentPlc.schoolsComputed).toBe(plc.schoolsComputed);

    const after = await readPlc();
    expect(after).toHaveLength(rows.length);
    for (const row of after) {
      expect(row.source).toBe("OPERATIONAL_AGG");
      expect(row.cpd_points_specialised_total).toBeNull();
      expect(row.cpd_points_recommended_total).toBeNull();
      expect(row.cpd_specialised_teacher_count).toBeNull();
      expect(row.cpd_recommended_teacher_count).toBeNull();
      expect(row.teachers_meeting_cpd_threshold).toBeNull();
      expect(row.ntc_cpd_target).toBeNull();
    }
    // The NEGATIVE half, in SQL: not one of them degraded to a zero anywhere in the table.
    const zeros = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_plc_participation
       where cpd_points_specialised_total = 0
          or cpd_points_recommended_total = 0
          or cpd_specialised_teacher_count = 0
          or cpd_recommended_teacher_count = 0
          or teachers_meeting_cpd_threshold = 0
          or ntc_cpd_target = 0`;
    expect(zeros[0]!.n).toBe(0);

    // The PLC-only partial, stated as the reconciliation FALLBACK on every ANNUAL row.
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_plc_participation fp
        join dim_period d on d.period_id = fp.period_id
       where d.period_type = 'ANNUAL'
         and fp.cpd_points_total is distinct from fp.cpd_points_mandatory_total`;
    expect(bad[0]!.n).toBe(0);

    // ⚠ AND THE PLC-EARNED PAIR SURVIVES THE CLOSED GATE UNTOUCHED — neither is one of the five.
    // In this state the points EQUAL cpd_points_total and the count EQUALS cpd_points_teacher_count
    // (there, the only CPD points ARE PLC points and the two populations are the same people) —
    // the categories-ABSENT half of their stated invariants, asserted on the written rows. This is
    // also the proof that the reader's switch of denominator changes nothing in the live state.
    const plcEarnedMismatch = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_plc_participation fp
        join dim_period d on d.period_id = fp.period_id
       where d.period_type = 'ANNUAL'
         and (fp.plc_earned_points_total is distinct from fp.cpd_points_total
           or fp.plc_earned_teacher_count is distinct from fp.cpd_points_teacher_count)`;
    expect(plcEarnedMismatch[0]!.n).toBe(0);
    // Never NULL on an ANNUAL row, even with every NTC column gone: a real 0.00 / 0 is a measurement.
    const absentEarned = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_plc_participation fp
        join dim_period d on d.period_id = fp.period_id
       where d.period_type = 'ANNUAL'
         and (fp.plc_earned_points_total is null or fp.plc_earned_teacher_count is null)`;
    expect(absentEarned[0]!.n).toBe(0);
    // And both are the IDENTICAL measured figures the demo run wrote — they do not move when the
    // NTC seam does, which is the provenance claim the reader labels "MEASURED" on.
    for (const row of after.filter((r) => r.period_type === "ANNUAL")) {
      const before = annualRows.find(
        (r) => r.jurisdiction_id === row.jurisdiction_id && r.sex === row.sex,
      )!;
      expect(row.plc_earned_points_total).toBe(before.plc_earned_points_total);
      expect(row.plc_earned_teacher_count).toBe(before.plc_earned_teacher_count);
    }

    // And the TERM cut is UNAFFECTED by the NTC seam: participation is operationally observed.
    const termAfter = after.filter((r) => r.period_type === "TERM");
    const strip = (r: PlcRow) => {
      const { etl_run_id: _ignored, ...rest } = r;
      return rest;
    };
    expect(termAfter.map(strip)).toEqual(termRows.map(strip));
  }, 900_000);
});

/**
 * ⚠ ALSO LAST, AND AFTER THE GATE-CLOSED RUN, because it declares a BROKEN period list and then
 * restores the baseline. The refusal itself writes nothing, but the period upsert runs first and
 * nulls that TERM row's window (the same sequence `tests/etl-attendance.test.ts` documents), so the
 * dated baseline is re-run at the end to leave the shared database as this file found it.
 */
describe("the TERM window is a SHARED run precondition, refused once for every term-grained arm", () => {
  it("refuses an undated TERM spec by the ONE message all three arms share", async () => {
    const before = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_plc_participation`;
    await expect(
      runOversightEtl(sql, {
        emisExtractText: JSON.stringify(emisExtractFor(dataset)),
        periods: [
          // Term 1 of the current year, stripped of BOTH dates. A PLC session belongs to the term
          // containing its civil `session_date`, so this term could hold no session and expect none.
          { academicYear: ACADEMIC_YEAR, term: 1, isCurrent: true },
          ...periodsOption().slice(1),
        ],
        sourceSchema: "demo_source",
      }),
      // ⚠ THE SAME MESSAGE `tests/etl-attendance.test.ts` ASSERTS. There used to be one refusal per
      // term-grained arm, which made the message a reader got depend on the order the arms run in —
      // adding this (seventh) arm changed what the attendance arm had always said. One requirement,
      // one refusal: `assertTermWindowsDeclared` in pipeline step 2.
    ).rejects.toThrow(/no TERM-grained fact has a window to aggregate over/);

    // It is refused BEFORE any arm computes, so not one fact row moved.
    const after = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_plc_participation`;
    expect(after[0]!.n).toBe(before[0]!.n);

    // Restore the dated baseline (the upsert nulled term 1's window on the way to the refusal).
    const restored = await runEtl();
    expect(restored.status).toBe("SUCCESS");
  }, 900_000);
});
