-- Omnischools — PROD hand-paste 0088: GOV-10 SEN register (sen_register + sen_module_adoption).
--
-- ⚠ RLS IS NOT AUTO-APPLIED ON PROD. `db:policies` only configures LOCAL DEV. This file is the hand-paste
-- that gives the TWO NEW tenant tables `sen_register` and `sen_module_adoption` their tenant isolation on
-- PROD. Without it these tables have NO boundary and one school's CONFIDENTIAL SEN register (a child's
-- disability category, diagnosis cluster and accommodations) is readable from EVERY other school's session.
-- Paste this into the Supabase SQL editor on the PROD project AFTER migration 0082 has created the tables.
--
-- Idempotent + fail-closed: guarded so a missing table ABORTS (does not silently no-op), the FORCE + policy
-- are safe to re-run, and each CREATE POLICY is DROP-then-CREATE. The tables themselves are created by
-- migration 0082_great_richard_fisk.sql — this file only applies RLS; run it after the migration, never
-- before.
--
-- Both are plain tenant tables (management-facing, NOT parent-facing): ENABLE + FORCE RLS + the standard
-- PERMISSIVE tenant_isolation policy keyed on app.current_school, byte-identical to every other tenant table.
-- sen_register is CONFIDENTIAL, but that is handled ENTIRELY at the app layer (sen_-prefix audit-redaction,
-- the sole-content-path reader gate) — RLS-wise it is an ordinary tenant table, identical to census_return
-- (GOV-8) / facilities_snapshot (GOV-7). Neither table carries parent_scope, so the catalog-driven
-- RESTRICTIVE parent_deny loop (already on prod via prod-paste-0055; it discovers every FORCE-RLS + school_id
-- table lacking a parent_scope) auto-denies BOTH to any claimed-parent session with ZERO further edits here.
--
-- verify-prod-rls.sql (QUERY 2) DELTAS after this paste, relative to the prior state (BOTH tables, so +2 each):
--   tenant_tables         +2   (sen_register + sen_module_adoption are real public tables with a school_id column)
--   fully_forced          +2   (ENABLE + FORCE on both below)
--   with_tenant_isolation +2   (the tenant_isolation policy on both below)
--   parent_denied         +2   (auto-covered by the parent_deny catalog loop — FORCE-RLS + school_id + no parent_scope)
--   parent_readable       unchanged   (NO parent_scope on either table)
--   global_ok             unchanged
-- QUERY 1 (the problem report) must still return ZERO ROWS after the paste.

-- Fail-closed guard: BOTH tables must exist (created by migration 0082) before RLS can be applied.
DO $$
BEGIN
  IF to_regclass('public.sen_register') IS NULL THEN
    RAISE EXCEPTION 'sen_register does not exist — run migration 0082 BEFORE this RLS paste';
  END IF;
  IF to_regclass('public.sen_module_adoption') IS NULL THEN
    RAISE EXCEPTION 'sen_module_adoption does not exist — run migration 0082 BEFORE this RLS paste';
  END IF;
END
$$;

-- ---- sen_register (CONFIDENTIAL SEN record; confidential handling is app-layer, RLS is standard tenant) ----
ALTER TABLE "sen_register" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sen_register" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "sen_register";
CREATE POLICY tenant_isolation ON "sen_register"
  FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

-- Re-affirm the CATALOG-DRIVEN parent boundary for THIS table (defense-in-depth; the full loop in
-- prod-paste-0055 already covers it, but pasting this idempotent block makes the parent_deny explicit for
-- 0088 and safe to run standalone). RESTRICTIVE so it ANDs with (tightens) the permissive tenant_isolation;
-- a parent session (app.current_parent_user set) → USING FALSE → ZERO rows. A staff/bypass session (GUC
-- unset) → USING TRUE → total no-op.
DROP POLICY IF EXISTS parent_deny ON "sen_register";
CREATE POLICY parent_deny ON "sen_register" AS RESTRICTIVE FOR ALL TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);

-- ---- sen_module_adoption (R413 adoption marker; config flag, NOT confidential, but still a tenant table) ----
ALTER TABLE "sen_module_adoption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sen_module_adoption" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "sen_module_adoption";
CREATE POLICY tenant_isolation ON "sen_module_adoption"
  FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

DROP POLICY IF EXISTS parent_deny ON "sen_module_adoption";
CREATE POLICY parent_deny ON "sen_module_adoption" AS RESTRICTIVE FOR ALL TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
