import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  bigint,
  numeric,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { dimJurisdiction, dimPeriod, dimStage, dimSubject } from "./dim";
import { refAssessmentWeights } from "./ref";
import { etlRun } from "./audit";
import {
  sexEnum,
  examEnum,
  sourceEnum,
  assessmentTypeEnum,
  schoolLevelEnum,
  feeCategoryEnum,
  anomalySeverityEnum,
  anomalyStatusEnum,
} from "./_enums";

/**
 * Fact tables (OVERSIGHT_ANALYTICS_SPEC §4).
 *
 * GRAIN RULE: one row per SCHOOL-level jurisdiction_id per period_id per breakdown. District,
 * regional and national figures are NOT stored — they are roll-ups summed up the dim_jurisdiction
 * tree at query time, so a regional number is always exactly its districts' sum (Principle 5).
 *
 * Every fact row additionally carries provenance: source, as_of_date, etl_run_id.
 */

// Shared provenance columns for every fact row.
const provenance = {
  source: sourceEnum("source").notNull(),
  asOfDate: timestamp("as_of_date", { withTimezone: true }).notNull(),
  etlRunId: uuid("etl_run_id").references(() => etlRun.runId),
};

/** fact_enrolment — enrolment-vs-population surface, dashboards' enrolment panels (§4.1). */
export const factEnrolment = pgTable("fact_enrolment", {
  factId: uuid("fact_id").primaryKey().defaultRandom(),
  jurisdictionId: uuid("jurisdiction_id")
    .notNull()
    .references(() => dimJurisdiction.jurisdictionId),
  periodId: uuid("period_id")
    .notNull()
    .references(() => dimPeriod.periodId),
  stage: text("stage")
    .notNull()
    .references(() => dimStage.stage),
  classForm: text("class_form"), // "Form 2", "P4" — null when the row is a stage total
  sex: sexEnum("sex").notNull(),
  headcount: integer("headcount").notNull(),
  ...provenance,
});

/** fact_attendance — rate stored AND its inputs stored (§4.2): inputs so a roll-up can re-derive a
 *  correct weighted rate (you cannot average rates), the stored rate so a single-school card is
 *  a no-math read. */
export const factAttendance = pgTable("fact_attendance", {
  factId: uuid("fact_id").primaryKey().defaultRandom(),
  jurisdictionId: uuid("jurisdiction_id")
    .notNull()
    .references(() => dimJurisdiction.jurisdictionId),
  periodId: uuid("period_id")
    .notNull()
    .references(() => dimPeriod.periodId),
  stage: text("stage").references(() => dimStage.stage),
  classForm: text("class_form"),
  enrolledDays: integer("enrolled_days").notNull(),
  presentDays: integer("present_days").notNull(),
  attendanceRate: numeric("attendance_rate", { precision: 5, scale: 2 }).notNull(),
  ...provenance,
});

/** fact_performance_exam — external, WAEC (§4.3). Grain: one row per school per EXAM_COHORT per exam. */
export const factPerformanceExam = pgTable("fact_performance_exam", {
  factId: uuid("fact_id").primaryKey().defaultRandom(),
  jurisdictionId: uuid("jurisdiction_id")
    .notNull()
    .references(() => dimJurisdiction.jurisdictionId),
  periodId: uuid("period_id")
    .notNull()
    .references(() => dimPeriod.periodId), // period is EXAM_COHORT type
  exam: examEnum("exam").notNull(),
  sex: sexEnum("sex").notNull(),
  candidates: integer("candidates").notNull(),
  qualified: integer("qualified").notNull(), // graded credit-or-above (A1–C6 / grades 1–6)
  qualificationRate: numeric("qualification_rate", { precision: 5, scale: 2 }).notNull(),
  ...provenance, // source = WAEC_EXTRACT or SCHOOL_ENTERED
});

/** fact_performance_subject — the subject-level cut behind the exam table (§4.4). */
export const factPerformanceSubject = pgTable("fact_performance_subject", {
  factId: uuid("fact_id").primaryKey().defaultRandom(),
  jurisdictionId: uuid("jurisdiction_id")
    .notNull()
    .references(() => dimJurisdiction.jurisdictionId),
  periodId: uuid("period_id")
    .notNull()
    .references(() => dimPeriod.periodId),
  exam: examEnum("exam").notNull(),
  subject: text("subject")
    .notNull()
    .references(() => dimSubject.subject),
  sex: sexEnum("sex").notNull(),
  candidates: integer("candidates").notNull(),
  qualified: integer("qualified").notNull(),
  qualificationRate: numeric("qualification_rate", { precision: 5, scale: 2 }).notNull(),
  ...provenance,
});

/** fact_performance_internal — internal/continuous, five-category SHS score ledger (§4.5). */
export const factPerformanceInternal = pgTable("fact_performance_internal", {
  factId: uuid("fact_id").primaryKey().defaultRandom(),
  jurisdictionId: uuid("jurisdiction_id")
    .notNull()
    .references(() => dimJurisdiction.jurisdictionId),
  periodId: uuid("period_id")
    .notNull()
    .references(() => dimPeriod.periodId), // TERM or ANNUAL
  assessmentType: assessmentTypeEnum("assessment_type").notNull(),
  schoolLevel: schoolLevelEnum("school_level").notNull(),
  stage: text("stage").references(() => dimStage.stage),
  classForm: text("class_form"),
  subject: text("subject").references(() => dimSubject.subject),
  sex: sexEnum("sex").notNull(),
  subjectScoreMean: numeric("subject_score_mean", { precision: 5, scale: 2 }),
  // SHS-only five-category breakouts (NULL for Basic).
  assignmentsScoreMean: numeric("assignments_score_mean", { precision: 5, scale: 2 }),
  midSemScoreMean: numeric("mid_sem_score_mean", { precision: 5, scale: 2 }),
  endSemScoreMean: numeric("end_sem_score_mean", { precision: 5, scale: 2 }),
  projectScoreMean: numeric("project_score_mean", { precision: 5, scale: 2 }),
  portfolioScoreMean: numeric("portfolio_score_mean", { precision: 5, scale: 2 }),
  weightsConfigId: bigint("weights_config_id", { mode: "number" }).references(
    () => refAssessmentWeights.weightsConfigId,
  ),
  pathsUsed: jsonb("paths_used"), // SHS only · {"A":12,"B":4,"C":3}
  creditRate: numeric("credit_rate", { precision: 5, scale: 2 }),
  gradebookCoverageFlag: boolean("gradebook_coverage_flag").notNull().default(false),
  scoreLedgerCoverageFlag: boolean("score_ledger_coverage_flag"),
  ...provenance, // source = SCHOOL_GRADEBOOK
});

/** fact_staffing — PTR, vacancies (§4.6). */
export const factStaffing = pgTable("fact_staffing", {
  factId: uuid("fact_id").primaryKey().defaultRandom(),
  jurisdictionId: uuid("jurisdiction_id")
    .notNull()
    .references(() => dimJurisdiction.jurisdictionId),
  periodId: uuid("period_id")
    .notNull()
    .references(() => dimPeriod.periodId),
  teachersOnRoll: integer("teachers_on_roll").notNull(),
  teachingPostsEstablished: integer("teaching_posts_established"),
  enrolmentTotal: integer("enrolment_total").notNull(),
  ptr: numeric("ptr", { precision: 5, scale: 2 }),
  vacancies: integer("vacancies"),
  ...provenance,
});

/** fact_fees — DISTRIBUTIONAL figures only; never a named pupil's balance (§4.7). */
export const factFees = pgTable("fact_fees", {
  factId: uuid("fact_id").primaryKey().defaultRandom(),
  jurisdictionId: uuid("jurisdiction_id")
    .notNull()
    .references(() => dimJurisdiction.jurisdictionId),
  periodId: uuid("period_id")
    .notNull()
    .references(() => dimPeriod.periodId),
  feeCategory: feeCategoryEnum("fee_category").notNull(),
  stage: text("stage").references(() => dimStage.stage),
  meanAmount: numeric("mean_amount", { precision: 10, scale: 2 }),
  medianAmount: numeric("median_amount", { precision: 10, scale: 2 }),
  ...provenance,
});

/**
 * fact_anomaly — the rule-based anomaly engine's output (§4.8). Written by the ETL after facts are
 * populated. `status` and `cluster_id` are the ONE place analytics accepts app writes (triage);
 * everything else is ETL-write, app-read.
 */
export const factAnomaly = pgTable("fact_anomaly", {
  anomalyId: uuid("anomaly_id").primaryKey().defaultRandom(),
  jurisdictionId: uuid("jurisdiction_id")
    .notNull()
    .references(() => dimJurisdiction.jurisdictionId),
  ruleCode: text("rule_code").notNull(),
  severity: anomalySeverityEnum("severity").notNull(),
  status: anomalyStatusEnum("status").notNull().default("NEW"),
  clusterId: uuid("cluster_id"),
  detailJson: jsonb("detail_json"),
  raisedEtlRunId: uuid("raised_etl_run_id").references(() => etlRun.runId),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
});

/* ============================================================================
 * ADDITIVE FACT DOMAINS — teacher attendance, school infrastructure, PLC participation.
 *
 * Same grain rule as every table above: ONE row per SCHOOL-level jurisdiction_id per period_id per
 * breakdown. District / regional / national figures are NEVER stored — they are summed up the
 * dim_jurisdiction tree at query time. Same doctrine too: store the RATE *and* its summable INPUTS,
 * because a roll-up cannot average rates (it must re-derive numerator ÷ denominator).
 *
 * All three are `source = OPERATIONAL_AGG` (the nightly ETL reads operational Postgres); no new
 * ov_source member and no new enum is needed for any of them.
 *
 * Each carries a UNIQUE index over its FULL grain. It does double duty: it serves the standard
 * RLS-filtered read path (`ov_in_subtree(jurisdiction_id)` + a period filter — a unique index is a
 * btree and serves reads exactly like a plain one, so there is no separate non-unique index), AND it
 * is the grain constraint. Without it a duplicated ETL row silently DOUBLES every roll-up above it —
 * an error that is invisible at every tier, because the sum is still internally consistent. It also
 * gives the ETL a clean `on conflict` upsert target, so a re-run overwrites rather than appends.
 *
 * The grain differs by table, because the breakdown does (owner answer E4):
 *   fact_teacher_attendance  UNIQUE (jurisdiction_id, period_id, sex)
 *   fact_plc_participation   UNIQUE (jurisdiction_id, period_id, sex)
 *   fact_infrastructure      UNIQUE (jurisdiction_id, period_id)      — NO breakdown, see below
 * fact_plc_participation's TERM and ANNUAL cuts are distinct period_ids, not two rows on one period,
 * so period_id alone still separates them.
 *
 * ⚠ THE `ALL` ROW IS STORED BESIDE THE SPLIT (the sexEnum idiom used by fact_enrolment and the two
 * performance tables). ov_sex = MALE | FEMALE | ALL, and the ETL writes the ALL row in ADDITION to
 * the MALE and FEMALE rows so a single-figure read needs no aggregation. The consequence is binding
 * on EVERY reader: a roll-up query MUST filter to exactly ONE sex value — `sex = 'ALL'` for a total,
 * `sex IN ('MALE','FEMALE')` for the split. Summing without a sex filter DOUBLE-COUNTS every figure,
 * and — as with a duplicated grain row — the result is internally consistent and therefore invisible.
 * There is no DB constraint that can catch this; it is a query-authoring rule.
 *
 * No new enum is introduced for any of this: sex reuses the existing ov_sex.
 *
 * ⚠ This DEVIATES from the existing eight fact tables, which are PK-only with no natural-key UNIQUE.
 * That is a deliberate, flagged call (pending consistency ratification): it is free here because
 * these three tables are empty, whereas retrofitting the existing eight would need a de-duplication
 * pass first, so it is not additive and is not done here.
 *
 * NOTE (RLS): migration 0001 ENABLEs row level security on all three at CREATE time. The POLICY is
 * applied separately — db/sql/policies.sql on dev, db/sql/prod-paste-0001-fact-domains.sql by hand on
 * prod. Enabling RLS in the migration is what makes the skip-the-paste state genuinely fail CLOSED
 * (RLS on + no policy → zero rows to a non-owner role) instead of briefly world-readable. NOT FORCEd,
 * so the owner / BYPASSRLS ETL loader still writes freely.
 * ==========================================================================*/

/**
 * fact_teacher_attendance — the teacher-side mirror of fact_attendance (§4.2 shape). Period grain
 * TERM. Rate stored AND its inputs stored, so a district roll-up re-derives a correctly weighted
 * rate from summed days rather than averaging school rates.
 *
 * THREE-STATE DAY MODEL (owner answer E1). Teacher days split into PRESENT / EXCUSED / ABSENT, not
 * the two-state present-vs-the-rest shape, because GES's headline teacher-absenteeism metric is
 *   absenteeism = absent_teacher_days ÷ expected_teacher_days
 * and it must isolate UNAUTHORISED absence. Folding approved leave and certified sickness into
 * "absent" would overstate absenteeism at every tier, and the overstatement would be largest at the
 * schools with the most honest leave records — exactly backwards as an accountability signal.
 *
 * INVARIANT (ETL-enforced, deliberately NOT a DB CHECK — a partial term's ETL row is still legal
 * mid-load, and the loader owns the reconciliation):
 *     present_teacher_days + excused_teacher_days + absent_teacher_days = expected_teacher_days
 * All four are summable, so the identity holds under roll-up at every tier.
 *
 * EXACTLY ONE STORED RATE. `teacher_attendance_rate` = present ÷ expected, and there is deliberately
 * NO excused_rate and NO absent_rate column. Every other rate re-derives EXACTLY from the summed
 * inputs above (absenteeism = sum(absent) ÷ sum(expected)), so storing them would add two columns
 * that can drift from the days they are supposed to summarise while adding no read that is not
 * already a single-row division. The one rate that IS stored earns its place by the §4.2 doctrine:
 * a single-school card reads it with no math.
 *
 * ETL STATUS MAPPING — from the OPERATIONAL `attendance_status` enum
 * (apps/web/db/schema/_enums.ts: PRESENT | ABSENT | LATE | EXCUSED | MEDICAL). All five members are
 * mapped; there is no default bucket, so a new enum member is an explicit ETL change, not a silent
 * mis-classification:
 *     PRESENT, LATE     → present_teacher_days   (LATE is present — it is a punctuality signal, not
 *                                                 an attendance one; the operational PLC register
 *                                                 already treats Late == Present for CPD)
 *     EXCUSED, MEDICAL  → excused_teacher_days   (authorised absence: approved leave / certified
 *                                                 sickness — attended-to, not unaccounted-for)
 *     ABSENT            → absent_teacher_days    (UNAUTHORISED only)
 * ⚠ NEVER fold EXCUSED or MEDICAL into absent_teacher_days. That is the single defect this column
 * split exists to prevent, and once loaded it is unrecoverable from the fact row (the three buckets
 * cannot be un-summed).
 *
 * BREAKDOWN = SEX ONLY (owner answer E4), on the stored-ALL-beside-the-split idiom — see the section
 * header for the one-sex-value-per-query rule. NO stage and NO subject breakdown: a teacher spans
 * both stages and several subjects, so a per-stage teacher-day would require apportioning one
 * person's day across stages, which is a modelling fiction, not a measurement.
 *
 * NO staff_category column (DEFERRED, not rejected): a teaching/non-teaching/management cut would
 * need a new ov_staff_category enum AND an owner ruling on the category list, and it would widen the
 * grain again. It is additive when confirmed; it is not guessed at here.
 *
 * Headcount does NOT live here — teachers_on_roll is fact_staffing's column and duplicating it would
 * let the two drift.
 *
 * ⚠ ETL POPULATION IS GATED (human-owner question E1): there is today NO operational teacher
 * daily-attendance source to aggregate from — apps/web records staff PD/PLC attendance
 * (plc_session_attendance), not a teacher daily register. The table SHAPE is correct and this
 * addition is purely additive, so the table simply stays EMPTY until that operational source exists;
 * nothing above or below depends on it being populated. The status mapping above is written now so
 * that whoever builds that register knows which bucket each status owes its day to.
 */
