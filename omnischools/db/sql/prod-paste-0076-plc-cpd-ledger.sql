-- Omnischools — PROD paste 0076: PLC CPD ledger (SHS module 4.6 / INCR-49, the module's FINAL
-- increment). ONE new tenant table + its RLS. NO enum, NO altered columns, NO backfills, NO seed, NO
-- global-table changes. Idempotent — safe to run more than once. Paste into the Supabase SQL editor on
-- PROD after merging.
--
-- ⚠ NUMBERING (read this once). The DRIZZLE migration is db/migrations/0073_*.sql — the drizzle chain was
-- at 0072 (the PLC session register, 0072_brainy_nightshade), so generate produced 0073. The prod-paste
-- SEQUENCE, however, already reached 0075 (prod-paste-0075-plc-sessions.sql — the two sequences have been
-- diverged since INCR-29). So this DDL's prod-paste is 0076 while its migration is 0073; that divergence
-- is expected. The SQL below is byte-identical in EFFECT (same table + constraint + policy names) to
-- migration 0073 followed by db:policies for this one table — a from-migrations rebuild and this paste
-- produce an identical catalog.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. If migration 0073 ships to
-- prod without this paste, plc_cpd_ledger exists there with NO row-level security at all: no ENABLE, no
-- FORCE, no tenant_isolation, no parent_deny. Every school's persisted staff-CPD accrual becomes readable
-- AND writable from every other school's session, and a claimed parent session reads it too. FAIL-CLOSED
-- gate: run this file on PROD as part of the INCR-49 deploy, THEN verify with db/sql/verify-prod-rls.sql —
-- Query 1 must return ZERO ROWS and Query 2's tenant_tables + fully_forced + with_tenant_isolation +
-- parent_denied must each have risen by exactly 1 (parent_readable UNCHANGED — PLC is staff CPD, no
-- parent path).
--
-- OWNER-LOCKED: a parent NEVER sees staff CPD (R404). There is NO parent_scope on the table; the
-- catalog-driven parent_deny loop at the bottom covers it structurally (FORCE-RLS + school_id, no
-- parent_scope), exactly as it auto-denies every other non-parent-readable tenant table. The CPD ledger is
-- OPERATIONAL / SHOWN — NO confidential/REDACTED layer, NO parent_scope, NO new GUC, NO triggers.
--
-- DDL ORDER — NO intra-file ordering hazard here (unlike the 0074/0075 spines). plc_cpd_ledger is a LEAF
-- (nothing FKs to it → NO tenant UK of its own), and BOTH its composite-FK targets ALREADY EXIST on prod:
-- its (school_id, session_id) FK targets the EXISTING plc_session_tenant_uk (INCR-48 / prod-paste-0075)
-- and its single-column school_id FK the ref_school PK (0001). So the CREATE TABLE + its FKs run against
-- pre-existing targets — the FK block is still DO-guarded for a clean re-run.
--
-- CONSTRAINT notes (Kofi R400/R401):
--   • plc_cpd_ledger (the frozen accrual): ONE point-in-time-correct row per (school × session × member),
--     written at the session write-lock instant from the SAME lib/plc/points.ts the INCR-48 register
--     displays (display == accrual, R391). `attended_pts` + `reflection_pts` are the two CPD arms captured
--     AT settle — numeric(5,2) NOT NULL, each CHECK >= 0; the TOTAL is attended+reflection, DERIVED in
--     lib/ (NO stored total column, R401). NO plc_id / academic_period_id / session_date columns — each
--     DERIVES via the session_id join (immutable on the session). `settled_at` is the deterministic award
--     instant (the write-lock instant); `created_at` the audit write time.
--   • UNIQUE(school_id, session_id, user_id) = the idempotent-upsert conflict target AND the ledger-layer
--     anti-double-count key (<=1 award per member × session). Its (school_id, session_id) prefix serves the
--     settle-time "all members of this session" read — no separate index.
--   • `school_id` FK single-column → the ref_school PK (0001) CASCADE. Composite (school_id, session_id)
--     intra-tenant FK → plc_session (school_id, id) CASCADE makes a cross-tenant reference structurally
--     impossible. `user_id` single-column SET NULL → the GLOBAL ref_user (nullable, as SET NULL requires).
--     NO TRIGGERS (portability).

-- ---- table: plc_cpd_ledger (TENANT — the frozen CPD accrual; LEAF, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "plc_cpd_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "user_id" uuid,
  "attended_pts" numeric(5, 2) NOT NULL,
  "reflection_pts" numeric(5, 2) NOT NULL,
  "settled_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_plc_cpd_ledger" UNIQUE("school_id","session_id","user_id"),
  CONSTRAINT "plc_cpd_ledger_attended_pts_nonneg" CHECK ("plc_cpd_ledger"."attended_pts" >= 0),
  CONSTRAINT "plc_cpd_ledger_reflection_pts_nonneg" CHECK ("plc_cpd_ledger"."reflection_pts" >= 0)
);

-- ---- foreign keys (guarded so a re-run is a no-op; the CREATE TABLE above is already done) ----
-- school_id → the ref_school PK (0001), single-column CASCADE.
DO $$ BEGIN
  ALTER TABLE "plc_cpd_ledger" ADD CONSTRAINT "plc_cpd_ledger_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- member → the GLOBAL ref_user, single-column SET NULL (nullable, as SET NULL requires).
DO $$ BEGIN
  ALTER TABLE "plc_cpd_ledger" ADD CONSTRAINT "plc_cpd_ledger_user_id_ref_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- composite (school_id, session_id) intra-tenant FK → the EXISTING plc_session_tenant_uk (school_id, id)
-- (INCR-48 / prod-paste-0075), CASCADE. A cross-tenant session reference is structurally impossible.
DO $$ BEGIN
  ALTER TABLE "plc_cpd_ledger" ADD CONSTRAINT "plc_cpd_ledger_school_id_session_id_plc_session_school_id_id_fk"
    FOREIGN KEY ("school_id","session_id") REFERENCES "public"."plc_session"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
-- No added index: the UNIQUE already prefixes (school_id, session_id), which serves the settle-time
-- "all members of this session" read. The per-member "my CPD" dashboard read is (school_id, user_id) but
-- the ledger is tiny (staff × sessions per school) — a scoped scan, no secondary index until measurably needed.

-- ---- RLS — plc_cpd_ledger: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (this name is added to that
-- hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that forgets to set
-- app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'plc_cpd_ledger'
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

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0075 ----
-- Owner-locked (R404): a parent NEVER sees staff CPD, so the table must be denied. This loop is NOT a
-- hand-list: it applies parent_deny to every FORCE-RLS + school_id table that lacks a parent_scope policy
-- — which, after the block above, is the new plc_cpd_ledger plus every already-covered one (it re-creates
-- their identical policy, hence idempotent). It is re-run here rather than hand-listing the one table, so a
-- FUTURE plc table stays auto-denied. RESTRICTIVE is load-bearing: Postgres OR's PERMISSIVE policies, so a
-- permissive parent policy would OR with tenant_isolation and hand a claimed parent the entire school.
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
