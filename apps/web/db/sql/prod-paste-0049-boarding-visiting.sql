-- Omnischools — migration 0049: Boarding visiting day (SHS module 4.2 / INCR-12).
-- The THREE NEW tenant tables (boarding_approved_visitor, boarding_visit, boarding_visit_notification)
-- plus their 4 enums plus their RLS. Idempotent — safe to run more than once. Paste into the Supabase
-- SQL editor on PROD after merging. (db:policies only configures local dev; a new tenant table needs its
-- RLS pasted on prod by hand, or it leaks across schools.)
--
-- SCOPE: 0049 is a pure NEW-TABLE migration — NO column ALTERs, NO backfills, NO seed (unlike 0048).
-- So this file is the COMPLETE prod application of 0049: the 4 enums + 3 tables + FKs + indexes + FORCE
-- RLS on all three. Running it is equivalent to running migration 0049 followed by db:policies for these
-- three tables.
--
-- DDL ORDER (recall the 0033 FK-before-UNIQUE bug): enums → tables (each carrying its UNIQUE/PK INLINE) →
-- FKs → indexes → RLS. Every FK target is created before the FK that references it:
--   • boarding_visit.approved_visitor_id → boarding_approved_visitor(id): the PK, created INLINE.
--   • boarding_visit_notification (school_id, visit_id) → boarding_visit(school_id, id): the tenant UK
--     "boarding_visit_tenant_uk", created INLINE — the FK ALTER runs strictly after that CREATE TABLE.
--   • boarding_*.calendar_event_id → boarding_calendar_event(id): shipped in 0045.
--   • (school_id, student_id)/(school_id, house_id) → students_tenant_uk / house_tenant_uk: shipped.
-- All CREATE TABLE statements run before any ADD CONSTRAINT, so every inline UK/PK exists first.
--
-- TENANT-UK vs LEAF doctrine (per table):
--   • boarding_approved_visitor — DURABLE + REFERENCED by boarding_visit.approved_visitor_id → carries a
--     composite (school_id, id) tenant UK (the F0-spine / boarding_exeat pattern).
--   • boarding_visit — DURABLE + REFERENCED by boarding_visit_notification.visit_id → carries a composite
--     (school_id, id) tenant UK.
--   • boarding_visit_notification — LEAF (nothing references it) → FORCE RLS but NO tenant UK (mirror
--     exeat_notification).
--
-- FK-shape notes:
--   • calendar_event_id (visit + notification) and approved_visitor_id (visit) are the SINGLE-COLUMN
--     SET-NULL exemption (the exeat calendar_event_id doctrine): a composite SET NULL would try to null the
--     NOT-NULL school_id, and these are weak informational links to HARD-deletable targets, not auth
--     boundaries (RLS + tenant-scoped getters already prevent a cross-tenant id reaching the insert).
--   • boarding_visit_notification (school_id, visit_id) is MATCH SIMPLE (Postgres default — no MATCH clause):
--     a cohort/event-scoped send carries visit_id NULL, which SKIPS the composite FK entirely (the
--     inspections tweak-#3 pattern), so an event-scoped row is allowed while school_id stays NOT NULL.
--   • uniq_boarding_visit_rsvp is NULLS DISTINCT (Postgres default): a NULL approved_visitor_id (or NULL
--     calendar_event_id) makes the row DISTINCT, so multiple FLAGGED walk-ins for the same student × event
--     COEXIST, while a duplicate at the full non-null grain (student × event × approved visitor) is rejected.
--     This is the intended re-RSVP idempotency behaviour, NOT a bug.

-- ---- enums needed by the visiting tables ----
DO $$ BEGIN
  CREATE TYPE "public"."visitor_approval_status" AS ENUM('PENDING_REVIEW', 'APPROVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."visit_status" AS ENUM('RSVP', 'ARRIVED', 'DEPARTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."visit_verification" AS ENUM('VERIFIED', 'FLAGGED', 'HM_AUTHORISED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."visit_notification_kind" AS ENUM('INVITATION', 'REMINDER_T3', 'REMINDER_T1', 'ARRIVAL_CONFIRM', 'OVERSTAY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- table 1: boarding_approved_visitor (DURABLE + REFERENCED — inline tenant UK) ----
-- The HM-curated per-student list the gate VERIFIES an arriving visitor against (list-CHECK not
-- list-RECORD). relationship is FREE TEXT (not an enum). id_hint/phone are external-PII (stored full,
-- rendered MASKED in lib/). status defaults PENDING_REVIEW; only APPROVED matches at the gate. Max-6 is
-- APP-enforced in lib/ (no DB cardinality constraint — a COUNT check would need a forbidden trigger).
CREATE TABLE IF NOT EXISTS "boarding_approved_visitor" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "name" text NOT NULL,
  "relationship" text NOT NULL,
  "id_hint" text,
  "phone" text,
  "status" "visitor_approval_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
  "pastoral_review" boolean DEFAULT false NOT NULL,
  "note" text,
  "added_by_user_id" uuid,
  "approved_by_user_id" uuid,
  "approved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "boarding_approved_visitor_tenant_uk" UNIQUE("school_id","id")
);

-- ---- table 2: boarding_visit (DURABLE + REFERENCED — inline tenant UK + re-RSVP UNIQUE) ----
-- The exeat two-stamp in/out lifecycle for a visiting-day gate check. status RSVP→ARRIVED→DEPARTED (a
-- walk-in inserts directly at ARRIVED); verification defaults FLAGGED (safe default — never silently
-- VERIFIED). visitor_name is a NOT-NULL snapshot so the visit stays a durable record even after the
-- approved-visitor row is removed. NO fee_owing_snapshot (visiting is NOT fee-gated). See header for the
-- NULL-distinct semantics of uniq_boarding_visit_rsvp.
CREATE TABLE IF NOT EXISTS "boarding_visit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "house_id" uuid NOT NULL,
  "calendar_event_id" uuid,
  "approved_visitor_id" uuid,
  "visitor_name" text NOT NULL,
  "visitor_phone" text,
  "relationship" text,
  "status" "visit_status" DEFAULT 'RSVP' NOT NULL,
  "verification" "visit_verification" DEFAULT 'FLAGGED' NOT NULL,
  "zone_key" text,
  "note" text,
  "rsvp_by_user_id" uuid,
  "arrived_at" timestamptz,
  "arrived_by_user_id" uuid,
  "departed_at" timestamptz,
  "departed_by_user_id" uuid,
  "authorised_at" timestamptz,
  "authorised_by_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "boarding_visit_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "uniq_boarding_visit_rsvp" UNIQUE("school_id","student_id","calendar_event_id","approved_visitor_id")
);

-- ---- table 3: boarding_visit_notification (LEAF — no tenant UK) ----
-- Dual-scoped visiting-day SMS log (mirror exeat_notification). Cohort/event sends (INVITATION/
-- REMINDER_T3/REMINDER_T1) carry a calendar_event_id and a NULL visit_id; per-visit sends
-- (ARRIVAL_CONFIRM/OVERSTAY) carry a visit_id. Only the delivery to_phone lives here — never the visitor
-- name/ID hint (PII discipline).
CREATE TABLE IF NOT EXISTS "boarding_visit_notification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "visit_id" uuid,
  "calendar_event_id" uuid,
  "kind" "visit_notification_kind" NOT NULL,
  "to_phone" text NOT NULL,
  "body" text NOT NULL,
  "provider" text NOT NULL,
  "provider_message_id" text,
  "error" text,
  "ok" boolean NOT NULL,
  "sent_at" timestamptz DEFAULT now() NOT NULL,
  "sent_by_user_id" uuid
);

