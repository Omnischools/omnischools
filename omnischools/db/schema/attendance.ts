import { pgTable, uuid, text, date, timestamp, unique, index } from "drizzle-orm/pg-core";
import { attendanceStatusEnum, correctionStatusEnum } from "./_enums";
import { schools } from "./tenancy";
import { students, classes } from "./students";
import { users } from "./identity";

/** One attendance record per student per day. */
export const attendanceRecords = pgTable(
  "attendance_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    status: attendanceStatusEnum("status").notNull(),
    note: text("note"),
    markedByUserId: uuid("marked_by_user_id").references(() => users.id),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqPerDay: unique("uniq_attendance_student_day").on(t.schoolId, t.studentId, t.date),
    byClassDate: index("attendance_class_date_idx").on(t.classId, t.date),
  }),
);

/** Teacher-requested correction to a record, co-signed (approved) by an admin. */
export const attendanceCorrections = pgTable("attendance_correction", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  attendanceRecordId: uuid("attendance_record_id")
    .notNull()
    .references(() => attendanceRecords.id, { onDelete: "cascade" }),
  requestedStatus: attendanceStatusEnum("requested_status").notNull(),
  reason: text("reason").notNull(),
  status: correctionStatusEnum("status").notNull().default("PENDING"),
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id),
  decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
