-- =============================================================================
-- Omnischools OVERSIGHT — PROD hand-paste 0001: the three additive fact domains
--   fact_teacher_attendance · fact_infrastructure · fact_plc_participation
--
-- ⚠ JURISDICTION RLS IS NOT AUTO-APPLIED ON PROD. `pnpm db:policies`
-- (scripts/apply-policies.ts → db/sql/policies.sql) only configures LOCAL DEV. This file is the
-- hand-paste that gives the three NEW analytics fact tables their jurisdiction isolation on the LIVE
-- `omnischools-analytics-prod` project. Paste it into the Supabase SQL editor on that project AFTER
-- migration 0001_majestic_gwen_stacy.sql has created the tables — never before.
--
-- This is the FIRST prod-paste file in apps/oversight; it establishes here the convention already
-- used throughout apps/web/db/sql/prod-paste-*.sql. Every future new jurisdiction-scoped analytics
-- table needs its own numbered file.
--
-- FAILS CLOSED IF SKIPPED. The app runtime connects as a NON-OWNER, read-scoped role
-- (docs/PROVISIONING.md §1). If this paste is skipped the tables exist with NO policy:
--   - a table with RLS ENABLED and no policy returns ZERO rows to that role (empty panels), and
--   - the guard below ABORTS rather than silently no-op'ing if a table is missing.
-- The dangerous direction — one district reading another's schools — is not reachable by skipping
-- this file, only by weakening the predicate below. Do not weaken it.
--
-- IDEMPOTENT: ENABLE ROW LEVEL SECURITY is a no-op when already on, and each policy is
-- DROP-then-CREATE. Safe to re-run any number of times.
--
-- The predicate is the SAME one every other fact table uses — `ov_in_subtree(jurisdiction_id)`,
-- defined once in db/sql/policies.sql (already on prod from the initial provisioning). National
-- (MoE) short-circuits to true; every other tier sees only the subtree rooted at its own node.
-- No new helper function is introduced here.
--
-- NOTE ON THE ETL: the nightly loader connects as the owner / a BYPASSRLS role and is meant to
-- bypass these SELECT policies so it can write. Do not add the ETL role to a policy.
-- =============================================================================

-- Fail-closed guard: all three tables must exist (created by migration 0001) before RLS is applied.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fact_teacher_attendance','fact_infrastructure','fact_plc_participation'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '% does not exist — run migration 0001_majestic_gwen_stacy BEFORE this RLS paste', t;
    END IF;
  END LOOP;
END
$$;

-- Sanity guard: the shared predicate must already be present on this database (it is created by the
-- initial db/sql/policies.sql application). Without it the CREATE POLICY below would fail anyway;
-- this makes the reason explicit.
DO $$
BEGIN
  IF to_regprocedure('public.ov_in_subtree(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ov_in_subtree(uuid) is missing — apply db/sql/policies.sql to this database first';
  END IF;
END
$$;

-- ---- ENABLE RLS + the standard jurisdiction_scope SELECT policy ------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fact_teacher_attendance','fact_infrastructure','fact_plc_participation'
  ] LOOP
    EXECUTE format('alter table %I enable row level security;', t);
    EXECUTE format('drop policy if exists jurisdiction_scope on %I;', t);
    EXECUTE format(
      'create policy jurisdiction_scope on %I for select using ( ov_in_subtree(jurisdiction_id) );', t);
  END LOOP;
END
$$;

-- SELECT-only, deliberately: these three are ETL-write / app-read. Unlike fact_anomaly (which takes
-- app triage writes) there is NO update/insert policy here, so the read-scoped app role cannot write
-- them at all.

-- ---- Verification (run after the paste; each row must read t / 1) ----------
-- SELECT c.relname,
--        c.relrowsecurity                                   AS rls_enabled,
--        count(p.polname) FILTER (WHERE p.polname = 'jurisdiction_scope') AS scope_policies
--   FROM pg_class c
--   LEFT JOIN pg_policy p ON p.polrelid = c.oid
--  WHERE c.relname IN ('fact_teacher_attendance','fact_infrastructure','fact_plc_participation')
--  GROUP BY c.relname, c.relrowsecurity
--  ORDER BY c.relname;
--
-- Then, as the NON-OWNER app role (the superuser/owner masks RLS), confirm the boundary holds:
--   SET app.current_level = 'DISTRICT';
--   SET app.current_jurisdiction = '<some district uuid>';
--   SELECT count(*) FROM fact_infrastructure;   -- only that district's schools, never another's
