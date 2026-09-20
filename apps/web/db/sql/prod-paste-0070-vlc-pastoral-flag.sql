-- Omnischools — PROD paste 0070: VLC Pastoral flag (SHS module 4.5 / INCR-42b). ONE new tenant table
-- + its RLS. The module's FIRST CONFIDENTIAL pastoral-PII table. NO enum change (severity is text +
-- CHECK, NOT a pg enum), NO altered columns, NO backfills, NO seed, NO global-table changes. Idempotent —
-- safe to run more than once. Paste into the Supabase SQL editor on PROD after merging.
--
-- 🔴🔴 THIS IS THE MODULE'S MOST LEAK-CRITICAL PASTE. `vlc_pastoral_flag` holds confidential pastoral
-- PII (severity, a short context locator, the flagged student). If migration 0068 ships to prod without
-- this paste, the table exists there with NO row-level security at all: no ENABLE, no FORCE, no
-- tenant_isolation, no parent_deny. Every school's pastoral flags become readable AND writable from every
-- other school's session, and a claimed parent session reads them too — the WORST cross-school PII leak
-- in the product. FAIL-CLOSED gate: run this file on PROD as part of the INCR-42b deploy, THEN verify with
-- db/sql/verify-prod-rls.sql — Query 1 must return ZERO ROWS and Query 2's tenant_tables + fully_forced +
-- with_tenant_isolation + parent_denied must each have risen by exactly 1 (parent_readable UNCHANGED).
--
-- ⚠ NUMBERING (read this once). The DRIZZLE migration is db/migrations/0068_pink_luke_cage.sql — the
-- drizzle chain was at 0067 (the VLC Session register, 0067_chubby_unicorn), so generate produced 0068.
-- The prod-paste SEQUENCE, however, already reached 0069 (prod-paste-0069-vlc-session-register.sql — the
-- two sequences have been diverged since INCR-29, when two policy-only pastes ran ahead of their
-- migrations). So this DDL's prod-paste is 0070 while its migration is 0068; that divergence is expected.
-- The SQL below is byte-identical in EFFECT (same table + constraint + index names) to migration 0068
-- followed by db:policies for this table — a from-migrations rebuild and this paste produce an identical
-- catalog.
--
-- OWNER-LOCKED (#4): a parent sees NOTHING VLC-wide. There is NO parent_scope on this table; the
-- catalog-driven parent_deny loop at the bottom covers it structurally (FORCE-RLS + school_id, no
-- parent_scope), exactly as it auto-denies every other non-parent-readable tenant table.
--
-- OWNER-LOCKED (INCR-42 batch): flag READ = FM(own-class) + DEAN_OF_STUDENTS ONLY; flag CREATE = FM +
-- DEAN (the PG is a `surfaced_by` DATA field, NOT a writer). The ROLE gate ([FM, DEAN]) and the FM
-- OWN-CLASS scoping are APP-LAYER (lib/vlc/), NOT the DB: own-class is a STATIC identity match on the
-- flagged student's class.class_teacher_user_id, not a revocable/expiring grant, so it needs NO
-- staff_grant_scope and NO new GUC (Kofi R318). RLS here enforces ONLY tenant isolation + parent_deny.
-- NO TRIGGERS (portability). severity/context validation is app-layer + the single-row CHECKs below.
--
-- CONFIDENTIAL, REDACTED audit (R320) — a DIFFERENT class from 42a's operational register. The build
-- wires the reserved `vlc_pastoral_` prefix into isRedactedAuditEntity so the whole future family is
-- redacted; audit records metadata only (actionType/entity/actor — NO context/severity/surfaced_by).
-- NO narrative/case-file/journal/character-paragraph column (INCR-43); NO derived scalars (active derives
-- from resolved_at); NO tenant_uk (LEAF); NO unique-on-active (concurrent open flags allowed).
--
-- DDL ORDER (the 0033 FK-before-UNIQUE bug). This table is LEAF and carries NO inline UNIQUE/tenant_uk,
-- so there is no intra-file ordering hazard. Its two composite (school_id, X) FKs reference tenant UKs
-- created in EARLIER migrations that already exist on prod:
--   • (school_id, student_id) → students(school_id, id)     [students_tenant_uk, shipped long ago]
--   • (school_id, session_id) → vlc_session(school_id, id)  [vlc_session_tenant_uk, INCR-42a / paste 0069]
-- The table is created FIRST (PK + the three CHECKs INLINE), THEN the FKs are added, THEN the index.
--
-- CONSTRAINT notes (Kofi R317/R321):
--   • student_id is a FIRST-CLASS column (composite FK, CASCADE) — INCR-45's hasActivePastoralFlag
--     existence-check reads it, never a confidential column.
--   • session_id is NULLABLE (composite FK, ON DELETE NO ACTION): 42a sessions are append-only/never
--     deleted so NO ACTION never fires, and a Dean may raise a session-less flag (a NULL member of the
--     composite FK is MATCH SIMPLE → the check is skipped, so no matching session is required).
--   • raised_by_user_id / resolved_by_user_id are single-column SET NULL → ref_user (the FM/Dean actor
--     stamps — NOT the PG). surfaced_by is the PG DISPLAY attribution (free text, CHECK <= 80).
--   • severity is text + CHECK IN ('NOTE','CONCERN','CRISIS') (the frozen VLC_PASTORAL_SEVERITY list),
--     deliberately NOT a pg enum. context is the SHORT locator (CHECK <= 280 — the physical scope fence
--     keeping the INCR-43 narrative out). Both char_length CHECKs are NULL-safe (the columns are nullable).
--   • resolved_at NULL = active (the open-row idiom). Partial index (school_id, student_id) WHERE
--     resolved_at IS NULL makes the existence-check + the FM own-class read filter indexed lookups.

-- ---- table: vlc_pastoral_flag (TENANT — confidential; LEAF, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "vlc_pastoral_flag" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "session_id" uuid,
  "raised_at" timestamp with time zone DEFAULT now() NOT NULL,
  "raised_by_user_id" uuid,
  "surfaced_by" text,
  "severity" text NOT NULL,
  "context" text,
  "resolved_at" timestamp with time zone,
  "resolved_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vlc_pastoral_flag_surfaced_by_len" CHECK (char_length("vlc_pastoral_flag"."surfaced_by") <= 80),
  CONSTRAINT "vlc_pastoral_flag_severity_valid" CHECK ("vlc_pastoral_flag"."severity" IN ('NOTE', 'CONCERN', 'CRISIS')),
  CONSTRAINT "vlc_pastoral_flag_context_len" CHECK (char_length("vlc_pastoral_flag"."context") <= 280)
);

-- ---- foreign keys (guarded so a re-run is a no-op; the CREATE TABLE above is already done) ----
-- school_id → the ref_school PK (0001), single-column CASCADE. Actor stamps → ref_user SET NULL.
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_flag" ADD CONSTRAINT "vlc_pastoral_flag_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_flag" ADD CONSTRAINT "vlc_pastoral_flag_raised_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("raised_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_flag" ADD CONSTRAINT "vlc_pastoral_flag_resolved_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Composite (school_id, student_id) → students(school_id, id) — first-class, CASCADE.
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_flag" ADD CONSTRAINT "vlc_pastoral_flag_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Composite (school_id, session_id) → vlc_session(school_id, id) — NULLABLE, ON DELETE NO ACTION.
DO $$ BEGIN
  ALTER TABLE "vlc_pastoral_flag" ADD CONSTRAINT "vlc_pastoral_flag_school_id_session_id_vlc_session_school_id_id_fk"
    FOREIGN KEY ("school_id","session_id") REFERENCES "public"."vlc_session"("school_id","id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- index: the partial active-flag index (existence-check + FM own-class read filter) ----
CREATE INDEX IF NOT EXISTS "vlc_pastoral_flag_active_idx"
  ON "vlc_pastoral_flag" USING btree ("school_id","student_id")
  WHERE "resolved_at" IS NULL;

-- ---- RLS: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (this name is added to that
-- hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that forgets to set
-- app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'vlc_pastoral_flag'
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

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0069 ----
-- Owner-locked (#4): a parent NEVER sees VLC, so this confidential table must be denied. This loop is NOT
-- a hand-list: it applies parent_deny to every FORCE-RLS + school_id table that lacks a parent_scope
-- policy — which, after the block above, is the new vlc_pastoral_flag plus every already-covered one (it
-- re-creates their identical policy, hence idempotent). It is re-run here rather than hand-listing the one,
-- so a FUTURE vlc table stays auto-denied. RESTRICTIVE is load-bearing: Postgres OR's PERMISSIVE policies,
-- so a permissive parent policy would OR with tenant_isolation and hand a claimed parent the entire school.
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
