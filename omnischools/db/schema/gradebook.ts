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
import { students } from "./students";
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
