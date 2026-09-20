-- Omnischools — migration 0051: WASSCE cohort spine (SHS module 4.3 / INCR-15). The ROOT of the
-- WASSCE module. SEVEN NEW tenant tables (wassce_cohort, wassce_programmes, wassce_subjects,
-- wassce_candidates, wassce_candidate_subject, wassce_papers, wassce_paper_sittings) plus their 4
-- enums plus their RLS. Idempotent — safe to run more than once. Paste into the Supabase SQL editor
-- on PROD after merging. (db:policies only configures local dev; a new tenant table needs its RLS
-- pasted on prod by hand, or it leaks across schools.)
--
-- SCOPE: 0051 is a pure NEW-TABLE migration — NO column ALTERs, NO backfills, NO seed. So this file is
-- the COMPLETE prod application of 0051: the 4 enums + 7 tables + FKs + indexes + FORCE RLS on all
-- seven. Running it is equivalent to running migration 0051 followed by db:policies for these tables.
--
-- READ-ONLY increment: INCR-15 seeds the WASSCE-2026 F3 cohort already-frozen; NO server action
-- mutates any spine row. The freeze/unfreeze co-sign action + the post-freeze typo-fix write-flow are
-- DEFERRED to a later increment — this migration builds the model + display columns only.
--
-- DDL ORDER (recall the 0033 FK-before-UNIQUE bug): enums → tables (each carrying its UNIQUE/PK/CHECK
-- INLINE) → FKs → indexes → RLS. Every FK target is created before the FK that references it, because
-- every referenced constraint is a tenant UK emitted INLINE in CREATE TABLE and all seven CREATE TABLE
-- statements run before any ADD CONSTRAINT FK:
--   • wassce_candidates (school_id, cohort_id)    → wassce_cohort_tenant_uk
--   • wassce_candidates (school_id, programme_id)  → wassce_programmes_tenant_uk
--   • wassce_candidates (school_id, student_id)    → students_tenant_uk (shipped)
--   • wassce_subjects  (school_id, programme_id)   → wassce_programmes_tenant_uk (Kofi Ruling 4)
--   • wassce_candidate_subject (school_id, candidate_id) → wassce_candidates_tenant_uk (Kofi Ruling 2)
--   • wassce_candidate_subject (school_id, subject_id)   → wassce_subjects_tenant_uk
--   • wassce_papers (school_id, cohort_id)  → wassce_cohort_tenant_uk (K2 cohort-scoped)
--   • wassce_papers (school_id, subject_id) → wassce_subjects_tenant_uk
--   • wassce_paper_sittings (school_id, candidate_id) → wassce_candidates_tenant_uk
--   • wassce_paper_sittings (school_id, paper_id)     → wassce_papers_tenant_uk (K2)
--
-- TENANT-UK vs LEAF doctrine (per table):
--   • wassce_cohort / wassce_programmes / wassce_subjects / wassce_candidates / wassce_papers — DURABLE
--     + REFERENCED → each carries a composite (school_id, id) tenant UK (the F0-spine pattern).
--   • wassce_candidate_subject — LEAF (nothing references it) → FORCE RLS but NO tenant UK.
--   • wassce_paper_sittings — LEAF → FORCE RLS but NO tenant UK.
--
-- CONSTRAINT notes (Kofi rulings 2026-07-19):
--   • Ruling 1 — freeze is PER-COHORT, keyed (school_id, exam_year). Two same-row CHECKs make the
--     co-sign invariants structural (no trigger, portable): wassce_cohort_freeze_needs_both_cosigns
--     (setup_frozen_at settable only when BOTH cosign timestamps present) +
--     wassce_cohort_distinct_cosigners (the two signer ids must differ → self-cosign rejected).
--   • Ruling 3 — uniq_wassce_index_number is TENANT-scoped UNIQUE(school_id, index_number), NOT global
--     (a global unique would leak cross-tenant row existence below RLS).
--   • Ruling 4 — wassce_subjects carries a COMPOSITE FK to wassce_programmes(school_id, id) (closes the
--     through-join RLS escape).
--   • K3 — fee/NHIS/medical are DISPLAY flags (reg_flag, nullable), never candidate_status, never
--     blockers; candidate_status is the WAEC lifecycle only.

