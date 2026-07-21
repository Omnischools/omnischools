-- Omnischools — migration 0056: SICKBAY F0 spine (SHS module 4.4 / INCR-21). TWO new enums + THREE
-- new tenant tables + TWO new columns on staff_profile + their RLS. Idempotent — safe to run more
-- than once. Paste into the Supabase SQL editor on PROD after merging.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. If migration 0056 ships
-- to prod without this paste, the three sickbay tables exist there with **NO row-level security at
-- all**: no ENABLE, no FORCE, no tenant_isolation, no parent_deny. Every school's sickbay config —
-- declared clinical mode, bed inventory, the matron's and assistant matron's identities, the visiting
-- doctor, the full round/clinic/on-call schedule — becomes readable and WRITABLE from every other
-- school's session, and a claimed parent session reads it too. This module goes on to hold the most
-- sensitive data in the product (0057+ adds visits, vitals, medication and working impressions on top
-- of these very tables' tenant keys). Running this file == migration 0056 followed by db:policies for
-- these tables; the executable SQL below is deliberately equivalent to what db/sql/policies.sql
-- applies. Verify afterwards with db/sql/verify-prod-rls.sql — Query 1 must return ZERO rows and
-- Query 2's tenant_tables must have risen by exactly 3 (with parent_denied up 3).
--
-- SCOPE: 0056 is a NEW-TABLE + ADD-COLUMN migration — NO backfills, NO data changes, NO seed, NO
-- GLOBAL-table changes. Nothing clinical: no visit, no patient, no vitals, no medication, no
-- diagnosis (all 0057+). The only new "clinical" datum is the N&MC licence pair on staff_profile —
-- a PUBLIC statutory-register credential, not medical PII.
--
-- ALL THREE new tables are TENANT tables (they carry school_id) → ENABLE + FORCE ROW LEVEL SECURITY +
-- tenant_isolation. The owner is NOT exempt under FORCE (fail-closed: an unscoped query returns zero
-- rows). NONE of them is global — there is no sickbay reference data in 0056, so nothing here gets the
-- bare-ENABLE treatment. Owner decision D8: every sickbay table stays PARENT-DENIED in module 4.4 —
-- delivered by the catalog-driven parent_deny loop at the bottom, unchanged from 0055.
--
-- DDL ORDER (recall the 0033 FK-before-UNIQUE bug): enums → tables (each carrying its PK/UNIQUE
-- INLINE) → column ALTERs → FKs → indexes → RLS. Every FK target is created before the FK that
-- references it; in 0056 every FK is SINGLE-column to a PK shipped long ago:
--   • sickbay_bed / sickbay_schedule_slot / sickbay_settings (school_id) → ref_school PK   (0001)
--   • sickbay_settings (matron_user_id, assistant_matron_user_id)       → ref_user PK      (0001)
-- ⚠ `sickbay_bed_tenant_uk UNIQUE(school_id, id)` is authored HERE, in 0056, although NOTHING
-- references it yet: it is the composite-FK target sickbay_admission.bed_id needs in 0057. Creating
-- the UNIQUE one migration AHEAD of the FK is precisely the discipline the 0033 bug taught.
--
-- CONSTRAINT notes (Kofi rulings 2026-07-21):
--   • R2 — sickbay_settings is a per-school SINGLETON: `school_id` NOT NULL **UNIQUE** (the
--     boarding_settings idiom), the upsert conflict target. NO child carries a sickbay_id (it would
--     duplicate school_id and add a 2nd composite FK to every table).
--   • R25 — mode DEFAULTs to REFERRAL_ONLY and a MISSING row coalesces to REFERRAL_ONLY +
--     configured:false. `configured_at` distinguishes "declared" from "never configured"; it is NOT
--     a freeze (R6: mode changes are lossless and reversible, no frozen_at).
--   • R20/R21 — both matron pointers are single-column SET NULL FKs → the GLOBAL ref_user (the
--     houses.hm_user_id idiom; global-table + SET NULL both keep an FK single-column). Senior vs
--     Assistant Matron is the SAME MATRON role, distinguished only by which pointer holds them — no
--     seniority column, no sickbay_staff table, no new role. The visiting doctor is NOT a system user:
--     name + affiliation text only, no ref_user, no role_assignment, no invite.
--   • R7/R8/R9/R10 — sickbay_bed is its OWN table, never boarding_bunk (a bunk is House-scoped, and a
--     patient holds her dorm bunk AND a sickbay bed at once). `bed_number` is STABLE FOR LIFE:
--     UNIQUE(school_id, bed_number), retirement is active=false, never a DELETE, never a renumber.
--     `is_isolation` splits two pools that never merge. Counts DERIVE from rows — no capacity_beds /
--     isolation_beds scalars (a stored count that can disagree with its rows is the failure mode).
--   • R13/R14/R15/R16 — sickbay_schedule_slot holds the rounds/hours relationally, so there is NO
--     operating_hours_json and NO visiting_doctor_schedule_json. `starts_at`/`ends_at` are "HH:MM"
--     text and **ends_at MAY be EARLIER than starts_at** — the ON_CALL window is 22:00→06:00 and wraps
--     midnight, so there is DELIBERATELY NO CHECK ordering them (such a CHECK would reject the one
--     slot the module most needs). `days_of_week` is a jsonb ISO 1..7 array + runs_on_holidays
--     (boarding_day_type cannot express "Thursdays" or "Every day · 365"). `staffing` is FREE TEXT,
--     not an FK. The partial UNIQUE index enforces EXACTLY ONE anchored slot per school; the rest of
--     the anchor rules (kind = MEDICATION_ROUND, not deletable/re-kindable, must start no later than
--     every other medication round) are app-layer.
--   • R22 — staff_profile gains a SECOND licence pair (nmc_*) beside the shipped ntc_* rather than a
--     generalised licence_body triple: a teacher-turned-matron holds BOTH licences and one triple
--     cannot hold two.
--   • R23 — the health-prefect roster is a DERIVED read of boarding_bunk.prefect_role='SICKBAY'. There
--     is deliberately NO school_health_prefect_student_ids JSONB: a JSONB id array is un-FK-able, so it
--     could not carry the composite (school_id, id) tenant FK — a foreign school's student id could be
--     written in with nothing to stop it. A tenant-isolation hole for a display list.
--   • NO TRIGGERS (portability): mode capabilities, the anchor-ordering rule, the "both matrons hold
--     MATRON in this school" check and the capacity target-reconcile all live in lib/ server actions.

-- ---- enums needed by the new tables ----
DO $$ BEGIN
  CREATE TYPE "public"."sickbay_mode" AS ENUM('FULL', 'FIRST_AID', 'REFERRAL_ONLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."sickbay_slot_kind" AS ENUM('MEDICATION_ROUND', 'CLINIC', 'DOCTOR_VISIT', 'ON_CALL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- table 1: sickbay_settings (TENANT, per-school SINGLETON — inline UNIQUE(school_id), no tenant UK) ----
CREATE TABLE IF NOT EXISTS "sickbay_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "mode" "sickbay_mode" DEFAULT 'REFERRAL_ONLY' NOT NULL,
  "matron_user_id" uuid,
  "assistant_matron_user_id" uuid,
  "visiting_doctor_name" text,
  "visiting_doctor_affiliation" text,
  "configured_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sickbay_settings_school_id_unique" UNIQUE("school_id")
);

-- ---- table 2: sickbay_bed (TENANT — inline natural key + the FORWARD-DECLARED tenant UK for 0057) ----
CREATE TABLE IF NOT EXISTS "sickbay_bed" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "bed_number" smallint NOT NULL,
  "is_isolation" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_sickbay_bed_number" UNIQUE("school_id","bed_number"),
  CONSTRAINT "sickbay_bed_tenant_uk" UNIQUE("school_id","id")
);

