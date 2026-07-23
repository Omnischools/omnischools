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
    'sickbay_settings',
    'sickbay_bed',
    'sickbay_schedule_slot',
    'sickbay_visit',
    'sickbay_vital_reading',
    'sickbay_admission',
    'sickbay_doctor_consult',
    'sickbay_chronic_entry',
    'sickbay_chronic_med',
    'sickbay_chronic_grant',
    'sickbay_chronic_read',
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
-- table), explicit search_path. NOT a business-logic trigger — it is a pure lookup used only by RLS
-- predicates.
--
-- 🔴 `search_path = public, pg_temp` AND NOT `= public` (Sarah MEDIUM-2, verified end-to-end on the
-- chronic helpers and true here identically). When `pg_temp` is not named EXPLICITLY, Postgres
-- searches the session's temp schema FIRST for relations — so any session that can run arbitrary SQL
-- does `create temp table student_guardian (...)`, inserts whatever rows it likes, and this SECURITY
-- DEFINER function resolves the fake table and hands the caller a set of student ids it chose. Naming
-- pg_temp LAST pins the resolution order to public. The precondition is SQL injection, i.e. this is
-- defence in depth — but RLS is precisely the layer that has to survive an injection.
CREATE OR REPLACE FUNCTION parent_student_ids(school uuid, pu uuid)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
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

-- ============================================================================================
-- CHRONIC-REGISTER per-staff read boundary (INCR-23a / Module 4.4) — THE THIRD RLS BOUNDARY.
-- Kept in sync with db/sql/prod-paste-0058-sickbay-chronic.sql — this block is dev; that file is the
-- hand-paste on PROD (⚠ RLS is NOT auto-applied on prod; without the paste these four tables have no
-- boundary at all and every school's chronic care plans are readable from every other school's
-- session).
--
-- MECHANISM. lib/db/rls.ts → withStaffScope(schoolId, userId) sets TWO GUCs: `app.current_school`
-- (as withSchool) AND `app.current_staff_user`. It wraps READS **AND WRITES** — unlike the parent
-- seam, which is read-only by contract.
--
-- 🔴 THE POLARITY IS THE INVERSE OF THE PARENT FAMILY, AND THAT IS THE POINT (Kofi R112).
--   parent family:  USING (pu IS NULL OR  <rule>)   -- PERMIT by default
--   this family:    USING (su IS NOT NULL AND <rule>) -- DENY by default
-- Permit-by-default is correct for the parent boundary because those tables' default audience IS all
-- staff, so an unset GUC must be a no-op. The chronic tables have NO default audience: nobody reads
-- them except a MATRON, a HEADMASTER (minus MENTAL_HEALTH) or a named grantee. Once the register's
-- route is widened to every staff member (R117), `su IS NULL ⇒ permit` would mean one forgotten seam
-- hands a HOUSEMASTER the whole register; under deny-by-default the same bug yields an empty page.
-- ⚠ PR #176 is the PROOF this is the right call, not a style preference: a claimed parent read
-- children's medications because `parent_deny`'s permit-by-default clause met an unset GUC on a
-- staff-shaped page. Do not "fix" the asymmetry; it is load-bearing in the opposite direction.
--
-- WHY RESTRICTIVE (identical reasoning to the parent block): tenant_isolation is PERMISSIVE and
-- Postgres OR's permissive policies, so a permissive staff policy would OR with it and hand every
-- staff session the whole register. RESTRICTIVE policies are AND'ed — they can only TIGHTEN.
--
-- ⚠ NO POLICY CYCLES. RLS applies to tables referenced inside a policy expression, INCLUDING inside
-- a SECURITY DEFINER function (FORCE RLS binds the owner too), so a policy on A that reads B while
-- B's policy reads A is an infinite recursion at runtime, not a clever design. The dependency graph
-- here is deliberately acyclic and must stay that way:
--     sickbay_chronic_entry  → chronic_entry_readable → sickbay_chronic_grant → role_assignment
--     sickbay_chronic_med    → chronic_entry_ids → sickbay_chronic_entry → (as above)
--     sickbay_chronic_read   → chronic_entry_ids → (as above)
--     sickbay_chronic_grant  → role_assignment ONLY (it must never read the entry table)
--
-- 🔴 R129 — HOW THE GRANT TABLE HONOURS R116 WITHOUT READING THE ENTRY. The grant policy cannot ask
-- "is this entry MENTAL_HEALTH?" — that read closes the cycle above. So the entry publishes the ONE
-- BIT the policy needs, and every grant row is PINNED to it by the FK:
--     sickbay_chronic_entry.hm_restricted  boolean GENERATED ALWAYS AS (condition = 'MENTAL_HEALTH')
--                                          STORED, + UNIQUE (school_id, id, hm_restricted)
--     sickbay_chronic_grant.hm_restricted  boolean NOT NULL, FK (school_id, entry_id, hm_restricted)
--                                          → that UNIQUE, ON UPDATE CASCADE
-- The grant policy then reads `hm_restricted` off its OWN row — no entry read, no cycle — and a
-- HEADMASTER gets ZERO grant rows against an entry his default read excludes.
-- ⚠ WHY A PLAIN INSERT-TIME BOOLEAN IS NOT ENOUGH, and this is the whole point: it FAILS OPEN on
-- re-classification. A grant stamped `false` against an entry later corrected to MENTAL_HEALTH would
-- stay Headmaster-visible forever. Under the FK the DB propagates the flip (ON UPDATE CASCADE) and a
-- dishonest stamp is an FK VIOLATION AT INSERT rather than a silent leak — a stored value that cannot
-- disagree with its source, which is what R10 requires. It is named for the POLICY FACT, never the
-- diagnosis, so the string `MENTAL_HEALTH` never lands on a grant row.
-- The earlier claim that the residue was harmless ("no student, no condition, no name") was WRONG on
-- the facts of this table: `scope_label`, `reason` and `directive_note` are matron-authored free text
-- (the last one CHECK-forced non-null for DIRECTIVE grants), and `entry_id` alone let a barred
-- HEADMASTER COUNT the entries he cannot see — the literal negation of R116/E18.
--
-- WHY THE FUNCTIONS TAKE THE GUC, NOT `school_id` FROM THE ROW (Wells, OQ1 #3). The parent family
-- passes the row's `school_id` into parent_student_ids(), which makes the sub-select CORRELATED:
-- Postgres must re-evaluate it once per candidate row. Here the school is read from the GUC instead,
-- so `entry_id IN (SELECT chronic_entry_ids(<const>, <const>))` is UNCORRELATED and is evaluated
-- ONCE per query as an InitPlan. It is exactly equivalent: tenant_isolation already forces
-- school_id = the GUC on every row that can survive, and under bypass the first OR arm short-circuits
-- the whole policy. Verified with EXPLAIN, not assumed.

-- ---- SECURITY DEFINER helper 1: which DEFAULT clinical tier does this staff user hold? ----
-- 'MATRON' (all entries) | 'HEADMASTER' (all except MENTAL_HEALTH — R116) | NULL (neither).
-- SECURITY DEFINER because it joins the GLOBAL ref_role, which carries bare ENABLE RLS and NO policy:
-- a non-owner role reads ZERO rows from it, so an inline join in a policy would silently evaluate to
-- "no role" for the very session it is meant to authorise. The date window is byte-equivalent to
-- lib/auth/roles.ts isCurrentlyActive() — BOTH endpoints inclusive; a `>` instead of `>=` would lock
-- out every matron on her last day of service.
--
-- 🔴 `search_path = public, pg_temp`, NEVER `= public` (Sarah MEDIUM-2, verified: it was a working
-- privilege escalation). Postgres searches the session's TEMP schema first for RELATIONS unless
-- pg_temp is named explicitly, so a TEACHER who can run one statement does
-- `create temp table role_assignment(...); create temp table ref_role(...)`, inserts a fake MATRON
-- row, and this function returns 'MATRON' for him — the whole register, both drug names. Naming
-- pg_temp LAST pins resolution to public. Same fix on all three helpers and on parent_student_ids().
CREATE OR REPLACE FUNCTION chronic_clinical_role(school uuid, su uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT CASE
           WHEN bool_or(r.code = 'MATRON')     THEN 'MATRON'
           WHEN bool_or(r.code = 'HEADMASTER') THEN 'HEADMASTER'
         END
  FROM role_assignment ra
  JOIN ref_role r ON r.id = ra.role_id
  WHERE ra.user_id = su
    AND ra.school_id = school
    AND ra.start_date <= current_date
    AND (ra.end_date IS NULL OR ra.end_date >= current_date)
$$;

-- ---- SECURITY DEFINER helper 2: THE PREDICATE. May `su` read THIS entry? ----
-- Written ONCE and used at every enforcement point (R113: "one predicate, two enforcement points,
-- zero divergence"). It takes the entry's id, student and condition as ARGUMENTS rather than reading
-- the entry table, because the policy that calls it IS the entry table's policy — reading the table
-- from inside its own policy is the recursion described above.
--   (a) MATRON      → every entry in the school.
--   (b) HEADMASTER  → every entry EXCEPT MENTAL_HEALTH (R116, structural: his SQL cannot return the
--                     row whatever the reader does).
--   (c) a live GRANT on THIS entry (R105 — per entry, never per student). Live means: not revoked,
--       not expired against the DB's own now() IN THIS TRANSACTION (R114 — never a session claim,
--       never middleware), and — when the grant is house-tied (R107) — the grantee is still that
--       House's HM and the student is still in that House. That last clause is the whole of
--       "auto-expire yes, auto-grant no": one nullable column, no new mechanism, and the grant dies
--       the moment either fact changes.
CREATE OR REPLACE FUNCTION chronic_entry_readable(
    school uuid, su uuid, entry uuid, student uuid, cond chronic_condition)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT su IS NOT NULL AND (
    chronic_clinical_role(school, su) = 'MATRON'
    OR (chronic_clinical_role(school, su) = 'HEADMASTER' AND cond <> 'MENTAL_HEALTH')
    OR EXISTS (
      SELECT 1
      FROM sickbay_chronic_grant g
      WHERE g.school_id = school
        AND g.entry_id = entry
        AND g.grantee_user_id = su
        AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR g.expires_at > now())
        AND (
          g.house_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM house h
            JOIN students s ON s.school_id = h.school_id AND s.id = student
            WHERE h.school_id = school
              AND h.id = g.house_id
              AND h.hm_user_id = su
              AND s.house_id = g.house_id
          )
        )
    )
  )
$$;

-- ---- SECURITY DEFINER helper 3: the readable entry ids, as a set ----
-- A thin projection of helper 2 over the entry table — the child tables (med / grant metadata / read
-- audit) carry no `condition` of their own, so they reach the discriminator through the entry. THIS
-- is the function the reader calls (R113): the row filter in lib/ MUST be this same predicate pushed
-- into SQL as an `EXISTS`/`IN` inside the same withStaffScope transaction. Never over-fetch and
-- filter in TS (the row is materialised before it is authorised); never a per-row hasGrant (R68's
-- N+1). ⚠ A naive `EXISTS (SELECT 1 FROM sickbay_chronic_grant …)` written directly in the reader
-- does NOT work and fails CLOSED in the most confusing way: RLS applies to the reader's own
-- subquery, so use this function.
CREATE OR REPLACE FUNCTION chronic_entry_ids(school uuid, su uuid)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT e.id
  FROM sickbay_chronic_entry e
  WHERE e.school_id = school
    AND chronic_entry_readable(school, su, e.id, e.student_id, e.condition)
$$;

-- ---- helper EXECUTE: the app role only (Sarah L3) ----
-- On Supabase every function in `public` is exposed as a PostgREST RPC and EXECUTE defaults to PUBLIC.
-- These three return nothing useful without the GUCs, so this is hardening rather than a hole — but a
-- SECURITY DEFINER function that reads the chronic register has no business being callable by anon.
-- ⚠ Quinn: do NOT build an AC on a direct helper call; on DEV the owner is a superuser, so the
-- function BODY bypasses RLS entirely and `chronic_entry_ids()` is a cross-tenant oracle with no GUCs
-- set at all. That closes on prod (non-superuser owner), which is why probes must be run under
-- prod-shaped ownership before they mean anything (Sarah L1).
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'chronic_clinical_role(uuid, uuid)',
    'chronic_entry_readable(uuid, uuid, uuid, uuid, chronic_condition)',
    'chronic_entry_ids(uuid, uuid)'
  ]
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC;', fn);
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnischools_app') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO omnischools_app;', fn);
    END IF;
  END LOOP;
END
$$;

-- ---- the four staff_grant_scope policies ----
-- Each carries the `app.bypass_rls` arm FIRST and byte-identical to tenant_isolation's, so seeds,
-- ETL and withoutTenantScope behave exactly as they do on every other table (and so the recursion
-- into the helper functions is short-circuited on escalated paths).

-- 1) the care plan itself. USING = the predicate. WITH CHECK is DELIBERATELY DIFFERENT and must be:
-- a WITH CHECK is evaluated on the NEW row BEFORE it exists, so any rule of the form "you may read
-- this entry" is FALSE for every INSERT and no matron could ever create a care plan. The write rule
-- is therefore actor-shaped, which also stops a FULL_PLAN grantee (a sports master) from EDITING the
-- plan he was shown.
--
-- 🔴 `= 'MATRON'`, NOT `IS NOT NULL` (Sarah HIGH-1 / Kofi, independently). `IS NOT NULL` means MATRON
-- *or HEADMASTER*, but R39 says clinical write is MATRON-only and R111 says grant/revoke is
-- MATRON-only. USING is the READ predicate and an INSERT never touches it — so under `IS NOT NULL` a
-- HEADMASTER barred from a MENTAL_HEALTH entry inserted one grant naming himself and then read the
-- entry, its protocol and its drug. Four places carry this token: the three WITH CHECKs and the
-- staff_grant_delete loop. Nothing legitimate breaks — the helper already prefers 'MATRON' when a
-- user holds both roles, and seeds/ETL run under bypass.
DROP POLICY IF EXISTS staff_grant_scope ON sickbay_chronic_entry;
CREATE POLICY staff_grant_scope ON sickbay_chronic_entry AS RESTRICTIVE FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND chronic_entry_readable(
            NULLIF(current_setting('app.current_school', true), '')::uuid,
            NULLIF(current_setting('app.current_staff_user', true), '')::uuid,
            id, student_id, condition)
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND chronic_clinical_role(
            NULLIF(current_setting('app.current_school', true), '')::uuid,
            NULLIF(current_setting('app.current_staff_user', true), '')::uuid) = 'MATRON'
    )
  );

-- 2) the medication schedule — drug names, the single most re-identifying string in the module
-- (hydroxyurea ⇒ sickle cell). Reachable exactly when its entry is; writable only by a clinical
-- reader, so a grantee cannot inject or edit a dose.
DROP POLICY IF EXISTS staff_grant_scope ON sickbay_chronic_med;
CREATE POLICY staff_grant_scope ON sickbay_chronic_med AS RESTRICTIVE FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND entry_id IN (
        SELECT chronic_entry_ids(
          NULLIF(current_setting('app.current_school', true), '')::uuid,
          NULLIF(current_setting('app.current_staff_user', true), '')::uuid)
      )
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND chronic_clinical_role(
            NULLIF(current_setting('app.current_school', true), '')::uuid,
            NULLIF(current_setting('app.current_staff_user', true), '')::uuid) = 'MATRON'
      AND entry_id IN (
        SELECT chronic_entry_ids(
          NULLIF(current_setting('app.current_school', true), '')::uuid,
          NULLIF(current_setting('app.current_staff_user', true), '')::uuid)
      )
    )
  );

-- 3) the grants themselves (R122 — §04 is clinical-reader-only: a grantee must never learn who ELSE
-- knows). A grantee sees his OWN grant row and nothing else — the student_guardian/parent_scope
-- idiom, and it is REQUIRED, not a courtesy: helper 2 reads this table to evaluate his entitlement,
-- so a blanket clinical-only rule here would make every grant self-defeating (R113's trap).
-- WITH CHECK excludes him from writing, which is what makes X10/X11 hold at the DB layer: he cannot
-- self-issue a grant and he cannot extend his own expiry.
--
-- 🔴 R129 — the HEADMASTER arm is `AND NOT hm_restricted`, read off THIS ROW. That is the whole of
-- the fix: the policy honours R116 on the grant table with NO read of the entry table, so the graph
-- stays acyclic, and `hm_restricted` cannot lie because the FK pins it (see the header). A HEADMASTER
-- now gets ZERO rows here for a MENTAL_HEALTH entry — no entry_id to enumerate, no `reason`, no
-- `directive_note`, and no count of the entries he cannot see.
-- The grantee arm survives untouched and MUST: chronic_entry_readable() reads this table to evaluate
-- his entitlement, so a clinical-only rule would make every grant self-defeating. He still sees ONLY
-- his own rows (R122 — he never learns who else knows), whatever hm_restricted says: a matron
-- granting him the entry is her explicit decision, and R116 carves out the DEFAULT read, not a grant.
DROP POLICY IF EXISTS staff_grant_scope ON sickbay_chronic_grant;
CREATE POLICY staff_grant_scope ON sickbay_chronic_grant AS RESTRICTIVE FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND (
        chronic_clinical_role(
          NULLIF(current_setting('app.current_school', true), '')::uuid,
          NULLIF(current_setting('app.current_staff_user', true), '')::uuid) = 'MATRON'
        OR (
          chronic_clinical_role(
            NULLIF(current_setting('app.current_school', true), '')::uuid,
            NULLIF(current_setting('app.current_staff_user', true), '')::uuid) = 'HEADMASTER'
          AND NOT hm_restricted
        )
        OR grantee_user_id = NULLIF(current_setting('app.current_staff_user', true), '')::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND chronic_clinical_role(
            NULLIF(current_setting('app.current_school', true), '')::uuid,
            NULLIF(current_setting('app.current_staff_user', true), '')::uuid) = 'MATRON'
    )
  );

