-- Omnischools — migration 0053: WASSCE projection + readiness statement + SC-form (SHS module 4.3 /
-- INCR-17). The analytical spine's two PERSISTED artifacts. TWO NEW tables + THREE new enums + their RLS.
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD after merging.
-- (db:policies only configures local dev; a new tenant table needs its RLS pasted on prod by hand, or it
-- leaks across schools.)
--
-- SCOPE: 0053 is a pure NEW-TABLE migration — NO column ALTERs, NO backfills, NO seed. So this file is the
-- COMPLETE prod application of 0053: the 3 enums + 2 tables + FKs + indexes + RLS. Running it is equivalent
-- to running migration 0053 followed by db:policies for these tables.
--
-- TWO TENANT tables (NO global table this increment — the university match + any global lookup is INCR-17b):
--   • waec_special_consideration / readiness_statements — both carry school_id → ENABLE + FORCE RLS +
--     tenant_isolation (the standard tenant policy). Owner is NOT exempt under FORCE (fail-closed). Both are
--     LEAF (nothing references them in 0053) → NO tenant UK.
--
-- DDL ORDER (recall the 0033 FK-before-UNIQUE bug): enums → tables (each carrying its UNIQUE/PK/CHECK
-- INLINE) → FKs → indexes → RLS. Every FK target is created before the FK that references it — every
-- referenced constraint is either an inline PK/UNIQUE emitted in a CREATE TABLE above, or a prior-migration
-- tenant UK already shipped on prod:
--   • readiness_statements     (school_id, candidate_id) → wassce_candidates_tenant_uk (0051)
--   • readiness_statements     (school_id, mock_2_id)    → mock_exams_tenant_uk (0052)
--   • waec_special_consideration (school_id, candidate_id) → wassce_candidates_tenant_uk (0051)
--
-- CONSTRAINT notes (Kofi rulings 2026-07-19):
--   • R3 — waec_special_consideration: UNIQUE(school_id, candidate_id, sc_form) means a REFILE UPDATEs the
--     one row (never a second). MUTABLE workflow (sc_status). The *_file_id columns have NO FK (no files
--     table) and stay NULL. filed_by_user_id is single-col SET NULL → ref_user.
--   • R4 — readiness_statements: FROZEN artifact. projected_aggregate range CHECK (NULL OR 6..54 — six A1 =
--     6 … six F9 = 54). projection_snapshot_json NOT NULL (frozen §5 visualizer + trajectory).
--     target_universities_json stays NULL (17b, no university leak). State (current/superseded, ack) is
--     DERIVED from superseded_at + parent_acknowledged_at — NO status enum. The partial index below serves
--     the "current statement" read (superseded_at IS NULL); the single-current invariant is enforced by the
--     generation action (supersede-then-insert), NOT a unique constraint. generated_by_user_id + the
--     parent_signature_pdf_file_id placeholder follow the same single-col SET NULL / no-FK rules.
--   • NO TRIGGERS (portability): the projection is a pure lib (lib/wassce/projection.ts); the frozen
--     snapshot is written ONCE by the generation server action, never by a trigger.

-- ---- enums needed by the new tables ----
DO $$ BEGIN
  CREATE TYPE "public"."sc_form" AS ENUM('SC-3', 'SC-7', 'SC-12');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."sc_status" AS ENUM('DRAFT', 'FILED', 'ACKNOWLEDGED', 'APPROVED', 'SCHEDULED', 'COMPLETED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."parent_ack_method" AS ENUM('PHONE_OTP', 'IN_PERSON', 'PDF_UPLOAD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- table 1: waec_special_consideration (TENANT, LEAF — inline UNIQUE, no tenant UK) ----
-- One MUTABLE filing per (candidate × SC form) — refile UPDATEs this row (R3). The *_file_id columns are
-- nullable placeholders with NO FK (no files table). Composite (school_id, candidate_id) → wassce_candidates.
CREATE TABLE IF NOT EXISTS "waec_special_consideration" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "candidate_id" uuid NOT NULL,
  "sc_form" "sc_form" NOT NULL,
  "status" "sc_status" NOT NULL,
  "filed_at" timestamptz,
  "filed_by_user_id" uuid,
  "medical_cert_file_id" uuid,
  "clinician_letter_file_id" uuid,
  "waec_acknowledged_at" timestamptz,
  "waec_ref" text,
  "approved_at" timestamptz,
  "make_up_scheduled_at" timestamptz,
  "make_up_centre" text,
  "completed_at" timestamptz,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_waec_sc_candidate_form" UNIQUE("school_id","candidate_id","sc_form")
);

-- ---- table 2: readiness_statements (TENANT, LEAF — inline CHECK, no tenant UK) ----
-- FROZEN projection artifact (R4). projection_snapshot_json NOT NULL; projected_aggregate range CHECK
-- (NULL OR 6..54). target_universities_json NULL (17b). Composite (school_id, candidate_id) → wassce_candidates
-- and (school_id, mock_2_id) → mock_exams. parent_signature_pdf_file_id nullable placeholder, NO FK.
CREATE TABLE IF NOT EXISTS "readiness_statements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "candidate_id" uuid NOT NULL,
  "mock_2_id" uuid NOT NULL,
  "projected_aggregate" smallint,
  "projected_band" text,
  "projection_snapshot_json" jsonb NOT NULL,
  "target_universities_json" jsonb,
  "generated_at" timestamptz NOT NULL,
  "generated_by_user_id" uuid,
  "superseded_at" timestamptz,
  "parent_acknowledged_at" timestamptz,
  "parent_acknowledged_signature_method" "parent_ack_method",
  "parent_acknowledged_phone" text,
  "parent_concerns_text" text,
  "parent_signature_pdf_file_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "readiness_statements_projected_aggregate_range" CHECK ("projected_aggregate" IS NULL OR ("projected_aggregate" BETWEEN 6 AND 54))
);

-- ---- foreign keys (all CREATE TABLEs above are done, so every inline/prior-migration UK/PK target exists) ----
-- waec_special_consideration: single-col school_id → ref_school CASCADE; single-col filed_by SET NULL →
-- ref_user; composite (school_id, candidate_id) → wassce_candidates CASCADE.
DO $$ BEGIN
  ALTER TABLE "waec_special_consideration" ADD CONSTRAINT "waec_special_consideration_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "waec_special_consideration" ADD CONSTRAINT "waec_special_consideration_filed_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("filed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "waec_special_consideration" ADD CONSTRAINT "waec_special_consideration_school_id_candidate_id_wassce_candidates_school_id_id_fk"
    FOREIGN KEY ("school_id","candidate_id") REFERENCES "public"."wassce_candidates"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- readiness_statements: single-col school_id → ref_school CASCADE; single-col generated_by SET NULL →
-- ref_user; composite (school_id, candidate_id) → wassce_candidates; (school_id, mock_2_id) → mock_exams.
DO $$ BEGIN
  ALTER TABLE "readiness_statements" ADD CONSTRAINT "readiness_statements_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "readiness_statements" ADD CONSTRAINT "readiness_statements_generated_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "readiness_statements" ADD CONSTRAINT "readiness_statements_school_id_candidate_id_wassce_candidates_school_id_id_fk"
    FOREIGN KEY ("school_id","candidate_id") REFERENCES "public"."wassce_candidates"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "readiness_statements" ADD CONSTRAINT "readiness_statements_school_id_mock_2_id_mock_exams_school_id_id_fk"
    FOREIGN KEY ("school_id","mock_2_id") REFERENCES "public"."mock_exams"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
-- per-candidate statement history read (§7) — includes superseded rows.
CREATE INDEX IF NOT EXISTS "readiness_statements_candidate_idx"
  ON "readiness_statements" USING btree ("school_id","candidate_id");
-- "current statement" hot read — the single non-superseded row per candidate (partial index).
CREATE INDEX IF NOT EXISTS "readiness_statements_current_idx"
  ON "readiness_statements" USING btree ("school_id","candidate_id") WHERE "superseded_at" IS NULL;
-- (waec_special_consideration needs no extra index — the UNIQUE(school_id, candidate_id, sc_form) prefix
--  already serves the per-candidate SC read.)

-- ---- RLS — both TENANT tables: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'waec_special_consideration',
    'readiness_statements'
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
