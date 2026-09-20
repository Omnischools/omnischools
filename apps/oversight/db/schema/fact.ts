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
