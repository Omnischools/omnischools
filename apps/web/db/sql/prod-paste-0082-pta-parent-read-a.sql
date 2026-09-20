-- Omnischools — PROD paste 0082: PTA PARENT READ, participation half (SHS module 4.7 / INCR-55a). POLICY +
-- FUNCTION ONLY — ZERO new tables, ZERO enums, ZERO altered columns, ZERO backfills, ZERO migration. It adds
-- two SECURITY DEFINER helpers and a narrow `parent_scope` policy to EXACTLY FOUR existing tables (ptas,
-- pta_meeting, pta_dues_charge, pta_meeting_attendance) and re-runs the catalog-driven parent_deny loop.
-- Idempotent (CREATE OR REPLACE + DROP … IF EXISTS + the discovery loop) — safe to run more than once. Paste
-- into the Supabase SQL editor on PROD after merging. Byte-identical in effect to the INCR-55a block in
-- db/sql/policies.sql (dev, db:policies). The four tables + every column read here already shipped
-- (migrations 0074/0076/0078, prod-pastes 0077/0079/0081). parent_student_ids() already exists on prod
-- (prod-paste-0055, INCR-19a) and is NOT re-created here.
--
-- 🔴 THE FIFTH WIDENING of the INCR-19a parent boundary (13 → 17 parent_scope tables). A parent gains ROW
-- access to the ACTIVE PTAs they belong to (ptas + pta_meeting, membership-scoped) and their OWN dues + OWN
-- meeting-attendance (pta_dues_charge + pta_meeting_attendance, own-child / own-guardian). The 55b
-- records/directory half (minutes subtree + officer matrix) is a LATER paste; those tables keep parent_deny.
--
-- 🔴 DUES ARE READ OFF THE BRIDGE, NEVER THE BILLING ENGINE (R476). parent_scope lands on pta_dues_charge
-- (it carries rate_snapshot + the family identity) and NOT on invoice / invoice_line_item / payment /
-- payment_allocation / receipt — those keep parent_deny (re-affirmed by the loop below), so tuition cannot
-- leak and the money engine is byte-unchanged for a parent session. paid/outstanding is DEFERRED.
--
-- 🔴 THE POLICY CYCLE, AND WHY `ptas` DOES NOT CALL `parent_pta_ids`. parent_pta_ids READS `ptas`. A
-- parent_scope on `ptas` that called it would be a policy-on-A reading A through a SECURITY DEFINER function
-- — and under PROD's FORCE RLS + non-superuser owner the inner `ptas` read RE-FIRES the same policy →
-- unbounded recursion (stack-depth error). DEV CANNOT catch it (the function owner is a superuser on dev, so
-- the body bypasses RLS) — the Sarah-L1 prod-shaped-ownership trap. So the membership rule is factored the
-- chronic-block way (one predicate, two enforcement forms, R113): parent_in_pta() is the per-ROW predicate
-- (reads `students`, NEVER `ptas`) that `ptas.parent_scope` calls on its own row's columns; parent_pta_ids()
-- is the SET form used by the child tables (pta_meeting) whose policies do NOT read `ptas`.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN — FAIL-CLOSED, NEVER A LEAK. db:policies configures LOCAL DEV ONLY.
-- Without this paste, all four tables keep their existing parent_deny on prod, so a parent session
-- (app.current_parent_user set) reads ZERO rows → the parent PTA tab is an honest empty state, never a
-- cross-tenant, cross-family or teacher-row leak. The cost of skipping is a blank tab, not exposure.
--
-- 🔴 COLUMN CONTROL LIVES IN THE READER. RLS is ROW-level and CANNOT mask columns. Once parent_scope opens
-- a row, an in-scope parent session CAN select any column off it (pta_meeting.agenda_json /
-- invited_teacher_user_ids / convened_by_user_id — staff PII; pta_meeting_attendance.recorded_by_user_id;
-- pta_dues_charge internals). The ONLY guard against those columns reaching the wire is the reader's frozen
-- key-set projection (Claude Code's parent-portal loaders) — R470/R480.
--
-- Verify afterwards:
--   -- exactly these four tables carry parent_scope among the PTA tables; every other pta_* keeps parent_deny:
--   select c.relname, p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname like 'pta%' and p.polname in ('parent_scope','parent_deny') order by 1, 2;
--   -- and db/sql/verify-prod-rls.sql: Query 1 must return ZERO ROWS; tenant_tables unchanged;
--   -- parent_scope up by 4 (→ 17) and parent_denied down by 4.

-- ---- SECURITY DEFINER helper 1: the per-row PTA membership predicate (reads students, NEVER ptas) ----
-- Same discipline as parent_student_ids (STABLE, explicit search_path public,pg_temp — pg_temp LAST pins
-- relation resolution to public so an injected temp `students` cannot spoof the answer). EXISTS(parent_
-- student_ids) is LOAD-BEARING: a non-parent → empty → FALSE → 0 PTAs everywhere, incl the universal GENERAL.
CREATE OR REPLACE FUNCTION parent_in_pta(school uuid, pu uuid, tier text, cls uuid, hse uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM parent_student_ids(school, pu))
    AND (
      tier = 'GENERAL'
      OR (tier = 'FORM' AND cls IN (
            SELECT s.class_id FROM students s
            WHERE s.school_id = school
              AND s.class_id IS NOT NULL
              AND s.id IN (SELECT parent_student_ids(school, pu))))
      OR (tier = 'HOUSE' AND hse IN (
            SELECT s.house_id FROM students s
            WHERE s.school_id = school
              AND s.house_id IS NOT NULL
              AND s.id IN (SELECT parent_student_ids(school, pu))))
    )
$$;

-- ---- SECURITY DEFINER helper 2: the ACTIVE PTAs the parent belongs to, as a set (Kofi R475) ----
CREATE OR REPLACE FUNCTION parent_pta_ids(school uuid, pu uuid)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT p.id
  FROM ptas p
  WHERE p.school_id = school
    AND p.status = 'ACTIVE'
    AND parent_in_pta(school, pu, p.tier_type, p.class_id, p.house_id)
$$;

-- ---- the four parent_scope policies (byte-identical to the db/sql/policies.sql INCR-55a block) ----

-- ptas (R480) — the ACTIVE PTAs the parent belongs to. Calls parent_in_pta on THIS row (never parent_pta_ids)
-- so the policy does not read its own table — no cycle under prod FORCE RLS.
DROP POLICY IF EXISTS parent_deny ON ptas;
DROP POLICY IF EXISTS parent_scope ON ptas;
CREATE POLICY parent_scope ON ptas AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR (
      status = 'ACTIVE'
      AND parent_in_pta(
            school_id,
            NULLIF(current_setting('app.current_parent_user', true), '')::uuid,
            tier_type, class_id, house_id)
    )
  );

-- pta_meeting (R480) — meetings of a PTA the parent belongs to. Reads ptas via parent_pta_ids, not
-- pta_meeting → acyclic.
DROP POLICY IF EXISTS parent_deny ON pta_meeting;
DROP POLICY IF EXISTS parent_scope ON pta_meeting;
CREATE POLICY parent_scope ON pta_meeting AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR pta_id IN (
      SELECT parent_pta_ids(
        school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
    )
  );

-- pta_dues_charge (R476) — the parent's OWN dues: on one of the parent's own children (subject_student_id)
-- OR a PER_FAMILY charge on a household one of the parent's children belongs to (the rep-sibling billed may
-- be a different child in the same household). The household reach reads `students`, not pta_dues_charge.
DROP POLICY IF EXISTS parent_deny ON pta_dues_charge;
DROP POLICY IF EXISTS parent_scope ON pta_dues_charge;
CREATE POLICY parent_scope ON pta_dues_charge AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR subject_student_id IN (
      SELECT parent_student_ids(
        school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
    )
    OR household_id IN (
      SELECT s.household_id FROM students s
      WHERE s.school_id = pta_dues_charge.school_id
        AND s.household_id IS NOT NULL
        AND s.id IN (
          SELECT parent_student_ids(
            pta_dues_charge.school_id,
            NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
        )
    )
  );

-- pta_meeting_attendance (R477) — the parent's OWN attendance rows. Keyed on student_guardian_id → the
-- parent's OWN guardian row (user_id = pu). TEACHER rows carry student_guardian_id NULL → auto-excluded.
DROP POLICY IF EXISTS parent_deny ON pta_meeting_attendance;
DROP POLICY IF EXISTS parent_scope ON pta_meeting_attendance;
CREATE POLICY parent_scope ON pta_meeting_attendance AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR student_guardian_id IN (
      SELECT g.id FROM student_guardian g
      WHERE g.school_id = pta_meeting_attendance.school_id
        AND g.user_id = NULLIF(current_setting('app.current_parent_user', true), '')::uuid
    )
  );

-- ---- layer 1: parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql ----
-- 🔴 RUN THIS. It applies parent_deny to every FORCE-RLS + school_id table that does NOT already carry a
-- parent_scope policy — which, after the block above, is every tenant table EXCEPT the 17 parent-readable
-- ones (the 13 shipped + the 4 added here). It re-creates identical policies on the already-covered tables
-- (idempotent) and, crucially, KEEPS these four EXCLUDED while re-affirming parent_deny on every other pta_*
-- table (pta_tiers_config, pta_dues_config_history, pta_officer, pta_minutes, pta_agenda_item,
-- pta_action_item, pta_resolution) AND on invoice / invoice_line_item / payment / payment_allocation /
-- receipt. It is what keeps a FUTURE tenant table auto-denied with zero code change.
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
