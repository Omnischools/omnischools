-- Omnischools — migration 0047: Boarding daily life (SHS module 4.2 / INCR-10).
-- The two NEW tenant tables (inspections, prep_attendance) plus the two enums they need + their
-- RLS. Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD after
-- merging. (db:policies only configures local dev; a new tenant table needs its RLS pasted on prod
-- by hand, or it leaks across schools.)
--
-- SCOPE: this file is the whole increment — inspections + prep_attendance + the two enums
-- (inspection_type, inspection_result) + FORCE RLS on both. The prep status column REUSES the
-- shipped attendance_status enum (no new enum). No changes to any already-RLS'd table. Run
-- migration 0047 on prod too (this file is the RLS companion, not a replacement).
--
-- DDL ORDER (recall the 0033 FK-before-UNIQUE bug): enums → tables → FKs → indexes → RLS. Both are
-- LEAF tables (nothing references them) so NEITHER carries a composite (school_id, id) tenant UK.
-- Every composite FK target is an already-SHIPPED UK/PK (boarding_dormitory_tenant_uk,
-- students_tenant_uk, house_tenant_uk, ref_school PK, ref_user PK) — so no FK-before-UNIQUE hazard
-- here. prep_attendance's uniq_prep_attendance UNIQUE is a business key (the upsert conflict
-- target), carried INLINE in CREATE TABLE, not a tenant-FK target.

-- ---- enums needed by the inspection table ----
DO $$ BEGIN
  CREATE TYPE "public"."inspection_type" AS ENUM('DAILY', 'WEEKLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."inspection_result" AS ENUM('PASS', 'PARTIAL', 'FAIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- tables (LEAF: no tenant UK; prep business-key UK inline; FKs added after) ----
-- inspections — append-only, latest-wins per (dormitory × type × UTC-date). NO unique-per-day,
-- NO tenant UK (mirrors bunk_allocation). result is 3-state (supersedes BUILD_STACK pass_fail bool);
-- bunks_clean/bunks_total populated DAILY, NULL WEEKLY (bunks_total a snapshot); findings_json shape
-- is discriminated by `type` and validated in lib/ (NO DB CHECK/trigger — portability).
CREATE TABLE IF NOT EXISTS "inspections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "dormitory_id" uuid NOT NULL,
  "type" "inspection_type" NOT NULL,
  "result" "inspection_result" NOT NULL,
  "bunks_clean" smallint,
  "bunks_total" smallint,
  "findings_json" jsonb NOT NULL,
  "anomalies_count" smallint DEFAULT 0 NOT NULL,
  "inspected_at" timestamptz DEFAULT now() NOT NULL,
  "inspected_by_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

-- prep_attendance — per-boarder EXCEPTION log, one upserted row per (boarder × night). status reuses
-- the canonical 5-status attendance_status enum (writer uses only LATE/ABSENT/EXCUSED/MEDICAL —
-- PRESENT is never a row). uniq_prep_attendance is the upsert conflict target. session_date is a
-- stored date (not derived — avoids the tz-boundary trap); house_id is a snapshot. NO tenant UK.
CREATE TABLE IF NOT EXISTS "prep_attendance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "house_id" uuid NOT NULL,
  "session_date" date NOT NULL,
  "status" "attendance_status" NOT NULL,
  "minutes_late" smallint,
  "note" text,
  "logged_at" timestamptz DEFAULT now() NOT NULL,
  "logged_by_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_prep_attendance" UNIQUE("school_id","student_id","session_date")
);

-- ---- foreign keys ----
-- inspections: single-column school_id -> ref_school; single-column SET NULL actor -> ref_user;
-- composite (school_id, dormitory_id) intra-tenant FK -> boarding_dormitory (its shipped tenant UK).
DO $$ BEGIN
  ALTER TABLE "inspections" ADD CONSTRAINT "inspections_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspected_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("inspected_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "inspections" ADD CONSTRAINT "inspections_school_id_dormitory_id_boarding_dormitory_school_id_id_fk"
    FOREIGN KEY ("school_id","dormitory_id") REFERENCES "public"."boarding_dormitory"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- prep_attendance: single-column school_id -> ref_school; single-column SET NULL actor -> ref_user;
-- composite (school_id, student_id) -> students and (school_id, house_id) -> house (shipped tenant UKs).
DO $$ BEGIN
  ALTER TABLE "prep_attendance" ADD CONSTRAINT "prep_attendance_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "prep_attendance" ADD CONSTRAINT "prep_attendance_logged_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("logged_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "prep_attendance" ADD CONSTRAINT "prep_attendance_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "prep_attendance" ADD CONSTRAINT "prep_attendance_school_id_house_id_house_school_id_id_fk"
    FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
CREATE INDEX IF NOT EXISTS "inspections_dorm_time_idx"
  ON "inspections" USING btree ("school_id","dormitory_id","inspected_at");
CREATE INDEX IF NOT EXISTS "prep_attendance_house_date_idx"
  ON "prep_attendance" USING btree ("school_id","house_id","session_date");

-- ---- RLS — the same tenant_isolation policy every other tenant table uses ----
ALTER TABLE "inspections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inspections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "inspections";
CREATE POLICY tenant_isolation ON "inspections" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

ALTER TABLE "prep_attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prep_attendance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "prep_attendance";
CREATE POLICY tenant_isolation ON "prep_attendance" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );
