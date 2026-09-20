-- Omnischools — PROD paste 0071: VLC Casework (SHS module 4.5 / INCR-43a). FOUR new confidential tenant
-- tables + their RLS, plus a ONE-CONSTRAINT retrofit on the 42b flag. NO enum change (no pg enums here),
-- NO altered columns beyond that constraint, NO backfills, NO seed, NO global-table changes. Idempotent —
-- safe to run more than once. Paste into the Supabase SQL editor on PROD after merging.
--
-- 🔴🔴 LEAK-CRITICAL PASTE (four confidential tables). vlc_pastoral_journal / _note / _observation / _case
-- hold confidential pastoral PII (reflection bodies, FM/Dean notes, PG observations, the running case
-- summary — the flagged student on every one). If migration 0069 ships to prod without this paste, all four
-- tables exist there with NO row-level security at all: no ENABLE, no FORCE, no tenant_isolation, no
-- parent_deny. Every school's casework becomes readable AND writable from every other school's session, and
-- a claimed parent session reads it too — a cross-school pastoral-PII leak. FAIL-CLOSED gate: run this file
-- on PROD as part of the INCR-43a deploy, THEN verify with db/sql/verify-prod-rls.sql — Query 1 must return
-- ZERO ROWS and Query 2's tenant_tables + fully_forced + with_tenant_isolation + parent_denied must each
-- have risen by exactly 4 (parent_readable UNCHANGED).
--
-- ⚠ NUMBERING (read this once). The DRIZZLE migration is db/migrations/0069_gigantic_vengeance.sql — the
-- drizzle chain was at 0068 (the VLC pastoral flag, 0068_pink_luke_cage), so generate produced 0069. The
-- prod-paste SEQUENCE, however, already reached 0070 (prod-paste-0070-vlc-pastoral-flag.sql — the two
-- sequences have been diverged since INCR-29). So this DDL's prod-paste is 0071 while its migration is 0069;
-- that divergence is expected. The SQL below is byte-identical in EFFECT (same table + constraint + index
-- names) to migration 0069 followed by db:policies for these four tables.
--
-- OWNER-LOCKED (#4): a parent sees NOTHING VLC-wide. There is NO parent_scope on any of these four; the
-- catalog-driven parent_deny loop at the bottom covers them structurally (FORCE-RLS + school_id, no
-- parent_scope), exactly as it auto-denies every other non-parent-readable tenant table.
--
-- OWNER-LOCKED (INCR-43 batch): casework READ = FM(own-class) + DEAN_OF_STUDENTS ONLY; WRITE = the same,
-- via canWritePastoralFlag reused VERBATIM. STAFF-FACING — the FM records the journal + PG observation; the
-- PG is `observed_by` free-text DATA, NEVER a principal (no student/PG login/write/self-read). The ROLE gate
-- ([FM, DEAN]) and the FM OWN-CLASS scoping are APP-LAYER (lib/vlc/), NOT the DB: own-class is a STATIC
-- identity match on the flagged/observed student's class.class_teacher_user_id, not a revocable/expiring
-- grant, so it needs NO staff_grant_scope and NO new GUC. RLS here enforces ONLY tenant isolation +
-- parent_deny. NO TRIGGERS (portability). body/summary/observed_by caps are app-layer + the single-row
-- CHECKs below.
--
-- CONFIDENTIAL, REDACTED audit — all four are `vlc_pastoral_*`, so the reserved prefix branch already wired
-- into isRedactedAuditEntity (INCR-42b) auto-redacts them with ZERO code change; audit records metadata
-- only (actionType/entity/actor — NO body/summary/observed_by/student). journal / note / observation are
-- APPEND-ONLY (no updated_at, create-only); vlc_pastoral_case is the SOLE editable table (one running
-- summary per flag, 1:1). NO derived scalars (the surface "N open" derives from 42b flags' resolved_at).
--
-- 🔴 R331 — THE FLAG tenant_uk RETROFIT (the ordering hazard). vlc_pastoral_case.flag_id is a composite
-- (school_id, flag_id) FK → vlc_pastoral_flag(school_id, id), but INCR-42b built the flag LEAF with NO
-- tenant_uk. On PROD the flag was created by the hand-run prod-paste-0070 (NOT a replayed migration), so
-- prod does NOT have the tenant_uk unless THIS paste adds it. So the FIRST statement below is an idempotent
-- ADD CONSTRAINT vlc_pastoral_flag_tenant_uk UNIQUE(school_id, id) — it MUST run BEFORE the vlc_pastoral_case
-- composite FK (the target UNIQUE must exist before the FK that references it — the 0033/0057 discipline).
-- In migration 0069 the same ALTER is likewise hand-ordered ahead of the case FK ALTER.

-- ---- 0) R331 retrofit: the flag tenant_uk (composite-FK target for vlc_pastoral_case). Guarded so a
-- ---- re-run (or a prod flag that somehow already carries it) is a no-op. MUST precede the case FK. ----
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_flag" ADD CONSTRAINT "vlc_pastoral_flag_tenant_uk" UNIQUE ("school_id","id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- ---- 1) tables (TENANT — confidential; all LEAF, no tenant UK) ----
-- vlc_pastoral_journal — Reflection entry, FM-recorded as DATA, APPEND-ONLY (no updated_at/entry_date).
CREATE TABLE IF NOT EXISTS "vlc_pastoral_journal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "session_id" uuid,
  "recorded_by_user_id" uuid,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vlc_pastoral_journal_body_len" CHECK (char_length("vlc_pastoral_journal"."body") <= 4000)
);

