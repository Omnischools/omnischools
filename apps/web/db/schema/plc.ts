import {
  pgTable,
  uuid,
  text,
  date,
  jsonb,
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
import { attendanceStatusEnum } from "./_enums";

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

/* ============================================================================
 * PLC SESSION REGISTER (SHS module 4.6 / INCR-48, migration 0072) — the Friday register, the
 * OPERATIONAL/SHOWN counterpart to VLC's Wednesday vlc_session (INCR-42a) and materially lighter than
 * it. Three NEW tenant tables capture three event streams: `plc_session` (the held instance), then the
 * present-by-default `plc_session_attendance` and the SEPARATE `plc_session_reflection`. Attendees are
 * STAFF, so — exactly like the INCR-47 spine — there is NO confidential layer, NO student PII, NO parent
 * path: all three are OPERATIONAL / SHOWN (each listed in SHOWN_AUDIT_ENTITIES; none carries a reserved
 * audit prefix, so an omitted one fails the classify-at-creation build guard). Reflection ANSWERS are
 * SHOWN (staff CPD ≠ pastoral); audit records metadata only, never an answer body (R395).
 *
 * All three get ENABLE + FORCE RLS + tenant_isolation (db:policies on dev; db/sql/prod-paste-0075-plc-
 * sessions.sql by hand on prod) and — via the catalog-driven RESTRICTIVE loop in db/sql/policies.sql —
 * parent_deny (FORCE-RLS + school_id, NO parent_scope → auto-denied). A parent NEVER sees staff PD.
 *
 * DERIVED, NEVER STORED (R381/R382): lifecycle state (SCHEDULED/HELD/MISSED), the write-lock, and the
 * whole CPD-points panel + KPIs compute in lib/plc/ (points.ts) from the cadence + the persisted events.
 * So there is deliberately NO status / started_at / closed_at / held_at / week_no / present_count /
 * points column anywhere below. 48 PERSISTS events only and DISPLAYS a derived preview; INCR-49 is the
 * SOLE plc_cpd_* ledger writer, importing the SAME points.ts (display == accrual by construction, R391).
 * Every cross-row rule (the R384 facilitator write-gate, the R388 within-window submit, the R389
 * confirm) lives in lib/plc/ server actions — NO triggers (portability).
 * ==========================================================================*/

/**
 * The HELD PLC session — one row per (PLC × date), created ONLY when a facilitator (or a break-glass
 * PLC_SESSION_BREAKGLASS role) OPENS it (R381 manual-open; the vlc_session openSession upsert). "Held" =
 * this row exists; SCHEDULED / MISSED / the write-lock all DERIVE in lib/plc/. `academic_period_id` is
 * resolved from `session_date` in lib/ and stored (the term the session belongs to). `agenda_json` is
 * the editable, facilitator-authored agenda ({items:[{text,durationMin?,done}]}, R385) — Zod-validated
 * in lib/, NOT append-only, no agenda-item table (YAGNI). `topic` is a nullable sub-topic beneath the
 * PLC's R375 term-focus headline. `opened_by_user_id` is a single-column SET NULL actor stamp → global
 * ref_user.
 *
 * `plc_session_tenant_uk UNIQUE(school_id, id)` is carried INLINE in CREATE TABLE because it is the
 * composite-FK TARGET of BOTH plc_session_attendance's and plc_session_reflection's (school_id,
 * session_id) FKs created in the SAME migration (0072): the UNIQUE must exist before those ALTER ... ADD
 * FOREIGN KEY (the 0033 target-before-FK ordering hazard, the vlc_session_tenant_uk precedent).
 * UNIQUE(school_id, plc_id, session_date) is the one-session-per-(PLC × date) invariant AND the
 * open-upsert conflict target; its (school_id, plc_id) prefix serves the per-PLC register history read.
 */
export const plcSession = pgTable(
  "plc_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    plcId: uuid("plc_id").notNull(), // composite (school_id, plc_id) FK below
    academicPeriodId: uuid("academic_period_id").notNull(), // composite (school_id, period_id) FK below — resolved from session_date
    sessionDate: date("session_date").notNull(), // stored date (not derived from a timestamp) — the tz-boundary discipline
    topic: text("topic"), // nullable sub-topic; the headline is the PLC's term focus (R375)
    // Facilitator-authored agenda {items:[{text,durationMin?,done}]} (R385), Zod-validated in lib/plc/;
    // editable-until-lock, NOT append-only, NO agenda-item table. Default = the valid empty shape.
    agendaJson: jsonb("agenda_json").notNull().default(sql`'{"items": []}'::jsonb`),
    // Single-column SET NULL actor stamp → global ref_user (the opener; a removed user clears it).
    openedByUserId: uuid("opened_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for the two child tables' (school_id, session_id) FK. INLINE, ahead of those
    // ALTERs in this same migration (the 0033 / vlc_session ordering discipline).
    tenantUk: unique("plc_session_tenant_uk").on(t.schoolId, t.id),
    // One session per (PLC × date) — the invariant + the open-upsert conflict target. Its (school_id,
    // plc_id) prefix serves the per-PLC register history read, so no separate index.
    uniqPerPlcDate: unique("uniq_plc_session").on(t.schoolId, t.plcId, t.sessionDate),
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

/**
 * PRESENT-BY-DEFAULT staff session-attendance (R383, the vlc_session_attendance / prep_attendance
 * idiom) — a row exists ONLY for a member who was NOT present; mark-present DELETES the row, so present
 * = live active plc_membership − rows and every count/rate DERIVES (NO stored present_count/rate).
 * `status` REUSES the canonical attendanceStatusEnum (NO new enum, R383); capture surfaces P/L/A
 * (Late==Present for CPD), E/M are storable-not-rejected (earn 0). `minutes_late` (nullable int, CHECK ≥
 * 0) is set for LATE. `user_id` is the STAFF member (single-column SET NULL → global ref_user, nullable
 * as SET NULL requires). The R384 facilitator write-gate (server-loaded facilitator id via session→plc
 * join, member-in-PLC, refuse-after-lock) is app-layer in lib/plc/, NOT a DB trigger.
 *
 * LEAF (nothing FKs here) → NO tenant UK. UNIQUE(school_id, session_id, user_id) is the upsert conflict
 * target (guarantees ≤1 attended event per member × session → no INCR-49 double-count, R391); its
 * (school_id, session_id) prefix serves the per-session "who was not present" roster read, so no
 * separate index. Composite (school_id, session_id) intra-tenant FK → plc_session.tenant_uk (CASCADE);
 * the recorder is a single-column SET NULL → ref_user.
 */
export const plcSessionAttendance = pgTable(
  "plc_session_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(), // composite (school_id, session_id) FK below
    // The STAFF member (single-column SET NULL → global ref_user; nullable because SET NULL requires it).
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // Reuses the canonical attendance enum; capture surfaces P/L/A (E/M storable-not-rejected, earn 0).
    status: attendanceStatusEnum("status").notNull(),
    minutesLate: integer("minutes_late"), // nullable — set for LATE
    note: text("note"),
    // Single-column SET NULL actor stamp → global ref_user.
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One row per (session × member) — the upsert conflict target. Its (school_id, session_id) prefix
    // serves the per-session roster read, so no separate index.
    uniqPerSessionUser: unique("uniq_plc_session_attendance").on(t.schoolId, t.sessionId, t.userId),
    minutesLateNonneg: check(
      "plc_session_attendance_minutes_late_nonneg",
      sql`${t.minutesLate} >= 0`,
    ),
    // Composite intra-tenant FK — a cross-tenant session reference is structurally impossible.
    sessionFk: foreignKey({
      columns: [t.schoolId, t.sessionId],
      foreignColumns: [plcSession.schoolId, plcSession.id],
    }).onDelete("cascade"),
  }),
);

/**
 * The post-session CPD reflection (R386 — a SEPARATE table, NOT columns on attendance: present-by-
 * default means an attendee has NO attendance row, yet the attendee is exactly who reflects). One row
 * per (session × member).
 *
 * ANSWER STORAGE = three FIXED text columns `q1`/`q2`/`q3` (takeaway / commitment / next-session-
 * question, R387), NOT a single answers_json. Rationale: the questions are frozen school-generic prompts
 * in lib/plc/, NOT configurable (R387) — a fixed 3-field shape is not EAV, so jsonb buys nothing; three
 * plain columns keep the projection explicit and are the honest representation of a fixed form. Nullable
 * so a partial submit is legal (the app requires non-empty answers where needed).
 *
 * `submitted_at` is the domain submission time the R393 within-window check reads; the ANSWERS are
 * append-only-hard (never UPDATE/DELETE, R388, enforced app-layer). `confirmed_at` + `confirmed_by_user_id`
 * are the facilitator's one-way confirmation stamp (R389 — the ONLY mutation this row ever takes, and
 * only on those two columns; NOT window-bound, distinct from the append-only answer). `user_id` (author)
 * and `confirmed_by_user_id` are single-column SET NULL → global ref_user (nullable).
 *
 * LEAF → NO tenant UK. UNIQUE(school_id, session_id, user_id) is the one-reflection-per-member invariant
 * (guarantees ≤1 confirmed reflection event per member × session → no INCR-49 double-count, R391); its
 * (school_id, session_id) prefix serves the per-session reflection read. Composite (school_id,
 * session_id) intra-tenant FK → plc_session.tenant_uk (CASCADE).
 */
export const plcSessionReflection = pgTable(
  "plc_session_reflection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(), // composite (school_id, session_id) FK below
    // The reflecting STAFF member (single-column SET NULL → global ref_user; nullable as SET NULL requires).
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // The 3 frozen prompts (R387) — fixed columns, not EAV. Nullable = a partial submit is legal.
    q1: text("q1"),
    q2: text("q2"),
    q3: text("q3"),
    // Domain submission time (feeds the R393 within-window check); the answers are append-only (R388).
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    // Facilitator's one-way confirmation stamp (R389) — the ONLY columns this row ever UPDATEs.
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One reflection per (session × member) — the invariant + upsert target. Its (school_id, session_id)
    // prefix serves the per-session reflection read, so no separate index.
    uniqPerSessionUser: unique("uniq_plc_session_reflection").on(
      t.schoolId,
      t.sessionId,
      t.userId,
    ),
    // Composite intra-tenant FK — a cross-tenant session reference is structurally impossible.
    sessionFk: foreignKey({
      columns: [t.schoolId, t.sessionId],
      foreignColumns: [plcSession.schoolId, plcSession.id],
    }).onDelete("cascade"),
  }),
);

/* ============================================================================
 * PLC CPD LEDGER (SHS module 4.6 / INCR-49, migration 0073) — the FINAL increment of the module and its
 * SOLE plc_cpd_* writer. ONE frozen row per (school × session × member): the point-in-time-correct
 * persisted CPD accrual, written at the session WRITE-LOCK instant from the SAME lib/plc/points.ts the
 * INCR-48 register DISPLAYS (display == accrual by construction, R391 — 48 persists events, 49 freezes
 * the award). Attendees are STAFF, so — like every table in this module — there is NO confidential layer,
 * NO student PII, NO parent path: OPERATIONAL / SHOWN (listed in SHOWN_AUDIT_ENTITIES; no reserved audit
 * prefix, so an omitted listing fails the classify-at-creation build guard, R404).
 *
 * ENABLE + FORCE RLS + tenant_isolation (db:policies on dev; db/sql/prod-paste-0076-plc-cpd-ledger.sql by
 * hand on prod) and — via the catalog-driven RESTRICTIVE loop in db/sql/policies.sql — parent_deny
 * (FORCE-RLS + school_id, NO parent_scope → auto-denied). A parent NEVER sees staff CPD. NO parent_scope,
 * NO confidential/REDACTED layer, NO new GUC, NO triggers (portability).
 *
 * FROZEN, POINT-IN-TIME (R400/R401): `attended_pts` + `reflection_pts` are the two CPD arms captured AT
 * settle; the TOTAL is attended+reflection, DERIVED in lib/ — deliberately NO stored total column. There
 * are also deliberately NO plc_id / academic_period_id / session_date columns: each DERIVES via the
 * session_id join (immutable on the session, so it carries no point-in-time benefit worth freezing). No
 * rollup table, no per-event table, no source/evidence/licence/NTC table (all deferred). `settled_at` is
 * the deterministic award instant (the session write-lock instant the freeze is anchored to);
 * `created_at` is the audit write time.
 * ==========================================================================*/
export const plcCpdLedger = pgTable(
  "plc_cpd_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(), // composite (school_id, session_id) FK below
    // The STAFF member (single-column SET NULL → global ref_user; nullable because SET NULL requires it).
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // The two frozen CPD arms captured at settle; total = attended + reflection, DERIVED in lib/ (R401 —
    // NO stored total column). numeric(5,2) mirrors the plc_programme CPD-scalar precision.
    attendedPts: numeric("attended_pts", { precision: 5, scale: 2 }).notNull(),
    reflectionPts: numeric("reflection_pts", { precision: 5, scale: 2 }).notNull(),
    // The deterministic award instant = the session write-lock instant (the point-in-time the freeze is
    // anchored to); distinct from created_at (the row's DB write time, for audit).
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One frozen row per (school × session × member) — the idempotent-upsert conflict target AND the
    // ledger-layer anti-double-count key (≤1 award per member × session). Its (school_id, session_id)
    // prefix serves the settle-time "all members of this session" read, so no separate index. LEAF
    // (nothing FKs here) → NO tenant UK. (A per-member "my CPD across sessions" dashboard read is
    // (school_id, user_id); the ledger is tiny — staff × sessions per school — so it stays a scoped scan,
    // no secondary index until a query pattern measurably needs one.)
    uniqLedger: unique("uniq_plc_cpd_ledger").on(t.schoolId, t.sessionId, t.userId),
    // Defense-in-depth non-negativity (the primary compute is app-layer in lib/plc/points.ts).
    attendedPtsNonneg: check("plc_cpd_ledger_attended_pts_nonneg", sql`${t.attendedPts} >= 0`),
    reflectionPtsNonneg: check(
      "plc_cpd_ledger_reflection_pts_nonneg",
      sql`${t.reflectionPts} >= 0`,
    ),
    // Composite intra-tenant FK → the EXISTING plc_session_tenant_uk (school_id, id) (INCR-48 / 0072) — a
    // cross-tenant session reference is structurally impossible. CASCADE: a session delete removes its
    // frozen ledger row (school delete cascades through it too).
    sessionFk: foreignKey({
      columns: [t.schoolId, t.sessionId],
      foreignColumns: [plcSession.schoolId, plcSession.id],
    }).onDelete("cascade"),
  }),
);
