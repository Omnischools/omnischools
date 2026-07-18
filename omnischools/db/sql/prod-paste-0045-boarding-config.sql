-- Omnischools — migration 0045: Boarding programme config (SHS module 4.2 / INCR-8).
-- The three NEW tenant config tables (daily_schedule_template, boarding_settings,
-- boarding_calendar_event) plus the two enums they need + their RLS. Idempotent — safe to run
-- more than once. Paste into the Supabase SQL editor on PROD after merging. (db:policies only
-- configures local dev; a new tenant table needs its RLS pasted on prod by hand, or it leaks
-- across schools.)
--
-- SCOPE: this file covers only the three NEW tenant tables + the two enums (boarding_day_type,
-- boarding_event_type) + their RLS. Migration 0045 is the source of truth for the rest of the
-- increment — the houses columns (founded_year / named_after). Those are ALTERs to an
-- already-RLS'd table (house), so they ride the migration (no new RLS to paste). Run migration
-- 0045 on prod too.
--
-- All three tables are LEAF tables: a single-column school_id FK to ref_school, and nothing
-- references them. So — like attendance_settings — they get FORCE RLS but NO composite tenant
-- UK ("school_id","id"). Their business keys (the schedule UNIQUE, the one-row settings UNIQUE,
-- the calendar UNIQUE) are created INLINE in CREATE TABLE, before the single-column FKs are
-- added by ALTER TABLE (no FK-before-UNIQUE ordering hazard — recall the 0033 bug).

-- ---- enums needed by the config tables ----
DO $$ BEGIN
  CREATE TYPE "public"."boarding_day_type" AS ENUM('WEEKDAY', 'SATURDAY', 'SUNDAY', 'VISITING_SUNDAY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."boarding_event_type" AS ENUM('VISITING', 'EXEAT_WINDOW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- tables (business-key UK inline; single-column school_id FK added after) ----
CREATE TABLE IF NOT EXISTS "daily_schedule_template" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "day_type" "boarding_day_type" NOT NULL,
  "form_scope" text DEFAULT 'ALL' NOT NULL,
  "activities_json" jsonb NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_schedule_template" UNIQUE("school_id","day_type","form_scope")
);

-- boarding_settings — one row per school (mirrors attendance_settings). Every scalar carries its
-- GES default (verbatim from surface 01 policy cards) so a bare INSERT(school_id) seeds a correct
-- GES-default row. school_id UNIQUE is the settings-editor upsert conflict target.
CREATE TABLE IF NOT EXISTS "boarding_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "exeat_scheduled_per_term" smallint DEFAULT 3 NOT NULL,
  "exeat_return_by" text DEFAULT '16:00' NOT NULL,
  "exeat_fee_owing_must_collect" boolean DEFAULT true NOT NULL,
  "exeat_special_approver" text DEFAULT 'Senior HM only' NOT NULL,
  "exeat_parent_initiated" boolean DEFAULT true NOT NULL,
  "exeat_dress_code" text DEFAULT 'Uniform or outing dress' NOT NULL,
  "exeat_card_signer" text DEFAULT 'Signed by Housemaster' NOT NULL,
  "visiting_cadence" text DEFAULT '2nd Sun · monthly' NOT NULL,
  "visiting_hours_start" text DEFAULT '12:00' NOT NULL,
  "visiting_hours_end" text DEFAULT '16:00' NOT NULL,
  "visiting_lunch_time" text DEFAULT '11:30' NOT NULL,
  "visiting_dormitories_rule" text DEFAULT 'Out of bounds' NOT NULL,
  "visiting_approved_visitors" text DEFAULT 'Parent · guardian · sibling' NOT NULL,
  "visiting_book_owner" text DEFAULT 'Digital · SoD owns' NOT NULL,
  "inspection_daily_start" text DEFAULT '06:10' NOT NULL,
  "inspection_daily_end" text DEFAULT '06:20' NOT NULL,
  "inspection_daily_scope" text DEFAULT 'Bunks · lockers · attire' NOT NULL,
  "inspection_weekly" text DEFAULT 'Saturday 08:00' NOT NULL,
  "inspection_weekly_scope" text DEFAULT 'Whole House · top to bottom' NOT NULL,
  "inspection_scrubbing" text DEFAULT 'Wed 16:00 — 17:00' NOT NULL,
  "inspection_washing_days" text DEFAULT 'Wed & Fri afternoons' NOT NULL,
  "inspection_inspector" text DEFAULT 'HM & House Prefects' NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "boarding_settings_school_id_unique" UNIQUE("school_id")
);

CREATE TABLE IF NOT EXISTS "boarding_calendar_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "academic_year" text NOT NULL,
  "event_type" "boarding_event_type" NOT NULL,
  "event_date" date NOT NULL,
  "label" text NOT NULL,
  "form_scope" text,
  "sequence" smallint,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_boarding_calendar_event" UNIQUE("school_id","academic_year","event_type","event_date")
);

-- ---- foreign keys (single-column school_id -> ref_school; leaf tables, no composite FK) ----
DO $$ BEGIN
  ALTER TABLE "daily_schedule_template" ADD CONSTRAINT "daily_schedule_template_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_settings" ADD CONSTRAINT "boarding_settings_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_calendar_event" ADD CONSTRAINT "boarding_calendar_event_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- index (per-year calendar read) ----
CREATE INDEX IF NOT EXISTS "boarding_calendar_event_year_idx"
  ON "boarding_calendar_event" USING btree ("school_id","academic_year");

-- ---- RLS — the same tenant_isolation policy every other tenant table uses ----
ALTER TABLE "daily_schedule_template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_schedule_template" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "daily_schedule_template";
CREATE POLICY tenant_isolation ON "daily_schedule_template" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

ALTER TABLE "boarding_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boarding_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "boarding_settings";
CREATE POLICY tenant_isolation ON "boarding_settings" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

ALTER TABLE "boarding_calendar_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boarding_calendar_event" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "boarding_calendar_event";
CREATE POLICY tenant_isolation ON "boarding_calendar_event" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );
