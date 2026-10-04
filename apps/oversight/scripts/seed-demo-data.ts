import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";
import {
  GHANA_REGIONS,
  MISSION_PATRONS,
  SCHOOL_NAME_STEMS,
  type DemoDistrict,
  type DemoRegion,
} from "@/db/seed/demo/ghana";

/**
 * DEMO DATA GENERATOR — grounded, deterministic, self-contained (Increment H first slice).
 *
 * WHY THIS EXISTS. The `fact_infrastructure` slice is a real pipeline, but the real inputs do not
 * exist yet: there is no EMIS extract (scope §5 blocker 2) and no cross-tenant operational read role
 * (blocker 1, task H1). A demo for MoE/GES therefore needs inputs that are (a) shaped exactly like
 * the real ones, so the ETL does real work, and (b) grounded in Ghana's actual administrative
 * structure, so a regional roll-up is recognisable rather than obviously synthetic.
 *
 * WHAT IT PRODUCES — two artefacts, matching the two real inputs one-for-one:
 *
 *   1. AN EMIS SCHOOL-REGISTER EXTRACT FILE (JSON, on disk). This is the external GES EMIS extract
 *      (scope §2 loader #1), the Y in every "X of Y schools" coverage figure. A FILE, not a table,
 *      because that is the real artefact's shape and because `lib/etl/register.ts` must be a real
 *      file loader — the same posture as the already-built `load-establishment.ts`.
 *
 *   2. OPERATIONAL-SHAPED `facilities_snapshot` ROWS in the `demo_source` schema (see
 *      db/seed/demo/demo-source-schema.sql for why that schema and not the real operational DB).
 *      ONE row per on-Schoolup school per term, with the operational column names, types and CHECK
 *      allow-lists. The ETL then does the decomposition. NOTHING HERE WRITES A FACT ROW — if the
 *      transform is wrong, the demo numbers are wrong, which is the only honest arrangement.
 *
 * DETERMINISM. One fixed seed (`DEFAULT_SEED`) through one small PRNG (mulberry32) drives every
 * choice, and every generated uuid is derived from an index rather than `gen_random_uuid()`. So two
 * runs produce byte-identical artefacts, a reviewer can reason about specific schools, and the
 * idempotency test ("a re-run is byte-identical") is testing the ETL rather than the generator.
 *
 * GROUNDING — the three things that make the output look like Ghana rather than like noise:
 *   · the 16 real regions and real MMDA district names (db/seed/demo/ghana.ts);
 *   · a school-type / ownership mix weighted to the real basic-heavy, ~70% public shape;
 *   · an URBAN/RURAL FACILITIES GRADIENT driven by the district's MMDA class, so rural districts are
 *     likelier to have water_source NONE/WELL, electricity NONE/SOLAR, latrine PIT/KVIP and no
 *     library / ICT lab / internet. That gradient is the thing a regional dashboard is FOR; a
 *     uniformly-sampled dataset would make every region look identical and prove nothing.
 *
 * Two deliberate imperfections, because both exercise logic that must be exercised:
 *   · ~12.5% of registered schools are NOT on Schoolup → coverage is below 100% and the
 *     excluded-from-facts-but-counted-in-the-register asymmetry (scope §3) is real.
 *   · the nullable optional-detail columns (computers, library books, furniture) are answered by
 *     only SOME schools → the *_reporting_count honest denominators are genuinely < schools_reporting.
 */

// ── deterministic RNG ───────────────────────────────────────────────────────────────────────────

/** The one seed. Changing it changes every demo figure, so it is a deliberate, reviewable edit. */
export const DEFAULT_SEED = 0x4845_4d49; // "HEMI" — Increment H EMIS

/** mulberry32 — 32-bit, seedable, no dependency, identical across platforms and Node versions. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  next: () => number;
  /** Uniform integer in [lo, hi]. */
  int: (lo: number, hi: number) => number;
  bool: (p: number) => boolean;
  pick: <T>(items: readonly T[]) => T;
  /** Weighted pick: `[["A", 0.7], ["B", 0.3]]`. Weights need not be normalised. */
  weighted: <T>(items: readonly (readonly [T, number])[]) => T;
}

function rngOf(seed: number): Rng {
  const next = makeRng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return {
    next,
    int,
    bool: (p) => next() < p,
    pick: (items) => items[int(0, items.length - 1)]!,
    weighted: (items) => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [value, w] of items) {
        r -= w;
        if (r <= 0) return value;
      }
      return items[items.length - 1]![0];
    },
  };
}

// ── shapes ──────────────────────────────────────────────────────────────────────────────────────

export type DemoSchoolType = "KG" | "PRIMARY" | "JHS" | "SHS" | "COMBINED";
export type DemoOwnership = "PUBLIC" | "PRIVATE" | "MISSION";

export interface DemoSchool {
  emisSchoolId: string;
  name: string;
  regionName: string;
  districtName: string;
  schoolType: DemoSchoolType;
  ownershipType: DemoOwnership;
  /** Registered AND live on Omnischools. Only these get facilities rows → only these get facts. */
  onSchoolup: boolean;
  /** The operational tenant uuid (apps/web ref_school.id). NULL when not on Schoolup. */
  operationalSchoolId: string | null;
  asOfDate: string;
  /** Not part of the register — a generator-internal driver of the facilities gradient. */
  urban: boolean;
}

export interface DemoTerm {
  academicYear: string;
  term: number;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
}

/** Operational-shaped census row, exactly the columns of apps/web `facilities_snapshot`. */
export interface DemoFacilitiesRow {
  schoolId: string;
  periodId: string;
  classroomsTotal: number;
  classroomsGood: number;
  classroomsRepair: number;
  waterSource: "BOREHOLE" | "PIPE" | "WELL" | "NONE";
  electricitySource: "GRID" | "SOLAR" | "GENERATOR" | "NONE";
  latrinesBoys: number;
  latrinesGirls: number;
  latrinesStaff: number;
  latrineType: "WC" | "KVIP" | "PIT" | "NONE";
  handwashing: boolean;
  hasLibrary: boolean;
  hasIctLab: boolean;
  internet: boolean;
  hasKitchen: boolean;
  gsfpParticipating: boolean;
  libraryBookCount: number | null;
  libraryStaffFte: number | null;
  computersTotal: number | null;
  computersWorking: number | null;
  internetType: string | null;
  mealsServedLastTerm: number | null;
  pupilsFedDailyAvg: number | null;
  catererName: string | null;
  textbookAvailability: "ADEQUATE" | "INADEQUATE" | null;
  studentDesksUsable: number | null;
  studentDesksBroken: number | null;
  teacherDesks: number | null;
  chalkboards: number | null;
  whiteboards: number | null;
  projectors: number | null;
  note: string | null;
  capturedAt: string;
}

/**
 * One row of operational `academic_period` — the REAL column set (period_number / period_label /
 * product_line), not a convenience "term". See db/seed/demo/demo-source-schema.sql.
 */
export interface DemoOperationalPeriod {
  schoolId: string;
  periodId: string;
  academicYear: string;
  /** `period_number`: a TERM on a BASIC row, a SEMESTER on a SENIOR one. Not interchangeable. */
  periodNumber: number;
  /** `period_label`: "Term 2" / "Semester 1". Display only — never a key. */
  periodLabel: string;
  startsOn: string;
  endsOn: string;
  /** `product_line`: SENIOR | BASIC | SENIOR_F3. */
  productLine: "BASIC" | "SENIOR" | "SENIOR_F3";
}

/**
 * Which product line a school's periods sit on.
 *
 * Basic schools run 3 TERMS, senior schools 2 SEMESTERS (apps/web
 * `ref_academic_period_config.period_count`), and that is why `period_number` cannot be read without
 * its line. SHS schools really do file facilities censuses, so the demo generates them on the SENIOR
 * line — and since `fact_infrastructure` was re-grained to ANNUAL (Kofi's Q3 ruling), those censuses
 * are now CONSUMED: a SENIOR school's latest snapshot in the year becomes its one fact row, where the
 * old TERM grain could only report the whole senior estate as an unmapped named gap.
 *
 * SIMPLIFICATION, stated: a COMBINED school in reality carries BOTH lines (a basic department and a
 * senior one, each with its own `academic_period` rows). Modelling two lines for one school is not
 * needed to exercise anything here, so COMBINED is generated on BASIC — its basic department's
 * calendar. The both-configurations case IS exercised, in `tests/etl-infrastructure.test.ts`, which
 * adds a senior configuration to one combined school and asserts it still yields exactly ONE row.
 */
export function productLineFor(schoolType: DemoSchoolType): "BASIC" | "SENIOR" {
  return schoolType === "SHS" ? "SENIOR" : "BASIC";
}

function periodLabelFor(productLine: "BASIC" | "SENIOR", periodNumber: number): string {
  return productLine === "SENIOR" ? `Semester ${periodNumber}` : `Term ${periodNumber}`;
}

/**
 * ── THE ROSTER (second slice, task H9) ──────────────────────────────────────────────────────────
 * Operational-shaped `class` rows. ONLY the columns the stand-in carries (see
 * db/seed/demo/demo-source-schema.sql): the enrolment ETL reads `level` and `name` and nothing else.
 */
export interface DemoClassRow {
  schoolId: string;
  classId: string;
  /** `class.name` — "JHS 1 A". The fallback the stage mapping uses when `level` is null. */
  name: string;
  /** `class.level` — "JHS 1". NULLABLE, exactly as upstream, and null on the unparseable edge class. */
  level: string | null;
  active: boolean;
}

/**
 * A COUNT of students sharing a (class, label, sex, status) key — not a student.
 *
 * The generator holds GROUPS rather than ~170,000 individual rows for two reasons, and the second is
 * the important one: a group is all the demo needs (the stand-in carries no name, no DOB, no student
 * code — see the schema header), and keeping the dataset a few thousand objects keeps
 * `generateDemoDataset()` cheap enough to call repeatedly in tests. `loadDemoSource` expands each
 * group into real individual rows with `generate_series`, so the SOURCE TABLE really is one row per
 * child and the ETL really does aggregate.
 */
export interface DemoStudentGroup {
  schoolId: string;
  /** NULL for the deliberate "admitted but not placed" case — the stage comes from the label then. */
  classId: string | null;
  currentClassLabel: string | null;
  sex: "MALE" | "FEMALE";
  status: "ACTIVE" | "INACTIVE" | "GRADUATED" | "WITHDRAWN" | "TRANSFERRED";
  headcount: number;
}

/**
 * ── THE SITTINGS (third slice, task H14) ────────────────────────────────────────────────────────
 * One operational-shaped `terminal_exam_result` row: a SCHOOL-LEVEL AGGREGATE for one (school, exam,
 * sitting year), carrying only the four sex-split leaf counts. No candidate rows, no names, no scores —
 * and no `note` / `captured_by`, which the stand-in does not even have columns for.
 */
export interface DemoTerminalExamRow {
  schoolId: string;
  examType: "BECE" | "WASSCE";
  /** The SITTING CALENDAR year (2025, 2026) — not an academic year. */
  year: number;
  femaleCandidates: number;
  maleCandidates: number;
  femalePassed: number;
  malePassed: number;
}

/**
 * ── THE REGISTER (fourth slice, task H10) ───────────────────────────────────────────────────────
 * A RUN of pupils in one class on one day sharing one mark state — NOT a mark.
 *
 * The generator holds RUNS rather than ~680,000 individual marks for the same reason it holds student
 * GROUPS rather than students, and with one extra property that matters: `fact_attendance` depends on
 * nothing about a mark except its (class, date, status) COUNT, so a run FULLY DETERMINES every published
 * figure while leaving WHICH pupil got which state to the loader. `loadDemoSource` expands each run into
 * real per-pupil rows by rank (`row_number() over (partition by class order by id)`), so the source table
 * really is one row per pupil per day — `uniq_attendance_student_day` and all — and the ETL really does
 * aggregate.
 *
 * ⚠ THE RANGES WITHIN ONE (class, date) ARE DISJOINT AND THAT IS LOAD-BEARING: two runs covering the same
 * pupil on the same day would violate `uniq_attendance_student_day`, which is the constraint the whole
 * rate rests on. The partition is built once, in `statusRunsFor`.
 */
export interface DemoAttendanceMarkGroup {
  schoolId: string;
  classId: string;
  /** The CIVIL date of the register. Fixed dates, never derived from the clock. */
  date: string;
  status: DemoAttendanceStatus;
  /** 1-based INCLUSIVE rank range within the class's pupils, ordered by id. */
  fromRank: number;
  toRank: number;
}

export type DemoAttendanceStatus =
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "EXCUSED"
  | "MEDICAL";

export interface DemoDataset {
  seed: number;
  terms: DemoTerm[];
  /** The sitting cohorts present in the data — the EXAM_COHORT periods the run must declare. */
  examCohorts: DemoExamCohort[];
  schools: DemoSchool[];
  periods: DemoOperationalPeriod[];
  facilities: DemoFacilitiesRow[];
  classes: DemoClassRow[];
  studentGroups: DemoStudentGroup[];
  terminalExamResults: DemoTerminalExamRow[];
  /** The register runs — see `DemoAttendanceMarkGroup`. Expanded to one row per pupil-day on load. */
  attendanceMarks: DemoAttendanceMarkGroup[];
}

/** The EMIS extract file format — the same `{ as_of_date, rows }` shape as the establishment file. */
export interface EmisExtractFile {
  as_of_date: string;
  rows: {
    emis_school_id: string;
    name: string;
    region: string;
    district: string;
    school_type: DemoSchoolType;
    ownership_type: DemoOwnership;
    on_schoolup: boolean;
    operational_school_id: string | null;
    as_of_date?: string;
  }[];
}

// ── the two demo terms ──────────────────────────────────────────────────────────────────────────

/**
 * TWO terms, not one. A single term cannot demonstrate the stock-not-flow rule (scope §1: sum
 * infrastructure spatially, NEVER across periods), and that rule is the one `fact_infrastructure`
 * invariant a reader can break while every number still looks internally consistent. Term 2 is the
 * current one; Term 1 is last term's census of the SAME classrooms.
 */
export const DEMO_TERMS: readonly DemoTerm[] = Object.freeze([
  {
    academicYear: "2025/26",
    term: 1,
    startsOn: "2025-09-15",
    endsOn: "2025-12-19",
    isCurrent: false,
  },
  {
    academicYear: "2025/26",
    term: 2,
    startsOn: "2026-01-12",
    endsOn: "2026-04-02",
    isCurrent: true,
  },
]);

/** The register's vintage. Fixed, not `today`, so the artefact is byte-stable across days. */
export const DEMO_REGISTER_AS_OF = "2026-09-01";

/** One declared sitting cohort — the shape `EtlRunOptions.examCohorts` takes. */
export interface DemoExamCohort {
  /** The sitting CALENDAR year. Maps to the EXAM_COHORT academic_year "(N-1)/N". */
  sittingYear: number;
  startsOn: string;
  /** The sitting's close — and therefore every fact row's frozen `as_of_date`. Never `now()`. */
  endsOn: string;
}

/**
 * TWO SITTING YEARS, not one, and this is the third slice's equivalent of `DEMO_TERMS` having two terms.
 *
 * A single sitting cannot demonstrate either of the two rules that make `fact_performance_exam`
 * dangerous to read:
 *   · BACKFILL IS LEGITIMATE HERE. A sitting is a CLOSED, IMMUTABLE cohort, so the arm runs for every
 *     declared cohort rather than the current year only (which is the enrolment arm's rule, and the
 *     opposite one). Two years is what makes that testable rather than asserted.
 *   · ROLL-UPS SUM SPATIALLY, NEVER ACROSS SITTINGS. The 2025 and 2026 BECE candidates are DIFFERENT
 *     CHILDREN; adding the two sittings produces a number with no referent. With one year in the data
 *     that mistake is unmakeable and therefore untested.
 *
 * The windows are the REGULAR MAY/JUNE sitting (BECE and WASSCE both sit in that window in Ghana). They
 * are fixed dates, not derived from the clock, so the artefact and every `as_of_date` are byte-stable.
 */
export const DEMO_EXAM_COHORTS: readonly DemoExamCohort[] = Object.freeze([
  { sittingYear: 2025, startsOn: "2025-05-05", endsOn: "2025-06-27" },
  { sittingYear: 2026, startsOn: "2026-05-04", endsOn: "2026-06-26" },
]);

// ── deterministic ids ───────────────────────────────────────────────────────────────────────────

function pad12(n: number): string {
  return String(n).padStart(12, "0");
}

/** The operational tenant uuid for school #n. Index-derived, so it is stable across runs. */
export function demoOperationalSchoolId(index: number): string {
  return `a1000000-0000-4000-8000-${pad12(index)}`;
}

/** The school's OWN period uuid for a term — per-school, as operational periods really are. */
export function demoOperationalPeriodId(index: number, term: number): string {
  return `b100000${term}-0000-4000-8000-${pad12(index)}`;
}

/** The operational class uuid for class #n of school #index. Index-derived, so it is run-stable. */
export function demoOperationalClassId(index: number, classIndex: number): string {
  return `c1000000-0000-4000-8000-${pad12(index * 100 + classIndex)}`;
}

// ── generation ──────────────────────────────────────────────────────────────────────────────────

const SCHOOL_TYPE_MIX: readonly (readonly [DemoSchoolType, number])[] = Object.freeze([
  // Basic-heavy, as Ghana's register is: KG + PRIMARY + JHS are the overwhelming majority.
  ["PRIMARY", 0.4],
  ["JHS", 0.25],
  ["KG", 0.15],
  ["SHS", 0.1],
  ["COMBINED", 0.1],
]);

