-- Omnischools — migration 0039: Senior score-ledger capture path (Item 2, Path C).
-- Adds the `capture_path` enum and the `senior_ledger_path` table (which path a
-- class·subject·period uses: AUTO_COMPILE / SCAN_EXTRACT / DIRECT_ENTRY) + its RLS.
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD
-- after merging. (db:policies only configures local dev; a new tenant table needs its
-- RLS pasted on prod by hand, or it leaks across schools.)

-- ---- enum ----
DO $$ BEGIN
  CREATE TYPE "capture_path" AS ENUM('AUTO_COMPILE','SCAN_EXTRACT','DIRECT_ENTRY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- table ----
CREATE TABLE IF NOT EXISTS "senior_ledger_path" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "period_id" uuid NOT NULL,
  "path" "capture_path" DEFAULT 'AUTO_COMPILE' NOT NULL,
  "updated_by_user_id" uuid,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_ledger_path_context" UNIQUE("school_id","class_id","subject_id","period_id")
);

-- ---- foreign keys (composite (school_id, id) for intra-tenant refs) ----
DO $$ BEGIN
  ALTER TABLE "senior_ledger_path" ADD CONSTRAINT "senior_ledger_path_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "senior_ledger_path" ADD CONSTRAINT "senior_ledger_path_updated_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."ref_user"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "senior_ledger_path" ADD CONSTRAINT "senior_ledger_path_school_id_class_id_class_school_id_id_fk"
    FOREIGN KEY ("school_id","class_id") REFERENCES "public"."class"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "senior_ledger_path" ADD CONSTRAINT "senior_ledger_path_school_id_subject_id_subject_school_id_id_fk"
    FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."subject"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "senior_ledger_path" ADD CONSTRAINT "senior_ledger_path_school_id_period_id_academic_period_school_id_period_id_fk"
    FOREIGN KEY ("school_id","period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- RLS — the same tenant_isolation policy every other tenant table uses ----
ALTER TABLE "senior_ledger_path" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "senior_ledger_path" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "senior_ledger_path";
CREATE POLICY tenant_isolation ON "senior_ledger_path" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );
