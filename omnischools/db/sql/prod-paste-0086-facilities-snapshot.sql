-- Omnischools — PROD hand-paste 0086: GOV-7 facilities snapshot (facilities_snapshot).
--
-- ⚠ RLS IS NOT AUTO-APPLIED ON PROD. `db:policies` only configures LOCAL DEV. This file is the hand-paste
-- that gives the NEW tenant table `facilities_snapshot` its tenant isolation on PROD. Without it the table
-- has NO boundary and one school's facilities census is readable from every other school's session.
-- Paste this into the Supabase SQL editor on the PROD project AFTER migration 0080 has created the table.
--
-- Idempotent + fail-closed: guarded so a missing table ABORTS (does not silently no-op), the FORCE + policy
-- are safe to re-run, and the CREATE POLICY is DROP-then-CREATE. The table itself is created by migration
-- 0080_dizzy_the_hand.sql — this file only applies RLS; run it after the migration, never before.
--
-- This adds a plain tenant table (management-facing, NOT parent-facing): ENABLE + FORCE RLS + the standard
-- PERMISSIVE tenant_isolation policy keyed on app.current_school, byte-identical to every other tenant table.
-- It carries NO parent_scope, so the catalog-driven RESTRICTIVE parent_deny loop (already on prod via
-- prod-paste-0055; it discovers every FORCE-RLS + school_id table lacking a parent_scope) auto-denies it to
-- any claimed-parent session with ZERO further edits here.
--
-- verify-prod-rls.sql (QUERY 2) DELTAS after this paste, relative to the prior state:
--   tenant_tables         +1   (facilities_snapshot is a real public table with a school_id column)
--   fully_forced          +1   (ENABLE + FORCE below)
--   with_tenant_isolation +1   (the tenant_isolation policy below)
--   parent_denied         +1   (auto-covered by the parent_deny catalog loop — FORCE-RLS + school_id + no parent_scope)
--   parent_readable       unchanged   (NO parent_scope on this table)
--   global_ok             unchanged
-- QUERY 1 (the problem report) must still return ZERO ROWS after the paste.

-- Fail-closed guard: the table must exist (created by migration 0080) before RLS can be applied.
DO $$
BEGIN
  IF to_regclass('public.facilities_snapshot') IS NULL THEN
    RAISE EXCEPTION 'facilities_snapshot does not exist — run migration 0080 BEFORE this RLS paste';
  END IF;
END
$$;

ALTER TABLE "facilities_snapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "facilities_snapshot" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "facilities_snapshot";
CREATE POLICY tenant_isolation ON "facilities_snapshot"
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
-- 0086 and safe to run standalone). RESTRICTIVE so it ANDs with (tightens) the permissive tenant_isolation;
-- a parent session (app.current_parent_user set) → USING FALSE → ZERO rows. A staff/bypass session (GUC
-- unset) → USING TRUE → total no-op.
DROP POLICY IF EXISTS parent_deny ON "facilities_snapshot";
CREATE POLICY parent_deny ON "facilities_snapshot" AS RESTRICTIVE FOR ALL TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
