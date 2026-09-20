-- Omnischools — migration 0035: term lifecycle. Adds academic_period.closed_at +
-- closed_by_user_id so a term can be CLOSED (finalised): its scores and attendance become
-- read-only and the next term is the school's active working term. Idempotent — safe to run
-- more than once. Paste into the Supabase SQL editor on PROD after merging.
--
-- No RLS changes: this only adds columns to the existing "academic_period" table, which is
-- already tenant-scoped. New columns are covered by the table's existing policies.

ALTER TABLE "academic_period" ADD COLUMN IF NOT EXISTS "closed_at" timestamptz;
ALTER TABLE "academic_period" ADD COLUMN IF NOT EXISTS "closed_by_user_id" uuid;

DO $$ BEGIN
  ALTER TABLE "academic_period" ADD CONSTRAINT "academic_period_closed_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."ref_user" ("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
