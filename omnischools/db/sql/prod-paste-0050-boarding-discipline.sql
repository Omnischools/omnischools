-- Omnischools — migration 0050: Boarding discipline & deboardinization (SHS module 4.2 / INCR-13).
-- The MODULE 4.2 CLOSER. THREE NEW tenant tables (boarding_infractions, bond_artefacts,
-- deboardinization_records) plus their 3 enums plus their RLS. Idempotent — safe to run more than
-- once. Paste into the Supabase SQL editor on PROD after merging. (db:policies only configures local
-- dev; a new tenant table needs its RLS pasted on prod by hand, or it leaks across schools.)
--
-- SCOPE: 0050 is a pure NEW-TABLE migration — NO column ALTERs, NO backfills, NO seed. So this file is
-- the COMPLETE prod application of 0050: the 3 enums + 3 tables + FKs + indexes + FORCE RLS on all
-- three. Running it is equivalent to running migration 0050 followed by db:policies for these three.
--
-- 🟥 THE INVOICE-WRITE STUB (owner-settled — do NOT re-open): deboardinization_records.
-- fee_penalty_invoice_id is a plain nullable uuid with NO FK to invoices, LEFT NULL. This file writes
-- NO invoices/finance row, creates NO PENALTY fee-category. The 3× penalty is DISPLAY-only from stored
-- snapshots (penalty_days/penalty_per_day_amount/penalty_adjusted_amount/penalty_adjustment_reason).
--
-- DDL ORDER (recall the 0033 FK-before-UNIQUE bug): enums → tables (each carrying its UNIQUE/PK/CHECK
-- INLINE) → FKs → indexes → RLS. Every FK target is created before the FK that references it:
--   • boarding_infractions self-FK (school_id, parent_infraction_id) → boarding_infractions(school_id,
--     id): the tenant UK "boarding_infractions_tenant_uk", created INLINE — the FK ALTER runs strictly
--     after that CREATE TABLE (ON DELETE NO ACTION; append-only never single-deletes, a whole-school
--     cascade removes the set together).
--   • bond_artefacts (school_id, infraction_id) → boarding_infractions(school_id, id): the same tenant
--     UK, created INLINE. CASCADE with the infraction.
--   • deboardinization_records (school_id, infraction_id) → boarding_infractions(school_id, id): idem.
--   • (school_id, student_id) → students_tenant_uk; (school_id, house_id) → house_tenant_uk: shipped.
-- All CREATE TABLE statements run before any ADD CONSTRAINT, so every inline UK/PK/CHECK exists first.
--
-- TENANT-UK vs LEAF doctrine (per table):
--   • boarding_infractions — the PARENT, DURABLE + REFERENCED (its supersede self-chain +
--     bond_artefacts.infraction_id + deboardinization_records.infraction_id) → carries a composite
--     (school_id, id) tenant UK (the F0-spine / boarding_exeat pattern).
--   • bond_artefacts — LEAF (nothing references it) → FORCE RLS but NO tenant UK (mirror
--     exeat_notification).
--   • deboardinization_records — LEAF → FORCE RLS but NO tenant UK.
--
-- CONSTRAINT notes:
--   • uniq_infraction_source is NULLS-partial (WHERE source_ref_id IS NOT NULL): a MANUAL log carries
--     source_ref_id NULL and is EXEMPT (any number coexist); a duplicate auto-log at the non-null grain
--     (school_id, source_kind, source_ref_id) is rejected — the DB backstop behind lib/'s NOT-EXISTS
--     idempotency guard for the 4 module stubs (exeat overdue / inspection FAIL / overstay / absent).
--   • deboard_effective_needs_all_signs (same-table CHECK): effective_at requires all 3 *_sign_at — a
--     2-of-3 draft can never flip residency. The app enforces each signer's ROLE; the CHECK enforces
--     presence/COUNT. No cross-table trigger (portability).
--   • reinstate_needs_board_decision (same-table CHECK): reinstated_at requires board_decision_text.
--   • one_active_deboard_per_student (partial UNIQUE, WHERE effective_at IS NOT NULL AND reinstated_at
--     IS NULL): at most one ACTIVE deboardinization per student (drafts + reinstated records exempt).

