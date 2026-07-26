-- Omnischools — PROD paste 0065: PARENT-NHIS SCOPE (SHS module 4.4 / INCR-32, owner decision D8).
-- POLICY-ONLY — ZERO new tables, ZERO enums, ZERO altered columns, ZERO backfills. It adds ONE narrow
-- `parent_scope` policy to EXACTLY ONE existing table (student_nhis_card) and re-runs the catalog-driven
-- parent_deny loop. Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD
-- after merging. Byte-identical in effect to the INCR-32 block in db/sql/policies.sql (dev, db:policies).
--
-- 🔴 THE THIRD WIDENING OF THE INCR-19a PARENT BOUNDARY (11 → 12 parent_scope tables). The first was
-- INCR-29 (prod-paste-0064: sickbay_admission + sickbay_referral, 9 → 11). This one (owner-authorised,
-- reverses D8's NHIS carve-out) opens ROW access to a parent's OWN child's NHIS-card row so the read-only
-- parent portal can show the card number + validity (Active / Expiring≤30d / Expired is derived in lib/).
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN — FAIL-CLOSED, NEVER A LEAK. db:policies configures LOCAL DEV ONLY.
-- Without this paste, student_nhis_card keeps its existing parent_deny on prod, so a parent session
-- (app.current_parent_user set) reads ZERO rows → the parent NHIS panel is an honest empty state, never a
-- cross-tenant or cross-child leak. The cost of skipping is a blank panel, not exposure. Run it to ship.
--
-- 🔴 COLUMN CONTROL LIVES IN THE APP READER (R229), NOT THE DB. RLS is ROW-level and CANNOT mask columns.
-- Once parent_scope opens the row, an in-scope parent session CAN select every column on the card
-- (card_number, holder_name, holder_kind, valid_from/valid_to, student_guardian_id). The card is the
-- intended parent view here, but per the module convention the reader's frozen key-set projection in
-- lib/parent/parent-sickbay-data.ts remains the SOLE column control — a view that kept the base table
-- parent_deny (Option 3) is non-functional under this repo's FORCE-RLS + single shared non-superuser app
-- role + no-BYPASSRLS model (it returns 0 rows to a parent on prod). Column control is in the reader by
-- construction, not in the DB.
--
-- SCOPE — EXACTLY ONE TABLE CHANGES. Only student_nhis_card gains parent_scope (its old parent_deny is
-- dropped). EVERY OTHER sickbay table is UNAFFECTED: the catalog parent_deny loop at the bottom re-affirms
-- parent_deny on sickbay_visit, sickbay_vital_reading, sickbay_doctor_consult, sickbay_chronic_entry/_med/
-- _grant/_read, sickbay_med_admin, sickbay_standing_order, sickbay_stock_item, sickbay_controlled_movement,
-- sickbay_hospital, sickbay_referral_update, sickbay_referral_cost_line and sickbay_notification (it
-- auto-EXCLUDES the three tables that now carry parent_scope — sickbay_admission, sickbay_referral and
-- student_nhis_card — exactly as it excludes the 9 shipped 19a tables). Tenant isolation is untouched on
-- every table (student_nhis_card keeps ENABLE+FORCE RLS + its tenant_isolation policy).
--
-- Verify afterwards:
--   -- exactly these three sickbay tables carry parent_scope, every other carries parent_deny:
--   select c.relname, p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname like 'sickbay_%' or c.relname = 'student_nhis_card' order by 1, 2;
--   -- and db/sql/verify-prod-rls.sql: Query 1 must return ZERO ROWS; tenant_tables unchanged;
--   -- parent_scope tables up by 1 (12) and parent_denied down by 1.

-- ---- layer 2: the new parent_scope policy (byte-identical to db/sql/policies.sql INCR-32 block) ----
-- Shape mirrors the 11 shipped parent_scope policies (student_id IN parent_student_ids(school_id, <parent
-- GUC>)). student_nhis_card carries student_id DIRECTLY (the beneficiary-singleton key, composite
-- (school_id, student_id) FK to students), so this is the simplest scope form.

-- student_nhis_card — the parent reads their own child's ONE NHIS-card row (the beneficiary singleton).
DROP POLICY IF EXISTS parent_deny ON student_nhis_card;
DROP POLICY IF EXISTS parent_scope ON student_nhis_card;
CREATE POLICY parent_scope ON student_nhis_card AS RESTRICTIVE FOR ALL TO public
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
-- EXCEPT the 12 parent-readable ones (the 9 shipped + the 2 from INCR-29 + student_nhis_card here). It
-- re-creates identical policies on the already-covered tables (hence idempotent) and, crucially, KEEPS
-- student_nhis_card EXCLUDED (it now carries parent_scope) while re-affirming parent_deny on every other
-- sickbay table — explicitly including sickbay_notification and sickbay_referral_cost_line. It is what
-- keeps a FUTURE tenant table auto-denied with zero code change.
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
