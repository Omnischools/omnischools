-- Omnischools — migration 0052: WASSCE subject-teacher + mock cycle (SHS module 4.3 / INCR-16). The
-- prediction INPUT built on the INCR-15 spine. FOUR NEW tables + FIVE new enums + their RLS. Idempotent
-- — safe to run more than once. Paste into the Supabase SQL editor on PROD after merging. (db:policies
-- only configures local dev; a new tenant table needs its RLS pasted on prod by hand, or it leaks across
-- schools. The one GLOBAL table here needs its bare ENABLE pasted too, or the anon Data API can read it.)
--
-- SCOPE: 0052 is a pure NEW-TABLE migration — NO column ALTERs, NO backfills, NO seed. So this file is the
-- COMPLETE prod application of 0052: the 5 enums + 4 tables + FKs + indexes + RLS. Running it is
-- equivalent to running migration 0052 followed by db:policies for these tables.
--
-- THREE TENANT tables + ONE GLOBAL table (the split — Kofi R4):
--   • mock_exams / mock_results / benchmark_data_points — carry school_id → ENABLE + FORCE RLS +
--     tenant_isolation (the standard tenant policy). Owner is NOT exempt under FORCE (fail-closed).
--   • benchmark_reference — DELIBERATELY GLOBAL, has NO school_id (a benchmark exists for every tenant)
--     → BARE `ENABLE ROW LEVEL SECURITY` ONLY: NO FORCE, NO tenant_isolation policy. The ref_region/
--     ref_user idiom — the postgres table owner (the app connection) stays exempt and keeps full access,
--     while the Data API roles (anon / authenticated) are denied by there being no permissive policy.
--     DO NOT add FORCE or a tenant_isolation policy to benchmark_reference.
--
-- DDL ORDER (recall the 0033 FK-before-UNIQUE bug): enums → tables (each carrying its UNIQUE/PK/CHECK
-- INLINE) → FKs → indexes → RLS. Every FK target is created before the FK that references it — every
-- referenced constraint is either a tenant UK emitted INLINE in a CREATE TABLE above, or an INCR-15
-- (0051) tenant UK already shipped:
--   • mock_exams  (school_id, cohort_id)    → wassce_cohort_tenant_uk (0051)
--   • mock_results (school_id, mock_id)      → mock_exams_tenant_uk (inline above)
--   • mock_results (school_id, candidate_id) → wassce_candidates_tenant_uk (0051)
--   • mock_results (school_id, subject_id)   → wassce_subjects_tenant_uk (0051)
--   • benchmark_data_points (school_id, subject_id) → wassce_subjects_tenant_uk (0051)
--
-- CONSTRAINT notes (Kofi rulings 2026-07-19):
--   • R1 — mock_exams: mock_number has NO CHECK ceiling (>2 allowed). Predictor is an explicit
--     is_predictor bool, enforced one-per-cohort by the PARTIAL unique index uniq_mock_exam_predictor
--     (WHERE is_predictor) — NOT "highest mock_number". Cohort link is a COMPOSITE FK (ratified
--     deviation from BUILD_STACK's loose cohort_year).
--   • R2 — mock_results: teacher enters grade A1–F9 directly (wassce_grade NOT NULL, authoritative);
--     raw_score/max_score nullable diagnostic. Predicted grade is DERIVED-ON-READ
--     COALESCE(moderated_grade, grade) of the is_predictor mock — NO stored predicted_grade column.
--   • R3 — mock_results moderation trail: same-row CHECK mock_results_moderation_trail makes a set
--     moderated_grade require BOTH moderator_user_id AND moderated_at (portable, no trigger; INCR-15
--     idiom). Moderation WRITE UI is INCR-18; columns + CHECK are authored now.
--   • R3b — mock marking lock (mock_exams.marking_complete_at) is INDEPENDENT of the registration
--     freeze (wassce_cohort.setup_frozen_at) — orthogonal locks, enforced app-side.

-- ---- enums needed by the new tables ----
DO $$ BEGIN
  CREATE TYPE "public"."wassce_grade" AS ENUM('A1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'E8', 'F9');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."benchmark_source" AS ENUM('SCHOOLUP_DIRECT', 'WAEC_NATIONAL', 'WAEC_REGIONAL_SUMMARY', 'INTERPOLATED', 'MULTI_SCHOOL_POOL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."benchmark_quality" AS ENUM('STRONG', 'MODERATE', 'DIRECTIONAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."benchmark_metric" AS ENUM('CREDIT_RATE', 'DISTINCTION_RATE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."benchmark_scope" AS ENUM('SCHOOL', 'REGION', 'NATIONAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- table 1: mock_exams (TENANT, referenced — inline tenant UK, no mock_number ceiling) ----
-- Cohort-wide, cohort-scoped (R1). is_predictor + a partial unique (below) = one predictor per cohort.
-- marking_complete_at locks MARKING independently of the roster freeze (R3b). Referenced by mock_results.
CREATE TABLE IF NOT EXISTS "mock_exams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "cohort_id" uuid NOT NULL,
  "name" text NOT NULL,
  "mock_number" smallint NOT NULL,
  "is_predictor" boolean DEFAULT false NOT NULL,
  "scheduled_start" date,
  "scheduled_end" date,
  "marking_complete_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_mock_exam_number" UNIQUE("school_id","cohort_id","mock_number"),
  CONSTRAINT "mock_exams_tenant_uk" UNIQUE("school_id","id")
);

-- ---- table 2: mock_results (TENANT, LEAF — inline UNIQUE + moderation-trail CHECK, no tenant UK) ----
-- One grade per (candidate × subject × mock). grade A1–F9 authoritative (R2); moderation columns + trail
-- CHECK authored now (write UI INCR-18). LEAF → NO tenant UK. Actor stamps single-col SET NULL to ref_user.
CREATE TABLE IF NOT EXISTS "mock_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "mock_id" uuid NOT NULL,
  "candidate_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "grade" "wassce_grade" NOT NULL,
  "raw_score" numeric(5, 2),
  "max_score" numeric(5, 2),
  "marked_by_user_id" uuid,
  "marked_at" timestamptz,
  "moderated_grade" "wassce_grade",
  "moderator_user_id" uuid,
  "moderated_at" timestamptz,
  "moderation_reason" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_mock_result" UNIQUE("school_id","mock_id","candidate_id","subject_id"),
  CONSTRAINT "mock_results_moderation_trail" CHECK ("mock_results"."moderated_grade" IS NULL OR ("mock_results"."moderator_user_id" IS NOT NULL AND "mock_results"."moderated_at" IS NOT NULL))
);

-- ---- table 3: benchmark_data_points (TENANT — this school's own SCHOOLUP_DIRECT rates) ----
-- subject_id NULLABLE: NULL = school-wide row, set = per-subject (composite FK, MATCH SIMPLE skips NULL).
-- No tenant UK (nothing references it). "My cohort vs region/national" is DERIVED on read (no pooling).
CREATE TABLE IF NOT EXISTS "benchmark_data_points" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "subject_id" uuid,
  "metric" "benchmark_metric" NOT NULL,
  "scope" "benchmark_scope" NOT NULL,
  "value" numeric(5, 2) NOT NULL,
  "source" "benchmark_source" NOT NULL,
  "quality" "benchmark_quality" NOT NULL,
  "confidence_interval_pp" numeric(5, 2),
  "reference_year" smallint NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

-- ---- table 4: benchmark_reference (GLOBAL — NO school_id, keyed by subject_name text) ----
-- WAEC national + directional regional summaries (R4). No composite FK (global). Gets a BARE ENABLE RLS
-- below (no FORCE, no policy). region set for REGION scope; NULL for NATIONAL.
CREATE TABLE IF NOT EXISTS "benchmark_reference" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subject_name" text NOT NULL,
  "region" text,
  "metric" "benchmark_metric" NOT NULL,
  "scope" "benchmark_scope" NOT NULL,
  "value" numeric(5, 2) NOT NULL,
  "source" "benchmark_source" NOT NULL,
  "quality" "benchmark_quality" NOT NULL,
  "confidence_interval_pp" numeric(5, 2),
  "reference_year" smallint NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

-- ---- foreign keys (all CREATE TABLEs above are done, so every inline/0051 UK/PK target exists) ----
-- mock_exams: single-col school_id → ref_school CASCADE; composite (school_id, cohort_id) → wassce_cohort.
DO $$ BEGIN
  ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_school_id_cohort_id_wassce_cohort_school_id_id_fk"
    FOREIGN KEY ("school_id","cohort_id") REFERENCES "public"."wassce_cohort"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- mock_results: single-col school_id → ref_school CASCADE; two single-col SET NULL actor stamps →
-- ref_user; composite (school_id, mock_id) → mock_exams; (school_id, candidate_id) → wassce_candidates;
-- (school_id, subject_id) → wassce_subjects. All composites CASCADE.
DO $$ BEGIN
  ALTER TABLE "mock_results" ADD CONSTRAINT "mock_results_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mock_results" ADD CONSTRAINT "mock_results_marked_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("marked_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mock_results" ADD CONSTRAINT "mock_results_moderator_user_id_ref_user_id_fk"
    FOREIGN KEY ("moderator_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mock_results" ADD CONSTRAINT "mock_results_school_id_mock_id_mock_exams_school_id_id_fk"
    FOREIGN KEY ("school_id","mock_id") REFERENCES "public"."mock_exams"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mock_results" ADD CONSTRAINT "mock_results_school_id_candidate_id_wassce_candidates_school_id_id_fk"
    FOREIGN KEY ("school_id","candidate_id") REFERENCES "public"."wassce_candidates"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mock_results" ADD CONSTRAINT "mock_results_school_id_subject_id_wassce_subjects_school_id_id_fk"
    FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."wassce_subjects"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- benchmark_data_points: single-col school_id → ref_school CASCADE; composite (school_id, subject_id) →
-- wassce_subjects CASCADE (only enforced when subject_id set — MATCH SIMPLE skips the school-wide row).
DO $$ BEGIN
  ALTER TABLE "benchmark_data_points" ADD CONSTRAINT "benchmark_data_points_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "benchmark_data_points" ADD CONSTRAINT "benchmark_data_points_school_id_subject_id_wassce_subjects_school_id_id_fk"
    FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."wassce_subjects"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- benchmark_reference: GLOBAL — NO foreign keys (deliberately tenant-agnostic).

-- ---- indexes ----
-- Exactly one predictor mock per cohort (R1) — partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_mock_exam_predictor"
  ON "mock_exams" USING btree ("school_id","cohort_id") WHERE "is_predictor";
-- mark-entry grid read: a mock's results for one subject.
CREATE INDEX IF NOT EXISTS "mock_results_mock_subject_idx"
  ON "mock_results" USING btree ("school_id","mock_id","subject_id");
-- trajectory read: a candidate's grades across mocks.
CREATE INDEX IF NOT EXISTS "mock_results_candidate_idx"
  ON "mock_results" USING btree ("school_id","candidate_id");

-- ---- RLS — the 3 TENANT tables: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'mock_exams',
    'mock_results',
    'benchmark_data_points'
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

-- ---- RLS — the GLOBAL table: BARE ENABLE only (NO FORCE, NO policy) ----
-- benchmark_reference has NO school_id. Owner (the app connection) stays exempt; the Data API roles
-- (anon / authenticated) are denied by there being no permissive policy — the ref_region idiom. This is
-- INTENTIONAL: a benchmark exists for every tenant, so tenant isolation would be wrong here.
ALTER TABLE "benchmark_reference" ENABLE ROW LEVEL SECURITY;
