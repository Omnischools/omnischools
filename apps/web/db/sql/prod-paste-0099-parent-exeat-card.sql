-- Omnischools — PROD paste 0099: PARENT EXEAT CARD (INCR — Exeat Phase 3, Feature A: a parent downloads
-- the exeat CARD PDF for their OWN child). ONE additive SECURITY DEFINER function — ZERO new tables, ZERO
-- columns, ZERO enums, ZERO backfills, ZERO new parent_scope grants. It adds ONE read-only fn
-- (parent_exeat_card = the ONLY parent reach for the card fields) and re-runs the catalog-driven
-- parent_deny loop. Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD
-- after merging. Byte-identical in effect to the "INCR — PARENT EXEAT CARD" block in db/sql/policies.sql
-- (dev, db:policies).
--
-- WHAT IT SHIPS. Phase 2 (prod-paste-0098) opened the parent's exeat WRITE (parent_request_exeat) and the
-- own-child status LIST (parent_exeat_list). Phase 3-A adds the printable CARD: the same own-child exeat,
-- projected to ONLY the parent-safe card fields (Kofi A1) — school name + GES/registration code, ref_code,
-- student full name, class/form label, house NAME, exeat_type, date-out (COALESCE(departed_at, depart_at)),
-- date-in (return_by), academic-year label and status. boarding_exeat / house / academic_period / class
-- STAY fully parent_deny (they carry NO parent_scope, so the catalog loop below keeps them denied
-- automatically) — a parent can touch the card fields ONLY through this fn.
--
-- 🔴 WHAT A PARENT NEVER GETS (the staff card source lib/boarding/exeat-data.ts getExeatCardData reads
-- these; this fn does NOT project them): fee_owing_snapshot / any amount / the feeLine; the signer staff
-- users.fullName (signerActor); the bunk / dormitory. The dress-code and signer LABEL are policy STRINGS
-- the app already holds — this fn fetches NO staff PII for them. A mutated client can never widen the
-- projection past the RETURNS TABLE contract.
--
-- 🔴 THE ELIGIBILITY GATE IS EMBEDDED IN THE FN (Kofi A3 — the fn is the authority, not the UI). The row
-- is returned ONLY when the exeat is downloadable:
--   SPECIAL                     → status ∈ (SR_HM_SIGNED, DEPARTED)
--   SCHEDULED / FEE_COLLECTION  → status ∈ (HM_APPROVED,  DEPARTED)
-- REQUESTED / DECLINED / (future) WITHDRAWN / RETURNED → 0 ROWS (RETURNED excluded per owner: the card is a
-- live-window artefact, not a returned-trip receipt). A mutated client asking for an ineligible id — or a
-- not-own-child / cross-tenant id — gets NOTHING (a route 404, no leak).
--
-- 🔴 THE GUC-CLEAR DEVICE (the parent_exeat_list / parent_boarding_placement / parent_house_names idiom).
-- boarding_exeat, house, academic_period and class are parent_deny. Under PROD's non-superuser FORCE-RLS
-- definer owner, a read of those tables with the parent GUC still set returns 0 rows — so the fn CLEARS
-- app.current_parent_user for its traverse (parent_deny's `pu IS NULL` → TRUE) then RESTORES it VERBATIM.
-- app.current_school STAYS set → tenant_isolation still fences the school (defence in depth). Own-child
-- fencing does NOT rely on the GUC — it uses the CAPTURED pu ARG via parent_student_ids(). RESTORE is
-- COALESCE(prev,''), NEVER pu::text: pu is a fn ARG that may differ from the caller's session GUC (a
-- pu::text restore would forge a scope that was never there — see the parent_boarding_placement note).
--
-- 🔴 STAFF UNAFFECTED — pu IS NULL → TOTAL NO-OP. This fn is not on any staff path; the staff card console
-- (lib/boarding/exeat-data.ts getExeatCardData) reads boarding_exeat DIRECTLY via withSchool, which never
-- sets app.current_parent_user. A staff/webhook/escalated caller that somehow invoked this fn with
-- pu IS NULL returns immediately (no rows) and touches NOTHING. Depends on parent_student_ids()
-- (prod-paste-0055), already on prod.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN — FAIL-CLOSED, NEVER A LEAK (but paste it WITH the code, not after).
-- db:policies configures LOCAL DEV ONLY. Without this paste the function is ABSENT on prod: a parent who
-- taps "Download card" hits `select … from parent_exeat_card(…)`, which 500s ("function does not exist") →
-- the card route 404s / errors — fail-CLOSED (boarding_exeat stays fully parent_deny, nothing leaks), but a
-- LOUD "the paste didn't run" signal, not a silent empty. Run this WITH/BEFORE the Exeat Phase 3-A release.
--
-- SCOPE — NO SCHEMA, NO POLICY CHANGES. Every policy on every table is untouched; boarding_exeat + house +
-- academic_period + class keep tenant_isolation + parent_deny exactly as their creating pastes left them.
-- The catalog parent_deny loop at the tail re-affirms parent_deny on every FORCE-RLS + school_id table with
-- NO parent_scope, so a future tenant table stays auto-denied with zero edits.
--
-- Verify afterwards:
--   -- the function exists, owned by / executable to omnischools_app:
--   select proname, pg_get_function_identity_arguments(oid) as args, proowner::regrole
--   from pg_proc where proname = 'parent_exeat_card';
--   -- boarding_exeat carries NO parent_scope and DOES carry parent_deny (never widened):
--   select c.relname, p.polname, p.polcmd from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname = 'boarding_exeat' order by 2;
--   -- and db/sql/verify-prod-rls.sql: Query 1 must still return ZERO ROWS; parent_readable UNCHANGED (31 —
--   -- this increment adds NO parent_scope table).

-- ============================================================================================
-- INCR — PARENT EXEAT CARD (Exeat Phase 3-A). ONE SECURITY DEFINER read fn; byte-identical to the
-- "INCR — PARENT EXEAT CARD" block in db/sql/policies.sql (dev). No parent_scope grant is added.
-- ============================================================================================

-- ---- Fn: parent_exeat_card — the own-child, download-eligible exeat CARD projection (the ONLY parent
-- reach for the card fields). Returns ONLY the parent-safe A1 columns for ONE own-child exeat that is in a
-- downloadable status. NEVER fee_owing_snapshot / any amount / signer staff name / bunk / dorm — a parent
-- can never reach the fee snapshot or staff PII even via a mutated reader. GUC-clear device: boarding_exeat
-- + house + academic_period + class are parent_deny, so clear the parent GUC for the read then restore it
-- VERBATIM; own-child fencing uses the CAPTURED pu ARG (parent_student_ids).
CREATE OR REPLACE FUNCTION parent_exeat_card(school uuid, pu uuid, p_exeat_id uuid)
  RETURNS TABLE(
    school_name    text,
    school_code    text,
    ref_code       text,
    student_name   text,
    form_label     text,
    house_name     text,
    exeat_type     text,
    date_out       timestamptz,
    date_in        timestamptz,
    academic_year  text,
    status         text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  prev text := current_setting('app.current_parent_user', true);  -- caller's GUC, captured VERBATIM
BEGIN
  -- fail-closed; GUC untouched. STAFF (pu IS NULL) short-circuits here — total no-op.
  IF pu IS NULL OR school IS NULL OR p_exeat_id IS NULL THEN RETURN; END IF;
  -- Relax parent_deny on boarding_exeat + house + academic_period + class for THIS read only (parent_deny's
  -- `pu IS NULL` → TRUE). Own-child fencing uses the CAPTURED pu ARG (parent_student_ids), NOT the cleared
  -- GUC; app.current_school stays set so tenant_isolation still fences the school.
  PERFORM set_config('app.current_parent_user', '', true);
  RETURN QUERY
    SELECT rs.name, rs.ges_code, be.ref_code,
           s.first_name || ' ' || s.last_name,
           c.name, h.name, be.exeat_type::text,
           COALESCE(be.departed_at, be.depart_at), be.return_by,
           ap.academic_year, be.status::text
    FROM boarding_exeat be
    JOIN students s        ON s.school_id = be.school_id AND s.id = be.student_id
    JOIN house h           ON h.school_id = be.school_id AND h.id = be.house_id
    JOIN academic_period ap ON ap.school_id = be.school_id AND ap.period_id = be.academic_period_id
    JOIN ref_school rs     ON rs.id = be.school_id
    LEFT JOIN class c      ON c.school_id = s.school_id AND c.id = s.class_id
    WHERE be.school_id = school
      AND be.id = p_exeat_id
      AND be.student_id IN (SELECT parent_student_ids(school, pu))
      -- eligibility gate — the fn is the authority (Kofi A3): only download-eligible statuses. RETURNED is
      -- deliberately EXCLUDED (owner: the card is a live-window artefact, not a returned-trip receipt).
      AND (
        (be.exeat_type::text = 'SPECIAL' AND be.status::text IN ('SR_HM_SIGNED', 'DEPARTED'))
        OR (be.exeat_type::text IN ('SCHEDULED', 'FEE_COLLECTION') AND be.status::text IN ('HM_APPROVED', 'DEPARTED'))
      );
  -- RESTORE the caller's GUC VERBATIM. COALESCE(prev,'') because current_setting(...,true) yields NULL when
  -- unset. NEVER pu::text: pu is a fn ARG that may differ from the caller's session GUC.
  PERFORM set_config('app.current_parent_user', COALESCE(prev, ''), true);
END;
$$;
-- On Supabase every public function is a PostgREST RPC and EXECUTE defaults to PUBLIC; a privileged
-- SECURITY DEFINER read must not be anon-callable (no-op without the GUCs, but harden anyway).
REVOKE EXECUTE ON FUNCTION parent_exeat_card(uuid, uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnischools_app') THEN
    GRANT EXECUTE ON FUNCTION parent_exeat_card(uuid, uuid, uuid) TO omnischools_app;
  END IF;
END $$;

-- ---- layer 1: parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql ----
-- 🔴 RUN THIS. It re-affirms RESTRICTIVE parent_deny on every FORCE-RLS + school_id table that does NOT
-- already carry a parent_scope policy. This increment adds NO parent_scope, so boarding_exeat +
-- exeat_notification (and every other never-widen tenant table, and any future one) stay auto-denied — the
-- fn above is the ONLY parent reach. Idempotent.
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
