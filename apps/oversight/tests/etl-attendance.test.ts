import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { adminDemoAnalytics } from "./helpers";
import {
  DEMO_OUT_OF_WINDOW_MARK_DATE,
  DEMO_TERMS,
  emisExtractFor,
  generateDemoDataset,
  loadDemoSource,
  type DemoClassRow,
  type DemoDataset,
  type DemoSchool,
  type DemoTerm,
} from "@/scripts/seed-demo-data";
import { runOversightEtl, type EtlRunReport } from "@/lib/etl/pipeline";
import {
  ATTENDANCE_STATES,
  AttendanceTransformError,
  aggregateSchoolAttendance,
  assertSchoolAttendanceInvariants,
  attendanceRateOf,
  writeAttendanceFacts,
  type FactAttendanceRow,
} from "@/lib/etl/attendance";
import {
  countMarksOutsideDeclaredTerms,
  readAttendanceMarkGroups,
  type AttendanceMarkGroupRow,
} from "@/lib/etl/attendance-source";
import { classFormOf, stageOf, type AnalyticsStage } from "@/lib/etl/stage";

/**
 * INCREMENT H FOURTH SLICE — `fact_attendance` end-to-end (task H10, Kofi's 22 acceptance criteria).
 *
 * Same posture as the three earlier slices' suites, deliberately: the REAL four-arm pipeline runs over the
 * deterministic demo dataset, every fact row is produced by `aggregateSchoolAttendance` from
 * operational-shaped `attendance_record` / `class` rows, and NOTHING HERE HAND-SEEDS A FACT except where a
 * write-path property can only be staged (the injected duplicate, the bystander delete). The expected
 * figures are HAND-COMPUTED IN TYPESCRIPT from the generated register runs — not read back out of SQL and
 * compared to another SQL query, which would only prove Postgres agrees with itself.
 *
 * ⚠ WHY THE GENERATED DATASET IS A SUFFICIENT EXPECTATION even though the loader picks WHICH pupil gets
 * which mark: `fact_attendance` depends on nothing about a mark except its (class, date, status) COUNT, and
 * the run lists exactly those counts (`DemoAttendanceMarkGroup`). The pupil identities the loader assigns
 * are invisible to every figure — which is itself the privacy claim this slice makes.
 *
 * It runs against the increment-H demo analytics database (`adminDemoAnalytics`) and sorts FIRST among the
 * ETL files ('a' < 'e'), so it sees a database carrying only the migrations and the `dim_stage` config rows.
 */

let sql: postgres.Sql;
let dataset: DemoDataset;
let report: EtlRunReport;

const ACADEMIC_YEAR = DEMO_TERMS[0]!.academicYear;
const FIRST_TERM = DEMO_TERMS[0]!;
const LAST_TERM = DEMO_TERMS[DEMO_TERMS.length - 1]!;

let schoolByEmis: Map<string, DemoSchool>;
/** `${emis}|${term}|${stage}|${class_form}` → hand-computed counts. `class_form` "" = the stage total. */
let expected: Map<string, { enrolled: number; present: number }>;
/** `${emis}|${term}` → marks in a below-KG / unparseable class. In NO row. */
let expectedOutOfScope: Map<string, number>;
let expectedUnmapped: Map<string, number>;
/** `${emis}|${term}` → the max date among marks that reached a row — the expected `as_of_date`. */
let expectedAsOf: Map<string, string>;
/** Marks no declared term window claims. Excluded from every row and TALLIED. */
let expectedOutOfWindow = 0;

const key = (
  emis: string,
  term: number,
  stage: string,
  classForm: string | null,
): string => `${emis}|${term}|${stage}|${classForm ?? ""}`;

function extractText(d: DemoDataset): string {
  return JSON.stringify(emisExtractFor(d));
}

function periodsOption(terms: readonly DemoTerm[] = DEMO_TERMS) {
  return terms.map((t) => ({
    academicYear: t.academicYear,
    term: t.term,
    startsOn: t.startsOn,
    endsOn: t.endsOn,
    isCurrent: t.isCurrent,
  }));
}

async function runEtl(
  over: {
    d?: DemoDataset;
    terms?: readonly DemoTerm[];
    extractText?: string;
    policy?: { maxFailureRate: number };
  } = {},
): Promise<EtlRunReport> {
  return runOversightEtl(sql, {
    emisExtractText: over.extractText ?? extractText(over.d ?? dataset),
    periods: periodsOption(over.terms),
    sourceSchema: "demo_source",
    ...(over.policy ? { policy: over.policy } : {}),
  });
}

/**
 * THE EXPECTATION, RE-DERIVED FROM THE GENERATED REGISTER RUNS IN TYPESCRIPT.
 *
 * It applies the SAME rules the ETL applies — the mark's own class label resolves the stage, PRESENT and
 * LATE are the numerator, ALL FIVE states are the denominator, out-of-scope and unmapped are tallied and
 * never bucketed, and a mark is assigned to the declared term CONTAINING ITS DATE — but over the
 * GENERATOR's objects rather than over anything the pipeline produced. `stageOf`/`classFormOf` are shared
 * on purpose (they ARE the ruling, and `tests/stage.test.ts` pins them against a hand-written table); every
 * COUNT below is independent.
 */
function buildExpectations(d: DemoDataset, terms: readonly DemoTerm[] = DEMO_TERMS): void {
  const classById = new Map<string, DemoClassRow>(d.classes.map((c) => [c.classId, c]));
  const emisByOpId = new Map<string, string>(
    d.schools
      .filter((s) => s.operationalSchoolId)
      .map((s) => [s.operationalSchoolId!, s.emisSchoolId]),
  );
  expected = new Map();
  expectedOutOfScope = new Map();
  expectedUnmapped = new Map();
  expectedAsOf = new Map();
  expectedOutOfWindow = 0;

  const add = (k: string, enrolled: number, present: number) => {
    const held = expected.get(k) ?? { enrolled: 0, present: 0 };
    held.enrolled += enrolled;
    held.present += present;
    expected.set(k, held);
  };

  for (const run of d.attendanceMarks) {
    const marks = run.toRank - run.fromRank + 1;
    const emis = emisByOpId.get(run.schoolId)!;
    // THE TERM WINDOW, applied exactly as the ETL applies it: the declared term containing the date.
    const term = terms.find((t) => run.date >= t.startsOn && run.date <= t.endsOn);
    if (!term) {
      expectedOutOfWindow += marks;
      continue;
    }
    const scope = `${emis}|${term.term}`;
    const klass = classById.get(run.classId)!;
    const stage = stageOf(klass.level, klass.name);
    if (stage === "OUT_OF_SCOPE") {
      expectedOutOfScope.set(scope, (expectedOutOfScope.get(scope) ?? 0) + marks);
      continue;
    }
    if (stage === "UNMAPPED") {
      expectedUnmapped.set(scope, (expectedUnmapped.get(scope) ?? 0) + marks);
      continue;
    }
    const classForm = classFormOf(klass.level, klass.name)!;
    // PRESENT + LATE is the numerator. All five states are the denominator — EXCUSED and MEDICAL IN.
    const present = run.status === "PRESENT" || run.status === "LATE" ? marks : 0;
    add(key(emis, term.term, stage, classForm), marks, present);
    // The stage total, accumulated INDEPENDENTLY of the breakdown rows above — so "total = Σ breakdown" is
    // a claim about the ETL and not a restatement of this loop.
    add(key(emis, term.term, stage, null), marks, present);
    const held = expectedAsOf.get(scope);
    if (!held || run.date > held) expectedAsOf.set(scope, run.date);
  }
}

beforeAll(async () => {
  sql = adminDemoAnalytics();
  dataset = generateDemoDataset();
  await loadDemoSource(sql, dataset);
  schoolByEmis = new Map(dataset.schools.map((s) => [s.emisSchoolId, s]));
  buildExpectations(dataset);
  report = await runEtl();
}, 600_000);

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

// ── helpers over the written facts ──────────────────────────────────────────────────────────────

/** The TERM `dim_period` row one declared term is written against. Pins `period_type`. */
async function termPeriodId(term: number): Promise<string> {
  const rows = await sql<{ period_id: string }[]>`
    select period_id::text as period_id from dim_period
     where academic_year = ${ACADEMIC_YEAR} and term = ${term} and period_type = 'TERM'`;
  expect(rows).toHaveLength(1);
  return rows[0]!.period_id;
}

async function nodeId(level: string, name: string): Promise<string> {
  const rows = await sql<{ jurisdiction_id: string }[]>`
    select jurisdiction_id::text as jurisdiction_id from dim_jurisdiction
     where level = ${level}::jurisdiction_level and name = ${name}`;
  expect(rows).toHaveLength(1);
  return rows[0]!.jurisdiction_id;
}

interface DbAttendanceRow {
  emis: string;
  term: number;
  period_type: string;
  stage: string | null;
  class_form: string | null;
  enrolled_days: number;
  present_days: number;
  attendance_rate: string;
  source: string;
  as_of: string;
}

/** Every written row, keyed back to its EMIS id and its term. The whole table. */
async function allRows(): Promise<DbAttendanceRow[]> {
  return sql<DbAttendanceRow[]>`
    select d.ges_code as emis, dp.term, dp.period_type::text as period_type, f.stage, f.class_form,
           f.enrolled_days, f.present_days, f.attendance_rate::text as attendance_rate,
           f.source::text as source, f.as_of_date::date::text as as_of
      from fact_attendance f
      join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
      join dim_period dp on dp.period_id = f.period_id`;
}

/**
 * SUM the two counts over a jurisdiction SUBTREE — the product's actual roll-up shape.
 *
 * ⚠ THE FILTER IS THE API: ONE `period_id` and `class_form IS NULL`. The unfiltered variant exists only to
 * prove how wrong the unfiltered read is (criterion 9).
 */
async function rollUp(
  rootJurisdictionId: string,
  periodId: string,
  opts: { stage?: string; filtered?: boolean } = {},
): Promise<{ present: number; enrolled: number }> {
  const filtered = opts.filtered !== false;
  const rows = await sql<{ present: number | null; enrolled: number | null }[]>`
    with recursive subtree as (
      select jurisdiction_id from dim_jurisdiction where jurisdiction_id = ${rootJurisdictionId}::uuid
      union all
      select c.jurisdiction_id from dim_jurisdiction c join subtree s on c.parent_id = s.jurisdiction_id
    )
    select sum(f.present_days)::int as present, sum(f.enrolled_days)::int as enrolled
      from fact_attendance f
      join subtree s on s.jurisdiction_id = f.jurisdiction_id
     where f.period_id = ${periodId}::uuid
       and (${opts.stage ?? null}::text is null or f.stage = ${opts.stage ?? null})
       and (${!filtered} or f.class_form is null)`;
  return { present: rows[0]!.present ?? 0, enrolled: rows[0]!.enrolled ?? 0 };
}

/** The hand-computed figure for a set of schools, for ONE term — stage totals only. */
function expectedFigure(
  predicate: (s: DemoSchool) => boolean,
  term: number,
  stage?: AnalyticsStage,
): { present: number; enrolled: number } {
  let present = 0;
  let enrolled = 0;
  for (const [k, tally] of expected) {
    const [emis, rowTerm, rowStage, classForm] = k.split("|");
    if (classForm !== "") continue; // stage totals only — the breakdown would double-count
    if (Number(rowTerm) !== term) continue;
    if (stage && rowStage !== stage) continue;
    if (!predicate(schoolByEmis.get(emis!)!)) continue;
    present += tally.present;
    enrolled += tally.enrolled;
  }
  return { present, enrolled };
}

/**
 * `round(100*p/e, 2)` as the suite's own independent restatement of the rate — integer half-away-from-zero,
 * so it matches Postgres `round()` on exact-half inputs exactly the way the production helper now does. A
 * float `Math.round((p/e) * 10_000)` would disagree on those cases and quietly diverge from the stored value.
 */
function rateOf(present: number, enrolled: number): string {
  const scaled = present * 10_000;
  let whole = Math.floor(scaled / enrolled);
  let rem = scaled - whole * enrolled;
  if (rem < 0) {
    whole -= 1;
    rem += enrolled;
  } else if (rem >= enrolled) {
    whole += 1;
    rem -= enrolled;
  }
  const basisPoints = rem * 2 >= enrolled ? whole + 1 : whole;
  return `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, "0")}`;
}

/** Round-trip a written row back into the shape the writer takes. Used by the write-path tests. */
function factRowFrom(db: Record<string, unknown>, periodId: string): FactAttendanceRow {
  return {
    jurisdictionId: db.jurisdiction_id as string,
    periodId,
    stage: db.stage as AnalyticsStage,
    classForm: (db.class_form as string | null) ?? null,
    enrolledDays: Number(db.enrolled_days),
    presentDays: Number(db.present_days),
    attendanceRate: String(db.attendance_rate),
    source: "OPERATIONAL_AGG",
    asOfDate: (db.as_of_date as Date).toISOString(),
    etlRunId: db.etl_run_id as string,
  };
}

async function fingerprint(): Promise<string> {
  const rows = await sql<{ f: string }[]>`
    select md5(string_agg(t.row, '|' order by t.row)) as f
      from (select (to_jsonb(f) - 'fact_id' - 'etl_run_id')::text as row from fact_attendance f) t`;
  return rows[0]!.f;
}

async function rowCount(): Promise<number> {
  return (await sql<{ n: number }[]>`select count(*)::int as n from fact_attendance`)[0]!.n;
}

function moduleText(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

/** Block and line comments removed, so a DOCUMENTED name is not mistaken for a REFERENCED one. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The pure transform's target, for the unit-level blocks. */
const TARGET = {
  jurisdictionId: "10000000-0000-4000-8000-000000000011",
  periodId: "20000000-0000-4000-8000-000000000001",
  emisSchoolId: "GH-TEST-0001",
  etlRunId: "30000000-0000-4000-8000-0000000000aa",
  termEndsOn: "2026-04-02",
};

const group = (over: Partial<AttendanceMarkGroupRow>): AttendanceMarkGroupRow => ({
  schoolId: "a1000000-0000-4000-8000-000000000001",
  classLevel: "Primary 4",
  className: "Primary 4",
  status: "PRESENT",
  marks: 1,
  lastMarkDate: "2026-02-17",
  ...over,
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RATE: ITS NUMERATOR, ITS DENOMINATOR AND ITS THREE STORED COLUMNS (criteria 1, 2, 3, 4)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the run writes a FOURTH fact table under one verdict (criteria 1, 2, 3)", () => {
  it("reaches SUCCESS with nothing to confess, and reports every declared term", async () => {
    expect(report.status).toBe("SUCCESS");
    expect(report.errorText).toBeNull();
    expect(report.terms).toHaveLength(DEMO_TERMS.length);
    for (const [i, term] of report.terms.entries()) {
      expect(term).toMatchObject({
        academicYear: DEMO_TERMS[i]!.academicYear,
        term: DEMO_TERMS[i]!.term,
        periodType: "TERM",
        startsOn: DEMO_TERMS[i]!.startsOn,
        endsOn: DEMO_TERMS[i]!.endsOn,
        failures: [],
      });
      expect(term.inserted).toBeGreaterThan(1_000);
      expect(term.schoolsComputed).toBeGreaterThan(500);
    }
    // All four arms wrote in the SAME run.
    const counts = (
      await sql<{ infra: number; enrol: number; attend: number }[]>`
        select (select count(*)::int from fact_infrastructure) as infra,
               (select count(*)::int from fact_enrolment)      as enrol,
               (select count(*)::int from fact_attendance)     as attend`
    )[0]!;
    expect(counts.infra).toBeGreaterThan(0);
    expect(counts.enrol).toBeGreaterThan(0);
    expect(counts.attend).toBe(
      report.terms.reduce((t, term) => t + term.inserted, 0),
    );
  });

  it("CRITERION 1+2 · EVERY written row equals the hand-computed counts for its (school, term, stage, class_form)", async () => {
    const rows = await allRows();
    expect(rows.length).toBeGreaterThan(1_000);
    let checked = 0;
    for (const row of rows) {
      const tally = expected.get(
        key(row.emis, Number(row.term), row.stage!, row.class_form),
      );
      expect(
        tally,
        `no expectation for ${row.emis} term ${row.term} ${row.stage}/${row.class_form}`,
      ).toBeTruthy();
      // present_days = PRESENT + LATE; enrolled_days = ALL FIVE STATES (EXCUSED and MEDICAL INCLUDED).
      expect(Number(row.present_days)).toBe(tally!.present);
      expect(Number(row.enrolled_days)).toBe(tally!.enrolled);
      // CRITERION 3: the rate is the one the row's own counts imply, to 2dp.
      expect(row.attendance_rate).toBe(rateOf(tally!.present, tally!.enrolled));
      expect(row.source).toBe("OPERATIONAL_AGG");
      checked += 1;
    }
    expect(checked).toBe(rows.length);
    // …and nothing the expectation holds is MISSING from the table (the other direction).
    const written = new Set(
      rows.map((r) => key(r.emis, Number(r.term), r.stage!, r.class_form)),
    );
    const missing = [...expected.keys()].filter((k) => !written.has(k));
    expect(missing).toEqual([]);
  });

  it("CRITERION 1 · a MIXED-state group confirms LATE is PRESENT and EXCUSED/MEDICAL/ABSENT are not", () => {
    // The decisive fixture, status by status: only the LATE run moves `present_days`.
    const base = [
      group({ status: "PRESENT", marks: 40 }),
      group({ status: "EXCUSED", marks: 3 }),
      group({ status: "MEDICAL", marks: 2 }),
      group({ status: "ABSENT", marks: 5 }),
    ];
    const without = aggregateSchoolAttendance(base, TARGET);
    const withLate = aggregateSchoolAttendance(
      [...base, group({ status: "LATE", marks: 7 })],
      TARGET,
    );
    const p4 = (r: ReturnType<typeof aggregateSchoolAttendance>) =>
      r.rows.find((x) => x.classForm === "P4")!;
    expect(p4(without)).toMatchObject({ presentDays: 40, enrolledDays: 50 });
    // LATE adds to BOTH counts — it is a child who was in school.
    expect(p4(withLate)).toMatchObject({ presentDays: 47, enrolledDays: 57 });
    // EXCUSED, MEDICAL and ABSENT add to the DENOMINATOR ONLY.
    expect(p4(without).enrolledDays - p4(without).presentDays).toBe(10);
  });

  it("CRITERION 2 · EXCUSED and MEDICAL stay IN the denominator — removing them would raise the rate", () => {
    const all = aggregateSchoolAttendance(
      [
        group({ status: "PRESENT", marks: 80 }),
        group({ status: "EXCUSED", marks: 10 }),
        group({ status: "MEDICAL", marks: 10 }),
      ],
      TARGET,
    );
    const total = all.rows.find((r) => r.classForm === null)!;
    expect(total).toMatchObject({
      presentDays: 80,
      enrolledDays: 100,
      attendanceRate: "80.00",
    });
    // The rate a "remove the excused" reading would have produced, stated so the choice is visible: a
    // school whose pupils are chronically ill or routinely excused would read 100%.
    expect(rateOf(80, 80)).toBe("100.00");
  });

  it("CRITERION 3 · the stated fixture P=70 L=5 E=5 M=5 A=15 → present 75, enrolled 100, rate 75.00", () => {
    const result = aggregateSchoolAttendance(
      [
        group({ status: "PRESENT", marks: 70 }),
        group({ status: "LATE", marks: 5 }),
        group({ status: "EXCUSED", marks: 5 }),
        group({ status: "MEDICAL", marks: 5 }),
        group({ status: "ABSENT", marks: 15 }),
      ],
      TARGET,
    );
    // The breakdown row AND the stage total, both from the same 100 marks.
    for (const row of result.rows)
      expect(row).toMatchObject({
        stage: "PRIMARY",
        presentDays: 75,
        enrolledDays: 100,
        attendanceRate: "75.00",
      });
    expect(result.rows.map((r) => r.classForm)).toEqual(["P4", null]);
    expect(result.markedDays).toBe(100);
  });

  it("CRITERION 3 · the rate is numeric(5,2), rounded, and NEVER stored from a rate", async () => {
    // The stored column really is a 2dp numeric, and every stored value is the one its own counts imply.
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_attendance
       where attendance_rate
             <> round(100.0 * present_days / nullif(enrolled_days, 0), 2)`;
    expect(bad[0]!.n).toBe(0);
    const type = await sql<{ data_type: string; precision: number; scale: number }[]>`
      select data_type, numeric_precision as precision, numeric_scale as scale
        from information_schema.columns
       where table_schema = 'public' and table_name = 'fact_attendance'
         and column_name = 'attendance_rate'`;
    expect(type[0]).toMatchObject({ data_type: "numeric", precision: 5, scale: 2 });
    // Rounding, not truncation: 2/3 is 66.67.
    expect(attendanceRateOf(2, 3)).toBe("66.67");
    // A group with NO marked pupil-days produces NO ROW — so the rate is never asked for, and asking
    // THROWS rather than fabricating a 0.00 that would read as "nobody attended".
    expect(() => attendanceRateOf(0, 0)).toThrow(AttendanceTransformError);
    const empty = aggregateSchoolAttendance([group({ marks: 0 })], TARGET);
    expect(empty.rows).toEqual([]);
  });

  it("CRITERION 4 · the table stores ONLY the two counts and the rate — no excused/medical/absent column", async () => {
    const columns = (
      await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'fact_attendance'`
    )
      .map((c) => c.column_name)
      .sort();
    expect(columns).toEqual(
      [
        // the grain
        "jurisdiction_id",
        "period_id",
        "stage",
        "class_form",
        // the measures
        "enrolled_days",
        "present_days",
        "attendance_rate",
        // provenance + the surrogate key
        "source",
        "as_of_date",
        "etl_run_id",
        "fact_id",
      ].sort(),
    );
    // The two-state model is PHYSICAL: there is nowhere to put a medical/truancy split, which is the
    // documented limitation of this grain rather than a missing feature.
    for (const absent of ["excused_days", "medical_days", "absent_days", "reason_code"])
      expect(columns).not.toContain(absent);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE GRAIN, THE STAGE TOTALS AND THE READER RULE (criteria 5, 6, 7, 8, 9)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the grain is (jurisdiction, period, stage, class_form) and carries NO sex (criteria 5, 7)", () => {
  it("CRITERION 5 · there is no sex column, and no grain key repeats", async () => {
    const columns = (
      await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'fact_attendance'`
    ).map((c) => c.column_name);
    expect(columns).not.toContain("sex");
    // Attendance is not sex-split in this slice, and the source read never touches a pupil attribute at
    // all — so a half-filled sex column is structurally impossible rather than merely absent.
    expect(stripComments(moduleText("lib/etl/attendance.ts"))).not.toMatch(/\bsex\b/);
    const dupes = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id, stage, class_form is null, coalesce(class_form, '')
          from fact_attendance
         group by 1, 2, 3, 4, 5 having count(*) > 1
      ) d`;
    expect(dupes[0]!.n).toBe(0);
  });

  it("CRITERION 7 · every row carries a NON-NULL stage, and no stage-NULL whole-school row exists", async () => {
    const nulls = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_attendance where stage is null`;
    expect(nulls[0]!.n).toBe(0);
    // Every stage is a dim_stage key (the FK would catch it, but the FK permits NULL — which is the point).
    const stages = await sql<{ stage: string }[]>`
      select distinct stage from fact_attendance order by stage`;
    expect(stages.map((s) => s.stage)).toEqual(["JHS", "KG", "PRIMARY", "SHS"]);
    // The column IS nullable — that is HEADROOM for a future whole-school grain, and the ruling says so in
    // as many words rather than leaving the nullability to read as a gap.
    const nullable = await sql<{ is_nullable: string }[]>`
      select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'fact_attendance' and column_name = 'stage'`;
    expect(nullable[0]!.is_nullable).toBe("YES");
    expect(moduleText("lib/etl/attendance.ts")).toMatch(
      /nullability[\s*\n]+is headroom, not a gap/i,
    );
  });
});

describe("the stage totals and the reader rule (criteria 6, 9)", () => {
  it("CRITERION 6 · per stage: class_form rows PLUS one class_form IS NULL total that really totals them", async () => {
    // Asserted over EVERY (school, term, stage) in the table, on BOTH counts — a stale total is the exact
    // failure mode materialising it exposes this slice to.
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id, stage,
               sum(case when class_form is null then present_days end)  as total_present,
               sum(case when class_form is not null then present_days end) as breakdown_present,
               sum(case when class_form is null then enrolled_days end) as total_enrolled,
               sum(case when class_form is not null then enrolled_days end) as breakdown_enrolled,
               count(*) filter (where class_form is null) as totals
          from fact_attendance group by 1, 2, 3
      ) x
       where total_present is distinct from breakdown_present
          or total_enrolled is distinct from breakdown_enrolled
          or totals <> 1`;
    expect(bad[0]!.n).toBe(0);

    // And the same claim against the HAND-COMPUTED figures for one real school, so the SQL above is not
    // merely Postgres agreeing with itself.
    const sample = (
      await sql<{ emis: string }[]>`
        select d.ges_code as emis from fact_attendance f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
         group by d.ges_code having count(*) >= 6 order by d.ges_code limit 1`
    )[0]!;
    const rows = (await allRows()).filter(
      (r) => r.emis === sample.emis && Number(r.term) === FIRST_TERM.term,
    );
    expect(rows.length).toBeGreaterThan(2);
    for (const stage of new Set(rows.map((r) => r.stage!))) {
      const total = rows.find((r) => r.stage === stage && r.class_form === null)!;
      const hand = expected.get(key(sample.emis, FIRST_TERM.term, stage, null))!;
      expect(Number(total.present_days)).toBe(hand.present);
      expect(Number(total.enrolled_days)).toBe(hand.enrolled);
    }
  });

  it("CRITERION 9 · a roll-up MUST filter class_form IS NULL — the filtered sum matches, the unfiltered DOUBLES", async () => {
    const period = await termPeriodId(FIRST_TERM.term);
    const district = schoolByEmis.get([...expected.keys()][0]!.split("|")[0]!)!.districtName;
    const districtId = await nodeId("DISTRICT", district);
    const hand = expectedFigure((s) => s.districtName === district, FIRST_TERM.term);

    const filtered = await rollUp(districtId, period);
    expect(filtered.present).toBe(hand.present);
    expect(filtered.enrolled).toBe(hand.enrolled);

    // THE OTHER DIRECTION: the unfiltered read is WRONG, and wrong by exactly the breakdown — i.e. it
    // counts every pupil-day twice (once in its class_form row, once in the stage total).
    const unfiltered = await rollUp(districtId, period, { filtered: false });
    expect(unfiltered.enrolled).toBe(hand.enrolled * 2);
    expect(unfiltered.present).toBe(hand.present * 2);
    // …yet its RATE is unchanged, which is why an unfiltered read is so hard to notice: the doubling
    // cancels in the ratio.
    expect(rateOf(unfiltered.present, unfiltered.enrolled)).toBe(
      rateOf(filtered.present, filtered.enrolled),
    );

    // A whole-school figure is Σ ITS STAGE TOTALS — there is no stage-NULL row to read instead.
    const school = [...expected.keys()][0]!.split("|")[0]!;
    const schoolRows = (await allRows()).filter(
      (r) => r.emis === school && Number(r.term) === FIRST_TERM.term,
    );
    const wholeSchool = schoolRows
      .filter((r) => r.class_form === null)
      .reduce(
        (t, r) => ({
          present: t.present + Number(r.present_days),
          enrolled: t.enrolled + Number(r.enrolled_days),
        }),
        { present: 0, enrolled: 0 },
      );
    const handSchool = expectedFigure(
      (s) => s.emisSchoolId === school,
      FIRST_TERM.term,
    );
    expect(wholeSchool).toEqual(handSchool);
  });
});

describe("the stage mapping is REUSED, and the two non-stages are tallied (criterion 8)", () => {
  it("CRITERION 8 · the transform calls stageOf/classFormOf and re-implements no label parsing", () => {
    const code = stripComments(moduleText("lib/etl/attendance.ts"));
    expect(code).toContain('from "./stage"');
    expect(code).toContain("stageOf(group.classLevel, group.className)");
    expect(code).toContain("classFormOf(group.classLevel, group.className)");
    // No second copy of the mapping: no tier keyword, no label regex and no year-range arithmetic anywhere
    // in this module. `lib/etl/stage.ts` is the single place the ruling lives (and tests/stage.test.ts
    // pins it against a hand-written table of 65 labels).
    for (const forbidden of ["NURSERY", "KINDERGARTEN", "KINDER", "BASIC", "OUT_OF_SCOPE_RE"])
      expect(code).not.toContain(forbidden);
    expect(code).not.toMatch(/\/\\b\(\?:/); // no tier-keyword regex literal
  });

  it("CRITERION 8 · a Nursery class's marks are OUT OF SCOPE: tallied, in NO row, school NOT failed", async () => {
    // Planted by the roster generator at index % 97 — real children, taught below KG, outside the GES
    // ladder `dim_stage` describes. The marks exist and must be visibly accounted for.
    const term = report.terms[0]!;
    expect(term.outOfScopeMarks).toBe(
      [...expectedOutOfScope.entries()]
        .filter(([k]) => k.endsWith(`|${FIRST_TERM.term}`))
        .reduce((t, [, n]) => t + n, 0),
    );
    expect(term.outOfScopeMarks).toBeGreaterThan(0);
    expect(term.failures).toEqual([]);
    // Not one row carries a Nursery figure: `stageOf` returns OUT_OF_SCOPE and the transform `continue`s.
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_attendance where class_form ilike '%nursery%'`;
    expect(rows[0]!.n).toBe(0);
  });

  it("CRITERION 8 · an unparseable class's marks are UNMAPPED: tallied, in NO row, school NOT failed", async () => {
    const term = report.terms[0]!;
    expect(term.unmappedMarks).toBe(
      [...expectedUnmapped.entries()]
        .filter(([k]) => k.endsWith(`|${FIRST_TERM.term}`))
        .reduce((t, [, n]) => t + n, 0),
    );
    expect(term.unmappedMarks).toBeGreaterThan(0);
    expect(term.failures).toEqual([]);
  });

  it("neither tally is bucketed into a stage: rows + out-of-scope + unmapped = every marked pupil-day", () => {
    // The accounting identity for one term, over the whole country: the marks the reader returned are
    // exactly the marks in the stage rows plus the two tallies. Nothing is coerced and nothing vanishes.
    const term = report.terms[0]!;
    const inRows = expectedFigure(() => true, FIRST_TERM.term).enrolled;
    const tallied = term.outOfScopeMarks + term.unmappedMarks;
    expect(term.enrolledDays).toBe(inRows);
    // Every mark dated in the window, from the generator — the independent total.
    const windowed = dataset.attendanceMarks
      .filter((m) => m.date >= FIRST_TERM.startsOn && m.date <= FIRST_TERM.endsOn)
      .reduce((t, m) => t + (m.toRank - m.fromRank + 1), 0);
    expect(inRows + tallied).toBe(windowed);
  });

  it("the pure transform refuses a mark state outside the five, naming the drift", () => {
    expect(() =>
      aggregateSchoolAttendance([group({ status: "HOLIDAY", marks: 3 })], TARGET),
    ).toThrow(/outside the allow-list/);
    expect(ATTENDANCE_STATES).toEqual([
      "PRESENT",
      "ABSENT",
      "LATE",
      "EXCUSED",
      "MEDICAL",
    ]);
    // A negative or fractional count is refused too, rather than subtracting pupil-days from a district.
    expect(() => aggregateSchoolAttendance([group({ marks: -1 })], TARGET)).toThrow(
      AttendanceTransformError,
    );
    expect(() => aggregateSchoolAttendance([group({ marks: 1.5 })], TARGET)).toThrow(
      AttendanceTransformError,
    );
  });

  it("the invariant checker catches a tampered stage total and a stale rate", () => {
    const result = aggregateSchoolAttendance(
      [
        group({ status: "PRESENT", marks: 20 }),
        group({ classLevel: "Primary 5", className: "Primary 5", marks: 10 }),
      ],
      TARGET,
    );
    expect(result.rows).toHaveLength(3); // P4, P5, and the PRIMARY total
    // The total is understated by one pupil-day. It has to be a SUBTRACTION rather than an addition: a
    // total one ABOVE its breakdown would also be one above its own enrolled_days, and the `present ≤
    // enrolled` claim would fire first — so the tamper would not be testing the claim it is aimed at.
    const tampered = {
      ...result,
      rows: result.rows.map((r) =>
        r.classForm === null
          ? {
              ...r,
              presentDays: r.presentDays - 1,
              // The rate is moved WITH it, so the per-row rate check cannot fire first and the assertion
              // under test is really the total-vs-breakdown one.
              attendanceRate: attendanceRateOf(r.presentDays - 1, r.enrolledDays),
            }
          : r,
      ),
    };
    expect(() => assertSchoolAttendanceInvariants(tampered, "GH-TEST-0001")).toThrow(
      /total present_days/,
    );
    const stale = {
      ...result,
      rows: result.rows.map((r) => ({ ...r, attendanceRate: "99.99" })),
    };
    expect(() => assertSchoolAttendanceInvariants(stale, "GH-TEST-0001")).toThrow(
      /RE-DERIVED/,
    );
    // present_days can never exceed enrolled_days — a rate above 100% is refused at the source.
    expect(() =>
      assertSchoolAttendanceInvariants(
        {
          ...result,
          rows: result.rows.map((r) => ({ ...r, presentDays: r.enrolledDays + 1 })),
        },
        "GH-TEST-0001",
      ),
    ).toThrow(/present days are a SUBSET/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TERM GRAIN, THE WINDOW AND THE FLOW (criteria 10, 11, 12, 13)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the period is TERM, one row-set per declared term (criterion 10)", () => {
  it("CRITERION 10 · every row is at a TERM period, and NO ANNUAL attendance row is materialised", async () => {
    const byType = await sql<{ period_type: string; term: number | null; n: number }[]>`
      select dp.period_type::text as period_type, dp.term, count(*)::int as n
        from fact_attendance f join dim_period dp on dp.period_id = f.period_id
       group by 1, 2 order by 2`;
    expect(byType.map((r) => [r.period_type, r.term])).toEqual(
      DEMO_TERMS.map((t) => ["TERM", t.term]),
    );
    // ⚠ THE RULING MADE EXECUTABLE: there is NO ANNUAL attendance row. The year's figure is a reader-side
    // SUM of the term rows (attendance is a FLOW), not a second materialised copy.
    const annual = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_attendance f
        join dim_period dp on dp.period_id = f.period_id
       where dp.period_type <> 'TERM'`;
    expect(annual[0]!.n).toBe(0);
    // …while the ANNUAL rows the OTHER arms write are still there, at the same academic year — so this is
    // the attendance ruling, not an absent period.
    const annualPeriod = await sql<{ n: number }[]>`
      select count(*)::int as n from dim_period
       where academic_year = ${ACADEMIC_YEAR} and period_type = 'ANNUAL'`;
    expect(annualPeriod[0]!.n).toBe(1);
  });

  // ⚠ THE REFUSAL IS NOW A SHARED RUN PRECONDITION, NOT THIS ARM'S OWN (`assertTermWindowsDeclared`,
  // pipeline step 2). It used to be one guard per term-grained arm, so WHICH message a reader saw
  // depended on the order the arms happen to run in — and adding the PLC arm, which runs earlier,
  // changed it. The message asserted here is the single one every term-grained arm now shares;
  // `tests/etl-plc.test.ts` asserts the same refusal from the PLC side.
  it("an undated TERM spec is REFUSED by name — a flow cannot be aggregated over an empty window", async () => {
    await expect(
      runOversightEtl(sql, {
        emisExtractText: extractText(dataset),
        periods: [
          { academicYear: ACADEMIC_YEAR, term: 1, isCurrent: true },
          ...periodsOption().slice(1),
        ],
        sourceSchema: "demo_source",
      }),
    ).rejects.toThrow(/no TERM-grained fact has a window to aggregate over/);
    // The dates-less upsert nulled that TERM row's window, so restore the dated baseline for what follows.
    await runEtl();
  }, 600_000);
});

describe("each mark is assigned to the term containing its date (criteria 11, 13)", () => {
  it("CRITERION 11 · a term's figures are exactly the marks dated inside ITS window", async () => {
    for (const term of DEMO_TERMS) {
      const hand = expectedFigure(() => true, term.term);
      const outcome = report.terms.find((t) => t.term === term.term)!;
      expect(outcome.enrolledDays).toBe(hand.enrolled);
      expect(outcome.presentDays).toBe(hand.present);
      // The written rows agree with the outcome — and the two terms' figures DIFFER, so the windowing is
      // doing work rather than reading the same marks twice.
      const national = await nodeId("NATIONAL", "Ghana");
      const written = await rollUp(national, await termPeriodId(term.term));
      expect(written).toEqual({ present: hand.present, enrolled: hand.enrolled });
    }
    expect(report.terms[0]!.enrolledDays).not.toBe(report.terms[1]!.enrolledDays);
  });

  it("CRITERION 11 · a mark OUTSIDE every declared window is EXCLUDED and TALLIED, never silently dropped", async () => {
    // The demo plants a holiday register (index % 127) in the Christmas break between the two terms.
    expect(expectedOutOfWindow).toBeGreaterThan(0);
    expect(report.attendanceOutOfWindowMarks).toBe(expectedOutOfWindow);
    // The marks really are there in the source, and really are in no term.
    const holiday = await sql<{ n: number }[]>`
      select count(*)::int as n from demo_source.attendance_record
       where date = ${DEMO_OUT_OF_WINDOW_MARK_DATE}::date`;
    expect(holiday[0]!.n).toBe(expectedOutOfWindow);
    for (const term of DEMO_TERMS)
      expect(
        DEMO_OUT_OF_WINDOW_MARK_DATE >= term.startsOn &&
          DEMO_OUT_OF_WINDOW_MARK_DATE <= term.endsOn,
      ).toBe(false);
    // And they are in NO fact row: the national enrolled_days over both terms is short by exactly them.
    const national = await nodeId("NATIONAL", "Ghana");
    let written = 0;
    for (const term of DEMO_TERMS)
      written += (await rollUp(national, await termPeriodId(term.term))).enrolled;
    const allMarks = dataset.attendanceMarks.reduce(
      (t, m) => t + (m.toRank - m.fromRank + 1),
      0,
    );
    const tallied =
      report.terms.reduce((t, x) => t + x.outOfScopeMarks + x.unmappedMarks, 0) +
      report.attendanceOutOfWindowMarks;
    expect(written + tallied).toBe(allMarks);
  });

  it("CRITERION 13 · as_of_date is the MAX INCLUDED MARK DATE, never now()", async () => {
    const rows = await sql<{ emis: string; term: number; as_of: string }[]>`
      select d.ges_code as emis, dp.term, max(f.as_of_date)::date::text as as_of
        from fact_attendance f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
        join dim_period dp on dp.period_id = f.period_id
       group by 1, 2`;
    expect(rows.length).toBeGreaterThan(500);
    for (const row of rows)
      expect(row.as_of).toBe(expectedAsOf.get(`${row.emis}|${row.term}`));
    // Every vintage is a real mark date inside its own term window — and NOT today.
    const today = new Date().toISOString().slice(0, 10);
    const vintages = await sql<{ as_of: string }[]>`
      select distinct as_of_date::date::text as as_of from fact_attendance order by as_of`;
    expect(vintages.map((v) => v.as_of)).not.toContain(today);
    expect(vintages.length).toBeGreaterThan(1); // one per term's last marked day

    // The FALLBACK half, where no mark reached a row: the term's own `ends_on`, not the clock.
    const fallback = aggregateSchoolAttendance(
      [group({ classLevel: "Nursery 1", className: "Nursery 1", marks: 4 })],
      TARGET,
    );
    expect(fallback.rows).toEqual([]);
    expect(fallback.asOfDate).toBe(TARGET.termEndsOn);
  });

  it("CRITERION 13 · a re-run over unchanged marks is BYTE-IDENTICAL, and REPLACES rather than appends", async () => {
    const before = await fingerprint();
    const countBefore = await rowCount();
    const second = await runEtl();
    expect(second.status).toBe("SUCCESS");
    expect(second.runId).not.toBe(report.runId);
    expect(await fingerprint()).toBe(before);
    expect(await rowCount()).toBe(countBefore);
    for (const term of second.terms) expect(term.deleted).toBe(term.inserted);
    // Provenance moved even though the measures did not — the rows were really rewritten.
    const stamped = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_attendance where etl_run_id = ${second.runId}::uuid`;
    expect(stamped[0]!.n).toBe(countBefore);
  }, 600_000);

  it("a CHANGED register moves the figure, with the row count unchanged", async () => {
    // "Byte-identical" is necessary but not sufficient: a pipeline that inserted nothing on the second run
    // would pass it. Change the source and the figure must MOVE — including the stage total.
    const victim = (
      await sql<{ emis: string; op: string; class_form: string; present: number }[]>`
        select d.ges_code as emis, r.operational_school_id::text as op, f.class_form,
               f.present_days as present
          from fact_attendance f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
          join ref_emis_school_register r on r.emis_school_id = d.ges_code
          join dim_period dp on dp.period_id = f.period_id
         where f.stage = 'PRIMARY' and f.class_form = 'P1' and dp.term = ${LAST_TERM.term}
         order by d.ges_code limit 1`
    )[0]!;
    const countBefore = await rowCount();
    try {
      // Turn five of that class's PRESENT marks into ABSENT: `present_days` falls by 5 and
      // `enrolled_days` does NOT move (both states are in the denominator).
      await sql`
        update demo_source.attendance_record
           set status = 'ABSENT'
         where id in (
           select a.id from demo_source.attendance_record a
             join demo_source.class c on c.school_id = a.school_id and c.id = a.class_id
            where a.school_id = ${victim.op}::uuid and a.status = 'PRESENT'
              and c.level in ('Primary 1', 'Class 1', 'Basic 1')
              and a.date between ${LAST_TERM.startsOn}::date and ${LAST_TERM.endsOn}::date
            order by a.id limit 5)`;
      const rerun = await runEtl();
      expect(rerun.status).toBe("SUCCESS");
      const after = await sql<{ present: number; enrolled: number }[]>`
        select f.present_days as present, f.enrolled_days as enrolled from fact_attendance f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
          join dim_period dp on dp.period_id = f.period_id
         where d.ges_code = ${victim.emis} and f.stage = 'PRIMARY' and f.class_form = 'P1'
           and dp.term = ${LAST_TERM.term}`;
      expect(Number(after[0]!.present)).toBe(Number(victim.present) - 5);
      expect(await rowCount()).toBe(countBefore);
      // The stage total moved WITH it — a stale total is the failure mode this materialisation invites.
      const bad = await sql<{ n: number }[]>`
        select count(*)::int as n from (
          select jurisdiction_id, period_id, stage,
                 sum(case when class_form is null then present_days end) t,
                 sum(case when class_form is not null then present_days end) b
            from fact_attendance group by 1, 2, 3
        ) x where t is distinct from b`;
      expect(bad[0]!.n).toBe(0);
    } finally {
      // The stand-in source is DROP-and-CREATE, so reloading it is the restore.
      await loadDemoSource(sql, dataset);
      await runEtl();
    }
  }, 600_000);
});

describe("CRITERION 12 · attendance is a FLOW: the annual figure is Σ/Σ across terms, never an average", () => {
  /**
   * A THIRD TERM, planted here rather than in the demo generator, for two reasons: the demo calendar is two
   * terms (and is shared with three other suites that count on it), and the contrast this criterion needs is
   * sharpest when the third window is DELIBERATELY UNLIKE the others — ONE marked day instead of two (half
   * the denominator) and a much lower attendance (~40%). An average of the three term rates then differs
   * from the correctly weighted figure by several points, which is exactly the mistake the ruling forbids.
   */
  const TERM3: DemoTerm = {
    academicYear: ACADEMIC_YEAR,
    term: 3,
    startsOn: "2026-04-20",
    endsOn: "2026-07-24",
    isCurrent: false,
  };
  const TERM3_MARK_DATE = "2026-04-28";
  const THREE_TERMS = [...DEMO_TERMS, TERM3];

  let period3: string | null = null;

  afterAll(async () => {
    // Leave the database as found for every block after this one: the planted term's facts, its dim_period
    // row and its marks all go, and the two-term baseline is re-run.
    if (period3) await sql`delete from fact_attendance where period_id = ${period3}::uuid`;
    // ⚠ THE PLANTED TERM NOW CARRIES ROWS IN **TWO** FACT TABLES. `fact_plc_participation` has a TERM
    // cut of its own, and — unlike attendance and fees, which only write for a school that filed
    // something in the window — it writes a row for EVERY computed school even when nothing happened,
    // because a term with no PLC session is a MEASUREMENT (sessions_held = 0), not an absence. So a
    // third term planted for this criterion gets ~2,500 PLC rows too, and `dim_period` cannot be
    // deleted out from under them: the FK refuses it and this afterAll dies, taking the rest of the
    // file's baseline with it. Cleared by PERIOD rather than by the captured id, so cleanup still
    // works if the run above failed before `period3` was set.
    await sql`
      delete from fact_plc_participation
       where period_id in (select period_id from dim_period
                            where academic_year = ${ACADEMIC_YEAR} and term = 3)`;
    await sql`delete from dim_period where academic_year = ${ACADEMIC_YEAR} and term = 3`;
    await sql`
      delete from demo_source.attendance_record where date = ${TERM3_MARK_DATE}::date`;
    buildExpectations(dataset);
    report = await runEtl();
  }, 600_000);

  it("Σpresent ÷ Σenrolled across the three terms is the annual rate — the average of the term rates is NOT", async () => {
    // One marked day, ~40% present, assigned deterministically by pupil rank so the figures are stable.
    await sql`
      insert into demo_source.attendance_record (school_id, student_id, class_id, date, status)
      select p.school_id, p.id, p.class_id, ${TERM3_MARK_DATE}::date,
             (case when p.rank % 10 between 1 and 4 then 'PRESENT' else 'ABSENT' end)
               ::demo_source.attendance_status
        from (
          select school_id, class_id, id,
                 row_number() over (partition by school_id, class_id order by id) as rank
            from demo_source.students where class_id is not null
        ) p`;
    const run = await runEtl({ terms: THREE_TERMS });
    expect(run.status).toBe("SUCCESS");
    expect(run.terms).toHaveLength(3);
    period3 = run.terms[2]!.periodId;

    const national = await nodeId("NATIONAL", "Ghana");
    const perTerm: { present: number; enrolled: number }[] = [];
    for (const term of THREE_TERMS)
      perTerm.push(await rollUp(national, await termPeriodId(term.term)));

    // THE FLOW PROPERTY: the two counts ARE additive across time — a pupil-day in term 1 and one in term 2
    // are TWO pupil-days — so the annual figure is the sum of the term counts.
    const annual = perTerm.reduce(
      (t, x) => ({ present: t.present + x.present, enrolled: t.enrolled + x.enrolled }),
      { present: 0, enrolled: 0 },
    );
    expect(annual.present).toBe(run.terms.reduce((t, x) => t + x.presentDays, 0));
    expect(annual.enrolled).toBe(run.terms.reduce((t, x) => t + x.enrolledDays, 0));

    // THE CONTRAST THE RULING IS ABOUT. The weighted rate is Σ/Σ; the average of the three term rates
    // weights a one-day term equally with a two-day one and is a different, wrong number.
    const weighted = Number(rateOf(annual.present, annual.enrolled));
    const average =
      perTerm.reduce((t, x) => t + Number(rateOf(x.present, x.enrolled)), 0) / 3;
    expect(Math.abs(weighted - average)).toBeGreaterThan(0.5);
    // Term 3 really is the lighter, worse term — which is what makes the weighting matter.
    expect(perTerm[2]!.enrolled).toBeLessThan(perTerm[0]!.enrolled);
    expect(Number(rateOf(perTerm[2]!.present, perTerm[2]!.enrolled))).toBeLessThan(
      Number(rateOf(perTerm[0]!.present, perTerm[0]!.enrolled)),
    );

    // STILL no ANNUAL attendance row: the annual figure is this sum and is never materialised.
    const materialised = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_attendance f
        join dim_period dp on dp.period_id = f.period_id where dp.period_type <> 'TERM'`;
    expect(materialised[0]!.n).toBe(0);
  }, 600_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WRITE: PER-TERM DELETE SCOPE, THE DUPLICATE ASSERTION AND THE TWO ZEROES (criteria 14, 15, 16, 17)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the bounded per-term delete and the threaded arm (criterion 14)", () => {
  it("CRITERION 14 · the delete is bounded by (period, jurisdiction ∈ computed) — a bystander survives", async () => {
    const period = await termPeriodId(FIRST_TERM.term);
    const two = await sql<{ jurisdiction_id: string }[]>`
      select distinct jurisdiction_id::text as jurisdiction_id from fact_attendance
       where period_id = ${period}::uuid order by jurisdiction_id limit 2`;
    const [bystander, rewritten] = two;
    const bystanderBefore = await sql<{ n: number; present: number }[]>`
      select count(*)::int as n, sum(present_days)::int as present from fact_attendance
       where period_id = ${period}::uuid and jurisdiction_id = ${bystander!.jurisdiction_id}::uuid`;

    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_attendance
       where period_id = ${period}::uuid and jurisdiction_id = ${rewritten!.jurisdiction_id}::uuid`;
    const result = await writeAttendanceFacts(sql, [
      {
        periodId: period,
        jurisdictionIds: [rewritten!.jurisdiction_id],
        rows: existing.map((r) => factRowFrom(r, period)),
      },
    ]);
    // EXACTLY that school's rows, in that term, deleted — a period-wide delete would report thousands.
    expect(result).toMatchObject({
      deleted: existing.length,
      inserted: existing.length,
    });
    const bystanderAfter = await sql<{ n: number; present: number }[]>`
      select count(*)::int as n, sum(present_days)::int as present from fact_attendance
       where period_id = ${period}::uuid and jurisdiction_id = ${bystander!.jurisdiction_id}::uuid`;
    expect(bystanderAfter[0]).toEqual(bystanderBefore[0]);
  });

  it("CRITERION 14 · the arm is PER TERM: rewriting one term leaves the other term's rows untouched", async () => {
    const first = await termPeriodId(FIRST_TERM.term);
    const last = await termPeriodId(LAST_TERM.term);
    const lastBefore = await sql<{ n: number; present: number }[]>`
      select count(*)::int as n, sum(present_days)::int as present from fact_attendance
       where period_id = ${last}::uuid`;
    const victim = (
      await sql<{ jurisdiction_id: string }[]>`
        select distinct jurisdiction_id::text as jurisdiction_id from fact_attendance
         where period_id = ${first}::uuid order by jurisdiction_id limit 1`
    )[0]!;
    const rows = (
      await sql<Record<string, unknown>[]>`
        select * from fact_attendance
         where period_id = ${first}::uuid and jurisdiction_id = ${victim.jurisdiction_id}::uuid`
    ).map((r) => factRowFrom(r, first));
    await writeAttendanceFacts(sql, [
      { periodId: first, jurisdictionIds: [victim.jurisdiction_id], rows },
    ]);
    const lastAfter = await sql<{ n: number; present: number }[]>`
      select count(*)::int as n, sum(present_days)::int as present from fact_attendance
       where period_id = ${last}::uuid`;
    expect(lastAfter[0]).toEqual(lastBefore[0]);
  });

  it("CRITERION 14 · ONE bad school fails ITSELF: the run survives, names it, and keeps its PRIOR rows", async () => {
    // Per-school isolation, through the REAL pipeline. A sixth mark state is the only way a school's marks
    // can be unaggregatable, so the demo enum is temporarily widened — which also exercises the drift guard.
    const victim = (
      await sql<{ emis: string; op: string }[]>`
        select distinct d.ges_code as emis, r.operational_school_id::text as op
          from fact_attendance f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
          join ref_emis_school_register r on r.emis_school_id = d.ges_code
         order by d.ges_code limit 1`
    )[0]!;
    const rowsFor = async (emis: string) =>
      (
        await sql<{ n: number; present: number }[]>`
          select count(*)::int as n, sum(present_days)::int as present from fact_attendance f
            join dim_jurisdiction d using (jurisdiction_id) where d.ges_code = ${emis}`
      )[0]!;
    const before = await rowsFor(victim.emis);
    expect(before.n).toBeGreaterThan(0);
    try {
      await sql.unsafe(
        `alter type demo_source.attendance_status add value if not exists 'HOLIDAY'`,
      );
      await sql`
        update demo_source.attendance_record set status = 'HOLIDAY'
         where id in (
           select id from demo_source.attendance_record
            where school_id = ${victim.op}::uuid order by id limit 3)`;
      const run = await runEtl();
      // The run SURVIVES (one school is far below the 1% policy) and the school is NAMED.
      expect(run.status).toBe("SUCCESS");
      expect(run.errorText).toMatch(/SUCCESS WITH GAPS/);
      const named = run.terms.flatMap((t) => t.failures);
      expect(named.some((f) => f.emisSchoolId === victim.emis)).toBe(true);
      expect(named.every((f) => /outside the allow-list/.test(f.message))).toBe(true);
      // ⚠ A FAILED SCHOOL KEEPS ITS PRIOR ROWS — it is excluded from the delete scope, not emptied.
      expect(await rowsFor(victim.emis)).toEqual(before);
    } finally {
      await loadDemoSource(sql, dataset);
      await runEtl();
    }
    expect(await rowsFor(victim.emis)).toEqual(before);
  }, 600_000);
});

describe("the NULL-safe duplicate assertion (criterion 15)", () => {
  it("CRITERION 15 · an injected duplicate FAILS the write inside the txn and rolls everything back", async () => {
    // `fact_attendance` is one of the PK-ONLY original eight: no grain UNIQUE, so a duplicate INSERTS
    // HAPPILY and doubles both counts in every roll-up — while the stored RATE still reads correctly,
    // because the doubling cancels in the ratio. This assertion is the ONLY guard that exists.
    const period = await termPeriodId(FIRST_TERM.term);
    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_attendance where period_id = ${period}::uuid
       order by jurisdiction_id, stage, class_form nulls first limit 1`;
    const row = factRowFrom(existing[0]!, period);
    const before = await rowCount();
    await expect(
      writeAttendanceFacts(sql, [
        { periodId: period, jurisdictionIds: [row.jurisdictionId], rows: [row, { ...row }] },
      ]),
    ).rejects.toThrow(/duplicated grain key/);
    // Inside the transaction: the delete AND both inserts were rolled back.
    expect(await rowCount()).toBe(before);
  });

  it("CRITERION 15 · the LEGITIMATE class_form IS NULL stage totals are NOT flagged (the NULL-safety half)", async () => {
    const period = await termPeriodId(FIRST_TERM.term);
    const victim = (
      await sql<{ jurisdiction_id: string }[]>`
        select jurisdiction_id::text as jurisdiction_id from fact_attendance
         where period_id = ${period}::uuid and class_form is null limit 1`
    )[0]!;
    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_attendance
       where period_id = ${period}::uuid and jurisdiction_id = ${victim.jurisdiction_id}::uuid`;
    expect(existing.filter((r) => r.class_form === null).length).toBeGreaterThanOrEqual(1);
    const before = await fingerprint();
    const result = await writeAttendanceFacts(sql, [
      {
        periodId: period,
        jurisdictionIds: [victim.jurisdiction_id],
        rows: existing.map((r) => factRowFrom(r, period)),
      },
    ]);
    expect(result.inserted).toBe(existing.length);
    expect(await fingerprint()).toBe(before); // byte-identical, so nothing was mangled either
  });

  it("CRITERION 15 · an empty-string class_form is NOT the same key as a stage total", async () => {
    // The specific collision a bare `coalesce(class_form, '')` key would create. '' is not a token this ETL
    // emits, but the guard must distinguish it from NULL or the assertion is only accidentally correct.
    const period = await termPeriodId(FIRST_TERM.term);
    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_attendance where period_id = ${period}::uuid and class_form is null limit 1`;
    const total = factRowFrom(existing[0]!, period);
    const before = await rowCount();
    const result = await writeAttendanceFacts(sql, [
      {
        periodId: period,
        jurisdictionIds: [total.jurisdictionId],
        rows: [
          ...(
            await sql<Record<string, unknown>[]>`
              select * from fact_attendance
               where period_id = ${period}::uuid
                 and jurisdiction_id = ${total.jurisdictionId}::uuid`
          ).map((r) => factRowFrom(r, period)),
          { ...total, classForm: "" },
        ],
      },
    ]);
    expect(result.inserted).toBeGreaterThan(0);
    expect(await rowCount()).toBe(before + 1);
    await sql`delete from fact_attendance where class_form = ''`;
    expect(await rowCount()).toBe(before);
  });
});

describe("the two zeroes are NOT the same thing (criterion 16)", () => {
  it("CRITERION 16 · a school with NO marks in a term is not computed, is NAMED, and KEEPS its prior rows", async () => {
    // The planted zero-marks schools (index % 109) have no term-1 marks at all: named in `noMarks`, absent
    // from term 1's facts, and present in term 2's.
    const named = report.terms[0]!.noMarks;
    expect(named.length).toBeGreaterThan(0);
    expect(report.terms[report.terms.length - 1]!.noMarks).toEqual([]);
    const first = await termPeriodId(FIRST_TERM.term);
    const last = await termPeriodId(LAST_TERM.term);
    for (const emis of named) {
      const counts = (
        await sql<{ in_first: number; in_last: number }[]>`
          select (select count(*)::int from fact_attendance f
                    join dim_jurisdiction d using (jurisdiction_id)
                   where d.ges_code = ${emis} and f.period_id = ${first}::uuid) as in_first,
                 (select count(*)::int from fact_attendance f
                    join dim_jurisdiction d using (jurisdiction_id)
                   where d.ges_code = ${emis} and f.period_id = ${last}::uuid)  as in_last`
      )[0]!;
      expect(counts.in_first).toBe(0);
      expect(counts.in_last).toBeGreaterThan(0);
    }

    // ⚠ THE DECISIVE HALF, which "it has no rows" cannot show: a school that HAD rows and then stops being
    // marked KEEPS them (it is not in the delete scope), rather than being emptied on the basis of an
    // absence. Delete one school's term-2 marks and re-run.
    const victim = (
      await sql<{ emis: string; op: string }[]>`
        select distinct d.ges_code as emis, r.operational_school_id::text as op
          from fact_attendance f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
          join ref_emis_school_register r on r.emis_school_id = d.ges_code
         where f.period_id = ${last}::uuid order by d.ges_code limit 1`
    )[0]!;
    const rowsFor = async () =>
      (
        await sql<{ n: number; present: number }[]>`
          select count(*)::int as n, sum(present_days)::int as present from fact_attendance f
            join dim_jurisdiction d using (jurisdiction_id)
           where d.ges_code = ${victim.emis} and f.period_id = ${last}::uuid`
      )[0]!;
    const before = await rowsFor();
    expect(before.n).toBeGreaterThan(0);
    try {
      await sql`
        delete from demo_source.attendance_record
         where school_id = ${victim.op}::uuid
           and date between ${LAST_TERM.startsOn}::date and ${LAST_TERM.endsOn}::date`;
      const run = await runEtl();
      expect(run.status).toBe("SUCCESS");
      const outcome = run.terms.find((t) => t.term === LAST_TERM.term)!;
      expect(outcome.noMarks).toContain(victim.emis);
      expect(outcome.failures).toEqual([]);
      // STALE-BUT-HONEST: the rows are exactly as they were, not deleted-and-not-reinserted.
      expect(await rowsFor()).toEqual(before);
    } finally {
      await loadDemoSource(sql, dataset);
      await runEtl();
    }
    expect(await rowsFor()).toEqual(before);
  }, 600_000);

  it("CRITERION 16 · an ALL-ABSENT school gets REAL rows with enrolled_days > 0 and rate 0.00", async () => {
    // Planted at index % 113 in the LAST term. This is the most important row shape in the table — a school
    // whose children stopped coming — and a "treat zero as no data" reader would hide it.
    const last = await termPeriodId(LAST_TERM.term);
    const zeroes = await sql<
      { emis: string; enrolled: number; present: number; rate: string }[]
    >`
      select d.ges_code as emis, f.enrolled_days as enrolled, f.present_days as present,
             f.attendance_rate::text as rate
        from fact_attendance f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where f.period_id = ${last}::uuid and f.present_days = 0 and f.class_form is null
       order by d.ges_code`;
    expect(zeroes.length).toBeGreaterThan(0);
    for (const row of zeroes) {
      expect(Number(row.enrolled)).toBeGreaterThan(0);
      expect(Number(row.present)).toBe(0);
      expect(row.rate).toBe("0.00");
    }
    // THE DISTINCTION, asserted: the all-absent schools HAVE rows in this term; the no-marks schools have
    // none. The two sets do not overlap, and neither is representable as the other.
    const allAbsent = new Set(zeroes.map((r) => r.emis));
    const noMarks = new Set(report.terms.find((t) => t.term === LAST_TERM.term)!.noMarks);
    for (const emis of allAbsent) expect(noMarks.has(emis)).toBe(false);
    // …and the all-absent school really did mark its register: the marks are there, all ABSENT.
    const sample = [...allAbsent][0]!;
    const marks = await sql<{ status: string; n: number }[]>`
      select a.status::text as status, count(*)::int as n
        from demo_source.attendance_record a
        join ref_emis_school_register r on r.operational_school_id = a.school_id
       where r.emis_school_id = ${sample}
         and a.date between ${LAST_TERM.startsOn}::date and ${LAST_TERM.endsOn}::date
       group by 1`;
    expect(marks.map((m) => m.status)).toEqual(["ABSENT"]);
    expect(marks[0]!.n).toBeGreaterThan(0);
  });
});

describe("CRITERION 17 · a FAILED verdict writes NOTHING and the prior data stays", () => {
  it("breaches the failure policy, closes FAILED, and leaves all four fact tables untouched", async () => {
    const before = {
      attendance: await fingerprint(),
      attendanceRows: await rowCount(),
      enrolment: (
        await sql<{ n: number }[]>`select count(*)::int as n from fact_enrolment`
      )[0]!.n,
      infrastructure: (
        await sql<{ n: number }[]>`select count(*)::int as n from fact_infrastructure`
      )[0]!.n,
    };
    try {
      // A zero-tolerance policy plus ONE unaggregatable school is the smallest breach that is still a
      // breach — the point is the VERDICT's effect on the write, not the size of the failure.
      await sql.unsafe(
        `alter type demo_source.attendance_status add value if not exists 'HOLIDAY'`,
      );
      const victim = (
        await sql<{ op: string }[]>`
          select r.operational_school_id::text as op from ref_emis_school_register r
           where r.on_schoolup and r.operational_school_id is not null
           order by r.emis_school_id limit 1`
      )[0]!;
      await sql`
        update demo_source.attendance_record set status = 'HOLIDAY'
         where id in (
           select id from demo_source.attendance_record
            where school_id = ${victim.op}::uuid order by id limit 2)`;
      const run = await runEtl({ policy: { maxFailureRate: 0 } });
      expect(run.status).toBe("FAILED");
      expect(run.errorText).toMatch(/schools failed compute/);
      // NOTHING WAS WRITTEN — by any arm. The prior night's data is exactly as it was: stale, labelled with
      // its own older as-of, and honest.
      for (const term of run.terms) {
        expect(term.inserted).toBe(0);
        expect(term.deleted).toBe(0);
      }
      expect(await fingerprint()).toBe(before.attendance);
      expect(await rowCount()).toBe(before.attendanceRows);
      expect(
        (await sql<{ n: number }[]>`select count(*)::int as n from fact_enrolment`)[0]!.n,
      ).toBe(before.enrolment);
      expect(
        (await sql<{ n: number }[]>`select count(*)::int as n from fact_infrastructure`)[0]!
          .n,
      ).toBe(before.infrastructure);
      // The run is recorded as FAILED with its reason, so the as-of banner reads the previous SUCCESS.
      const row = (
        await sql<{ status: string; error_text: string | null }[]>`
          select status::text as status, error_text from etl_run where run_id = ${run.runId}::uuid`
      )[0]!;
      expect(row.status).toBe("FAILED");
      expect(row.error_text).toMatch(/schools failed compute/);
    } finally {
      await loadDemoSource(sql, dataset);
      report = await runEtl();
    }
    expect(await fingerprint()).toBe(before.attendance);
  }, 600_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SOURCE READ: ALLOW-LIST, BOUND AND AGGREGATE-ONLY (criteria 18, 19, 20)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the attendance read is an ALLOW-LIST, not a `select *` (criterion 18)", () => {
  /** The four names that must never cross the boundary — three clinical/named, one the child itself. */
  const FORBIDDEN = ["note", "reason_code", "marked_by_user_id", "student_id", "students"];
  const ALLOWED = ["school_id", "status", "date", "class_id", "level", "name"];

  it("CRITERION 18 · the forbidden names appear NOWHERE in the source module, and the allowed six do", () => {
    const code = stripComments(moduleText("lib/etl/attendance-source.ts"));
    // Comments are stripped, not banned: the header documents the forbidden names on purpose, and a test
    // that banned the words outright would make the module undocumentable.
    for (const column of FORBIDDEN)
      expect(code, `${column} must not be referenced`).not.toMatch(
        new RegExp(`\\b${column}\\b`),
      );
    expect(code).not.toContain("select *");
    for (const column of ALLOWED) expect(code).toContain(column);
    // The transform never sees them either — it only ever receives grouped counts.
    expect(stripComments(moduleText("lib/etl/attendance.ts"))).not.toMatch(
      /\b(note|reason_code|marked_by_user_id|student_id|students)\b/,
    );
  });

  it("CRITERION 18 · the demo stand-in does not even CARRY the clinical columns — the structural floor", async () => {
    const names = (
      await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
         where table_schema = 'demo_source' and table_name = 'attendance_record'`
    )
      .map((c) => c.column_name)
      .sort();
    expect(names).toEqual(
      ["id", "school_id", "student_id", "class_id", "date", "status"].sort(),
    );
    for (const column of ["note", "reason_code", "marked_by_user_id", "marked_at"])
      expect(names).not.toContain(column);
    // Without this, the test above would pass just as well against a source that never had the columns,
    // and the claim "the allow-list excludes them" would be vacuous: the REAL table carries all three.
    const real = moduleText("../web/db/schema/attendance.ts");
    expect(real).toContain('text("reason_code")');
    expect(real).toContain('text("note")');
    expect(real).toContain('uuid("marked_by_user_id")');
    // `student_id` IS in the stand-in — the table's grain is one row per pupil per day and
    // `uniq_attendance_student_day` is load-bearing — and the reader still never selects it.
    expect(names).toContain("student_id");
    const unique = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_constraint
       where conname = 'uniq_attendance_student_day' and contype = 'u'`;
    expect(unique[0]!.n).toBe(1);
  });

  it("the reader COUNTS and does not ENUMERATE: one row per (school, class label, status), not per mark", async () => {
    const operationalIds = (
      await sql<{ op: string }[]>`
        select r.operational_school_id::text as op from ref_emis_school_register r
         where r.on_schoolup and r.operational_school_id is not null
         order by r.emis_school_id limit 3`
    ).map((r) => r.op);
    const { groups } = await readAttendanceMarkGroups(sql, {
      schemaName: "demo_source",
      operationalSchoolIds: operationalIds,
      startsOn: FIRST_TERM.startsOn,
      endsOn: FIRST_TERM.endsOn,
    });
    const marks = groups.reduce((t, g) => t + g.marks, 0);
    expect(marks).toBeGreaterThan(groups.length * 5); // counts, not rows
    // Each group is a real count of pupil-days, and its `lastMarkDate` is inside the window.
    for (const g of groups) {
      expect(g.marks).toBeGreaterThan(0);
      expect(g.lastMarkDate >= FIRST_TERM.startsOn).toBe(true);
      expect(g.lastMarkDate <= FIRST_TERM.endsOn).toBe(true);
    }
  });
});

describe("the read is bounded by the inclusion set (criterion 19)", () => {
  it("CRITERION 19 · it returns ONLY the requested schools, and an empty id set reads ZERO rows", async () => {
    const operationalIds = (
      await sql<{ op: string }[]>`
        select r.operational_school_id::text as op from ref_emis_school_register r
         where r.on_schoolup and r.operational_school_id is not null
         order by r.emis_school_id limit 4`
    ).map((r) => r.op);
    const { groups } = await readAttendanceMarkGroups(sql, {
      schemaName: "demo_source",
      operationalSchoolIds: operationalIds,
      startsOn: FIRST_TERM.startsOn,
      endsOn: FIRST_TERM.endsOn,
    });
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((g) => operationalIds.includes(g.schoolId))).toBe(true);
    // AN EMPTY ID SET READS ZERO ROWS — and does not issue an unbounded query at all. An unbounded read
    // would return schools the run cannot resolve to a jurisdiction node.
    expect(
      (
        await readAttendanceMarkGroups(sql, {
          schemaName: "demo_source",
          operationalSchoolIds: [],
          startsOn: FIRST_TERM.startsOn,
          endsOn: FIRST_TERM.endsOn,
        })
      ).groups,
    ).toEqual([]);
    expect(
      await countMarksOutsideDeclaredTerms(sql, {
        schemaName: "demo_source",
        operationalSchoolIds: [],
        windows: [],
      }),
    ).toBe(0);

    // The seam is a PARAMETER, not a hard-coded schema: `demo_source` here, `public` on an
    // `oversight_etl` connection, with no change to the query — and the bound is in the WHERE clause.
    const code = moduleText("lib/etl/attendance-source.ts");
    expect(code).toContain("${sql(query.schemaName)}.attendance_record");
    expect(code).toContain("= any(${query.operationalSchoolIds}::uuid[])");
  });

  it("CRITERION 19 · an out-of-inclusion school in the result FAILS that school rather than being written", () => {
    // The guard is unreachable while the read stays bounded (above), so what is asserted here is that it
    // EXISTS and is per-school isolated — the same shape the three earlier arms carry. A school the run
    // cannot resolve to a jurisdiction node must never reach a fact row: there is no grain key for it.
    const pipeline = stripComments(moduleText("lib/etl/pipeline.ts"));
    expect(pipeline).toMatch(
      /is not in the inclusion set[\s\S]{0,200}the attendance[\s\S]{0,80}read is not bounded by the inclusion set/,
    );
    // …and it is raised INSIDE the per-school compute closure, so it costs ONE school and not the run.
    expect(pipeline).toMatch(/aggregateSchoolAttendance\(item\.rows/);
  });
});

describe("CRITERION 20 · the fact table holds aggregates only — no individual crosses", () => {
  it("fact_attendance carries no pupil identifier, and its rows are counts of pupil-days", async () => {
    const columns = (
      await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'fact_attendance'`
    ).map((c) => c.column_name);
    for (const forbidden of [
      "student_id",
      "pupil_id",
      "person_id",
      "full_name",
      "first_name",
      "last_name",
      "date_of_birth",
      "marked_by_user_id",
      "note",
      "reason_code",
    ])
      expect(columns).not.toContain(forbidden);
    // `tests/no-individuals-in-analytics.test.ts` is a LIVE-SCHEMA public sweep, so this table is already
    // inside it; this block adds the table-specific half — the rows really are aggregates, not marks.
    const grain = await sql<{ n: number; min_enrolled: number }[]>`
      select count(*)::int as n, min(enrolled_days)::int as min_enrolled from fact_attendance`;
    expect(grain[0]!.min_enrolled).toBeGreaterThan(0);
    const aggregated = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_attendance where enrolled_days > 1`;
    // Most rows cover many pupil-days: a row is a (stage, class_form) aggregate, never a pupil's day.
    expect(aggregated[0]!.n).toBeGreaterThan(grain[0]!.n * 0.9);
    // One row per grain key per school — so no reader can recover who was absent on which day.
    const dates = await sql<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
       where table_schema = 'public' and table_name = 'fact_attendance'
         and column_name like '%date%'`;
    expect(dates[0]!.n).toBe(1); // as_of_date (provenance) and nothing else
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// NO NEW ANALYTICS OBJECT, AND THE WEIGHTED ROLL-UP (criteria 21, 22)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("CRITERION 21 · H10 adds no migration, no new object and no new enum value", () => {
  it("the migrations folder is unchanged and fact_attendance predates this slice", () => {
    const files = readdirSync(join(process.cwd(), "db/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    // 0000–0005 predate this slice; 0006 is the CPD `plc_earned_points_total` ADD COLUMN (increment-L
    // follow-up, NOT the attendance slice). The §6 prod-paste-0006 re-run rule fires only on a new TABLE,
    // SEQUENCE or ROUTINE in the analytics `public` schema — a bare ADD COLUMN is none of those and is
    // covered by the existing table-level RLS, so the rule still does not fire.
    expect(files).toHaveLength(7);
    expect(files.map((f) => f.slice(0, 4))).toEqual([
      "0000",
      "0001",
      "0002",
      "0003",
      "0004",
      "0005",
      "0006",
    ]);
    // 0006 is an ADD COLUMN only — no new table/sequence/routine.
    const m0006 = readdirSync(join(process.cwd(), "db/migrations"))
      .filter((f) => f.startsWith("0006") && f.endsWith(".sql"))
      .map((f) => moduleText(join("db/migrations", f)))
      .join("\n");
    expect(m0006).toMatch(/alter table .*add column/i);
    expect(m0006).not.toMatch(/create (table|sequence|function|procedure)/i);
    // The table was created in the FIRST migration — this slice only writes to it.
    expect(moduleText("db/migrations/0000_fuzzy_slipstream.sql")).toContain(
      "fact_attendance",
    );
    // `demo_source` is not in `public` and is created by a DEMO script that never runs against prod, so the
    // stand-in table is not a new analytics object either.
    expect(moduleText("db/seed/demo/demo-source-schema.sql")).toContain(
      "create table demo_source.attendance_record",
    );
  });

  it("the two enum values the slice needs already existed — nothing was added", async () => {
    const values = await sql<{ typname: string; enumlabel: string }[]>`
      select t.typname, e.enumlabel from pg_type t
        join pg_enum e on e.enumtypid = t.oid
       where t.typname in ('period_type', 'ov_source')
       order by t.typname, e.enumsortorder`;
    const of = (name: string) =>
      values.filter((v) => v.typname === name).map((v) => v.enumlabel);
    expect(of("period_type")).toEqual(["TERM", "ANNUAL", "EXAM_COHORT"]);
    expect(of("ov_source")).toContain("OPERATIONAL_AGG");
    // The two this slice stamps are the two that were already there.
    const used = await sql<{ period_type: string; source: string }[]>`
      select distinct dp.period_type::text as period_type, f.source::text as source
        from fact_attendance f join dim_period dp on dp.period_id = f.period_id`;
    expect(used).toEqual([{ period_type: "TERM", source: "OPERATIONAL_AGG" }]);
  });
});

describe("CRITERION 22 · the roll-up is WEIGHTED: Σpresent ÷ Σenrolled, never an average of rates", () => {
  it("district = Σ its schools' stage totals, and the weighted rate differs from the average of school rates", async () => {
    const period = await termPeriodId(FIRST_TERM.term);
    // A district with several schools, so the weighting has something to do.
    const district = (
      await sql<{ jurisdiction_id: string; name: string; n: number }[]>`
        select p.jurisdiction_id::text as jurisdiction_id, p.name, count(distinct f.jurisdiction_id)::int as n
          from fact_attendance f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
          join dim_jurisdiction p on p.jurisdiction_id = d.parent_id
         where f.period_id = ${period}::uuid and p.level = 'DISTRICT'
         group by 1, 2 having count(distinct f.jurisdiction_id) >= 5
         order by 3 desc, 1 limit 1`
    )[0]!;

    const hand = expectedFigure((s) => s.districtName === district.name, FIRST_TERM.term);
    const rolled = await rollUp(district.jurisdiction_id, period);
    expect(rolled).toEqual({ present: hand.present, enrolled: hand.enrolled });

    // THE WEIGHTED FIGURE, and the mistake it is not: averaging the member schools' own stored rates
    // weights a 40-pupil school equally with a 900-pupil one.
    const perSchool = await sql<{ present: number; enrolled: number }[]>`
      select sum(f.present_days)::int as present, sum(f.enrolled_days)::int as enrolled
        from fact_attendance f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where f.period_id = ${period}::uuid and f.class_form is null
         and d.parent_id = ${district.jurisdiction_id}::uuid
       group by f.jurisdiction_id`;
    expect(perSchool.length).toBeGreaterThanOrEqual(5);
    const weighted = Number(rateOf(rolled.present, rolled.enrolled));
    const average =
      perSchool.reduce(
        (t, s) => t + Number(rateOf(Number(s.present), Number(s.enrolled))),
        0,
      ) / perSchool.length;
    expect(weighted).not.toBe(average);
    // Both are plausible percentages — which is exactly why the wrong one is dangerous.
    expect(weighted).toBeGreaterThan(50);
    expect(average).toBeGreaterThan(50);

    // REGION = Σ ITS DISTRICTS, and NATIONAL = Σ every school — the same filtered sum, one tier up.
    const regionName = schoolByEmis.get(
      (
        await sql<{ emis: string }[]>`
          select d.ges_code as emis from dim_jurisdiction d
           where d.parent_id = ${district.jurisdiction_id}::uuid and d.level = 'SCHOOL'
           order by d.ges_code limit 1`
      )[0]!.emis,
    )!.regionName;
    const regionId = await nodeId("REGION", regionName);
    const region = await rollUp(regionId, period);
    expect(region).toEqual(
      expectedFigure((s) => s.regionName === regionName, FIRST_TERM.term),
    );
    const national = await rollUp(await nodeId("NATIONAL", "Ghana"), period);
    expect(national).toEqual(expectedFigure(() => true, FIRST_TERM.term));
    expect(national.enrolled).toBeGreaterThan(region.enrolled);

    // ⚠ THE ONE-PERIOD FILTER IS MANDATORY, and omitting it is the FLOW-specific trap: the sum over BOTH
    // terms is a perfectly valid figure for a window nobody asked for, so it looks entirely plausible.
    const bothTerms = await sql<{ enrolled: number }[]>`
      with recursive subtree as (
        select jurisdiction_id from dim_jurisdiction
         where jurisdiction_id = ${district.jurisdiction_id}::uuid
        union all
        select c.jurisdiction_id from dim_jurisdiction c join subtree s on c.parent_id = s.jurisdiction_id
      )
      select sum(f.enrolled_days)::int as enrolled from fact_attendance f
        join subtree s on s.jurisdiction_id = f.jurisdiction_id
       where f.class_form is null`;
    expect(Number(bothTerms[0]!.enrolled)).toBeGreaterThan(rolled.enrolled);
    expect(Number(bothTerms[0]!.enrolled)).toBe(
      DEMO_TERMS.reduce(
        (t, term) =>
          t + expectedFigure((s) => s.districtName === district.name, term.term).enrolled,
        0,
      ),
    );
  });
});
