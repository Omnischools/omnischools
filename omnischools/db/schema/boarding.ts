import {
  pgTable,
  uuid,
  text,
  date,
  integer,
  smallint,
  boolean,
  jsonb,
  numeric,
  timestamp,
  unique,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { schools } from "./tenancy";
import { users } from "./identity";
import { houses, students } from "./students";
import { academicPeriod } from "./periods";
import {
  prefectRoleEnum,
  boardingDayTypeEnum,
  boardingEventTypeEnum,
  exeatTypeEnum,
  exeatStatusEnum,
  exeatNotificationKindEnum,
  inspectionTypeEnum,
  inspectionResultEnum,
  attendanceStatusEnum,
  boardingModeEnum,
  visitorApprovalStatusEnum,
  visitStatusEnum,
  visitVerificationEnum,
  visitNotificationKindEnum,
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

/* ============================================================================
 * Boarding exeat (SHS module 4.2 / INCR-9) — the request → HM review → (Sr-HM sign) → depart →
 * return gate-crossing lifecycle for a boarder (Kofi OQ1). Two NEW tenant tables:
 * boarding_exeat (the exeat itself, one row per trip) + exeat_notification (append-only SMS log).
 * Both FORCE RLS (db:policies dev + prod-paste-0046-boarding-exeat.sql prod). Lifecycle lives in
 * lib/boarding/ server actions (no trigger — portability). Config is READ through the frozen
 * getExeatPolicy contract; fee-owing is a live READ of invoices.balance_amount. NOTHING is derived
 * in the DB: quota_used = count(SCHEDULED+FEE_COLLECTION, status≠DECLINED, per student×period);
 * returned_late = returned_at > return_by; overdue = DEPARTED ∧ now>return_by ∧ returned_at IS NULL
 * — all computed in lib/, so there is deliberately NO quota counter and NO overdue/returned_late col.
 * ==========================================================================*/

/**
 * One exeat (leave-of-absence) for a boarder. Five timestamped, actor-stamped stages
 * (requested → hm_approved → sr_hm_signed → departed → returned) plus a terminal decline. A
 * scheduled-clean exeat skips sr_hm_signed; a SPECIAL needs the Senior HM signature (Kofi OQ4).
 *
 * FK shapes (composite-tenant-FK rule): student_id / house_id / academic_period_id are composite
 * (school_id, …) intra-tenant FKs — a cross-tenant student, House or semester is structurally
 * impossible (CASCADE, mirroring bunk_allocation / gradebook). calendar_event_id is the ONE
 * exception: a nullable "which EXEAT_WINDOW does this fill" pointer, single-column SET NULL →
 * boarding_calendar_event(id). It takes the rule's SET-NULL exemption because (a) a composite SET
 * NULL would try to null the NOT-NULL school_id too (the score-ledger supersedesFk trap), and
 * boarding_calendar_event is HARD-deletable (no `active` soft-delete, unlike house/bunk), so a
 * composite FK would behave like RESTRICT and block editing a window an exeat references — the
 * opposite of the intended SET NULL; and (b) it is a weak informational link, not an authorization
 * boundary — RLS on boarding_calendar_event + tenant-scoped getBoardingCalendar already prevent a
 * cross-tenant event id ever reaching the insert. So NO tenant UK is added to the INCR-8 table.
 *
 * ref_code (e.g. ASA-EX-2026-0341) is human-facing and unique per school — unique(school_id,
 * ref_code) is the collision guard + the upsert/idempotency target for the code generator.
 * fee_owing_snapshot freezes the live balance at approval (read once, not re-read per view — T5).
 */
export const boardingExeat = pgTable(
  "boarding_exeat",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(),
    houseId: uuid("house_id").notNull(), // House at time of exeat (snapshot)
    academicPeriodId: uuid("academic_period_id").notNull(), // SHS semester = quota scope
    // Nullable single-column SET NULL FK — the scheduled EXEAT_WINDOW this trip fills (see doc).
    calendarEventId: uuid("calendar_event_id").references(() => boardingCalendarEvent.id, {
      onDelete: "set null",
    }),
    exeatType: exeatTypeEnum("exeat_type").notNull(),
    status: exeatStatusEnum("status").notNull().default("REQUESTED"),
    refCode: text("ref_code").notNull(), // e.g. ASA-EX-2026-0341
    reason: text("reason"), // app-required for SPECIAL, auto-prefilled for FEE_COLLECTION
    parentInitiated: boolean("parent_initiated").notNull().default(true),
    departAt: timestamp("depart_at", { withTimezone: true }), // planned out
    returnBy: timestamp("return_by", { withTimezone: true }), // planned in (return-by deadline)
    // --- 5 stage stamps, each + actor (global-table SET NULL → single-column FK) ---
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    hmApprovedAt: timestamp("hm_approved_at", { withTimezone: true }),
    hmApprovedByUserId: uuid("hm_approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    srHmSignedAt: timestamp("sr_hm_signed_at", { withTimezone: true }),
    srHmSignedByUserId: uuid("sr_hm_signed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    departedAt: timestamp("departed_at", { withTimezone: true }),
    departedByUserId: uuid("departed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    returnedByUserId: uuid("returned_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // --- terminal decline ---
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    declinedByUserId: uuid("declined_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    declineReason: text("decline_reason"),
    // Live fee balance frozen at approval (GHS). Null = fees clear at approval time.
    feeOwingSnapshot: numeric("fee_owing_snapshot", { precision: 12, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for exeat_notification (school_id, id). MUST exist before that FK.
    tenantUk: unique("boarding_exeat_tenant_uk").on(t.schoolId, t.id),
    // Human-facing code unique per school; the code-generator collision + idempotency target.
    uniqRefCode: unique("uniq_exeat_ref_code").on(t.schoolId, t.refCode),
    // Quota read: count SCHEDULED+FEE_COLLECTION per (student × semester).
    byStudentPeriod: index("boarding_exeat_student_period_idx").on(
      t.schoolId,
      t.studentId,
      t.academicPeriodId,
    ),
    // Composite intra-tenant FKs — cross-tenant student/House/period structurally impossible.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    houseFk: foreignKey({
      columns: [t.schoolId, t.houseId],
      foreignColumns: [houses.schoolId, houses.id],
    }).onDelete("cascade"),
    periodFk: foreignKey({
      columns: [t.schoolId, t.academicPeriodId],
      foreignColumns: [academicPeriod.schoolId, academicPeriod.periodId],
    }).onDelete("cascade"),
  }),
);

/**
 * APPEND-ONLY exeat SMS log (NOT audit_log — needs delivery metadata + idempotency the audit trail
 * doesn't carry). One row per send attempt for the late-return escalation chain (Kofi OQ3/OQ5);
 * idempotency for the +5/+30/+60 chain is `NOT EXISTS(kind for this exeat)` before each stage send.
 * `provider` = console | hubtel (sends nothing real until Hubtel go-live). `ok`/`error`/
 * `provider_message_id` are the delivery result. Human lifecycle actions still go to audit_log, not
 * here. Composite (school_id, exeat_id) FK → boarding_exeat keeps it intra-tenant; CASCADE with the
 * exeat. FORCE RLS (prod-paste-0046).
 */
export const exeatNotification = pgTable(
  "exeat_notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    exeatId: uuid("exeat_id").notNull(),
    kind: exeatNotificationKindEnum("kind").notNull(),
    toPhone: text("to_phone").notNull(), // E.164
    body: text("body").notNull(),
    provider: text("provider").notNull(), // console | hubtel
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    ok: boolean("ok").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    // Global-table SET NULL → single column (null for system-fired chain sends).
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    // Per-exeat log read + the idempotency existence check.
    byExeat: index("exeat_notification_exeat_idx").on(t.schoolId, t.exeatId),
    // Composite intra-tenant FK — a cross-tenant exeat reference is structurally impossible.
    exeatFk: foreignKey({
      columns: [t.schoolId, t.exeatId],
      foreignColumns: [boardingExeat.schoolId, boardingExeat.id],
    }).onDelete("cascade"),
  }),
);

/* ============================================================================
 * Boarding daily life (SHS module 4.2 / INCR-10) — the Housemaster's live Today view (surface
 * 04). Two NEW tenant tables record what the timeline/NOW/counts only DERIVE: `inspections`
 * (per-dorm DAILY + whole-house WEEKLY) and `prep_attendance` (per-boarder exception log). Both
 * are LEAF tables — single-column `school_id` FK + composite (school_id, X) intra-tenant FKs,
 * FORCE RLS, but NO composite (school_id, id) tenant UK (nothing references them — mirror
 * bunk_allocation, not the F0 spine). Write/derive logic lives in lib/boarding/ (no trigger —
 * portability). RLS: db:policies (dev) + prod-paste-0047-boarding-inspections.sql (prod).
 * Timeline/NOW/exeat-and-in-House counts are pure derivation with NO storage (Kofi OQ4/OQ5).
 * ==========================================================================*/

/**
 * APPEND-ONLY, latest-wins dormitory inspection (Kofi OQ1). One `inspections` table holds both
 * cadences discriminated by `type` (BUILD_STACK #8): a DAILY per-dorm morning check and a WEEKLY
 * whole-house deep check. There is deliberately NO unique-per-day and NO tenant UK — a re-inspection
 * simply appends; the read is latest-wins per (dormitory × type × UTC-date) by max `inspected_at`.
 *
 * `result` is a 3-state PASS/PARTIAL/FAIL (supersedes BUILD_STACK's `pass_fail` bool — surface 04
 * shows "N/M bunks clean" alongside a tri-state). `bunks_clean`/`bunks_total` are populated for
 * DAILY, NULL for WEEKLY; `bunks_total` is a SNAPSHOT taken at write (a later-added bunk must not
 * change a past inspection's denominator — AC C3), never re-derived. `findings_json` is plain jsonb
 * whose shape is discriminated by `type` and Zod-validated in lib/ (DAILY {kind,checks,flaggedBunks?,
 * notes?} vs WEEKLY {kind,areas[],notes?}) — deliberately NO DB CHECK/trigger (portability). A
 * PARTIAL/FAIL records `anomalies_count` (computed in lib at write) but writes ZERO discipline rows —
 * escalation is STUBBED to INCR-13 (AC E). Composite (school_id, dormitory_id) FK keeps the dorm
 * intra-tenant (cross-tenant structurally impossible); actor stamp is the single-column SET NULL
 * users FK (exeat pattern). Index (school_id, dormitory_id, inspected_at) serves the latest-wins read.
 *
 * INCR-11 tweak #3 (Kofi AC K): a WEEKLY whole-house check anchors on the HOUSE, not a dormitory, so
 * it survives a later dorm deactivation. `dormitory_id` is now NULLABLE (DAILY sets it, WEEKLY leaves
 * it NULL) and a parallel nullable `house_id` (composite (school_id, house_id) FK → house) is added
 * (WEEKLY sets it, DAILY leaves it NULL). The DAILY-vs-WEEKLY column discipline is app-enforced in
 * lib/ (no DB CHECK — portability); with MATCH SIMPLE a NULL in either composite FK simply skips that
 * FK. Existing WEEKLY rows are backfilled house_id = their dormitory's house in migration 0048.
 */
export const inspections = pgTable(
  "inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    dormitoryId: uuid("dormitory_id"), // nullable (tweak #3): DAILY anchor; NULL for WEEKLY
    houseId: uuid("house_id"), // nullable (tweak #3): WEEKLY anchor; NULL for DAILY
    type: inspectionTypeEnum("type").notNull(),
    result: inspectionResultEnum("result").notNull(),
    bunksClean: smallint("bunks_clean"), // DAILY only; NULL for WEEKLY
    bunksTotal: smallint("bunks_total"), // DAILY only; snapshot at write, never re-derived; NULL for WEEKLY
    findingsJson: jsonb("findings_json").notNull(), // shape discriminated by `type`, Zod-validated in lib/
    anomaliesCount: smallint("anomalies_count").notNull().default(0), // computed in lib at write
    inspectedAt: timestamp("inspected_at", { withTimezone: true }).notNull().defaultNow(),
    // Global-table SET NULL → single column (exeat actor-stamp pattern).
    inspectedByUserId: uuid("inspected_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Latest-wins read: max(inspected_at) per (school, dormitory, type) filtered to a UTC-date.
    byDormTime: index("inspections_dorm_time_idx").on(t.schoolId, t.dormitoryId, t.inspectedAt),
    // WEEKLY latest-wins read anchors on the House (tweak #3): max(inspected_at) per (school, house, type).
    byHouseTime: index("inspections_house_time_idx").on(t.schoolId, t.houseId, t.inspectedAt),
    // Composite intra-tenant FK — a cross-tenant dormitory reference is structurally impossible.
    // Nullable dormitory_id: with MATCH SIMPLE a WEEKLY row's NULL dormitory_id skips this FK.
    dormitoryFk: foreignKey({
      columns: [t.schoolId, t.dormitoryId],
      foreignColumns: [boardingDormitory.schoolId, boardingDormitory.id],
    }).onDelete("cascade"),
    // Composite intra-tenant FK — the WEEKLY anchor House (tweak #3). Nullable house_id: a DAILY
    // row's NULL house_id skips this FK. Not a new tenant UK target — inspections stays a LEAF table.
    houseFk: foreignKey({
      columns: [t.schoolId, t.houseId],
      foreignColumns: [houses.schoolId, houses.id],
    }).onDelete("cascade"),
  }),
);

/**
 * Per-boarder prep-attendance EXCEPTION log (Kofi OQ3) — one upserted row per (boarder × night)
 * for the exceptions only. The writer inserts only LATE/ABSENT/EXCUSED/MEDICAL (the existing
 * canonical 5-status attendance enum, reused — PRESENT is NEVER a row: present-by-default is the
 * absence of a row, AC F1/F3). `session_date` is a STORED date, not derived from a timestamp —
 * avoids the tz-boundary trap (Kofi OQ3). `house_id` is a SNAPSHOT of the boarder's House at log
 * time. UNIQUE(school_id, student_id, session_date) is the upsert conflict target (re-logging the
 * same boarder the same night updates the one row, never a second — AC F2). LEAF table: NO tenant
 * UK. Composite (school_id, X) FKs to students/houses keep both refs intra-tenant; actor stamp is
 * the single-column SET NULL users FK. Index (school_id, house_id, session_date) serves the
 * per-House per-night roster read. Write logic in lib/boarding/ (no trigger).
 */
export const prepAttendance = pgTable(
  "prep_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(),
    houseId: uuid("house_id").notNull(), // snapshot of House at log time
    sessionDate: date("session_date").notNull(), // stored date (not derived) — avoids tz-boundary trap
    // Reuses the canonical 5-status attendance enum; writer only ever uses LATE/ABSENT/EXCUSED/MEDICAL.
    status: attendanceStatusEnum("status").notNull(),
    minutesLate: smallint("minutes_late"), // nullable — set for LATE
    note: text("note"),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
    // Global-table SET NULL → single column (exeat actor-stamp pattern).
    loggedByUserId: uuid("logged_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One exception row per boarder per night — the upsert conflict target.
    uniqPerNight: unique("uniq_prep_attendance").on(t.schoolId, t.studentId, t.sessionDate),
    // Per-House per-night roster read.
    byHouseDate: index("prep_attendance_house_date_idx").on(t.schoolId, t.houseId, t.sessionDate),
    // Composite intra-tenant FKs — a cross-tenant student/House reference is structurally impossible.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    houseFk: foreignKey({
      columns: [t.schoolId, t.houseId],
      foreignColumns: [houses.schoolId, houses.id],
    }).onDelete("cascade"),
  }),
);

