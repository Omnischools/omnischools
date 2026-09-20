-- Omnischools — PROD paste 0101: PARENT EXEAT WITHDRAW (INCR — Exeat Phase 3, Feature B: parent
-- cancels/withdraws an own, still-pending exeat request). ONE additive ENUM VALUE + ONE additive
-- SECURITY DEFINER write fn. ZERO new tables, ZERO new columns, ZERO backfills, ZERO new parent_scope
-- grants. Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD after
-- merging. Byte-identical in effect to the "INCR — PARENT EXEAT WITHDRAW" block in db/sql/policies.sql
-- (dev, db:policies) plus the exeat_status.WITHDRAWN value (Drizzle migration 0091 on dev/source-of-truth).
--
-- WHAT IT SHIPS. Phase 2 (prod-paste-0098) opened parent_request_exeat (the only parent write into
-- boarding_exeat) + parent_exeat_list (the only parent read). Phase 3-B adds the parent's CANCEL: a parent
-- may unsend an exeat THEY filed through the portal, but ONLY before any staff decision. The status flip
-- is a NEW terminal enum value WITHDRAWN — distinct from staff DECLINED — recorded by an audit row (who/
-- when is the audit row, NOT a new boarding_exeat column; Kofi B8). boarding_exeat STAYS fully parent_deny
-- (it carries NO parent_scope; the catalog loop at the tail keeps it denied) — a parent flips a status
-- ONLY through parent_withdraw_exeat below.
--
-- 🔴 THE ADD-VALUE-OUTSIDE-TX CAVEAT (Kofi). `ALTER TYPE ... ADD VALUE` cannot run inside a transaction
-- block, and a value added in a transaction cannot be USED in that same transaction. The ALTER below
-- therefore runs STANDALONE — NO surrounding BEGIN/COMMIT. The Supabase SQL editor autocommits each
-- statement, so pasting this file top-to-bottom is correct: the enum value commits first, THEN the fn
-- (which references 'WITHDRAWN') is created in a later statement that can see it. IF NOT EXISTS makes the
-- ALTER idempotent. Do NOT wrap the ALTER in a transaction and do NOT move the fn ahead of it.
--
-- 🔴 ELIGIBILITY (Kofi B1/B2) — THE FN IS THE AUTHORITY. parent_withdraw_exeat flips status ONLY when the
-- exeat is via_parent_portal=true AND status='REQUESTED'. Any other status (a staff HM→Sr-HM decision has
-- begun) or a staff-authored (non-portal) exeat → a NEUTRAL "please contact the House", NO write. The full
-- state predicate is IN THE UPDATE's WHERE, so a concurrent staff action that lands between the read and
-- the write matches 0 rows and the fn refuses rather than clobber it. Idempotency (B7): an already-
-- WITHDRAWN row → no-op success, NO second status write, NO second audit row.
--
-- 🔴 THE GUC-CLEAR DEVICE (the parent_request_exeat / parent_exeat_list idiom). boarding_exeat and
-- audit_log are parent_deny; under PROD's non-superuser FORCE-RLS definer owner, a read/write of those
-- tables with the parent GUC still set returns 0 rows / denies — so the fn CLEARS app.current_parent_user
-- for its traverse (parent_deny's `pu IS NULL` → TRUE) then RESTORES it VERBATIM. app.current_school STAYS
-- set → tenant_isolation still fences the school (defence in depth). Own-child fencing does NOT rely on the
-- GUC — it uses the CAPTURED pu ARG via parent_student_ids(). RESTORE is COALESCE(prev,''), NEVER pu::text:
-- pu is a fn ARG that may differ from the caller's session GUC (a pu::text restore would forge a scope that
-- was never there — see the parent_boarding_placement note). Depends on parent_student_ids() (prod-paste-
-- 0055), already on prod.
--
-- 🔴 STAFF UNAFFECTED — pu IS NULL → TOTAL NO-OP. The fn is on NO staff path; the staff exeat console
-- (lib/actions/boarding-exeat.ts) flips status DIRECTLY via withSchool, which never sets
-- app.current_parent_user. A staff/webhook caller that somehow invoked the fn with pu IS NULL returns
-- immediately (unauthorized) and touches NOTHING — boarding_exeat behaviour is byte-unchanged for staff.
-- The B9 open-guard in parent_request_exeat EXCLUDES WITHDRAWN, so a withdrawn exeat frees a fresh request.
--
-- 🔴 RLS UNCHANGED — NO LEAK SURFACE. boarding_exeat stays fully parent_deny (it carries NO parent_scope;
-- the catalog parent_deny loop at the tail keeps it denied). This paste adds NO policy, NO grant, NO parent
-- reach beyond the one DEFINER fn — an enum value is not a row and touches no RLS. verify-prod-rls.sql is
-- unaffected (parent_readable UNCHANGED at 31 — no new parent_scope table).
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN — FAIL-CLOSED, NEVER A LEAK (but paste it WITH the code, not after).
-- db:policies configures LOCAL DEV ONLY, and enum/function changes are NOT auto-applied to prod. Without
-- this paste the fn is ABSENT on prod and a parent's Withdraw button hits `select … from
-- parent_withdraw_exeat(…)`, which 500s ("function does not exist") — fail-CLOSED (boarding_exeat stays
-- fully parent_deny; nothing leaks; no status flips), but a LOUD "the paste didn't run" signal. If the app
-- ever emits status='WITHDRAWN' before the ALTER runs it fails ("invalid input value for enum"). RUN THIS
-- BEFORE the Exeat Phase 3-B app deploy. Purely additive → running it early is harmless.
--
-- Verify afterwards:
--   -- the value exists:
--   select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
--   where t.typname = 'exeat_status' order by e.enumsortorder;
--   -- expect: REQUESTED, HM_APPROVED, SR_HM_SIGNED, DEPARTED, RETURNED, DECLINED, WITHDRAWN
--   -- the fn exists, owned by / executable to omnischools_app:
--   select proname, pg_get_function_identity_arguments(oid) as args, proowner::regrole
--   from pg_proc where proname = 'parent_withdraw_exeat';
--   -- boarding_exeat carries NO parent_scope and DOES carry parent_deny (never widened):
--   select p.polname, p.polcmd from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname = 'boarding_exeat' order by 1;
--   -- and db/sql/verify-prod-rls.sql: Query 1 must still return ZERO ROWS; parent_readable UNCHANGED (31).

-- ---- ADDITIVE ENUM VALUE (runs FIRST, STANDALONE — see the outside-tx caveat above). Idempotent.
ALTER TYPE "public"."exeat_status" ADD VALUE IF NOT EXISTS 'WITHDRAWN';

-- ============================================================================================
-- INCR — PARENT EXEAT WITHDRAW (Exeat Phase 3-B). ONE SECURITY DEFINER write fn; byte-identical to the
-- "INCR — PARENT EXEAT WITHDRAW" block in db/sql/policies.sql (dev). No parent_scope grant is added.
-- ============================================================================================

CREATE OR REPLACE FUNCTION parent_withdraw_exeat(
  school      uuid,
  pu          uuid,
  p_exeat_id  uuid,
  OUT ok      boolean,
  OUT error   text
)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  prev      text := current_setting('app.current_parent_user', true);  -- caller's GUC, captured VERBATIM
  v_student uuid;
  v_status  text;
  v_portal  boolean;
  v_actor   uuid;
  v_rows    int;
BEGIN
  ok := false;
  -- fail-CLOSED: no parent / no school / no id → no-op, GUC untouched. STAFF (pu IS NULL) short-circuits.
  IF pu IS NULL OR school IS NULL OR p_exeat_id IS NULL THEN
    error := 'unauthorized';
    RETURN;
  END IF;

  -- GUC-CLEAR DEVICE: boarding_exeat + audit_log are parent_deny — with the parent GUC still set the
  -- definer body reads 0 rows / a write denies under prod's non-superuser FORCE-RLS owner. Clear the
  -- parent GUC for the traverse (parent_deny's `pu IS NULL` → TRUE); KEEP app.current_school so
  -- tenant_isolation still fences the school. RESTORED verbatim at the single exit below.
  PERFORM set_config('app.current_parent_user', '', true);

  <<body>>
  BEGIN
    -- read the target exeat within THIS school (tenant_isolation fences via app.current_school).
    SELECT be.student_id, be.status::text, be.via_parent_portal
      INTO v_student, v_status, v_portal
      FROM boarding_exeat be
      WHERE be.school_id = school AND be.id = p_exeat_id;

    -- own-child fence (the CAPTURED pu ARG, never the GUC): a missing row OR a row for a child in another
    -- family/tenant → the SAME neutral not_found (never reveals the exeat exists).
    IF NOT FOUND
       OR NOT EXISTS (SELECT 1 FROM parent_student_ids(school, pu) sid WHERE sid = v_student) THEN
      error := 'not_found';
      EXIT body;
    END IF;

    -- idempotency (B7): already WITHDRAWN → no-op SUCCESS. No second status write, no second audit row.
    IF v_status = 'WITHDRAWN' THEN
      ok := true;
      EXIT body;
    END IF;

    -- eligibility (Kofi B1/B2): a parent may withdraw ONLY an own, still-REQUESTED, PORTAL-filed exeat
    -- (unsend what THEY filed, before any staff decision). Any other status or a staff-authored
    -- (non-portal) exeat → neutral refuse, NO write.
    IF NOT (v_portal AND v_status = 'REQUESTED') THEN
      error := 'This exeat can no longer be withdrawn — please contact the House.';
      EXIT body;
    END IF;

    -- actor_user_id = pu ONLY if a ref_user row exists (OC-3 parity; audit_log.actor_user_id FK is
    -- NO ACTION, so an orphan pu would raise). else NULL.
    v_actor := CASE WHEN EXISTS (SELECT 1 FROM ref_user u WHERE u.id = pu) THEN pu ELSE NULL END;

    -- WITHDRAW. The full state predicate (own-child student, via_parent_portal, status still REQUESTED)
    -- is IN THE WHERE so a concurrent staff action that lands between the read above and this write
    -- CANNOT be clobbered — the UPDATE matches 0 rows and we refuse.
    UPDATE boarding_exeat be
      SET status = 'WITHDRAWN'
      WHERE be.school_id = school
        AND be.id = p_exeat_id
        AND be.student_id = v_student
        AND be.via_parent_portal = true
        AND be.status::text = 'REQUESTED';
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 0 THEN
      -- lost the race to a concurrent staff action → neutral refuse, NO audit row.
      error := 'This exeat can no longer be withdrawn — please contact the House.';
      EXIT body;
    END IF;

    ok := true;
    -- AUDIT (parity with lib/actions/boarding-exeat.ts recordAudit) — parent-sourced withdraw. who/when
    -- lives HERE, not on a new boarding_exeat column (Kofi B8).
    INSERT INTO audit_log (
      school_id, actor_user_id, actor_role, action_type, entity_type, entity_id,
      before_jsonb, after_jsonb, reason)
    VALUES (
      school, v_actor, 'PARENT', 'EXEAT_WITHDRAWN', 'boarding_exeat', p_exeat_id,
      jsonb_build_object('status', 'REQUESTED'),
      jsonb_build_object('status', 'WITHDRAWN', 'source', 'parent'),
      NULL);
  END body;

  -- SINGLE restore point (every EXIT body + the success path land here). RESTORE VERBATIM:
  -- COALESCE(prev,'') because current_setting(...,true) is NULL when unset. NEVER pu::text — pu is a fn
  -- ARG that may differ from the caller's session GUC.
  PERFORM set_config('app.current_parent_user', COALESCE(prev, ''), true);
  RETURN;
END;
$$;
-- On Supabase every public function is a PostgREST RPC (EXECUTE defaults to PUBLIC); a privileged
-- SECURITY DEFINER write must not be anon-callable. The owner keeps EXECUTE regardless of the REVOKE.
REVOKE EXECUTE ON FUNCTION parent_withdraw_exeat(uuid, uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnischools_app') THEN
    GRANT EXECUTE ON FUNCTION parent_withdraw_exeat(uuid, uuid, uuid) TO omnischools_app;
  END IF;
END $$;

-- ---- layer 1: parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql ----
-- 🔴 RUN THIS. It re-affirms RESTRICTIVE parent_deny on every FORCE-RLS + school_id table that does NOT
-- already carry a parent_scope policy. This increment adds NO parent_scope, so boarding_exeat (and every
-- other never-widen tenant table, and any future one) stays auto-denied. Idempotent.
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
