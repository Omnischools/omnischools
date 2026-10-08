import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { adminDemoAnalytics, selectsStoredPtr } from "./helpers";
import {
  DEMO_TERMS,
  emisExtractFor,
  generateDemoDataset,
  loadDemoSource,
  makeRng,
  type DemoDataset,
  type DemoSchool,
} from "@/scripts/seed-demo-data";
import { runOversightEtl, type EtlRunReport } from "@/lib/etl/pipeline";
import {
  NORTHERN_REGIONS,
  SCHOOL_LEVEL_BANDS,
  SOUTHERN_METRO_REGIONS,
  StaffingTransformError,
  buildStaffingRow,
  deriveSchoolStaffing,
  dominantStage,
  makeStaffingRng,
  pinnedEnrolmentTotal,
  ptrOf,
  staffingSeed,
  writeStaffingFacts,
} from "@/lib/etl/staffing";
import type { FactEnrolmentRow } from "@/lib/etl/enrolment";
// The presentation axis the PTR spread bar is drawn on. A plain object literal in a `.tsx` module, so
// importing it here pulls in no React render path — and it is the ONE copy, so this assertion cannot
// drift from the axis actually plotted.
import { PTR_AXIS } from "@/components/oversight/breakdown-visuals";

/**
 * THE SIXTH FACT ARM — `fact_staffing` end-to-end, against Kofi's
 * `STAFFING-PTR-DOMAIN-RULING.md` (21 acceptance criteria) and Wells's `STAFFING-ETL-PLAN.md` §6.
 *
 * Same posture as the five arms before it: the REAL pipeline runs over the deterministic demo dataset,
 * every fact row is produced by `deriveSchoolStaffing`, and NOTHING HERE HAND-SEEDS A FACT except where
 * a test's whole subject is a hand-built pathological row (the lopsided district and the duplicate
 * assertion), which say so in as many words.
 *
 * ⚠ THE HEADLINE ASSERTIONS ARE MADE IN SQL AGAINST THE WRITTEN ROWS, not against the transform's
 * return value. An in-memory assertion would re-test the generator with the generator's own numbers and
 * would still pass if the writer dropped a column or swapped two of them. Where a figure is
 * hand-computed it is computed in TypeScript from the GENERATED ROSTER, never from a second SQL query
 * against the same rows — that would only prove Postgres agrees with itself.
 *
 * ⚠ THE RECONCILIATION TEST CARRIES TWO NEGATIVE ASSERTIONS. A test that only says "these two sums
 * agree" cannot tell you whether it is sensitive to the two filters that make the enrolment surface
 * roll-up-safe. So it also asserts that dropping `sex = 'ALL'` and dropping `class_form IS NULL` each
 * BREAK the equality — ≈2× and ≈2× respectively (the ALL row is stored beside MALE/FEMALE, so an
 * unfiltered sex sum is ALL + MALE + FEMALE = 2 × ALL).
 *
 * ⚠ NOTHING IN THIS FILE READS OR IMPORTS THE NAMED-STAFF PATH. `teachers_on_roll` is a count of
 * teachers, never a teacher; `fact_staffing` has no `sex` column and no person column, and two tests
 * below pin that against the live schema.
 */

let sql: postgres.Sql;
let dataset: DemoDataset;
let report: EtlRunReport;

const ACADEMIC_YEAR = DEMO_TERMS.find((t) => t.isCurrent)!.academicYear;
/** The roster's frozen vintage — the staffing arm stamps the SAME one (ruling AC 21). */
const ROSTER_AS_OF = DEMO_TERMS[DEMO_TERMS.length - 1]!.endsOn;

let schoolByEmis: Map<string, DemoSchool>;
/** jurisdiction_id → the generated school, for the ownership/region assertions. */
let schoolByJurisdiction: Map<string, DemoSchool>;

interface StaffingRow {
  jurisdiction_id: string;
  period_id: string;
  teachers_on_roll: number;
  teaching_posts_established: number | null;
  enrolment_total: number;
  ptr: string;
  vacancies: number | null;
  source: string;
  as_of_date: string;
  etl_run_id: string;
  emis_school_id: string;
  region_name: string;
  district_name: string;
  ownership_type: string;
}

let rows: StaffingRow[];

function periodsOption() {
  return DEMO_TERMS.map((t) => ({
    academicYear: t.academicYear,
    term: t.term,
    startsOn: t.startsOn,
    endsOn: t.endsOn,
    isCurrent: t.isCurrent,
  }));
}

async function runEtl(
  over: { policy?: { maxFailureRate: number } } = {},
): Promise<EtlRunReport> {
  return runOversightEtl(sql, {
    emisExtractText: JSON.stringify(emisExtractFor(dataset)),
    periods: periodsOption(),
    sourceSchema: "demo_source",
    ...(over.policy ? { policy: over.policy } : {}),
  });
}

/** Every written row, joined out to the register so ownership and geography are assertable. */
async function readStaffing(): Promise<StaffingRow[]> {
  return sql<StaffingRow[]>`
    select fs.jurisdiction_id::text as jurisdiction_id,
           fs.period_id::text       as period_id,
           fs.teachers_on_roll,
           fs.teaching_posts_established,
           fs.enrolment_total,
           fs.ptr::text             as ptr,
           fs.vacancies,
           fs.source::text          as source,
           fs.as_of_date::text      as as_of_date,
           fs.etl_run_id::text      as etl_run_id,
           r.emis_school_id,
           reg.name                 as region_name,
           dis.name                 as district_name,
           r.ownership_type::text   as ownership_type
      from fact_staffing fs
      join dim_jurisdiction j on j.jurisdiction_id = fs.jurisdiction_id
      join ref_emis_school_register r on r.emis_school_id = j.ges_code
      -- The geography comes off the SPINE, walked through parent_id, because the register holds
      -- jurisdiction uuids rather than names — the same walk every roll-up uses.
      join dim_jurisdiction dis on dis.jurisdiction_id = j.parent_id
      join dim_jurisdiction reg on reg.jurisdiction_id = dis.parent_id
     order by r.emis_school_id`;
}

beforeAll(async () => {
  sql = adminDemoAnalytics();
  dataset = generateDemoDataset();
  schoolByEmis = new Map(dataset.schools.map((s) => [s.emisSchoolId, s]));
  await loadDemoSource(sql, dataset);
  report = await runEtl();
  expect(report.status).toBe("SUCCESS");
  rows = await readStaffing();
  schoolByJurisdiction = new Map(
    rows.map((r) => [r.jurisdiction_id, schoolByEmis.get(r.emis_school_id)!]),
  );
}, 900_000);

afterAll(async () => {
  if (sql) await sql.end({ timeout: 5 });
});

// ── the pure transform, before anything touches the database ─────────────────────────────────────

describe("the generator is the demo's own deterministic PRNG, not Math.random()", () => {
  it("mulberry32 in lib/etl/staffing.ts is byte-identical to the demo seed's makeRng", () => {
    // The copy exists because `lib/` must not import `scripts/`. This is what stops the two drifting:
    // a one-character change in either stream re-rolls every school in the country, silently.
    for (const seed of [0, 1, 42, 0x4845_4d49, 0x5354_4146, 0xffff_ffff]) {
      const a = makeRng(seed);
      const b = makeStaffingRng(seed);
      for (let i = 0; i < 8; i++) expect(b()).toBe(a());
    }
  });

  it("gives the same school the same seed on every run, and different schools different seeds", () => {
    expect(staffingSeed("GH-GA-0001", ACADEMIC_YEAR)).toBe(
      staffingSeed("GH-GA-0001", ACADEMIC_YEAR),
    );
    expect(staffingSeed("GH-GA-0001", ACADEMIC_YEAR)).not.toBe(
      staffingSeed("GH-GA-0002", ACADEMIC_YEAR),
    );
    // The academic year is in the seed, so a future multi-year run cannot file identical figures twice.
    expect(staffingSeed("GH-GA-0001", "2025/26")).not.toBe(
      staffingSeed("GH-GA-0001", "2026/27"),
    );
  });
});

describe("the PIN is the roll-up-safe enrolment figure and nothing else (ruling §5)", () => {
  const enrolmentRow = (over: Partial<FactEnrolmentRow>): FactEnrolmentRow => ({
    jurisdictionId: "j",
    periodId: "p",
    stage: "PRIMARY",
    classForm: null,
    sex: "ALL",
    source: "OPERATIONAL_AGG",
    asOfDate: ROSTER_AS_OF,
    etlRunId: "r",
    headcount: 0,
    ...over,
  });

  it("sums ONLY sex='ALL' AND class_form IS NULL, across every stage", () => {
    const given: FactEnrolmentRow[] = [
      // PRIMARY: the breakdown (must be ignored) and the stage total (must be counted).
      enrolmentRow({ stage: "PRIMARY", classForm: "P1", sex: "MALE", headcount: 30 }),
      enrolmentRow({ stage: "PRIMARY", classForm: "P1", sex: "FEMALE", headcount: 20 }),
      enrolmentRow({ stage: "PRIMARY", classForm: "P1", sex: "ALL", headcount: 50 }),
      enrolmentRow({ stage: "PRIMARY", classForm: null, sex: "MALE", headcount: 30 }),
      enrolmentRow({ stage: "PRIMARY", classForm: null, sex: "FEMALE", headcount: 20 }),
      enrolmentRow({ stage: "PRIMARY", classForm: null, sex: "ALL", headcount: 50 }),
      // A second stage's total — summed too, because `enrolment_total` is the whole school.
      enrolmentRow({ stage: "KG", classForm: null, sex: "ALL", headcount: 18 }),
      enrolmentRow({ stage: "KG", classForm: "KG1", sex: "ALL", headcount: 18 }),
    ];
    expect(pinnedEnrolmentTotal(given, "GH-XX-0001")).toBe(68);
    // The two traps, stated as arithmetic: the unfiltered sum of the SAME rows is 236 — 3.5× the
    // honest figure, and internally consistent, which is why no reader would notice.
    expect(given.reduce((t, r) => t + r.headcount, 0)).toBe(236);
  });

  it("refuses a roster it cannot pin to, naming the school", () => {
    expect(() =>
      pinnedEnrolmentTotal([enrolmentRow({ headcount: -1 })], "GH-XX-0002"),
    ).toThrow(StaffingTransformError);
    expect(() =>
      pinnedEnrolmentTotal([enrolmentRow({ headcount: -1 })], "GH-XX-0002"),
    ).toThrow(/^GH-XX-0002:/);
  });

  it("picks the band by the PUPIL-WEIGHTED dominant stage, not the highest one", () => {
    // A 900-pupil primary school with one 30-pupil JHS stream is a PRIMARY-band school (ruling §3's
    // "PRIMARY (incl. COMBINED basic)"), not a JHS-band one. Highest-stage would have filed it under
    // 12–25 and dragged the primary estate's pupil-weighted mean below its own band.
    const given = [
      enrolmentRow({ stage: "PRIMARY", classForm: null, sex: "ALL", headcount: 900 }),
      enrolmentRow({ stage: "JHS", classForm: null, sex: "ALL", headcount: 30 }),
    ];
    expect(dominantStage(given)).toBe("PRIMARY");
    expect(dominantStage([])).toBeNull();
  });
});

describe("ptr is re-derived from the two STORED integers, with the numeric(5,2) ceiling named", () => {
  it("rounds half away from zero, exactly as Postgres round(x, 2) does", () => {
    expect(ptrOf(1240, 32, "GH-XX-0001")).toBe("38.75");
    expect(ptrOf(100, 3, "GH-XX-0001")).toBe("33.33");
    expect(ptrOf(200, 3, "GH-XX-0001")).toBe("66.67");
    // The exact-half case a float implementation rounds the other way.
    expect(ptrOf(7, 8, "GH-XX-0001")).toBe("0.88");
    expect(ptrOf(0, 1, "GH-XX-0001")).toBe("0.00");
  });

  it("throws a NAMED per-school error rather than letting numeric field overflow escape the INSERT", () => {
    // Unreachable through the ruled bands (teachers_on_roll = max(1, round(e ÷ target)) keeps ptr at
    // ≈ the target, and the bands top out at 55), which is exactly why the guard is asserted rather
    // than assumed. The message LEADS with the EMIS id so `failureVerdict` does not double-prefix it.
    expect(() => ptrOf(1_000_000, 1, "GH-XX-0009")).toThrow(StaffingTransformError);
    expect(() => ptrOf(1_000_000, 1, "GH-XX-0009")).toThrow(/^GH-XX-0009: ptr .*999\.99/);
    expect(() =>
      buildStaffingRow({
        jurisdictionId: "j",
        periodId: "p",
        emisSchoolId: "GH-XX-0010",
        enrolmentTotal: 500_000,
        teachersOnRoll: 1,
        teachingPostsEstablished: null,
        etlRunId: "r",
        asOfDate: ROSTER_AS_OF,
      }),
    ).toThrow(/^GH-XX-0010: ptr/);
  });

  it("refuses to divide by a zero or non-integer teacher count", () => {
    expect(() => ptrOf(100, 0, "GH-XX-0011")).toThrow(/teachers_on_roll must be an integer/);
  });
});

describe("vacancies is SIGNED and NULL-iff-NULL (ruling §4 — the plan's max(0, …) is overruled)", () => {
  const row = (roll: number, posts: number | null) =>
    buildStaffingRow({
      jurisdictionId: "j",
      periodId: "p",
      emisSchoolId: "GH-XX-0020",
      enrolmentTotal: roll * 30,
      teachersOnRoll: roll,
      teachingPostsEstablished: posts,
      etlRunId: "r",
      asOfDate: ROSTER_AS_OF,
    });

  it("goes NEGATIVE for a school over establishment, instead of flooring at 0", () => {
    expect(row(32, 28).vacancies).toBe(-4);
    expect(row(28, 32).vacancies).toBe(4);
    expect(row(30, 30).vacancies).toBe(0);
  });

  it("is NULL — never 0 — when the establishment is unknown", () => {
    expect(row(30, null).vacancies).toBeNull();
    expect(row(30, null).teachingPostsEstablished).toBeNull();
  });
});

describe("one school's bad figure fails THAT SCHOOL (computePerSchool's contract)", () => {
  it("derives a row for a healthy school and refuses an unpinnable one, by name", () => {
    const target = {
      jurisdictionId: "11111111-1111-4111-8111-111111111111",
      periodId: "22222222-2222-4222-8222-222222222222",
      emisSchoolId: "GH-NR-0100",
      etlRunId: "33333333-3333-4333-8333-333333333333",
      academicYear: ACADEMIC_YEAR,
      asOfDate: ROSTER_AS_OF,
      regionName: "Northern",
      districtName: "Tamale Metropolitan",
      ownershipType: "PUBLIC" as const,
    };
    const good: FactEnrolmentRow[] = [
      {
        jurisdictionId: target.jurisdictionId,
        periodId: target.periodId,
        stage: "PRIMARY",
        classForm: null,
        sex: "ALL",
        headcount: 420,
        source: "OPERATIONAL_AGG",
        asOfDate: ROSTER_AS_OF,
        etlRunId: target.etlRunId,
      },
    ];
    const derived = deriveSchoolStaffing(good, target);
    expect(derived.row).not.toBeNull();
    expect(derived.row!.enrolmentTotal).toBe(420);
    expect(derived.row!.teachersOnRoll).toBeGreaterThanOrEqual(1);
    expect(derived.row!.ptr).toBe(
      ptrOf(420, derived.row!.teachersOnRoll, target.emisSchoolId),
    );
    // Deterministic: the same inputs give the same row, which is the idempotency claim's foundation.
    expect(deriveSchoolStaffing(good, target).row).toEqual(derived.row);

    // ZERO ROLL ⇒ NO ROW (ruling §5), not a 0.00 ptr.
    expect(deriveSchoolStaffing([{ ...good[0]!, headcount: 0 }], target).row).toBeNull();

    expect(() =>
      deriveSchoolStaffing([{ ...good[0]!, headcount: -5 }], target),
    ).toThrow(StaffingTransformError);
  });

  it("gives PRIVATE and MISSION schools NO establishment, and PUBLIC one", () => {
    const base = {
      jurisdictionId: "11111111-1111-4111-8111-111111111111",
      periodId: "22222222-2222-4222-8222-222222222222",
      emisSchoolId: "GH-GA-0200",
      etlRunId: "33333333-3333-4333-8333-333333333333",
      academicYear: ACADEMIC_YEAR,
      asOfDate: ROSTER_AS_OF,
      regionName: "Greater Accra",
      districtName: "Accra Metropolitan",
    };
    const enrolment: FactEnrolmentRow[] = [
      {
        jurisdictionId: base.jurisdictionId,
        periodId: base.periodId,
        stage: "PRIMARY",
        classForm: null,
        sex: "ALL",
        headcount: 600,
        source: "OPERATIONAL_AGG",
        asOfDate: ROSTER_AS_OF,
        etlRunId: base.etlRunId,
      },
    ];
    for (const ownership of ["PRIVATE", "MISSION"] as const) {
      const r = deriveSchoolStaffing(enrolment, { ...base, ownershipType: ownership }).row!;
      expect(r.teachingPostsEstablished).toBeNull();
      expect(r.vacancies).toBeNull();
      expect(r.teachersOnRoll).toBeGreaterThanOrEqual(1);
      expect(Number(r.ptr)).toBeGreaterThan(0);
    }
    const pub = deriveSchoolStaffing(enrolment, {
      ...base,
      ownershipType: "PUBLIC",
    }).row!;
    expect(pub.teachingPostsEstablished).not.toBeNull();
    expect(pub.vacancies).toBe(pub.teachingPostsEstablished! - pub.teachersOnRoll);
  });

  it("prefers the REAL ref_ges_teacher_establishment vintage over a generated figure — PUBLIC only", () => {
    const base = {
      jurisdictionId: "11111111-1111-4111-8111-111111111111",
      periodId: "22222222-2222-4222-8222-222222222222",
      emisSchoolId: "GH-GA-0201",
      etlRunId: "33333333-3333-4333-8333-333333333333",
      academicYear: ACADEMIC_YEAR,
      asOfDate: ROSTER_AS_OF,
      regionName: "Greater Accra",
      districtName: "Accra Metropolitan",
    };
    const enrolment: FactEnrolmentRow[] = [
      {
        jurisdictionId: base.jurisdictionId,
        periodId: base.periodId,
        stage: "JHS",
        classForm: null,
        sex: "ALL",
        headcount: 300,
        source: "OPERATIONAL_AGG",
        asOfDate: ROSTER_AS_OF,
        etlRunId: base.etlRunId,
      },
    ];
    const withRef = deriveSchoolStaffing(enrolment, {
      ...base,
      ownershipType: "PUBLIC",
      refPostsEstablished: 41,
    }).row!;
    expect(withRef.teachingPostsEstablished).toBe(41);
    expect(withRef.vacancies).toBe(41 - withRef.teachersOnRoll);
    // A non-GES school is not on the payroll establishment at all, so a ref figure cannot put it there.
    const privateWithRef = deriveSchoolStaffing(enrolment, {
      ...base,
      ownershipType: "PRIVATE",
      refPostsEstablished: 41,
    }).row!;
    expect(privateWithRef.teachingPostsEstablished).toBeNull();
  });
});

// ── the written rows ────────────────────────────────────────────────────────────────────────────

describe("CRITERIA 1–4 · the grain is school × ANNUAL period, and it is the SAME period row", () => {
  it("every row's period is ANNUAL with term IS NULL, and none is a TERM or EXAM_COHORT", async () => {
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_staffing fs join dim_period p on p.period_id = fs.period_id
       where p.period_type <> 'ANNUAL' or p.term is not null`;
    expect(bad[0]!.n).toBe(0);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("the rows sit on the CURRENT academic year's annual period (is_current, period_type pinned)", async () => {
    const current = await sql<{ period_id: string; academic_year: string }[]>`
      select period_id::text as period_id, academic_year from dim_period
       where is_current and period_type = 'ANNUAL'`;
    expect(current).toHaveLength(1);
    expect(current[0]!.academic_year).toBe(ACADEMIC_YEAR);
    expect([...new Set(rows.map((r) => r.period_id))]).toEqual([current[0]!.period_id]);
  });

  it("is EXACTLY one row per school per period — no duplicate grain key", async () => {
    const dupes = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id from fact_staffing
         group by jurisdiction_id, period_id having count(*) > 1) d`;
    expect(dupes[0]!.n).toBe(0);
    expect(new Set(rows.map((r) => r.jurisdiction_id)).size).toBe(rows.length);
  });

  it("uses the SAME dim_period row fact_enrolment and fact_infrastructure use for that school", async () => {
    const mismatched = await sql<{ n: number }[]>`
      select count(*)::int as n
        from fact_staffing fs
       where not exists (
               select 1 from fact_enrolment fe
                where fe.jurisdiction_id = fs.jurisdiction_id
                  and fe.period_id = fs.period_id)`;
    expect(mismatched[0]!.n).toBe(0);
    const infraPeriods = await sql<{ period_id: string }[]>`
      select distinct period_id::text as period_id from fact_infrastructure`;
    expect(infraPeriods.map((p) => p.period_id)).toContain(rows[0]!.period_id);
  });
});

describe("CRITERION 5 + 19 · a count of teachers, never a teacher — and no sex anywhere", () => {
  it("fact_staffing has NO sex column, and the ETL therefore cannot write one", async () => {
    const columns = (
      await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'fact_staffing'
         order by column_name`
    ).map((c) => c.column_name);
    expect(columns).not.toContain("sex");
    // And no person-shaped column has appeared beside it. `lib/oversight/suppression.ts`'s sexed-staff
    // helper is defined for fact_teacher_attendance / fact_plc_participation ONLY, and the reason it
    // does not apply here is structural rather than a policy choice: there is no sex split to disclose.
    for (const forbidden of ["full_name", "ntc_licence_number", "staff_profile_id", "email"])
      expect(columns).not.toContain(forbidden);
    expect(columns).toEqual([
      "as_of_date",
      "enrolment_total",
      "etl_run_id",
      "fact_id",
      "jurisdiction_id",
      "period_id",
      "ptr",
      "source",
      "teachers_on_roll",
      "teaching_posts_established",
      "vacancies",
    ]);
  });

  it("teachers_on_roll is NOT NULL and ≥ 1 on every emitted row", () => {
    expect(rows.every((r) => Number.isInteger(r.teachers_on_roll))).toBe(true);
    expect(Math.min(...rows.map((r) => r.teachers_on_roll))).toBeGreaterThanOrEqual(1);
  });

  it("publishes PTR for 1- and 2-teacher schools with no small-cell blanking (ruling §7)", () => {
    const tiny = rows.filter((r) => r.teachers_on_roll <= 2);
    // There is no suppression at this grain: `teachers_on_roll` is a school attribute, not a named
    // record. If the demo happens to contain none, the claim is still that none is BLANKED.
    for (const r of tiny) expect(Number(r.ptr)).toBeGreaterThan(0);
    expect(rows.every((r) => r.ptr !== null)).toBe(true);
  });
});

describe("CRITERION 13 + 14 · RECONCILIATION to the enrolment surface, and it is SENSITIVE", () => {
  it("enrolment_total equals Σ headcount at sex='ALL' AND class_form IS NULL, exactly", async () => {
    const off = await sql<
      { emis: string; stored: number; reconciled: number }[]
    >`
      select j.ges_code as emis, fs.enrolment_total as stored,
             coalesce(sum(fe.headcount), 0)::int as reconciled
        from fact_staffing fs
        join dim_jurisdiction j on j.jurisdiction_id = fs.jurisdiction_id
        left join fact_enrolment fe
               on fe.jurisdiction_id = fs.jurisdiction_id
              and fe.period_id = fs.period_id
              and fe.sex = 'ALL'
              and fe.class_form is null
       group by j.ges_code, fs.enrolment_total
      having fs.enrolment_total <> coalesce(sum(fe.headcount), 0)::int`;
    expect(off).toEqual([]);
  });

  it("⚠ DROPPING sex='ALL' BREAKS IT (≈2×) — the test is sensitive to the filter", async () => {
    const [agg] = await sql<{ stored: number; unfiltered: number }[]>`
      select sum(fs.enrolment_total)::int as stored,
             sum(x.n)::int                as unfiltered
        from fact_staffing fs
        join lateral (
          select coalesce(sum(fe.headcount), 0)::int as n from fact_enrolment fe
           where fe.jurisdiction_id = fs.jurisdiction_id
             and fe.period_id = fs.period_id
             and fe.class_form is null) x on true`;
    expect(agg!.unfiltered).not.toBe(agg!.stored);
    expect(agg!.unfiltered / agg!.stored).toBeGreaterThan(1.9);
    expect(agg!.unfiltered / agg!.stored).toBeLessThan(2.1);
  });

  it("⚠ DROPPING class_form IS NULL BREAKS IT TOO — the stage total is not the only row", async () => {
    const [agg] = await sql<{ stored: number; unfiltered: number }[]>`
      select sum(fs.enrolment_total)::int as stored,
             sum(x.n)::int                as unfiltered
        from fact_staffing fs
        join lateral (
          select coalesce(sum(fe.headcount), 0)::int as n from fact_enrolment fe
           where fe.jurisdiction_id = fs.jurisdiction_id
             and fe.period_id = fs.period_id
             and fe.sex = 'ALL') x on true`;
    expect(agg!.unfiltered).not.toBe(agg!.stored);
    expect(agg!.unfiltered / agg!.stored).toBeGreaterThan(1.9);
    expect(agg!.unfiltered / agg!.stored).toBeLessThan(2.1);
  });

  it("agrees with the enrolment arm's own reported headcount for the period, to the pupil", () => {
    const period = report.periods.find((p) => p.academicYear === ACADEMIC_YEAR)!;
    // The staffing arm's `enrolmentTotal` is the enrolment arm's `headcount` MINUS the zero-roll
    // schools (which have no row at all), so it is ≤ and the gap is exactly those schools: zero.
    expect(period.staffing.enrolmentTotal).toBe(period.enrolment.headcount);
    expect(period.staffing.enrolmentTotal).toBe(
      rows.reduce((t, r) => t + r.enrolment_total, 0),
    );
  });

  it("has no school with a staffing row and no reconciling enrolment total, and none the other way", async () => {
    const orphans = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_staffing fs
       where not exists (select 1 from fact_enrolment fe
                          where fe.jurisdiction_id = fs.jurisdiction_id
                            and fe.period_id = fs.period_id
                            and fe.sex = 'ALL' and fe.class_form is null
                            and fe.headcount > 0)`;
    expect(orphans[0]!.n).toBe(0);
    const missing = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select fe.jurisdiction_id, fe.period_id, sum(fe.headcount) as roll
          from fact_enrolment fe
         where fe.sex = 'ALL' and fe.class_form is null
         group by fe.jurisdiction_id, fe.period_id
        having sum(fe.headcount) > 0) rolled
       where not exists (select 1 from fact_staffing fs
                          where fs.jurisdiction_id = rolled.jurisdiction_id
                            and fs.period_id = rolled.period_id)`;
    expect(missing[0]!.n).toBe(0);
  });
});

describe("CRITERION 6 · a reconciled roll of 0 produces NO ROW, and is reported", () => {
  it("lists the zero-roll schools on the outcome instead of publishing a 0.00 ptr", async () => {
    const period = report.periods.find((p) => p.academicYear === ACADEMIC_YEAR)!;
    const zeros = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_staffing where enrolment_total = 0`;
    expect(zeros[0]!.n).toBe(0);
    // Every school the arm looked at either produced a row or is named in `noEnrolment`.
    expect(period.staffing.schoolsComputed + period.staffing.noEnrolment.length).toBe(
      period.enrolment.schoolsComputed,
    );
    for (const emis of period.staffing.noEnrolment) {
      const row = rows.find((r) => r.emis_school_id === emis);
      expect(row).toBeUndefined();
    }
  });
});

describe("CRITERION 7 · ptr is the row's OWN numerator ÷ denominator, re-derived before the write", () => {
  it("equals Postgres round(enrolment_total::numeric / teachers_on_roll, 2) on EVERY row", async () => {
    const off = await sql<{ emis: string; ptr: string; expected: string }[]>`
      select j.ges_code as emis, fs.ptr::text as ptr,
             round(fs.enrolment_total::numeric / fs.teachers_on_roll, 2)::text as expected
        from fact_staffing fs join dim_jurisdiction j on j.jurisdiction_id = fs.jurisdiction_id
       where fs.ptr <> round(fs.enrolment_total::numeric / fs.teachers_on_roll, 2)`;
    expect(off).toEqual([]);
    // And the TypeScript helper the writer used agrees with Postgres on every stored row, so the
    // integer rounding in `ptrOf` is not merely close.
    for (const r of rows)
      expect(r.ptr).toBe(ptrOf(r.enrolment_total, r.teachers_on_roll, r.emis_school_id));
  });

  it("fits numeric(5,2) — no stored ptr is above 999.99", () => {
    expect(Math.max(...rows.map((r) => Number(r.ptr)))).toBeLessThanOrEqual(999.99);
  });

  /**
   * THE PRESENTATION AXIS MUST CONTAIN THE WHOLE GENERATED RANGE (Kofi §10.4). `projectPtr` clamps a
   * value outside `PTR_AXIS` to a rail while the §10.3 equity caption still quotes the TRUE (max−min)
   * gap — so a clamped value makes the bar UNDER-DRAW a gap the prose asserts. The axis comment states
   * the contract ("the axis MUST be widened before plotting any value outside [lo,hi]"), and this is
   * where it can actually be checked: `tests/oversight-child-breakdown.test.ts` can only reach the
   * handful of schools on the small fixture DB, and only at the two tiers its spread bar renders at,
   * whereas THIS file has every row the real generator produces for the full ~849-school demo estate.
   *
   * EVERY row, not a sample: the whole risk is the single outlier school at the tail of the §3 band
   * spread, which is exactly what a sample misses. If this goes red the fix is to widen PTR_AXIS (a
   * STATED owner-movable presentation domain), NEVER to narrow SCHOOL_LEVEL_BANDS — the bands are the
   * data's own ruled distribution, and moving them regenerates the demo dataset.
   */
  it("every generated ptr lies inside PTR_AXIS — no demo value clamps the bar (Kofi §10.4)", () => {
    const values = rows.map((r) => Number(r.ptr));
    expect(values.length).toBeGreaterThan(800); // the full estate, not a fixture handful
    const outside = rows
      .filter((r) => Number(r.ptr) < PTR_AXIS.lo || Number(r.ptr) > PTR_AXIS.hi)
      .map((r) => `${r.emis_school_id}=${r.ptr}`);
    expect(
      outside,
      `PTR_AXIS [${PTR_AXIS.lo}, ${PTR_AXIS.hi}] does not contain the generated range ` +
        `[${Math.min(...values)}, ${Math.max(...values)}] — widen the axis`,
    ).toEqual([]);
  });
});

