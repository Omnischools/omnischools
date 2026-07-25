-- Omnischools — migration 0059: student_subject_enrolment (CAPTURE of a prod-only table).
--
-- ⚠ PROD ALREADY HAS THIS TABLE AND ITS RLS. This table was created directly on PROD via raw SQL in an
-- ad-hoc session (documented in commit 636185e / db/sql/verify-prod-rls.sql) and was never modelled in
-- the repo — no Drizzle schema, no migration, no policies.sql/prod-paste entry — and it does NOT exist
-- on dev. Migration 0059 captures it so a from-migrations rebuild (dev, or a FRESH prod) reproduces
-- exactly what prod holds today. On CURRENT prod this paste is therefore a deliberate NO-OP: every
-- statement is idempotent (CREATE TABLE IF NOT EXISTS, guarded FK adds, CREATE INDEX IF NOT EXISTS,
-- DROP POLICY IF EXISTS before CREATE, the catalog-driven parent_deny loop). Its purpose is the
-- from-scratch rebuild, not a change to the live table.
--
-- Idempotent — safe to run more than once, and safe to run against the prod that already has the table.
-- (db:policies only configures LOCAL DEV; a new tenant table needs its RLS pasted on prod by hand, or it
-- leaks across schools. Here prod's RLS is already present, so this re-asserts the identical policy.)
--
-- SHAPE (matched column-for-column to the live prod catalog, introspected 2026-07-23): the
-- wassce_candidate_subject / senior_subject_teacher leaf idiom. `id` uuid PK; `school_id`/`student_id`/
-- `subject_id` NOT NULL; `created_by_user_id` nullable; `created_at` timestamptz default now(). Composite
-- (school_id, student_id) → students and (school_id, subject_id) → subject keep both refs intra-tenant
-- (CASCADE); single-column (school_id) → ref_school CASCADE; single-column (created_by_user_id) → ref_user
-- with NO on-delete. UNIQUE(school_id, student_id, subject_id) named `uniq_student_subject_enrolment`
-- (custom prod name). LEAF — nothing references it, so NO composite (school_id, id) tenant UK (prod has
-- none either). Read index `student_subject_enrolment_subject_idx` on (school_id, subject_id).
--
-- ⚠ Constraint NAMES are the drizzle-generated ones, so this paste and `drizzle-kit migrate` produce a
-- byte-identical catalog on a fresh rebuild. Postgres truncates identifiers at 63 chars — the two
-- composite FK names below are written PRE-truncation exactly as drizzle emits them; Postgres truncates
-- them identically on both paths (a NOTICE, not an error) and the truncations stay distinct.
--
-- DDL ORDER (the 0033 hazard): the PK + UNIQUE are INLINE in CREATE TABLE, so they exist before the FK
-- section. The four FKs reference ref_school / ref_user (0001) and students / subject tenant UKs
-- (0033) — all shipped in earlier migrations — so nothing here depends on a constraint created later.
--
-- Verify afterwards with db/sql/verify-prod-rls.sql: Query 1 must stay ZERO ROWS (prod already counts
-- this table; no new leak) and the table must show relrowsecurity = relforcerowsecurity = true with
-- both tenant_isolation (permissive) and parent_deny (restrictive).

CREATE TABLE IF NOT EXISTS "student_subject_enrolment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "subject_id" uuid NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_student_subject_enrolment" UNIQUE("school_id","student_id","subject_id")
);

-- ---- foreign keys (guarded so a re-run, or a run against the live prod table, is a no-op) ----
DO $$ BEGIN
  ALTER TABLE "student_subject_enrolment" ADD CONSTRAINT "student_subject_enrolment_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Global ref_user pointer — single-column, NO on-delete (matches prod): a removed actor leaves the
-- enrolment intact rather than cascading it away.
DO $$ BEGIN
  ALTER TABLE "student_subject_enrolment" ADD CONSTRAINT "student_subject_enrolment_created_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."ref_user"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Composite intra-tenant FK — a cross-tenant student reference is structurally impossible. Consumes
-- students_tenant_uk (shipped 0033).
DO $$ BEGIN
  ALTER TABLE "student_subject_enrolment" ADD CONSTRAINT "student_subject_enrolment_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Composite intra-tenant FK — a cross-tenant subject reference is structurally impossible. Consumes
-- subject_tenant_uk (shipped 0033).
DO $$ BEGIN
  ALTER TABLE "student_subject_enrolment" ADD CONSTRAINT "student_subject_enrolment_school_id_subject_id_subject_school_id_id_fk"
    FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."subject"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- index ----
CREATE INDEX IF NOT EXISTS "student_subject_enrolment_subject_idx"
  ON "student_subject_enrolment" USING btree ("school_id","subject_id");

-- ---- RLS — the same tenant_isolation policy every other tenant table uses ----
-- ENABLE + FORCE means the owner is NOT exempt: a query that forgets to set app.current_school returns
-- ZERO rows — fails safe — rather than leaking across tenants.
ALTER TABLE "student_subject_enrolment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_subject_enrolment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "student_subject_enrolment";
CREATE POLICY tenant_isolation ON "student_subject_enrolment" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0058 ----
-- Owner decision D8 keeps a claimed parent out of every tenant table except the small parent-readable
-- set. The loop is NOT a hand-list: it applies parent_deny to every FORCE-RLS + school_id table that
-- lacks a parent_scope policy — which, after the block above, includes student_subject_enrolment
-- (it re-creates the identical policy on the already-covered tables, hence idempotent). It is re-run
-- here rather than hand-listing the one table because that is what keeps a FUTURE tenant table
-- auto-denied.
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
