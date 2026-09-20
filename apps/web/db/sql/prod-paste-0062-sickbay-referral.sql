-- Omnischools — migration 0062: SICKBAY REFERRALS (SHS module 4.4 / INCR-25, lane B). FIVE new enums
-- + SIX new tenant tables, ZERO altered columns. All six are STANDARD tenant tables: ENABLE + FORCE
-- RLS + tenant_isolation + the catalog-driven parent_deny — and, like the 0060 medication layer and
-- unlike the 0058 chronic register, NO staff_grant_scope family (R194: the referral is the ACUTE
-- clinical graph, gated app-layer like the visit/MAR, not via the chronic per-entry grant boundary).
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD after merging.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. Without this paste the
-- six tables exist on prod with NO row-level security at all: no ENABLE, no FORCE, no tenant_isolation,
-- no parent_deny. sickbay_referral carries the FROZEN ER handoff (reason referred out, pre-referral
-- care, labs, last meal, MENSTRUAL data — Class-4 PII, travel), the NHIS card-number snapshot and the
-- return record; student_nhis_card holds the national NHIS identifier per student; sickbay_referral_update
-- the external ward-round log; sickbay_referral_cost_line the reconciliation the Bursar reads;
-- sickbay_notification the parent/HM/headmaster comms (incl. a matron private_note that must never reach
-- a parent). Without the paste every school's referral record, NHIS numbers, ER handoffs and comms are
-- readable AND writable from every other school's session. Run it at deploy. This is the module's most
-- sensitive data yet — Sarah gates paste parity (Risk 6).
--
-- SCOPE: NEW-TABLE-ONLY — no data changes, no backfills, no seed, no GLOBAL-table changes, no altered
-- columns on any existing table. It is the DB foundation for BOTH 25a (hospital + NHIS-card config) and
-- 25b (the referral flow, app-layer): the whole 0062 table set is authored here up front (the
-- 0056/0057 author-UK-before-FK precedent), including sickbay_notification, whose WRITE-CHAIN is built
-- at INCR-26 (R196/R197 — INCR-25 inserts ZERO rows into it, and private_note stays unpopulated).
--
-- 🔴 DDL ORDER — THE 0033 HAZARD, INSIDE ONE MIGRATION (as 0057/0058/0060). Three composite-FK targets
-- are authored INLINE in CREATE TABLE — `sickbay_hospital_tenant_uk` (referral.hospital_id target),
-- `sickbay_referral_tenant_uk` (referral_update / cost_line / notification.referral_id target) and
-- `sickbay_notification_tenant_uk` (the SHARPEST — the target of sickbay_notification's OWN self-FK,
-- retry_of_id) — so every one exists before the ALTER TABLE … ADD FOREIGN KEY that consumes it. There
-- is NO `ALTER TABLE … ADD UNIQUE` anywhere in this file: drizzle-kit runs a migration's statements in
-- ONE transaction and SWALLOWS a UK-after-FK error (silent rollback, exit 1, no message), so the
-- generated 0062 SQL was read by eye AND replayed from EMPTY into a throwaway database, verified by
-- CATALOG inspection (pg_constraint / pg_policy) rather than exit code. Every composite-FK target here:
--   • sickbay_hospital_tenant_uk / sickbay_referral_tenant_uk / sickbay_notification_tenant_uk — INLINE.
--   • students_tenant_uk (0033), sickbay_visit_tenant_uk (0057), invoice_line_item / notification_log /
--     student_guardian / ref_school / ref_user PK — all shipped.
--
-- ⚠ Constraint NAMES are the drizzle-generated ones, so this paste and `drizzle-kit migrate` produce a
-- byte-identical catalog. Postgres truncates identifiers at 63 chars — the long composite FK names below
-- are written PRE-truncation exactly as drizzle emits them; Postgres truncates them identically on both
-- paths (a NOTICE, not an error) and the truncations stay distinct (verified in the from-empty replay).
--
-- NO TRIGGERS (portability). Every cross-row rule lives in lib/sickbay/: the legal status transitions,
-- the write-once ER handoff, void-only-while-not-returned, the HM co-sign role check, the medical-hold
-- UNION (open admissions ∪ open referrals, R193) and referredOutStudentIds() (R192). The one rule in
-- the DB is sickbay_notification's single-row `tier BETWEEN 1 AND 3` CHECK — not a cross-table trigger.
--
-- Verify afterwards with db/sql/verify-prod-rls.sql — Query 1 must return ZERO ROWS and Query 2's
-- tenant_tables must have risen by exactly 6 (with parent_denied up 6). Then confirm no staff_grant
-- family leaked onto these six (they are STANDARD tenant tables):
--   select c.relname, p.polname, p.polpermissive
--   from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname in ('sickbay_hospital','student_nhis_card','sickbay_referral','sickbay_referral_update','sickbay_referral_cost_line','sickbay_notification')
--   order by 1, 2;   -- expect exactly 2 rows per table: tenant_isolation (permissive) + parent_deny (restrictive).

-- ---- enums needed by the new tables ----
DO $$ BEGIN
  CREATE TYPE "public"."nhis_holder_kind" AS ENUM('STUDENT', 'GUARDIAN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."sickbay_notify_channel" AS ENUM('SMS', 'CALL', 'IN_APP', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."sickbay_notify_direction" AS ENUM('OUTBOUND', 'INBOUND');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."sickbay_notify_recipient" AS ENUM('PARENT', 'HOUSEMASTER', 'HEADMASTER', 'DISTRICT_HEALTH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."sickbay_referral_status" AS ENUM('REFERRED', 'INPATIENT', 'RETURNING', 'RETURNED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- table 1: sickbay_hospital (TENANT, config; tenant UK INLINE — referral.hospital_id target) ----
CREATE TABLE IF NOT EXISTS "sickbay_hospital" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "name" text NOT NULL,
  "distance_km" numeric,
  "services" text,
  "notes" text,
  "is_primary" boolean DEFAULT false NOT NULL,
  "accepts_nhis" boolean DEFAULT false NOT NULL,
  "tags" jsonb,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sickbay_hospital_tenant_uk" UNIQUE("school_id","id")
);

-- ---- table 2: student_nhis_card (TENANT, LEAF — the NHIS beneficiary singleton; no tenant UK) ----
-- card_number VERBATIM (formats vary, no regex/CHECK). NO status column — Active/Expiring/Expired is
-- derived from valid_to. holder is TEXT + kind (the card can be the mother's); student_guardian_id is a
-- best-effort SET NULL link only.
CREATE TABLE IF NOT EXISTS "student_nhis_card" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "card_number" text NOT NULL,
  "holder_name" text,
  "holder_kind" "nhis_holder_kind" DEFAULT 'STUDENT' NOT NULL,
  "valid_from" date,
  "valid_to" date,
  "student_guardian_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_student_nhis_card" UNIQUE("school_id","student_id")
);

-- ---- table 3: sickbay_referral (TENANT — the referred-out record; tenant UK INLINE, consumed by
-- referral_update / cost_line / notification) ----
CREATE TABLE IF NOT EXISTS "sickbay_referral" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "visit_id" uuid NOT NULL,
  "hospital_id" uuid NOT NULL,
  "accompanied_by_user_id" uuid,
  "hm_authorised_by_user_id" uuid,
  "recorded_by_user_id" uuid,
  "status" "sickbay_referral_status" DEFAULT 'REFERRED' NOT NULL,
  "transport_mode" text,
  "hospital_ward" text,
  "hospital_bed" text,
  "attending_clinician_name" text,
  "hm_authorised_at" timestamp with time zone,
  "departed_at" timestamp with time zone,
  "expected_return_at" timestamp with time zone,
  "returned_at" timestamp with time zone,
  "return_note" text,
  "voided_at" timestamp with time zone,
  "voided_by_user_id" uuid,
  "void_reason" text,
  "nhis_card_number" text,
  "nhis_valid" boolean,
  "reason_referred_out" text NOT NULL,
  "pre_referral_care" text,
  "handoff_labs" text,
  "last_meal" text,
  "menses_note" text,
  "travel_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sickbay_referral_tenant_uk" UNIQUE("school_id","id")
);

-- ---- table 4: sickbay_referral_update (TENANT, LEAF, APPEND-ONLY — no tenant UK, no updated_at) ----
CREATE TABLE IF NOT EXISTS "sickbay_referral_update" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "referral_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "clinician_name" text,
  "clinician_affiliation" text,
  "body" text,
  "recorded_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ---- table 5: sickbay_referral_cost_line (TENANT, LEAF — the diagnosis-free reconciliation; no tenant
-- UK; NO clinical column by construction, R185/Risk-4; billing_line_item_id stays NULL in 4.4, D6) ----
CREATE TABLE IF NOT EXISTS "sickbay_referral_cost_line" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "referral_id" uuid NOT NULL,
  "item_label" text,
  "provider" text,
  "nhis_covered" boolean NOT NULL,
  "out_of_pocket_amount" numeric,
  "billing_line_item_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ---- table 6: sickbay_notification (TENANT — authored 0062, WRITTEN INCR-26; tenant UK INLINE, the
-- SELF-FK target; tier CHECK inline) ----
CREATE TABLE IF NOT EXISTS "sickbay_notification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "visit_id" uuid,
  "referral_id" uuid,
  "notification_log_id" uuid,
  "retry_of_id" uuid,
  "created_by_user_id" uuid,
  "tier" smallint NOT NULL,
  "channel" "sickbay_notify_channel" NOT NULL,
  "direction" "sickbay_notify_direction" NOT NULL,
  "recipient" "sickbay_notify_recipient" NOT NULL,
  "trigger_label" text,
  "body" text,
  "private_note" text,
  "call_duration_seconds" smallint,
  "answered" boolean,
  "scheduled_for" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sickbay_notification_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "sickbay_notification_tier_range" CHECK ("sickbay_notification"."tier" BETWEEN 1 AND 3)
);

-- ---- foreign keys — ALL SIX CREATE TABLEs (with their INLINE tenant UKs) are complete, so every
-- composite target exists. Guarded so a re-run is a no-op. ----

-- sickbay_hospital
DO $$ BEGIN
  ALTER TABLE "sickbay_hospital" ADD CONSTRAINT "sickbay_hospital_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- sickbay_notification — actor / log SET NULL, then composite CASCADE, then the SELF-FK RESTRICT.
-- ⚠ the self-FK consumes sickbay_notification_tenant_uk (INLINE above) — the sharpest 0033 hazard.
DO $$ BEGIN
  ALTER TABLE "sickbay_notification" ADD CONSTRAINT "sickbay_notification_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_notification" ADD CONSTRAINT "sickbay_notification_notification_log_id_notification_log_id_fk"
    FOREIGN KEY ("notification_log_id") REFERENCES "public"."notification_log"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_notification" ADD CONSTRAINT "sickbay_notification_created_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_notification" ADD CONSTRAINT "sickbay_notification_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_notification" ADD CONSTRAINT "sickbay_notification_school_id_visit_id_sickbay_visit_school_id_id_fk"
    FOREIGN KEY ("school_id","visit_id") REFERENCES "public"."sickbay_visit"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_notification" ADD CONSTRAINT "sickbay_notification_school_id_referral_id_sickbay_referral_school_id_id_fk"
    FOREIGN KEY ("school_id","referral_id") REFERENCES "public"."sickbay_referral"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_notification" ADD CONSTRAINT "sickbay_notification_retry_of_fk"
    FOREIGN KEY ("school_id","retry_of_id") REFERENCES "public"."sickbay_notification"("school_id","id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- sickbay_referral — actor SET NULL, then composite student/visit CASCADE, then hospital RESTRICT.
-- ⚠ the hospital FK consumes sickbay_hospital_tenant_uk (INLINE above).
DO $$ BEGIN
  ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_accompanied_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("accompanied_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_hm_authorised_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("hm_authorised_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_recorded_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_voided_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_school_id_visit_id_sickbay_visit_school_id_id_fk"
    FOREIGN KEY ("school_id","visit_id") REFERENCES "public"."sickbay_visit"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_school_id_hospital_id_sickbay_hospital_school_id_id_fk"
    FOREIGN KEY ("school_id","hospital_id") REFERENCES "public"."sickbay_hospital"("school_id","id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- sickbay_referral_cost_line — billing SET NULL (stays NULL in 4.4), then referral CASCADE.
DO $$ BEGIN
  ALTER TABLE "sickbay_referral_cost_line" ADD CONSTRAINT "sickbay_referral_cost_line_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_referral_cost_line" ADD CONSTRAINT "sickbay_referral_cost_line_billing_line_item_id_invoice_line_item_id_fk"
    FOREIGN KEY ("billing_line_item_id") REFERENCES "public"."invoice_line_item"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_referral_cost_line" ADD CONSTRAINT "sickbay_referral_cost_line_school_id_referral_id_sickbay_referral_school_id_id_fk"
    FOREIGN KEY ("school_id","referral_id") REFERENCES "public"."sickbay_referral"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- sickbay_referral_update — recorded_by SET NULL, then referral CASCADE.
DO $$ BEGIN
  ALTER TABLE "sickbay_referral_update" ADD CONSTRAINT "sickbay_referral_update_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_referral_update" ADD CONSTRAINT "sickbay_referral_update_recorded_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_referral_update" ADD CONSTRAINT "sickbay_referral_update_school_id_referral_id_sickbay_referral_school_id_id_fk"
    FOREIGN KEY ("school_id","referral_id") REFERENCES "public"."sickbay_referral"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- student_nhis_card — guardian SET NULL, then student CASCADE.
DO $$ BEGIN
  ALTER TABLE "student_nhis_card" ADD CONSTRAINT "student_nhis_card_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "student_nhis_card" ADD CONSTRAINT "student_nhis_card_student_guardian_id_student_guardian_id_fk"
    FOREIGN KEY ("student_guardian_id") REFERENCES "public"."student_guardian"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "student_nhis_card" ADD CONSTRAINT "student_nhis_card_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes (new tables) ----
-- The active-referral list ("students out right now") filters by status within a school.
CREATE INDEX IF NOT EXISTS "sickbay_referral_status_idx"
  ON "sickbay_referral" USING btree ("school_id","status");
-- The day-counter / "since 06:45" reads and referredOutStudentIds()'s window scan by departed_at.
CREATE INDEX IF NOT EXISTS "sickbay_referral_departed_idx"
  ON "sickbay_referral" USING btree ("school_id","departed_at");
-- A referral's updates in time order (the append-only log's only read).
CREATE INDEX IF NOT EXISTS "sickbay_referral_update_referral_idx"
  ON "sickbay_referral_update" USING btree ("school_id","referral_id","occurred_at");
-- A referral's cost lines, read together for the reconciliation.
CREATE INDEX IF NOT EXISTS "sickbay_referral_cost_line_referral_idx"
  ON "sickbay_referral_cost_line" USING btree ("school_id","referral_id");
-- INCR-26's reads (authored now — the notification table's one migration): a referral's notification
-- thread, and a student's notifications, in time order.
CREATE INDEX IF NOT EXISTS "sickbay_notification_referral_idx"
  ON "sickbay_notification" USING btree ("school_id","referral_id","created_at");
CREATE INDEX IF NOT EXISTS "sickbay_notification_student_idx"
  ON "sickbay_notification" USING btree ("school_id","student_id","created_at");

-- ---- RLS — all SIX new tables: ENABLE + FORCE + tenant_isolation. STANDARD tenant tables, NO
-- staff_grant_scope (R194). Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql
-- (these six names are added to that hardcoded array in the same commit). FORCE means the owner is NOT
-- exempt: a query that forgets to set app.current_school returns ZERO rows. ----
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'sickbay_hospital',
    'student_nhis_card',
    'sickbay_referral',
    'sickbay_referral_update',
    'sickbay_referral_cost_line',
    'sickbay_notification'
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

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0058/0060 ----
-- Owner decision D8 keeps a claimed parent out of every tenant table except the small parent-readable
-- set. The loop is NOT a hand-list: it applies parent_deny to every FORCE-RLS + school_id table that
-- lacks a parent_scope policy — which, after the block above, includes the six new tables (it re-creates
-- the identical policy on the already-covered tables, hence idempotent). It is re-run here rather than
-- hand-listing the six because that is what keeps a FUTURE sickbay table auto-denied.
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r'
      AND c.relforcerowsecurity
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = c.relname
          AND col.column_name = 'school_id'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_policy p
        WHERE p.polrelid = c.oid AND p.polname = 'parent_scope'
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS parent_deny ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY parent_deny ON %I AS RESTRICTIVE FOR ALL TO public '
      'USING (NULLIF(current_setting(''app.current_parent_user'', true), '''') IS NULL);',
      tbl
    );
  END LOOP;
END
$$;
