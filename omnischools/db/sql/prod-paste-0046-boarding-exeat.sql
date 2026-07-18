-- Omnischools — migration 0046: Boarding exeat management (SHS module 4.2 / INCR-9).
-- The two NEW tenant tables (boarding_exeat, exeat_notification) plus the three enums they need
-- + their RLS. Idempotent — safe to run more than once. Paste into the Supabase SQL editor on
-- PROD after merging. (db:policies only configures local dev; a new tenant table needs its RLS
-- pasted on prod by hand, or it leaks across schools.)
--
-- SCOPE: this file is the whole increment — boarding_exeat + exeat_notification + the three enums
-- (exeat_type, exeat_status, exeat_notification_kind) + FORCE RLS on both. No changes to any
-- already-RLS'd table (calendar_event_id is a single-column SET NULL FK to the shipped
-- boarding_calendar_event — NO tenant UK added there, so that table is untouched). Run migration
-- 0046 on prod too (this file is the RLS companion, not a replacement).
--
-- DDL ORDER (recall the 0033 FK-before-UNIQUE bug): enums → tables → FKs → indexes → RLS. Both
-- tables carry their UNIQUE constraints INLINE in CREATE TABLE — so boarding_exeat's tenant UK
-- ("school_id","id") exists before the exeat_notification -> boarding_exeat composite FK is added
-- by ALTER. No FK-before-UNIQUE ordering hazard.

-- ---- enums needed by the exeat tables ----
DO $$ BEGIN
  CREATE TYPE "public"."exeat_type" AS ENUM('SCHEDULED', 'SPECIAL', 'FEE_COLLECTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."exeat_status" AS ENUM('REQUESTED', 'HM_APPROVED', 'SR_HM_SIGNED', 'DEPARTED', 'RETURNED', 'DECLINED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."exeat_notification_kind" AS ENUM('DEPARTURE', 'REMINDER', 'OVERDUE_STAGE_1', 'OVERDUE_STAGE_2', 'OVERDUE_STAGE_3');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- tables (tenant UK + business-key UK inline; FKs added after) ----
-- boarding_exeat — one exeat per boarder trip. tenant UK ("school_id","id") is the composite-FK
-- target for exeat_notification; uniq_exeat_ref_code guards the human-facing code per school.
CREATE TABLE IF NOT EXISTS "boarding_exeat" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "house_id" uuid NOT NULL,
  "academic_period_id" uuid NOT NULL,
  "calendar_event_id" uuid,
  "exeat_type" "exeat_type" NOT NULL,
  "status" "exeat_status" DEFAULT 'REQUESTED' NOT NULL,
  "ref_code" text NOT NULL,
  "reason" text,
  "parent_initiated" boolean DEFAULT true NOT NULL,
  "depart_at" timestamptz,
  "return_by" timestamptz,
  "requested_at" timestamptz DEFAULT now() NOT NULL,
  "requested_by_user_id" uuid,
  "hm_approved_at" timestamptz,
  "hm_approved_by_user_id" uuid,
  "sr_hm_signed_at" timestamptz,
  "sr_hm_signed_by_user_id" uuid,
  "departed_at" timestamptz,
  "departed_by_user_id" uuid,
  "returned_at" timestamptz,
  "returned_by_user_id" uuid,
  "declined_at" timestamptz,
  "declined_by_user_id" uuid,
  "decline_reason" text,
  "fee_owing_snapshot" numeric(12, 2),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "boarding_exeat_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "uniq_exeat_ref_code" UNIQUE("school_id","ref_code")
);

-- exeat_notification — append-only SMS log for the late-return chain (idempotency + delivery meta).
CREATE TABLE IF NOT EXISTS "exeat_notification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "exeat_id" uuid NOT NULL,
  "kind" "exeat_notification_kind" NOT NULL,
  "to_phone" text NOT NULL,
  "body" text NOT NULL,
  "provider" text NOT NULL,
  "provider_message_id" text,
  "error" text,
  "ok" boolean NOT NULL,
  "sent_at" timestamptz DEFAULT now() NOT NULL,
  "sent_by_user_id" uuid
);

-- ---- foreign keys ----
-- boarding_exeat: single-column school_id -> ref_school; single-column SET NULL calendar_event_id
-- -> boarding_calendar_event (the SET-NULL exemption, see the schema doc); single-column SET NULL
-- actor ids -> ref_user; composite (school_id,*) intra-tenant FKs to students / house /
-- academic_period (cross-tenant reference structurally impossible).
DO $$ BEGIN
  ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_calendar_event_id_boarding_calendar_event_id_fk"
    FOREIGN KEY ("calendar_event_id") REFERENCES "public"."boarding_calendar_event"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_requested_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_hm_approved_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("hm_approved_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_sr_hm_signed_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("sr_hm_signed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_departed_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("departed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_returned_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("returned_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_declined_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("declined_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_school_id_house_id_house_school_id_id_fk"
    FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_school_id_academic_period_id_academic_period_school_id_period_id_fk"
    FOREIGN KEY ("school_id","academic_period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- exeat_notification: single-column school_id -> ref_school; single-column SET NULL sender ->
-- ref_user; composite (school_id,exeat_id) intra-tenant FK -> boarding_exeat (needs the tenant UK
-- created inline above).
DO $$ BEGIN
  ALTER TABLE "exeat_notification" ADD CONSTRAINT "exeat_notification_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "exeat_notification" ADD CONSTRAINT "exeat_notification_sent_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "exeat_notification" ADD CONSTRAINT "exeat_notification_school_id_exeat_id_boarding_exeat_school_id_id_fk"
    FOREIGN KEY ("school_id","exeat_id") REFERENCES "public"."boarding_exeat"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
CREATE INDEX IF NOT EXISTS "boarding_exeat_student_period_idx"
  ON "boarding_exeat" USING btree ("school_id","student_id","academic_period_id");
CREATE INDEX IF NOT EXISTS "exeat_notification_exeat_idx"
  ON "exeat_notification" USING btree ("school_id","exeat_id");

-- ---- RLS — the same tenant_isolation policy every other tenant table uses ----
ALTER TABLE "boarding_exeat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boarding_exeat" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "boarding_exeat";
CREATE POLICY tenant_isolation ON "boarding_exeat" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

ALTER TABLE "exeat_notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exeat_notification" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exeat_notification";
CREATE POLICY tenant_isolation ON "exeat_notification" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );
