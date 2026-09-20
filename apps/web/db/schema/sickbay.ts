import {
  pgTable,
  uuid,
  text,
  date,
  smallint,
  numeric,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
  uniqueIndex,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./tenancy";
import { users } from "./identity";
import { students, houses, studentGuardians } from "./students";
import { invoiceLineItems } from "./fees";
import { notificationLog } from "./comms";
import {
  sickbayModeEnum,
  sickbaySlotKindEnum,
  sickbayDispositionEnum,
  sickbayConsultModeEnum,
  chronicConditionEnum,
  chronicStatusEnum,
  sickbayGrantScopeEnum,
  sickbayMedSourceEnum,
  sickbayMedStatusEnum,
  sickbayStockMovementTypeEnum,
  sickbayReferralStatusEnum,
  nhisHolderKindEnum,
  sickbayNotifyChannelEnum,
  sickbayNotifyDirectionEnum,
  sickbayNotifyRecipientEnum,
  sickbaySurveillanceCategoryEnum,
} from "./_enums";

/**
 * Sickbay F0 spine (SHS module 4.4 / INCR-21, migration 0056) — the config the whole module reads:
 * declared clinical MODE, the bed inventory, and the rounds/hours schedule. Nothing clinical lands
 * here: no visit, no patient, no vitals, no medication, no diagnosis (those are 0057+). The only new
 * "clinical" datum in 0056 is the matron's N&MC licence number on staff_profile — a PUBLIC statutory
 * register credential, not medical PII.
 *
 * All three tables are tenant-scoped and get ENABLE + FORCE RLS + tenant_isolation (db:policies on
 * dev; db/sql/prod-paste-0056-sickbay-spine.sql by hand on prod) and — via the catalog-driven loop in
 * db/sql/policies.sql — parent_deny. Owner decision D8: a parent never sees sickbay in module 4.4.
 *
 * Deliberate omissions, each ratified as a BUILD_STACK amendment (Kofi R2/R10/R17/R23/R26):
 *   • NO `sickbay_id` on any child — it would be a derived duplicate of school_id plus a second
 *     composite FK on every table (no boarding table carries a boarding_settings_id either).
 *   • NO `capacity_beds`/`isolation_beds` scalars — counts DERIVE from the bed rows; a stored count
 *     that can disagree with its rows is the STPSHS-matrix failure in miniature.
 *   • NO `operating_hours_json`/`visiting_doctor_schedule_json` — the slot rows already hold those
 *     facts relationally; two mechanisms for one fact is how three contradictory round schedules got
 *     into the surfaces in the first place.
 *   • NO `school_health_prefect_student_ids JSONB` — the roster is a DERIVED read of
 *     boarding_bunk.prefect_role = 'SICKBAY'. A JSONB id array is un-FK-able, so it could not carry
 *     the composite (school_id, id) tenant FK: a foreign school's student id could be written in with
 *     nothing to stop it. A tenant-isolation hole for a display list.
 *   • NO `notes_json` — the policy anchors are identical static editorial for every school and live
 *     as frozen constants in lib/; a per-school free-text column invites per-tenant drift in a
 *     regulatory citation.
 *
 * Validation that spans tables stays in lib/ server actions, never a DB trigger (portability): both
 * matron pointers must hold the MATRON role in this school (R20), the anchor must start no later than
 * every other medication round (R16), and a capacity decrease reconciles to a target by deactivating
 * the highest-numbered UNOCCUPIED beds — rejecting the whole save if that is unreachable (R11).
 */

/**
 * Per-school sickbay config — ONE row per school (R2), the boarding_settings / attendance_settings
 * singleton idiom: single-column `school_id UNIQUE` FK, leaf, no composite tenant UK. The UNIQUE is
 * the upsert conflict target for the setup editor.
 *
 * A MISSING row is legal and meaningful: readers coalesce it to mode REFERRAL_ONLY + configured:false
 * (R25) — never null, never a fabricated capacity. `configured_at` is what distinguishes "declared
 * REFERRAL_ONLY" from "never configured"; it is NOT a freeze (R6 — a sickbay is live operational
 * config, so there is deliberately no frozen_at and mode changes stay lossless and reversible).
 *
 * Both matron pointers are single-column SET NULL FKs to the global ref_user (the houses.hm_user_id
 * idiom — global-table + SET NULL both keep it single-column). Senior vs Assistant Matron is the SAME
 * MATRON role distinguished only by WHICH pointer holds them (R20): no seniority column, no
 * sickbay_staff table, no new role. The visiting doctor is NOT a system user (R21) — name +
 * affiliation text and a DOCTOR_VISIT slot, no ref_user, no role assignment, no invite.
 */
export const sickbaySettings = pgTable("sickbay_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .unique()
    .references(() => schools.id, { onDelete: "cascade" }),
  mode: sickbayModeEnum("mode").notNull().default("REFERRAL_ONLY"),
  matronUserId: uuid("matron_user_id").references(() => users.id, { onDelete: "set null" }),
  assistantMatronUserId: uuid("assistant_matron_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  visitingDoctorName: text("visiting_doctor_name"),
  visitingDoctorAffiliation: text("visiting_doctor_affiliation"),
  // NULL = never configured (readers render the honest empty state); set = the school declared its
  // mode. Not a freeze — every field above stays editable afterwards.
  configuredAt: timestamp("configured_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A sickbay bed — bed-as-a-row, its own table, deliberately NOT boarding_bunk (R7): a bunk is
 * dormitory/House-scoped and a sickbay bed has no House; students.current_bunk_id is one-per-student
 * but an admitted patient occupies her dorm bunk AND a sickbay bed at once, so reuse would vacate her
 * dorm bunk and silently corrupt the boarding in-House count.
 *
 * `bed_number` is STABLE FOR LIFE (R8): retiring bed 4 never renumbers 5→4, because a visit record
 * saying "bed 3" must still mean that bed; the next bed is max+1, never a reused gap. Retirement is
 * `active = false`, never a DELETE. `is_isolation` splits the inventory into two pools that NEVER
 * merge (R9) — a full general pool does not overflow into isolation. Bed COUNTS (total, isolation,
 * occupied) are derived from these rows, never stored (R10).
 */
export const sickbayBed = pgTable(
  "sickbay_bed",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    bedNumber: smallint("bed_number").notNull(),
    isIsolation: boolean("is_isolation").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One row per bed number per school — the natural key and the upsert conflict target. Its
    // school_id prefix also serves the "all beds for this school" read, so no separate index.
    uniqNumber: unique("uniq_sickbay_bed_number").on(t.schoolId, t.bedNumber),
    // Composite-FK target for sickbay_admission.bed_id (school_id, id) in 0057. Authored NOW, in
    // 0056, even though nothing references it yet (AC B6): adding the UNIQUE in the same migration
    // as the FK that needs it is exactly the 0033 FK-before-UNIQUE ordering hazard.
    tenantUk: unique("sickbay_bed_tenant_uk").on(t.schoolId, t.id),
  }),
);

/**
 * One row per recurring sickbay time slot — medication rounds, clinic hours, the visiting doctor's
 * session, overnight on-call. This table IS the config spine (R13): the setup surface's 7 rows are
 * canonical and the other surfaces' contradictory times are demo drift. Descriptions are STORED —
 * when the matron is on leave the description is the handoff document.
 *
 * `starts_at`/`ends_at` are "HH:MM" text (the boarding_settings time idiom), and `ends_at` MAY be
 * EARLIER than `starts_at`: the ON_CALL window is 22:00→06:00 and wraps midnight (AC C8). There is
 * deliberately NO CHECK ordering them — such a CHECK would reject the one slot the module most needs.
 *
 * `days_of_week` is a jsonb array of ISO weekday numbers (1 = Monday … 7 = Sunday) plus
 * `runs_on_holidays` (R14). Reusing boardingDayTypeEnum was REJECTED: it answers "what rhythm is
 * today", not "which days does this slot run", and literally cannot express `Thursdays` (AC C7) or
 * `Every day · 365` — forcing it would silently drop the visiting doctor's weekday. One pure
 * formatter reproduces every surface label from the set; the label is NEVER stored beside it.
 *
 * `staffing` is FREE TEXT, not an FK (e.g. "Matron + Sick Bay Prefect", "06:30 round assist"):
 * modelling prefect→slot assignment is INCR-24's problem, not the config spine's.
 *
 * `is_anchor` (R16): EXACTLY ONE anchored slot per school, enforced by the partial unique index below
 * (the uniq_mock_exam_predictor idiom). App rules on top: kind must be MEDICATION_ROUND; the anchor's
 * TIME is editable (05:45 is still anchored) but it cannot be deleted, deactivated, re-kinded or
 * un-anchored, no other slot can be promoted, and it must start no later than every other medication
 * round — otherwise "morning round" sorts after the evening one and INCR-24's ordering is nonsense.
 * Modes FULL/FIRST_AID have an anchor; REFERRAL_ONLY has none (it has no rounds at all).
 */
export const sickbayScheduleSlot = pgTable(
  "sickbay_schedule_slot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    kind: sickbaySlotKindEnum("kind").notNull(),
    label: text("label").notNull(), // "Morning medication round"
    description: text("description"), // STORED — the handoff document when the matron is away
    startsAt: text("starts_at").notNull(), // "HH:MM"
    endsAt: text("ends_at").notNull(), // "HH:MM" — MAY be < starts_at (22:00→06:00 wraps midnight)
    staffing: text("staffing"), // free text, deliberately NOT an FK
    // ISO 1..7 int array, e.g. [1,2,3,4,5]. `$type` is TYPING ONLY — no DDL, no migration — and it
    // deletes the reader's one `as number[]` assertion.
    daysOfWeek: jsonb("days_of_week").$type<number[]>().notNull(),
    runsOnHolidays: boolean("runs_on_holidays").notNull().default(false),
    isAnchor: boolean("is_anchor").notNull().default(false),
    active: boolean("active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // EXACTLY ONE anchor per school (AC C3) — partial unique index; the many non-anchor rows are
    // exempt via the WHERE. Emitted alongside the other indexes, after the table.
    oneAnchor: uniqueIndex("uniq_sickbay_anchor_slot").on(t.schoolId).where(sql`${t.isAnchor}`),
    // Composite-FK target for the 0059 medication-round tables (school_id, id). Its school_id prefix
    // also serves the "all slots for this school" read, so no separate index.
    tenantUk: unique("sickbay_schedule_slot_tenant_uk").on(t.schoolId, t.id),
  }),
);

/* ============================================================================
 * Sickbay VISIT (SHS module 4.4 / INCR-22a, migration 0057) — the module's TRUNK and its first real
 * CLINICAL data: presenting complaints, working impressions, vitals, dispositions, admissions. 0056
 * held config only; from here on these tables carry the most sensitive rows in the product.
 *
 * FOUR tenant tables, TWO enums, ZERO altered columns (AC S1). All four get ENABLE + FORCE RLS +
 * tenant_isolation (db:policies on dev; db/sql/prod-paste-0057-sickbay-visit.sql by hand on prod) and
 * — via the catalog-driven loop in db/sql/policies.sql — parent_deny. Owner decision D8: a parent
 * never sees sickbay in module 4.4.
 *
 * ⚠ DDL ORDERING (AC S2 — the 0033 hazard INSIDE one migration file). `sickbay_visit_tenant_uk` is
 * the composite-FK target of THREE tables created in this SAME migration. drizzle-kit runs the whole
 * batch in ONE transaction and SWALLOWS the error, so a UNIQUE emitted after its FKs fails silently
 * with a rollback and exit 1. The generated 0057 SQL was read by eye and replayed from EMPTY into a
 * throwaway database, verified by CATALOG INSPECTION rather than exit code. (`sickbay_bed_tenant_uk`
 * was authored a migration AHEAD, in 0056, for exactly this reason.)
 *
 * Deliberate omissions — R64's four further BUILD_STACK amendments (continuing INCR-21's six):
 *   • NO `vitals_json` → sickbay_vital_reading ROWS: a JSON blob cannot carry per-reading
 *     `taken_by_user_id`, cannot be time-indexed, and cannot be append-only.
 *   • NO `discharged_at` on the visit — superseded by `disposition_at` plus the admission's own
 *     `discharged_at`. Two end-stamps for one fact can disagree.
 *   • NO `tier_fired` / `parent_notified_at` — a notification column with no chain to fire it is a
 *     stub; the Tier-2 chain is authored at 0060 and built at INCR-26.
 *   • NO generated `visit_ref` — it encodes three facts already on the row, in a format the surfaces
 *     contradict four ways. A pure formatter if a printed header ever needs one.
 * And, from the enum file: NO status column (R32), NO `unit` column on a reading (R44), NO
 * triage/urgency column (R62), NO `diagnos*` anything anywhere (R43).
 *
 * NO TRIGGERS (portability). Every rule that spans rows lives in lib/sickbay/: the disposition
 * preconditions (R34), the ADMIT + admission single transaction (R35), void-only-while-open (R37),
 * `admission.is_isolation` MUST equal `bed.is_isolation` (R57), the Mode-C server-side ADMIT refusal
 * (R55), the vitals plausibility bounds (R45 — zod typo guards, NOT DB CHECKs: a CHECK on a
 * physiological range rejects the genuine extreme reading the record most needs), and the
 * attendance-M hook, which is BEST-EFFORT and deliberately OUTSIDE the clinical transaction (R54).
 * ==========================================================================*/

/**
 * One sickbay visit — presentation → assessment → disposition. The PARENT of the module's clinical
 * graph and the medico-legal record itself.
 *
 * R32 — there is NO status column. State is DERIVED by a pure `visitState()` from four timestamps
 * plus the admission's `discharged_at`: `started_at` NULL ⇒ QUEUED, set ⇒ IN_PROGRESS;
 * `disposition` NULL ⇒ still open, set ⇒ closed at `disposition_at`; `voided_at` set ⇒ void. A
 * stored enum can disagree with its own timestamps, which is the R10 stored-count failure again.
 *
 * R43 — `working_impression` is NOT a diagnosis, and the string `diagnos` appears in no column,
 * enum, type, zod key, label or route this migration ships (grep-testable). It is required by the
 * app for ADMIT and REFER only (R34): forcing prose onto a 40-second dressing change produces
 * garbage, not a record. `red_flags_screened` stays free text — structuring it into a checkable
 * screen is an EMR feature. `escalation_triggers` is INERT: stored, rendered, never evaluated (any
 * mechanism that ACTS on a stored clinical value is surveillance → INCR-27).
 *
 * R38 — `intake_reported_by` is TEXT, never an identity pointer. The Sick Bay Prefect who walks a
 * student over is a recorded external actor; an FK to that prefect's student row would place ONE
 * student's identity as an ACTOR inside ANOTHER student's clinical record. (Same reasoning puts the
 * doctor's name on sickbay_doctor_consult as text — R21/R60.)
 *
 * R37 — nothing is ever hard-deleted, and a visit is VOIDABLE ONLY WHILE OPEN (enforced in lib/,
 * `disposition IS NULL`): an open visit on the wrong student is an active attendance-coercion source,
 * so it must be retractable, while a closed one is the record. Because void is legal only while open,
 * and only ADMIT/REFER write attendance, voiding can never touch an attendance row BY CONSTRUCTION.
 *
 * FK shapes: `student_id` is a composite (school_id, student_id) intra-tenant FK → students' tenant
 * UK, CASCADE — a cross-tenant student reference is structurally impossible. The three actor
 * pointers are single-column SET NULL FKs → the GLOBAL ref_user (the houses.hm_user_id idiom; global
 * target and SET NULL each independently keep an FK single-column). ⚠ ref_user being global means the
 * DB cannot check that an attending clinician belongs to THIS school — `holdsMatronRole` in lib/ is
 * the only tenancy guard on `attending_user_id` (Sarah's INCR-21 advisory 2, which lands here).
 */
export const sickbayVisit = pgTable(
  "sickbay_visit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(), // composite (school_id, student_id) FK below
    presentedAt: timestamp("presented_at", { withTimezone: true }).notNull(),
    presentingComplaint: text("presenting_complaint").notNull(),
    // R38: the external actor who brought/reported the student (e.g. "Sick Bay Prefect", a
    // housemaster's name). TEXT — deliberately NOT an FK to a student or a user.
    intakeReportedBy: text("intake_reported_by"),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // NULL ⇒ QUEUED (R33: the wait clock stops at "Begin visit", not at assessment).
    startedAt: timestamp("started_at", { withTimezone: true }),
    attendingUserId: uuid("attending_user_id").references(() => users.id, { onDelete: "set null" }),
    // ---- assessment: FOLDED INTO THE VISIT ROW as columns (Kofi ⟂ Lucy divergence 3, Kofi rules).
    // Lucy mapped a separate sickbay_assessment table; one assessment per visit, written once by one
    // actor, is a 1:1 child that buys a join and an orphan state and nothing else.
    workingImpression: text("working_impression"), // R43 — NOT a diagnosis. Free text.
    redFlagsScreened: text("red_flags_screened"), // free text; structuring it is an EMR feature
    hydrationStatus: text("hydration_status"),
    plan: text("plan"),
    escalationTriggers: text("escalation_triggers"), // INERT — stored, never evaluated
    // R215 (INCR-27) — the coarse GHS/IDSR syndromic-surveillance bucket, MATRON-set at assessment.
    // NULLABLE: pre-0063 rows read NULL = "Uncategorised", and requiredness is APP-LAYER only (F-27A),
    // never a DB NOT NULL/CHECK. NOT a diagnosis (R43 — `diagnos` grep-clean); it AGGREGATES (the
    // outbreak monitor + 30-day mix derive from it at read), it does not diagnose. No referral/cost
    // column mirrors it (R218 — the mix derives the category via the referral→visit join).
    surveillanceCategory: sickbaySurveillanceCategoryEnum("surveillance_category"),
    assessedAt: timestamp("assessed_at", { withTimezone: true }),
    // ---- disposition. NULL ⇒ the visit is OPEN. IMMUTABLE once set (R36).
    disposition: sickbayDispositionEnum("disposition"),
    dispositionAt: timestamp("disposition_at", { withTimezone: true }),
    // ---- void (R37) — legal ONLY while disposition IS NULL. No hard delete anywhere in 4.4.
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByUserId: uuid("voided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    voidReason: text("void_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for sickbay_vital_reading, sickbay_admission AND sickbay_doctor_consult —
    // THREE tables in THIS SAME migration (AC S2). Carried INLINE in CREATE TABLE so it exists before
    // every ALTER TABLE ... ADD FOREIGN KEY that follows.
    tenantUk: unique("sickbay_visit_tenant_uk").on(t.schoolId, t.id),
    // R58 — ONE OPEN VISIT PER STUDENT, by PARTIAL UNIQUE INDEX rather than an app check: an app
    // check loses the concurrent double-open race (two matron tablets, one student). Closed and
    // voided visits are exempt via the WHERE, so a student may have any number of past visits.
    oneOpenPerStudent: uniqueIndex("uniq_sickbay_open_visit_student")
      .on(t.schoolId, t.studentId)
      .where(sql`${t.disposition} IS NULL AND ${t.voidedAt} IS NULL`),
    // The queue and the "recent visits · 24h" read are both windows on presented_at within a school.
    byPresented: index("sickbay_visit_presented_idx").on(t.schoolId, t.presentedAt),
    // Composite intra-tenant FK — a cross-tenant student reference is structurally impossible.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  }),
);

/**
 * One row per set of observations taken at one moment (R44/R45) — the vitals TIMELINE.
 *
 * APPEND-ONLY, and the schema says so: there is NO `updated_at`, no void column and no soft-delete.
 * A mistaken reading is corrected by taking another one; you cannot un-observe an observation. (Same
 * posture as the doctor consult below and the shipped boarding_infractions ledger.)
 *
 * NO `unit` COLUMN (R44). Units are FIXED — °C, mmHg, bpm, %, 0–10 — and a unit column is a SECOND
 * FACT that can disagree with the number beside it; the day one row says `temp 101 / unit: F` is the
 * day the trend arithmetic silently lies. `temp_c numeric(3,1)` holds 25.0–45.0 exactly (float would
 * make 37.15 unreproducible); the rest are smallint, which is the honest width for a pulse.
 *
 * ALL SIX measures are NULLABLE — a matron who took only a temperature must be able to record only a
 * temperature — with "at least one non-null" enforced in zod, not as a CHECK. The plausibility
 * bounds (temp 25–45, sys 50–260, dia 30–160, pulse 20–250, SpO₂ 50–100, pain 0–10) are TYPO GUARDS
 * and live in zod TOO: a DB CHECK on a physiological range rejects the genuine extreme reading the
 * record most needs, and does it inside the transaction that was trying to document an emergency.
 *
 * ZERO derived alerting at INCR-22: cell colours and pills are presentation from a pure DB-free
 * helper and trend deltas are arithmetic. Anything that ACTS on a value is surveillance → INCR-27.
 *
 * LEAF (nothing references a reading) → FORCE RLS but NO tenant UK, mirroring exeat_notification.
 */
export const sickbayVitalReading = pgTable(
  "sickbay_vital_reading",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").notNull(), // composite (school_id, visit_id) FK below
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    // Per-reading attribution — the single fact a vitals_json blob could never carry (R64/7).
    takenByUserId: uuid("taken_by_user_id").references(() => users.id, { onDelete: "set null" }),
    context: text("context"), // free text: "on arrival", "post-paracetamol", "21:00 round"
    tempC: numeric("temp_c", { precision: 3, scale: 1 }), // °C — fixed unit, no unit column
    systolic: smallint("systolic"), // mmHg
    diastolic: smallint("diastolic"), // mmHg
    pulseBpm: smallint("pulse_bpm"), // bpm
    spo2Pct: smallint("spo2_pct"), // %
    painScore: smallint("pain_score"), // 0–10
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // NO updated_at — append-only (R44). Its absence is the constraint.
  },
  (t) => ({
    // The one read this table has: a visit's readings in time order, for the timeline and the deltas.
    byVisit: index("sickbay_vital_reading_visit_idx").on(t.schoolId, t.visitId, t.takenAt),
    // Composite intra-tenant FK → sickbay_visit_tenant_uk. CASCADE with the visit.
    visitFk: foreignKey({
      columns: [t.schoolId, t.visitId],
      foreignColumns: [sickbayVisit.schoolId, sickbayVisit.id],
    }).onDelete("cascade"),
  }),
);

/**
 * An ADMIT disposition's inpatient stay — student in a bed, from `admitted_at` to `discharged_at`.
 * Written in ONE transaction with the visit's ADMIT disposition (R35).
 *
 * `student_id` is DENORMALISED here — it is already reachable via the visit — SOLELY to carry the
 * partial UNIQUE(school_id, student_id) WHERE discharged_at IS NULL below. A cross-table exclusivity
 * rule has no home in Postgres without a trigger, and business logic never goes in a trigger; a
 * denormalised column that exists to be a UNIQUE key is the cheap, portable, race-proof alternative.
 *
 * R58 — THREE exclusivity invariants, all PARTIAL UNIQUE INDEXES, none an app check (an app check
 * loses the concurrent double-admit race): one open admission per BED, one per STUDENT, and one
 * admission per VISIT (that last one total, not partial — a visit is admitted at most once ever).
 *
 * R57 — `is_isolation` MUST EQUAL the bed's `is_isolation`, checked in lib/: isolation is a property
 * of the CASE, so there is no judgment call and no overflow in either direction (R9's two pools that
 * never merge). It is stored here as the snapshot the stay is reasoned about with.
 *
 * R63 — `discharge_criteria` is FREE TEXT, plus `expected_discharge_at` and an app-REQUIRED
 * `overnight_plan` (the "no silent overnight stays" rule, preserved at 22). The surfaces' structured
 * 4-row checklist and `3 of 4 met` counter are OMITTED, not faked: a criterion instance needs
 * per-condition templates, which arrive with the chronic register at INCR-23.
 *
 * `bed_id` is a composite (school_id, bed_id) FK → `sickbay_bed_tenant_uk`, RESTRICT — the FK this
 * whole ordering discipline was for, and the reason that UNIQUE was authored a migration early in
 * 0056. RESTRICT because a bed with a stay against it is not deletable; R8 means a bed is retired
 * with `active = false` and never DELETEd anyway, so RESTRICT is a backstop, not a workflow (the
 * shipped invoice_discount_application.discountFk precedent).
 */
export const sickbayAdmission = pgTable(
  "sickbay_admission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").notNull(),
    // Denormalised from the visit SOLELY to carry the per-student partial UNIQUE below.
    studentId: uuid("student_id").notNull(),
    bedId: uuid("bed_id").notNull(),
    admittedAt: timestamp("admitted_at", { withTimezone: true }).notNull(),
    admittedByUserId: uuid("admitted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // R57 — must equal the bed's is_isolation; enforced in lib/, stored as the stay's snapshot.
    isIsolation: boolean("is_isolation").notNull().default(false),
    expectedDischargeAt: timestamp("expected_discharge_at", { withTimezone: true }),
    dischargeCriteria: text("discharge_criteria"), // R63 — FREE TEXT; no structured checklist at 22
    overnightPlan: text("overnight_plan"), // app-required — the "no silent overnight stays" rule
    // NULL ⇒ the stay is OPEN: this column is the predicate of two of the three invariants below,
    // and of medicalHoldStudentIds() (22b's attendance PULL arm).
    dischargedAt: timestamp("discharged_at", { withTimezone: true }),
    dischargedByUserId: uuid("discharged_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    dischargeNote: text("discharge_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Authored NOW (the 0056 B6 precedent): INCR-25/27 reference an admission, and adding the UNIQUE
    // in the same migration as the FK that needs it is exactly the 0033 ordering hazard. INLINE.
    tenantUk: unique("sickbay_admission_tenant_uk").on(t.schoolId, t.id),
    // One admission per visit — TOTAL, not partial: a visit is admitted at most once, ever. (An
    // ADMIT that later needs a hospital is INCR-25's referral EVENT, never a second admission here.)
    uniqVisit: unique("uniq_sickbay_admission_visit").on(t.schoolId, t.visitId),
    // R58 — one OPEN admission per bed. Discharged stays are exempt via the WHERE, so bed 3 can be
    // reused forever; two live patients in bed 3 is rejected by the DB, not by a lost race in lib/.
    oneOpenPerBed: uniqueIndex("uniq_sickbay_open_admission_bed")
      .on(t.schoolId, t.bedId)
      .where(sql`${t.dischargedAt} IS NULL`),
    // R58 — one OPEN admission per student. This is what `student_id` is denormalised here FOR.
    oneOpenPerStudent: uniqueIndex("uniq_sickbay_open_admission_student")
      .on(t.schoolId, t.studentId)
      .where(sql`${t.dischargedAt} IS NULL`),
    // INCR-24 obligation (e) / R167e — the index for medicalHoldStudentIds()'s rewrite. The shipped
    // medical-hold query filters by student over an admitted_at window on EVERY register save at every
    // Senior school; its `::date` casts were non-sargable, so Claude Code rewrites them to half-open
    // timestamp ranges (the app-layer half of e). This index is the DDL half and belongs in this
    // migration: (school_id, student_id, admitted_at) makes that half-open range scan an index range.
    byStudentAdmitted: index("sickbay_admission_student_admitted_idx").on(
      t.schoolId,
      t.studentId,
      t.admittedAt,
    ),
    // Composite intra-tenant FKs. The visit CASCADEs; the student CASCADEs; the BED restricts.
    visitFk: foreignKey({
      columns: [t.schoolId, t.visitId],
      foreignColumns: [sickbayVisit.schoolId, sickbayVisit.id],
    }).onDelete("cascade"),
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    bedFk: foreignKey({
      columns: [t.schoolId, t.bedId],
      foreignColumns: [sickbayBed.schoolId, sickbayBed.id],
    }).onDelete("restrict"),
  }),
);

/**
 * A consultation with the visiting/on-call doctor about this visit (R60) — a SEPARATE artefact from
 * the matron's own assessment, because it is a different person's clinical opinion.
 *
 * `clinician_name` is COPIED ONTO THE ROW, not read from sickbay_settings.visiting_doctor_name: the
 * locum or ER registrar who actually took the 21:40 call is not the settings value, and next term's
 * settings edit must not retro-attribute an old consult to a doctor who never gave it.
 *
 * It is HEARSAY WITH ATTRIBUTION — render it as "recorded by {matron}" — and it CANNOT be a co-sign
 * or a gate: an unauthenticated external actor is not an authorisation subject. Hence no ref_user for
 * the clinician and no approval column here at all. (Forward: INCR-24's `Doctor-ordered` MAR tag
 * records PROVENANCE, never PERMISSION — same rule, same reason.)
 *
 * APPEND-ONLY like the vitals: no `updated_at`, no delete. A correction is a SECOND row. LEAF →
 * FORCE RLS, no tenant UK.
 */
export const sickbayDoctorConsult = pgTable(
  "sickbay_doctor_consult",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    mode: sickbayConsultModeEnum("mode").notNull(),
    // Copied onto the row — the doctor who ACTUALLY said it, not today's settings value. TEXT, never
    // a ref_user: the visiting doctor is not a system user (R21) and cannot be an authorisation
    // subject (R60).
    clinicianName: text("clinician_name").notNull(),
    clinicianAffiliation: text("clinician_affiliation"),
    note: text("note").notNull(),
    // Who WROTE IT DOWN — the attribution half of "hearsay with attribution".
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // NO updated_at — append-only; a correction is a second row.
  },
  (t) => ({
    // A visit's consults in time order — the only read this table has.
    byVisit: index("sickbay_doctor_consult_visit_idx").on(t.schoolId, t.visitId, t.occurredAt),
    // INCR-24 (R143) — this leaf becomes a composite-FK TARGET: sickbay_med_admin.consult_id is
    // (school_id, consult_id) RESTRICT for a DOCTOR_ORDERED administration (provenance, never a gate —
    // R60). Adding the UNIQUE in the SAME migration as the FK that needs it is the 0056/0057 "author the
    // UK before the FK" move (and the 0033 ordering hazard, guarded because the ALTER ADD UNIQUE is
    // emitted ahead of the ADD FOREIGN KEY that consumes it). This ADD-UNIQUE on an existing table stays
    // append-only-safe: it constrains nothing new (id is already the PK, so (school_id, id) is trivially
    // unique) and rejects no existing row.
    tenantUk: unique("sickbay_doctor_consult_tenant_uk").on(t.schoolId, t.id),
    // Composite intra-tenant FK → sickbay_visit_tenant_uk. CASCADE with the visit.
    visitFk: foreignKey({
      columns: [t.schoolId, t.visitId],
      foreignColumns: [sickbayVisit.schoolId, sickbayVisit.id],
    }).onDelete("cascade"),
  }),
);

