-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- FIXTURE OPERATIONAL SCHEMA for the Oversight read-back tests.
--
-- This is a faithful, minimal stand-in for the parts of apps/web's operational Postgres that the
-- §6 gate reads. It is NOT a second source of truth: every column below is copied from
-- apps/web/db/schema/*.ts, and `school_staff_oversight_consent` is built to the contract in
-- apps/web/Todo.md (that table does not exist in this repo yet — the capture surface is another
-- session's work, and the whole point of the drill-down increment is that it fails closed until it
-- lands). If the two ever disagree, apps/web wins and this file is the bug.
--
-- Two things are modelled deliberately rather than conveniently:
--   · TENANT RLS keyed on `app.current_school`, exactly as apps/web/db/sql/policies.sql does, so
--     `withReadbackSchool()`'s GUC is genuinely load-bearing in the tests rather than decorative.
--   · `staff_compensation` EXISTS and is POPULATED, and the read-back role is granted NOTHING on
--     it. A test that only proved "we did not select the salary column" would pass against a schema
--     with no salary in it. The row has to be there, and reachable by someone, for the refusal to
--     mean anything.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

create table ref_school (
  id             uuid primary key,
  name           text not null,
  ges_code       text not null unique,
  ownership_type text not null default 'PRIVATE'
);

create table ref_user (
  id        uuid primary key,
  phone     text not null unique,
  email     text,
  full_name text
);

create table ref_role (
  id    uuid primary key,
  code  text not null unique,
  label text not null
);

create table role_assignment (
  id         uuid primary key,
  user_id    uuid not null references ref_user(id) on delete cascade,
  school_id  uuid not null references ref_school(id) on delete cascade,
  role_id    uuid not null references ref_role(id),
  scope_ref  uuid,
  start_date date not null default current_date,
  end_date   date
);

create table staff_profile (
  id                    uuid primary key,
  school_id             uuid not null references ref_school(id) on delete cascade,
  user_id               uuid not null references ref_user(id) on delete cascade,
  date_of_birth         date,
  gender                text,
  address               text,
  emergency_contact     text,
  qualification_level   text,
  highest_qualification text,
  undergraduate         text,
  ntc_licence_number    text,
  ntc_licence_expiry    date,
  nmc_licence_number    text,
  nmc_licence_expiry    date,
  specialisations       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint uniq_staff_profile_per_school unique (school_id, user_id)
);

-- NEVER READABLE BY THE READ-BACK ROLE. Present and populated on purpose — see the header.
create table staff_compensation (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references ref_school(id) on delete cascade,
  user_id         uuid not null references ref_user(id) on delete cascade,
  salary_status   text not null default 'SCHOOL_PAID',
  monthly_amount  numeric(12,2) not null default 0,
  pay_method      text not null default 'BANK',
  pay_cadence     text not null default 'MONTHLY',
  ssnit_deduction numeric(12,2) not null default 0,
  paye_deduction  numeric(12,2) not null default 0,
  effective_from  date,
  notes           text,
  constraint uniq_staff_compensation_per_school unique (school_id, user_id)
);

-- Carries `caterer_name` and `captured_by` precisely so the exclusion test has something to fail on.
create table facilities_snapshot (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references ref_school(id) on delete cascade,
  period_id          uuid not null,
  classrooms_total   integer not null default 0,
  classrooms_good    integer not null default 0,
  classrooms_repair  integer not null default 0,
  caterer_name       text,
  captured_at        timestamptz not null default now(),
  captured_by        uuid references ref_user(id) on delete set null
);

-- ── apps/web/Todo.md contract ───────────────────────────────────────────────────────────────────
create type oversight_consent_scope as enum ('NON_GES_STAFF');
create type oversight_consent_state as enum ('GRANTED', 'REVOKED');

create table school_staff_oversight_consent (
  id                        uuid primary key,
  school_id                 uuid not null references ref_school(id) on delete cascade,
  scope                     oversight_consent_scope not null default 'NON_GES_STAFF',
  state                     oversight_consent_state not null,
  granted_by_user_id        uuid references ref_user(id) on delete set null,
  granted_by_role           text,
  granted_at                timestamptz,
  revoked_at                timestamptz,
  consent_statement_version text,
  constraint school_staff_oversight_consent_uk unique (school_id, scope)
);

create table school_staff_oversight_consent_event (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references ref_school(id) on delete cascade,
  scope      oversight_consent_scope not null default 'NON_GES_STAFF',
  action     text not null,
  actor_id   uuid,
  occurred_at timestamptz not null default now()
);

-- ── tenant isolation, mirroring apps/web/db/sql/policies.sql ────────────────────────────────────
alter table ref_school force row level security;
alter table ref_school enable row level security;
create policy tenant_isolation on ref_school for all to public
  using  (id = nullif(current_setting('app.current_school', true), '')::uuid)
  with check (id = nullif(current_setting('app.current_school', true), '')::uuid);

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'role_assignment','staff_profile','staff_compensation','facilities_snapshot',
    'school_staff_oversight_consent','school_staff_oversight_consent_event'
  ] loop
    execute format('alter table %I force row level security', tbl);
    execute format('alter table %I enable row level security', tbl);
    execute format($p$create policy tenant_isolation on %I for all to public
        using  (school_id = nullif(current_setting('app.current_school', true), '')::uuid)
        with check (school_id = nullif(current_setting('app.current_school', true), '')::uuid)$p$, tbl);
  end loop;
end $$;

-- ref_user is GLOBAL identity (no school_id) and ref_role is a catalogue: no tenant key, no policy.
-- They are reachable only by joining from a tenant-scoped row, which RLS already filters.

-- ── the read-back role: PROVISIONING §4a posture ────────────────────────────────────────────────
do $$
begin
  if not exists (select from pg_roles where rolname = 'ov_readback') then
    create role ov_readback login;
  end if;
end $$;

revoke all on schema public from ov_readback;
grant usage on schema public to ov_readback;

-- SELECT only, table by table. NO `grant select on all tables`.
--   staff_profile / ref_role / role_assignment  — the record and the current posting
--   facilities_snapshot                          — school-context fields
--   school_staff_oversight_consent               — the live consent check
--   ref_user / ref_school                        — ⚠ ADDITIONS to §4a: full_name/phone live on the
--     global login identity, and the school's name + GES code on the tenant row. Both are required
--     by the identity spine and by the school-identity confirmation. Flagged in docs/PROVISIONING.md.
grant select on staff_profile, ref_role, role_assignment, facilities_snapshot,
                school_staff_oversight_consent, ref_user, ref_school
  to ov_readback;

-- staff_compensation is DELIBERATELY ABSENT from the grants above.
alter role ov_readback set default_transaction_read_only = on;
alter role ov_readback set statement_timeout = '5s';
alter role ov_readback set idle_in_transaction_session_timeout = '10s';
