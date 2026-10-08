-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- `demo_source` — THE OPERATIONAL STAND-IN FOR THE INCREMENT-H DEMO.
--
-- WHAT THIS IS. Sixteen tables standing in for the real operational schema in apps/web
-- (plus ONE SEPARATE SCHEMA, `demo_ntc_source`, at the foot of this file — a stand-in for a THIRD
-- PARTY'S system rather than for Omnischools' own, which is why it is not a table in here)
-- (`db/schema/facilities-snapshot.ts`, `db/schema/periods.ts`, `db/schema/students.ts`,
-- `db/schema/terminal-results.ts`, `db/schema/attendance.ts`, `db/schema/fees.ts` and the
-- `pta_dues_charge` bridge of `db/schema/pta.ts`). The demo generator writes
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
--     attendance_record   — ⚠ THE TIGHTEST OMISSION IN THIS FILE: `reason_code`, `note`,
--                           `marked_by_user_id` and `marked_at`. The first three are the
--                           clinical/pastoral surface of the register (a structured health reason, the
--                           free text explaining it, and the named teacher who typed both); the fourth
--                           is simply unread. `student_id` IS kept, because the table's GRAIN is one row
--                           per pupil per day and `uniq_attendance_student_day` is load-bearing — the
--                           reader still never selects it. See the table's own header at the foot of
--                           this file.
--     invoice / invoice_line_item / fee_category / pta_dues_charge
--                         — ⚠ THE WIDEST OMISSIONS IN THIS FILE: `invoice_line_item.description` (free
--                           text on one child's bill), `invoice.invoice_number`, the WHOLE collection
--                           estate (`paid_amount` / `balance_amount` / `paid_at`, and the payment /
--                           receipt / allocation tables, which have no stand-in at all), the invoice-level
--                           money denormalisations, and all of `pta_dues_charge` except the line-item
--                           bridge — `rate_snapshot` included, so the double-count is unwritable. Each is
--                           argued at the tables' own header at the foot of this file.
--     plc_* (six tables) — ⚠ THE TIGHTEST ALLOW-LIST IN THIS FILE, because every attendee is a
--                           NAMED MEMBER OF STAFF: `plc.facilitator_user_id`, `plc.name`,
--                           `plc_session.topic` / `agenda_json` / `opened_by_user_id`,
--                           `plc_session_attendance.note` / `minutes_late` / `recorded_by_user_id`,
--                           the whole of `plc_term_focus` and the whole of `plc_session_reflection`
--                           (its q1/q2/q3 ARE a teacher's own written reflection; the ETL reads the
--                           frozen POINTS, never the prose). `user_id` IS carried on the three tables
--                           whose UNIQUE needs it, and the reader only ever `count(distinct …)`-es it.
--                           Each is argued at the tables' own header at the foot of this file.
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- PUPIL ATTENDANCE (increment H fourth slice, task H10) — `attendance_record`, the source of
-- `fact_attendance`.
--
-- ⚠ THE OMISSIONS HERE ARE THE TIGHTEST IN THIS FILE, AND THE REASON IS CLINICAL. The real table
-- (apps/web/db/schema/attendance.ts:38) carries FOUR columns this stand-in deliberately does not:
--   `reason_code`        SICK / MEDICAL / FAMILY / TRAVEL / OTHER — a structured HEALTH FACT about a
--                        named child. Together with a MEDICAL mark it is sickbay/pastoral data, not an
--                        education statistic, and nothing in oversight has any business reading it.
--   `note`               the free-detail field beside it ("mother in hospital"). Free text written
--                        specifically to explain a child's absence is the worst possible column to let
--                        cross an aggregation boundary, because nothing bounds what is in it.
--   `marked_by_user_id`  the NAMED TEACHER who took the register. Carrying it would make "who marked
--                        this class" queryable outside the gated §6 named-record path.
--   `marked_at`          omitted for the duller reason `terminal_exam_result.captured_at` is: the ETL
--                        never reads it (the vintage is the max MARK DATE in the term window), so it is
--                        not part of the contract this stand-in exists to pin.
-- Omitting all four makes `lib/etl/attendance-source.ts`'s allow-list STRUCTURAL in the demo: a reader
-- that reached for any of them would FAIL here rather than quietly succeed. This is the `students`
-- posture, taken further, and `tests/etl-attendance.test.ts` asserts both halves (absent here, and
-- genuinely present in the real table — so the omission is a choice, not an accident).
--
-- ⚠ `student_id` IS PRESENT, AND THE ETL STILL MUST NOT SELECT IT. The grain of this table IS one row
-- per pupil per civil day, so a stand-in without `student_id` could not carry
-- `uniq_attendance_student_day` and would be a different table with a different meaning. It is here for
-- that reason ONLY: the reader GROUPS and counts, never enumerates, and the test asserts the column name
-- appears nowhere in the reader. The UNIQUE is what makes `count(*)` a count of PUPIL-DAYS rather than of
-- register edits — the whole rate rests on it, so it is kept verbatim.
--
-- EVERY OTHER NAME AND TYPE IS THE OPERATIONAL ONE, including the five-member status enum in the
-- operational member ORDER (PRESENT, ABSENT, LATE, EXCUSED, MEDICAL — apps/web/db/schema/_enums.ts).
-- `class_id` is NOT NULL here exactly as upstream, which is why the ETL has no class_id-NULL fallback.
create type demo_source.attendance_status as enum
  ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'MEDICAL');

create table demo_source.attendance_record (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null,
  student_id uuid not null,
  class_id   uuid not null,
  -- The CIVIL date of the register. There is no period_id: a mark belongs to a DAY, and the ETL assigns
  -- it to the declared TERM whose [starts_on, ends_on] contains that day — it does NOT join
  -- `academic_period` (which is per-school and whose period_number means different things per product
  -- line; see the Q3 note in lib/etl/dimensions.ts).
  date       date not null,
  status     demo_source.attendance_status not null,
  -- The real `uniq_attendance_student_day`. LOAD-BEARING: it is what guarantees one mark per pupil per
  -- day, and therefore that the ETL's count(*) is a count of pupil-days.
  constraint uniq_attendance_student_day unique (school_id, student_id, date),
  -- The real composite school-scoped FKs — the pupil and the class must be in the same tenant.
  constraint attendance_record_student_fk
    foreign key (school_id, student_id)
    references demo_source.students (school_id, id) on delete cascade,
  constraint attendance_record_class_fk
    foreign key (school_id, class_id)
    references demo_source.class (school_id, id) on delete cascade
);

-- The ETL's attendance read is per school and date-windowed on the term, which is exactly this index.
create index demo_source_attendance_record_school_date_idx
  on demo_source.attendance_record (school_id, date);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- BILLED FEES (increment H fifth slice, task H11) — `fee_category` + `invoice` + `invoice_line_item`
-- + `pta_dues_charge`, the source of `fact_fees`.
--
-- ⚠ THE OMISSIONS HERE ARE THE WIDEST IN THIS FILE, AND THE REASON IS THAT THIS IS THE ONE DOMAIN
-- WHERE A ROW IS SIMULTANEOUSLY A CHILD, A HOUSEHOLD'S MEANS AND A CASH LEDGER. The posture is
-- `students`' taken as far as it goes: the stand-in carries ONLY the columns
-- `lib/etl/fees-source.ts` actually selects, so its allow-list is STRUCTURAL — a reader that reached
-- for a denied column would FAIL here rather than quietly succeed.
--
--   invoice            REAL columns (apps/web/db/schema/fees.ts:49): id, school_id, student_id,
--                      invoice_number, academic_year, period_id, subtotal_amount, discount_amount,
--                      billed_amount, paid_amount, balance_amount, status, issued_at, due_at,
--                      paid_at, voided_at.
--                      HERE: id, school_id, student_id, period_id, status, issued_at. AND NOTHING ELSE.
--                        · `invoice_number` is a per-child document reference — a direct handle on one
--                          family's bill.
--                        · `paid_amount` / `balance_amount` / `paid_at` are THE COLLECTION ESTATE. This
--                          slice publishes BILLED figures only (Kofi's ruling): what a school CHARGES is
--                          its published fee policy, while what a family HAS PAID is that family's
--                          financial distress, and a "mean arrears" figure for a two-school village is a
--                          sentence about identifiable households. Omitting the columns is what stops
--                          arrears analytics from happening BY ACCIDENT.
--                        · `billed_amount` / `subtotal_amount` / `discount_amount` are omitted for a
--                          different reason: they are INVOICE-level denormalisations, and the measures
--                          are built from the LINE items so that the category split is real. Carrying an
--                          invoice total would invite exactly the upstream-figure shortcut Kofi's ruling
--                          forbids ("re-derived from the group's own distribution, never from an
--                          upstream figure").
--   invoice_line_item  REAL columns: id, school_id, invoice_id, fee_category_id, description, amount,
--                      is_optional.
--                      HERE: everything EXCEPT `description` and `is_optional`.
--                        · ⚠ `description` IS THE SINGLE MOST IMPORTANT OMISSION IN THIS FILE. It is
--                          NOT NULL free text a bursar typed onto ONE CHILD'S bill ("Ama's arrears, see
--                          her mother"), and the category is available STRUCTURALLY (fee_category_id, or
--                          the dues bridge), so the only plausible excuse for reading it does not exist.
--                          Its absence here is what makes "the category NEVER comes from the
--                          description" a structural fact rather than a promise.
--                        · `is_optional` is simply unread: an optional line that was BILLED is billed.
--   fee_category       REAL columns: id, school_id, name, active, created_at. HERE: id, school_id, name.
--                      `active` is NOT read and NOT carried — a category somebody deactivated after
--                      issuing the bills is still the category those bills were issued under.
--   pta_dues_charge    REAL columns (migration 0078): id, school_id, line_item_id, pta_id, tier_type,
--                      academic_year, academic_period_id, basis, cadence, subject_student_id,
--                      household_id, rate_snapshot, created_at, updated_at.
--                      HERE: id, school_id, line_item_id. THREE COLUMNS, and the omissions are the
--                      ruling:
--                        · `rate_snapshot` is DENIED. The billed figure is the LINE's `amount`; summing
--                          the snapshot beside it would DOUBLE-COUNT the same money, and reading it
--                          instead would disagree with the invoice the parent was handed whenever the
--                          rate moved after issuance (the dues history is forward-only and the invoicer
--                          never re-rates an issued invoice). Omitting the column makes the double-count
--                          impossible to write.
--                        · `subject_student_id` / `household_id` are IDENTITY — the billed child and her
--                          family. The ETL already has the invoice's own pupil as a group key and needs
--                          no second one.
--                        · `pta_id` / `tier_type` / `basis` / `cadence` are PTA structure. `fact_fees`
--                          has one PTA_DUES bucket and no tier dimension, so a per-tier national figure
--                          is not representable — and inventing one here would be a grain this slice was
--                          not asked for.
--                      What IS kept is EXISTENCE: the bridge answers exactly one question — "is this
--                      line item PTA dues?" — which outranks the category name (a school may file dues
--                      under a category called "General Levy").
--
-- EVERY NAME AND TYPE IS THE OPERATIONAL ONE, including the seven-member `invoice_status` enum in the
-- operational member ORDER (apps/web/db/schema/_enums.ts:65). `amount` is numeric(12,2) exactly as
-- upstream — the ETL converts to exact integer pesewas at the boundary so that no published fee is
-- decided by float arithmetic.
--
-- ⚠ `uniq_pta_dues_charge_line_item` IS KEPT VERBATIM AND IS LOAD-BEARING: it is what makes the ETL's
-- LEFT JOIN to the bridge incapable of fanning out a line item (and therefore of doubling a fee). The
-- ETL RELIES on it rather than defending against it with a DISTINCT, so the stand-in must carry it or
-- the demo would not be testing the same query.
create type demo_source.invoice_status as enum
  ('DRAFT', 'ISSUED', 'PARTIAL', 'PAID', 'OVERDUE', 'EXEMPT', 'VOIDED');

create table demo_source.fee_category (
  id        uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  -- The per-school label the PURE resolver (lib/etl/fee-category.ts) reads — "Tuition", "Boarding
  -- Fees", "Printing Levy". NOT a mapping-table key: there is no mapping table, by Kofi's ruling.
  name      text not null,
  constraint uniq_fee_category_per_school unique (school_id, name),
  -- The real `fee_category_tenant_uk` — the composite-FK target for invoice_line_item.
  constraint fee_category_tenant_uk unique (school_id, id)
);

create table demo_source.invoice (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null,
  -- The billed CHILD. Present because the measures are a per-STUDENT distribution and a distribution
  -- cannot be rebuilt from a total — it is the ETL's GROUP KEY and reaches no fact row. This is the
  -- `attendance_record.student_id` posture, for the same structural reason.
  student_id uuid not null,
  -- NULLABLE exactly as upstream: a real bill can carry no term. Those invoices reach no fact row and
  -- are TALLIED (`countInvoicesWithoutPeriod`), never silently dropped.
  period_id  uuid,
  status     demo_source.invoice_status not null default 'ISSUED',
  issued_at  timestamptz not null default now(),
  constraint invoice_tenant_uk unique (school_id, id),
  constraint invoice_student_fk
    foreign key (school_id, student_id)
    references demo_source.students (school_id, id) on delete cascade,
  -- ⚠ DELIBERATE DEVIATION FROM UPSTREAM, AND THE ONLY ONE. `apps/web`'s `invoice.periodFk` has NO
  -- `on delete` action, because in production a term that has been invoiced against must not be
  -- deletable. This stand-in cascades for the same reason every other FK in this file does: the demo
  -- seam is fixture scaffolding, and tests tear a single school's `academic_period` rows down to
  -- synthesise "this school filed nothing" (see `tests/etl-infrastructure.test.ts`). A RESTRICT here
  -- would make the fifth arm's stand-in silently break the fourth arm's fixtures. Nothing in the ETL
  -- reads or depends on the delete action, so the deviation is invisible to the transform.
  constraint invoice_period_fk
    foreign key (school_id, period_id)
    references demo_source.academic_period (school_id, period_id) on delete cascade
);

