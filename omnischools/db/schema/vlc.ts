import {
  pgTable,
  uuid,
  text,
  date,
  smallint,
  boolean,
  timestamp,
  unique,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./tenancy";
import { users } from "./identity";
import { students, classes } from "./students";
import { academicPeriod } from "./periods";
import { attendanceStatusEnum } from "./_enums";

/**
 * VLC F0 spine (SHS module 4.5 / INCR-40, migration 0065) — the configuration the whole Values &
 * Life Competencies module reads: the weekly session schedule (day + start + the five phase
 * durations), the per-school list of taught VALUES, and the two-slot session TEMPLATE per value.
 * Nothing operational lands here: no session instance, no attendance, no reflection, no journal
 * (those are INCR-41+). NO new enum — `slot` is a two-value CHECK ('A','B') and the DEAN_OF_STUDENTS
 * role is a free-text ref_role.code the BUILD team seeds, never an appRoleEnum member.
 *
 * All three tables are tenant-scoped and get ENABLE + FORCE RLS + tenant_isolation (db:policies on
 * dev; db/sql/prod-paste-0067-vlc-spine.sql by hand on prod) and — via the catalog-driven loop in
 * db/sql/policies.sql — parent_deny. Owner decision: a parent sees NOTHING in VLC (owner-locked); it
 * is delivered structurally by the parent_deny catalog (FORCE-RLS + school_id, no parent_scope), the
 * same auto-deny every non-parent-readable tenant table receives.
 *
 * Deliberate omissions (the sickbay.ts:55 "no derived / no frozen-lib duplicate" discipline):
 *   • NO `session_end` / `total_minutes` on vlc_programme — both DERIVE from session_start + the five
 *     phase minutes; a stored end/total that can disagree with its parts is the R10 stored-count
 *     failure again.
 *   • NO `term_arc` / phase-NAME / `academic_year` column — the phase names ("Opener", "Small group",
 *     …) and the term arc are frozen editorial in lib/, identical for every school; the academic year
 *     is the shipped academic_period, never re-stored here.
 *   • NO sum-CHECK on the phase minutes — a school may run a 55- or a 70-minute session; the only
 *     invariant is each phase is positive (a zero-minute phase is not a phase).
 *
 * Validation that spans rows stays in lib/ server actions, never a DB trigger (portability).
 */

/**
 * Per-school VLC session programme — ONE row per school, the sickbay_settings / boarding_settings
 * singleton idiom: single-column `school_id UNIQUE` FK, LEAF (nothing references it), NO composite
 * tenant UK. The UNIQUE is both the singleton constraint and the upsert conflict target for the
 * setup editor.
 *
 * A MISSING row is legal and meaningful: readers coalesce it to the frozen defaults below +
 * configured:false. `configured_at` (nullable) distinguishes "declared this schedule" from "never
 * configured"; it is NOT a freeze — every field stays editable afterwards.
 */
export const vlcProgramme = pgTable(
  "vlc_programme",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The singleton constraint + upsert target. Single-column UNIQUE FK → ref_school (the
    // boarding_settings idiom); LEAF, so no composite tenant UK.
    schoolId: uuid("school_id")
      .notNull()
      .unique()
      .references(() => schools.id, { onDelete: "cascade" }),
    // ISO weekday 1..7 (Mon..Sun); Wednesday (3) is the frozen default.
    sessionDay: smallint("session_day").notNull().default(3),
    sessionStart: text("session_start").notNull().default("14:30"), // "HH:MM" (boarding_settings time idiom)
    // The five session phases, in minutes. Defaults sum to 60 but that sum is NOT enforced (a school
    // may run a longer or shorter session); each is only required to be positive.
    openerMin: smallint("opener_min").notNull().default(5),
    smallGroupMin: smallint("small_group_min").notNull().default(25),
    plenaryMin: smallint("plenary_min").notNull().default(15),
    reflectionMin: smallint("reflection_min").notNull().default(10),
    closeMin: smallint("close_min").notNull().default(5),
    // NULL = never configured (readers render the frozen-default empty state). Not a freeze.
    configuredAt: timestamp("configured_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionDayRange: check(
      "vlc_programme_session_day_range",
      sql`${t.sessionDay} BETWEEN 1 AND 7`,
    ),
    openerPositive: check("vlc_programme_opener_min_positive", sql`${t.openerMin} > 0`),
    smallGroupPositive: check(
      "vlc_programme_small_group_min_positive",
      sql`${t.smallGroupMin} > 0`,
    ),
    plenaryPositive: check("vlc_programme_plenary_min_positive", sql`${t.plenaryMin} > 0`),
    reflectionPositive: check(
      "vlc_programme_reflection_min_positive",
      sql`${t.reflectionMin} > 0`,
    ),
    closePositive: check("vlc_programme_close_min_positive", sql`${t.closeMin} > 0`),
  }),
);

/**
 * One row per taught VALUE (e.g. "Respect", "Integrity"), ordered within the school. `school_id`
 * DIRECT — there is deliberately no programme_id: the programme is a per-school singleton, so a value
 * belongs to the school, not to a row that duplicates school_id. `name_twi` is the optional local
 * translation. `term_group` (1..3) buckets the value into a term of the arc.
 *
 * `tenant_uk UNIQUE(school_id, id)` is carried INLINE in CREATE TABLE because it is the composite-FK
 * TARGET of vlc_session_template's `(school_id, value_id)` FK created in the SAME migration (0065):
 * the UNIQUE must exist before that ALTER ... ADD FOREIGN KEY, exactly the 0033 ordering hazard that
 * sickbay_visit_tenant_uk (0057) guarded the same way.
 */
export const vlcValue = pgTable(
  "vlc_value",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    ordinal: smallint("ordinal").notNull(),
    nameEn: text("name_en").notNull(),
    nameTwi: text("name_twi"),
    termGroup: smallint("term_group").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One value per ordinal per school — the display order and the upsert conflict target. Its
    // school_id prefix also serves the "all values for this school" read, so no separate index.
    uniqOrdinal: unique("uniq_vlc_value_ordinal").on(t.schoolId, t.ordinal),
    // Composite-FK target for vlc_session_template.value_id (school_id, id). INLINE, ahead of that
    // FK's ALTER in this same migration (the 0033 / sickbay-0057 ordering discipline).
    tenantUk: unique("vlc_value_tenant_uk").on(t.schoolId, t.id),
    termGroupRange: check("vlc_value_term_group_range", sql`${t.termGroup} BETWEEN 1 AND 3`),
  }),
);

/**
 * One row per (value × slot A|B) — the two session templates a value carries. `slot` is a two-value
 * CHECK ('A','B'), deliberately NOT an enum (a bare two-value domain needs no type). `prompt` is the
 * optional facilitation prompt.
 *
 * `value_id` is a composite (school_id, value_id) intra-tenant FK → vlc_value_tenant_uk, CASCADE — a
 * cross-tenant value reference is structurally impossible, and deleting a value drops its templates.
 * `tenant_uk UNIQUE(school_id, id)` was authored AHEAD (the 0056 sickbay_bed_tenant_uk "author the UK a
 * migration early" precedent) and is now REALISED: it is the composite-FK target of `vlc_session`'s
 * `(school_id, session_template_id)` FK, built below in THIS file (INCR-42a, migration 0067). It is
 * INLINE, ahead of that FK ALTER, per the 0033 discipline.
 */
export const vlcSessionTemplate = pgTable(
  "vlc_session_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    valueId: uuid("value_id").notNull(), // composite (school_id, value_id) FK below
    slot: text("slot").notNull(),
    title: text("title").notNull(),
    prompt: text("prompt"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One template per (value × slot) — the natural key and upsert conflict target.
    uniqValueSlot: unique("uniq_vlc_session_template_value_slot").on(
      t.schoolId,
      t.valueId,
      t.slot,
    ),
    // Composite-FK target for vlc_session.session_template_id (school_id, id) — realised below in this
    // file (INCR-42a). INLINE, ahead of that FK ALTER (the 0033 discipline).
    tenantUk: unique("vlc_session_template_tenant_uk").on(t.schoolId, t.id),
    slotValid: check("vlc_session_template_slot_valid", sql`${t.slot} IN ('A', 'B')`),
    // Composite intra-tenant FK — a cross-tenant value reference is structurally impossible.
    valueFk: foreignKey({
      columns: [t.schoolId, t.valueId],
      foreignColumns: [vlcValue.schoolId, vlcValue.id],
    }).onDelete("cascade"),
  }),
);

/* ============================================================================
 * VLC Peer Guides (SHS module 4.5 / INCR-41, migration 0066) — the OPERATIONAL, SHOWN-audit
 * student-leadership roster + its training-attendance log. Three NEW tenant tables. Peer Guides are
 * senior students (2/class, Forms F2–F3) elected by classmates to facilitate VLC small-groups — a
 * visible, prefect-like role, NOT confidential counselling. The confidential pastoral graph
 * (vlc_pastoral_flag, journal, PG-first *session* attendance) is INCR-42/43 and OUT OF SCOPE here.
 *
 * OWNER-LOCKED (2026-07-27): the class vote is OFFLINE — the Dean records only the OUTCOME. So there
 * is deliberately NO candidate table, NO ballot/vote table, NO vacancy table and NO vote-date storage:
 * a VACANCY is DERIVED (an eligible class with <2 active PGs in the current period), never a stored
 * row (R307). All cross-row validation — the hard cap of 2 active per (class × period) (R301), F2/F3
 * eligibility (R301), one-active-per-student-per-period — lives in lib/vlc/ server actions, NOT the DB
 * (portability; no trigger). The DB enforces only the two structural invariants a constraint can:
 * one active appointment per student per period (partial unique) and one absence row per (training × PG).
 *
 * All three tables are tenant-scoped and get ENABLE + FORCE RLS + tenant_isolation (db:policies on dev;
 * db/sql/prod-paste-0068-vlc-peer-guides.sql by hand on prod) and — via the catalog-driven loop in
 * db/sql/policies.sql — parent_deny. Owner decision #4 LOCKED: a parent sees NOTHING VLC-wide (R309),
 * delivered structurally by the parent_deny catalog (FORCE-RLS + school_id, no parent_scope).
 *
 * NO derived-duplicate scalars (R302/R305): no stored status/count/gender-balance/slot-gender on the
 * roster, no stored attendance/%/status on training — rep-gender derives from students.sex, the 1+1
 * boy/girl target is an ADVISORY read-time flag (never refused), attendance % derives from the absence
 * rows. A stored count that can disagree with its source is the R10 stored-count failure.
 * ==========================================================================*/

/**
 * APPEND-ONLY Peer Guide appointment roster (the bunk_allocation open-row idiom). One row per
 * appointment; `ended_at IS NULL` marks a PG who is CURRENTLY SERVING. Vacate = set `ended_at` (never
 * DELETE); fill = INSERT a fresh row scoped to the SAME current `academic_period_id` (R307). Tenure is
 * ONE academic_period (SHS semester, R303) — no expiry job, the appointment simply scopes out of the
 * next period by its `academic_period_id`; re-selection in a later period is allowed because the partial
 * unique below is period-scoped. `class_id` is the CONSTITUENCY class (a `classes` row — the same
 * form-class unit attendance/gradebook use, R301). `ended_reason` is an optional operational note
 * (SHOWN audit, R308 — welfare detail belongs in INCR-43).
 *
 * `tenant_uk UNIQUE(school_id, id)` is carried INLINE in CREATE TABLE because it is the composite-FK
 * TARGET of vlc_training_absence's (school_id, peer_guide_id) FK created in the SAME migration (0066):
 * the UNIQUE must exist before that ALTER ... ADD FOREIGN KEY (the 0033 ordering hazard). Composite
 * (school_id, X) intra-tenant FKs to students / classes / academic_period make a cross-tenant reference
 * structurally impossible (CASCADE); the appointer stamp is the single-column SET NULL users FK.
 */
export const vlcPeerGuide = pgTable(
  "vlc_peer_guide",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(), // composite (school_id, student_id) FK below
    classId: uuid("class_id").notNull(), // the constituency class — composite (school_id, class_id) FK
    academicPeriodId: uuid("academic_period_id").notNull(), // tenure scope — composite FK
    appointedAt: timestamp("appointed_at", { withTimezone: true }).notNull().defaultNow(),
    // Global-table SET NULL → single column (exeat actor-stamp pattern).
    appointedByUserId: uuid("appointed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    endedAt: timestamp("ended_at", { withTimezone: true }), // null = currently serving (open-row idiom)
    endedReason: text("ended_reason"), // optional operational note (SHOWN)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for vlc_training_absence.peer_guide_id (school_id, id). INLINE, ahead of that
    // FK's ALTER in this same migration (the 0033 / sickbay-0057 ordering discipline).
    tenantUk: unique("vlc_peer_guide_tenant_uk").on(t.schoolId, t.id),
    // At most one ACTIVE appointment per student per period (the one_active_deboard_per_student
    // precedent). Ended rows are exempt via the WHERE, so a student may be re-appointed after stepping
    // aside or in a later period. PARTIAL unique index.
    oneActivePerStudentPeriod: uniqueIndex("uniq_vlc_peer_guide_active")
      .on(t.schoolId, t.studentId, t.academicPeriodId)
      .where(sql`${t.endedAt} IS NULL`),
    // The roster grid + the hard-cap-2 / vacancy reads: active PGs per (class × period).
    byClassPeriod: index("vlc_peer_guide_class_period_idx").on(
      t.schoolId,
      t.classId,
      t.academicPeriodId,
    ),
    // Composite intra-tenant FKs — a cross-tenant student/class/period reference is structurally impossible.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    classFk: foreignKey({
      columns: [t.schoolId, t.classId],
      foreignColumns: [classes.schoolId, classes.id],
    }).onDelete("cascade"),
    periodFk: foreignKey({
      columns: [t.schoolId, t.academicPeriodId],
      foreignColumns: [academicPeriod.schoolId, academicPeriod.periodId],
    }).onDelete("cascade"),
  }),
);

/**
 * Dean-authored monthly PG training event (R305). `academic_year` is TEXT (periods carry academic_year
 * as text — it is NOT an FK). NO stored attendance/status/count — training attendance is the absence
 * rows below and the % DERIVES from them. `tenant_uk UNIQUE(school_id, id)` is carried INLINE because it
 * is the composite-FK TARGET of vlc_training_absence's (school_id, training_id) FK in the SAME migration
 * (0066) — the UNIQUE must exist before that ALTER (the 0033 discipline). LEAF otherwise: single-column
 * school_id FK. `duration_min` CHECK > 0 (a zero-minute training is not a training).
 */
export const vlcTraining = pgTable(
  "vlc_training",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    academicYear: text("academic_year").notNull(), // text, mirrors periods (NOT an FK)
    scheduledDate: date("scheduled_date").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    durationMin: smallint("duration_min").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for vlc_training_absence.training_id (school_id, id). INLINE (the 0033 discipline).
    tenantUk: unique("vlc_training_tenant_uk").on(t.schoolId, t.id),
    // Per-year training calendar read (boarding_calendar_event byYear precedent).
    byYear: index("vlc_training_year_idx").on(t.schoolId, t.academicYear),
    durationPositive: check("vlc_training_duration_min_positive", sql`${t.durationMin} > 0`),
  }),
);

/**
 * PRESENT-BY-DEFAULT PG training-attendance log (the prep_attendance idiom) — one row ONLY for a PG who
 * was NOT present at a training. PRESENT is NEVER a row: present-by-default is the absence of a row, so
 * the attendance % for a training DERIVES as (active PGs − absence rows) / active PGs. `excused` (default
 * false) distinguishes an excused absence; `note` is an optional reason. UNIQUE(school_id, training_id,
 * peer_guide_id) is the upsert conflict target (re-logging the same PG for the same training updates the
 * one row, never a second). LEAF table: NO tenant UK. Composite (school_id, X) intra-tenant FKs to
 * vlc_training / vlc_peer_guide keep both refs intra-tenant (CASCADE); the recorder stamp is the
 * single-column SET NULL users FK.
 */
export const vlcTrainingAbsence = pgTable(
  "vlc_training_absence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    trainingId: uuid("training_id").notNull(), // composite (school_id, training_id) FK below
    peerGuideId: uuid("peer_guide_id").notNull(), // composite (school_id, peer_guide_id) FK below
    excused: boolean("excused").notNull().default(false),
    note: text("note"),
    // Global-table SET NULL → single column (exeat actor-stamp pattern).
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One absence row per (training × PG) — the upsert conflict target. Its (school_id, training_id)
    // prefix also serves the per-training "who was absent" read, so no separate index.
    uniqAbsence: unique("uniq_vlc_training_absence").on(t.schoolId, t.trainingId, t.peerGuideId),
    // Per-PG attendance-% derivation (count a PG's absences across trainings).
    byPeerGuide: index("vlc_training_absence_peer_guide_idx").on(t.schoolId, t.peerGuideId),
    // Composite intra-tenant FKs — a cross-tenant training/peer-guide reference is structurally impossible.
    trainingFk: foreignKey({
      columns: [t.schoolId, t.trainingId],
      foreignColumns: [vlcTraining.schoolId, vlcTraining.id],
    }).onDelete("cascade"),
    peerGuideFk: foreignKey({
      columns: [t.schoolId, t.peerGuideId],
      foreignColumns: [vlcPeerGuide.schoolId, vlcPeerGuide.id],
    }).onDelete("cascade"),
  }),
);

/* ============================================================================
 * VLC Session register (SHS module 4.5 / INCR-42a, migration 0067) — the OPERATIONAL, SHOWN-audit
 * Wednesday live-session register. TWO NEW tenant tables: `vlc_session` (the held-session instance, one
 * per class×date) + `vlc_session_attendance` (present-by-default student P/L/A). This is the same audit
 * class as `attendance` / `prep_attendance`: operational, NO pastoral PII, NO confidential machinery.
 * The confidential pastoral graph (`vlc_pastoral_flag`, reflection/journal, PG-write path) is INCR-42b/43
 * and OUT OF SCOPE here — 42a builds NO `vlc_pastoral_` table, NO reflection/journal, NO small-group or
 * project-brief table, NO facilitation-points column.
 *
 * OWNER-LOCKED (2026-07-27, d): attendance writer = the session's-class Form Master, FM-only DB write
 * ("PG-first" is a UI capture-order convention, NOT a student/PG write grant — no student or PG writes
 * any 42a table). Enforced app-layer in lib/vlc/ (own-class), NOT a trigger.
 *
 * Both tables are tenant-scoped and get ENABLE + FORCE RLS + tenant_isolation (db:policies on dev;
 * db/sql/prod-paste-0069-vlc-session-register.sql by hand on prod) and — via the catalog-driven loop in
 * db/sql/policies.sql — parent_deny. Owner decision #4 LOCKED: a parent sees NOTHING VLC-wide, delivered
 * structurally by the parent_deny catalog (FORCE-RLS + school_id, no parent_scope).
 *
 * DERIVED, NEVER STORED (R311/R312/R315): the lifecycle bar + agenda windows compute from the F0
 * programme's session_start + the five frozen phase durations (the F0 endTime derivation); the "held"
 * state = the row exists; the "auto-locked at 3:33" late-edit guard DERIVES from session_date + the
 * programme window vs now. So there is deliberately NO started_at, NO phase/duration column, NO
 * status/locked/closed, and NO present_count/attendance_rate/late_count summary — every one DERIVES.
 * Cross-row validation (FM own-class write, auto-lock) is app-layer in lib/vlc/, never a DB trigger
 * (portability).
 * ==========================================================================*/

/**
 * The HELD-session instance — one row per (class × date). "Held" = this row exists (R312); there is no
 * status/locked/closed column. `session_template_id` is a composite (school_id, session_template_id) FK →
 * vlc_session_template.tenant_uk (CASCADE): the value and its slot A|B DERIVE THROUGH the template, so
 * there is deliberately NO value_id column. `session_date` is a STORED date (not derived from a timestamp
 * — the prep_attendance tz-boundary discipline). There is NO programme_id (the programme is a per-school
 * singleton) and NO academic_period_id (it DERIVES from session_date). `held_by_user_id` is the
 * single-column SET NULL users actor-stamp.
 *
 * `tenant_uk UNIQUE(school_id, id)` is carried INLINE in CREATE TABLE because it is the composite-FK
 * TARGET of vlc_session_attendance's (school_id, session_id) FK created in the SAME migration (0067):
 * the UNIQUE must exist before that ALTER ... ADD FOREIGN KEY (the 0033 ordering hazard). Composite
 * (school_id, X) intra-tenant FKs to classes / vlc_session_template make a cross-tenant reference
 * structurally impossible (CASCADE).
 */
export const vlcSession = pgTable(
  "vlc_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    classId: uuid("class_id").notNull(), // composite (school_id, class_id) FK below
    sessionTemplateId: uuid("session_template_id").notNull(), // composite (school_id, id) FK below — value+slot derive through it
    sessionDate: date("session_date").notNull(), // stored date (not derived) — avoids the tz-boundary trap
    // Global-table SET NULL → single column (exeat actor-stamp pattern).
    heldByUserId: uuid("held_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for vlc_session_attendance.session_id (school_id, id). INLINE, ahead of that
    // FK's ALTER in this same migration (the 0033 / sickbay-0057 ordering discipline).
    tenantUk: unique("vlc_session_tenant_uk").on(t.schoolId, t.id),
    // One held session per (class × date) — the natural key and the upsert conflict target. Its
    // (school_id, class_id) prefix also serves the per-class session history read, so no separate index.
    uniqPerClassDate: unique("uniq_vlc_session").on(t.schoolId, t.classId, t.sessionDate),
    // Composite intra-tenant FKs — a cross-tenant class / template reference is structurally impossible.
    classFk: foreignKey({
      columns: [t.schoolId, t.classId],
      foreignColumns: [classes.schoolId, classes.id],
    }).onDelete("cascade"),
    templateFk: foreignKey({
      columns: [t.schoolId, t.sessionTemplateId],
      foreignColumns: [vlcSessionTemplate.schoolId, vlcSessionTemplate.id],
    }).onDelete("cascade"),
  }),
);

/**
 * PRESENT-BY-DEFAULT student session-attendance log (the prep_attendance idiom) — one row ONLY for a
 * student who was NOT present at the session. PRESENT is NEVER a row: present-by-default is the absence
 * of a row (the parent vlc_session confirms the register was taken), so present = enrolled − ABSENT rows
 * and the rate/counts all DERIVE (R315 — NO stored present_count/attendance_rate/late_count/status). LATE
 * is a present sub-state, so `minutes_late` (nullable smallint, CHECK ≥ 0) is set for LATE. `status`
 * REUSES the canonical 5-status attendanceStatusEnum (NOT a forked VLC enum) — capture surfaces P/L/A;
 * E/M are storable-not-rejected so the M-not-A seam + a future Sickbay hook stay open, but 42a builds no
 * such control. The "PG-gold marked first" highlight DERIVES from the INCR-41 roster — there is NO
 * marked_by_pg column and NO PG on the row (R313).
 *
 * LEAF table: NO tenant UK (nothing references it). UNIQUE(school_id, session_id, student_id) is the
 * upsert conflict target (re-marking the same student for the same session updates the one row, never a
 * second); its (school_id, session_id) prefix also serves the per-session roster read, so no separate
 * index. Composite (school_id, X) intra-tenant FKs to vlc_session / students keep both refs intra-tenant
 * (CASCADE); the recorder stamp is the single-column SET NULL users FK. FM-only write (owner d) is
 * enforced app-layer in lib/vlc/, not the DB.
 */
export const vlcSessionAttendance = pgTable(
  "vlc_session_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(), // composite (school_id, session_id) FK below
    studentId: uuid("student_id").notNull(), // composite (school_id, student_id) FK below
    // Reuses the canonical 5-status attendance enum; capture surfaces P/L/A (E/M storable-not-rejected).
    status: attendanceStatusEnum("status").notNull(),
    minutesLate: smallint("minutes_late"), // nullable — set for LATE
    note: text("note"),
    // Global-table SET NULL → single column (exeat actor-stamp pattern).
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One attendance row per (session × student) — the upsert conflict target. Its (school_id, session_id)
    // prefix also serves the per-session "who was not present" roster read, so no separate index.
    uniqPerSessionStudent: unique("uniq_vlc_session_attendance").on(
      t.schoolId,
      t.sessionId,
      t.studentId,
    ),
    minutesLateNonneg: check(
      "vlc_session_attendance_minutes_late_nonneg",
      sql`${t.minutesLate} >= 0`,
    ),
    // Composite intra-tenant FKs — a cross-tenant session / student reference is structurally impossible.
    sessionFk: foreignKey({
      columns: [t.schoolId, t.sessionId],
      foreignColumns: [vlcSession.schoolId, vlcSession.id],
    }).onDelete("cascade"),
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  }),
);

/* ============================================================================
 * VLC Pastoral flag (SHS module 4.5 / INCR-42b, migration 0068) — the module's FIRST CONFIDENTIAL
 * pastoral-PII table and its sensitivity boundary. ONE new tenant table: `vlc_pastoral_flag`. This is
 * a different audit class from 42a's operational register — it is REDACTED (the reserved
 * `vlc_pastoral_` prefix branch in isRedactedAuditEntity, wired by the build; audit records metadata
 * only), and its content is READ by a single server-only path (lib/vlc/pastoral-data.ts).
 *
 * OWNER-LOCKED (INCR-42 batch): (b) flag READ = FM(own-class) + DEAN_OF_STUDENTS ONLY (ADMIN barred,
 * HM excluded); (c) flag CREATE = FM + DEAN — the PG is a `surfaced_by` DATA field, NOT a writer;
 * narrative/case-file is INCR-43; (#4) parents see NOTHING VLC-wide.
 *
 * 🔴 THE ACCESS MODEL IS SPLIT ACROSS TWO LAYERS (Kofi R318, deliberately):
 *   • TENANT + PARENT isolation is RLS — this table gets ENABLE + FORCE + tenant_isolation (db:policies
 *     on dev; db/sql/prod-paste-0070-vlc-pastoral-flag.sql by hand on prod — THE MODULE'S MOST
 *     LEAK-CRITICAL PASTE: skip it and the confidential table ships with NO RLS → cross-school PII
 *     leak) and — via the catalog-driven loop in db/sql/policies.sql — parent_deny (owner #4; FORCE-RLS
 *     + school_id, NO parent_scope, so the loop auto-denies it).
 *   • The ROLE gate ([FM, DEAN]) and the FM OWN-CLASS scoping are APP-LAYER (lib/vlc/), NOT RLS and NOT
 *     a trigger. Own-class is a STATIC identity match (the flagged student's class.class_teacher_user_id
 *     === caller.userId), not a revocable/expiring grant, so the chronic-register's staff_grant_scope
 *     machinery (R114) does NOT transfer; 42a's identical own-class WRITE mechanism is already
 *     Sarah-CLEARED. So NO new GUC, NO new RLS boundary, NO staff_grant_scope here.
 *
 * Deliberate omissions (the sickbay/vlc "no derived, no narrative" discipline — R317/R323 scope fence):
 *   • NO narrative / case-file / note-thread / character-paragraph column — that is INCR-43. `context`
 *     is a SHORT ≤280 locator, and the 280-cap is the PHYSICAL scope fence keeping the INCR-43 `.fc-body`
 *     narrative out of this table.
 *   • NO derived scalars — no `active`/`is_open` bool, no `severity_rank`, no count. ACTIVE derives from
 *     `resolved_at IS NULL` (the open-row idiom); severity ordering is frozen editorial in lib/.
 *   • NO tenant_uk in 42b — the flag was LEAF (nothing in 42b FKed to it). ⚠ INCR-43a RETROFITS a
 *     `vlc_pastoral_flag_tenant_uk UNIQUE(school_id, id)` below because vlc_pastoral_case's composite FK
 *     targets it (R331). NO unique-on-active — multiple concurrent open flags per student are allowed
 *     (two staff may raise independently).
 *   • `severity` is TEXT + a CHECK allow-list (the frozen `VLC_PASTORAL_SEVERITY` in lib/), NOT a pg
 *     enum — a bare three-value domain the app owns needs no type (the vlc_session_template.slot idiom).
 *
 * Validation that spans rows (the role gate, own-class scoping, severity/context shape) lives in
 * lib/vlc/ server actions; the three single-row CHECKs below are defense-in-depth, never the primary
 * control. NO TRIGGERS (portability).
 */
export const vlcPastoralFlag = pgTable(
  "vlc_pastoral_flag",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    // FIRST-CLASS column (composite (school_id, student_id) FK → students, CASCADE): INCR-45's
    // isPastorallyFlagged existence-check reads THIS column, never a confidential one.
    studentId: uuid("student_id").notNull(), // composite (school_id, student_id) FK below
    // NULLABLE composite (school_id, session_id) FK → vlc_session.tenant_uk, ON DELETE NO ACTION: 42a
    // sessions are append-only/never deleted so it never fires, and a Dean may raise a session-less
    // flag (session_id NULL — the composite FK is MATCH SIMPLE, so a NULL member skips the check).
    sessionId: uuid("session_id"), // composite (school_id, session_id) FK below — nullable, NO ACTION
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
    // The FM/Dean who COMMITTED the flag (SET NULL → global ref_user). ⚠ Distinct from the surface's PG
    // "Raised by" — that is `surfaced_by` (display DATA), never this actor stamp.
    raisedByUserId: uuid("raised_by_user_id").references(() => users.id, { onDelete: "set null" }),
    // Free-text PG attribution — DISPLAY DATA in NO access decision (OC1). ≤80 CHECK (defense-in-depth).
    surfacedBy: text("surfaced_by"),
    // Frozen allow-list VLC_PASTORAL_SEVERITY (lib/) — text + CHECK, deliberately NOT a pg enum (OC2).
    severity: text("severity").notNull(),
    // The SHORT `.sub` locator (nullable ≤280) — the 280-cap is the physical fence vs the INCR-43 narrative.
    context: text("context"),
    // NULL = active (the open-row idiom); set = resolved. `resolved_by_user_id` SET NULL → global ref_user.
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // R331 (INCR-43a) RETROFIT — the composite-FK TARGET of vlc_pastoral_case's (school_id, flag_id) FK.
    // 42b built this flag LEAF with no tenant_uk; 43a's vlc_pastoral_case now references it, so the UNIQUE
    // is added here. In migration 0069 the UNIQUE ALTER is ordered AHEAD of the case FK ALTER (the
    // 0033/0057 target-before-FK discipline). 🔴 prod's flag came from the hand-run prod-paste-0070, NOT a
    // replayed migration, so prod lacks this UNIQUE until prod-paste-0071 ALTERs it in (idempotent, FIRST).
    tenantUk: unique("vlc_pastoral_flag_tenant_uk").on(t.schoolId, t.id),
    // The INCR-45 existence-check AND the FM own-class read filter both look up active flags by student;
    // this makes both an indexed lookup. Partial (WHERE resolved_at IS NULL) — NOT unique (concurrent
    // open flags per student are allowed).
    activeByStudent: index("vlc_pastoral_flag_active_idx")
      .on(t.schoolId, t.studentId)
      .where(sql`${t.resolvedAt} IS NULL`),
    // Defense-in-depth single-row CHECKs (the primary validation is app-layer in lib/vlc/). char_length
    // is NULL-safe: a NULL surfaced_by/context passes (the columns are nullable).
    surfacedByLen: check(
      "vlc_pastoral_flag_surfaced_by_len",
      sql`char_length(${t.surfacedBy}) <= 80`,
    ),
    severityValid: check(
      "vlc_pastoral_flag_severity_valid",
      sql`${t.severity} IN ('NOTE', 'CONCERN', 'CRISIS')`,
    ),
    contextLen: check("vlc_pastoral_flag_context_len", sql`char_length(${t.context}) <= 280`),
    // Composite intra-tenant FKs. The student CASCADEs (first-class, cross-tenant ref impossible); the
    // session is NULLABLE + NO ACTION (append-only sessions never delete; a session-less flag is legal).
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    sessionFk: foreignKey({
      columns: [t.schoolId, t.sessionId],
      foreignColumns: [vlcSession.schoolId, vlcSession.id],
    }).onDelete("no action"),
  }),
);

/* ============================================================================
 * VLC Casework (SHS module 4.5 / INCR-43a, migration 0069) — the module's CONFIDENTIAL pastoral
 * READ boundary. FOUR NEW tenant tables, all `vlc_pastoral_*` so the reserved REDACTED-audit prefix
 * branch (isRedactedAuditEntity → startsWith("vlc_pastoral_")) auto-covers them — ZERO redaction.ts
 * edit, none in SHOWN (R324/R332). Same confidential audit class as 42b's flag; content is read by the
 * ONE server-only path lib/vlc/pastoral-data.ts (the reader extension is APP code, R329 — not here).
 *
 * OWNER-LOCKED (INCR-43 batch): STAFF-FACING — the FM records the journal + the PG observation; the
 * named PG is attributed as `observed_by` free-text DATA (the 42b surfaced_by precedent), NEVER a
 * principal (no student/PG login/write/self-read; PG reads NOTHING — structural). READ = FM(own-class)
 * + DEAN_OF_STUDENTS only (ADMIN/HM barred); WRITE = the same, via canWritePastoralFlag reused VERBATIM.
 * Both gates are APP-LAYER (lib/vlc/), NOT RLS and NOT a trigger — own-class is a STATIC identity match
 * (the student's class.class_teacher_user_id === caller.userId), the 42a/42b cleared mechanism. NO new
 * role/group/enum/GUC/RLS-shape.
 *
 * All four are tenant-scoped and get ENABLE + FORCE RLS + tenant_isolation (db:policies on dev;
 * db/sql/prod-paste-0071-vlc-casework.sql by hand on prod — LEAK-CRITICAL: skip it and four confidential
 * tables ship with NO RLS → cross-school pastoral-PII leak) and — via the catalog-driven parent_deny loop
 * in db/sql/policies.sql — parent_deny (owner #4: a parent sees NOTHING VLC-wide; FORCE-RLS + school_id,
 * NO parent_scope). All four are LEAF (nothing FKs to them).
 *
 * APPEND-ONLY vs EDITABLE (R325–R328): journal / note / observation are APPEND-ONLY — corrections are a
 * new row, so NO `updated_at`, no update/delete action, no status/open/closed column (the surface's
 * "N open" DERIVES from 42b flags' resolved_at IS NULL, never a stored bool). vlc_pastoral_case is the
 * SOLE editable table: ONE running summary per flag (1:1 UNIQUE(school_id, flag_id)); an edit bumps
 * summary + last_revised_at + last_revised_by. Entry date / word count / prompt / value all DERIVE — NO
 * `entry_date`, no derived-scalar column anywhere (R325). Composite (school_id, X) intra-tenant FKs make
 * a cross-tenant reference structurally impossible; the FM/author actor stamps are single-column SET NULL
 * users FKs. Validation that spans rows is app-layer in lib/vlc/, never a DB trigger (portability).
 * ==========================================================================*/

