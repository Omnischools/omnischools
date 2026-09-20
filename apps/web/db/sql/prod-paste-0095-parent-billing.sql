-- Omnischools — PROD paste 0095: PARENT BILLING SCOPE (INCR — parent-portal Billing tab, READ-ONLY).
-- POLICY-ONLY — ZERO new tables, ZERO enums, ZERO altered columns, ZERO backfills. It adds a narrow,
-- SELECT-ONLY `parent_scope` (plus write-deny policies) to EXACTLY FOUR existing tables (invoice,
-- invoice_line_item, payment, receipt) and re-runs the catalog-driven parent_deny loop. Idempotent —
-- safe to run more than once. Paste into the Supabase SQL editor on PROD after merging. Byte-identical
-- in effect to the "INCR — PARENT BILLING" block in db/sql/policies.sql (dev, db:policies).
--
-- WHAT IT SHIPS. A read-only parent BILLING tab in the parent portal: a parent linked to a school READS
-- their OWN CHILD's issued bills (invoice: totals + discount scalar + status), the per-line breakdown
-- (invoice_line_item: description + amount), and the payments/receipts history (payment / receipt). This
-- is the NINTH widening of the INCR-19a parent boundary (25 → 29 parent_scope tables). Owner chose the
-- narrow parent_scope grant (approach a) over a SECURITY DEFINER projection — implemented here as (a),
-- read-only.
--
-- 🔴 THE ONE THING THAT MAKES BILLING DIFFERENT FROM EVERY PRIOR WIDENING: IT IS STRUCTURALLY READ-ONLY.
-- Every earlier parent_scope policy is `AS RESTRICTIVE FOR ALL` with USING doubling as WITH CHECK, relying
-- on the contract "no app write path runs inside withParentScope" (Kofi R4). That contract is NOT strong
-- enough for money: forging a `payment` (marking fees paid) or an `invoice` is the high-value attack, and a
-- FOR-ALL parent_scope would let a parent WRITE its own-child rows (USING doubles as WITH CHECK on
-- INSERT/UPDATE). So billing uses a different, tighter shape — SELECT reach + explicit write denial:
--   • parent_scope     AS RESTRICTIVE FOR SELECT — opens ONLY the own-child ROWS to a read; it carries NO
--     WITH CHECK, so it can never combine to PERMIT a write.
--   • parent_no_insert AS RESTRICTIVE FOR INSERT WITH CHECK (pu IS NULL) — a parent INSERT is REJECTED
--     (without it, tenant_isolation's permissive WITH CHECK alone would admit an own-school INSERT — the
--     forge hole).
--   • parent_no_update AS RESTRICTIVE FOR UPDATE USING (pu IS NULL) — a parent UPDATE matches 0 rows.
--   • parent_no_delete AS RESTRICTIVE FOR DELETE USING (pu IS NULL) — a parent DELETE matches 0 rows.
-- Net: a parent SELECTs own-child billing rows and can do NOTHING else to these tables. Same device as the
-- parent_no_update/parent_no_delete in prod-paste-0094, extended to INSERT and paired with a SELECT-only
-- scope. Proven NON-SUPERUSER (omnischools_app) in scripts/rls-test.ts — the dev superuser masks RLS.
--
-- 🔴 OWN-CHILD ONLY — PER-CHILD JOIN, tenant-fenced, pu-guarded. invoice / payment / receipt carry
-- student_id and reach a SPECIFIC child through the SECURITY DEFINER helper parent_student_ids(school_id, pu)
-- — byte-shaped like the attendance_record / wassce_candidates policies. invoice_line_item carries no
-- student_id; it is reachable ONLY via its OWN-CHILD invoice (invoice_id IN own-child invoices of the same
-- tenant) — a direct subquery on `invoice` (a DIFFERENT table, so acyclic under prod FORCE RLS; and belt-
-- and-suspenders, that inner read re-fires invoice's own parent_scope). All four predicates are
-- `pu IS NULL OR <own-child reach>`, where pu = NULLIF(current_setting('app.current_parent_user', true), '').
-- A parent of school A reads ONLY their own child's rows; ANOTHER child of the SAME school → 0 rows;
-- CROSS-TENANT → 0 rows. `pu IS NULL` → staff (withSchool) / webhook / escalated session → total no-op:
-- the SELECT scope is TRUE, the write-denies are TRUE, so staff finance (read AND write) is byte-unchanged.
-- Depends on parent_student_ids() (prod-paste-0055), already on prod.
--
-- 🔴 RLS IS ROW-LEVEL — IT CANNOT MASK COLUMNS. This opens the child's billing ROWS. The reader
-- (lib/parent/*, under withParentScope ONLY) is the column guard. The DISCOUNT design keeps confidential
-- mechanics off the wire structurally: the discount TOTAL is the denormalised scalar invoice.discount_amount
-- and the line text is invoice_line_item.description — so NO discount/mechanic table is ever reached.
--
-- 🔴 NEVER WIDEN — these stay parent_deny (half the security; they carry NO parent_scope, so the catalog
-- loop below re-affirms parent_deny on each): payment_allocation, invoice_discount_application, discount,
-- discount_tier, fee_structure, fee_structure_item, fee_category, payment_audit_log. A parent reads the four
-- tables above and NOTHING else in the billing domain — no allocation ledger, no discount scheme/tier, no
-- fee-structure catalogue, no audit log.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN — FAIL-CLOSED, NEVER A LEAK. db:policies configures LOCAL DEV ONLY.
-- Without this paste, all four tables keep their existing parent_deny on prod, so a parent session
-- (app.current_parent_user set) reads ZERO rows → the parent Billing tab is an honest empty state, never a
-- cross-tenant or cross-child leak, and the write-forge surface never opens. The cost of skipping is a blank
-- tab, not exposure. Run it to ship the tab.
--
-- SCOPE — EXACTLY FOUR TABLES CHANGE (invoice, invoice_line_item, payment, receipt gain SELECT-only
-- parent_scope + parent_no_insert/update/delete; their old parent_deny is dropped). Tenant isolation is
-- untouched on every table. The catalog parent_deny loop at the tail re-affirms parent_deny on every other
-- tenant table (auto-EXCLUDING the four that now carry parent_scope), so the never-widen list stays denied
-- and a future tenant table stays auto-denied with zero edits.
--
-- Verify afterwards:
--   -- the four tables carry parent_scope (SELECT) + parent_no_insert/update/delete; never-widen still denied:
--   select c.relname, p.polname, p.polcmd from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname in ('invoice','invoice_line_item','payment','receipt',
--                       'payment_allocation','discount','fee_category','payment_audit_log')
--   order by 1, 2;
--   -- and db/sql/verify-prod-rls.sql: Query 1 must return ZERO ROWS; tenant_tables unchanged;
--   -- parent_readable up by 4 (29) and parent_denied down by 4.

-- ---- layer 2: the four new SELECT-only parent_scope policies + per-command write denials (byte-identical
-- to db/sql/policies.sql "INCR — PARENT BILLING" block) ---- `pu IS NULL` → staff/bypass session → the
-- SELECT scope AND every write-deny are TRUE → total no-op. `pu` set → SELECT is fenced to own-child rows
-- and INSERT/UPDATE/DELETE are denied outright.

-- invoice — the child's issued bills (own-child only, via parent_student_ids). READ-ONLY.
DROP POLICY IF EXISTS parent_deny ON invoice;
DROP POLICY IF EXISTS parent_scope ON invoice;
DROP POLICY IF EXISTS parent_no_insert ON invoice;
DROP POLICY IF EXISTS parent_no_update ON invoice;
DROP POLICY IF EXISTS parent_no_delete ON invoice;
CREATE POLICY parent_scope ON invoice AS RESTRICTIVE FOR SELECT TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR student_id IN (
      SELECT parent_student_ids(
        school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
    )
  );
CREATE POLICY parent_no_insert ON invoice AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
CREATE POLICY parent_no_update ON invoice AS RESTRICTIVE FOR UPDATE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
CREATE POLICY parent_no_delete ON invoice AS RESTRICTIVE FOR DELETE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);

-- invoice_line_item — the per-line breakdown, reachable ONLY via an OWN-CHILD invoice of the same tenant
-- (no student_id on the row). Reads `invoice` (a different table → acyclic). READ-ONLY.
DROP POLICY IF EXISTS parent_deny ON invoice_line_item;
DROP POLICY IF EXISTS parent_scope ON invoice_line_item;
DROP POLICY IF EXISTS parent_no_insert ON invoice_line_item;
DROP POLICY IF EXISTS parent_no_update ON invoice_line_item;
DROP POLICY IF EXISTS parent_no_delete ON invoice_line_item;
CREATE POLICY parent_scope ON invoice_line_item AS RESTRICTIVE FOR SELECT TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR invoice_id IN (
      SELECT i.id FROM invoice i
      WHERE i.school_id = invoice_line_item.school_id
        AND i.student_id IN (
          SELECT parent_student_ids(
            invoice_line_item.school_id,
            NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
        )
    )
  );
CREATE POLICY parent_no_insert ON invoice_line_item AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
CREATE POLICY parent_no_update ON invoice_line_item AS RESTRICTIVE FOR UPDATE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
CREATE POLICY parent_no_delete ON invoice_line_item AS RESTRICTIVE FOR DELETE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);

-- payment — the child's payments history (own-child only, via parent_student_ids). READ-ONLY: forging a
-- payment (marking fees paid) is the high-value attack, denied structurally by parent_no_insert.
DROP POLICY IF EXISTS parent_deny ON payment;
DROP POLICY IF EXISTS parent_scope ON payment;
DROP POLICY IF EXISTS parent_no_insert ON payment;
DROP POLICY IF EXISTS parent_no_update ON payment;
DROP POLICY IF EXISTS parent_no_delete ON payment;
CREATE POLICY parent_scope ON payment AS RESTRICTIVE FOR SELECT TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR student_id IN (
      SELECT parent_student_ids(
        school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
    )
  );
CREATE POLICY parent_no_insert ON payment AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
CREATE POLICY parent_no_update ON payment AS RESTRICTIVE FOR UPDATE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
CREATE POLICY parent_no_delete ON payment AS RESTRICTIVE FOR DELETE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);

-- receipt — the child's receipts history (own-child only, via parent_student_ids). READ-ONLY.
DROP POLICY IF EXISTS parent_deny ON receipt;
DROP POLICY IF EXISTS parent_scope ON receipt;
DROP POLICY IF EXISTS parent_no_insert ON receipt;
DROP POLICY IF EXISTS parent_no_update ON receipt;
DROP POLICY IF EXISTS parent_no_delete ON receipt;
CREATE POLICY parent_scope ON receipt AS RESTRICTIVE FOR SELECT TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR student_id IN (
      SELECT parent_student_ids(
        school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
    )
  );
CREATE POLICY parent_no_insert ON receipt AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
CREATE POLICY parent_no_update ON receipt AS RESTRICTIVE FOR UPDATE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
CREATE POLICY parent_no_delete ON receipt AS RESTRICTIVE FOR DELETE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);

-- ---- layer 1: parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql ----
-- 🔴 RUN THIS. It re-affirms RESTRICTIVE parent_deny on every FORCE-RLS + school_id table that does NOT
-- already carry a parent_scope policy. The four tables above now carry parent_scope, so they stay EXCLUDED;
-- every never-widen billing table (payment_allocation, invoice_discount_application, discount, discount_tier,
-- fee_structure, fee_structure_item, fee_category, payment_audit_log) and every other tenant table (and any
-- future one) stays auto-denied. Idempotent.
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
