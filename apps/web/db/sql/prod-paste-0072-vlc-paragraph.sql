-- Omnischools — PROD paste 0072: VLC Character paragraph (SHS module 4.5 / INCR-43b). ONE new
-- confidential tenant table + its RLS. NO enum change, NO altered columns, NO backfills, NO seed, NO
-- global-table changes, NO constraint retrofit on any prior table (this is a fresh LEAF table).
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD after merging.
--
-- 🔴 LEAK-CRITICAL PASTE (one confidential table). vlc_pastoral_paragraph holds the FM-authored
-- school-leaver character paragraph — confidential pastoral PII, the flagged student on every row. If
-- migration 0070 ships to prod without this paste, the table exists there with NO row-level security at
-- all: no ENABLE, no FORCE, no tenant_isolation, no parent_deny. Every school's paragraphs become
-- readable AND writable from every other school's session, and a claimed parent session reads them too —
-- a cross-school pastoral-PII leak. FAIL-CLOSED gate: run this file on PROD as part of the INCR-43b
-- deploy, THEN verify with db/sql/verify-prod-rls.sql — Query 1 must return ZERO ROWS and Query 2's
-- tenant_tables + fully_forced + with_tenant_isolation + parent_denied must each have risen by exactly 1
-- (parent_readable UNCHANGED).
--
-- ⚠ NUMBERING (read this once). The DRIZZLE migration is db/migrations/0070_tiny_giant_man.sql — the
-- drizzle chain was at 0069 (the VLC casework, 0069_gigantic_vengeance), so generate produced 0070. The
-- prod-paste SEQUENCE, however, already reached 0071 (prod-paste-0071-vlc-casework.sql — the two
-- sequences have been diverged since INCR-29). So this DDL's prod-paste is 0072 while its migration is
-- 0070; that divergence is expected. The SQL below is byte-identical in EFFECT (same table + constraint
-- + policy names) to migration 0070 followed by db:policies for this one table.
--
-- OWNER-LOCKED (#4): a parent sees NOTHING VLC-wide here (they receive the paragraph at leaver via
-- INCR-45, not this table). There is NO parent_scope on this table; the catalog-driven parent_deny loop
-- at the bottom covers it structurally (FORCE-RLS + school_id, no parent_scope), exactly as it auto-denies
-- every other non-parent-readable tenant table.
--
-- OWNER-LOCKED (INCR-43 batch): #6 FM-AUTHORED free text, NO AI / NO auto-summary; #2 the READ set is
-- WIDER than the 43a casework — own-class FM + DEAN_OF_STUDENTS + HEADMASTER (paragraph-only, FINALISED
-- rows only) — but that WIDER read is APP-LAYER (a SEPARATE reader lib/vlc/paragraph-data.ts behind a
-- SEPARATE route, gated VLC_PARAGRAPH_READ_ROLES), NOT the DB. WRITE (author/edit/lock) = own-class FM +
-- DEAN only (HM cannot write); own-class is a STATIC identity match on the student's
-- class.class_teacher_user_id, not a revocable/expiring grant, so it needs NO staff_grant_scope and NO
-- new GUC. RLS here enforces ONLY tenant isolation + parent_deny. NO TRIGGERS (portability). The body cap
-- is app-layer + the single-row CHECK below.
--
-- CONFIDENTIAL, REDACTED audit — `vlc_pastoral_paragraph` matches the reserved prefix already wired into
-- isRedactedAuditEntity (INCR-42b), so it auto-redacts with ZERO code change (audit records metadata
-- only — actionType/entity/actor — NO body/student). Redaction ≠ read-gate: the audit diff is REDACTED
-- even though the app-read admits the HM. EDITABLE-IN-PLACE (the SOLE difference from the 43a append-only
-- casework tables — hence it carries updated_at): ONE row per student, lazily created, retunable while
-- locked_at IS NULL, frozen once set. LEAF — nothing FKs to it, so NO tenant_uk and NO ordering hazard.

-- ---- 1) table (TENANT — confidential; LEAF, no tenant UK). The composite (school_id, student_id) FK
-- ---- targets the EXISTING students(school_id, id) UNIQUE, so no target-before-FK ordering step. ----
-- vlc_pastoral_paragraph — FM-authored school-leaver character paragraph, ONE editable row per student.
-- The inline UNIQUE(school_id, student_id) is the one-per-student invariant + the upsert conflict target +
-- the INCR-45 leaver read key. body CHECK ≤3000 is defense-in-depth (the primary cap is app-layer).
CREATE TABLE IF NOT EXISTS "vlc_pastoral_paragraph" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "body" text NOT NULL,
  "author_user_id" uuid,
  "updated_by_user_id" uuid,
  "locked_at" timestamp with time zone,
  "locked_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_vlc_pastoral_paragraph_student" UNIQUE("school_id","student_id"),
  CONSTRAINT "vlc_pastoral_paragraph_body_len" CHECK (char_length("vlc_pastoral_paragraph"."body") <= 3000)
);

-- ---- 2) foreign keys (guarded so a re-run is a no-op; the CREATE TABLE above is already done) ----
-- school_id → ref_school PK single-column CASCADE; author/updated_by/locked_by → ref_user SET NULL;
-- the composite (school_id, student_id) intra-tenant FK makes a cross-tenant reference structurally
-- impossible (CASCADE — deleting the student drops the paragraph).
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_paragraph" ADD CONSTRAINT "vlc_pastoral_paragraph_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_paragraph" ADD CONSTRAINT "vlc_pastoral_paragraph_author_user_id_ref_user_id_fk"
    FOREIGN KEY ("author_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_paragraph" ADD CONSTRAINT "vlc_pastoral_paragraph_updated_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_paragraph" ADD CONSTRAINT "vlc_pastoral_paragraph_locked_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_paragraph" ADD CONSTRAINT "vlc_pastoral_paragraph_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- 3) indexes: NONE. The UNIQUE(school_id, student_id) above already serves the per-student point
-- ---- lookup (its school_id prefix + student_id are the exact read key), so no separate index. ----

-- ---- 4) RLS: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (this name is added to that
-- hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that forgets to set
-- app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'vlc_pastoral_paragraph'
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

-- ---- 5) parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0071 ----
-- Owner-locked (#4): a parent NEVER sees this table, so it must be denied. This loop is NOT a hand-list: it
-- applies parent_deny to every FORCE-RLS + school_id table that lacks a parent_scope policy — which, after
-- the block above, is the new vlc_pastoral_paragraph plus every already-covered one (it re-creates their
-- identical policy, hence idempotent). It is re-run here rather than hand-listing the one, so a FUTURE vlc
-- table stays auto-denied. RESTRICTIVE is load-bearing: Postgres OR's PERMISSIVE policies, so a permissive
-- parent policy would OR with tenant_isolation and hand a claimed parent the entire school.
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
