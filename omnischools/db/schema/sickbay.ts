import {
  pgTable,
  uuid,
  text,
  smallint,
  numeric,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./tenancy";
import { users } from "./identity";
import { students } from "./students";
import {
  sickbayModeEnum,
  sickbaySlotKindEnum,
  sickbayDispositionEnum,
  sickbayConsultModeEnum,
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
    // Composite intra-tenant FK → sickbay_visit_tenant_uk. CASCADE with the visit.
    visitFk: foreignKey({
      columns: [t.schoolId, t.visitId],
      foreignColumns: [sickbayVisit.schoolId, sickbayVisit.id],
    }).onDelete("cascade"),
  }),
);
