-- Omnischools — PROD paste 0077: PTA structure-setup spine (SHS module 4.7 / INCR-50, the module's FIRST
-- increment). THREE new tenant tables + their RLS. NO enum, NO altered columns, NO backfills, NO seed, NO
-- global-table changes. Idempotent — safe to run more than once. Paste into the Supabase SQL editor on
-- PROD after merging.
--
-- ⚠ NUMBERING (read this once). The DRIZZLE migration is db/migrations/0074_workable_overlord.sql — the
-- drizzle chain was at 0073 (the PLC CPD ledger, 0073_tired_dracula), so generate produced 0074. The
-- prod-paste SEQUENCE, however, already reached 0076 (prod-paste-0076-plc-cpd-ledger.sql — the two
-- sequences have diverged since INCR-29). So this DDL's prod-paste is 0077 while its migration is 0074;
-- that divergence is expected. The SQL below is byte-identical in EFFECT (same table + constraint + index +
-- policy names) to migration 0074 followed by db:policies for these three tables — a from-migrations
-- rebuild and this paste produce an identical catalog.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. If migration 0074 ships to
-- prod without this paste, pta_tiers_config / ptas / pta_dues_config_history exist there with NO row-level
-- security at all: no ENABLE, no FORCE, no tenant_isolation, no parent_deny. Every school's PTA config,
-- generated instances and dues-rate history become readable AND writable from every other school's session,
-- and a claimed parent session reads them too. FAIL-CLOSED gate: run this file on PROD as part of the
-- INCR-50 deploy, THEN verify with db/sql/verify-prod-rls.sql — Query 1 must return ZERO ROWS and Query 2's
-- tenant_tables + fully_forced + with_tenant_isolation + parent_denied must each have risen by exactly 3
-- (parent_readable UNCHANGED — PTA structure has no parent path in this increment; parent_scope RETURNS at
-- INCR-55).
--
-- OWNER-LOCKED: a parent sees NOTHING of PTA structure here (R416). There is NO parent_scope on any of the
-- three; the catalog-driven parent_deny loop at the bottom covers them structurally (FORCE-RLS + school_id,
-- no parent_scope), exactly as it auto-denies every other non-parent-readable tenant table. All three are
-- OPERATIONAL / SHOWN — NO confidential/REDACTED layer, NO parent_scope, NO new GUC, NO triggers.
--
-- DDL ORDER — the ONE intra-file ordering point: pta_tiers_config is created FIRST because
-- pta_dues_config_history carries a composite (school_id, tier_type) FK → pta_tiers_config's
-- UNIQUE(school_id, tier_type) natural key, and that UNIQUE must exist before the FK ALTER. Because every FK
-- is added in a DO-guarded block AFTER all three CREATE TABLEs, the target UNIQUE is always present (the
-- 0033 target-before-FK discipline). ptas' scope FKs target the PRE-EXISTING class / house tenant_uk (0001-
-- era), and every table's school_id FK the ref_school PK — so the FK block runs against pre-existing +
-- same-file targets, still DO-guarded for a clean re-run.
--
-- CONSTRAINT notes (Kofi R410–R414):
--   • pta_tiers_config (per school × tier): ONE row per (school × tier) — UNIQUE(school_id, tier_type). The
--     four tiers are a CHECK (FORM/HOUSE/GENERAL/EMERGENCY), NOT an enum. `officer_roles` is a JSON array of
--     OFFICE-NAME strings (a data list, NOT permissions — OC3). `dues_*` is the current rate; `dues_basis`
--     CHECK PER_STUDENT|PER_FAMILY, `dues_cadence` CHECK PER_TERM|PER_YEAR|ONE_OFF (both NULL-safe → pass
--     when dues off). EMERGENCY CHECK (R414): tier='EMERGENCY' ⇒ officer_roles='[]' AND dues_enabled=false.
--     Inline tenant_uk UNIQUE(school_id, id).
--   • ptas (the generated instances): scope = two NULLABLE typed composite-FK cols (class_id/house_id), NOT
--     polymorphic. tier↔scope CHECK: FORM⇒class set/house null; HOUSE⇒house set/class null; GENERAL &
--     EMERGENCY⇒both null. status CHECK ACTIVE|CLOSED. Scope FKs onDelete RESTRICT (R412 — a scope row is
--     soft-archived, never hard-deleted). THREE partial unique indexes = the idempotency crux (R411):
--     (school_id,class_id) WHERE FORM · (school_id,house_id) WHERE HOUSE · (school_id) WHERE GENERAL — the
--     General singleton is PARTIAL on (school_id) ALONE (a plain UNIQUE treats two NULL scopes as distinct
--     and would permit a 2nd General — PTA50-8). Inline tenant_uk UNIQUE(school_id, id) (FK target of 51–54).
--   • pta_dues_config_history (append-only, forward-only): full dues snapshot per change; `reason` NOT NULL
--     (R413). Composite (school_id, tier_type) FK → pta_tiers_config natural key CASCADE (never orphan);
--     `changed_by_user_id` single-column SET NULL → the GLOBAL ref_user. Append-only-HARD + backdating
--     rejection are APP-SIDE (lib/pta/) — NO trigger. LEAF (no tenant UK).