/* ============================================================================
 * Boarding resumption / vacation (SHS module 4.2 / INCR-11) — surface 03, the two chaos days of
 * the year. ONE NEW tenant table `boarding_arrival` records each boarder's gate-check on both
 * days, discriminated by `mode` (RESUMPTION | VACATION) — one surface, one table, mode flag (Kofi
 * OQ1). FORCE RLS (db:policies dev + prod-paste-0048-boarding-resumption.sql prod). All arrival/
 * window/counter/checklist logic lives in lib/boarding/ (no trigger — portability): windows,
 * counters and the issues queue are pure DERIVATIONS with NO storage (Kofi OQ3/OQ5), and the
 * checklist is Zod-in-lib with NO DB CHECK.
 * ==========================================================================*/

/**
 * One gate-check per boarder per (semester × mode) — the STORED half of surface 03. `mode`
 * disambiguates the two days: RESUMPTION (staggered arrival, F3-first) records the GES 6-item
 * prospectus checklist; VACATION (departure inverse) records the 5-item departure checklist. There
 * is deliberately NO arrived/departed split and NO window column — one `checked_at` (arrived_at for
 * RESUMPTION / departed_at for VACATION) and windows DERIVE from the calendar + Form (Kofi OQ1/OQ3).
 *
 * LEAF table (mirror inspections / prep_attendance): single-column school_id FK + composite
 * (school_id, X) intra-tenant FKs, FORCE RLS, but NO composite (school_id, id) tenant UK — nothing
 * references it. `house_id` is a SNAPSHOT of the boarder's House at check time; `academic_period_id`
 * is the resolved SENIOR semester (F3 early vacation still records against the SENIOR period_id — the
 * SENIOR_F3 calendar only shifts the derived date). NO bunk_id column — the confirmed bunk is a live
 * read of students.current_bunk_id (Kofi OQ1, AC F1).
 *
 * `checklist_json` shape is discriminated by `mode` and Zod-validated in lib/ (RESUMPTION 6 keys /
 * VACATION 5 keys, each ok|partial|missing) — NO DB CHECK/trigger (portability, the inspections
 * pattern). `fee_owing_snapshot numeric(12,2)` freezes the live feeOwingForStudent balance at check
 * (never re-read per view — AC E4; NULL = fees clear); it is a FLAG that never blocks (GES
 * cannot-detain — mirrors boarding_exeat.fee_owing_snapshot). `note` is the one lean issue note
 * (Kofi OQ5 — no issues table; the other issue categories all DERIVE). `checked_by_user_id` is the
 * single-column SET NULL users actor stamp (exeat pattern).
 *
 * UNIQUE(school_id, student_id, academic_period_id, mode) is the upsert / re-scan idempotency target
 * (AC M1 — re-scanning the same boarder+mode+period updates the one row, never a dup) and lets one
 * RESUMPTION + one VACATION row coexist per (student × period) (AC H5 — mode is in the key). Index
 * (school_id, house_id, academic_period_id, mode) serves the per-House per-mode progress read (AC B).
 */
