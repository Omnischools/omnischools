import {
  pgTable,
  uuid,
  text,
  date,
  boolean,
  integer,
  jsonb,
  numeric,
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
import { academicPeriod } from "./periods";
import { attendanceStatusEnum } from "./_enums";
import { classes, houses, studentGuardians } from "./students";

/**
 * PTA structure-setup spine (SHS module 4.7 / INCR-50, migration 0074) — the Parent-Teacher Association
 * config trunk, the VLC-40 / PLC-47 analogue. THIS INCREMENT IS THE SPINE ONLY: the four-tier config, the
 * idempotently-GENERATED instances, and the append-only dues-rate history. NO permissions model (officers
 * are a DATA LIST, not roles — OC3), NO meetings, NO invoices (those are INCR-51/52/54).
 *
 * All three tables are tenant-scoped, OPERATIONAL / SHOWN (each `pta*` entity is listed in
 * SHOWN_AUDIT_ENTITIES; none carries a reserved audit prefix, so an omitted one would FAIL the
 * classify-at-creation build guard, R416). ENABLE + FORCE RLS + tenant_isolation (db:policies on dev;
 * db/sql/prod-paste-0077-pta-spine.sql by hand on prod) and — via the catalog-driven RESTRICTIVE loop in
 * db/sql/policies.sql — parent_deny (all three are FORCE-RLS + school_id and carry NO parent_scope, so the
 * loop auto-denies them). A parent sees NOTHING of PTA structure in this increment; parent_scope RETURNS at
 * INCR-55, NOT here (R416).
 *
 * Composite `(school_id, …)` intra-tenant FKs make a cross-tenant reference structurally impossible
 * ([[composite-tenant-fks]]); the only single-column SET NULL is `changed_by_user_id` → the GLOBAL
 * `ref_user` (a composite intra-tenant FK is impossible there — ref_user has no school_id). NO triggers
 * (portability): idempotent generation (R411), archived-scope→CLOSED cascade (R412), forward-only-history
 * append + backdating rejection (R413) and the config write-gate (PTA_CONFIG_WRITE_ROLES, R415) all live in
 * lib/pta/ server actions. The 4 tier types (R410) and dues basis/cadence are TEXT + CHECK, NOT enums (the
 * plc.type / senior-CHECK idiom — a fixed, app-owned, non-extensible domain needs no pg enum).
 */

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/**
 * Per-school × tier config — ONE row per (school × tier), `UNIQUE(school_id, tier_type)` (R410). The four
 * tiers are FIXED (FORM/HOUSE/GENERAL/EMERGENCY) via a CHECK, not an enum, not extensible. Per-tier flat
 * columns (active, frequency label, the officer-role name LIST, quorum text, the dues contract) + a
 * `tier_settings` jsonb bag round-tripped OPAQUE (NOT EAV — the spine never branches on it, R410).
 *
 * A MISSING row is legal and meaningful: `coalescePtaTiers` (lib/pta/defaults.ts) coalesces it to the
 * frozen per-tier defaults (Form active + dues PER_STUDENT/PER_TERM; House active + dues-off; General
 * active + dues PER_FAMILY/PER_YEAR; Emergency available + no-dues) with configured:false, never null/throw
 * (R417). `configured_at` (nullable) distinguishes "declared this tier" from "never configured"; it is NOT
 * a freeze — every field stays editable afterwards.
 *
 * `officer_roles` is a JSON array of OFFICE-NAME STRINGS — a data list, NOT permissions (the OC3 boundary,
 * R410). `dues_*` are the current rate the INCR-54 invoicer reads; EVERY change also appends an immutable
 * pta_dues_config_history row (R413). EMERGENCY (R414) has no standing officers and no standing dues — the
 * `pta_tiers_config_emergency_no_officers_no_dues` CHECK enforces `officer_roles = '[]'` AND
 * `dues_enabled = false` at the DB layer (defense in depth; the primary validation is app-layer).
 *
 * `pta_tiers_config_tenant_uk UNIQUE(school_id, id)` is carried INLINE — it is not a downstream FK target
 * today, but is declared for the [[composite-tenant-fks]] uniformity and future scope; the
 * `UNIQUE(school_id, tier_type)` natural key IS the FK target of pta_dues_config_history below (that FK
 * must see this UNIQUE before its ALTER … ADD FOREIGN KEY — the 0033 target-before-FK ordering discipline,
 * satisfied because both live in this same migration and the CREATE TABLE emits the UNIQUE first).
 */
export const ptaTiersConfig = pgTable(
  "pta_tiers_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    // The four FIXED tiers (R410) — a CHECK, NOT an enum (not extensible; the plc.type idiom).
    tierType: text("tier_type").notNull(),
    active: boolean("active").notNull().default(true),
    frequencyNorm: text("frequency_norm"), // free-text cadence label (e.g. "Once per term")
    // Office-NAME strings — a data list, NOT permissions (OC3 boundary, R410). NOT NULL default '[]' so the
    // Emergency CHECK (officer_roles = '[]') is a total comparison, never NULL.
    officerRoles: jsonb("officer_roles").notNull().default(sql`'[]'::jsonb`),
    quorumRule: text("quorum_rule"), // free text (e.g. "Half of registered parents + 1")
    duesEnabled: boolean("dues_enabled").notNull().default(false),
    duesAmount: money("dues_amount"), // nullable — null when dues disabled (the repo money type, numeric(12,2))
    duesBasis: text("dues_basis"), // CHECK PER_STUDENT|PER_FAMILY (nullable → passes when dues off)
    duesCadence: text("dues_cadence"), // CHECK PER_TERM|PER_YEAR|ONE_OFF (nullable → passes when dues off)
    // Heterogeneous per-tier scalars, round-tripped OPAQUE (NOT EAV — the spine never branches on it, R410).
    tierSettings: jsonb("tier_settings").notNull().default(sql`'{}'::jsonb`),
    // NULL = never configured (readers render the coalesced default). Not a freeze (R417).
    configuredAt: timestamp("configured_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // ONE row per (school × tier) — the singleton constraint AND the upsert conflict target for the setup
    // editor; ALSO the natural-key FK target of pta_dues_config_history (school_id, tier_type). Its
    // (school_id) prefix serves the "all tiers for this school" read, so no separate index.
    uniqTier: unique("uniq_pta_tiers_config").on(t.schoolId, t.tierType),
    // Composite tenant UK (school_id, id) — [[composite-tenant-fks]] uniformity, carried inline.
    tenantUk: unique("pta_tiers_config_tenant_uk").on(t.schoolId, t.id),
    // The four fixed tiers (R410). NOT NULL, so the allow-list is mandatory.
    tierTypeValid: check(
      "pta_tiers_config_tier_type_valid",
      sql`${t.tierType} IN ('FORM', 'HOUSE', 'GENERAL', 'EMERGENCY')`,
    ),
    // NULL-safe: a NULL basis/cadence (dues disabled) passes; a set value must be in the allow-list.
    duesBasisValid: check(
      "pta_tiers_config_dues_basis_valid",
      sql`${t.duesBasis} IN ('PER_STUDENT', 'PER_FAMILY')`,
    ),
    duesCadenceValid: check(
      "pta_tiers_config_dues_cadence_valid",
      sql`${t.duesCadence} IN ('PER_TERM', 'PER_YEAR', 'ONE_OFF')`,
    ),
    // R414 — EMERGENCY carries no standing officers and no standing dues. Written as "not emergency, OR both
    // hold": a non-emergency tier is unconstrained; an emergency tier must have officer_roles='[]' AND
    // dues_enabled=false. (dues_amount is left free — it is meaningless with dues_enabled=false either way.)
    emergencyNoOfficersNoDues: check(
      "pta_tiers_config_emergency_no_officers_no_dues",
      sql`${t.tierType} <> 'EMERGENCY' OR (${t.officerRoles} = '[]'::jsonb AND ${t.duesEnabled} = false)`,
    ),
  }),
);

/**
 * The GENERATED PTA instances (R411) — one row per real association. Generation is an EXPLICIT idempotent
 * scope-keyed upsert in lib/pta/ (NOT cron): N Form (one per active class) + M House (one per active House)
 * + 1 General + 0 Emergency (Emergency is convened on-demand in INCR-52, R414). Re-running Generate is a
 * no-op — the three PARTIAL unique indexes below are the idempotency crux.
 *
 * SCOPE = two NULLABLE typed composite-FK columns (`class_id` → class, `house_id` → house), NOT a
 * polymorphic scope_ref (preserving [[composite-tenant-fks]] — a single-column typed FK per scope means a
 * cross-tenant scope is structurally impossible). The `ptas_tier_scope_binding` CHECK pins exactly one
 * scope shape per tier: FORM ⇒ class_id set & house_id null; HOUSE ⇒ house_id set & class_id null;
 * GENERAL/EMERGENCY ⇒ both null. Scope FKs are `onDelete RESTRICT` (R412): an archived class/House is
 * SOFT-archived (active=false) and its PTA set to status=CLOSED in lib/, never hard-deleted — a real
 * DELETE of a scope row is refused rather than silently orphaning or cascading a PTA away.
 *
 * NO `name` column (R411): the display name is DERIVED from the class/House join at read ("{class} PTA").
 * `status` is a 2-value CHECK (ACTIVE default | CLOSED) — CLOSED is the soft, preserved, read-only state a
 * de-activated scope or toggled-off tier produces; re-activating re-opens the SAME row (R412).
 *
 * `ptas_tenant_uk UNIQUE(school_id, id)` is carried INLINE in CREATE TABLE because it is the composite-FK
 * TARGET of the INCR-51/52/54 tables (officers, meetings, invoices) — declared ahead per the 0033
 * target-before-FK discipline even though no child exists yet in this migration.
 *
 * ⚠ THE GENERAL SINGLETON IS A PARTIAL index on (school_id) ALONE, not a plain UNIQUE (PTA50-8). A General
 * PTA's scope is (class_id=NULL, house_id=NULL); a plain UNIQUE(school_id, class_id, house_id) treats two
 * NULL scopes as DISTINCT and would permit a second General PTA. The partial `UNIQUE(school_id) WHERE
 * tier_type='GENERAL'` is what makes re-Generate idempotent for the singleton tier.
 */
export const ptas = pgTable(
  "ptas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    // Same four fixed tiers as the config (R410) — a CHECK, NOT an enum.
    tierType: text("tier_type").notNull(),
    // Nullable typed composite-FK scope columns (below). Exactly one is set for FORM/HOUSE; both NULL for
    // GENERAL/EMERGENCY — pinned by the tier↔scope CHECK.
    classId: uuid("class_id"),
    houseId: uuid("house_id"),
    // Soft lifecycle (R412): CLOSED = preserved read-only; re-activate re-opens the SAME row.
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for the INCR-51/52/54 child tables (school_id, id). INLINE, ahead of those FKs
    // (the 0033 / plc_tenant_uk ordering discipline). Its (school_id) prefix ALSO serves the "all PTAs for
    // this school" read (incl. the Emergency instances the partial indexes below don't cover), so no
    // separate school index.
    tenantUk: unique("ptas_tenant_uk").on(t.schoolId, t.id),
    tierTypeValid: check(
      "ptas_tier_type_valid",
      sql`${t.tierType} IN ('FORM', 'HOUSE', 'GENERAL', 'EMERGENCY')`,
    ),
    statusValid: check("ptas_status_valid", sql`${t.status} IN ('ACTIVE', 'CLOSED')`),
    // R411 — tier binds scope shape exactly. Exactly one branch holds per row.
    tierScopeBinding: check(
      "ptas_tier_scope_binding",
      sql`(${t.tierType} = 'FORM' AND ${t.classId} IS NOT NULL AND ${t.houseId} IS NULL)
        OR (${t.tierType} = 'HOUSE' AND ${t.houseId} IS NOT NULL AND ${t.classId} IS NULL)
        OR (${t.tierType} IN ('GENERAL', 'EMERGENCY') AND ${t.classId} IS NULL AND ${t.houseId} IS NULL)`,
    ),
    // The three idempotency indexes (R411 / PTA50-8). Partial, per scope-tier:
    //   Form  — one PTA per active class.
    formScope: uniqueIndex("uniq_pta_form_scope")
      .on(t.schoolId, t.classId)
      .where(sql`${t.tierType} = 'FORM'`),
    //   House — one PTA per active House.
    houseScope: uniqueIndex("uniq_pta_house_scope")
      .on(t.schoolId, t.houseId)
      .where(sql`${t.tierType} = 'HOUSE'`),
    //   General — the SINGLETON: one General PTA per school. PARTIAL on (school_id) alone — a plain UNIQUE
    //   would treat the two NULL scopes as distinct and permit a second General (the PTA50-8 trap).
    generalSingleton: uniqueIndex("uniq_pta_general_singleton")
      .on(t.schoolId)
      .where(sql`${t.tierType} = 'GENERAL'`),
    // Composite intra-tenant scope FKs — RESTRICT (R412: a scope row is soft-archived, never hard-deleted;
    // a real DELETE is refused rather than orphaning the PTA). A cross-tenant scope is impossible.
    classFk: foreignKey({
      columns: [t.schoolId, t.classId],
      foreignColumns: [classes.schoolId, classes.id],
    }).onDelete("restrict"),
    houseFk: foreignKey({
      columns: [t.schoolId, t.houseId],
      foreignColumns: [houses.schoolId, houses.id],
    }).onDelete("restrict"),
  }),
);

/**
 * Append-only, FORWARD-ONLY dues-rate history (R413) — the invoice_discount_application forward-only-audit
 * analogue. EVERY change to a tier's dues contract appends an immutable row here; the INCR-54 invoicer
 * reads the rate in force by `effective_from` (it NEVER re-rates an already-issued invoice). `reason` is
 * MANDATORY (NOT NULL). Append-only-HARD and forward-only (backdating REJECTED, future allowed) are enforced
 * APP-SIDE in lib/pta/ — there is deliberately NO UPDATE/DELETE path and NO trigger (portability). The row
 * carries a full snapshot of the dues contract at the change instant (enabled/amount/basis/cadence) so the
 * invoicer needs no point-in-time reconstruction.
 *
 * The natural key `(school_id, tier_type)` is a composite intra-tenant FK → pta_tiers_config's
 * `UNIQUE(school_id, tier_type)` (CASCADE — a school delete cascades the config, and the history with it),
 * so a history row can never orphan its tier and a cross-tenant tier reference is impossible. `tier_type`
 * needs no own CHECK — the FK to the (already CHECK-constrained) config natural key covers it. LEAF (nothing
 * FKs here) → NO tenant UK. `changed_by_user_id` is the SINGLE-column SET NULL actor stamp → global ref_user.
 */
export const ptaDuesConfigHistory = pgTable(
  "pta_dues_config_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    tierType: text("tier_type").notNull(), // composite (school_id, tier_type) FK below — no own CHECK needed
    // Full snapshot of the dues contract at the change instant.
    duesEnabled: boolean("dues_enabled").notNull(),
    duesAmount: money("dues_amount"), // nullable snapshot (null when dues disabled at the change)
    duesBasis: text("dues_basis"),
    duesCadence: text("dues_cadence"),
    // Forward-only: backdating REJECTED app-side (R413); future allowed.
    effectiveFrom: date("effective_from").notNull(),
    reason: text("reason").notNull(), // MANDATORY (R413)
    // Actor stamp — single-column SET NULL → global ref_user (a removed user clears it, never deletes history).
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The INCR-54 "rate in force at effective_from for this tier" read; also serves the setup editor's
    // dues-history panel. (school_id, tier_type) prefix matches the FK / the per-tier lookup.
    byTier: index("pta_dues_config_history_tier_idx").on(t.schoolId, t.tierType, t.effectiveFrom),
    // Composite intra-tenant FK → pta_tiers_config natural key (school_id, tier_type). CASCADE with the
    // config (which itself cascades from the school) — never orphan a history row.
    tierFk: foreignKey({
      columns: [t.schoolId, t.tierType],
      foreignColumns: [ptaTiersConfig.schoolId, ptaTiersConfig.tierType],
    }).onDelete("cascade"),
  }),
);

/**
 * The PTA OFFICER MATRIX (SHS module 4.7 / INCR-51, migration 0075) — the office×holder appointment
 * roster, ONE table. It makes the OC3 boundary concrete: an officer is a DATA position, NOT a
 * KnownAppRole (R419). Authz derives from HOLDING an office BY IDENTITY (`canActAsPtaOfficer`, lib/pta/,
 * the [[vlc-pastoral-confidential-model]] canAccessPastoralFlag idiom) — NEVER from a widened app-role.
 * Builds on the INCR-50 spine (`ptas`, the tier's `officer_roles`, `tier_settings`) byte-unchanged.
 *
 * HOLDER = `person_user_id` (single-column SET NULL → the GLOBAL ref_user — the parent OR staff holder)
 * XOR `external_name` (the rare non-user holder, e.g. a BOG member). `person_type` is DERIVED at read
 * (guardian-link ⇒ parent / staff-role ⇒ staff / external_name ⇒ external) — a DISPLAY tag; authz NEVER
 * keys on it (R419). The `pta_officer_at_most_one_holder` CHECK is at-MOST-one, NOT exactly-one: a SET
 * NULL degradation (the holder user is removed → person_user_id nulls, external_name still null) must not
 * violate it. Exactly-one is the app-side write rule; the looser DB CHECK tolerates the degradation.
 *
 * MULTI-HAT = N rows (R421). Vacancy is a DERIVED absence, NEVER a placeholder row; reassignment
 * soft-ends the incumbent (`ended_at` + `end_reason`, the row is RETAINED as history) and inserts a new
 * row (previous-holder derives from the most-recent ended row). The partial unique
 * `uniq_pta_officer_current (school_id, pta_id, office) WHERE ended_at IS NULL` pins ONE CURRENT holder
 * per office per PTA and exempts ended rows. `office` is TEXT with NO CHECK / NO FK — it is validated
 * app-side ∈ the tier's `officer_roles` (per-school config data, drift-tolerant: removing an office from
 * config does NOT cascade onto live rows — R420). `assignment_basis` is the meaningful binary
 * (ELECTED|APPOINTED, CHECK) that drives term auto-calc (R423); `election_ref` is the MANDATORY free-text
 * audit of how appointed (the appointer = election_ref + the audit actor, not a third stored axis). The
 * ex-officio holders (General→Headmaster, Form→class teacher, House→housemaster, R424) are DERIVED at
 * compose, NEVER stored here.
 *
 * TENANT / OPERATIONAL / SHOWN (`pta_officer` in SHOWN_AUDIT_ENTITIES, R428): ENABLE + FORCE RLS +
 * tenant_isolation (db:policies on dev; db/sql/prod-paste-0078-pta-officer.sql by hand on prod) and — via
 * the catalog RESTRICTIVE loop — parent_deny (FORCE-RLS + school_id + NO parent_scope ⇒ auto-denied). A
 * parent sees NOTHING of the matrix in THIS increment; the school-wide-parent public-transparency read is
 * INCR-55 (R429), NOT here. NO confidential/REDACTED layer, NO trigger (portability). Composite
 * `(school_id, pta_id)` intra-tenant FK ⇒ a cross-tenant PTA reference is structurally impossible
 * ([[composite-tenant-fks]]); `person_user_id` is the ONLY single-column SET NULL (→ the GLOBAL ref_user,
 * which has no school_id). LEAF — nothing FKs to an officer → NO tenant_uk.
 */
export const ptaOfficer = pgTable(
  "pta_officer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    // Composite (school_id, pta_id) FK → ptas tenant UK below — CASCADE (a PTA delete takes its officers).
    ptaId: uuid("pta_id").notNull(),
    // Holder: person_user_id (single-column SET NULL → the GLOBAL ref_user) XOR external_name — the
    // at-most-one CHECK below. A removed user nulls this and keeps the historical row.
    personUserId: uuid("person_user_id").references(() => users.id, { onDelete: "set null" }),
    externalName: text("external_name"), // the rare external non-user holder (e.g. a BOG member)
    // Office NAME — validated app-side ∈ the tier's officer_roles (R420); NO CHECK / NO FK (per-school
    // config data, drift-tolerant — a config edit removing an office does not cascade onto live rows).
    office: text("office").notNull(),
    // The meaningful binary (R423) — drives ELECTED term auto-calc; CHECK below.
    assignmentBasis: text("assignment_basis").notNull(),
    // MANDATORY free-text audit of HOW appointed (R423) — appointer = election_ref + the audit actor.
    electionRef: text("election_ref").notNull(),
    termStart: date("term_start").notNull(),
    termEnd: date("term_end"), // nullable — holdover until re-elected (R422); NO auto-vacate
    // Soft-end: the row is RETAINED as history (R421). end_reason is the early-end free-text note.
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: text("end_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // ONE CURRENT holder per office per PTA (R421); ended rows exempt (= history). PARTIAL unique — the
    // WHERE is what makes soft-end + re-appoint legal (a plain UNIQUE would collide with the ended row).
    currentHolder: uniqueIndex("uniq_pta_officer_current")
      .on(t.schoolId, t.ptaId, t.office)
      .where(sql`${t.endedAt} IS NULL`),
    // The identity-gate lookup (canActAsPtaOfficer, R426) — "which offices does this user hold?".
    byPerson: index("pta_officer_person_idx").on(t.schoolId, t.personUserId),
    // Composite intra-tenant FK → ptas tenant UK (school_id, id). CASCADE — a PTA delete takes its
    // officers. A cross-tenant PTA reference is structurally impossible.
    ptaFk: foreignKey({
      columns: [t.schoolId, t.ptaId],
      foreignColumns: [ptas.schoolId, ptas.id],
    }).onDelete("cascade"),
    // At-MOST-one holder (R419): NOT (both set). A SET NULL degradation must not violate it; exactly-one
    // is the app-side write rule, deliberately looser at the DB layer.
    atMostOneHolder: check(
      "pta_officer_at_most_one_holder",
      sql`NOT (${t.personUserId} IS NOT NULL AND ${t.externalName} IS NOT NULL)`,
    ),
    // The meaningful binary (R423) — drives term auto-calc.
    assignmentBasisValid: check(
      "pta_officer_assignment_basis_valid",
      sql`${t.assignmentBasis} IN ('ELECTED', 'APPOINTED')`,
    ),
  }),
);

/* ============================================================================
 * PTA MEETING REGISTER (SHS module 4.7 / INCR-52, migration 0076) — the dual teacher/parent meeting
 * register, the OPERATIONAL/SHOWN counterpart to PLC's Friday plc_session (INCR-48) and the FIRST LIVE use
 * of the canActAsPtaOfficer identity gate (the module's IDOR fence, wired in lib/pta/). Two NEW tenant
 * tables: `pta_meeting` (the manually-convened instance) + the DUAL-register `pta_meeting_attendance`. NO
 * cron (manual convene, R431); NO stored status/counts — lifecycle (scheduled/held/closed), the write-lock
 * and every present-count / quorum-% DERIVE in lib/pta/meeting-clock.ts (R432). Attendees are STAFF *and*
 * PARENTS, but this increment holds NO student PII and NO confidential layer: both tables are OPERATIONAL /
 * SHOWN (each listed in SHOWN_AUDIT_ENTITIES; neither carries a reserved audit prefix, so an omitted one
 * FAILS the classify-at-creation build guard, R442).
 *
 * Both get ENABLE + FORCE RLS + tenant_isolation (db:policies on dev; db/sql/prod-paste-0079-pta-
 * meetings.sql by hand on prod) and — via the catalog-driven RESTRICTIVE loop in db/sql/policies.sql —
 * parent_deny (FORCE-RLS + school_id, NO parent_scope → auto-denied). A parent reads NOTHING here in THIS
 * increment; the own-child own-attendance parent_scope (via student_guardian_id → student_guardian.user_id
 * = app.current_parent_user) RETURNS at INCR-55 (R442), NOT here. NO confidential/REDACTED layer, NO new
 * GUC, NO triggers (portability): the R439 write-gate authorizePtaMeetingWrite, the R435 per-register
 * default polarity, and the R432 lifecycle/write-lock all live in lib/pta/ server code.
 *
 * Composite `(school_id, …)` intra-tenant FKs make a cross-tenant reference structurally impossible; the
 * user / student_guardian links (convened_by / attendee / recorded_by) are SINGLE-column SET NULL (the
 * [[composite-tenant-fks]] rule exempts SET-NULL links; student_guardian is the sickbay student_nhis_card
 * best-effort-link precedent).
 * ==========================================================================*/

/**
 * The manually-convened PTA meeting (R431) — one row per convened meeting, created when the register is
 * opened (NO cron, NO auto-schedule; State-1 SMS-scheduling DEFERRED). `academic_period_id` is resolved
 * from `meeting_date` in lib/ and stored (the term the meeting belongs to). `meeting_type` is a FREE-TEXT
 * DISPLAY label — NO CHECK, and no logic branches on it (R431). `agenda_json` reuses the INCR-48
 * plc_session shape ({items:[…]}, Zod-validated in lib/, editable-until-lock). `invited_teacher_user_ids`
 * is the convener's invite list (jsonb array of ref_user ids) the R436 teacher roster unions in.
 * `quorum_met` is a NULLABLE Secretary JUDGMENT (R438 — NOT auto-derived; free-text quorum rules have
 * non-countable clauses); it gates the INCR-53 minutes/resolution UI. `convened_by_user_id` is a
 * single-column SET NULL actor stamp → global ref_user. NO stored status / present-count — all DERIVED (R432).
 *
 * `pta_meeting_tenant_uk UNIQUE(school_id, id)` is carried INLINE in CREATE TABLE because it is the
 * composite-FK TARGET of pta_meeting_attendance's (school_id, meeting_id) FK created in the SAME migration
 * (0076): the UNIQUE must exist before that ALTER … ADD FOREIGN KEY (the 0033 target-before-FK ordering
 * hazard, the plc_session_tenant_uk precedent). There is deliberately NO one-meeting-per-(PTA × date)
 * unique — a PTA may convene more than once a day (R440 allows multiple Emergencies); the per-PTA meeting-
 * history read is served by pta_meeting_pta_idx.
 */
export const ptaMeeting = pgTable(
  "pta_meeting",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    ptaId: uuid("pta_id").notNull(), // composite (school_id, pta_id) FK below
    academicPeriodId: uuid("academic_period_id").notNull(), // composite (school_id, period_id) FK below — resolved from meeting_date
    meetingType: text("meeting_type").notNull(), // FREE-TEXT display label — NO CHECK, no logic branch (R431)
    meetingDate: date("meeting_date").notNull(),
    startTime: text("start_time").notNull(), // "HH:MM" (the plc_programme text-time idiom)
    endTime: text("end_time").notNull(),
    location: text("location"),
    // Convener-authored agenda {items:[…]} (reuse the INCR-48 plc_session shape), Zod-validated in
    // lib/pta/; editable-until-lock, NOT append-only, NO agenda-item table (that is INCR-53). Default =
    // the valid empty shape.
    agendaJson: jsonb("agenda_json").notNull().default(sql`'{"items": []}'::jsonb`),
    // The convener's invite list — a jsonb array of ref_user ids the R436 teacher roster unions in.
    invitedTeacherUserIds: jsonb("invited_teacher_user_ids").notNull().default(sql`'[]'::jsonb`),
    // Secretary JUDGMENT (R438) — NULLABLE, NOT auto-derived (free-text quorum rules have non-countable
    // clauses); gates the INCR-53 minutes/resolution UI (enabled only when quorum_met = true).
    quorumMet: boolean("quorum_met"),
    // Single-column SET NULL actor stamp → global ref_user (the convener; a removed user clears it).
    convenedByUserId: uuid("convened_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for pta_meeting_attendance's (school_id, meeting_id) FK. INLINE, ahead of that
    // ALTER in this same migration (the 0033 / plc_session ordering discipline).
    tenantUk: unique("pta_meeting_tenant_uk").on(t.schoolId, t.id),
    // The per-PTA meeting-history read ("this PTA's meetings, most recent first"). No natural (PTA × date)
    // unique — a PTA may meet more than once a day (R440 multiple Emergencies) — so this is a plain index.
    byPta: index("pta_meeting_pta_idx").on(t.schoolId, t.ptaId, t.meetingDate),
    // Composite intra-tenant FKs — a cross-tenant PTA / period reference is structurally impossible.
    ptaFk: foreignKey({
      columns: [t.schoolId, t.ptaId],
      foreignColumns: [ptas.schoolId, ptas.id],
    }).onDelete("cascade"),
    periodFk: foreignKey({
      columns: [t.schoolId, t.academicPeriodId],
      foreignColumns: [academicPeriod.schoolId, academicPeriod.periodId],
    }).onDelete("cascade"),
  }),
);

/**
 * DUAL teacher/parent meeting attendance (R434) — ONE table, two registers discriminated by `register`
 * (TEACHER | PARENT, CHECK). The attendee is `user_id` (a staff/teacher — single-column SET NULL → global
 * ref_user) XOR `student_guardian_id` (a PARENT — single-column SET NULL → the school-scoped
 * student_guardian, the sickbay student_nhis_card best-effort-link precedent; SMS-only guardians have no
 * ref_user, which is exactly why the parent register keys on the guardian row, NOT a user). The
 * `pta_meeting_attendance_register_identity` CHECK binds register↔identity EXACTLY: a TEACHER row carries
 * user_id (and no guardian); a PARENT row carries student_guardian_id (and no user). Unlike the
 * pta_officer at-MOST-one soft guard, this binding is STRICT (both branches require the register's own
 * identity column NON-NULL): it is load-bearing for R437 count-once AND the INCR-55 own-child parent_scope
 * (which reads student_guardian_id → student_guardian.user_id) — a null-identity register row would break
 * both. See the ⚠ SET NULL note below.
 *
 * `status` REUSES the canonical attendanceStatusEnum (NO new enum, R434): capture surfaces P/L/A (Late
 * counts toward the quorum present-count), E/M are storable-not-rejected. `minutes_late` (nullable int,
 * CHECK ≥ 0) is set for LATE. PER-REGISTER DEFAULT POLARITY is a pure lib/pta/ DERIVATION, NOT schema
 * (R435): TEACHER = present-by-default (no row = present, PLC-verbatim); PARENT = absent-by-default (no
 * row = awaiting-while-live / absent-once-closed, a row = a PRESENT/LATE arrival). The app writes a row
 * ONLY for the non-default state — there are NO bulk absent rows; the unmarked→absent-on-close flip is a
 * pure read-time derivation. `recorded_by_user_id` is a single-column SET NULL actor stamp → global ref_user.
 *
 * TWO PARTIAL UNIQUES enforce count-once per register (R437): (school_id, meeting_id, user_id) WHERE
 * register='TEACHER' and (school_id, meeting_id, student_guardian_id) WHERE register='PARENT'. SPLIT by
 * register so each keys its own identity column and the many NULLs of the other never collide. LEAF
 * (nothing FKs here) → NO tenant UK. Composite (school_id, meeting_id) intra-tenant FK →
 * pta_meeting.tenant_uk (CASCADE — a meeting delete takes its register).
 *
 * ⚠ SET NULL × strict CHECK edge: student_guardian is school-scoped and cascade-deletes with its student /
 * school, and the register_identity CHECK requires a PARENT row's student_guardian_id NON-NULL — so a HARD
 * guardian delete fires SET NULL → NULL and the CHECK would reject it. In practice students/guardians are
 * SOFT-stated (never hard-deleted, the plc user_id-SET-NULL reasoning), so it does not fire; the
 * school-delete cascade path is verified empirically at build. If it ever bites, loosen to the SET-NULL-
 * tolerant form `(register='TEACHER' AND student_guardian_id IS NULL) OR (register='PARENT' AND user_id IS
 * NULL)` (the pta_officer at-most-one precedent) with the own-column non-null enforced app-side.
 */
export const ptaMeetingAttendance = pgTable(
  "pta_meeting_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    meetingId: uuid("meeting_id").notNull(), // composite (school_id, meeting_id) FK below
    // TEACHER | PARENT — the register discriminator (CHECK below); binds to user_id XOR student_guardian_id.
    register: text("register").notNull(),
    // The staff/teacher attendee (single-column SET NULL → global ref_user; nullable as SET NULL requires).
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // The PARENT attendee — a school-scoped student_guardian (single-column SET NULL; SMS-only guardians
    // have no ref_user, so the parent register keys on the guardian row). The student_nhis_card link idiom.
    studentGuardianId: uuid("student_guardian_id").references(() => studentGuardians.id, {
      onDelete: "set null",
    }),
    // Reuses the canonical attendance enum (R434); capture surfaces P/L/A (E/M storable-not-rejected).
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
    // Count-once per register (R437) — SPLIT partial uniques so each keys its own identity column and the
    // NULLs of the other never collide. A person appears at most once in their register.
    uniqTeacher: uniqueIndex("uniq_pta_meeting_attendance_teacher")
      .on(t.schoolId, t.meetingId, t.userId)
      .where(sql`${t.register} = 'TEACHER'`),
    uniqParent: uniqueIndex("uniq_pta_meeting_attendance_parent")
      .on(t.schoolId, t.meetingId, t.studentGuardianId)
      .where(sql`${t.register} = 'PARENT'`),
    // TEACHER | PARENT (R434).
    registerValid: check(
      "pta_meeting_attendance_register_valid",
      sql`${t.register} IN ('TEACHER', 'PARENT')`,
    ),
    // Binds register↔identity EXACTLY: a TEACHER row carries user_id (no guardian); a PARENT row carries
    // student_guardian_id (no user). Load-bearing for R437 count-once + the INCR-55 own-child parent_scope.
    registerIdentity: check(
      "pta_meeting_attendance_register_identity",
      sql`(${t.register} = 'TEACHER' AND ${t.userId} IS NOT NULL AND ${t.studentGuardianId} IS NULL)
        OR (${t.register} = 'PARENT' AND ${t.studentGuardianId} IS NOT NULL AND ${t.userId} IS NULL)`,
    ),
    // Defense-in-depth non-negativity (nullable → a NULL passes; set for LATE).
    minutesLateNonneg: check(
      "pta_meeting_attendance_minutes_late_nonneg",
      sql`${t.minutesLate} >= 0`,
    ),
    // Composite intra-tenant FK — a cross-tenant meeting reference is structurally impossible.
    meetingFk: foreignKey({
      columns: [t.schoolId, t.meetingId],
      foreignColumns: [ptaMeeting.schoolId, ptaMeeting.id],
    }).onDelete("cascade"),
  }),
);

/* ============================================================================
 * PTA MINUTES + RESOLUTIONS + ACTION ITEMS (SHS module 4.7 / INCR-53, migration 0077) — the post-meeting
 * record: FOUR NEW tenant tables forming a composite-FK CHAIN (R444). It WIRES canActAsPtaOfficer a 2nd
 * time (Secretary drafts / Chair adopts) and builds on the CLOSED INCR-52 meeting + its quorum_met.
 *
 *   pta_minutes (1:1 meeting, inline tenant_uk)
 *     └─ pta_agenda_item (FK → minutes tenant_uk, inline tenant_uk)
 *          ├─ pta_action_item (FK → agenda_item tenant_uk, LEAF)
 *          └─ pta_resolution  (FK → agenda_item tenant_uk, LEAF)
 *
 * Every intra-tenant FK is composite (school_id, …) → the parent's (school_id, id) tenant_uk, CASCADE all
 * the way down ([[composite-tenant-fks]] — a cross-tenant reference is structurally impossible; a minutes /
 * meeting / school delete cascades the whole subtree). The ONLY single-column links are the SET NULL actor
 * stamps → the GLOBAL ref_user (secretary_id / adopted_by_user_id / the action-item person_user_id).
 *
 * ALL FOUR are TENANT / OPERATIONAL / SHOWN (each listed in SHOWN_AUDIT_ENTITIES; none carries a reserved
 * audit prefix, so an omitted one FAILS the classify-at-creation build guard, R456). Each gets ENABLE +
 * FORCE RLS + tenant_isolation (db:policies on dev; db/sql/prod-paste-0080-pta-minutes.sql by hand on prod)
 * and — via the catalog-driven RESTRICTIVE loop in db/sql/policies.sql — parent_deny (FORCE-RLS + school_id,
 * NO parent_scope → auto-denied). A parent reads NOTHING of the minutes record in THIS increment; the
 * ADOPTED-only parent read (own-child own-PTA + school-wide GENERAL-tier transparency, R457) RETURNS at
 * INCR-55, NOT here. NO confidential/REDACTED layer, NO new GUC, NO triggers (portability).
 *
 * NO DB-level immutability / lifecycle machinery: the 🔴 R451 adopted-is-TOTAL-immutable fence, the R450
 * lifecycle, the R452 quorum→resolution gate, the R453 resolution-number assignment and the R455 submit
 * validation are ALL app-enforced in lib/pta/ (the INCR-49 ledger + readiness-freeze pattern — no trigger).
 * The domain CHECKs below are defense-in-depth on the value SETS only, never the state machine.
 * ==========================================================================*/

/**
 * The minutes record — 1:1 with a meeting (R445). `status` walks DRAFT → CHAIR_REVIEW → ADOPTED (a 3-value
 * CHECK, NOT an enum — the fixed app-owned domain idiom); ADOPTED is the R451 total-immutable terminal state
 * (app-enforced). `secretary_id` (the drafter) and `adopted_by_user_id` (the Chair, NULL until adoption) are
 * single-column SET NULL actor stamps → the GLOBAL ref_user. `adopted_at` / `distributed_at` are nullable
 * lifecycle timestamps (R458 distribution = this column only; SMS/PDF channels DEFERRED). NO stored
 * preamble / period columns — the R454 preamble (PTA/meeting name, date/times/location, Chair, Secretary,
 * attendance aggregates, quorum) is DERIVED from the register + officers at read, stable because adoption
 * waits for the meeting write-lock (R450).
 *
 * `UNIQUE(school_id, meeting_id)` is the 1:1 (R445) AND the draft-create upsert conflict target. Inline
 * `pta_minutes_tenant_uk UNIQUE(school_id, id)` is the composite-FK TARGET of pta_agenda_item — declared in
 * CREATE TABLE ahead of that FK (the 0033 target-before-FK discipline; the pta_meeting_tenant_uk precedent).
 */
export const ptaMinutes = pgTable(
  "pta_minutes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    // Composite (school_id, meeting_id) FK → pta_meeting tenant_uk below — CASCADE (a meeting delete takes
    // its minutes). The UNIQUE(school_id, meeting_id) makes it strictly 1:1.
    meetingId: uuid("meeting_id").notNull(),
    // DRAFT → CHAIR_REVIEW → ADOPTED (R445/R450). CHECK, not an enum; ADOPTED is R451-immutable app-side.
    status: text("status").notNull().default("DRAFT"),
    // The drafter (Secretary) — single-column SET NULL → global ref_user (a removed user clears the stamp).
    secretaryId: uuid("secretary_id").references(() => users.id, { onDelete: "set null" }),
    // The adopter (Chair) — NULL until adoption; single-column SET NULL → global ref_user.
    adoptedByUserId: uuid("adopted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    adoptedAt: timestamp("adopted_at", { withTimezone: true }), // stamped at adoption (R450)
    distributedAt: timestamp("distributed_at", { withTimezone: true }), // R458 — distribution marker only
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The 1:1 (R445) — one minutes per meeting; ALSO the draft-create upsert conflict target. Its
    // (school_id) prefix serves the per-school reads, so no separate school index.
    uniqMeeting: unique("uniq_pta_minutes_meeting").on(t.schoolId, t.meetingId),
    // Composite-FK target for pta_agenda_item's (school_id, minutes_id) FK — INLINE, ahead of that ALTER in
    // this same migration (the 0033 / pta_meeting_tenant_uk discipline).
    tenantUk: unique("pta_minutes_tenant_uk").on(t.schoolId, t.id),
    // DRAFT | CHAIR_REVIEW | ADOPTED (R445). NOT NULL, so the allow-list is mandatory.
    statusValid: check(
      "pta_minutes_status_valid",
      sql`${t.status} IN ('DRAFT', 'CHAIR_REVIEW', 'ADOPTED')`,
    ),
    // Composite intra-tenant FK → pta_meeting tenant UK (school_id, id). CASCADE.
    meetingFk: foreignKey({
      columns: [t.schoolId, t.meetingId],
      foreignColumns: [ptaMeeting.schoolId, ptaMeeting.id],
    }).onDelete("cascade"),
  }),
);

/**
 * An agenda item under a minutes (R446) — one row SEEDED per meeting `agenda_json` item at draft-create,
 * editable-until-adoption. `seq_no` is the display order, `title` the item heading (both from the seeded
 * agenda entry). `classification` is a single value the Secretary sets BY HAND (R449 — NO NLP), NULLABLE
 * WHILE DRAFTING and pinned only at submit-for-review (R455): the CHECK is NULL-tolerant (NULL passes; a set
 * value must be in the allow-list). Reclassifying away from ACTION/RESOLUTION removes the spawned children
 * app-side (R449) — the CASCADE FKs below make that a plain child DELETE. `narrative` is the free-text body.
 *
 * Inline `pta_agenda_item_tenant_uk UNIQUE(school_id, id)` is the composite-FK TARGET of BOTH pta_action_item
 * and pta_resolution — declared in CREATE TABLE ahead of those FKs (the 0033 target-before-FK discipline).
 */
export const ptaAgendaItem = pgTable(
  "pta_agenda_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    // Composite (school_id, minutes_id) FK → pta_minutes tenant_uk below — CASCADE (a minutes delete takes
    // its agenda items, and their children with them).
    minutesId: uuid("minutes_id").notNull(),
    seqNo: integer("seq_no").notNull(), // display order, from the seeded agenda_json entry
    title: text("title").notNull(),
    // Set BY HAND by the Secretary (R449, NO NLP); NULLABLE while drafting, pinned at submit (R455). The
    // CHECK is NULL-tolerant — a NULL passes, a set value must be in the allow-list.
    classification: text("classification"),
    narrative: text("narrative"), // free-text discussion body (nullable)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite-FK target for pta_action_item + pta_resolution — INLINE, ahead of those ALTERs.
    tenantUk: unique("pta_agenda_item_tenant_uk").on(t.schoolId, t.id),
    // The "all agenda items for this minutes, in order" read AND the FK-cascade support.
    byMinutes: index("pta_agenda_item_minutes_idx").on(t.schoolId, t.minutesId, t.seqNo),
    // NULL-tolerant (R446): a NULL (drafting) passes; a set value must be in the allow-list.
    classificationValid: check(
      "pta_agenda_item_classification_valid",
      sql`${t.classification} IS NULL OR ${t.classification} IN ('DISCUSSION', 'ACTION', 'RESOLUTION')`,
    ),
    // Composite intra-tenant FK → pta_minutes tenant UK (school_id, id). CASCADE.
    minutesFk: foreignKey({
      columns: [t.schoolId, t.minutesId],
      foreignColumns: [ptaMinutes.schoolId, ptaMinutes.id],
    }).onDelete("cascade"),
  }),
);

/**
 * An action item spawned from an ACTION-classified agenda item (R447) — the LEAF assignment row. `owner` =
 * `person_user_id` (single-column SET NULL → the GLOBAL ref_user) XOR `external_name` (a non-user owner),
 * the pta_officer holder shape reused: the `pta_action_item_at_most_one_owner` CHECK is at-MOST-one, NOT
 * exactly-one, so a SET NULL degradation (the owner user removed → person_user_id nulls, external_name still
 * null) does not violate it; exactly-one is the app-side write rule. `deadline` is nullable (NULL = Ongoing,
 * R447 — legal, deadline is ADVISORY per R455). `status` is a 2-value CHECK (PENDING default | DONE);
 * `completed_at` is stamped when DONE. LEAF — nothing FKs here → NO tenant_uk.
 */
export const ptaActionItem = pgTable(
  "pta_action_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    // Composite (school_id, agenda_item_id) FK → pta_agenda_item tenant_uk below — CASCADE (a reclassify-away
    // or agenda-item/minutes delete takes the action item with it).
    agendaItemId: uuid("agenda_item_id").notNull(),
    description: text("description").notNull(),
    // Owner: person_user_id (single-column SET NULL → global ref_user) XOR external_name — the at-most-one
    // CHECK below (the pta_officer holder shape). A removed user nulls this and keeps the row.
    personUserId: uuid("person_user_id").references(() => users.id, { onDelete: "set null" }),
    externalName: text("external_name"), // a non-user owner (e.g. a named parent/vendor)
    deadline: date("deadline"), // nullable — NULL = Ongoing (R447); advisory (R455)
    status: text("status").notNull().default("PENDING"),
    completedAt: timestamp("completed_at", { withTimezone: true }), // stamped when DONE
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The "all actions for this agenda item" read AND the FK-cascade support.
    byAgendaItem: index("pta_action_item_agenda_item_idx").on(t.schoolId, t.agendaItemId),
    // At-MOST-one owner (R447): NOT (both set). A SET NULL degradation must not violate it; exactly-one is
    // the app-side write rule, deliberately looser at the DB layer (the pta_officer at-most-one precedent).
    atMostOneOwner: check(
      "pta_action_item_at_most_one_owner",
      sql`NOT (${t.personUserId} IS NOT NULL AND ${t.externalName} IS NOT NULL)`,
    ),
    statusValid: check("pta_action_item_status_valid", sql`${t.status} IN ('PENDING', 'DONE')`),
    // Composite intra-tenant FK → pta_agenda_item tenant UK (school_id, id). CASCADE.
    agendaItemFk: foreignKey({
      columns: [t.schoolId, t.agendaItemId],
      foreignColumns: [ptaAgendaItem.schoolId, ptaAgendaItem.id],
    }).onDelete("cascade"),
  }),
);

/**
 * A resolution spawned from a RESOLUTION-classified agenda item (R448) — the LEAF decision row, permitted
 * only when pta_meeting.quorum_met = TRUE (R452, app-enforced — NO cross-table CHECK). `resolution_no` is
 * NULLABLE UNTIL ADOPTION (R453 — assigned at adopt per (pta × academic_period), frozen `{scope}-{period}-
 * {NNN}`; a discarded draft burns no number); the `UNIQUE(school_id, resolution_no)` guards the NNN=MAX+1
 * assignment, and because multiple NULLs are DISTINCT in a UNIQUE, drafts (resolution_no NULL) never collide.
 * `resolution_text` is the wording; the three vote tallies are NOT NULL with a ≥0 CHECK each; `binding` is
 * NOT NULL (app defaults TRUE for the GENERAL tier, R448). The OUTCOME (PASSED ⟺ votes_for > votes_against)
 * is DERIVED at read, NEVER stored (R448). LEAF — nothing FKs here → NO tenant_uk.
 */
export const ptaResolution = pgTable(
  "pta_resolution",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    // Composite (school_id, agenda_item_id) FK → pta_agenda_item tenant_uk below — CASCADE.
    agendaItemId: uuid("agenda_item_id").notNull(),
    resolutionNo: text("resolution_no"), // NULLABLE until adoption (R453); NULLs distinct in the UNIQUE
    resolutionText: text("resolution_text").notNull(),
    // Vote tallies — NOT NULL, each ≥0 (defense in depth; the app records the count).
    votesFor: integer("votes_for").notNull(),
    votesAgainst: integer("votes_against").notNull(),
    votesAbstain: integer("votes_abstain").notNull(),
    binding: boolean("binding").notNull(), // app defaults TRUE for GENERAL tier (R448)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // R453 — the number-collision guard for the AT-ADOPTION NNN=MAX+1 assignment per (pta × period); the
    // `{scope}-{period}-{NNN}` string embeds both axes, so a school-level UNIQUE suffices. Multiple NULLs are
    // DISTINCT, so drafting resolutions (resolution_no NULL) never collide.
    uniqResolutionNo: unique("uniq_pta_resolution_no").on(t.schoolId, t.resolutionNo),
    // The "all resolutions for this agenda item" read AND the FK-cascade support.
    byAgendaItem: index("pta_resolution_agenda_item_idx").on(t.schoolId, t.agendaItemId),
    // Vote tallies are non-negative (defense in depth).
    votesForNonneg: check("pta_resolution_votes_for_nonneg", sql`${t.votesFor} >= 0`),
    votesAgainstNonneg: check("pta_resolution_votes_against_nonneg", sql`${t.votesAgainst} >= 0`),
    votesAbstainNonneg: check("pta_resolution_votes_abstain_nonneg", sql`${t.votesAbstain} >= 0`),
    // Composite intra-tenant FK → pta_agenda_item tenant UK (school_id, id). CASCADE.
    agendaItemFk: foreignKey({
      columns: [t.schoolId, t.agendaItemId],
      foreignColumns: [ptaAgendaItem.schoolId, ptaAgendaItem.id],
    }).onDelete("cascade"),
  }),
);
