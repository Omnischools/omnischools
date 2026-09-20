-- Omnischools — PROD paste 0069: VLC Session register (SHS module 4.5 / INCR-42a). TWO new tenant tables
-- + their RLS. NO enum change (reuses the existing attendance_status enum), NO altered columns, NO
-- backfills, NO seed, NO global-table changes. Idempotent — safe to run more than once. Paste into the
-- Supabase SQL editor on PROD after merging.
--
-- ⚠ NUMBERING (read this once). The DRIZZLE migration is db/migrations/0067_chubby_unicorn.sql — the
-- drizzle chain was at 0066 (the VLC Peer Guides, 0066_silky_jigsaw), so generate produced 0067. The
-- prod-paste SEQUENCE, however, already reached 0068 (prod-paste-0068-vlc-peer-guides.sql — the two
-- sequences have been diverged since INCR-29, when two policy-only pastes ran ahead of their migrations).
-- So this DDL's prod-paste is 0069 while its migration is 0067; that divergence is expected. The SQL below
-- is byte-identical in EFFECT (same table + constraint names) to migration 0067 followed by db:policies for
-- these two tables — a from-migrations rebuild and this paste produce an identical catalog.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. If migration 0067 ships to
-- prod without this paste, the two vlc tables exist there with NO row-level security at all: no ENABLE, no
-- FORCE, no tenant_isolation, no parent_deny. Every school's Wednesday session register and its
-- present-by-default student attendance become readable AND writable from every other school's session, and
-- a claimed parent session reads them too. FAIL-CLOSED gate: run this file on PROD as part of the INCR-42a
-- deploy, THEN verify with db/sql/verify-prod-rls.sql — Query 1 must return ZERO ROWS and Query 2's
-- tenant_tables + fully_forced + with_tenant_isolation + parent_denied must each have risen by exactly 2.
--
-- OWNER-LOCKED (#4): a parent sees NOTHING VLC-wide. There is NO parent_scope on any vlc table; the
-- catalog-driven parent_deny loop at the bottom covers both structurally (FORCE-RLS + school_id, no
-- parent_scope), exactly as it auto-denies every other non-parent-readable tenant table.
--
-- OWNER-LOCKED (2026-07-27, d): the attendance writer is the session's-class Form Master, FM-only DB write
-- ("PG-first" is a UI capture-order convention, NOT a student/PG write grant). This is an app-layer
-- (lib/vlc/) authorization concern, NOT a DB trigger. NO TRIGGERS (portability).
--
-- OPERATIONAL, SHOWN audit (R316) — the same class as attendance / prep_attendance. NO pastoral PII, NO
-- confidential machinery: 42a builds NO vlc_pastoral_ table, NO status/count/started_at columns, NO
-- small-group / project-brief / reflection / journal table — all of those are DERIVED, ephemeral, or
-- INCR-42b/43.
--
-- DDL ORDER (the 0033 FK-before-UNIQUE bug, INSIDE one file — same as vlc-peer-guides 0068 / sickbay 0057).
-- Tables are created FIRST, each carrying its PK/UNIQUE INLINE, THEN the FKs are added.
--   • `vlc_session_tenant_uk UNIQUE(school_id, id)` is the composite-FK TARGET of vlc_session_attendance's
--     (school_id, session_id) FK; it is emitted INLINE in vlc_session's CREATE TABLE, so it exists before
--     the ALTER ... ADD FOREIGN KEY that consumes it.
--
-- CONSTRAINT notes (Kofi R310–R315):
--   • vlc_session is the HELD-session instance — one row per (class × date). "Held" = the row exists (R312);
--     there is NO status/locked/closed column. session_template_id is a composite FK → vlc_session_template
--     (value + slot A|B DERIVE through it — NO value_id). session_date is a STORED date (prep_attendance
--     tz-boundary discipline). NO programme_id (school singleton), NO academic_period_id (derives from
--     date), NO phase/duration/started_at column (R311 — all DERIVE from the F0 programme). tenant_uk
--     INLINE. UNIQUE(school_id, class_id, session_date) is the natural key + upsert conflict target.
--   • vlc_session_attendance is PRESENT-BY-DEFAULT (the prep_attendance idiom): one row ONLY for a student
--     who was NOT present; PRESENT is the absence of a row, so present/rate/counts all DERIVE (R315 — NO
--     stored present_count/attendance_rate/late_count/status-summary). status REUSES the existing
--     attendance_status enum (NOT a forked VLC enum). minutes_late nullable, CHECK >= 0. NO marked_by_pg /
--     PG column (R313 — PG-gold derives from the INCR-41 roster). UNIQUE(school_id, session_id, student_id)
--     is the upsert conflict target; LEAF (NO tenant UK).
--   • ALL school_id FKs are single-column → the ref_school PK (0001) CASCADE. Composite (school_id, X)
--     intra-tenant FKs (class / vlc_session_template / vlc_session / student) make a cross-tenant reference
--     structurally impossible, CASCADE. Actor stamps (held_by / recorded_by) are the single-column SET NULL
--     → ref_user exemption.

-- ---- table 1: vlc_session (TENANT — inline tenant UK the attendance FK needs) ----
CREATE TABLE IF NOT EXISTS "vlc_session" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "session_template_id" uuid NOT NULL,
  "session_date" date NOT NULL,
  "held_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vlc_session_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "uniq_vlc_session" UNIQUE("school_id","class_id","session_date")
);

-- ---- table 2: vlc_session_attendance (TENANT — present-by-default, LEAF, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "vlc_session_attendance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "status" "attendance_status" NOT NULL,
  "minutes_late" smallint,
  "note" text,
  "recorded_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_vlc_session_attendance" UNIQUE("school_id","session_id","student_id"),
  CONSTRAINT "vlc_session_attendance_minutes_late_nonneg" CHECK ("vlc_session_attendance"."minutes_late" >= 0)
);

-- ---- foreign keys (guarded so a re-run is a no-op; every CREATE TABLE above is already done) ----
-- All school_id FKs → the ref_school PK (0001), single-column CASCADE. Actor stamps → ref_user SET NULL.
DO $$ BEGIN
  ALTER TABLE "vlc_session" ADD CONSTRAINT "vlc_session_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_session" ADD CONSTRAINT "vlc_session_held_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("held_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Composite (school_id, class_id) → class(school_id, id) — the held session's constituency class.
DO $$ BEGIN
  ALTER TABLE "vlc_session" ADD CONSTRAINT "vlc_session_school_id_class_id_class_school_id_id_fk"
    FOREIGN KEY ("school_id","class_id") REFERENCES "public"."class"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Composite (school_id, session_template_id) → vlc_session_template(school_id, id) — value + slot A|B derive through it.
DO $$ BEGIN
  ALTER TABLE "vlc_session" ADD CONSTRAINT "vlc_session_school_id_session_template_id_vlc_session_template_school_id_id_fk"
    FOREIGN KEY ("school_id","session_template_id") REFERENCES "public"."vlc_session_template"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_session_attendance" ADD CONSTRAINT "vlc_session_attendance_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_session_attendance" ADD CONSTRAINT "vlc_session_attendance_recorded_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- The two composite (school_id, X) intra-tenant FKs → the INLINE tenant UK / students UK, CASCADE.
DO $$ BEGIN
  ALTER TABLE "vlc_session_attendance" ADD CONSTRAINT "vlc_session_attendance_school_id_session_id_vlc_session_school_id_id_fk"
    FOREIGN KEY ("school_id","session_id") REFERENCES "public"."vlc_session"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_session_attendance" ADD CONSTRAINT "vlc_session_attendance_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- (No standalone indexes: both UNIQUEs are inline table constraints and their (school_id, class_id) /
--  (school_id, session_id) prefixes serve the per-class history / per-session roster reads. R315 — no
--  derived-scalar columns to index.)

-- ---- RLS — both tables: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (these two names are added
-- to that hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that forgets to
-- set app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'vlc_session',
    'vlc_session_attendance'
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

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0068 ----
-- Owner-locked: a parent NEVER sees VLC, so both tables must be denied. This loop is NOT a hand-list: it
-- applies parent_deny to every FORCE-RLS + school_id table that lacks a parent_scope policy — which, after
-- the block above, is the two new vlc tables plus every already-covered one (it re-creates their identical
-- policy, hence idempotent). It is re-run here rather than hand-listing the two, so a FUTURE vlc table stays
-- auto-denied. RESTRICTIVE is load-bearing: Postgres OR's PERMISSIVE policies, so a permissive parent policy
-- would OR with tenant_isolation and hand a claimed parent the entire school.
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
