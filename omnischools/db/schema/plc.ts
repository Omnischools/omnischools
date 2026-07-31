import {
  pgTable,
  uuid,
  text,
  smallint,
  integer,
  numeric,
  timestamp,
  unique,
  index,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./tenancy";
import { users } from "./identity";
import { academicPeriod } from "./periods";

/**
 * PLC programme-setup spine (SHS module 4.6 / INCR-47, migration 0071) — the staff-CPD config trunk,
 * the Friday counterpart to VLC's Wednesday F0 (INCR-40). ATTENDEES ARE STAFF, so — unlike VLC's
 * INCR-42b/43 pastoral graph — there is NO confidential layer, NO student PII, NO parent path: every
 * table here is OPERATIONAL / SHOWN (each `plc_*` entity is listed in SHOWN_AUDIT_ENTITIES; none
 * carries a reserved audit prefix, so an omitted one would fail the classify-at-creation build guard).
 *
 * Four NEW tenant tables: `plc_programme` (per-school singleton cadence + the 4-scalar CPD contract),
 * `plc` (the staff PLC group), `plc_membership` (open-row M2M staff cohort) and `plc_term_focus`
 * (per-PLC free-text focus per period). This increment is the CONFIG SPINE ONLY — no session /
 * attendance / reflection / CPD-ledger table (those are INCR-48/49).
 *
 * All four are tenant-scoped and get ENABLE + FORCE RLS + tenant_isolation (db:policies on dev;
 * db/sql/prod-paste-0074-plc-spine.sql by hand on prod) and — via the catalog-driven RESTRICTIVE loop
 * in db/sql/policies.sql — parent_deny (they are FORCE-RLS + school_id and carry NO parent_scope, so
 * the loop auto-denies them). A parent NEVER sees staff PD: delivered structurally, NO parent_scope,
 * NO new GUC, NO RLS boundary of the module's own.
 *
 * Composite `(school_id, id/plc_id/period_id)` intra-tenant FKs make a cross-tenant reference
 * structurally impossible. The user references (facilitator / member / set-by) are SINGLE-column SET
 * NULL to the GLOBAL `ref_user` — a composite intra-tenant FK is impossible there (ref_user has no
 * school_id), which is the [[composite-tenant-fks]] rule. NO triggers (portability): every cross-row
 * rule (the config write-gate PLC_CONFIG_WRITE_ROLES, the facilitator IDENTITY gate, auto-ensured
 * membership) lives in lib/plc/ server actions.
 *
 * `PD_COORDINATOR` (R366) is a FREE-TEXT `ref_role.code` (ref_role.code is `text`, not an enum — a
 * school may add custom roles), so it needs NO enum change and NO migration; its catalog/picker/label
 * registration is an APP-LAYER seam (lib/auth), not schema.
 */

/**
 * Per-school PLC programme — ONE row per school (the vlc_programme / boarding_settings singleton
 * idiom): single-column `school_id UNIQUE` FK, LEAF (nothing references it), so NO composite tenant
 * UK. The UNIQUE is both the singleton constraint and the upsert conflict target for the setup editor.
 *
 * A MISSING row is legal and meaningful: `coalescePlcProgramme` (lib/plc/defaults.ts) coalesces it to
 * the frozen defaults below + configured:false, never null/throw (R370). `configured_at` (nullable)
 * distinguishes "declared this schedule" from "never configured"; it is NOT a freeze — every field
 * stays editable afterwards.
 *
 * DERIVED, NEVER STORED (R370/R371, the vlc_programme "no stored derivable" discipline): `session_end`
 * (= session_start + session_length_min) and `max_pts_per_session` (= pts_per_attended_session +
 * pts_per_reflection, 1.0 by default) are computed in lib/, so there is deliberately NO session_end,
 * NO max_pts_per_session and NO phase/duration column. The 4 CPD scalars are FLAT editable numbers
 * (R371 — the surface's `cpd_points_rules · condition_json` EAV note is SUPERSEDED; no rules-engine).
 */
export const plcProgramme = pgTable(
  "plc_programme",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Singleton constraint + upsert target. Single-column UNIQUE FK → ref_school (the vlc_programme
    // idiom); LEAF, so no composite tenant UK. (school_id) unique subsumes any (school_id, id) — a
    // composite tenant_uk here would be strictly redundant and reference no FK, so it is omitted.
    schoolId: uuid("school_id")
      .notNull()
      .unique()
      .references(() => schools.id, { onDelete: "cascade" }),
    // Cadence. ISO weekday 1..7 (Mon..Sun); Friday (5) is the frozen default (R370).
    sessionDay: smallint("session_day").notNull().default(5),
    sessionStart: text("session_start").notNull().default("15:30"), // "HH:MM" (vlc_programme text idiom)
    sessionLengthMin: integer("session_length_min").notNull().default(60),
    weeksPerSemester: integer("weeks_per_semester").notNull().default(12),
    // The 4-scalar CPD contract (R371) — flat editable numbers the INCR-49 ledger accrues on.
    ptsPerAttendedSession: numeric("pts_per_attended_session", { precision: 5, scale: 2 })
      .notNull()
      .default("0.5"),
    ptsPerReflection: numeric("pts_per_reflection", { precision: 5, scale: 2 })
      .notNull()
      .default("0.5"),
    reflectionWindowHours: integer("reflection_window_hours").notNull().default(48),
    annualPlcTarget: numeric("annual_plc_target", { precision: 5, scale: 2 }).notNull().default("8"),
    // NULL = never configured (readers render the coalesced default empty state). Not a freeze.
    configuredAt: timestamp("configured_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Defense-in-depth single-row CHECKs (the primary validation is app-layer in lib/plc/). Mirror the
    // vlc_programme day-range + positivity discipline; points are non-negative, durations/windows > 0.
    sessionDayRange: check("plc_programme_session_day_range", sql`${t.sessionDay} BETWEEN 1 AND 7`),
    sessionLengthPositive: check(
      "plc_programme_session_length_min_positive",
      sql`${t.sessionLengthMin} > 0`,
    ),
    weeksPositive: check("plc_programme_weeks_per_semester_positive", sql`${t.weeksPerSemester} > 0`),
    reflectionWindowPositive: check(
      "plc_programme_reflection_window_hours_positive",
      sql`${t.reflectionWindowHours} > 0`,
    ),
    ptsAttendedNonneg: check(
      "plc_programme_pts_per_attended_session_nonneg",
      sql`${t.ptsPerAttendedSession} >= 0`,
    ),
    ptsReflectionNonneg: check(
      "plc_programme_pts_per_reflection_nonneg",
      sql`${t.ptsPerReflection} >= 0`,
    ),
    annualTargetNonneg: check("plc_programme_annual_plc_target_nonneg", sql`${t.annualPlcTarget} >= 0`),
  }),
);

/**
 * The PLC GROUP (R373). `type` is a 3-value CHECK ('subject','cross-cutting','new-teacher'),
 * deliberately NOT an enum (a bare app-owned domain needs no type — the vlc_session_template.slot
 * idiom); mandatoriness/induction DERIVE from `type` in lib/ (R376 — NO mandatory/voluntary/induction
 * column). `facilitator_user_id` stores the USER id directly (single-column SET NULL → global
 * ref_user), NOT a staff_id — the R377 `canFacilitatePlcSession` IDENTITY gate compares user ids; a
 * facilitator is a manual staff assignment (NO HoD role, NO room field).
 *
 * `override_frequency` / `override_session_day` are the per-PLC cadence override (null = inherit the
 * programme cadence). `archived_at` is a SOFT-archive (active = archived_at IS NULL); a PLC is NEVER
 * hard-deleted — INCR-48/49 rows (session/attendance/membership/focus) hang off it, so a delete would
 * orphan history. Vacate a PLC by stamping archived_at.
 *
 * `tenant_uk UNIQUE(school_id, id)` is carried INLINE in CREATE TABLE because it is the composite-FK
 * TARGET of both plc_membership's (school_id, plc_id) FK and plc_term_focus's (school_id, plc_id) FK
 * created in the SAME migration (0071): the UNIQUE must exist before those ALTER ... ADD FOREIGN KEY,
 * exactly the 0033 target-before-FK ordering hazard the VLC tables (vlc_value_tenant_uk etc.) guard.
 */
export const plc = pgTable(
  "plc",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    // 3-value CHECK, NOT an enum (R373). mandatory/induction derive from this in lib/ (R376).
    type: text("type").notNull(),
    name: text("name").notNull(),
    // Store the USER id directly (single-column SET NULL → global ref_user) — the R377 identity gate
    // compares user ids. A removed user must not delete the PLC, only clear its facilitator.
    facilitatorUserId: uuid("facilitator_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Per-PLC cadence override (null = inherit the programme). Frequency is a 2-value CHECK, day 1..7.
    overrideFrequency: text("override_frequency"),
    overrideSessionDay: smallint("override_session_day"),
    // Soft-archive: active = archived_at IS NULL. NEVER hard-deleted (48/49 rows FK here).
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for plc_membership.plc_id + plc_term_focus.plc_id (school_id, id). INLINE,
    // ahead of those FK ALTERs in this same migration (the 0033 / vlc ordering discipline). Its
    // (school_id) prefix also serves the "all PLCs for this school" read, so no separate index.
    tenantUk: unique("plc_tenant_uk").on(t.schoolId, t.id),
    // NULL-safe CHECKs (a NULL override/type column passes only where the column is nullable). type is
    // NOT NULL so its allow-list is mandatory; the two overrides are nullable so NULL passes (= inherit).
    typeValid: check(
      "plc_type_valid",
      sql`${t.type} IN ('subject', 'cross-cutting', 'new-teacher')`,
    ),
    overrideFrequencyValid: check(
      "plc_override_frequency_valid",
      sql`${t.overrideFrequency} IN ('WEEKLY', 'BIWEEKLY')`,
    ),
    overrideSessionDayRange: check(
      "plc_override_session_day_range",
      sql`${t.overrideSessionDay} BETWEEN 1 AND 7`,
    ),
  }),
);

/**
 * OPEN-ROW staff membership of a PLC (R374) — the M2M staff cohort. `left_at IS NULL` = an ACTIVE
 * member; leaving stamps left_at, and re-joining UPSERTS the SAME row (the full UNIQUE below is the
 * conflict target — one row per (school × PLC × user) ever, left_at toggles). There is deliberately
 * NO `role` column: facilitator authority lives ONLY on plc.facilitator_user_id (R374 SUPERSEDES the
 * surface's `plc_memberships.role`); assigning a facilitator auto-ensures their active membership
 * (app-layer upsert).
 *
 * `user_id` is a SINGLE-column SET NULL → global ref_user (a composite intra-tenant FK is impossible —
 * ref_user has no school_id), so it is NULLABLE (SET NULL requires it); a hard user-delete is inert in
 * this app (users are BLOCKED via user_school_block, never deleted) so the null-member edge case is
 * effectively unreachable, and the app filters `user_id IS NOT NULL AND left_at IS NULL`. LEAF (nothing
 * FKs to it) → NO tenant UK. Composite (school_id, plc_id) FK → plc.tenant_uk (CASCADE — archiving a
 * PLC keeps its history; only a school delete cascades the membership away).
 */
export const plcMembership = pgTable(
  "plc_membership",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    plcId: uuid("plc_id").notNull(), // composite (school_id, plc_id) FK below
    // The staff member (single-column SET NULL → global ref_user; nullable because SET NULL requires it).
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }), // null = active member (open-row idiom)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One membership row per (school × PLC × user) — the M2M natural key AND the re-join upsert conflict
    // target (R374). Its (school_id, plc_id) prefix also serves the per-PLC roster read, so no separate
    // index for it.
    uniqMembership: unique("uniq_plc_membership").on(t.schoolId, t.plcId, t.userId),
    // The per-user "my PLCs" read (a facilitating teacher's own list, R368 config READ = isStaff).
    byUser: index("plc_membership_user_idx").on(t.schoolId, t.userId),
    // Composite intra-tenant FK — a cross-tenant PLC reference is structurally impossible.
    plcFk: foreignKey({
      columns: [t.schoolId, t.plcId],
      foreignColumns: [plc.schoolId, plc.id],
    }).onDelete("cascade"),
  }),
);

/**
 * Per-PLC free-text term focus (R375) — one focus per (PLC × academic period). `focus` is FREE TEXT
 * (NO frozen canon, NO seed — a school starts blank, the sharp difference from VLC's 11 frozen values).
 * `set_by_user_id` is the SINGLE-column SET NULL actor stamp → global ref_user. There is deliberately
 * NO history table (OC7): an edit overwrites (hence updated_at). `academic_period_id` is a composite
 * (school_id, academic_period_id) intra-tenant FK → academic_period.tenant_uk.
 *
 * `UNIQUE(school_id, plc_id, academic_period_id)` is the one-focus-per-(PLC × period) invariant AND the
 * upsert conflict target; its (school_id, plc_id) prefix serves the per-PLC focus lookup, so no separate
 * index. LEAF (nothing FKs to it) → NO tenant UK.
 */
export const plcTermFocus = pgTable(
  "plc_term_focus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    plcId: uuid("plc_id").notNull(), // composite (school_id, plc_id) FK below
    academicPeriodId: uuid("academic_period_id").notNull(), // composite (school_id, period_id) FK below
    focus: text("focus").notNull(),
    // Actor stamp (single-column SET NULL → global ref_user).
    setByUserId: uuid("set_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One focus per (PLC × period) — the invariant + the upsert conflict target. Its (school_id, plc_id)
    // prefix serves the per-PLC focus read, so no separate index.
    uniqFocus: unique("uniq_plc_term_focus").on(t.schoolId, t.plcId, t.academicPeriodId),
    // Defense-in-depth single-row cap (the primary validation is app-layer in lib/plc/).
    focusLen: check("plc_term_focus_focus_len", sql`char_length(${t.focus}) <= 500`),
    // Composite intra-tenant FKs — a cross-tenant PLC / period reference is structurally impossible.
    plcFk: foreignKey({
      columns: [t.schoolId, t.plcId],
      foreignColumns: [plc.schoolId, plc.id],
    }).onDelete("cascade"),
    periodFk: foreignKey({
      columns: [t.schoolId, t.academicPeriodId],
      foreignColumns: [academicPeriod.schoolId, academicPeriod.periodId],
    }).onDelete("cascade"),
  }),
);
