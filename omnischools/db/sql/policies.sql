-- Row-Level Security for Omnischools (applied after migrations via scripts/apply-policies.ts).
--
-- Tenant isolation is enforced by RLS on every tenant table, keyed on the
-- `app.current_school` GUC set per-transaction (lib/db/rls.ts → withSchool).
--
-- Privileged, cross-tenant work (onboarding, identity lookups, ETL) sets the
-- `app.bypass_rls` GUC to 'on' for the transaction (withoutTenantScope); the
-- policies below honour that flag. This GUC approach is deliberately portable: it
-- needs NO `BYPASSRLS` role (Supabase's non-superuser `postgres` cannot create
-- one) and no superuser. The flag is only ever set by trusted server code in
-- withoutTenantScope — never from user input — so it cannot be forged by a request.
--
-- FORCE RLS is kept so even the table-owning connection role is subject to the
-- policies: a query that forgets to scope (no GUC set) returns zero rows — fails
-- safe — rather than leaking across tenants.
--
-- `omnischools_app` (NOSUPERUSER, no bypass) exists so scripts/rls-test.ts can
-- prove isolation as a non-privileged role even on a local superuser database.

-- ---- role (used by the RLS test; harmless in prod) ----
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnischools_app') THEN
    CREATE ROLE omnischools_app NOSUPERUSER NOINHERIT;
  END IF;
END
$$;

GRANT omnischools_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO omnischools_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO omnischools_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO omnischools_app;

-- ---- tenant-isolation policies ----
-- ref_school: a tenant sees only its own row (keyed on id).
ALTER TABLE ref_school ENABLE ROW LEVEL SECURITY;
ALTER TABLE ref_school FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ref_school;
CREATE POLICY tenant_isolation ON ref_school
  FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

-- All other tenant tables key on school_id.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'ref_school_product',
    'role_assignment',
    'staff_profile',
    'staff_compensation',
    'ref_academic_period_config',
    'academic_period',
    'school_holiday',
    'audit_log',
    'students',
    'student_guardian',
    'student_health_record',
    'household',
    'admission_application',
    'admission_document',
    'fee_category',
    'fee_structure',
    'fee_structure_item',
    'discount',
    'discount_tier',
    'invoice_discount_application',
    'invoice',
    'invoice_line_item',
    'payment',
    'payment_allocation',
    'receipt',
    'payment_audit_log',
    'class',
    'timetable_slot',
    'attendance_record',
    'attendance_correction',
    'attendance_settings',
    'subject',
    'gradebook_config',
    'gradebook_score',
    'gradebook_column',
    'gradebook_column_score',
    'grade_scale',
    'report_card',
    'house',
    'boarding_dormitory',
    'boarding_bunk',
    'bunk_allocation',
    'daily_schedule_template',
    'boarding_settings',
    'boarding_calendar_event',
    'boarding_exeat',
    'exeat_notification',
    'inspections',
    'prep_attendance',
    'boarding_arrival',
    'boarding_approved_visitor',
    'boarding_visit',
    'boarding_visit_notification',
    'boarding_infractions',
    'bond_artefacts',
    'deboardinization_records',
    'ref_assessment_weights',
    'senior_assessment',
    'senior_assessment_score',
    'senior_score_ledger',
    'senior_score_ledger_version',
    'senior_ledger_path',
    'senior_subject_teacher',
    'wassce_cohort',
    'wassce_programmes',
    'wassce_subjects',
    'wassce_candidates',
    'wassce_candidate_subject',
    'wassce_papers',
    'wassce_paper_sittings',
    'mock_exams',
    'mock_results',
    'benchmark_data_points',
    'waec_special_consideration',
    'readiness_statements',
    'university_targets',
    'announcement',
    'sms_template',
    'notification_log',
    'conversation',
    'inbox_message',
    'inbox_routing_rule',
    'whatsapp_template',
    'invite',
    'book_category',
    'book_entry',
    'fixed_asset'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO public '
      'USING (current_setting(''app.bypass_rls'', true) = ''on'' '
      '  OR school_id = NULLIF(current_setting(''app.current_school'', true), '''')::uuid) '
      'WITH CHECK (current_setting(''app.bypass_rls'', true) = ''on'' '
      '  OR school_id = NULLIF(current_setting(''app.current_school'', true), '''')::uuid);',
      tbl
    );
  END LOOP;
END
$$;

-- ---- global (non-tenant) tables ----
-- These have NO school_id, so the tenant_isolation policy above does not apply:
--   ref_region / ref_district / ref_role / ref_anomaly_rule / gen_period_defaults — global
--     reference data, read across tenants (often inside withSchool, GUC set, bypass off).
--   ref_user — identity table, read under withoutTenantScope during pre-tenant auth lookups.
--   marketing_lead — pre-signup demo-form leads, written with no tenant context at all.
--   benchmark_reference — WASSCE WAEC national + directional regional benchmarks (INCR-16 / 0052).
--     A benchmark exists for every tenant, so it is deliberately GLOBAL (no school_id, no tenant
--     isolation); "my cohort vs region/national" is DERIVED on read, never a stored cross-tenant join.
--   universities / university_programmes — the WASSCE university + cut-off reference (INCR-17b / 0054).
--     KNUST and its published cut-offs exist for every tenant, so both are deliberately GLOBAL (no
--     school_id, no tenant isolation) — a seeded published snapshot, read across tenants. Only the
--     per-candidate university_targets (above) is tenant data; the match band itself is derived on read.
-- We enable RLS but intentionally do NOT FORCE it and add NO policy. The postgres table
-- owner (the app's direct connection) is therefore exempt and keeps full access, while the
-- Data API roles (anon / authenticated) are denied — closing the anon-key exposure the
-- Supabase security advisor flags, without imposing tenant isolation on global data.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'ref_region',
    'ref_district',
    'ref_role',
    'ref_anomaly_rule',
    'gen_period_defaults',
    'ref_user',
    'marketing_lead',
    'benchmark_reference',
    'universities',
    'university_programmes'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
  END LOOP;
END
$$;

-- ============================================================================================
-- PARENT-PORTAL per-user read boundary (INCR-19a / Module 4.3). Kept in sync with
-- db/sql/prod-paste-0055-parent-linkage.sql — this block is dev; that file is the hand-paste on
-- PROD (⚠ RLS is NOT auto-applied on prod; without the paste the parent boundary is app-layer only,
-- the option Kofi explicitly rejected — Decision 13 mandates DB-layer enforcement).
--
-- MECHANISM. lib/db/rls.ts → withParentScope(schoolId, userId) sets TWO GUCs: `app.current_school`
-- (as withSchool) AND `app.current_parent_user`. Staff (withSchool) and escalated (withoutTenantScope)
-- sessions NEVER set the second GUC.
--
-- WHY RESTRICTIVE, NOT PERMISSIVE (the whole point). `tenant_isolation` above is PERMISSIVE and
-- Postgres OR's permissive policies, so it alone matches every row in the parent's school — a
-- PERMISSIVE parent policy would OR with it and let the parent read the ENTIRE school. So the parent
-- scope is expressed as `AS RESTRICTIVE` policies, which Postgres AND's with the permissive set: they
-- can only TIGHTEN. Every restrictive policy is guarded `pu IS NULL OR <rule>` where
-- pu = NULLIF(current_setting('app.current_parent_user', true), ''):
--   • staff / bypass session  → GUC unset → pu IS NULL → clause TRUE → TOTAL NO-OP (behaviour
--     byte-identical to before this block existed);
--   • parent session          → pu set → the <rule> decides, AND'd on top of tenant_isolation.
--
-- LAYERS (applied in the order below — scope FIRST, deny catalog LAST):
--   2. parent_scope — restrictive USING (pu IS NULL OR <child reaches this row>) on the small
--      readable set. Child reach goes through the SECURITY DEFINER helper parent_student_ids() so each
--      policy is one line and the student_guardian sub-select is not itself RLS-recursed. Created FIRST
--      so the deny catalog below can recognise (and skip) the readable set by its parent_scope policy.
--   1. parent_deny  — restrictive USING (pu IS NULL) on EVERY tenant table EXCEPT the readable set:
--      a parent session (pu set) → FALSE → ZERO rows. Deny-by-default (mock_results,
--      benchmark_data_points, university_targets, cohort aggregates, any other student, everything).
--      CATALOG-DRIVEN, not a hand-kept list: it is applied to every FORCE-RLS + school_id table that
--      lacks a parent_scope policy, so a new tenant table is auto-denied with no edit here (the fix for
--      Dex's BLOCK — the old 77-name array silently let student_health_record escape the boundary).
-- FOR ALL (USING doubles as WITH CHECK): parent_deny tables are read+write locked; there is no parent
-- write path anywhere (Kofi R4), so the scope tables' WITH CHECK is left = USING (no app writes ever
-- run inside withParentScope). ref_school (keyed on id, handled at the top of this file) is left
-- readable to the parent — their OWN school row only, no other-student PII — the portal header needs
-- it; it is deliberately NOT in the deny suite.

-- ---- SECURITY DEFINER helper: the parent's own children in one school ----
-- The ONE sanctioned SECURITY DEFINER exception (portability note): it lets every parent_scope policy
-- read student_guardian in a single line without RLS-recursing that sub-select. Its WHERE clause
-- (user_id = pu AND school_id = school) makes the result correct whether or not RLS applies inside it,
-- so it is robust across the dev superuser DB and the Supabase non-superuser owner. STABLE (reads a
-- table), explicit search_path (no mutable-search_path advisor finding). NOT a business-logic trigger
-- — it is a pure lookup used only by RLS predicates.
CREATE OR REPLACE FUNCTION parent_student_ids(school uuid, pu uuid)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT student_id
  FROM student_guardian
  WHERE user_id = pu
    AND school_id = school
    AND user_id IS NOT NULL
$$;

-- ---- layer 2 FIRST, then layer 1: parent_scope is created BEFORE the parent_deny catalog loop so
-- that the loop can SKIP the readable set by testing "does this table already have a parent_scope
-- policy?". (Semantically parent_deny is still "layer 1" — deny-by-default — but it must run AFTER the
-- 9 scope policies exist so the catalog can exclude them.) ----

-- ---- layer 2: parent_scope on the parent-readable set (overrides the parent_deny catalog below) ----
-- students — only the parent's own children.
DROP POLICY IF EXISTS parent_deny ON students;
DROP POLICY IF EXISTS parent_scope ON students;
CREATE POLICY parent_scope ON students AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR id IN (
      SELECT parent_student_ids(
        school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
    )
  );

-- student_guardian — ONLY the parent's OWN guardian row (never a co-guardian of the same child).
DROP POLICY IF EXISTS parent_deny ON student_guardian;
DROP POLICY IF EXISTS parent_scope ON student_guardian;
CREATE POLICY parent_scope ON student_guardian AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR user_id = NULLIF(current_setting('app.current_parent_user', true), '')::uuid
  );

-- wassce_candidates — the child's candidate row.
DROP POLICY IF EXISTS parent_deny ON wassce_candidates;
DROP POLICY IF EXISTS parent_scope ON wassce_candidates;
CREATE POLICY parent_scope ON wassce_candidates AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR student_id IN (
      SELECT parent_student_ids(
        school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
    )
  );

-- wassce_paper_sittings — sittings of the child's candidates.
DROP POLICY IF EXISTS parent_deny ON wassce_paper_sittings;
DROP POLICY IF EXISTS parent_scope ON wassce_paper_sittings;
CREATE POLICY parent_scope ON wassce_paper_sittings AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR candidate_id IN (
      SELECT c.id FROM wassce_candidates c
      WHERE c.school_id = wassce_paper_sittings.school_id
        AND c.student_id IN (
          SELECT parent_student_ids(
            c.school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
        )
    )
  );

-- wassce_papers — ONLY the papers the child actually sits (NOT the cohort-wide table; Lucy leak #1).
DROP POLICY IF EXISTS parent_deny ON wassce_papers;
DROP POLICY IF EXISTS parent_scope ON wassce_papers;
CREATE POLICY parent_scope ON wassce_papers AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR id IN (
      SELECT s.paper_id FROM wassce_paper_sittings s
      WHERE s.school_id = wassce_papers.school_id
        AND s.candidate_id IN (
          SELECT c.id FROM wassce_candidates c
          WHERE c.school_id = wassce_papers.school_id
            AND c.student_id IN (
              SELECT parent_student_ids(
                wassce_papers.school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
            )
        )
    )
  );

-- waec_special_consideration — the child's SC filings (row-scoped to the child's candidates; the
-- DRAFT-hiding + notes/filed_by_user_id column redaction is the parent loader's job — RLS is
-- row-level and cannot mask columns).
DROP POLICY IF EXISTS parent_deny ON waec_special_consideration;
DROP POLICY IF EXISTS parent_scope ON waec_special_consideration;
CREATE POLICY parent_scope ON waec_special_consideration AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR candidate_id IN (
      SELECT c.id FROM wassce_candidates c
      WHERE c.school_id = waec_special_consideration.school_id
        AND c.student_id IN (
          SELECT parent_student_ids(
            waec_special_consideration.school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
        )
    )
  );

-- readiness_statements — the CURRENT statement only (superseded_at IS NULL); a parent must never see
-- a superseded projection.
DROP POLICY IF EXISTS parent_deny ON readiness_statements;
DROP POLICY IF EXISTS parent_scope ON readiness_statements;
CREATE POLICY parent_scope ON readiness_statements AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR (
      superseded_at IS NULL
      AND candidate_id IN (
        SELECT c.id FROM wassce_candidates c
        WHERE c.school_id = readiness_statements.school_id
          AND c.student_id IN (
            SELECT parent_student_ids(
              readiness_statements.school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
          )
      )
    )
  );

-- conversation — threads about the child AND on the parent's OWN stored phone (a co-guardian's thread
-- must not appear). NULL-student threads are excluded (NULL IN (...) is not TRUE).
DROP POLICY IF EXISTS parent_deny ON conversation;
DROP POLICY IF EXISTS parent_scope ON conversation;
CREATE POLICY parent_scope ON conversation AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR (
      student_id IN (
        SELECT parent_student_ids(
          school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
      )
      AND contact_phone IN (
        SELECT g.phone FROM student_guardian g
        WHERE g.school_id = conversation.school_id
          AND g.user_id = NULLIF(current_setting('app.current_parent_user', true), '')::uuid
      )
    )
  );

-- inbox_message — reaches the child (and the parent's own phone) through its conversation.
DROP POLICY IF EXISTS parent_deny ON inbox_message;
DROP POLICY IF EXISTS parent_scope ON inbox_message;
CREATE POLICY parent_scope ON inbox_message AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR conversation_id IN (
      SELECT cv.id FROM conversation cv
      WHERE cv.school_id = inbox_message.school_id
        AND cv.student_id IN (
          SELECT parent_student_ids(
            inbox_message.school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
        )
        AND cv.contact_phone IN (
          SELECT g.phone FROM student_guardian g
          WHERE g.school_id = inbox_message.school_id
            AND g.user_id = NULLIF(current_setting('app.current_parent_user', true), '')::uuid
        )
    )
  );

-- ---- layer 1: parent_deny on every tenant table EXCEPT the parent-readable set (CATALOG-DRIVEN) ----
-- This USED to be a hand-maintained 77-name array; a new tenant table that got tenant_isolation but was
-- forgotten here escaped the parent boundary silently (Dex BLOCK; student_health_record was the leak).
-- It is now DISCOVERED, not listed: every table that is FORCE-RLS AND has a `school_id` column AND does
-- NOT already carry a parent_scope policy gets parent_deny. The discovery is byte-identical to the tenant
-- probe in scripts/rls-test.ts (pg_class.relforcerowsecurity + a school_id attribute), so a FUTURE tenant
-- table is auto-denied with ZERO code change here. Because the 9 parent_scope policies are created ABOVE,
-- the NOT EXISTS(parent_scope) filter excludes exactly the readable set — reproducing the 77-deny/9-scope
-- end state today, plus any newly-added tenant table (student_health_record included).
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
