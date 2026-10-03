-- =============================================================================
-- Omnischools OVERSIGHT — PROD hand-paste 0006: THE ANALYTICS APP ROLE,
--                          AND THE SUPABASE BUILT-IN ROLE SWEEP
--
-- Installs, idempotently, the two things that were done BY HAND while applying prod-paste-0005:
--   · `oversight_app`                 — the NON-OWNER login role behind ANALYTICS_DATABASE_URL, with
--                                       the exact grant/revoke posture the test harness proves
--                                       (tests/setup/global-setup.ts, which runs the WHOLE suite as
--                                       a non-owner `ov_app` against the real db/sql/policies.sql);
--   · THE SWEEP                       — Supabase auto-grants `ALL` on every `public` table to the
--                                       built-in `anon`, `authenticated` and `service_role`. `ALL`
--                                       includes DELETE and TRUNCATE. This file revokes it, on every
--                                       table, every sequence and every routine in `public`, and
--                                       neutralises the DEFAULT PRIVILEGES that would re-grant it to
--                                       the NEXT table a migration creates.
--
-- ⚠ WHY THIS FILE EXISTS. The oversight app was connecting to analytics as `postgres` — the table
-- OWNER, which is RLS-EXEMPT. Every policy in db/sql/policies.sql and every posture installed by
-- pastes 0001–0005 was therefore INERT in production: the jurisdiction boundary existed in the
-- catalogue, was tested in CI, and filtered nothing on prod. It was not a leak between tenants (one
-- credential, one app, scoped in SQL by `withJurisdiction()`), but it was the whole database-side
-- half of the privacy model switched off. A non-owner `oversight_app` role now exists,
-- ANALYTICS_DATABASE_URL points at it, and `oversight_provisioner` sits behind
-- PROVISIONER_DATABASE_URL. THIS FILE IS WHAT MAKES THAT POSTURE A WRITTEN, RE-RUNNABLE ARTEFACT
-- instead of a sequence of statements someone typed into the SQL editor once.
--
-- ⚠ AND WHY THE SWEEP IS HERE. prod-paste-0005's G5 check — "no non-owner role holds
-- DELETE/TRUNCATE on ref_oversight_officer" — FAILED on first application, and what it caught was
-- not a mistake of ours: it was Supabase's own `grant all on all tables in schema public to anon,
-- authenticated, service_role`, applied to the officer directory and the provisioning log like any
-- other table. Those grants were revoked by hand on the two officer tables to get 0005 to pass. That
-- fixed two tables out of twenty-seven, left every `fact_*`/`dim_*`/`ref_*` table and
-- `audit_access_log` exposed, and would have been undone by the next migration. G5 is a good check;
-- this is the file that makes it pass for a reason rather than by hand.
--
-- ⚠ APPLY AFTER: all migrations (0000–0004), db/sql/policies.sql, and prod-paste-0001 … 0005, in
-- that order. This file is LAST because it is the only one that assumes a finished schema: it issues
-- `... ON ALL TABLES IN SCHEMA public`, which is a point-in-time operation over the tables that exist
-- AT THE MOMENT IT RUNS. A table created afterwards is NOT covered by §3 or §4a (which is exactly
-- what §4c is for — see it). Paste it into the Supabase SQL editor on `omnischools-analytics-prod`,
-- AS THE OWNER (`postgres`). It needs CREATEROLE only if `oversight_app` does not exist yet.
--
-- ⚠ CHICKEN-AND-EGG, ON A FRESH PROJECT ONLY — READ THIS IF 0005 WILL NOT APPLY. Supabase's
-- auto-grants exist from the moment a table is created, i.e. BEFORE any paste in this directory
-- runs. So on a project where 0005 has not yet been applied, 0005's G5 check fails on them:
--     G5 FAILED: DELETE/TRUNCATE on ref_oversight_officer is granted to non-owner role(s)
--                [anon, authenticated, service_role]
-- and because the SQL editor runs the whole file in one transaction, 0005 rolls back entirely —
-- which is why it was unblocked by hand the first time. THE SWEEP IN §4a IS THE PROPER FIX FOR THAT
-- EXACT FAILURE. Verified on a replay database that simulates the Supabase grant set:
--     run THIS file first  →  §1 WARNs if 0005's objects are absent, and carries on (a WARNING and
--                              not an EXCEPTION precisely so this ordering is possible). On a
--                              database set up with `pnpm db:setup` the current db/sql/policies.sql
--                              has already created them, so §1 is silent.
--     then run 0005        →  G5 ok, G6 ok, no hand-revoke needed
--     then run THIS file again  →  the app role picks up EXECUTE on 0005's functions
-- On `omnischools-analytics-prod` as it stands TODAY none of this applies: 0005 is already in place,
-- so the plain order (0005 is done; paste this) is the one to use.
--
-- ⚠ RE-RUN THIS FILE AFTER EVERY ONE OF THESE:
--   · a migration that CREATES A TABLE, A SEQUENCE OR A ROUTINE   (§3's blanket grant and §4a's
--     blanket revoke are both point-in-time; the new object is covered by neither);
--   · any re-application of db/sql/policies.sql to prod            (it revokes EXECUTE from PUBLIC
--     and its tail re-revokes writes — harmless, but a DROPPED-and-recreated function loses the app
--     role's EXECUTE grant with it);
--   · any `grant ... to anon|authenticated|service_role` issued for any reason.
-- It is entirely idempotent (guarded CREATE ROLE, GRANT/REVOKE, read-only assertions) and re-running
-- it costs nothing but the time to read the NOTICEs.
--
-- ⚠ HOW THIS ONE FAILS IF YOU SKIP IT. Not with an empty panel and not with an outage — with
-- NOTHING. The app keeps working. If ANALYTICS_DATABASE_URL has already been repointed at
-- `oversight_app`, skipping this file means that role holds no privileges at all and every page
-- raises `permission denied for table …` — loud, and the good case. If it has NOT been repointed, the
-- app is still the RLS-exempt owner and `anon`/`service_role` still hold DELETE and TRUNCATE on the
-- officer directory, the audit log and the warehouse, reachable by anything that holds the project's
-- service key. There is no symptom to notice. That asymmetry is the whole reason this is a file in
-- the repository and not a note in a ticket.
--
-- ⚠ IF A VERIFICATION BLOCK RAISES, THE SUPABASE SQL EDITOR ROLLS BACK THE WHOLE FILE. Nothing is
-- left half-applied. The V0 and §5 blocks are LIVE assertions, not commented probes, for the reason
-- prod-paste-0005 gives for its G5/G6: every control in this file is an ABSENCE — a privilege never
-- held — and an absence is the one kind of control that a later well-meaning `grant all` removes with
-- nothing to show for it. Fix the condition the error names, then re-run.
--
-- ⚠ V0 RUNS BEFORE §3 AND GATES IT. §3's blanket `grant select on all tables` is only safe because
-- every table in `public` has RLS enabled; V0 asserts that invariant rather than assuming it, and it
-- is placed ahead of §3 so that a database where the invariant is broken never receives the grant.
-- See the V0 banner for what the broken case actually looks like (an unscoped read with no empty-panel
-- signature).
--
-- ⚠ AND THE LAST STATEMENT IN THIS FILE IS A `SELECT`, NOT A `DO` BLOCK. **READ ITS RESULT SET: ZERO
-- ROWS = CLEAN.** The Supabase SQL editor renders result sets and errors; it does NOT reliably render
-- `RAISE NOTICE` / `RAISE WARNING`. So every soft finding in this file — §1's "0005 is not applied",
-- §4b's un-revoked routines, §4c's and V5's advisory about a default privilege this connection cannot
-- alter — is ALSO returned as a row by §6, with the exact remediation statement in the last column.
-- The RAISE lines are kept as well (they are what `psql` and the test harness see), but §6 is the
-- authoritative report, because a control whose only output is an invisible WARNING is not a control.
--
-- ⚠ THERE IS NOTHING IN THIS FILE TO EDIT BEFORE PASTING IT. In particular the app role name is
-- FIXED at `oversight_app` — it is written thirteen times in executable code, seven of them as SQL
-- literals in §6 that no plpgsql variable can reach, and a partial rename makes §6 report CLEAN when
-- it is not. See the §3 banner. (prod-paste-0005 does have an edit point; this one does not.)
--
-- SCOPE, STATED NARROWLY SO IT IS NOT WIDENED BY ACCIDENT. This file touches schema `public` ONLY.
-- It does NOT touch `auth`, `storage`, `realtime`, `graphql`, `vault`, `extensions` or any other
-- Supabase-managed schema; it does not revoke anything from the owner, from `oversight_app` or from
-- `oversight_provisioner`; it creates no table, column, policy, trigger or function. The only
-- objects it writes are role memberships' worth of ACL entries.
-- =============================================================================

-- =============================================================================
-- §1 · FAIL-CLOSED PRECONDITIONS
--      Migrations, policies.sql and prod-paste-0005 must already be in place. §3 narrows a blanket
--      grant down onto the officer tables by name; if those tables are absent the blanket grant
--      would be installed and the narrowing silently skipped, which is the one way this file could
--      make things WORSE than not running it. So: refuse.
-- =============================================================================
DO $$
BEGIN
  IF to_regclass('public.dim_jurisdiction') IS NULL THEN
    RAISE EXCEPTION '0006: dim_jurisdiction missing — this database has not been migrated at all. Run the migrations (0000–0004), then db/sql/policies.sql, then prod-paste-0001…0005, then this file.';
  END IF;
  IF to_regclass('public.audit_access_log') IS NULL THEN
    RAISE EXCEPTION '0006: audit_access_log missing — run the migrations BEFORE this paste (§3 grants INSERT on it by name)';
  END IF;
  IF to_regclass('public.ref_oversight_officer') IS NULL
     OR to_regclass('public.audit_officer_provisioning') IS NULL THEN
    RAISE EXCEPTION '0006: the officer-auth pair is missing — run migration 0004_white_eternity BEFORE this paste. §3 issues a blanket `grant select on all tables` and then NARROWS it onto these two tables by name; with them absent the blanket grant would land and the narrowing would be skipped.';
  END IF;
  -- policies.sql applied? (the shared predicate behind every jurisdiction policy)
  IF to_regprocedure('public.ov_in_subtree(uuid)') IS NULL THEN
    RAISE EXCEPTION '0006: ov_in_subtree(uuid) is missing — apply db/sql/policies.sql and prod-paste-0002 to this database first. Granting an app role SELECT on every table in a database with no jurisdiction predicate installed is the opposite of what this file is for.';
  END IF;
  -- prod-paste-0005 applied? ov_resolve_officer is the app role's ONLY read path into the directory,
  -- and §3 grants EXECUTE on it via `grant execute on all routines`. If it does not exist yet, that
  -- blanket grant cannot cover it and SIGN-IN STAYS BROKEN after this file reports success — loudly
  -- (`permission denied for function ov_resolve_officer`), which is the right direction of failure
  -- but is still an outage somebody has to connect back to this paste. A WARNING for the same reason
  -- as the trigger check below: on a project where 0005 has not landed, this file is what unblocks
  -- it, so it must be runnable first.
  IF to_regprocedure('public.ov_resolve_officer(uuid)') IS NULL THEN
    RAISE WARNING '0006: ov_resolve_officer(uuid) does not exist, so prod-paste-0005-officer-directory.sql has not been applied here. §3''s `grant execute on all routines` cannot cover a function that does not exist: apply 0005 and then RE-RUN THIS FILE, or sign-in will fail with `permission denied for function ov_resolve_officer`. (This WARNING is also returned as a row by the RESIDUAL REPORT at the foot of this file, because the Supabase SQL editor does not render RAISE output.)';
  END IF;
  -- …and the CURRENT 0005, the one that carries the S1 coupling trigger. This file's §4a revokes
  -- DELETE/TRUNCATE on the directory from the Supabase built-ins, which is the residual 0005's G5
  -- describes; it would be odd to close that while the coupling guard itself is missing.
  --
  -- A WARNING AND NOT AN EXCEPTION, DELIBERATELY — see the ⚠ CHICKEN-AND-EGG note in the header.
  -- On a project where 0005 has not been applied yet, THE SWEEP IS WHAT UNBLOCKS IT, so refusing to
  -- run until 0005 is in place would be refusing to fix the thing that is stopping 0005. Nothing in
  -- this file depends on the trigger; the only cost of being early is that §3's blanket
  -- `grant execute on all routines` cannot cover routines that do not exist yet, which is why the
  -- message says to come back.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.ref_oversight_officer'::regclass
       AND tgname  = 'officer_directory_audit_guard'
       AND NOT tgisinternal
  ) THEN
    RAISE WARNING '0006: officer_directory_audit_guard is missing from ref_oversight_officer, so the CURRENT prod-paste-0005-officer-directory.sql (the one carrying the S1 directory↔audit coupling) has not been applied to this database. That is expected only if you are running this file FIRST to unblock 0005''s G5 check (see the header). Apply 0005, then RE-RUN THIS FILE so the app role picks up EXECUTE on everything 0005 creates. (Also returned as a row by the RESIDUAL REPORT at the foot of this file.)';
  END IF;
END
$$;

-- =============================================================================
-- §2 · THE APP ROLE EXISTS, AND IS THE RIGHT **KIND** OF ROLE
--
-- ⚠ NO PASSWORD IS SET HERE, AND NONE MAY EVER BE ADDED TO THIS FILE. This file lives in the git
-- repository and is pasted into the Supabase SQL editor, whose query history is readable by every
-- project member; a password written here is a credential published twice over. The role is created
-- with LOGIN and no password, which means IT CANNOT CONNECT until the password is set OUT OF BAND:
--
--     -- in the Supabase SQL editor, ONE TIME, not from a file:
--     alter role oversight_app with password '…';
--     -- then put that credential in ANALYTICS_DATABASE_URL (transaction pooler, port 6543)
--
-- That ordering is deliberate and fail-closed: a role that cannot log in grants nothing to anybody.
--
-- ⚠ IT MUST BE A NON-OWNER, NON-SUPERUSER, NON-BYPASSRLS ROLE. All three, not just the first. A
-- table's OWNER is exempt from that table's RLS unless the table is FORCEd (and we use ENABLE, never
-- FORCE, because the ETL loader connects as the owner and must keep writing); a SUPERUSER is exempt
-- from everything; and `rolbypassrls` is exemption as an explicit role attribute — the quietest of
-- the three, since such a role looks entirely ordinary in `\du` output to anyone not reading the
-- Attributes column. Any one of them reproduces the defect this file exists to fix, and reproduces it
-- invisibly: every policy still present, still correct, still filtering nothing. §5's V1 asserts all
-- three on every re-run, the way prod-paste-0005's G6 does for the provisioner.
-- =============================================================================
DO $$
DECLARE
  app_role text := 'oversight_app';  -- ⇦ the ANALYTICS_DATABASE_URL role. FIXED, not configurable:
                                     --    see the §3 banner for why renaming it produces a FALSE
                                     --    CLEAN from §6.
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    BEGIN
      EXECUTE format('CREATE ROLE %I LOGIN', app_role);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'role % does not exist and this connection cannot create it (CREATEROLE required). Create it as a role that can — `create role % login;` — then set its password out of band and re-run this file.', app_role, app_role;
    END;
    RAISE NOTICE '0006: created role % with LOGIN and NO PASSWORD. It CANNOT CONNECT until you run `alter role % with password ''…'';` by hand and put that credential in ANALYTICS_DATABASE_URL.', app_role, app_role;
  ELSE
    RAISE NOTICE '0006: role % already exists — left exactly as it is (no password, no attribute and no membership is changed by this file; V1 asserts them instead)', app_role;
  END IF;

  -- CONNECT is granted to PUBLIC by default, so this is normally a no-op. It is here for the project
  -- that has (correctly) revoked CONNECT from PUBLIC, where its absence presents as an opaque
  -- authentication failure rather than as a permission error.
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), app_role);

  -- Fail FAST on the two attributes that make everything below theatre, so the operator sees the
  -- cause and not a wall of NOTICEs followed by a V1 failure. V1 re-asserts these and more (SET ROLE
  -- reachability, table ownership, ownership by inheritance) as the standing check.
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION '% is a SUPERUSER. It is exempt from every policy in db/sql/policies.sql, so the entire jurisdiction boundary would be inert for the app — the exact defect this file was written to fix, reproduced with no visible symptom. Fix: ALTER ROLE % NOSUPERUSER, or point app_role at a plain login role.', app_role, app_role;
  END IF;
  IF (SELECT rolbypassrls FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION '% holds BYPASSRLS. Same consequence as superuser for every table in this database: the policies are evaluated for nobody. Fix: ALTER ROLE % NOBYPASSRLS.', app_role, app_role;
  END IF;
END
$$;

-- =============================================================================
-- V0 · THE RLS INVARIANT THAT §3's BLANKET GRANT RESTS ON — **A GATE, NOT A REPORT**
--
-- ⚠ WHY THIS IS NUMBERED WITH THE §5 VERIFICATIONS BUT RUNS UP HERE. It is the same shape as V1…V6
-- — a read-only assertion that raises — but it must run BEFORE §3, not after it, and the ordering is
-- the whole point. §3 issues `GRANT SELECT ON ALL TABLES IN SCHEMA public TO oversight_app` and the
-- header makes re-running §3 MANDATORY after every migration that adds a table. That blanket grant is
-- safe for exactly one reason: every relation in `public` has RLS ENABLED, so the jurisdiction
-- policies — not the grant — decide which rows the app role sees. Nothing in this file asserted that
-- reason. This block is it.
--
-- WHAT GOES WRONG WITHOUT IT, precisely. A migration lands and its matching prod-paste (PROVISIONING
-- §2a) is skipped, or a paste is applied half-way; one table ends up with `relrowsecurity = false`.
-- Re-run §3 as instructed and the app credential gets SELECT on it. A DISTRICT officer then reads
-- that table UNSCOPED — national data, every district, no predicate — and there is NO EMPTY PANEL to
-- notice, because the documented fail-closed signature of a missed paste IS RLS being on with no
-- policy. This is not a new argument: it is the one the foot of §4c already makes to justify NOT
-- adding a default privilege for the app role — "a table that slipped through with RLS off and an
-- automatic SELECT grant is a leak with no signature at all". §3's blanket grant, re-run on a
-- schedule, is that same automatic grant by another name. So the same argument has to gate it.
--
-- TWO CONDITIONS, BOTH FATAL, FOR DIFFERENT REASONS:
--   · RLS OFF (`relrowsecurity = false`)        — a LEAK. The grant is unscoped read access. Fix:
--                                                 `alter table <t> enable row level security;` AND
--                                                 apply the prod-paste that carries its policies.
--                                                 Enabling RLS alone leaves it deny-all (see below),
--                                                 which is correct but is an outage, not a fix.
--   · RLS ON, ZERO POLICIES                     — NOT a leak (deny-all for every non-owner, which is
--                                                 fail-closed and is the intended empty-panel
--                                                 signature) but a MISSING PASTE, and therefore a
--                                                 leak waiting for someone to "fix the empty panel"
--                                                 by disabling RLS instead of applying the paste.
--                                                 Raising here names the real cause while the
--                                                 operator is already in the SQL editor.
-- `ref_oversight_officer` is NOT this second case and must not be mistaken for it: §3's commentary
-- calls it "RLS-enabled with NO app-reachable policy", which is true — the policies it does carry are
-- targeted at `oversight_provisioner`. It has three, so it passes.
--
-- SCOPE: `relkind in ('r','p')` — ordinary and partitioned tables, the only relkinds that HAVE an
-- RLS flag. Views and materialised views (`v`, `m`) have none and are governed by the privileges of
-- their owner; sequences have none. Schema `public` only, as everywhere in this file, so Supabase's
-- own `auth`/`storage` tables are not this file's business. Drizzle's own bookkeeping table lives in
-- schema `drizzle`, not `public`, so it is correctly out of scope.
--
-- ⚠ IF THIS BLOCK RAISES, DO NOT "FIX" IT BY DELETING IT. It is reporting that this database is in a
-- state where re-running §3 would widen access. The repair is upstream: apply the missing paste.
-- =============================================================================
DO $$
DECLARE
  norls   text;
  nopol   text;
  covered int;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO norls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND NOT c.relrowsecurity;
  IF norls IS NOT NULL THEN
    RAISE EXCEPTION 'V0 FAILED (GATE ON §3): table(s) in schema public have ROW LEVEL SECURITY DISABLED: [%]. §3 below would hand oversight_app SELECT on them, and with RLS off that SELECT is UNSCOPED — a DISTRICT officer would read national data out of those tables with no empty panel and no other symptom to notice, because the empty panel IS the RLS. This file has therefore refused to run §3 at all; nothing is half-applied. Fix: apply the prod-paste that carries those tables'' policies (docs/PROVISIONING.md §2a — a migration and its RLS paste are SEPARATE steps, and step 2 is what this is about), then re-run this file. If you believe a table genuinely needs no jurisdiction predicate, it still needs `enable row level security` plus an explicit policy saying so, so that the exemption is written down where the next person reads it.', norls;
  END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO nopol
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND c.relrowsecurity
     AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);
  IF nopol IS NOT NULL THEN
    RAISE EXCEPTION 'V0 FAILED (GATE ON §3): table(s) in schema public have RLS ENABLED but ZERO POLICIES: [%]. That state is FAIL-CLOSED, not a leak — every non-owner read returns zero rows — so this is not an emergency. It is reported as an error anyway because it is the exact signature of a migration whose prod-paste was never applied, and because the next person to meet it meets it as "the panel is empty", whose tempting fix is `alter table … disable row level security` — which turns a safe outage into the silent unscoped-read described in the block above. Fix: apply the missing prod-paste so the table has its jurisdiction policy, then re-run this file. (Deliberately deny-all? Give it an explicit `create policy … using (false)` so the intent is in the catalogue.)', nopol;
  END IF;

  SELECT count(*) INTO covered
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
  RAISE NOTICE 'V0 ok — all % table(s) in schema public have RLS enabled and at least one policy, so §3''s blanket `grant select on all tables` is scoped by the policies and not by the grant', covered;
END
$$;

-- =============================================================================
-- §3 · THE APP-ROLE POSTURE — THE HARNESS RECIPE, VERBATIM
--
-- ⚠ THE APP ROLE NAME IS **FIXED** AT `oversight_app` THROUGHOUT THIS FILE. DO NOT EDIT IT. An
-- earlier version of this banner invited you to edit it "if yours differs", and that invitation was
-- a trap rather than a convenience. The name appears THIRTEEN times in executable code: six plpgsql
-- DECLAREs (§2, §3, V1, V2, V3, V6) and seven SQL literals inside §6's residual report — and a
-- plpgsql variable CANNOT reach the §6 ones, because §6 is a single `SELECT` whose result-set column
-- literals are not parameterisable from a DO block. (The test that pins this file asserts both
-- counts, so a new §6 row source naming the role makes this banner go red rather than stale.) So
-- renaming the role is not one edit, it is thirteen, and getting it partly right FAILS SILENTLY IN
-- THE WORST DIRECTION: §6's `app_missing_select` row source is gated on `EXISTS (SELECT 1 FROM
-- pg_roles WHERE rolname = 'oversight_app')`, so with the role renamed and §6 un-edited that source
-- yields ZERO ROWS and §6 REPORTS CLEAN. That is a FALSE CLEAN against the one contract this file
-- asks you to read — "zero rows = clean" — while every other §6 row goes on labelling findings with
-- a role nobody is using.
-- A fixed name has no such failure mode, and `omnischools-analytics-prod` uses the default, so there
-- is nothing to edit.
--
-- IF A SITE'S ANALYTICS APP ROLE IS CALLED SOMETHING ELSE, rename the ROLE, not the file:
--     alter role <theirs> rename to oversight_app;   -- then re-set its password out of band
--                                                    -- (RENAME clears an md5-stored one) and update
--                                                    -- ANALYTICS_DATABASE_URL
-- Or fork this file and change all thirteen occurrences together, plus the prose in V0's and V4's
-- error messages and in §4c's closing comment. Do not change a subset.
--
-- THIS IS NOT A DESIGN DECISION TAKEN IN THIS FILE. It is a transcription. The whole oversight test
-- suite — every RLS, gate, audit and officer-auth test — runs as a NON-OWNER
-- role (`ov_app`) against the real db/sql/policies.sql, provisioned with exactly these statements in
-- tests/setup/global-setup.ts (~lines 112–145). If prod matches this list, prod matches the thing CI
-- proves. If it does not, CI is proving a posture nobody is running.
--
-- ⚠ ORDER MATTERS AND IS THE POINT. The blanket `grant select on all tables` is the shape everyone
-- reaches for, and it hands the app credential SELECT on `audit_officer_provisioning` — the GES
-- officer roster plus who granted whom national access, the single table the officer-auth design
-- exists to withhold. The narrowing REVOKEs MUST run after it. Reverse these two groups and the file
-- reports success while leaving the roster readable. (db/sql/policies.sql's own tail block carries
-- the same two REVOKEs for the same reason, and its header calls out the same trap.)
--
-- WHAT THE APP ROLE GETS, AND WHY EACH LINE:
--   · USAGE on schema public                 — without it nothing else is reachable.
--   · SELECT on all tables                   — read-only by construction; the jurisdiction policies
--                                              then decide WHICH ROWS. (`ref_oversight_officer` is
--                                              RLS-enabled with NO app-reachable policy, so its
--                                              SELECT yields zero rows; the grant is kept so that
--                                              widening it later does not silently widen writes.)
--   · INSERT on audit_access_log             — the ONLY write the app may perform anywhere. And only
--                                              INSERT: never UPDATE/DELETE. Per policies.sql and
--                                              PROVISIONING §1, an over-granted role hits RLS first
--                                              and gets a silent `UPDATE 0` — the row survives but
--                                              the tamper attempt REPORTS SUCCESS. With the grant
--                                              withheld the same statement fails loudly. The absent
--                                              grant, not the append-only trigger, is the guard.
--   · EXECUTE on all ROUTINES                — ov_resolve_officer() is the app's only read path into
--                                              the directory, and policies.sql/0005 revoke EXECUTE on
--                                              it from PUBLIC. Without this, sign-in fails with
--                                              `permission denied for function ov_resolve_officer`.
--                                              ⚠ THE ONE PLACE THIS BLOCK IS NOT A LITERAL
--                                              TRANSCRIPTION OF THE HARNESS. The harness line is
--                                              `grant execute on all functions`; this says ALL
--                                              ROUTINES, which is the same choice (and the same
--                                              reasoning) as §4a/§4b: ROUTINES is the superset that
--                                              also covers PROCEDURES, FUNCTIONS does not. The two
--                                              are IDENTICAL on this schema today — `select distinct
--                                              prokind from pg_proc join pg_namespace … where nspname
--                                              = 'public'` is `{f}`, there is not one procedure — so
--                                              the parity the harness proves is unaffected. The
--                                              asymmetry mattered the other way round: §4b's revoke
--                                              loop walks `pg_proc` and therefore ALREADY covers a
--                                              procedure, so a migration that adds one the app calls
--                                              would have had EXECUTE revoked from PUBLIC by §4b and
--                                              NOT re-granted by §3 — a prod outage
--                                              (`permission denied for procedure …`) caused by this
--                                              file disagreeing with itself. Fail-closed, but
--                                              needless. If a procedure is ever added, add the
--                                              matching `all routines` widening to
--                                              tests/setup/global-setup.ts so the parity test keeps
--                                              comparing like with like.
-- …then NARROWED:
--   · no INSERT/UPDATE/DELETE on ref_oversight_officer  — self-promotion is prevented by a privilege
--                                              that was never issued, not by a policy. A policy can
--                                              be mis-edited into permitting an UPDATE; an absent
--                                              privilege cannot. `update ref_oversight_officer set
--                                              officer_role='NATIONAL_OVERSIGHT' where officer_id=<me>`
--                                              must fail BEFORE RLS and BEFORE the trigger.
--   · nothing at all on audit_officer_provisioning      — see the ordering note above.
--
-- NOT GRANTED, DELIBERATELY: **UPDATE on fact_anomaly**. PROVISIONING §1 lists it for anomaly
-- triage, and the test harness does not grant it because nothing writes it yet — triage is increment
-- J. Leaving it out keeps the app credential strictly read-only-plus-one-audit-INSERT, which is a
-- property worth holding for as long as it is true. When J lands: add `grant update on fact_anomaly`
-- HERE (not as a one-off in the SQL editor), add it to tests/setup/global-setup.ts in the same
-- change so CI runs the same posture, and re-paste this file. Do not grant it in advance.
--
-- NOT GRANTED EITHER: anything on `etl_run` beyond SELECT (the loader is the owner), and no USAGE on
-- any sequence — the app role inserts into `audit_access_log`, whose PK is a uuid default, so it
-- needs no sequence. If a future insert path needs one, grant that ONE sequence by name here.
-- =============================================================================
DO $$
DECLARE
  app_role text := 'oversight_app';  -- ⇦ FIXED (see the §3 banner above), not an edit point
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION '§3: role % does not exist — §2 above should have created it, so either §2 was skipped or this connection lacks CREATEROLE. Create it by hand (`create role % login;`) and re-run. The name is FIXED at oversight_app throughout this file and must not be edited: see the §3 banner.', app_role, app_role;
  END IF;

  -- ---- the blanket grants (harness lines ~115–120) --------------------------
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);
  EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', app_role);
  EXECUTE format('GRANT INSERT ON audit_access_log TO %I', app_role);
  EXECUTE format('GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO %I', app_role);

  -- ---- then the narrowing (harness lines ~142–145) — AFTER, never before ----
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON ref_oversight_officer FROM %I', app_role);
  EXECUTE format('REVOKE ALL ON audit_officer_provisioning FROM %I', app_role);

  -- TRUNCATE is not in the harness line because `grant select` never confers it. It is revoked here
  -- anyway, for the reason 0005's G5 gives: TRUNCATE fires NO row triggers, so it would empty the
  -- directory with the coupling guard, the tier guard and the Kofi R1 guard all unconsulted. This is
  -- a no-op against the posture above and a repair if something ever widens it.
  EXECUTE format('REVOKE TRUNCATE ON ref_oversight_officer FROM %I', app_role);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON audit_access_log FROM %I', app_role);

  RAISE NOTICE '0006 §3: % — usage+select on public, insert on audit_access_log, execute on all routines; narrowed off ref_oversight_officer (select only) and audit_officer_provisioning (nothing)', app_role;
END
$$;

-- =============================================================================
-- §4 · THE SWEEP — THE SUPABASE BUILT-IN ROLES GET NOTHING IN `public`
--
-- `anon`, `authenticated` and `service_role` are PostgREST's roles. The Oversight app reaches the
-- analytics database ONLY over direct Postgres, as `oversight_app` (reads) and
-- `oversight_provisioner` (provisioning writes). It does not use supabase-js, PostgREST or the
-- project's REST/GraphQL endpoint against `public` AT ALL. (It does use the analytics project's
-- Supabase Auth — NEXT_PUBLIC_SUPABASE_ANON_KEY in the browser — but GoTrue lives in the `auth`
-- schema and runs as `supabase_auth_admin`. Sign-in does not read one row of `public`, so nothing
-- below can break it. This is the one coupling worth being sure of before pasting, and it is the
-- reason §4 is scoped to `public` and touches no Supabase-managed schema.)
--
-- So the correct privilege set for those three roles on `public` is EMPTY — and that is not merely
-- tidiness. PostgREST access to the analytics warehouse would bypass `withJurisdiction()`
-- (lib/db/rls.ts), which is the only code that sets `app.current_jurisdiction` /
-- `app.current_level` / `app.current_officer`. With no GUCs set, `ov_is_national()` is false and
-- `ov_in_subtree()` sees a NULL node, so the jurisdiction policies deny — the boundary holds. What
-- does NOT hold is everything the policies are not: `audit_access_log`'s append-only guard is a
-- trigger behind an absent grant, the §6 named-record gate is application code that writes its audit
-- row BEFORE it fetches, and `anon` holding DELETE/TRUNCATE is outside all of it. A REST path into
-- this database is a path around the gate, so the roles that serve REST hold nothing.
--
-- NOT DONE HERE: `revoke usage on schema public from anon, authenticated, service_role`. It would
-- read as the strongest single lever and it is in fact a NO-OP: USAGE on `public` is granted to
-- PUBLIC by default in every supported Postgres, so revoking it from three named roles removes a
-- grant they do not individually hold. Making it bite means `revoke usage on schema public from
-- PUBLIC`, which reaches every role in the cluster including Supabase's own `dashboard_user`,
-- `authenticator` and whatever the platform adds next — a blast radius this file cannot assess from
-- inside the database. It also buys nothing: USAGE on a schema conveys only the right to NAME
-- objects in it, and §4a/§4b leave nothing in it they may touch.
-- =============================================================================

-- ---- §4a · revoke the blanket object privileges --------------------------------------------------
-- Each role is guarded by `if exists` so this file is a clean NO-OP on a non-Supabase cluster — the
-- local test cluster (scripts/test-pg.sh) has no `anon`/`authenticated`/`service_role` at all, and
-- `revoke … from <nonexistent role>` is a hard error, not a warning. The guard is what keeps
-- `pnpm db:rls-test` able to replay this file.
--
-- `ALL ROUTINES` (PG 11+) rather than `ALL FUNCTIONS`: it is the superset that also covers
-- PROCEDURES. `ALL TABLES` covers tables, views, materialised views, partitioned and foreign tables.
--
-- A REVOKE for which this connection is not the grantor emits a WARNING ("no privileges could be
-- revoked") and does not abort — so a table owned by someone else is reported rather than fatal, and
-- V4 below is what turns an un-revoked privilege into an error.
DO $$
DECLARE
  builtins text[] := array['anon', 'authenticated', 'service_role'];
  r        text;
  present  int := 0;
BEGIN
  FOREACH r IN ARRAY builtins LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL ROUTINES  IN SCHEMA public FROM %I', r);
      present := present + 1;
      RAISE NOTICE '0006 §4a: swept % — no privilege on any table, sequence or routine in schema public', r;
    ELSE
      RAISE NOTICE '0006 §4a: role % is not present on this cluster — nothing to sweep (expected off Supabase, e.g. the local test cluster)', r;
    END IF;
  END LOOP;
  IF present = 0 THEN
    RAISE NOTICE '0006 §4a: none of the Supabase built-in roles exist here — §4 is a no-op on this cluster, as designed';
  END IF;
END
$$;

-- ---- §4b · and EXECUTE on our routines is revoked from PUBLIC ------------------------------------
-- §4a alone does NOT make "those roles hold no privilege" true, and it is worth being precise about
-- why rather than claiming a property the catalogue contradicts. A function is created with
-- `EXECUTE` granted to **PUBLIC** by default. PUBLIC includes `anon`. So after §4a,
-- `has_function_privilege('anon', 'ov_in_subtree(uuid)', 'EXECUTE')` is still TRUE — reachable by an
-- unauthenticated PostgREST RPC, and `ov_in_subtree` is SECURITY DEFINER: a jurisdiction-tree
-- membership oracle over the GES spine. db/sql/policies.sql and prod-paste-0005 already revoke the
-- two sharpest ones (`ov_resolve_officer`, `ov_officer_node_tier`) from PUBLIC by name, which is the
-- precedent; this generalises it to every routine WE own in `public`.
--
-- SCOPED TO NON-EXTENSION ROUTINES. Routines belonging to an extension (pg_depend deptype 'e') are
-- skipped: `pgcrypto`, `uuid-ossp` and friends are installed in `extensions` on Supabase, but if one
-- was ever put in `public`, revoking EXECUTE from PUBLIC on its functions would be this file
-- reaching outside its own scope to break someone else's code. Ours, not theirs.
--
-- SAFE FOR THE ROLES THAT ACTUALLY CALL THEM, in all four cases:
--   · `oversight_app`           — holds EXECUTE by the DIRECT grant in §3. Revoking the PUBLIC entry
--                                 does not touch a direct entry, so §3 and §4b are order-independent.
--   · `oversight_provisioner`   — holds EXECUTE on ov_officer_node_tier by the direct grant in 0005.
--   · the owner / ETL loader    — an owner holds all privileges on its own objects unconditionally.
--   · the trigger guards        — EXECUTE on a trigger function is checked at CREATE TRIGGER time,
--                                 not when the trigger fires. Existing triggers keep working.
--   · the RLS policies          — a policy's function calls are checked against the QUERYING role,
--                                 which is `oversight_app`: covered by §3's direct grant.
-- Each revoke is individually wrapped so an exotic routine kind cannot abort the paste; failures are
-- collected into one WARNING instead.
DO $$
DECLARE
  rec      record;
  done     int  := 0;
  failures text := '';
BEGIN
  FOR rec IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND NOT EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
       AND EXISTS (
             SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
     ORDER BY 1
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC', rec.sig);
      done := done + 1;
    EXCEPTION WHEN others THEN
      failures := failures || rec.sig::text || ' (' || SQLERRM || '); ';
    END;
  END LOOP;

  IF failures <> '' THEN
    RAISE WARNING '0006 §4b: EXECUTE could not be revoked from PUBLIC on: %. These are ALSO returned as rows by §6, the residual report at the foot of this file, because the Supabase SQL editor does not render WARNINGs — resolve them by hand with the statement §6 prints.', failures;
  END IF;
  RAISE NOTICE '0006 §4b: revoked EXECUTE from PUBLIC on % non-extension routine(s) in schema public (the app role and the provisioner keep their direct grants)', done;
END
$$;

-- ---- §4c · DEFAULT PRIVILEGES — so the NEXT table is not silently re-granted ---------------------
--
-- ⚠ THIS IS THE HALF THAT MAKES §4a MORE THAN A ONE-DAY FIX, AND IT IS A DELIBERATE MUTATION OF
-- SUPABASE'S OWN PROJECT SETUP. The argument for doing it rather than merely reporting it:
--
--   1 · WITHOUT IT, §4a DECAYS SILENTLY AND ON A KNOWN SCHEDULE. Supabase ships
--       `alter default privileges in schema public grant all on tables|sequences|functions to
--       postgres, anon, authenticated, service_role`. Default privileges attach to the role that
--       CREATES an object, and on this project that role is `postgres` — the same credential that
--       runs `drizzle-kit migrate`. So the first `create table` of increment H re-grants `ALL`
--       (DELETE and TRUNCATE included) on a brand-new analytics table to all three roles, with no
--       statement anywhere naming them. §4a is point-in-time; this is the standing instruction that
--       produced the finding in the first place.
--   2 · THE BLAST RADIUS IS SMALL, BOUNDED AND FORWARD-ONLY. ALTER DEFAULT PRIVILEGES changes NO
--       existing object. It is scoped here to schema `public` (plus any cluster-wide default, which
--       applies to `public` too), to those three grantees, and to the grantors this connection is
--       actually a member of. Nothing else in the project is reachable from it.
--   3 · IT CANNOT BREAK A LIVE PATH, for the reason §4 opens with: no part of this product reads
--       `public` over PostgREST, and Supabase Auth does not touch `public`. Studio's table editor and
--       SQL editor connect as `postgres`/`supabase_admin`, not as these three.
--   4 · IT IS REVERSIBLE IN ONE STATEMENT, printed below.
--
-- The reverse case — "flag it, do not touch it" — was considered and rejected: an advisory only works
-- if someone reads it at the moment a migration is written, and the whole reason this file exists is
-- that the equivalent advisory for the app role was carried out by hand once and never again.
--
-- TO UNDO (if PostgREST is ever deliberately wanted on analytics — read §4's second paragraph first,
-- because it would put a path around the §6 gate):
--     alter default privileges in schema public
--       grant all on tables to anon, authenticated, service_role;   -- and sequences, functions
--
-- WHAT THIS BLOCK WILL NOT DO. `ALTER DEFAULT PRIVILEGES FOR ROLE x` requires membership of `x`. On
-- Supabase, `postgres` is NOT a member of `supabase_admin`, so a default privilege whose grantor is
-- `supabase_admin` CANNOT be altered from the SQL editor. Those are collected and reported with the
-- exact statement to run, rather than swallowed — see V5, which fails the paste for a grantor we
-- COULD have fixed (that would be a bug in this block) and WARNS for one we could not (that needs
-- Supabase support, or a `create table` done as a role whose defaults are clean).
DO $$
DECLARE
  builtins text[] := array['anon', 'authenticated', 'service_role'];
  rec      record;
  objkw    text;
  scopekw  text;
  fixed    int  := 0;
  advisory text := '';
BEGIN
  FOR rec IN
    SELECT DISTINCT
           d.defaclrole                                        AS grantor_oid,
           pg_get_userbyid(d.defaclrole)                       AS grantor,
           d.defaclobjtype                                     AS objtype,
           d.defaclnamespace                                   AS nsp,
           pg_get_userbyid(a.grantee)                          AS grantee
      FROM pg_default_acl d
      CROSS JOIN aclexplode(d.defaclacl) a
     WHERE (d.defaclnamespace = 0 OR d.defaclnamespace = 'public'::regnamespace::oid)
       AND a.grantee <> 0
       AND pg_get_userbyid(a.grantee) = ANY (builtins)
  LOOP
    objkw := CASE rec.objtype
               WHEN 'r' THEN 'TABLES'
               WHEN 'S' THEN 'SEQUENCES'
               WHEN 'f' THEN 'FUNCTIONS'
               WHEN 'T' THEN 'TYPES'
               WHEN 'n' THEN 'SCHEMAS'
             END;
    CONTINUE WHEN objkw IS NULL;
    -- A cluster-wide default (defaclnamespace = 0) applies to EVERY schema, `public` included, so it
    -- has to be revoked without the IN SCHEMA clause or the public-schema case is left standing.
    scopekw := CASE WHEN rec.nsp = 0 THEN '' ELSE ' IN SCHEMA public' END;

    IF pg_has_role(current_user, rec.grantor_oid, 'USAGE') THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE ALL ON %s FROM %I',
                     rec.grantor, scopekw, objkw, rec.grantee);
      fixed := fixed + 1;
      RAISE NOTICE '0006 §4c: future % created by % will no longer be granted to %',
        lower(objkw), rec.grantor, rec.grantee;
    ELSE
      advisory := advisory
        || format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE ALL ON %s FROM %I;  ',
                  rec.grantor, scopekw, objkw, rec.grantee);
    END IF;
  END LOOP;

  IF advisory <> '' THEN
    RAISE WARNING '0006 §4c: default privileges remain that this connection (%) is not a member of the grantor for. A future object created BY THAT GRANTOR in schema public will be re-granted to a Supabase built-in role. Run these as a role that is a member of the grantor (Supabase support, or `supabase_admin`): %  — AND SEE §6 at the foot of this file, which returns the same list as a RESULT SET: this WARNING is not rendered by the Supabase SQL editor, which is the whole reason §6 exists.', current_user, advisory;
  END IF;
  IF fixed = 0 AND advisory = '' THEN
    RAISE NOTICE '0006 §4c: no default privileges in schema public (or cluster-wide) grant anything to anon/authenticated/service_role — nothing to neutralise. Expected off Supabase, and expected on EVERY RE-RUN after the first.';
  END IF;

  -- NOT DONE, AND NOT AN OVERSIGHT: no default privilege is ADDED for `oversight_app`. It is
  -- tempting (`alter default privileges in schema public grant select on tables to oversight_app`)
  -- and it is the wrong shape for this codebase. A new jurisdiction-scoped table is THREE deliberate
  -- steps — the migration, the matching prod-paste with its RLS, then a re-paste of THIS file
  -- (docs/PROVISIONING.md §2a, steps 1-3) — and a default
  -- privilege would hand the app credential SELECT on it in step one, during the window before its
  -- policy exists. The documented fail-closed signature of a missed paste is an EMPTY PANEL, which
  -- depends on RLS being enabled in the migration; a table that slipped through with RLS off and an
  -- automatic SELECT grant is a leak with no signature at all. So: re-run §3 of this file after every
  -- migration that adds a table. That is the header's first bullet, and this is why.
END
$$;

-- =============================================================================
-- §5 · VERIFICATION — LIVE ASSERTIONS, RUN AS PART OF THE PASTE
--
-- Labelled V1…V6 rather than continuing prod-paste-0005's A…G, whose letters now collide with the
-- increment letters (increment G, increment J) in a way that reads badly in a handover.
--
-- Every block here is CALLER-AGNOSTIC — `has_table_privilege`, `has_function_privilege`,
-- `aclexplode`, `pg_roles`, `pg_has_role` are all readable by every role and answer the same
-- question whoever asks — so these report the same result pasted as the owner or re-run later as the
-- app role. They alter NOTHING: no grant, no role, no policy, no row.
--
-- `has_*_privilege()` is used in preference to scanning `information_schema.role_table_grants`
-- because it accounts for a privilege arriving INDIRECTLY — through a granted role, or through a
-- grant to PUBLIC — which is how this class of finding actually comes back. Its one cost is that it
-- also answers TRUE for a superuser or an object's owner, where there is no grant to revoke; V1 runs
-- first and names that case so the operator is not sent hunting for a phantom GRANT.
-- =============================================================================

-- ---- V1 · THE APP ROLE IS NOT RLS-EXEMPT ---------------------------------------------------------
--      The defect this whole file answers was an RLS-exempt app credential. Three attributes and two
--      relationships can reproduce it, all of them invisible in normal use: rolsuper, rolbypassrls,
--      SET ROLE reachability to either, ownership of a public table, and MEMBERSHIP in an owning role
--      (membership confers the owner's privileges by inheritance, so "not the owner" has to mean
--      "does not reach the owner"). Asserted on every re-paste, for the reason 0005 gives for its
--      G5/G6: this control is an absence, and an absence is what a later `alter role` removes with
--      nothing to show for it.
DO $$
DECLARE
  app_role      text := 'oversight_app';          -- ⇦ FIXED (see the §3 banner), not an edit point
  prov_role     text := 'oversight_provisioner';  -- ⇦ likewise fixed; matches prod-paste-0005
  reachable     text;
  owned         text;
  owner_roles   text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'V1: role % does not exist — §2 creates it and §3 refuses without it, so reaching V1 at all means something dropped it mid-file. The name is FIXED at oversight_app here as everywhere in this file (see the §3 banner).', app_role;
  END IF;

  IF (SELECT rolsuper FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'V1 FAILED: % is a SUPERUSER — exempt from every policy in db/sql/policies.sql. Fix: ALTER ROLE % NOSUPERUSER.', app_role, app_role;
  END IF;
  IF (SELECT rolbypassrls FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'V1 FAILED: % holds BYPASSRLS — same effect as superuser for RLS. Fix: ALTER ROLE % NOBYPASSRLS.', app_role, app_role;
  END IF;

  -- A role that can SET ROLE to an exempt role is exempt whenever it chooses to be. 'MEMBER' is the
  -- SET ROLE test (vs 'USAGE', which is inheritance); both matter, so both are tested — 'MEMBER' is
  -- the weaker precondition and therefore catches the 'USAGE' case too.
  SELECT string_agg(r.rolname, ', ') INTO reachable
    FROM pg_roles r
   WHERE (r.rolsuper OR r.rolbypassrls)
     AND r.rolname <> app_role
     AND pg_has_role(app_role, r.rolname, 'MEMBER');
  IF reachable IS NOT NULL THEN
    RAISE EXCEPTION 'V1 FAILED: % can SET ROLE to RLS-exempt role(s) [%] — superuser/bypassrls whenever it chooses to be. Fix: revoke that role membership.', app_role, reachable;
  END IF;

  -- Owner of any `public` table ⇒ exempt from THAT table's RLS (we use ENABLE, never FORCE, because
  -- the ETL loader connects as the owner and must keep writing).
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO owned
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND pg_get_userbyid(c.relowner) = app_role;
  IF owned IS NOT NULL THEN
    RAISE EXCEPTION 'V1 FAILED: % OWNS public table(s) [%] and is therefore exempt from their RLS. Fix: ALTER TABLE … OWNER TO <the migration owner>; the app role must be a grantee, never an owner.', app_role, owned;
  END IF;

  SELECT string_agg(DISTINCT o.rolname, ', ') INTO owner_roles
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles o ON o.oid = c.relowner
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND o.rolname <> app_role
     AND pg_has_role(app_role, o.rolname, 'USAGE');
  IF owner_roles IS NOT NULL THEN
    RAISE EXCEPTION 'V1 FAILED: % is a member of [%], which own public tables, so it holds the owner''s privileges — including RLS exemption — by inheritance. Fix: revoke that membership (or make the role NOINHERIT, though revoking is the honest fix).', app_role, owner_roles;
  END IF;

  -- …and it must not be a member of the Supabase built-ins either, in BOTH directions of
  -- consequence: §4a's revokes would silently remove privileges it inherited, and a future grant to
  -- `authenticated` would silently widen it. (On Supabase these three are granted TO `postgres`,
  -- which is why this is worth asserting rather than assuming.)
  SELECT string_agg(r.rolname, ', ') INTO reachable
    FROM pg_roles r
   WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
     AND pg_has_role(app_role, r.rolname, 'MEMBER');
  IF reachable IS NOT NULL THEN
    RAISE EXCEPTION 'V1 FAILED: % is a member of Supabase built-in role(s) [%]. §4 revokes everything from those roles, so the app role''s privileges would move with theirs in both directions. Fix: REVOKE % FROM %.', app_role, reachable, reachable, app_role;
  END IF;

  -- The provisioner's non-ownership/non-superuser-ness is prod-paste-0005's G6. BYPASSRLS is the one
  -- attribute G6 does not look at, so it is picked up here rather than left to nobody.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = prov_role) THEN
    IF (SELECT rolbypassrls FROM pg_roles WHERE rolname = prov_role) THEN
      RAISE EXCEPTION 'V1 FAILED: provisioner role % holds BYPASSRLS. prod-paste-0005''s G6 checks rolsuper and ownership but not this attribute; the consequence is the same — the role-targeted policies on the officer tables stop being what authorises it. Fix: ALTER ROLE % NOBYPASSRLS.', prov_role, prov_role;
    END IF;
  END IF;

  RAISE NOTICE 'V1 ok — % is not superuser, not BYPASSRLS, cannot SET ROLE to either, owns no public table, inherits no table owner, and is not a member of anon/authenticated/service_role', app_role;
END
$$;

-- ---- V2 · THE APP ROLE ON THE OFFICER TABLES -----------------------------------------------------
--      SELECT and nothing else on `ref_oversight_officer`; NOTHING AT ALL on
--      `audit_officer_provisioning`. This is the §3 ordering trap, asserted: if the narrowing REVOKEs
--      ever stop running after the blanket grant, the app credential becomes a GES-officer roster
--      enumeration primitive and this block is what says so.
DO $$
DECLARE
  app_role text := 'oversight_app';  -- ⇦ FIXED (see the §3 banner), not an edit point
  writes   text[] := array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  allpriv  text[] := array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  p        text;
  held     text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'V2: role % does not exist — see V1''s message; the name is FIXED throughout this file', app_role;
  END IF;

  IF NOT has_table_privilege(app_role, 'public.ref_oversight_officer', 'SELECT') THEN
    RAISE EXCEPTION 'V2 FAILED: % does not hold SELECT on ref_oversight_officer. Kofi''s posture is SELECT-only, and db/sql/policies.sql leaves the table with no app-reachable policy so it yields ZERO rows anyway — the grant is kept so that widening it later cannot silently widen writes. Fix: re-run §3.', app_role;
  END IF;

  FOREACH p IN ARRAY writes LOOP
    IF has_table_privilege(app_role, 'public.ref_oversight_officer', p) THEN
      held := held || p || ' ';
    END IF;
  END LOOP;
  IF held <> '' THEN
    RAISE EXCEPTION 'V2 FAILED: % holds [%] on ref_oversight_officer. Self-promotion (`update ref_oversight_officer set officer_role=''NATIONAL_OVERSIGHT'' where officer_id=<me>`) is prevented by the ABSENCE of this privilege, before RLS and before the trigger. Fix: REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ref_oversight_officer FROM % — and look for an INDIRECT grant (a granted role, or a grant to PUBLIC), not only a direct one. If there is no such grant at all, % is a superuser or the table owner: V1 covers that case and should have raised first.', app_role, held, app_role, app_role;
  END IF;

  held := '';
  FOREACH p IN ARRAY allpriv LOOP
    IF has_table_privilege(app_role, 'public.audit_officer_provisioning', p) THEN
      held := held || p || ' ';
    END IF;
  END LOOP;
  IF held <> '' THEN
    RAISE EXCEPTION 'V2 FAILED: % holds [%] on audit_officer_provisioning and must hold nothing. That table is the officer roster plus who granted whom national access; a GES officer who could read it would have exactly what the directory design withholds. This is the §3 ORDERING TRAP — a blanket `grant select on all tables in schema public` hands it over, so the REVOKE must run AFTER. Fix: REVOKE ALL ON audit_officer_provisioning FROM % (and re-run §3 in order).', app_role, held, app_role;
  END IF;

  RAISE NOTICE 'V2 ok — % holds SELECT and no write on ref_oversight_officer, and nothing whatever on audit_officer_provisioning', app_role;
END
$$;

-- ---- V3 · THE APP ROLE ON THE AUDIT LOG AND THE WAREHOUSE ----------------------------------------
--      SELECT + INSERT on `audit_access_log` and NOT UPDATE/DELETE/TRUNCATE — the one case where an
--      over-grant makes a tamper attempt report SUCCESS rather than fail (RLS yields a silent
--      `UPDATE 0`; see db/sql/policies.sql above the append-only trigger). Plus SELECT on a
--      representative dim/fact/ref table, because an app role that cannot read the warehouse is an
--      outage and this file is the thing that would have caused it.
DO $$
DECLARE
  app_role text := 'oversight_app';  -- ⇦ FIXED (see the §3 banner), not an edit point
  reads    text[] := array['public.dim_jurisdiction', 'public.fact_enrolment',
                           'public.ref_emis_school_register', 'public.audit_access_log'];
  mutates  text[] := array['UPDATE', 'DELETE', 'TRUNCATE'];
  t        text;
  p        text;
  held     text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'V3: role % does not exist — see V1''s message; the name is FIXED throughout this file', app_role;
  END IF;

  FOREACH t IN ARRAY reads LOOP
    CONTINUE WHEN to_regclass(t) IS NULL;
    IF NOT has_table_privilege(app_role, t, 'SELECT') THEN
      RAISE EXCEPTION 'V3 FAILED: % cannot SELECT %. Every oversight panel reads this. Fix: re-run §3 (`grant select on all tables in schema public`).', app_role, t;
    END IF;
  END LOOP;

  IF NOT has_table_privilege(app_role, 'public.audit_access_log', 'INSERT') THEN
    RAISE EXCEPTION 'V3 FAILED: % cannot INSERT into audit_access_log. The §6 gate writes its audit row BEFORE it fetches, so without this the named-record path does not fail open — it fails shut, on every access, for every officer. Fix: GRANT INSERT ON audit_access_log TO %.', app_role, app_role;
  END IF;

  FOREACH p IN ARRAY mutates LOOP
    IF has_table_privilege(app_role, 'public.audit_access_log', p) THEN
      held := held || p || ' ';
    END IF;
  END LOOP;
  IF held <> '' THEN
    RAISE EXCEPTION 'V3 FAILED: % holds [%] on audit_access_log. This is the over-grant that is WORSE THAN LOUD: the append-only trigger only fires for a role that can SEE the row, so an over-granted role hits RLS first and gets a silent `UPDATE 0` — the row survives but the tamper attempt reports success. With the privilege absent the same statement fails with `permission denied`. Fix: REVOKE UPDATE, DELETE, TRUNCATE ON audit_access_log FROM %.', app_role, held, app_role;
  END IF;

  -- fact_anomaly UPDATE (anomaly triage) is NOT granted by this file — triage is increment J. Not an
  -- error either way, so this reports rather than raises: a future increment legitimately adds it,
  -- and a block that failed the paste for it would be deleted rather than updated.
  IF to_regclass('public.fact_anomaly') IS NOT NULL THEN
    IF has_table_privilege(app_role, 'public.fact_anomaly', 'UPDATE') THEN
      RAISE NOTICE 'V3 note — % holds UPDATE on fact_anomaly. This file does not grant it (triage is increment J). If increment J has landed, add the grant to §3 AND to tests/setup/global-setup.ts so CI runs the same posture; if it has not, find out who granted it.', app_role;
    ELSE
      RAISE NOTICE 'V3 note — % does NOT hold UPDATE on fact_anomaly: correct for now. Increment J (anomaly triage) will need it; add it to §3 and to tests/setup/global-setup.ts together.', app_role;
    END IF;
  END IF;

  RAISE NOTICE 'V3 ok — % reads the warehouse, can INSERT into audit_access_log, and cannot UPDATE/DELETE/TRUNCATE it', app_role;
END
$$;

-- ---- V4 · THE SUPABASE BUILT-INS HOLD NOTHING, ON EVERY TABLE ------------------------------------
--      Not a spot-check on four tables: EVERY table, view, sequence and routine in `public`, against
--      all three roles. The finding 0005's G5 caught was project-wide, and the hand-fix covered two
--      tables — so the assertion that replaces the hand-fix has to be project-wide too, or the next
--      re-paste reports success on the same half-closed state.
--
--      The four named tables are checked FIRST so the error message is specific when the sweep
--      misses the ones that matter most: the officer directory (roster), the provisioning log (who
--      granted whom national access), and the audit log (the evidence that the gate held).
--
--      …and then, separately, that none of the three can SET ROLE its way to a role that holds
--      everything — the one thing `has_*_privilege()` cannot see. See the S-2 note inside the block.
DO $$
DECLARE
  builtins text[] := array['anon', 'authenticated', 'service_role'];
  named    text[] := array['public.ref_oversight_officer', 'public.audit_officer_provisioning',
                           'public.audit_access_log', 'public.dim_jurisdiction',
                           'public.fact_enrolment', 'public.ref_emis_school_register'];
  tabpriv  text[] := array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  seqpriv  text[] := array['USAGE', 'SELECT', 'UPDATE'];
  r        text;
  t        text;
  p        text;
  rec      record;
  findings text := '';
  escal    text := '';
  escal1   text;
  checked  int  := 0;
  active   int  := 0;
BEGIN
  -- PG 17 adds MAINTAIN (VACUUM/ANALYZE/REINDEX/CLUSTER/REFRESH). `revoke all` covers it; name it
  -- explicitly where the server knows it, so the assertion is as wide as the grant it undoes.
  IF current_setting('server_version_num')::int >= 170000 THEN
    tabpriv := tabpriv || 'MAINTAIN';
  END IF;

  SELECT count(*) INTO checked
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f');

  FOREACH r IN ARRAY builtins LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
    active := active + 1;

    -- the named, highest-consequence tables first
    FOREACH t IN ARRAY named LOOP
      CONTINUE WHEN to_regclass(t) IS NULL;
      FOREACH p IN ARRAY tabpriv LOOP
        IF has_table_privilege(r, t, p) THEN
          findings := findings || format('%s:%s on %s; ', r, p, t);
        END IF;
      END LOOP;
    END LOOP;

    -- then everything else in the schema: tables, views, matviews, partitioned and foreign tables
    -- (the six named above are excluded so a finding is reported once, not twice)
    FOR rec IN
      SELECT (quote_ident(n.nspname) || '.' || quote_ident(c.relname)) AS qname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND (n.nspname || '.' || c.relname) <> ALL (named)
       ORDER BY c.relname
    LOOP
      FOREACH p IN ARRAY tabpriv LOOP
        IF has_table_privilege(r, rec.qname, p) THEN
          findings := findings || format('%s:%s on %s; ', r, p, rec.qname);
        END IF;
      END LOOP;
    END LOOP;

    -- sequences (ref_assessment_weights.weights_config_id is a bigserial, so there is one)
    FOR rec IN
      SELECT (quote_ident(n.nspname) || '.' || quote_ident(c.relname)) AS qname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'S'
       ORDER BY c.relname
    LOOP
      FOREACH p IN ARRAY seqpriv LOOP
        IF has_sequence_privilege(r, rec.qname, p) THEN
          findings := findings || format('%s:%s on sequence %s; ', r, p, rec.qname);
        END IF;
      END LOOP;
    END LOOP;

    -- routines we own (extension routines are out of this file's scope, as in §4b)
    FOR rec IN
      SELECT p2.oid AS oid, p2.oid::regprocedure::text AS sig
        FROM pg_proc p2 JOIN pg_namespace n ON n.oid = p2.pronamespace
       WHERE n.nspname = 'public'
         AND NOT EXISTS (
               SELECT 1 FROM pg_depend d
                WHERE d.classid = 'pg_proc'::regclass AND d.objid = p2.oid AND d.deptype = 'e')
       ORDER BY 2
    LOOP
      IF has_function_privilege(r, rec.oid, 'EXECUTE') THEN
        findings := findings || format('%s:EXECUTE on %s; ', r, rec.sig);
      END IF;
    END LOOP;
  END LOOP;

  IF findings <> '' THEN
    RAISE EXCEPTION 'V4 FAILED: Supabase built-in role(s) still hold privileges in schema public: %  — the Oversight app reaches analytics ONLY over direct Postgres as oversight_app/oversight_provisioner, never over PostgREST, so these roles must hold NOTHING here (a REST path into this database is a path around the §6 audit-first gate, and `ALL` includes DELETE and TRUNCATE on the officer directory and the audit log). Fix: re-run §4a/§4b. If a privilege survives the revoke it is arriving INDIRECTLY — check for a grant to PUBLIC (`select grantee, privilege_type from information_schema.role_table_grants where table_schema=''public'' and grantee in (''PUBLIC'',''anon'',''authenticated'',''service_role'')`) and for a role granted to one of these three. Revoke at the source.', findings;
  END IF;

  -- ---- S-2 · AND THEY CANNOT *BECOME* A ROLE THAT HOLDS EVERYTHING -------------------------------
  -- Everything above is `has_*_privilege()`, and that primitive has one blind spot that matters here:
  -- it answers "what does this role hold, counting what it INHERITS". A role membership granted
  -- `WITH INHERIT FALSE`, or granted to a NOINHERIT role, confers NOTHING by inheritance — so
  -- `has_table_privilege` reports FALSE — and yet the member can still `SET ROLE` to it and then hold
  -- the lot. The loop above would report a clean sweep for a role that is one `set role postgres`
  -- away from owning the warehouse.
  --
  -- THIS IS NOT HYPOTHETICAL PLUMBING ON SUPABASE: `anon`, `authenticated` and `service_role` are all
  -- created NOINHERIT, and `authenticator` is a member of all three precisely so that it can SET ROLE
  -- between them per request. The mechanism is in use on this very project; the only thing standing
  -- between it and an escalation is that nobody has granted one of the three a membership pointing
  -- the wrong way. That is an ABSENCE, which is the one kind of control this file exists to assert.
  --
  -- The primitive is the one V1 already uses on the app role — `pg_has_role(role, target, 'MEMBER')`,
  -- where 'MEMBER' is the SET ROLE test and is the WEAKER precondition, so it catches the inheriting
  -- ('USAGE') case too. Targets: the owners of `public` tables (owner ⇒ RLS-exempt, since we ENABLE
  -- and never FORCE) plus every `rolsuper`/`rolbypassrls` role (exempt from everything).
  FOREACH r IN ARRAY builtins LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
    SELECT string_agg(DISTINCT x.rolname, ', ') INTO escal1
      FROM (
             SELECT o.rolname
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN pg_roles o ON o.oid = c.relowner
              WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
             UNION
             SELECT s.rolname FROM pg_roles s WHERE s.rolsuper OR s.rolbypassrls
           ) x
     WHERE x.rolname <> r
       AND pg_has_role(r, x.rolname, 'MEMBER');
    IF escal1 IS NOT NULL THEN
      escal := escal || format('%s can SET ROLE to [%s]; ', r, escal1);
    END IF;
  END LOOP;

  IF escal <> '' THEN
    RAISE EXCEPTION 'V4 FAILED (SET ROLE escalation): %  — these Supabase built-in role(s) hold no privilege of their own in schema public (the sweep above is clean) but can SET ROLE to a role that owns the warehouse tables, or to a SUPERUSER/BYPASSRLS role. An owner is exempt from its own tables'' RLS and a superuser is exempt from everything, so this makes the entire jurisdiction boundary optional for anything that can authenticate as one of these three — i.e. for anything holding the project''s anon or service key, over PostgREST, with no statement anywhere granting it a privilege. `has_table_privilege` does NOT see this, which is why it is checked separately: a membership granted WITH INHERIT FALSE (and all three of these roles are NOINHERIT) confers nothing by inheritance and everything by SET ROLE. Fix: REVOKE <the owner/superuser role> FROM <the built-in>. Do not "fix" it by making the membership NOINHERIT — NOINHERIT is already the state that hides it.', escal;
  END IF;

  IF active = 0 THEN
    RAISE NOTICE 'V4 ok (vacuously) — none of anon/authenticated/service_role exist on this cluster, so there is nothing for them to hold and nothing for them to SET ROLE to. Expected off Supabase; on omnischools-analytics-prod all three MUST exist and this NOTICE would mean you are looking at the wrong database.';
  ELSE
    RAISE NOTICE 'V4 ok — % Supabase built-in role(s) hold no privilege on any of the % relation(s), nor on any sequence or non-extension routine, in schema public, and none of them can SET ROLE to a table owner, a superuser or a BYPASSRLS role', active, checked;
  END IF;
END
$$;

-- ---- V5 · NO DEFAULT PRIVILEGE WILL RE-GRANT THE NEXT TABLE --------------------------------------
--      V4 is a statement about the present. This is the statement about the future, and it is the one
--      that would have prevented the hand-fix applied during 0005 from being undone by increment H's
--      first `create table`.
--
--      The two outcomes are deliberately different:
--        · a remaining default privilege whose GRANTOR THIS CONNECTION CAN ALTER ⇒ EXCEPTION. §4c
--          should already have removed it, so this is a bug in §4c (or something re-added it inside
--          this very transaction) and the paste must not report success.
--        · one it CANNOT alter (grantor `supabase_admin`, say) ⇒ WARNING with the exact statement.
--          Failing the paste for a condition the operator has no way to fix from the SQL editor would
--          only teach them to stop running the file.
DO $$
DECLARE
  builtins text[] := array['anon', 'authenticated', 'service_role'];
  rec      record;
  objkw    text;
  scopekw  text;
  fatal    text := '';
  advisory text := '';
BEGIN
  FOR rec IN
    SELECT DISTINCT
           d.defaclrole                  AS grantor_oid,
           pg_get_userbyid(d.defaclrole) AS grantor,
           d.defaclobjtype               AS objtype,
           d.defaclnamespace             AS nsp,
           pg_get_userbyid(a.grantee)    AS grantee
      FROM pg_default_acl d
      CROSS JOIN aclexplode(d.defaclacl) a
     WHERE (d.defaclnamespace = 0 OR d.defaclnamespace = 'public'::regnamespace::oid)
       AND a.grantee <> 0
       AND pg_get_userbyid(a.grantee) = ANY (builtins)
  LOOP
    objkw := CASE rec.objtype
               WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' WHEN 'f' THEN 'FUNCTIONS'
               WHEN 'T' THEN 'TYPES'  WHEN 'n' THEN 'SCHEMAS'
             END;
    CONTINUE WHEN objkw IS NULL;
    scopekw := CASE WHEN rec.nsp = 0 THEN '' ELSE ' IN SCHEMA public' END;

    IF pg_has_role(current_user, rec.grantor_oid, 'USAGE') THEN
      fatal := fatal || format('%s grants %s to %s%s; ', rec.grantor, objkw, rec.grantee,
                               CASE WHEN rec.nsp = 0 THEN ' (cluster-wide)' ELSE '' END);
    ELSE
      advisory := advisory
        || format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE ALL ON %s FROM %I;  ',
                  rec.grantor, scopekw, objkw, rec.grantee);
    END IF;
  END LOOP;

  IF fatal <> '' THEN
    RAISE EXCEPTION 'V5 FAILED: default privileges that THIS connection could have removed are still in place: %  — §4c should have revoked these, so either §4c did not run or something re-added them. Until they are gone, the first `create table` of the next migration silently re-grants ALL (DELETE and TRUNCATE included) on a new analytics table to a Supabase built-in role, with no statement anywhere naming it. Fix: re-run §4c, then this block.', fatal;
  END IF;
  IF advisory <> '' THEN
    RAISE WARNING 'V5 ADVISORY: default privileges remain whose grantor this connection (%) is not a member of, so §4c could not touch them. A future object created BY THAT GRANTOR in schema public will be granted to a Supabase built-in role. Run these as a member of the grantor: %  — also returned as ADVISORY rows by §6 at the foot of this file, which is the copy the Supabase SQL editor will actually show you.', current_user, advisory;
    RAISE NOTICE 'V5 partial — present-tense privileges are clean (V4) and the removable default privileges are gone; the advisory above is the residual. Until it is cleared, treat "re-run prod-paste-0006 after every migration that adds a table" as mandatory rather than hygienic.';
  ELSE
    RAISE NOTICE 'V5 ok — no default privilege in schema public (or cluster-wide) grants anything to anon/authenticated/service_role, so a table created by a future migration starts with no privilege for them';
  END IF;
END
$$;

-- ---- V6 · SUMMARY --------------------------------------------------------------------------------
--      One place to read the posture off, and one place that names what is NOT proven here. It prints
--      the app role's own view of its privileges rather than re-deriving them, so a NOTICE that does
--      not match the intent above is itself the finding.
DO $$
DECLARE
  app_role  text := 'oversight_app';          -- ⇦ FIXED (see the §3 banner), not an edit point
  prov_role text := 'oversight_provisioner';  -- ⇦ likewise fixed; matches prod-paste-0005
  builtins  int;
  tables    int;
  routines  int;
BEGIN
  SELECT count(*) INTO builtins FROM pg_roles
   WHERE rolname IN ('anon', 'authenticated', 'service_role');
  SELECT count(*) INTO tables FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f');
  SELECT count(*) INTO routines FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public';

  RAISE NOTICE '─────────────────────────────────────────────────────────────────────────────';
  RAISE NOTICE 'prod-paste-0006 applied to % — % relation(s), % routine(s) in schema public',
    current_database(), tables, routines;
  RAISE NOTICE '  app role          : %  (super=%, bypassrls=%)', app_role,
    (SELECT rolsuper FROM pg_roles WHERE rolname = app_role),
    (SELECT rolbypassrls FROM pg_roles WHERE rolname = app_role);
  RAISE NOTICE '  ref_oversight_officer      : select=%, insert=%, update=%, delete=%, truncate=%',
    has_table_privilege(app_role, 'public.ref_oversight_officer', 'SELECT'),
    has_table_privilege(app_role, 'public.ref_oversight_officer', 'INSERT'),
    has_table_privilege(app_role, 'public.ref_oversight_officer', 'UPDATE'),
    has_table_privilege(app_role, 'public.ref_oversight_officer', 'DELETE'),
    has_table_privilege(app_role, 'public.ref_oversight_officer', 'TRUNCATE');
  RAISE NOTICE '  audit_officer_provisioning : select=% (all privileges must be false)',
    has_table_privilege(app_role, 'public.audit_officer_provisioning', 'SELECT');
  RAISE NOTICE '  audit_access_log           : select=%, insert=%, update=%, delete=%',
    has_table_privilege(app_role, 'public.audit_access_log', 'SELECT'),
    has_table_privilege(app_role, 'public.audit_access_log', 'INSERT'),
    has_table_privilege(app_role, 'public.audit_access_log', 'UPDATE'),
    has_table_privilege(app_role, 'public.audit_access_log', 'DELETE');
  RAISE NOTICE '  provisioner role  : % (present=%)', prov_role,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = prov_role);
  RAISE NOTICE '  supabase built-ins: % of 3 present, all swept out of schema public', builtins;
  RAISE NOTICE '';
  RAISE NOTICE 'NOT PROVEN BY THIS FILE, and still to be checked by hand:';
  RAISE NOTICE '  · that ANALYTICS_DATABASE_URL actually points at % (this file cannot see your env);', app_role;
  RAISE NOTICE '    confirm with: select current_user, current_setting(''is_superuser'') — from the APP, not here.';
  RAISE NOTICE '  · that the jurisdiction boundary FILTERS for that role. Connect AS % and run', app_role;
  RAISE NOTICE '    prod-paste-0002 block C / 0004 verification 3: set app.current_level=''DISTRICT'',';
  RAISE NOTICE '    app.current_jurisdiction=<a district uuid>, then count a fact table. As the owner';
  RAISE NOTICE '    these show a false pass — that false pass is the defect this file answers.';
  RAISE NOTICE '  · prod-paste-0005''s G1–G4 (the S1 coupling), which need real node/officer uuids.';
  RAISE NOTICE '  · re-run THIS FILE after any migration that adds a table, sequence or routine.';
  RAISE NOTICE '─────────────────────────────────────────────────────────────────────────────';
END
$$;

-- =============================================================================
-- §6 · THE RESIDUAL REPORT — THE ONE OUTPUT OF THIS FILE THE SQL EDITOR ACTUALLY RENDERS
--
-- ⚠ READ THE RESULT SET BELOW. IT IS THE AUTHORITATIVE REPORT. **ZERO ROWS = CLEAN.** Any row is a
-- finding, and its `remediation_statement` column is the statement that closes it.
--
-- WHY THIS EXISTS, AND WHY IT IS NOT MERELY DECORATIVE. Everything above reports in one of two ways:
-- `RAISE EXCEPTION`, which the Supabase SQL editor shows as an error and which rolls the whole file
-- back (good — loud, unmissable, fail-closed), or `RAISE NOTICE` / `RAISE WARNING`, WHICH THE SUPABASE
-- SQL EDITOR DOES NOT RELIABLY RENDER AT ALL. It shows result sets and errors. That is fine for the
-- NOTICEs, which are narration. It is NOT fine for the soft findings, because every one of them is a
-- control over an ABSENCE — a privilege nobody should hold, a default privilege nobody should have
-- left standing — and a control whose only report is an invisible WARNING is not a control. It is a
-- line of SQL that makes the file feel thorough.
--
-- The soft findings that were, until this block existed, emitted ONLY as RAISE output and therefore
-- silently swallowed on prod:
--   · §1   — prod-paste-0005 not applied (`ov_resolve_officer` absent), which means sign-in is broken
--            after this file reports success;
--   · §1   — the CURRENT 0005 not applied (the S1 directory↔audit coupling trigger is absent);
--   · §4b  — routines whose EXECUTE could not be revoked from PUBLIC (`anon` can call them over
--            PostgREST RPC, and `ov_in_subtree` is a SECURITY DEFINER oracle over the GES spine);
--   · §4c  — a default privilege whose grantor this connection is not a member of, so §4c could
--            report it but could not fix it (the advisory branch);
--   · V5   — the same residual, re-derived after the fact.
-- All of them are below, plus — for the case where someone runs JUST THIS STATEMENT later as a
-- standing audit query rather than re-pasting the file — the conditions V0 and V4 assert by raising.
-- Those branches are unreachable in a full paste (the EXCEPTION rolls the file back before the
-- editor ever renders a result set); they are here so that this query is a complete posture check on
-- its own, which is what makes it worth saving in the project's snippets.
--
-- ⚠ "COMPLETE ON ITS OWN" IS A CLAIM WITH A CHECKLIST BEHIND IT, so here is the checklist. V4
-- asserts four things about the Supabase built-ins and §6 must have a row source for each, or this
-- banner is wider than the query:
--   · a built-in holding any privilege on a TABLE / view / matview / foreign table  → `builtin_residual`
--   · a built-in holding USAGE / SELECT / UPDATE on a SEQUENCE                      → `builtin_sequence`
--   · a built-in holding EXECUTE on one of our routines                             → `builtin_execute`
--                                                                                     (direct or
--                                                                                     inherited) and
--                                                                                     `public_execute`
--                                                                                     (via PUBLIC)
--   · a built-in that can SET ROLE to a table owner / SUPERUSER / BYPASSRLS role    → `builtin_residual`
-- The middle two were MISSING until this revision, and their absence was precisely the kind of
-- finding this file is about: §6 said it covered what V4 covers, V4 would have raised on a built-in
-- holding `nextval` on a sequence or a direct `grant execute … to anon`, and §6 would have returned
-- zero rows — reporting CLEAN for a residual the file itself treats as fatal.
--
-- WHAT IS DELIBERATELY *NOT* A ROW: V6's "NOT PROVEN BY THIS FILE" checklist above. Those are manual
-- steps, not residuals — two of them (does ANALYTICS_DATABASE_URL point at `oversight_app`; does the
-- jurisdiction boundary filter for that role) are undetectable from inside the database BY
-- CONSTRUCTION, which is exactly why they are listed as unproven. Emitting them as rows on every
-- clean apply would destroy the only property that makes this report readable at a glance — zero rows
-- means clean — and would train the operator to ignore it. They stay in V6's NOTICE and in this
-- file's text, which the person pasting has open in front of them.
-- =============================================================================
WITH builtins(rolname) AS (
  VALUES ('anon'), ('authenticated'), ('service_role')
),
-- §4c / V5 · default privileges that will re-grant the NEXT object a migration creates. Same
-- pg_default_acl/aclexplode query V5 uses, with V5's own FINDING/ADVISORY split: a grantor this
-- connection could have altered is a bug in §4c (V5 raises on it); one it could not is the advisory.
default_acl AS (
  SELECT DISTINCT
         (CASE WHEN pg_has_role(current_user, d.defaclrole, 'USAGE')
               THEN 'FINDING' ELSE 'ADVISORY' END)::text              AS severity,
         pg_get_userbyid(d.defaclrole)::text                          AS grantor,
         -- The two CASEs over `defaclobjtype` in this row source — this label and the remediation
         -- statement below — enumerate THE SAME five codes with NO `ELSE`, deliberately. The final
         -- `defaclobjtype IN ('r','S','f','T','n')` predicate makes an out-of-list code unreachable;
         -- if a future Postgres adds a sixth and the predicate is widened without these, BOTH
         -- columns go NULL together and the row is obviously broken. The earlier version gave the
         -- label an `ELSE d.defaclobjtype::text` and the remediation none, which would have produced
         -- a row that LOOKED like a real finding with a NULL remediation.
         ('DEFAULT ACL ' || CASE d.defaclobjtype
                              WHEN 'r' THEN 'TABLES'    WHEN 'S' THEN 'SEQUENCES'
                              WHEN 'f' THEN 'FUNCTIONS' WHEN 'T' THEN 'TYPES'
                              WHEN 'n' THEN 'SCHEMAS'
                            END
           || CASE WHEN d.defaclnamespace = 0 THEN ' (CLUSTER-WIDE)' ELSE ' (public)' END)::text
                                                                      AS objtype,
         pg_get_userbyid(a.grantee)::text                             AS grantee,
         format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE ALL ON %s FROM %I;',
                pg_get_userbyid(d.defaclrole),
                CASE WHEN d.defaclnamespace = 0 THEN '' ELSE ' IN SCHEMA public' END,
                CASE d.defaclobjtype
                  WHEN 'r' THEN 'TABLES'    WHEN 'S' THEN 'SEQUENCES'
                  WHEN 'f' THEN 'FUNCTIONS' WHEN 'T' THEN 'TYPES'
                  WHEN 'n' THEN 'SCHEMAS'
                END,
                pg_get_userbyid(a.grantee))::text                     AS remediation_statement
    FROM pg_default_acl d
    CROSS JOIN aclexplode(d.defaclacl) a
   WHERE (d.defaclnamespace = 0 OR d.defaclnamespace = 'public'::regnamespace::oid)
     AND a.grantee <> 0
     AND pg_get_userbyid(a.grantee) IN (SELECT rolname FROM builtins)
     AND d.defaclobjtype IN ('r', 'S', 'f', 'T', 'n')
),
-- §4b · routines that still grant EXECUTE to PUBLIC. §4b wraps each REVOKE individually and collects
-- the failures into one WARNING; these are those failures, named, with the statement to retry.
public_execute AS (
  SELECT 'FINDING'::text                           AS severity,
         pg_get_userbyid(p.proowner)::text         AS grantor,
         'ROUTINE EXECUTE'::text                   AS objtype,
         'PUBLIC'::text                            AS grantee,
         format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC;', p.oid::regprocedure)::text
                                                   AS remediation_statement
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
     AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
),
-- §1 · the two prod-paste-0005 preconditions that are WARNINGs rather than EXCEPTIONs (deliberately —
-- see the CHICKEN-AND-EGG note in the header: this file has to be runnable BEFORE 0005 in order to
-- unblock it). A WARNING the editor never shows is how "apply 0005 and re-run" gets forgotten.
missing_0005 AS (
  SELECT 'ADVISORY'::text               AS severity,
         'n/a'::text                    AS grantor,
         'PASTE 0005 NOT APPLIED'::text AS objtype,
         'oversight_app'::text          AS grantee,
         ('ov_resolve_officer(uuid) is absent: apply db/sql/prod-paste-0005-officer-directory.sql, then RE-RUN THIS FILE. Until then sign-in fails with `permission denied for function ov_resolve_officer`.')::text
                                        AS remediation_statement
   WHERE to_regprocedure('public.ov_resolve_officer(uuid)') IS NULL
  UNION ALL
  -- Matched through pg_class/pg_namespace rather than a `::regclass` cast: a WHERE clause is not
  -- evaluated left-to-right, so `'public.ref_oversight_officer'::regclass` could be reached — and
  -- would ERROR, not return NULL — on a database where the table is absent. That database is exactly
  -- the one this row exists to report on.
  SELECT 'ADVISORY'::text, 'n/a'::text, 'PASTE 0005 OUT OF DATE'::text,
         'ref_oversight_officer'::text,
         ('officer_directory_audit_guard is absent from ref_oversight_officer: the CURRENT prod-paste-0005 (the one carrying the S1 directory<->audit coupling) has not been applied. Apply it, then RE-RUN THIS FILE.')::text
   WHERE EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'ref_oversight_officer')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                       JOIN pg_class c ON c.oid = t.tgrelid
                       JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relname = 'ref_oversight_officer'
                        AND t.tgname = 'officer_directory_audit_guard' AND NOT t.tgisinternal)
),
-- V0 · unreachable in a full paste (V0 raises and the file rolls back). Here so that this statement
-- alone is a complete posture check — the leak with no signature, named.
rls_off AS (
  SELECT 'FINDING'::text                      AS severity,
         pg_get_userbyid(c.relowner)::text    AS grantor,
         (CASE WHEN NOT c.relrowsecurity THEN 'TABLE RLS DISABLED'
               ELSE 'TABLE RLS ON, ZERO POLICIES' END)::text AS objtype,
         'oversight_app'::text                AS grantee,
         (CASE WHEN NOT c.relrowsecurity
               THEN format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY; -- and apply the prod-paste carrying its jurisdiction policy: until then oversight_app reads public.%I UNSCOPED', c.relname, c.relname)
               ELSE format('-- public.%I is deny-all (fail-closed) but has no policy: apply the prod-paste that carries it, do NOT disable RLS', c.relname) END)::text
                                              AS remediation_statement
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND (NOT c.relrowsecurity
          OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))
),
-- V4 · likewise unreachable in a full paste, and likewise worth having in a standing audit query:
-- a built-in holding a privilege in `public`, or able to SET ROLE its way to one that holds all of
-- them (the S-2 blind spot of `has_*_privilege`).
builtin_residual AS (
  SELECT 'FINDING'::text                  AS severity,
         pg_get_userbyid(c.relowner)::text AS grantor,
         ('TABLE ' || g.priv)::text        AS objtype,
         b.rolname::text                   AS grantee,
         format('REVOKE ALL ON public.%I FROM %I; -- holds %s', c.relname, b.rolname, g.priv)::text
                                           AS remediation_statement
    FROM builtins b
    JOIN pg_roles ro ON ro.rolname = b.rolname
    CROSS JOIN pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    -- PG 17 adds MAINTAIN (VACUUM/ANALYZE/REINDEX/CLUSTER/REFRESH). The array is chosen BEFORE
    -- has_table_privilege() is called with it, so naming it here cannot error on PG 16.
    CROSS JOIN unnest(
      CASE WHEN current_setting('server_version_num')::int >= 170000
           THEN array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER',
                      'MAINTAIN']
           ELSE array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
      END) AS g(priv)
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND has_table_privilege(b.rolname::name, c.oid, g.priv)
  UNION ALL
  SELECT 'FINDING'::text, x.rolname::text, 'SET ROLE REACHABLE (RLS-EXEMPT)'::text, b.rolname::text,
         format('REVOKE %I FROM %I; -- %s can SET ROLE to %s, which owns public tables or is SUPERUSER/BYPASSRLS', x.rolname, b.rolname, b.rolname, x.rolname)::text
    FROM builtins b
    JOIN pg_roles ro ON ro.rolname = b.rolname
    CROSS JOIN (
           SELECT o.rolname
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_roles o ON o.oid = c.relowner
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
           UNION
           SELECT s.rolname FROM pg_roles s WHERE s.rolsuper OR s.rolbypassrls
         ) x
   WHERE x.rolname <> b.rolname
     AND pg_has_role(b.rolname::name, x.rolname, 'MEMBER')
),
-- V4 · the SEQUENCE half of the same sweep. `builtin_residual` above is TABLES ONLY, and until this
-- source existed §6 claimed V4's coverage without it: Supabase's project setup issues `grant all on
-- all sequences in schema public to anon, authenticated, service_role` exactly as it does on tables,
-- §4a revokes it, and V4 asserts it — so a built-in left holding a sequence privilege was a residual
-- V4 would raise on and §6 would report as CLEAN. It is not a cosmetic gap: USAGE on a sequence is
-- `nextval()`, i.e. a WRITE, reachable over PostgREST RPC by a role that is supposed to hold nothing
-- here. `has_sequence_privilege` is used rather than an ACL scan for the reason §5's banner gives:
-- it sees a privilege arriving indirectly (through PUBLIC, or through a granted role), which is how
-- this class of finding actually comes back.
builtin_sequence AS (
  SELECT 'FINDING'::text                   AS severity,
         pg_get_userbyid(c.relowner)::text AS grantor,
         ('SEQUENCE ' || g.priv)::text     AS objtype,
         b.rolname::text                   AS grantee,
         format('REVOKE ALL ON SEQUENCE public.%I FROM %I; -- holds %s', c.relname, b.rolname, g.priv)::text
                                           AS remediation_statement
    FROM builtins b
    JOIN pg_roles ro ON ro.rolname = b.rolname
    CROSS JOIN pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(array['USAGE', 'SELECT', 'UPDATE']) AS g(priv)
   WHERE n.nspname = 'public'
     AND c.relkind = 'S'
     AND has_sequence_privilege(b.rolname::name, c.oid, g.priv)
),
-- V4 · and the ROUTINE half, for a grantee that is NOT PUBLIC. `public_execute` above matches only
-- `grantee = 0`; a plain `grant execute on function ov_in_subtree(uuid) to anon` is a different ACL
-- entry entirely, which §4a's point-in-time `revoke all on all routines` removes and nothing in §6
-- used to report. V4 catches it (its loop is `has_function_privilege(r, oid, 'EXECUTE')`), so §6
-- must too, or the "complete snapshot on its own" claim in the banner is false for the sharpest
-- object in the schema: `ov_in_subtree` is SECURITY DEFINER, a jurisdiction-tree membership oracle
-- over the GES spine.
--
-- The `NOT EXISTS (… grantee = 0 …)` predicate keeps this source DISJOINT from `public_execute`:
-- while a routine still grants EXECUTE to PUBLIC, that one fact is reported ONCE (as PUBLIC) rather
-- than four times (PUBLIC plus each built-in that inherits it). Remediate the PUBLIC row, re-run,
-- and any surviving direct grant appears here — the report converges rather than double-counting.
builtin_execute AS (
  SELECT 'FINDING'::text                  AS severity,
         pg_get_userbyid(p.proowner)::text AS grantor,
         'ROUTINE EXECUTE'::text          AS objtype,
         b.rolname::text                  AS grantee,
         format('REVOKE EXECUTE ON ROUTINE %s FROM %I;', p.oid::regprocedure, b.rolname)::text
                                          AS remediation_statement
    FROM builtins b
    JOIN pg_roles ro ON ro.rolname = b.rolname
    CROSS JOIN pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
     AND has_function_privilege(b.rolname::name, p.oid, 'EXECUTE')
),
-- §3 · the decay the header's FIRST bullet warns about, made visible. §3's blanket grant is
-- point-in-time; a table created by a migration after the last paste is readable by NOBODY, which is
-- an outage rather than a leak — but it is also the proof that this file has not been re-run.
-- `audit_officer_provisioning` is EXCLUDED BY NAME because §3 deliberately revokes everything on it
-- (the ordering trap V2 asserts); it is the one table the app role is supposed to be unable to read.
app_missing_select AS (
  SELECT 'ADVISORY'::text            AS severity,
         pg_get_userbyid(c.relowner)::text AS grantor,
         'TABLE NOT GRANTED'::text   AS objtype,
         'oversight_app'::text       AS grantee,
         format('GRANT SELECT ON public.%I TO oversight_app; -- or just re-run §3 of this file, which is what the header means by "re-run after every migration that CREATES A TABLE"', c.relname)::text
                                     AS remediation_statement
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND c.relname <> 'audit_officer_provisioning'
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oversight_app')
     AND NOT has_table_privilege('oversight_app', c.oid, 'SELECT')
)
SELECT severity, grantor, objtype, grantee, remediation_statement
  FROM (
    SELECT * FROM default_acl
    UNION ALL SELECT * FROM public_execute
    UNION ALL SELECT * FROM missing_0005
    UNION ALL SELECT * FROM rls_off
    UNION ALL SELECT * FROM builtin_residual
    UNION ALL SELECT * FROM builtin_sequence
    UNION ALL SELECT * FROM builtin_execute
    UNION ALL SELECT * FROM app_missing_select
  ) residual
 ORDER BY CASE severity WHEN 'FINDING' THEN 1 WHEN 'ADVISORY' THEN 2 ELSE 3 END,
          objtype, grantee, grantor, remediation_statement;