-- ---- enums needed by the discipline tables ----
DO $$ BEGIN
  CREATE TYPE "public"."infraction_severity" AS ENUM('NOTE', 'WARNING', 'BOND', 'SUSPENSION', 'DEBOARDINIZATION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."infraction_source" AS ENUM('MANUAL', 'EXEAT_OVERDUE', 'INSPECTION_DAILY', 'INSPECTION_WEEKLY', 'VISIT_OVERSTAY', 'RESUMPTION_ABSENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."infraction_status" AS ENUM('OPEN', 'RESOLVED', 'SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- table 1: boarding_infractions (PARENT, append-only — inline tenant UK) ----
-- One row per logged infraction at a ladder rung. NO delete/edit: a correction is a NEW row carrying
-- parent_infraction_id (composite self-FK) with the original flipped to status=SUPERSEDED. severity is
-- the frozen 5-rung DeboardinizationSeverity. co_signs_json is an audit mirror, NOT the enforcement
-- point. house_id is a nullable House snapshot (composite SET NULL). source_kind/source_ref_id are the
-- idempotency key for the 4 auto-logged module stubs.
CREATE TABLE IF NOT EXISTS "boarding_infractions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "house_id" uuid,
  "severity" "infraction_severity" NOT NULL,
  "narrative_text" text NOT NULL,
  "status" "infraction_status" DEFAULT 'OPEN' NOT NULL,
  "co_signs_json" jsonb,
  "parent_infraction_id" uuid,
  "source_kind" "infraction_source" DEFAULT 'MANUAL' NOT NULL,
  "source_ref_id" text,
  "logged_by_user_id" uuid,
  "logged_at" timestamptz DEFAULT now() NOT NULL,
  "parents_notified_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "boarding_infractions_tenant_uk" UNIQUE("school_id","id")
);

-- ---- table 2: bond_artefacts (LEAF — one bond per infraction) ----
-- The witnessed standard-form bond: student signature + HM witness + Senior-HM witness (the surface's
-- 3 independently-flipping slots). bond_text is sensitive PII (tenant-scoped). scanned_pdf_file_id is a
-- nullable opaque pointer with NO FK (no files table yet).
CREATE TABLE IF NOT EXISTS "bond_artefacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "infraction_id" uuid NOT NULL,
  "student_signature_at" timestamptz,
  "hm_witness_user_id" uuid,
  "hm_witness_at" timestamptz,
  "senior_hm_witness_user_id" uuid,
  "senior_hm_witness_at" timestamptz,
  "scanned_pdf_file_id" uuid,
  "bond_text" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_bond_per_infraction" UNIQUE("school_id","infraction_id")
);

-- ---- table 3: deboardinization_records (LEAF — 3-way co-sign + Board-review + reinstate + 2 CHECKs) ----
-- The 3 DISCRETE co-sign columns are the enforcement point (HM=HOUSEMASTER / Senior-HM=DEAN_OF_BOARDING
-- / Headmaster=HEADMASTER). effective_at flips residency + releases the bunk (in lib/, no trigger).
-- Board is a first-class record (board_review_at/board_decision_text); reinstate is Headmaster-gated.
-- 🟥 fee_penalty_invoice_id: NO FK, LEFT NULL (the invoice-write STUB). Penalty cols are display snapshots.
CREATE TABLE IF NOT EXISTS "deboardinization_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "infraction_id" uuid NOT NULL,
  "hm_sign_user_id" uuid,
  "hm_sign_at" timestamptz,
  "senior_hm_sign_user_id" uuid,
  "senior_hm_sign_at" timestamptz,
  "headmaster_sign_user_id" uuid,
  "headmaster_sign_at" timestamptz,
  "effective_at" timestamptz,
  "board_review_at" timestamptz,
  "board_decision_text" text,
  "reinstated_at" timestamptz,
  "reinstated_by_user_id" uuid,
  "fee_penalty_invoice_id" uuid,
  "penalty_days" integer,
  "penalty_per_day_amount" numeric(12, 2),
  "penalty_adjusted_amount" numeric(12, 2),
  "penalty_adjustment_reason" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "deboard_effective_needs_all_signs" CHECK ("deboardinization_records"."effective_at" IS NULL OR ("deboardinization_records"."hm_sign_at" IS NOT NULL AND "deboardinization_records"."senior_hm_sign_at" IS NOT NULL AND "deboardinization_records"."headmaster_sign_at" IS NOT NULL)),
  CONSTRAINT "reinstate_needs_board_decision" CHECK ("deboardinization_records"."reinstated_at" IS NULL OR "deboardinization_records"."board_decision_text" IS NOT NULL)
);

