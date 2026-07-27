-- Omnischools — PROD paste 0068: VLC Peer Guides (SHS module 4.5 / INCR-41). THREE new tenant tables +
-- their RLS. NO enum, NO altered columns, NO backfills, NO seed, NO global-table changes. Idempotent
-- — safe to run more than once. Paste into the Supabase SQL editor on PROD after merging.
--
-- ⚠ NUMBERING (read this once). The DRIZZLE migration is db/migrations/0066_silky_jigsaw.sql — the
-- drizzle chain was at 0065 (the VLC F0 spine, 0065_light_james_howlett), so generate produced 0066.
-- The prod-paste SEQUENCE, however, already reached 0067 (prod-paste-0067-vlc-spine.sql — itself a
-- migration-0065 DDL renumbered to 0067 because two policy-only pastes ran ahead of their migrations
-- back at INCR-29). So this DDL's prod-paste is 0068 while its migration is 0066; the two sequences
-- have been diverged since INCR-29. The SQL below is byte-identical in EFFECT (same table + constraint
-- + index names) to migration 0066 followed by db:policies for these three tables — a from-migrations
-- rebuild and this paste produce an identical catalog.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. If migration 0066 ships
-- to prod without this paste, the three vlc tables exist there with NO row-level security at all: no
-- ENABLE, no FORCE, no tenant_isolation, no parent_deny. Every school's Peer Guide roster, training
-- events and training-attendance become readable AND writable from every other school's session, and a
-- claimed parent session reads them too. FAIL-CLOSED gate: run this file on PROD as part of the INCR-41
-- deploy, THEN verify with db/sql/verify-prod-rls.sql — Query 1 must return ZERO ROWS and Query 2's
-- tenant_tables + fully_forced + with_tenant_isolation + parent_denied must each have risen by exactly 3.
--
-- OWNER-LOCKED (R309): a parent sees NOTHING VLC-wide. There is NO parent_scope on any vlc table; the
-- catalog-driven parent_deny loop at the bottom covers all three structurally (FORCE-RLS + school_id,
-- no parent_scope), exactly as it auto-denies every other non-parent-readable tenant table.
--
-- OWNER-LOCKED (2026-07-27, OC2): the class vote is OFFLINE — the Dean records only the OUTCOME. There
-- is deliberately NO candidate table, NO ballot/vote table, NO vacancy table and NO vote-date storage:
-- a VACANCY is DERIVED (an eligible class with <2 active PGs in the current period). All cross-row
-- validation (hard cap of 2 active per class×period, F2/F3 eligibility) lives in lib/vlc/, NOT the DB.
-- NO TRIGGERS (portability).
--
-- DDL ORDER (the 0033 FK-before-UNIQUE bug, INSIDE one file — same as vlc-spine 0067 / sickbay 0057).
-- Tables are created FIRST, each carrying its PK/UNIQUE INLINE, THEN the FKs are added.
--   • `vlc_peer_guide_tenant_uk UNIQUE(school_id, id)` and `vlc_training_tenant_uk UNIQUE(school_id, id)`
--     are the composite-FK TARGETS of vlc_training_absence's (school_id, peer_guide_id) and
--     (school_id, training_id) FKs; both are emitted INLINE in their CREATE TABLE, so they exist before
--     the ALTER ... ADD FOREIGN KEY that consumes them.
--
-- CONSTRAINT notes (Kofi R301–R309):
--   • vlc_peer_guide is APPEND-ONLY (the bunk_allocation open-row idiom): `ended_at IS NULL` = currently
--     serving. Vacate = set ended_at (never DELETE); fill = INSERT a fresh row scoped to the SAME
--     current academic_period_id. Tenure = one academic_period (R303). NO stored status/count/
--     gender-balance/slot-gender/training-completed column — all DERIVED (R302). The ONE cross-row
--     invariant a constraint can carry is the partial unique `uniq_vlc_peer_guide_active` = at most one
--     ACTIVE appointment per (student × period); ended rows are exempt via the WHERE (re-appointment
--     after stepping aside, or in a later period, is legal). class_id is the CONSTITUENCY class.
--   • vlc_training is a Dean-authored monthly event. academic_year is TEXT (periods carry it as text —
--     NOT an FK). NO stored attendance/status/count — the % DERIVES from the absence rows. duration_min
--     CHECK > 0 (a zero-minute training is not a training).
--   • vlc_training_absence is PRESENT-BY-DEFAULT (the prep_attendance idiom): one row ONLY for a PG who
--     was NOT present; PRESENT is the absence of a row. UNIQUE(school_id, training_id, peer_guide_id) is
--     the upsert conflict target. `excused` defaults false.
--   • ALL school_id FKs are single-column → the ref_school PK (0001) CASCADE. Composite (school_id, X)
--     intra-tenant FKs (student / class / academic_period / training / peer_guide) make a cross-tenant
--     reference structurally impossible, CASCADE. Actor stamps (appointed_by / recorded_by) are the
--     single-column SET NULL → ref_user exemption.

