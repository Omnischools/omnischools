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
-- =============================================================================

-- ---- helper functions -------------------------------------------------------

create or replace function ov_current_jurisdiction() returns uuid
  language sql stable as $$
    select nullif(current_setting('app.current_jurisdiction', true), '')::uuid
  $$;

create or replace function ov_current_officer() returns uuid
  language sql stable as $$
    select nullif(current_setting('app.current_officer', true), '')::uuid
  $$;

create or replace function ov_is_national() returns boolean
  language sql stable as $$
    select coalesce(current_setting('app.current_level', true), '') = 'NATIONAL'
  $$;

-- True when :jid is the current node or any DESCENDANT of it. Walks parent_id upward from :jid;
-- if the current node appears in that ancestor chain (or equals :jid), the row is in scope.
-- National short-circuits to true (no filter).
create or replace function ov_in_subtree(jid uuid) returns boolean
  language sql stable as $$
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

-- dim_period / dim_stage / dim_subject are non-sensitive shared vocabularies: left readable
-- (no RLS) so period banners and stage/subject grids resolve for every tier.

-- ---- fact_* : one predicate, joined through jurisdiction_id -----------------
do $$
declare t text;
begin
  foreach t in array array[
    'fact_enrolment','fact_attendance','fact_performance_exam','fact_performance_subject',
    'fact_performance_internal','fact_staffing','fact_fees','fact_anomaly'
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
alter table audit_access_log enable row level security;
drop policy if exists audit_scope on audit_access_log;
create policy audit_scope on audit_access_log
  for select using ( officer_id = ov_current_officer() or ov_in_subtree(jurisdiction_id) );
drop policy if exists audit_insert on audit_access_log;
create policy audit_insert on audit_access_log
  for insert with check ( officer_id = ov_current_officer() );

-- Append-only: reject UPDATE/DELETE on existing rows. A review only ever INSERTs a linked row.
create or replace function ov_audit_append_only() returns trigger
  language plpgsql as $$
  begin
    raise exception 'audit_access_log is append-only (% rejected)', tg_op;
  end $$;
drop trigger if exists audit_append_only on audit_access_log;
create trigger audit_append_only
  before update or delete on audit_access_log
  for each row execute function ov_audit_append_only();
