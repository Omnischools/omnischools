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
--     family across every tenant table. parent_deny is CATALOG-DRIVEN (INCR-19a re-gate): it is applied
--     to every FORCE-RLS + school_id table lacking a parent_scope policy, so a future tenant table is
--     auto-covered with no edit — keep this block byte-identical to db/sql/policies.sql.
--   • student_health_record (migration 0036) tenant_isolation is re-asserted here (Part 1b) so the health
--     PII table is FORCE-RLS before the catalog parent_deny loop, and so dev matches prod (Sarah BLOCK).
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
-- Part 1b — student_health_record tenant isolation (closes the dev↔prod drift; Sarah BLOCK, INCR-19a).
-- ==================================================================================================
-- The health table (migration 0036: blood group, allergies, conditions, medications, emergency
-- contacts) is a tenant table but shipped WITHOUT the tenant_isolation policy on dev. prod-paste-0036
-- DID grant it on prod — this re-asserts it idempotently so dev and prod match, AND (crucially) so the
-- table is FORCE-RLS BEFORE the catalog parent_deny loop below runs (the loop only denies FORCE-RLS
-- tables). Byte-identical to the tenant_isolation policy every other tenant table carries.
-- ⚠ prod-paste-0036 is what gave this table tenant isolation on PROD — confirm it was run there. If it
-- was somehow never run, THIS idempotent block establishes the tenant isolation on prod as well.
ALTER TABLE "student_health_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_health_record" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "student_health_record";
CREATE POLICY tenant_isolation ON "student_health_record" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

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
-- 🔴 `search_path = public, pg_temp`, NOT `= public` (Sarah MEDIUM-2, found via INCR-23a's helpers,
-- identical flaw here). Postgres searches the session TEMP schema first for RELATIONS unless pg_temp
-- is named, so a session that can run one statement does `create temp table student_guardian(...)`
-- and this DEFINER function returns whatever child ids it chose. Re-run this CREATE OR REPLACE on
-- prod to close it (it is idempotent; the body is otherwise byte-identical to what shipped in 0055).
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
