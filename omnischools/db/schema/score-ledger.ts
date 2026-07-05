import {
  pgTable,
  uuid,
  text,
  smallint,
  boolean,
  numeric,
  date,
  timestamp,
  unique,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./tenancy";
import { users } from "./identity";
import { students, classes } from "./students";
import { subjects } from "./gradebook";
import { academicPeriod } from "./periods";
import { assessmentCategoryEnum, ledgerStatusEnum, capturePathEnum } from "./_enums";

/**
 * Senior (SHS) score ledger — Score Ledger Item 1 (five-category model + Path A auto-compile).
 * The five categories per (student × subject × period): assignments/class exercises,
 * mid-semester exam, end-of-semester exam, project work, portfolio. The first four are
 * auto-compiled from `senior_assessment` events (Path A); portfolio is a manual entry.
 * Compilation lives in lib/score-ledger/compile.ts (a lib function, never a DB trigger —
 * portability discipline). See docs/senior/f0-ledger-schema.md and SHS_SCORE_LEDGER_SPEC.md.
 */

// Same numeric helper the Basic gradebook uses (file-local in gradebook.ts, not exported).
const score = (name: string) => numeric(name, { precision: 5, scale: 2 });

/**
 * Per-(school × subject) five-category weights. Resolution order in lib/score-ledger:
 * exact (school, subject) row → school-default row (subject_id NULL) → system constant
 * 15/15/40/15/15. The five must sum to exactly 100 (CHECK). Asankrangwa default is
 * 15/15/40/15/15 — end-of-semester exam carries the dominant 40% (spec §2).
 */
export const assessmentWeights = pgTable(
  "ref_assessment_weights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id"), // NULL = school-wide default; set = per-subject override
    asgnWeight: smallint("asgn_weight").notNull().default(15),
    midSemWeight: smallint("mid_sem_weight").notNull().default(15),
    endSemWeight: smallint("end_sem_weight").notNull().default(40),
    projectWeight: smallint("project_weight").notNull().default(15),
    portfolioWeight: smallint("portfolio_weight").notNull().default(15),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One override row per (school, subject). NULLs are distinct in a UNIQUE, so the
    // school-default row is constrained separately by the partial index below.
    uniqPerSubject: unique("uniq_weights_per_school_subject").on(t.schoolId, t.subjectId),
    // Exactly one school-wide default row (subject_id NULL) per school.
    oneDefault: uniqueIndex("uniq_school_default_weights")
      .on(t.schoolId)
      .where(sql`${t.subjectId} IS NULL`),
    // The five category weights must sum to exactly 100. First CHECK in the repo —
    // standard SQL, portable (no Supabase dependency).
    sumTo100: check(
      "assessment_weights_sum_100",
      sql`${t.asgnWeight} + ${t.midSemWeight} + ${t.endSemWeight} + ${t.projectWeight} + ${t.portfolioWeight} = 100`,
    ),
    // Composite school-scoped FK — only enforced when subject_id is set (MATCH SIMPLE
    // skips rows with any NULL key column, which is exactly the school-default row).
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [subjects.schoolId, subjects.id],
    }).onDelete("cascade"),
  }),
);

/**
 * A Path A gradebook event — the SHS analogue of gradebook_column, keyed to the
 * five-category model via `category`. Assignments are many per context; mid-sem,
 * end-sem and project are each normally a single event (single mid/end enforced by
 * the partial unique indexes below). Composite-FK target for senior_assessment_score.
 */
export const seniorAssessments = pgTable(
  "senior_assessment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    classId: uuid("class_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    periodId: uuid("period_id").notNull(),
    category: assessmentCategoryEnum("category").notNull(),
    title: text("title").notNull(), // "Assignment 1", "Mid-Sem Exam"
    maxMark: score("max_mark").notNull(),
    assessedOn: date("assessed_on"), // when the assessment happened (nullable until set)
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqTitle: unique("uniq_assessment_per_context").on(
      t.schoolId,
      t.classId,
      t.subjectId,
      t.periodId,
      t.category,
      t.title,
    ),
    // At most one mid-semester and one end-semester exam per (class × subject × period).
    // Assignments and projects are unrestricted. Enforces the single-event assumption the
    // Path A compile rule relies on (Kofi ruling Q1).
    oneMidSem: uniqueIndex("uniq_one_mid_sem_per_context")
      .on(t.schoolId, t.classId, t.subjectId, t.periodId)
      .where(sql`${t.category} = 'MID_SEM_EXAM'`),
    oneEndSem: uniqueIndex("uniq_one_end_sem_per_context")
      .on(t.schoolId, t.classId, t.subjectId, t.periodId)
      .where(sql`${t.category} = 'END_SEM_EXAM'`),
    byContext: index("senior_assessment_context_idx").on(
      t.periodId,
      t.subjectId,
      t.classId,
    ),
    // Composite-FK target for senior_assessment_score (school_id, id).
    tenantUk: unique("senior_assessment_tenant_uk").on(t.schoolId, t.id),
    classFk: foreignKey({
      columns: [t.schoolId, t.classId],
      foreignColumns: [classes.schoolId, classes.id],
    }).onDelete("cascade"),
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [subjects.schoolId, subjects.id],
    }).onDelete("cascade"),
    periodFk: foreignKey({
      columns: [t.schoolId, t.periodId],
      foreignColumns: [academicPeriod.schoolId, academicPeriod.periodId],
    }).onDelete("cascade"),
  }),
);

