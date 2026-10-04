-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- `demo_source` — THE OPERATIONAL STAND-IN FOR THE INCREMENT-H DEMO.
--
-- WHAT THIS IS. Ten tables standing in for the real operational schema in apps/web
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
