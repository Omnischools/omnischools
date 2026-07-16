-- Omnischools — migration 0043: senior_score_ledger_version (Score Ledger Item 7 / INCR-6).
-- The retained, immutable per-grain version snapshot of a senior_score_ledger row at commit
-- time + the composite supersedes self-FK forming the per-grain version chain, plus its RLS.
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD after
-- merging. (db:policies only configures local dev; a new tenant table needs its RLS pasted
-- on prod by hand, or it leaks across schools.)
--
-- DDL ORDERING (recall the 0033 FK-before-UNIQUE bug): the composite tenant UK
-- ("school_id","id") is created INLINE in CREATE TABLE, BEFORE the supersedes self-FK is added
-- by a later ALTER TABLE — the self-FK's referenced UNIQUE must already exist. Do not reorder.

CREATE TABLE IF NOT EXISTS "senior_score_ledger_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "period_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "batch_id" uuid NOT NULL,
  "asgn_score" numeric(5, 2),
  "mid_sem_score" numeric(5, 2),
  "end_sem_score" numeric(5, 2),
  "project_score" numeric(5, 2),
  "portfolio_score" numeric(5, 2),
  "weighted_total" numeric(5, 2),
  "status" "ledger_status" NOT NULL,
  "path_used" "capture_path" NOT NULL,
  "committed_by_user_id" uuid,
  "committed_at" timestamptz DEFAULT now() NOT NULL,
  "supersedes_id" uuid,
  -- Composite tenant UK: the target of the supersedes self-FK below (must exist first).
  CONSTRAINT "senior_score_ledger_version_tenant_uk" UNIQUE("school_id","id"),
  -- Concurrency + chain integrity: exactly one version_number per grain (AC I1). This is the
  -- conflict target the versioned-write path guards on; its btree also serves the
  -- latest-version-by-grain lookup.
  CONSTRAINT "uniq_ledger_version_grain_number" UNIQUE("school_id","student_id","subject_id","period_id","version_number")
);

-- ---- foreign keys (composite (school_id, X) for intra-tenant refs; single-column to globals) ----
DO $$ BEGIN
  ALTER TABLE "senior_score_ledger_version" ADD CONSTRAINT "senior_score_ledger_version_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "senior_score_ledger_version" ADD CONSTRAINT "senior_score_ledger_version_committed_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("committed_by_user_id") REFERENCES "public"."ref_user"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "senior_score_ledger_version" ADD CONSTRAINT "senior_score_ledger_version_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "senior_score_ledger_version" ADD CONSTRAINT "senior_score_ledger_version_school_id_subject_id_subject_school_id_id_fk"
    FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."subject"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "senior_score_ledger_version" ADD CONSTRAINT "senior_score_ledger_version_school_id_period_id_academic_period_school_id_period_id_fk"
    FOREIGN KEY ("school_id","period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Composite supersedes self-FK (school_id, supersedes_id) -> (school_id, id): intra-tenant, so
-- a cross-tenant supersedes is structurally impossible (J2). ON DELETE NO ACTION (NOT SET NULL:
-- supersedes_id is write-once immutable, and a composite SET NULL would also null school_id);
-- the whole-period prune deletes an entire co-periodic chain in one statement, satisfied at
-- statement end.
DO $$ BEGIN
  ALTER TABLE "senior_score_ledger_version" ADD CONSTRAINT "senior_score_ledger_version_school_id_supersedes_id_senior_score_ledger_version_school_id_id_fk"
    FOREIGN KEY ("school_id","supersedes_id") REFERENCES "public"."senior_score_ledger_version"("school_id","id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- index (tenant-scoped period prune — prunePriorPeriodVersions over closed periods) ----
CREATE INDEX IF NOT EXISTS "senior_ledger_version_prune_idx"
  ON "senior_score_ledger_version" USING btree ("school_id","period_id");

-- ---- RLS — the same tenant_isolation policy every other tenant table uses ----
ALTER TABLE "senior_score_ledger_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "senior_score_ledger_version" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "senior_score_ledger_version";
CREATE POLICY tenant_isolation ON "senior_score_ledger_version" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );
