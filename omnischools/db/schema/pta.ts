import {
  pgTable,
  uuid,
  text,
  date,
  boolean,
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
import { classes, houses } from "./students";

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