-- ---- table 3: sickbay_schedule_slot (TENANT — inline tenant UK; NO CHECK on starts_at/ends_at) ----
CREATE TABLE IF NOT EXISTS "sickbay_schedule_slot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "kind" "sickbay_slot_kind" NOT NULL,
  "label" text NOT NULL,
  "description" text,
  "starts_at" text NOT NULL,
  "ends_at" text NOT NULL,
  "staffing" text,
  "days_of_week" jsonb NOT NULL,
  "runs_on_holidays" boolean DEFAULT false NOT NULL,
  "is_anchor" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sickbay_schedule_slot_tenant_uk" UNIQUE("school_id","id")
);

-- ---- staff_profile: the N&MC licence pair (R22) ----
ALTER TABLE "staff_profile" ADD COLUMN IF NOT EXISTS "nmc_licence_number" text;
ALTER TABLE "staff_profile" ADD COLUMN IF NOT EXISTS "nmc_licence_expiry" date;

-- ---- foreign keys (every target is a PK shipped in 0001; all three CREATE TABLEs above are done) ----
DO $$ BEGIN
  ALTER TABLE "sickbay_bed" ADD CONSTRAINT "sickbay_bed_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_schedule_slot" ADD CONSTRAINT "sickbay_schedule_slot_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_settings" ADD CONSTRAINT "sickbay_settings_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_settings" ADD CONSTRAINT "sickbay_settings_matron_user_id_ref_user_id_fk"
    FOREIGN KEY ("matron_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_settings" ADD CONSTRAINT "sickbay_settings_assistant_matron_user_id_ref_user_id_fk"
    FOREIGN KEY ("assistant_matron_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
-- EXACTLY ONE anchored slot per school (R16) — PARTIAL UNIQUE; the many non-anchor rows are exempt via
-- the WHERE. No other index is needed: uniq_sickbay_bed_number and both tenant UKs lead with school_id,
-- so they already serve the "everything for this school" reads.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_sickbay_anchor_slot"
  ON "sickbay_schedule_slot" USING btree ("school_id") WHERE "is_anchor";

-- ---- RLS — all THREE tables: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (these three names are
-- added to that hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that
-- forgets to set app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'sickbay_settings',
    'sickbay_bed',
    'sickbay_schedule_slot'
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

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0055 ----
-- Owner decision D8: a parent NEVER sees sickbay in module 4.4, so all three tables must be denied.
-- This loop is NOT a hand-list: it applies parent_deny to every FORCE-RLS + school_id table that lacks
-- a parent_scope policy — which, after the block above, is exactly the three new sickbay tables plus
-- the ones already covered (it re-creates their identical policy, hence idempotent). It is re-run here
-- rather than hand-listing the three because that is what keeps a future sickbay table auto-denied.
-- RESTRICTIVE is load-bearing: Postgres OR's PERMISSIVE policies, so a permissive parent policy would
-- OR with tenant_isolation and hand a claimed parent the entire school.
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
