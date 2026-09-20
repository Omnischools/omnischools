-- Omnischools — PROD paste 0091: Boarding visiting-day PUBLIC parent RSVP link (SHS module 4.2 / INCR-298
-- part B). ONE new LEAF tenant table `boarding_visit_rsvp_token` + its FKs + index + RLS. Idempotent —
-- safe to run more than once. Paste into the Supabase SQL editor on PROD after merging.
--
-- 🔴 RLS IS NOT AUTO-APPLIED ON PROD. `db:policies` only configures LOCAL DEV. If the drizzle migration
-- (0088_fat_vengeance) ships to prod without this paste, `boarding_visit_rsvp_token` exists there with NO
-- row-level security — so one school's RSVP links (each naming a ward + a guardian phone, and carrying the
-- hash that grants an unauthenticated RSVP against that ward) become readable AND writable from every other
-- school's session. This file is SELF-CONTAINED (creates the table too, all IF NOT EXISTS / guarded), so it
-- is byte-identical in EFFECT to migration 0088 followed by db:policies for this table — run it whether or
-- not the migration has already reached prod.
--
-- ⚠ NUMBERING. The DRIZZLE migration is db/migrations/0088_fat_vengeance.sql; the prod-paste SEQUENCE has
-- been diverged from the migration sequence since INCR-29, so this paste is 0091 while its migration is
-- 0088. That divergence is expected.
--
-- DDL ORDER (recall the 0033 FK-before-UNIQUE bug): table (carrying its PK + token_hash UNIQUE INLINE) →
-- FKs → index → RLS. Every FK target predates this table (all shipped in earlier migrations):
--   • school_id → ref_school(id); issued_by_user_id / guardian_id → ref_user / student_guardian(id).
--   • (school_id, student_id) → students(school_id, id) = students_tenant_uk.
--   • calendar_event_id → boarding_calendar_event(id) (0045); visit_id → boarding_visit(id) (0049).
--
-- FK-shape notes (composite-tenant-FK doctrine):
--   • (school_id, student_id) is the ONLY composite intra-tenant FK (CASCADE) — a cross-tenant ward is
--     structurally impossible.
--   • calendar_event_id, visit_id and guardian_id are all SINGLE-COLUMN SET NULL (the exeat exemption):
--     a composite SET NULL would try to null the NOT-NULL school_id on an independent parent-target delete
--     (de-facto RESTRICT — the score-ledger supersedesFk trap). student_guardian has no (school_id, id)
--     tenant UK anyway, and SET NULL FKs stay single-column by rule. RLS + the tenant-scoped server write
--     already prevent a cross-tenant id reaching the insert (same posture as boarding_visit's own
--     approved_visitor_id / calendar_event_id).
--   • token_hash UNIQUE is GLOBAL (single-column, not school-scoped): the PUBLIC withoutTenantScope lookup
--     resolves the school FROM the token, so the hash alone must be unique.
--
-- PII / SECOND FACTOR: the ONLY PII here is issued_to_phone (E.164 guardian phone, the SMS delivery
-- target). The raw token is NEVER stored (only its SHA-256 hex). There is NO DOB / second-factor column —
-- the ward's date of birth is verified live against students.date_of_birth at submit time. `attempts` is a
-- per-token wrong-DOB counter the endpoint caps (~8) to fence brute-forcing the low-entropy second factor;
-- the token is REUSABLE (repeat submits update the same visit via visit_id — no single-use/consumed flag).
--
-- verify-prod-rls.sql (QUERY 2) DELTAS after this paste, relative to the prior state (ONE table, so +1 each):
--   tenant_tables         +1   (boarding_visit_rsvp_token is a real public table with a school_id column)
--   fully_forced          +1   (ENABLE + FORCE below)
--   with_tenant_isolation +1   (the tenant_isolation policy below)
--   parent_denied         +1   (the catalog-driven parent_deny loop is RE-RUN at the tail of this file —
--                               the current convention, verbatim from db/sql/policies.sql / prod-paste-0090;
--                               it applies RESTRICTIVE parent_deny to every FORCE-RLS + school_id table
--                               lacking a parent_scope, so this NEW table is covered by THIS paste itself,
--                               not by a stale one-shot 0055 loop. This is structural denial — NOT a
--                               parent_scope grant; authenticated parents still never READ the table.)
--   parent_readable       unchanged   (NO parent_scope — authenticated parents never read this table)
--   global_ok             unchanged
-- QUERY 1 (the problem report) must still return ZERO ROWS after the paste.

-- ---- table: boarding_visit_rsvp_token (LEAF — PK + token_hash UNIQUE inline, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "boarding_visit_rsvp_token" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "calendar_event_id" uuid,
  "token_hash" text NOT NULL,
  "issued_to_phone" text,
  "guardian_id" uuid,
  "visit_id" uuid,
  "attempts" integer DEFAULT 0 NOT NULL,
  "issued_by_user_id" uuid,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_boarding_visit_rsvp_token_hash" UNIQUE("token_hash")
);

-- ---- foreign keys (the CREATE TABLE above is done, so its inline PK/UNIQUE exists; all other targets predate this file) ----
DO $$ BEGIN
  ALTER TABLE "boarding_visit_rsvp_token" ADD CONSTRAINT "boarding_visit_rsvp_token_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit_rsvp_token" ADD CONSTRAINT "boarding_visit_rsvp_token_calendar_event_id_boarding_calendar_event_id_fk"
    FOREIGN KEY ("calendar_event_id") REFERENCES "public"."boarding_calendar_event"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit_rsvp_token" ADD CONSTRAINT "boarding_visit_rsvp_token_guardian_id_student_guardian_id_fk"
    FOREIGN KEY ("guardian_id") REFERENCES "public"."student_guardian"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit_rsvp_token" ADD CONSTRAINT "boarding_visit_rsvp_token_visit_id_boarding_visit_id_fk"
    FOREIGN KEY ("visit_id") REFERENCES "public"."boarding_visit"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit_rsvp_token" ADD CONSTRAINT "boarding_visit_rsvp_token_issued_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit_rsvp_token" ADD CONSTRAINT "boarding_visit_rsvp_token_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- index ----
CREATE INDEX IF NOT EXISTS "boarding_visit_rsvp_token_event_idx"
  ON "boarding_visit_rsvp_token" USING btree ("school_id","calendar_event_id");

-- ---- RLS — the same tenant_isolation policy every other tenant table uses (ENABLE + FORCE) ----
ALTER TABLE "boarding_visit_rsvp_token" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boarding_visit_rsvp_token" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "boarding_visit_rsvp_token";
CREATE POLICY tenant_isolation ON "boarding_visit_rsvp_token"
  FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0090 ----
-- Authenticated parents (parent portal, INCR-19a) NEVER read this table: it holds per-ward RSVP-link
-- hashes + guardian phones, and the RSVP write path is a server-side withoutTenantScope bypass, not a
-- parent-role read. This loop is NOT a hand-list: it applies RESTRICTIVE parent_deny to every FORCE-RLS +
-- school_id table that lacks a parent_scope policy — which, after the block above, is the new
-- boarding_visit_rsvp_token plus every already-covered one (it re-creates their identical policy, hence
-- idempotent). Re-running it here (rather than hand-listing the one table) is what keeps prod byte-identical
-- to `db:policies` on dev and covers this new table without relying on a stale one-shot 0055 loop.
-- RESTRICTIVE is load-bearing: Postgres OR's PERMISSIVE policies, so a permissive parent policy would OR
-- with tenant_isolation and hand a claimed parent the entire school; a RESTRICTIVE deny ANDs (tightens) —
-- a parent session (app.current_parent_user set) → USING FALSE → ZERO rows; a staff/bypass session (GUC
-- unset) → USING TRUE → total no-op.
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
