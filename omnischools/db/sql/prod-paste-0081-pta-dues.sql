-- Omnischools — PROD paste 0081: PTA dues bridge (SHS module 4.7 / INCR-54a). ONE new tenant table
-- (pta_dues_charge) + its RLS, PLUS two ADDITIVE composite-FK-target UNIQUEs on the PRE-EXISTING
-- invoice_line_item and household tables. NO enum, NO altered columns, NO backfills, NO seed, NO
-- global-table changes, NO trigger. Idempotent — safe to run more than once. Paste into the Supabase SQL
-- editor on PROD after merging.
--
-- ⚠ NUMBERING (read this once). The DRIZZLE migration is db/migrations/0078_gifted_clint_barton.sql — the
-- drizzle chain was at 0077 (the PTA minutes record, 0077_tan_shinobi_shaw), so generate produced 0078. The
-- prod-paste SEQUENCE, however, already reached 0080 (prod-paste-0080-pta-minutes.sql — the two sequences
-- have diverged since INCR-29). So this DDL's prod-paste is 0081 while its migration is 0078; that divergence
-- is expected. The SQL below is byte-identical in EFFECT (same table + the two target UNIQUEs + constraints +
-- indexes + policies) to migration 0078 followed by db:policies for pta_dues_charge — a from-migrations
-- rebuild and this paste produce an identical catalog.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. If migration 0078 ships to prod
-- without this paste, pta_dues_charge exists there with NO row-level security at all: no ENABLE, no FORCE, no
-- tenant_isolation, no parent_deny. Every school's PTA dues ledger — which PTA levied each charge, the billed
-- student / representative sibling, the household, and the snapshotted rate — becomes readable AND writable
-- from every other school's session, and a claimed parent session reads it too. FAIL-CLOSED gate: run this
-- file on PROD as part of the INCR-54a deploy, THEN verify with db/sql/verify-prod-rls.sql — Query 1 must
-- return ZERO ROWS and Query 2's tenant_tables + fully_forced + with_tenant_isolation + parent_denied must
-- each have risen by exactly 1 (parent_readable UNCHANGED — dues have no parent path in THIS increment; the
-- own-family own-dues parent read is INCR-55, R470).
--
-- OWNER-LOCKED (R470/R471): a parent reads NOTHING of dues here. There is NO parent_scope on pta_dues_charge;
-- the catalog-driven parent_deny loop at the bottom covers it structurally (FORCE-RLS + school_id, no
-- parent_scope), exactly as it auto-denies every other non-parent-readable tenant table. The INCR-55 parent
-- own-dues read scopes the BRIDGE (own family) + reads amount/status from rate_snapshot — NEVER a blanket
-- parent_scope on the `invoice` table (which is row-level and would leak TUITION). OPERATIONAL / SHOWN — NO
-- confidential/REDACTED layer, NO new GUC, NO trigger. Forward-only rate, idempotent generation, the "PTA
-- dues" fee_category upsert, and the R472 tuition-skip guard all live in app code (lib/pta/ + lib/actions/
-- billing.ts) — there is deliberately NO trigger and NO cross-table CHECK.
--
-- DDL ORDER — the composite-FK TARGET-BEFORE-FK discipline (the 0033 ordering hazard). pta_dues_charge's
-- composite (school_id, line_item_id) and (school_id, household_id) FKs target UNIQUE(school_id, id) on
-- invoice_line_item and household — tables that did NOT previously carry one. So those two ADD UNIQUEs run
-- FIRST (guarded), THEN the CREATE TABLE, THEN every FK in a guarded block, so each target UNIQUE exists
-- before its FK and a re-run is a clean no-op. (school_id, id) is trivially unique because id is the PK on
-- both, so the ADD never fails on existing rows. The pta / period / student FK targets are PRE-EXISTING
-- tenant UKs (ptas_tenant_uk, academic_period_tenant_uk, students_tenant_uk). pta_dues_charge is LEAF
-- (nothing FKs it) -> NO tenant UK.
--
-- CONSTRAINT notes (Kofi R460/R462/R463):
--   • uniq_pta_dues_charge_line_item UNIQUE(school_id, line_item_id) = the 1:1 with the dues line item AND
--     what lets R472's tuition-skip guard identify a dues line item cheaply.
--   • tier_type / basis / cadence are TEXT + CHECK (denormalised snapshots; the fixed app-owned domain idiom,
--     NOT enums). All three columns NOT NULL, so each CHECK is total.
--   • rate_snapshot numeric(12,2) NOT NULL — the forward-only rate snapshot (R463): the report's Expected
--     figure and the INCR-55 parent own-dues amount source.
--   • THE THREE PARTIAL-UNIQUE IDEMPOTENCY INDEXES (R462 — the generation crux; re-Generate = 0 new rows):
--       uniq_pta_dues_per_student        UNIQUE(school_id,pta_id,academic_period_id,subject_student_id)
--                                          WHERE basis='PER_STUDENT'
--       uniq_pta_dues_per_family         UNIQUE(school_id,pta_id,academic_year,household_id)
--                                          WHERE basis='PER_FAMILY' AND household_id IS NOT NULL
--       uniq_pta_dues_per_family_of_one  UNIQUE(school_id,pta_id,academic_year,subject_student_id)
--                                          WHERE basis='PER_FAMILY' AND household_id IS NULL  (family-of-one)
--     Split by basis (and by household_id NULL/NOT NULL) so the many NULLs of the inapplicable case never
--     collide and each case dedups on its own key.

-- ---- target UNIQUEs on the pre-existing tables (guarded; MUST precede the pta_dues_charge FKs) ----
-- household composite tenant UK — the (school_id, household_id) FK target. Additive; (school_id, id) is
-- trivially unique (id is the PK), so this never fails on existing rows.
DO $$ BEGIN
  ALTER TABLE "household" ADD CONSTRAINT "household_tenant_uk" UNIQUE("school_id","id");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;
-- invoice_line_item composite tenant UK — the (school_id, line_item_id) FK target. Additive; trivially unique.
DO $$ BEGIN
  ALTER TABLE "invoice_line_item" ADD CONSTRAINT "invoice_line_item_tenant_uk" UNIQUE("school_id","id");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

-- ---- table: pta_dues_charge (TENANT — 1:1 the dues line item; LEAF, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "pta_dues_charge" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "line_item_id" uuid NOT NULL,
  "pta_id" uuid NOT NULL,
  "tier_type" text NOT NULL,
  "academic_year" text NOT NULL,
  "academic_period_id" uuid,
  "basis" text NOT NULL,
  "cadence" text NOT NULL,
  "subject_student_id" uuid NOT NULL,
  "household_id" uuid,
  "rate_snapshot" numeric(12, 2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_pta_dues_charge_line_item" UNIQUE("school_id","line_item_id"),
  CONSTRAINT "pta_dues_charge_tier_type_valid" CHECK ("pta_dues_charge"."tier_type" IN ('FORM', 'HOUSE', 'GENERAL', 'EMERGENCY')),
  CONSTRAINT "pta_dues_charge_basis_valid" CHECK ("pta_dues_charge"."basis" IN ('PER_STUDENT', 'PER_FAMILY')),
  CONSTRAINT "pta_dues_charge_cadence_valid" CHECK ("pta_dues_charge"."cadence" IN ('PER_TERM', 'PER_YEAR', 'ONE_OFF'))
);

-- ---- foreign keys (guarded so a re-run is a no-op; the target UNIQUEs above already exist) ----
-- pta_dues_charge.school_id -> ref_school PK, single-column CASCADE.
DO $$ BEGIN
  ALTER TABLE "pta_dues_charge" ADD CONSTRAINT "pta_dues_charge_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_dues_charge composite (school_id, line_item_id) -> invoice_line_item (school_id, id) tenant UK, CASCADE
-- (the bridge must never outlive its line item, or R472's existence test misclassifies the dues invoice).
DO $$ BEGIN
  ALTER TABLE "pta_dues_charge" ADD CONSTRAINT "pta_dues_charge_school_id_line_item_id_invoice_line_item_school_id_id_fk"
    FOREIGN KEY ("school_id","line_item_id") REFERENCES "public"."invoice_line_item"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_dues_charge composite (school_id, pta_id) -> ptas (school_id, id) tenant UK, CASCADE.
DO $$ BEGIN
  ALTER TABLE "pta_dues_charge" ADD CONSTRAINT "pta_dues_charge_school_id_pta_id_ptas_school_id_id_fk"
    FOREIGN KEY ("school_id","pta_id") REFERENCES "public"."ptas"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_dues_charge composite (school_id, academic_period_id) -> academic_period (school_id, period_id) UK, CASCADE.
DO $$ BEGIN
  ALTER TABLE "pta_dues_charge" ADD CONSTRAINT "pta_dues_charge_school_id_academic_period_id_academic_period_school_id_period_id_fk"
    FOREIGN KEY ("school_id","academic_period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_dues_charge composite (school_id, subject_student_id) -> students (school_id, id) tenant UK, CASCADE.
DO $$ BEGIN
  ALTER TABLE "pta_dues_charge" ADD CONSTRAINT "pta_dues_charge_school_id_subject_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","subject_student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_dues_charge composite (school_id, household_id) -> household (school_id, id) tenant UK, CASCADE
-- (households are never app-deleted — only re-parented — so this only fires under the school cascade).
DO $$ BEGIN
  ALTER TABLE "pta_dues_charge" ADD CONSTRAINT "pta_dues_charge_school_id_household_id_household_school_id_id_fk"
    FOREIGN KEY ("school_id","household_id") REFERENCES "public"."household"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
-- R462 — the three PARTIAL-unique idempotency indexes (the generation crux).
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_pta_dues_per_student"
  ON "pta_dues_charge" USING btree ("school_id","pta_id","academic_period_id","subject_student_id")
  WHERE "pta_dues_charge"."basis" = 'PER_STUDENT';
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_pta_dues_per_family"
  ON "pta_dues_charge" USING btree ("school_id","pta_id","academic_year","household_id")
  WHERE "pta_dues_charge"."basis" = 'PER_FAMILY' AND "pta_dues_charge"."household_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_pta_dues_per_family_of_one"
  ON "pta_dues_charge" USING btree ("school_id","pta_id","academic_year","subject_student_id")
  WHERE "pta_dues_charge"."basis" = 'PER_FAMILY' AND "pta_dues_charge"."household_id" IS NULL;
-- The Treasurer report access path (R467/R469): school-wide + per-PTA-instance drill / own-PTA read.
CREATE INDEX IF NOT EXISTS "pta_dues_charge_pta_idx"
  ON "pta_dues_charge" USING btree ("school_id","pta_id");

-- ---- RLS — pta_dues_charge: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (pta_dues_charge is added to
-- that hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that forgets to set
-- app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'pta_dues_charge'
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

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0080 ----
-- Owner-locked (R470/R471): a parent reads NOTHING of dues in this increment, so pta_dues_charge must be
-- denied. This loop is NOT a hand-list: it applies parent_deny to every FORCE-RLS + school_id table that
-- lacks a parent_scope policy — which, after the block above, is the new pta_dues_charge plus every
-- already-covered one (it re-creates their identical policy, hence idempotent). It is re-run here rather than
-- hand-listing, so a FUTURE PTA table stays auto-denied. RESTRICTIVE is load-bearing: Postgres OR's
-- PERMISSIVE policies, so a permissive parent policy would OR with tenant_isolation and hand a claimed parent
-- the entire school. (The INCR-55 own-family own-dues read is a dedicated withParentScope reader scoped on
-- THIS bridge — added THERE, not a widening of this deny.)
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
