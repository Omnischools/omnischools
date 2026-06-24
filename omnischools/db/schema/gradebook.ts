import {
  pgTable,
  uuid,
  text,
  numeric,
  smallint,
  boolean,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { schools } from "./tenancy";
import { students, classes } from "./students";
import { users } from "./identity";
import { academicPeriod } from "./periods";

const score = (name: string) => numeric(name, { precision: 5, scale: 2 });

/** Subjects taught at a school (English, Maths, Integrated Science, ...). */
export const subjects = pgTable(
  "subject",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqName: unique("uniq_subject_per_school").on(t.schoolId, t.name) }),
);

/**
 * Per-school grade scale — how a final score maps to a letter grade. A grade applies
 * for score >= minScore up to the next-higher grade's threshold; the lowest grade has
 * minScore 0 ("below X"). Seeded at onboarding (Basic A–F or WASSCE A1–F9), editable.
 * Used by the gradebook, report cards and the parent app.
 */
export const gradeScale = pgTable(
  "grade_scale",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    grade: text("grade").notNull(), // "A", "A1", "F9"
    label: text("label"), // "Excellent", "Pass"
    minScore: numeric("min_score", { precision: 5, scale: 2 }).notNull(),
    ordinal: smallint("ordinal").notNull(), // display order, highest grade = 0
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqGrade: unique("uniq_grade_per_school").on(t.schoolId, t.grade),
    bySchool: index("grade_scale_school_idx").on(t.schoolId),
  }),
);

/** Per-school weighting for Basic's two-category model (defaults 50/50). */
export const gradebookConfig = pgTable("gradebook_config", {
  schoolId: uuid("school_id")
    .primaryKey()
    .references(() => schools.id, { onDelete: "cascade" }),
  classWeight: smallint("class_weight").notNull().default(50),
  examWeight: smallint("exam_weight").notNull().default(50),
});

/** A student's score for a subject in a period: class (CA) + exam → weighted total. */
export const gradebookScores = pgTable(
  "gradebook_score",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => academicPeriod.periodId, { onDelete: "cascade" }),
    classScore: score("class_score"),
    examScore: score("exam_score"),
    total: score("total"),
    grade: text("grade"),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("uniq_score_student_subject_period").on(
      t.schoolId,
      t.studentId,
      t.subjectId,
      t.periodId,
    ),
    byPeriodSubject: index("score_period_subject_idx").on(t.periodId, t.subjectId),
  }),
);

/** A generated term report card (overall summary; lines rendered from scores). */
export const reportCards = pgTable(
  "report_card",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => academicPeriod.periodId, { onDelete: "cascade" }),
    overallTotal: score("overall_total"),
    overallGrade: text("overall_grade"),
    subjectCount: smallint("subject_count"),
    remark: text("remark"),
    generatedByUserId: uuid("generated_by_user_id").references(() => users.id),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("uniq_report_student_period").on(t.schoolId, t.studentId, t.periodId),
  }),
);

/**
 * A named assessment column within a class·subject·period — e.g. "Quiz 1",
 * "Class Test", "Mid-term exam". Each has a marks ceiling and rolls up into one of
 * the two score categories (CA → class score, EXAM → exam score) per gradebook_config.
 * This is the granular layer under the fixed CA/Exam totals in `gradebook_score`.
 */
export const gradebookColumns = pgTable(
  "gradebook_column",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => academicPeriod.periodId, { onDelete: "cascade" }),
    name: text("name").notNull(), // "Quiz 1", "Class Test"
    category: text("category").notNull().default("CA"), // 'CA' | 'EXAM'
    maxScore: numeric("max_score", { precision: 5, scale: 2 }).notNull(),
    position: smallint("position").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqName: unique("uniq_column_per_class_subject_period").on(
      t.schoolId,
      t.classId,
      t.subjectId,
      t.periodId,
      t.name,
    ),
    byContext: index("gradebook_column_context_idx").on(t.periodId, t.subjectId, t.classId),
  }),
);

/** A student's raw mark on a single assessment column. */
export const gradebookColumnScores = pgTable(
  "gradebook_column_score",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    columnId: uuid("column_id")
      .notNull()
      .references(() => gradebookColumns.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    rawScore: score("raw_score"),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("uniq_column_score_per_student").on(t.schoolId, t.columnId, t.studentId),
    byColumn: index("gradebook_column_score_column_idx").on(t.columnId),
  }),
);
