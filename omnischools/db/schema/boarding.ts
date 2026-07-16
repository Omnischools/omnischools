import {
  pgTable,
  uuid,
  text,
  date,
  integer,
  smallint,
  boolean,
  jsonb,
  timestamp,
  unique,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { schools } from "./tenancy";
import { users } from "./identity";
import { houses, students } from "./students";
import {
  prefectRoleEnum,
  boardingDayTypeEnum,
  boardingEventTypeEnum,
} from "./_enums";

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

/* ============================================================================
 * Boarding programme config (SHS module 4.2 / INCR-8) — the "config OS" every later
 * boarding surface reads. Three NEW tenant tables (Kofi OQ1 rulings). All three are LEAF
 * tables — single-column `school_id` FK to ref_school, nothing references them — so they get
 * FORCE RLS but NO composite (school_id, id) tenant UK (mirror attendance_settings, not the
 * F0 spine tables above). RLS: db:policies (dev) + prod-paste-0045-boarding-config.sql (prod).
 * Config edits are audit-logged in lib/ (recordAudit → audit_log); no versioning table, no
 * DB trigger — portability discipline (Kofi OQ2/OQ3).
 * ==========================================================================*/

/**
 * The daily-rhythm template, one row per (school × day_type × form_scope). `activities_json`
 * is an ordered block array — heterogeneous rows (section markers + activities) make JSON the
 * fit over relational rows (Kofi OQ1): `[{ kind:'section'|'activity', label?, range?, start?,
 * end?, activity?, who?, note? }]`. `form_scope` defaults 'ALL'; a WEEKDAY/FORM_3 row is the F3
 * prep-extension variant (later lights-out) that INCR-10 resolves before falling back to 'ALL'
 * (contract getScheduleTemplate). UNIQUE(school_id, day_type, form_scope) is the upsert conflict
 * target — exactly one template per rhythm-per-form; a re-seed or an editor save upserts on it.
 */
export const dailyScheduleTemplate = pgTable(
  "daily_schedule_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    dayType: boardingDayTypeEnum("day_type").notNull(),
    // 'ALL' | 'FORM_1' | 'FORM_2' | 'FORM_3' — free-scope text, not an enum (Lucy: form scope is
    // an inline variant, not a fixed axis). 'ALL' is the base template every day_type must have.
    formScope: text("form_scope").notNull().default("ALL"),
    activitiesJson: jsonb("activities_json").notNull(), // ordered block array (see doc above)
    active: boolean("active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One template per (day_type, form_scope) per school — the upsert conflict target.
    uniqTemplate: unique("uniq_schedule_template").on(t.schoolId, t.dayType, t.formScope),
  }),
);

/**
 * Per-school boarding policy config (ONE row per school) — mirrors attendance_settings exactly:
 * single-column `school_id UNIQUE` FK, leaf, no composite UK, FORCE RLS. Every scalar is
 * editable-per-school and carries its GES default (verbatim from surface 01 policy cards) as the
 * column DEFAULT, so a bare `INSERT (school_id)` seeds a correct GES-default row (AC A1). The
 * `school_id` UNIQUE is the upsert conflict target for the settings editor. NO ladder columns
 * (the deboardinization ladder renders read-only from lib/ constants — Kofi OQ6, INCR-13 owns
 * any editable store). Readers coalesce a missing row to the GES-default constant (AC A2).
 */
export const boardingSettings = pgTable("boarding_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .unique()
    .references(() => schools.id, { onDelete: "cascade" }),
  // --- Exeat doctrine (→ getExeatPolicy → INCR-9) ---
  exeatScheduledPerTerm: smallint("exeat_scheduled_per_term").notNull().default(3),
  exeatReturnBy: text("exeat_return_by").notNull().default("16:00"),
  exeatFeeOwingMustCollect: boolean("exeat_fee_owing_must_collect").notNull().default(true),
  exeatSpecialApprover: text("exeat_special_approver").notNull().default("Senior HM only"),
  exeatParentInitiated: boolean("exeat_parent_initiated").notNull().default(true),
  exeatDressCode: text("exeat_dress_code").notNull().default("Uniform or outing dress"),
  exeatCardSigner: text("exeat_card_signer").notNull().default("Signed by Housemaster"),
  // --- Visiting doctrine (→ getVisitingPolicy → INCR-12) ---
  visitingCadence: text("visiting_cadence").notNull().default("2nd Sun · monthly"),
  visitingHoursStart: text("visiting_hours_start").notNull().default("12:00"),
  visitingHoursEnd: text("visiting_hours_end").notNull().default("16:00"),
  visitingLunchTime: text("visiting_lunch_time").notNull().default("11:30"),
  visitingDormitoriesRule: text("visiting_dormitories_rule").notNull().default("Out of bounds"),
  visitingApprovedVisitors: text("visiting_approved_visitors")
    .notNull()
    .default("Parent · guardian · sibling"),
  visitingBookOwner: text("visiting_book_owner").notNull().default("Digital · SoD owns"),
  // --- Inspection doctrine (→ getInspectionPolicy → INCR-10) ---
  inspectionDailyStart: text("inspection_daily_start").notNull().default("06:10"),
  inspectionDailyEnd: text("inspection_daily_end").notNull().default("06:20"),
  inspectionDailyScope: text("inspection_daily_scope").notNull().default("Bunks · lockers · attire"),
  inspectionWeekly: text("inspection_weekly").notNull().default("Saturday 08:00"),
  inspectionWeeklyScope: text("inspection_weekly_scope")
    .notNull()
    .default("Whole House · top to bottom"),
  inspectionScrubbing: text("inspection_scrubbing").notNull().default("Wed 16:00 — 17:00"),
  inspectionWashingDays: text("inspection_washing_days").notNull().default("Wed & Fri afternoons"),
  inspectionInspector: text("inspection_inspector").notNull().default("HM & House Prefects"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Boarding-specific calendar events — ONLY visiting Sundays and exeat windows (Kofi OQ4).
 * Resumption/vacation are NEVER rows here: they derive from academic_period (SENIOR for F1/F2,
 * SENIOR_F3 for Form 3) in the config-read contract. Storing term dates here would duplicate the
 * source of truth and diverge. UNIQUE(school_id, academic_year, event_type, event_date) prevents
 * a duplicate event on the same date (and is the upsert conflict target); the (school_id,
 * academic_year) index serves the per-year calendar read. `form_scope`/`sequence` are nullable
 * (e.g. "exeat 2 of 3" carries sequence=2; a whole-school visiting Sunday carries neither).
 */
export const boardingCalendarEvent = pgTable(
  "boarding_calendar_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    academicYear: text("academic_year").notNull(),
    eventType: boardingEventTypeEnum("event_type").notNull(),
    eventDate: date("event_date").notNull(),
    label: text("label").notNull(),
    formScope: text("form_scope"), // nullable — null = whole school
    sequence: smallint("sequence"), // nullable — e.g. exeat "2 of 3"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // No duplicate event on a date per year per school; also the upsert conflict target.
    uniqEvent: unique("uniq_boarding_calendar_event").on(
      t.schoolId,
      t.academicYear,
      t.eventType,
      t.eventDate,
    ),
    // Per-year calendar read (getBoardingCalendar).
    byYear: index("boarding_calendar_event_year_idx").on(t.schoolId, t.academicYear),
  }),
);
