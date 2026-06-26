-- Omnischools — migration 0030: staff_compensation (current pay record per staff
-- member: status, monthly amount, method, SSNIT/PAYE deductions, tenure) + RLS.
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD
-- after merging. (db:policies only configures local dev; new tenant tables need their
-- RLS pasted on prod by hand.)

CREATE TABLE IF NOT EXISTS "staff_compensation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "salary_status" text DEFAULT 'SCHOOL_PAID' NOT NULL,
  "monthly_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "pay_method" text DEFAULT 'BANK' NOT NULL,
  "pay_cadence" text DEFAULT 'MONTHLY' NOT NULL,
  "ssnit_deduction" numeric(12, 2) DEFAULT '0' NOT NULL,
  "paye_deduction" numeric(12, 2) DEFAULT '0' NOT NULL,
  "effective_from" date,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_staff_compensation_per_school" UNIQUE ("school_id", "user_id")
);

DO $$ BEGIN
  ALTER TABLE "staff_compensation" ADD CONSTRAINT "staff_compensation_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school" ("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "staff_compensation" ADD CONSTRAINT "staff_compensation_user_id_ref_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."ref_user" ("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "staff_compensation_school_idx" ON "staff_compensation" USING btree ("school_id");

-- RLS — the same tenant_isolation policy every other tenant table uses.
ALTER TABLE "staff_compensation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_compensation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "staff_compensation";
CREATE POLICY tenant_isolation ON "staff_compensation" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );
