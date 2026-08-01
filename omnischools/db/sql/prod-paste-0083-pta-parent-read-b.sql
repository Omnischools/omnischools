-- Omnischools — PROD paste 0083: PTA PARENT READ, records/directory half (SHS module 4.7 / INCR-55b).
-- POLICY + FUNCTION ONLY — ZERO new tables, ZERO enums, ZERO altered columns, ZERO backfills, ZERO
-- migration. It adds three SECURITY DEFINER helpers and a narrow `parent_scope` policy to EXACTLY FIVE
-- existing tables (pta_officer, pta_minutes, pta_agenda_item, pta_action_item, pta_resolution) and re-runs
-- the catalog-driven parent_deny loop. Idempotent (CREATE OR REPLACE + DROP … IF EXISTS + the discovery
-- loop) — safe to run more than once. Paste into the Supabase SQL editor on PROD after merging.
-- Byte-identical in effect to the INCR-55b block in db/sql/policies.sql (dev, db:policies). The five tables
-- + every column read here already shipped (migrations 0075/0077, prod-pastes 0078/0080). The 55a helpers
-- parent_in_pta() / parent_pta_ids() and parent_student_ids() already exist on prod (prod-paste-0082 /
-- prod-paste-0055) and are NOT re-created here.
--
-- 🔴 THE SIXTH WIDENING of the INCR-19a parent boundary (17 → 22 parent_scope tables). A parent gains ROW
-- access to the CURRENT officer matrix of the PTAs they belong to (pta_officer, `ended_at IS NULL`,
-- membership-scoped) and the ADOPTED-minutes subtree of those PTAs (pta_minutes + pta_agenda_item +
-- pta_action_item + pta_resolution). This completes Module 4.7's parent read; there is no 55c.
--
-- 🔴 RLS GATES ROWS, NOT COLUMNS. Once a row is opened, an in-scope parent session CAN select any column off
-- it. The officer-only COLUMNS (pta_officer.election_ref, end_reason, contact) and the DRAFT/CHAIR_REVIEW
-- exclusion are the READER's frozen key-set projection (Claude Code's withParentScope loaders, R478/R479) —
-- EXCEPT where a row-gate structurally covers it: pta_officer's `ended_at IS NULL` denies ended rows (so
-- end_reason is never on a visible row), and pta_minutes's `status='ADOPTED'` denies DRAFT/CHAIR_REVIEW (so
-- a parent can never see a non-adopted minutes, nor any of its agenda/action/resolution children — the
-- subtree is reachable only through an ADOPTED minutes).
--
-- 🔴 THE 55a RECURSION TRAP APPLIES TO THE MINUTES SUBTREE. A parent_scope policy on table T must NEVER read
-- T inside a SECURITY DEFINER helper — under PROD's FORCE RLS + non-superuser owner the inner read RE-FIRES
-- the same policy → unbounded recursion (stack-depth error). DEV CANNOT catch it (the function owner is a
-- superuser on dev, so the body bypasses RLS) — the Sarah-L1 prod-shaped-ownership trap, verbatim the reason
-- 55a split parent_in_pta off parent_pta_ids. So each table's policy reaches UP the tree, reading only
-- ANCESTOR tables, never its own:
--   • pta_officer      → reads ptas          (via parent_pta_ids).                     officer ≠ ptas.
--   • pta_minutes      → reads pta_meeting   (via parent_minutes_row, a per-ROW pred). NEVER pta_minutes.
--   • pta_agenda_item  → reads pta_minutes   (via parent_readable_minutes_ids).        agenda ≠ minutes.
--   • pta_action_item  → reads pta_agenda_item (via parent_readable_agenda_item_ids).  action ≠ agenda.
--   • pta_resolution   → reads pta_agenda_item (same helper).                           resolution ≠ agenda.
-- Each SET helper MAY read the table one level up because THAT table's policy reaches a level HIGHER still
-- (pta_minutes's policy reads pta_meeting, not pta_minutes), so no policy ever reads the table it guards.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN — FAIL-CLOSED, NEVER A LEAK. db:policies configures LOCAL DEV ONLY.
-- Without this paste, all five tables keep their existing parent_deny on prod, so a parent session
-- (app.current_parent_user set) reads ZERO rows → the parent PTA records/officers tab is an honest empty
-- state, never a cross-tenant, cross-family or non-adopted-draft leak. The cost of skipping is a blank tab,
-- not exposure.
--
-- Verify afterwards:
--   -- these five tables now carry parent_scope; every other pta_* keeps parent_deny:
--   select c.relname, p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname like 'pta%' and p.polname in ('parent_scope','parent_deny') order by 1, 2;
--   -- and db/sql/verify-prod-rls.sql: Query 1 must return ZERO ROWS; tenant_tables unchanged;
--   -- parent_scope up by 5 (→ 22) and parent_denied down by 5.

-- ---- SECURITY DEFINER helper: is THIS minutes row parent-readable (ADOPTED, own-PTA)? (R478) ----
-- Per-ROW predicate for pta_minutes.parent_scope — reads pta_meeting, NEVER pta_minutes (so pta_minutes's
-- policy never reads its own table). Takes the row's status + meeting_id as ARGUMENTS (never a table read of
-- the guarded table). ADOPTED-only is the structural gate. Same discipline as parent_in_pta (STABLE,
-- explicit search_path public,pg_temp LAST).
CREATE OR REPLACE FUNCTION parent_minutes_row(school uuid, pu uuid, mstatus text, meeting uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT mstatus = 'ADOPTED'
    AND EXISTS (
      SELECT 1 FROM pta_meeting m
      WHERE m.school_id = school
        AND m.id = meeting
        AND m.pta_id IN (SELECT parent_pta_ids(school, pu))
    )
$$;

-- ---- SECURITY DEFINER helper: the ADOPTED, own-PTA minutes ids, as a set (R478) ----
-- SET form of parent_minutes_row over pta_minutes — used by the CHILD table's policy (pta_agenda_item), NOT
-- by pta_minutes.parent_scope (which uses the per-row predicate above), so reading pta_minutes here is
-- acyclic (pta_minutes's own policy reads pta_meeting, never pta_minutes). Its own parent_minutes_row filter
-- makes it correct whether the inner pta_minutes read is RLS-bypassed (dev) or RLS-applied (prod).
CREATE OR REPLACE FUNCTION parent_readable_minutes_ids(school uuid, pu uuid)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT m.id
  FROM pta_minutes m
  WHERE m.school_id = school
    AND parent_minutes_row(school, pu, m.status, m.meeting_id)
$$;

-- ---- SECURITY DEFINER helper: the agenda-item ids under a parent-readable minutes, as a set (R478) ----
-- SET form used by the LEAF tables' policies (pta_action_item, pta_resolution), NOT by pta_agenda_item's own
-- policy (which reaches minutes via parent_readable_minutes_ids), so reading pta_agenda_item here is acyclic.
CREATE OR REPLACE FUNCTION parent_readable_agenda_item_ids(school uuid, pu uuid)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT ai.id
  FROM pta_agenda_item ai
  WHERE ai.school_id = school
    AND ai.minutes_id IN (SELECT parent_readable_minutes_ids(school, pu))
$$;

-- pta_officer (R479) — the CURRENT officer matrix of the PTAs the parent belongs to. `ended_at IS NULL`
-- gates to current holders (AND structurally denies end_reason ever landing on a visible row); pta_id ∈
-- parent_pta_ids scopes to the parent's PTAs. Reads ptas via parent_pta_ids, NOT pta_officer → acyclic.
-- election_ref / contact stay officer-only — the reader's projection job (R479).
DROP POLICY IF EXISTS parent_deny ON pta_officer;
DROP POLICY IF EXISTS parent_scope ON pta_officer;
CREATE POLICY parent_scope ON pta_officer AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR (
      ended_at IS NULL
      AND pta_id IN (
        SELECT parent_pta_ids(
          school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
      )
    )
  );

-- pta_minutes (R478) — the ADOPTED minutes of the PTAs the parent belongs to. Uses the per-ROW predicate
-- parent_minutes_row on this row's status + meeting_id (reads pta_meeting, NEVER pta_minutes → no cycle under
-- prod FORCE RLS). status='ADOPTED' is structural: DRAFT/CHAIR_REVIEW rows never open to a parent.
DROP POLICY IF EXISTS parent_deny ON pta_minutes;
DROP POLICY IF EXISTS parent_scope ON pta_minutes;
CREATE POLICY parent_scope ON pta_minutes AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR parent_minutes_row(
         school_id,
         NULLIF(current_setting('app.current_parent_user', true), '')::uuid,
         status, meeting_id)
  );

