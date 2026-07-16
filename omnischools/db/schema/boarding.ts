import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  unique,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { schools } from "./tenancy";
import { users } from "./identity";
import { houses, students } from "./students";
import { prefectRoleEnum } from "./_enums";

/**
 * Boarding F0 (SHS module 4.2 / INCR-7) — the House → Dormitory → Bunk spatial spine, with
 * the bunk as the primary spatial key (BUILD_STACK #2). Houses already ship in students.ts
 * (name/colour/gender/capacity/HM); this file adds the two levels below the house plus the
 * append-only allocation history. Every table is tenant-scoped (composite (school_id, id) UKs
 * + composite intra-tenant FKs) so a cross-tenant bunk reference is structurally impossible;
 * all three get tenant_isolation FORCE RLS (db:policies dev + prod-paste-0044-boarding-spine.sql).
 *
 * Allocation / reassign logic lives in lib/ (server actions), never a DB trigger — portability
 * discipline. The live pointer is students.current_bunk_id (one-student-per-bunk enforced by a
 * partial unique index there); this table is the queryable move history, distinct from audit_log.
 *
 * CIRCULAR IMPORT (safe): students.ts imports boardingBunk (for the current_bunk_id composite FK)
 * and this file imports houses/students. Drizzle stores the table extra-config callback rather than
 * invoking it at module load, so the cross-file foreignColumns references resolve lazily after both
 * modules finish evaluating.
 */

/**
 * A dormitory within a House (Asankrangwa seeds A–H per House). `bunk_count` is the planned
 * figure; the roster grid renders from the actual boarding_bunk rows, never a hard-coded 8×15
 * (Kofi trap J5 — a 6-dorm house must render). `section_label` is an optional wing label.
 */
export const boardingDormitory = pgTable(
  "boarding_dormitory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    houseId: uuid("house_id").notNull(),
    name: text("name").notNull(), // "A".."H"
    sectionLabel: text("section_label"), // optional wing/section, nullable
    bunkCount: integer("bunk_count").notNull().default(15), // planned; grid renders from actual bunks
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One dormitory name per House (e.g. no two "A" dorms in Aggrey).
    uniqName: unique("uniq_dormitory_per_house").on(t.schoolId, t.houseId, t.name),
    // Composite-FK target for boarding_bunk (school_id, id).
    tenantUk: unique("boarding_dormitory_tenant_uk").on(t.schoolId, t.id),
    // Composite school-scoped FK — house must belong to the same tenant. CASCADE: removing a
    // House removes its dormitories (and, via boarding_bunk's CASCADE, its bunks).
    houseFk: foreignKey({
      columns: [t.schoolId, t.houseId],
      foreignColumns: [houses.schoolId, houses.id],
    }).onDelete("cascade"),
  }),
);

/**
 * A physical bunk within a dormitory — the primary spatial key. `position_number` is 1..bunk_count
 * (rendered zero-padded 01–15). `prefect_role` nullable: a set value marks this bunk's occupant a
 * prefect (display-only in F0). The occupancy pointer is students.current_bunk_id, NOT stored here
 * (a bunk holds ≤1 student, enforced by the partial unique index on students.current_bunk_id).
 */
export const boardingBunk = pgTable(
  "boarding_bunk",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    dormitoryId: uuid("dormitory_id").notNull(),
    positionNumber: integer("position_number").notNull(), // 1..bunk_count; rendered zero-padded
    prefectRole: prefectRoleEnum("prefect_role"), // nullable — set = occupant is that prefect
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One bunk per position within a dormitory.
    uniqPosition: unique("uniq_bunk_per_dormitory").on(
      t.schoolId,
      t.dormitoryId,
      t.positionNumber,
    ),
    // Composite-FK target for students.current_bunk_id + bunk_allocation.bunk_id (school_id, id).
    tenantUk: unique("boarding_bunk_tenant_uk").on(t.schoolId, t.id),
    // Composite school-scoped FK — dormitory must belong to the same tenant. CASCADE.
    dormitoryFk: foreignKey({
      columns: [t.schoolId, t.dormitoryId],
      foreignColumns: [boardingDormitory.schoolId, boardingDormitory.id],
    }).onDelete("cascade"),
  }),
);

/**
 * APPEND-ONLY bunk allocation history — one row per placement/reassign. `to_at IS NULL` marks the
 * open (current) allocation; a reassign closes the prior open row (to_at = now) and inserts a new
 * open row, atomically in one tx alongside moving students.current_bunk_id (lib/ server action, no
 * trigger). Rows are never UPDATEd except to close the open row, never DELETEd. This is operational
 * history (the swap log), deliberately distinct from audit_log. `reason` is mandatory (AC C4).
 * "The open allocation row for a student" = WHERE student_id = ? AND to_at IS NULL (one at most).
 */
export const bunkAllocation = pgTable(
  "bunk_allocation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(),
    bunkId: uuid("bunk_id").notNull(),
    fromAt: timestamp("from_at", { withTimezone: true }).notNull().defaultNow(),
    toAt: timestamp("to_at", { withTimezone: true }), // null = open = current allocation
    reason: text("reason").notNull(),
    // Global-table FK, SET NULL → single column (composite-FK rule exemption).
    allocatedByUserId: uuid("allocated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Serves both the per-student swap-log read and the open-row lookup (to_at IS NULL).
    byStudent: index("bunk_allocation_student_idx").on(t.schoolId, t.studentId),
    // Composite school-scoped FKs — student and bunk must belong to the same tenant. CASCADE.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    bunkFk: foreignKey({
      columns: [t.schoolId, t.bunkId],
      foreignColumns: [boardingBunk.schoolId, boardingBunk.id],
    }).onDelete("cascade"),
  }),
);