export const boardingArrival = pgTable(
  "boarding_arrival",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(),
    houseId: uuid("house_id").notNull(), // snapshot of House at check time
    academicPeriodId: uuid("academic_period_id").notNull(), // resolved SENIOR semester
    mode: boardingModeEnum("mode").notNull(), // RESUMPTION | VACATION
    checklistJson: jsonb("checklist_json").notNull(), // shape discriminated by `mode`, Zod-validated in lib/
    // Live fee balance frozen at check (GHS). Null = fees clear. Flag, never a block (GES cannot-detain).
    feeOwingSnapshot: numeric("fee_owing_snapshot", { precision: 12, scale: 2 }),
    note: text("note"), // the one lean issue note (Kofi OQ5) — nullable
    // arrived_at (RESUMPTION) / departed_at (VACATION); mode disambiguates the single stamp.
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    // Global-table SET NULL → single column (exeat actor-stamp pattern).
    checkedByUserId: uuid("checked_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Upsert / re-scan idempotency target; mode in the key lets a RESUMPTION + VACATION row coexist.
    uniqPerMode: unique("uniq_boarding_arrival").on(
      t.schoolId,
      t.studentId,
      t.academicPeriodId,
      t.mode,
    ),
    // Per-House per-mode progress read.
    byHousePeriodMode: index("boarding_arrival_house_period_mode_idx").on(
      t.schoolId,
      t.houseId,
      t.academicPeriodId,
      t.mode,
    ),
    // Composite intra-tenant FKs — a cross-tenant student/House/period reference is structurally impossible.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    houseFk: foreignKey({
      columns: [t.schoolId, t.houseId],
      foreignColumns: [houses.schoolId, houses.id],
    }).onDelete("cascade"),
    periodFk: foreignKey({
      columns: [t.schoolId, t.academicPeriodId],
      foreignColumns: [academicPeriod.schoolId, academicPeriod.periodId],
    }).onDelete("cascade"),
  }),
);

/* ============================================================================
 * Boarding visiting day (SHS module 4.2 / INCR-12) — surface 06, the digital Visitor's Book, one
 * Sunday a month. THREE NEW tenant tables (Kofi OQ1): a DURABLE per-student approved-visitor list
 * (boarding_approved_visitor), the visit record with the exeat two-stamp in/out (boarding_visit),
 * and a lean dual-scoped SMS log (boarding_visit_notification). All three FORCE RLS (db:policies dev
 * + prod-paste-0049-boarding-visiting.sql prod). Every gate-check / CRUD / derivation lives in
 * lib/boarding/ (no trigger — portability); RSVP-by-House, zone occupancy, arrival counters and
 * overstay are pure DERIVATIONS with NO storage (Kofi OQ5, AC K). Reads the frozen getVisitingPolicy
 * + getBoardingCalendar VISITING events READ-only. NOT fee- or discipline-gated (OQ-F) — deliberately
 * NO fee_owing_snapshot column, unlike boarding_exeat / boarding_arrival.
 *
 * TENANT-UK vs LEAF doctrine here: the first two tables are DURABLE and REFERENCED, so both carry a
 * composite (school_id, id) tenant UK (mirror the F0 spine + boarding_exeat, NOT the INCR-10/11 LEAF
 * tables): boarding_approved_visitor is referenced by boarding_visit.approved_visitor_id, and
 * boarding_visit is referenced by boarding_visit_notification.visit_id. boarding_visit_notification is
 * a LEAF (nothing references it) so it gets FORCE RLS but NO tenant UK (mirror exeat_notification).
 * ==========================================================================*/

