import { pgTable, uuid, text, timestamp, date } from "drizzle-orm/pg-core";
import { schools } from "./tenancy";

/** A person who can authenticate (phone-OTP). Linked to schools via role_assignment. */
export const users = pgTable("ref_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull().unique(), // E.164 (+233...)
  email: text("email"),
  fullName: text("full_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Role catalogue (one row per role). `code` is free text — seeded with the standard
 * AppRole set but schools can add custom roles (e.g. "Sports Master") on the fly.
 */
export const roles = pgTable("ref_role", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
});

/** RBAC: a user holds a role at a school, optionally scoped (programme/house/class). */
export const roleAssignments = pgTable("role_assignment", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  roleId: uuid("role_id")
    .notNull()
    .references(() => roles.id),
  scopeRef: uuid("scope_ref"), // programme_id / house_id / class_id, role-dependent
  startDate: date("start_date").notNull().defaultNow(),
  endDate: date("end_date"), // null = currently active
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
