import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  unique,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./tenancy";
import { users } from "./identity";
import { academicPeriod } from "./periods";

/**
 * GOV-7 facilities snapshot (governance module) — ONE new tenant table holding a SCHOOL-LEVEL,
 * PER-TERM census of physical infrastructure (classrooms, WASH, library/ICT, GSFP feeding, furniture).
 * Kofi R376: exactly ONE row per (school × academic term), the (school_id, period_id) UNIQUE being the
 * idempotency / upsert conflict target — a re-submitted census overwrites the term's row, never appends.
 *
 * TENANT / management-facing (NOT parent-facing), the standard tenant-table pattern: ENABLE + FORCE RLS +
 * tenant_isolation (db:policies on dev; db/sql/prod-paste-0086-facilities-snapshot.sql by hand on prod —
 * ⚠ RLS is NOT auto-applied on prod). It carries NO parent_scope, so the catalog-driven RESTRICTIVE
 * parent_deny loop in db/sql/policies.sql auto-covers it (FORCE-RLS + school_id + no parent_scope → denied)
 * with zero edits. Same shape as terminal_exam_result (GOV-6).
 *
 * FKs ([[composite-tenant-fks]]): school_id → ref_school (the tenant ROOT, so single-col, NOT composite)
 * CASCADE; captured_by → the GLOBAL ref_user SET NULL (a removed user clears the audit stamp, never deletes
 * the census). PLUS a COMPOSITE (school_id, period_id) → academic_period(school_id, period_id) CASCADE — the
 * target is academic_period_tenant_uk, so a term reference is structurally intra-tenant and can never cross
 * schools. LEAF — nothing FKs here → NO tenant_uk. All tick-one enums are TEXT + CHECK, NOT pg-enum (the
 * ref_role / plc.type fixed-domain idiom).
 *
 * Every count is CHECK-bounded ≥ 0. The optional-detail (nullable) counts are ALSO CHECK ≥ 0 — a CHECK that
 * evaluates to NULL is satisfied, so an omitted value passes while a negative one is rejected. The two
 * cross-column invariants (good + repair ≤ total; computers_working ≤ computers_total when both present) are
 * table CHECKs.
 */
