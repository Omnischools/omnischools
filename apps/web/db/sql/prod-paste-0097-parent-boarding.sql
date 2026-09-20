-- Omnischools — PROD paste 0097: PARENT BOARDING SCOPE (INCR — parent-portal Boarding tab, READ-ONLY, lean v1).
-- POLICY + FUNCTION ONLY — ZERO new tables, ZERO enums, ZERO altered columns, ZERO backfills. It adds two
-- narrow SELECT-only school-wide `parent_scope` grants (+ write-deny policies) to EXACTLY TWO existing tables
-- (boarding_calendar_event, boarding_settings), one SECURITY DEFINER placement projection
-- (parent_boarding_placement), and re-runs the catalog-driven parent_deny loop. Idempotent — safe to run
-- more than once. Paste into the Supabase SQL editor on PROD after merging. Byte-identical in effect to the
-- "INCR — PARENT BOARDING" block in db/sql/policies.sql (dev, db:policies).
--
-- WHAT IT SHIPS. A read-only parent BOARDING tab: a parent linked to a school READS the school's VISITING-day
-- calendar (boarding_calendar_event, constrained to event_type='VISITING'), the school's visiting policy
-- (boarding_settings), and — via the projection fn — their OWN PLACED boarder child's placement as House name
-- + dormitory name + prefect badge. This is the TENTH widening of the INCR-19a parent boundary
-- (29 → 31 parent_scope tables). Exeat/leave is DEFERRED to phase 2; the bunk NUMBER is deliberately NOT
-- surfaced (owner: "full placement except bunk number").
--
-- 🔴 THE VISITING CONSTRAINT IS STRUCTURAL, NOT A READER FILTER (Kofi OC-BOARD-EXEAT belt+braces). The
-- boarding_calendar_event SELECT scope is `pu IS NULL OR (school_id = current_school AND event_type='VISITING')`
-- — an EXEAT_WINDOW row is DENIED to a parent at the RLS layer. Exeat/leave is phase-2 and must not be
-- reachable via the visiting grant even if a future reader forgets to filter.
--
-- 🔴 STRUCTURALLY READ-ONLY (the billing posture). Both config tables use SELECT reach + explicit write
-- denial — a parent must NOT forge a visiting day or school policy:
--   • parent_scope     AS RESTRICTIVE FOR SELECT — opens ONLY the readable rows; NO WITH CHECK, so it can
--     never combine to PERMIT a write.
--   • parent_no_insert AS RESTRICTIVE FOR INSERT WITH CHECK (pu IS NULL) — a parent INSERT is REJECTED
--     (without it, tenant_isolation's permissive WITH CHECK alone would admit an own-school INSERT — the
--     forge hole).
--   • parent_no_update / parent_no_delete AS RESTRICTIVE FOR UPDATE/DELETE USING (pu IS NULL) — 0 rows.
-- `pu IS NULL` (staff / webhook / escalated) → the SELECT scope AND every write-deny are TRUE → total no-op;
-- staff boarding read+write is byte-unchanged. Proven NON-SUPERUSER (omnischools_app) in scripts/rls-test.ts.
--
-- 🔴 SCHOOL-WIDE, NOT PER-CHILD (for the two tables). The visiting calendar and the visiting policy are
-- identical for every child in the school and carry ZERO per-student data, so the scope is the SCHOOL itself,
-- keyed on the app.current_school GUC withParentScope already sets (and that the permissive tenant_isolation
-- policy already enforces) — the INCR-278 school-calendar shape. Any parent linked to the school may read them.
--
-- 🔴 THE PLACEMENT PROJECTION USES THE GUC-CLEAR DEVICE. boarding_bunk / boarding_dormitory / house are all
-- parent_deny, so a parent cannot read the spatial spine directly. parent_boarding_placement(school, pu) is a
-- SECURITY DEFINER fn that is BOTH the immutable column guard (it returns ONLY house_name / dorm_name /
-- prefect_role — NEVER bunk_position / house_id / dorm_id / bunk_id / hm_user_id / colour / capacity / gender /
-- section_label, so a parent can never reach the bunk number or staff PII even via a mutated reader) AND uses
-- the parent_bump_conversation / parent_house_names GUC-clear idiom: under prod's non-superuser FORCE-RLS
-- definer owner, a plain read of those parent_deny tables with the parent GUC still set returns 0 rows and the
-- projection fail-closes; so it CLEARS app.current_parent_user for the one read (parent_deny's `pu IS NULL` →
-- TRUE, the definer traverses the spine) then RESTORES it VERBATIM. app.current_school stays set →
-- tenant_isolation still fences the school. Own-child fencing does NOT rely on the GUC — it uses the CAPTURED
-- pu ARG via parent_student_ids(). One row per own PLACED boarder (current_bunk_id NOT NULL); an unplaced
-- boarder → no row; another child / family / tenant → 0. Depends on parent_student_ids() (prod-paste-0055),
-- already on prod.
--
-- 🔴 RESTORE VERBATIM, NEVER pu::text. `pu` is a fn ARG that may differ from the caller's session GUC (unlike
-- parent_bump_conversation, whose pu is DERIVED from the GUC). The fn captures `prev := current_setting(
-- 'app.current_parent_user', true)` and restores `COALESCE(prev, '')`; a pu::text restore would mis-scope a
-- caller whose GUC is unset (or differs), forging a scope that was never there.
--
-- 🔴 NEVER WIDEN — these stay parent_deny (re-affirmed by the catalog loop below, which covers every FORCE-RLS
-- + school_id table with NO parent_scope): boarding_bunk, boarding_dormitory, house, boarding_approved_visitor,
-- boarding_visit, boarding_visit_notification, boarding_exeat, exeat_notification, inspections, prep_attendance,
-- boarding_arrival, bunk_allocation, daily_schedule_template (and every non-boarding tenant table). A parent
-- reads the two config tables + the projection and NOTHING else in the boarding domain.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN — FAIL-CLOSED, NEVER A LEAK (but paste it WITH the code, not after).
-- db:policies configures LOCAL DEV ONLY. Without this paste, both grant tables keep parent_deny AND the
-- function is ABSENT. A DAY / non-boarder parent short-circuits before the placement call → honest empty. But
-- a parent of a BOARDER child hits the placement call `select … from parent_boarding_placement(…)`, which
-- 500s ("function does not exist") — fail-CLOSED (a 500 leaks NOTHING: no cross-tenant/cross-child data), but
-- a LOUD "the paste didn't run" signal, not a silent empty. So run this WITH/BEFORE the code release.
--
-- Verify afterwards:
--   -- the two tables carry parent_scope (SELECT) + parent_no_insert/update/delete; never-widen still denied:
--   select c.relname, p.polname, p.polcmd from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname in ('boarding_calendar_event','boarding_settings',
--                       'boarding_bunk','boarding_dormitory','house','boarding_exeat')
--   order by 1, 2;
--   -- the projection fn exists and is owned by / executable to omnischools_app:
--   select proname, proowner::regrole from pg_proc where proname = 'parent_boarding_placement';
--   -- and db/sql/verify-prod-rls.sql: Query 1 must return ZERO ROWS; parent_readable up by 2 (31).

-- ---- layer 2: the two new SELECT-only school-wide parent_scope grants + per-command write denials + the
-- placement projection (byte-identical to db/sql/policies.sql "INCR — PARENT BOARDING" block). `pu IS NULL`
-- → staff/bypass session → the SELECT scope AND every write-deny are TRUE → total no-op.

-- boarding_calendar_event — the visiting-Sunday calendar. SCHOOL-WIDE, CONSTRAINED to event_type='VISITING'
-- (EXEAT_WINDOW rows are denied at the RLS layer, not just filtered). READ-ONLY.
DROP POLICY IF EXISTS parent_deny ON boarding_calendar_event;
DROP POLICY IF EXISTS parent_scope ON boarding_calendar_event;
DROP POLICY IF EXISTS parent_no_insert ON boarding_calendar_event;
DROP POLICY IF EXISTS parent_no_update ON boarding_calendar_event;
DROP POLICY IF EXISTS parent_no_delete ON boarding_calendar_event;
CREATE POLICY parent_scope ON boarding_calendar_event AS RESTRICTIVE FOR SELECT TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR (
      school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
      AND event_type = 'VISITING'
    )
  );
CREATE POLICY parent_no_insert ON boarding_calendar_event AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
CREATE POLICY parent_no_update ON boarding_calendar_event AS RESTRICTIVE FOR UPDATE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
CREATE POLICY parent_no_delete ON boarding_calendar_event AS RESTRICTIVE FOR DELETE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);

-- boarding_settings — the per-school visiting policy (one row/school). SCHOOL-WIDE. READ-ONLY.
DROP POLICY IF EXISTS parent_deny ON boarding_settings;
DROP POLICY IF EXISTS parent_scope ON boarding_settings;
DROP POLICY IF EXISTS parent_no_insert ON boarding_settings;
DROP POLICY IF EXISTS parent_no_update ON boarding_settings;
DROP POLICY IF EXISTS parent_no_delete ON boarding_settings;
CREATE POLICY parent_scope ON boarding_settings AS RESTRICTIVE FOR SELECT TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );
CREATE POLICY parent_no_insert ON boarding_settings AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
CREATE POLICY parent_no_update ON boarding_settings AS RESTRICTIVE FOR UPDATE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
CREATE POLICY parent_no_delete ON boarding_settings AS RESTRICTIVE FOR DELETE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);

-- parent_boarding_placement — the own-PLACED-boarder placement projection (House + dorm + prefect, NEVER
-- the bunk number). GUC-clear device: boarding_bunk / boarding_dormitory / house stay parent_deny, so this
-- SECURITY DEFINER fn clears app.current_parent_user for the one read then restores it VERBATIM.
CREATE OR REPLACE FUNCTION parent_boarding_placement(school uuid, pu uuid)
  RETURNS TABLE(student_id uuid, house_name text, dorm_name text, prefect_role text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  prev text := current_setting('app.current_parent_user', true);  -- caller's GUC, captured VERBATIM
BEGIN
  IF pu IS NULL THEN RETURN; END IF;  -- no parent arg → 0 rows (fail-closed); GUC untouched
  -- Relax parent_deny on the spatial spine for THIS read only (parent_deny's `pu IS NULL` → TRUE). Own-child
  -- fencing uses the CAPTURED pu ARG (parent_student_ids), NOT the now-cleared GUC; app.current_school stays
  -- set so tenant_isolation still fences the school.
  PERFORM set_config('app.current_parent_user', '', true);
  RETURN QUERY
    SELECT s.id, h.name, d.name, b.prefect_role::text
    FROM students s
    JOIN boarding_bunk b      ON b.school_id = s.school_id AND b.id = s.current_bunk_id
    JOIN boarding_dormitory d ON d.school_id = b.school_id AND d.id = b.dormitory_id
    JOIN house h              ON h.school_id = d.school_id AND h.id = d.house_id
    WHERE s.school_id = school
      AND s.current_bunk_id IS NOT NULL
      AND s.id IN (SELECT parent_student_ids(school, pu));
  -- RESTORE the caller's GUC VERBATIM. COALESCE(prev,'') because current_setting(...,true) yields NULL when
  -- unset. NEVER pu::text: pu is a fn ARG that may differ from the caller's session GUC — a pu::text restore
  -- would mis-scope a caller whose GUC is unset (or differs), forging a scope that was never there.
  PERFORM set_config('app.current_parent_user', COALESCE(prev, ''), true);
END;
$$;
-- On Supabase every public function is a PostgREST RPC and EXECUTE defaults to PUBLIC; a privileged
-- SECURITY DEFINER read must not be anon-callable (no-op without the GUCs, but harden anyway).
REVOKE EXECUTE ON FUNCTION parent_boarding_placement(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnischools_app') THEN
    GRANT EXECUTE ON FUNCTION parent_boarding_placement(uuid, uuid) TO omnischools_app;
  END IF;
END $$;

-- ---- layer 1: parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql ----
-- 🔴 RUN THIS. It re-affirms RESTRICTIVE parent_deny on every FORCE-RLS + school_id table that does NOT
-- already carry a parent_scope policy. The two tables above now carry parent_scope, so they stay EXCLUDED;
-- every never-widen boarding table (boarding_bunk, boarding_dormitory, house, boarding_approved_visitor,
-- boarding_visit, boarding_visit_notification, boarding_exeat, exeat_notification, inspections,
-- prep_attendance, boarding_arrival, bunk_allocation, daily_schedule_template) and every other tenant table
-- (and any future one) stays auto-denied. Idempotent.
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