/**
 * R325 — Reflection JOURNAL entry, FM-recorded as DATA, APPEND-ONLY (HARD). One row per reflection; a
 * correction is a NEW row (no edit/delete/backdate — structurally absent, so NO `updated_at`). Entry
 * DATE derives (the session's session_date, else created_at — NO `entry_date` column); word count /
 * prompt / value all derive from `body` + the F0 template. `session_id` is a NULLABLE composite
 * (school_id, session_id) FK → vlc_session.tenant_uk, NO ACTION (append-only sessions never delete; a
 * session-less journal entry is legal — a NULL member is MATCH SIMPLE, so the check is skipped). LEAF —
 * nothing FKs to it, so NO tenant_uk. NO unique (corrections are appends). Index (school_id, student_id).
 */
export const vlcPastoralJournal = pgTable(
  "vlc_pastoral_journal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(), // composite (school_id, student_id) FK below
    sessionId: uuid("session_id"), // NULLABLE composite (school_id, session_id) FK below — NO ACTION
    // The FM who recorded the entry (SET NULL → global ref_user). The student is `student_id`; there is no
    // student/PG author — this is staff-recorded DATA.
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Per-student journal stream read (the sole reader filters by student after the own-class fence).
    byStudent: index("vlc_pastoral_journal_student_idx").on(t.schoolId, t.studentId),
    // Defense-in-depth single-row cap (primary validation is app-layer in lib/vlc/).
    bodyLen: check("vlc_pastoral_journal_body_len", sql`char_length(${t.body}) <= 4000`),
    // Composite intra-tenant FKs — the student CASCADEs; the session is NULLABLE + NO ACTION.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    sessionFk: foreignKey({
      columns: [t.schoolId, t.sessionId],
      foreignColumns: [vlcSession.schoolId, vlcSession.id],
    }).onDelete("no action"),
  }),
);

/**
 * R326 — FM/Dean NOTE, APPEND-ONLY, student-scoped. One row per note; append-only (NO `updated_at`,
 * create-only). `open` is deliberately NOT a column — it DERIVES from 42b flags (resolved_at IS NULL);
 * the surface "2 open · 4 total" = count(notes) + count(unresolved flags). `author_user_id` is the
 * single-column SET NULL users stamp. LEAF — no tenant_uk. Index (school_id, student_id).
 */
export const vlcPastoralNote = pgTable(
  "vlc_pastoral_note",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(), // composite (school_id, student_id) FK below
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStudent: index("vlc_pastoral_note_student_idx").on(t.schoolId, t.studentId),
    bodyLen: check("vlc_pastoral_note_body_len", sql`char_length(${t.body}) <= 4000`),
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  }),
);

/**
 * R327 — PG OBSERVATION, FM-recorded, APPEND-ONLY, the PG is DATA not a principal. `observed_by` is
 * free-text ≤80 naming the PG (the 42b surfaced_by precedent — deliberately NO `peer_guide_id` FK: the
 * PG never becomes a foreign-key principal, and PG reads NOTHING — structural, no PG login/read path).
 * `recorded_by_user_id` is the FM who committed it (SET NULL → global ref_user). Append-only. LEAF — no
 * tenant_uk. Index (school_id, student_id).
 */
export const vlcPastoralObservation = pgTable(
  "vlc_pastoral_observation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(), // composite (school_id, student_id) FK below
    // The PG named as free-text DATA (NOT an FK principal). NOT NULL, ≤80 (the surfaced_by precedent).
    observedBy: text("observed_by").notNull(),
    // The FM who recorded the observation (SET NULL → global ref_user).
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStudent: index("vlc_pastoral_observation_student_idx").on(t.schoolId, t.studentId),
    observedByLen: check("vlc_pastoral_observation_observed_by_len", sql`char_length(${t.observedBy}) <= 80`),
    bodyLen: check("vlc_pastoral_observation_body_len", sql`char_length(${t.body}) <= 4000`),
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  }),
);

/**
 * R328 — CASE: ONE editable running summary per flag (1:1), the SOLE non-append-only casework table.
 * `flag_id` is a composite (school_id, flag_id) FK → vlc_pastoral_flag.tenant_uk (the R331 retrofit
 * above), CASCADE — a cross-tenant flag reference is structurally impossible and deleting the flag drops
 * its case. `UNIQUE(school_id, flag_id)` enforces the 1:1 (lazily created — a flag may have no case yet;
 * at most one). EDITABLE by FM(own)+Dean: an update bumps `summary` + `last_revised_at` +
 * `last_revised_by_user_id`. NO delete. LEAF — nothing FKs to it, so NO tenant_uk.
 */
