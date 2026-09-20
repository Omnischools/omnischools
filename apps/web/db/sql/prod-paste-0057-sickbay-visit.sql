-- Omnischools — migration 0057: SICKBAY VISIT (SHS module 4.4 / INCR-22a). TWO new enums + FOUR new
-- tenant tables + their RLS. ZERO altered columns, zero backfills. Idempotent — safe to run more than
-- once. Paste into the Supabase SQL editor on PROD after merging.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. If migration 0057 ships
-- to prod without this paste, the four tables below exist there with **NO row-level security at all**:
-- no ENABLE, no FORCE, no tenant_isolation, no parent_deny. 0056 leaked CONFIG; **0057 is where this
-- module starts holding real CLINICAL DATA about named children** — the presenting complaint
-- ("menstrual cramps", "chest pain"), the matron's working impression, the red-flag screen, every
-- temperature/BP/SpO₂/pain reading with the time it was taken, the disposition, which bed a named girl
-- slept in and for how long, whether she was in ISOLATION, and what an external doctor said about her
-- on the phone at 21:40. Without this paste every one of those rows is readable **and writable** from
-- every other school's session, and a claimed parent session reads them too (owner decision D8 keeps
-- parents out of sickbay entirely until the Tier-2 chain at INCR-26). A cross-tenant read here is not
-- a data-quality incident; it is disclosure of a minor's health information to a stranger.
-- Running this file == migration 0057 followed by db:policies for these tables; the executable SQL
-- below is deliberately equivalent to what db/sql/policies.sql applies. Verify afterwards with
-- db/sql/verify-prod-rls.sql — Query 1 must return ZERO ROWS and Query 2's tenant_tables must have
-- risen by exactly 4 (with parent_denied up 4).
--
-- SCOPE: 0057 is a NEW-TABLE-ONLY migration — NO ALTERs, NO backfills, NO data changes, NO seed, NO
-- GLOBAL-table changes. It adds NO medication, chronic-condition, referral or notification table
-- (INCR-23/24/25/26 own those). Four tables, two enums, nothing else.
--
-- ALL FOUR new tables are TENANT tables (they carry school_id) → ENABLE + FORCE ROW LEVEL SECURITY +
-- tenant_isolation. The owner is NOT exempt under FORCE (fail-closed: an unscoped query returns zero
-- rows). NONE of them is global — there is no sickbay reference data in 0057, so nothing here gets the
-- bare-ENABLE treatment. Owner decision D8: every sickbay table stays PARENT-DENIED in module 4.4 —
-- delivered by the catalog-driven parent_deny loop at the bottom, unchanged from 0055/0056.
--
-- 🔴 DDL ORDER — THE 0033 HAZARD, THIS TIME INSIDE ONE MIGRATION (AC S2). `sickbay_visit_tenant_uk`
-- UNIQUE(school_id, id) is the composite-FK target of THREE tables created in this SAME file
-- (sickbay_vital_reading, sickbay_admission, sickbay_doctor_consult). drizzle-kit runs a migration's
-- statements in ONE transaction and SWALLOWS the error, so an FK emitted ahead of the UNIQUE it needs
-- fails silently: rollback, exit 1, no message. The order below is therefore strict and load-bearing:
--   enums → CREATE TABLE ×4 (each carrying its PK/UNIQUE **INLINE**) → foreign keys → indexes → RLS.
-- Every composite-FK target exists before the FK that references it:
--   • sickbay_visit_tenant_uk           — created INLINE in CREATE TABLE sickbay_visit, below, i.e.
--     before ALL the ALTER TABLE ... ADD FOREIGN KEY statements (the whole FK section runs after the
--     whole table section). Consumed by all three child tables.
--   • sickbay_admission_tenant_uk       — created INLINE too. Nothing references it YET; it is
--     authored NOW because INCR-25/27 will (the 0056 sickbay_bed_tenant_uk precedent — create the
--     UNIQUE a migration AHEAD of the FK, never in the same one).
--   • sickbay_bed_tenant_uk             — shipped in **0056**, exactly for sickbay_admission.bed_id.
--   • students_tenant_uk                — shipped in 0033.
--   • ref_school PK / ref_user PK       — shipped in 0001.
-- The generated migration (db/migrations/0057_legal_epoch.sql) was inspected line by line and replayed
-- from an EMPTY database, verified by CATALOG INSPECTION rather than exit code.
--
-- CONSTRAINT notes (Kofi rulings R32–R67, 2026-07-21):
--   • R32 — NO status/state column on sickbay_visit. State is DERIVED from the timestamps by a pure
--     visitState(): started_at NULL ⇒ QUEUED; disposition NULL ⇒ open; voided_at set ⇒ void. A stored
--     enum can disagree with its own timestamps.
--   • R58 — THREE exclusivity invariants as PARTIAL UNIQUE INDEXES, never app checks (an app check
--     loses the concurrent double-admit race): one OPEN visit per student, one OPEN admission per bed,
--     one OPEN admission per student. Plus a total UNIQUE(school_id, visit_id) on the admission — a
--     visit is admitted at most once, ever.
--   • R38/R60/R21 — recorded EXTERNAL actors are TEXT, never identity pointers: `intake_reported_by`
--     (the Sick Bay Prefect who walked the student over) and `clinician_name`/`clinician_affiliation`
--     on the consult. An FK to the prefect's student row would place one student's identity as an
--     ACTOR inside another student's clinical record; and the visiting doctor is not a system user, so
--     a consult can never be a co-sign or an authorisation gate. `clinician_name` is COPIED onto the
--     row rather than read from sickbay_settings — the locum who actually took the call is not this
--     term's settings value.
--   • R43 — `working_impression`, NOT `diagnosis`: the string `diagnos` appears in no column, enum,
--     type, label or route 0057 ships. `red_flags_screened` and `escalation_triggers` are free text
--     and the latter is INERT (stored, never evaluated). The only structured clinical vocabulary in
--     all of 4.4 is chronic_condition_enum, at INCR-23. No ICD, no SNOMED, no code list.
--   • R44/R45 — vitals are ROWS, and sickbay_vital_reading is APPEND-ONLY: **no `updated_at`**, no
--     void, no delete (a correction is another reading). **NO `unit` column** — units are fixed
--     (°C/mmHg/bpm/%/0–10) and a unit column is a second fact that can disagree with the number beside
--     it. `temp_c` is numeric(3,1) (exact); the rest are smallint. All six measures NULLABLE, with
--     "at least one" and the plausibility bounds (temp 25–45, sys 50–260, dia 30–160, pulse 20–250,
--     SpO₂ 50–100, pain 0–10) in **zod, deliberately NOT as DB CHECKs** — a CHECK on a physiological
--     range rejects the genuine extreme reading the record most needs, inside the very transaction
--     documenting an emergency.
--   • R57/R63 — `sickbay_admission.is_isolation` must EQUAL the bed's (enforced in lib/: isolation is
--     a property of the case, and R9's two bed pools never merge); `discharge_criteria` is FREE TEXT
--     plus expected_discharge_at and an app-required overnight_plan. The surfaces' structured 4-row
--     checklist / "3 of 4 met" counter is OMITTED, not faked — a criterion instance needs per-condition
--     templates, which arrive at INCR-23.
--   • `sickbay_admission.student_id` is DENORMALISED (it is reachable via the visit) SOLELY to carry
--     the per-student partial UNIQUE: a cross-table exclusivity rule has no home in Postgres without a
--     trigger, and business logic never goes in a trigger.
--   • `bed_id` is composite (school_id, bed_id) → sickbay_bed, ON DELETE **RESTRICT** (the shipped
--     invoice_discount_application.discountFk precedent). R8 retires a bed with active=false and never
--     DELETEs one, so RESTRICT is a backstop, not a workflow.
--   • R64 — four DELIBERATE BUILD_STACK deviations, each an omission: NO `vitals_json` (a blob cannot
--     carry per-reading taken_by_user_id, cannot be time-indexed, cannot be append-only); NO
--     `discharged_at` on the VISIT (superseded by disposition_at + the admission's own discharged_at —
--     two end-stamps for one fact can disagree); NO `tier_fired` / `parent_notified_at` (a
--     notification column with no chain to fire it is a stub — 0060/INCR-26); NO generated `visit_ref`
--     (three facts already on the row, in a format the surfaces contradict four ways).
--   • NO TRIGGERS (portability): the disposition preconditions (R34), the ADMIT + admission single
--     transaction (R35), disposition immutability (R36), void-only-while-open (R37), the Mode-C
--     server-side ADMIT refusal (R55) and the attendance-M hook (R46, best-effort and deliberately
--     OUTSIDE the clinical transaction, R54) all live in lib/sickbay/ and lib/attendance/.