-- ---- table: pta_tiers_config (TENANT — per school × tier; created FIRST, the dues-history FK target) ----
CREATE TABLE IF NOT EXISTS "pta_tiers_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "tier_type" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "frequency_norm" text,
  "officer_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "quorum_rule" text,
  "dues_enabled" boolean DEFAULT false NOT NULL,
  "dues_amount" numeric(12, 2),
  "dues_basis" text,
  "dues_cadence" text,
  "tier_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "configured_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_pta_tiers_config" UNIQUE("school_id","tier_type"),
  CONSTRAINT "pta_tiers_config_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "pta_tiers_config_tier_type_valid" CHECK ("pta_tiers_config"."tier_type" IN ('FORM', 'HOUSE', 'GENERAL', 'EMERGENCY')),
  CONSTRAINT "pta_tiers_config_dues_basis_valid" CHECK ("pta_tiers_config"."dues_basis" IN ('PER_STUDENT', 'PER_FAMILY')),
  CONSTRAINT "pta_tiers_config_dues_cadence_valid" CHECK ("pta_tiers_config"."dues_cadence" IN ('PER_TERM', 'PER_YEAR', 'ONE_OFF')),
  CONSTRAINT "pta_tiers_config_emergency_no_officers_no_dues" CHECK ("pta_tiers_config"."tier_type" <> 'EMERGENCY' OR ("pta_tiers_config"."officer_roles" = '[]'::jsonb AND "pta_tiers_config"."dues_enabled" = false))
);

-- ---- table: ptas (TENANT — the generated instances; inline tenant_uk = the 51–54 FK target) ----
CREATE TABLE IF NOT EXISTS "ptas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "tier_type" text NOT NULL,
  "class_id" uuid,
  "house_id" uuid,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ptas_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "ptas_tier_type_valid" CHECK ("ptas"."tier_type" IN ('FORM', 'HOUSE', 'GENERAL', 'EMERGENCY')),
  CONSTRAINT "ptas_status_valid" CHECK ("ptas"."status" IN ('ACTIVE', 'CLOSED')),
  CONSTRAINT "ptas_tier_scope_binding" CHECK (("ptas"."tier_type" = 'FORM' AND "ptas"."class_id" IS NOT NULL AND "ptas"."house_id" IS NULL)
        OR ("ptas"."tier_type" = 'HOUSE' AND "ptas"."house_id" IS NOT NULL AND "ptas"."class_id" IS NULL)
        OR ("ptas"."tier_type" IN ('GENERAL', 'EMERGENCY') AND "ptas"."class_id" IS NULL AND "ptas"."house_id" IS NULL))
);

-- ---- table: pta_dues_config_history (TENANT — append-only, forward-only; LEAF, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "pta_dues_config_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "tier_type" text NOT NULL,
  "dues_enabled" boolean NOT NULL,
  "dues_amount" numeric(12, 2),
  "dues_basis" text,
  "dues_cadence" text,
  "effective_from" date NOT NULL,
  "reason" text NOT NULL,
  "changed_by_user_id" uuid,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ---- foreign keys (guarded so a re-run is a no-op; the CREATE TABLEs above are already done) ----
-- pta_tiers_config.school_id → ref_school PK (0001), single-column CASCADE.
DO $$ BEGIN
  ALTER TABLE "pta_tiers_config" ADD CONSTRAINT "pta_tiers_config_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ptas.school_id → ref_school PK (0001), single-column CASCADE.
DO $$ BEGIN
  ALTER TABLE "ptas" ADD CONSTRAINT "ptas_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ptas composite (school_id, class_id) → the EXISTING class (school_id, id) tenant UK, RESTRICT (R412 — a
-- scope row is soft-archived, never hard-deleted). A cross-tenant class scope is structurally impossible.
DO $$ BEGIN
  ALTER TABLE "ptas" ADD CONSTRAINT "ptas_school_id_class_id_class_school_id_id_fk"
    FOREIGN KEY ("school_id","class_id") REFERENCES "public"."class"("school_id","id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ptas composite (school_id, house_id) → the EXISTING house (school_id, id) tenant UK, RESTRICT.
DO $$ BEGIN
  ALTER TABLE "ptas" ADD CONSTRAINT "ptas_school_id_house_id_house_school_id_id_fk"
    FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- pta_dues_config_history.school_id → ref_school PK (0001), single-column CASCADE.
DO $$ BEGIN
  ALTER TABLE "pta_dues_config_history" ADD CONSTRAINT "pta_dues_config_history_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_dues_config_history.changed_by_user_id → the GLOBAL ref_user, single-column SET NULL (nullable).
DO $$ BEGIN
  ALTER TABLE "pta_dues_config_history" ADD CONSTRAINT "pta_dues_config_history_changed_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_dues_config_history composite (school_id, tier_type) → pta_tiers_config natural key
-- UNIQUE(school_id, tier_type) (SAME FILE, created above), CASCADE — never orphan a history row.
DO $$ BEGIN
  ALTER TABLE "pta_dues_config_history" ADD CONSTRAINT "pta_dues_config_history_school_id_tier_type_pta_tiers_config_school_id_tier_type_fk"
    FOREIGN KEY ("school_id","tier_type") REFERENCES "public"."pta_tiers_config"("school_id","tier_type") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
-- pta_dues_config_history: the INCR-54 "rate in force at effective_from for this tier" read + the setup
-- editor's dues-history panel. (school_id, tier_type) prefix matches the FK / per-tier lookup.
CREATE INDEX IF NOT EXISTS "pta_dues_config_history_tier_idx"
  ON "pta_dues_config_history" USING btree ("school_id","tier_type","effective_from");
-- ptas: the THREE idempotency partial unique indexes (R411 / PTA50-8). Form / House per-scope; General is
-- the SINGLETON — PARTIAL on (school_id) ALONE (a plain UNIQUE would permit a 2nd General via NULL-distinctness).
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_pta_form_scope"
  ON "ptas" USING btree ("school_id","class_id") WHERE "ptas"."tier_type" = 'FORM';
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_pta_house_scope"
  ON "ptas" USING btree ("school_id","house_id") WHERE "ptas"."tier_type" = 'HOUSE';
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_pta_general_singleton"
  ON "ptas" USING btree ("school_id") WHERE "ptas"."tier_type" = 'GENERAL';

-- ---- RLS — the 3 PTA tables: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (these names are added to
-- that hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that forgets to set
-- app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'pta_tiers_config',
    'ptas',
    'pta_dues_config_history'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO public '
      'USING (current_setting(''app.bypass_rls'', true) = ''on'' '
      '  OR school_id = NULLIF(current_setting(''app.current_school'', true), '''')::uuid) '
      'WITH CHECK (current_setting(''app.bypass_rls'', true) = ''on'' '
      '  OR school_id = NULLIF(current_setting(''app.current_school'', true), '''')::uuid);',
      tbl
    );
  END LOOP;
END
$$;

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0076 ----
-- Owner-locked (R416): a parent sees NOTHING of PTA structure in this increment, so all three must be
-- denied. This loop is NOT a hand-list: it applies parent_deny to every FORCE-RLS + school_id table that
-- lacks a parent_scope policy — which, after the block above, is the three new PTA tables plus every
-- already-covered one (it re-creates their identical policy, hence idempotent). It is re-run here rather
-- than hand-listing, so a FUTURE PTA table stays auto-denied. RESTRICTIVE is load-bearing: Postgres OR's
-- PERMISSIVE policies, so a permissive parent policy would OR with tenant_isolation and hand a claimed
-- parent the entire school.
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r'
      AND c.relforcerowsecurity
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = c.relname
          AND col.column_name = 'school_id'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_policy p
        WHERE p.polrelid = c.oid AND p.polname = 'parent_scope'
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS parent_deny ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY parent_deny ON %I AS RESTRICTIVE FOR ALL TO public '
      'USING (NULLIF(current_setting(''app.current_parent_user'', true), '''') IS NULL);',
      tbl
    );
  END LOOP;
END
$$;