/**
 * One raw mark per (event × student). SHS analogue of gradebook_column_score. Leaf —
 * nothing references it, so no tenant_uk. `raw_mark` nullable: a blank cell is a missing
 * entry, distinct from a zero (Kofi ruling Q2 — blanks are excluded from the assignment
 * mean; a non-submission is an explicit 0). `raw_mark ≤ max_mark` is a soft warn in the
 * lib/UI layer, not a DB check (a cross-row check would need a forbidden trigger — Q3).
 */
export const seniorAssessmentScores = pgTable(
  "senior_assessment_score",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id").notNull(),
    studentId: uuid("student_id").notNull(),
    rawMark: score("raw_mark"), // nullable — blank until entered
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("uniq_assessment_score_per_student").on(
      t.schoolId,
      t.assessmentId,
      t.studentId,
    ),
    byAssessment: index("senior_assessment_score_assessment_idx").on(t.assessmentId),
    assessmentFk: foreignKey({
      columns: [t.schoolId, t.assessmentId],
      foreignColumns: [seniorAssessments.schoolId, seniorAssessments.id],
    }).onDelete("cascade"),
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  }),
);

/**
 * The compiled ledger record at grain (school × student × subject × period) — the
 * five compiled category values, the computed weighted total, the portfolio-manual flag,
 * the status, and a frozen snapshot of the five weights used at compile time (so a later
 * weight change never alters a historical total, and every report can show how a final
 * score was computed — Kofi ruling Q4). Mirrors the Basic gradebook_score shape exactly.
 */
export const seniorScoreLedger = pgTable(
  "senior_score_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    periodId: uuid("period_id").notNull(),
    // The five category values, reduced to a 0–100 scale from the raw events.
    asgnScore: score("asgn_score"),
    midSemScore: score("mid_sem_score"),
    endSemScore: score("end_sem_score"),
    projectScore: score("project_score"),
    portfolioScore: score("portfolio_score"), // manual entry (spec §4.1)
    // The computed weighted total, using the resolved ref_assessment_weights.
    weightedTotal: score("weighted_total"),
    // Snapshot of the weights used at compile time (frozen — Q4).
    asgnWeightUsed: smallint("asgn_weight_used"),
    midSemWeightUsed: smallint("mid_sem_weight_used"),
    endSemWeightUsed: smallint("end_sem_weight_used"),
    projectWeightUsed: smallint("project_weight_used"),
    portfolioWeightUsed: smallint("portfolio_weight_used"),
    portfolioManual: boolean("portfolio_manual").notNull().default(false),
    status: ledgerStatusEnum("status").notNull().default("DRAFT"),
    compiledByUserId: uuid("compiled_by_user_id").references(() => users.id),
    compiledAt: timestamp("compiled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("uniq_ledger_student_subject_period").on(
      t.schoolId,
      t.studentId,
      t.subjectId,
      t.periodId,
    ),
    byPeriodSubject: index("senior_ledger_period_subject_idx").on(
      t.periodId,
      t.subjectId,
    ),
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [subjects.schoolId, subjects.id],
    }).onDelete("cascade"),
    periodFk: foreignKey({
      columns: [t.schoolId, t.periodId],
      foreignColumns: [academicPeriod.schoolId, academicPeriod.periodId],
    }).onDelete("cascade"),
  }),
);

/**
 * The capture path a teacher chose for one (class × subject × period) — spec §4.4, chosen
 * per context and switchable. Absent row = the AUTO_COMPILE (Path A) default. Path drives
 * how the ledger is written: AUTO_COMPILE compiles from senior_assessment events;
 * DIRECT_ENTRY (Item 2) writes the five category scores straight onto the ledger.
 */
export const seniorLedgerPath = pgTable(
  "senior_ledger_path",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    classId: uuid("class_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    periodId: uuid("period_id").notNull(),
    path: capturePathEnum("path").notNull().default("AUTO_COMPILE"),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("uniq_ledger_path_context").on(
      t.schoolId,
      t.classId,
      t.subjectId,
      t.periodId,
    ),
    classFk: foreignKey({
      columns: [t.schoolId, t.classId],
      foreignColumns: [classes.schoolId, classes.id],
    }).onDelete("cascade"),
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [subjects.schoolId, subjects.id],
    }).onDelete("cascade"),
    periodFk: foreignKey({
      columns: [t.schoolId, t.periodId],
      foreignColumns: [academicPeriod.schoolId, academicPeriod.periodId],
    }).onDelete("cascade"),
  }),
);