export const factTeacherAttendance = pgTable(
  "fact_teacher_attendance",
  {
    factId: uuid("fact_id").primaryKey().defaultRandom(),
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => dimJurisdiction.jurisdictionId),
    periodId: uuid("period_id")
      .notNull()
      .references(() => dimPeriod.periodId), // period_type = TERM
    // The ONLY breakdown (E4). ALL is stored beside MALE/FEMALE — filter to one value per query.
    sex: sexEnum("sex").notNull(),
    // Summable inputs (the roll-up's numerator/denominator).
    // INVARIANT: present + excused + absent = expected.
    expectedTeacherDays: integer("expected_teacher_days").notNull(),
    presentTeacherDays: integer("present_teacher_days").notNull(), // PRESENT + LATE
    excusedTeacherDays: integer("excused_teacher_days").notNull(), // EXCUSED + MEDICAL (authorised)
    absentTeacherDays: integer("absent_teacher_days").notNull(), // ABSENT only (unauthorised)
    // The ONE stored rate = present ÷ expected — a single-school card is a no-math read. Absenteeism
    // and the excused share re-derive exactly from the summed inputs, so they are NOT stored.
    teacherAttendanceRate: numeric("teacher_attendance_rate", {
      precision: 5,
      scale: 2,
    }).notNull(),
    ...provenance, // source = OPERATIONAL_AGG
  },
  (t) => ({
    // Grain constraint AND the RLS-filtered read path — one row per school × period × sex.
    uniqJurisdictionPeriodSex: uniqueIndex(
      "fact_teacher_attendance_jurisdiction_period_sex_idx",
    ).on(t.jurisdictionId, t.periodId, t.sex),
  }),
);

/**
 * fact_infrastructure — ONE WIDE row per school × period (TERM), aggregated by the ETL from the
 * operational `facilities_snapshot` census (apps/web/db/schema/facilities-snapshot.ts, ONE row per
 * school × academic term). source = OPERATIONAL_AGG.
 *
 * EVERY attribute is a COUNT, never a boolean and never a raw category. A school-level boolean
 * ("has electricity") or enum ("water_source = BOREHOLE") does not roll up: you cannot SUM it into a
 * district figure. Stored as 0/1 counts, the district answer is a plain SUM and reads "N of Y
 * schools". Hence:
 *   - presence booleans  → has_*_count            (0 or 1 on a school row)
 *   - fixed-domain enums → one 0/1 count per allowed value, exactly the operational CHECK allow-list
 *   - physical tallies   → stored directly (they are already summable)
 * `schools_reporting` = 1 on every school row: it is the "Y" denominator, so "3 of 12 schools have a
 * library" is sum(has_library_count) ÷ sum(schools_reporting) at any tier.
 *
 * The per-value count families mirror the operational CHECK allow-lists byte-for-byte:
 *   water_source       BOREHOLE | PIPE | WELL | NONE
 *   electricity_source GRID | SOLAR | GENERATOR | NONE
 *   latrine_type       WC | KVIP | PIT | NONE
 * Exactly one member of each family is 1 per school row (they sum to schools_reporting), which makes
 * a mis-derived ETL row arithmetically detectable. `has_water_count` / `has_electricity_count`
 * derive from source <> 'NONE' (the operational census has no separate presence boolean for those
 * two); `has_handwashing_count` / `has_internet_count` come from the `handwashing` / `internet`
 * booleans.
 *
 * OPTIONAL-DETAIL HONESTY: the operational census makes computers, library books and furniture
 * nullable. Those columns stay nullable here, and each family carries a *_reporting_count so a
 * roll-up divides by the schools that actually answered, not by all schools — "1,200 computers
 * across 8 of 12 reporting schools", never a silent zero.
 *
 * NO school_type / ownership_type here: they live on dim_jurisdiction (§3.1) and the ETL must not
 * duplicate a slowly-changing dimension attribute onto a fact.
 *
 * ⚠ NO sex AND NO stage BREAKDOWN — the deliberate exception among the three new tables (owner
 * answer E4). The grain stays (jurisdiction_id, period_id), one census row per school × period.
 * A classroom, a borehole or a generator has no sex and belongs to no stage: adding a sex column
 * would force the ETL to either duplicate the whole wide row three times (MALE/FEMALE/ALL rows all
 * carrying the same classroom count — which then sums to 3× the real estate if a reader forgets the
 * sex filter) or write MALE/FEMALE rows of zeros. Both are worse than honest.
 * Where the domain genuinely IS sexed, it is already a COLUMN split and stays one:
 * latrines_boys / latrines_girls / latrines_staff. That is the right shape here precisely because it
 * is a property of the facility, not a breakdown of the reporting school — the three sum to the
 * school's latrine stock on ONE row, with no ALL-row double-count hazard at all.
 *
 * TIME SEMANTICS: infrastructure is a STOCK, not a flow — sum it SPATIALLY (across schools) only,
 * NEVER across periods. Two terms of a school's classroom count are the same classrooms.
 */
export const factInfrastructure = pgTable(
  "fact_infrastructure",
  {
    factId: uuid("fact_id").primaryKey().defaultRandom(),
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => dimJurisdiction.jurisdictionId),
    periodId: uuid("period_id")
      .notNull()
      .references(() => dimPeriod.periodId), // period_type = TERM
    // The "Y schools" roll-up denominator — always 1 on a school row.
    schoolsReporting: integer("schools_reporting").notNull().default(1),

    // ---- Physical counts (already summable; mandatory in the operational census) ----
    classroomsTotal: integer("classrooms_total").notNull(),
    classroomsGood: integer("classrooms_good").notNull(),
    classroomsRepair: integer("classrooms_repair").notNull(),
    latrinesBoys: integer("latrines_boys").notNull(),
    latrinesGirls: integer("latrines_girls").notNull(),
    latrinesStaff: integer("latrines_staff").notNull(),
    // Optional detail in the census → nullable here (see the *_reporting_count denominators below).
    studentDesksUsable: integer("student_desks_usable"),
    studentDesksBroken: integer("student_desks_broken"),
    teacherDesks: integer("teacher_desks"),
    chalkboards: integer("chalkboards"),
    whiteboards: integer("whiteboards"),
    projectors: integer("projectors"),
    computersTotal: integer("computers_total"),
    computersWorking: integer("computers_working"),
    libraryBookCount: integer("library_book_count"),

    // ---- Presence booleans decomposed to 0/1 counts ----
    hasElectricityCount: integer("has_electricity_count").notNull(), // electricity_source <> 'NONE'
    hasWaterCount: integer("has_water_count").notNull(), // water_source <> 'NONE'
    hasHandwashingCount: integer("has_handwashing_count").notNull(), // handwashing
    hasLibraryCount: integer("has_library_count").notNull(), // has_library
    hasIctLabCount: integer("has_ict_lab_count").notNull(), // has_ict_lab
    hasInternetCount: integer("has_internet_count").notNull(), // internet
    gsfpParticipatingCount: integer("gsfp_participating_count").notNull(), // gsfp_participating
    hasKitchenCount: integer("has_kitchen_count").notNull(), // has_kitchen

    // ---- Categorical families decomposed to one 0/1 count per allowed value ----
    // water_source: BOREHOLE | PIPE | WELL | NONE (sums to schools_reporting)
    waterBoreholeCount: integer("water_borehole_count").notNull(),
    waterPipeCount: integer("water_pipe_count").notNull(),
    waterWellCount: integer("water_well_count").notNull(),
    waterNoneCount: integer("water_none_count").notNull(),
    // electricity_source: GRID | SOLAR | GENERATOR | NONE (sums to schools_reporting)
    electricityGridCount: integer("electricity_grid_count").notNull(),
    electricitySolarCount: integer("electricity_solar_count").notNull(),
    electricityGeneratorCount: integer("electricity_generator_count").notNull(),
    electricityNoneCount: integer("electricity_none_count").notNull(),
    // latrine_type: WC | KVIP | PIT | NONE (sums to schools_reporting)
    latrineWcCount: integer("latrine_wc_count").notNull(),
    latrineKvipCount: integer("latrine_kvip_count").notNull(),
    latrinePitCount: integer("latrine_pit_count").notNull(),
    latrineNoneCount: integer("latrine_none_count").notNull(),

    // ---- Honest denominators for the nullable optional-detail families ----
    computersReportingCount: integer("computers_reporting_count").notNull(),
    libraryBooksReportingCount: integer("library_books_reporting_count").notNull(),
    furnitureReportingCount: integer("furniture_reporting_count").notNull(),

    ...provenance, // source = OPERATIONAL_AGG
  },
  (t) => ({
    // Grain constraint AND the RLS-filtered read path — one census row per school × period.
    uniqJurisdictionPeriod: uniqueIndex("fact_infrastructure_jurisdiction_period_idx").on(
      t.jurisdictionId,
      t.periodId,
    ),
  }),
);

/**
 * fact_plc_participation — teacher CPD / Professional Learning Community participation, aggregated
 * from the operational PLC module (apps/web/db/schema/plc.ts: plc_programme, plc, plc_membership,
 * plc_session, plc_session_attendance, plc_cpd_ledger). source = OPERATIONAL_AGG.
 *
 * Counts and inputs, never a bare rate or a bare mean: `plc_participation_rate` is stored beside
 * attendance_events / attendance_expected, and `cpd_points_mean` beside cpd_points_total /
 * cpd_points_teacher_count, so every roll-up re-derives the weighted figure from summed inputs.
 *
 * `schools_running_plc_count` is 0/1 per school — the "N of Y schools run a PLC programme" numerator
 * — deliberately a COUNT and not a boolean, for the same reason as fact_infrastructure: a boolean
 * does not sum.
 *
 * TWO PERIOD CUTS in one table, discriminated by the referenced dim_period.period_type:
 *   TERM   rows carry sessions_* / attendance_* / plc_participation_rate / teachers_in_plc; the CPD
 *          columns are NULL.
 *   ANNUAL rows carry cpd_points_* (including the three NTC category totals and their teacher
 *          counts) / teachers_meeting_cpd_threshold / annual_plc_target / ntc_cpd_target; the
 *          session columns are NULL.
 *   BOTH   cuts carry `teacher_headcount` (see the ETL contract below) — it is the ONLY cut-spanning
 *          MEASURE, because both cuts need the same on-roll denominator — and `sex`, which is a
 *          grain key rather than a measure.
 * Hence every cut-specific column is nullable; only the grain keys (jurisdiction_id, period_id, sex)
 * and schools_running_plc_count are NOT NULL. (period_type lives on dim_period — it is not
 * duplicated onto the fact.)
 *
 * ETL CONTRACT — `teacher_headcount` IS POPULATED ON *BOTH* CUTS, TERM *AND* ANNUAL. It is not a
 * TERM-only column, and an ANNUAL row that leaves it NULL is an ETL defect, not a valid row. The
 * reason is that both headline rates divide by it, and each must be readable from a SINGLE row:
 *   TERM   PLC coverage      = teachers_in_plc               ÷ teacher_headcount
 *   ANNUAL CPD-target metric = teachers_meeting_cpd_threshold ÷ teacher_headcount
 * If ANNUAL rows omitted it, "% of staff meeting the CPD target" would have no on-roll denominator on
 * its own row: the numerator and denominator would sit on different rows with different period_ids
 * and never join, so the invariant teachers_meeting_cpd_threshold ≤ teacher_headcount would compare
 * zero rows and be VACUOUSLY true — unprovable, and silently so.
 *
 * `cpd_points_teacher_count` is explicitly NOT that denominator. It counts only teachers who already
 * have a CPD ledger entry, so dividing by it would understate non-participation: a teacher who earned
 * nothing all year would vanish from both numerator and denominator instead of counting as a miss.
 * It is the honest denominator for `cpd_points_mean` ONLY (mean points among teachers who earned
 * any). The staff-coverage denominator is always teacher_headcount.
 *
 * `teacher_headcount` is PINNED to the same population as fact_staffing.teachers_on_roll — the same
 * ETL definition of "a teacher on this school's roll this period", on BOTH cuts — so PLC coverage and
 * the CPD-target metric are comparable with PTR and vacancies rather than counting a quietly
 * different set of people. For an ANNUAL row the ETL takes the roll for the academic year that period
 * covers, by the same rule fact_staffing uses.
 *
 * TWO DIFFERENT TARGETS, DELIBERATELY BOTH STORED (owner answer E2 — this resolves a genuine name
 * collision; they are not duplicates and neither derives from the other). They are named APART on
 * purpose: anything called "the annual CPD target" reads as the statutory one, so the school's
 * self-set target carries the narrower PLC name instead.
 *   `annual_plc_target` = THE SCHOOL'S OWN configured, PLC-ONLY target. It mirrors the operational
 *      column it is copied from BY NAME — plc_programme.annual_plc_target (numeric(5,2), default 8)
 *      — so the lineage is readable without a lookup. It covers PLC participation ALONE, not a
 *      teacher's whole CPD year, and schools configure different values, so it is stored per school
 *      and is never a hard-coded constant. It measures a school against the cadence it set itself.
 *   `ntc_cpd_target` = THE NATIONAL STATUTORY CPD TOTAL from the NTC framework (nominally 20 points
 *      a year), covering ALL CPD a teacher earns, not just PLC. It is the SAME number for every
 *      school in a given year — but it is a POLICY VARIABLE, so it is stored PER ROW rather than
 *      hard-coded in a query or a config file. If NTC moves the total, last year's rows must keep
 *      reporting against last year's number; a constant in the reader would silently rewrite history
 *      for every prior year the moment it changed. The stored copy makes the threshold
 *      self-describing provenance, exactly like as_of_date.
 * `teachers_meeting_cpd_threshold` IS MEASURED AGAINST ntc_cpd_target (the statutory 20-pt total),
 * NEVER against annual_plc_target. It is the statutory compliance count GES asks for ("how many
 * teachers met the national CPD requirement"), so a school that set itself a low PLC target cannot
 * thereby report full compliance. The two numbers are not comparable and must never be substituted
 * for one another: 8 PLC points is not 8/20ths of compliance, because PLC is only one contributor.
 *
 * CPD BY NTC CATEGORY (E2) — Mandatory / Specialised / Recommended, the NTC framework's three point
 * classes. They are stored as COLUMNS, never as breakdown ROWS, and that is load-bearing: as columns
 * the reconciliation
 *     cpd_points_mandatory_total + cpd_points_specialised_total + cpd_points_recommended_total
 *       = cpd_points_total                                          (when the categories are populated)
 * is checkable on ONE row and survives roll-up. As rows they would be a second ALL-beside-the-split
 * hazard stacked on top of sex, and the total would no longer be readable without an aggregation.
 * The three `cpd_*_teacher_count` columns are per-category COVERAGE NUMERATORS — teachers with ≥1
 * point in that category — and their denominator is `teacher_headcount`, the same on-roll population
 * as every other coverage rate here. They deliberately do NOT sum to cpd_points_teacher_count: one
 * teacher earning in two categories is counted in both, so the three overlap by construction.
 *
 * ⚠ SOURCING GATE — THE CATEGORY AND THRESHOLD COLUMNS STAY NULL UNTIL AN NTC FEED EXISTS (the
 * E1-class ruling applied to CPD). The operational ledger (apps/web/db/schema/plc.ts,
 * `plc_cpd_ledger`) stores exactly two arms — `attended_pts` and `reflection_pts` — and carries NO
 * category column of any kind. So today the ONLY CPD points Omnischools can observe are PLC points,
 * which are one part of the NTC Mandatory class; the NCPD half of Mandatory, and the Specialised and
 * Recommended classes entirely, are earned OUTSIDE this product and have NO operational source at
 * all. Therefore the ETL must leave `cpd_points_specialised_total`, `cpd_points_recommended_total`,
 * their two teacher counts, and `teachers_meeting_cpd_threshold` **NULL — never 0** — until an
 * NTC-portal feed is wired up. Zero is a measurement ("nobody earned any"); NULL is the truth ("we
 * cannot see it"). Writing 0 here would report every school in Ghana as 0% CPD-compliant, which is
 * both false and actionable, i.e. the worst possible failure mode for a regulator's dashboard.
 * `cpd_points_mandatory_total` may be populated from PLC points ONLY if the ETL is prepared to state
 * that it is a PLC-only partial; if not, it too stays NULL.
 *
 * BREAKDOWN = SEX (E4), on both the TERM and the ANNUAL cut — "are women getting the same CPD access
 * as men" is a question GES asks of both session participation and points earned, so the column is on
 * the table rather than on one cut. ALL is stored beside MALE/FEMALE; see the section header for the
 * one-sex-value-per-query rule. No stage breakdown (a teacher spans stages).
 *
 * ⚠ SEX-INVARIANT COLUMNS — THE ONE PLACE THE SPLIT READ IS WRONG. Widening the grain to sex makes
 * every row sexed, but three measures here are properties of the SCHOOL, not of the teachers in it,
 * and have no sex at all:
 *     schools_running_plc_count   0/1 — a school either runs a PLC programme or it does not
 *     sessions_held               PLC sessions the school actually held
 *     sessions_expected           PLC sessions its configured cadence called for
 * A session is held once, not once per sex, and `schools_running_plc_count` is NOT NULL so the ETL
 * cannot leave it off the MALE/FEMALE rows. So the ETL REPEATS THE IDENTICAL VALUE on all three sex
 * rows (MALE, FEMALE and ALL) — the value is copied, never apportioned, and never split in half.
 *
 * Therefore these three columns are read with `sex = 'ALL'` ONLY. They MUST NOT be aggregated under
 * the `sex IN ('MALE','FEMALE')` split: summing the two split rows returns EXACTLY 2× the truth, so
 * a district with 12 PLC-running schools reports 24, and the session-coverage rate
 * sessions_held ÷ sessions_expected still reads correctly because the doubling cancels — which is
 * what makes this one dangerous. The inflated COUNT looks plausible and its derived RATE looks
 * right, so nothing in the output signals the error. The section header's one-sex-value-per-query
 * rule covers the general case; this is the specific column list where the split read — normally the
 * legitimate way to see MALE and FEMALE separately — is simply not defined.
 *
 * `annual_plc_target` and `ntc_cpd_target` are likewise per-row SCALARS repeated across the sex rows
 * (a school's target and the national statutory total are not sexed either). They are COMPARED
 * against a measure, never SUMMED — across sex or across anything else. Summing a target across
 * three sex rows yields 3× a number that was never a quantity to begin with.
 *
 * (fact_teacher_attendance needs no equivalent note: every measure on it — expected / present /
 * excused / absent teacher-days — is genuinely sexed and splits honestly.)
 *
 * NO teacher-identifiable columns — no user ids, no names, no per-teacher rows. Analytics holds
 * aggregates only; the named path is the gated §6 audit route.
 *
 * (Deliberately NOT modelled: a VLC counterpart. VLC is the STUDENT pastoral programme, whose
 * confidential graph is structurally barred from analytics; whether GES wants even an aggregate VLC
 * session-coverage fact is an open human-owner question.)
 */
export const factPlcParticipation = pgTable(
  "fact_plc_participation",
  {
    factId: uuid("fact_id").primaryKey().defaultRandom(),
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => dimJurisdiction.jurisdictionId),
    periodId: uuid("period_id")
      .notNull()
      .references(() => dimPeriod.periodId), // period_type = TERM or ANNUAL (discriminates the cut)
    // Breakdown (E4) — meaningful on BOTH cuts. ALL is stored beside MALE/FEMALE: filter to one
    // value per query or every figure double-counts.
    sex: sexEnum("sex").notNull(),
    // 0/1 per school — "N of Y schools run PLC". Present on both cuts.
    // ⚠ SEX-INVARIANT: identical value repeated on the MALE, FEMALE and ALL rows. Read with
    // sex = 'ALL' ONLY — summing it under sex IN ('MALE','FEMALE') returns exactly 2×.
    schoolsRunningPlcCount: integer("schools_running_plc_count").notNull(),
    // ---- BOTH cuts: the shared on-roll denominator ----
    // Populated on TERM *and* ANNUAL rows (ETL contract, see doc comment). Same population as
    // fact_staffing.teachers_on_roll. Denominator for BOTH teachers_in_plc (TERM) and
    // teachers_meeting_cpd_threshold (ANNUAL), so each rate is derivable from a single row.
    teacherHeadcount: integer("teacher_headcount"),

    // ---- TERM cut (NULL on an ANNUAL row) ----
    // ⚠ sessions_held / sessions_expected are SEX-INVARIANT school-level event counts: a session is
    // held once, not once per sex, so the ETL repeats the identical value on all three sex rows.
    // Read with sex = 'ALL' ONLY — never aggregated under the MALE/FEMALE split (returns 2×).
    sessionsHeld: integer("sessions_held"),
    sessionsExpected: integer("sessions_expected"), // from the school's configured cadence
    attendanceEvents: integer("attendance_events"),
    attendanceExpected: integer("attendance_expected"),
    plcParticipationRate: numeric("plc_participation_rate", { precision: 5, scale: 2 }),
    teachersInPlc: integer("teachers_in_plc"),

    // ---- ANNUAL cut (NULL on a TERM row) ----
    cpdPointsTotal: numeric("cpd_points_total", { precision: 7, scale: 2 }),
    // Denominator for cpd_points_mean ONLY (teachers with any ledger entry) — NOT the staff-coverage
    // denominator; that is teacher_headcount above.
    cpdPointsTeacherCount: integer("cpd_points_teacher_count"),
    cpdPointsMean: numeric("cpd_points_mean", { precision: 5, scale: 2 }),
    // Count of teachers meeting the NATIONAL statutory CPD total — measured against ntc_cpd_target
    // below, NEVER against annual_plc_target. Invariant: ≤ teacher_headcount on the SAME row.
    // ⚠ Stays NULL (never 0) until an NTC feed exists — see the sourcing gate in the doc comment.
    teachersMeetingCpdThreshold: integer("teachers_meeting_cpd_threshold"),
    // The SCHOOL's own configured PLC-ONLY target — same name as the operational column it copies,
    // plc_programme.annual_plc_target (default 8). Never a constant, and NOT the threshold that
    // teachers_meeting_cpd_threshold is measured against.
    // ⚠ SEX-INVARIANT scalar (repeated across the sex rows): COMPARE it, never SUM it.
    annualPlcTarget: numeric("annual_plc_target", { precision: 5, scale: 2 }),
    // The NATIONAL statutory NTC CPD total (nominally 20 pts/yr, covering ALL CPD, not just PLC) —
    // the threshold the count above is actually computed from. Stored per row because it is a POLICY
    // VARIABLE: prior years must keep their own number.
    // ⚠ SEX-INVARIANT scalar (repeated across the sex rows): COMPARE it, never SUM it.
    ntcCpdTarget: numeric("ntc_cpd_target", { precision: 5, scale: 2 }),

    // ---- ANNUAL cut · NTC CATEGORY SPLIT (columns, never rows — reconciles to cpd_points_total) ----
    // Invariant when populated: mandatory + specialised + recommended = cpd_points_total.
    // ⚠ Specialised / Recommended (and the NCPD half of Mandatory) have NO operational source today
    // — the ETL leaves them NULL, never 0. See the sourcing gate in the doc comment.
    cpdPointsMandatoryTotal: numeric("cpd_points_mandatory_total", {
      precision: 7,
      scale: 2,
    }),
    cpdPointsSpecialisedTotal: numeric("cpd_points_specialised_total", {
      precision: 7,
      scale: 2,
    }),
    cpdPointsRecommendedTotal: numeric("cpd_points_recommended_total", {
      precision: 7,
      scale: 2,
    }),
    // Per-category COVERAGE numerators: teachers with ≥1 point in that category. Denominator is
    // teacher_headcount (not cpd_points_teacher_count). These OVERLAP by design — a teacher earning
    // in two categories is counted in both — so they do NOT sum to any other count here.
    cpdMandatoryTeacherCount: integer("cpd_mandatory_teacher_count"),
    cpdSpecialisedTeacherCount: integer("cpd_specialised_teacher_count"),
    cpdRecommendedTeacherCount: integer("cpd_recommended_teacher_count"),

    ...provenance, // source = OPERATIONAL_AGG
  },
  (t) => ({
    // Grain constraint AND the RLS-filtered read path — one row per school × period × sex. The TERM
    // and ANNUAL cuts live on DIFFERENT period_ids, so period_id alone still separates them.
    uniqJurisdictionPeriodSex: uniqueIndex(
      "fact_plc_participation_jurisdiction_period_sex_idx",
    ).on(t.jurisdictionId, t.periodId, t.sex),
  }),
);
