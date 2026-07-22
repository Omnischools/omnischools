-- Omnischools — migration 0058: SICKBAY CHRONIC REGISTER (SHS module 4.4 / INCR-23a). THREE new
-- enums + FOUR new tenant tables + tenant_isolation + parent_deny + THE THIRD RLS BOUNDARY
-- (`staff_grant_scope`, the per-staff grant family). ZERO altered columns, zero backfills.
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD after merging.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN. `db:policies` configures LOCAL DEV ONLY. Without this paste the
-- four tables exist on prod with **NO row-level security at all**: no ENABLE, no FORCE, no
-- tenant_isolation, no parent_deny, and no grant boundary. 0057 was the acute episode; **0058 is the
-- LONGITUDINAL record** — that a named 15-year-old has sickle cell disease HbSS, epilepsy, a peanut
-- anaphylaxis, type-1 diabetes, or an adjustment disorder with anxiety features in the context of
-- bereavement; the drug and dose she takes at 06:30 every morning; the emergency protocol; the
-- external mental-health unit that holds her case. Without the paste all of it is readable **and
-- writable** from every other school's session, a claimed parent reads it too (owner decision D8),
-- and — uniquely to this migration — **every member of staff in the school reads it**, because the
-- register's route is deliberately open to all staff and the reader's gate is the ONLY clinical
-- boundary (R117). A missed paste here does not leak a bed count; it hands a school's entire
-- adolescent mental-health register to whoever logs in next.
--
-- ⚠ SECOND, EASILY-MISSED HALF: the `parent_deny` loop at the bottom is NOT decoration. It is the
-- catalog-driven loop from policies.sql, re-run so the four NEW tables are picked up. Skip it and
-- every chronic care plan is readable by a claimed parent session on prod until someone runs
-- `db:policies` — which never runs against prod at all.
--
-- Verify afterwards with db/sql/verify-prod-rls.sql — Query 1 must return ZERO ROWS and Query 2's
-- tenant_tables must have risen by exactly 4 (with parent_denied up 4). Then, additionally, confirm
-- the grant family landed:
--   select c.relname, p.polname, p.polcmd, p.polpermissive
--   from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname like 'sickbay_chronic%' order by 1, 2;
-- Expect 15 rows: all four tables with tenant_isolation (permissive) + parent_deny + staff_grant_scope
-- (both restrictive), and staff_grant_delete on entry/med/grant.
--
-- SCOPE: NEW-TABLE-ONLY — no ALTERs, no backfills, no data changes, no seed, no GLOBAL-table changes.
-- It adds NO medication-administration (MAR), referral, notification or NHIS table (INCR-24/25/26 own
-- those). Four tables, three enums, nothing else.
--
-- 🔴 DDL ORDER — THE 0033 HAZARD, INSIDE ONE MIGRATION (as 0057). `sickbay_chronic_entry_tenant_uk`
-- UNIQUE(school_id, id) is the composite-FK target of THREE tables created in this SAME file
-- (sickbay_chronic_med, sickbay_chronic_grant, sickbay_chronic_read). drizzle-kit runs a migration's
-- statements in ONE transaction and SWALLOWS the error, so an FK emitted ahead of the UNIQUE it needs
-- fails silently: rollback, exit 1, no message. The order below is strict and load-bearing:
--   enums → CREATE TABLE ×4 (each carrying its PK/UNIQUE/CHECK **INLINE**) → foreign keys → indexes
--   → RLS → the three SECURITY DEFINER helpers → the grant policies → parent_deny.
-- Every composite-FK target exists before the FK that references it:
--   • sickbay_chronic_entry_tenant_uk — INLINE in CREATE TABLE, i.e. before the whole FK section.
--   • sickbay_chronic_med_tenant_uk   — INLINE too. Nothing references it YET; it is authored NOW
--     because INCR-24's MAR row will point at the prescription it administered (the 0056
--     sickbay_bed_tenant_uk / 0057 sickbay_admission_tenant_uk precedent — create the UNIQUE a
--     migration AHEAD of the FK, never in the same one).
--   • sickbay_schedule_slot_tenant_uk — shipped in **0056**, for sickbay_chronic_med.slot_id.
--   • house_tenant_uk / students_tenant_uk — shipped in 0033.
--   • ref_school PK / ref_user PK     — shipped in 0001.
--
-- 🔴 ONE APP-SIDE PRECONDITION, NOT A DB ONE (R100). `sickbay_chronic_med.slot_id` is ON DELETE
-- **RESTRICT** (SET NULL would silently orphan a dose from its round — a student quietly stops being
-- dosed, with no error anywhere). The shipped `resetScheduleSlots` action is a hard DELETE that
-- changes every slot id, so after this migration "Reset to defaults" HARD-FAILS for any school with a
-- medication schedule. It must become a reconcile/update-in-place in the same release. That is why
-- R100 moves the obligation forward from INCR-24 to 23a.
--
-- CONSTRAINT notes (Kofi rulings R91–R127, 2026-07-22):
--   • R91 — the register is its own table because `student_health_record.student_id` carries a GLOBAL
--     UNIQUE: sickle cell AND asthma is inexpressible there. That table is not migrated, not
--     dual-written; a plan PREFILLS from it and never links to it.
--   • R93/R94 — exactly 4 tables. `chronic_condition` is BUILD_STACK L346 VERBATIM (7 values) and is
--     the ONLY structured clinical vocabulary in module 4.4; the no-EMR ceiling is enforced by
--     `OTHER` + free text, never by widening the enum. R43's ban stands: the string `diagnos` appears
--     in no column, enum, type, index, constraint or policy name this migration ships.
--   • R95 — status is THREE values. `REFERRAL_MANAGED` is deliberately NOT one: as an enum value it
--     forces a referral-managed student in CRISIS to choose, and crisis wins, silently erasing "we do
--     not treat this on-site" at the one moment it matters. It is the independent boolean below.
--   • R96 — `MENTAL_HEALTH ⇒ (on_site_treatable false, referral_managed true)` is a DB CHECK: product
--     policy, identical for every school, and a SINGLE-ROW check is not the cross-table trigger the
--     J3 rule forbids. R99 — `is_prn` XOR `slot_id`. R109 — `DIRECTIVE` ⇒ `directive_note NOT NULL`.
--   • R97/R98/R103 — NO protocol-step table (one `emergency_protocol` text column in the matron's own
--     words), NO version table and NO superseded rows (`version` is a counter; the history is the
--     shipped audit_log — which owner decision D5.1 acknowledges makes audit_log a clinical record
--     store), and the dorm-side card is SEPARATELY AUTHORED (`triggers` / `red_flags` /
--     `first_action`) rather than a redaction of the clinical tier. That deletes the whole class of
--     redaction bug: a scope becomes a fixed key-set, not a substring judgement at render time.
--   • R107 — grants AUTO-EXPIRE but never AUTO-GRANT. "Grants auto-transfer to the new housemaster"
--     LOSES: six students' medical records landing on a man the day he changes job, with no matron
--     decision and no audit event, is the boundary this increment exists to build. The auto-EXPIRE
--     half costs one nullable `house_id`: a house-tied grant is live iff the grantee is still that
--     House's HM and the student is still in that House.
--   • R110 — append-only: revoke never deletes, and a scope change is revoke + re-grant, never an
--     UPDATE. ⚠ There is deliberately NO "one live grant" partial unique: liveness depends on `now()`,
--     which is not immutable and cannot appear in an index predicate, and the fallback
--     `WHERE revoked_at IS NULL` is WORSE than nothing — an EXPIRED grant is not a revoked one, so a
--     lawful re-grant in August would be rejected against July's dead row.
--   • R121/R122 — the read audit is its own table, deduped by UNIQUE(school_id, entry_id,
--     actor_user_id, read_on) + ON CONFLICT DO NOTHING (one insert, no read-before-write, no race),
--     and it stores IDS AND A SCOPE — never a condition string.
--   • R127 — NO NHIS column (D3's shape is INCR-25's; the card in the referral log is the MOTHER's),
--     NO external-visit log table and no VLC link (the module is unbuilt — the DMHU facts live in the
--     four external-care TEXT columns, and a case id, if typed, is a matron's string inside
--     `external_pastoral_home`, never a join).
--   • NO TRIGGERS (portability): `on_site_treatable = false ⇒ zero med rows` (R102), grant/revoke
--     being MATRON-only (R111), the read-audit write (R121) and the version bump (R103) all live in
--     lib/sickbay/ and lib/actions/.

-- ---- enums needed by the new tables ----
DO $$ BEGIN
  CREATE TYPE "public"."chronic_condition" AS ENUM('SICKLE_CELL', 'ASTHMA', 'EPILEPSY', 'ALLERGY', 'MENTAL_HEALTH', 'DIABETES', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."chronic_status" AS ENUM('STABLE', 'MONITOR', 'ACTIVE_CRISIS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."sickbay_grant_scope" AS ENUM('FULL_PLAN', 'PARTIAL', 'DIRECTIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- table 1: sickbay_chronic_entry (TENANT — the PARENT; its tenant UK is INLINE and must precede every FK) ----
CREATE TABLE IF NOT EXISTS "sickbay_chronic_entry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "condition" "chronic_condition" NOT NULL,
  "condition_label" text,
  "condition_detail" text,
  "status" "chronic_status" DEFAULT 'STABLE' NOT NULL,
  "on_site_treatable" boolean DEFAULT true NOT NULL,
  "referral_managed" boolean DEFAULT false NOT NULL,
  "baseline_status" text,
  "care_goals" text,
  "emergency_protocol" text,
  "discharge_criteria" text,
  "triggers" text,
  "red_flags" text,
  "first_action" text,
  "external_clinical_home" text,
  "external_pastoral_home" text,
  "external_care_cadence" text,
  "external_next_visit_at" timestamp with time zone,
  "version" smallint DEFAULT 1 NOT NULL,
  "reviewed_at" timestamp with time zone,
  "reviewed_by_user_id" uuid,
  "co_reviewer_note" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sickbay_chronic_entry_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "chronic_mental_health_referral_managed" CHECK ("sickbay_chronic_entry"."condition" <> 'MENTAL_HEALTH' OR ("sickbay_chronic_entry"."on_site_treatable" = false AND "sickbay_chronic_entry"."referral_managed" = true))
);

-- ---- table 2: sickbay_chronic_grant (TENANT — the row the third boundary reads) ----
CREATE TABLE IF NOT EXISTS "sickbay_chronic_grant" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "entry_id" uuid NOT NULL,
  "grantee_user_id" uuid NOT NULL,
  "scope" "sickbay_grant_scope" NOT NULL,
  "scope_label" text,
  "reason" text,
  "directive_note" text,
  "house_id" uuid,
  "granted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "granted_by_user_id" uuid,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revoked_by_user_id" uuid,
  CONSTRAINT "chronic_grant_directive_needs_note" CHECK ("sickbay_chronic_grant"."scope" <> 'DIRECTIVE' OR "sickbay_chronic_grant"."directive_note" IS NOT NULL)
);

-- ---- table 3: sickbay_chronic_med (TENANT — the FORWARD-DECLARED tenant UK is INLINE) ----
CREATE TABLE IF NOT EXISTS "sickbay_chronic_med" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "entry_id" uuid NOT NULL,
  "drug_name" text NOT NULL,
  "dose_label" text NOT NULL,
  "is_prn" boolean DEFAULT false NOT NULL,
  "slot_id" uuid,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sickbay_chronic_med_tenant_uk" UNIQUE("school_id","id"),
  CONSTRAINT "uniq_sickbay_chronic_med_dose" UNIQUE("school_id","entry_id","drug_name","slot_id"),
  CONSTRAINT "chronic_med_prn_xor_slot" CHECK ("sickbay_chronic_med"."is_prn" = ("sickbay_chronic_med"."slot_id" IS NULL))
);

-- ---- table 4: sickbay_chronic_read (TENANT, LEAF, APPEND-ONLY — no updated_at; the UNIQUE IS the dedupe) ----
CREATE TABLE IF NOT EXISTS "sickbay_chronic_read" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "entry_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "read_on" date NOT NULL,
  "scope" "sickbay_grant_scope",
  "read_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_sickbay_chronic_read_day" UNIQUE("school_id","entry_id","actor_user_id","read_on")
);

-- ---- foreign keys — ALL FOUR CREATE TABLEs above are complete, so every composite target exists.
-- ⚠ Constraint NAMES are the drizzle-generated ones, so this paste and `drizzle-kit migrate` produce a
-- byte-identical catalog. Postgres truncates identifiers at 63 chars — the four longest names below
-- are written PRE-truncation exactly as drizzle emits them; Postgres truncates them identically on
-- both paths (it raises a NOTICE, not an error) and the truncations stay distinct. ----
DO $$ BEGIN
  ALTER TABLE "sickbay_chronic_entry" ADD CONSTRAINT "sickbay_chronic_entry_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_chronic_entry" ADD CONSTRAINT "sickbay_chronic_entry_reviewed_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Composite intra-tenant FK — a cross-tenant student reference is structurally impossible.
DO $$ BEGIN
  ALTER TABLE "sickbay_chronic_entry" ADD CONSTRAINT "sickbay_chronic_entry_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sickbay_chronic_grant" ADD CONSTRAINT "sickbay_chronic_grant_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- The grantee is NOT NULL, so CASCADE rather than SET NULL: a deleted user must not leave grants
-- behind as unreadable stubs. R106 — a STUDENT or PARENT may never hold one (app-layer isStaff()).
DO $$ BEGIN
  ALTER TABLE "sickbay_chronic_grant" ADD CONSTRAINT "sickbay_chronic_grant_grantee_user_id_ref_user_id_fk"
    FOREIGN KEY ("grantee_user_id") REFERENCES "public"."ref_user"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_chronic_grant" ADD CONSTRAINT "sickbay_chronic_grant_granted_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_chronic_grant" ADD CONSTRAINT "sickbay_chronic_grant_revoked_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ⚠ consumes sickbay_chronic_entry_tenant_uk (created INLINE above).
DO $$ BEGIN
  ALTER TABLE "sickbay_chronic_grant" ADD CONSTRAINT "sickbay_chronic_grant_school_id_entry_id_sickbay_chronic_entry_school_id_id_fk"
    FOREIGN KEY ("school_id","entry_id") REFERENCES "public"."sickbay_chronic_entry"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- R107's house tie — composite, so an HM-tied grant can never name a foreign school's House.
DO $$ BEGIN
  ALTER TABLE "sickbay_chronic_grant" ADD CONSTRAINT "sickbay_chronic_grant_school_id_house_id_house_school_id_id_fk"
    FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sickbay_chronic_med" ADD CONSTRAINT "sickbay_chronic_med_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ⚠ consumes sickbay_chronic_entry_tenant_uk (created INLINE above).
DO $$ BEGIN
  ALTER TABLE "sickbay_chronic_med" ADD CONSTRAINT "sickbay_chronic_med_school_id_entry_id_sickbay_chronic_entry_school_id_id_fk"
    FOREIGN KEY ("school_id","entry_id") REFERENCES "public"."sickbay_chronic_entry"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ⚠ consumes sickbay_schedule_slot_tenant_uk (shipped in 0056). RESTRICT, NOT SET NULL — see R100 above.
DO $$ BEGIN
  ALTER TABLE "sickbay_chronic_med" ADD CONSTRAINT "sickbay_chronic_med_school_id_slot_id_sickbay_schedule_slot_school_id_id_fk"
    FOREIGN KEY ("school_id","slot_id") REFERENCES "public"."sickbay_schedule_slot"("school_id","id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sickbay_chronic_read" ADD CONSTRAINT "sickbay_chronic_read_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sickbay_chronic_read" ADD CONSTRAINT "sickbay_chronic_read_actor_user_id_ref_user_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."ref_user"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- ⚠ consumes sickbay_chronic_entry_tenant_uk (created INLINE above).
DO $$ BEGIN
  ALTER TABLE "sickbay_chronic_read" ADD CONSTRAINT "sickbay_chronic_read_school_id_entry_id_sickbay_chronic_entry_school_id_id_fk"
    FOREIGN KEY ("school_id","entry_id") REFERENCES "public"."sickbay_chronic_entry"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- indexes ----
-- ONE LIVE PLAN PER (student × condition) — partial unique, the R58 idiom, because an app check loses
-- the concurrent double-create race and two live SCD plans for one girl means two contradictory
-- emergency protocols. Retired plans (active=false) are exempt, and `OTHER` is EXEMPT because it is
-- R94's escape hatch for everything outside the seven values (coeliac AND hypertension is legitimate).
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_sickbay_chronic_entry_condition"
  ON "sickbay_chronic_entry" USING btree ("school_id","student_id","condition")
  WHERE "sickbay_chronic_entry"."active" AND "sickbay_chronic_entry"."condition" <> 'OTHER';
-- Read paths. The register list, the R123 queue marker and the R124 visit-record chips are all
-- windows keyed on (school_id[, student_id]).
CREATE INDEX IF NOT EXISTS "sickbay_chronic_entry_student_idx"
  ON "sickbay_chronic_entry" USING btree ("school_id","student_id");
CREATE INDEX IF NOT EXISTS "sickbay_chronic_grant_entry_idx"
  ON "sickbay_chronic_grant" USING btree ("school_id","entry_id");
-- THE HOT PATH: the RLS predicate's grant arm, read on every query against every chronic table.
CREATE INDEX IF NOT EXISTS "sickbay_chronic_grant_grantee_idx"
  ON "sickbay_chronic_grant" USING btree ("school_id","grantee_user_id");
-- INCR-24's "who is due at 06:30", and the RESTRICT check on every schedule-slot delete (Postgres
-- does not index a FK automatically, and an unindexed RESTRICT target is a seq scan of every
-- prescription in the school on every schedule edit).
CREATE INDEX IF NOT EXISTS "sickbay_chronic_med_slot_idx"
  ON "sickbay_chronic_med" USING btree ("school_id","slot_id");
-- sickbay_chronic_read needs no extra index — uniq_sickbay_chronic_read_day leads with
-- (school_id, entry_id) and serves the §04 trail.

-- ---- RLS layer 1 — all FOUR tables: ENABLE + FORCE + tenant_isolation ----
-- Byte-identical in effect to the tenant_isolation loop in db/sql/policies.sql (these four names are
-- added to that hardcoded array in the same commit). FORCE means the owner is NOT exempt: a query
-- that forgets to set app.current_school returns ZERO rows.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'sickbay_chronic_entry',
    'sickbay_chronic_med',
    'sickbay_chronic_grant',
    'sickbay_chronic_read'
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

-- ============================================================================================
-- RLS layer 3 — THE THIRD BOUNDARY. Per-staff, per-ENTRY, DENY-BY-DEFAULT.
-- Identical to the block at the bottom of db/sql/policies.sql; keep the two in sync.
--
-- MECHANISM. lib/db/rls.ts → withStaffScope(schoolId, userId) sets `app.current_school` AND
-- `app.current_staff_user`, and wraps READS **AND WRITES**.
--
-- 🔴 POLARITY. The parent family (0055) reads `pu IS NULL OR <rule>` — PERMIT by default, correct
-- there because those tables' default audience IS all staff. This family reads
-- `su IS NOT NULL AND <rule>` — DENY by default, because the chronic tables have NO default audience.
-- The register's route is deliberately open to all staff (R117) and the reader's gate is the only
-- clinical boundary, so `su IS NULL ⇒ permit` would mean one forgotten seam hands a HOUSEMASTER the
-- whole register; deny-by-default turns the same bug into an empty page. PR #176 is the demonstrated
-- version of that hazard. Do not "fix" the asymmetry.
--
-- ⚠ NO POLICY CYCLES. RLS applies to tables referenced inside a policy expression, INCLUDING inside a
-- SECURITY DEFINER function (FORCE binds the owner too), so "policy on A reads B while B's policy
-- reads A" is an infinite recursion at runtime. The graph below is acyclic and must stay so:
--   entry → chronic_entry_readable → grant → role_assignment;  med/read → chronic_entry_ids → entry;
--   grant → role_assignment ONLY.
-- That last line is why the grant table's rule is "a default clinical reader, OR your own grant row"
-- rather than "an entry you may read". Recorded consequence: a HEADMASTER can see that a grant EXISTS
-- against a MENTAL_HEALTH entry he cannot read (the grant row carries no student, name or condition).
-- R116's "no signal a sixth exists" is enforced structurally on the REGISTER, and on §04 by the
-- reader's INNER JOIN to the entry.
-- ============================================================================================

-- ---- helper 1: which DEFAULT clinical tier does this staff user hold? ----
-- SECURITY DEFINER because it joins the GLOBAL ref_role, which carries bare ENABLE RLS and NO policy:
-- a non-owner role reads ZERO rows from it, so an inline join would silently evaluate to "no role"
-- for the very session it is meant to authorise. The date window is byte-equivalent to
-- lib/auth/roles.ts isCurrentlyActive() — BOTH endpoints inclusive.
CREATE OR REPLACE FUNCTION chronic_clinical_role(school uuid, su uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT CASE
           WHEN bool_or(r.code = 'MATRON')     THEN 'MATRON'
           WHEN bool_or(r.code = 'HEADMASTER') THEN 'HEADMASTER'
         END
  FROM role_assignment ra
  JOIN ref_role r ON r.id = ra.role_id
  WHERE ra.user_id = su
    AND ra.school_id = school
    AND ra.start_date <= current_date
    AND (ra.end_date IS NULL OR ra.end_date >= current_date)
$$;

-- ---- helper 2: THE PREDICATE. May `su` read THIS entry? ----
-- Written ONCE and used at every enforcement point (R113: one predicate, two enforcement points,
-- zero divergence). It takes the entry's id/student/condition as ARGUMENTS rather than reading the
-- entry table, because the policy that calls it IS the entry table's policy.
--   (a) MATRON     → every entry in the school.
--   (b) HEADMASTER → every entry EXCEPT MENTAL_HEALTH (R116, structural: his SQL cannot return the
--       row whatever the reader does — he is the school's disciplinary authority, and a psychiatric
--       history in his default read is the adjacency that makes an adolescent not disclose).
--   (c) a live GRANT on THIS entry (R105 — per entry, never per student): not revoked, not expired
--       against the DB's own now() IN THIS TRANSACTION (R114), and — when house-tied (R107) — the
--       grantee is still that House's HM and the student is still in that House.
CREATE OR REPLACE FUNCTION chronic_entry_readable(
    school uuid, su uuid, entry uuid, student uuid, cond chronic_condition)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT su IS NOT NULL AND (
    chronic_clinical_role(school, su) = 'MATRON'
    OR (chronic_clinical_role(school, su) = 'HEADMASTER' AND cond <> 'MENTAL_HEALTH')
    OR EXISTS (
      SELECT 1
      FROM sickbay_chronic_grant g
      WHERE g.school_id = school
        AND g.entry_id = entry
        AND g.grantee_user_id = su
        AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR g.expires_at > now())
        AND (
          g.house_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM house h
            JOIN students s ON s.school_id = h.school_id AND s.id = student
            WHERE h.school_id = school
              AND h.id = g.house_id
              AND h.hm_user_id = su
              AND s.house_id = g.house_id
          )
        )
    )
  )
$$;

-- ---- helper 3: the readable entry ids, as a set ----
-- A thin projection of helper 2 over the entry table — the child tables carry no `condition` of their
-- own, so they reach the discriminator through the entry. THIS is the function the reader calls
-- (R113): the row filter in lib/ MUST be this same predicate pushed into SQL inside the same
-- withStaffScope transaction. Never over-fetch then filter in TS; never a per-row hasGrant (R68's
-- N+1). ⚠ A naive `EXISTS (SELECT 1 FROM sickbay_chronic_grant …)` in the reader does NOT work: RLS
-- applies to the reader's own subquery.
CREATE OR REPLACE FUNCTION chronic_entry_ids(school uuid, su uuid)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT e.id
  FROM sickbay_chronic_entry e
  WHERE e.school_id = school
    AND chronic_entry_readable(school, su, e.id, e.student_id, e.condition)
$$;

-- ---- the four staff_grant_scope policies ----
-- Each carries the `app.bypass_rls` arm FIRST and byte-identical to tenant_isolation's, so seeds, ETL
-- and withoutTenantScope behave as on every other table. The functions are given the GUC rather than
-- the row's school_id, which keeps the id sub-select UNCORRELATED — Postgres evaluates it ONCE per
-- query (a hashed SubPlan) instead of once per row. It is exactly equivalent: tenant_isolation
-- already forces school_id = the GUC on every row that can survive.

-- 1) the care plan itself. USING = the predicate. WITH CHECK is DELIBERATELY DIFFERENT and must be: a
-- WITH CHECK is evaluated on the NEW row BEFORE it exists, so any "you may read this entry" rule is
-- FALSE for every INSERT and no matron could ever create a care plan. The actor-shaped write rule
-- also stops a FULL_PLAN grantee from EDITING the plan he was shown.
DROP POLICY IF EXISTS staff_grant_scope ON sickbay_chronic_entry;
CREATE POLICY staff_grant_scope ON sickbay_chronic_entry AS RESTRICTIVE FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND chronic_entry_readable(
            NULLIF(current_setting('app.current_school', true), '')::uuid,
            NULLIF(current_setting('app.current_staff_user', true), '')::uuid,
            id, student_id, condition)
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND chronic_clinical_role(
            NULLIF(current_setting('app.current_school', true), '')::uuid,
            NULLIF(current_setting('app.current_staff_user', true), '')::uuid) IS NOT NULL
    )
  );

-- 2) the medication schedule — drug names are the most re-identifying string in the module
-- (hydroxyurea ⇒ sickle cell). Reachable exactly when its entry is; writable only by a clinical
-- reader, so a grantee cannot inject or edit a dose.
DROP POLICY IF EXISTS staff_grant_scope ON sickbay_chronic_med;
CREATE POLICY staff_grant_scope ON sickbay_chronic_med AS RESTRICTIVE FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND entry_id IN (
        SELECT chronic_entry_ids(
          NULLIF(current_setting('app.current_school', true), '')::uuid,
          NULLIF(current_setting('app.current_staff_user', true), '')::uuid)
      )
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND chronic_clinical_role(
            NULLIF(current_setting('app.current_school', true), '')::uuid,
            NULLIF(current_setting('app.current_staff_user', true), '')::uuid) IS NOT NULL
      AND entry_id IN (
        SELECT chronic_entry_ids(
          NULLIF(current_setting('app.current_school', true), '')::uuid,
          NULLIF(current_setting('app.current_staff_user', true), '')::uuid)
      )
    )
  );

-- 3) the grants themselves (R122 — §04 is clinical-reader-only: a grantee must never learn who ELSE
-- knows). A grantee sees his OWN grant row and nothing else — the student_guardian/parent_scope
-- idiom, and REQUIRED rather than a courtesy: helper 2 reads this table to evaluate his entitlement,
-- so a blanket clinical-only rule here would make every grant self-defeating (R113's trap). WITH
-- CHECK excludes him from writing, which is what makes X10/X11 hold at the DB layer: he can neither
-- self-issue a grant nor extend his own expiry.
DROP POLICY IF EXISTS staff_grant_scope ON sickbay_chronic_grant;
CREATE POLICY staff_grant_scope ON sickbay_chronic_grant AS RESTRICTIVE FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND (
        chronic_clinical_role(
          NULLIF(current_setting('app.current_school', true), '')::uuid,
          NULLIF(current_setting('app.current_staff_user', true), '')::uuid) IS NOT NULL
        OR grantee_user_id = NULLIF(current_setting('app.current_staff_user', true), '')::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND chronic_clinical_role(
            NULLIF(current_setting('app.current_school', true), '')::uuid,
            NULLIF(current_setting('app.current_staff_user', true), '')::uuid) IS NOT NULL
    )
  );

-- 4) the read audit (R121/R122). ASYMMETRIC ON PURPOSE: every reader must be able to WRITE his own
-- open (the matron's own opens are audited too), but only a clinical reader may READ the trail — a
-- grantee learning who else opened the plan is the leak R122 names. Because USING governs SELECT,
-- UPDATE and DELETE while WITH CHECK governs INSERT, this single policy also makes the trail
-- append-only against a grantee: he can add his own row and can neither read, alter nor delete one.
-- ⚠ The reader's insert must therefore NOT use RETURNING (RETURNING needs SELECT). ON CONFLICT DO
-- NOTHING does not.
DROP POLICY IF EXISTS staff_grant_scope ON sickbay_chronic_read;
CREATE POLICY staff_grant_scope ON sickbay_chronic_read AS RESTRICTIVE FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND chronic_clinical_role(
            NULLIF(current_setting('app.current_school', true), '')::uuid,
            NULLIF(current_setting('app.current_staff_user', true), '')::uuid) IS NOT NULL
      AND entry_id IN (
        SELECT chronic_entry_ids(
          NULLIF(current_setting('app.current_school', true), '')::uuid,
          NULLIF(current_setting('app.current_staff_user', true), '')::uuid)
      )
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR (
      NULLIF(current_setting('app.current_staff_user', true), '') IS NOT NULL
      AND entry_id IN (
        SELECT chronic_entry_ids(
          NULLIF(current_setting('app.current_school', true), '')::uuid,
          NULLIF(current_setting('app.current_staff_user', true), '')::uuid)
      )
    )
  );

-- ---- staff_grant_delete: DELETE is the one command a WITH CHECK cannot reach ----
-- A grantee's USING clause legitimately matches the rows he may READ, and DELETE is authorised by
-- USING alone — so without this, a FULL_PLAN grantee could delete the care plan he was shown, and a
-- grantee could delete his own grant row and erase the evidence that he ever had access (R110 makes
-- that trail append-only). Three tables, one identical rule: destructive commands require a default
-- clinical reader. (sickbay_chronic_read needs none — its USING is already clinical-reader-only.)
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'sickbay_chronic_entry',
    'sickbay_chronic_med',
    'sickbay_chronic_grant'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS staff_grant_delete ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY staff_grant_delete ON %I AS RESTRICTIVE FOR DELETE TO public '
      'USING (current_setting(''app.bypass_rls'', true) = ''on'' '
      '  OR (NULLIF(current_setting(''app.current_staff_user'', true), '''') IS NOT NULL '
      '      AND chronic_clinical_role('
      '            NULLIF(current_setting(''app.current_school'', true), '''')::uuid,'
      '            NULLIF(current_setting(''app.current_staff_user'', true), '''')::uuid) IS NOT NULL));',
      tbl
    );
  END LOOP;
END
$$;

-- ---- parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql / prod-paste-0057 ----
-- 🔴 THIS IS NOT OPTIONAL AND IT IS NOT COSMETIC. Owner decision D8 keeps a parent out of sickbay
-- entirely in module 4.4, and the four tables above are the most sensitive rows in the product. The
-- loop is NOT a hand-list: it applies parent_deny to every FORCE-RLS + school_id table that lacks a
-- parent_scope policy — which, after the block above, is exactly the four new tables plus the ones
-- already covered (it re-creates their identical policy, hence idempotent). It is re-run here rather
-- than hand-listing the four because that is what keeps a FUTURE sickbay table auto-denied. Skip it
-- and every chronic care plan on prod is readable by a claimed parent session until someone runs
-- `db:policies` — which never runs against prod at all.
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
