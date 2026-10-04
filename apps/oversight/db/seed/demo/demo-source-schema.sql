-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- `demo_source` — THE OPERATIONAL STAND-IN FOR THE INCREMENT-H DEMO.
--
-- WHAT THIS IS. Two tables standing in for the real operational schema in apps/web
-- (`db/schema/facilities-snapshot.ts` and `db/schema/periods.ts`). The demo generator writes
-- OPERATIONAL-SHAPED rows here, and the ETL transform reads them and performs the real
-- decomposition — booleans → has_*_count, the three CHECK families → one 0/1 count per allowed
-- value, nullable detail → *_reporting_count denominators. Nothing in the demo hand-seeds a fact
-- row; `fact_infrastructure` is only ever written by `lib/etl/infrastructure.ts`.
--
-- ⚠ EXACTLY WHAT IS AND IS NOT COPIED — stated precisely, because `lib/etl/source.ts` has to run
-- against the REAL table unchanged, and a stand-in that quietly renames a column guarantees it will
-- not (the first version of this file invented `term integer` where the real table has
-- `period_number smallint`; the ETL's filter would have failed on prod with
-- `column p.term does not exist`).
--
--   NAMES AND TYPES ARE NEVER CHANGED. Every column below has the operational name and type.
--   COLUMNS MAY BE OMITTED. A DELIBERATE SUBSET, listed here so the omission is reviewable:
--     academic_period     — `closed_at`, `closed_by_user_id` (the term-lifecycle pair). The ETL does
--                           not read them; whether a closed term should be the only aggregatable one
--                           is a real question, and an open one, so the stand-in does not prejudge it.
--     facilities_snapshot — none; all columns are present, including the two person-identifying ones
--                           (`captured_by`, `caterer_name`) which exist here precisely so the
--                           transform can be SEEN not to carry them across.
--   FKs that reach tables this stand-in does not carry (ref_school, ref_user,
--   ref_academic_period_config) are dropped; the intra-tenant composite FK between the two tables
--   below is kept, because that one is load-bearing for the grain.
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
-- parameter, so pointing the same query at operational `public.facilities_snapshot` /
-- `public.academic_period` over an `oversight_etl` connection — per-school, with `app.current_school`
-- set, inside the H1 allow-list — is a connection change at the call site, not a rewrite of the
-- transform. That claim is only true because the column NAMES above are the operational ones; it is
-- the reason the subset rule in the header is "omit, never rename".
--
-- ⚠ NOT `public`. The §6 prod-paste-0006 re-run rule (scope §6) is triggered by a new object in the
-- analytics `public` schema; `demo_source` is a separate schema created by a DEMO script that never
-- runs against `omnischools-analytics-prod`, so the slice still adds no `public` object and still
-- does not trigger the re-run — deliberately, per scope §8.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

drop schema if exists demo_source cascade;
create schema demo_source;

-- Operational `academic_period` (apps/web/db/schema/periods.ts:62) minus the two term-lifecycle
-- columns. The point of its existence is that operational periods are PER SCHOOL — every school has
-- its OWN period_id for "2025/26 Term 1" — while analytics `dim_period` is GLOBAL. This table is
-- where that mismatch lives, and `lib/etl/dimensions.ts` is where it is resolved (the Q3 note there).
--
-- THREE COLUMNS THE ETL CANNOT IGNORE, and the first version of this file got all three wrong:
--   `period_number` smallint, NOT `term`. There is no `term` column anywhere in operational Postgres.
--   `period_label`  free text ("Semester 1", "Term 2") — display, never a key.
--   `product_line`  NOT NULL, SENIOR | BASIC | SENIOR_F3. THIS IS THE ONE THAT MATTERS: period_number
--                   means a TERM on a BASIC row and a SEMESTER on a SENIOR row, so `period_number = 1`
--                   is not one thing. Mapping a SENIOR semester onto analytics `dim_period` term 1
--                   would file half a year under a third of one. `lib/etl/source.ts` therefore reads
--                   every line and reports the non-mapped ones as a NAMED GAP.
create table demo_source.academic_period (
  period_id     uuid primary key default gen_random_uuid(),
  school_id     uuid not null,
  academic_year text not null,
  period_number smallint not null,
  period_label  text not null,
  starts_on     date not null,
  ends_on       date not null,
  product_line  text not null,
  -- The real table's `academic_period_tenant_uk` — the composite-FK target that makes a cross-tenant
  -- period reference structurally impossible. Kept because facilities_snapshot's FK below needs it,
  -- AND because together with the period_id PK it is what stops the ETL's join fanning out.
  constraint academic_period_tenant_uk unique (school_id, period_id),
  -- Not a CHECK on the real table (it is a plain text discriminator there); asserted here so the demo
  -- cannot generate a product line the ETL has no rule for.
  constraint demo_source_academic_period_product_line_valid
    check (product_line in ('SENIOR', 'BASIC', 'SENIOR_F3'))
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
