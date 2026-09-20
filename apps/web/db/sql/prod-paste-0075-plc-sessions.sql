-- Omnischools — PROD paste 0075: PLC session register (SHS module 4.6 / INCR-48). THREE new tenant
-- tables + their RLS. NO enum (reuses the existing attendance_status enum), NO altered columns, NO
-- backfills, NO seed, NO global-table changes. Idempotent — safe to run more than once. Paste into the
-- Supabase SQL editor on PROD after merging.
--
-- ⚠ NUMBERING (read this once). The DRIZZLE migration is db/migrations/0072_*.sql — the drizzle chain
-- was at 0071 (the PLC spine, 0071_shocking_caretaker), so generate produced 0072. The prod-paste
-- SEQUENCE, however, already reached 0074 (prod-paste-0074-plc-spine.sql — the two sequences have been
-- diverged since INCR-29). So this DDL's prod-paste is 0075 while its migration is 0072; that divergence
-- is expected. The SQL below is byte-identical in EFFECT (same table + constraint + policy names) to
-- migration 0072 followed by db:policies for these three tables — a from-migrations rebuild and this
-- paste produce an identical catalog.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. If migration 0072 ships to
-- prod without this paste, the three plc_session tables exist there with NO row-level security at all:
-- no ENABLE, no FORCE, no tenant_isolation, no parent_deny. Every school's PLC sessions, staff
-- attendance and CPD reflections become readable AND writable from every other school's session, and a
-- claimed parent session reads them too. FAIL-CLOSED gate: run this file on PROD as part of the INCR-48
-- deploy, THEN verify with db/sql/verify-prod-rls.sql — Query 1 must return ZERO ROWS and Query 2's
-- tenant_tables + fully_forced + with_tenant_isolation + parent_denied must each have risen by exactly 3
-- (parent_readable UNCHANGED — PLC is staff CPD, no parent path).
--
-- OWNER-LOCKED: a parent NEVER sees staff PD (R395). There is NO parent_scope on any plc table; the
-- catalog-driven parent_deny loop at the bottom covers all three structurally (FORCE-RLS + school_id, no
-- parent_scope), exactly as it auto-denies every other non-parent-readable tenant table. The PLC session
-- register is OPERATIONAL / SHOWN throughout — NO confidential/REDACTED layer, NO parent_scope, NO new
-- GUC. Reflection ANSWERS are SHOWN (staff CPD ≠ pastoral).
--
-- DDL ORDER (the 0033 FK-before-UNIQUE bug, INSIDE one file — same as the VLC session register 0069 and
-- the PLC spine 0074). Tables are created FIRST, each carrying its PK/UNIQUE INLINE, THEN the FKs are
-- added. `plc_session_tenant_uk UNIQUE (school_id, id)` is the composite-FK TARGET of BOTH
-- plc_session_attendance's (school_id, session_id) FK and plc_session_reflection's (school_id,
-- session_id) FK, and it is emitted INLINE in CREATE TABLE "plc_session" — so it exists before the
-- ALTER ... ADD FOREIGN KEY statements that consume it. plc_session's (school_id, plc_id) FK targets the
-- EXISTING plc_tenant_uk (0071/0074) and its (school_id, academic_period_id) FK the EXISTING
-- academic_period_tenant_uk (0034), both already on prod.
--
-- CONSTRAINT notes (Kofi R382–R390):
--   • plc_session (the held instance): "held" = the row exists — there is NO stored status / started_at /
--     closed_at / held_at / week_no / present_count / points (all DERIVED in lib/plc/, R381/R382).
--     UNIQUE(school_id, plc_id, session_date) = the one-session-per-(PLC × date) invariant AND the
--     open-upsert conflict target. `academic_period_id` is resolved from session_date in lib/ and stored.
--     `agenda_json` is the editable facilitator agenda ({items:[...]}, R385, default the empty shape).
--     `opened_by_user_id` is single-column SET NULL → the GLOBAL ref_user. Its `plc_session_tenant_uk`
--     is the composite-FK target of the two child tables below.
--   • plc_session_attendance: present-by-default (a row exists ONLY for a non-present member; present =
--     absence of a row, R383). `status` REUSES the existing attendance_status enum (NO new enum);
--     `minutes_late` int nullable, CHECK >= 0. `user_id` + `recorded_by_user_id` single-column SET NULL
--     → ref_user (nullable, as SET NULL requires). UNIQUE(school_id, session_id, user_id) = the upsert
--     target.
--   • plc_session_reflection: a SEPARATE table (NOT columns on attendance, R386). Three FIXED answer
--     columns q1/q2/q3 (the frozen R387 prompts — not EAV, so no jsonb). `submitted_at` = the domain
--     submission time; the answers are append-only-hard (R388, app-layer). `confirmed_at` +
--     `confirmed_by_user_id` = the facilitator's one-way confirmation stamp (R389). `user_id` +
--     `confirmed_by_user_id` single-column SET NULL → ref_user. UNIQUE(school_id, session_id, user_id).
--   • ALL school_id FKs are single-column → the ref_school PK (0001) CASCADE. Composite (school_id, X)
--     intra-tenant FKs (plc_id, academic_period_id, session_id) make a cross-tenant reference
--     structurally impossible. NO TRIGGERS (portability).

-- ---- table 1: plc_session (TENANT — the held instance; inline tenant UK the child FKs below need) ----
CREATE TABLE IF NOT EXISTS "plc_session" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "plc_id" uuid NOT NULL,
  "academic_period_id" uuid NOT NULL,
  "session_date" date NOT NULL,
  "topic" text,
  "agenda_json" jsonb DEFAULT '{"items": []}'::jsonb NOT NULL,
  "opened_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plc_session_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "uniq_plc_session" UNIQUE("school_id","plc_id","session_date")
);

-- ---- table 2: plc_session_attendance (TENANT — present-by-default staff P/L/A; LEAF, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "plc_session_attendance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "user_id" uuid,
  "status" "attendance_status" NOT NULL,
  "minutes_late" integer,
  "note" text,
  "recorded_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_plc_session_attendance" UNIQUE("school_id","session_id","user_id"),
  CONSTRAINT "plc_session_attendance_minutes_late_nonneg" CHECK ("plc_session_attendance"."minutes_late" >= 0)
);

-- ---- table 3: plc_session_reflection (TENANT — separate reflection table; LEAF, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "plc_session_reflection" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "user_id" uuid,
  "q1" text,
  "q2" text,
  "q3" text,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "confirmed_at" timestamp with time zone,
  "confirmed_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_plc_session_reflection" UNIQUE("school_id","session_id","user_id")
);

-- ---- foreign keys (guarded so a re-run is a no-op; every CREATE TABLE above is already done) ----
-- All school_id FKs → the ref_school PK (0001), single-column CASCADE.
DO $$ BEGIN
  ALTER TABLE "plc_session" ADD CONSTRAINT "plc_session_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- opener → the GLOBAL ref_user, single-column SET NULL (a removed user clears the stamp).
DO $$ BEGIN
  ALTER TABLE "plc_session" ADD CONSTRAINT "plc_session_opened_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- composite (school_id, plc_id) intra-tenant FK → the EXISTING plc_tenant_uk (0071/0074), CASCADE.
DO $$ BEGIN
  ALTER TABLE "plc_session" ADD CONSTRAINT "plc_session_school_id_plc_id_plc_school_id_id_fk"
    FOREIGN KEY ("school_id","plc_id") REFERENCES "public"."plc"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- composite (school_id, academic_period_id) intra-tenant FK → the EXISTING academic_period_tenant_uk
-- (school_id, period_id) (0034), CASCADE. A cross-tenant period reference is structurally impossible.
DO $$ BEGIN
  ALTER TABLE "plc_session" ADD CONSTRAINT "plc_session_school_id_academic_period_id_academic_period_school_id_period_id_fk"
    FOREIGN KEY ("school_id","academic_period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "plc_session_attendance" ADD CONSTRAINT "plc_session_attendance_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- member → the GLOBAL ref_user, single-column SET NULL (nullable, as SET NULL requires).
DO $$ BEGIN
  ALTER TABLE "plc_session_attendance" ADD CONSTRAINT "plc_session_attendance_user_id_ref_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- recorder → the GLOBAL ref_user, single-column SET NULL.
DO $$ BEGIN
  ALTER TABLE "plc_session_attendance" ADD CONSTRAINT "plc_session_attendance_recorded_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- composite (school_id, session_id) intra-tenant FK → plc_session_tenant_uk (INLINE above), CASCADE.
DO $$ BEGIN
  ALTER TABLE "plc_session_attendance" ADD CONSTRAINT "plc_session_attendance_school_id_session_id_plc_session_school_id_id_fk"
    FOREIGN KEY ("school_id","session_id") REFERENCES "public"."plc_session"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "plc_session_reflection" ADD CONSTRAINT "plc_session_reflection_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- author → the GLOBAL ref_user, single-column SET NULL (nullable, as SET NULL requires).
DO $$ BEGIN
  ALTER TABLE "plc_session_reflection" ADD CONSTRAINT "plc_session_reflection_user_id_ref_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- confirmer → the GLOBAL ref_user, single-column SET NULL.
DO $$ BEGIN
  ALTER TABLE "plc_session_reflection" ADD CONSTRAINT "plc_session_reflection_confirmed_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- composite (school_id, session_id) intra-tenant FK → plc_session_tenant_uk (INLINE above), CASCADE.
DO $$ BEGIN
  ALTER TABLE "plc_session_reflection" ADD CONSTRAINT "plc_session_reflection_school_id_session_id_plc_session_school_id_id_fk"
    FOREIGN KEY ("school_id","session_id") REFERENCES "public"."plc_session"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
-- No added index: each table's UNIQUE already prefixes (school_id, plc_id) / (school_id, session_id),
-- which serve the per-PLC register history and per-session roster / reflection reads respectively.

-- ---- RLS — all THREE tables: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (these three names are
-- added to that hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that
-- forgets to set app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'plc_session',
    'plc_session_attendance',
    'plc_session_reflection'
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

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0074 ----
-- Owner-locked (R395): a parent NEVER sees staff PD, so all three tables must be denied. This loop is NOT
-- a hand-list: it applies parent_deny to every FORCE-RLS + school_id table that lacks a parent_scope
-- policy — which, after the block above, is the three new plc_session tables plus every already-covered
-- one (it re-creates their identical policy, hence idempotent). It is re-run here rather than
-- hand-listing the three, so a FUTURE plc table stays auto-denied. RESTRICTIVE is load-bearing: Postgres
-- OR's PERMISSIVE policies, so a permissive parent policy would OR with tenant_isolation and hand a
-- claimed parent the entire school.
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
