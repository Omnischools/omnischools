-- Omnischools — migration 0029: staff_profile (optional staff Personal & contact +
-- Qualifications & licensure fields) + RLS. Idempotent — safe to run more than once.
-- Paste into the Supabase SQL editor on PROD after merging. (db:policies only configures
-- local dev; new tenant tables need their RLS pasted on prod by hand.)

CREATE TABLE IF NOT EXISTS "staff_profile" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "date_of_birth" date,
  "gender" text,
  "address" text,
  "emergency_contact" text,
  "qualification_level" text,
  "highest_qualification" text,
  "undergraduate" text,
  "ntc_licence_number" text,
  "ntc_licence_expiry" date,
  "specialisations" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_staff_profile_per_school" UNIQUE ("school_id", "user_id")
);

DO $$ BEGIN
  ALTER TABLE "staff_profile" ADD CONSTRAINT "staff_profile_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school" ("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "staff_profile" ADD CONSTRAINT "staff_profile_user_id_ref_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."ref_user" ("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "staff_profile_school_idx" ON "staff_profile" USING btree ("school_id");

-- RLS — the same tenant_isolation policy every other tenant table uses.
ALTER TABLE "staff_profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_profile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "staff_profile";
CREATE POLICY tenant_isolation ON "staff_profile" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );
