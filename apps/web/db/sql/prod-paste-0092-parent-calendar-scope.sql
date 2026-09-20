-- Omnischools — PROD paste 0092: PARENT SCHOOL-CALENDAR SCOPE (INCR-278). POLICY-ONLY — ZERO new tables,
-- ZERO enums, ZERO altered columns, ZERO backfills. It adds a narrow `parent_scope` policy to EXACTLY TWO
-- existing tables (academic_period, school_holiday) and re-runs the catalog-driven parent_deny loop.
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD after merging.
-- Byte-identical in effect to the INCR-278 block in db/sql/policies.sql (dev, db:policies).
--
-- WHAT IT SHIPS. A parent SCHOOL CALENDAR tab in the read-only parent portal. To render it, a parent linked
-- to a school must READ that school's term/semester dates (academic_period) and its holidays/breaks/events/
-- exam weeks (school_holiday). This is the SEVENTH widening of the INCR-19a parent boundary (22 → 24
-- parent_scope tables).
--
-- 🔴 THE SAFEST PARENT GRANT IN THE MODULE — NO PER-CHILD JOIN, NO CROSS-CHILD LEAK SURFACE. Every prior
-- parent_scope policy reaches a SPECIFIC child (parent_student_ids / parent_pta_ids) because the row carries
-- per-student data. These two tables are SCHOOL-WIDE: the calendar is identical for every child in the school
-- and carries ZERO per-student data —
--   • academic_period : academic_year / period_label / starts_on / ends_on / product_line / closed_at
--   • school_holiday  : name / starts_on / ends_on / kind
-- — so there is nothing to fence per-child. The scope is the SCHOOL itself, keyed on the SAME app.current_school
-- GUC that lib/db/rls.ts → withParentScope(schoolId, userId) already sets, and that the PERMISSIVE
-- tenant_isolation policy on both tables already enforces on every row a parent session can see. The parent's
-- active-school membership is therefore ALREADY established in the session GUC — this paste adds no new
-- membership check, it simply stops denying the school's own calendar rows to a parent of that school.
-- The restrictive predicate `pu IS NULL OR school_id = current_school` is a true no-op tightening: its only
-- structural job is to EXIST so the catalog parent_deny loop below EXCLUDES these two tables, while
-- re-affirming the school boundary EXPLICITLY (defence in depth — never a bare `OR TRUE` that reads as "open
-- to everyone"). There is no confidential column here and no per-child column, so unlike the sickbay/PTA
-- widenings there is NO reader-projection column-guard obligation — every column on both tables is
-- school-public calendar data.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN — FAIL-CLOSED, NEVER A LEAK. db:policies configures LOCAL DEV ONLY.
-- Without this paste, academic_period + school_holiday keep their existing parent_deny on prod, so a parent
-- session (app.current_parent_user set) reads ZERO rows from both → the parent Calendar tab is an honest
-- empty state, never a cross-tenant or cross-child leak. The cost of skipping is a blank tab, not exposure.
-- Run it to actually ship the feature.
--
-- SCOPE — EXACTLY TWO TABLES CHANGE. Only academic_period and school_holiday gain parent_scope (their old
-- parent_deny is dropped). Tenant isolation is untouched on every table. Billing (invoice / invoice_line_item
-- / payment / payment_allocation / receipt) DELIBERATELY keeps parent_deny (R476 tuition-leak) and is out of
-- scope: a parent-billing view would need a safe bridge/projection, never a raw invoice grant. The catalog
-- parent_deny loop at the tail re-affirms parent_deny on every other tenant table (auto-EXCLUDING the two
-- tables that now carry parent_scope), so a future tenant table stays auto-denied with zero edits.
--
-- Verify afterwards:
--   -- these two tables carry parent_scope; billing tables still carry parent_deny:
--   select c.relname, p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname in ('academic_period','school_holiday','invoice','payment','receipt') order by 1, 2;
--   -- and db/sql/verify-prod-rls.sql: Query 1 must return ZERO ROWS; tenant_tables unchanged;
--   -- parent_readable up by 2 (24) and parent_denied down by 2.

-- ---- layer 2: the two new parent_scope policies (byte-identical to db/sql/policies.sql INCR-278 block) ----
-- School-wide, no per-child join. `pu IS NULL` → staff/bypass session → total no-op. `pu` set → the row must
-- belong to the parent's active school (which tenant_isolation already required) → the parent reads the whole
-- school calendar and nothing else. USING doubles as WITH CHECK; there is no parent write path (Kofi R4).

-- academic_period — the school's term/semester dates (school-wide; no per-child data).
DROP POLICY IF EXISTS parent_deny ON academic_period;
DROP POLICY IF EXISTS parent_scope ON academic_period;
CREATE POLICY parent_scope ON academic_period AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

-- school_holiday — the school's holidays / breaks / events / exam weeks (school-wide; no per-child data).
DROP POLICY IF EXISTS parent_deny ON school_holiday;
DROP POLICY IF EXISTS parent_scope ON school_holiday;
CREATE POLICY parent_scope ON school_holiday AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

-- ---- layer 1: parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql ----
-- 🔴 RUN THIS. It is NOT a hand-list: it applies RESTRICTIVE parent_deny to every FORCE-RLS + school_id table
-- that does NOT already carry a parent_scope policy — which, after the block above, is every tenant table
-- EXCEPT the 24 parent-readable ones (the 22 shipped + the 2 added here). It re-creates identical policies on
-- the already-covered tables (hence idempotent) and, crucially, KEEPS the two INCR-278 tables EXCLUDED (they
-- now carry parent_scope) while re-affirming parent_deny on billing and every other tenant table. It is what
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
