-- Omnischools — migration 0040: senior_subject_teacher (Item 3, VHM progress view).
-- The authoritative "teacher teaches subject to class" assignment — the enumeration source
-- for the Vice Headmaster progress view (so a never-started teacher still appears) + its RLS.
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD after
-- merging. (db:policies only configures local dev; a new tenant table needs its RLS pasted
-- on prod by hand, or it leaks across schools.)

CREATE TABLE IF NOT EXISTS "senior_subject_teacher" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "teacher_user_id" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_subject_teacher_context" UNIQUE("school_id","class_id","subject_id")
);

DO $$ BEGIN
  ALTER TABLE "senior_subject_teacher" ADD CONSTRAINT "senior_subject_teacher_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "senior_subject_teacher" ADD CONSTRAINT "senior_subject_teacher_teacher_user_id_ref_user_id_fk"
    FOREIGN KEY ("teacher_user_id") REFERENCES "public"."ref_user"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "senior_subject_teacher" ADD CONSTRAINT "senior_subject_teacher_school_id_class_id_class_school_id_id_fk"
    FOREIGN KEY ("school_id","class_id") REFERENCES "public"."class"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "senior_subject_teacher" ADD CONSTRAINT "senior_subject_teacher_school_id_subject_id_subject_school_id_id_fk"
    FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."subject"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- RLS — the same tenant_isolation policy every other tenant table uses ----
ALTER TABLE "senior_subject_teacher" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "senior_subject_teacher" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "senior_subject_teacher";
CREATE POLICY tenant_isolation ON "senior_subject_teacher" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );
