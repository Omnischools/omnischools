-- Omnischools — PROD paste 0067: VLC F0 spine (SHS module 4.5 / INCR-40). THREE new tenant tables +
-- their RLS. NO enum, NO altered columns, NO backfills, NO seed, NO global-table changes. Idempotent
-- — safe to run more than once. Paste into the Supabase SQL editor on PROD after merging.
--
-- ⚠ NUMBERING (read this once). The DRIZZLE migration is db/migrations/0065_light_james_howlett.sql —
-- the drizzle chain was at 0064, so generate produced 0065. The prod-paste SEQUENCE, however, already
-- reached 0066 (two policy-only pastes, 0064/0065, ran ahead of their migrations — see
-- prod-paste-0066-user-school-block.sql, itself "byte-identical to migration 0064"). So this DDL's
-- prod-paste is 0067 while its migration is 0065; the two sequences have been diverged since INCR-29.
-- The SQL below is byte-identical in EFFECT (same table + constraint names) to migration 0065 followed
-- by db:policies for these three tables — a from-migrations rebuild and this paste produce an identical
-- catalog.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. If migration 0065 ships
-- to prod without this paste, the three vlc tables exist there with NO row-level security at all: no
-- ENABLE, no FORCE, no tenant_isolation, no parent_deny. Every school's VLC programme, values and
-- session templates become readable AND writable from every other school's session, and a claimed
-- parent session reads them too. FAIL-CLOSED gate: run this file on PROD as part of the INCR-40 deploy,
-- THEN verify with db/sql/verify-prod-rls.sql — Query 1 must return ZERO ROWS and Query 2's
-- tenant_tables + with_tenant_isolation must each have risen by exactly 3 (parent_denied up 3).
--
-- OWNER-LOCKED: a parent sees NOTHING in VLC. There is NO parent_scope on any vlc table; the
-- catalog-driven parent_deny loop at the bottom covers all three structurally (FORCE-RLS + school_id,
-- no parent_scope), exactly as it auto-denies every other non-parent-readable tenant table.
--
-- DDL ORDER (the 0033 FK-before-UNIQUE bug, INSIDE one file — same as sickbay 0057/0058). Tables are
-- created FIRST, each carrying its PK/UNIQUE INLINE, THEN the FKs are added. `vlc_value_tenant_uk
-- UNIQUE(school_id, id)` is the composite-FK TARGET of vlc_session_template's (school_id, value_id) FK,
-- and it is emitted INLINE in CREATE TABLE "vlc_value" — so it exists before the ALTER ... ADD FOREIGN
-- KEY that consumes it. `vlc_session_template_tenant_uk` is authored AHEAD for INCR-41's vlc_session,
-- the 0056 sickbay_bed_tenant_uk "author the UK a migration early" precedent.
--
-- CONSTRAINT notes (Kofi R286–R292):
--   • vlc_programme is a per-school SINGLETON: `school_id` NOT NULL UNIQUE (the sickbay_settings /
--     boarding_settings idiom), the upsert conflict target; LEAF, so NO composite tenant UK. A MISSING
--     row coalesces to the frozen defaults + configured:false; `configured_at` distinguishes "declared"
--     from "never configured" and is NOT a freeze. NO session_end / total_minutes / term_arc /
--     phase-name / academic_year column — all derived or frozen-lib. The five phase minutes each CHECK
--     > 0; there is DELIBERATELY NO sum-CHECK (a school may run a longer or shorter session).
--   • vlc_value carries school_id DIRECT (no programme_id — the programme is a singleton). UNIQUE
--     (school_id, ordinal) is the display order + upsert target; term_group CHECK 1..3.
--   • vlc_session_template is one row per (value × slot). `slot` is a two-value CHECK ('A','B'),
--     deliberately NOT an enum. Composite (school_id, value_id) FK → vlc_value CASCADE; a cross-tenant
--     value reference is structurally impossible. UNIQUE (school_id, value_id, slot).
--   • ALL school_id FKs are single-column → the ref_school PK (shipped 0001) CASCADE. The ONLY
--     composite (school_id, id) intra-tenant FK is value_id. NO TRIGGERS (portability).

-- ---- table 1: vlc_programme (TENANT, per-school SINGLETON — inline UNIQUE(school_id), NO tenant UK) ----
CREATE TABLE IF NOT EXISTS "vlc_programme" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "session_day" smallint DEFAULT 3 NOT NULL,
  "session_start" text DEFAULT '14:30' NOT NULL,
  "opener_min" smallint DEFAULT 5 NOT NULL,
  "small_group_min" smallint DEFAULT 25 NOT NULL,
  "plenary_min" smallint DEFAULT 15 NOT NULL,
  "reflection_min" smallint DEFAULT 10 NOT NULL,
  "close_min" smallint DEFAULT 5 NOT NULL,
  "configured_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vlc_programme_school_id_unique" UNIQUE("school_id"),
  CONSTRAINT "vlc_programme_session_day_range" CHECK ("vlc_programme"."session_day" BETWEEN 1 AND 7),
  CONSTRAINT "vlc_programme_opener_min_positive" CHECK ("vlc_programme"."opener_min" > 0),
  CONSTRAINT "vlc_programme_small_group_min_positive" CHECK ("vlc_programme"."small_group_min" > 0),
  CONSTRAINT "vlc_programme_plenary_min_positive" CHECK ("vlc_programme"."plenary_min" > 0),
  CONSTRAINT "vlc_programme_reflection_min_positive" CHECK ("vlc_programme"."reflection_min" > 0),
  CONSTRAINT "vlc_programme_close_min_positive" CHECK ("vlc_programme"."close_min" > 0)
);

-- ---- table 2: vlc_value (TENANT — inline natural key + the tenant UK the 0067 composite FK needs) ----
CREATE TABLE IF NOT EXISTS "vlc_value" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "ordinal" smallint NOT NULL,
  "name_en" text NOT NULL,
  "name_twi" text,
  "term_group" smallint NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_vlc_value_ordinal" UNIQUE("school_id","ordinal"),
  CONSTRAINT "vlc_value_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "vlc_value_term_group_range" CHECK ("vlc_value"."term_group" BETWEEN 1 AND 3)
);

-- ---- table 3: vlc_session_template (TENANT — inline tenant UK, authored ahead for INCR-41) ----
CREATE TABLE IF NOT EXISTS "vlc_session_template" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "value_id" uuid NOT NULL,
  "slot" text NOT NULL,
  "title" text NOT NULL,
  "prompt" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_vlc_session_template_value_slot" UNIQUE("school_id","value_id","slot"),
  CONSTRAINT "vlc_session_template_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "vlc_session_template_slot_valid" CHECK ("vlc_session_template"."slot" IN ('A', 'B'))
);

-- ---- foreign keys (guarded so a re-run is a no-op; every CREATE TABLE above is already done) ----
-- All school_id FKs → the ref_school PK (0001), single-column CASCADE.
DO $$ BEGIN
  ALTER TABLE "vlc_programme" ADD CONSTRAINT "vlc_programme_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_value" ADD CONSTRAINT "vlc_value_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_session_template" ADD CONSTRAINT "vlc_session_template_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- The ONE composite (school_id, value_id) intra-tenant FK → vlc_value_tenant_uk (created INLINE above),
-- CASCADE. A cross-tenant value reference is structurally impossible.
DO $$ BEGIN
  ALTER TABLE "vlc_session_template" ADD CONSTRAINT "vlc_session_template_school_id_value_id_vlc_value_school_id_id_fk"
    FOREIGN KEY ("school_id","value_id") REFERENCES "public"."vlc_value"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- RLS — all THREE tables: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (these three names are
-- added to that hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that
-- forgets to set app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'vlc_programme',
    'vlc_value',
    'vlc_session_template'
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

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0055 ----
-- Owner-locked: a parent NEVER sees VLC, so all three tables must be denied. This loop is NOT a
-- hand-list: it applies parent_deny to every FORCE-RLS + school_id table that lacks a parent_scope
-- policy — which, after the block above, is the three new vlc tables plus every already-covered one (it
-- re-creates their identical policy, hence idempotent). It is re-run here rather than hand-listing the
-- three, so a FUTURE vlc table stays auto-denied. RESTRICTIVE is load-bearing: Postgres OR's PERMISSIVE
-- policies, so a permissive parent policy would OR with tenant_isolation and hand a claimed parent the
-- entire school.
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