export const facilitiesSnapshot = pgTable(
  "facilities_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    // Composite-FK member (see periodFk): (school_id, period_id) → academic_period, so the term reference
    // cannot cross tenants.
    periodId: uuid("period_id").notNull(),

    // ---- Classrooms (mandatory) ----
    classroomsTotal: integer("classrooms_total").notNull(),
    classroomsGood: integer("classrooms_good").notNull(),
    classroomsRepair: integer("classrooms_repair").notNull(),

    // ---- WASH: water / power / sanitation (mandatory) ----
    waterSource: text("water_source").notNull(), // BOREHOLE | PIPE | WELL | NONE
    electricitySource: text("electricity_source").notNull(), // GRID | SOLAR | GENERATOR | NONE
    latrinesBoys: integer("latrines_boys").notNull(),
    latrinesGirls: integer("latrines_girls").notNull(),
    latrinesStaff: integer("latrines_staff").notNull(),
    latrineType: text("latrine_type").notNull(), // WC | KVIP | PIT | NONE
    handwashing: boolean("handwashing").notNull(),

    // ---- Facility presence (mandatory) ----
    hasLibrary: boolean("has_library").notNull(),
    hasIctLab: boolean("has_ict_lab").notNull(),
    internet: boolean("internet").notNull(),
    hasKitchen: boolean("has_kitchen").notNull(),
    gsfpParticipating: boolean("gsfp_participating").notNull(),

    // ---- Optional detail (nullable; each count CHECK ≥ 0, satisfied on NULL) ----
    libraryBookCount: integer("library_book_count"),
    libraryStaffFte: numeric("library_staff_fte", { precision: 4, scale: 1 }),
    computersTotal: integer("computers_total"),
    computersWorking: integer("computers_working"),
    internetType: text("internet_type"), // free-text: domain unconfirmed → NO CHECK
    mealsServedLastTerm: integer("meals_served_last_term"),
    pupilsFedDailyAvg: integer("pupils_fed_daily_avg"),
    catererName: text("caterer_name"),
    textbookAvailability: text("textbook_availability"), // ADEQUATE | INADEQUATE
    studentDesksUsable: integer("student_desks_usable"),
    studentDesksBroken: integer("student_desks_broken"),
    teacherDesks: integer("teacher_desks"),
    chalkboards: integer("chalkboards"),
    whiteboards: integer("whiteboards"),
    projectors: integer("projectors"),

    note: text("note"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    // Audit stamp — single-column SET NULL → the GLOBAL ref_user.
    capturedBy: uuid("captured_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => ({
    // Composite intra-tenant FK to the term. Target = academic_period_tenant_uk (school_id, period_id).
    periodFk: foreignKey({
      columns: [t.schoolId, t.periodId],
      foreignColumns: [academicPeriod.schoolId, academicPeriod.periodId],
    }).onDelete("cascade"),
    // The idempotency / upsert conflict target (R376): one census per (school × term). Its (school_id)
    // prefix serves the per-school reads, so no separate school index.
    uniqTerm: unique("uniq_facilities_snapshot_term").on(t.schoolId, t.periodId),

    // Classrooms: counts ≥ 0, and good + repair never exceed the total.
    classroomsNonneg: check(
      "facilities_snapshot_classrooms_nonneg",
      sql`${t.classroomsTotal} >= 0 AND ${t.classroomsGood} >= 0 AND ${t.classroomsRepair} >= 0`,
    ),
    classroomsSum: check(
      "facilities_snapshot_classrooms_sum",
      sql`${t.classroomsGood} + ${t.classroomsRepair} <= ${t.classroomsTotal}`,
    ),

    // WASH fixed domains + latrine counts ≥ 0.
    waterSourceValid: check(
      "facilities_snapshot_water_source_valid",
      sql`${t.waterSource} IN ('BOREHOLE', 'PIPE', 'WELL', 'NONE')`,
    ),
    electricitySourceValid: check(
      "facilities_snapshot_electricity_source_valid",
      sql`${t.electricitySource} IN ('GRID', 'SOLAR', 'GENERATOR', 'NONE')`,
    ),
    latrinesNonneg: check(
      "facilities_snapshot_latrines_nonneg",
      sql`${t.latrinesBoys} >= 0 AND ${t.latrinesGirls} >= 0 AND ${t.latrinesStaff} >= 0`,
    ),
    latrineTypeValid: check(
      "facilities_snapshot_latrine_type_valid",
      sql`${t.latrineType} IN ('WC', 'KVIP', 'PIT', 'NONE')`,
    ),

    // Optional detail — non-negativity (three-valued: NULL passes, a real negative is FALSE → rejected).
    libraryNonneg: check(
      "facilities_snapshot_library_nonneg",
      sql`${t.libraryBookCount} >= 0 AND ${t.libraryStaffFte} >= 0`,
    ),
    computersNonneg: check(
      "facilities_snapshot_computers_nonneg",
      sql`${t.computersTotal} >= 0 AND ${t.computersWorking} >= 0`,
    ),
    computersBound: check(
      "facilities_snapshot_computers_bound",
      sql`${t.computersWorking} IS NULL OR ${t.computersTotal} IS NULL OR ${t.computersWorking} <= ${t.computersTotal}`,
    ),
    gsfpNonneg: check(
      "facilities_snapshot_gsfp_nonneg",
      sql`${t.mealsServedLastTerm} >= 0 AND ${t.pupilsFedDailyAvg} >= 0`,
    ),
    furnitureNonneg: check(
      "facilities_snapshot_furniture_nonneg",
      sql`${t.studentDesksUsable} >= 0 AND ${t.studentDesksBroken} >= 0 AND ${t.teacherDesks} >= 0 AND ${t.chalkboards} >= 0 AND ${t.whiteboards} >= 0 AND ${t.projectors} >= 0`,
    ),
    textbookAvailabilityValid: check(
      "facilities_snapshot_textbook_availability_valid",
      sql`${t.textbookAvailability} IN ('ADEQUATE', 'INADEQUATE')`,
    ),
  }),
);