/* ============================================================================
 * Sickbay CHRONIC REGISTER (SHS module 4.4 / INCR-23a, migration 0058) — the module's LONGITUDINAL
 * record and the product's THIRD RLS BOUNDARY. 0056 held config, 0057 holds the acute episode; these
 * four tables hold the standing care plan for a named child, plus the machinery that decides WHO may
 * read it.
 *
 * FOUR tenant tables, THREE enums, ZERO altered columns. All four get ENABLE + FORCE RLS +
 * tenant_isolation + the catalog-driven parent_deny (owner decision D8) exactly as 0056/0057 — AND,
 * uniquely in this repo, a THIRD restrictive family `staff_grant_scope` keyed on a new
 * `app.current_staff_user` GUC (db/sql/policies.sql; db/sql/prod-paste-0058-sickbay-chronic.sql by
 * hand on prod). The seam is `withStaffScope(schoolId, userId, fn)` in lib/db/rls.ts, wrapping READS
 * AND WRITES.
 *
 * 🔴 THE POLARITY IS INVERTED FROM THE PARENT FAMILY, DELIBERATELY (R112). Every 19a policy reads
 * `pu IS NULL OR <rule>` — permit-by-default — which is safe there because those tables' default
 * audience IS all staff. The chronic tables have NO default audience, so `staff_grant_scope` reads
 * `su IS NOT NULL AND <rule>` — DENY-by-default. A forgotten seam therefore yields an EMPTY PAGE
 * instead of the whole register. This is not theoretical: PR #176 was a live PII leak in which a
 * claimed parent read children's health records precisely because a permit-by-default clause met an
 * unset GUC. Do not "fix" the asymmetry.
 *
 * ⚠ DDL ORDERING (the 0033 hazard INSIDE one migration, as 0057). `sickbay_chronic_entry_tenant_uk`
 * is the composite-FK target of THREE tables created in this SAME migration; it is carried INLINE in
 * CREATE TABLE so it exists before every ALTER TABLE ... ADD FOREIGN KEY that follows.
 *
 * Deliberate omissions (continuing the R64/E2 amendment series — Lucy mapped seven tables, Kofi
 * ruled four, and every collapse is recorded):
 *   • NO protocol-STEP table (R97) — `emergency_protocol` is ONE text column in the matron's own
 *     words. The terracotta frame survives; the five numbered cards become her paragraphs. Do NOT
 *     write a prose parser to reconstruct the numbering.
 *   • NO version table and NO superseded rows (R103) — `version` is a COUNTER and the history is the
 *     shipped audit_log. ⚠ That makes audit_log a clinical record store (owner decision D5.1).
 *   • NO trigger/bullet table — triggers and the "sickbay monitoring" watch-list are the same
 *     artefact under two names, and both are `triggers` free text (R98).
 *   • NO external-VISIT log table and no `Open VLC case` link (R127) — VLC is unbuilt; the DMHU
 *     facts survive as the four external-care columns below, and `VLC Case 2024-VLC-0047` is a
 *     matron-typed string inside `external_pastoral_home`, never a join to a module that does not
 *     exist.
 *   • NO `nhis_card_number` (R127/D3) — the card in the referral log is the MOTHER's; storing it
 *     here would pre-commit the wrong shape. INCR-25 rules it.
 *   • NO `daily_med_schedule_json` (BUILD_STACK's shape) — a blob cannot carry the (school_id,
 *     slot_id) composite FK and cannot be queried by round. The `vitals_json` mistake again.
 *   • NO stored grant label, NO stored audit sentence, NO `dorm_side_artefact_pdf_file_id` (no file
 *     store exists; the dorm card is DERIVED), NO `next_review_at` (cadence is policy, not config).
 *
 * NO TRIGGERS (portability). Everything that spans rows lives in lib/sickbay/: `on_site_treatable =
 * false ⇒ zero med rows` (R102), the R100 `resetScheduleSlots` reconcile (a hard DELETE of slot ids
 * would now HARD-FAIL against `sickbay_chronic_med.slot_id`'s RESTRICT — which is exactly why R100
 * moves forward from INCR-24 to 23a), grant/revoke being MATRON-only (R111), and the read-audit
 * insert (R121). The one rule that IS in the DB is R96's single-row CHECK — product policy, not
 * per-school judgement, and a single-row CHECK is not the cross-table trigger J3 forbids.
 * ==========================================================================*/

/**
 * ONE ROW PER (student × condition) — the care plan itself (R91).
 *
 * NOT columns on the shipped `student_health_record`, whose `student_id` carries a GLOBAL `.unique()`
 * (students.ts:250): sickle cell AND asthma is literally inexpressible there. That table stays the
 * 1:1 bio baseline — prefill from it, never link to it (a plan reading its condition text live from
 * the health record would be silently rewritten by a clerk editing the student profile), not
 * migrated, not dual-written.
 *
 * R98 — THE ENTRY CARRIES TWO TIERS OF COLUMN, AND THAT IS THE HEADLINE. The dorm-side card is a
 * SEPARATELY AUTHORED artefact, not a redaction of the care plan: the surface proves it, because
 * protocol step 4 says *priapism (boys)* and *O₂ sat <95%* while the dorm card says *severe pain ·
 * fever · breathlessness · chest pain*. Different strings for different readers. So `triggers`,
 * `red_flags` and `first_action` are the HM-tier columns and `condition_detail`, `emergency_protocol`
 * and the med rows are the clinical tier. This DELETES the entire class of redaction bug: there is
 * nothing to redact, so a scope is a fixed, pinnable KEY-SET (R70's runtime key-set pin generalises
 * straight onto it) instead of a substring judgement made at render time.
 *
 * R96 — `on_site_treatable` and `referral_managed` are INDEPENDENT NOT NULL booleans (a school can
 * both treat on site and share care with a hospital), with ONE combination fixed by DB CHECK:
 * `MENTAL_HEALTH ⇒ (false, true)`. A real Ghanaian SHS sickbay does not provide mental-health
 * treatment; the matron is not a psychiatrist, and pretending otherwise creates harm. That is
 * product policy, identical for every school, so it is a CHECK rather than a per-school judgement.
 *
 * R116 — `condition = 'MENTAL_HEALTH'` is a SECURITY DISCRIMINATOR, not just a category: it is
 * carved out of the HEADMASTER's default read inside the RLS predicate itself, so his SQL cannot
 * return the row whatever a reader does. Ground: he is the school's disciplinary authority, and a
 * psychiatric history in his default read is the exact adjacency that makes an adolescent not
 * disclose — a register nobody discloses to is worse than no register.
 */
