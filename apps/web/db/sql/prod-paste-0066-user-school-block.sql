-- Omnischools — prod-paste 0066: user_school_block (INCR-35 / Module L2b admin user-management).
--
-- ⚠ HAND-RUN ON PROD AT DEPLOY. db:policies configures LOCAL DEV ONLY. A new tenant table that is
-- not pasted here on prod has NO tenant isolation → one school's block list (and, through the Data
-- API, the row itself) is readable from every other school. FAIL-CLOSED gate: this file MUST be
-- run in the Supabase SQL editor on PROD as part of the INCR-35 deploy, THEN verify with
-- db/sql/verify-prod-rls.sql (Query 1 must stay ZERO ROWS; Query 2 tenant_isolation count +1).
--
-- The block state lives on THIS table, never on ref_user or role_assignment (Kofi R262):
--   presence of a row = the (school, user) is BLOCKED; absence = active. No status enum.
--
-- SHAPE (byte-identical to db/migrations/0064_thin_thor.sql — same drizzle-generated constraint
-- names, so a from-migrations rebuild and this paste produce an identical catalog):
--   id uuid PK gen_random_uuid(); school_id/user_id NOT NULL; blocked_by nullable; blocked_at
--   timestamptz default now(); reason text. UNIQUE(school_id, user_id) = user_school_block_school_user_uk.
--   ALL THREE FKs SINGLE-COLUMN — ref_user is GLOBAL (no school_id), so a composite (school_id, id)
--   intra-tenant FK is impossible here and the 0033 FK-before-UNIQUE ordering hazard does NOT apply:
--     • school_id → ref_school CASCADE, user_id → ref_user CASCADE  (block is meaningless without either)
--     • blocked_by → ref_user SET NULL                             (attribution only; houses.hm_user_id idiom)
--
-- Idempotent — safe to re-run: CREATE TABLE IF NOT EXISTS, guarded FK adds, DROP POLICY IF EXISTS
-- before CREATE, and the catalog-driven parent_deny loop.

CREATE TABLE IF NOT EXISTS "user_school_block" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "blocked_by" uuid,
  "blocked_at" timestamptz DEFAULT now() NOT NULL,
  "reason" text,
  CONSTRAINT "user_school_block_school_user_uk" UNIQUE("school_id","user_id")
);

-- ---- foreign keys (guarded so a re-run is a no-op) ----
-- Tenant owner — CASCADE: the block dies with its school.
DO $$ BEGIN
  ALTER TABLE "user_school_block" ADD CONSTRAINT "user_school_block_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- The BLOCKED user — single-column FK to the GLOBAL ref_user; CASCADE: the block is meaningless
-- once the user no longer exists.
DO $$ BEGIN
  ALTER TABLE "user_school_block" ADD CONSTRAINT "user_school_block_user_id_ref_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- The manager who blocked them — single-column FK to the GLOBAL ref_user; SET NULL: attribution
-- only, a removed manager must NOT delete the block (houses.hm_user_id idiom).
DO $$ BEGIN
  ALTER TABLE "user_school_block" ADD CONSTRAINT "user_school_block_blocked_by_ref_user_id_fk"
    FOREIGN KEY ("blocked_by") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- RLS — the same tenant_isolation policy every other tenant table uses ----
-- ENABLE + FORCE means the owner is NOT exempt: a query that forgets to set app.current_school
-- returns ZERO rows — fails safe — rather than leaking across tenants. A manager at school A sees
-- and writes ONLY A's block rows; getCurrentUser's read is under withoutTenantScope (bypass arm).
ALTER TABLE "user_school_block" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_school_block" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "user_school_block";
CREATE POLICY tenant_isolation ON "user_school_block" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql ----
-- A claimed parent never reads the block list. The loop is NOT a hand-list: it applies parent_deny
-- to every FORCE-RLS + school_id table that lacks a parent_scope policy — which, after the block
-- above, includes user_school_block (it re-creates the identical policy on already-covered tables,
-- hence idempotent). Re-run here rather than hand-listing the one table, so a FUTURE tenant table
-- stays auto-denied.
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