-- vlc_pastoral_note — FM/Dean note, APPEND-ONLY (no status/open column — "open" derives from 42b flags).
CREATE TABLE IF NOT EXISTS "vlc_pastoral_note" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "author_user_id" uuid,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vlc_pastoral_note_body_len" CHECK (char_length("vlc_pastoral_note"."body") <= 4000)
);

-- vlc_pastoral_observation — PG observation, FM-recorded; observed_by is free-text DATA (no peer_guide FK).
CREATE TABLE IF NOT EXISTS "vlc_pastoral_observation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "observed_by" text NOT NULL,
  "recorded_by_user_id" uuid,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vlc_pastoral_observation_observed_by_len" CHECK (char_length("vlc_pastoral_observation"."observed_by") <= 80),
  CONSTRAINT "vlc_pastoral_observation_body_len" CHECK (char_length("vlc_pastoral_observation"."body") <= 4000)
);

-- vlc_pastoral_case — ONE editable running summary per flag (1:1); the inline UNIQUE(school_id, flag_id)
-- enforces the 1:1. The SOLE non-append-only casework table (edit bumps summary + last_revised_*).
CREATE TABLE IF NOT EXISTS "vlc_pastoral_case" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "flag_id" uuid NOT NULL,
  "summary" text NOT NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_revised_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_revised_by_user_id" uuid,
  CONSTRAINT "uniq_vlc_pastoral_case_flag" UNIQUE("school_id","flag_id"),
  CONSTRAINT "vlc_pastoral_case_summary_len" CHECK (char_length("vlc_pastoral_case"."summary") <= 8000)
);

-- ---- 2) foreign keys (guarded so a re-run is a no-op; the CREATE TABLEs above are already done) ----
-- school_id → ref_school PK single-column CASCADE; actor stamps → ref_user SET NULL; composite
-- (school_id, X) intra-tenant FKs make a cross-tenant reference structurally impossible.

-- vlc_pastoral_journal
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_journal" ADD CONSTRAINT "vlc_pastoral_journal_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_journal" ADD CONSTRAINT "vlc_pastoral_journal_recorded_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_journal" ADD CONSTRAINT "vlc_pastoral_journal_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- session is NULLABLE + ON DELETE NO ACTION (append-only sessions never delete; a session-less entry is legal).
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_journal" ADD CONSTRAINT "vlc_pastoral_journal_school_id_session_id_vlc_session_school_id_id_fk"
    FOREIGN KEY ("school_id","session_id") REFERENCES "public"."vlc_session"("school_id","id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- vlc_pastoral_note
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_note" ADD CONSTRAINT "vlc_pastoral_note_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_note" ADD CONSTRAINT "vlc_pastoral_note_author_user_id_ref_user_id_fk"
    FOREIGN KEY ("author_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_note" ADD CONSTRAINT "vlc_pastoral_note_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- vlc_pastoral_observation
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_observation" ADD CONSTRAINT "vlc_pastoral_observation_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_observation" ADD CONSTRAINT "vlc_pastoral_observation_recorded_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_observation" ADD CONSTRAINT "vlc_pastoral_observation_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- vlc_pastoral_case — the composite (school_id, flag_id) FK → vlc_pastoral_flag(school_id, id) REQUIRES the
-- flag tenant_uk from step 0 above (already run). CASCADE — deleting the flag drops its case.
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_case" ADD CONSTRAINT "vlc_pastoral_case_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_case" ADD CONSTRAINT "vlc_pastoral_case_last_revised_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("last_revised_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_case" ADD CONSTRAINT "vlc_pastoral_case_school_id_flag_id_vlc_pastoral_flag_school_id_id_fk"
    FOREIGN KEY ("school_id","flag_id") REFERENCES "public"."vlc_pastoral_flag"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- 3) indexes: per-student stream reads (journal / note / observation) ----
CREATE INDEX IF NOT EXISTS "vlc_pastoral_journal_student_idx"
  ON "vlc_pastoral_journal" USING btree ("school_id","student_id");
CREATE INDEX IF NOT EXISTS "vlc_pastoral_note_student_idx"
  ON "vlc_pastoral_note" USING btree ("school_id","student_id");
CREATE INDEX IF NOT EXISTS "vlc_pastoral_observation_student_idx"
  ON "vlc_pastoral_observation" USING btree ("school_id","student_id");

-- ---- 4) RLS: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (these four names are added
-- to that hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that forgets to
-- set app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'vlc_pastoral_journal',
    'vlc_pastoral_note',
    'vlc_pastoral_observation',
    'vlc_pastoral_case'
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

-- ---- 5) parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0070 ----
-- Owner-locked (#4): a parent NEVER sees VLC, so these four confidential tables must be denied. This loop is
-- NOT a hand-list: it applies parent_deny to every FORCE-RLS + school_id table that lacks a parent_scope
-- policy — which, after the block above, is the four new vlc_pastoral_* tables plus every already-covered
-- one (it re-creates their identical policy, hence idempotent). It is re-run here rather than hand-listing
-- the four, so a FUTURE vlc table stays auto-denied. RESTRICTIVE is load-bearing: Postgres OR's PERMISSIVE
-- policies, so a permissive parent policy would OR with tenant_isolation and hand a claimed parent the
-- entire school.
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