export const vlcPastoralCase = pgTable(
  "vlc_pastoral_case",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    flagId: uuid("flag_id").notNull(), // composite (school_id, flag_id) FK below → the R331 flag tenant_uk
    summary: text("summary").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    lastRevisedAt: timestamp("last_revised_at", { withTimezone: true }).notNull().defaultNow(),
    lastRevisedByUserId: uuid("last_revised_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    // 1:1 — at most one case per flag (the upsert conflict target). Its (school_id, flag_id) prefix also
    // serves the per-flag case lookup, so no separate index.
    uniqPerFlag: unique("uniq_vlc_pastoral_case_flag").on(t.schoolId, t.flagId),
    summaryLen: check("vlc_pastoral_case_summary_len", sql`char_length(${t.summary}) <= 8000`),
    // Composite intra-tenant FK → the flag's R331 tenant_uk (school_id, id), CASCADE.
    flagFk: foreignKey({
      columns: [t.schoolId, t.flagId],
      foreignColumns: [vlcPastoralFlag.schoolId, vlcPastoralFlag.id],
    }).onDelete("cascade"),
  }),
);

/* ============================================================================
 * VLC Character paragraph (SHS module 4.5 / INCR-43b, migration 0070) — the FM-authored school-leaver
 * reference output, and the ONE VLC table with a WIDER app-read set. ONE new confidential tenant table:
 * `vlc_pastoral_paragraph`. Same `vlc_pastoral_` family → the reserved REDACTED-audit prefix branch
 * (isRedactedAuditEntity → startsWith("vlc_pastoral_")) auto-covers it — ZERO redaction.ts / SHOWN edit
 * (R335/R339). Redaction ≠ read-gate: the audit diff is REDACTED even though its app-read admits the HM.
 *
 * OWNER-LOCKED (INCR-43 batch): #6 FM-AUTHORED free text, NO AI / NO auto-summary (the surface's
 * "auto-drafted/regenerates" framing is OMIT-NOT-FAKED); #2 the Headmaster READS this paragraph
 * (school-wide, paragraph-only — EXCLUDED from the 43a journal/note/observation/case); #4 parents see
 * NOTHING here (they receive the paragraph at leaver via INCR-45, R341).
 *
 * 🔴 THE ACCESS MODEL — one table, TWO read audiences, split across layers (R336, deliberately):
 *   • TENANT + PARENT isolation is RLS — ENABLE + FORCE + tenant_isolation (db:policies on dev;
 *     db/sql/prod-paste-0072-vlc-paragraph.sql by hand on prod — LEAK-CRITICAL: skip it and the
 *     confidential paragraph ships with NO RLS → cross-school PII leak) and — via the catalog-driven
 *     parent_deny loop in db/sql/policies.sql — parent_deny (owner #4; FORCE-RLS + school_id, NO
 *     parent_scope, so the loop auto-denies it).
 *   • The WIDER read set (own-class FM + Dean + HEADMASTER) is APP-LAYER (lib/vlc/) via a SEPARATE
 *     reader (lib/vlc/paragraph-data.ts) behind a SEPARATE route — NOT RLS. The HM is same-tenant, so
 *     RLS passes for him; the app-layer reader is what scopes HM to the paragraph-only (and to FINALISED
 *     rows). RLS here enforces ONLY tenant + parent isolation. NO new GUC, NO new RLS boundary.
 *
 * EDITABLE-IN-PLACE, unlike the 43a append-only tables (hence it HAS `updated_at`): ONE row per student,
 * lazily created, retunable while `locked_at IS NULL`, frozen once set (R338 — the write re-checks
 * canWritePastoralFlag AND locked_at IS NULL app-layer; the lock is one-way for the year, no unlock UI).
 * LEAF — nothing FKs to it, so NO tenant_uk. NO derived scalars (word count / state derive in lib/), NO
 * triggers (portability). The single-row `body` CHECK ≤3000 is defense-in-depth; the primary caps are
 * app-layer. `UNIQUE(school_id, student_id)` is the one-per-student invariant AND the upsert conflict
 * target AND the INCR-45 leaver read key (SELECT body WHERE student_id = X AND locked_at IS NOT NULL) —
 * its (school_id) prefix + student_id serve that point lookup, so no separate index.
 * ==========================================================================*/
export const vlcPastoralParagraph = pgTable(
  "vlc_pastoral_paragraph",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(), // composite (school_id, student_id) FK below
    // The FM's free-text school-leaver character paragraph. NOT NULL, ≤3000 (defense-in-depth CHECK;
    // retunable — the primary cap is app-layer). FM-authored ONLY — no machine derivation (owner #6).
    body: text("body").notNull(),
    // The FM/Dean who first authored the paragraph (SET NULL → global ref_user).
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    // The FM/Dean who last edited it (SET NULL → global ref_user).
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    // NULL = draft/editable; set = frozen for the year (R338). The write rejects when non-NULL.
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedByUserId: uuid("locked_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // ONE paragraph per student (lazily created) — the invariant, the upsert conflict target, and the
    // INCR-45 leaver read key. Its (school_id, student_id) prefix serves the point lookup, so no index.
    uniqPerStudent: unique("uniq_vlc_pastoral_paragraph_student").on(t.schoolId, t.studentId),
    // Defense-in-depth single-row cap (primary validation is app-layer in lib/vlc/).
    bodyLen: check("vlc_pastoral_paragraph_body_len", sql`char_length(${t.body}) <= 3000`),
    // Composite intra-tenant FK — a cross-tenant student reference is structurally impossible. CASCADE.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  }),
);
