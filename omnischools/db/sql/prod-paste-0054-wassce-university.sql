-- Omnischools — migration 0054: WASSCE university targets + match (SHS module 4.3 / INCR-17b). Closes
-- the INCR-17 split: the university-match half deferred out of 0053. THREE NEW tables + TWO new enums +
-- their RLS, plus the AC21 readiness-index upgrade. Idempotent — safe to run more than once. Paste into
-- the Supabase SQL editor on PROD after merging. (db:policies only configures local dev; a new tenant
-- table needs its RLS pasted on prod by hand, or it leaks across schools.)
--
-- SCOPE: 0054 is a NEW-TABLE migration + ONE index upgrade — NO column ALTERs, NO backfills, NO seed. So
-- this file is the COMPLETE prod application of 0054: the 2 enums + 3 tables + FKs + indexes + the AC21
-- index upgrade + RLS. Running it is equivalent to running migration 0054 followed by db:policies for
-- these tables.
--
-- ONE TENANT table + TWO deliberately GLOBAL reference tables — the split matters, get it right:
--   • university_targets — carries school_id → ENABLE + FORCE RLS + tenant_isolation (the standard
--     tenant policy). Owner is NOT exempt under FORCE (fail-closed). LEAF (nothing references it) → NO
--     tenant UK.
--   • universities / university_programmes — NO school_id (KNUST exists for every tenant), so they get a
--     BARE `ENABLE ROW LEVEL SECURITY` — **NO FORCE, NO tenant_isolation policy** — the benchmark_reference
--     idiom (INCR-16 / 0052). The postgres table owner (the app's direct connection) stays exempt and keeps
--     full access, while the Data API roles (anon / authenticated) are denied by there being no permissive
--     policy — closing the anon-key exposure the Supabase advisor flags, WITHOUT imposing tenant isolation
--     on global reference data. FORCING these would break every tenant's read (AC8).
--
-- DDL ORDER (recall the 0033 FK-before-UNIQUE bug): enums → tables (each carrying its UNIQUE/PK/CHECK
-- INLINE) → FKs → indexes → RLS. Every FK target is created before the FK that references it — every
-- referenced constraint is either an inline PK/UNIQUE emitted in a CREATE TABLE above, or a prior-migration
-- tenant UK already shipped on prod:
--   • university_programmes (university_id)             → universities PK              (created above)
--   • university_targets    (university_programme_id)   → university_programmes PK     (created above)
--   • university_targets    (school_id, candidate_id)   → wassce_candidates_tenant_uk  (0051)
--   • university_targets    (school_id) → ref_school PK · (tagged_by_user_id) → ref_user PK
--
-- CONSTRAINT notes (Kofi rulings 2026-07-19):
--   • R1 — university_programmes: `current_cut_off` NOT NULL with a same-row CHECK 6..54 (the WAEC
--     aggregate scale: six A1 = 6 … six F9 = 54, same scale as the projection). `cut_off_reference_year`
--     NOT NULL labels the figure a SNAPSHOT (every surface cut-off renders "(year)"). Seed-only in 17b —
--     no update UI, so BUILD_STACK's `updated_*`/`public_or_private`/`accreditation_status` are dropped.
--     Single-col FK → universities ON DELETE RESTRICT (a referenced university can't be deleted).
--   • R1 — university_targets: UNIQUE(school_id, candidate_id, university_programme_id) rejects a dup
--     programme per candidate; the PARTIAL UNIQUE(school_id, candidate_id, target_rank) WHERE target_rank
--     IS NOT NULL rejects a 2nd FIRST/SECOND/THIRD_CHOICE while allowing MANY NULL-rank targets (AC12).
--     `target_rank` is NULLABLE — it stores the CHOICE ORDER only; the stretch/match/safety words are the
--     DERIVED computed band (storing both = two sources of truth). Composite (school_id, candidate_id) →
--     wassce_candidates keeps it intra-tenant (AC9); the link to the GLOBAL programme is SINGLE-column
--     RESTRICT (AC10); `tagged_by_user_id` is single-col SET NULL → ref_user.
--   • R5 — `parent_acknowledged_at` is authored now but has NO writer in 17b: the §7 ack is ONE bundled
--     statement-level ack (readiness_statements), not per-programme. Write-flow is INCR-19.
--   • NO TRIGGERS (portability): the match band/margin + the prerequisite check are PURE LIBS
--     (lib/wassce/university-match.ts), DERIVED on read — no match_tier column, no stored tier. The only
--     frozen copy is readiness_statements.target_universities_json, snapshotted at (re)generation (R4).

-- ---- enums needed by the new tables ----
DO $$ BEGIN
  CREATE TYPE "public"."university_type" AS ENUM('PUBLIC_UNIVERSITY', 'PRIVATE_UNIVERSITY', 'TECHNICAL_UNIVERSITY', 'POLYTECHNIC', 'NURSING_COLLEGE', 'EDUCATION_COLLEGE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."target_rank" AS ENUM('FIRST_CHOICE', 'SECOND_CHOICE', 'THIRD_CHOICE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- table 1: universities (GLOBAL — no school_id, single-col FKs only, references nothing) ----
CREATE TABLE IF NOT EXISTS "universities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "short_name" text NOT NULL,
  "university_type" "university_type" NOT NULL,
  "location" text NOT NULL,
  "region" text,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

-- ---- table 2: university_programmes (GLOBAL — inline CHECK 6..54; single-col FK → universities) ----
CREATE TABLE IF NOT EXISTS "university_programmes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "university_id" uuid NOT NULL,
  "name" text NOT NULL,
  "qualification" text NOT NULL,
  "duration_years" smallint,
  "current_cut_off" smallint NOT NULL,
  "cut_off_reference_year" smallint NOT NULL,
  "cut_off_history_json" jsonb,
  "prerequisite_subjects_json" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "university_programmes_current_cut_off_range" CHECK ("current_cut_off" BETWEEN 6 AND 54)
);

-- ---- table 3: university_targets (TENANT, LEAF — inline UNIQUE, no tenant UK) ----
CREATE TABLE IF NOT EXISTS "university_targets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "candidate_id" uuid NOT NULL,
  "university_programme_id" uuid NOT NULL,
  "target_rank" "target_rank",
  "tagged_at" timestamptz DEFAULT now() NOT NULL,
  "tagged_by_user_id" uuid,
  "parent_acknowledged_at" timestamptz,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_university_target_programme" UNIQUE("school_id","candidate_id","university_programme_id")
);

-- ---- foreign keys (all CREATE TABLEs above are done, so every inline/prior-migration UK/PK target exists) ----
-- university_programmes: single-col university_id → universities RESTRICT (global → global, no composite).
DO $$ BEGIN
  ALTER TABLE "university_programmes" ADD CONSTRAINT "university_programmes_university_id_universities_id_fk"
    FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- university_targets: single-col school_id → ref_school CASCADE; single-col university_programme_id →
-- university_programmes RESTRICT (global reference — deliberately NOT composite); single-col tagged_by
-- SET NULL → ref_user; composite (school_id, candidate_id) → wassce_candidates CASCADE (intra-tenant).
DO $$ BEGIN
  ALTER TABLE "university_targets" ADD CONSTRAINT "university_targets_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "university_targets" ADD CONSTRAINT "university_targets_university_programme_id_university_programmes_id_fk"
    FOREIGN KEY ("university_programme_id") REFERENCES "public"."university_programmes"("id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "university_targets" ADD CONSTRAINT "university_targets_tagged_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("tagged_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "university_targets" ADD CONSTRAINT "university_targets_school_id_candidate_id_wassce_candidates_school_id_id_fk"
    FOREIGN KEY ("school_id","candidate_id") REFERENCES "public"."wassce_candidates"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
-- "all programmes for a university" read (§3 cut-off table grouped by institution).
CREATE INDEX IF NOT EXISTS "university_programmes_university_idx"
  ON "university_programmes" USING btree ("university_id");
-- One FIRST/SECOND/THIRD choice per candidate — PARTIAL UNIQUE (NULL-rank targets exempt, AC12).
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_university_target_rank"
  ON "university_targets" USING btree ("school_id","candidate_id","target_rank") WHERE "target_rank" IS NOT NULL;
-- The §6 board read — all targets for a candidate.
CREATE INDEX IF NOT EXISTS "university_targets_candidate_idx"
  ON "university_targets" USING btree ("school_id","candidate_id");

-- ---- AC21 (Dex MEDIUM): readiness_statements_current_idx → PARTIAL UNIQUE ----
-- 0053 shipped this as a NON-unique partial index. Upgrading it to UNIQUE closes the concurrent-generation
-- race: two simultaneous generations for the same candidate can both pass the app's supersede-then-insert
-- check and leave TWO current statements. With the UNIQUE, the 2nd insert hits a unique-violation the
-- generation action's try/catch degrades. Drop-then-create (an index cannot be made unique in place).
--
-- ⚠ PRE-CHECK before running on PROD — this CREATE fails if duplicate current statements already exist.
-- Run this first; it must return ZERO rows:
--   SELECT school_id, candidate_id, count(*) FROM readiness_statements
--    WHERE superseded_at IS NULL GROUP BY 1,2 HAVING count(*) > 1;
-- If it returns rows, supersede the older duplicate(s) (set superseded_at) BEFORE creating the index.
DROP INDEX IF EXISTS "readiness_statements_current_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "readiness_statements_current_idx"
  ON "readiness_statements" USING btree ("school_id","candidate_id") WHERE "superseded_at" IS NULL;

-- ---- RLS — the ONE TENANT table: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'university_targets'
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

-- ---- RLS — the TWO GLOBAL tables: BARE ENABLE ONLY (no FORCE, no policy) ----
-- The benchmark_reference idiom. These have NO school_id, so tenant_isolation does not apply and must NOT
-- be added: a university/programme is reference data every tenant reads. We enable RLS (so the Data API
-- roles anon/authenticated are denied — no permissive policy exists) but intentionally do NOT FORCE it, so
-- the postgres table owner (the app's direct connection) stays exempt and keeps full access. Adding FORCE
-- here would return zero rows to every tenant and break the whole §3/§6 surface (AC8).
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'universities',
    'university_programmes'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
  END LOOP;
END
$$;