describe("CRITERIA 10–12 · establishment and vacancies, signed and honestly null", () => {
  it("vacancies = teaching_posts_established − teachers_on_roll wherever the establishment exists", () => {
    for (const r of rows.filter((x) => x.teaching_posts_established !== null))
      expect(r.vacancies).toBe(r.teaching_posts_established! - r.teachers_on_roll);
  });

  it("vacancies IS NULL exactly when teaching_posts_established IS NULL — never 0 for 'unknown'", () => {
    for (const r of rows)
      expect(r.vacancies === null).toBe(r.teaching_posts_established === null);
  });

  it("is NULL for EVERY private and mission school, and NOT NULL for every public one", () => {
    const nonPublicWithPosts = rows.filter(
      (r) => r.ownership_type !== "PUBLIC" && r.teaching_posts_established !== null,
    );
    expect(nonPublicWithPosts).toEqual([]);
    const publicWithout = rows.filter(
      (r) => r.ownership_type === "PUBLIC" && r.teaching_posts_established === null,
    );
    expect(publicWithout).toEqual([]);
    // Both sets are non-empty, so neither assertion can pass vacuously — the demo really does
    // exercise the nullable column (the ~30% PRIVATE/MISSION mix in `scripts/seed-demo-data.ts`).
    expect(rows.filter((r) => r.teaching_posts_established === null).length).toBeGreaterThan(
      0,
    );
    expect(rows.filter((r) => r.teaching_posts_established !== null).length).toBeGreaterThan(
      0,
    );
  });

  it("⚠ CONTAINS BOTH SIGNS — a NEGATIVE vacancy exists, so nothing was floored at 0", () => {
    const negative = rows.filter((r) => r.vacancies !== null && r.vacancies < 0);
    const positive = rows.filter((r) => r.vacancies !== null && r.vacancies > 0);
    // Flooring at max(0, …) — which the ETL plan proposed and the ruling overruled — would erase the
    // surplus half of Ghana's real distribution and leave the national vacancy total unbalanced.
    expect(negative.length).toBeGreaterThanOrEqual(1);
    expect(positive.length).toBeGreaterThanOrEqual(1);
  });

  it("puts the SURPLUS in the urban south and the SHORTAGE in the rural north", () => {
    const share = (predicate: (r: StaffingRow) => boolean) => {
      const set = rows.filter(
        (r) => r.vacancies !== null && r.teaching_posts_established !== null && predicate(r),
      );
      if (set.length === 0) return null;
      return set.filter((r) => r.vacancies! < 0).length / set.length;
    };
    const southMetroUrban = share(
      (r) =>
        SOUTHERN_METRO_REGIONS.includes(r.region_name) &&
        /Metropolitan|Municipal/.test(r.district_name),
    );
    const northRural = share(
      (r) =>
        NORTHERN_REGIONS.includes(r.region_name) &&
        !/Metropolitan|Municipal/.test(r.district_name),
    );
    expect(southMetroUrban).not.toBeNull();
    expect(northRural).not.toBeNull();
    expect(southMetroUrban!).toBeGreaterThan(northRural!);
  });
});

describe("CRITERION 8 + 9 · the demo distribution is realistic, skewed, and gradient-correct", () => {
  /** The band level each school was filed under — recomputed from the written enrolment surface. */
  let bandOf: Map<string, "KG" | "PRIMARY" | "JHS" | "SHS">;

  beforeAll(async () => {
    const stageTotals = await sql<
      { jurisdiction_id: string; stage: string; n: number }[]
    >`
      select jurisdiction_id::text as jurisdiction_id, stage::text as stage,
             sum(headcount)::int as n
        from fact_enrolment
       where sex = 'ALL' and class_form is null
       group by jurisdiction_id, stage`;
    // Ties break by the stage's own order, matching `dominantStage`'s `ANALYTICS_STAGES` walk.
    const order = ["KG", "PRIMARY", "JHS", "SHS"];
    const best = new Map<string, { stage: string; n: number }>();
    for (const stage of order)
      for (const row of stageTotals.filter((r) => r.stage === stage)) {
        const held = best.get(row.jurisdiction_id);
        if (!held || row.n > held.n) best.set(row.jurisdiction_id, row);
      }
    bandOf = new Map(
      [...best.entries()].map(
        ([j, v]) => [j, v.stage as "KG" | "PRIMARY" | "JHS" | "SHS"] as const,
      ),
    );
  });

  it("keeps the pupil-weighted PTR per level inside the ruled band", () => {
    for (const level of ["KG", "PRIMARY", "JHS", "SHS"] as const) {
      const set = rows.filter((r) => bandOf.get(r.jurisdiction_id) === level);
      if (set.length === 0) continue;
      // Σ enrolment ÷ Σ teachers — the ONLY correct way to aggregate PTR (ruling §6). Never avg(ptr).
      const weighted =
        set.reduce((t, r) => t + r.enrolment_total, 0) /
        set.reduce((t, r) => t + r.teachers_on_roll, 0);
      const band = SCHOOL_LEVEL_BANDS[level];
      expect(weighted).toBeGreaterThanOrEqual(band.lo);
      expect(weighted).toBeLessThanOrEqual(band.hi);
      // A handful of per-school outliers is acceptable (ruling AC 8); the BULK must be in band.
      const outOfBand = set.filter(
        (r) => Number(r.ptr) < band.lo - 2 || Number(r.ptr) > band.hi + 2,
      );
      expect((set.length - outOfBand.length) / set.length).toBeGreaterThan(0.9);
      // AND EVERY OUTLIER IS EXPLAINED, which is the part that distinguishes "a handful of honest
      // outliers" from "the band table is wrong". `teachers_on_roll` is an INTEGER, so on a school with
      // a handful of teachers the rounding step is a huge fraction of the band's width: a one-teacher KG
      // with 48 children really does have a PTR of 48, and the honest row says so. If a band were
      // misconfigured the outliers would be spread across schools of every size instead.
      for (const r of outOfBand)
        expect(
          r.teachers_on_roll,
          `${r.emis_school_id} is out of the ${level} band at ptr ${r.ptr} with ` +
            `${r.teachers_on_roll} teachers — too many teachers for integer rounding to explain it`,
        ).toBeLessThanOrEqual(8);
    }
  });

  it("lands the national basic pupil-weighted mean in the ruled 35–40 window", () => {
    const basic = rows.filter((r) => bandOf.get(r.jurisdiction_id) === "PRIMARY");
    expect(basic.length).toBeGreaterThan(0);
    const weighted =
      basic.reduce((t, r) => t + r.enrolment_total, 0) /
      basic.reduce((t, r) => t + r.teachers_on_roll, 0);
    expect(weighted).toBeGreaterThanOrEqual(35);
    expect(weighted).toBeLessThanOrEqual(40);
  });

  it("is NOT degenerate — an above-30 tail exists for PTR-ESC-30 to fire on, and ptr varies", () => {
    expect(rows.filter((r) => Number(r.ptr) > 30).length).toBeGreaterThanOrEqual(1);
    // A bug that pinned every school to its band's midpoint would pass a bounds check and fail this.
    expect(new Set(rows.map((r) => r.ptr)).size).toBeGreaterThanOrEqual(3);
  });

  it("reproduces Ghana's north/south gradient for basic schools (direction matches GES EMIS)", () => {
    const weighted = (set: StaffingRow[]) =>
      set.reduce((t, r) => t + r.enrolment_total, 0) /
      set.reduce((t, r) => t + r.teachers_on_roll, 0);
    const basic = rows.filter((r) => {
      const level = bandOf.get(r.jurisdiction_id);
      return level === "KG" || level === "PRIMARY";
    });
    const north = basic.filter((r) => NORTHERN_REGIONS.includes(r.region_name));
    const south = basic.filter((r) => SOUTHERN_METRO_REGIONS.includes(r.region_name));
    expect(north.length).toBeGreaterThan(0);
    expect(south.length).toBeGreaterThan(0);
    // MATERIALLY higher, not merely higher: the first thing MoE/GES sanity-check is the ranking.
    expect(weighted(north)).toBeGreaterThan(weighted(south) + 5);
  });

  it("covers every reporting school whose reconciled roll is above 0, including the SHS estate", async () => {
    const [coverage] = await sql<{ rolled: number; staffed: number }[]>`
      select (select count(*)::int from (
                select fe.jurisdiction_id from fact_enrolment fe
                 where fe.sex = 'ALL' and fe.class_form is null
                 group by fe.jurisdiction_id having sum(fe.headcount) > 0) r) as rolled,
             (select count(*)::int from fact_staffing) as staffed`;
    expect(coverage!.staffed).toBe(coverage!.rolled);
    // The SHS estate specifically — PTR norms differ enough that an arm that quietly skipped it would
    // still look plausible (ruling §8).
    const shs = rows.filter(
      (r) => schoolByJurisdiction.get(r.jurisdiction_id)?.schoolType === "SHS",
    );
    expect(shs.length).toBeGreaterThan(0);
  });
});

describe("CRITERION 21 · provenance is the DATA's vintage, never the run's clock", () => {
  it("stamps source, the frozen as_of_date and the run id on every row", () => {
    for (const r of rows) {
      expect(r.source).toBe("OPERATIONAL_AGG");
      expect(r.etl_run_id).toBe(report.runId);
      // The SAME vintage the roster was frozen at — `options.rosterAsOf`'s default, the year's ends_on.
      expect(r.as_of_date.startsWith(ROSTER_AS_OF)).toBe(true);
    }
  });
});

describe("CRITERIA 15–18 · the ROLL-UP is Σ÷Σ, and avg(ptr) is a different, wrong number", () => {
  it("a district's Σenrolment ÷ Σteachers does NOT equal the mean of its schools' stored ptr", async () => {
    const districts = await sql<
      { district: string; weighted: string; naive: string; n: number }[]
    >`
      select d.name as district,
             (sum(fs.enrolment_total)::numeric / sum(fs.teachers_on_roll))::text as weighted,
             avg(fs.ptr)::text as naive,
             count(*)::int as n
        from fact_staffing fs
        join dim_jurisdiction s on s.jurisdiction_id = fs.jurisdiction_id
        join dim_jurisdiction d on d.jurisdiction_id = s.parent_id
       group by d.name having count(*) > 2
       order by d.name`;
    expect(districts.length).toBeGreaterThan(0);
    // Not "they happen to differ somewhere" — they differ in the MAJORITY of real districts, because
    // the two formulas weight schools differently by construction.
    const differing = districts.filter(
      (d) => Math.abs(Number(d.weighted) - Number(d.naive)) > 0.01,
    );
    expect(differing.length / districts.length).toBeGreaterThan(0.9);
  });

  it("region and national PTR are exactly the subtree sums, and no tier row is STORED", async () => {
    const [levels] = await sql<{ nonSchool: number }[]>`
      select count(*)::int as "nonSchool"
        from fact_staffing fs join dim_jurisdiction j on j.jurisdiction_id = fs.jurisdiction_id
       where j.level <> 'SCHOOL'`;
    expect(levels!.nonSchool).toBe(0);
    // National = Σ over ALL school rows, regardless of establishment nullability (ruling §17).
    const [national] = await sql<{ e: number; t: number }[]>`
      select sum(enrolment_total)::int as e, sum(teachers_on_roll)::int as t from fact_staffing`;
    expect(national!.e).toBe(rows.reduce((t, r) => t + r.enrolment_total, 0));
    expect(national!.t).toBe(rows.reduce((t, r) => t + r.teachers_on_roll, 0));
    // Region Σ = Σ over its districts' schools — the same number, walked through `parent_id`.
    const [viaRegions] = await sql<{ e: number; t: number }[]>`
      select sum(e)::int as e, sum(t)::int as t from (
        select sum(fs.enrolment_total) as e, sum(fs.teachers_on_roll) as t
          from fact_staffing fs
          join dim_jurisdiction s on s.jurisdiction_id = fs.jurisdiction_id
          join dim_jurisdiction d on d.jurisdiction_id = s.parent_id
          join dim_jurisdiction r on r.jurisdiction_id = d.parent_id
         group by r.jurisdiction_id) x`;
    expect(viaRegions!.e).toBe(national!.e);
    expect(viaRegions!.t).toBe(national!.t);
  });

  it("sums establishment and vacancies ONLY over the rows that HAVE an establishment (ruling §17)", async () => {
    const [agg] = await sql<
      { posts: number; vac: number; withPosts: number; allRows: number }[]
    >`
      select coalesce(sum(teaching_posts_established), 0)::int as posts,
             coalesce(sum(vacancies), 0)::int                  as vac,
             count(teaching_posts_established)::int            as "withPosts",
             count(*)::int                                     as "allRows"
        from fact_staffing`;
    // Postgres `sum`/`count(col)` already skip NULLs; the point of the assertion is that the
    // DENOMINATOR is the non-null count and NOT the row count, so a reader who divides by `count(*)`
    // is describing a base that includes schools GES sets no establishment for.
    expect(agg!.withPosts).toBeLessThan(agg!.allRows);
    const period = report.periods.find((p) => p.academicYear === ACADEMIC_YEAR)!;
    expect(period.staffing.postsEstablished).toBe(agg!.posts);
    expect(period.staffing.vacancies).toBe(agg!.vac);
    expect(period.staffing.postsEstablishedSchools).toBe(agg!.withPosts);
  });

  it("⚠ a cross-period sum is WRONG BY CONSTRUCTION — staffing is a STOCK, not a flow", async () => {
    // Within ONE period the spatial sum is the national figure (asserted above). Across periods there
    // is nothing to add: the same teachers appear in each year, so Σ over two years invents staff.
    // Structurally, the arm only ever files the CURRENT year, which is what makes the wrong sum
    // unavailable rather than merely discouraged.
    const periods = await sql<{ n: number }[]>`
      select count(distinct period_id)::int as n from fact_staffing`;
    expect(periods[0]!.n).toBe(1);
    const nonCurrent = report.periods.filter((p) => p.academicYear !== ACADEMIC_YEAR);
    for (const p of nonCurrent) {
      expect(p.staffing.inserted).toBe(0);
      expect(p.staffing.deleted).toBe(0);
      expect(p.staffing.schoolsComputed).toBe(0);
    }
  });

  it("the LOPSIDED PAIR: 1240/32 = 38.75 weighted vs 30.00 averaged — the two differ by >8 points", async () => {
    // THE EXECUTABLE FORM OF THE READ RULE (ruling §6, plan §6 test 2), and the one test that stops a
    // future query author from "simplifying" a roll-up to avg(ptr). The pair is HAND-BUILT and written
    // through the real writer, because the claim is about what SQL over the real table returns.
    const victims = rows.slice(0, 2);
    const original = victims.map((v) => ({ ...v }));
    const periodId = victims[0]!.period_id;
    const pair = [
      { jurisdictionId: victims[0]!.jurisdiction_id, enrolment: 40, teachers: 2 },
      { jurisdictionId: victims[1]!.jurisdiction_id, enrolment: 1200, teachers: 30 },
    ];
    try {
      await writeStaffingFacts(sql, [
        {
          periodId,
          jurisdictionIds: pair.map((p) => p.jurisdictionId),
          rows: pair.map((p) =>
            buildStaffingRow({
              jurisdictionId: p.jurisdictionId,
              periodId,
              emisSchoolId: "LOPSIDED",
              enrolmentTotal: p.enrolment,
              teachersOnRoll: p.teachers,
              teachingPostsEstablished: null,
              etlRunId: report.runId,
              asOfDate: ROSTER_AS_OF,
            }),
          ),
        },
      ]);
      const [agg] = await sql<{ weighted: string; naive: string }[]>`
        select (sum(enrolment_total)::numeric / sum(teachers_on_roll))::text as weighted,
               avg(ptr)::text as naive
          from fact_staffing
         where jurisdiction_id = any(${pair.map((p) => p.jurisdictionId)}::uuid[])`;
      expect(Number(agg!.weighted)).toBeCloseTo(38.75, 2);
      expect(Number(agg!.naive)).toBeCloseTo(30.0, 2);
      expect(Number(agg!.weighted) - Number(agg!.naive)).toBeGreaterThan(8);
      // ⇒ avg(ptr) weighted the 40-pupil school equally with the 1,200-pupil one. It is plausible,
      //   stable and wrong, and nothing in the output says so. Hence: `ptr` stays OUT of every
      //   roll-up/tier/breakdown column allow-list (`lib/oversight/performance.ts` is the precedent).
    } finally {
      // Restore the two real rows exactly, so the file's later assertions are not reading the fixture.
      await sql`delete from fact_staffing
                 where jurisdiction_id = any(${pair.map((p) => p.jurisdictionId)}::uuid[])
                   and period_id = ${periodId}::uuid`;
      for (const r of original)
        await sql`
          insert into fact_staffing (jurisdiction_id, period_id, teachers_on_roll,
                                     teaching_posts_established, enrolment_total, ptr, vacancies,
                                     source, as_of_date, etl_run_id)
          values (${r.jurisdiction_id}::uuid, ${r.period_id}::uuid, ${r.teachers_on_roll},
                  ${r.teaching_posts_established}, ${r.enrolment_total}, ${r.ptr}::numeric,
                  ${r.vacancies}, ${r.source}::ov_source, ${r.as_of_date}::timestamptz,
                  ${r.etl_run_id}::uuid)`;
    }
  });
});

describe("the POST-INSERT DUPLICATE ASSERTION is the only guard there is, so it has its own test", () => {
  it("THROWS inside the transaction and rolls the whole write back", async () => {
    const victim = rows[0]!;
    const before = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_staffing
       where jurisdiction_id = ${victim.jurisdiction_id}::uuid`;
    expect(before[0]!.n).toBe(1);
    const dup = buildStaffingRow({
      jurisdictionId: victim.jurisdiction_id,
      periodId: victim.period_id,
      emisSchoolId: victim.emis_school_id,
      enrolmentTotal: victim.enrolment_total,
      teachersOnRoll: victim.teachers_on_roll,
      teachingPostsEstablished: victim.teaching_posts_established,
      etlRunId: report.runId,
      asOfDate: ROSTER_AS_OF,
    });
    await expect(
      writeStaffingFacts(sql, [
        {
          periodId: victim.period_id,
          jurisdictionIds: [victim.jurisdiction_id],
          // The SAME grain key twice. `fact_staffing` has no UNIQUE, so Postgres accepts both happily.
          rows: [dup, dup],
        },
      ]),
    ).rejects.toThrow(/duplicated grain key/);
    // ROLLED BACK: the delete went with the insert, so the school still has exactly its ONE prior row.
    const after = await sql<{ n: number; ptr: string }[]>`
      select count(*)::int as n, max(ptr::text) as ptr from fact_staffing
       where jurisdiction_id = ${victim.jurisdiction_id}::uuid`;
    expect(after[0]!.n).toBe(1);
    expect(after[0]!.ptr).toBe(victim.ptr);
    const total = await sql<{ n: number }[]>`select count(*)::int as n from fact_staffing`;
    expect(total[0]!.n).toBe(rows.length);
  });
});

describe("IDEMPOTENCY · a re-run is byte-identical except etl_run_id (and fact_id)", () => {
  /** A school that returned NO roster at all, so the staffing arm never looked at it. */
  let strandedJurisdiction: string | null = null;

  it("replaces rather than duplicates, and every measure + the vintage is unchanged", async () => {
    const fingerprint = async () =>
      (
        await sql<{ f: string }[]>`
          select coalesce(string_agg(line, '|' order by line), '') as f from (
            select jurisdiction_id::text || ':' || period_id::text || ':' ||
                   teachers_on_roll::text || ':' ||
                   coalesce(teaching_posts_established::text, 'NULL') || ':' ||
                   enrolment_total::text || ':' || ptr::text || ':' ||
                   coalesce(vacancies::text, 'NULL') || ':' || source::text || ':' ||
                   as_of_date::text as line
              from fact_staffing) x`
      )[0]!.f;
    const before = await fingerprint();
    const beforeCount = rows.length;

    // STALE-BUT-HONEST, in the same re-run: a school the arm never computed (its roster read returned
    // nothing at all) is OUT of the delete scope, so a prior row for it must SURVIVE the re-run rather
    // than being deleted-and-not-reinserted.
    const period = report.periods.find((p) => p.academicYear === ACADEMIC_YEAR)!;
    const stranded = period.enrolment.noRoster[0];
    if (stranded) {
      const node = await sql<{ jurisdiction_id: string }[]>`
        select jurisdiction_id::text as jurisdiction_id from dim_jurisdiction
         where ges_code = ${stranded} and level = 'SCHOOL'`;
      if (node[0]) {
        strandedJurisdiction = node[0].jurisdiction_id;
        await sql`
          insert into fact_staffing (jurisdiction_id, period_id, teachers_on_roll,
                                     teaching_posts_established, enrolment_total, ptr, vacancies,
                                     source, as_of_date, etl_run_id)
          values (${strandedJurisdiction}::uuid, ${rows[0]!.period_id}::uuid, 7, 9, 210, 30.00, 2,
                  'OPERATIONAL_AGG', ${ROSTER_AS_OF}::timestamptz, ${report.runId}::uuid)`;
      }
    }

    const second = await runEtl();
    expect(second.status).toBe("SUCCESS");
    expect(second.runId).not.toBe(report.runId);

    const after = await readStaffing();
    expect(after.length).toBe(beforeCount + (strandedJurisdiction ? 1 : 0));
    // `fact_id` is defaultRandom() and is NOT part of the grain, so it is deliberately not compared —
    // comparing it would fail the test for the wrong reason.
    const strippedAfter = await sql<{ f: string }[]>`
      select coalesce(string_agg(line, '|' order by line), '') as f from (
        select jurisdiction_id::text || ':' || period_id::text || ':' ||
               teachers_on_roll::text || ':' ||
               coalesce(teaching_posts_established::text, 'NULL') || ':' ||
               enrolment_total::text || ':' || ptr::text || ':' ||
               coalesce(vacancies::text, 'NULL') || ':' || source::text || ':' ||
               as_of_date::text as line
          from fact_staffing
         where jurisdiction_id <> coalesce(${strandedJurisdiction}, '00000000-0000-4000-8000-000000000000')::uuid
        ) x`;
    expect(strippedAfter[0]!.f).toBe(before);
    // …and the ONE thing that did change is the run id, on every refreshed row.
    const refreshed = after.filter((r) => r.jurisdiction_id !== strandedJurisdiction);
    expect(refreshed.every((r) => r.etl_run_id === second.runId)).toBe(true);

    if (strandedJurisdiction) {
      const kept = after.find((r) => r.jurisdiction_id === strandedJurisdiction);
      expect(kept).toBeDefined();
      // Untouched, and still stamped with the EARLIER run — stale, labelled, and honest.
      expect(kept!.etl_run_id).toBe(report.runId);
      expect(kept!.teachers_on_roll).toBe(7);
      await sql`delete from fact_staffing
                 where jurisdiction_id = ${strandedJurisdiction}::uuid`;
    }
    report = second;
    rows = (await readStaffing()).filter(
      (r) => r.jurisdiction_id !== strandedJurisdiction,
    );
  }, 900_000);
});

describe("a FAILED verdict writes NOTHING — across ALL SIX fact tables", () => {
  it("breaches the policy, closes FAILED, and leaves every arm's rows exactly as they were", async () => {
    const counts = async () =>
      (
        await sql<Record<string, number>[]>`
          select (select count(*)::int from fact_staffing)          as staffing,
                 (select count(*)::int from fact_enrolment)         as enrolment,
                 (select count(*)::int from fact_infrastructure)    as infrastructure,
                 (select count(*)::int from fact_performance_exam)  as exams,
                 (select count(*)::int from fact_attendance)        as attendance,
                 (select count(*)::int from fact_fees)              as fees`
      )[0]!;
    const before = await counts();
    const beforeRunId = rows[0]!.etl_run_id;
    expect(before.staffing).toBeGreaterThan(0);
    try {
      // The smallest breach that is still a breach: a zero-tolerance policy plus ONE unaggregatable
      // school. The point is the VERDICT's effect on the WRITE, not the size of the failure.
      await sql.unsafe(`alter type demo_source.sex add value if not exists 'OTHER'`);
      // The victim is chosen FROM THE ROSTER, not from the register, and it must have an ACTIVE child:
      // the register is a DELTA loader, so after several ETL test files it can carry schools whose
      // operational uuid has no rows in THIS file's `demo_source` — mutating one of those would change
      // nothing, the verdict would come back SUCCESS, and the test would pass for the wrong reason or
      // fail for an unrelated one. The affected-row count is asserted for the same reason.
      const victim = (
        await sql<{ op: string }[]>`
          select s.school_id::text as op from demo_source.students s
           join ref_emis_school_register r on r.operational_school_id = s.school_id
          where s.status = 'ACTIVE' and r.on_schoolup
          group by s.school_id order by s.school_id::text limit 1`
      )[0]!;
      expect(victim).toBeDefined();
      const mutated = await sql`
        update demo_source.students set sex = 'OTHER'
         where id in (select id from demo_source.students
                       where school_id = ${victim.op}::uuid and status = 'ACTIVE'
                       order by id limit 1)`;
      expect(mutated.count).toBe(1);
      const failed = await runEtl({ policy: { maxFailureRate: 0 } });
      expect(failed.status).toBe("FAILED");
      expect(failed.errorText).toMatch(/schools failed compute/);
      for (const p of failed.periods) {
        expect(p.staffing.inserted).toBe(0);
        expect(p.staffing.deleted).toBe(0);
      }
      // ⚠ THE SHARED-TRANSACTION PROPERTY. This is the assertion that catches an implementer who gave
      // the staffing arm its own `sql.begin`: the other five tables must be untouched too.
      expect(await counts()).toEqual(before);
      const stillOld = await sql<{ n: number }[]>`
        select count(*)::int as n from fact_staffing where etl_run_id = ${beforeRunId}::uuid`;
      expect(stillOld[0]!.n).toBe(before.staffing);
      const closed = await sql<{ status: string }[]>`
        select status::text as status from etl_run where run_id = ${failed.runId}::uuid`;
      expect(closed[0]!.status).toBe("FAILED");
    } finally {
      await loadDemoSource(sql, dataset);
    }
  }, 900_000);
});

describe("the structural half of the read rule — the stored ptr column stays out of every allow-list", () => {
  it("no oversight read module selects fact_staffing.ptr; the tier reads sum the two counts instead", () => {
    // `SLICE-3-ROLLUP-RULING.md` §1: the DURABLE form of "never avg(ptr)" is to keep the stored per-school
    // `ptr` column out of the allow-list, so a tier query physically cannot select it and must sum the
    // two integer inputs instead — exactly how `lib/oversight/performance.ts` handles `qualification_rate`.
    // The PTR surfacing slice has now landed (ptr.ts + breakdown.ts read fact_staffing), so this is no
    // longer "no staffing read exists"; it is the lasting rule that the one column they must never touch
    // is the stored rate. The offence is selecting `fs.ptr` (the stored column, aliased `fs` in both
    // readers), NOT merely referencing fact_staffing — the readers legitimately sum enrolment_total and
    // teachers_on_roll and re-derive the ratio.
    const dir = join(process.cwd(), "lib/oversight");
    const offenders: string[] = [];
    const staffingReaders: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts")) continue;
      const text = readFileSync(join(dir, file), "utf8");
      // Comment lines are stripped first, so prose that REASONS about the stored ptr (as both readers
      // and suppression.ts do) is not an offence — only a query that selects the column is.
      const code = text
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      if (/from\s+fact_staffing/.test(code)) staffingReaders.push(file);
      // One ALIAS-BLIND guard shared with the three other files that assert this rule (see
      // `selectsStoredPtr` in tests/helpers.ts): the former alias allow-list — `fs|st|fact_staffing`
      // — was evadable by a plain re-alias (`select s.ptr`), which is exactly the smuggling route it
      // was widened to close.
      // …and it is handed the SAME comment-stripped `code` the other three sites pass (Dex N2): the
      // helper narrows to SQL itself, so raw source would also be sound, but one form across four
      // sites means the guard cannot answer differently here than it does there.
      if (selectsStoredPtr(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
    // The surfacing slice HAS landed, so there ARE staffing readers now — the national PTR KPI read and
    // the breakdown PTR column. Asserted so the rule above is understood against real readers, not a vacuum.
    expect(staffingReaders).toContain("ptr.ts");
    expect(staffingReaders).toContain("breakdown.ts");
    // …and each derives the ratio from the two integer counts, never the stored rate.
    for (const file of staffingReaders) {
      const code = readFileSync(join(dir, file), "utf8");
      expect(code).toMatch(/enrolment_total/);
      expect(code).toMatch(/teachers_on_roll/);
    }
    // And the precedent it is modelled on is still in place, so this test is not asserting a vacuum.
    const performance = readFileSync(join(dir, "performance.ts"), "utf8");
    expect(performance).toMatch(/qualification_rate` is absent from it ON PURPOSE/);
  });
});