-- ---- enums needed by the new tables ----
DO $$ BEGIN
  CREATE TYPE "public"."sickbay_disposition" AS ENUM('DISCHARGE', 'ADMIT', 'REFER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."sickbay_consult_mode" AS ENUM('PHONE', 'IN_PERSON');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- table 1: sickbay_visit (TENANT — the PARENT; its tenant UK is INLINE and must precede every FK) ----
CREATE TABLE IF NOT EXISTS "sickbay_visit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "presented_at" timestamp with time zone NOT NULL,
  "presenting_complaint" text NOT NULL,
  "intake_reported_by" text,
  "recorded_by_user_id" uuid,
  "started_at" timestamp with time zone,
  "attending_user_id" uuid,
  "working_impression" text,
  "red_flags_screened" text,
  "hydration_status" text,
  "plan" text,
  "escalation_triggers" text,
  "assessed_at" timestamp with time zone,
  "disposition" "sickbay_disposition",
  "disposition_at" timestamp with time zone,
  "voided_at" timestamp with time zone,
  "voided_by_user_id" uuid,
  "void_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sickbay_visit_tenant_uk" UNIQUE("school_id","id")
);

-- ---- table 2: sickbay_vital_reading (TENANT, LEAF, APPEND-ONLY — note the absent updated_at) ----
CREATE TABLE IF NOT EXISTS "sickbay_vital_reading" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "visit_id" uuid NOT NULL,
  "taken_at" timestamp with time zone NOT NULL,
  "taken_by_user_id" uuid,
  "context" text,
  "temp_c" numeric(3, 1),
  "systolic" smallint,
  "diastolic" smallint,
  "pulse_bpm" smallint,
  "spo2_pct" smallint,
  "pain_score" smallint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ---- table 3: sickbay_admission (TENANT — inline UNIQUE(school_id,visit_id) + the FORWARD-DECLARED tenant UK) ----
CREATE TABLE IF NOT EXISTS "sickbay_admission" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "visit_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "bed_id" uuid NOT NULL,
  "admitted_at" timestamp with time zone NOT NULL,
  "admitted_by_user_id" uuid,
  "is_isolation" boolean DEFAULT false NOT NULL,
  "expected_discharge_at" timestamp with time zone,
  "discharge_criteria" text,
  "overnight_plan" text,
  "discharged_at" timestamp with time zone,
  "discharged_by_user_id" uuid,
  "discharge_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sickbay_admission_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "uniq_sickbay_admission_visit" UNIQUE("school_id","visit_id")
);

-- ---- table 4: sickbay_doctor_consult (TENANT, LEAF, APPEND-ONLY — no updated_at; a correction is a 2nd row) ----
CREATE TABLE IF NOT EXISTS "sickbay_doctor_consult" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "visit_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "mode" "sickbay_consult_mode" NOT NULL,
  "clinician_name" text NOT NULL,
  "clinician_affiliation" text,
  "note" text NOT NULL,
  "recorded_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ---- foreign keys — ALL FOUR CREATE TABLEs above are complete, so every composite target
-- (sickbay_visit_tenant_uk here, sickbay_bed_tenant_uk from 0056, students_tenant_uk from 0033) exists.
-- ⚠ Constraint NAMES are the drizzle-generated ones, so this paste and `drizzle-kit migrate` produce a
-- byte-identical catalog (verified by pg_dump diff). Postgres truncates identifiers at 63 chars — the
-- three longest names below are written PRE-truncation exactly as drizzle emits them; Postgres
-- truncates them identically on both paths (it raises a NOTICE, not an error). ----
DO $$ BEGIN
  ALTER TABLE "sickbay_visit" ADD CONSTRAINT "sickbay_visit_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_visit" ADD CONSTRAINT "sickbay_visit_recorded_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_visit" ADD CONSTRAINT "sickbay_visit_attending_user_id_ref_user_id_fk"
    FOREIGN KEY ("attending_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_visit" ADD CONSTRAINT "sickbay_visit_voided_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Composite intra-tenant FK — a cross-tenant student reference is structurally impossible.
DO $$ BEGIN
  ALTER TABLE "sickbay_visit" ADD CONSTRAINT "sickbay_visit_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sickbay_vital_reading" ADD CONSTRAINT "sickbay_vital_reading_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_vital_reading" ADD CONSTRAINT "sickbay_vital_reading_taken_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("taken_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ⚠ consumes sickbay_visit_tenant_uk (created INLINE above).
DO $$ BEGIN
  ALTER TABLE "sickbay_vital_reading" ADD CONSTRAINT "sickbay_vital_reading_school_id_visit_id_sickbay_visit_school_id_id_fk"
    FOREIGN KEY ("school_id","visit_id") REFERENCES "public"."sickbay_visit"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sickbay_admission" ADD CONSTRAINT "sickbay_admission_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_admission" ADD CONSTRAINT "sickbay_admission_admitted_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("admitted_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_admission" ADD CONSTRAINT "sickbay_admission_discharged_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("discharged_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ⚠ consumes sickbay_visit_tenant_uk (created INLINE above).
DO $$ BEGIN
  ALTER TABLE "sickbay_admission" ADD CONSTRAINT "sickbay_admission_school_id_visit_id_sickbay_visit_school_id_id_fk"
    FOREIGN KEY ("school_id","visit_id") REFERENCES "public"."sickbay_visit"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_admission" ADD CONSTRAINT "sickbay_admission_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ⚠ consumes sickbay_bed_tenant_uk — authored a migration EARLY, in 0056, for exactly this FK. RESTRICT.
DO $$ BEGIN
  ALTER TABLE "sickbay_admission" ADD CONSTRAINT "sickbay_admission_school_id_bed_id_sickbay_bed_school_id_id_fk"
    FOREIGN KEY ("school_id","bed_id") REFERENCES "public"."sickbay_bed"("school_id","id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sickbay_doctor_consult" ADD CONSTRAINT "sickbay_doctor_consult_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_doctor_consult" ADD CONSTRAINT "sickbay_doctor_consult_recorded_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ⚠ consumes sickbay_visit_tenant_uk (created INLINE above).
DO $$ BEGIN
  ALTER TABLE "sickbay_doctor_consult" ADD CONSTRAINT "sickbay_doctor_consult_school_id_visit_id_sickbay_visit_school_id_id_fk"
    FOREIGN KEY ("school_id","visit_id") REFERENCES "public"."sickbay_visit"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
-- R58's three exclusivity invariants are PARTIAL UNIQUE indexes: closed/voided/discharged rows are
-- exempt via the WHERE, so a student may have any number of PAST visits and bed 3 is reusable forever,
-- while a second LIVE one is rejected by the database rather than by a lost race in application code.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_sickbay_open_visit_student"
  ON "sickbay_visit" USING btree ("school_id","student_id")
  WHERE "disposition" IS NULL AND "voided_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_sickbay_open_admission_bed"
  ON "sickbay_admission" USING btree ("school_id","bed_id")
  WHERE "discharged_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_sickbay_open_admission_student"
  ON "sickbay_admission" USING btree ("school_id","student_id")
  WHERE "discharged_at" IS NULL;
-- Read paths. The queue and "recent visits · 24h" are both windows on presented_at within a school;
-- the two child tables are always read as "this visit's rows, in time order". sickbay_admission needs
-- no extra index — uniq_sickbay_admission_visit and the two partial uniques already lead with
-- school_id and cover its by-visit, by-bed and by-student reads.
CREATE INDEX IF NOT EXISTS "sickbay_visit_presented_idx"
  ON "sickbay_visit" USING btree ("school_id","presented_at");
CREATE INDEX IF NOT EXISTS "sickbay_vital_reading_visit_idx"
  ON "sickbay_vital_reading" USING btree ("school_id","visit_id","taken_at");
CREATE INDEX IF NOT EXISTS "sickbay_doctor_consult_visit_idx"
  ON "sickbay_doctor_consult" USING btree ("school_id","visit_id","occurred_at");

-- ---- RLS — all FOUR tables: ENABLE + FORCE + tenant_isolation (the standard tenant policy) ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (these four names are
-- added to that hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query that
-- forgets to set app.current_school returns ZERO rows — it fails safe rather than leaking a child's
-- complaint, impression or vitals to another school.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'sickbay_visit',
    'sickbay_vital_reading',
    'sickbay_admission',
    'sickbay_doctor_consult'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO public '
      'USING (current_setting(''app.bypass_rls'', true) = ''on'' '
      '  OR school_id = NULLIF(current_setting(''app.current_school'', true), '''')::uuid) '
      'WITH CHECK (current_setting(''app.bypass_rls'', true) = ''on'' '
      '  OR school_id = NULLIF(current_setting(''app.current_school'', true), '''')::uuid);',
      tbl
    );
  END LOOP;
END
$$;

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0056 ----
-- Owner decision D8: a parent NEVER sees sickbay in module 4.4, so all four tables must be denied —
-- and at 0057 that matters far more than it did at 0056, because these rows are the child's clinical
-- record rather than the school's bed count. (The parent half of sickbay is the deliberate Tier-2
-- chain at INCR-26, not an accidental RLS hole here.) This loop is NOT a hand-list: it applies
-- parent_deny to every FORCE-RLS + school_id table that lacks a parent_scope policy — which, after the
-- block above, is exactly the four new tables plus the ones already covered (it re-creates their
-- identical policy, hence idempotent). It is re-run here rather than hand-listing the four because
-- that is what keeps a future sickbay table auto-denied. RESTRICTIVE is load-bearing: Postgres OR's
-- PERMISSIVE policies, so a permissive parent policy would OR with tenant_isolation and hand a claimed
-- parent the entire school.
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r'
      AND c.relforcerowsecurity
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = c.relname
          AND col.column_name = 'school_id'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_policy p
        WHERE p.polrelid = c.oid AND p.polname = 'parent_scope'
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS parent_deny ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY parent_deny ON %I AS RESTRICTIVE FOR ALL TO public '
      'USING (NULLIF(current_setting(''app.current_parent_user'', true), '''') IS NULL);',
      tbl
    );
  END LOOP;
END
$$;