create table demo_source.invoice_line_item (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null,
  invoice_id      uuid not null,
  -- NULLABLE exactly as upstream. A line with no category resolves from NOTHING — and because
  -- `description` is not even a column here, the honest answer is OTHER rather than a guess.
  fee_category_id uuid,
  -- THE BILLED FIGURE, and the only money column in this slice. numeric(12,2) as upstream.
  amount          numeric(12,2) not null,
  constraint invoice_line_item_tenant_uk unique (school_id, id),
  constraint invoice_line_item_invoice_fk
    foreign key (school_id, invoice_id)
    references demo_source.invoice (school_id, id) on delete cascade,
  constraint invoice_line_item_category_fk
    foreign key (school_id, fee_category_id)
    references demo_source.fee_category (school_id, id)
);

create table demo_source.pta_dues_charge (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null,
  line_item_id uuid not null,
  -- The 1:1 bridge (migration 0078). LOAD-BEARING: it is what makes the ETL's LEFT JOIN unable to fan
  -- out a line item, and therefore unable to double a fee.
  constraint uniq_pta_dues_charge_line_item unique (school_id, line_item_id),
  constraint pta_dues_charge_line_item_fk
    foreign key (school_id, line_item_id)
    references demo_source.invoice_line_item (school_id, id) on delete cascade
);

-- The ETL's fees read is per school and joins line items to invoices, which is exactly these.
create index demo_source_invoice_school_idx on demo_source.invoice (school_id, period_id);
create index demo_source_invoice_line_item_invoice_idx
  on demo_source.invoice_line_item (school_id, invoice_id);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEACHER CPD / PLC (increment L, the CPD/PLC slice) — `plc_programme` + `plc` + `plc_membership`
