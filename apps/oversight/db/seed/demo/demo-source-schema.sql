-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- `demo_source` — THE OPERATIONAL STAND-IN FOR THE INCREMENT-H DEMO.
--
-- WHAT THIS IS. Five tables standing in for the real operational schema in apps/web
-- (`db/schema/facilities-snapshot.ts`, `db/schema/periods.ts`, `db/schema/students.ts` and
-- `db/schema/terminal-results.ts`). The demo generator writes
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
--     class               — everything except the per-school configuration the enrolment ETL has no
--                           use for (`programme`, `class_teacher_user_id`, `target_capacity`,
--                           `created_at`). `level` and `name` ARE the stage mapping's only inputs.
--     students            — ⚠ A DELIBERATELY RADICAL SUBSET, AND THE OPPOSITE POSTURE TO
--                           facilities_snapshot's. The real table carries `first_name`, `last_name`,
--                           `other_names`, `student_code`, `date_of_birth`, `household_id`,
--                           `stpshs_ref`, `house_id`, `current_bunk_id`, `programme`, `residency`,
--                           `enrolled_on`, `admission_application_id`. NONE of them is here.
--                           For the census that was the right call — the person-identifying columns
--                           were INCLUDED so the transform could be seen not to carry them. A ROSTER
--                           is different in kind: `students` is the most person-identifying table in
--                           the estate, every one of those columns names a CHILD, and the enrolment
--                           ETL's allow-list (`lib/etl/enrolment-source.ts`) reads exactly six
--                           columns. Omitting the rest makes the allow-list STRUCTURAL in the demo —
--                           a reader that reached for `date_of_birth` would fail here rather than
--                           quietly succeed — which is a stronger statement than a passing test.
--                           The omission is also the one thing that CANNOT hide a prod defect: the
--                           reader names its six columns explicitly, so columns absent here are
--                           columns it never mentions.
--     terminal_exam_result — `note` (free text) and `captured_by` (a user id) — the SAME posture as
--                           `students`, for the same reason, plus `captured_at` which the ETL does not
--                           read (the cohort's vintage is the sitting's `ends_on`). See the table's own
--                           header at the foot of this file.
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
--                   would file half a year under a third of one — which is why `fact_infrastructure`
--                   is grained ANNUAL (Kofi's Q3 ruling) and files nothing under a term at all.
--                   `lib/etl/source.ts` reads EVERY line and keeps each school's latest census in the
--                   academic year; `product_line` survives only as that selector's final tie-break.
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- THE ROSTER (increment H second slice, task H9) — `class` + `students`, the source of
-- `fact_enrolment`.
--
-- ⚠ THE ROSTER HAS NO PERIOD, and the absence of any `period_id` below is that ruling made physical.
-- `students` is the CURRENT state of the school — there is no per-term roster filing operationally —
-- so the ETL counts who is on roll now and files the answer at ANNUAL grain under the run's academic
-- year. A `period_id` here would be an invented key, and joining it would multiply every child by the
-- number of periods the school has configured.
--
-- The two ENUM TYPES are created in this schema rather than reusing the analytics `ov_sex`: the
-- operational columns really are enums (apps/web `sex`, `student_status`) with DIFFERENT members —
-- operational sex has NO 'ALL' member, because 'ALL' is SYNTHESISED by the ETL (MALE + FEMALE) and
-- must never be readable from the source. Modelling them as text would hide exactly that distinction,
-- and `lib/etl/enrolment-source.ts` casts `::text` at the boundary the way it would have to on prod.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

create type demo_source.sex as enum ('MALE', 'FEMALE');
create type demo_source.student_status as enum
  ('ACTIVE', 'INACTIVE', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED');

-- Operational `class` (apps/web/db/schema/students.ts:30), minus the per-school configuration the
-- enrolment ETL does not read. `level` is NULLABLE upstream and nullable here, because that nullability
-- IS the reason the stage mapping is "level first, then name" (lib/etl/stage.ts).
create table demo_source.class (
  id        uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  name      text not null,
  level     text,
  active    boolean not null default true,
  constraint uniq_class_per_school unique (school_id, name),
  -- The real `class_tenant_uk` — the composite-FK target that makes a cross-tenant class reference
  -- structurally impossible. Load-bearing: the ETL's LEFT JOIN is on (school_id, class_id).
  constraint class_tenant_uk unique (school_id, id)
);

-- Operational `students` (apps/web/db/schema/students.ts:127) reduced to the SIX allow-listed columns
-- plus the tenant key — see the header for why this stand-in omits rather than includes. Every column
-- here is one `lib/etl/enrolment-source.ts` actually selects.
create table demo_source.students (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null,
  sex                 demo_source.sex not null,
  status              demo_source.student_status not null default 'ACTIVE',
  -- The display fallback the school typed. It is the ONLY statement of a year group that exists for a
  -- child with no class, which is why the ETL reads it rather than dropping that child.
  current_class_label text,
  class_id            uuid,
  constraint students_tenant_uk unique (school_id, id),
  -- The real composite school-scoped FK — the class must belong to the same tenant. NO `on delete`
  -- clause, matching the real constraint in apps/web/db/schema/students.ts (NO ACTION): deleting a
  -- class a child still points at is REFUSED, not allowed to delete the child with it.
  constraint students_class_fk
    foreign key (school_id, class_id)
    references demo_source.class (school_id, id)
);

-- The ETL's roster read is per school and groups by class label; both of these mirror what the real
-- `students_school_idx` / class lookup give it operationally.
create index demo_source_students_school_idx on demo_source.students (school_id);
create index demo_source_class_school_idx on demo_source.class (school_id);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TERMINAL EXAM RESULTS (increment H third slice, task H14) — `terminal_exam_result`, the source of
-- `fact_performance_exam`'s SCHOOL_ENTERED arm.
--
-- Operational apps/web/db/schema/terminal-results.ts (GOV-6, migration 0079) is ALREADY a SCHOOL-LEVEL
-- AGGREGATE: one row per (school × exam_type × year), four sex-split leaf counts, and NO per-candidate
-- rows, names or scores anywhere (Kofi R363/R372). So this stand-in is not a reduction of a per-person
-- table the way `students` is — it is the same aggregate, minus two columns.
--
-- ⚠ THE TWO OMITTED COLUMNS ARE THE POINT, and this is the `students` posture rather than the
-- `facilities_snapshot` one:
--   `note`        free text a head teacher typed. Nothing bounds what free text contains — a name, a
--                 phone number, a safeguarding remark — so the ETL's allow-list never mentions it.
--   `captured_by` a `ref_user` id: the NAMED STAFF MEMBER who keyed the figures. Carrying it into
--                 analytics would make "who filed this" queryable outside the gated §6 named-record
--                 path, which is the only route to an individual this product allows.
-- Omitting both makes `lib/etl/performance-source.ts`'s seven-column allow-list STRUCTURAL in the demo:
-- a reader that reached for either would FAIL here rather than quietly succeed. (`captured_at` is
-- omitted for a different and duller reason: the cohort's vintage is the SITTING's `ends_on`, so the ETL
-- never reads it — see lib/etl/performance.ts.)
--
-- EVERY OTHER NAME AND TYPE IS THE OPERATIONAL ONE, and all five operational CHECKs are kept, because
-- the transform restates them: if the operational constraint and the ETL's own validation ever drift,
-- the transform must fail loudly on the school rather than publish a pass rate above 100%.
--
-- `exam_type` is TEXT + CHECK, not an enum — exactly as upstream (the ref_role / plc.type fixed-domain
-- idiom). The analytics side has its own `exam` enum, and the 1:1 mapping across that boundary is
-- validated in `lib/etl/performance.ts` rather than assumed.
--
-- ⚠ ONE ROW PER EXAM PER YEAR IS THE REGULAR MAY/JUNE SITTING. There is no sitting-window column to
-- model, so NovDec and private-candidate figures are simply not representable here — which is the honest
-- shape, since Omnischools does not capture them.
create table demo_source.terminal_exam_result (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null,
  exam_type         text not null,
  -- The exam-sitting CALENDAR year (e.g. 2026) — NOT an academic year. The ETL maps N → "(N-1)/N".
  year              integer not null,
  female_candidates integer not null,
  male_candidates   integer not null,
  female_passed     integer not null,
  male_passed       integer not null,
  -- The real `uniq_terminal_exam_result_sitting`: one aggregate per (school × exam × year). Load-bearing
  -- for the grain — it is what makes the ETL's grouped read an identity rather than a de-duplication.
  constraint uniq_terminal_exam_result_sitting unique (school_id, exam_type, year),
  constraint terminal_exam_result_exam_type_valid
    check (exam_type in ('BECE', 'WASSCE')),
  constraint terminal_exam_result_female_candidates_nonneg check (female_candidates >= 0),
  constraint terminal_exam_result_male_candidates_nonneg check (male_candidates >= 0),
  -- Passed is bounded 0 ≤ passed ≤ candidates, PER SEX (a pass count can never exceed its sitters).
  constraint terminal_exam_result_female_passed_bounds
    check (female_passed >= 0 and female_passed <= female_candidates),
  constraint terminal_exam_result_male_passed_bounds
    check (male_passed >= 0 and male_passed <= male_candidates),
  -- A captured sitting has ≥1 candidate overall → sex='ALL' never divides by zero. Note it is the SUM
  -- that is bounded, not each sex: a single-sex school legitimately files female_candidates = 0, which
  -- is exactly why the per-sex rate needs its own zero guard.
  constraint terminal_exam_result_min_one_candidate
    check (female_candidates + male_candidates >= 1)
);

create index demo_source_terminal_exam_result_school_idx
  on demo_source.terminal_exam_result (school_id);