-- 4) the read audit (R121/R122). ASYMMETRIC ON PURPOSE: every reader must be able to WRITE his own
-- open (the matron's own opens are audited too), but only a clinical reader may READ the trail — a
-- grantee learning who else opened the plan is the leak R122 names. Because USING governs SELECT,
-- UPDATE and DELETE while WITH CHECK governs INSERT, this single policy also makes the trail
-- append-only against a grantee: he can add his own row and can neither read, alter nor delete one.
--
-- 🔴 `AND actor_user_id = <the staff GUC>` in WITH CHECK (Sarah MEDIUM-1, verified exploit). Without
-- it the WITH CHECK never says WHOSE row this is, so a grantee inserted an audit row ATTRIBUTED TO
-- THE HEADMASTER — into a log he cannot read back. `actor_user_id` FKs the GLOBAL ref_user, so the
-- forged actor need not even belong to this school. An oversight trail anyone can write in anyone
-- else's name is worse than no trail: it is evidence that reads as authentic.
DROP POLICY IF EXISTS staff_grant_scope ON sickbay_chronic_read;
CREATE POLICY staff_grant_scope ON sickbay_chronic_read AS RESTRICTIVE FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND chronic_clinical_role(
            NULLIF(current_setting('app.current_school', true), '')::uuid,
            NULLIF(current_setting('app.current_staff_user', true), '')::uuid) IS NOT NULL
      AND entry_id IN (
        SELECT chronic_entry_ids(
          NULLIF(current_setting('app.current_school', true), '')::uuid,
          NULLIF(current_setting('app.current_staff_user', true), '')::uuid)
      )
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND actor_user_id = NULLIF(current_setting('app.current_staff_user', true), '')::uuid
      AND entry_id IN (
        SELECT chronic_entry_ids(
          NULLIF(current_setting('app.current_school', true), '')::uuid,
          NULLIF(current_setting('app.current_staff_user', true), '')::uuid)
      )
    )
  );

-- ---- the read audit is APPEND-ONLY AGAINST EVERYONE, including the matron (Sarah MEDIUM-1) ----
-- staff_grant_scope's USING governs SELECT *and* UPDATE *and* DELETE, so a clinical reader could
-- UPDATE or DELETE trail rows — i.e. a matron could delete the audit of her own opens, which is the
-- single thing §04 exists to prevent. These two make the table insert-only outside bypass. They are
-- RESTRICTIVE, so they AND with everything else; bypass is the only escape (retention purges, ETL),
-- and Sarah L4 stands: a chronic table inside withoutTenantScope is an automatic review trigger.
DROP POLICY IF EXISTS staff_grant_delete ON sickbay_chronic_read;
CREATE POLICY staff_grant_delete ON sickbay_chronic_read AS RESTRICTIVE FOR DELETE TO public
  USING (current_setting('app.bypass_rls', true) = 'on');
DROP POLICY IF EXISTS staff_grant_freeze ON sickbay_chronic_read;
CREATE POLICY staff_grant_freeze ON sickbay_chronic_read AS RESTRICTIVE FOR UPDATE TO public
  USING (current_setting('app.bypass_rls', true) = 'on');

-- ---- staff_grant_delete: DELETE is the one command a WITH CHECK cannot reach ----
-- A grantee's USING clause legitimately matches the rows he may READ, and DELETE is authorised by
-- USING alone — so without this, a FULL_PLAN grantee could delete the care plan he was shown, and a
-- grantee could delete his own grant row and erase the evidence that he ever had access (R110 makes
-- that trail append-only). Three tables, one identical rule: destructive commands require a MATRON —
-- `= 'MATRON'`, not `IS NOT NULL`, because R39/R111 keep the Headmaster out of clinical writes and
-- out of grant/revoke, and a DELETE is the most destructive write there is (Sarah HIGH-1, the fourth
-- of its four places). sickbay_chronic_read is handled separately above: bypass only, no exceptions.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'sickbay_chronic_entry',
    'sickbay_chronic_med',
    'sickbay_chronic_grant'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS staff_grant_delete ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY staff_grant_delete ON %I AS RESTRICTIVE FOR DELETE TO public '
      'USING (current_setting(''app.bypass_rls'', true) = ''on'' '
      '  OR (NULLIF(current_setting(''app.current_staff_user'', true), '''') IS NOT NULL '
      '      AND chronic_clinical_role('
      '            NULLIF(current_setting(''app.current_school'', true), '''')::uuid,'
      '            NULLIF(current_setting(''app.current_staff_user'', true), '''')::uuid) = ''MATRON''));',
      tbl
    );
  END LOOP;
END
$$;
