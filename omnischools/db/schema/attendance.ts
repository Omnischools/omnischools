import {
  pgTable,
  uuid,
  text,
  date,
  integer,
  boolean,
  timestamp,
  unique,
  foreignKey,
  index,
} from "drizzle-orm/pg-core";
import { attendanceStatusEnum, correctionStatusEnum } from "./_enums";
import { schools } from "./tenancy";
import { students, classes } from "./students";
import { users } from "./identity";

/** Per-school attendance configuration (one row). Drives marking, SMS and flags. */
export const attendanceSettings = pgTable("attendance_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .unique()
    .references(() => schools.id, { onDelete: "cascade" }),
  dayStart: text("day_start").notNull().default("08:00"),
  lateThreshold: text("late_threshold").notNull().default("08:15"),
  dayEnd: text("day_end").notNull().default("15:00"),
  editWindowHours: integer("edit_window_hours").notNull().default(24),
  absenceSms: boolean("absence_sms").notNull().default(true),
  absWatchDays: integer("abs_watch_days").notNull().default(3),
  absCriticalDays: integer("abs_critical_days").notNull().default(5),
  pctWatch: integer("pct_watch").notNull().default(70),
  pctCritical: integer("pct_critical").notNull().default(60),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One attendance record per student per day. */
export const attendanceRecords = pgTable(
  "attendance_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(),
    classId: uuid("class_id").notNull(),
    date: date("date").notNull(),
    status: attendanceStatusEnum("status").notNull(),
    // Structured absence reason (SICK / MEDICAL / FAMILY / TRAVEL / OTHER); free
    // detail goes in `note`. Both are captured when a student isn't Present.
    reasonCode: text("reason_code"),
    note: text("note"),
    markedByUserId: uuid("marked_by_user_id").references(() => users.id),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqPerDay: unique("uniq_attendance_student_day").on(t.schoolId, t.studentId, t.date),
    byClassDate: index("attendance_class_date_idx").on(t.classId, t.date),
    // Composite-FK target for attendance_correction (school_id, id).
    tenantUk: unique("attendance_record_tenant_uk").on(t.schoolId, t.id),
    // Composite school-scoped FKs — student and class must be in the same tenant.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    classFk: foreignKey({
      columns: [t.schoolId, t.classId],
      foreignColumns: [classes.schoolId, classes.id],
    }).onDelete("cascade"),
  }),
);

/** Teacher-requested correction to a record, co-signed (approved) by an admin. */
export const attendanceCorrections = pgTable(
  "attendance_correction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    attendanceRecordId: uuid("attendance_record_id").notNull(),
    requestedStatus: attendanceStatusEnum("requested_status").notNull(),
    reason: text("reason").notNull(),
    status: correctionStatusEnum("status").notNull().default("PENDING"),
    /** Admin's note recorded at decision time (audit trail; surface §5 "note for the record"). */
    decisionNote: text("decision_note"),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite school-scoped FK — the corrected record must be in the same tenant.
    recordFk: foreignKey({
      columns: [t.schoolId, t.attendanceRecordId],
      foreignColumns: [attendanceRecords.schoolId, attendanceRecords.id],
    }).onDelete("cascade"),
  }),
);
