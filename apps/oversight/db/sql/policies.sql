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
drop policy if exists audit_insert on audit_access_log;
create policy audit_insert on audit_access_log
  for insert with check ( officer_id = ov_current_officer() );

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
