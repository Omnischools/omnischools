-- Omnischools — PROD paste 0096: FIX the PROD-ONLY defect in parent_house_names (SHS module 4.7 / INCR-58
-- Item 1; Kofi R483/R484). FUNCTION ONLY — ZERO new tables, ZERO enums, ZERO altered columns, ZERO
-- backfills, ZERO migration, ZERO policy changes. It replaces the ONE SECURITY DEFINER helper
-- parent_house_names(school uuid, pu uuid) with a GUC-clearing plpgsql version. Idempotent (CREATE OR
-- REPLACE) — safe to run more than once. Paste into the Supabase SQL editor on PROD after merging.
-- Byte-identical in effect to the INCR-58 block in db/sql/policies.sql (dev, db:policies). SUPERSEDES
-- prod-paste-0084-pta-parent-house-name.sql (same name + signature; callers are unaffected).
--
-- 🔴 THE BUG (prod-only, fail-closed, masked by dev's superuser owner). The function reads `house`, which
-- is a parent_deny table (house.parent_deny USING app.current_parent_user IS NULL). On PROD the SECURITY
-- DEFINER owner is a NON-SUPERUSER bound by FORCE RLS (there is no BYPASSRLS role). So when the parent
-- portal calls it inside a parent session (app.current_parent_user set), house.parent_deny DENIES the
-- read → the original LANGUAGE sql function returned 0 ROWS → the parent House-PTA card silently fell back
-- to the generic "House PTA" label instead of the real House name (R483/R484). This is FAIL-CLOSED: no
-- crash, no leak — the cost was a generic label, never another family's house or a housemaster's identity.
-- DEV never saw it because its superuser owner bypasses RLS inside the definer body (the same class of trap
-- Quinn caught on parent_bump_conversation).
--
-- 🔴 THE FIX — THE GUC-CLEAR DEVICE (same as parent_bump_conversation, prod-paste-0094). Convert to
-- plpgsql and CLEAR app.current_parent_user for exactly the one scoped read (house.parent_deny USING
-- pu IS NULL → TRUE), then RESTORE it. app.current_school STAYS set, so tenant_isolation still fences the
-- school (defence in depth). The own-child scope uses the CAPTURED function ARG `pu` (never the cleared
-- GUC), so relaxing the GUC cannot widen the result — a parent still sees ONLY their own children's houses.
-- set_config(...,true) is transaction-local: an error mid-RETURN aborts the enclosing tx and rolls the
-- clear back, so the caller's session GUC can never leak across statements (the reasoning Sarah accepted
-- for parent_bump_conversation).
--
-- 🔴 STILL THE IMMUTABLE COLUMN GUARD. The projection is unchanged: it returns ONLY (id, name), so a
-- parent can never reach hm_user_id / colour / capacity / etc. `house` STAYS parent_deny — this paste does
-- NOT open the row and does NOT change any table's parent_scope status, so the parent_deny catalog is
-- UNCHANGED (a function was replaced, no policy moved). search_path = public, pg_temp with pg_temp LAST so
-- an injected temp `house`/`students` cannot spoof the answer. `pu` is the GUC arg, never a row column; a
-- NULL pu / school → early RETURN → 0 rows (fail-closed). parent_student_ids() (prod-paste-0055) already
-- ships on prod and is NOT re-created here.
--
-- 🔴 STAFF ARE UNAFFECTED. Staff / webhook / escalated sessions never set app.current_parent_user. The
-- portal only calls this fn from a parent session; a staff caller passing a `pu` would still only read
-- that pu's own children's houses (the projection + own-child scope are unchanged), and clearing an
-- already-unset GUC is a no-op. No staff access is widened or narrowed.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN — FAIL-CLOSED, NEVER A LEAK. db:policies configures LOCAL DEV ONLY.
-- Without this paste the OLD LANGUAGE sql function stays on prod and the parent House-PTA card keeps the
-- generic "House PTA" label — the cost of skipping is a generic label, not exposure.
--
-- Verify afterwards (db/sql/verify-prod-rls.sql):
--   -- Query 1 must return ZERO ROWS (no table opened); tenant_tables / parent_readable / parent_denied
--   -- are ALL UNCHANGED (a function was replaced, no policy moved).
--   -- Language check: SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
--   --                 WHERE p.proname = 'parent_house_names';  -- must be 'plpgsql'.

-- ---- SECURITY DEFINER helper: the parent's OWN children's houses as (id, name) ONLY, with the GUC-clear.
CREATE OR REPLACE FUNCTION parent_house_names(school uuid, pu uuid)
  RETURNS TABLE(house_id uuid, house_name text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  prev text := current_setting('app.current_parent_user', true);  -- capture, restore verbatim (pu is an ARG)
BEGIN
  IF pu IS NULL OR school IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.current_parent_user', '', true);  -- relax house.parent_deny for the scoped read
  RETURN QUERY
    SELECT DISTINCT h.id, h.name
    FROM house h
    WHERE h.school_id = school
      AND h.id IN (
        SELECT DISTINCT s.house_id
        FROM students s
        WHERE s.school_id = school
          AND s.house_id IS NOT NULL
          AND s.id IN (SELECT parent_student_ids(school, pu))
      );
  PERFORM set_config('app.current_parent_user', COALESCE(prev, ''), true);  -- restore the caller's own GUC
END;
$$;
-- On Supabase every public function is a PostgREST RPC and EXECUTE defaults to PUBLIC. This fn now CLEARS
-- the parent GUC as the definer owner, so harden it: it must not be anon-callable (the owner keeps EXECUTE
-- regardless of the REVOKE; a caller without app.current_school is still fenced by tenant_isolation).
REVOKE EXECUTE ON FUNCTION parent_house_names(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnischools_app') THEN
    GRANT EXECUTE ON FUNCTION parent_house_names(uuid, uuid) TO omnischools_app;
  END IF;
END $$;
