import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { inviteStatusEnum } from "./_enums";
import { schools } from "./tenancy";
import { users } from "./identity";
import { students } from "./students";

/**
 * A pending invitation for someone to join a school in a role (teacher, accountant,
 * parent…). The recipient opens /accept/[token], sets a password, and is linked to a
 * ref_user + role_assignment. `assignments` holds teacher class/subject/form-master
 * grants captured at invite time (jsonb so it stays flexible across tiers).
 */
export const invites = pgTable(
  "invite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    role: text("role").notNull(), // role code (standard or custom)
    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone"), // E.164 — mandatory for staff (enforced in the action)
    // INCR-19a (parent portal): the child a PARENT invite claims. Nullable — staff/teacher invites
    // carry no student (new-nullable stays NULL for all existing rows); the PARENT-requires-student
    // rule is app-enforced, not a NOT NULL, so one column serves every invite kind (AC C1). A real
    // typed column, NOT the untyped `assignments` jsonb (which is teacher class/subject grants).
    studentId: uuid("student_id"),
    assignments: jsonb("assignments"), // e.g. [{ classId, subjectId?, formMaster? }]
    status: inviteStatusEnum("status").notNull().default("PENDING"),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptedUserId: uuid("accepted_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => ({
    bySchool: index("invite_school_status_idx").on(t.schoolId, t.status),
    // Composite intra-tenant FK — a PARENT invite can only reference a child in the SAME tenant (a
    // cross-tenant child invite is structurally impossible). CASCADE drops the pending invite if the
    // student is removed. NULL student_id (staff/teacher invites) skips the FK (MATCH SIMPLE). INCR-19a.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  }),
);
