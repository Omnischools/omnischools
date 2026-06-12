import {
  pgTable,
  uuid,
  text,
  smallint,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { schools } from "./tenancy";
import { classes } from "./students";
import { subjects } from "./gradebook";
import { users } from "./identity";

/**
 * One timetable cell: a class meets for a subject (taught by a teacher) on a given
 * weekday + period. dayOfWeek 1=Mon … 5=Fri; periodIndex is the 1-based slot in the
 * day. A class can't double-book a (day, period) — enforced by the unique index.
 * A teacher can't be in two classes at the same (day, period) — checked in the action
 * (lib/actions/classes.ts) and indexed for the lookup.
 */
export const timetableSlots = pgTable(
  "timetable_slot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    dayOfWeek: smallint("day_of_week").notNull(), // 1=Mon … 5=Fri
    periodIndex: smallint("period_index").notNull(), // 1-based
    startTime: text("start_time"), // "08:00"
    endTime: text("end_time"), // "08:40"
    subjectId: uuid("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    teacherUserId: uuid("teacher_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqSlot: unique("uniq_timetable_class_slot").on(
      t.schoolId,
      t.classId,
      t.dayOfWeek,
      t.periodIndex,
    ),
    byTeacherSlot: index("timetable_teacher_slot_idx").on(
      t.schoolId,
      t.teacherUserId,
      t.dayOfWeek,
      t.periodIndex,
    ),
  }),
);
