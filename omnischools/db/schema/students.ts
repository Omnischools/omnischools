import {
  pgTable,
  uuid,
  text,
  date,
  boolean,
  integer,
  timestamp,
  unique,
  foreignKey,
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
    targetCapacity: integer("target_capacity"), // planned seats; drives utilisation stats (nullable)
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqName: unique("uniq_class_per_school").on(t.schoolId, t.name),
    // Composite-FK target for students / attendance / timetable / gradebook (school_id, id).
    tenantUk: unique("class_tenant_uk").on(t.schoolId, t.id),
  }),
);

/**
 * A family/household grouping siblings within a school. Powers sibling-rank fee
 * discounts (1st/2nd/3rd child). Sibling rank is derived at billing time from a
 * household's members ordered by enrolment, so it's never stored stale.
 */
export const households = pgTable(
  "household",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ bySchool: index("household_school_idx").on(t.schoolId) }),
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
    classId: uuid("class_id"),
    householdId: uuid("household_id").references(() => households.id, {
      onDelete: "set null",
    }),
    enrolledOn: date("enrolled_on"),
    admissionApplicationId: uuid("admission_application_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCode: unique("uniq_student_code_per_school").on(t.schoolId, t.studentCode),
    bySchool: index("students_school_idx").on(t.schoolId),
    // Composite-FK target for every student-scoped table (school_id, id).
    tenantUk: unique("students_tenant_uk").on(t.schoolId, t.id),
    // Composite school-scoped FK — class must belong to the same tenant.
    classFk: foreignKey({
      columns: [t.schoolId, t.classId],
      foreignColumns: [classes.schoolId, classes.id],
    }),
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
    studentId: uuid("student_id").notNull(),
    name: text("name").notNull(),
    relationship: guardianRelationEnum("relationship").notNull().default("GUARDIAN"),
    phone: text("phone").notNull(), // E.164
    email: text("email"),
    isPrimary: boolean("is_primary").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStudent: index("guardian_student_idx").on(t.studentId),
    // Composite school-scoped FK — student must belong to the same tenant.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  }),
);

/**
 * A student's health & emergency record (1:1). Allergies, chronic conditions, current
 * medications, blood group and an emergency contact — surfaced to staff on the student
 * profile. Sensitive; tenant-isolated like every student-scoped table.
 */
export const studentHealthRecords = pgTable(
  "student_health_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull().unique(),
    bloodGroup: text("blood_group"),
    allergies: text("allergies"),
    conditions: text("conditions"),
    medications: text("medications"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    emergencyContactRelation: text("emergency_contact_relation"),
    notes: text("notes"),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStudent: index("health_student_idx").on(t.studentId),
    // Composite school-scoped FK — student must belong to the same tenant.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  }),
);
