-- =============================================================================
-- Omnischools Oversight — analytics DB Row-Level Security (OVERSIGHT_ANALYTICS_SPEC §8, §6)
-- Applied by `pnpm db:policies` (scripts/apply-policies.ts) after migrations.
--
-- One predicate, expressed once against dim_jurisdiction. Per request the app sets:
--   app.current_jurisdiction  uuid   — the GES user's node
--   app.current_level         text   — SCHOOL | DISTRICT | REGION | NATIONAL
--   app.current_officer       uuid   — the acting officer (audit_access_log own-rows rule)
--
-- National (MoE) sees everything; every other tier sees the subtree rooted at its node.
--
-- NO FOURTH GUC. Officer auth (increment G, at the foot of this file) resolves the session from the
-- Supabase auth uid through `ov_resolve_officer(uid)` — a function ARGUMENT, not a GUC — precisely so
-- that `withJurisdiction()` in lib/db/rls.ts remains the only code that writes request GUCs.
--
-- IMPORTANT: the Oversight app MUST connect as a NON-OWNER role. A table owner bypasses RLS
-- unless the table is FORCEd; the nightly ETL loader (a privileged role) is meant to bypass so it
-- can write, while the read-only app role is subject to every policy below.
--
-- ⚠ THIS FILE IS LOCAL DEV ONLY (`pnpm db:policies` is not part of any prod deploy). The helper
-- function definitions below were changed after go-live and must be re-pasted on the LIVE analytics
-- DB by hand — see db/sql/prod-paste-0002-rls-security-fix.sql and docs/PROVISIONING.md §2a.
-- =============================================================================

-- ---- helper functions -------------------------------------------------------
--
-- EVERY helper below pins `set search_path = public, pg_temp` with **pg_temp LAST**. This is not
-- cosmetic. Postgres searches the temporary schema for RELATION names FIRST — before every schema
-- in search_path — unless pg_temp is listed explicitly, in which case it is searched at the
-- position given. Leaving it implicit lets any caller who can open a SQL channel as the app role
-- run `create temp table dim_jurisdiction (...)` and have these functions read THAT table instead
-- of the real spine (CVE-2018-1058, "pg_temp hijack"). Naming it last makes `public` win, so the
-- temp schema can never shadow a real relation. Do not drop the `, pg_temp` — and do not move it to
-- the front.

create or replace function ov_current_jurisdiction() returns uuid
  language sql stable
  set search_path = public, pg_temp as $$
    select nullif(current_setting('app.current_jurisdiction', true), '')::uuid
  $$;

create or replace function ov_current_officer() returns uuid
  language sql stable
  set search_path = public, pg_temp as $$
    select nullif(current_setting('app.current_officer', true), '')::uuid
  $$;

create or replace function ov_is_national() returns boolean
  language sql stable
  set search_path = public, pg_temp as $$
    select coalesce(current_setting('app.current_level', true), '') = 'NATIONAL'
  $$;

-- True when :jid is the current node or any DESCENDANT of it. Walks parent_id upward from :jid;
-- if the current node appears in that ancestor chain (or equals :jid), the row is in scope.
-- National short-circuits to true (no filter).
--
-- SECURITY DEFINER is LOAD-BEARING, not an optimisation. This function is the USING predicate of
-- dim_jurisdiction's own `jurisdiction_scope` policy, and its body reads dim_jurisdiction. Called
-- by a NON-OWNER role (which is how the app connects — see the header note), that inner read is
-- itself subject to jurisdiction_scope, which calls this function again, which reads
-- dim_jurisdiction again... => `ERROR: stack depth limit exceeded` on EVERY jurisdiction-scoped
-- read as soon as the spine has rows. (The owner/ETL role never saw it: an owner is exempt from RLS,
-- so the inner read is unfiltered and the recursion never starts. NATIONAL never saw it either: it
-- short-circuits before touching the table.) Running the ancestor walk as the function OWNER makes
-- the inner read RLS-exempt, which terminates the recursion. It does NOT widen what the caller can
-- see: the function returns only a boolean, and the outer policy still filters every row.
--
-- Because it is SECURITY DEFINER, the `, pg_temp` pin above is upgraded from hygiene to a hard
-- boundary: without it, a planted temp `dim_jurisdiction` would be read WITH OWNER PRIVILEGES —
-- full RLS bypass plus privilege escalation. The two changes must stay together.
--
-- Corollary for future work: do NOT put dim_jurisdiction into `force row level security`. FORCE
-- applies RLS to the owner too, which would reintroduce the recursion through this definer body.
create or replace function ov_in_subtree(jid uuid) returns boolean
  language sql stable
  security definer
  set search_path = public, pg_temp as $$
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

-- ---- dim_jurisdiction (the spine) ------------------------------------------
alter table dim_jurisdiction enable row level security;
drop policy if exists jurisdiction_scope on dim_jurisdiction;
create policy jurisdiction_scope on dim_jurisdiction
  for select using ( ov_in_subtree(jurisdiction_id) );

-- Non-sensitive shared vocabulary / config tables (dim_period, dim_stage, dim_subject,
-- ref_anomaly_rule, ref_assessment_weights) and etl_run carry no jurisdiction and no school data.
-- They still get RLS ENABLED with a read-all policy: on Supabase a public table without RLS is
-- exposed to the anon role via PostgREST, so "no RLS" is not "no exposure". `using (true)` keeps
-- them readable to every tier (and to the app's direct-Postgres role) while satisfying the linter.
do $$
declare t text;
begin
  foreach t in array array[
    'dim_period','dim_stage','dim_subject','ref_anomaly_rule','ref_assessment_weights','etl_run'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists read_all on %I;', t);
    execute format('create policy read_all on %I for select using ( true );', t);
  end loop;
end $$;

-- ---- fact_* : one predicate, joined through jurisdiction_id -----------------
do $$
declare t text;
begin
  foreach t in array array[
    'fact_enrolment','fact_attendance','fact_performance_exam','fact_performance_subject',
    'fact_performance_internal','fact_staffing','fact_fees','fact_anomaly',
    -- Additive fact domains (migration 0001). ⚠ On PROD these three are applied BY HAND via
    -- db/sql/prod-paste-0001-fact-domains.sql — this loop only configures LOCAL DEV.
    'fact_teacher_attendance','fact_infrastructure','fact_plc_participation'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists jurisdiction_scope on %I;', t);
    execute format(
      'create policy jurisdiction_scope on %I for select using ( ov_in_subtree(jurisdiction_id) );', t);
  end loop;
end $$;

-- fact_anomaly additionally accepts app WRITES to triage (status / cluster_id only). The write is
-- gated to the user's subtree; column-level restriction to status/cluster_id is enforced in the app.
drop policy if exists anomaly_triage_write on fact_anomaly;
create policy anomaly_triage_write on fact_anomaly
  for update using ( ov_in_subtree(jurisdiction_id) )
  with check ( ov_in_subtree(jurisdiction_id) );

-- ---- ref_* : scope where a jurisdiction column exists ----------------------
alter table ref_emis_school_register enable row level security;
drop policy if exists jurisdiction_scope on ref_emis_school_register;
create policy jurisdiction_scope on ref_emis_school_register
  for select using ( ov_in_subtree(district_id) );

alter table ref_gss_population enable row level security;
drop policy if exists jurisdiction_scope on ref_gss_population;
create policy jurisdiction_scope on ref_gss_population
  for select using ( ov_in_subtree(district_id) );

-- (No ref_ges_data_sharing_agreements: GES/MoE are statutory regulators, so there is no per-school
-- consent to gate on — every registered school is in scope by law.)

-- WAEC + establishment extracts are keyed by emis_school_id (not a dim uuid): scope via the register.
alter table ref_waec_results_extract enable row level security;
drop policy if exists jurisdiction_scope on ref_waec_results_extract;
create policy jurisdiction_scope on ref_waec_results_extract
  for select using ( exists (
    select 1 from ref_emis_school_register r
    where r.emis_school_id = ref_waec_results_extract.emis_school_id
      and ov_in_subtree(r.district_id)
  ) );

alter table ref_ges_teacher_establishment enable row level security;
drop policy if exists jurisdiction_scope on ref_ges_teacher_establishment;
create policy jurisdiction_scope on ref_ges_teacher_establishment
  for select using ( exists (
    select 1 from ref_emis_school_register r
    where r.emis_school_id = ref_ges_teacher_establishment.emis_school_id
      and ov_in_subtree(r.district_id)
  ) );

-- ref_anomaly_rule / ref_assessment_weights are global config: left readable (no RLS).

-- ---- audit_access_log : own rows + subtree, and APPEND-ONLY (§6) -----------
--
-- Migration 0002 added four columns (legal_basis, consent_ref, outcome, staff_category) for the
-- individual drill-down. NOTHING BELOW CHANGES, and there is no prod-paste for that migration: a
-- policy declared without a column list applies to every column of the table, present and future,
-- so the two policies and the trigger cover the new columns automatically.
--
-- Two properties worth stating explicitly, because the drill-down depends on them:
--   · DENIALS ARE INSERTS. A refused access writes a row with outcome = DENIED_* and
--     fields_released = []. audit_insert admits it on the same terms as a grant
--     (officer_id = ov_current_officer()), so the gate cannot be made quieter by failing.
--   · consent_ref IS FROZEN. The append-only trigger means a later revocation of the referenced
--     operational consent can never rewrite this row. That is correct: the log records the basis
--     relied on AT THE TIME, not the basis that is live now.
alter table audit_access_log enable row level security;
drop policy if exists audit_scope on audit_access_log;
create policy audit_scope on audit_access_log
  for select using ( officer_id = ov_current_officer() or ov_in_subtree(jurisdiction_id) );
--   · THE INSERT PREDICATE IS TWO CONDITIONS, NOT ONE (added 0003). `officer_id =
--     ov_current_officer()` alone says "you may not write a row in someone else's name" — it says
--     nothing about WHOSE SCHOOL the row is about. A district director could log (and therefore
--     perform) an access against a school in another region, in their own name, and the database
--     would accept it. Adding `ov_in_subtree(jurisdiction_id)` makes the jurisdiction ceiling a
--     property of the DATABASE rather than of the application: because the gate writes the audit
--     row BEFORE it fetches anything (§6 step 2), a row the database refuses is an access that
--     cannot happen. That is the backstop behind lib/oversight/named-record-access.ts's own check,
--     and it holds against a future caller that forgets to make one.
--
--     Note what this does NOT block: an in-subtree DENIAL. A no-consent / stale-establishment /
--     flag-off refusal carries the TARGET SCHOOL's jurisdiction_id, which is inside the officer's
--     subtree, so denial rows still insert cleanly — as they must, or the gate would fail closed by
--     becoming unable to record that it fired.
--
--     NULL jurisdiction_id: ov_in_subtree(null) is false below NATIONAL, so a row that names no
--     jurisdiction is rejected for every tier except national. That is intended — an access nobody
--     can scope is an access nobody can review.
drop policy if exists audit_insert on audit_access_log;
create policy audit_insert on audit_access_log
  for insert with check (
    officer_id = ov_current_officer() and ov_in_subtree(jurisdiction_id)
  );

-- Append-only: reject UPDATE/DELETE on existing rows. A review only ever INSERTs a linked row.
--
-- ⚠ THE TRIGGER IS NOT THE WHOLE GUARD — the GRANT is. Verified on a replay DB (PG 16):
--   · owner / BYPASSRLS ETL role  → the trigger fires: `audit_access_log is append-only (UPDATE
--     rejected)`. Loud, which is what you want for the one role that can see every row.
--   · app role with SELECT+INSERT only (the posture PROVISIONING §1 requires) → `ERROR: permission
--     denied for table audit_access_log`. Also loud. This is the intended production path.
--   · app role that has ALSO been granted UPDATE/DELETE → `UPDATE 0` / `DELETE 0`. The rows are
--     untouched (there is no FOR UPDATE / FOR DELETE policy, so RLS makes zero rows visible to
--     those commands), but the caller is told the statement SUCCEEDED and the trigger never runs.
--     Data integrity holds; the ERROR does not. A silent no-op is the wrong signal for a tamper
--     attempt on an audit table.
-- So: grant the Oversight app role exactly SELECT and INSERT on audit_access_log, and nothing else.
-- RLS cannot be made to raise here — only the absent grant can.
create or replace function ov_audit_append_only() returns trigger
  language plpgsql
  set search_path = public, pg_temp as $$
  begin
    raise exception 'audit_access_log is append-only (% rejected)', tg_op;
  end $$;
drop trigger if exists audit_append_only on audit_access_log;
create trigger audit_append_only
  before update or delete on audit_access_log
  for each row execute function ov_audit_append_only();

-- =============================================================================
-- OFFICER AUTH (increment G, migration 0004) — ref_oversight_officer + audit_officer_provisioning
--
-- ⚠ PROD: these objects are NOT installed by any deploy. Paste
-- db/sql/prod-paste-0005-officer-directory.sql by hand after migration 0004 (PROVISIONING §2a).
-- Unlike a fact table, a missed paste here does not show as an empty panel: NO OFFICER CAN SIGN IN,
-- because ov_resolve_officer() — the only read path into the directory — will not exist.
--
-- ── THE BOOTSTRAP-RESOLUTION PROBLEM ────────────────────────────────────────────────────────────
-- Every other read in this app runs with `app.current_jurisdiction` set. This one cannot: it is the
-- read that PRODUCES the jurisdiction. So the usual predicate is unavailable, and the obvious
-- stand-in — `create policy ... using (true)` on the directory so the app can look itself up — would
-- hand anyone holding the app credential (a leaked connection string, an SQL-injection foothold, a
-- compromised server action) `select * from ref_oversight_officer`: the complete roster of GES
-- oversight officers with tier, node and work email. That is a named-target list for whoever wants
-- to phish their way to NATIONAL access. The resolution path must be incapable of returning a row
-- the caller did not already name.
--
-- CHOSEN: (a) a SECURITY DEFINER function keyed on the uid, with NO select policy on the table at
-- all. Not (b) an `app.current_auth_user` GUC + `using (auth_user_id = ov_current_auth_user())`.
-- Both deny enumeration, so the decision was made on two other grounds:
--
--   1. ⭐ (b) CANNOT DERIVE THE TIER, which makes it not merely weaker but unable to do the job.
--      `level` is deliberately NOT stored on the directory (Kofi R2/AC10 — see db/schema/officer.ts),
--      so the tier must come from a join to dim_jurisdiction. dim_jurisdiction is itself RLS-scoped
--      by `ov_in_subtree()`, which reads `app.current_jurisdiction` — the value this read exists to
--      find. Under a policy-based bootstrap the join therefore returns ZERO rows and the officer has
--      no tier. The only ways out are to store `level` on the directory (a second, writable source
--      of truth for how much of Ghana someone can read — the exact silent-escalation footgun R2
--      forbids) or to widen dim_jurisdiction's own policy (worse). A SECURITY DEFINER body is
--      RLS-exempt, so it can read the spine with no GUC set: it resolves the officer AND derives the
--      tier in one statement that no caller can decompose.
--   2. It adds no second GUC. `lib/db/rls.ts` (`withJurisdiction`) is the single chokepoint that
--      writes request GUCs from trusted server state. A bootstrap GUC would necessarily be set
--      outside it — before any jurisdiction is known — creating a second, differently-shaped
--      GUC-writing path whose input is the uid from the request's own JWT. A function ARGUMENT
--      carries the same uid with no ambient session state to leak into a later statement in the same
--      transaction, and no second place to remember to clear.
--
-- The cost is one more SECURITY DEFINER surface, which is why the pin below and the `revoke ... from
-- public` are not optional.
-- =============================================================================

-- ov_resolve_officer — THE bootstrap read. ≤1 row, for the uid the caller names, and nothing else.
--
-- Shape properties, each load-bearing:
--   · `where o.officer_id = uid` + `limit 1`: it cannot return a row the caller did not name, and
--     cannot return two. There is no parameterless, no wildcard and no range form of this function —
--     the table has NO select policy, so there is no other read path to fall back to. "No
--     enumeration" is therefore a property of the available QUERY SURFACE, not of a filter someone
--     could later widen.
--   · `uid is not null`: a null uid (unauthenticated, or a JWT with no sub) returns zero rows rather
--     than relying on `= null` evaluating to NULL. Fail closed, explicitly.
--   · `and o.is_active`: deactivation takes effect in the DATABASE. A deactivated officer resolves
--     to ZERO rows — indistinguishable from an unprovisioned uid, so the app cannot forget to check
--     a flag, and the function is not an account-state oracle either.
--   · `j.level <> 'SCHOOL'`: Kofi R1 restated on the READ side. The write trigger below already
--     refuses a SCHOOL node, but if one were ever planted by a privileged hand (or the trigger were
--     disabled for a bulk load) this still refuses to build a session from it.
--   · INNER JOIN: an officer whose node has vanished gets no session, rather than a session with a
--     null tier.
--   · It returns NO PII — no full_name, no work_email. The session's display name comes from the
--     Supabase JWT (the officer's own identity). Those two columns are reachable only by the
--     owner/provisioner connection, so the app credential cannot read them by any path at all.
--
-- `security definer` + `set search_path = public, pg_temp` (PG_TEMP LAST) for exactly the reasons in
-- this file's header: definer means a planted `create temp table ref_oversight_officer` would
-- otherwise be read WITH OWNER PRIVILEGES, turning the bootstrap into an authority-forgery
-- primitive — plant a temp directory row, become NATIONAL. The two changes stay together.
--
-- RESIDUAL, STATED PLAINLY. Anyone who can execute this function can CONFIRM a uid they already
-- hold — pass it, learn that officer's node, tier and post. That is the same confirm-not-enumerate
-- shape PROVISIONING §4a blesses for `ref_school` and `ref_user` on the operational side, and it is
-- irreducible: the function's whole job is to answer that question about the caller's own uid, and it
-- cannot tell "my uid" from "a uid I obtained" without trusting a claim the caller also supplies.
-- What matters is the gap between confirming and enumerating: officer uids are not derivable from
-- the directory (no policy), not readable from the provisioning log (no grant to the app role), and
-- a uuid is not guessable. One place they ARE visible is `audit_access_log.officer_id` for rows
-- inside one's own subtree — so an officer can confirm the tier of a colleague whose access they can
-- already see logged. Acceptable, and worth knowing before someone adds a wider read path and
-- assumes uids are secret.
create or replace function ov_resolve_officer(uid uuid)
  returns table (
    officer_id uuid,
    jurisdiction_id uuid,
    level jurisdiction_level,
    officer_role ov_officer_role
  )
  language sql stable
  security definer
  set search_path = public, pg_temp as $$
    select o.officer_id, o.jurisdiction_id, j.level, o.officer_role
      from ref_oversight_officer o
      join dim_jurisdiction j on j.jurisdiction_id = o.jurisdiction_id
     where uid is not null
       and o.officer_id = uid
       and o.is_active
       and j.level <> 'SCHOOL'
     limit 1
  $$;

-- A SECURITY DEFINER function is EXECUTE-able by PUBLIC by default. On Supabase that includes `anon`
-- and `authenticated`, both of which can call a public-schema function as an RPC over PostgREST — so
-- left as-is this would be an unauthenticated "resolve any uid I can guess or harvest" endpoint.
-- Revoke, then grant to the app role by name (done by the test harness / the prod paste).
revoke all on function ov_resolve_officer(uuid) from public;

-- ---- write-side guards on the directory -------------------------------------
--
-- ov_officer_node_tier — the node's tier, or a LOUD REFUSAL. Used by both write triggers below so
-- "what tier is this node, and is it even eligible" is answered in one place.
--
-- `security definer` BECAUSE THE WRITER IS A NON-OWNER ROLE. The provisioner is a separate login
-- role (not the owner — that separation is the point: the credential the web app runs under must not
-- be able to grant authority, and neither should provisioning require full ownership). A non-owner's
-- lookup here is subject to dim_jurisdiction's own `jurisdiction_scope` policy, which needs
-- `app.current_jurisdiction` — a GUC that means nothing during provisioning. Without definer the
-- lookup returns no row and the `not present` raise below refuses EVERY provisioning write: the
-- guard would fail closed against the legitimate writer, which is the surest way to get a guard
-- deleted. Running the lookup as the function owner makes it work for any writer, so the only writes
-- it refuses are the ones it is meant to.
--
-- The alternative — having the provisioner set `app.current_level = 'NATIONAL'` around its
-- transaction — was rejected: it makes a correctness-critical guard depend on the caller first
-- granting itself national scope, which is precisely the habit this table exists to prevent.
--
-- Residual: whoever may execute this can learn the TIER of a node uuid they already hold (and that a
-- SCHOOL/unknown node is one). The jurisdiction spine is public administrative geography and the
-- function returns nothing else, so this is negligible — but it is revoked from PUBLIC below anyway,
-- because a SECURITY DEFINER function left EXECUTE-able by PUBLIC is callable by Supabase `anon`
-- over PostgREST.
create or replace function ov_officer_node_tier(jid uuid) returns jurisdiction_level
  language plpgsql stable
  security definer
  set search_path = public, pg_temp as $$
  declare node_level jurisdiction_level;
  begin
    select j.level into node_level from dim_jurisdiction j where j.jurisdiction_id = jid;
    if node_level is null then
      raise exception 'oversight officer node % is not present (or not visible) in dim_jurisdiction', jid;
    end if;
    -- Kofi R1: NO SCHOOL-TIER OVERSIGHT OFFICER. A head teacher is an operational user of apps/web,
    -- not a GES supervisor of their own school; one credential must not both run a school and
    -- oversee it. Enforced as a TRIGGER rather than a CHECK because the disqualifying fact
    -- (`dim_jurisdiction.level`) lives in another table, which no CHECK may read. SCHOOL remains a
    -- fully valid jurisdiction_level everywhere else in the engine — the spine, the subtree walk and
    -- every fact table still key on school nodes.
    if node_level = 'SCHOOL' then
      raise exception 'no SCHOOL-tier oversight officer: jurisdiction % is a SCHOOL node (Kofi R1)', jid;
    end if;
    return node_level;
  end $$;

revoke all on function ov_officer_node_tier(uuid) from public;

-- Directory guard: the node must be eligible, and officer_role must agree with the node's DERIVED
-- tier. The role column is descriptive of the post; the NODE is what actually grants reach, so a row
-- claiming REGIONAL_OVERSIGHT on a district node is a contradiction that must not be storable — if
-- it were, a UI that reads the role and a policy that reads the node would disagree about the same
-- officer, and only one of them would be enforcing anything.
create or replace function ov_officer_directory_guard() returns trigger
  language plpgsql
  set search_path = public, pg_temp as $$
  declare
    node_level jurisdiction_level;
    expected ov_officer_role;
  begin
    node_level := ov_officer_node_tier(new.jurisdiction_id);
    expected := (case node_level
                   when 'DISTRICT' then 'DISTRICT_OVERSIGHT'
                   when 'REGION'   then 'REGIONAL_OVERSIGHT'
                   when 'NATIONAL' then 'NATIONAL_OVERSIGHT'
                 end)::ov_officer_role;
    if new.officer_role <> expected then
      raise exception 'officer_role % contradicts the % tier of jurisdiction % (expected %)',
        new.officer_role, node_level, new.jurisdiction_id, expected;
    end if;
    return new;
  end $$;

drop trigger if exists officer_directory_guard on ref_oversight_officer;
create trigger officer_directory_guard
  before insert or update on ref_oversight_officer
  for each row execute function ov_officer_directory_guard();

-- ---- ref_oversight_officer RLS: NOTHING THE APP ROLE CAN REACH -------------
--
-- The directory carries NO policy that the Oversight app role can match. RLS-enabled-with-no-
-- applicable-policy means it reads ZERO rows by any direct query — `select *`, a count, a join, a
-- subquery inside someone else's predicate — while ov_resolve_officer() above (owner-privileged)
-- serves the one legitimate read. That absence is the design, not an omission.
--
-- The only policies on this table are ROLE-TARGETED AT THE PROVISIONER (installed in the DO block
-- further down, if that role exists). A policy with a `to` clause is invisible to every other role,
-- so it widens nothing for the app credential — Postgres only considers policies whose role list
-- includes the current role.
--
-- If an app-reachable self-read is ever genuinely needed (an account page), the safe form is
-- `for select using ( officer_id = ov_current_officer() )` — confirm-not-enumerate, keyed on a GUC
-- that withJurisdiction only ever sets from an ALREADY-RESOLVED session. Never `using (true)`
-- without a `to` clause.
--
-- ⚠ AND THE REAL GUARD IS THE ABSENT GRANT. The app role gets SELECT on this table and NOTHING
-- ELSE — no INSERT, no UPDATE, no DELETE, ever. That is what makes self-promotion impossible: with
-- no UPDATE grant, `update ref_oversight_officer set officer_role='NATIONAL_OVERSIGHT', jurisdiction_id=<national>
-- where officer_id = <me>` fails with `permission denied for table ref_oversight_officer` before any
-- policy or trigger is consulted. A policy could be mis-edited into permitting it; a grant that was
-- never issued cannot. See the same argument above the append-only trigger on audit_access_log.
alter table ref_oversight_officer enable row level security;
drop policy if exists officer_self on ref_oversight_officer;
drop policy if exists read_all on ref_oversight_officer;

-- ---- audit_officer_provisioning: append-only, provisioner-only -------------
--
-- Tier guard. The two-person CHECK (`ck_officer_provisioning_two_person`) keys on `target_tier`,
-- which the WRITER supplies — so on its own it is forgeable: record a NATIONAL grant as
-- `target_tier = 'DISTRICT'` and the approver requirement disappears. This trigger derives the tier
-- from the node and refuses any mismatch, which is what makes the recorded tier (and therefore the
-- two-person rule) unforgeable. Keep both: the CHECK states the rule declaratively, the trigger
-- makes its input honest.
create or replace function ov_officer_provisioning_tier_guard() returns trigger
  language plpgsql
  set search_path = public, pg_temp as $$
  declare node_level jurisdiction_level;
  begin
    node_level := ov_officer_node_tier(new.target_jurisdiction_id);
    if new.target_tier <> node_level then
      raise exception
        'target_tier % does not match dim_jurisdiction.level % of node % — the two-person rule keys on target_tier and must not be forgeable',
        new.target_tier, node_level, new.target_jurisdiction_id;
    end if;
    return new;
  end $$;

drop trigger if exists officer_provisioning_tier_guard on audit_officer_provisioning;
create trigger officer_provisioning_tier_guard
  before insert on audit_officer_provisioning
  for each row execute function ov_officer_provisioning_tier_guard();

-- Append-only, mirroring ov_audit_append_only on audit_access_log — and with the same caveat: the
-- trigger is the LOUD half, the absent UPDATE/DELETE grant is the real guard. A role that has been
-- granted UPDATE but matches no policy gets a silent `UPDATE 0`; a role with no grant at all gets
-- `permission denied`. Grant the provisioner SELECT + INSERT here, never UPDATE or DELETE. A
-- correction is a new row (REACTIVATE, ROLE_CHANGE), exactly as a review is a new audit row.
create or replace function ov_officer_provisioning_append_only() returns trigger
  language plpgsql
  set search_path = public, pg_temp as $$
  begin
    raise exception 'audit_officer_provisioning is append-only (% rejected)', tg_op;
  end $$;

drop trigger if exists officer_provisioning_append_only on audit_officer_provisioning;
create trigger officer_provisioning_append_only
  before update or delete on audit_officer_provisioning
  for each row execute function ov_officer_provisioning_append_only();

alter table audit_officer_provisioning enable row level security;

-- Read posture: the Omnischools PROVISIONER role context, and nobody else. A GES officer must not
-- read this table at all — not their own row, not their district's. Who granted whom national access
-- is Omnischools' internal control record, and an officer who could read it would have the officer
-- roster the directory's whole design exists to withhold.
--
-- This policy IS `using (true)`, which the directory above refuses — the difference is the `to`
-- clause. A `using (true)` policy restricted `to ov_provisioner` authorises by ROLE: it is
-- unreachable from the app credential, which is not and must never be a member of that role. The
-- directory's case was the opposite — a policy reachable BY the app credential, where `true` would
-- have been the authorisation.
--
-- If no provisioner role exists (a plain dev box), NO policy is created and both tables stay
-- owner-only. That is the fail-closed default and needs no repair.
--
-- ⚠ WHY THE PROVISIONER NEEDS WRITE POLICIES AT ALL, AND NOT JUST GRANTS. Verified on a replay DB:
-- with RLS enabled and no applicable policy, a non-owner role holding `INSERT` still fails with
-- `new row violates row-level security policy for table "ref_oversight_officer"`. RLS blocks writes
-- as well as reads. So a provisioner that is NOT the owner needs explicit, role-targeted write
-- policies or provisioning is simply impossible. Giving it the OWNER credential instead would
-- "work", and is the wrong trade: the whole design is that granting oversight authority is a narrow,
-- separately-held capability, which an owner login is the opposite of.
--
-- Note what is NOT created below: no DELETE policy on either table, and no UPDATE policy on
-- audit_officer_provisioning. Those omissions sit behind the matching absent grants, so a tamper
-- attempt is refused twice — and if someone later issues the grant "for symmetry", the missing
-- policy still refuses (silently, as `UPDATE 0` — which is why the grant must stay absent too; see
-- the audit_access_log note above).
do $$
declare roles text[];
begin
  select coalesce(array_agg(quote_ident(rolname)), '{}')
    into roles
    from pg_roles
   where rolname in ('ov_provisioner', 'oversight_provisioner');

  execute 'drop policy if exists provisioning_audit_read on audit_officer_provisioning';
  execute 'drop policy if exists provisioning_audit_append on audit_officer_provisioning';
  execute 'drop policy if exists officer_directory_provisioner_read on ref_oversight_officer';
  execute 'drop policy if exists officer_directory_provisioner_insert on ref_oversight_officer';
  execute 'drop policy if exists officer_directory_provisioner_update on ref_oversight_officer';

  if array_length(roles, 1) is null then
    raise notice 'no provisioner role found — ref_oversight_officer and audit_officer_provisioning left with no policy (owner-only). Fail-closed default.';
  else
    -- The provisioning log: readable and APPENDABLE by the provisioner, by nobody else.
    execute format(
      'create policy provisioning_audit_read on audit_officer_provisioning for select to %s using ( true )',
      array_to_string(roles, ', '));
    execute format(
      'create policy provisioning_audit_append on audit_officer_provisioning for insert to %s with check ( true )',
      array_to_string(roles, ', '));
    -- The directory: the provisioner maintains it. SELECT + INSERT + UPDATE, never DELETE
    -- (offboarding is is_active = false; a deleted row orphans every audit entry naming that uid).
    -- Each write still passes ov_officer_directory_guard() — the policies say WHO may write, the
    -- trigger says WHAT is a coherent row, and neither substitutes for the other.
    execute format(
      'create policy officer_directory_provisioner_read on ref_oversight_officer for select to %s using ( true )',
      array_to_string(roles, ', '));
    execute format(
      'create policy officer_directory_provisioner_insert on ref_oversight_officer for insert to %s with check ( true )',
      array_to_string(roles, ', '));
    execute format(
      'create policy officer_directory_provisioner_update on ref_oversight_officer for update to %s using ( true ) with check ( true )',
      array_to_string(roles, ', '));
  end if;
end $$;

-- Belt-and-braces for local dev: make the app role's floor the MISSING GRANT rather than the
-- policy. `grant select on all tables in schema public` (the shape used by the dev/test harness and
-- easy to repeat on prod) would otherwise hand the app credential SELECT on the provisioning log.
-- Policy-wise that yields zero rows, but the durable statement is that the grant does not exist.
do $$
declare r text;
begin
  foreach r in array array['ov_app', 'oversight_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on audit_officer_provisioning from %I', r);
      -- SELECT stays (the directory is unreadable by policy anyway); writes must never be granted.
      execute format('revoke insert, update, delete on ref_oversight_officer from %I', r);
    end if;
  end loop;
end $$;
