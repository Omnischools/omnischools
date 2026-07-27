import {
  pgTable,
  uuid,
  text,
  smallint,
  boolean,
  timestamp,
  unique,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./tenancy";

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
 * `tenant_uk UNIQUE(school_id, id)` is authored AHEAD here (nothing references it yet) for INCR-41's
 * vlc_session `(school_id, template_id)` FK — the 0056 sickbay_bed_tenant_uk "author the UK a
 * migration early" precedent — and it is INLINE, ahead of the FK ALTER, per the 0033 discipline.
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
    // Authored-ahead composite-FK target for INCR-41's vlc_session. INLINE (the 0033 discipline).
    tenantUk: unique("vlc_session_template_tenant_uk").on(t.schoolId, t.id),
    slotValid: check("vlc_session_template_slot_valid", sql`${t.slot} IN ('A', 'B')`),
    // Composite intra-tenant FK — a cross-tenant value reference is structurally impossible.
    valueFk: foreignKey({
      columns: [t.schoolId, t.valueId],
      foreignColumns: [vlcValue.schoolId, vlcValue.id],
    }).onDelete("cascade"),
  }),
);
