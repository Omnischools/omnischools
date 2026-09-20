-- Omnischools — migration 0060: SICKBAY MEDICATION LAYER (SHS module 4.4 / INCR-24). THREE new enums
-- + FOUR new tenant tables + ONE ADD-UNIQUE on the 0057 sickbay_doctor_consult leaf + one carried
-- index on the 0057 sickbay_admission table (obligation e). All four new tables are STANDARD tenant
-- tables: ENABLE + FORCE RLS + tenant_isolation + the catalog-driven parent_deny — and, unlike 0058,
-- NO staff_grant_scope family (R166: the MAR is the ACUTE/round clinical graph, gated app-layer like
-- the visit, not the chronic register's per-entry grant boundary). Idempotent — safe to run more than
-- once. Paste into the Supabase SQL editor on PROD after merging.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. Without this paste the
-- four tables exist on prod with **NO row-level security at all**: no ENABLE, no FORCE, no
-- tenant_isolation, no parent_deny. sickbay_med_admin is the Medication Administration Record — WHO
-- was given WHICH drug (a controlled substance among them), at what dose, by which nurse, witnessed by
-- whom, plus the amendment trail — the single most sensitive operational log in the module after the
-- chronic register. Without the paste every school's MAR, standing orders, controlled-stock ledger and
-- per-drug stock are readable **and writable** from every other school's session. Run it at deploy.
--
-- SCOPE: NEW-TABLE-ONLY plus TWO adds on existing 0057 tables — no data changes, no backfills, no
-- seed, no GLOBAL-table changes. It is the DB foundation for BOTH 24a and 24b (R166 — one migration,
-- one prod paste): 24a ships the spine/config (standing orders, stock, controlled register,
-- assertSchoolClinician) and 24b the clinical MAR (append-only write + witness gate + derived rounds);
-- the app work is Claude Code's, this file is the schema + RLS.
--
-- OWNER DECISIONS baked in: O4 → the MAR + controlled ledger fall under the D5.1 7-year-post-exit
-- retention setting; NO purge machinery is built at 24 and the UI must not claim one. ⚠ The source
-- pointers (chronic_med / standing_order / consult) and the slot are ON DELETE **RESTRICT**, so a
-- student with a controlled-administration history CANNOT be hard-erased within the window
-- (regulatorily correct for a controlled-drug record; owner acknowledged). O2 → the MAR is Matron +
-- Headmaster only (like the visit); a chronic grant reaches the care PLAN, never this admin log — which
-- is exactly why there is NO staff_grant_scope here.
--
-- 🔴 DDL ORDER — THE 0033 HAZARD, INSIDE ONE MIGRATION (as 0057/0058). Three composite-FK targets are
-- authored INLINE in CREATE TABLE (`sickbay_med_admin_tenant_uk` — the MAR's OWN self-FK target for the
-- append-only amendment chain; `sickbay_standing_order_tenant_uk`; `sickbay_stock_item_tenant_uk`), and
-- ONE is an ADD-UNIQUE on the pre-existing 0057 leaf (`sickbay_doctor_consult_tenant_uk`, the MAR's
-- consult_id target). That ADD-UNIQUE is emitted **before the FK section** below, because the MAR's
-- consult FK consumes it — drizzle-kit runs a migration's statements in ONE transaction and SWALLOWS the
-- error, so a UNIQUE emitted after the FK it feeds fails silently (rollback, exit 1, no message). Every
-- composite-FK target therefore exists before the FK that references it:
--   • sickbay_med_admin_tenant_uk / _standing_order_tenant_uk / _stock_item_tenant_uk — INLINE in CREATE TABLE.
--   • sickbay_doctor_consult_tenant_uk — ADDED below, ahead of the whole FK section.
--   • sickbay_chronic_med_tenant_uk (0058), sickbay_schedule_slot_tenant_uk (0056),
--     sickbay_visit_tenant_uk (0057), students_tenant_uk (0033), ref_school/ref_user PK (0001) — all shipped.
--
-- ⚠ Constraint NAMES are the drizzle-generated ones, so this paste and `drizzle-kit migrate` produce a
-- byte-identical catalog. Postgres truncates identifiers at 63 chars — the long composite FK names below
-- are written PRE-truncation exactly as drizzle emits them; Postgres truncates them identically on both
-- paths (a NOTICE, not an error) and the truncations stay distinct.
--
-- NO TRIGGERS (portability). The witness IDENTITY (a real in-school ref_user with an N&MC licence),
-- the "controlled WASTAGE requires a witness" rule (it depends on sickbay_stock_item.is_controlled, a
-- cross-table fact), the derived due-list / overdue / controlled-balance reads, and the append-only
-- posture all live in lib/sickbay/ (assertSchoolClinician). The four rules that ARE in the DB are
-- single-row CHECKs on sickbay_med_admin (R143/R144/R154/R157) — none is a cross-table trigger.
--
-- Verify afterwards with db/sql/verify-prod-rls.sql — Query 1 must return ZERO ROWS and Query 2's
-- tenant_tables must have risen by exactly 4 (with parent_denied up 4). Then confirm no staff_grant
-- family leaked onto these four (they are STANDARD tenant tables):
--   select c.relname, p.polname, p.polpermissive
--   from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname in ('sickbay_med_admin','sickbay_standing_order','sickbay_stock_item','sickbay_controlled_movement')
--   order by 1, 2;   -- expect exactly 2 rows per table: tenant_isolation (permissive) + parent_deny (restrictive).

-- ---- enums needed by the new tables ----
DO $$ BEGIN
  CREATE TYPE "public"."sickbay_med_source" AS ENUM('CHRONIC', 'STANDING_ORDER', 'DOCTOR_ORDERED', 'AD_HOC');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."sickbay_med_status" AS ENUM('GIVEN', 'REFUSED', 'HELD', 'OMITTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."sickbay_stock_movement_type" AS ENUM('RECEIPT', 'WASTAGE', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- table 1: sickbay_controlled_movement (TENANT, LEAF, APPEND-ONLY — no tenant UK, no updated_at) ----
CREATE TABLE IF NOT EXISTS "sickbay_controlled_movement" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "stock_item_id" uuid NOT NULL,
  "movement_type" "sickbay_stock_movement_type" NOT NULL,
  "quantity" numeric NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "actor_user_id" uuid,
  "witness_user_id" uuid,
  "batch_ref" text,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ---- table 2: sickbay_med_admin (TENANT — the append-only MAR; its tenant UK is INLINE, the self-FK target) ----
CREATE TABLE IF NOT EXISTS "sickbay_med_admin" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "visit_id" uuid,
  "slot_id" uuid,
  "source" "sickbay_med_source" NOT NULL,
  "chronic_med_id" uuid,
  "standing_order_id" uuid,
  "consult_id" uuid,
  "drug_name" text NOT NULL,
  "dose_label" text NOT NULL,
  "route" text,
  "is_controlled" boolean DEFAULT false NOT NULL,
  "dispensed_qty" numeric,
  "status" "sickbay_med_status" NOT NULL,
  "administered_at" timestamp with time zone NOT NULL,
  "administered_by_user_id" uuid,
  "witness_user_id" uuid,
  "witness_override_reason" text,
  "notes" text,
  "corrects_admin_id" uuid,
  "amendment_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sickbay_med_admin_tenant_uk" UNIQUE("school_id","id"),
  -- R144 — a controlled dose must carry the dispensed quantity (the controlled-balance deduction).
  CONSTRAINT "med_admin_controlled_needs_qty" CHECK ("sickbay_med_admin"."is_controlled" = false OR "sickbay_med_admin"."dispensed_qty" IS NOT NULL),
  -- R154 — a controlled GIVEN administration reaches the table ONLY with a witness OR a recorded override.
  CONSTRAINT "med_admin_controlled_given_witness" CHECK (NOT ("sickbay_med_admin"."is_controlled" AND "sickbay_med_admin"."status" = 'GIVEN') OR "sickbay_med_admin"."witness_user_id" IS NOT NULL OR "sickbay_med_admin"."witness_override_reason" IS NOT NULL),
  -- R157 — self-witness is forbidden: a witness is a SECOND clinician.
  CONSTRAINT "med_admin_witness_not_self" CHECK ("sickbay_med_admin"."witness_user_id" IS NULL OR "sickbay_med_admin"."witness_user_id" <> "sickbay_med_admin"."administered_by_user_id"),
  -- R143 (OQ1 TIGHTENED) — each source PAIRED with its pointer: STANDING_ORDER requires standing_order_id
  -- (which protocol), DOCTOR_ORDERED requires consult_id (the surface hyperlink), each forbidding the
  -- other two; AD_HOC forbids all three. CHRONIC is the ONE named exception (R163): chronic_med_id is
  -- OPTIONAL (a patient's own surrendered bottle has no prescription row), but standing_order_id/consult_id
  -- are still forbidden.
  CONSTRAINT "med_admin_source_pointer_match" CHECK (("sickbay_med_admin"."source" = 'CHRONIC' AND "sickbay_med_admin"."standing_order_id" IS NULL AND "sickbay_med_admin"."consult_id" IS NULL)
       OR ("sickbay_med_admin"."source" = 'STANDING_ORDER' AND "sickbay_med_admin"."standing_order_id" IS NOT NULL AND "sickbay_med_admin"."chronic_med_id" IS NULL AND "sickbay_med_admin"."consult_id" IS NULL)
       OR ("sickbay_med_admin"."source" = 'DOCTOR_ORDERED' AND "sickbay_med_admin"."consult_id" IS NOT NULL AND "sickbay_med_admin"."chronic_med_id" IS NULL AND "sickbay_med_admin"."standing_order_id" IS NULL)
       OR ("sickbay_med_admin"."source" = 'AD_HOC' AND "sickbay_med_admin"."chronic_med_id" IS NULL AND "sickbay_med_admin"."standing_order_id" IS NULL AND "sickbay_med_admin"."consult_id" IS NULL))
);

-- ---- table 3: sickbay_standing_order (TENANT — the MAR's standing_order_id target; tenant UK INLINE) ----
CREATE TABLE IF NOT EXISTS "sickbay_standing_order" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "complaint" text NOT NULL,
  "treatment" text NOT NULL,
  "escalation" text,
  "ordered_by_doctor_name" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sickbay_standing_order_tenant_uk" UNIQUE("school_id","id")
);

-- ---- table 4: sickbay_stock_item (TENANT — per-drug, school-level, NEVER per-student; tenant UK INLINE) ----
CREATE TABLE IF NOT EXISTS "sickbay_stock_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "drug_name" text NOT NULL,
  "form_label" text,
  "unit" text,
  "qty_on_hand" numeric DEFAULT '0' NOT NULL,
  "reorder_point" numeric,
  "last_restocked_at" timestamp with time zone,
  "is_controlled" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sickbay_stock_item_tenant_uk" UNIQUE("school_id","id")
);

-- ---- ADD-UNIQUE on the existing 0057 leaf — MUST precede the MAR's consult FK (the 0033 hazard) ----
-- (school_id, id) is trivially unique already (id is the PK), so this constrains nothing new and
-- rejects no existing row; it exists only to be a composite-FK target for sickbay_med_admin.consult_id.
-- ⚠ Guard catches BOTH duplicate_object (the constraint) AND duplicate_table (its backing index shares
-- the constraint name — a UNIQUE re-add raises the latter, unlike an FK re-add), so a re-run is a no-op.
DO $$ BEGIN
  ALTER TABLE "sickbay_doctor_consult" ADD CONSTRAINT "sickbay_doctor_consult_tenant_uk" UNIQUE("school_id","id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- ---- foreign keys — ALL FOUR CREATE TABLEs and the consult UK above are complete, so every composite
-- target exists. Guarded so a re-run is a no-op. ----
DO $$ BEGIN
  ALTER TABLE "sickbay_controlled_movement" ADD CONSTRAINT "sickbay_controlled_movement_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_controlled_movement" ADD CONSTRAINT "sickbay_controlled_movement_actor_user_id_ref_user_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_controlled_movement" ADD CONSTRAINT "sickbay_controlled_movement_witness_user_id_ref_user_id_fk"
    FOREIGN KEY ("witness_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ⚠ consumes sickbay_stock_item_tenant_uk (INLINE above). RESTRICT — a stocked item with movement
-- history must not vanish.
DO $$ BEGIN
  ALTER TABLE "sickbay_controlled_movement" ADD CONSTRAINT "sickbay_controlled_movement_school_id_stock_item_id_sickbay_stock_item_school_id_id_fk"
    FOREIGN KEY ("school_id","stock_item_id") REFERENCES "public"."sickbay_stock_item"("school_id","id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Actor pointers — single-column SET NULL → the GLOBAL ref_user. The clinician role/NMC/tenancy guard
-- is app-layer (assertSchoolClinician); the DB cannot check it on a global pointer.
DO $$ BEGIN
  ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_administered_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("administered_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_witness_user_id_ref_user_id_fk"
    FOREIGN KEY ("witness_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Composite intra-tenant FKs. student/visit CASCADE; slot + the three source pointers + the self-FK RESTRICT.
-- ⚠ consumes students_tenant_uk (0033).
DO $$ BEGIN
  ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ⚠ consumes sickbay_visit_tenant_uk (0057).
DO $$ BEGIN
  ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_school_id_visit_id_sickbay_visit_school_id_id_fk"
    FOREIGN KEY ("school_id","visit_id") REFERENCES "public"."sickbay_visit"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ⚠ consumes sickbay_schedule_slot_tenant_uk (0056). RESTRICT — the round attributed to must not vanish.
DO $$ BEGIN
  ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_school_id_slot_id_sickbay_schedule_slot_school_id_id_fk"
    FOREIGN KEY ("school_id","slot_id") REFERENCES "public"."sickbay_schedule_slot"("school_id","id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ⚠ consumes sickbay_chronic_med_tenant_uk (0058). RESTRICT — a dispensed prescription must not vanish.
DO $$ BEGIN
  ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_school_id_chronic_med_id_sickbay_chronic_med_school_id_id_fk"
    FOREIGN KEY ("school_id","chronic_med_id") REFERENCES "public"."sickbay_chronic_med"("school_id","id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ⚠ consumes sickbay_standing_order_tenant_uk (INLINE above). RESTRICT.
DO $$ BEGIN
  ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_school_id_standing_order_id_sickbay_standing_order_school_id_id_fk"
    FOREIGN KEY ("school_id","standing_order_id") REFERENCES "public"."sickbay_standing_order"("school_id","id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ⚠ consumes sickbay_doctor_consult_tenant_uk (ADDED above, ahead of this FK — the 0033 hazard). RESTRICT.
DO $$ BEGIN
  ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_school_id_consult_id_sickbay_doctor_consult_school_id_id_fk"
    FOREIGN KEY ("school_id","consult_id") REFERENCES "public"."sickbay_doctor_consult"("school_id","id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- The append-only amendment chain — the SELF-FK. ⚠ consumes sickbay_med_admin_tenant_uk (INLINE above).
-- RESTRICT: a corrected row must not be deletable out from under its correction. Named explicitly
-- because drizzle's default self-FK name exceeds 63 chars.
DO $$ BEGIN
  ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_corrects_fk"
    FOREIGN KEY ("school_id","corrects_admin_id") REFERENCES "public"."sickbay_med_admin"("school_id","id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sickbay_standing_order" ADD CONSTRAINT "sickbay_standing_order_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_standing_order" ADD CONSTRAINT "sickbay_standing_order_created_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sickbay_stock_item" ADD CONSTRAINT "sickbay_stock_item_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes (new tables + the carried obligation-e index on the existing sickbay_admission) ----
-- The controlled balance derivation reads a stock item's movements in time order; this also serves the
-- RESTRICT check on every stock-item delete.
CREATE INDEX IF NOT EXISTS "sickbay_controlled_movement_item_idx"
  ON "sickbay_controlled_movement" USING btree ("school_id","stock_item_id","occurred_at");
-- R142 — a student's MAR in time order; a round's doses in time order (the derived "done" check); a
-- visit's doses.
CREATE INDEX IF NOT EXISTS "sickbay_med_admin_student_idx"
  ON "sickbay_med_admin" USING btree ("school_id","student_id","administered_at");
CREATE INDEX IF NOT EXISTS "sickbay_med_admin_slot_idx"
  ON "sickbay_med_admin" USING btree ("school_id","slot_id","administered_at");
CREATE INDEX IF NOT EXISTS "sickbay_med_admin_visit_idx"
  ON "sickbay_med_admin" USING btree ("school_id","visit_id");
-- ⚠ INCR-24 obligation (e) / R167e — on the EXISTING 0057 sickbay_admission. The index half of the
-- medicalHoldStudentIds() rewrite (Claude Code rewrites the non-sargable `::date` casts to half-open
-- timestamp ranges); this runs on every register save at every Senior school forever.
CREATE INDEX IF NOT EXISTS "sickbay_admission_student_admitted_idx"
  ON "sickbay_admission" USING btree ("school_id","student_id","admitted_at");

-- ---- RLS — all FOUR new tables: ENABLE + FORCE + tenant_isolation. STANDARD tenant tables, NO
-- staff_grant_scope (R166). Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql
-- (these four names are added to that hardcoded array in the same commit). FORCE means the owner is NOT
-- exempt: a query that forgets to set app.current_school returns ZERO rows. ----
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'sickbay_standing_order',
    'sickbay_stock_item',
    'sickbay_med_admin',
    'sickbay_controlled_movement'
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

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0058/0059 ----
-- Owner decision D8 keeps a claimed parent out of every tenant table except the small parent-readable
-- set. The loop is NOT a hand-list: it applies parent_deny to every FORCE-RLS + school_id table that
-- lacks a parent_scope policy — which, after the block above, includes the four new tables (it re-creates
-- the identical policy on the already-covered tables, hence idempotent). It is re-run here rather than
-- hand-listing the four because that is what keeps a FUTURE sickbay table auto-denied.
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
