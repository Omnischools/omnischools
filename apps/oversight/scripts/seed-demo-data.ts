import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";
import { plcSexShares } from "@/lib/etl/plc";
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

/**
 * ── THE FEE BOOK (fifth slice, task H11) ────────────────────────────────────────────────────────
 * One operational-shaped `fee_category` row: the per-school LABEL the pure resolver
 * (`lib/etl/fee-category.ts`) reads. There is no mapping table to seed — by Kofi's ruling the mapping
 * is a function — so these names are the ONLY input to the category split, and the demo emits a
 * deliberate spread of them (see `DEMO_FEE_CATEGORY_NAMES`).
 */
export interface DemoFeeCategoryRow {
  schoolId: string;
  feeCategoryId: string;
  /** `fee_category.name`. Resolves to TUITION/BOARDING/FEEDING/EXAM — or deliberately to OTHER. */
  name: string;
}

export type DemoInvoiceStatus =
  | "DRAFT"
  | "ISSUED"
  | "PARTIAL"
  | "PAID"
  | "OVERDUE"
  | "EXEMPT"
  | "VOIDED";

/** One billed line on every invoice of a run. Amount in EXACT PESEWAS — never a float GHS figure. */
export interface DemoInvoiceLine {
  /** `fee_category.name`, or NULL for the deliberate no-`fee_category_id` line (→ OTHER). */
  categoryName: string | null;
  /** The line's `amount`, in pesewas (GHS × 100). Integer, so the expectation is exact. */
  amountPesewas: number;
  /** TRUE when the loader bridges this line into `pta_dues_charge` → PTA_DUES by precedence. */
  dues: boolean;
}

/**
 * A BAND of pupils in one class who share one invoice shape — NOT an invoice.
 *
 * The generator holds BANDS for the same reason it holds attendance RUNS and student GROUPS: the
 * dataset stays a few thousand objects while `loadDemoSource` expands it into ~200,000 real invoices
 * and ~400,000 real line items, so the ETL genuinely aggregates. And, as with the register, a band
 * FULLY DETERMINES every published figure — `fact_fees` depends on nothing about an invoice except the
 * per-pupil amount per category — while leaving WHICH pupil gets which bill to the loader.
 *
 * ⚠ THE BANDS WITHIN ONE (class, period) ARE DISJOINT AND THAT IS LOAD-BEARING: the loader keys a line
 * item to its invoice by (school, pupil, period), so two bands covering the same pupil in the same
 * period would make that join ambiguous — and would also mean one pupil held two bills for one term,
 * which is not the shape this demo is asserting against.
 *
 * ⚠ BANDS DO NOT COVER THE WHOLE CLASS, deliberately. Roughly 40–80% of each class is billed, because
 * `fact_fees`'s denominator is BILLED students rather than enrolled ones (see `lib/etl/fees.ts`) and a
 * demo in which every pupil was billed everything would leave that distinction untested.
 */
export interface DemoInvoiceRun {
  schoolId: string;
  classId: string;
  /** 1-based INCLUSIVE rank range within the class's pupils, ordered by id. */
  fromRank: number;
  toRank: number;
  /** The operational `academic_period.period_id` — or NULL for the planted no-term invoice. */
  periodId: string | null;
  /** The analytics TERM this bill belongs to, or NULL alongside `periodId`. Dataset bookkeeping only. */
  term: number | null;
  status: DemoInvoiceStatus;
  /** `invoice.issued_at` — a fixed instant inside the term, never the clock. */
  issuedAt: string;
  lines: DemoInvoiceLine[];
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE PLC REGISTER AND THE NTC CPD STAND-IN (increment L, the CPD/PLC slice) ─────────────────
 *
 * TWO SOURCES, DELIBERATELY APART, because they stand in for two different systems:
 *   `demo_source.plc_*`             Omnischools' OWN operational PLC module. Real aggregate SHAPE,
 *                                   demo VOLUME — identical in kind to the roster and the register.
 *   `demo_ntc_source.ntc_cpd_summary`  A THIRD PARTY'S system (the NTC CPD portal), which
 *                                   Omnischools cannot read at all today. The fact builder reads it
 *                                   through a SEAM (`lib/etl/ntc-cpd-source.ts`) and populates the
 *                                   schema's NULL-gated category/threshold columns FROM IT —
 *                                   never by inventing a figure (Kofi's C1/C2).
 *
 * ⚠ THE TEACHER POOL IS DIMENSIONED TO STAY UNDER `fact_staffing.teachers_on_roll`, and that is a
 * correctness requirement rather than tidiness. `teacher_headcount` on the fact row is PINNED to the
 * staffing arm's derived roll (pupils ÷ a drawn PTR in [12, 55]), and every coverage rate divides by
 * it — so a demo whose PLC cohort exceeded the roll would publish coverage above 100% across the
 * country. The pool is therefore `max(1, round(pupils ÷ 60))`, which sits below the roll for EVERY
 * band in `SCHOOL_LEVEL_BANDS` (whose widest is 55), and the per-PLC cohort is a fraction of that.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** One operational `plc_programme` row — the school's own cadence and its OWN PLC-only target. */
export interface DemoPlcProgrammeRow {
  schoolId: string;
  weeksPerSemester: number;
  /** `annual_plc_target` in exact HUNDREDTHS of a point (800 = the operational default of 8.00). */
  annualPlcTargetHundredths: number;
}

/** One ACTIVE or ARCHIVED `plc` group. `archivedAt` non-null is the soft-archive case. */
export interface DemoPlcGroupRow {
  schoolId: string;
  plcId: string;
  /** NULL = inherit the programme cadence (weekly). BIWEEKLY halves the session expectation. */
  overrideFrequency: "WEEKLY" | "BIWEEKLY" | null;
  archivedAt: string | null;
}

/**
 * One `plc_membership` row — ONE TEACHER in ONE PLC.
 *
 * `memberRank` is the teacher's 1-based position in the school's pool. It is NOT an operational
 * column: it is dataset bookkeeping that lets the LEDGER be derived in SQL by a deterministic rule
 * (see `loadDemoSource`) instead of being materialised as ~100,000 JS objects.
 */
export interface DemoPlcMembershipRow {
  schoolId: string;
  plcId: string;
  userId: string;
  memberRank: number;
}

/** One HELD `plc_session`. "Held" = the row exists — there is no status column upstream. */
export interface DemoPlcSessionRow {
  schoolId: string;
  plcId: string;
  sessionId: string;
  /** The CIVIL date. Fixed offsets inside the term, never the clock. */
  date: string;
  /** The session's 1-based ordinal within its PLC and term. Dataset bookkeeping, as `memberRank` is. */
  ordinal: number;
}

/**
 * One `plc_session_attendance` row — PRESENT-BY-DEFAULT, so A ROW EXISTS ONLY FOR SOMEBODY WHO WAS
 * NOT MARKED PRESENT. LATE rows are generated deliberately: Late IS Present for CPD, so a LATE row
 * must deduct NOTHING from `attendance_events` and must still earn its ledger award. A dataset without
 * them could not demonstrate the one status rule in this arm that is easy to get backwards.
 */
export interface DemoPlcAttendanceRow {
  schoolId: string;
  sessionId: string;
  userId: string;
  status: "ABSENT" | "EXCUSED" | "MEDICAL" | "LATE";
}

/**
 * One `demo_ntc_source.ntc_cpd_summary` row — (school × academic year × teacher sex).
 *
 * ⚠ NOT A FACT ROW, AND NOT A COLUMN OF ONE. Nothing in this demo hand-seeds `fact_plc_participation`;
 * these rows are an operational-SHAPED stand-in that the ETL reads through the swappable seam, exactly
 * as `facilities_snapshot` rows are. If the transform is wrong, the demo CPD figures are wrong — which
 * is the only honest arrangement.
 *
 * Every point figure is in exact HUNDREDTHS, so the reconciliation
 * `mandatory + specialised + recommended = cpd_points_total` holds EXACTLY rather than approximately.
 */
export interface DemoNtcCpdRow {
  emisSchoolId: string;
  academicYear: string;
  teacherSex: "MALE" | "FEMALE";
  specialisedHundredths: number;
  recommendedHundredths: number;
  /** The NCPD half of Mandatory — the TOPUP the builder adds to the observed PLC floor (C7). */
  ncpdHundredths: number;
  mandatoryTeachers: number;
  specialisedTeachers: number;
  recommendedTeachers: number;
  teachersMeetingThreshold: number;
  /** The national statutory total. 2000 hundredths = 20.00 points. */
  cpdTargetHundredths: number;
}

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
  /** The per-school fee book — `fee_category` rows. The resolver's only input. */
  feeCategories: DemoFeeCategoryRow[];
  /** The invoice bands — see `DemoInvoiceRun`. Expanded to real invoices + line items on load. */
  invoiceRuns: DemoInvoiceRun[];
  /** The PLC programme configurations — one per school that has configured one. */
  plcProgrammes: DemoPlcProgrammeRow[];
  /** The PLC groups. A school with NONE runs no PLC, which is a MEASUREMENT (a 0 row), not absence. */
  plcGroups: DemoPlcGroupRow[];
  plcMemberships: DemoPlcMembershipRow[];
  plcSessions: DemoPlcSessionRow[];
  /** The NON-PRESENT (and LATE) register rows. Present-by-default: there is no PRESENT row. */
  plcAttendance: DemoPlcAttendanceRow[];
  /** The NTC CPD stand-in — a DIFFERENT schema, read through a DIFFERENT seam. See `DemoNtcCpdRow`. */
  ntcCpd: DemoNtcCpdRow[];
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

// ── the fee book: categories and invoice bands (fifth slice, task H11) ──────────────────────────

/**
 * THE CATEGORY NAMES THE DEMO EMITS, and why each one is in the list.
 *
 * `fact_fees`'s category split comes from a PURE RESOLVER over `fee_category.name` (Kofi Q9 — there is
 * no mapping table), so these strings ARE the test of that resolver against data rather than against a
 * unit fixture. Each entry is here for a reason:
 *   TUITION     three spellings, one per school style — "Tuition" / "School Fees" / "Tuition Fees".
 *               A school picks one and keeps it, exactly as it picks a class-label style.
 *   BOARDING    "Boarding Fees" — only at schools that board (SHS / COMBINED).
 *   FEEDING     "Feeding" — the GSFP/canteen family.
 *   EXAM        "Examination Fees" — note it also contains the word FEES, which is precisely the
 *               collision the resolver's specific-before-generic check order exists to get right.
 *   OTHER       "Printing Levy" — THE DELIBERATE OTHER CASE. It matches no family, so it must land in
 *               OTHER and must appear in the run's `otherCategoryNames` tally.
 *   PTA_DUES    "General Levy" — ⚠ A PLANTED TRAP. By NAME it resolves to OTHER; every line carrying it
 *               is bridged into `pta_dues_charge` by the loader, so it must be published as PTA_DUES by
 *               PRECEDENCE. That makes PTA_DUES in this demo reachable ONLY through the bridge: a
 *               resolver that tried to guess dues from a name would produce zero PTA_DUES rows and a
 *               doubled OTHER, and the test would see both.
 */
const TUITION_NAME_STYLES = ["Tuition", "School Fees", "Tuition Fees"] as const;
export const DEMO_BOARDING_CATEGORY = "Boarding Fees";
export const DEMO_FEEDING_CATEGORY = "Feeding";
export const DEMO_EXAM_CATEGORY = "Examination Fees";
/** The deliberate OTHER case — matches no keyword family, by design. */
export const DEMO_OTHER_CATEGORY = "Printing Levy";
/**
 * The dues category. ⚠ EVERY line item carrying this category is bridged into `pta_dues_charge`, and
 * the loader's bridge insert is keyed on exactly this name — which is what makes "PTA_DUES comes from
 * the bridge, never from the name" assertable end-to-end.
 */
export const DEMO_DUES_CATEGORY = "General Levy";

/**
 * The invoice-status mix. ⚠ FOUR STATUSES ARE PLANTED RATHER THAN SAMPLED (the first four bands of a
 * class, when it has that many), because each is a rule and a probability would occasionally leave a
 * term with none of them:
 *   band 0 → ISSUED   the ordinary billed state.
 *   band 1 → EXEMPT   INCLUDED, billed-as-charged — the flagged default of Kofi's status ruling.
 *   band 2 → DRAFT    EXCLUDED: a bill nobody issued.
 *   band 3 → VOIDED   EXCLUDED: a bill the school withdrew.
 * Every later band is sampled across the four INCLUDED states, so PARTIAL/PAID/OVERDUE are well
 * represented and the excluded pair stays a small, locatable minority.
 */
const PLANTED_STATUSES: readonly DemoInvoiceStatus[] = Object.freeze([
  "ISSUED",
  "EXEMPT",
  "DRAFT",
  "VOIDED",
]);
const SAMPLED_STATUSES: readonly (readonly [DemoInvoiceStatus, number])[] = Object.freeze([
  ["ISSUED", 0.4],
  ["PAID", 0.25],
  ["PARTIAL", 0.2],
  ["OVERDUE", 0.15],
]);

/** GHS × 100, rounded to the nearest 50 pesewas — real fee books are priced in half-cedis. */
function pesewasBetween(rng: Rng, loGhs: number, hiGhs: number): number {
  return rng.int(loGhs * 2, hiGhs * 2) * 50;
}

/** The fee-category uuid for category #n of school #index. Index-derived, so it is run-stable. */
export function demoOperationalFeeCategoryId(index: number, catIndex: number): string {
  return `d1000000-0000-4000-8000-${pad12(index * 100 + catIndex)}`;
}

/**
 * ONE SCHOOL'S FEE BOOK plus its invoice bands across the declared terms.
 *
 * ⚠ THE PLANTED EDGE CASES, keyed off the school INDEX so they are stable across runs and a reviewer can
 * find them. Each is a landmine in Kofi's H11 ruling that would otherwise be exercised only by a
 * hand-built fixture:
 *   · index % 131 === 0 → A FREE-SHS SCHOOL: every tuition line is billed 0.00. Its TUITION rows are
 *     REAL rows with mean 0.00 and median 0.00 — the single most consequential fee fact in Ghana — and a
 *     "treat zero as no data" reader would erase them. It must stay DISTINGUISHABLE from a school that
 *     bills no tuition at all, which gets NO tuition row.
 *   · index % 139 === 0 → A LINE WITH NO `fee_category_id` AND NO DUES BRIDGE. Nothing to resolve from
 *     (the description is not even a column), so it must land in OTHER rather than be dropped.
 *   · index % 149 === 0 → AN INVOICE WITH `period_id IS NULL`. It belongs to no term, reaches no fact
 *     row, and is TALLIED (`EtlRunReport.feesNullPeriodInvoices`) rather than vanishing.
 * The OUT_OF_SCOPE (Nursery, index % 97) and UNMAPPED ("Transition Stream", index % 101) classes need no
 * special handling: bills are issued for every class a school has, and the ETL tallies their GHS without
 * bucketing it.
 */
function feeBookFor(
  rng: Rng,
  school: DemoSchool,
  index: number,
  classes: DemoClassRow[],
  pupilsByClass: Map<string, number>,
  terms: readonly DemoTerm[],
): { categories: DemoFeeCategoryRow[]; runs: DemoInvoiceRun[] } {
  const schoolId = school.operationalSchoolId!;
  const boards = school.schoolType === "SHS" || school.schoolType === "COMBINED";
  const names = [
    rng.pick(TUITION_NAME_STYLES) as string,
    ...(boards ? [DEMO_BOARDING_CATEGORY] : []),
    DEMO_FEEDING_CATEGORY,
    DEMO_EXAM_CATEGORY,
    DEMO_OTHER_CATEGORY,
    DEMO_DUES_CATEGORY,
  ];
  const tuitionName = names[0]!;
  const categories: DemoFeeCategoryRow[] = names.map((name, i) => ({
    schoolId,
    feeCategoryId: demoOperationalFeeCategoryId(index, i + 1),
    name,
  }));

  const billedClasses = classes.filter((c) => (pupilsByClass.get(c.classId) ?? 0) > 0);
  const runs: DemoInvoiceRun[] = [];
  if (billedClasses.length === 0) return { categories, runs };

  const freeShs = index % 131 === 0;
  const uncategorisedLine = index % 139 === 0;
  const noPeriodInvoice = index % 149 === 0;

  // The school's own tariff level, drawn ONCE: fees are a school-level policy, so two pupils in the same
  // band pay the same and two bands differ by a discount/stream rather than at random. Drawing per line
  // would make every school's distribution the same wide uniform spread and the mean/median
  // indistinguishable, which is the one shape `fact_fees` exists to show.
  const tuitionFloor = school.urban ? 180 : 60;
  const tuitionCeiling = school.urban ? 900 : 320;

  for (const term of terms) {
    const periodId = demoOperationalPeriodId(Number(schoolId.slice(-12)), term.term);
    // A fixed instant inside the term — the input to the deterministic `as_of_date`. NEVER the clock:
    // `max(issued_at)` is the vintage, so a wall-clock value here would make every re-run differ.
    const issuedAt = `${addDays(term.startsOn, 5)}T09:00:00+00:00`;
    for (const klass of billedClasses) {
      const pupils = pupilsByClass.get(klass.classId) ?? 0;
      // 40–80% of the class is billed — the denominator is BILLED pupils, not enrolled ones.
      const covered = Math.max(1, Math.round(pupils * (0.4 + rng.next() * 0.4)));
      let rank = 1;
      let band = 0;
      while (rank <= covered) {
        const size = Math.min(rng.int(4, 14), covered - rank + 1);
        const status =
          band < PLANTED_STATUSES.length
            ? PLANTED_STATUSES[band]!
            : rng.weighted(SAMPLED_STATUSES);
        const lines: DemoInvoiceLine[] = [
          {
            categoryName: tuitionName,
            // THE FREE-SHS ZERO: a real billed line, amount 0. Not an absence.
            amountPesewas: freeShs
              ? 0
              : pesewasBetween(rng, tuitionFloor, tuitionCeiling),
            dues: false,
          },
        ];
        if (boards && rng.bool(0.4))
          lines.push({
            categoryName: DEMO_BOARDING_CATEGORY,
            amountPesewas: pesewasBetween(rng, 400, 1_800),
            dues: false,
          });
        if (rng.bool(0.4))
          lines.push({
            categoryName: DEMO_FEEDING_CATEGORY,
            amountPesewas: pesewasBetween(rng, 60, 350),
            dues: false,
          });
        if (rng.bool(0.25))
          lines.push({
            categoryName: DEMO_EXAM_CATEGORY,
            amountPesewas: pesewasBetween(rng, 30, 180),
            dues: false,
          });
        if (rng.bool(0.15))
          lines.push({
            categoryName: DEMO_OTHER_CATEGORY,
            amountPesewas: pesewasBetween(rng, 10, 60),
            dues: false,
          });
        // THE DUES LINE: its category NAME resolves to OTHER, and the bridge overrides that to PTA_DUES.
        if (rng.bool(0.3))
          lines.push({
            categoryName: DEMO_DUES_CATEGORY,
            amountPesewas: pesewasBetween(rng, 5, 40),
            dues: true,
          });
        // The planted no-category line — on the first band of the first class only, so it is findable.
        if (uncategorisedLine && band === 0 && klass.classId === billedClasses[0]!.classId)
          lines.push({
            categoryName: null,
            amountPesewas: pesewasBetween(rng, 20, 90),
            dues: false,
          });
        runs.push({
          schoolId,
          classId: klass.classId,
          fromRank: rank,
          toRank: rank + size - 1,
          periodId,
          term: term.term,
          status,
          issuedAt,
          lines,
        });
        rank += size;
        band += 1;
      }
    }
  }

  // THE INVOICE NO TERM CLAIMS — one pupil, one bill, `period_id IS NULL`. It must be TALLIED and must
  // reach no fact row. Kept to a single pupil so the expected tally is exactly one invoice per planted
  // school.
  if (noPeriodInvoice)
    runs.push({
      schoolId,
      classId: billedClasses[0]!.classId,
      fromRank: 1,
      toRank: 1,
      periodId: null,
      term: null,
      status: "ISSUED",
      issuedAt: `${terms[0]!.startsOn}T09:00:00+00:00`,
      lines: [
        {
          categoryName: tuitionName,
          amountPesewas: pesewasBetween(rng, tuitionFloor, tuitionCeiling),
          dues: false,
        },
      ],
    });

  return { categories, runs };
}

// ── the PLC register and the NTC CPD stand-in (increment L) ─────────────────────────────────────

/** The operational PLC-group uuid for PLC #k of school #index. Index-derived, so it is run-stable. */
export function demoOperationalPlcId(index: number, plcIndex: number): string {
  return `e1000000-0000-4000-8000-${pad12(index * 100 + plcIndex)}`;
}

/** The operational PLC-session uuid. Keyed by (school, PLC, term, ordinal) so it is run-stable. */
export function demoOperationalPlcSessionId(
  index: number,
  plcIndex: number,
  term: number,
  ordinal: number,
): string {
  return `f1000000-0000-4000-8000-${pad12((index * 100 + plcIndex) * 100 + term * 20 + ordinal)}`;
}

/**
 * A STAFF uuid. ⚠ A COUNT OF TEACHERS IS WHAT THIS DEMO PUBLISHES; the uuid exists only because the
 * operational UNIQUEs (`uniq_plc_membership`, `uniq_plc_session_attendance`, `uniq_plc_cpd_ledger`) are
 * keyed by member and are LOAD-BEARING — they are what make a distinct count a count of PEOPLE. No
 * attribute hangs off it: there is no name, no sex, no staff record, and the ETL never selects it.
 */
export function demoTeacherId(index: number, memberRank: number): string {
  return `0a000000-0000-4000-8000-${pad12(index * 1000 + memberRank)}`;
}

/** The share of schools that run a PLC at all. NOT 100%: `schools_running_plc_count = 0` is a figure. */
const PLC_RUNNING_RATE = 0.72;
/** Of the schools that run NO PLC, how many have still CONFIGURED a programme (target set, no groups). */
const PLC_CONFIGURED_WITHOUT_GROUPS_RATE = 0.55;
/** Teachers per pupil in the demo staff pool — see the section header for why it is this conservative. */
const PUPILS_PER_TEACHER_POOL = 60;
/** The share of schools the NTC extract covers. NOT 100%: a covered neighbour must not imply coverage. */
const NTC_COVERAGE_RATE = 0.92;
/** The statutory CPD total, in hundredths. 20.00 points — asserted HIGH confidence in Kofi's §8. */
const NTC_TARGET_HUNDREDTHS = 2_000;

/** Whole civil days between two ISO dates, UTC. No clock, no locale — the artefact is byte-stable. */
function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * ONE SCHOOL'S PLC MODULE across the declared terms — groups, cohorts, sessions and the non-present
 * register. The CPD LEDGER IS NOT GENERATED HERE: it is DERIVED in `loadDemoSource` from (session ×
 * member) minus the non-present rows, which is the upstream rule itself (R391 — the register's display
 * and the ledger's accrual come from one computation), and which keeps ~100,000 ledger rows out of the
 * in-memory dataset.
 *
 * ⚠ THE PLANTED EDGE CASES, keyed off the school INDEX so they are stable and findable. Each is a
 * landmine in the ruling or the schema that would otherwise be exercised only by a hand-built fixture:
 *   · index % 157 === 0 → A SCHOOL THAT RUNS A PLC BUT HELD NO SESSION IN THE LAST TERM. Session
 *     coverage 0% against a real expectation, `attendance_expected = 0` and therefore a NULL
 *     participation rate — NOT 0.00, because a rate with no denominator is not a measurement of zero.
 *   · index % 163 === 0 → A PLC THAT MET BUT LOGGED EVERY MEMBER NON-PRESENT. A REAL zero:
 *     `attendance_events = 0` against a positive expectation, rate 0.00. It must stay DISTINGUISHABLE
 *     from the case above, and from a school with no PLC at all.
 *   · index % 167 === 0 → AN ARCHIVED PLC WITH SESSIONS IN THE WINDOW. Its Fridays are history: they
 *     must reach NO fact column (the group read excludes archived PLCs) and must be TALLIED as
 *     `orphanSessions` rather than silently dropped.
 *   · index % 173 === 0 → A BIWEEKLY PLC. Its session expectation is HALF the programme's weeks, which
 *     is the only thing `plc.override_frequency` changes and is otherwise untested.
 *   · index % 179 === 0 → A SCHOOL WITH PLCs BUT NO `plc_programme` ROW. `sessions_expected` and
 *     `annual_plc_target` are then NULL — never 0, and never the upstream coalesced default of 8.
 */
function plcModuleFor(
  rng: Rng,
  school: DemoSchool,
  index: number,
  classes: DemoClassRow[],
  pupilsByClass: Map<string, number>,
  terms: readonly DemoTerm[],
): {
  programme: DemoPlcProgrammeRow | null;
  groups: DemoPlcGroupRow[];
  memberships: DemoPlcMembershipRow[];
  sessions: DemoPlcSessionRow[];
  attendance: DemoPlcAttendanceRow[];
  /** The staff pool size — the NTC stand-in is dimensioned from the SAME number. */
  teacherPool: number;
} {
  const schoolId = school.operationalSchoolId!;
  const pupils = classes.reduce((t, c) => t + (pupilsByClass.get(c.classId) ?? 0), 0);
  // Conservative ON PURPOSE — see the section header. It must stay below `teachers_on_roll`.
  const teacherPool = Math.max(1, Math.round(pupils / PUPILS_PER_TEACHER_POOL));

  const runsPlc = rng.bool(PLC_RUNNING_RATE);
  const noProgramme = index % 179 === 0;
  const biweekly = index % 173 === 0;
  const archivedExtra = index % 167 === 0;
  const allNonPresent = index % 163 === 0;
  const dormantLastTerm = index % 157 === 0;

  // A school with no PLC may still have CONFIGURED a programme (a target it set and never ran). The
  // other half has no programme row at all, which is what makes the NULL `annual_plc_target` path real.
  const hasProgramme =
    !noProgramme && (runsPlc || rng.bool(PLC_CONFIGURED_WITHOUT_GROUPS_RATE));
  const programme: DemoPlcProgrammeRow | null = hasProgramme
    ? {
        schoolId,
        // 10–14 weeks around the operational default of 12 — schools do configure their own.
        weeksPerSemester: rng.int(10, 14),
        // The operational default is 8.00; a minority of schools set their own. ⚠ NOT the statutory 20.
        annualPlcTargetHundredths: rng.bool(0.7) ? 800 : rng.int(10, 16) * 50,
      }
    : null;

  const groups: DemoPlcGroupRow[] = [];
  const memberships: DemoPlcMembershipRow[] = [];
  const sessions: DemoPlcSessionRow[] = [];
  const attendance: DemoPlcAttendanceRow[] = [];
  if (!runsPlc && !archivedExtra)
    return { programme, groups, memberships, sessions, attendance, teacherPool };

  // 1–3 active PLCs, weighted to 1–2 (a subject circle, sometimes a cross-cutting one as well).
  const activeCount = runsPlc ? rng.weighted([[1, 0.5] as const, [2, 0.35] as const, [3, 0.15] as const]) : 0;
  let plcIndex = 0;
  const plans: {
    group: DemoPlcGroupRow;
    members: DemoPlcMembershipRow[];
    /** The PLC's 1-based index within its school — part of every session's index-derived uuid. */
    plcIndex: number;
  }[] = [];
  for (let i = 0; i < activeCount; i++) {
    plcIndex += 1;
    const group: DemoPlcGroupRow = {
      schoolId,
      plcId: demoOperationalPlcId(index, plcIndex),
      overrideFrequency: biweekly && i === 0 ? "BIWEEKLY" : null,
      archivedAt: null,
    };
    // 50–95% of the pool per PLC, and the rank windows WRAP — so a teacher in two PLCs is a real,
    // common case. That is what makes `teachers_in_plc` (distinct people) differ from Σ the per-PLC
    // cohorts, which is the distinction `readPlcSchoolMemberCounts` exists for. The fraction is high
    // because a school-based PLC really does take in most of the teaching staff; it stays below the
    // pool, and the pool stays below the pinned roll, so PLC coverage cannot exceed 100%.
    const size = Math.max(1, Math.min(teacherPool, Math.round(teacherPool * (0.5 + rng.next() * 0.45))));
    const start = rng.int(1, teacherPool);
    const members: DemoPlcMembershipRow[] = [];
    for (let m = 0; m < size; m++) {
      const rank = ((start - 1 + m) % teacherPool) + 1;
      members.push({
        schoolId,
        plcId: group.plcId,
        userId: demoTeacherId(index, rank),
        memberRank: rank,
      });
    }
    groups.push(group);
    memberships.push(...members);
    plans.push({ group, members, plcIndex });
  }
  // THE ARCHIVED PLC — soft-archived upstream, so its rows survive. Its sessions are in the window and
  // must reach no fact column: the group read filters `archived_at IS NULL`.
  if (archivedExtra) {
    plcIndex += 1;
    const group: DemoPlcGroupRow = {
      schoolId,
      plcId: demoOperationalPlcId(index, plcIndex),
      overrideFrequency: null,
      archivedAt: `${terms[0]!.startsOn}T12:00:00+00:00`,
    };
    const members: DemoPlcMembershipRow[] = [
      {
        schoolId,
        plcId: group.plcId,
        userId: demoTeacherId(index, 1),
        memberRank: 1,
      },
    ];
    groups.push(group);
    memberships.push(...members);
    plans.push({ group, members, plcIndex });
  }

  for (const term of terms) {
    const weeks = programme?.weeksPerSemester ?? 12;
    // The window cannot be exceeded: a session dated outside its term would belong to no cut at all.
    const maxWeeks = Math.max(1, Math.floor((daysBetween(term.startsOn, term.endsOn) - 3) / 7) + 1);
    for (const plan of plans) {
      const expected = Math.min(
        plan.group.overrideFrequency === "BIWEEKLY" ? Math.ceil(weeks / 2) : weeks,
        maxWeeks,
      );
      const lastTerm = term.term === terms[terms.length - 1]!.term;
      // 45–95% session coverage — plausible, and wide enough that the coverage rate varies. The
      // planted dormant school holds NOTHING in the last term.
      const held =
        dormantLastTerm && lastTerm
          ? 0
          : Math.max(1, Math.round(expected * (0.45 + rng.next() * 0.5)));
      const step = plan.group.overrideFrequency === "BIWEEKLY" ? 14 : 7;
      for (let n = 1; n <= held; n++) {
        const offset = 3 + (n - 1) * step;
        if (offset > daysBetween(term.startsOn, term.endsOn)) break;
        const sessionId = demoOperationalPlcSessionId(index, plan.plcIndex, term.term, n);
        sessions.push({
          schoolId,
          plcId: plan.group.plcId,
          sessionId,
          date: addDays(term.startsOn, offset),
          ordinal: n,
        });
        // THE NON-PRESENT REGISTER. Present-by-default, so only the exceptions get a row — and LATE
        // is one of them while costing the member nothing.
        if (allNonPresent && lastTerm) {
          for (const member of plan.members)
            attendance.push({
              schoolId,
              sessionId,
              userId: member.userId,
              status: "ABSENT",
            });
          continue;
        }
        for (const member of plan.members) {
          if (!rng.bool(school.urban ? 0.14 : 0.2)) continue;
          attendance.push({
            schoolId,
            sessionId,
            userId: member.userId,
            status: rng.weighted([
              ["ABSENT", 0.5] as const,
              ["LATE", 0.26] as const,
              ["EXCUSED", 0.14] as const,
              ["MEDICAL", 0.1] as const,
            ]),
          });
        }
      }
    }
  }

  return { programme, groups, memberships, sessions, attendance, teacherPool };
}

/**
 * ONE SCHOOL'S NTC CPD EXTRACT ROWS — the stand-in the fact builder reads its NULL-gated columns from.
 *
 * ⚠ THE SEX SPLIT USES THE **FACT BUILDER'S OWN** APPORTIONMENT SHARE (`plcSexShares`, imported from
 * `lib/etl/plc.ts`), and that import is deliberate. The builder divides each sexed NTC count by that
 * sex's share of the PINNED roll, so a stand-in dimensioned on any other split would need clamping on
 * nearly every row — and the clamp exists to make a REAL mismatch between NTC's roll and ours visible,
 * not to absorb one this generator created. Using the same share keeps the clamp tally at ~0 in the
 * demo, which is what makes a non-zero tally mean something. (`scripts/` → `lib/` is the allowed
 * direction; `lib/` never imports `scripts/`.)
 *
 * THE COMPLIANCE DISTRIBUTION is grounded rather than uniform: urban schools do better, and women and
 * men differ by a per-school tilt — which is the whole point of the girls'-access frame (ruling C14).
 * ⚠ PLAUSIBILITY WEIGHTS, NOT MEASUREMENTS. No figure here is a statement about Ghana's CPD
 * compliance; the live NTC feed is not connected, and every one of these figures is marked DEMO on
 * every surface that shows it.
 */
function ntcCpdFor(
  rng: Rng,
  school: DemoSchool,
  academicYear: string,
  teacherPool: number,
): DemoNtcCpdRow[] {
  if (!rng.bool(NTC_COVERAGE_RATE)) return []; // an UNCOVERED school: its NTC columns stay NULL.
  const shares = plcSexShares(school.emisSchoolId, academicYear);
  const female = Math.round((teacherPool * shares.headPerMille) / 1000);
  const male = teacherPool - female;
  // The school's own compliance level, drawn ONCE: CPD provision is a district/school phenomenon, so
  // two teachers at one school are far more alike than two teachers in one region.
  const base = 0.25 + rng.next() * 0.5 + (school.urban ? 0.1 : 0);
  const sexTilt = (rng.next() * 2 - 1) * 0.12;
  // Per-teacher point averages, drawn once per school: Specialised is the bigger external class.
  const specialisedEach = rng.int(200, 700); // hundredths of a point per teacher
  const recommendedEach = rng.int(100, 500);
  const ncpdEach = rng.int(100, 600);
  const rows: DemoNtcCpdRow[] = [];
  for (const [teacherSex, count, tilt] of [
    ["MALE", male, -sexTilt],
    ["FEMALE", female, sexTilt],
  ] as const) {
    const compliance = Math.min(0.97, Math.max(0.03, base + tilt));
    rows.push({
      emisSchoolId: school.emisSchoolId,
      academicYear,
      teacherSex,
      specialisedHundredths: count * specialisedEach,
      recommendedHundredths: count * recommendedEach,
      ncpdHundredths: count * ncpdEach,
      // The three COVERAGE counts OVERLAP by construction — a teacher earning in two classes is in
      // both — so they are never summed to each other, and each is bounded by its sex's own pool.
      mandatoryTeachers: Math.round(count * Math.min(1, 0.6 + rng.next() * 0.4)),
      specialisedTeachers: Math.round(count * (0.3 + rng.next() * 0.6)),
      recommendedTeachers: Math.round(count * (0.2 + rng.next() * 0.6)),
      teachersMeetingThreshold: Math.round(count * compliance),
      cpdTargetHundredths: NTC_TARGET_HUNDREDTHS,
    });
  }
  return rows;
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

  // ── the FEE BOOK: A THIRD PASS, WITH ITS OWN RNG ──────────────────────────────────────────────
  //
  // ⚠ A NEW, DISTINCT SALT, for exactly the reason the attendance pass documents above: every draw from a
  // stream shifts everything after it, so generating invoices from `rng` (or from `attendanceRng`) would
  // silently move EVERY already-shipped arm's demo figures — censuses, rosters, sittings AND registers —
  // and a reviewer comparing branches would have thousands of unexplained differences to read past. A
  // third, independently seeded generator keeps this slice's blast radius to this slice's own data, and
  // `tests/etl-fees.test.ts` asserts the byte-identity of the four prior arms' datasets across it.
  //
  // It reuses `classesBySchool` / `pupilsByClass` built above (pure reads, no draws) because a bill is
  // issued to a pupil in a class — and it includes NON-ACTIVE pupils for the same reason attendance does:
  // a withdrawn child's term bill is a bill that was really issued.
  const feesRng = rngOf(seed ^ 0x4645_4553); // "FEES"
  const feeCategories: DemoFeeCategoryRow[] = [];
  const invoiceRuns: DemoInvoiceRun[] = [];
  for (const school of schools) {
    if (!school.onSchoolup) continue; // no tenant → no operational fee book → no fact row
    const book = feeBookFor(
      feesRng,
      school,
      Number(school.operationalSchoolId!.slice(-12)),
      classesBySchool.get(school.operationalSchoolId!) ?? [],
      pupilsByClass,
      DEMO_TERMS,
    );
    feeCategories.push(...book.categories);
    invoiceRuns.push(...book.runs);
  }

  // ── the PLC MODULE and the NTC STAND-IN: A FOURTH PASS, WITH ITS OWN RNG ──────────────────────
  //
  // ⚠ A NEW, DISTINCT SALT, for exactly the reason the attendance and fees passes document above:
  // every draw from a stream shifts everything after it, so generating PLC rows from `rng`,
  // `attendanceRng` or `feesRng` would silently move EVERY already-shipped arm's demo figures —
  // censuses, rosters, sittings, registers AND the whole fee book — and a reviewer comparing branches
  // would have thousands of unexplained differences to read past. A fourth, independently seeded
  // generator keeps this slice's blast radius to this slice's own data, and `tests/etl-plc.test.ts`
  // asserts the byte-identity of the five prior arms' datasets across it.
  //
  // THE TWO SOURCES SHARE ONE STREAM, deliberately: the NTC stand-in is DIMENSIONED from the PLC
  // staff pool (see `ntcCpdFor`), so drawing them together keeps the two consistent per school and
  // keeps the clamp tally at ~0 — which is what makes a non-zero clamp tally meaningful.
  const cpdRng = rngOf(seed ^ 0x4350_4443); // "CPDC"
  const plcProgrammes: DemoPlcProgrammeRow[] = [];
  const plcGroups: DemoPlcGroupRow[] = [];
  const plcMemberships: DemoPlcMembershipRow[] = [];
  const plcSessions: DemoPlcSessionRow[] = [];
  const plcAttendance: DemoPlcAttendanceRow[] = [];
  const ntcCpd: DemoNtcCpdRow[] = [];
  // The NTC extract is per ACADEMIC YEAR, and the PLC arm runs for the CURRENT one only (its
  // `teacher_headcount` is pinned to a roll that exists only there), so the stand-in carries exactly
  // that year. A stand-in covering a year the arm cannot file would be rows nothing reads.
  const cpdAcademicYear = (DEMO_TERMS.find((t) => t.isCurrent) ?? DEMO_TERMS[0]!).academicYear;
  for (const school of schools) {
    if (!school.onSchoolup) continue; // no tenant → no operational PLC module → no fact row
    const index = Number(school.operationalSchoolId!.slice(-12));
    const module = plcModuleFor(
      cpdRng,
      school,
      index,
      classesBySchool.get(school.operationalSchoolId!) ?? [],
      pupilsByClass,
      DEMO_TERMS,
    );
    if (module.programme) plcProgrammes.push(module.programme);
    plcGroups.push(...module.groups);
    plcMemberships.push(...module.memberships);
    plcSessions.push(...module.sessions);
    plcAttendance.push(...module.attendance);
    ntcCpd.push(...ntcCpdFor(cpdRng, school, cpdAcademicYear, module.teacherPool));
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
    feeCategories,
    invoiceRuns,
    plcProgrammes,
    plcGroups,
    plcMemberships,
    plcSessions,
    plcAttendance,
    ntcCpd,
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

/** Exact hundredths → the literal a `numeric(_,2)` column takes. Never via a float. */
function hundredthsLiteral(hundredths: number): string {
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

/**
 * (Re)create `demo_source` (and `demo_ntc_source`) and load the operational-shaped rows.
 * DROP-and-CREATE, not upsert: this is a demo fixture, and a half-migrated stand-in source is a worse
 * failure than a slow reload.
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
  feeCategories: number;
  invoices: number;
  invoiceLineItems: number;
  plcGroups: number;
  plcSessions: number;
  plcAttendance: number;
  /** DERIVED in SQL from (session × member) minus the non-present rows — see the insert's own note. */
  plcLedger: number;
  ntcCpd: number;
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

    // ---- the FEE BOOK: categories, then ONE INVOICE PER BILLED PUPIL, then its line items ----
    // Inside the SAME transaction as the register load because it reuses `demo_ranked_pupil`: the ranking
    // window scans every pupil in the country, and the temp table is `on commit drop` and
    // CONNECTION-scoped, so re-creating it for this pass would both cost a second full scan and reopen
    // the pooled-connection hazard the attendance load was fixed for.
    for (let i = 0; i < dataset.feeCategories.length; i += CHUNK) {
      const chunk = dataset.feeCategories.slice(i, i + CHUNK);
      await tx`insert into demo_source.fee_category ${tx(
        chunk.map((c) => ({
          id: c.feeCategoryId,
          school_id: c.schoolId,
          name: c.name,
        })),
      )}`;
    }

    // ONE INVOICE PER (pupil × period) — the bands within a (class, period) are DISJOINT, which is what
    // makes that true and what makes the line-item join below unambiguous.
    const RUN_CHUNK = 5_000;
    for (let i = 0; i < dataset.invoiceRuns.length; i += RUN_CHUNK) {
      const chunk = dataset.invoiceRuns.slice(i, i + RUN_CHUNK).map((r) => ({
        school_id: r.schoolId,
        class_id: r.classId,
        period_id: r.periodId,
        status: r.status,
        issued_at: r.issuedAt,
        from_rank: r.fromRank,
        to_rank: r.toRank,
      }));
      await tx`
        insert into demo_source.invoice (school_id, student_id, period_id, status, issued_at)
        select g.school_id, p.id, g.period_id,
               g.status::demo_source.invoice_status, g.issued_at
          from jsonb_to_recordset(${sql.json(chunk)}::jsonb)
            as g(school_id uuid, class_id uuid, period_id uuid, status text,
                 issued_at timestamptz, from_rank int, to_rank int)
          join demo_ranked_pupil p
            on p.school_id = g.school_id and p.class_id = g.class_id
           and p.rank between g.from_rank and g.to_rank`;
    }

    // THE LINE ITEMS, keyed back to their invoice by (school, pupil, period). `is not distinct from` is
    // mandatory rather than stylistic: the planted no-term invoice carries `period_id IS NULL`, and a
    // plain `=` would match nothing and silently drop its lines — turning the invoice this demo plants to
    // be TALLIED into an invoice with no lines at all, which tallies the same and proves less.
    const lineRows = dataset.invoiceRuns.flatMap((r) =>
      r.lines.map((line) => ({
        school_id: r.schoolId,
        class_id: r.classId,
        period_id: r.periodId,
        from_rank: r.fromRank,
        to_rank: r.toRank,
        // NULL for the planted no-category line. The category id is looked up by NAME inside the insert,
        // so the dataset never has to carry the per-school uuid twice.
        category_name: line.categoryName,
        // Pesewas → the numeric(12,2) literal, built from integer arithmetic so the fixture's own
        // expectation and the stored value cannot drift by a float rounding.
        amount: `${Math.floor(line.amountPesewas / 100)}.${String(line.amountPesewas % 100).padStart(2, "0")}`,
      })),
    );
    const LINE_CHUNK = 20_000;
    for (let i = 0; i < lineRows.length; i += LINE_CHUNK) {
      const chunk = lineRows.slice(i, i + LINE_CHUNK);
      await tx`
        insert into demo_source.invoice_line_item
          (school_id, invoice_id, fee_category_id, amount)
        select g.school_id, i.id, fc.id, g.amount
          from jsonb_to_recordset(${sql.json(chunk)}::jsonb)
            as g(school_id uuid, class_id uuid, period_id uuid, from_rank int, to_rank int,
                 category_name text, amount numeric)
          join demo_ranked_pupil p
            on p.school_id = g.school_id and p.class_id = g.class_id
           and p.rank between g.from_rank and g.to_rank
          join demo_source.invoice i
            on i.school_id = g.school_id and i.student_id = p.id
           and i.period_id is not distinct from g.period_id
          left join demo_source.fee_category fc
            on fc.school_id = g.school_id and fc.name = g.category_name`;
    }

    // THE DUES BRIDGE — one row per line item carrying the dues category, and NOTHING ELSE. The demo's
    // dues lines are exactly the `General Levy` ones (see `DEMO_DUES_CATEGORY`), whose NAME resolves to
    // OTHER: so every PTA_DUES row the ETL writes can ONLY have come from this bridge, which is the
    // precedence ruling made testable end-to-end. The bridge carries THREE columns — the stand-in has no
    // `rate_snapshot` to sum beside the line amount, by design.
    await tx`
      insert into demo_source.pta_dues_charge (school_id, line_item_id)
      select li.school_id, li.id
        from demo_source.invoice_line_item li
        join demo_source.fee_category fc
          on fc.school_id = li.school_id and fc.id = li.fee_category_id
       where fc.name = ${DEMO_DUES_CATEGORY}`;
  });

  // ---- the PLC MODULE: programme, groups, cohorts, sessions, the non-present register ----
  // Straight inserts: unlike the roster and the register, every row here is already in the dataset
  // (the volumes are thousands, not hundreds of thousands) EXCEPT the CPD ledger, which is DERIVED
  // below.
  for (let i = 0; i < dataset.plcProgrammes.length; i += CHUNK) {
    const chunk = dataset.plcProgrammes.slice(i, i + CHUNK);
    await sql`insert into demo_source.plc_programme ${sql(
      chunk.map((p) => ({
        school_id: p.schoolId,
        weeks_per_semester: p.weeksPerSemester,
        // Hundredths → the numeric(5,2) literal, built from integer arithmetic so the fixture's own
        // expectation and the stored value cannot drift by a float rounding.
        annual_plc_target: `${Math.floor(p.annualPlcTargetHundredths / 100)}.${String(
          p.annualPlcTargetHundredths % 100,
        ).padStart(2, "0")}`,
      })),
    )}`;
  }
  for (let i = 0; i < dataset.plcGroups.length; i += CHUNK) {
    const chunk = dataset.plcGroups.slice(i, i + CHUNK);
    await sql`insert into demo_source.plc ${sql(
      chunk.map((g) => ({
        id: g.plcId,
        school_id: g.schoolId,
        override_frequency: g.overrideFrequency,
        archived_at: g.archivedAt,
      })),
    )}`;
  }
  for (let i = 0; i < dataset.plcMemberships.length; i += CHUNK) {
    const chunk = dataset.plcMemberships.slice(i, i + CHUNK);
    await sql`insert into demo_source.plc_membership ${sql(
      chunk.map((m) => ({
        school_id: m.schoolId,
        plc_id: m.plcId,
        user_id: m.userId,
        // Every generated membership is ACTIVE (`left_at IS NULL`): the operational module stores no
        // membership history beyond this one stamp, so the ETL reads the roster AS IT STANDS and the
        // demo does not pretend otherwise (see `lib/etl/plc-source.ts`'s stated as-of limitation).
        left_at: null,
      })),
    )}`;
  }
  for (let i = 0; i < dataset.plcSessions.length; i += CHUNK) {
    const chunk = dataset.plcSessions.slice(i, i + CHUNK);
    await sql`insert into demo_source.plc_session ${sql(
      chunk.map((s) => ({
        id: s.sessionId,
        school_id: s.schoolId,
        plc_id: s.plcId,
        session_date: s.date,
      })),
    )}`;
  }
  for (let i = 0; i < dataset.plcAttendance.length; i += CHUNK) {
    const chunk = dataset.plcAttendance.slice(i, i + CHUNK);
    await sql`insert into demo_source.plc_session_attendance ${sql(
      chunk.map((a) => ({
        school_id: a.schoolId,
        session_id: a.sessionId,
        user_id: a.userId,
        status: a.status,
      })),
    )}`;
  }

  // ---- the CPD LEDGER: **DERIVED**, not generated ----
  //
  // ⚠ THE LEDGER IS THE REGISTER'S OWN CONSEQUENCE, AND THIS INSERT-SELECT IS THAT RULE. Upstream,
  // INCR-49 freezes one award per (session × member) from the SAME computation INCR-48's register
  // displays (R391: display == accrual by construction). Generating the ledger independently in
  // TypeScript would let the demo's points disagree with the demo's attendance — which is precisely
  // the inconsistency the operational module is built to prevent, and which would make the Mandatory
  // floor (`mandatory >= the observed PLC points`) a claim about two unrelated numbers.
  //
  // So: one row per (session × ACTIVE member), EXCLUDING the members whose register row says they were
  // not present — and LATE IS NOT EXCLUDED, because Late IS Present for CPD (R383). The attended arm
  // is the operational default 0.50; the reflection arm is 0.50 for a DETERMINISTIC ~70% of awards
  // (`(member_rank + ordinal) % 10 < 7`), which is an arithmetic rule rather than a random draw so the
  // whole fixture stays byte-stable without a PRNG inside SQL.
  //
  // `settled_at` is the session's own evening — the award instant the freeze is anchored to, and the
  // ANNUAL row's `as_of_date`. NEVER `now()`: a wall-clock value here would make every re-run differ in
  // provenance and turn the idempotency test into a test of the clock.
  const LEDGER_CHUNK = 20_000;
  const ledgerRows = dataset.plcSessions.map((s) => ({
    school_id: s.schoolId,
    session_id: s.sessionId,
    plc_id: s.plcId,
    ordinal: s.ordinal,
  }));
  for (let i = 0; i < ledgerRows.length; i += LEDGER_CHUNK) {
    const chunk = ledgerRows.slice(i, i + LEDGER_CHUNK);
    await sql`
      insert into demo_source.plc_cpd_ledger
        (school_id, session_id, user_id, attended_pts, reflection_pts, settled_at)
      select g.school_id, g.session_id, m.user_id,
             0.50,
             case when ((m.rank_hint + g.ordinal) % 10) < 7 then 0.50 else 0.00 end,
             (s.session_date + interval '18 hours')
        from jsonb_to_recordset(${sql.json(chunk)}::jsonb)
          as g(school_id uuid, session_id uuid, plc_id uuid, ordinal int)
        join demo_source.plc_session s
          on s.school_id = g.school_id and s.id = g.session_id
        join (
               select mm.school_id, mm.plc_id, mm.user_id,
                      -- The member's position within its PLC, used ONLY by the deterministic
                      -- reflection rule above. It is not an operational column.
                      row_number() over (partition by mm.school_id, mm.plc_id order by mm.user_id)
                        as rank_hint
                 from demo_source.plc_membership mm
                where mm.left_at is null
             ) m
          on m.school_id = g.school_id and m.plc_id = g.plc_id
       where not exists (
               select 1 from demo_source.plc_session_attendance a
                where a.school_id = g.school_id
                  and a.session_id = g.session_id
                  and a.user_id = m.user_id
                  and a.status in ('ABSENT', 'EXCUSED', 'MEDICAL')
             )`;
  }

  // ---- the NTC CPD STAND-IN: a DIFFERENT SCHEMA, read through a DIFFERENT SEAM ----
  // Keyed by EMIS code, because that is the only key a real NTC extract could arrive on. Nothing here
  // writes a fact row: the ETL reads these rows through `lib/etl/ntc-cpd-source.ts` and populates the
  // schema's NULL-gated columns FROM them, which is the whole of Kofi's C1/C2.
  for (let i = 0; i < dataset.ntcCpd.length; i += CHUNK) {
    const chunk = dataset.ntcCpd.slice(i, i + CHUNK);
    await sql`insert into demo_ntc_source.ntc_cpd_summary ${sql(
      chunk.map((n) => ({
        emis_school_id: n.emisSchoolId,
        academic_year: n.academicYear,
        teacher_sex: n.teacherSex,
        specialised_points: hundredthsLiteral(n.specialisedHundredths),
        recommended_points: hundredthsLiteral(n.recommendedHundredths),
        ncpd_points: hundredthsLiteral(n.ncpdHundredths),
        mandatory_teachers: n.mandatoryTeachers,
        specialised_teachers: n.specialisedTeachers,
        recommended_teachers: n.recommendedTeachers,
        teachers_meeting_threshold: n.teachersMeetingThreshold,
        cpd_target_points: hundredthsLiteral(n.cpdTargetHundredths),
      })),
    )}`;
  }

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
    feeCategories: dataset.feeCategories.length,
    invoices: dataset.invoiceRuns.reduce((t, r) => t + (r.toRank - r.fromRank + 1), 0),
    invoiceLineItems: dataset.invoiceRuns.reduce(
      (t, r) => t + (r.toRank - r.fromRank + 1) * r.lines.length,
      0,
    ),
    plcGroups: dataset.plcGroups.length,
    plcSessions: dataset.plcSessions.length,
    plcAttendance: dataset.plcAttendance.length,
    // COUNTED from the database rather than from the dataset, because this is the ONE table the
    // generator does not enumerate: the ledger is derived by the INSERT-SELECT above, so the honest
    // figure to report is the one the database actually holds.
    plcLedger: Number(
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n from demo_source.plc_cpd_ledger`
      )[0]!.n,
    ),
    ntcCpd: dataset.ntcCpd.length,
  };
}

/** The academic year the NTC stand-in covers — the CURRENT one, the only year the PLC arm files. */
function cpdYearOf(dataset: DemoDataset): string {
  return dataset.ntcCpd[0]?.academicYear ?? "no year";
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
    console.log(
      `✓ demo_source → ${loaded.invoices} invoice rows and ${loaded.invoiceLineItems} line items ` +
        `across ${loaded.feeCategories} fee categories (BILLED only — the payment estate has no ` +
        `stand-in at all), incl. Free-SHS billed-0 tuition, EXEMPT/DRAFT/VOIDED bills, a no-category ` +
        `line, a no-term invoice, and PTA dues reachable ONLY through the bridge`,
    );
    console.log(
      `✓ demo_source → ${loaded.plcGroups} plc group(s), ${loaded.plcSessions} held session(s), ` +
        `${loaded.plcAttendance} non-present/late register row(s) and ${loaded.plcLedger} CPD ledger ` +
        `award(s) DERIVED from (session × member) minus the non-present rows — incl. an archived PLC, ` +
        `a BIWEEKLY cadence, a school with PLCs but no programme row, a term held dormant and a ` +
        `session logged all-absent`,
    );
    console.log(
      `✓ demo_ntc_source → ${loaded.ntcCpd} ntc_cpd_summary row(s) (school × ${cpdYearOf(dataset)} × ` +
        `teacher sex) — ⚠ ILLUSTRATIVE DEMO DATA for the GES/NTC demo, NOT measured: the live NTC ` +
        `CPD feed is not connected. The ETL reads them through the swappable seam, so the real feed ` +
        `replaces THIS SOURCE and nothing else`,
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
