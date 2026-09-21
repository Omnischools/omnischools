-- =============================================================================
-- Omnischools OVERSIGHT — PROD hand-paste 0002: jurisdiction-RLS helper SECURITY FIX
--   ov_in_subtree · ov_current_jurisdiction · ov_current_officer · ov_is_national
--   · ov_audit_append_only
--
-- ⚠ JURISDICTION RLS IS NOT AUTO-APPLIED ON PROD. `pnpm db:policies`
-- (scripts/apply-policies.ts → db/sql/policies.sql) only configures LOCAL DEV. This file is the
-- hand-paste that carries a SECURITY FIX to the shared RLS helper functions on the LIVE
-- `omnischools-analytics-prod` project. Paste it into the Supabase SQL editor on that project.
--
-- THIS PASTE SUPERSEDES the helper definitions installed by the initial application of
-- db/sql/policies.sql. It replaces functions only — no table, no policy, no predicate changes, so
-- there is nothing to order it against in the migration stream. It can be applied at any time
-- AFTER the initial policies.sql, and SHOULD be applied BEFORE the ETL writes any rows (see
-- "WHEN TO APPLY" below).
--
-- ---------------------------------------------------------------------------
-- WHAT IT FIXES — two coupled defects, which must land TOGETHER
-- ---------------------------------------------------------------------------
-- (1) INFINITE RECURSION — ov_in_subtree() was `language sql stable` with NO `security definer`.
--     Its body walks dim_jurisdiction, and dim_jurisdiction's own `jurisdiction_scope` policy IS
--     ov_in_subtree(). Called by a NON-OWNER role — which is exactly how the app runtime connects
--     (docs/PROVISIONING.md §1) — the inner read re-enters the policy, which re-enters the
--     function, until:
--           ERROR:  stack depth limit exceeded
--     Effect: once dim_jurisdiction has rows, NO non-owner role can read ANY jurisdiction-scoped
--     table at any tier below NATIONAL. This never showed up in dev because the dev superuser owns
--     the tables and is exempt from RLS (which is precisely why RLS must be proven against the
--     non-owner role), and never at NATIONAL because ov_is_national() short-circuits before the
--     table is touched. It is an availability break, not a leak — the boundary held.
--     FIX: `security definer`, so the internal ancestor walk runs as the function owner and is
--     RLS-exempt. The recursion terminates. This does NOT widen the caller's view: the function
--     returns a boolean, and the calling policy still filters every row.
--
-- (2) pg_temp HIJACK (CVE-2018-1058 class) — the helpers were pinned `set search_path = public`.
--     Postgres searches the temporary schema for RELATION names FIRST, ahead of every schema in
--     search_path, whenever pg_temp is not listed explicitly. So a caller with a SQL channel as the
--     app role could run
--           create temp table dim_jurisdiction (jurisdiction_id uuid, parent_id uuid, ...);
--     and ov_in_subtree() would walk THAT table instead of the real spine — answering "yes, in
--     subtree" for any jurisdiction the attacker chose to plant.
--     On its own that was MEDIUM. Combined with fix (1) it would be HIGH: the planted table would
--     be read WITH OWNER PRIVILEGES — total RLS bypass plus privilege escalation. That is why the
--     two fixes ship as one paste and must never be split.
--     FIX: `set search_path = public, pg_temp` with **pg_temp LAST**, so `public` is resolved first
--     and the temp schema can never shadow a real relation.
--
-- Only ov_in_subtree() needs `security definer` (it is the only helper that reads a table). The
-- other four read session GUCs or raise an exception, so they take the search_path pin ONLY —
-- defence in depth, no privilege change.
--
-- ---------------------------------------------------------------------------
-- WHEN TO APPLY — before the ETL writes rows, ideally
-- ---------------------------------------------------------------------------
-- Defect (1) is latent while dim_jurisdiction is EMPTY (the recursive walk has nothing to recurse
-- into). It becomes a hard, total read failure for every non-NATIONAL tier the moment the first ETL
-- run populates the spine. Apply this paste BEFORE the first ETL load into
-- `omnischools-analytics-prod`. If rows already exist, apply it NOW — every district and regional
-- officer is currently getting `stack depth limit exceeded` instead of a dashboard.
--
-- ---------------------------------------------------------------------------
-- SAFETY
-- ---------------------------------------------------------------------------
-- IDEMPOTENT: every statement is `create or replace function`. Safe to re-run any number of times,
-- in any order among themselves. `create or replace` preserves each function's existing OWNER and
-- its existing EXECUTE grants — which matters for ov_in_subtree, since `security definer` means it
-- now runs as that owner. Confirm the owner is the intended privileged role (the verification query
-- at the foot prints it). If these functions were ever created by some role OTHER than the schema
-- owner, fix the owner BEFORE pasting: `ALTER FUNCTION public.ov_in_subtree(uuid) OWNER TO <owner>;`
--
-- NO DATA IS TOUCHED. No table is altered, no policy is created or dropped, no predicate changes.
-- Replacing a function used in a policy takes only a short lock on the function itself; existing
-- sessions pick up the new definition on their next plan. No downtime, no migration.
--
-- NOT REVERSIBLE BY ROLLBACK OF A MIGRATION (there is no migration): to revert, re-paste the old
-- definitions from git history. Do not. Reverting (1) restores the outage; reverting (2) while (1)
-- is in place opens the privilege-escalation path.
--
-- NOTE ON THE ETL: the nightly loader connects as the owner / a BYPASSRLS role and is unaffected —
-- these helpers are only ever evaluated in SELECT policies, which the owner is exempt from.
-- =============================================================================

-- Sanity guard: the helpers must already exist on this database (created by the initial
-- application of db/sql/policies.sql). This paste REPLACES them; it is not the first install.
DO $$
BEGIN
  IF to_regprocedure('public.ov_in_subtree(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'ov_in_subtree(uuid) is missing — apply db/sql/policies.sql to this database first; 0002 is a replace, not an install';
  END IF;
END
$$;

-- ---- GUC readers: search_path pin only (no privilege change) ---------------
CREATE OR REPLACE FUNCTION ov_current_jurisdiction() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp AS $$
    select nullif(current_setting('app.current_jurisdiction', true), '')::uuid
  $$;

CREATE OR REPLACE FUNCTION ov_current_officer() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp AS $$
    select nullif(current_setting('app.current_officer', true), '')::uuid
  $$;

CREATE OR REPLACE FUNCTION ov_is_national() RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp AS $$
    select coalesce(current_setting('app.current_level', true), '') = 'NATIONAL'
  $$;

-- ---- the subtree predicate: SECURITY DEFINER + pg_temp pin -----------------
-- BODY IS UNCHANGED from db/sql/policies.sql. Only the two modifiers are new.
-- Do NOT apply `force row level security` to dim_jurisdiction: FORCE subjects the owner to RLS too,
-- which would reintroduce the recursion straight through this definer body.
CREATE OR REPLACE FUNCTION ov_in_subtree(jid uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp AS $$
    select ov_is_national()
        or (jid is not null and exists (
          with recursive up as (
            select jid as id
            union all
            select dj.parent_id
            from dim_jurisdiction dj
            join up on dj.jurisdiction_id = up.id
            where dj.parent_id is not null
          )
          select 1 from up where id = ov_current_jurisdiction()
        ));
  $$;

-- ---- append-only audit guard: search_path pin only -------------------------
CREATE OR REPLACE FUNCTION ov_audit_append_only() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp AS $$
  begin
    raise exception 'audit_access_log is append-only (% rejected)', tg_op;
  end $$;

-- ---- Verification (run after the paste) ------------------------------------
-- A) Every helper must show the pinned search_path, and ONLY ov_in_subtree may be prosecdef = t.
--    Check `owner` on ov_in_subtree is the privileged schema owner — that is who it now runs as.
--
-- SELECT p.proname,
--        p.prosecdef                              AS security_definer,
--        pg_get_userbyid(p.proowner)              AS owner,
--        p.proconfig                              AS settings
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname IN ('ov_in_subtree','ov_current_jurisdiction','ov_current_officer',
--                      'ov_is_national','ov_audit_append_only')
--  ORDER BY p.proname;
--
--    Expected: settings = {"search_path=public, pg_temp"} on all five;
--              security_definer = t on ov_in_subtree ONLY, f on the other four.
--
-- B) Then, as the NON-OWNER app role (the owner masks RLS, so this MUST be the app role),
--    confirm reads work and the boundary still holds:
--
--   SET app.current_level = 'DISTRICT';
--   SET app.current_jurisdiction = '<district uuid>';
--   SELECT count(*) FROM fact_enrolment;   -- must RETURN A NUMBER, not 'stack depth limit exceeded'
--                                          -- and must cover only that district's schools
--   SET app.current_jurisdiction = '<a DIFFERENT district uuid>';
--   SELECT count(*) FROM fact_enrolment;   -- a different, disjoint set — never the first district's
--
--   RESET app.current_jurisdiction; RESET app.current_level;
--   SELECT count(*) FROM fact_enrolment;   -- 0 (fails closed with no GUCs set)
--
-- C) The pg_temp pin is load-bearing — prove it is holding, as the NON-OWNER app role:
--
--   CREATE TEMP TABLE dim_jurisdiction (jurisdiction_id uuid, parent_id uuid);
--   INSERT INTO dim_jurisdiction VALUES ('<a FOREIGN district uuid>', '<your district uuid>');
--   SET app.current_level = 'DISTRICT';
--   SET app.current_jurisdiction = '<your district uuid>';
--   SELECT count(*) FROM public.fact_enrolment;  -- UNCHANGED from (B): the planted table is ignored
--   DROP TABLE pg_temp.dim_jurisdiction;
