-- Omnischools — PROD paste 0093: PARENT ATTENDANCE SCOPE (INCR — parent-portal Attendance tab). POLICY-ONLY —
-- ZERO new tables, ZERO enums, ZERO altered columns, ZERO backfills. It adds ONE narrow `parent_scope` policy
-- to EXACTLY ONE existing table (attendance_record) and re-runs the catalog-driven parent_deny loop.
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD after merging.
-- Byte-identical in effect to the "INCR — PARENT ATTENDANCE" block in db/sql/policies.sql (dev, db:policies).
--
-- WHAT IT SHIPS. A read-only parent ATTENDANCE tab in the parent portal. To render it, a parent linked to a
-- school must READ their OWN CHILD's per-day attendance marks (attendance_record: date + status). This is the
-- EIGHTH widening of the INCR-19a parent boundary (24 → 25 parent_scope tables).
--
-- 🔴 OWN-CHILD ONLY — PER-CHILD JOIN, NOT school-wide. Unlike the INCR-278 calendar tables (school-wide, keyed
-- on current_school), attendance_record carries PER-STUDENT data, so the restrictive predicate reaches a
-- SPECIFIC child through the SECURITY DEFINER helper parent_student_ids(school_id, pu) — byte-shaped like the
-- wassce_candidates policy (INCR-19a). The predicate is:
--   pu IS NULL  OR  student_id IN (SELECT parent_student_ids(school_id, pu))
-- where pu = NULLIF(current_setting('app.current_parent_user', true), ''). A parent of school A reads ONLY
-- their own child's rows; ANOTHER child of the SAME school → 0 rows; CROSS-TENANT → 0 rows. `pu IS NULL` →
-- staff/bypass session → total no-op (the permissive tenant_isolation still governs the row). USING doubles as
-- WITH CHECK; there is no parent write path anywhere (Kofi R4). Depends on parent_student_ids()
-- (prod-paste-0055), which already ships on prod.
--
-- 🔴 RLS IS ROW-LEVEL — IT CANNOT MASK COLUMNS. This policy opens the child's ROW. The reader's frozen key-set
-- (lib/parent/parent-attendance-data.ts, under withParentScope ONLY) is the column guard and MUST omit
-- reason_code / note / marked_by_user_id / marked_at, and fold MEDICAL→EXCUSED so the string "MEDICAL" never
-- crosses the wire (OC-PARENT-ATT-KEYSET). This paste does NOT and CANNOT enforce that projection — it only
-- decides which ROWS a parent may reach (their own child's).
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN — FAIL-CLOSED, NEVER A LEAK. db:policies configures LOCAL DEV ONLY.
-- Without this paste, attendance_record keeps its existing parent_deny on prod, so a parent session
-- (app.current_parent_user set) reads ZERO rows → the parent Attendance tab is an honest empty state, never a
-- cross-tenant or cross-child leak. The cost of skipping is a blank tab, not exposure. Run it to ship the tab.
--
-- SCOPE — EXACTLY ONE TABLE CHANGES. Only attendance_record gains parent_scope (its old parent_deny is
-- dropped). attendance_correction (staff decision_note / requested_by_user_id / decided_by_user_id — the
-- correction workflow's staff PII) and attendance_settings (per-school marking config) are DELIBERATELY NOT
-- widened: the reader never touches them, so they keep parent_deny (re-affirmed by the catalog loop below,
-- which still covers them — no parent_scope policy exists on either, so the NOT EXISTS(parent_scope) filter
-- includes them). Billing (invoice / invoice_line_item / payment / payment_allocation / receipt) likewise
-- keeps parent_deny (R476 tuition-leak). Tenant isolation is untouched on every table. The catalog parent_deny
-- loop at the tail re-affirms parent_deny on every other tenant table (auto-EXCLUDING the tables that carry
-- parent_scope), so a future tenant table stays auto-denied with zero edits.
--
-- Verify afterwards:
--   -- attendance_record carries parent_scope; correction/settings/billing still carry parent_deny:
--   select c.relname, p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname in ('attendance_record','attendance_correction','attendance_settings','invoice','receipt')
--   order by 1, 2;
--   -- and db/sql/verify-prod-rls.sql: Query 1 must return ZERO ROWS; tenant_tables unchanged;
--   -- parent_readable up by 1 (25) and parent_denied down by 1.

-- ---- layer 2: the new parent_scope policy (byte-identical to db/sql/policies.sql "INCR — PARENT ATTENDANCE"
-- block) ---- `pu IS NULL` → staff/bypass session → total no-op. `pu` set → student_id must resolve to one of
-- the parent's OWN children via parent_student_ids() (SECURITY DEFINER). USING doubles as WITH CHECK; there is
-- no parent write path (Kofi R4).

-- attendance_record — the child's per-day attendance marks (own-child only, via parent_student_ids).
DROP POLICY IF EXISTS parent_deny ON attendance_record;
DROP POLICY IF EXISTS parent_scope ON attendance_record;
CREATE POLICY parent_scope ON attendance_record AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR student_id IN (
      SELECT parent_student_ids(
        school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
    )
  );

-- ---- layer 1: parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql ----
-- 🔴 RUN THIS. It is NOT a hand-list: it applies RESTRICTIVE parent_deny to every FORCE-RLS + school_id table
-- that does NOT already carry a parent_scope policy — which, after the block above, is every tenant table
-- EXCEPT the 25 parent-readable ones (the 24 shipped + attendance_record added here). It re-creates identical
-- policies on the already-covered tables (hence idempotent) and, crucially, KEEPS attendance_record EXCLUDED
-- (it now carries parent_scope) while re-affirming parent_deny on attendance_correction, attendance_settings,
-- billing and every other tenant table. It is what keeps a FUTURE tenant table auto-denied with zero change.
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