-- pta_agenda_item (R478) — agenda items under a parent-readable (ADOPTED, own-PTA) minutes. Reads pta_minutes
-- via parent_readable_minutes_ids, NOT pta_agenda_item → acyclic.
DROP POLICY IF EXISTS parent_deny ON pta_agenda_item;
DROP POLICY IF EXISTS parent_scope ON pta_agenda_item;
CREATE POLICY parent_scope ON pta_agenda_item AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR minutes_id IN (
      SELECT parent_readable_minutes_ids(
        school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
    )
  );

-- pta_action_item (R478) — actions under a parent-readable agenda item. Reads pta_agenda_item via
-- parent_readable_agenda_item_ids, NOT pta_action_item → acyclic.
DROP POLICY IF EXISTS parent_deny ON pta_action_item;
DROP POLICY IF EXISTS parent_scope ON pta_action_item;
CREATE POLICY parent_scope ON pta_action_item AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR agenda_item_id IN (
      SELECT parent_readable_agenda_item_ids(
        school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
    )
  );

-- pta_resolution (R478) — resolutions under a parent-readable agenda item (same reach as action items).
-- Reads pta_agenda_item via parent_readable_agenda_item_ids, NOT pta_resolution → acyclic. The vote tallies /
-- resolution text / derived PASSED are PUBLIC on an adopted minutes (R478); nothing officer-only here.
DROP POLICY IF EXISTS parent_deny ON pta_resolution;
DROP POLICY IF EXISTS parent_scope ON pta_resolution;
CREATE POLICY parent_scope ON pta_resolution AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR agenda_item_id IN (
      SELECT parent_readable_agenda_item_ids(
        school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
    )
  );

-- ---- layer 1: parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql ----
-- 🔴 RUN THIS. It applies parent_deny to every FORCE-RLS + school_id table that does NOT already carry a
-- parent_scope policy — which, after the block above, is every tenant table EXCEPT the 22 parent-readable
-- ones (the 17 shipped + the 5 added here). It re-creates identical policies on the already-covered tables
-- (idempotent) and, crucially, KEEPS these five EXCLUDED while re-affirming parent_deny on every other pta_*
-- table (pta_tiers_config, pta_dues_config_history) AND on invoice / invoice_line_item / payment /
-- payment_allocation / receipt. It is what keeps a FUTURE tenant table auto-denied with zero code change.
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
