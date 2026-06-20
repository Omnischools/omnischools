import { pgTable, uuid, text, timestamp, unique, index } from "drizzle-orm/pg-core";
import { audienceEnum, notifStatusEnum } from "./_enums";
import { schools } from "./tenancy";
import { students, classes } from "./students";
import { users } from "./identity";

/** School-wide or per-class announcement (in-app; optionally SMS-broadcast separately). */
export const announcements = pgTable("announcement", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audience: audienceEnum("audience").notNull().default("WHOLE_SCHOOL"),
  classId: uuid("class_id").references(() => classes.id, { onDelete: "set null" }),
  postedByUserId: uuid("posted_by_user_id").references(() => users.id),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Reusable SMS message templates (placeholders: {student_first}, {school_short}). */
export const smsTemplates = pgTable(
  "sms_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqName: unique("uniq_template_per_school").on(t.schoolId, t.name) }),
);

/** Per-recipient delivery log for every SMS send. */
export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").references(() => students.id, { onDelete: "set null" }),
    phone: text("phone").notNull(),
    message: text("message").notNull(),
    status: notifStatusEnum("status").notNull().default("QUEUED"),
    provider: text("provider"),
    providerRef: text("provider_ref"),
    templateId: uuid("template_id").references(() => smsTemplates.id, {
      onDelete: "set null",
    }),
    sentByUserId: uuid("sent_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ bySchoolTime: index("notif_school_time_idx").on(t.schoolId, t.createdAt) }),
);