-- ---- enums needed by the spine tables ----
DO $$ BEGIN
  CREATE TYPE "public"."wassce_candidate_status" AS ENUM('REGISTERED', 'ACTIVE', 'WITHDRAWN', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."wassce_subject_type" AS ENUM('CORE', 'ELECTIVE', 'OPTIONAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."wassce_paper_type" AS ENUM('OBJECTIVE', 'ESSAY', 'PRACTICAL', 'ORAL', 'COMBINED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."wassce_reg_flag" AS ENUM('ON_MEDICAL', 'NHIS_ISSUE', 'FEE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- table 1: wassce_cohort (freeze anchor — inline tenant UK + 2 co-sign CHECKs) ----
-- One cohort per (school × exam_year). setup_frozen_at NULL = in-flight, non-NULL = frozen. The two
-- co-signs are discrete {actor id, ts} pairs (single-col SET NULL users FKs); the CHECKs enforce
-- both-present-to-freeze + distinct-signers (self-cosign rejected). Referenced by candidates + papers.
CREATE TABLE IF NOT EXISTS "wassce_cohort" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "exam_year" integer NOT NULL,
  "setup_frozen_at" timestamptz,
  "headmaster_cosign_user_id" uuid,
  "headmaster_cosign_at" timestamptz,
  "academic_cosign_user_id" uuid,
  "academic_cosign_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_wassce_cohort_per_year" UNIQUE("school_id","exam_year"),
  CONSTRAINT "wassce_cohort_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "wassce_cohort_freeze_needs_both_cosigns" CHECK ("wassce_cohort"."setup_frozen_at" IS NULL OR ("wassce_cohort"."headmaster_cosign_at" IS NOT NULL AND "wassce_cohort"."academic_cosign_at" IS NOT NULL)),
  CONSTRAINT "wassce_cohort_distinct_cosigners" CHECK ("wassce_cohort"."headmaster_cosign_user_id" IS NULL OR "wassce_cohort"."academic_cosign_user_id" IS NULL OR "wassce_cohort"."headmaster_cosign_user_id" <> "wassce_cohort"."academic_cosign_user_id")
);

-- ---- table 2: wassce_programmes (school-level reference — inline tenant UK) ----
-- DURABLE, NOT cohort-scoped. programme reuses the fixed GES enum (bridges to classes.programme).
-- active_flag soft-delete (K5). Referenced by wassce_subjects + wassce_candidates.
CREATE TABLE IF NOT EXISTS "wassce_programmes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "programme" "programme" NOT NULL,
  "name" text NOT NULL,
  "active_flag" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_wassce_programme_per_school" UNIQUE("school_id","programme"),
  CONSTRAINT "wassce_programmes_tenant_uk" UNIQUE("school_id","id")
);

-- ---- table 3: wassce_subjects (school-level reference, per-programme — inline tenant UK) ----
-- Composite FK to wassce_programmes(school_id, id) (Ruling 4). subject_type ↔ Core/Elec/Alt (K1).
-- active_flag soft-delete (K5). Referenced by wassce_candidate_subject + wassce_papers.
CREATE TABLE IF NOT EXISTS "wassce_subjects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "programme_id" uuid NOT NULL,
  "name" text NOT NULL,
  "subject_type" "wassce_subject_type" NOT NULL,
  "active_flag" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_wassce_subject_per_programme" UNIQUE("school_id","programme_id","name"),
  CONSTRAINT "wassce_subjects_tenant_uk" UNIQUE("school_id","id")
);

-- ---- table 4: wassce_candidates (the §4 roster — inline tenant UK + tenant-scoped index number) ----
-- Cohort-scoped. candidate_status = WAEC lifecycle only (K3); reg_flag = display flag (NULL=Confirmed).
-- index_number is TENANT-scoped unique (Ruling 3). accommodations_json stays jsonb (Ruling 2).
-- mock_2_aggregate seeded display-only, projected_aggregate stays NULL (K4). Referenced by
-- wassce_candidate_subject + wassce_paper_sittings.
CREATE TABLE IF NOT EXISTS "wassce_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "cohort_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "programme_id" uuid NOT NULL,
  "index_number" text NOT NULL,
  "centre_code" text NOT NULL,
  "candidate_status" "wassce_candidate_status" DEFAULT 'REGISTERED' NOT NULL,
  "reg_flag" "wassce_reg_flag",
  "accommodations_json" jsonb,
  "note" text,
  "mock_2_aggregate" smallint,
  "projected_aggregate" smallint,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_wassce_index_number" UNIQUE("school_id","index_number"),
  CONSTRAINT "uniq_wassce_candidate_student_cohort" UNIQUE("school_id","cohort_id","student_id"),
  CONSTRAINT "wassce_candidates_tenant_uk" UNIQUE("school_id","id")
);

-- ---- table 5: wassce_candidate_subject (LEAF join — Ruling 2, replaces subjects_sitting_json) ----
-- One row per (candidate × subject). Composite FKs to candidates + subjects; UNIQUE guards double
-- registration and backs the INCR-18 subject heatmap GROUP BY. LEAF → NO tenant UK.
CREATE TABLE IF NOT EXISTS "wassce_candidate_subject" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "candidate_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_wassce_candidate_subject" UNIQUE("school_id","candidate_id","subject_id")
);

-- ---- table 6: wassce_papers (cohort-scoped WAEC timetable — inline tenant UK, K2) ----
-- Composite FKs to cohort + subject. paper_type = WAEC structure; scheduled_time is a text clock
-- (boarding-config idiom), end derives from duration_minutes. Referenced by wassce_paper_sittings.
CREATE TABLE IF NOT EXISTS "wassce_papers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "cohort_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "name" text NOT NULL,
  "paper_number" smallint,
  "paper_type" "wassce_paper_type" NOT NULL,
  "waec_paper_code" text,
  "scheduled_date" date,
  "scheduled_time" text,
  "duration_minutes" smallint,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_wassce_paper" UNIQUE("school_id","cohort_id","subject_id","name"),
  CONSTRAINT "wassce_papers_tenant_uk" UNIQUE("school_id","id")
);

-- ---- table 7: wassce_paper_sittings (LEAF, one per candidate×paper — K2/D) ----
-- Composite FKs to candidates + papers. Exemption/make-up fields carry the medical-exemption case.
-- LEAF → NO tenant UK.
CREATE TABLE IF NOT EXISTS "wassce_paper_sittings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "candidate_id" uuid NOT NULL,
  "paper_id" uuid NOT NULL,
  "sat_at" timestamptz,
  "exempted_at" timestamptz,
  "exemption_reason_text" text,
  "make_up_at" timestamptz,
  "make_up_centre" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_wassce_paper_sitting" UNIQUE("school_id","candidate_id","paper_id")
);

-- ---- foreign keys (all CREATE TABLEs above are done, so every inline UK/PK target exists) ----
-- wassce_cohort: single-col school_id → ref_school CASCADE; two single-col SET NULL co-sign → ref_user.
DO $$ BEGIN
  ALTER TABLE "wassce_cohort" ADD CONSTRAINT "wassce_cohort_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "wassce_cohort" ADD CONSTRAINT "wassce_cohort_headmaster_cosign_user_id_ref_user_id_fk"
    FOREIGN KEY ("headmaster_cosign_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "wassce_cohort" ADD CONSTRAINT "wassce_cohort_academic_cosign_user_id_ref_user_id_fk"
    FOREIGN KEY ("academic_cosign_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- wassce_programmes: single-col school_id → ref_school CASCADE.
DO $$ BEGIN
  ALTER TABLE "wassce_programmes" ADD CONSTRAINT "wassce_programmes_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- wassce_subjects: single-col school_id → ref_school CASCADE; composite (school_id, programme_id) →
-- wassce_programmes tenant UK CASCADE (Ruling 4).
DO $$ BEGIN
  ALTER TABLE "wassce_subjects" ADD CONSTRAINT "wassce_subjects_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "wassce_subjects" ADD CONSTRAINT "wassce_subjects_school_id_programme_id_wassce_programmes_school_id_id_fk"
    FOREIGN KEY ("school_id","programme_id") REFERENCES "public"."wassce_programmes"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- wassce_candidates: single-col school_id → ref_school CASCADE; composite (school_id, cohort_id) →
-- wassce_cohort; (school_id, student_id) → students; (school_id, programme_id) → wassce_programmes. All CASCADE.
DO $$ BEGIN
  ALTER TABLE "wassce_candidates" ADD CONSTRAINT "wassce_candidates_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "wassce_candidates" ADD CONSTRAINT "wassce_candidates_school_id_cohort_id_wassce_cohort_school_id_id_fk"
    FOREIGN KEY ("school_id","cohort_id") REFERENCES "public"."wassce_cohort"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "wassce_candidates" ADD CONSTRAINT "wassce_candidates_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "wassce_candidates" ADD CONSTRAINT "wassce_candidates_school_id_programme_id_wassce_programmes_school_id_id_fk"
    FOREIGN KEY ("school_id","programme_id") REFERENCES "public"."wassce_programmes"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- wassce_candidate_subject: single-col school_id → ref_school CASCADE; composite (school_id,
-- candidate_id) → wassce_candidates; (school_id, subject_id) → wassce_subjects. Both CASCADE.
DO $$ BEGIN
  ALTER TABLE "wassce_candidate_subject" ADD CONSTRAINT "wassce_candidate_subject_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "wassce_candidate_subject" ADD CONSTRAINT "wassce_candidate_subject_school_id_candidate_id_wassce_candidates_school_id_id_fk"
    FOREIGN KEY ("school_id","candidate_id") REFERENCES "public"."wassce_candidates"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "wassce_candidate_subject" ADD CONSTRAINT "wassce_candidate_subject_school_id_subject_id_wassce_subjects_school_id_id_fk"
    FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."wassce_subjects"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- wassce_papers: single-col school_id → ref_school CASCADE; composite (school_id, cohort_id) →
-- wassce_cohort; (school_id, subject_id) → wassce_subjects. Both CASCADE.
DO $$ BEGIN
  ALTER TABLE "wassce_papers" ADD CONSTRAINT "wassce_papers_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "wassce_papers" ADD CONSTRAINT "wassce_papers_school_id_cohort_id_wassce_cohort_school_id_id_fk"
    FOREIGN KEY ("school_id","cohort_id") REFERENCES "public"."wassce_cohort"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "wassce_papers" ADD CONSTRAINT "wassce_papers_school_id_subject_id_wassce_subjects_school_id_id_fk"
    FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."wassce_subjects"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- wassce_paper_sittings: single-col school_id → ref_school CASCADE; composite (school_id, candidate_id)
-- → wassce_candidates; (school_id, paper_id) → wassce_papers. Both CASCADE.
DO $$ BEGIN
  ALTER TABLE "wassce_paper_sittings" ADD CONSTRAINT "wassce_paper_sittings_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "wassce_paper_sittings" ADD CONSTRAINT "wassce_paper_sittings_school_id_candidate_id_wassce_candidates_school_id_id_fk"
    FOREIGN KEY ("school_id","candidate_id") REFERENCES "public"."wassce_candidates"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "wassce_paper_sittings" ADD CONSTRAINT "wassce_paper_sittings_school_id_paper_id_wassce_papers_school_id_id_fk"
    FOREIGN KEY ("school_id","paper_id") REFERENCES "public"."wassce_papers"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
CREATE INDEX IF NOT EXISTS "wassce_subjects_programme_idx"
  ON "wassce_subjects" USING btree ("school_id","programme_id");
CREATE INDEX IF NOT EXISTS "wassce_candidates_cohort_idx"
  ON "wassce_candidates" USING btree ("school_id","cohort_id");
CREATE INDEX IF NOT EXISTS "wassce_candidates_programme_idx"
  ON "wassce_candidates" USING btree ("school_id","programme_id");
CREATE INDEX IF NOT EXISTS "wassce_candidate_subject_subject_idx"
  ON "wassce_candidate_subject" USING btree ("school_id","subject_id");
CREATE INDEX IF NOT EXISTS "wassce_papers_cohort_subject_idx"
  ON "wassce_papers" USING btree ("school_id","cohort_id","subject_id");
CREATE INDEX IF NOT EXISTS "wassce_paper_sittings_paper_idx"
  ON "wassce_paper_sittings" USING btree ("school_id","paper_id");

-- ---- RLS — the same tenant_isolation policy every other tenant table uses (all 7 FORCE) ----
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'wassce_cohort',
    'wassce_programmes',
    'wassce_subjects',
    'wassce_candidates',
    'wassce_candidate_subject',
    'wassce_papers',
    'wassce_paper_sittings'
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
