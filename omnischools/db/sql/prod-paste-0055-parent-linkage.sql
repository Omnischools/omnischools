-- Omnischools — migration 0055: parent identity foundation + the per-user parent-portal RLS boundary
-- (SHS module 4.3 / INCR-19a). Idempotent — safe to run more than once. Paste into the Supabase SQL
-- editor on PROD after merging.
--
-- ⚠ THIS PASTE IS THE PARENT BOUNDARY ON PROD. db:policies only configures LOCAL dev. Without pasting
-- this file, the two new columns migrate but the RESTRICTIVE parent policies do NOT exist on prod —
-- so the parent boundary would be APP-LAYER ONLY, the option Kofi explicitly REJECTED (Decision 13
-- mandates DB-layer enforcement). Running this file == migration 0055 + db:policies for the parent
-- boundary. Keep it byte-identical to the parent block in db/sql/policies.sql.
--
-- SCOPE (mirrors the 0055 drizzle migration + the policies.sql parent block):
--   • student_guardian.user_id — NULLABLE uuid, SINGLE-column FK → ref_user(id) SET NULL (ref_user is
--     GLOBAL, so single-column per the composite-FK rule). + index guardian_user_idx(school_id, user_id)
--     + partial UNIQUE(school_id, student_id, user_id) WHERE user_id IS NOT NULL (one login per
--     guardian-of-child).
--   • invite.student_id — NULLABLE uuid + COMPOSITE FK (school_id, student_id) → students(school_id, id)
--     CASCADE (intra-tenant; nullable because staff/teacher invites carry no student — the
--     PARENT-requires-student rule is app-enforced, AC C1).
--   • parent_student_ids() SECURITY DEFINER helper + the RESTRICTIVE parent_deny / parent_scope policy
--     family across every tenant table.
-- NO new enums. NO new tables. NO GLOBAL-table changes (ref_user / benchmark_reference / universities /
-- university_programmes are left exactly as-is — a parent session must not read tenant PII there, and
-- they hold none; adding parent policies to global tables is explicitly NOT done).
--
-- DDL ORDER: ALTER ADD COLUMN → FK constraints (targets pre-exist: ref_user PK + students_tenant_uk,
-- both shipped in earlier migrations) → indexes → SECURITY DEFINER function → policies. No FK precedes
-- its target (no 0033-style FK-before-UNIQUE hazard).

-- ==================================================================================================
-- Part 1 — the two column additions (idempotent).
-- ==================================================================================================

-- student_guardian.user_id — nullable, single-column SET NULL FK → GLOBAL ref_user.
ALTER TABLE "student_guardian" ADD COLUMN IF NOT EXISTS "user_id" uuid;
DO $$ BEGIN
  ALTER TABLE "student_guardian" ADD CONSTRAINT "student_guardian_user_id_ref_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "guardian_user_idx"
  ON "student_guardian" USING btree ("school_id","user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_guardian_user_per_child"
  ON "student_guardian" USING btree ("school_id","student_id","user_id") WHERE "user_id" IS NOT NULL;

-- invite.student_id — nullable, composite (school_id, student_id) FK → students(school_id, id) CASCADE.
ALTER TABLE "invite" ADD COLUMN IF NOT EXISTS "student_id" uuid;
DO $$ BEGIN
  ALTER TABLE "invite" ADD CONSTRAINT "invite_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ==================================================================================================
-- Part 2 — the per-user parent-portal RLS boundary (keep byte-identical to db/sql/policies.sql).
-- ==================================================================================================
-- lib/db/rls.ts → withParentScope(schoolId, userId) sets `app.current_school` AND
-- `app.current_parent_user`. Staff (withSchool) / escalated (withoutTenantScope) sessions NEVER set
-- the second GUC.
--
-- WHY RESTRICTIVE, NOT PERMISSIVE. tenant_isolation is PERMISSIVE and Postgres OR's permissive
-- policies, so it alone matches every row in the parent's school — a PERMISSIVE parent policy would OR
-- with it and let the parent read the ENTIRE school. The parent scope is therefore AS RESTRICTIVE,
-- which Postgres AND's with the permissive set (it can only TIGHTEN). Every restrictive policy is
-- guarded `pu IS NULL OR <rule>` where pu = NULLIF(current_setting('app.current_parent_user', true),
-- ''): staff/bypass → GUC unset → pu IS NULL → TRUE → TOTAL NO-OP (behaviour byte-identical); parent →
-- pu set → the <rule> decides.
--   1. parent_deny  — restrictive USING (pu IS NULL) on every tenant table EXCEPT the readable set:
--      parent session → FALSE → ZERO rows (deny-by-default: mock_results, benchmark_data_points,
--      university_targets, any other student, everything).
--   2. parent_scope — restrictive USING (pu IS NULL OR <child reaches this row>) on the readable set,
--      overriding parent_deny there, via the SECURITY DEFINER helper parent_student_ids().
-- FOR ALL (USING doubles as WITH CHECK): parent_deny tables are read+write locked; there is no parent
-- write path anywhere (Kofi R4). ref_school (keyed on id) is left readable to the parent — their OWN
-- school row only, no other-student PII — deliberately NOT in the deny suite.

-- ---- SECURITY DEFINER helper: the parent's own children in one school ----
-- The ONE sanctioned SECURITY DEFINER exception (portability): it lets every parent_scope policy read
-- student_guardian in one line without RLS-recursing that sub-select. Its WHERE clause makes the
-- result correct whether or not RLS applies inside it. NOT a business-logic trigger.
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

-- ---- layer 1: parent_deny on every tenant table EXCEPT the parent-readable set ----
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
    'wassce_candidate_subject',
    'mock_exams',
    'mock_results',
    'benchmark_data_points',
    'university_targets',
    'announcement',
    'sms_template',
    'notification_log',
    'inbox_routing_rule',
    'whatsapp_template',
    'invite',
    'book_category',
    'book_entry',
    'fixed_asset'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS parent_deny ON %I;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS parent_scope ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY parent_deny ON %I AS RESTRICTIVE FOR ALL TO public '
      'USING (NULLIF(current_setting(''app.current_parent_user'', true), '''') IS NULL);',
      tbl
    );
  END LOOP;
END
$$;

-- ---- layer 2: parent_scope on the parent-readable set (overrides parent_deny) ----
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
