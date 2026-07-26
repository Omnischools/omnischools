-- Omnischools — PROD paste 0064: PARENT-SICKBAY SCOPE (SHS module 4.4 / INCR-29). POLICY-ONLY — ZERO
-- new tables, ZERO enums, ZERO altered columns, ZERO backfills. It adds a narrow `parent_scope` policy
-- to EXACTLY TWO existing tables (sickbay_admission, sickbay_referral) and re-runs the catalog-driven
-- parent_deny loop. Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD
-- after merging. Byte-identical in effect to the INCR-29 block in db/sql/policies.sql (dev, db:policies).
--
-- 🔴 WHY THIS IS THE MODULE'S MOST SENSITIVE PASTE. This is the FIRST widening of the INCR-19a parent
-- boundary since it shipped (9 → 11 parent_scope tables). Before it, owner decision D8 kept a parent out
-- of sickbay entirely; INCR-29 (owner-authorised, reverses D8) opens ROW access to a parent's OWN child's
-- admission + referral rows so the read-only parent portal can show on-site / referred-out status.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN — FAIL-CLOSED, NEVER A LEAK. db:policies configures LOCAL DEV ONLY.
-- Without this paste, sickbay_admission + sickbay_referral keep their existing parent_deny on prod, so a
-- parent session (app.current_parent_user set) reads ZERO rows from both → the parent Sickbay tab is an
-- honest empty state, never a cross-tenant or cross-child leak. The cost of skipping is a blank tab, not
-- exposure. Run it to actually ship the feature.
--
-- 🔴 CLASS-4 ADJACENCY — READ THIS (Sarah's hardest gate). RLS is ROW-level and CANNOT mask columns.
-- Once parent_scope opens the row, an in-scope parent session CAN select sickbay_referral.menses_note
-- (Class-4 reproductive PII, F5) AND the frozen ER-handoff snapshot (reason_referred_out / handoff_labs
-- / last_meal / travel_note) off the reachable row. The ONLY guard against those columns reaching the
-- wire is the reader's frozen key-set projection (R229) in lib/parent/parent-sickbay-data.ts (MEDIUM-3).
-- A view that kept the base tables parent_deny (Option 3) does NOT solve this: it is non-functional here
-- (FORCE RLS + a single shared non-superuser app role + no BYPASSRLS) — it returns 0 rows to a parent on
-- prod, or, if the base tables are opened to make it work, the columns are reachable anyway. Column
-- control lives in the app reader by construction, not in the DB.
--
-- SCOPE — EXACTLY TWO TABLES CHANGE. Only sickbay_admission and sickbay_referral gain parent_scope
-- (their old parent_deny is dropped). EVERY OTHER sickbay table is UNAFFECTED: the catalog parent_deny
-- loop at the bottom re-affirms parent_deny on sickbay_visit, sickbay_vital_reading, sickbay_doctor_consult,
-- sickbay_chronic_entry/_med/_grant/_read, sickbay_med_admin, sickbay_standing_order, sickbay_stock_item,
-- sickbay_controlled_movement, sickbay_hospital, student_nhis_card, sickbay_referral_update,
-- sickbay_referral_cost_line and sickbay_notification (it auto-EXCLUDES the two tables that now carry
-- parent_scope, exactly as it excludes the 9 shipped ones). Tenant isolation is untouched on every table.
--
-- Verify afterwards:
--   -- exactly these two sickbay tables carry parent_scope, every other carries parent_deny:
--   select c.relname, p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname like 'sickbay_%' or c.relname = 'student_nhis_card' order by 1, 2;
--   -- and db/sql/verify-prod-rls.sql: Query 1 must return ZERO ROWS; tenant_tables unchanged;
--   -- parent_scope tables up by 2 (11) and parent_denied down by 2.

-- ---- layer 2: the two new parent_scope policies (byte-identical to db/sql/policies.sql INCR-29 block) ----
-- Shape mirrors the 9 shipped 19a policies (student_id IN parent_student_ids(school_id, <parent GUC>)).
-- Both tables carry student_id directly (sickbay_admission.student_id is the denormalised open-admission
-- key; sickbay_referral.student_id is the composite-FK column), so this is the simplest scope form.
-- OPEN-STATE is the reader's filter (R230), NOT RLS: a parent's own child's CLOSED admission and
-- RETURNED/VOIDED referral rows ARE returned by RLS (it scopes by child); the loader narrows to open.

-- sickbay_admission — the parent reads their own child's admission rows (open + closed alike).
DROP POLICY IF EXISTS parent_deny ON sickbay_admission;
DROP POLICY IF EXISTS parent_scope ON sickbay_admission;
CREATE POLICY parent_scope ON sickbay_admission AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR student_id IN (
      SELECT parent_student_ids(
        school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
    )
  );

-- sickbay_referral — same shape. ⚠ carries the Class-4 menses_note + the ER-handoff snapshot; the row
-- (all columns) is reachable to an in-scope parent — the reader projection is the only column guard.
DROP POLICY IF EXISTS parent_deny ON sickbay_referral;
DROP POLICY IF EXISTS parent_scope ON sickbay_referral;
CREATE POLICY parent_scope ON sickbay_referral AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR student_id IN (
      SELECT parent_student_ids(
        school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
    )
  );

-- ---- layer 1: parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql ----
-- 🔴 RUN THIS. It is NOT a hand-list: it applies parent_deny to every FORCE-RLS + school_id table that
-- does NOT already carry a parent_scope policy — which, after the block above, is every tenant table
-- EXCEPT the 11 parent-readable ones (the 9 shipped + the 2 added here). It re-creates identical
-- policies on the already-covered tables (hence idempotent) and, crucially, KEEPS the two INCR-29 tables
-- EXCLUDED (they now carry parent_scope) while re-affirming parent_deny on every other sickbay table. It
-- is what keeps a FUTURE tenant table auto-denied with zero code change.
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
