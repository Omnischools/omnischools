-- Omnischools — PROD paste 0079: PTA meeting register (SHS module 4.7 / INCR-52). TWO new tenant tables
-- (pta_meeting + pta_meeting_attendance) + their RLS. NO enum, NO altered columns, NO backfills, NO seed,
-- NO global-table changes. Idempotent — safe to run more than once. Paste into the Supabase SQL editor on
-- PROD after merging.
--
-- ⚠ NUMBERING (read this once). The DRIZZLE migration is db/migrations/0076_fine_frog_thor.sql — the
-- drizzle chain was at 0075 (the PTA officer matrix, 0075_giant_sabretooth), so generate produced 0076. The
-- prod-paste SEQUENCE, however, already reached 0078 (prod-paste-0078-pta-officer.sql — the two sequences
-- have diverged since INCR-29). So this DDL's prod-paste is 0079 while its migration is 0076; that
-- divergence is expected. The SQL below is byte-identical in EFFECT (same two tables + constraints +
-- indexes + policies) to migration 0076 followed by db:policies for the two tables — a from-migrations
-- rebuild and this paste produce an identical catalog.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. If migration 0076 ships to
-- prod without this paste, pta_meeting and pta_meeting_attendance exist there with NO row-level security at
-- all: no ENABLE, no FORCE, no tenant_isolation, no parent_deny. Every school's PTA meeting register —
-- who convened, who attended, teacher AND parent identities, quorum judgment — becomes readable AND
-- writable from every other school's session, and a claimed parent session reads it too. FAIL-CLOSED gate:
-- run this file on PROD as part of the INCR-52 deploy, THEN verify with db/sql/verify-prod-rls.sql —
-- Query 1 must return ZERO ROWS and Query 2's tenant_tables + fully_forced + with_tenant_isolation +
-- parent_denied must each have risen by exactly 2 (parent_readable UNCHANGED — the register has no parent
-- path in THIS increment; the own-child own-attendance parent_scope is INCR-55, R442).
--
-- OWNER-LOCKED (R442): a parent reads NOTHING of the register here. There is NO parent_scope on either
-- table; the catalog-driven parent_deny loop at the bottom covers them structurally (FORCE-RLS + school_id,
-- no parent_scope), exactly as it auto-denies every other non-parent-readable tenant table. The own-child
-- own-attendance parent_scope (via student_guardian_id -> student_guardian.user_id = app.current_parent_user)
-- RETURNS at INCR-55, NOT here. OPERATIONAL / SHOWN — NO confidential/REDACTED layer, NO parent_scope, NO
-- new GUC, NO triggers.
--
-- DDL ORDER — one intra-file ordering point, satisfied: pta_meeting carries its INLINE tenant UK
-- UNIQUE(school_id, id) = pta_meeting_tenant_uk in the CREATE TABLE, and pta_meeting_attendance's composite
-- (school_id, meeting_id) FK targets it — so pta_meeting is CREATEd (UK and all) BEFORE that FK is added in
-- the guarded block below (the 0033 target-before-FK discipline; the plc_session_tenant_uk precedent). The
-- pta_meeting composite (school_id, pta_id) FK targets the PRE-EXISTING ptas UNIQUE(school_id, id) =
-- ptas_tenant_uk (migration 0074 / prod-paste 0077), and its (school_id, academic_period_id) FK the
-- PRE-EXISTING academic_period UNIQUE(school_id, period_id) = academic_period_tenant_uk. Every FK is added
-- in a DO-guarded block AFTER both CREATE TABLEs, so a re-run is a clean no-op.
--
-- CONSTRAINT notes (Kofi R431/R434–R438):
--   • pta_meeting: `meeting_type` is a FREE-TEXT display label (NO CHECK, no logic branch, R431);
--     `quorum_met` is a NULLABLE Secretary judgment (R438, NOT auto-derived); NO stored status/counts (all
--     DERIVED, R432). Inline pta_meeting_tenant_uk UNIQUE(school_id, id) is the FK target of the attendance
--     table. NO one-meeting-per-(PTA x date) unique — a PTA may convene more than once a day (R440 multiple
--     Emergencies); the per-PTA history read is served by pta_meeting_pta_idx (school_id, pta_id, meeting_date).
--   • pta_meeting_attendance DUAL register (R434): `register` CHECK IN ('TEACHER','PARENT'); the attendee
--     is user_id (single-col SET NULL -> ref_user, the teacher) XOR student_guardian_id (single-col SET
--     NULL -> the school-scoped student_guardian, the parent — SMS-only guardians have no ref_user, so the
--     parent register keys on the guardian row). `pta_meeting_attendance_register_identity` CHECK binds
--     register<->identity EXACTLY: a TEACHER row carries user_id (no guardian), a PARENT row carries
--     student_guardian_id (no user). It is STRICT (own identity column NON-NULL) — load-bearing for R437
--     count-once and the INCR-55 own-child parent_scope. (⚠ a hard student_guardian delete would fire SET
--     NULL and the CHECK would refuse it; students/guardians are SOFT-stated in this app so it never fires,
--     and a school delete cascades the register away cleanly — verified on dev.) `status` REUSES the
--     canonical attendance_status enum (NO new enum, R434); `minutes_late` CHECK >= 0. The PER-REGISTER
--     default polarity (teacher present-by-default / parent absent-by-default, R435) is a lib/ DERIVATION,
--     NOT schema. TWO PARTIAL UNIQUES enforce count-once per register: (school_id, meeting_id, user_id)
--     WHERE register='TEACHER' and (school_id, meeting_id, student_guardian_id) WHERE register='PARENT' —
--     SPLIT so each keys its own identity column and the other's NULLs never collide. LEAF -> NO tenant UK.

-- ---- table: pta_meeting (TENANT — the convened meeting; carries INLINE tenant UK, the attendance FK target) ----
CREATE TABLE IF NOT EXISTS "pta_meeting" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "pta_id" uuid NOT NULL,
  "academic_period_id" uuid NOT NULL,
  "meeting_type" text NOT NULL,
  "meeting_date" date NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "location" text,
  "agenda_json" jsonb DEFAULT '{"items": []}'::jsonb NOT NULL,
  "invited_teacher_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "quorum_met" boolean,
  "convened_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pta_meeting_tenant_uk" UNIQUE("school_id","id")
);

-- ---- table: pta_meeting_attendance (TENANT — the DUAL teacher/parent register; LEAF, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "pta_meeting_attendance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "meeting_id" uuid NOT NULL,
  "register" text NOT NULL,
  "user_id" uuid,
  "student_guardian_id" uuid,
  "status" "attendance_status" NOT NULL,
  "minutes_late" integer,
  "note" text,
  "recorded_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pta_meeting_attendance_register_valid" CHECK ("pta_meeting_attendance"."register" IN ('TEACHER', 'PARENT')),
  CONSTRAINT "pta_meeting_attendance_register_identity" CHECK (("pta_meeting_attendance"."register" = 'TEACHER' AND "pta_meeting_attendance"."user_id" IS NOT NULL AND "pta_meeting_attendance"."student_guardian_id" IS NULL)
        OR ("pta_meeting_attendance"."register" = 'PARENT' AND "pta_meeting_attendance"."student_guardian_id" IS NOT NULL AND "pta_meeting_attendance"."user_id" IS NULL)),
  CONSTRAINT "pta_meeting_attendance_minutes_late_nonneg" CHECK ("pta_meeting_attendance"."minutes_late" >= 0)
);

-- ---- foreign keys (guarded so a re-run is a no-op; the CREATE TABLEs above are already done) ----
-- pta_meeting.school_id -> ref_school PK, single-column CASCADE.
DO $$ BEGIN
  ALTER TABLE "pta_meeting" ADD CONSTRAINT "pta_meeting_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_meeting.convened_by_user_id -> the GLOBAL ref_user, single-column SET NULL (nullable convener).
DO $$ BEGIN
  ALTER TABLE "pta_meeting" ADD CONSTRAINT "pta_meeting_convened_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("convened_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_meeting composite (school_id, pta_id) -> the PRE-EXISTING ptas (school_id, id) tenant UK, CASCADE (a
-- PTA delete takes its meetings). A cross-tenant PTA reference is structurally impossible.
DO $$ BEGIN
  ALTER TABLE "pta_meeting" ADD CONSTRAINT "pta_meeting_school_id_pta_id_ptas_school_id_id_fk"
    FOREIGN KEY ("school_id","pta_id") REFERENCES "public"."ptas"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_meeting composite (school_id, academic_period_id) -> the PRE-EXISTING academic_period (school_id,
-- period_id) tenant UK, CASCADE. A cross-tenant period reference is structurally impossible.
DO $$ BEGIN
  ALTER TABLE "pta_meeting" ADD CONSTRAINT "pta_meeting_school_id_academic_period_id_academic_period_school_id_period_id_fk"
    FOREIGN KEY ("school_id","academic_period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_meeting_attendance.school_id -> ref_school PK, single-column CASCADE.
DO $$ BEGIN
  ALTER TABLE "pta_meeting_attendance" ADD CONSTRAINT "pta_meeting_attendance_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_meeting_attendance.user_id -> the GLOBAL ref_user, single-column SET NULL (nullable teacher attendee).
DO $$ BEGIN
  ALTER TABLE "pta_meeting_attendance" ADD CONSTRAINT "pta_meeting_attendance_user_id_ref_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_meeting_attendance.student_guardian_id -> student_guardian PK, single-column SET NULL (the parent
-- attendee; the sickbay student_nhis_card best-effort-link precedent — student_guardian is school-scoped,
-- but a SET NULL link stays single-column per the composite-tenant-FK rule).
DO $$ BEGIN
  ALTER TABLE "pta_meeting_attendance" ADD CONSTRAINT "pta_meeting_attendance_student_guardian_id_student_guardian_id_fk"
    FOREIGN KEY ("student_guardian_id") REFERENCES "public"."student_guardian"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_meeting_attendance.recorded_by_user_id -> the GLOBAL ref_user, single-column SET NULL.
DO $$ BEGIN
  ALTER TABLE "pta_meeting_attendance" ADD CONSTRAINT "pta_meeting_attendance_recorded_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_meeting_attendance composite (school_id, meeting_id) -> the pta_meeting (school_id, id) tenant UK
-- created above, CASCADE (a meeting delete takes its register). A cross-tenant meeting reference is
-- structurally impossible.
DO $$ BEGIN
  ALTER TABLE "pta_meeting_attendance" ADD CONSTRAINT "pta_meeting_attendance_school_id_meeting_id_pta_meeting_school_id_id_fk"
    FOREIGN KEY ("school_id","meeting_id") REFERENCES "public"."pta_meeting"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
-- The per-PTA meeting-history read ("this PTA's meetings, most recent first"). No natural (PTA x date)
-- unique — a PTA may meet more than once a day (R440 multiple Emergencies) — so this is a plain index.
CREATE INDEX IF NOT EXISTS "pta_meeting_pta_idx"
  ON "pta_meeting" USING btree ("school_id","pta_id","meeting_date");
-- Count-once per register (R437) — SPLIT partial uniques so each keys its own identity column and the many
-- NULLs of the other never collide. The WHERE is load-bearing.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_pta_meeting_attendance_teacher"
  ON "pta_meeting_attendance" USING btree ("school_id","meeting_id","user_id") WHERE "pta_meeting_attendance"."register" = 'TEACHER';
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_pta_meeting_attendance_parent"
  ON "pta_meeting_attendance" USING btree ("school_id","meeting_id","student_guardian_id") WHERE "pta_meeting_attendance"."register" = 'PARENT';

-- ---- RLS — both tables: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (both tables are added to
-- that hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that forgets to
-- set app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'pta_meeting',
    'pta_meeting_attendance'
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

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0078 ----
-- Owner-locked (R442): a parent reads NOTHING of the register in this increment, so both new tables must be
-- denied. This loop is NOT a hand-list: it applies parent_deny to every FORCE-RLS + school_id table that
-- lacks a parent_scope policy — which, after the block above, is the new pta_meeting + pta_meeting_attendance
-- plus every already-covered one (it re-creates their identical policy, hence idempotent). It is re-run here
-- rather than hand-listing, so a FUTURE PTA table stays auto-denied. RESTRICTIVE is load-bearing: Postgres
-- OR's PERMISSIVE policies, so a permissive parent policy would OR with tenant_isolation and hand a claimed
-- parent the entire school. (The own-child own-attendance parent_scope is INCR-55, R442 — a dedicated
-- withParentScope reader added THERE, not a widening of this deny.)
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
