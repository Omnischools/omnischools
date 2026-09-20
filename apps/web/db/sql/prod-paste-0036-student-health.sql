-- Omnischools — migration 0036: student_health_record (1:1 health & emergency record per
-- student). Idempotent — safe to run more than once. Paste into the Supabase SQL editor on
-- PROD after merging. NEW TENANT TABLE → it MUST get the tenant_isolation RLS below, or a
-- student's health data would be visible across schools.

CREATE TABLE IF NOT EXISTS "student_health_record" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "blood_group" text,
  "allergies" text,
  "conditions" text,
  "medications" text,
  "emergency_contact_name" text,
  "emergency_contact_phone" text,
  "emergency_contact_relation" text,
  "notes" text,
  "updated_by_user_id" uuid,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "student_health_record_student_id_unique" UNIQUE ("student_id")
);

DO $$ BEGIN
  ALTER TABLE "student_health_record" ADD CONSTRAINT "student_health_record_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school" ("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "student_health_record" ADD CONSTRAINT "student_health_record_updated_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."ref_user" ("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "student_health_record" ADD CONSTRAINT "student_health_record_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students" ("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "health_student_idx"
  ON "student_health_record" USING btree ("student_id");

-- RLS — the same tenant_isolation policy every other tenant table uses.
ALTER TABLE "student_health_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_health_record" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "student_health_record";
CREATE POLICY tenant_isolation ON "student_health_record" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );
