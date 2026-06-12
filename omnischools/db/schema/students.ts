import {
  pgTable,
  uuid,
  text,
  date,
  boolean,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { sexEnum, studentStatusEnum, guardianRelationEnum } from "./_enums";
import { schools } from "./tenancy";
import { users } from "./identity";

/** A class/form students belong to (e.g. "JHS 1A"). Attendance is taken per class. */
export const classes = pgTable(
  "class",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    level: text("level"), // e.g. "JHS 1"
    classTeacherUserId: uuid("class_teacher_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqName: unique("uniq_class_per_school").on(t.schoolId, t.name) }),
);

/**
 * The student is the central object — the single source of truth every module reads.
 * SHS-specific columns (programme/house/residency) are added in Phase 4.
 * `current_class_label` is kept as a display fallback alongside the class_id FK.
 */
export const students = pgTable(
  "students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentCode: text("student_code").notNull(), // school's admission / student number
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    otherNames: text("other_names"),
    sex: sexEnum("sex").notNull(),
    dateOfBirth: date("date_of_birth"),
    status: studentStatusEnum("status").notNull().default("ACTIVE"),
    currentClassLabel: text("current_class_label"), // display fallback
    classId: uuid("class_id").references(() => classes.id),
    enrolledOn: date("enrolled_on"),
    admissionApplicationId: uuid("admission_application_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCode: unique("uniq_student_code_per_school").on(t.schoolId, t.studentCode),
    bySchool: index("students_school_idx").on(t.schoolId),
  }),
);

/** Guardians/parents — SMS-first contacts attached to a student. */
export const studentGuardians = pgTable(
  "student_guardian",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    relationship: guardianRelationEnum("relationship").notNull().default("GUARDIAN"),
    phone: text("phone").notNull(), // E.164
    email: text("email"),
    isPrimary: boolean("is_primary").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStudent: index("guardian_student_idx").on(t.studentId),
  }),
);
