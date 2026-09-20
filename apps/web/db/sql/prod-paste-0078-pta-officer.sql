-- Omnischools — PROD paste 0078: PTA officer matrix (SHS module 4.7 / INCR-51). ONE new tenant table
-- (pta_officer) + its RLS. NO enum, NO altered columns, NO backfills, NO seed, NO global-table changes.
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD after merging.
--
-- ⚠ NUMBERING (read this once). The DRIZZLE migration is db/migrations/0075_giant_sabretooth.sql — the
-- drizzle chain was at 0074 (the PTA spine, 0074_workable_overlord), so generate produced 0075. The
-- prod-paste SEQUENCE, however, already reached 0077 (prod-paste-0077-pta-spine.sql — the two sequences
-- have diverged since INCR-29). So this DDL's prod-paste is 0078 while its migration is 0075; that
-- divergence is expected. The SQL below is byte-identical in EFFECT (same table + constraints + indexes +
-- policies) to migration 0075 followed by db:policies for pta_officer — a from-migrations rebuild and this
-- paste produce an identical catalog.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. If migration 0075 ships to
-- prod without this paste, pta_officer exists there with NO row-level security at all: no ENABLE, no FORCE,
-- no tenant_isolation, no parent_deny. Every school's PTA officer matrix — office, holder identity,
-- election_ref, term — becomes readable AND writable from every other school's session, and a claimed
-- parent session reads it too. FAIL-CLOSED gate: run this file on PROD as part of the INCR-51 deploy, THEN
-- verify with db/sql/verify-prod-rls.sql — Query 1 must return ZERO ROWS and Query 2's tenant_tables +
-- fully_forced + with_tenant_isolation + parent_denied must each have risen by exactly 1 (parent_readable
-- UNCHANGED — the matrix has no parent path in THIS increment; the school-wide-parent public-transparency
-- read is INCR-55, R429).
--
-- OWNER-LOCKED (R428): an officer is a DATA position, NOT a KnownAppRole (OC3). A parent sees NOTHING of
-- the matrix here. There is NO parent_scope on pta_officer; the catalog-driven parent_deny loop at the
-- bottom covers it structurally (FORCE-RLS + school_id, no parent_scope), exactly as it auto-denies every
-- other non-parent-readable tenant table. OPERATIONAL / SHOWN — NO confidential/REDACTED layer, NO
-- parent_scope, NO new GUC, NO triggers.
--
-- DDL ORDER — no intra-file ordering hazard: pta_officer's composite (school_id, pta_id) FK targets the
-- PRE-EXISTING ptas UNIQUE(school_id, id) = ptas_tenant_uk (created in migration 0074 / prod-paste 0077,
-- already on prod). Its person_user_id FK targets the GLOBAL ref_user, and its school_id FK the ref_school
-- PK — all three FK targets pre-exist. Every FK is added in a DO-guarded block AFTER the CREATE TABLE, so
-- a re-run is a clean no-op (the 0033 target-before-FK discipline is satisfied trivially — nothing here is
-- a fresh UNIQUE target).
--
-- CONSTRAINT notes (Kofi R419–R424):
--   • HOLDER = person_user_id (single-column SET NULL → the GLOBAL ref_user) XOR external_name (the rare
--     external non-user holder). `pta_officer_at_most_one_holder` CHECK is at-MOST-one, NOT exactly-one: a
--     SET NULL degradation (holder user removed) must not violate it; exactly-one is app-side (R419).
--   • `office` TEXT, NO CHECK / NO FK — validated app-side ∈ the tier's officer_roles (per-school config,
--     drift-tolerant — removing an office from config does not cascade onto live rows, R420).
--   • `assignment_basis` CHECK IN ('ELECTED', 'APPOINTED') — the meaningful binary that drives term
--     auto-calc (R423). `election_ref` NOT NULL (mandatory free-text audit of how appointed).
--   • MULTI-HAT = N rows; PARTIAL UNIQUE (school_id, pta_id, office) WHERE ended_at IS NULL = ONE CURRENT
--     holder per office per PTA, ended rows exempt (= history; soft-end + re-appoint, R421). A plain UNIQUE
--     would collide with the ended row — the partial WHERE is load-bearing.
--   • Composite (school_id, pta_id) FK → ptas tenant_uk CASCADE (a PTA delete takes its officers; a
--     cross-tenant PTA reference is structurally impossible). LEAF (nothing FKs to an officer) → NO
--     tenant_uk. Index (school_id, person_user_id) = the canActAsPtaOfficer identity-gate lookup (R426).

-- ---- table: pta_officer (TENANT — the office × holder appointment roster; LEAF, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "pta_officer" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "pta_id" uuid NOT NULL,
  "person_user_id" uuid,
  "external_name" text,
  "office" text NOT NULL,
  "assignment_basis" text NOT NULL,
  "election_ref" text NOT NULL,
  "term_start" date NOT NULL,
  "term_end" date,
  "ended_at" timestamp with time zone,
  "end_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pta_officer_at_most_one_holder" CHECK (NOT ("pta_officer"."person_user_id" IS NOT NULL AND "pta_officer"."external_name" IS NOT NULL)),
  CONSTRAINT "pta_officer_assignment_basis_valid" CHECK ("pta_officer"."assignment_basis" IN ('ELECTED', 'APPOINTED'))
);

-- ---- foreign keys (guarded so a re-run is a no-op; the CREATE TABLE above is already done) ----
-- pta_officer.school_id → ref_school PK (0001), single-column CASCADE.
DO $$ BEGIN
  ALTER TABLE "pta_officer" ADD CONSTRAINT "pta_officer_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_officer.person_user_id → the GLOBAL ref_user, single-column SET NULL (nullable holder).
DO $$ BEGIN
  ALTER TABLE "pta_officer" ADD CONSTRAINT "pta_officer_person_user_id_ref_user_id_fk"
    FOREIGN KEY ("person_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_officer composite (school_id, pta_id) → the PRE-EXISTING ptas (school_id, id) tenant UK, CASCADE (a
-- PTA delete takes its officers). A cross-tenant PTA reference is structurally impossible.
DO $$ BEGIN
  ALTER TABLE "pta_officer" ADD CONSTRAINT "pta_officer_school_id_pta_id_ptas_school_id_id_fk"
    FOREIGN KEY ("school_id","pta_id") REFERENCES "public"."ptas"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
-- The PARTIAL UNIQUE (R421): ONE CURRENT holder per office per PTA; ended rows exempt (= history). The
-- WHERE is load-bearing — a plain UNIQUE would collide with a soft-ended row and block re-appointment.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_pta_officer_current"
  ON "pta_officer" USING btree ("school_id","pta_id","office") WHERE "pta_officer"."ended_at" IS NULL;
-- The canActAsPtaOfficer identity-gate lookup (R426) — "which offices does this user hold?".
CREATE INDEX IF NOT EXISTS "pta_officer_person_idx"
  ON "pta_officer" USING btree ("school_id","person_user_id");

-- ---- RLS — pta_officer: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (pta_officer is added to
-- that hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that forgets to
-- set app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'pta_officer'
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

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0077 ----
-- Owner-locked (R428): a parent sees NOTHING of the officer matrix in this increment, so pta_officer must
-- be denied. This loop is NOT a hand-list: it applies parent_deny to every FORCE-RLS + school_id table
-- that lacks a parent_scope policy — which, after the block above, is the new pta_officer plus every
-- already-covered one (it re-creates their identical policy, hence idempotent). It is re-run here rather
-- than hand-listing, so a FUTURE PTA table stays auto-denied. RESTRICTIVE is load-bearing: Postgres OR's
-- PERMISSIVE policies, so a permissive parent policy would OR with tenant_isolation and hand a claimed
-- parent the entire school. (The school-wide-parent public-transparency read is INCR-55, R429 — a
-- dedicated withParentScope reader added THERE, not a widening of this deny.)
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
