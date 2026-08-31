-- Omnischools — PROD paste 0098: PARENT EXEAT (INCR — Exeat Phase 2: parent-initiated SPECIAL exeat
-- request + own-child exeat status, parent-portal Boarding). FUNCTION-ONLY — ZERO new tables, ZERO enums,
-- ZERO altered columns, ZERO backfills, ZERO new parent_scope grants. It adds TWO SECURITY DEFINER
-- functions (parent_request_exeat = the ONLY parent write into boarding_exeat; parent_exeat_list = the
-- ONLY parent read of boarding_exeat) and re-runs the catalog-driven parent_deny loop. Idempotent — safe
-- to run more than once. Paste into the Supabase SQL editor on PROD after merging. Byte-identical in effect
-- to the "INCR — PARENT EXEAT" block in db/sql/policies.sql (dev, db:policies).
--
-- WHAT IT SHIPS. Phase 1 (prod-paste-0097) left boarding_exeat + exeat_notification fully parent_deny and
-- exeat/leave deferred. Phase 2 opens the two parent touchpoints as DEFINER FUNCTIONS, NOT parent_scope
-- grants: (1) a parent of a BOARDER child files a SPECIAL exeat request (status REQUESTED, awaiting the
-- staff HM→Sr-HM lane), and (2) reads the status/timeline of their OWN child's exeats. boarding_exeat and
-- exeat_notification STAY fully parent_deny (they carry NO parent_scope, so the catalog loop below keeps
-- them denied automatically) — a parent can touch boarding_exeat ONLY through these two fns.
--
-- 🔴 THE GUC-CLEAR DEVICE (the parent_bump_conversation / parent_boarding_placement / parent_house_names
-- idiom). boarding_exeat, house, academic_period and audit_log are parent_deny; invoice, students and
-- boarding_settings are parent_scope. Under PROD's non-superuser FORCE-RLS definer owner, a read/write of
-- those tables with the parent GUC still set returns 0 rows / denies — so each fn CLEARS
-- app.current_parent_user for its traverse (parent_deny's `pu IS NULL` → TRUE) then RESTORES it VERBATIM.
-- app.current_school STAYS set → tenant_isolation still fences the school (defence in depth). Own-child
-- fencing does NOT rely on the GUC — it uses the CAPTURED pu ARG via parent_student_ids(). RESTORE is
-- COALESCE(prev,''), NEVER pu::text: pu is a fn ARG that may differ from the caller's session GUC (a
-- pu::text restore would forge a scope that was never there — see the parent_boarding_placement note).
--
-- 🔴 STAFF UNAFFECTED — pu IS NULL → TOTAL NO-OP. Neither fn is on any staff path; the staff exeat console
-- (lib/actions/boarding-exeat.ts) writes/reads boarding_exeat DIRECTLY via withSchool, which never sets
-- app.current_parent_user. A staff/webhook/escalated caller that somehow invoked these fns with pu IS NULL
-- returns immediately (no rows / unauthorized) and touches NOTHING — boarding_exeat behaviour is
-- byte-unchanged for staff. Depends on parent_student_ids() (prod-paste-0055), already on prod.
--
-- 🔴 RLS IS ROW-LEVEL. parent_request_exeat SERVER-FORCES every security-critical field (exeat_type=SPECIAL,
-- status=REQUESTED, parent_initiated=true, house_id/academic_period_id derived, all approval/departure/
-- return stamps NULL) — the app cannot smuggle a pre-approved or mis-typed row. parent_exeat_list PROJECTS
-- ONLY the C3-IN columns (never fee_owing_snapshot / decline_reason / any *_by_user_id / returned_late /
-- house_id/dorm/bunk) — a parent can never reach the fee snapshot, the decline reason or staff PII even via
-- a mutated reader. fee_owing_snapshot is captured advisory-only and NEVER blocks a request.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN — FAIL-CLOSED, NEVER A LEAK (but paste it WITH the code, not after).
-- db:policies configures LOCAL DEV ONLY. Without this paste both functions are ABSENT on prod: a parent of
-- a BOARDER child who opens the Exeat surface hits `select … from parent_exeat_list(…)` (or submits a
-- request), which 500s ("function does not exist") — fail-CLOSED (a 500 leaks NOTHING: boarding_exeat
-- stays fully parent_deny), but a LOUD "the paste didn't run" signal, not a silent empty. Run this
-- WITH/BEFORE the Exeat Phase 2 code release.
--
-- SCOPE — NO TABLE CHANGES. Every policy on every table is untouched; boarding_exeat + exeat_notification
-- keep tenant_isolation + parent_deny exactly as prod-paste-0046 / prod-paste-0097 left them. The catalog
-- parent_deny loop at the tail re-affirms parent_deny on every FORCE-RLS + school_id table with NO
-- parent_scope (both exeat tables included), so a future tenant table stays auto-denied with zero edits.
--
-- Verify afterwards:
--   -- both functions exist, owned by / executable to omnischools_app:
--   select proname, pg_get_function_identity_arguments(oid) as args, proowner::regrole
--   from pg_proc where proname in ('parent_request_exeat','parent_exeat_list') order by 1;
--   -- boarding_exeat + exeat_notification carry NO parent_scope and DO carry parent_deny (never widened):
--   select c.relname, p.polname, p.polcmd from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname in ('boarding_exeat','exeat_notification') order by 1, 2;
--   -- and db/sql/verify-prod-rls.sql: Query 1 must still return ZERO ROWS; parent_readable UNCHANGED (31 —
--   -- no new parent_scope table is added by this increment).

-- ============================================================================================
-- INCR — PARENT EXEAT (Exeat Phase 2). Two SECURITY DEFINER fns; byte-identical to the
-- "INCR — PARENT EXEAT" block in db/sql/policies.sql (dev). No parent_scope grant is added.
-- ============================================================================================

-- ---- Fn 1: parent_request_exeat — the guarded parent WRITE (the ONLY parent write into boarding_exeat).
-- Server-forces a SPECIAL / REQUESTED / parent_initiated row for the parent's OWN active boarder child,
-- one live exeat at a time, with a per-school retry-guarded ref_code. Composite OUT {ok, ref_code, error}.
CREATE OR REPLACE FUNCTION parent_request_exeat(
  school     uuid,
  pu         uuid,
  p_student  uuid,
  p_reason   text,
  p_depart   date,
  p_return   date,
  OUT ok        boolean,
  OUT ref_code  text,
  OUT error     text
)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  prev           text := current_setting('app.current_parent_user', true);  -- caller's GUC, captured VERBATIM
  v_today        date := (now() AT TIME ZONE 'UTC')::date;
  v_year         int  := EXTRACT(YEAR FROM now())::int;
  v_res          text;
  v_status       text;
  v_house        uuid;
  v_period       uuid;
  v_owing        numeric;
  v_snapshot     numeric;
  v_return_time  text;
  v_return_by    timestamptz;
  v_requested_by uuid;
  v_prefix       text;
  v_base_seq     int;
  v_attempt      int;
  v_ref          text;
  v_id           uuid;