-- ---- table 1: vlc_peer_guide (TENANT — inline tenant UK the absence FK needs) ----
CREATE TABLE IF NOT EXISTS "vlc_peer_guide" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "academic_period_id" uuid NOT NULL,
  "appointed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "appointed_by_user_id" uuid,
  "ended_at" timestamp with time zone,
  "ended_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vlc_peer_guide_tenant_uk" UNIQUE("school_id","id")
);

-- ---- table 2: vlc_training (TENANT — inline tenant UK the absence FK needs) ----
CREATE TABLE IF NOT EXISTS "vlc_training" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "academic_year" text NOT NULL,
  "scheduled_date" date NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "duration_min" smallint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vlc_training_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "vlc_training_duration_min_positive" CHECK ("vlc_training"."duration_min" > 0)
);

-- ---- table 3: vlc_training_absence (TENANT — present-by-default, LEAF, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "vlc_training_absence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "training_id" uuid NOT NULL,
  "peer_guide_id" uuid NOT NULL,
  "excused" boolean DEFAULT false NOT NULL,
  "note" text,
  "recorded_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_vlc_training_absence" UNIQUE("school_id","training_id","peer_guide_id")
);

-- ---- foreign keys (guarded so a re-run is a no-op; every CREATE TABLE above is already done) ----
-- All school_id FKs → the ref_school PK (0001), single-column CASCADE. Actor stamps → ref_user SET NULL.
DO $$ BEGIN
  ALTER TABLE "vlc_peer_guide" ADD CONSTRAINT "vlc_peer_guide_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_peer_guide" ADD CONSTRAINT "vlc_peer_guide_appointed_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("appointed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_peer_guide" ADD CONSTRAINT "vlc_peer_guide_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_peer_guide" ADD CONSTRAINT "vlc_peer_guide_school_id_class_id_class_school_id_id_fk"
    FOREIGN KEY ("school_id","class_id") REFERENCES "public"."class"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Composite (school_id, academic_period_id) → academic_period(school_id, period_id) — the tenure scope.
DO $$ BEGIN
  ALTER TABLE "vlc_peer_guide" ADD CONSTRAINT "vlc_peer_guide_school_id_academic_period_id_academic_period_school_id_period_id_fk"
    FOREIGN KEY ("school_id","academic_period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_training" ADD CONSTRAINT "vlc_training_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_training_absence" ADD CONSTRAINT "vlc_training_absence_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_training_absence" ADD CONSTRAINT "vlc_training_absence_recorded_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- The two composite (school_id, X) intra-tenant FKs → the INLINE tenant UKs created above, CASCADE.
DO $$ BEGIN
  ALTER TABLE "vlc_training_absence" ADD CONSTRAINT "vlc_training_absence_school_id_training_id_vlc_training_school_id_id_fk"
    FOREIGN KEY ("school_id","training_id") REFERENCES "public"."vlc_training"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_training_absence" ADD CONSTRAINT "vlc_training_absence_school_id_peer_guide_id_vlc_peer_guide_school_id_id_fk"
    FOREIGN KEY ("school_id","peer_guide_id") REFERENCES "public"."vlc_peer_guide"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes (IF NOT EXISTS, so a re-run is a no-op) ----
-- At most one ACTIVE appointment per (student × period) — PARTIAL unique; ended rows exempt via the
-- WHERE, so re-appointment after stepping aside or in a later period is legal (R302/R303).
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_vlc_peer_guide_active"
  ON "vlc_peer_guide" USING btree ("school_id","student_id","academic_period_id")
  WHERE "ended_at" IS NULL;
-- Read paths. The roster grid + the hard-cap-2 / vacancy reads are active PGs per (class × period); the
-- per-year training calendar; the per-PG attendance-% derivation (a PG's absences across trainings).
CREATE INDEX IF NOT EXISTS "vlc_peer_guide_class_period_idx"
  ON "vlc_peer_guide" USING btree ("school_id","class_id","academic_period_id");
CREATE INDEX IF NOT EXISTS "vlc_training_year_idx"
  ON "vlc_training" USING btree ("school_id","academic_year");
CREATE INDEX IF NOT EXISTS "vlc_training_absence_peer_guide_idx"
  ON "vlc_training_absence" USING btree ("school_id","peer_guide_id");

-- ---- RLS — all THREE tables: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (these three names are
-- added to that hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that
-- forgets to set app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'vlc_peer_guide',
    'vlc_training',
    'vlc_training_absence'
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