const OWNERSHIP_MIX: readonly (readonly [DemoOwnership, number])[] = Object.freeze([
  ["PUBLIC", 0.7],
  ["PRIVATE", 0.25],
  ["MISSION", 0.05],
]);

/** P(a registered school is live on Omnischools). Below 1 on purpose — see the header. */
const ON_SCHOOLUP_RATE = 0.875;

/**
 * Schools generated per district — ~950 across the 73 districts.
 *
 * THE DENSITY IS A STATISTICAL DECISION, NOT A SIZE PREFERENCE. At 5–7 schools per district the
 * REGIONAL roll-ups read well (n ≈ 25) but a DISTRICT drill-down is pure small-sample noise: with 5
 * schools and P(ICT lab) ≈ 0.26, "Accra Metropolitan: 0% ICT" is a perfectly likely draw and reads as
 * a data bug to anyone looking at it. Since the district tier is the one a district director actually
 * works in, the demo has to be credible there. 10–16 per district puts districts at n ≈ 13 and regions
 * at n ≈ 55, which is where the percentages stop jumping around.
 *
 * Cost: ~950 register rows and ~1,650 census rows per term. The seed and the ETL both stay comfortably
 * inside a couple of seconds, so there is nothing to trade off against.
 */
const SCHOOLS_PER_DISTRICT_MIN = 10;
const SCHOOLS_PER_DISTRICT_MAX = 16;

function schoolName(
  rng: Rng,
  type: DemoSchoolType,
  ownership: DemoOwnership,
  used: Set<string>,
): string {
  const stem = rng.pick(SCHOOL_NAME_STEMS);
  const suffix =
    type === "KG"
      ? "KG"
      : type === "PRIMARY"
        ? "Primary School"
        : type === "JHS"
          ? "JHS"
          : type === "SHS"
            ? "Senior High School"
            : "Basic School";
  const qualifier =
    ownership === "MISSION"
      ? `${rng.pick(MISSION_PATRONS)} `
      : ownership === "PRIVATE"
        ? rng.pick(["", "", "Academy ", "International "])
        : rng.pick(["", "", "Community ", "Model "]);
  let name = `${stem} ${qualifier}${suffix}`.replace(/\s+/g, " ").trim();
  // Names are display data; a collision is cosmetic, but an unambiguous register reads better.
  let n = 2;
  while (used.has(name))
    name = `${stem} ${qualifier}${suffix} ${n++}`.replace(/\s+/g, " ");
  used.add(name);
  return name;
}

/**
 * THE URBAN/RURAL FACILITIES GRADIENT. Every distribution below is conditioned on `urban`, and the
 * direction is the one Ghana's own EMIS/GSS reporting shows: urban schools are far likelier to have
 * piped water, grid power, WC/KVIP sanitation, a library, an ICT lab and internet; rural schools lean
 * to boreholes and wells (or nothing), solar or nothing, pit latrines, and no ICT at all.
 *
 * `previous` makes the second term a RE-CENSUS OF THE SAME SCHOOL rather than a fresh draw. That is
 * not cosmetic: infrastructure is a STOCK, and if each term were sampled independently the demo would
 * imply a country that rebuilds itself every twelve weeks — and the stock-not-flow test would be
 * asserting against noise instead of against a stable stock that moves a little. So term 2 carries term
 * 1's buildings forward, repairs a few classrooms, occasionally adds a borehole / handwashing station /
 * grid connection, and re-answers the optional-detail questions independently (a school that skipped
 * the computer count last term may answer it this term, which is exactly what makes the
 * `*_reporting_count` denominators move).
 */
function facilitiesFor(
  rng: Rng,
  school: DemoSchool,
  term: DemoTerm,
  capturedAt: string,
  previous: DemoFacilitiesRow | null,
): DemoFacilitiesRow {
  if (previous) return nextTermCensus(rng, school, term, capturedAt, previous);
  const urban = school.urban;
  const big = school.schoolType === "SHS" || school.schoolType === "COMBINED";

  const classroomsTotal = big ? rng.int(12, 34) : urban ? rng.int(6, 18) : rng.int(3, 12);
  // Good + repair ≤ total (the operational CHECK). A few classrooms are neither — condemned or
  // under construction — which is why the two do not have to sum to the total.
  const good = rng.int(
    Math.floor(classroomsTotal * (urban ? 0.5 : 0.25)),
    classroomsTotal,
  );
  const repair = rng.int(0, classroomsTotal - good);

  const waterSource = urban
    ? rng.weighted([
        ["PIPE", 0.45],
        ["BOREHOLE", 0.35],
        ["WELL", 0.12],
        ["NONE", 0.08],
      ] as const)
    : rng.weighted([
        ["BOREHOLE", 0.4],
        ["WELL", 0.22],
        ["NONE", 0.28],
        ["PIPE", 0.1],
      ] as const);

  const electricitySource = urban
    ? rng.weighted([
        ["GRID", 0.78],
        ["GENERATOR", 0.08],
        ["SOLAR", 0.06],
        ["NONE", 0.08],
      ] as const)
    : rng.weighted([
        ["GRID", 0.34],
        ["SOLAR", 0.16],
        ["GENERATOR", 0.04],
        ["NONE", 0.46],
      ] as const);

  const latrineType = urban
    ? rng.weighted([
        ["WC", 0.34],
        ["KVIP", 0.44],
        ["PIT", 0.17],
        ["NONE", 0.05],
      ] as const)
    : rng.weighted([
        ["KVIP", 0.32],
        ["PIT", 0.45],
        ["NONE", 0.17],
        ["WC", 0.06],
      ] as const);

  const hasLatrines = latrineType !== "NONE";
  const latrinesBoys = hasLatrines ? rng.int(1, urban ? 8 : 4) : 0;
  const latrinesGirls = hasLatrines ? rng.int(1, urban ? 8 : 4) : 0;
  const latrinesStaff = hasLatrines ? rng.int(0, urban ? 3 : 1) : 0;

  const handwashing = rng.bool(urban ? 0.72 : 0.38);
  const hasLibrary = rng.bool(urban ? 0.46 : 0.14);
  const hasIctLab = rng.bool(urban ? 0.38 : 0.07);
  // Internet is gated on power: a school with no electricity source has no internet.
  const internet = electricitySource !== "NONE" && rng.bool(urban ? 0.44 : 0.09);
  const hasKitchen = rng.bool(urban ? 0.52 : 0.41);
  // GSFP is a public-basic programme: private schools are not on it.
  const gsfpParticipating =
    school.ownershipType === "PUBLIC" &&
    school.schoolType !== "SHS" &&
    rng.bool(urban ? 0.55 : 0.78);

  // ---- optional detail: answered by SOME schools only (the *_reporting_count denominators) ----
  // Reporting propensity is itself urban-skewed, which is realistic AND makes the honest denominator
  // visibly different per region rather than uniformly ~60%.
  const reportsComputers = rng.bool(urban ? 0.72 : 0.42);
  const computersTotal = reportsComputers
    ? hasIctLab
      ? rng.int(8, 60)
      : rng.int(0, 6)
    : null;
  const computersWorking =
    computersTotal === null
      ? null
      : rng.int(Math.floor(computersTotal * 0.4), computersTotal);

  const reportsLibraryBooks = rng.bool(urban ? 0.6 : 0.3);
  const libraryBookCount = reportsLibraryBooks
    ? hasLibrary
      ? rng.int(180, 4200)
      : rng.int(0, 120)
    : null;

  const reportsFurniture = rng.bool(urban ? 0.68 : 0.47);
  const studentDesksUsable = reportsFurniture
    ? rng.int(classroomsTotal * 8, classroomsTotal * 26)
    : null;
  const studentDesksBroken = reportsFurniture ? rng.int(0, classroomsTotal * 6) : null;
  const teacherDesks = reportsFurniture ? rng.int(0, classroomsTotal) : null;
  const chalkboards = reportsFurniture ? rng.int(0, classroomsTotal) : null;
  const whiteboards = reportsFurniture ? rng.int(0, urban ? 4 : 1) : null;
  const projectors = reportsFurniture ? rng.int(0, urban ? 3 : 1) : null;

  return {
    schoolId: school.operationalSchoolId!,
    periodId: demoOperationalPeriodId(
      Number(school.operationalSchoolId!.slice(-12)),
      term.term,
    ),
    classroomsTotal,
    classroomsGood: good,
    classroomsRepair: repair,
    waterSource,
    electricitySource,
    latrinesBoys,
    latrinesGirls,
    latrinesStaff,
    latrineType,
    handwashing,
    hasLibrary,
    hasIctLab,
    internet,
    hasKitchen,
    gsfpParticipating,
    libraryBookCount,
    libraryStaffFte: hasLibrary && reportsLibraryBooks ? rng.int(0, 2) : null,
    computersTotal,
    computersWorking,
    internetType: internet ? rng.pick(["FIBRE", "MOBILE_BROADBAND", "VSAT"]) : null,
    mealsServedLastTerm: gsfpParticipating ? rng.int(2_000, 38_000) : null,
    pupilsFedDailyAvg: gsfpParticipating ? rng.int(40, 520) : null,
    // Person-identifying third-party name. Present in the SOURCE on purpose: the transform must be
    // seen NOT to carry it across (lib/oversight/infrastructure.ts's hard exclusion).
    catererName: gsfpParticipating
      ? `${rng.pick(SCHOOL_NAME_STEMS)} Catering Services`
      : null,
    textbookAvailability: rng.bool(urban ? 0.55 : 0.3) ? "ADEQUATE" : "INADEQUATE",
    studentDesksUsable,
    studentDesksBroken,
    teacherDesks,
    chalkboards,
    whiteboards,
    projectors,
    note: null,
    capturedAt,
  };
}

/**
 * THE SECOND TERM: the same school, re-censused. The physical stock carries forward; a handful of
 * schools improve. Every optional-detail answer is re-rolled independently, because reporting is a
 * behaviour of the person filling in the form, not a property of the building.
 */
function nextTermCensus(
  rng: Rng,
  school: DemoSchool,
  term: DemoTerm,
  capturedAt: string,
  prev: DemoFacilitiesRow,
): DemoFacilitiesRow {
  const urban = school.urban;
  // A classroom is occasionally built; a few needing repair are repaired.
  const classroomsTotal = prev.classroomsTotal + (rng.bool(0.06) ? 1 : 0);
  const repaired =
    prev.classroomsRepair > 0 && rng.bool(0.35) ? rng.int(1, prev.classroomsRepair) : 0;
  const classroomsGood = Math.min(prev.classroomsGood + repaired, classroomsTotal);
  const classroomsRepair = Math.min(
    prev.classroomsRepair - repaired,
    classroomsTotal - classroomsGood,
  );

  // Infrastructure upgrades are rare and one-directional: nothing un-builds a borehole mid-year.
  const waterSource =
    prev.waterSource === "NONE" && rng.bool(0.05) ? "BOREHOLE" : prev.waterSource;
  const electricitySource =
    prev.electricitySource === "NONE" && rng.bool(0.04)
      ? rng.bool(0.5)
        ? "SOLAR"
        : "GRID"
      : prev.electricitySource;
  const latrineType =
    prev.latrineType === "NONE" && rng.bool(0.06) ? "KVIP" : prev.latrineType;
  const hasLatrines = latrineType !== "NONE";

  const handwashing = prev.handwashing || rng.bool(0.07);
  const hasLibrary = prev.hasLibrary || rng.bool(0.02);
  const hasIctLab = prev.hasIctLab || rng.bool(0.02);
  const internet = electricitySource !== "NONE" && (prev.internet || rng.bool(0.03));
  const gsfpParticipating = prev.gsfpParticipating;

  const reportsComputers = rng.bool(urban ? 0.72 : 0.42);
  const computersTotal = reportsComputers
    ? (prev.computersTotal ?? (hasIctLab ? rng.int(8, 60) : rng.int(0, 6)))
    : null;
  const computersWorking =
    computersTotal === null
      ? null
      : rng.int(Math.floor(computersTotal * 0.4), computersTotal);
  const reportsLibraryBooks = rng.bool(urban ? 0.6 : 0.3);
  const libraryBookCount = reportsLibraryBooks
    ? (prev.libraryBookCount ?? (hasLibrary ? rng.int(180, 4200) : rng.int(0, 120)))
    : null;
  const reportsFurniture = rng.bool(urban ? 0.68 : 0.47);

  return {
    ...prev,
    periodId: demoOperationalPeriodId(Number(prev.schoolId.slice(-12)), term.term),
    classroomsTotal,
    classroomsGood,
    classroomsRepair,
    waterSource,
    electricitySource,
    latrinesBoys: hasLatrines ? Math.max(prev.latrinesBoys, 1) : 0,
    latrinesGirls: hasLatrines ? Math.max(prev.latrinesGirls, 1) : 0,
    latrinesStaff: prev.latrinesStaff,
    latrineType,
    handwashing,
    hasLibrary,
    hasIctLab,
    internet,
    gsfpParticipating,
    libraryBookCount,
    computersTotal,
    computersWorking,
    internetType: internet ? (prev.internetType ?? "MOBILE_BROADBAND") : null,
    studentDesksUsable: reportsFurniture
      ? (prev.studentDesksUsable ?? rng.int(classroomsTotal * 8, classroomsTotal * 26))
      : null,
    studentDesksBroken: reportsFurniture
      ? (prev.studentDesksBroken ?? rng.int(0, classroomsTotal * 6))
      : null,
    teacherDesks: reportsFurniture
      ? (prev.teacherDesks ?? rng.int(0, classroomsTotal))
      : null,
    chalkboards: reportsFurniture
      ? (prev.chalkboards ?? rng.int(0, classroomsTotal))
      : null,
    whiteboards: reportsFurniture
      ? (prev.whiteboards ?? rng.int(0, urban ? 4 : 1))
      : null,
    projectors: reportsFurniture ? (prev.projectors ?? rng.int(0, urban ? 3 : 1)) : null,
    capturedAt,
  };
}

// ── the roster: classes and students (second slice, task H9) ────────────────────────────────────

/**
 * THE LABELLING STYLES A SCHOOL MIGHT USE, and the reason the roster generator exists in this shape.
 *
 * `class.level` is PER-SCHOOL FREE TEXT. Ghana's schools really do write the same year group three
 * different ways — "Primary 4", "Class 4" and "Basic 4" are one cohort — and GES designates JHS 1–3 as
 * "Basic 7–9", which is the single most dangerous label in the set: read naively it files a 13-year-old
 * under PRIMARY, whose GSS population band is 6–11 (see `lib/etl/stage.ts`). A generator that emitted
 * only the canonical "Primary N" / "JHS N" labels would leave every one of those rules unexercised by
 * demo data and tested only by a unit test — so each school picks a style and keeps it.
 */
const PRIMARY_STYLES = ["Primary", "Class", "Basic"] as const;
const JHS_STYLES = ["JHS", "JSS", "Basic"] as const;
const SHS_STYLES = ["Form", "SHS"] as const;

function primaryLevel(style: (typeof PRIMARY_STYLES)[number], n: number): string {
  return `${style} ${n}`;
}

/** JHS 1–3 under the school's style — including the "Basic 7–9" voice (JHS n → Basic n+6). */
function jhsLevel(style: (typeof JHS_STYLES)[number], n: number): string {
  return style === "Basic" ? `Basic ${n + 6}` : `${style} ${n}`;
}

function shsLevel(style: (typeof SHS_STYLES)[number], n: number): string {
  return `${style} ${n}`;
}

/** Realistic Ghanaian class sizes, urban-skewed and bigger up the ladder. */
function classSize(
  rng: Rng,
  urban: boolean,
  tier: "KG" | "PRIMARY" | "JHS" | "SHS",
): number {
  if (tier === "KG") return urban ? rng.int(22, 44) : rng.int(14, 32);
  if (tier === "PRIMARY") return urban ? rng.int(26, 48) : rng.int(16, 38);
  if (tier === "JHS") return urban ? rng.int(30, 52) : rng.int(18, 42);
  return urban ? rng.int(34, 58) : rng.int(24, 46);
}

/**
 * ONE SCHOOL'S ROSTER: its classes, and an ACTIVE student group per class per sex.
 *
 * WHAT IS DELIBERATELY IMPERFECT HERE, because each imperfection is a pipeline rule that would
 * otherwise be exercised only by a hand-built fixture (they are keyed off the school INDEX, so they are
 * stable across runs and a reviewer can find them):
 *   · a NURSERY class (index % 97)        → the OUT_OF_SCOPE tally: real children, below KG, in no stage
 *   · an UNPARSEABLE class (index % 101)  → the UNMAPPED tally: level NULL, name "Transition Stream"
 *   · class_id-NULL students (index % 89) → counted from `current_class_label` ("JHS 2"), never dropped
 *   · label-less, class-less students (index % 173) → UNMAPPED: nothing to read, and still counted
 *   · a FORM 1 class in a JHS/PRIMARY school (index % 151) → the school_type DRIFT flag, from real data
 *   · NON-ACTIVE students in most classes → they must contribute to NO row (status = 'ACTIVE' only)
 *
 * The sex split is ~49% female with per-class variation, so `ALL = MALE + FEMALE` is a real equality
 * over uneven numbers rather than over a clean half.
 */
function rosterFor(
  rng: Rng,
  school: DemoSchool,
  index: number,
): { classes: DemoClassRow[]; groups: DemoStudentGroup[] } {
  const schoolId = school.operationalSchoolId!;
  const classes: DemoClassRow[] = [];
  const groups: DemoStudentGroup[] = [];
  let classIndex = 0;

  const primaryStyle = rng.pick(PRIMARY_STYLES);
  const jhsStyle = rng.pick(JHS_STYLES);
  const shsStyle = rng.pick(SHS_STYLES);

  /** The levels this school teaches, from its school_type — the LABELS, not the stage. */
  const levels: {
    level: string | null;
    name: string;
    tier: "KG" | "PRIMARY" | "JHS" | "SHS";
  }[] = [];
  const addKg = () => {
    for (const n of [1, 2])
      levels.push({ level: `KG ${n}`, name: `KG ${n}`, tier: "KG" });
  };
  const addPrimary = () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const level = primaryLevel(primaryStyle, n);
      levels.push({ level, name: level, tier: "PRIMARY" });
    }
  };
  const addJhs = () => {
    for (const n of [1, 2, 3]) {
      const level = jhsLevel(jhsStyle, n);
      levels.push({ level, name: level, tier: "JHS" });
    }
  };
  const addShs = () => {
    for (const n of [1, 2, 3]) {
      const level = shsLevel(shsStyle, n);
      levels.push({ level, name: level, tier: "SHS" });
    }
  };

  switch (school.schoolType) {
    case "KG":
      addKg();
      break;
    case "PRIMARY":
      // A primary school routinely runs an attached KG — which is why the drift flag's expected set
      // for PRIMARY is {KG, PRIMARY} and this case does NOT read as drift.
      if (rng.bool(0.45)) addKg();
      addPrimary();
      break;
    case "JHS":
      addJhs();
      break;
    case "SHS":
      addShs();
      break;
    case "COMBINED":
      addKg();
      addPrimary();
      addJhs();
      break;
  }

  // ---- the deliberate edge classes ----
  if (index % 97 === 0)
    levels.push({ level: "Nursery 1", name: "Nursery 1", tier: "KG" }); // OUT_OF_SCOPE
  if (index % 101 === 0)
    levels.push({ level: null, name: "Transition Stream", tier: "PRIMARY" }); // UNMAPPED
  if (
    index % 151 === 0 &&
    (school.schoolType === "JHS" || school.schoolType === "PRIMARY")
  )
    levels.push({ level: "Form 1", name: "Form 1 Science", tier: "SHS" }); // school_type DRIFT

  for (const spec of levels) {
    // A second stream is an urban-school phenomenon, and it is what makes one `class_form` the sum of
    // two class rows — so the stage total is not trivially the breakdown.
    const streams = school.urban && rng.bool(0.35) ? ["A", "B"] : [""];
    for (const stream of streams) {
      classIndex += 1;
      const classId = demoOperationalClassId(index, classIndex);
      const name = stream ? `${spec.name} ${stream}` : spec.name;
      classes.push({
        schoolId,
        classId,
        name,
        level: spec.level,
        // A deactivated class with children still on roll is a real state; the ETL reads the label and
        // counts them anyway, because a child on roll is a child on roll.
        active: !rng.bool(0.03),
      });

      const size = classSize(rng, school.urban, spec.tier);
      const femaleShare = 0.43 + rng.next() * 0.12;
      const female = Math.round(size * femaleShare);
      const male = size - female;
      for (const [sex, headcount] of [
        ["MALE", male],
        ["FEMALE", female],
      ] as const) {
        if (headcount > 0)
          groups.push({
            schoolId,
            classId,
            currentClassLabel: name,
            sex,
            status: "ACTIVE",
            headcount,
          });
      }
      // Children who have left. They are in the table, they are not on roll, and they must reach NO
      // fact row — a roll that counted its graduates would grow for ever.
      if (rng.bool(0.5))
        groups.push({
          schoolId,
          classId,
          currentClassLabel: name,
          sex: rng.bool(0.5) ? "MALE" : "FEMALE",
          status: rng.pick([
            "GRADUATED",
            "WITHDRAWN",
            "TRANSFERRED",
            "INACTIVE",
          ] as const),
          headcount: rng.int(1, 6),
        });
    }
  }

  // ---- the deliberate class-less students ----
  if (index % 89 === 0) {
    // Admitted, not yet placed in a class. The ONLY statement of their year group is the label — and it
    // says JHS 2 whatever this school's `school_type` says.
    groups.push({
      schoolId,
      classId: null,
      currentClassLabel: "JHS 2",
      sex: "MALE",
      status: "ACTIVE",
      headcount: 3,
    });
    groups.push({
      schoolId,
      classId: null,
      currentClassLabel: "JHS 2",
      sex: "FEMALE",
      status: "ACTIVE",
      headcount: 2,
    });
  }
  if (index % 173 === 0)
    // No class and no label: nothing to read. UNMAPPED — tallied, never coerced into a stage.
    groups.push({
      schoolId,
      classId: null,
      currentClassLabel: null,
      sex: "FEMALE",
      status: "ACTIVE",
      headcount: 2,
    });

  return { classes, groups };
}

// ── the sittings: terminal exam results (third slice, task H14) ─────────────────────────────────

/**
 * WHICH EXAMS A SCHOOL PRESENTS CANDIDATES FOR, from its register `school_type`.
 *
 * BECE is the end of JUNIOR HIGH, WASSCE the end of SENIOR HIGH, so only a school that teaches the
 * terminal year presents candidates at all:
 *     JHS → BECE · SHS → WASSCE · COMBINED → BOTH · KG / PRIMARY → NEITHER
 * The KG/PRIMARY case is not a gap to be filled: those schools legitimately appear in the inclusion set
 * with NO sitting, which is what exercises the "a school that filed nothing keeps its prior rows and is
 * NOT in the delete scope" half of the write ruling.
 *
 * ⚠ THE COMBINED CASE IS A PLANTED LANDMINE, NOT A CONVENIENCE. A COMBINED school files a BECE row AND
 * a WASSCE row for the SAME sitting year, and they are DIFFERENT PUPILS — JHS 3 leavers and SHS 3
 * leavers. Summing the two into one pass rate describes a cohort that does not exist, and the figure
 * looks entirely plausible; the `exam` grain column is what makes the mistake avoidable, and the demo
 * data is what makes it testable.
 */
export function examsPresentedBy(schoolType: DemoSchoolType): ("BECE" | "WASSCE")[] {
  if (schoolType === "JHS") return ["BECE"];
  if (schoolType === "SHS") return ["WASSCE"];
  if (schoolType === "COMBINED") return ["BECE", "WASSCE"];
  return [];
}

/**
 * ONE SCHOOL'S SITTINGS across the declared cohorts.
 *
 * Grounded, not uniform: candidate numbers scale with the school's size and urbanisation, and the pass
 * rate is urban-skewed (the same gradient the facilities generator uses, for the same reason — a dataset
 * in which every district performs identically proves nothing a regional dashboard is for). The female
 * share varies per sitting, so `ALL = MALE + FEMALE` is a real equality over uneven numbers rather than
 * over a clean half, and the per-sex rates genuinely differ from the ALL rate (which is why ALL's rate
 * must be re-derived and never averaged).
 *
 * ⚠ TWO PLANTED EDGE ROWS, keyed off the school INDEX so they are stable across runs and a reviewer can
 * find them:
 *   · index % 103 === 0 → a SINGLE-SEX school: `female_candidates = 0` (and therefore `female_passed =
 *     0`). Legal operationally — only the SUM of the two is CHECKed ≥ 1 — and it is the row that makes
 *     the per-sex zero-denominator guard real: its FEMALE `qualification_rate` must be 0.00, never NaN
 *     and never a division error.
 *   · a COMBINED school → BOTH exams in the same year (see `examsPresentedBy`).
 */
function sittingsFor(
  rng: Rng,
  school: DemoSchool,
  index: number,
  cohorts: readonly DemoExamCohort[],
): DemoTerminalExamRow[] {
  const exams = examsPresentedBy(school.schoolType);
  if (exams.length === 0) return [];
  const rows: DemoTerminalExamRow[] = [];
  const singleSex = index % 103 === 0;

  for (const cohort of cohorts) {
    for (const examType of exams) {
      // A WASSCE cohort is one SHS year group; a BECE cohort one JHS 3 year group. Both are bigger in
      // urban schools, and SHS cohorts are bigger than JHS ones.
      const size =
        examType === "WASSCE"
          ? school.urban
            ? rng.int(90, 320)
            : rng.int(40, 160)
          : school.urban
            ? rng.int(40, 140)
            : rng.int(18, 80);
      const femaleShare = singleSex ? 0 : 0.4 + rng.next() * 0.18;
      const femaleCandidates = Math.round(size * femaleShare);
      const maleCandidates = Math.max(1, size - femaleCandidates);
      // Pass rates: urban-skewed, and girls a shade ahead of boys at BECE — the direction Ghana's own
      // BECE reporting shows. Each sex's rate is drawn SEPARATELY, so the ALL rate is genuinely neither
      // of them and cannot be reproduced by averaging the two.
      const basePass = school.urban ? 0.62 + rng.next() * 0.3 : 0.38 + rng.next() * 0.34;
      const femaleRate = Math.min(1, basePass + (examType === "BECE" ? 0.03 : -0.01));
      const femalePassed = Math.round(femaleCandidates * femaleRate);
      const malePassed = Math.round(maleCandidates * Math.min(1, basePass));
      rows.push({
        schoolId: school.operationalSchoolId!,
        examType,
        year: cohort.sittingYear,
        femaleCandidates,
        maleCandidates,
        femalePassed: Math.min(femalePassed, femaleCandidates),
        malePassed: Math.min(malePassed, maleCandidates),
      });
    }
  }
  return rows;
}

// ── the register: attendance marks (fourth slice, task H10) ─────────────────────────────────────

/**
 * HOW MANY REGISTER DAYS PER TERM THE DEMO MARKS, and the one simplification in this slice's data.
 *
 * A real term has 55–65 marked days; the demo marks TWO per term, as fixed day-offsets into the term
 * window. The reason is volume and nothing else: one day of national marking is ~168,000 pupil-day rows,
 * so a realistic term would put ~10 million rows in a fixture that is rebuilt several times per test run.
 *
 * ⚠ WHAT THE SIMPLIFICATION DOES AND DOES NOT COST. Every RULE the slice encodes is still exercised, and
 * exercised the same way it will be on prod: the rate's five-state denominator, the LATE-is-present
 * decision, the class→stage mapping, the stage totals, the term windowing, the FLOW roll-up across terms
 * and the deterministic `as_of_date` are all independent of HOW MANY days were marked. What it does cost is
 * MAGNITUDE: demo `enrolled_days` figures are ~2× a class's headcount rather than ~60×, so a reader should
 * not read the demo's absolute pupil-day counts as plausible national figures. Two days rather than one is
 * deliberate: with a single day `enrolled_days` would be numerically identical to the class roll, and the
 * most important thing to understand about this table — that its denominator is MARKED PUPIL-DAYS and not a
 * headcount — would be invisible in the data.
 */
const DEMO_MARK_DAY_OFFSETS = [8, 36] as const;

/**
 * A register taken on a day NO DECLARED TERM CLAIMS — fixed, in the Christmas break between the two demo
 * terms (term 1 ends 2025-12-19, term 2 opens 2026-01-12).
 *
 * It exists so the "excluded AND TALLIED" half of the term-window ruling is exercised by real demo data
 * rather than only by a unit test: holiday marking and mis-keyed dates both happen, and a pipeline whose
 * only treatment of them is a `where` clause reports nothing at all.
 */
export const DEMO_OUT_OF_WINDOW_MARK_DATE = "2025-12-29";

/** `+n` civil days on an ISO date, in UTC. No clock, no locale — the artefact must be byte-stable. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * ONE CLASS ON ONE DAY, partitioned into DISJOINT status runs — mostly PRESENT, with a realistic tail.
 *
 * The mix is grounded rather than uniform (absence is higher in rural schools, which is the direction
 * Ghana's own reporting shows and the gradient every other generator here uses), and EXCUSED / MEDICAL are
 * deliberately present in small numbers on most days: they are the two states whose treatment is the whole
 * Q5 ruling (they stay in the denominator), so a dataset without them could not demonstrate it.
 *
 * `allAbsent` is the planted all-ABSENT school: every pupil ABSENT, which is a REAL row with
 * `enrolled_days > 0`, `present_days = 0` and a rate of 0.00 — and must stay distinguishable from a school
 * that marked no register at all (which produces NO row).
 */
function statusRunsFor(
  rng: Rng,
  pupils: number,
  urban: boolean,
  allAbsent: boolean,
): { status: DemoAttendanceStatus; count: number }[] {
  if (pupils <= 0) return [];
  if (allAbsent) return [{ status: "ABSENT", count: pupils }];
  const absent = rng.int(0, Math.max(1, Math.round(pupils * (urban ? 0.1 : 0.16))));
  const late = rng.int(0, Math.max(1, Math.round(pupils * (urban ? 0.08 : 0.05))));
  const excused = rng.bool(0.45) ? rng.int(1, 2) : 0;
  const medical = rng.bool(0.35) ? rng.int(1, 2) : 0;
  const present = pupils - absent - late - excused - medical;
  // A tiny class can be fully consumed by the tail; PRESENT is the remainder, never negative, and the
  // runs always sum to exactly `pupils` so the partition stays a partition.
  const runs: { status: DemoAttendanceStatus; count: number }[] = [
    { status: "PRESENT", count: Math.max(0, present) },
    { status: "LATE", count: late },
    { status: "EXCUSED", count: excused },
    { status: "MEDICAL", count: medical },
    { status: "ABSENT", count: absent },
  ];
  let over = runs.reduce((t, r) => t + r.count, 0) - pupils;
  // Trim from the tail (ABSENT first) rather than from PRESENT, so a clamped tiny class does not become
  // an implausible all-absent one.
  for (let i = runs.length - 1; i >= 0 && over > 0; i--) {
    const take = Math.min(over, runs[i]!.count);
    runs[i]!.count -= take;
    over -= take;
  }
  return runs.filter((r) => r.count > 0);
}

/**
 * ONE SCHOOL'S REGISTERS across the declared terms.
 *
 * ⚠ THE PLANTED EDGE CASES, keyed off the school INDEX so they are stable across runs and a reviewer can
 * find them. Each one is a landmine in Kofi's H10 ruling that would otherwise be exercised only by a
 * hand-built fixture:
 *   · index % 109 === 0 → NO MARKS AT ALL IN THE FIRST TERM (and normal marks in the others). The school is
 *     therefore NOT COMPUTED for that term, is NOT in its delete scope, and KEEPS its prior rows —
 *     stale-but-honest. It must stay DISTINGUISHABLE from:
 *   · index % 113 === 0 → ALL MARKS ABSENT IN THE LAST TERM. A REAL row set: enrolled_days > 0,
 *     present_days = 0, rate 0.00. The most important rows in the table, and the ones a "treat zero as no
 *     data" reader would hide.
 *   · index % 127 === 0 → ONE REGISTER DAY OUTSIDE EVERY DECLARED WINDOW (the Christmas break). Excluded
 *     from every row and TALLIED on the run outcome, never silently dropped.
 * The OUT_OF_SCOPE (Nursery, index % 97) and UNMAPPED ("Transition Stream", index % 101) classes need no
 * special handling here: the roster already plants them, registers are marked for every class a school has,
 * and the ETL tallies their marks without bucketing them.
 */
function attendanceFor(
  rng: Rng,
  school: DemoSchool,
  index: number,
  classes: DemoClassRow[],
  pupilsByClass: Map<string, number>,
  terms: readonly DemoTerm[],
): DemoAttendanceMarkGroup[] {
  const schoolId = school.operationalSchoolId!;
  const marks: DemoAttendanceMarkGroup[] = [];
  const markedClasses = classes.filter((c) => (pupilsByClass.get(c.classId) ?? 0) > 0);
  if (markedClasses.length === 0) return marks;

  const skipFirstTerm = index % 109 === 0;
  const allAbsentLastTerm = index % 113 === 0;

  const push = (classId: string, date: string, allAbsent: boolean) => {
    const pupils = pupilsByClass.get(classId) ?? 0;
    let rank = 1;
    for (const run of statusRunsFor(rng, pupils, school.urban, allAbsent)) {
      marks.push({
        schoolId,
        classId,
        date,
        status: run.status,
        fromRank: rank,
        toRank: rank + run.count - 1,
      });
      rank += run.count;
    }
  };

  terms.forEach((term, termIndex) => {
    if (skipFirstTerm && termIndex === 0) return;
    const allAbsent = allAbsentLastTerm && termIndex === terms.length - 1;
    for (const offset of DEMO_MARK_DAY_OFFSETS) {
      const date = addDays(term.startsOn, offset);
      // Defensive: a term shorter than the offsets would otherwise generate a mark outside its own
      // window, which would silently become an out-of-window tally instead of a term figure.
      if (date > term.endsOn) continue;
      for (const klass of markedClasses) push(klass.classId, date, allAbsent);
    }
  });

  // The holiday register — one class, one day, nobody's term.
  if (index % 127 === 0)
    push(markedClasses[0]!.classId, DEMO_OUT_OF_WINDOW_MARK_DATE, false);

  return marks;
}

/**
 * Build the whole dataset in memory. PURE (given a seed) — no DB, no filesystem — so a test can
 * assert hand-computed sums against exactly the rows the loader is about to write.
 */
export function generateDemoDataset(seed: number = DEFAULT_SEED): DemoDataset {
  const rng = rngOf(seed);
  const schools: DemoSchool[] = [];
  const usedNames = new Set<string>();
  let index = 0;

  for (const region of GHANA_REGIONS as readonly DemoRegion[]) {
    for (const district of region.districts as readonly DemoDistrict[]) {
      const n = rng.int(SCHOOLS_PER_DISTRICT_MIN, SCHOOLS_PER_DISTRICT_MAX);
      for (let i = 0; i < n; i++) {
        index += 1;
        const schoolType = rng.weighted(SCHOOL_TYPE_MIX);
        const ownershipType = rng.weighted(OWNERSHIP_MIX);
        const onSchoolup = rng.bool(ON_SCHOOLUP_RATE);
        schools.push({
          emisSchoolId: `GH-${region.code}-${String(index).padStart(4, "0")}`,
          name: schoolName(rng, schoolType, ownershipType, usedNames),
          regionName: region.name,
          districtName: district.name,
          schoolType,
          ownershipType,
          onSchoolup,
          operationalSchoolId: onSchoolup ? demoOperationalSchoolId(index) : null,
          asOfDate: DEMO_REGISTER_AS_OF,
          // MMDA class × region urbanisation (see DemoRegion.urbanisation). Capped below 1 so even
          // Accra Metropolitan keeps a handful of peri-urban schools — a region in which EVERY school
          // is urban would hide the within-region inequality a regional director is looking for.
          urban: rng.bool(Math.min(0.95, district.urbanShare * region.urbanisation)),
        });
      }
    }
  }

  const periods: DemoOperationalPeriod[] = [];
  const facilities: DemoFacilitiesRow[] = [];
  const classes: DemoClassRow[] = [];
  const studentGroups: DemoStudentGroup[] = [];
  const terminalExamResults: DemoTerminalExamRow[] = [];
  const attendanceMarks: DemoAttendanceMarkGroup[] = [];
  for (const school of schools) {
    if (!school.onSchoolup) continue; // no tenant → no operational census → no fact row
    const schoolIndex = Number(school.operationalSchoolId!.slice(-12));
    let previous: DemoFacilitiesRow | null = null;
    const productLine = productLineFor(school.schoolType);
    for (const term of DEMO_TERMS) {
      const periodId = demoOperationalPeriodId(schoolIndex, term.term);
      periods.push({
        schoolId: school.operationalSchoolId!,
        periodId,
        academicYear: term.academicYear,
        // Term 1/2 of the analytics calendar is period_number 1/2 operationally on BOTH lines — the
        // NUMBER coincides, the MEANING does not, which is exactly the trap product_line exists for.
        periodNumber: term.term,
        periodLabel: periodLabelFor(productLine, term.term),
        startsOn: term.startsOn,
        endsOn: term.endsOn,
        productLine,
      });
      // captured_at is the census VINTAGE and becomes the fact row's as_of_date, so it must be
      // deterministic: a wall-clock value here would make a re-run differ in provenance and turn the
      // idempotency test into a test of the clock.
      previous = facilitiesFor(
        rng,
        school,
        term,
        `${term.endsOn}T12:00:00+00:00`,
        previous,
      );
      facilities.push(previous);
    }

    // The ROSTER is per school and carries NO period (see db/seed/demo/demo-source-schema.sql): it is
    // generated once, outside the term loop, which is the generator's statement of that ruling.
    const roster = rosterFor(rng, school, schoolIndex);
    classes.push(...roster.classes);
    studentGroups.push(...roster.groups);

    // The SITTINGS are per school and per sitting YEAR, and they carry NO operational period either: a
    // sitting is identified by its calendar year (`terminal_exam_result.year`), which the ETL maps to an
    // EXAM_COHORT `dim_period`. Generated outside the term loop, for that reason.
    terminalExamResults.push(...sittingsFor(rng, school, schoolIndex, DEMO_EXAM_COHORTS));
  }

  // ── the REGISTERS: a SEPARATE PASS, WITH ITS OWN RNG ──────────────────────────────────────────
  //
  // ⚠ WHY THIS IS NOT IN THE LOOP ABOVE, where it would read more naturally. Every draw from `rng`
  // shifts the stream for everything after it, so generating marks inside that loop would change EVERY
  // facilities census, EVERY roster and EVERY sitting of EVERY subsequent school — i.e. adding the fourth
  // arm would silently move all three ALREADY-SHIPPED arms' demo figures, and a reviewer comparing
  // branches would have hundreds of unexplained differences to read past. A second, independently seeded
  // generator keeps this slice's blast radius to this slice's own data.
  //
  // The pupil count per class comes from the roster just generated and INCLUDES NON-ACTIVE pupils:
  // attendance does NOT filter by pupil status (a withdrawn child's marks from the weeks she WAS in school
  // are real pupil-days), which is exactly the ruling the ETL implements.
  const attendanceRng = rngOf(seed ^ 0x4154_5445); // "ATTE"
  const classesBySchool = new Map<string, DemoClassRow[]>();
  for (const klass of classes) {
    const held = classesBySchool.get(klass.schoolId);
    if (held) held.push(klass);
    else classesBySchool.set(klass.schoolId, [klass]);
  }
  const pupilsByClass = new Map<string, number>();
  for (const group of studentGroups) {
    if (!group.classId) continue; // a class-less child is on nobody's register
    pupilsByClass.set(
      group.classId,
      (pupilsByClass.get(group.classId) ?? 0) + group.headcount,
    );
  }
  for (const school of schools) {
    if (!school.onSchoolup) continue; // no tenant → no operational register → no fact row
    attendanceMarks.push(
      ...attendanceFor(
        attendanceRng,
        school,
        Number(school.operationalSchoolId!.slice(-12)),
        classesBySchool.get(school.operationalSchoolId!) ?? [],
        pupilsByClass,
        DEMO_TERMS,
      ),
    );
  }

  return {
    seed,
    terms: [...DEMO_TERMS],
    examCohorts: [...DEMO_EXAM_COHORTS],
    schools,
    periods,
    facilities,
    classes,
    studentGroups,
    terminalExamResults,
    attendanceMarks,
  };
}

/** The EMIS extract artefact, exactly as the register loader will read it back off disk. */
export function emisExtractFor(dataset: DemoDataset): EmisExtractFile {
  return {
    as_of_date: DEMO_REGISTER_AS_OF,
    rows: dataset.schools.map((s) => ({
      emis_school_id: s.emisSchoolId,
      name: s.name,
      region: s.regionName,
      district: s.districtName,
      school_type: s.schoolType,
      ownership_type: s.ownershipType,
      on_schoolup: s.onSchoolup,
      operational_school_id: s.operationalSchoolId,
    })),
  };
}

// ── loading ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Both demo artefact paths are resolved relative to THIS MODULE, not to `process.cwd()`.
 *
 * cwd-relative paths work only when the script is launched from `apps/oversight`, which is how the
 * pnpm scripts happen to launch it and is not how a cron, a CI step or a `tsx` invocation from the repo
 * root does. The failure is a confusing `ENOENT` on a file that is sitting right there in git.
 */
const DEMO_DIR = join(fileURLToPath(new URL("../db/seed/demo/", import.meta.url)));

/** Where the generated EMIS extract lands. Committed, so the demo runs without the generator. */
export const DEMO_EMIS_EXTRACT_PATH = join(DEMO_DIR, "emis-register-extract.json");

const DEMO_SOURCE_SCHEMA_SQL = join(DEMO_DIR, "demo-source-schema.sql");

/**
 * (Re)create `demo_source` and load the operational-shaped rows. DROP-and-CREATE, not upsert: this
 * is a demo fixture, and a half-migrated stand-in source is a worse failure than a slow reload.
 */
export async function loadDemoSource(
  sql: postgres.Sql,
  dataset: DemoDataset,
  schemaSqlPath: string = DEMO_SOURCE_SCHEMA_SQL,
): Promise<{
  periods: number;
  facilities: number;
  classes: number;
  students: number;
  terminalExamResults: number;
  attendanceMarks: number;
}> {
  await sql.unsafe(readFileSync(schemaSqlPath, "utf8"));

  const CHUNK = 500;
  for (let i = 0; i < dataset.periods.length; i += CHUNK) {
    const chunk = dataset.periods.slice(i, i + CHUNK);
    await sql`insert into demo_source.academic_period ${sql(
      chunk.map((p) => ({
        period_id: p.periodId,
        school_id: p.schoolId,
        academic_year: p.academicYear,
        period_number: p.periodNumber,
        period_label: p.periodLabel,
        starts_on: p.startsOn,
        ends_on: p.endsOn,
        product_line: p.productLine,
      })),
    )}`;
  }

  for (let i = 0; i < dataset.facilities.length; i += CHUNK) {
    const chunk = dataset.facilities.slice(i, i + CHUNK);
    await sql`insert into demo_source.facilities_snapshot ${sql(
      chunk.map((f) => ({
        school_id: f.schoolId,
        period_id: f.periodId,
        classrooms_total: f.classroomsTotal,
        classrooms_good: f.classroomsGood,
        classrooms_repair: f.classroomsRepair,
        water_source: f.waterSource,
        electricity_source: f.electricitySource,
        latrines_boys: f.latrinesBoys,
        latrines_girls: f.latrinesGirls,
        latrines_staff: f.latrinesStaff,
        latrine_type: f.latrineType,
        handwashing: f.handwashing,
        has_library: f.hasLibrary,
        has_ict_lab: f.hasIctLab,
        internet: f.internet,
        has_kitchen: f.hasKitchen,
        gsfp_participating: f.gsfpParticipating,
        library_book_count: f.libraryBookCount,
        library_staff_fte: f.libraryStaffFte,
        computers_total: f.computersTotal,
        computers_working: f.computersWorking,
        internet_type: f.internetType,
        meals_served_last_term: f.mealsServedLastTerm,
        pupils_fed_daily_avg: f.pupilsFedDailyAvg,
        caterer_name: f.catererName,
        textbook_availability: f.textbookAvailability,
        student_desks_usable: f.studentDesksUsable,
        student_desks_broken: f.studentDesksBroken,
        teacher_desks: f.teacherDesks,
        chalkboards: f.chalkboards,
        whiteboards: f.whiteboards,
        projectors: f.projectors,
        note: f.note,
        captured_at: f.capturedAt,
      })),
    )}`;
  }

  // ---- the roster: classes first (the students' composite FK target), then the students ----
  for (let i = 0; i < dataset.classes.length; i += CHUNK) {
    const chunk = dataset.classes.slice(i, i + CHUNK);
    await sql`insert into demo_source.class ${sql(
      chunk.map((c) => ({
        id: c.classId,
        school_id: c.schoolId,
        name: c.name,
        level: c.level,
        active: c.active,
      })),
    )}`;
  }

  // ONE ROW PER CHILD, expanded from the groups by `generate_series` rather than materialised in JS.
  // The source table really is one row per student — so the ETL really does aggregate, and the PII
  // allow-list is being exercised against a table with ~170,000 rows in it — while the generated
  // dataset stays a few thousand objects (see `DemoStudentGroup`). `jsonb_to_recordset` keeps the
  // parameter count at 1 per chunk and declares the column types once, here.
  const GROUP_CHUNK = 2_000;
  for (let i = 0; i < dataset.studentGroups.length; i += GROUP_CHUNK) {
    const chunk = dataset.studentGroups.slice(i, i + GROUP_CHUNK).map((g) => ({
      school_id: g.schoolId,
      class_id: g.classId,
      current_class_label: g.currentClassLabel,
      sex: g.sex,
      status: g.status,
      headcount: g.headcount,
    }));
    await sql`
      insert into demo_source.students
        (school_id, class_id, current_class_label, sex, status)
      select g.school_id, g.class_id, g.current_class_label,
             g.sex::demo_source.sex, g.status::demo_source.student_status
        from jsonb_to_recordset(${sql.json(chunk)}::jsonb)
          as g(school_id uuid, class_id uuid, current_class_label text, sex text,
               status text, headcount int),
          generate_series(1, g.headcount)`;
  }

  // ---- the sittings: already aggregates, so one row in the dataset is one row in the table ----
  for (let i = 0; i < dataset.terminalExamResults.length; i += CHUNK) {
    const chunk = dataset.terminalExamResults.slice(i, i + CHUNK);
    await sql`insert into demo_source.terminal_exam_result ${sql(
      chunk.map((t) => ({
        school_id: t.schoolId,
        exam_type: t.examType,
        year: t.year,
        female_candidates: t.femaleCandidates,
        male_candidates: t.maleCandidates,
        female_passed: t.femalePassed,
        male_passed: t.malePassed,
      })),
    )}`;
  }

  // ---- the registers: ONE ROW PER PUPIL PER DAY, expanded from the runs by RANK ----
  // The run says "pupils 1–31 of this class were PRESENT on this date"; the rank comes from
  // `row_number() over (partition by (school, class) order by id)`, so each run lands on a DISJOINT set of
  // real pupils and `uniq_attendance_student_day` holds. The COUNTS — the only thing the ETL reads — are
  // fully determined by the generated dataset, so every expected figure in the test suite is hand-computable
  // in TypeScript even though WHICH pupil got which state is not.
  //
  // The ranking is materialised ONCE into a session-temporary table rather than recomputed per chunk: the
  // window function scans every pupil in the country, and doing that once per 5,000-run chunk made the
  // demo load several times slower than the whole rest of the fixture.
  // A session-temporary table is CONNECTION-scoped, so the create, the chunked inserts that join it and
  // its disposal must all run on ONE physical connection. Doing this on a pooled `sql` was only correct
  // because every current caller happens to open with `max: 1`; that coupling lived nowhere in the
  // signature. `sql.begin` pins a single connection for the block regardless of pool size, and
  // `on commit drop` disposes of the table when the transaction ends — on success OR rollback — so a
  // failed load can never leave a stale `demo_ranked_pupil` on a connection the pool later hands out.
  await sql.begin(async (tx) => {
    await tx`
      create temporary table demo_ranked_pupil on commit drop as
        select school_id, class_id, id,
               row_number() over (partition by school_id, class_id order by id) as rank
          from demo_source.students
         where class_id is not null`;
    await tx`create index on demo_ranked_pupil (school_id, class_id, rank)`;
    const MARK_CHUNK = 20_000;
    for (let i = 0; i < dataset.attendanceMarks.length; i += MARK_CHUNK) {
      const chunk = dataset.attendanceMarks.slice(i, i + MARK_CHUNK).map((m) => ({
        school_id: m.schoolId,
        class_id: m.classId,
        date: m.date,
        status: m.status,
        from_rank: m.fromRank,
        to_rank: m.toRank,
      }));
      await tx`
        insert into demo_source.attendance_record (school_id, student_id, class_id, date, status)
        select g.school_id, p.id, g.class_id, g.date, g.status::demo_source.attendance_status
          from jsonb_to_recordset(${sql.json(chunk)}::jsonb)
            as g(school_id uuid, class_id uuid, date date, status text,
                 from_rank int, to_rank int)
          join demo_ranked_pupil p
            on p.school_id = g.school_id and p.class_id = g.class_id
           and p.rank between g.from_rank and g.to_rank`;
    }
  });

  return {
    periods: dataset.periods.length,
    facilities: dataset.facilities.length,
    classes: dataset.classes.length,
    students: dataset.studentGroups.reduce((t, g) => t + g.headcount, 0),
    terminalExamResults: dataset.terminalExamResults.length,
    attendanceMarks: dataset.attendanceMarks.reduce(
      (t, m) => t + (m.toRank - m.fromRank + 1),
      0,
    ),
  };
}

/** Write the EMIS extract artefact to disk. Stable bytes for a given seed. */
export function writeEmisExtract(dataset: DemoDataset, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(emisExtractFor(dataset), null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const seed = process.env.DEMO_SEED ? Number(process.env.DEMO_SEED) : DEFAULT_SEED;
  const dataset = generateDemoDataset(seed);

  writeEmisExtract(dataset, DEMO_EMIS_EXTRACT_PATH);
  console.log(
    `✓ EMIS extract → ${DEMO_EMIS_EXTRACT_PATH} (${dataset.schools.length} registered schools, ` +
      `${dataset.schools.filter((s) => s.onSchoolup).length} on Schoolup)`,
  );

  // The demo stand-in source lives in the ANALYTICS database (see db/seed/demo/demo-source-schema.sql
  // for why). This connection must be the PRIVILEGED owner/writer, exactly like db:migrate and
  // load-establishment — never the app runtime's read-scoped role.
  const url =
    process.env.ANALYTICS_DATABASE_URL ??
    "postgresql://omnischools:omnischools@localhost:55432/omnischools_analytics_dev";
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const loaded = await loadDemoSource(sql, dataset);
    console.log(
      `✓ demo_source → ${loaded.facilities} facilities_snapshot rows across ` +
        `${loaded.periods} school-periods (${dataset.terms.length} terms)`,
    );
    console.log(
      `✓ demo_source → ${loaded.classes} class rows and ${loaded.students} students ` +
        `(ACTIVE and not — the roster, which carries no period)`,
    );
    console.log(
      `✓ demo_source → ${loaded.terminalExamResults} terminal_exam_result rows across ` +
        `${dataset.examCohorts.length} sitting year(s) ` +
        `(${dataset.examCohorts.map((c) => c.sittingYear).join(", ")}) — BECE and WASSCE`,
    );
    console.log(
      `✓ demo_source → ${loaded.attendanceMarks} attendance_record rows ` +
        `(one per pupil per marked day, ${DEMO_MARK_DAY_OFFSETS.length} register days per term ` +
        `across ${dataset.terms.length} terms, plus a holiday register nobody's term claims)`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