-- + `plc_session` + `plc_session_attendance` + `plc_cpd_ledger`, the source of
-- `fact_plc_participation`'s PLC-OPERATIONAL columns (Kofi's CPD-SURFACING-RULING C3).
--
-- ⚠ THIS IS THE `students` / `invoice` POSTURE TAKEN TO ITS LIMIT: the stand-in carries ONLY the
-- columns `lib/etl/plc-source.ts` actually reads, so the allow-list is STRUCTURAL — a reader that
-- reached for a denied column would FAIL here rather than quietly succeed. The denials, each for its
-- own reason and none of them a style preference:
--   plc_programme          REAL columns (apps/web/db/schema/plc.ts:68): id, school_id, session_day,
--                          session_start, session_length_min, weeks_per_semester,
--                          pts_per_attended_session, pts_per_reflection, reflection_window_hours,
--                          annual_plc_target, configured_at, updated_at.
--                          HERE: id, school_id, weeks_per_semester, annual_plc_target. AND NOTHING ELSE.
--                            · `weeks_per_semester` IS the cadence the TERM cut's `sessions_expected`
--                              is computed from — the school's OWN declared expectation, never a
--                              constant this ETL picks.
--                            · `annual_plc_target` is copied BY NAME onto the fact row (the schema's
--                              lineage-without-a-lookup rule), so it must keep its operational name.
--                            · the two `pts_per_*` scalars are NOT read: the ledger carries the
--                              FROZEN award (`attended_pts` / `reflection_pts`), and re-deriving
--                              points from today's configured rate would silently re-price last
--                              year's CPD the moment a school edited its programme.
--                            · `session_day` / `session_start` / `session_length_min` /
--                              `reflection_window_hours` are a TIMETABLE, not a measure.
--   plc                    REAL columns: id, school_id, type, name, facilitator_user_id,
--                          override_frequency, override_session_day, archived_at, created_at,
--                          updated_at.
--                          HERE: id, school_id, override_frequency, archived_at.
--                            · ⚠ `facilitator_user_id` IS DENIED. It is a NAMED MEMBER OF STAFF, and
--                              "who runs the PLC at this school" must not become queryable outside
--                              the gated §6 named-record path. `fact_plc_participation` says in as
--                              many words: NO teacher-identifiable columns.
--                            · `name` is free text a school typed onto a group ("Ama's maths circle")
--                              and analytics has no column for it.
--                            · `type` is deliberately unread: mandatoriness DERIVES from it in
--                              apps/web's lib/plc, and `fact_plc_participation` has no PLC-type
--                              breakdown — adding one would be a grain this slice was not asked for.
--                            · `override_frequency` IS read, because WEEKLY vs BIWEEKLY changes how
--                              many sessions the cadence CALLED FOR, which is the denominator of the
--                              session-coverage rate. NULL = inherit the programme = weekly.
--                            · `archived_at` IS read: active = archived_at IS NULL, and a PLC is soft-
--                              archived rather than deleted, so an archived group must not keep
--                              inflating `schools_running_plc_count` for ever.
--   plc_membership         REAL columns: id, school_id, plc_id, user_id, joined_at, left_at,
--                          created_at. HERE: id, school_id, plc_id, user_id, left_at.
--                            · ⚠ `user_id` IS PRESENT AND THE ETL NEVER SELECTS IT. The table's GRAIN
--                              is one row per (school × PLC × member), and `uniq_plc_membership` is
--                              what makes `count(distinct user_id)` a count of TEACHERS rather than
--                              of membership rows — a teacher in two PLCs is one teacher in a PLC.
--                              It is here for that reason ONLY: the reader AGGREGATES it and never
--                              projects it, and `tests/etl-plc.test.ts` asserts that every mention of
--                              the column in the reader sits inside a `count(distinct …)`. This is the
--                              `attendance_record.student_id` posture, tightened.
--                            · `joined_at` is unread: membership is an OPEN ROW, so "active" is
--                              `left_at IS NULL` and the join date buys nothing.
--   plc_session            REAL columns: id, school_id, plc_id, academic_period_id, session_date,
--                          topic, agenda_json, opened_by_user_id, created_at, updated_at.
--                          HERE: id, school_id, plc_id, session_date.
--                            · ⚠ `topic` and `agenda_json` are FREE TEXT a facilitator authored about
--                              a staff development session. Nothing bounds what free text contains and
--                              there is no destination for it; `opened_by_user_id` is a named teacher.
--                            · `academic_period_id` is OMITTED ON PURPOSE, and the omission is a
--                              ruling: a session is assigned to the declared TERM whose
--                              [starts_on, ends_on] window CONTAINS its civil `session_date`, exactly
--                              as an attendance mark is (`lib/etl/attendance-source.ts`). Joining the
--                              operational period instead would reintroduce the Q3 problem —
--                              `period_number` means a term on BASIC and a SEMESTER on SENIOR — and
--                              would file an SHS school's Friday PLC under half a year.
--   plc_session_attendance REAL columns: id, school_id, session_id, user_id, status, minutes_late,
--                          note, recorded_by_user_id, created_at.
--                          HERE: id, school_id, session_id, user_id, status.
--                            · ⚠ PRESENT-BY-DEFAULT (apps/web R383): A ROW EXISTS ONLY FOR A MEMBER WHO
--                              WAS NOT PRESENT. So `attendance_events` is NOT count(*) of this table —
--                              it is (members × sessions held) MINUS the rows here whose status is not
--                              present-ish. That inversion is the single easiest thing to get backwards
--                              in this arm, and it is why `status` is carried verbatim with the
--                              operational five-member enum: LATE == PRESENT for CPD (R383), and
--                              EXCUSED / MEDICAL / ABSENT each earn nothing.
--                            · `note` is free text explaining why a named teacher missed a session —
--                              the `attendance_record.note` argument, about a member of staff.
--                            · `minutes_late` is unread (Late IS present for CPD, so the minutes
--                              change no published figure) and `recorded_by_user_id` is identity.
--   plc_cpd_ledger         REAL columns: id, school_id, session_id, user_id, attended_pts,
--                          reflection_pts, settled_at, created_at.
--                          HERE: everything except `created_at` (the DB write time, for audit; the
--                          DOMAIN instant is `settled_at`, which IS the annual row's vintage).
--                            · `attended_pts` + `reflection_pts` ARE the whole observable CPD universe
--                              today — there is NO category column anywhere in this module, which is
--                              the fact the schema's ⚠ SOURCING GATE is built on and the reason
--                              `demo_ntc_source` below has to exist at all.
--   plc_term_focus         NO STAND-IN. Free text per (PLC × period) with no analytics destination.
--   plc_session_reflection NO STAND-IN, and this one is worth stating: its ANSWERS (q1/q2/q3) are a
--                          teacher's own written reflection. The reflection's CPD CONSEQUENCE is
--                          already frozen in `plc_cpd_ledger.reflection_pts`, so the ETL reads the
--                          POINTS and never the prose. A stand-in for the table would be a column
--                          nobody may read.
--
-- NOTHING HERE HAND-SEEDS A FACT ROW. `fact_plc_participation` is only ever written by
-- `lib/etl/plc.ts`, exactly as `fact_infrastructure` is only ever written by the census transform.
create table demo_source.plc_programme (
  id                uuid primary key default gen_random_uuid(),
  -- Singleton per school (the real table's single-column UNIQUE FK → ref_school). A MISSING row is
  -- LEGAL AND MEANINGFUL: apps/web coalesces it to frozen defaults, and here it means the school never
  -- configured a PLC programme — so `annual_plc_target` is NULL on its fact row, never 0.
  school_id         uuid not null unique,
  weeks_per_semester integer not null default 12,
  -- numeric(5,2) exactly as upstream (default 8) — the SCHOOL'S OWN PLC-only target, deliberately NOT
  -- the statutory 20. Copied onto the fact row under the SAME name.
  annual_plc_target numeric(5,2) not null default 8,
  constraint demo_plc_programme_weeks_positive check (weeks_per_semester > 0),
  constraint demo_plc_programme_annual_plc_target_nonneg check (annual_plc_target >= 0)
);

create table demo_source.plc (
  id        uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  -- NULL = inherit the programme cadence (weekly). The real 2-value CHECK is kept so the demo cannot
  -- generate a frequency the `sessions_expected` rule has no answer for.
  override_frequency text,
  -- SOFT archive: active = archived_at IS NULL. A PLC is never hard-deleted upstream.
  archived_at timestamptz,
  -- The real `plc_tenant_uk` — the composite-FK target of the membership and session tables below.
  constraint plc_tenant_uk unique (school_id, id),
  constraint plc_override_frequency_valid
    check (override_frequency in ('WEEKLY', 'BIWEEKLY'))
);

create table demo_source.plc_membership (
  id        uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  plc_id    uuid not null,
  -- The STAFF member. NULLABLE exactly as upstream (single-column SET NULL → ref_user). Never
  -- selected by the ETL — only ever `count(distinct …)`-ed. See the header.
  user_id   uuid,
  left_at   timestamptz, -- null = ACTIVE member (the open-row idiom)
  -- The real `uniq_plc_membership`. LOAD-BEARING: one row per (school × PLC × member) is what makes
  -- a distinct count of members a count of TEACHERS IN A PLC.
  constraint uniq_plc_membership unique (school_id, plc_id, user_id),
  constraint plc_membership_plc_fk
    foreign key (school_id, plc_id)
    references demo_source.plc (school_id, id) on delete cascade
);

create table demo_source.plc_session (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null,
  plc_id       uuid not null,
  -- The CIVIL date of the session. "Held" = this row exists (the real table's manual-open rule), so
  -- `sessions_held` is a count of these rows and needs no status column — there is none upstream.
  session_date date not null,
  -- The real `plc_session_tenant_uk` — the composite-FK target of the two child tables below.
  constraint plc_session_tenant_uk unique (school_id, id),
  -- The real `uniq_plc_session`: one session per (PLC × date). LOAD-BEARING — it is what makes
  -- `count(*)` a count of SESSIONS rather than of register edits.
  constraint uniq_plc_session unique (school_id, plc_id, session_date),
  constraint plc_session_plc_fk
    foreign key (school_id, plc_id)
    references demo_source.plc (school_id, id) on delete cascade
);

-- The operational five-member enum, in the operational member ORDER (apps/web/db/schema/_enums.ts).
-- REUSED by the PLC register upstream (R383 — no new enum), which is why the demo reuses the one
-- created for `attendance_record` above rather than minting a second copy with the same name.
create table demo_source.plc_session_attendance (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null,
  session_id uuid not null,
  -- The STAFF member who was NOT present (present-by-default: mark-present DELETES the row). Never
  -- selected by the ETL. Here because `uniq_plc_session_attendance` is load-bearing.
  user_id    uuid,
  status     demo_source.attendance_status not null,
  -- The real `uniq_plc_session_attendance`: ≤1 event per (session × member), which is what guarantees
  -- the non-present deduction cannot exceed the roll and the participation rate cannot go negative.
  constraint uniq_plc_session_attendance unique (school_id, session_id, user_id),
  constraint plc_session_attendance_session_fk
    foreign key (school_id, session_id)
    references demo_source.plc_session (school_id, id) on delete cascade
);

create table demo_source.plc_cpd_ledger (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null,
  session_id     uuid not null,
  -- The awarded STAFF member. Never selected; only `count(distinct …)`-ed, which is what makes
  -- `cpd_points_teacher_count` a count of teachers who earned ANY points (the MEAN's denominator —
  -- and emphatically NOT the coverage denominator, which is teacher_headcount).
  user_id        uuid,
  -- ⚠ THE TWO ARMS, AND THERE IS NO THIRD. There is NO category column here, in this stand-in or
  -- upstream: the NTC Specialised / Recommended classes and the NCPD half of Mandatory are earned
  -- OUTSIDE this product. That absence IS the schema's sourcing gate, and `demo_ntc_source` below is
  -- the separate, swappable place the demo's NTC figures come from instead.
  attended_pts   numeric(5,2) not null,
  reflection_pts numeric(5,2) not null,
  -- The deterministic award instant (the session write-lock). It is the ANNUAL row's `as_of_date`
  -- vintage, which is why it is carried and `created_at` (the DB write time) is not.
  settled_at     timestamptz not null,
  -- The real `uniq_plc_cpd_ledger`: one frozen award per (school × session × member) — the ledger-layer
  -- anti-double-count key, so a sum of points cannot double a teacher's session.
  constraint uniq_plc_cpd_ledger unique (school_id, session_id, user_id),
  constraint plc_cpd_ledger_attended_pts_nonneg check (attended_pts >= 0),
  constraint plc_cpd_ledger_reflection_pts_nonneg check (reflection_pts >= 0),
  constraint plc_cpd_ledger_session_fk
    foreign key (school_id, session_id)
    references demo_source.plc_session (school_id, id) on delete cascade
);

-- The ETL's PLC reads are per school, then windowed on the term's civil dates — exactly these.
create index demo_source_plc_school_idx on demo_source.plc (school_id);
create index demo_source_plc_session_school_date_idx
  on demo_source.plc_session (school_id, session_date);
create index demo_source_plc_cpd_ledger_session_idx
  on demo_source.plc_cpd_ledger (school_id, session_id);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- `demo_ntc_source` — THE DEMO NTC CPD STAND-IN (Kofi's CPD-SURFACING-RULING C1/C2).
--
-- ⚠ A SEPARATE SCHEMA, NOT A TABLE IN `demo_source`, AND THAT IS THE WHOLE POINT. `demo_source`
-- stands in for OMNISCHOOLS' OWN operational Postgres; this stands in for a THIRD PARTY'S system —
-- the NTC CPD portal — which Omnischools does not own, does not write to, and today cannot read at
-- all. Keeping them apart is what makes the two sourcing states mechanically distinct:
--
--     SCHEMA PRESENT  → `lib/etl/ntc-cpd-source.ts` returns rows, and the fact builder POPULATES
--                       cpd_points_specialised_total, cpd_points_recommended_total, their two teacher
--                       counts, teachers_meeting_cpd_threshold and ntc_cpd_target FROM THEM.
--     SCHEMA ABSENT   → the reader returns NOTHING, and those columns stay NULL — NEVER 0. One code
--                       path, two data states (C1).
--
-- ⚠ THE FACT BUILDER NEVER INVENTS AN NTC FIGURE. The demo does not relax the schema's ⚠ SOURCING
-- GATE by letting the transform synthesise numbers; it relaxes it by giving the transform A SOURCE TO
-- READ FROM. Writing 0 instead of NULL would report every school in Ghana as 0% CPD-compliant —
-- false, actionable, and the worst available failure mode for a regulator's dashboard.
--
-- ⚠ THE REAL FEED REPLACES WHAT IS BEHIND THE SEAM AND NOTHING ELSE. `readNtcCpdSummaries` takes the
-- schema name as a parameter exactly as `lib/etl/source.ts` does, so pointing it at
-- `schemaName = "public"` on a genuine NTC-portal/extract connection changes the CALL SITE and not the
-- fact builder, not `getTeacherCpd`, and not one dashboard. That claim only holds because the column
-- NAMES below are the ones a real NTC extract uses rather than the analytics column names — the
-- "omit, never rename" rule of the `demo_source` header, applied to somebody else's vocabulary.
--
-- KEYED BY `emis_school_id`, NOT BY AN OMNISCHOOLS TENANT UUID, and that is a correctness
-- requirement rather than a convenience: NTC has never heard of `ref_school.id`. An external extract
-- keyed by the national school code is the `ref_waec_results_extract` posture (db/schema/ref.ts), and
-- it is the only key the real feed could plausibly arrive on.
--
-- ⚠ WHAT IS *NOT* HERE, deliberately: no teacher row, no licence number, no name, no per-teacher
-- points. A real NTC extract plausibly COULD be per teacher; analytics has no destination for that
-- and `fact_plc_participation` says so in as many words ("no user ids, no names, no per-teacher
-- rows"). The stand-in is therefore pre-aggregated to (school × academic year × teacher sex), which
-- is the coarsest shape that can still feed the sexed fact columns — so even a future real feed is
-- aggregated BEFORE it reaches this seam, not after.
--
-- ⚠ GRANT-ABSENCE POSTURE, as in `demo_source`: no GRANT is issued on this schema at all, so only the
-- analytics owner (the ETL's own credential) can read it. And, like `demo_source`, it is NOT `public`:
-- the §6 prod-paste-0006 re-run rule is triggered by a new object in the analytics `public` schema,
-- and a demo-only schema created by a script that never runs against prod adds none.
drop schema if exists demo_ntc_source cascade;
create schema demo_ntc_source;

-- ONE ROW PER (school × academic year × teacher sex).
--
-- ⚠ SEX IS A GRAIN KEY HERE AND CARRIES ONLY MALE AND FEMALE — there is NO 'ALL' row, by design. 'ALL'
-- is SYNTHESISED by the fact builder as MALE + FEMALE, exactly as the operational `demo_source.sex`
-- enum has no 'ALL' member for pupils. That is what makes `MALE + FEMALE = ALL` true BY CONSTRUCTION
-- on every NTC-sourced column rather than true by agreement between two generated numbers.
create table demo_ntc_source.ntc_cpd_summary (
  -- The GES/EMIS school code — the only key an external extract could arrive on. TEXT, not a uuid.
  emis_school_id             text not null,
  -- "2025/26". The same academic-year string the rest of the warehouse speaks.
  academic_year              text not null,
  teacher_sex                text not null,
  -- The two point classes earned ENTIRELY OUTSIDE this product. These are the columns the schema's
  -- sourcing gate holds NULL until a feed exists; here, they come FROM a feed-shaped source.
  specialised_points         numeric(9,2) not null,
  recommended_points         numeric(9,2) not null,
  -- ⚠ THE NCPD HALF OF MANDATORY, AND ONLY THAT HALF. NTC's Mandatory class is fed by two streams —
  -- school-based/PLC provision and National-Centre-for-PD provision — and Omnischools observes ONLY
  -- the PLC stream (`plc_cpd_ledger`). So this column is the TOPUP, not the total: the builder adds it
  -- TO the genuinely observed PLC points (C7), which is what makes
  -- `cpd_points_mandatory_total >= the observed PLC points` hold by construction and what lets a real
  -- NTC feed only ever ADD to the PLC floor rather than contradict it.
  ncpd_points                numeric(9,2) not null,
  -- Per-category COVERAGE numerators — teachers with ≥1 point in that class. They OVERLAP by
  -- construction (one teacher can earn in two classes), so they are never summed to each other.
  mandatory_teachers         integer not null,
  specialised_teachers       integer not null,
  recommended_teachers       integer not null,
  -- The statutory compliance count GES asks for: teachers who reached `cpd_target_points` ACROSS ALL
  -- CPD. Measured against the national total, NEVER against a school's own PLC target.
  teachers_meeting_threshold integer not null,
  -- The NATIONAL STATUTORY TOTAL for this year (nominally 20). Carried PER ROW rather than hard-coded
  -- because it is a POLICY VARIABLE: if NTC moves it, last year's rows must keep last year's number.
  cpd_target_points          numeric(5,2) not null,
  constraint uniq_ntc_cpd_summary unique (emis_school_id, academic_year, teacher_sex),
  -- No 'ALL': see the table header. The builder synthesises it.
  constraint ntc_cpd_summary_teacher_sex_valid check (teacher_sex in ('MALE', 'FEMALE')),
  constraint ntc_cpd_summary_points_nonneg
    check (specialised_points >= 0 and recommended_points >= 0 and ncpd_points >= 0),
  constraint ntc_cpd_summary_counts_nonneg
    check (mandatory_teachers >= 0 and specialised_teachers >= 0 and recommended_teachers >= 0
           and teachers_meeting_threshold >= 0),
  constraint ntc_cpd_summary_target_positive check (cpd_target_points > 0)
);

create index demo_ntc_source_ntc_cpd_summary_year_idx
  on demo_ntc_source.ntc_cpd_summary (academic_year, emis_school_id);
