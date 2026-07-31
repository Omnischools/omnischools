-- Omnischools — PROD paste 0074: PLC programme-setup spine (SHS module 4.6 / INCR-47). FOUR new tenant
-- tables + their RLS. NO enum, NO altered columns, NO backfills, NO seed, NO global-table changes.
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD after merging.
--
-- ⚠ NUMBERING (read this once). The DRIZZLE migration is db/migrations/0071_shocking_caretaker.sql — the
-- drizzle chain was at 0070 (the VLC character paragraph, 0070_tiny_giant_man), so generate produced
-- 0071. The prod-paste SEQUENCE, however, already reached 0073 (prod-paste-0073-parent-leaver-paragraph-
-- scope.sql — the two sequences have been diverged since INCR-29). So this DDL's prod-paste is 0074 while
-- its migration is 0071; that divergence is expected. The SQL below is byte-identical in EFFECT (same
-- table + constraint + policy names) to migration 0071 followed by db:policies for these four tables — a
-- from-migrations rebuild and this paste produce an identical catalog.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. If migration 0071 ships to
-- prod without this paste, the four plc tables exist there with NO row-level security at all: no ENABLE,
-- no FORCE, no tenant_isolation, no parent_deny. Every school's PLC programme, groups, staff membership
-- and term focus become readable AND writable from every other school's session, and a claimed parent
-- session reads them too. FAIL-CLOSED gate: run this file on PROD as part of the INCR-47 deploy, THEN
-- verify with db/sql/verify-prod-rls.sql — Query 1 must return ZERO ROWS and Query 2's tenant_tables +
-- fully_forced + with_tenant_isolation + parent_denied must each have risen by exactly 4 (parent_readable
-- UNCHANGED — PLC is staff CPD, no parent path).
--
-- OWNER-LOCKED: a parent NEVER sees staff PD (R378). There is NO parent_scope on any plc table; the
-- catalog-driven parent_deny loop at the bottom covers all four structurally (FORCE-RLS + school_id, no
-- parent_scope), exactly as it auto-denies every other non-parent-readable tenant table. PLC is
-- OPERATIONAL / SHOWN throughout — NO confidential/REDACTED layer, NO staff_grant_scope, NO new GUC.
--
-- DDL ORDER (the 0033 FK-before-UNIQUE bug, INSIDE one file — same as the VLC spine 0067). Tables are
-- created FIRST, each carrying its PK/UNIQUE INLINE, THEN the FKs are added. `plc_tenant_uk UNIQUE
-- (school_id, id)` is the composite-FK TARGET of BOTH plc_membership's (school_id, plc_id) FK and
-- plc_term_focus's (school_id, plc_id) FK, and it is emitted INLINE in CREATE TABLE "plc" — so it exists
-- before the ALTER ... ADD FOREIGN KEY statements that consume it. plc_term_focus's (school_id,
-- academic_period_id) FK targets the EXISTING academic_period_tenant_uk (0034), already on prod.
--
-- CONSTRAINT notes (Kofi R370–R376):
--   • plc_programme is a per-school SINGLETON: `school_id` NOT NULL UNIQUE (the vlc_programme /
--     boarding_settings idiom), the upsert conflict target; LEAF, so NO composite tenant UK. A MISSING
--     row coalesces to the frozen defaults (Friday ISO-5 / 15:30 / 60min / 12wk + the 4 CPD scalars) +
--     configured:false; `configured_at` distinguishes "declared" from "never configured", NOT a freeze.
--     NO session_end / max_pts_per_session / phase column — all DERIVED in lib/. Day 1..7, durations/
--     windows CHECK > 0, the CPD point scalars CHECK >= 0.
--   • plc (the group): `type` is a 3-value CHECK ('subject','cross-cutting','new-teacher'), deliberately
--     NOT an enum; mandatoriness/induction DERIVE from type in lib/ (no such column). `facilitator_user_id`
--     is single-column SET NULL → the GLOBAL ref_user (store the user id — the R377 identity gate compares
--     user ids). `override_frequency` 2-value CHECK / `override_session_day` 1..7 = the per-PLC cadence
--     override (NULL = inherit). `archived_at` = soft-archive (active = archived_at IS NULL); NEVER hard-
--     deleted (INCR-48/49 rows FK here). Its `plc_tenant_uk` is the composite-FK target below.
--   • plc_membership: open-row M2M (left_at IS NULL = active), NO role column (facilitator authority lives
--     only on plc.facilitator_user_id). `user_id` is single-column SET NULL → ref_user (nullable, as SET
--     NULL requires). UNIQUE(school_id, plc_id, user_id) = the M2M key + the re-join upsert target.
--   • plc_term_focus: free-text focus, one per (plc × academic_period). UNIQUE(school_id, plc_id,
--     academic_period_id); `set_by_user_id` single-column SET NULL → ref_user; NO history table.
--   • ALL school_id FKs are single-column → the ref_school PK (0001) CASCADE. Composite (school_id, X)
--     intra-tenant FKs (plc_id, academic_period_id) make a cross-tenant reference structurally impossible.
--     NO TRIGGERS (portability).

-- ---- table 1: plc (TENANT — the group; inline tenant UK the composite FKs below need) ----
CREATE TABLE IF NOT EXISTS "plc" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "type" text NOT NULL,
  "name" text NOT NULL,
  "facilitator_user_id" uuid,
  "override_frequency" text,
  "override_session_day" smallint,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plc_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "plc_type_valid" CHECK ("plc"."type" IN ('subject', 'cross-cutting', 'new-teacher')),
  CONSTRAINT "plc_override_frequency_valid" CHECK ("plc"."override_frequency" IN ('WEEKLY', 'BIWEEKLY')),
  CONSTRAINT "plc_override_session_day_range" CHECK ("plc"."override_session_day" BETWEEN 1 AND 7)
);

-- ---- table 2: plc_programme (TENANT, per-school SINGLETON — inline UNIQUE(school_id), NO tenant UK) ----
CREATE TABLE IF NOT EXISTS "plc_programme" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "session_day" smallint DEFAULT 5 NOT NULL,
  "session_start" text DEFAULT '15:30' NOT NULL,
  "session_length_min" integer DEFAULT 60 NOT NULL,
  "weeks_per_semester" integer DEFAULT 12 NOT NULL,
  "pts_per_attended_session" numeric(5, 2) DEFAULT '0.5' NOT NULL,
  "pts_per_reflection" numeric(5, 2) DEFAULT '0.5' NOT NULL,
  "reflection_window_hours" integer DEFAULT 48 NOT NULL,
  "annual_plc_target" numeric(5, 2) DEFAULT '8' NOT NULL,
  "configured_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plc_programme_school_id_unique" UNIQUE("school_id"),
  CONSTRAINT "plc_programme_session_day_range" CHECK ("plc_programme"."session_day" BETWEEN 1 AND 7),
  CONSTRAINT "plc_programme_session_length_min_positive" CHECK ("plc_programme"."session_length_min" > 0),
  CONSTRAINT "plc_programme_weeks_per_semester_positive" CHECK ("plc_programme"."weeks_per_semester" > 0),
  CONSTRAINT "plc_programme_reflection_window_hours_positive" CHECK ("plc_programme"."reflection_window_hours" > 0),
  CONSTRAINT "plc_programme_pts_per_attended_session_nonneg" CHECK ("plc_programme"."pts_per_attended_session" >= 0),
  CONSTRAINT "plc_programme_pts_per_reflection_nonneg" CHECK ("plc_programme"."pts_per_reflection" >= 0),
  CONSTRAINT "plc_programme_annual_plc_target_nonneg" CHECK ("plc_programme"."annual_plc_target" >= 0)
);

-- ---- table 3: plc_membership (TENANT — open-row M2M; LEAF, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "plc_membership" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "plc_id" uuid NOT NULL,
  "user_id" uuid,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "left_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_plc_membership" UNIQUE("school_id","plc_id","user_id")
);

-- ---- table 4: plc_term_focus (TENANT — free-text focus per (plc × period); LEAF, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "plc_term_focus" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "plc_id" uuid NOT NULL,
  "academic_period_id" uuid NOT NULL,
  "focus" text NOT NULL,
  "set_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_plc_term_focus" UNIQUE("school_id","plc_id","academic_period_id"),
  CONSTRAINT "plc_term_focus_focus_len" CHECK (char_length("plc_term_focus"."focus") <= 500)
);

-- ---- foreign keys (guarded so a re-run is a no-op; every CREATE TABLE above is already done) ----
-- All school_id FKs → the ref_school PK (0001), single-column CASCADE.
DO $$ BEGIN
  ALTER TABLE "plc" ADD CONSTRAINT "plc_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- facilitator → the GLOBAL ref_user, single-column SET NULL (a removed user clears the facilitator).
DO $$ BEGIN
  ALTER TABLE "plc" ADD CONSTRAINT "plc_facilitator_user_id_ref_user_id_fk"
    FOREIGN KEY ("facilitator_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "plc_programme" ADD CONSTRAINT "plc_programme_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "plc_membership" ADD CONSTRAINT "plc_membership_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- member → the GLOBAL ref_user, single-column SET NULL (nullable, as SET NULL requires).
DO $$ BEGIN
  ALTER TABLE "plc_membership" ADD CONSTRAINT "plc_membership_user_id_ref_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- composite (school_id, plc_id) intra-tenant FK → plc_tenant_uk (created INLINE above), CASCADE.
DO $$ BEGIN
  ALTER TABLE "plc_membership" ADD CONSTRAINT "plc_membership_school_id_plc_id_plc_school_id_id_fk"
    FOREIGN KEY ("school_id","plc_id") REFERENCES "public"."plc"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "plc_term_focus" ADD CONSTRAINT "plc_term_focus_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- set_by → the GLOBAL ref_user, single-column SET NULL.
DO $$ BEGIN
  ALTER TABLE "plc_term_focus" ADD CONSTRAINT "plc_term_focus_set_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("set_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- composite (school_id, plc_id) intra-tenant FK → plc_tenant_uk (INLINE above), CASCADE.
DO $$ BEGIN
  ALTER TABLE "plc_term_focus" ADD CONSTRAINT "plc_term_focus_school_id_plc_id_plc_school_id_id_fk"
    FOREIGN KEY ("school_id","plc_id") REFERENCES "public"."plc"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- composite (school_id, academic_period_id) intra-tenant FK → the EXISTING academic_period_tenant_uk
-- (school_id, period_id), CASCADE. A cross-tenant period reference is structurally impossible.
DO $$ BEGIN
  ALTER TABLE "plc_term_focus" ADD CONSTRAINT "plc_term_focus_school_id_academic_period_id_academic_period_school_id_period_id_fk"
    FOREIGN KEY ("school_id","academic_period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes (guarded so a re-run is a no-op) ----
-- The per-user "my PLCs" read (a facilitating teacher's own membership list). The three UNIQUEs above
-- already serve the singleton / roster / focus point lookups, so this is the only added index.
CREATE INDEX IF NOT EXISTS "plc_membership_user_idx" ON "plc_membership" USING btree ("school_id","user_id");

-- ---- RLS — all FOUR tables: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (these four names are
-- added to that hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that
-- forgets to set app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'plc_programme',
    'plc',
    'plc_membership',
    'plc_term_focus'
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

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0067 ----
-- Owner-locked (R378): a parent NEVER sees staff PD, so all four tables must be denied. This loop is NOT
-- a hand-list: it applies parent_deny to every FORCE-RLS + school_id table that lacks a parent_scope
-- policy — which, after the block above, is the four new plc tables plus every already-covered one (it
-- re-creates their identical policy, hence idempotent). It is re-run here rather than hand-listing the
-- four, so a FUTURE plc table stays auto-denied. RESTRICTIVE is load-bearing: Postgres OR's PERMISSIVE
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
