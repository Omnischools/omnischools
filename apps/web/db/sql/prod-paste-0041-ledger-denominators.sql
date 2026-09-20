-- Omnischools — migration 0041: Score Ledger Item 4 · Path B (INCR-2) denominators.
-- Adds the five per-category scan denominators to ref_assessment_weights and the
-- ledger_correction_reason enum (Path B score-down / Case-D reason codes).
-- Idempotent — safe to run more than once.
--
-- *** RLS: NOTHING TO DO. ***
-- This migration adds NO new table. ref_assessment_weights already carries
-- ENABLE + FORCE ROW LEVEL SECURITY + the tenant_isolation policy (pasted at 0038 —
-- see prod-paste-0038-senior-ledger.sql). Adding columns does not change RLS, so there
-- is NO policy delta and NO cross-tenant leak risk here. The reason enum is a Postgres
-- type, not a table, so it has no RLS at all.
--
-- 0041 is plain, portable DDL (a type + five columns + one CHECK). It is applied to prod
-- by the normal drizzle migrate flow at deploy; these idempotent statements are provided
-- only so the change can be hand-verified/hand-applied in the Supabase SQL editor if needed.
-- Prod needs the column ALTER + the enum — NOT new RLS.

-- ---- enum: allowed score-down / Case-D reason codes (persist in audit_log.reason) ----
DO $$ BEGIN
  CREATE TYPE "ledger_correction_reason" AS ENUM('RE_GRADED','TRANSCRIPTION_ERROR','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- new columns on the existing tenant table ref_assessment_weights ----
-- smallint NOT NULL DEFAULT 100 (system-default denominator = identity; never inflates).
ALTER TABLE "ref_assessment_weights" ADD COLUMN IF NOT EXISTS "asgn_denominator" smallint DEFAULT 100 NOT NULL;
ALTER TABLE "ref_assessment_weights" ADD COLUMN IF NOT EXISTS "mid_sem_denominator" smallint DEFAULT 100 NOT NULL;
ALTER TABLE "ref_assessment_weights" ADD COLUMN IF NOT EXISTS "end_sem_denominator" smallint DEFAULT 100 NOT NULL;
ALTER TABLE "ref_assessment_weights" ADD COLUMN IF NOT EXISTS "project_denominator" smallint DEFAULT 100 NOT NULL;
ALTER TABLE "ref_assessment_weights" ADD COLUMN IF NOT EXISTS "portfolio_denominator" smallint DEFAULT 100 NOT NULL;

-- ---- CHECK: every denominator strictly positive (guards the scan-scale divide-by-zero) ----
DO $$ BEGIN
  ALTER TABLE "ref_assessment_weights" ADD CONSTRAINT "assessment_denominators_positive"
    CHECK ("asgn_denominator" > 0 AND "mid_sem_denominator" > 0 AND "end_sem_denominator" > 0
       AND "project_denominator" > 0 AND "portfolio_denominator" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
