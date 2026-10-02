-- =============================================================================
-- Omnischools OVERSIGHT — PROD hand-paste 0005: OFFICER AUTH (increment G)
--   ref_oversight_officer       — the officer directory, keyed by Supabase auth uid
--   audit_officer_provisioning  — append-only provisioning / approval history
--
-- Installs, idempotently:
--   · ov_resolve_officer(uuid)                   SECURITY DEFINER — the ONLY read path into the
--                                                directory (the bootstrap resolution)
--   · ov_officer_node_tier(uuid)                 node tier lookup + the no-SCHOOL-officer refusal
--   · ov_officer_directory_guard()               write trigger: node eligible, role matches tier
--   · ov_officer_provisioning_tier_guard()       write trigger: recorded tier must match the node
--   · ov_officer_provisioning_append_only()      UPDATE/DELETE refusal on the provisioning log
--   · RLS posture on both tables + the provisioner read policy
--   · the GRANT/REVOKE posture, which is where the real security lives
--
-- ⚠ RLS IS NOT AUTO-APPLIED ON PROD. `pnpm db:policies` (scripts/apply-policies.ts →
-- db/sql/policies.sql) configures LOCAL DEV ONLY. Per docs/PROVISIONING.md §2a a new table is TWO
-- steps: apply the migration, then paste this file. Paste it into the Supabase SQL editor on
-- `omnischools-analytics-prod` AFTER migration 0004_white_eternity.sql has run — never before — and
-- run the verification blocks at the foot AS THE NON-OWNER APP ROLE (the owner is exempt from RLS
-- and would show a false pass).
--
-- ⚠ HOW THIS ONE FAILS IF YOU SKIP IT. Not with an empty panel. Migration 0004 creates both tables
-- with RLS ENABLED and no policy, so nothing leaks — but the directory's only read path is
-- ov_resolve_officer(), which this file creates. Skip the paste and every sign-in fails with
-- `function ov_resolve_officer(uuid) does not exist`: a total, immediately visible outage rather
-- than a quiet disclosure. That is the intended direction of failure. Do not "fix" it in a hurry by
-- adding `create policy ... using (true)` on ref_oversight_officer — that converts the app
-- credential into a GES-officer roster enumeration primitive (name, work email, tier and node for
-- every officer in Ghana), which is the single thing this design exists to prevent. Paste this file.
--
-- POSTURE: ENABLE, NEVER FORCE. The provisioner/owner connection writes both tables, and these
-- policies are written to admit nobody but the provisioner role — FORCE would subject the owner to
-- them and lock provisioning out of its own tables. Re-asserting ENABLE on an already-enabled table
-- is a no-op, so this file is safe to re-run any number of times, in any order after the migration.
-- =============================================================================

-- ---- Fail-closed guards: migration 0004 and the RLS baseline must be in place ----
DO $$
BEGIN
  IF to_regclass('public.ref_oversight_officer') IS NULL THEN
    RAISE EXCEPTION 'ref_oversight_officer missing — run migration 0004_white_eternity BEFORE this paste';
  END IF;
  IF to_regclass('public.audit_officer_provisioning') IS NULL THEN
    RAISE EXCEPTION 'audit_officer_provisioning missing — run migration 0004_white_eternity BEFORE this paste';
  END IF;
  IF to_regclass('public.dim_jurisdiction') IS NULL THEN
    RAISE EXCEPTION 'dim_jurisdiction missing — this database has not been migrated at all';
  END IF;
  -- Not called by anything below, but its absence means db/sql/policies.sql was never applied to
  -- this database, in which case the whole jurisdiction boundary is missing and officer auth is the
  -- wrong thing to be installing first.
  IF to_regprocedure('public.ov_in_subtree(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ov_in_subtree(uuid) is missing — apply db/sql/policies.sql (and prod-paste-0002) to this database first';
  END IF;
  -- The derived-tier join and the guards depend on these two columns existing with these names.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ref_oversight_officer' AND column_name='jurisdiction_id'
  ) THEN
    RAISE EXCEPTION 'ref_oversight_officer.jurisdiction_id missing — migration 0004 did not apply cleanly';
  END IF;
  -- If a `level` column ever appears here, the derived-tier rule (Kofi R2/AC10) has been broken and
  -- this file's security argument no longer holds. Refuse rather than install over it.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ref_oversight_officer' AND column_name='level'
  ) THEN
    RAISE EXCEPTION 'ref_oversight_officer has a `level` column — tier must be DERIVED from dim_jurisdiction.level (Kofi R2/AC10), never stored. Stop and resolve this before pasting.';
  END IF;
END
$$;

-- ---- Re-assert the RLS posture ---------------------------------------------
-- The migration already did this at CREATE time (that is what makes the pre-paste window safe);
-- these two statements are the repair path if a prior step was lost.
ALTER TABLE ref_oversight_officer ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_officer_provisioning ENABLE ROW LEVEL SECURITY;

-- ref_oversight_officer gets NO POLICY THE APP ROLE CAN REACH. The absence is the design: with no
-- applicable policy a non-owner role reads ZERO rows by any direct query (select *, count, join,
-- subquery), while the SECURITY DEFINER function below serves the one legitimate read. The only
-- policies installed on this table are ROLE-TARGETED at the provisioner (the block near the foot) —
-- a policy with a `TO` clause is never considered for any other role, so it widens nothing for the
-- app credential.
--
-- These DROPs remove any un-targeted policy a previous hand may have added — including the
-- `using (true)` someone reaches for when sign-in breaks.
DROP POLICY IF EXISTS officer_self ON ref_oversight_officer;
DROP POLICY IF EXISTS read_all ON ref_oversight_officer;
DROP POLICY IF EXISTS jurisdiction_scope ON ref_oversight_officer;

-- ---- ov_resolve_officer: THE bootstrap read --------------------------------
--
-- This is the one read in the application that runs with NO jurisdiction GUC set — it is the read
-- that PRODUCES the jurisdiction. It must therefore be incapable of returning a row the caller did
-- not already name, and it must be able to derive the tier from dim_jurisdiction while that table's
-- own policy (which needs the GUC) cannot help it. SECURITY DEFINER does both; see the long note in
-- db/sql/policies.sql for why this was chosen over an `app.current_auth_user` GUC + policy (short
-- version: a policy-based bootstrap cannot do the dim_jurisdiction join at all, and the only ways
-- around that are to store `level` on the directory or widen the spine's policy — both worse).
--
-- `set search_path = public, pg_temp` with PG_TEMP LAST is mandatory and is upgraded from hygiene to
-- a hard boundary by SECURITY DEFINER: without it a planted `create temp table ref_oversight_officer`
-- would be read WITH OWNER PRIVILEGES, i.e. plant a row, become NATIONAL.
CREATE OR REPLACE FUNCTION ov_resolve_officer(uid uuid)
  RETURNS TABLE (
    officer_id uuid,
    jurisdiction_id uuid,
    level jurisdiction_level,
    officer_role ov_officer_role
  )
  LANGUAGE sql STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp AS $$
    SELECT o.officer_id, o.jurisdiction_id, j.level, o.officer_role
      FROM ref_oversight_officer o
      JOIN dim_jurisdiction j ON j.jurisdiction_id = o.jurisdiction_id
     WHERE uid IS NOT NULL          -- unauthenticated / no `sub` → zero rows, explicitly
       AND o.officer_id = uid       -- cannot return a row the caller did not name
       AND o.is_active              -- deactivation is effective in the DATABASE
       AND j.level <> 'SCHOOL'      -- Kofi R1, restated on the read side
     LIMIT 1                        -- cannot return two
  $$;

-- A SECURITY DEFINER function is EXECUTE-able by PUBLIC by default — on Supabase that includes
-- `anon` and `authenticated`, both of which can call a public-schema function as a PostgREST RPC.
-- Left as-is this would be an unauthenticated "resolve any uid I can harvest" endpoint.
REVOKE ALL ON FUNCTION ov_resolve_officer(uuid) FROM PUBLIC;

-- ---- Write-side guards ------------------------------------------------------
-- SECURITY DEFINER because THE WRITER IS A NON-OWNER ROLE. The provisioner is a separate login role,
-- so its lookup here would otherwise be subject to dim_jurisdiction's `jurisdiction_scope` policy —
-- which needs `app.current_jurisdiction`, a GUC that means nothing during provisioning. Without
-- definer the lookup finds nothing and the `not present` raise refuses EVERY provisioning write: the
-- guard would fail closed against the legitimate writer, which is the surest way to get a guard
-- deleted. (The alternative — having the provisioner set `app.current_level = 'NATIONAL'` around its
-- transaction — makes a correctness-critical guard depend on the caller first granting itself
-- national scope, which is the habit this table exists to prevent.) `pg_temp` LAST, as ever.
CREATE OR REPLACE FUNCTION ov_officer_node_tier(jid uuid) RETURNS jurisdiction_level
  LANGUAGE plpgsql STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp AS $$
  DECLARE node_level jurisdiction_level;
  BEGIN
    SELECT j.level INTO node_level FROM dim_jurisdiction j WHERE j.jurisdiction_id = jid;
    IF node_level IS NULL THEN
      RAISE EXCEPTION 'oversight officer node % is not present (or not visible) in dim_jurisdiction', jid;
    END IF;
    -- Kofi R1: NO SCHOOL-TIER OVERSIGHT OFFICER. Enforced as a trigger, not a CHECK, because the
    -- disqualifying fact (dim_jurisdiction.level) lives in another table. SCHOOL stays a fully valid
    -- jurisdiction_level everywhere else in the engine.
    IF node_level = 'SCHOOL' THEN
      RAISE EXCEPTION 'no SCHOOL-tier oversight officer: jurisdiction % is a SCHOOL node (Kofi R1)', jid;
    END IF;
    RETURN node_level;
  END $$;

-- Same reason as ov_resolve_officer: a SECURITY DEFINER function is EXECUTE-able by PUBLIC by
-- default, which on Supabase includes `anon` over PostgREST. The provisioner is granted it back
-- explicitly in the role block below (the write triggers call it as the INVOKER, so the writing role
-- genuinely needs EXECUTE or every provisioning write fails).
REVOKE ALL ON FUNCTION ov_officer_node_tier(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION ov_officer_directory_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp AS $$
  DECLARE
    node_level jurisdiction_level;
    expected ov_officer_role;
  BEGIN
    node_level := ov_officer_node_tier(new.jurisdiction_id);
    expected := (CASE node_level
                   WHEN 'DISTRICT' THEN 'DISTRICT_OVERSIGHT'
                   WHEN 'REGION'   THEN 'REGIONAL_OVERSIGHT'
                   WHEN 'NATIONAL' THEN 'NATIONAL_OVERSIGHT'
                 END)::ov_officer_role;
    IF new.officer_role <> expected THEN
      RAISE EXCEPTION 'officer_role % contradicts the % tier of jurisdiction % (expected %)',
        new.officer_role, node_level, new.jurisdiction_id, expected;
    END IF;
    RETURN new;
  END $$;

DROP TRIGGER IF EXISTS officer_directory_guard ON ref_oversight_officer;
CREATE TRIGGER officer_directory_guard
  BEFORE INSERT OR UPDATE ON ref_oversight_officer
  FOR EACH ROW EXECUTE FUNCTION ov_officer_directory_guard();

-- The two-person CHECK keys on `target_tier`, which the WRITER supplies — so on its own it is
-- forgeable (record a NATIONAL grant as DISTRICT and the approver requirement disappears). This
-- trigger derives the tier from the node and refuses a mismatch, which is what makes the CHECK's
-- input honest. Keep both halves.
CREATE OR REPLACE FUNCTION ov_officer_provisioning_tier_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp AS $$
  DECLARE node_level jurisdiction_level;
  BEGIN
    node_level := ov_officer_node_tier(new.target_jurisdiction_id);
    IF new.target_tier <> node_level THEN
      RAISE EXCEPTION
        'target_tier % does not match dim_jurisdiction.level % of node % — the two-person rule keys on target_tier and must not be forgeable',
        new.target_tier, node_level, new.target_jurisdiction_id;
    END IF;
    RETURN new;
  END $$;

DROP TRIGGER IF EXISTS officer_provisioning_tier_guard ON audit_officer_provisioning;
CREATE TRIGGER officer_provisioning_tier_guard
  BEFORE INSERT ON audit_officer_provisioning
  FOR EACH ROW EXECUTE FUNCTION ov_officer_provisioning_tier_guard();

-- Append-only, mirroring ov_audit_append_only on audit_access_log — same caveat: the trigger is the
-- LOUD half, the absent UPDATE/DELETE grant is the real guard. A correction is a new row.
CREATE OR REPLACE FUNCTION ov_officer_provisioning_append_only() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp AS $$
  BEGIN
    RAISE EXCEPTION 'audit_officer_provisioning is append-only (% rejected)', tg_op;
  END $$;

DROP TRIGGER IF EXISTS officer_provisioning_append_only ON audit_officer_provisioning;
CREATE TRIGGER officer_provisioning_append_only
  BEFORE UPDATE OR DELETE ON audit_officer_provisioning
  FOR EACH ROW EXECUTE FUNCTION ov_officer_provisioning_append_only();

-- ============================================================================
-- ⇩⇩ EDIT THESE TWO ROLE NAMES BEFORE RUNNING ⇩⇩
--
-- `app_role`         — the read-scoped NON-OWNER role behind ANALYTICS_DATABASE_URL (PROVISIONING §1).
-- `provisioner_role` — the Omnischools provisioner role. A SEPARATE role, not the app role and not
--                      the owner. If it does not exist yet, create it first:
--                        create role oversight_provisioner login password '…' noinherit;
--                      The whole point of the directory is that the credential the web app runs
--                      under cannot grant oversight authority, and "cannot" has to mean a different
--                      role rather than a different code path.
--
-- The block RAISES if either role is absent, rather than silently installing half a posture.
-- ============================================================================
DO $$
DECLARE
  app_role          text := 'oversight_app';
  provisioner_role  text := 'oversight_provisioner';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'app role % does not exist — set app_role at the top of this block to the real ANALYTICS_DATABASE_URL role', app_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = provisioner_role) THEN
    RAISE EXCEPTION 'provisioner role % does not exist — create it (see the note above) or set provisioner_role to the real one', provisioner_role;
  END IF;

  -- 1 · THE APP ROLE: SELECT ON THE DIRECTORY, AND NOTHING ELSE, EVER.
  --     The missing UPDATE grant — not a policy — is what makes self-promotion impossible:
  --       update ref_oversight_officer set officer_role='NATIONAL_OVERSIGHT',
  --              jurisdiction_id='<national>' where officer_id='<me>';
  --     must fail with `permission denied for table ref_oversight_officer`, before RLS and before
  --     the trigger are consulted. A policy can be mis-edited into permitting that; a privilege that
  --     was never issued cannot.
  --     (SELECT yields ZERO rows anyway — no policy — so the grant is harmless and kept only so the
  --     posture matches `grant select on all tables`, which is how this role is usually set up.)
  EXECUTE format('GRANT SELECT ON ref_oversight_officer TO %I', app_role);
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ref_oversight_officer FROM %I', app_role);

  --     …and the app role must be able to CALL the bootstrap function (EXECUTE was revoked from
  --     PUBLIC above, which included it).
  EXECUTE format('GRANT EXECUTE ON FUNCTION ov_resolve_officer(uuid) TO %I', app_role);

  -- 2 · THE APP ROLE GETS NOTHING AT ALL ON THE PROVISIONING LOG. A GES officer must not be able to
  --     read who granted whom national access, and a role that could read this table would have the
  --     officer roster the directory exists to withhold. Note the ordering trap: a prior
  --     `grant select on all tables in schema public` would have handed it over, so this REVOKE must
  --     run after any such blanket grant (re-run this file if one is issued later).
  EXECUTE format('REVOKE ALL ON audit_officer_provisioning FROM %I', app_role);

  -- 3 · THE PROVISIONER: reads the log, appends to it, and maintains the directory. NO DELETE on
  --     either table — offboarding is `is_active = false`, and a correction to the log is a new row.
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', provisioner_role);
  EXECUTE format('GRANT SELECT, INSERT ON audit_officer_provisioning TO %I', provisioner_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ref_oversight_officer TO %I', provisioner_role);
  EXECUTE format('REVOKE DELETE, TRUNCATE ON ref_oversight_officer FROM %I', provisioner_role);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON audit_officer_provisioning FROM %I', provisioner_role);
  --     The write triggers call ov_officer_node_tier() as the INVOKER, so the provisioner needs
  --     EXECUTE on it (it was revoked from PUBLIC above) or every provisioning write fails with
  --     `permission denied for function ov_officer_node_tier`.
  EXECUTE format('GRANT EXECUTE ON FUNCTION ov_officer_node_tier(uuid) TO %I', provisioner_role);
  --     A plain SELECT grant on the spine so the provisioner can look up the node it is about to
  --     reference. NOTE: dim_jurisdiction is jurisdiction-RLS'd, so with no GUC set this returns ZERO
  --     rows — the provisioner UI must set `app.current_level = 'NATIONAL'` for its own READS (it is
  --     a nationally-scoped internal tool). That is a read convenience only: the WRITE guards do not
  --     depend on it, which is why ov_officer_node_tier() is SECURITY DEFINER.
  EXECUTE format('GRANT SELECT ON dim_jurisdiction TO %I', provisioner_role);

  -- 4 · The POLICIES, every one of them targeted AT THE PROVISIONER ROLE.
  --
  --     These are `using (true)` / `with check (true)`, which the directory refuses for the app
  --     role — the difference is the TO clause. A `TO oversight_provisioner` policy authorises by
  --     ROLE and is never even considered for another role, so it is unreachable from the app
  --     credential (which is not, and must never be, a member of that role). The rejected shape was
  --     the opposite: a policy reachable BY the app credential, where `true` would have been the
  --     authorisation.
  --
  --     ⚠ WRITE POLICIES ARE REQUIRED, NOT OPTIONAL. Verified on a replay DB: with RLS enabled and
  --     no applicable policy, a non-owner role holding INSERT still fails with `new row violates
  --     row-level security policy`. RLS gates writes as well as reads, so without these the
  --     provisioner could not provision at all — and the "fix" of handing provisioning the OWNER
  --     credential is exactly the concentration of power this separation exists to avoid.
  --
  --     Note what is NOT created: no DELETE policy on either table, and no UPDATE policy on
  --     audit_officer_provisioning. Each omission sits behind the matching absent grant, so a tamper
  --     attempt is refused twice over.
  EXECUTE 'DROP POLICY IF EXISTS provisioning_audit_read ON audit_officer_provisioning';
  EXECUTE 'DROP POLICY IF EXISTS provisioning_audit_append ON audit_officer_provisioning';
  EXECUTE 'DROP POLICY IF EXISTS officer_directory_provisioner_read ON ref_oversight_officer';
  EXECUTE 'DROP POLICY IF EXISTS officer_directory_provisioner_insert ON ref_oversight_officer';
  EXECUTE 'DROP POLICY IF EXISTS officer_directory_provisioner_update ON ref_oversight_officer';

  EXECUTE format(
    'CREATE POLICY provisioning_audit_read ON audit_officer_provisioning FOR SELECT TO %I USING ( true )',
    provisioner_role);
  EXECUTE format(
    'CREATE POLICY provisioning_audit_append ON audit_officer_provisioning FOR INSERT TO %I WITH CHECK ( true )',
    provisioner_role);
  EXECUTE format(
    'CREATE POLICY officer_directory_provisioner_read ON ref_oversight_officer FOR SELECT TO %I USING ( true )',
    provisioner_role);
  EXECUTE format(
    'CREATE POLICY officer_directory_provisioner_insert ON ref_oversight_officer FOR INSERT TO %I WITH CHECK ( true )',
    provisioner_role);
  EXECUTE format(
    'CREATE POLICY officer_directory_provisioner_update ON ref_oversight_officer FOR UPDATE TO %I USING ( true ) WITH CHECK ( true )',
    provisioner_role);
END
$$;

-- ---- Verification (run after the paste) ------------------------------------
--
-- A · Posture. Expect rls_enabled=t, rls_forced=f for both, and EVERY policy listed with a non-empty
--     `roles` = {oversight_provisioner}. A policy here with roles = {0} (i.e. PUBLIC / no TO clause)
--     is a finding: it is reachable by the app credential.
-- SELECT c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
--        p.polname, p.polcmd,
--        (SELECT array_agg(pg_get_userbyid(r)) FROM unnest(p.polroles) AS r) AS roles
--   FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
--  WHERE c.relname IN ('ref_oversight_officer','audit_officer_provisioning')
--  ORDER BY c.relname, p.polname;
--
-- B · The definer function is definer, pinned PG_TEMP LAST, and owned by the intended privileged
--     role. Expect security_definer=t, config={search_path=public, pg_temp}. CHECK THE OWNER — it is
--     whose privileges the bootstrap read runs with.
-- SELECT p.proname, p.prosecdef AS security_definer, p.proconfig,
--        pg_get_userbyid(p.proowner) AS owner, pg_get_function_result(p.oid) AS result_type
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname='public' AND p.proname IN ('ov_resolve_officer','ov_officer_node_tier',
--        'ov_officer_directory_guard','ov_officer_provisioning_tier_guard',
--        'ov_officer_provisioning_append_only')
--  ORDER BY p.proname;
--     result_type for ov_resolve_officer must contain officer_id, jurisdiction_id, level,
--     officer_role and MUST NOT mention full_name or work_email — the app credential has no read
--     path to the directory's PII, by construction.
--
-- C · Grants. Expect ref_oversight_officer → SELECT only for the app role; audit_officer_provisioning
--     → nothing for the app role.
-- SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
--   FROM information_schema.role_table_grants
--  WHERE table_name IN ('ref_oversight_officer','audit_officer_provisioning')
--  GROUP BY grantee, table_name ORDER BY table_name, grantee;
--
-- D · ⚠ AS THE NON-OWNER APP ROLE (the owner masks RLS and would show a false pass). With NO
--     jurisdiction GUC set — this is the bootstrap condition:
-- SELECT count(*) FROM ref_oversight_officer;                  -- expect 0 (no policy)
-- SELECT * FROM ov_resolve_officer('<a provisioned officer uid>');  -- expect exactly 1 row, right tier
-- SELECT * FROM ov_resolve_officer('<an unprovisioned uid>');       -- expect 0 rows
-- SELECT * FROM ov_resolve_officer(NULL);                           -- expect 0 rows
-- UPDATE ref_oversight_officer SET officer_role='NATIONAL_OVERSIGHT';
--     -- expect: ERROR permission denied for table ref_oversight_officer
-- SELECT count(*) FROM audit_officer_provisioning;
--     -- expect: ERROR permission denied for table audit_officer_provisioning
--
-- E · As the PROVISIONER role: the log is readable, and still cannot be rewritten.
-- SELECT count(*) FROM audit_officer_provisioning;   -- expect the real count
-- UPDATE audit_officer_provisioning SET reason='x';  -- expect: ERROR permission denied (no grant)
--
-- F · The guards, as the OWNER (owners bypass RLS but NOT triggers or CHECKs):
-- INSERT INTO ref_oversight_officer (officer_id, jurisdiction_id, officer_role, as_of_date)
-- VALUES (gen_random_uuid(), '<any SCHOOL node uuid>', 'DISTRICT_OVERSIGHT', current_date);
--     -- expect: ERROR no SCHOOL-tier oversight officer … (Kofi R1)
