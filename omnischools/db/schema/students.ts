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
import {
  sexEnum,
  studentStatusEnum,
  guardianRelationEnum,
  programmeEnum,
  residencyEnum,
} from "./_enums";
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
    // SHS: "Form 2 General Arts" → GENERAL_ARTS. Nullable — null for Basic classes.
    // Modelled as the enum column (not a programme_id FK) since programmes are a fixed
    // GES set, not a per-school table (Kofi ruling Q6).
    programme: programmeEnum("programme"),
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
 * SHS boarding house (Aggrey, Guggisberg, Fraser, Slessor, Kingsley, Aryee — seeded per
 * INSTRUCTIONS_FOR_CLAUDE_CODE.md §1.7). Houses are per-school *config*, not hard-coded:
 * name + display colour are stored so each school sets its own. `colour` is a raw hex the
 * roster renders as a House dot via inline style (user data, not a brand token — the
 * no-alpha-token-opacity rule doesn't apply). This is the only physical table F0 needs;
 * dormitories, bunks and housemaster staffing are Phase 4.2 boarding tables.
 */
export const houses = pgTable(
  "house",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // "Aggrey", "Guggisberg", ...
    colour: text("colour"), // hex e.g. "#D87794" — rendered as a House dot via inline style
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqName: unique("uniq_house_per_school").on(t.schoolId, t.name),
    // Composite-FK target for students.house_id (school_id, id).
    tenantUk: unique("house_tenant_uk").on(t.schoolId, t.id),
  }),
);

/**
 * The student is the central object — the single source of truth every module reads.
 * SHS-specific columns (programme/house/residency) are added here in Phase 4 — all
 * nullable, staying null for every Basic (KG · Primary · JHS) student.
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
    // SHS-specific — all nullable, null for Basic students.
    programme: programmeEnum("programme"),
    residency: residencyEnum("residency"),
    houseId: uuid("house_id"),
    // STPSHS Assessment Reference ID (format like "REF-2024-XXXX") assigned by STPSHS at
    // Year-1 bio-data registration. External opaque id → plain text, not an enum. Nullable:
    // stays NULL until a future STPSHS bio-data-ingest increment populates real IDs; the
    // regulator score sheet renders "pending" while null (INCR-3, owner ruling Q1 LOCKED).
    // Uniqueness is per student for the 3-year cycle (§2), but with many NULLs today we add
    // no UNIQUE now — a partial unique index lands with the ingest increment.
    stpshsRef: text("stpshs_ref"),
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
    // Composite school-scoped FK — house must belong to the same tenant. SET NULL so
    // deactivating a house detaches students rather than deleting them (house_id is nullable).
    houseFk: foreignKey({
      columns: [t.schoolId, t.houseId],
      foreignColumns: [houses.schoolId, houses.id],
    }).onDelete("set null"),
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
