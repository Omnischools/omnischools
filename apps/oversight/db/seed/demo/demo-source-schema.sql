-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- `demo_source` — THE OPERATIONAL STAND-IN FOR THE INCREMENT-H DEMO.
--
-- WHAT THIS IS. Two tables whose columns, types and CHECK allow-lists are copied byte-for-byte from
-- the real operational schema in apps/web (`db/schema/facilities-snapshot.ts` and the
-- (school_id, period_id) half of `db/schema/periods.ts`). The demo generator writes
-- OPERATIONAL-SHAPED rows here, and the ETL transform reads them and performs the real
-- decomposition — booleans → has_*_count, the three CHECK families → one 0/1 count per allowed
-- value, nullable detail → *_reporting_count denominators. Nothing in the demo hand-seeds a fact
-- row; `fact_infrastructure` is only ever written by `lib/etl/infrastructure.ts`.
--
-- WHY A SEPARATE SCHEMA IN THE ANALYTICS DATABASE, AND NOT THE REAL OPERATIONAL ONE.
-- The ETL's real operational reader DOES NOT EXIST YET: it needs the cross-tenant `oversight_etl`
-- role from scope §3 / task H1 (`oversight_readback` is structurally incapable — a six-table
-- allow-list, `app.current_school` RLS, a 5-second statement timeout). Until that role is built, a
-- demo that insisted on a genuine cross-database read could not run at all, and faking it with a
-- privileged operational credential would put a prod-shaped secret into a demo script. So the demo
-- keeps the SHAPE of the operational source and drops only the CREDENTIAL BOUNDARY, which is the one
-- part H1 is going to supply.
--
-- IN REAL OPERATION this schema is not used. `lib/etl/source.ts` takes the source schema name as a
-- parameter, so pointing the same transform at operational `public.facilities_snapshot` over an
-- `oversight_etl` connection — per-school, with `app.current_school` set, inside the H1 allow-list —
-- is a connection change at the call site, not a rewrite of the transform.
--
-- ⚠ NOT `public`. The §6 prod-paste-0006 re-run rule (scope §6) is triggered by a new object in the
-- analytics `public` schema; `demo_source` is a separate schema created by a DEMO script that never
-- runs against `omnischools-analytics-prod`, so the slice still adds no `public` object and still
-- does not trigger the re-run — deliberately, per scope §8.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

drop schema if exists demo_source cascade;
create schema demo_source;

-- Mirrors the (school_id, period_id) grain of operational `academic_period`. The point of its
-- existence is that operational periods are PER SCHOOL — every school has its OWN period_id for
-- "2025/26 Term 1" — while analytics `dim_period` is GLOBAL. This table is where that mismatch
-- lives, and `lib/etl/dimensions.ts` is where it is resolved (see the Q3 note there).
create table demo_source.academic_period (
  school_id     uuid not null,
  period_id     uuid not null,
  academic_year text not null,
  term          integer not null,
  starts_on     date,
  ends_on       date,
  primary key (school_id, period_id),
  constraint demo_source_academic_period_term_valid check (term in (1, 2, 3))
);

-- Column-for-column apps/web `facilities_snapshot`, minus the FKs that reach tables this stand-in
-- does not carry. The CHECKs are kept because the ETL's categorical decomposition asserts the SAME
-- allow-lists: if the two ever disagree, the transform must fail loudly rather than silently write a
-- row where no member of a family is 1.
create table demo_source.facilities_snapshot (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null,
  period_id          uuid not null,

  -- Classrooms (mandatory)
  classrooms_total   integer not null,
  classrooms_good    integer not null,
  classrooms_repair  integer not null,

  -- WASH: water / power / sanitation (mandatory)
  water_source       text not null,
  electricity_source text not null,
  latrines_boys      integer not null,
  latrines_girls     integer not null,
  latrines_staff     integer not null,
  latrine_type       text not null,
  handwashing        boolean not null,

  -- Facility presence (mandatory)
  has_library        boolean not null,
  has_ict_lab        boolean not null,
  internet           boolean not null,
  has_kitchen        boolean not null,
  gsfp_participating boolean not null,

  -- Optional detail (nullable — these are what the *_reporting_count denominators are for)
  library_book_count    integer,
  library_staff_fte     numeric(4,1),
  computers_total       integer,
  computers_working     integer,
  internet_type         text,
  meals_served_last_term integer,
  pupils_fed_daily_avg  integer,
  caterer_name          text,
  textbook_availability text,
  student_desks_usable  integer,
  student_desks_broken  integer,
  teacher_desks         integer,
  chalkboards           integer,
  whiteboards           integer,
  projectors            integer,

  note        text,
  captured_at timestamptz not null default now(),
  captured_by uuid,

  constraint uniq_facilities_snapshot_term unique (school_id, period_id),
  constraint demo_facilities_snapshot_classrooms_nonneg
    check (classrooms_total >= 0 and classrooms_good >= 0 and classrooms_repair >= 0),
  constraint demo_facilities_snapshot_classrooms_sum
    check (classrooms_good + classrooms_repair <= classrooms_total),
  constraint demo_facilities_snapshot_water_source_valid
    check (water_source in ('BOREHOLE', 'PIPE', 'WELL', 'NONE')),
  constraint demo_facilities_snapshot_electricity_source_valid
    check (electricity_source in ('GRID', 'SOLAR', 'GENERATOR', 'NONE')),
  constraint demo_facilities_snapshot_latrine_type_valid
    check (latrine_type in ('WC', 'KVIP', 'PIT', 'NONE')),
  constraint demo_facilities_snapshot_latrines_nonneg
    check (latrines_boys >= 0 and latrines_girls >= 0 and latrines_staff >= 0),
  constraint demo_facilities_snapshot_library_nonneg
    check (library_book_count >= 0 and library_staff_fte >= 0),
  constraint demo_facilities_snapshot_computers_nonneg
    check (computers_total >= 0 and computers_working >= 0),
  constraint demo_facilities_snapshot_computers_bound
    check (computers_working is null or computers_total is null or computers_working <= computers_total),
  constraint demo_facilities_snapshot_furniture_nonneg
    check (student_desks_usable >= 0 and student_desks_broken >= 0 and teacher_desks >= 0
           and chalkboards >= 0 and whiteboards >= 0 and projectors >= 0),
  constraint demo_facilities_snapshot_textbook_availability_valid
    check (textbook_availability in ('ADEQUATE', 'INADEQUATE')),
  -- The composite (school_id, period_id) must name a period this school actually has — the
  -- intra-tenant guarantee apps/web gets from its composite FK to academic_period.
  constraint demo_facilities_snapshot_period_fk
    foreign key (school_id, period_id)
    references demo_source.academic_period (school_id, period_id) on delete cascade
);