-- ---- foreign keys (all CREATE TABLEs above are done, so every inline UK/PK target exists) ----
-- boarding_approved_visitor: single-col school_id → ref_school; single-col SET NULL actors → ref_user;
-- composite (school_id, student_id) → students.
DO $$ BEGIN
  ALTER TABLE "boarding_approved_visitor" ADD CONSTRAINT "boarding_approved_visitor_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_approved_visitor" ADD CONSTRAINT "boarding_approved_visitor_added_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("added_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_approved_visitor" ADD CONSTRAINT "boarding_approved_visitor_approved_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_approved_visitor" ADD CONSTRAINT "boarding_approved_visitor_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- boarding_visit: single-col school_id → ref_school; single-col SET NULL calendar_event_id →
-- boarding_calendar_event and approved_visitor_id → boarding_approved_visitor(id) (the PK); single-col
-- SET NULL actor stamps → ref_user; composite (school_id, student_id) → students, (school_id, house_id) → house.
DO $$ BEGIN
  ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_calendar_event_id_boarding_calendar_event_id_fk"
    FOREIGN KEY ("calendar_event_id") REFERENCES "public"."boarding_calendar_event"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_approved_visitor_id_boarding_approved_visitor_id_fk"
    FOREIGN KEY ("approved_visitor_id") REFERENCES "public"."boarding_approved_visitor"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_rsvp_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("rsvp_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_arrived_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("arrived_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_departed_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("departed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_authorised_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("authorised_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_school_id_house_id_house_school_id_id_fk"
    FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- boarding_visit_notification: single-col school_id → ref_school; single-col SET NULL calendar_event_id →
-- boarding_calendar_event and sent_by → ref_user; composite (school_id, visit_id) → boarding_visit's tenant
-- UK, MATCH SIMPLE (plain FK, no MATCH clause) so a NULL visit_id cohort send skips the FK.
DO $$ BEGIN
  ALTER TABLE "boarding_visit_notification" ADD CONSTRAINT "boarding_visit_notification_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit_notification" ADD CONSTRAINT "boarding_visit_notification_calendar_event_id_boarding_calendar_event_id_fk"
    FOREIGN KEY ("calendar_event_id") REFERENCES "public"."boarding_calendar_event"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit_notification" ADD CONSTRAINT "boarding_visit_notification_sent_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_visit_notification" ADD CONSTRAINT "boarding_visit_notification_school_id_visit_id_boarding_visit_school_id_id_fk"
    FOREIGN KEY ("school_id","visit_id") REFERENCES "public"."boarding_visit"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
CREATE INDEX IF NOT EXISTS "boarding_approved_visitor_student_idx"
  ON "boarding_approved_visitor" USING btree ("school_id","student_id");
CREATE INDEX IF NOT EXISTS "boarding_visit_event_house_idx"
  ON "boarding_visit" USING btree ("school_id","calendar_event_id","house_id");
CREATE INDEX IF NOT EXISTS "boarding_visit_notification_visit_idx"
  ON "boarding_visit_notification" USING btree ("school_id","visit_id");
CREATE INDEX IF NOT EXISTS "boarding_visit_notification_event_idx"
  ON "boarding_visit_notification" USING btree ("school_id","calendar_event_id");

-- ---- RLS — the same tenant_isolation policy every other tenant table uses (all 3 FORCE) ----
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'boarding_approved_visitor',
    'boarding_visit',
    'boarding_visit_notification'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO public '
      'USING (current_setting(''app.bypass_rls'', true) = ''on'' '
      '  OR school_id = NULLIF(current_setting(''app.current_school'', true), '''')::uuid) '
      'WITH CHECK (current_setting(''app.bypass_rls'', true) = ''on'' '
      '  OR school_id = NULLIF(current_setting(''app.current_school'', true), '''')::uuid);',
      tbl
    );
  END LOOP;
END
$$;