BEGIN
  ok := false;
  -- fail-CLOSED: no parent / no school → do nothing, GUC untouched. STAFF (pu IS NULL) short-circuit here.
  IF pu IS NULL OR school IS NULL THEN
    error := 'unauthorized';
    RETURN;
  END IF;

  -- own-child fence (D1): the CAPTURED pu ARG, never the GUC. Checked BEFORE the clear → GUC untouched,
  -- and the error is a NEUTRAL not-found (never reveals the child exists in another family/tenant).
  IF NOT EXISTS (SELECT 1 FROM parent_student_ids(school, pu) sid WHERE sid = p_student) THEN
    error := 'not_found';
    RETURN;
  END IF;

  -- GUC-CLEAR DEVICE: boarding_exeat / house / academic_period / audit_log are parent_deny and
  -- invoice / students / boarding_settings are parent_scope — with the parent GUC still set the definer
  -- body reads 0 rows / a write denies under prod's non-superuser FORCE-RLS owner. Clear the parent GUC
  -- for the traverse (parent_deny's `pu IS NULL` → TRUE); KEEP app.current_school so tenant_isolation
  -- still fences the school. RESTORED verbatim at the single exit below.
  PERFORM set_config('app.current_parent_user', '', true);

  <<body>>
  BEGIN
    -- residency / house (E5 / A5). Read after the clear (own-child already proven above).
    SELECT s.residency::text, s.status::text, s.house_id
      INTO v_res, v_status, v_house
      FROM students s
      WHERE s.school_id = school AND s.id = p_student;
    IF NOT FOUND OR v_house IS NULL THEN
      error := 'That boarder is not assigned to a House.';        -- E5
      EXIT body;
    END IF;
    IF v_status IS DISTINCT FROM 'ACTIVE' OR v_res IS DISTINCT FROM 'BOARDER' THEN
      error := 'Only an active boarder can request an exeat.';    -- A5 belt
      EXIT body;
    END IF;

    -- current SENIOR semester — mirrors lib/boarding/period.ts getCurrentPeriod (covering → latest
    -- started → earliest). E2 when the school has no SENIOR period.
    SELECT ap.period_id INTO v_period
      FROM academic_period ap
      WHERE ap.school_id = school AND ap.product_line = 'SENIOR'
      ORDER BY
        (ap.starts_on <= v_today AND ap.ends_on >= v_today) DESC,
        (ap.starts_on <= v_today) DESC,
        CASE WHEN ap.starts_on <= v_today THEN ap.starts_on END DESC,
        ap.starts_on ASC
      LIMIT 1;
    IF v_period IS NULL THEN
      error := 'No academic semester is configured.';            -- E2
      EXIT body;
    END IF;

    -- OPEN-GUARD (B9, authoritative, in-tx): one live exeat at a time (any type).
    IF EXISTS (
      SELECT 1 FROM boarding_exeat be
      WHERE be.school_id = school AND be.student_id = p_student
        AND be.status::text IN ('REQUESTED','HM_APPROVED','SR_HM_SIGNED','DEPARTED')
    ) THEN
      error := 'This boarder already has an exeat in progress — please contact the House.';  -- B9
      EXIT body;
    END IF;

    -- fee-owing snapshot (B8): SUM(invoice.balance_amount) over owing statuses; > 0 ? sum : NULL.
    -- Advisory only — NEVER blocks (mirrors lib/boarding/exeat-data.ts feeOwingForStudent semantics).
    SELECT COALESCE(SUM(i.balance_amount), 0) INTO v_owing
      FROM invoice i
      WHERE i.school_id = school AND i.student_id = p_student
        AND i.status::text IN ('ISSUED','PARTIAL','OVERDUE');
    v_snapshot := CASE WHEN v_owing > 0 THEN round(v_owing, 2) ELSE NULL END;

    -- return_by = p_return at the policy return-by time (default 16:00 — getExeatPolicy.returnByTime).
    SELECT bs.exeat_return_by INTO v_return_time
      FROM boarding_settings bs WHERE bs.school_id = school;
    v_return_time := COALESCE(NULLIF(v_return_time, ''), '16:00');
    v_return_by := (p_return::text || ' ' || v_return_time)::timestamptz;

    -- requested_by_user_id = pu ONLY if a ref_user row exists (OC-3), else NULL (the FK is SET NULL).
    v_requested_by := CASE WHEN EXISTS (SELECT 1 FROM ref_user u WHERE u.id = pu) THEN pu ELSE NULL END;

    -- ref-code prefix — mirrors refPrefix in lib/actions/boarding-exeat.ts: first 4 alnum of
    -- short_name/name, upper-cased, else 'EXT'.
    SELECT COALESCE(
             NULLIF(left(upper(regexp_replace(COALESCE(rs.short_name, rs.name), '[^A-Za-z0-9]', '', 'g')), 4), ''),
             'EXT')
      INTO v_prefix
      FROM ref_school rs WHERE rs.id = school;
    v_prefix := COALESCE(v_prefix, 'EXT');

    -- base sequence = max trailing number over the school's existing ref_codes + 1 (per-school).
    SELECT COALESCE(MAX(substring(be.ref_code from '(\d+)\s*$')::int), 0) + 1
      INTO v_base_seq
      FROM boarding_exeat be WHERE be.school_id = school;

    -- ponytail: the "PREFIX-EX-YYYY-NNNN" format is intentionally duplicated from formatRefCode/
    -- nextExeatSequence in lib/boarding/exeat-decision.ts — it is a DISPLAY string, not lifecycle logic.
    -- Computing it IN-fn (retry-on-collision, guarded by uniq_exeat_ref_code) keeps allocation atomic
    -- with the unique constraint (no TOCTOU). Upgrade path: extract a shared codegen only if a third
    -- caller appears.
    <<alloc>>
    FOR v_attempt IN 0..4 LOOP
      v_ref := v_prefix || '-EX-' || v_year::text || '-' || lpad((v_base_seq + v_attempt)::text, 4, '0');
      BEGIN
        INSERT INTO boarding_exeat (
          school_id, student_id, house_id, academic_period_id,
          exeat_type, status, ref_code, reason, parent_initiated,
          depart_at, return_by, requested_by_user_id, fee_owing_snapshot)
        VALUES (
          school, p_student, v_house, v_period,
          'SPECIAL', 'REQUESTED', v_ref, NULLIF(btrim(p_reason), ''), true,
          p_depart::timestamptz, v_return_by, v_requested_by, v_snapshot)
        RETURNING id INTO v_id;
        ok := true;
        ref_code := v_ref;
        EXIT alloc;
      EXCEPTION WHEN unique_violation THEN
        -- uniq_exeat_ref_code lost race — bump the sequence and retry.
        CONTINUE alloc;
      END;
    END LOOP alloc;

    IF NOT ok THEN
      error := 'Could not allocate an exeat reference — please retry.';
      EXIT body;
    END IF;

    -- D8 recursion note: this fn reads boarding_exeat (open-guard) AND inserts into it. With the parent
    -- GUC cleared, boarding_exeat's parent_deny is a no-op and tenant_isolation is a plain predicate —
    -- no policy or SECURITY DEFINER helper on boarding_exeat re-enters parent_request_exeat. No recursion.

    -- AUDIT (parity with lib/actions/boarding-exeat.ts recordAudit / EXEAT_REQUESTED) — parent-sourced.
    INSERT INTO audit_log (
      school_id, actor_user_id, actor_role, action_type, entity_type, entity_id,
      before_jsonb, after_jsonb, reason)
    VALUES (
      school, v_requested_by, 'PARENT', 'EXEAT_REQUESTED', 'boarding_exeat', v_id,
      NULL,
      jsonb_build_object(
        'refCode', v_ref, 'type', 'SPECIAL', 'status', 'REQUESTED',
        'parentInitiated', true, 'source', 'parent', 'feeSnapshot', v_snapshot),
      NULLIF(btrim(p_reason), ''));
  END body;

  -- SINGLE restore point (every EXIT body + the success path land here). RESTORE VERBATIM:
  -- COALESCE(prev,'') because current_setting(...,true) is NULL when unset. NEVER pu::text — pu is a fn
  -- ARG that may differ from the caller's session GUC (see the parent_boarding_placement note).
  PERFORM set_config('app.current_parent_user', COALESCE(prev, ''), true);
  RETURN;
END;
$$;
-- On Supabase every public function is a PostgREST RPC (EXECUTE defaults to PUBLIC); a privileged
-- SECURITY DEFINER write must not be anon-callable. The owner keeps EXECUTE regardless of the REVOKE.
REVOKE EXECUTE ON FUNCTION parent_request_exeat(uuid, uuid, uuid, text, date, date) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnischools_app') THEN
    GRANT EXECUTE ON FUNCTION parent_request_exeat(uuid, uuid, uuid, text, date, date) TO omnischools_app;
  END IF;
END $$;

-- ---- Fn 2: parent_exeat_list — the own-child exeat READ projection (the ONLY parent read of
-- boarding_exeat). Returns ONLY the C3-IN columns for ALL of the parent's own child's exeats (any type),
-- newest first. NEVER fee_owing_snapshot / decline_reason / *_by_user_id / returned_late / house_id/dorm/
-- bunk — a parent can never reach the fee snapshot, the decline reason or staff PII even via a mutated
-- reader. GUC-clear device: boarding_exeat + house are parent_deny, so clear the parent GUC for the read
-- then restore it VERBATIM; own-child fencing uses the CAPTURED pu ARG (parent_student_ids).
CREATE OR REPLACE FUNCTION parent_exeat_list(school uuid, pu uuid)
  RETURNS TABLE(
    exeat_id        uuid,
    ref_code        text,
    exeat_type      text,
    status          text,
    parent_initiated boolean,
    reason          text,
    depart_at       timestamptz,
    return_by       timestamptz,
    departed_at     timestamptz,
    returned_at     timestamptz,
    hm_approved_at  timestamptz,
    sr_hm_signed_at timestamptz,
    house_name      text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  prev text := current_setting('app.current_parent_user', true);  -- caller's GUC, captured VERBATIM
BEGIN
  IF pu IS NULL OR school IS NULL THEN RETURN; END IF;  -- fail-closed; GUC untouched
  -- Relax parent_deny on boarding_exeat + house for THIS read only (parent_deny's `pu IS NULL` → TRUE).
  -- Own-child fencing uses the CAPTURED pu ARG (parent_student_ids), NOT the cleared GUC; app.current_school
  -- stays set so tenant_isolation still fences the school.
  PERFORM set_config('app.current_parent_user', '', true);
  RETURN QUERY
    SELECT be.id, be.ref_code, be.exeat_type::text, be.status::text, be.parent_initiated,
           be.reason, be.depart_at, be.return_by, be.departed_at, be.returned_at,
           be.hm_approved_at, be.sr_hm_signed_at, h.name
    FROM boarding_exeat be
    JOIN house h ON h.school_id = be.school_id AND h.id = be.house_id
    WHERE be.school_id = school
      AND be.student_id IN (SELECT parent_student_ids(school, pu))
    ORDER BY be.created_at DESC;
  -- RESTORE the caller's GUC VERBATIM. COALESCE(prev,'') because current_setting(...,true) yields NULL when
  -- unset. NEVER pu::text: pu is a fn ARG that may differ from the caller's session GUC.
  PERFORM set_config('app.current_parent_user', COALESCE(prev, ''), true);
END;
$$;
-- On Supabase every public function is a PostgREST RPC and EXECUTE defaults to PUBLIC; a privileged
-- SECURITY DEFINER read must not be anon-callable (no-op without the GUCs, but harden anyway).
REVOKE EXECUTE ON FUNCTION parent_exeat_list(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnischools_app') THEN
    GRANT EXECUTE ON FUNCTION parent_exeat_list(uuid, uuid) TO omnischools_app;
  END IF;
END $$;

-- ---- layer 1: parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql ----
-- 🔴 RUN THIS. It re-affirms RESTRICTIVE parent_deny on every FORCE-RLS + school_id table that does NOT
-- already carry a parent_scope policy. This increment adds NO parent_scope, so boarding_exeat +
-- exeat_notification (and every other never-widen tenant table, and any future one) stay auto-denied.
-- Idempotent.
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