/**
 * DURABLE per-student approved-visitor list (Kofi OQ1/OQ3) — the HM-curated set of adults the gate
 * VERIFIES an arriving visitor against (§2 tenet: list-CHECK not list-RECORD). One row per approved
 * adult per student. `relationship` is FREE TEXT (not an enum — a visitor relationship is open-ended,
 * unlike guardian_relation), `id_hint`/`phone` are the biggest external-PII surface in Boarding (adults'
 * names/phones/ID hints — FORCE RLS, stored full, rendered MASKED in lib/, never in a URL/SMS log — AC J4).
 * `status` defaults PENDING_REVIEW; HM/Dean approval flips it to APPROVED (only APPROVED matches at the
 * gate → VERIFIED). `pastoral_review` is the Dean/VLC-4.5 STUB flag (manual, no VLC write). Max-6 is
 * APP-ENFORCED in lib/ (MAX_APPROVED_VISITORS) — deliberately NO DB cardinality constraint (a COUNT
 * check would need a forbidden trigger; zero approved visitors is also valid — AC B5).
 *
 * DURABLE + REFERENCED by boarding_visit.approved_visitor_id → needs the composite (school_id, id)
 * tenant UK (the F0-spine/exeat pattern, NOT the INCR-10/11 LEAF pattern). Composite (school_id,
 * student_id) FK keeps the student intra-tenant (cross-tenant structurally impossible, CASCADE); the
 * two actor stamps are single-column SET NULL users FKs (exeat pattern). Index (school_id, student_id)
 * serves the per-student list read (the gate's match lookup).
 */
export const boardingApprovedVisitor = pgTable(
  "boarding_approved_visitor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(),
    name: text("name").notNull(),
    relationship: text("relationship").notNull(), // FREE TEXT (not an enum) — open-ended
    idHint: text("id_hint"), // PII — ID hint (not a document), nullable
    phone: text("phone"), // PII — E.164, nullable
    status: visitorApprovalStatusEnum("status").notNull().default("PENDING_REVIEW"),
    pastoralReview: boolean("pastoral_review").notNull().default(false), // Dean/VLC-4.5 stub flag
    note: text("note"),
    // Global-table SET NULL → single-column actor stamps (exeat pattern).
    addedByUserId: uuid("added_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for boarding_visit.approved_visitor_id (single-col → id, see doc). Also the
    // durable tenant UK. MUST exist before that FK — carried INLINE in CREATE TABLE.
    tenantUk: unique("boarding_approved_visitor_tenant_uk").on(t.schoolId, t.id),
    // Per-student list read + the gate's match lookup.
    byStudent: index("boarding_approved_visitor_student_idx").on(t.schoolId, t.studentId),
    // Composite intra-tenant FK — a cross-tenant student reference is structurally impossible.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  }),
);

/**
 * The visit record — the exeat two-stamp in/out lifecycle for a visiting-day gate check (Kofi OQ1).
 * `status` RSVP → ARRIVED → DEPARTED (a walk-in inserts directly at ARRIVED — D5); `verification`
 * defaults FLAGGED (the SAFE default — a visit is never silently VERIFIED). `visitor_name` is a NOT-NULL
 * SNAPSHOT (visitor_phone/relationship nullable snapshots) so the visit is a durable record even after
 * the approved-visitor row is removed (AC B6). NO fee_owing_snapshot — visiting is NOT fee-gated (OQ-F).
 *
 * FK shapes: student_id / house_id are composite (school_id, …) intra-tenant FKs (cross-tenant
 * structurally impossible, CASCADE; house_id is a snapshot of the boarder's House at check time —
 * mirrors boarding_exeat / boarding_arrival). calendar_event_id and approved_visitor_id are BOTH the
 * single-column SET-NULL exemption (the exeat calendar_event_id doctrine): (a) a composite SET NULL
 * would try to null the NOT-NULL school_id (the score-ledger supersedesFk trap), (b) both targets are
 * HARD-deletable and this is a weak informational link, not an authorization boundary — RLS + the
 * tenant-scoped getters already prevent a cross-tenant id reaching the insert. approved_visitor_id NULL
 * = a flagged walk-in not on the list OR a later-removed visitor; the visitor_name snapshot is the
 * durable record either way (AC B6 — remove a visitor → past visits keep the snapshot, id nulled).
 * The six actor/time stamps (rsvp_by / arrived_at+by / departed_at+by / authorised_at+by) mirror the
 * exeat two-stamp; every actor is a single-column SET NULL users FK.
 *
 * tenant UK (school_id, id) — DURABLE + REFERENCED by boarding_visit_notification.visit_id (composite
 * FK) → carried INLINE, MUST exist before that FK. UNIQUE (school_id, student_id, calendar_event_id,
 * approved_visitor_id) is the re-RSVP idempotency target (D6). ⚠ NULL-DISTINCT (Postgres default): a
 * row with a NULL approved_visitor_id is DISTINCT from any other, so multiple FLAGGED walk-ins (NULL
 * approved_visitor_id) for the same student × event COEXIST — while a duplicate at the non-null grain
 * (same student × event × approved visitor) is rejected. This is the intended behaviour, NOT a bug: the
 * constraint idempotency-guards a named-visitor RSVP but never collapses two distinct walk-ins into one.
 * Index (school_id, calendar_event_id, house_id) serves the RSVP-by-House per-event read.
 */
export const boardingVisit = pgTable(
  "boarding_visit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(),
    houseId: uuid("house_id").notNull(), // snapshot of the boarder's House at check time
    // Nullable single-column SET NULL FK — the VISITING event this visit belongs to (exeat exemption).
    calendarEventId: uuid("calendar_event_id").references(() => boardingCalendarEvent.id, {
      onDelete: "set null",
    }),
    // Nullable single-column SET NULL FK — the matched approved visitor. NULL = flagged walk-in / removed
    // visitor; the visitor_name snapshot below is the durable record. → id (PK), NOT the tenant UK.
    approvedVisitorId: uuid("approved_visitor_id").references(() => boardingApprovedVisitor.id, {
      onDelete: "set null",
    }),
    visitorName: text("visitor_name").notNull(), // SNAPSHOT — durable even if the approved row is removed
    visitorPhone: text("visitor_phone"), // PII snapshot, nullable
    relationship: text("relationship"), // snapshot, nullable
    status: visitStatusEnum("status").notNull().default("RSVP"),
    verification: visitVerificationEnum("verification").notNull().default("FLAGGED"), // SAFE default
    zoneKey: text("zone_key"), // lib/boarding/ zone constant key; occupancy DERIVED (Kofi OQ5)
    note: text("note"),
    // --- two-stamp in/out + the flag override, each + actor (global-table SET NULL → single-column FK) ---
    rsvpByUserId: uuid("rsvp_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    arrivedByUserId: uuid("arrived_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    departedAt: timestamp("departed_at", { withTimezone: true }),
    departedByUserId: uuid("departed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    authorisedAt: timestamp("authorised_at", { withTimezone: true }), // set when a FLAGGED visit is HM-overridden
    authorisedByUserId: uuid("authorised_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for boarding_visit_notification (school_id, id). MUST exist before that FK.
    tenantUk: unique("boarding_visit_tenant_uk").on(t.schoolId, t.id),
    // Re-RSVP idempotency (D6). NULL-DISTINCT: flagged walk-ins (NULL approved_visitor_id) COEXIST; a
    // duplicate at the non-null (student × event × visitor) grain is rejected. See table doc.
    uniqRsvp: unique("uniq_boarding_visit_rsvp").on(
      t.schoolId,
      t.studentId,
      t.calendarEventId,
      t.approvedVisitorId,
    ),
    // RSVP-by-House per-event read (respecting formScope in lib/).
    byEventHouse: index("boarding_visit_event_house_idx").on(
      t.schoolId,
      t.calendarEventId,
      t.houseId,
    ),
    // Composite intra-tenant FKs — a cross-tenant student/House reference is structurally impossible.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    houseFk: foreignKey({
      columns: [t.schoolId, t.houseId],
      foreignColumns: [houses.schoolId, houses.id],
    }).onDelete("cascade"),
  }),
);

/**
 * LEAF dual-scoped visiting-day SMS log (Kofi OQ7) — mirrors exeat_notification (delivery metadata +
 * idempotency the audit trail doesn't carry). One row per send attempt. DUAL-SCOPED: cohort/event sends
 * (INVITATION / REMINDER_T3 / REMINDER_T1) carry a calendar_event_id and a NULL visit_id (no visit row
 * exists pre-arrival); per-visit sends (ARRIVAL_CONFIRM / OVERSTAY) carry a visit_id. Idempotency for a
 * given (scope × kind) is NOT EXISTS(scope, kind) before each send; overstay is on-read (no cron), grace
 * 15 min. `provider` = console | hubtel (console-only until Hubtel go-live). PII discipline: only the
 * delivery `to_phone` lives here — never the visitor name/ID hint (AC J4).
 *
 * FK shapes: (school_id, visit_id) is a composite intra-tenant FK → boarding_visit's tenant UK, CASCADE
 * with the visit. It is MATCH SIMPLE (Drizzle's default — no MATCH clause emitted): a cohort row's NULL
 * visit_id SKIPS the composite FK entirely (the inspections tweak-#3 pattern), so an event-scoped send
 * with visit_id NULL is allowed while school_id is still NOT NULL. calendar_event_id is the single-column
 * SET-NULL exemption (exeat pattern). LEAF table (nothing references it) → FORCE RLS but NO tenant UK
 * (mirror exeat_notification). Two indexes: (school_id, visit_id) for per-visit sends + the ARRIVAL/
 * OVERSTAY idempotency check; (school_id, calendar_event_id) for cohort sends + the INVITATION/REMINDER
 * idempotency check.
 */
export const boardingVisitNotification = pgTable(
  "boarding_visit_notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id"), // nullable — NULL for cohort/event-scoped sends (MATCH SIMPLE skips the FK)
    // Nullable single-column SET NULL FK — the VISITING event for cohort sends (exeat exemption).
    calendarEventId: uuid("calendar_event_id").references(() => boardingCalendarEvent.id, {
      onDelete: "set null",
    }),
    kind: visitNotificationKindEnum("kind").notNull(),
    toPhone: text("to_phone").notNull(), // E.164 — the ONLY PII in this log (delivery target)
    body: text("body").notNull(),
    provider: text("provider").notNull(), // console | hubtel
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    ok: boolean("ok").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    // Global-table SET NULL → single column (null for system-fired cohort sends).
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    // Per-visit send read + the ARRIVAL_CONFIRM/OVERSTAY idempotency existence check.
    byVisit: index("boarding_visit_notification_visit_idx").on(t.schoolId, t.visitId),
    // Cohort send read + the INVITATION/REMINDER_T3/T1 idempotency existence check.
    byEvent: index("boarding_visit_notification_event_idx").on(t.schoolId, t.calendarEventId),
    // Composite intra-tenant FK — MATCH SIMPLE (Drizzle default): a cohort row's NULL visit_id skips
    // this FK, so an event-scoped send is allowed with visit_id NULL. CASCADE with the visit.
    visitFk: foreignKey({
      columns: [t.schoolId, t.visitId],
      foreignColumns: [boardingVisit.schoolId, boardingVisit.id],
    }).onDelete("cascade"),
  }),
);
