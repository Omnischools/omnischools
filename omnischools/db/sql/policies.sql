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
    'user_school_block',
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
    'student_subject_enrolment',
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
    'sickbay_standing_order',
    'sickbay_stock_item',
    'sickbay_med_admin',
    'sickbay_controlled_movement',
    'sickbay_hospital',
    'student_nhis_card',
    'sickbay_referral',
    'sickbay_referral_update',
    'sickbay_referral_cost_line',
    'sickbay_notification',
    'vlc_programme',
    'vlc_value',
    'vlc_session_template',
    'vlc_peer_guide',
    'vlc_training',
    'vlc_training_absence',
    'vlc_session',
    'vlc_session_attendance',
    'vlc_pastoral_flag',
    'vlc_pastoral_journal',
    'vlc_pastoral_note',
    'vlc_pastoral_observation',
    'vlc_pastoral_case',
    'vlc_pastoral_paragraph',
    'plc_programme',
    'plc',
    'plc_membership',
    'plc_term_focus',
    'plc_session',
    'plc_session_attendance',
    'plc_session_reflection',
    'plc_cpd_ledger',
    'pta_tiers_config',
    'ptas',
    'pta_dues_config_history',
    'pta_officer',
    'pta_meeting',
    'pta_meeting_attendance',
    'pta_minutes',
    'pta_agenda_item',
    'pta_action_item',
    'pta_resolution',
    'pta_dues_charge',
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
    'fixed_asset',
    'terminal_exam_result',
    'facilities_snapshot',
    'census_return',
    'sen_register',
    'sen_module_adoption'
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

-- ---- INCR-29: the FIRST widening of the 19a parent boundary since it shipped (9 → 11 parent_scope
-- tables). A parent gains ROW access to their own child's sickbay_admission + sickbay_referral so the
-- read-only parent portal (lib/parent/parent-sickbay-data.ts) can show on-site/referred-out status.
-- Kept in sync with db/sql/prod-paste-0064-parent-sickbay-scope.sql — this block is DEV; that file is
-- the hand-paste on PROD (⚠ RLS is NOT auto-applied on prod; without the paste these two tables keep
-- parent_deny and the parent tab is an honest empty state — fail-closed, never a leak).
--
-- 🔴 MECHANISM (Kofi R231, WELLS's call): table-level parent_scope on these TWO tables ONLY, byte-shaped
-- like the 9 policies above. A VIEW that keeps the base tables parent_deny (Option 3) was REJECTED: it
-- is non-functional under this repo's FORCE-RLS + single shared app role + no-BYPASSRLS model. Proven on
-- dev — a security_invoker view returns 0 rows to a parent (the invoker hits parent_deny), and a plain
-- view returns rows ONLY because the LOCAL owner is a superuser that bypasses RLS (a dev-only illusion;
-- on prod the non-superuser owner under FORCE returns 0 → a permanently empty tab). Making a view work
-- requires opening the base tables anyway, at which point the columns are reachable and the view buys no
-- DB-enforced column control. So RLS opens the ROW; the reader's frozen key-set projection (R229) is the
-- SOLE column control (MEDIUM-3).
--
-- ⚠ CLASS-4 ADJACENCY (flagged to Sarah). RLS is row-level and CANNOT mask columns: an in-scope parent
-- session CAN select sickbay_referral.menses_note (Class-4 reproductive PII, F5) and the ER handoff
-- snapshot (reason_referred_out / handoff_labs / last_meal / travel_note) off the reachable row. The
-- reader's frozen projection is the only guard against those columns reaching the wire. NO other sickbay
-- table gains parent_scope — the catalog parent_deny loop below auto-excludes exactly these two (they
-- now carry parent_scope) and re-affirms parent_deny on every other sickbay table with ZERO edits.
--
-- OPEN-STATE is the READER's job (R230), NOT RLS: RLS scopes by child, so the parent's own child's
-- CLOSED admission (discharged_at set) and RETURNED/VOIDED referral rows ARE returned here — the loader
-- filters to the current-open set.

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

-- ---- INCR-32: the THIRD widening of the 19a parent boundary (11 → 12 parent_scope tables), owner
-- decision D8. A parent gains ROW access to their own child's ONE NHIS-card row so the read-only parent
-- portal (lib/parent/parent-nhis-data.ts) can show the card's STATUS + EXPIRY ONLY — never the membership
-- number (owner call; Active/Expiring/Expired/Unknown is derived from valid_to in lib/). Kept in sync with
-- db/sql/prod-paste-0065-parent-nhis-scope.sql — this block is DEV;
-- that file is the hand-paste on PROD (⚠ RLS is NOT auto-applied on prod; without the paste
-- student_nhis_card keeps parent_deny and the parent NHIS panel is an honest empty state — fail-closed,
-- never a leak).
--
-- Same table-level parent_scope mechanism as INCR-29 above, byte-shaped like the 11 policies before it.
-- student_nhis_card carries student_id DIRECTLY (beneficiary singleton, composite (school_id, student_id)
-- FK). RLS opens the ROW; the reader's frozen {status, validTo} projection (R255) is the SOLE column control. The
-- catalog parent_deny loop below auto-excludes student_nhis_card (it now carries parent_scope) and
-- re-affirms parent_deny on every other sickbay table — sickbay_notification and sickbay_referral_cost_line
-- included — with ZERO edits.

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

-- ---- INCR-46: the FOURTH widening of the 19a parent boundary (12 → 13 parent_scope tables) and the
-- FIRST break in owner-#4 ("parents see NOTHING VLC-wide") — owner-authorised (2026-07-30). A parent
-- gains ROW access to EXACTLY ONE row: their OWN child's FINALISED vlc_pastoral_paragraph, so the
-- read-only parent portal (lib/parent/parent-reference-data.ts, a card on the /wassce tab) can show the
-- FM-authored school-leaver character reference. Kept in sync with
-- db/sql/prod-paste-0073-parent-leaver-paragraph-scope.sql — this block is DEV; that file is the
-- hand-paste on PROD (⚠ RLS is NOT auto-applied on prod; without the paste vlc_pastoral_paragraph keeps
-- parent_deny and the parent card is an honest empty state — fail-closed, never a leak).
--
-- 🔴 MECHANISM: table-level parent_scope on vlc_pastoral_paragraph ONLY, byte-shaped like the 12 policies
-- above PLUS the readiness_statements STATE restriction (superseded_at IS NULL there → locked_at IS NOT
-- NULL here). The table carries student_id + school_id + locked_at DIRECTLY, so the scope is the simplest
-- child-reach form, gated by the finalised state. FINALISED-only lives IN the predicate — a DRAFT
-- (locked_at IS NULL) is NEVER visible to a parent (the crux) — and is re-filtered in the reader
-- (belt-and-suspenders for a confidential widening). The reader projects body + the student/school name +
-- the paragraph's OWN FM author name (all non-confidential; NEVER severity/context/surfaced_by or any
-- casework/journal body): RLS opens the ROW, the reader's frozen key-set is the column control (the 19a
-- discipline). USING doubles as
-- WITH CHECK, so a parent write is confined to the same finalised-own-child scope — no draft insert, no
-- unlock, no cross-child write. EVERY OTHER vlc_* table keeps parent_deny — the catalog loop below
-- auto-excludes ONLY this one (it now carries parent_scope) and re-affirms parent_deny on the other 13
-- (flag/journal/note/observation/case/session/session_attendance/programme/value/session_template/
-- peer_guide/training/training_absence) with ZERO edits.

-- vlc_pastoral_paragraph — the parent reads their OWN child's FINALISED leaver paragraph (drafts never).
DROP POLICY IF EXISTS parent_deny ON vlc_pastoral_paragraph;
DROP POLICY IF EXISTS parent_scope ON vlc_pastoral_paragraph;
CREATE POLICY parent_scope ON vlc_pastoral_paragraph AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR (
      locked_at IS NOT NULL
      AND student_id IN (
        SELECT parent_student_ids(
          school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
      )
    )
  );

-- ---- INCR-55a: the FIFTH widening of the 19a parent boundary (13 → 17 parent_scope tables) — the PTA
-- PARENT READ, participation half (Module 4.7 capstone, part a; Kofi R474–R482). A parent gains ROW access
-- to the ACTIVE PTAs they belong to (ptas + pta_meeting, membership-scoped) and their OWN dues + OWN
-- meeting-attendance (pta_dues_charge + pta_meeting_attendance, own-child/own-guardian). Kept in sync with
-- db/sql/prod-paste-0082-pta-parent-read-a.sql — this block is DEV; that file is the hand-paste on PROD
-- (⚠ RLS is NOT auto-applied on prod; without the paste these four tables keep parent_deny and the parent
-- PTA tab is an honest empty state — fail-closed, never a leak). The 55b records/directory half (minutes
-- subtree + officer matrix) is a LATER widening; those tables keep parent_deny until then.
--
-- 🔴 DUES ARE READ OFF THE BRIDGE, NEVER THE BILLING ENGINE (R476). parent_scope lands on pta_dues_charge
-- (which carries rate_snapshot + the family identity) and NOT on invoice / invoice_line_item / payment /
-- payment_allocation / receipt — those stay parent_deny, so tuition cannot leak and the money engine is
-- byte-unchanged for a parent session (0 tuition leak by construction). paid/outstanding is DEFERRED.
--
-- 🔴 THE POLICY CYCLE, AND WHY `ptas` DOES NOT CALL `parent_pta_ids`. parent_pta_ids READS `ptas` (it
-- enumerates the parent's ACTIVE PTAs). A parent_scope on `ptas` that called parent_pta_ids would be a
-- policy-on-A that reads A through a SECURITY DEFINER function — and under PROD's FORCE RLS + non-superuser
-- owner the inner `ptas` read RE-FIRES the same policy → unbounded recursion (stack-depth error). DEV CANNOT
-- catch it: the function owner is a superuser on dev, so the body bypasses RLS and never recurses — the
-- Sarah-L1 prod-shaped-ownership trap, verbatim the chronic-block "NO POLICY CYCLES" hazard. So the
-- membership rule is factored the chronic way (one predicate, two enforcement forms, zero divergence, R113):
--   • parent_in_pta(school, pu, tier, class, house) → boolean — the per-ROW membership predicate; reads
--     `students` (+ student_guardian via parent_student_ids), NEVER `ptas`. `ptas.parent_scope` calls THIS
--     on its own row's columns, so `ptas`'s policy never reads `ptas` — no cycle.
--   • parent_pta_ids(school, pu) → SETOF uuid — the SET form (`SELECT id FROM ptas WHERE … parent_in_pta`);
--     used by the CHILD tables whose policies do NOT read `ptas` (pta_meeting here; the 55b subtree later).
--     Because ptas.parent_scope now calls parent_in_pta (not parent_pta_ids), even this helper's own
--     `FROM ptas` read is acyclic under prod FORCE RLS.
-- The EXISTS(parent_student_ids) guard inside parent_in_pta is LOAD-BEARING: a non-parent → empty set →
-- FALSE → 0 PTAs everywhere, INCLUDING the universal GENERAL tier (the R481 non-parent-sees-nothing crux).
-- EMERGENCY PTAs are excluded structurally (parent_in_pta returns FALSE for any tier that is not
-- GENERAL/FORM/HOUSE); only status='ACTIVE' PTAs are ever in scope.

-- ---- SECURITY DEFINER helper: the per-row PTA membership predicate (reads students, NEVER ptas) ----
-- Same discipline as parent_student_ids (STABLE, explicit search_path public,pg_temp — pg_temp LAST pins
-- relation resolution to public so an injected temp `students` cannot spoof the answer). Takes the ptas
-- row's tier/class/house as ARGUMENTS so it never reads the table its caller's policy guards.
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

-- ---- SECURITY DEFINER helper: the ACTIVE PTAs the parent belongs to, as a set (Kofi R475) ----
-- The SET form of parent_in_pta over the ptas table — used by the child tables' policies (pta_meeting here),
-- NOT by ptas.parent_scope (see the cycle note above).
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

-- ptas (R480) — the parent reads the ACTIVE PTAs they belong to. Calls parent_in_pta on THIS row's columns
-- (never parent_pta_ids) so the policy does not read its own table — no cycle under prod FORCE RLS.
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

-- pta_meeting (R480) — meetings of a PTA the parent belongs to (membership-scoped). Reads ptas via
-- parent_pta_ids, NOT pta_meeting, so acyclic.
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

-- pta_dues_charge (R476) — the parent's OWN dues. Two reaches, OR'd: the charge is on one of the parent's
-- own children (subject_student_id, PER_STUDENT), OR it is a PER_FAMILY charge on a HOUSEHOLD one of the
-- parent's children belongs to (the rep-sibling billed may be a different child in the same household). The
-- household reach reads `students` (not pta_dues_charge) → no cycle.
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
-- parent's OWN guardian row (user_id = pu). TEACHER rows carry student_guardian_id NULL → NULL IN (…) is not
-- TRUE → auto-excluded. Reads `student_guardian` (not pta_meeting_attendance) → no cycle.
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

-- ---- INCR-55b: the SIXTH widening of the 19a parent boundary (17 → 22 parent_scope tables) — the PTA
-- PARENT READ, records/directory half (Module 4.7 capstone, part b; Kofi R478/R479). A parent gains ROW
-- access to the CURRENT officer matrix of the PTAs they belong to (pta_officer) and the ADOPTED-minutes
-- subtree of those PTAs (pta_minutes + pta_agenda_item + pta_action_item + pta_resolution). Builds on the
-- 55a helpers (parent_in_pta / parent_pta_ids) BYTE-UNCHANGED. Kept in sync with
-- db/sql/prod-paste-0083-pta-parent-read-b.sql — this block is DEV; that file is the hand-paste on PROD
-- (⚠ RLS is NOT auto-applied on prod; without the paste these five tables keep parent_deny and the parent
-- PTA records/officers tab is an honest empty state — fail-closed, never a leak).
--
-- 🔴 RLS GATES ROWS, NOT COLUMNS. Once a row is opened the officer-only COLUMNS (pta_officer.election_ref,
-- pta_officer.end_reason, contact) and the DRAFT/CHAIR_REVIEW exclusion are the READER's frozen projection
-- job (Claude Code's withParentScope loaders, R478/R479) — EXCEPT where a row-gate structurally covers it:
--   • pta_officer's `ended_at IS NULL` predicate denies ended rows, so end_reason is NEVER on a visible row.
--   • pta_minutes's `status = 'ADOPTED'` predicate denies DRAFT/CHAIR_REVIEW, so a parent can NEVER see a
--     non-adopted minutes — nor any of its agenda/action/resolution children (the subtree is reachable ONLY
--     through an ADOPTED minutes).
--
-- 🔴 THE 55a RECURSION TRAP APPLIES TO THE MINUTES SUBTREE. A parent_scope policy on table T must NEVER read
-- T inside a SECURITY DEFINER helper: on prod (function owner non-super + FORCE RLS) the inner read RE-FIRES
-- the same policy → stack-depth error; INVISIBLE on the superuser dev DB (the body bypasses RLS) — the exact
-- reason 55a split parent_in_pta off parent_pta_ids. So each table's policy reaches UP the tree, reading only
-- ANCESTOR tables, never its own:
--   • pta_officer      → reads ptas          (via parent_pta_ids).                 officer ≠ ptas    → acyclic.
--   • pta_minutes      → reads pta_meeting   (via parent_minutes_row, per-ROW).    NEVER pta_minutes → acyclic.
--   • pta_agenda_item  → reads pta_minutes   (via parent_readable_minutes_ids).    agenda ≠ minutes  → acyclic.
--   • pta_action_item  → reads pta_agenda_item (via parent_readable_agenda_item_ids). action ≠ agenda → acyclic.
--   • pta_resolution   → reads pta_agenda_item (same helper).                       resolution ≠ agenda → acyclic.
-- Each SET helper MAY read the table one level up because THAT table's policy reaches a level HIGHER still
-- (pta_minutes's policy reads pta_meeting, not pta_minutes), so no policy ever reads the table it guards.

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

-- ---- INCR-58 Item 1 (Kofi R483): the parent resolves the NAME of their OWN children's houses ----
-- The parent portal relabels the generic "House PTA" with the real House name. The `house` table STAYS
-- parent_deny — it carries staff PII IN-ROW (hm_user_id, the resident housemaster) plus
-- colour/capacity/gender/founded_year/named_after/active, NONE of which a parent may read. So we do NOT
-- open the row with a parent_scope policy (Kofi's Option 1) — that would leave the reader's projection as
-- the ONLY guard on the housemaster. Instead this SECURITY DEFINER function (Kofi's Option 2) IS the
-- immutable column guard: it returns ONLY (id, name), so a parent can never reach hm_user_id / colour /
-- capacity / etc. even via a mutated reader — strictly tighter than a row-opening parent_scope. It reads
-- students + house internally as the owner (definer) but exposes only the two projected columns; `house`
-- itself keeps parent_deny (re-affirmed by the catalog loop below, which still covers it — no parent_scope
-- policy exists on it, so the NOT EXISTS(parent_scope) filter includes it).
--
-- ACYCLIC / PII GUARD: because no parent_scope policy on `house` exists (it stays denied), there is no
-- policy-reads-its-own-table concern — this is a plain definer read, the parent_student_ids / parent_pta_ids
-- idiom (STABLE, SECURITY DEFINER, search_path public,pg_temp LAST — pg_temp last so an injected temp
-- `house`/`students` cannot spoof the answer). The reach set = the parent's OWN children's houses via
-- students.house_id — the SAME set as parent_in_pta's HOUSE branch above (policies.sql HOUSE tier). `pu` is
-- the GUC arg, NEVER a row column; a NULL pu → empty parent_student_ids → 0 rows (fail-closed). Kept in sync
-- with db/sql/prod-paste-0084-pta-parent-house-name.sql (the PROD hand-paste; ⚠ RLS is NOT auto-applied on
-- prod — without it the function is simply absent and the parent tab keeps the generic "House PTA" label,
-- never a leak). Depends on parent_student_ids() (prod-paste-0055), which already ships on prod.
CREATE OR REPLACE FUNCTION parent_house_names(school uuid, pu uuid)
  RETURNS TABLE(house_id uuid, house_name text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT h.id, h.name
  FROM house h
  WHERE h.school_id = school
    AND h.id IN (
      SELECT DISTINCT s.house_id
      FROM students s
      WHERE s.school_id = school
        AND s.house_id IS NOT NULL
        AND s.id IN (SELECT parent_student_ids(school, pu))
    )
$$;

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