export const sickbayChronicEntry = pgTable(
  "sickbay_chronic_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(), // composite (school_id, student_id) FK below
    condition: chronicConditionEnum("condition").notNull(),
    // R129 — THE POLICY BIT. Not a diagnosis, not a copy of `condition`: the one fact the grant
    // table's RLS predicate needs ("is this entry outside a HEADMASTER's default read?"), materialised
    // on the entry so the GRANT policy gates on it WITHOUT reading the entry table — reading the entry
    // from the grant policy is the cycle (entry → grant → entry), not a style choice. GENERATED ALWAYS
    // STORED, never app-written: structurally incapable of disagreeing with `condition` (R10), and the
    // string `MENTAL_HEALTH` lives ONLY here — a grant row carries a boolean about a policy (R43/R122).
    hmRestricted: boolean("hm_restricted")
      .notNull()
      .generatedAlwaysAs(sql`"condition" = 'MENTAL_HEALTH'`),
    // The words on the pill ("Sickle cell disease · HbSS"); the ENUM above drives only the colour.
    // Free text because HbSS/HbSC, "peanut + shellfish" and "type 1" are facts no 7-value vocabulary
    // can hold, and widening the vocabulary is how a register becomes an EMR (R94).
    conditionLabel: text("condition_label"),
    conditionDetail: text("condition_detail"),
    status: chronicStatusEnum("status").notNull().default("STABLE"),
    // R96 — independent booleans; the MENTAL_HEALTH combination is CHECK-enforced below.
    onSiteTreatable: boolean("on_site_treatable").notNull().default(true),
    referralManaged: boolean("referral_managed").notNull().default(false),
    // ---- clinical tier (a FULL_PLAN reader; never the dorm card, never a list) ----
    baselineStatus: text("baseline_status"),
    careGoals: text("care_goals"),
    emergencyProtocol: text("emergency_protocol"), // R97 — ONE column, the matron's paragraphs
    // R104 — discharge criteria as ONE free-text column that PREFILLS the shipped visit field.
    // R63 closed with a smaller answer: the surfaces' structured 4-row checklist and "3 of 4 met"
    // counter stay OMITTED (a criterion instance needs per-condition templates; this is the
    // template, and it is prose).
    dischargeCriteria: text("discharge_criteria"),
    // ---- HM tier (R98) — separately authored, structurally incapable of carrying the clinical tier
    triggers: text("triggers"),
    redFlags: text("red_flags"),
    firstAction: text("first_action"),
    // ---- external care (R127) — the DMHU/pastoral facts, as TEXT, with no link and no join. The
    // VLC case id, if the matron types one, lives inside external_pastoral_home as her own string.
    externalClinicalHome: text("external_clinical_home"),
    externalPastoralHome: text("external_pastoral_home"),
    externalCareCadence: text("external_care_cadence"),
    // The ONE non-text external-care column: the next appointment is a stored DATE nobody computes
    // (nothing generates a monthly series). In free text it would be unsortable and unrenderable.
    externalNextVisitAt: timestamp("external_next_visit_at", { withTimezone: true }),
    // ---- review + version (R103) — `v4` is a NUMBER, the history is audit_log, there is no
    // superseded row and no version table. `co_reviewer_note` is free text because the second name
    // on the surface's head meta (a VLC counsellor) may not be a system user at all — the R21/R38
    // recorded-external-actor precedent. Do NOT add a second FK to a user who may not exist.
    version: smallint("version").notNull().default(1),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    coReviewerNote: text("co_reviewer_note"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for sickbay_chronic_med, _grant AND _read — THREE tables in THIS SAME
    // migration. Carried INLINE in CREATE TABLE so it exists before every ADD FOREIGN KEY (the 0033
    // ordering hazard; 0057 did the same for sickbay_visit_tenant_uk).
    tenantUk: unique("sickbay_chronic_entry_tenant_uk").on(t.schoolId, t.id),
    // R129 — the FK TARGET that pins every grant row to the entry's live classification: the grant's
    // entry FK is (school_id, entry_id, hm_restricted) ON UPDATE CASCADE, so re-classifying an entry
    // PROPAGATES onto its grants instead of leaving a stale `false` (which fails OPEN — the dangerous
    // direction, and R94 concedes re-classification happens). UNIQUE (not uniqueIndex): a constraint
    // is emitted INLINE in CREATE TABLE, ahead of every ADD FOREIGN KEY (the 0033 ordering hazard).
    hmUk: unique("sickbay_chronic_entry_hm_uk").on(
      t.schoolId,
      t.id,
      t.hmRestricted,
    ),
    // R96 — the one product-policy invariant that lives in the DB. Single-row CHECK, no trigger.
    mentalHealthIsReferralManaged: check(
      "chronic_mental_health_referral_managed",
      sql`${t.condition} <> 'MENTAL_HEALTH' OR (${t.onSiteTreatable} = false AND ${t.referralManaged} = true)`,
    ),
    // ONE LIVE PLAN PER (student × condition) — partial unique, the R58 idiom, because an app check
    // loses the concurrent double-create race and two live SCD plans for one girl means two
    // contradictory emergency protocols. Retired plans (active=false) are exempt, so a condition can
    // be re-opened. ⚠ `OTHER` is EXEMPT: it is R94's escape hatch for everything outside the seven
    // values, so capping a student at one OTHER row would cap the register itself (coeliac AND
    // hypertension is a legitimate pair).
    oneLivePerCondition: uniqueIndex("uniq_sickbay_chronic_entry_condition")
      .on(t.schoolId, t.studentId, t.condition)
      .where(sql`${t.active} AND ${t.condition} <> 'OTHER'`),
    // The register list is "this school's entries" and the R123 queue marker + R124 visit-record
    // chips are "this student's entries" — one index leading with school_id serves both.
    byStudent: index("sickbay_chronic_entry_student_idx").on(t.schoolId, t.studentId),
    // Composite intra-tenant FK — a cross-tenant student reference is structurally impossible.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  }),
);

/**
 * One row per (entry × drug × slot), or per PRN drug (R99). The med GRID on the surface is a PIVOT
 * of these rows over `getRoundSchedule()`'s columns — presentation, never storage (R101; the
 * surface's `13:00 Lunch` column is demo drift and loses to the shipped 06:30/12:30/21:00 rounds).
 *
 * REJECTED: a `slot_doses jsonb` map on one row per drug (INCR-24's "who is due at 06:30" becomes a
 * full scan of every plan in the school — R64(7) again), and a third `_dose` child table (a row per
 * (drug × slot) IS the dose row; the extra level buys a join and an orphan state).
 *
 * 🔴 `slot_id` is a composite (school_id, slot_id) FK with ON DELETE **RESTRICT**, not SET NULL.
 * SET NULL looks kinder and is the dangerous option: it silently orphans a dose from its round, i.e.
 * a student quietly stops being dosed and no error is ever raised. RESTRICT converts that into a
 * loud failure — which is precisely why R100 pulls the `resetScheduleSlots` obligation FORWARD from
 * INCR-24 to 23a: that action hard-DELETEs every slot row and re-creates it with new ids, so after
 * this migration "Reset to defaults" would hard-fail against any school with a medication schedule.
 * It must become a reconcile/update-in-place BEFORE this ships.
 */
export const sickbayChronicMed = pgTable(
  "sickbay_chronic_med",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id").notNull(), // composite (school_id, entry_id) FK below
    drugName: text("drug_name").notNull(),
    // "500mg OD", "2 puffs", "8 units" — TEXT, deliberately not a numeric quantity + unit pair:
    // this is a PRESCRIPTION SCHEDULE, not an administration record (that is INCR-24's MAR, and
    // owner decision D5.2 puts the controlled-substance register there too).
    doseLabel: text("dose_label").notNull(),
    // Exactly one of "as needed" / "at this round" — CHECK-enforced below.
    isPrn: boolean("is_prn").notNull().default(false),
    slotId: uuid("slot_id"), // composite (school_id, slot_id) FK below — RESTRICT
    // PRN criteria ("for pain ≥ 4/10, max 4 doses in 24h"), kitchen instructions, monitoring notes.
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Authored NOW though nothing references it yet — the 0056 `sickbay_bed_tenant_uk` / 0057
    // `sickbay_admission_tenant_uk` precedent (AC B6): INCR-24's MAR row will point at the
    // prescription it administered, and adding the UNIQUE in the same migration as that FK is
    // exactly the 0033 ordering hazard. INLINE.
    tenantUk: unique("sickbay_chronic_med_tenant_uk").on(t.schoolId, t.id),
    // R99's XOR: `is_prn` TRUE ⇔ no slot. A PRN row with a round, or a scheduled row with no round,
    // are both nonsense the grid cannot render.
    prnXorSlot: check("chronic_med_prn_xor_slot", sql`${t.isPrn} = (${t.slotId} IS NULL)`),
    // One row per (entry × drug × round) — the grid cell is single-valued, and a duplicate is a
    // double dose in a pivot nobody would notice. PRN rows have slot_id NULL, which Postgres treats
    // as distinct, so a drug may carry several PRN lines (different criteria) — correct: nothing
    // FIRES a PRN row. This index also serves "this plan's medications".
    uniqDose: unique("uniq_sickbay_chronic_med_dose").on(
      t.schoolId,
      t.entryId,
      t.drugName,
      t.slotId,
    ),
    // INCR-24's round query ("who is due at 06:30") and the RESTRICT check on every slot delete both
    // read by slot. Postgres does not index a FK automatically, and an unindexed RESTRICT target
    // means a seq scan of every prescription in the school on every schedule edit.
    bySlot: index("sickbay_chronic_med_slot_idx").on(t.schoolId, t.slotId),
    // Composite intra-tenant FKs. The plan CASCADEs; the ROUND restricts (see the header note).
    entryFk: foreignKey({
      columns: [t.schoolId, t.entryId],
      foreignColumns: [sickbayChronicEntry.schoolId, sickbayChronicEntry.id],
    }).onDelete("cascade"),
    slotFk: foreignKey({
      columns: [t.schoolId, t.slotId],
      foreignColumns: [sickbayScheduleSlot.schoolId, sickbayScheduleSlot.id],
    }).onDelete("restrict"),
  }),
);

/**
 * A per-ENTRY access grant (R105) — the row the third RLS boundary reads.
 *
 * PER ENTRY, NOT PER STUDENT. A grant on "Adwoa's plan" that silently widened to a future
 * MENTAL_HEALTH entry for the same girl is exactly what R116 exists to prevent.
 *
 * R106 — the grantee is a `ref_user` and it is NOT NULL. A STUDENT or a PARENT may NEVER hold one:
 * R38 already ruled that one student's identity must never appear as an ACTOR inside another
 * student's clinical record, so the surface's `Senior prefect` grant row is REFUSED (owner E19). A
 * non-user gets the PRINTED dorm card, which is the doctrine already. `isStaff()` is reused at the
 * app layer; the DB cannot check role membership on a global ref_user pointer (Sarah's standing
 * advisory — every clinical actor pointer needs the explicit app-layer check).
 *
 * R107 — grants AUTO-EXPIRE but never AUTO-GRANT. The note panel's "grants auto-transfer to the new
 * HM" LOSES: six students' medical records landing on a man the day he changes job, with no matron
 * decision and no audit event, is the boundary this increment exists to build. The "auto-expired"
 * half WINS, and costs ONE nullable column: a house-tied grant is live iff
 * `houses.hm_user_id = grantee AND student.house_id = grant.house_id`. One column, no new mechanism,
 * and the grant dies the moment either fact changes — evaluated in SQL, in the transaction, per
 * request (R114), never a session claim.
 *
 * R110 — APPEND-ONLY: revoke never deletes, and a scope CHANGE is revoke + re-grant, never an
 * UPDATE of `scope`. R111 — issuing and revoking is MATRON-only (not HEADMASTER, not ADMIN): R39's
 * split repeats, the Head reads but never authors.
 *
 * ⚠ There is deliberately NO "one live grant" unique index. `live` depends on `now()`, which is not
 * immutable and cannot appear in an index predicate; the obvious fallback `WHERE revoked_at IS NULL`
 * is WORSE THAN NOTHING, because an EXPIRED grant is not a revoked one, so a lawful re-grant in
 * August would be rejected by a unique violation against July's dead row. Duplicate live grants are
 * semantically idempotent (both were issued by a matron), and the reader must resolve a SET of live
 * grants anyway — an expired FULL_PLAN beside a live DIRECTIVE has to collapse to DIRECTIVE whatever
 * any constraint says. See OQ1 #6 in the PR.
 */
export const sickbayChronicGrant = pgTable(
  "sickbay_chronic_grant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id").notNull(), // composite (school_id, entry_id, hm_restricted) FK below
    // R129 — the pinned copy of the entry's policy bit, here ONLY so the grant policy can decide
    // "may a HEADMASTER see this grant row?" without reading the entry table (that read is the cycle).
    // The composite FK below makes a wrong value an FK VIOLATION AT INSERT and a re-classification a
    // CASCADE; a grantee cannot flip it to false either (no matching parent key). A boolean about a
    // POLICY, never the condition — `MENTAL_HEALTH` must not appear on a grant row (R43/R122).
    hmRestricted: boolean("hm_restricted").notNull(),
    // NOT NULL: a grant with no grantee is not a grant. Single-column FK to the GLOBAL ref_user
    // (the houses.hm_user_id idiom); CASCADE rather than SET NULL precisely because it is NOT NULL —
    // a deleted user's grants must not survive as unreadable stubs.
    granteeUserId: uuid("grantee_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: sickbayGrantScopeEnum("scope").notNull(),
    // THREE matron-authored strings, deliberately NOT collapsed into one (R109): the scope's own
    // words on the row ("dorm-side card"), WHY it was issued, and — for DIRECTIVE — the single
    // sentence that IS the grantee's entire view of this student.
    scopeLabel: text("scope_label"),
    reason: text("reason"),
    directiveNote: text("directive_note"),
    // R107 — nullable house tie. Set ⇒ the grant is live only while the grantee is that House's HM
    // AND the student is still in that House. NULL ⇒ an ordinary named grant.
    houseId: uuid("house_id"), // composite (school_id, house_id) FK below
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // NULL ⇒ no expiry (the surface's italic-green `No expiry`). Evaluated against the DB's now() in
    // the same statement that reads the row (R114) — never cached, never in middleware.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    // R109 — a DIRECTIVE grant with no directive_note would show its holder a blank page where the
    // one sentence he is entitled to should be. The narrowest tier must be non-empty by construction.
    directiveNeedsNote: check(
      "chronic_grant_directive_needs_note",
      sql`${t.scope} <> 'DIRECTIVE' OR ${t.directiveNote} IS NOT NULL`,
    ),
    // §04's grant list for one plan.
    byEntry: index("sickbay_chronic_grant_entry_idx").on(t.schoolId, t.entryId),
    // THE HOT PATH: the RLS predicate's grant arm ("does su hold a live grant on this entry"), read
    // on every single query against every chronic table.
    byGrantee: index("sickbay_chronic_grant_grantee_idx").on(t.schoolId, t.granteeUserId),
    // Composite intra-tenant FKs. The plan CASCADEs. The House CASCADEs — a deleted House cannot
    // leave an HM-tied grant behind, and R107's liveness rule would be unevaluable without it.
    //
    // R129 — THREE columns, and ON UPDATE CASCADE is the load-bearing half. It still makes a
    // cross-tenant/non-existent entry impossible ((school_id, id) is itself unique) AND pins
    // `hm_restricted` to the entry's live value. Named explicitly because drizzle's default name for a
    // 3-column composite FK exceeds Postgres's 63-char identifier limit; this keeps the prod paste and
    // `drizzle-kit migrate` byte-identical with no truncation to reason about.
    entryFk: foreignKey({
      name: "sickbay_chronic_grant_entry_hm_fk",
      columns: [t.schoolId, t.entryId, t.hmRestricted],
      foreignColumns: [
        sickbayChronicEntry.schoolId,
        sickbayChronicEntry.id,
        sickbayChronicEntry.hmRestricted,
      ],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    houseFk: foreignKey({
      columns: [t.schoolId, t.houseId],
      foreignColumns: [houses.schoolId, houses.id],
    }).onDelete("cascade"),
  }),
);

/**
 * THE READ AUDIT (R121) — one row per (actor × entry × civil day), and nothing else.
 *
 * Fires on the care-plan DETAIL route and on the dorm-card print. NEVER on the list, the R123 queue
 * marker, a counter, a tile or a revalidation. The MATRON's own opens ARE audited.
 *
 * Its own table, not `actionType='viewed'` on the shipped `audit_log`: dedupe on that table becomes
 * SELECT-then-INSERT needing a five-column index on a hot shared path (Risk 3's "an audit table
 * outgrowing the data"), and — decisively — a separate table can be aged out on its own retention
 * schedule (owner D5.1: 7 years post-exit, the SETTING is real, the purge machinery is not built at
 * 23 and the UI must not claim it). The UNIQUE below IS the dedupe: ONE insert with ON CONFLICT DO
 * NOTHING, no read-before-write, no race (AC A3). ⚠ Do NOT add `.returning()` to that insert — a
 * grantee has INSERT but no SELECT on this table (R122), and RETURNING needs SELECT.
 *
 * 🔴 R122 — the row stores IDs AND A SCOPE, never a condition string. The surface's
 * `viewed Esi Antwi · diabetic protocol` is a leak by proxy on the very screen meant for oversight.
 * And §04 is CLINICAL-READER-ONLY: a grantee must never learn who ELSE knows.
 *
 * APPEND-ONLY: no updated_at, no void, no delete. LEAF → no tenant UK.
 */
export const sickbayChronicRead = pgTable(
  "sickbay_chronic_read",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id").notNull(), // composite (school_id, entry_id) FK below
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The Africa/Accra CIVIL date from the shipped civilDate() — a DATE, not a timestamp, because it
    // is the dedupe key and a timestamp cannot be one. (Ghana is UTC+0 year-round, so this is the
    // same calendar day as UTC; the helper is used anyway so the rule is stated, not assumed.)
    readOn: date("read_on").notNull(),
    // WHAT the actor was entitled to see when they opened it. NULL ⇒ read under the DEFAULT clinical
    // role (MATRON/HEADMASTER), i.e. no grant was involved. Never a condition, never a label.
    scope: sickbayGrantScopeEnum("scope"),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // R121's dedupe key AND the §04 trail's read path (it leads with school_id, entry_id).
    uniqPerDay: unique("uniq_sickbay_chronic_read_day").on(
      t.schoolId,
      t.entryId,
      t.actorUserId,
      t.readOn,
    ),
    // Composite intra-tenant FK → sickbay_chronic_entry_tenant_uk. CASCADE with the plan.
    entryFk: foreignKey({
      columns: [t.schoolId, t.entryId],
      foreignColumns: [sickbayChronicEntry.schoolId, sickbayChronicEntry.id],
    }).onDelete("cascade"),
  }),
);

/* ============================================================================
 * Sickbay MEDICATION LAYER (SHS module 4.4 / INCR-24, migration 0060) — the ACTUAL (the MAR) versus
 * the chronic-med PLAN, plus the controlled-substance register, standing orders and per-drug stock.
 * 0058 held the standing care PLAN; these tables hold what was actually given, to whom, by whom,
 * witnessed by whom, and the running controlled balance derived from it.
 *
 * FOUR tenant tables, THREE enums, ONE ADD-UNIQUE on the 0057 sickbay_doctor_consult leaf (above),
 * ZERO altered columns. All four get ENABLE + FORCE RLS + tenant_isolation + the catalog-driven
 * parent_deny (owner decision D8) exactly as every tenant table (db:policies on dev;
 * db/sql/prod-paste-0060-sickbay-medication.sql by hand on prod). ⚠ STANDARD tenant tables — NO
 * `staff_grant_scope` family (R166): the MAR is the ACUTE/round clinical graph, gated like the VISIT
 * by the app-layer clinical pair (SICKBAY_CLINICAL_* roles, R164), not the chronic register's
 * per-entry grant boundary. A housemaster with a chronic FULL_PLAN grant sees the PLAN, never the
 * admin log (owner O2 — no grantee MAR access at 24).
 *
 * ⚠ DDL ORDERING (the 0033 hazard INSIDE one migration, as 0057/0058). `sickbay_med_admin_tenant_uk`
 * is the target of the MAR's own SELF-FK (`corrects_admin_id`, the append-only amendment chain), so it
 * is carried INLINE in CREATE TABLE, and `sickbay_standing_order_tenant_uk` / `sickbay_stock_item_tenant_uk`
 * / `sickbay_doctor_consult_tenant_uk` are all authored ahead of the FKs that consume them.
 *
 * NO TRIGGERS (portability). Every rule that spans rows or reads another table lives in lib/sickbay/:
 * `assertSchoolClinician(schoolId, userId, {requireNmc})` on every clinical actor pointer (R155/R158 —
 * the DB cannot check role/NMC on a GLOBAL ref_user pointer; staff_profile.nmc_licence_number is the
 * tenant join), the "controlled WASTAGE requires a witness" rule (R152 — it depends on
 * sickbay_stock_item.is_controlled, a cross-table fact), the derived due-list / overdue reads (R148/R149
 * — no scheduler, nothing auto-writes OMITTED), the derived controlled balance (R152 — no stored
 * balance), and the append-only amendment posture (a correction is a NEW row, never an UPDATE). The
 * four rules that ARE in the DB are single-row CHECKs on sickbay_med_admin (R143/R144/R154/R157) — none
 * is the cross-table trigger J3 forbids.
 * ==========================================================================*/

/**
 * A STANDING ORDER (R159) — a pre-authored "for complaint X give treatment Y" the matron may
 * administer under her OWN authority. `ordered_by_doctor_name` is COPIED TEXT, never a ref_user (R21 —
 * the ordering doctor is not a system user) and never a gate (R160 — provenance, not permission): a MAR
 * row cites it via `source = STANDING_ORDER`, and the matron administers on her own licence. Editable
 * by [ADMIN, MATRON] (the matron GAINS §3 write), so it carries `updated_at` — unlike the append-only
 * MAR. `tenant_uk (school_id, id)` is INLINE: it is the MAR's `standing_order_id` composite-FK target.
 */
export const sickbayStandingOrder = pgTable(
  "sickbay_standing_order",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    complaint: text("complaint").notNull(), // "headache", "menstrual cramps"
    treatment: text("treatment").notNull(), // "paracetamol 1g PO, max 4g/24h"
    escalation: text("escalation"), // when to stop and refer — free text
    // Copied onto the row — the doctor who authorised the order, not a system user (R21). Provenance
    // only (R160): the matron administers under her own authority.
    orderedByDoctorName: text("ordered_by_doctor_name"),
    active: boolean("active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for sickbay_med_admin.standing_order_id (school_id, id). INLINE (0033). Its
    // school_id prefix also serves the "all standing orders for this school" read, so no separate index.
    tenantUk: unique("sickbay_standing_order_tenant_uk").on(t.schoolId, t.id),
  }),
);

/**
 * PER-DRUG, SCHOOL-LEVEL stock (R161) — never per-student (R162, Risk 4: a drug beside a student on the
 * shared stock/register screen is a re-identification; the surface's "Hydroxyurea — for Adwoa Mensa" is
 * REFUSED). So there is NO `student_id` / student text on this table by construction. `qty_on_hand` is a
 * stored, MANUALLY-maintained reorder aid — a deliberate corner, NOT an audit record: non-controlled
 * stock is not auto-decremented from the MAR (ponytail: upgrade to a movement ledger only if
 * non-controlled audit is ever required). Only the CONTROLLED balance is derived, over
 * sickbay_controlled_movement (R152). `is_controlled` is the boolean the school flags per item (R151 —
 * no seeded national narcotics schedule, owner O3). `tenant_uk` is INLINE: the movement's
 * `stock_item_id` composite-FK target.
 */
export const sickbayStockItem = pgTable(
  "sickbay_stock_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    drugName: text("drug_name").notNull(),
    formLabel: text("form_label"), // "500mg tablet", "100mcg inhaler"
    unit: text("unit"), // "tablets", "puffs", "vials"
    // Stored manually-maintained reorder aid (R161) — NOT an audit record. Default 0 so it always has a
    // value to compare against reorder_point.
    qtyOnHand: numeric("qty_on_hand").notNull().default("0"),
    reorderPoint: numeric("reorder_point"),
    lastRestockedAt: timestamp("last_restocked_at", { withTimezone: true }),
    isControlled: boolean("is_controlled").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for sickbay_controlled_movement.stock_item_id (school_id, id). INLINE (0033).
    // Its school_id prefix also serves the "all stock for this school" read, so no separate index.
    tenantUk: unique("sickbay_stock_item_tenant_uk").on(t.schoolId, t.id),
  }),
);

/**
 * THE MAR — the append-only Medication Administration Record (R141/R142). ONE ROW PER ADMINISTRATION
 * EVENT (given, refused, held or omitted). A "due dose" is DERIVED (schedule × civil day × round), never
 * stored (R148/R101/R32 derived-state doctrine); this table records only what actually happened.
 *
 * 🔴 APPEND-ONLY IS STRUCTURAL (R142/R146): there is NO `updated_at`, no `voided_at`, no delete policy —
 * the DB offers no mutation path, and its ABSENCE is the constraint. A correction is a NEW row that sets
 * `corrects_admin_id` (the composite self-FK) + `amendment_note`; the original stays byte-unchanged and
 * the reader renders a footnoted amendment. A MAR that can be edited is a falsifiable clinical record.
 *
 * R144 — the SNAPSHOTS (`drug_name` / `dose_label` / `route` / `is_controlled` / `dispensed_qty`) are
 * COPIED at administration, never read live from the plan (the sickbay_doctor_consult.clinician_name
 * doctrine): de-listing a drug next term must not retroactively make a past un-witnessed controlled dose
 * look compliant, so `is_controlled` is PINNED here.
 *
 * R143 — `source` is PROVENANCE, never permission. The matching composite RESTRICT pointer
 * (chronic_med_id / standing_order_id / consult_id) is nullable and CHECK-tied to `source`; a
 * DOCTOR_ORDERED row is attribution only (the visiting doctor is not a system user, R21). The CHECK is
 * the PERMISSIVE form — a pointer may only accompany its own source, but the matching pointer is NOT
 * forced non-null, because a CHRONIC "patient's own surrendered bottle" dose (R163) has no chronic_med
 * prescription row to point at.
 *
 * The witness rules are BOTH DB and app: DB CHECKs enforce "a controlled GIVEN dose reaches the table
 * only with a witness or a recorded override" (R154), "controlled GIVEN needs a dispensed_qty" (R144),
 * and "no self-witness" (R157). The witness IDENTITY (a real in-school ref_user with an N&MC licence) is
 * app-layer only (R155/R158 — the DB cannot check role/NMC on a GLOBAL ref_user pointer); a student Sick
 * Bay Prefect can NEVER be witness-of-record (that is a free-text `notes` line, R155).
 *
 * FK shapes: `student_id` composite CASCADE (always present); `visit_id` nullable composite CASCADE
 * (NULL for a routine round dose); `slot_id` nullable composite **RESTRICT** (the round attributed to;
 * NULL for PRN/ad-hoc — mirrors sickbay_chronic_med.slotFk: a referenced round must not vanish); the
 * three source pointers nullable composite **RESTRICT** (a dispensed/cited row must not vanish);
 * `corrects_admin_id` nullable composite SELF-FK **RESTRICT**. The actor pointers (`administered_by`,
 * `witness`) are single-column SET NULL → the GLOBAL ref_user (the houses.hm_user_id idiom). `tenant_uk`
 * is INLINE — the self-FK target, and the 0033 hazard.
 */
export const sickbayMedAdmin = pgTable(
  "sickbay_med_admin",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(), // composite (school_id, student_id) FK below — always present
    visitId: uuid("visit_id"), // nullable composite FK below — NULL for a routine round dose
    slotId: uuid("slot_id"), // nullable composite FK below — RESTRICT; NULL for PRN/ad-hoc
    // ---- provenance (R143) — source + its matching RESTRICT pointer, CHECK-tied ----
    source: sickbayMedSourceEnum("source").notNull(),
    chronicMedId: uuid("chronic_med_id"), // composite FK below — RESTRICT (CHRONIC)
    standingOrderId: uuid("standing_order_id"), // composite FK below — RESTRICT (STANDING_ORDER)
    consultId: uuid("consult_id"), // composite FK below — RESTRICT (DOCTOR_ORDERED)
    // ---- snapshots (R144) — copied at administration, never read live from the plan ----
    drugName: text("drug_name").notNull(),
    doseLabel: text("dose_label").notNull(),
    route: text("route"), // "oral", "IV", "inhaled" — free text
    isControlled: boolean("is_controlled").notNull().default(false), // PINNED at administration (R144)
    dispensedQty: numeric("dispensed_qty"), // the controlled deduction (R153); CHECK-required for controlled GIVEN
    // R168 — WHICH stock item this dose drew from. Nullable: a CHRONIC "patient's own surrendered
    // bottle" dose (R163) draws no school stock. A controlled dose MUST name it (the CHECK below, the
    // twin of med_admin_controlled_needs_qty). Composite (school_id, stock_item_id) FK below — RESTRICT.
    // getControlledRegister's MAR arm now sums by this id, not the mutable drug_name (24b app work).
    stockItemId: uuid("stock_item_id"), // composite (school_id, stock_item_id) FK below — RESTRICT
    // ---- the event ----
    status: sickbayMedStatusEnum("status").notNull(),
    administeredAt: timestamp("administered_at", { withTimezone: true }).notNull(),
    // Actor pointers — single-column SET NULL → GLOBAL ref_user. The clinician tenancy/role/NMC guard is
    // app-layer (assertSchoolClinician) on every one of these — the DB cannot check it on a global FK.
    administeredByUserId: uuid("administered_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    witnessUserId: uuid("witness_user_id").references(() => users.id, { onDelete: "set null" }),
    witnessOverrideReason: text("witness_override_reason"), // R156 — documented, single-signature override
    notes: text("notes"),
    // ---- append-only amendment (R146) — a correction is a NEW row citing the original ----
    correctsAdminId: uuid("corrects_admin_id"), // composite SELF-FK below — RESTRICT
    amendmentNote: text("amendment_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // NO updated_at, NO voided_at, NO soft-delete — append-only (R142/R146). Absence IS the constraint.
  },
  (t) => ({
    // Composite-FK target for the SELF-FK (corrects_admin_id) — INLINE so it exists before the ADD
    // FOREIGN KEY that references it (the 0033 hazard, sharpest here because the target is this table).
    tenantUk: unique("sickbay_med_admin_tenant_uk").on(t.schoolId, t.id),
    // R144 — a controlled dose must carry the quantity dispensed (it is the controlled-balance deduction).
    controlledNeedsQty: check(
      "med_admin_controlled_needs_qty",
      sql`${t.isControlled} = false OR ${t.dispensedQty} IS NOT NULL`,
    ),
    // R168 — the TWIN of controlledNeedsQty on the SAME is_controlled key: a controlled dose must name
    // the stock item it drew from, so getControlledRegister sums by stock_item_id (not the mutable
    // drug_name). Like its twin it bites on ALL controlled rows, not just GIVEN — a controlled
    // REFUSED/HELD/OMITTED carries dispensed_qty=0 + a stock_item_id, and the balance sums only GIVEN so
    // the 0 never moves it. Nullable stock_item_id is legal only when NOT controlled (R163 patient-own).
    controlledNeedsStockItem: check(
      "med_admin_controlled_needs_stock_item",
      sql`NOT ${t.isControlled} OR ${t.stockItemId} IS NOT NULL`,
    ),
    // R154 — a controlled GIVEN administration reaches the table ONLY with a witness OR a recorded
    // override, never silently. (Non-GIVEN controlled and all non-controlled doses are exempt.)
    controlledGivenNeedsWitness: check(
      "med_admin_controlled_given_witness",
      sql`NOT (${t.isControlled} AND ${t.status} = 'GIVEN') OR ${t.witnessUserId} IS NOT NULL OR ${t.witnessOverrideReason} IS NOT NULL`,
    ),
    // R157 — self-witness is forbidden: a witness is a SECOND clinician.
    witnessNotSelf: check(
      "med_admin_witness_not_self",
      sql`${t.witnessUserId} IS NULL OR ${t.witnessUserId} <> ${t.administeredByUserId}`,
    ),
    // R143 (OQ1 TIGHTENED) — each source is PAIRED with its pointer, DB-backstopped not app-only
    // (append-only safety-critical record): STANDING_ORDER requires standing_order_id (which protocol)
    // and DOCTOR_ORDERED requires consult_id (the surface hyperlink), each forbidding the other two;
    // AD_HOC forbids all three. CHRONIC is the ONE NAMED exception (R163): chronic_med_id is OPTIONAL,
    // so a "patient's own surrendered bottle" dose with no prescription row is legal — but it still
    // forbids standing_order_id and consult_id.
    sourcePointerMatch: check(
      "med_admin_source_pointer_match",
      sql`(${t.source} = 'CHRONIC' AND ${t.standingOrderId} IS NULL AND ${t.consultId} IS NULL)
       OR (${t.source} = 'STANDING_ORDER' AND ${t.standingOrderId} IS NOT NULL AND ${t.chronicMedId} IS NULL AND ${t.consultId} IS NULL)
       OR (${t.source} = 'DOCTOR_ORDERED' AND ${t.consultId} IS NOT NULL AND ${t.chronicMedId} IS NULL AND ${t.standingOrderId} IS NULL)
       OR (${t.source} = 'AD_HOC' AND ${t.chronicMedId} IS NULL AND ${t.standingOrderId} IS NULL AND ${t.consultId} IS NULL)`,
    ),
    // R142 — the three reads: a student's MAR in time order (the record), a round's doses in time order
    // (the "done" check for the derived due-list), and a visit's doses (the visit-record §3 chip).
    byStudent: index("sickbay_med_admin_student_idx").on(t.schoolId, t.studentId, t.administeredAt),
    bySlot: index("sickbay_med_admin_slot_idx").on(t.schoolId, t.slotId, t.administeredAt),
    byVisit: index("sickbay_med_admin_visit_idx").on(t.schoolId, t.visitId),
    // Composite intra-tenant FKs. student/visit CASCADE; slot + the three source pointers + the self-FK
    // all RESTRICT (a dispensed/cited/amended row must not vanish).
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    visitFk: foreignKey({
      columns: [t.schoolId, t.visitId],
      foreignColumns: [sickbayVisit.schoolId, sickbayVisit.id],
    }).onDelete("cascade"),
    slotFk: foreignKey({
      columns: [t.schoolId, t.slotId],
      foreignColumns: [sickbayScheduleSlot.schoolId, sickbayScheduleSlot.id],
    }).onDelete("restrict"),
    chronicMedFk: foreignKey({
      columns: [t.schoolId, t.chronicMedId],
      foreignColumns: [sickbayChronicMed.schoolId, sickbayChronicMed.id],
    }).onDelete("restrict"),
    standingOrderFk: foreignKey({
      columns: [t.schoolId, t.standingOrderId],
      foreignColumns: [sickbayStandingOrder.schoolId, sickbayStandingOrder.id],
    }).onDelete("restrict"),
    consultFk: foreignKey({
      columns: [t.schoolId, t.consultId],
      foreignColumns: [sickbayDoctorConsult.schoolId, sickbayDoctorConsult.id],
    }).onDelete("restrict"),
    // R168 — composite intra-tenant FK → sickbay_stock_item_tenant_uk, RESTRICT (mirrors the movement
    // ledger's stockItemFk and the MAR's other source pointers): a stocked item with administration
    // history must not vanish, and a cross-tenant stock reference is structurally impossible.
    stockItemFk: foreignKey({
      columns: [t.schoolId, t.stockItemId],
      foreignColumns: [sickbayStockItem.schoolId, sickbayStockItem.id],
    }).onDelete("restrict"),
    // The append-only amendment chain. RESTRICT: a corrected row must not be deletable out from under
    // its correction. Named explicitly — drizzle's default self-FK name exceeds 63 chars.
    correctsFk: foreignKey({
      name: "sickbay_med_admin_corrects_fk",
      columns: [t.schoolId, t.correctsAdminId],
      foreignColumns: [t.schoolId, t.id],
    }).onDelete("restrict"),
  }),
);

/**
 * THE CONTROLLED-STOCK MOVEMENT LEDGER (R152) — append-only, the register's balance is DERIVED over it,
 * never stored (R10): balance = Σ RECEIPT − Σ(controlled GIVEN MAR dispensed_qty) − Σ WASTAGE
 * ± Σ ADJUSTMENT. ADMINISTRATIONS ARE NOT A MOVEMENT ROW — they are read from the MAR (one source of
 * truth); only receipts, wastage and adjustments land here.
 *
 * `movement_type` is the enum; `witness_user_id` is nullable because the "controlled WASTAGE requires a
 * witness" rule (R152 — the diversion point) depends on sickbay_stock_item.is_controlled, a CROSS-TABLE
 * fact a single-row CHECK cannot reach, so it is app-layer (assertSchoolClinician) not a DB constraint.
 * "Brief" (D5.2) EXCLUDES batch/lot lifecycle, expiry alerting, multi-store, procurement, cyclic count
 * and cabinet-key logs — `batch_ref` is a free-text note, not a lot-tracking table.
 *
 * LEAF, APPEND-ONLY: nothing references a movement, so NO tenant UK; no `updated_at`, no void, no delete
 * (FORCE RLS, the sickbay_vital_reading / sickbay_doctor_consult posture). `stock_item_id` is a composite
 * **RESTRICT** — a stock item with movement history must not be deletable.
 */
export const sickbayControlledMovement = pgTable(
  "sickbay_controlled_movement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    stockItemId: uuid("stock_item_id").notNull(), // composite (school_id, stock_item_id) FK below — RESTRICT
    movementType: sickbayStockMovementTypeEnum("movement_type").notNull(),
    quantity: numeric("quantity").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    // Nullable — a controlled WASTAGE requires a witness (R152), enforced app-layer because it depends on
    // the stock item's is_controlled (a cross-table fact no single-row CHECK can reach).
    witnessUserId: uuid("witness_user_id").references(() => users.id, { onDelete: "set null" }),
    batchRef: text("batch_ref"), // free-text note, NOT a lot-tracking table (D5.2 "brief")
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // NO updated_at — append-only (R152). A correction is a second row (an ADJUSTMENT).
  },
  (t) => ({
    // The balance derivation (R152) reads a stock item's movements in time order; this index serves it
    // AND the RESTRICT check on every stock-item delete (an unindexed RESTRICT target is a seq scan).
    byItem: index("sickbay_controlled_movement_item_idx").on(
      t.schoolId,
      t.stockItemId,
      t.occurredAt,
    ),
    // Composite intra-tenant FK → sickbay_stock_item_tenant_uk. RESTRICT — a stocked item with movement
    // history must not vanish.
    stockItemFk: foreignKey({
      columns: [t.schoolId, t.stockItemId],
      foreignColumns: [sickbayStockItem.schoolId, sickbayStockItem.id],
    }).onDelete("restrict"),
  }),
);

/* ============================================================================
 * Sickbay REFERRALS (SHS module 4.4 / INCR-25, migration 0062) — LANE B: the referred-out record. When
 * a sickbay sends a student to a hospital, THIS is the row that carries the frozen ER handoff, the
 * external ward updates, the NHIS coverage snapshot, the return, and the diagnosis-free cost lines the
 * Bursar reconciles. It branches off the INCR-22 visit trunk (a referral is a REFER-disposition visit
 * EVENT), never off the chronic register.
 *
 * SIX tenant tables, FIVE enums, ZERO altered columns. All six get ENABLE + FORCE RLS +
 * tenant_isolation + the catalog-driven parent_deny (owner decision D8) — and ⚠ NO staff_grant_scope
 * (R194): the referral is the ACUTE clinical graph, gated app-layer like the visit/MAR by
 * SICKBAY_CLINICAL_READ_ROLES, NOT via the chronic register's per-entry grant boundary (db:policies on
 * dev; db/sql/prod-paste-0062-sickbay-referral.sql by hand on prod).
 *
 * ⚠ DDL ORDERING (the 0033 hazard INSIDE one migration, as 0057/0058/0060). THREE composite-FK targets
 * are carried INLINE in CREATE TABLE so each exists before every ALTER TABLE … ADD FOREIGN KEY that
 * consumes it: `sickbay_hospital_tenant_uk` (referral.hospital_id), `sickbay_referral_tenant_uk`
 * (referral_update / cost_line / notification.referral_id) and — the SHARPEST — `sickbay_notification_tenant_uk`,
 * the target of the notification's OWN self-FK (retry_of_id). drizzle-kit runs the batch in ONE
 * transaction and SWALLOWS a UK-after-FK error into a silent rollback, so the generated 0062 SQL was
 * read by eye and replayed from EMPTY into a throwaway database, verified by CATALOG inspection
 * (pg_constraint / pg_policy) rather than exit code.
 *
 * NHIS (D3 / R182–R184): FOUR shapes, THREE homes, ZERO school-wide roll-up (the `1,108/1,200 · 92.3%`
 * card-health tile is the forbidden STPSHS matrix — never built). Card IDENTITY lives on
 * student_nhis_card (below); per-line COVERAGE on sickbay_referral_cost_line; `accepts_nhis` on
 * sickbay_hospital; and the referral SNAPSHOTS `nhis_card_number` + `nhis_valid` at creation so a later
 * renewal cannot retro-cover a past ER visit.
 *
 * NO TRIGGERS (portability). Every cross-row rule lives in lib/sickbay/: the legal status transitions,
 * the write-once ER handoff, void-only-while-not-returned, the HM co-sign role check
 * (hm_authorised_by IS HEADMASTER-in-school), the medical-hold UNION (open admissions ∪ open referrals,
 * R193) and `referredOutStudentIds()` (R192, the boarding in-House arm). The one rule in the DB is
 * sickbay_notification's single-row `tier BETWEEN 1 AND 3` CHECK — product policy, not a cross-table
 * trigger.
 *
 * 🔴 R190 — `diagnos` appears NOWHERE: no column, enum, type, index or constraint name. And
 * sickbay_referral_cost_line carries NO clinical column of any kind (structural Risk-4: the Bursar who
 * reads a cost line must not be able to re-identify a condition through it).
 * ==========================================================================*/

/**
 * A hospital a sickbay refers serious cases to (R186) — the setup §4 config, mode-independent (a
 * REFERRAL_ONLY school configures these too, R198). `accepts_nhis` and `distance_km` are config facts,
 * no PII. The visiting/attending doctor stays TEXT on the referral (R21 — an external clinician is not
 * a system user), never an FK here. `tags` is a jsonb string array ("24h", "surgery", "maternity") —
 * `$type` is TYPING ONLY (no DDL), the sickbay_schedule_slot.days_of_week idiom. Retirement is
 * `active = false`, never a DELETE (a hospital with referral history is RESTRICT-protected below).
 */
export const sickbayHospital = pgTable(
  "sickbay_hospital",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    distanceKm: numeric("distance_km"),
    services: text("services"),
    notes: text("notes"),
    isPrimary: boolean("is_primary").notNull().default(false),
    acceptsNhis: boolean("accepts_nhis").notNull().default(false),
    tags: jsonb("tags").$type<string[]>(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for sickbay_referral.hospital_id (school_id, id) — INLINE in CREATE TABLE so
    // it exists before the referral's ADD FOREIGN KEY (the 0033 ordering hazard). Its school_id prefix
    // also serves the "all hospitals for this school" setup read, so no separate index.
    tenantUk: unique("sickbay_hospital_tenant_uk").on(t.schoolId, t.id),
  }),
);

/**
 * ONE NHIS card per student (R183) — the beneficiary singleton. The card's HOLDER may be the student OR
 * a guardian (the mother's household card is common), so the holder is TEXT (`holder_name`) plus
 * `holder_kind`, which are the source of truth; `student_guardian_id` is a nullable BEST-EFFORT SET NULL
 * link only, never the authority. `card_number` is stored VERBATIM — NHIS formats vary across card
 * generations, so there is deliberately NO regex/CHECK (R183). There is NO `status` column: Active /
 * Expiring≤30d / Expired is DERIVED from `valid_to` + now() in lib/, because a stored status can
 * disagree with its own dates (the R10 stored-count failure again).
 *
 * LEAF → FORCE RLS, no tenant UK: nothing references a card row. The referral SNAPSHOTS the number as
 * TEXT (R184), it does not FK to this table — so a renewal here can never retro-rewrite a past handoff.
 */
export const studentNhisCard = pgTable(
  "student_nhis_card",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(), // composite (school_id, student_id) FK below
    // VERBATIM (R183) — formats vary, no regex/CHECK. NOT NULL: the number is the whole reason the row
    // exists; a student with no NHIS simply has no row (that is what the singleton means).
    cardNumber: text("card_number").notNull(),
    holderName: text("holder_name"),
    holderKind: nhisHolderKindEnum("holder_kind").notNull().default("STUDENT"),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    // Nullable single-column SET NULL best-effort link to the guardian whose card this is (the
    // houses.hm_user_id idiom — a SET NULL link stays single-column). `holder_name` is authoritative.
    studentGuardianId: uuid("student_guardian_id").references(() => studentGuardians.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // R183 — ONE card per student (the beneficiary singleton) and the upsert conflict target.
    uniqStudent: unique("uniq_student_nhis_card").on(t.schoolId, t.studentId),
    // Composite intra-tenant FK → students tenant UK. CASCADE with the student.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  }),
);

/**
 * A REFERRAL OUT (R187–R191) — the module's off-campus record. It hangs off a REFER-disposition VISIT
 * (`visit_id` NOT NULL composite CASCADE): a referral is a visit disposition/escalation event, so
 * presenting complaint, vitals and `working_impression` are LIVE-READ from the append-only visit and
 * never re-stored here — the surface's "Diagnosis" line renders the visit's `working_impression` (R190,
 * D1 verbatim). There is NO generated `referral_ref` (R187/R64.4): a pure `formatReferralRef(row)`
 * produces the `R-YYYY-MM-DD-####` crumb from facts already on the row, routing is by server-resolved id.
 *
 * The FROZEN write-once ER handoff (`reason_referred_out` … `travel_note`) is the referral-time snapshot
 * the receiving doctor reads — write-once enforced in lib/ (no trigger), because a later vitals/chronic
 * edit must not rewrite history. `reason_referred_out` is the one REQUIRED handoff field; `menses_note`
 * is 🔴 Class-4 reproductive PII (F5), nullable and clinical-read gated at the app layer.
 *
 * FK shapes: `student_id`/`visit_id` composite CASCADE; `hospital_id` composite **RESTRICT** (a hospital
 * with referral history against it must not vanish — the sickbay_admission.bedFk precedent); the three
 * actor pointers single-column SET NULL → the GLOBAL ref_user (the DB cannot check that
 * `hm_authorised_by` is a HEADMASTER in this school — that is the R191 app check). NHIS is a copied
 * `nhis_card_number` + `nhis_valid` SNAPSHOT (R184), never a live read of student_nhis_card.
 */
export const sickbayReferral = pgTable(
  "sickbay_referral",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(), // composite (school_id, student_id) FK below
    visitId: uuid("visit_id").notNull(), // composite (school_id, visit_id) FK below — R187
    hospitalId: uuid("hospital_id").notNull(), // composite (school_id, hospital_id) FK below — RESTRICT
    // Actor pointers — single-column SET NULL → the GLOBAL ref_user (the houses.hm_user_id idiom).
    accompaniedByUserId: uuid("accompanied_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // R191 — the HM co-sign is a REAL field; the app checks the holder is a HEADMASTER in this school
    // (the DB cannot check role on a global ref_user pointer — the standing sickbay advisory).
    hmAuthorisedByUserId: uuid("hm_authorised_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // R188 — the clinical-LOCATION lifecycle. Legal transitions app-enforced (no trigger); "day N" and
    // "outpatient · same-day" are DERIVED; void = retract while status <> RETURNED (a void column, not
    // a status value). Cost status is INDEPENDENT and DERIVED, never mirrored here.
    status: sickbayReferralStatusEnum("status").notNull().default("REFERRED"),
    transportMode: text("transport_mode"),
    hospitalWard: text("hospital_ward"),
    hospitalBed: text("hospital_bed"),
    attendingClinicianName: text("attending_clinician_name"), // copied text — an external clinician (R21)
    hmAuthorisedAt: timestamp("hm_authorised_at", { withTimezone: true }),
    departedAt: timestamp("departed_at", { withTimezone: true }),
    expectedReturnAt: timestamp("expected_return_at", { withTimezone: true }), // nullable
    // NULL ⇒ still out; set ⇒ RETURNED. The hold drops the NEXT civil day (R193), computed in lib/.
    returnedAt: timestamp("returned_at", { withTimezone: true }), // nullable
    returnNote: text("return_note"),
    // ---- void (R188) — retract while status <> RETURNED. No hard delete anywhere in 4.4. ----
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByUserId: uuid("voided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    voidReason: text("void_reason"),
    // ---- NHIS snapshot (R184) — FROZEN at creation, copied text/bool, never a live card read. ----
    nhisCardNumber: text("nhis_card_number"),
    nhisValid: boolean("nhis_valid"),
    // ---- FROZEN write-once ER handoff (R187) — the verbatim referral-time snapshot; write-once in lib/.
    reasonReferredOut: text("reason_referred_out").notNull(), // the one REQUIRED handoff field
    preReferralCare: text("pre_referral_care"),
    handoffLabs: text("handoff_labs"),
    lastMeal: text("last_meal"),
    mensesNote: text("menses_note"), // 🔴 Class-4 reproductive PII (F5) — nullable, app-gated
    travelNote: text("travel_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for sickbay_referral_update / _cost_line / sickbay_notification.referral_id
    // (school_id, id) — INLINE so it exists before every ADD FOREIGN KEY that follows (the 0033 hazard).
    tenantUk: unique("sickbay_referral_tenant_uk").on(t.schoolId, t.id),
    // R188 — the active-referral list ("students out right now") filters by status within a school.
    byStatus: index("sickbay_referral_status_idx").on(t.schoolId, t.status),
    // The day-counter / "since 06:45" reads and referredOutStudentIds()'s window scan by departed_at.
    byDeparted: index("sickbay_referral_departed_idx").on(t.schoolId, t.departedAt),
    // Composite intra-tenant FKs. student/visit CASCADE; the hospital RESTRICTs.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    visitFk: foreignKey({
      columns: [t.schoolId, t.visitId],
      foreignColumns: [sickbayVisit.schoolId, sickbayVisit.id],
    }).onDelete("cascade"),
    hospitalFk: foreignKey({
      columns: [t.schoolId, t.hospitalId],
      foreignColumns: [sickbayHospital.schoolId, sickbayHospital.id],
    }).onDelete("restrict"),
  }),
);

/**
 * An APPEND-ONLY external clinical update on a referral (R189) — the hospital's ward-round / nurse note,
 * HEARSAY WITH ATTRIBUTION: the author is an external clinician who is NOT a system user (R21), so
 * `clinician_name` + `clinician_affiliation` are TEXT and `recorded_by_user_id` is the matron who
 * transcribed it. The schema says append-only: there is NO `updated_at`, no void and no delete — a
 * correction is a SECOND row. Its absence IS the constraint (the sickbay_doctor_consult /
 * sickbay_vital_reading posture). LEAF → FORCE RLS, no tenant UK.
 *
 * ⚠ The referral ROW is status-updatable (it carries `updated_at`); the UPDATE stream about it is this
 * append-only log. Two different postures on purpose — do not add `updated_at` here.
 */
export const sickbayReferralUpdate = pgTable(
  "sickbay_referral_update",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    referralId: uuid("referral_id").notNull(), // composite (school_id, referral_id) FK below
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    clinicianName: text("clinician_name"), // external actor — TEXT, never a ref_user (R21)
    clinicianAffiliation: text("clinician_affiliation"),
    body: text("body"),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // NO updated_at — append-only (R189). Its absence is the constraint.
  },
  (t) => ({
    // R189 — a referral's updates in time order (the only read this table has).
    byReferral: index("sickbay_referral_update_referral_idx").on(
      t.schoolId,
      t.referralId,
      t.occurredAt,
    ),
    // Composite intra-tenant FK → sickbay_referral tenant UK. CASCADE with the referral.
    referralFk: foreignKey({
      columns: [t.schoolId, t.referralId],
      foreignColumns: [sickbayReferral.schoolId, sickbayReferral.id],
    }).onDelete("cascade"),
  }),
);

/**
 * A per-item cost line on a referral (R185) — the NHIS reconciliation the Bursar reads. Each line is
 * either NHIS-covered or paid out of pocket: `nhis_covered` is a NOT NULL boolean and
 * `out_of_pocket_amount` a plain numeric. `billing_line_item_id` is a nullable single-column SET NULL FK
 * to invoice_line_item that STAYS NULL throughout module 4.4 (D6 — no invoice write in 4.4, STOP-AND-ASK):
 * the link exists only so INCR-27 can wire the handoff later. Status-updatable, so it carries
 * `updated_at`; LEAF → FORCE RLS, no tenant UK.
 *
 * 🔴 There is NO condition / impression / diagnosis column of ANY kind (R185, structural Risk-4): the
 * Bursar reads these lines, and re-identifying a clinical condition through a cost line must be
 * impossible BY CONSTRUCTION, not by a render-time redaction.
 */
export const sickbayReferralCostLine = pgTable(
  "sickbay_referral_cost_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    referralId: uuid("referral_id").notNull(), // composite (school_id, referral_id) FK below
    itemLabel: text("item_label"),
    provider: text("provider"),
    nhisCovered: boolean("nhis_covered").notNull(), // R185 — a line is covered or not, never unknown
    outOfPocketAmount: numeric("out_of_pocket_amount"),
    // 🔴 Nullable single-column SET NULL → invoice_line_item; STAYS NULL in 4.4 (D6). No invoice write
    // in this module; the column is authored now so INCR-27's billing handoff needs no migration.
    billingLineItemId: uuid("billing_line_item_id").references(() => invoiceLineItems.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // NO clinical column (R185) — the structural Risk-4 guarantee.
  },
  (t) => ({
    // R185 — a referral's cost lines, read together for the reconciliation. Leads with school_id.
    byReferral: index("sickbay_referral_cost_line_referral_idx").on(t.schoolId, t.referralId),
    // Composite intra-tenant FK → sickbay_referral tenant UK. CASCADE with the referral.
    referralFk: foreignKey({
      columns: [t.schoolId, t.referralId],
      foreignColumns: [sickbayReferral.schoolId, sickbayReferral.id],
    }).onDelete("cascade"),
  }),
);

/**
 * The three-tier parent/HM/headmaster/district notification (R196) — AUTHORED NOW, WRITTEN AT INCR-26
 * (the INCR-16→18 / 0060-authored-0026-built precedent). INCR-25 inserts ZERO rows (R197): no
 * write-chain ships here, and `private_note` stays unpopulated.
 *
 * `notification_log_id` REUSES the shipped SMS-delivery table (R196 — do not re-model), a single-column
 * SET NULL best-effort link. `retry_of_id` is the retry chain: a nullable composite SELF-FK, RESTRICT —
 * a retried notification must not vanish out from under its retry. That self-FK is the SHARPEST 0033
 * hazard in this migration (its target, `sickbay_notification_tenant_uk`, is this very table's INLINE
 * tenant UK), and its constraint name is set explicitly because drizzle's default self-FK name exceeds
 * Postgres's 63-char limit (the sickbay_med_admin_corrects_fk precedent).
 *
 * 🔴 `private_note` (F4) is a matron note that NEVER reaches the parent, sitting adjacent to the
 * parent-facing `body` — Sarah's INCR-26 boundary gate. `tier` is `smallint` with a single-row
 * `BETWEEN 1 AND 3` CHECK (product policy, no trigger).
 */
export const sickbayNotification = pgTable(
  "sickbay_notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(), // composite (school_id, student_id) FK below — NOT NULL
    visitId: uuid("visit_id"), // nullable composite (school_id, visit_id) FK below
    referralId: uuid("referral_id"), // nullable composite (school_id, referral_id) FK below
    // Reuse the shipped notification_log (R196) — single-column SET NULL best-effort delivery link.
    notificationLogId: uuid("notification_log_id").references(() => notificationLog.id, {
      onDelete: "set null",
    }),
    retryOfId: uuid("retry_of_id"), // nullable composite (school_id, retry_of_id) SELF-FK below — RESTRICT
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    tier: smallint("tier").notNull(), // 1 parent · 2 HM · 3 headmaster/district — CHECK 1..3 below
    channel: sickbayNotifyChannelEnum("channel").notNull(),
    direction: sickbayNotifyDirectionEnum("direction").notNull(),
    recipient: sickbayNotifyRecipientEnum("recipient").notNull(),
    triggerLabel: text("trigger_label"),
    body: text("body"), // parent-facing
    privateNote: text("private_note"), // 🔴 F4 — NEVER parent-facing; adjacent to `body`
    callDurationSeconds: smallint("call_duration_seconds"),
    answered: boolean("answered"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for the SELF-FK (retry_of_id) — INLINE so it exists before the ADD FOREIGN
    // KEY that references it (the 0033 hazard, sharpest here because the target is this very table).
    tenantUk: unique("sickbay_notification_tenant_uk").on(t.schoolId, t.id),
    // R196 — tier 1..3 (product policy, single-row CHECK, no trigger).
    tierRange: check("sickbay_notification_tier_range", sql`${t.tier} BETWEEN 1 AND 3`),
    // INCR-26's reads: a referral's notification thread, and a student's notifications, in time order.
    // Authored NOW (this is the notification table's one migration) so INCR-26 needs no follow-on DDL.
    byReferral: index("sickbay_notification_referral_idx").on(t.schoolId, t.referralId, t.createdAt),
    byStudent: index("sickbay_notification_student_idx").on(t.schoolId, t.studentId, t.createdAt),
    // Composite intra-tenant FKs. student (NOT NULL) / visit / referral CASCADE; the self-FK RESTRICTs.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    visitFk: foreignKey({
      columns: [t.schoolId, t.visitId],
      foreignColumns: [sickbayVisit.schoolId, sickbayVisit.id],
    }).onDelete("cascade"),
    referralFk: foreignKey({
      columns: [t.schoolId, t.referralId],
      foreignColumns: [sickbayReferral.schoolId, sickbayReferral.id],
    }).onDelete("cascade"),
    // The retry SELF-FK. RESTRICT: a retried row must not be deletable out from under its retry. Named
    // explicitly — drizzle's default self-FK name exceeds Postgres's 63-char limit (the
    // sickbay_med_admin_corrects_fk precedent).
    retryOfFk: foreignKey({
      name: "sickbay_notification_retry_of_fk",
      columns: [t.schoolId, t.retryOfId],
      foreignColumns: [t.schoolId, t.id],
    }).onDelete("restrict"),
  }),
);
