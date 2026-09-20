import { pgTable, uuid, text, timestamp, date, unique } from "drizzle-orm/pg-core";
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

/**
 * Admin user-management block list (INCR-35 / Module L2b, Kofi R262). ONE row per (school, user)
 * that is BLOCKED — **presence = blocked, absence = active**. There is deliberately no status enum:
 * the row IS the block. The block state lives HERE, never on ref_user (global identity, shared
 * across schools — a block is per-school) nor on role_assignment (a block is school-wide, not
 * per-role). getCurrentUser reads it under withoutTenantScope during identity resolution (RLS
 * bypass, exactly as it reads role_assignment there); block/activate manage actions write it under
 * withSchool. Tenant-scoped (has school_id) → FORCE RLS + tenant_isolation
 * (db/sql/policies.sql + prod-paste-0066-user-school-block.sql; RLS is hand-pasted on prod).
 *
 * FKs are all SINGLE-COLUMN — ref_user is GLOBAL (no school_id), so a composite (school_id, id)
 * intra-tenant FK is impossible here (the 0033 ordering hazard does not apply):
 *   • school_id → ref_school CASCADE and user_id → ref_user CASCADE — the block row is meaningless
 *     without its (school, user), so it dies with either.
 *   • blocked_by → ref_user SET NULL — attribution only (mirrors houses.hm_user_id); a removed
 *     manager must not delete the block itself.
 */
export const userSchoolBlock = pgTable(
  "user_school_block",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }), // the BLOCKED user
    blockedBy: uuid("blocked_by").references(() => users.id, { onDelete: "set null" }), // the manager
    blockedAt: timestamp("blocked_at", { withTimezone: true }).notNull().defaultNow(),
    reason: text("reason"),
  },
  (t) => ({
    // presence = blocked: at most one live block per (school, user).
    uniqSchoolUser: unique("user_school_block_school_user_uk").on(t.schoolId, t.userId),
  }),
);
