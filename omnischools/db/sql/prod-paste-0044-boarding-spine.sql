-- Omnischools — migration 0044: Boarding F0 spine (SHS module 4.2 / INCR-7).
-- The three NEW tenant tables of the House -> Dormitory -> Bunk hierarchy plus their RLS.
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD after
-- merging. (db:policies only configures local dev; a new tenant table needs its RLS pasted on
-- prod by hand, or it leaks across schools.)
--
-- SCOPE: this file covers only the three NEW tenant tables (boarding_dormitory, boarding_bunk,
-- bunk_allocation) + the prefect_role enum they need + their RLS. Migration 0044 is the source
-- of truth for the rest of the increment — the house_gender enum, the houses columns
-- (gender/capacity/hm_user_id), and the students.current_bunk_id column + its composite FK to
-- boarding_bunk + the partial unique index. Those are ALTERs to already-RLS'd tables (no new
-- RLS to paste), so they ride the migration, not this file. Run migration 0044 on prod too.
--
-- DDL ORDERING (recall the 0033 FK-before-UNIQUE bug): each composite tenant UK ("school_id","id")
-- is created INLINE in CREATE TABLE, BEFORE any composite FK targeting it is added by a later
-- ALTER TABLE. boarding_dormitory is created before boarding_bunk's FK to it; boarding_bunk before
-- bunk_allocation's FK to it. Do not reorder.

-- ---- enum needed by boarding_bunk.prefect_role ----
DO $$ BEGIN
  CREATE TYPE "public"."prefect_role" AS ENUM('HEAD', 'DINING', 'SANITATION', 'PREP', 'SICKBAY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- tables (composite tenant UK ("school_id","id") inline; the FK targets exist first) ----
CREATE TABLE IF NOT EXISTS "boarding_dormitory" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "house_id" uuid NOT NULL,
  "name" text NOT NULL,
  "section_label" text,
  "bunk_count" integer DEFAULT 15 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_dormitory_per_house" UNIQUE("school_id","house_id","name"),
  CONSTRAINT "boarding_dormitory_tenant_uk" UNIQUE("school_id","id")
);

CREATE TABLE IF NOT EXISTS "boarding_bunk" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "dormitory_id" uuid NOT NULL,
  "position_number" integer NOT NULL,
  "prefect_role" "prefect_role",
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_bunk_per_dormitory" UNIQUE("school_id","dormitory_id","position_number"),
  CONSTRAINT "boarding_bunk_tenant_uk" UNIQUE("school_id","id")
);

CREATE TABLE IF NOT EXISTS "bunk_allocation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "bunk_id" uuid NOT NULL,
  "from_at" timestamptz DEFAULT now() NOT NULL,
  "to_at" timestamptz,
  "reason" text NOT NULL,
  "allocated_by_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

-- ---- foreign keys (composite (school_id, X) for intra-tenant refs; single-column to globals) ----
DO $$ BEGIN
  ALTER TABLE "boarding_dormitory" ADD CONSTRAINT "boarding_dormitory_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_dormitory" ADD CONSTRAINT "boarding_dormitory_school_id_house_id_house_school_id_id_fk"
    FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "boarding_bunk" ADD CONSTRAINT "boarding_bunk_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_bunk" ADD CONSTRAINT "boarding_bunk_school_id_dormitory_id_boarding_dormitory_school_id_id_fk"
    FOREIGN KEY ("school_id","dormitory_id") REFERENCES "public"."boarding_dormitory"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "bunk_allocation" ADD CONSTRAINT "bunk_allocation_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- allocated_by_user_id -> global ref_user, SET NULL: single-column (composite-FK rule exemption).
DO $$ BEGIN
  ALTER TABLE "bunk_allocation" ADD CONSTRAINT "bunk_allocation_allocated_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("allocated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "bunk_allocation" ADD CONSTRAINT "bunk_allocation_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "bunk_allocation" ADD CONSTRAINT "bunk_allocation_school_id_bunk_id_boarding_bunk_school_id_id_fk"
    FOREIGN KEY ("school_id","bunk_id") REFERENCES "public"."boarding_bunk"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- index (per-student swap-log read + open-row lookup) ----
CREATE INDEX IF NOT EXISTS "bunk_allocation_student_idx"
  ON "bunk_allocation" USING btree ("school_id","student_id");

-- ---- RLS — the same tenant_isolation policy every other tenant table uses ----
ALTER TABLE "boarding_dormitory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boarding_dormitory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "boarding_dormitory";
CREATE POLICY tenant_isolation ON "boarding_dormitory" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

ALTER TABLE "boarding_bunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boarding_bunk" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "boarding_bunk";
CREATE POLICY tenant_isolation ON "boarding_bunk" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

ALTER TABLE "bunk_allocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bunk_allocation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "bunk_allocation";
CREATE POLICY tenant_isolation ON "bunk_allocation" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );
