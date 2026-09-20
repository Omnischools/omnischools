-- Omnischools — PROD paste 0080: PTA minutes + resolutions + action items (SHS module 4.7 / INCR-53). FOUR
-- new tenant tables (pta_minutes + pta_agenda_item + pta_action_item + pta_resolution) + their RLS. NO enum,
-- NO altered columns, NO backfills, NO seed, NO global-table changes. Idempotent — safe to run more than
-- once. Paste into the Supabase SQL editor on PROD after merging.
--
-- ⚠ NUMBERING (read this once). The DRIZZLE migration is db/migrations/0077_tan_shinobi_shaw.sql — the
-- drizzle chain was at 0076 (the PTA meeting register, 0076_fine_frog_thor), so generate produced 0077. The
-- prod-paste SEQUENCE, however, already reached 0079 (prod-paste-0079-pta-meetings.sql — the two sequences
-- have diverged since INCR-29). So this DDL's prod-paste is 0080 while its migration is 0077; that
-- divergence is expected. The SQL below is byte-identical in EFFECT (same four tables + constraints +
-- indexes + policies) to migration 0077 followed by db:policies for the four tables — a from-migrations
-- rebuild and this paste produce an identical catalog.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. If migration 0077 ships to
-- prod without this paste, pta_minutes / pta_agenda_item / pta_action_item / pta_resolution exist there with
-- NO row-level security at all: no ENABLE, no FORCE, no tenant_isolation, no parent_deny. Every school's PTA
-- minutes record — the meeting narrative, the resolutions and their vote tallies, the action-item owners —
-- becomes readable AND writable from every other school's session, and a claimed parent session reads it
-- too. FAIL-CLOSED gate: run this file on PROD as part of the INCR-53 deploy, THEN verify with
-- db/sql/verify-prod-rls.sql — Query 1 must return ZERO ROWS and Query 2's tenant_tables + fully_forced +
-- with_tenant_isolation + parent_denied must each have risen by exactly 4 (parent_readable UNCHANGED — the
-- minutes record has no parent path in THIS increment; the ADOPTED-only parent read is INCR-55, R457).
--
-- OWNER-LOCKED (R456/R457): a parent reads NOTHING of the minutes record here. There is NO parent_scope on
-- any of the four tables; the catalog-driven parent_deny loop at the bottom covers them structurally
-- (FORCE-RLS + school_id, no parent_scope), exactly as it auto-denies every other non-parent-readable tenant
-- table. The ADOPTED-only parent read (own-child own-PTA adopted minutes + school-wide GENERAL-tier
-- transparency) RETURNS at INCR-55, NOT here. OPERATIONAL / SHOWN — NO confidential/REDACTED layer, NO
-- parent_scope, NO new GUC, NO triggers. The 🔴 R451 adopted-is-TOTAL-immutable fence, the R450 lifecycle,
-- the R452 quorum->resolution gate, the R453 resolution-number assignment and the R455 submit validation are
-- ALL app-enforced in lib/pta/ — there is deliberately NO trigger and NO cross-table CHECK.
--
-- DDL ORDER — the composite-FK CHAIN (the 0033 target-before-FK discipline, R444). Each table carries its
-- INLINE tenant UK UNIQUE(school_id, id) in the CREATE TABLE, and the next link's composite (school_id, …)
-- FK targets it: pta_minutes (pta_minutes_tenant_uk) -> pta_agenda_item (pta_agenda_item_tenant_uk) ->
-- {pta_action_item, pta_resolution}. All four CREATE TABLEs run FIRST (UKs and all), then every FK is added
-- in a DO-guarded block, so each target UNIQUE exists before its FK and a re-run is a clean no-op.
-- pta_minutes' composite (school_id, meeting_id) FK targets the PRE-EXISTING pta_meeting UNIQUE(school_id,
-- id) = pta_meeting_tenant_uk (migration 0076 / prod-paste 0079). action_item + resolution are LEAF (nothing
-- FKs them) -> NO tenant UK.
--
-- CONSTRAINT notes (Kofi R445–R448):
--   • pta_minutes (1:1 meeting): `status` CHECK IN ('DRAFT','CHAIR_REVIEW','ADOPTED') default 'DRAFT';
--     `secretary_id` / `adopted_by_user_id` single-col SET NULL -> ref_user; `adopted_at` / `distributed_at`
--     nullable. UNIQUE(school_id, meeting_id) = the 1:1 AND the draft-create upsert conflict target. Inline
--     pta_minutes_tenant_uk UNIQUE(school_id, id) = FK target of pta_agenda_item. NO stored preamble/period
--     (R454 DERIVED).
--   • pta_agenda_item: `classification` CHECK is NULL-tolerant — (classification IS NULL OR classification
--     IN ('DISCUSSION','ACTION','RESOLUTION')) — NULLABLE while drafting, pinned at submit (R446/R455/R449).
--     Inline pta_agenda_item_tenant_uk UNIQUE(school_id, id) = FK target of BOTH leaf tables.
--   • pta_action_item (LEAF): owner = person_user_id (single-col SET NULL -> ref_user) XOR external_name;
--     `pta_action_item_at_most_one_owner` CHECK NOT (both set) — the pta_officer at-most-one soft guard (a
--     SET NULL degradation must not violate it; exactly-one is the app-side write rule). `deadline` nullable
--     (NULL = Ongoing, R447); `status` CHECK IN ('PENDING','DONE') default 'PENDING'. NO tenant UK.
--   • pta_resolution (LEAF): `resolution_no` NULLABLE until adoption (R453 — multiple NULLs are DISTINCT in
--     the UNIQUE, so drafts never collide); `resolution_text`; three vote tallies NOT NULL each with a >= 0
--     CHECK; `binding` NOT NULL. UNIQUE(school_id, resolution_no) = the NNN=MAX+1 assignment guard. The
--     OUTCOME (PASSED <=> votes_for > votes_against) is DERIVED at read, NEVER stored (R448). NO tenant UK.

-- ---- table: pta_minutes (TENANT — 1:1 the meeting; carries INLINE tenant UK, the agenda_item FK target) ----
CREATE TABLE IF NOT EXISTS "pta_minutes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "meeting_id" uuid NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "secretary_id" uuid,
  "adopted_by_user_id" uuid,
  "adopted_at" timestamp with time zone,
  "distributed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_pta_minutes_meeting" UNIQUE("school_id","meeting_id"),
  CONSTRAINT "pta_minutes_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "pta_minutes_status_valid" CHECK ("pta_minutes"."status" IN ('DRAFT', 'CHAIR_REVIEW', 'ADOPTED'))
);

-- ---- table: pta_agenda_item (TENANT — a minuted item; carries INLINE tenant UK, the leaf-tables FK target) ----
CREATE TABLE IF NOT EXISTS "pta_agenda_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "minutes_id" uuid NOT NULL,
  "seq_no" integer NOT NULL,
  "title" text NOT NULL,
  "classification" text,
  "narrative" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pta_agenda_item_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "pta_agenda_item_classification_valid" CHECK ("pta_agenda_item"."classification" IS NULL OR "pta_agenda_item"."classification" IN ('DISCUSSION', 'ACTION', 'RESOLUTION'))
);

-- ---- table: pta_action_item (TENANT — the ACTION assignment; LEAF, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "pta_action_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "agenda_item_id" uuid NOT NULL,
  "description" text NOT NULL,
  "person_user_id" uuid,
  "external_name" text,
  "deadline" date,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pta_action_item_at_most_one_owner" CHECK (NOT ("pta_action_item"."person_user_id" IS NOT NULL AND "pta_action_item"."external_name" IS NOT NULL)),
  CONSTRAINT "pta_action_item_status_valid" CHECK ("pta_action_item"."status" IN ('PENDING', 'DONE'))
);

-- ---- table: pta_resolution (TENANT — the RESOLUTION decision; LEAF, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "pta_resolution" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "agenda_item_id" uuid NOT NULL,
  "resolution_no" text,
  "resolution_text" text NOT NULL,
  "votes_for" integer NOT NULL,
  "votes_against" integer NOT NULL,
  "votes_abstain" integer NOT NULL,
  "binding" boolean NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_pta_resolution_no" UNIQUE("school_id","resolution_no"),
  CONSTRAINT "pta_resolution_votes_for_nonneg" CHECK ("pta_resolution"."votes_for" >= 0),
  CONSTRAINT "pta_resolution_votes_against_nonneg" CHECK ("pta_resolution"."votes_against" >= 0),
  CONSTRAINT "pta_resolution_votes_abstain_nonneg" CHECK ("pta_resolution"."votes_abstain" >= 0)
);

-- ---- foreign keys (guarded so a re-run is a no-op; the CREATE TABLEs above are already done) ----
-- pta_minutes.school_id -> ref_school PK, single-column CASCADE.
DO $$ BEGIN
  ALTER TABLE "pta_minutes" ADD CONSTRAINT "pta_minutes_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_minutes.secretary_id -> the GLOBAL ref_user, single-column SET NULL (the drafter).
DO $$ BEGIN
  ALTER TABLE "pta_minutes" ADD CONSTRAINT "pta_minutes_secretary_id_ref_user_id_fk"
    FOREIGN KEY ("secretary_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_minutes.adopted_by_user_id -> the GLOBAL ref_user, single-column SET NULL (the Chair; NULL until adopt).
DO $$ BEGIN
  ALTER TABLE "pta_minutes" ADD CONSTRAINT "pta_minutes_adopted_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("adopted_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_minutes composite (school_id, meeting_id) -> the PRE-EXISTING pta_meeting (school_id, id) tenant UK,
-- CASCADE (a meeting delete takes its minutes). A cross-tenant meeting reference is structurally impossible.
DO $$ BEGIN
  ALTER TABLE "pta_minutes" ADD CONSTRAINT "pta_minutes_school_id_meeting_id_pta_meeting_school_id_id_fk"
    FOREIGN KEY ("school_id","meeting_id") REFERENCES "public"."pta_meeting"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_agenda_item.school_id -> ref_school PK, single-column CASCADE.
DO $$ BEGIN
  ALTER TABLE "pta_agenda_item" ADD CONSTRAINT "pta_agenda_item_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_agenda_item composite (school_id, minutes_id) -> the pta_minutes (school_id, id) tenant UK created
-- above, CASCADE. A cross-tenant minutes reference is structurally impossible.
DO $$ BEGIN
  ALTER TABLE "pta_agenda_item" ADD CONSTRAINT "pta_agenda_item_school_id_minutes_id_pta_minutes_school_id_id_fk"
    FOREIGN KEY ("school_id","minutes_id") REFERENCES "public"."pta_minutes"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_action_item.school_id -> ref_school PK, single-column CASCADE.
DO $$ BEGIN
  ALTER TABLE "pta_action_item" ADD CONSTRAINT "pta_action_item_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_action_item.person_user_id -> the GLOBAL ref_user, single-column SET NULL (the owner, when a user).
DO $$ BEGIN
  ALTER TABLE "pta_action_item" ADD CONSTRAINT "pta_action_item_person_user_id_ref_user_id_fk"
    FOREIGN KEY ("person_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_action_item composite (school_id, agenda_item_id) -> the pta_agenda_item (school_id, id) tenant UK
-- created above, CASCADE. A cross-tenant agenda-item reference is structurally impossible.
DO $$ BEGIN
  ALTER TABLE "pta_action_item" ADD CONSTRAINT "pta_action_item_school_id_agenda_item_id_pta_agenda_item_school_id_id_fk"
    FOREIGN KEY ("school_id","agenda_item_id") REFERENCES "public"."pta_agenda_item"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_resolution.school_id -> ref_school PK, single-column CASCADE.
DO $$ BEGIN
  ALTER TABLE "pta_resolution" ADD CONSTRAINT "pta_resolution_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- pta_resolution composite (school_id, agenda_item_id) -> the pta_agenda_item (school_id, id) tenant UK
-- created above, CASCADE. A cross-tenant agenda-item reference is structurally impossible.
DO $$ BEGIN
  ALTER TABLE "pta_resolution" ADD CONSTRAINT "pta_resolution_school_id_agenda_item_id_pta_agenda_item_school_id_id_fk"
    FOREIGN KEY ("school_id","agenda_item_id") REFERENCES "public"."pta_agenda_item"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
-- "all agenda items for this minutes, in order" read + the FK-cascade support.
CREATE INDEX IF NOT EXISTS "pta_agenda_item_minutes_idx"
  ON "pta_agenda_item" USING btree ("school_id","minutes_id","seq_no");
-- "all actions for this agenda item" read + the FK-cascade support.
CREATE INDEX IF NOT EXISTS "pta_action_item_agenda_item_idx"
  ON "pta_action_item" USING btree ("school_id","agenda_item_id");
-- "all resolutions for this agenda item" read + the FK-cascade support.
CREATE INDEX IF NOT EXISTS "pta_resolution_agenda_item_idx"
  ON "pta_resolution" USING btree ("school_id","agenda_item_id");

-- ---- RLS — all four tables: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (all four tables are added to
-- that hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that forgets to
-- set app.current_school returns ZERO rows — it fails safe rather than leaking.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'pta_minutes',
    'pta_agenda_item',
    'pta_action_item',
    'pta_resolution'
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

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0079 ----
-- Owner-locked (R456/R457): a parent reads NOTHING of the minutes record in this increment, so all four new
-- tables must be denied. This loop is NOT a hand-list: it applies parent_deny to every FORCE-RLS + school_id
-- table that lacks a parent_scope policy — which, after the block above, is the new pta_minutes +
-- pta_agenda_item + pta_action_item + pta_resolution plus every already-covered one (it re-creates their
-- identical policy, hence idempotent). It is re-run here rather than hand-listing, so a FUTURE PTA table
-- stays auto-denied. RESTRICTIVE is load-bearing: Postgres OR's PERMISSIVE policies, so a permissive parent
-- policy would OR with tenant_isolation and hand a claimed parent the entire school. (The ADOPTED-only
-- parent read is INCR-55, R457 — a dedicated withParentScope reader added THERE, not a widening of this deny.)
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