-- ---- foreign keys (all CREATE TABLEs above are done, so every inline UK/PK target exists) ----
-- boarding_infractions: single-col school_id → ref_school; single-col SET NULL logged_by → ref_user;
-- composite (school_id, student_id) → students CASCADE; composite (school_id, house_id) → house SET NULL
-- (snapshot); composite self-FK (school_id, parent_infraction_id) → this table's tenant UK, NO ACTION.
DO $$ BEGIN
  ALTER TABLE "boarding_infractions" ADD CONSTRAINT "boarding_infractions_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_infractions" ADD CONSTRAINT "boarding_infractions_logged_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("logged_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_infractions" ADD CONSTRAINT "boarding_infractions_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_infractions" ADD CONSTRAINT "boarding_infractions_school_id_house_id_house_school_id_id_fk"
    FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_infractions" ADD CONSTRAINT "boarding_infractions_school_id_parent_infraction_id_boarding_infractions_school_id_id_fk"
    FOREIGN KEY ("school_id","parent_infraction_id") REFERENCES "public"."boarding_infractions"("school_id","id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- bond_artefacts: single-col school_id → ref_school; single-col SET NULL witness stamps → ref_user;
-- composite (school_id, infraction_id) → boarding_infractions' tenant UK, CASCADE with the infraction.
DO $$ BEGIN
  ALTER TABLE "bond_artefacts" ADD CONSTRAINT "bond_artefacts_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "bond_artefacts" ADD CONSTRAINT "bond_artefacts_hm_witness_user_id_ref_user_id_fk"
    FOREIGN KEY ("hm_witness_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "bond_artefacts" ADD CONSTRAINT "bond_artefacts_senior_hm_witness_user_id_ref_user_id_fk"
    FOREIGN KEY ("senior_hm_witness_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "bond_artefacts" ADD CONSTRAINT "bond_artefacts_school_id_infraction_id_boarding_infractions_school_id_id_fk"
    FOREIGN KEY ("school_id","infraction_id") REFERENCES "public"."boarding_infractions"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- deboardinization_records: single-col school_id → ref_school; single-col SET NULL sign/reinstate
-- actors → ref_user; composite (school_id, student_id) → students CASCADE; composite (school_id,
-- infraction_id) → boarding_infractions' tenant UK CASCADE. fee_penalty_invoice_id has NO FK (the stub).
DO $$ BEGIN
  ALTER TABLE "deboardinization_records" ADD CONSTRAINT "deboardinization_records_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "deboardinization_records" ADD CONSTRAINT "deboardinization_records_hm_sign_user_id_ref_user_id_fk"
    FOREIGN KEY ("hm_sign_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "deboardinization_records" ADD CONSTRAINT "deboardinization_records_senior_hm_sign_user_id_ref_user_id_fk"
    FOREIGN KEY ("senior_hm_sign_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "deboardinization_records" ADD CONSTRAINT "deboardinization_records_headmaster_sign_user_id_ref_user_id_fk"
    FOREIGN KEY ("headmaster_sign_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "deboardinization_records" ADD CONSTRAINT "deboardinization_records_reinstated_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("reinstated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "deboardinization_records" ADD CONSTRAINT "deboardinization_records_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "deboardinization_records" ADD CONSTRAINT "deboardinization_records_school_id_infraction_id_boarding_infractions_school_id_id_fk"
    FOREIGN KEY ("school_id","infraction_id") REFERENCES "public"."boarding_infractions"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes (incl. the 2 partial uniques) ----
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_infraction_source"
  ON "boarding_infractions" USING btree ("school_id","source_kind","source_ref_id") WHERE "source_ref_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "boarding_infractions_student_idx"
  ON "boarding_infractions" USING btree ("school_id","student_id");
CREATE INDEX IF NOT EXISTS "boarding_infractions_status_idx"
  ON "boarding_infractions" USING btree ("school_id","status");
CREATE UNIQUE INDEX IF NOT EXISTS "one_active_deboard_per_student"
  ON "deboardinization_records" USING btree ("school_id","student_id") WHERE "effective_at" IS NOT NULL AND "reinstated_at" IS NULL;

-- ---- RLS — the same tenant_isolation policy every other tenant table uses (all 3 FORCE) ----
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'boarding_infractions',
    'bond_artefacts',
    'deboardinization_records'
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
