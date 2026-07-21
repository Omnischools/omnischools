import {
  pgTable,
  uuid,
  text,
  smallint,
  boolean,
  jsonb,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./tenancy";
import { users } from "./identity";
import { sickbayModeEnum, sickbaySlotKindEnum } from "./_enums";

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
    daysOfWeek: jsonb("days_of_week").notNull(), // ISO 1..7 int array, e.g. [1,2,3,4,5]
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
