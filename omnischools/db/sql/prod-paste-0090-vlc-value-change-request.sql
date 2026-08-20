-- Omnischools — PROD paste 0090: VLC curriculum-library change request (SHS module 4.5 / issue #296).
-- TWO stored columns on vlc_value (descriptor + is_capstone) with an ordinal-keyed backfill, plus ONE new
-- tenant table vlc_value_change_request + its RLS. Idempotent — safe to run more than once. Paste into the
-- Supabase SQL editor on PROD after merging (and after migration 0085 has run, though this file is
-- self-contained and does not depend on it — every statement is IF NOT EXISTS / guarded / re-runnable).
--
-- 🔴 RLS IS NOT AUTO-APPLIED ON PROD. `db:policies` only configures LOCAL DEV. If migration 0085 ships to
-- prod without this paste, vlc_value_change_request exists there with NO row-level security: no ENABLE, no
-- FORCE, no tenant_isolation, no parent_deny — so one school's proposed curriculum changes (and the payload
-- naming its taught values) become readable AND writable from every other school's session, and a claimed
-- parent session reads them too. FAIL-CLOSED gate: run this file on PROD as part of the issue-#296 deploy,
-- THEN verify with db/sql/verify-prod-rls.sql — Query 1 must return ZERO ROWS and Query 2's tenant_tables +
-- fully_forced + with_tenant_isolation + parent_denied must each have risen by exactly 1 (parent_readable
-- and global_ok UNCHANGED).
--
-- ⚠ NUMBERING. The DRIZZLE migration is db/migrations/0085_rainy_ironclad.sql; the prod-paste SEQUENCE has
-- been diverged from the migration sequence since INCR-29, so this paste is 0090 while its migration is
-- 0085. That divergence is expected. The SQL below is byte-identical in EFFECT (same columns, backfill,
-- table + constraint + index names, and RLS catalog) to migration 0085 followed by db:policies for this
-- table — a from-migrations rebuild and this paste produce an identical catalog.
--
-- OWNER-RATIFIED (Kofi ruling): approval gates ALL THREE ops (ADD / REORDER / REMOVE); an ADMIN proposes
-- but CANNOT self-approve; approver = HEADMASTER ONLY; apply-on-approval is pragmatic + NON-destructive (so
-- NO year-scoping columns are added to vlc_value). The role gate (Admin proposes / HM decides) AND the
-- ATOMIC ordinal renumber on a REORDER/REMOVE apply are APP-LAYER (lib/vlc/), NOT the DB and NOT a trigger
-- (portability). RLS here enforces ONLY tenant isolation + parent_deny.
--
-- OWNER-LOCKED (#4): a parent sees NOTHING VLC-wide. There is NO parent_scope on this table; the
-- catalog-driven parent_deny loop at the bottom covers it structurally (FORCE-RLS + school_id, no
-- parent_scope), exactly as it auto-denies every other non-parent-readable tenant table.
--
-- DDL ORDER (the 0033 FK-before-UNIQUE bug). vlc_value_change_request is LEAF and carries NO inline
-- UNIQUE / tenant_uk (it references vlc_value ONLY through jsonb payload ids — no direct FK, hence no
-- composite tenant FK), so there is no intra-file ordering hazard. Its three single-column FKs reference
-- objects that already exist on prod (ref_school PK, ref_user PK). The table is created FIRST (PK + the two
-- CHECKs INLINE), THEN the FKs are added, THEN the index.
--
-- CONSTRAINT notes:
--   • op / state are text + CHECK allow-lists (op IN ('ADD','REORDER','REMOVE'); state IN
--     ('PROPOSED','APPROVED','REJECTED') DEFAULT 'PROPOSED'), deliberately NOT pg enums (the
--     vlc_session_template.slot idiom — a bare closed domain the app owns needs no type).
--   • payload is SCHEMA-FREE jsonb (the GOV-9 census hand_fill / reserved-jsonb precedent): ADD carries the
--     new-value fields, REMOVE the target value_id, REORDER the ordered value_id[]. Validated app-layer.
--   • school_id → ref_school single-column CASCADE. proposed_by/decided_by → ref_user single-column SET
--     NULL (the actor stamps). decided_at / decision_note / applied_at are NULL until decided/applied.

-- ---- vlc_value: TWO stored columns (issue #296) + the ordinal-keyed backfill ----
-- The current ordinal-keyed descriptor attach in lib/vlc/defaults.ts (VLC_VALUE_BY_ORDINAL, defaults.ts:296)
-- breaks the moment a value is added/reordered/removed; these stored columns are the hard prerequisite. The
-- reader switches to them in the build slice. ADD COLUMN IF NOT EXISTS + an idempotent backfill BY ORDINAL
-- (the exact key the current reader uses → reproduces today's rendering) from VLC_VALUES, so no live row
-- loses its descriptor. is_capstone defaults false, so only ordinal 11 (Wisdom, the capstone) flips true.
ALTER TABLE "vlc_value" ADD COLUMN IF NOT EXISTS "descriptor" text;
ALTER TABLE "vlc_value" ADD COLUMN IF NOT EXISTS "is_capstone" boolean DEFAULT false NOT NULL;

UPDATE "vlc_value" v SET
  "descriptor" = d.descriptor,
  "is_capstone" = d.is_capstone
FROM (VALUES
  (1, 'foundation value', false),
  (2, 'honesty & consistency', false),
  (3, 'ownership of self & tasks', false),
  (4, 'self-direction', false),
  (5, 'endurance under difficulty', false),
  (6, 'seeing the other''s burden', false),
  (7, 'love of country, civic duty', false),
  (8, 'peaceful difference', false),
  (9, 'using what you have for others', false),
  (10, 'doing what is good, well', false),
  (11, 'capstone · integration', true)
) AS d(ordinal, descriptor, is_capstone)
WHERE v."ordinal" = d.ordinal;

-- ---- table: vlc_value_change_request (TENANT; LEAF, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "vlc_value_change_request" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "op" text NOT NULL,
  "payload" jsonb NOT NULL,
  "state" text DEFAULT 'PROPOSED' NOT NULL,
  "proposed_by_user_id" uuid,
  "proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_by_user_id" uuid,
  "decided_at" timestamp with time zone,
  "decision_note" text,
  "applied_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vlc_value_change_request_op_valid" CHECK ("vlc_value_change_request"."op" IN ('ADD', 'REORDER', 'REMOVE')),
  CONSTRAINT "vlc_value_change_request_state_valid" CHECK ("vlc_value_change_request"."state" IN ('PROPOSED', 'APPROVED', 'REJECTED'))
);

-- ---- foreign keys (guarded so a re-run is a no-op; the CREATE TABLE above is already done) ----
-- school_id → the ref_school PK (0001), single-column CASCADE. Actor stamps → ref_user SET NULL.
DO $$ BEGIN
  ALTER TABLE "vlc_value_change_request" ADD CONSTRAINT "vlc_value_change_request_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_value_change_request" ADD CONSTRAINT "vlc_value_change_request_proposed_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vlc_value_change_request" ADD CONSTRAINT "vlc_value_change_request_decided_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- index: the HEADMASTER pending-approval queue + per-school history listing ----
CREATE INDEX IF NOT EXISTS "vlc_value_change_request_state_idx"
  ON "vlc_value_change_request" USING btree ("school_id","state");

-- ---- RLS: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (this name is added to that
-- hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that forgets to set
-- app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'vlc_value_change_request'
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

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0070 ----
-- Owner-locked (#4): a parent NEVER sees VLC, so this table must be denied. This loop is NOT a hand-list:
-- it applies parent_deny to every FORCE-RLS + school_id table that lacks a parent_scope policy — which,
-- after the block above, is the new vlc_value_change_request plus every already-covered one (it re-creates
-- their identical policy, hence idempotent). It is re-run here rather than hand-listing the one, so a FUTURE
-- vlc table stays auto-denied. RESTRICTIVE is load-bearing: Postgres OR's PERMISSIVE policies, so a
-- permissive parent policy would OR with tenant_isolation and hand a claimed parent the entire school.
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
