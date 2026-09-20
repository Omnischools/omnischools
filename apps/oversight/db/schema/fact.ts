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
 * Each carries a UNIQUE (jurisdiction_id, period_id) index. It does double duty: it serves the
 * standard RLS-filtered read path (`ov_in_subtree(jurisdiction_id)` + a period filter — a unique
 * index is a btree and serves reads exactly like a plain one, so there is no separate non-unique
 * index), AND it is the grain constraint. For these three there is NO legitimate second row per
 * school × period: none has a stage / subject / sex breakdown, and fact_plc_participation's TERM and
 * ANNUAL cuts are distinct period_ids, not two rows on one period. Without it a duplicated ETL row
 * silently DOUBLES every roll-up above it — an error that is invisible at every tier, because the
 * sum is still internally consistent. It also gives the ETL a clean `on conflict` upsert target, so
 * a re-run overwrites rather than appends.
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
 * NO sex / stage / role breakdown: teacher attendance is a whole-school figure here; a per-role cut
 * would be a different grain and is not requested. Headcount does NOT live here — teachers_on_roll
 * is fact_staffing's column and duplicating it would let the two drift.
 *
 * ⚠ ETL POPULATION IS GATED (human-owner question E1): there is today NO operational teacher
 * daily-attendance source to aggregate from — apps/web records staff PD/PLC attendance, not a
 * teacher daily register. The table SHAPE is correct and this addition is purely additive, so the
 * table simply stays EMPTY until that operational source exists; nothing above or below depends on
 * it being populated.
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
    // Summable inputs (the roll-up's numerator/denominator).
    expectedTeacherDays: integer("expected_teacher_days").notNull(),
    presentTeacherDays: integer("present_teacher_days").notNull(),
    // The stored rate — a single-school card is a no-math read.
    teacherAttendanceRate: numeric("teacher_attendance_rate", {
      precision: 5,
      scale: 2,
    }).notNull(),
    ...provenance, // source = OPERATIONAL_AGG
  },
  (t) => ({
    // Grain constraint AND the RLS-filtered read path — one row per school × period, no exceptions.
    uniqJurisdictionPeriod: uniqueIndex(
      "fact_teacher_attendance_jurisdiction_period_idx",
    ).on(t.jurisdictionId, t.periodId),
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
 *   ANNUAL rows carry cpd_points_* / teachers_meeting_cpd_threshold / annual_cpd_target; the session
 *          columns are NULL.
 *   BOTH   cuts carry `teacher_headcount` (see the ETL contract below) — it is the ONLY cut-spanning
 *          measure, because both cuts need the same on-roll denominator.
 * Hence every cut-specific column is nullable; only the grain keys and schools_running_plc_count are
 * NOT NULL. (period_type lives on dim_period — it is not duplicated onto the fact.)
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
 * `annual_cpd_target` is stored PER SCHOOL (it is the school's configured
 * plc_programme.annual_plc_target), never a hard-coded constant: schools configure different
 * targets, so "met the target" is only meaningful against the target that school actually set.
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
    // 0/1 per school — "N of Y schools run PLC". Present on both cuts.
    schoolsRunningPlcCount: integer("schools_running_plc_count").notNull(),
    // ---- BOTH cuts: the shared on-roll denominator ----
    // Populated on TERM *and* ANNUAL rows (ETL contract, see doc comment). Same population as
    // fact_staffing.teachers_on_roll. Denominator for BOTH teachers_in_plc (TERM) and
    // teachers_meeting_cpd_threshold (ANNUAL), so each rate is derivable from a single row.
    teacherHeadcount: integer("teacher_headcount"),

    // ---- TERM cut (NULL on an ANNUAL row) ----
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
    // Invariant: ≤ teacher_headcount on the SAME row (both populated on ANNUAL rows).
    teachersMeetingCpdThreshold: integer("teachers_meeting_cpd_threshold"),
    // The school's own configured annual target — never a constant.
    annualCpdTarget: numeric("annual_cpd_target", { precision: 5, scale: 2 }),

    ...provenance, // source = OPERATIONAL_AGG
  },
  (t) => ({
    // Grain constraint AND the RLS-filtered read path. The TERM and ANNUAL cuts live on DIFFERENT
    // period_ids, so one row per school × period holds for both.
    uniqJurisdictionPeriod: uniqueIndex(
      "fact_plc_participation_jurisdiction_period_idx",
    ).on(t.jurisdictionId, t.periodId),
  }),
);
