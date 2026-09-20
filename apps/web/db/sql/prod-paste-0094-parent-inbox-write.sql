-- Omnischools — PROD paste 0094: PARENT COMMUNICATIONS WRITE (INCR — parent-portal Communications tab,
-- the FIRST parent WRITE path). POLICY-ONLY — ZERO new tables, ZERO enums, ZERO altered columns, ZERO
-- backfills. It RESHAPES the write half of the existing parent_scope on TWO tables (conversation,
-- inbox_message) and adds per-command DENY policies. Idempotent — safe to run more than once. Paste into
-- the Supabase SQL editor on PROD after merging. Byte-identical in effect to the "INCR — PARENT
-- COMMUNICATIONS" block in db/sql/policies.sql (dev, db:policies).
--
-- WHAT IT SHIPS. Until now the parent boundary was READ-ONLY by contract (Kofi R4): conversation and
-- inbox_message carried parent_scope AS RESTRICTIVE FOR ALL with WITH CHECK left = USING, because no app
-- write ever ran inside withParentScope. The Communications tab makes a parent post an in-app INBOUND
-- message to a thread about their OWN child, on their OWN stored phone. FOR-ALL-with-USING-as-WITH-CHECK
-- would OVER-grant that write three ways, and this paste closes all three:
--   1. Direction spoofing — a parent could INSERT direction='OUTBOUND', forging a "from the school"
--      message that STAFF also see in the shared thread. The tightened WITH CHECK requires INBOUND.
--   2. Impersonation — a parent could set any sent_by_user_id (another user, or NULL/anon). The WITH
--      CHECK pins sent_by_user_id = the parent GUC.
--   3. Tampering — FOR ALL authorises UPDATE/DELETE, so a parent could edit or delete history (their
--      own OR a staff OUTBOUND message; reassign / flip status / topic / read_at on a conversation). New
--      per-command parent_no_update / parent_no_delete DENY policies make the parent seam INSERT+SELECT
--      only.
-- The READ stays byte-identical (same USING); conversation's INSERT was already correctly constrained by
-- its existing WITH CHECK = USING (own-child, NULL student excluded, + own-phone) and is UNCHANGED.
--
-- 🔴 STAFF ARE UNAFFECTED — THE LOAD-BEARING REGRESSION CHECK. Every added clause is guarded
-- `pu IS NULL OR <rule>` (WITH CHECK) or `pu IS NULL` (the deny policies), where
-- pu = NULLIF(current_setting('app.current_parent_user', true), ''). Staff (withSchool), the inbound
-- webhook POST /api/inbox/inbound (withSchool) and escalated (withoutTenantScope) sessions NEVER set that
-- GUC → pu IS NULL → every clause is TRUE → a total no-op → the staff inbox (OUTBOUND replies, status
-- changes, deletes, thread reassignment) behaves byte-for-byte as before. Depends on parent_student_ids()
-- (prod-paste-0055) and the conversation/inbox_message parent_scope (prod-paste-0055), both already on prod.
--
-- 🔴 RLS IS ROW-LEVEL — IT CANNOT MASK COLUMNS AND IT DOES NOT CONSTRAIN NON-PREDICATE COLUMNS. The
-- server action (lib/parent/*) still owns direction=INBOUND, sent_by_user_id=the parent, body length /
-- sanitisation and the conversation defaults (status=OPEN, assigned=null, topic). RLS enforces the
-- security-critical INVARIANTS only: which ROWS a parent may INSERT (own scoped thread), that a parent
-- INSERT is INBOUND + attributed to the parent, and that a parent may never UPDATE/DELETE.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN — FAIL-OPEN ON THE WRITE, NOT A CROSS-TENANT LEAK. db:policies
-- configures LOCAL DEV ONLY. Without this paste, conversation and inbox_message keep their old FOR ALL
-- USING-as-WITH-CHECK on prod: the parent tab still reads correctly and is still tenant/child-isolated,
-- but a crafted request from a parent session could INSERT an OUTBOUND / mis-attributed message into a
-- thread it can see, or UPDATE/DELETE a message in scope. There is NO cross-tenant or cross-child exposure
-- either way (the reach predicate is unchanged) — the risk is in-thread forgery/tampering, so run this
-- before the Communications tab goes live on prod.
--
-- SCOPE — EXACTLY TWO TABLES CHANGE. conversation and inbox_message. Tenant isolation is untouched on
-- every table. The catalog parent_deny loop at the tail re-affirms parent_deny on every other tenant
-- table (auto-EXCLUDING the tables that carry parent_scope — both of these still do), so nothing else
-- moves and a future tenant table stays auto-denied with zero edits.
--
-- Verify afterwards:
--   -- both tables carry parent_scope + parent_no_update + parent_no_delete, all RESTRICTIVE:
--   select c.relname, p.polname, p.polcmd, p.polpermissive
--   from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname in ('conversation','inbox_message') and p.polname like 'parent%'
--   order by 1, 2;
--   -- and db/sql/verify-prod-rls.sql: Query 1 must still return ZERO ROWS; parent_readable unchanged.

-- ---- conversation — READ + INSERT unchanged (own-child + own-phone); UPDATE/DELETE denied for parents.
DROP POLICY IF EXISTS parent_deny ON conversation;
DROP POLICY IF EXISTS parent_scope ON conversation;
DROP POLICY IF EXISTS parent_no_update ON conversation;
DROP POLICY IF EXISTS parent_no_delete ON conversation;
CREATE POLICY parent_scope ON conversation AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR (
      student_id IN (
        SELECT parent_student_ids(
          school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
      )
      AND contact_phone IN (
        SELECT g.phone FROM student_guardian g
        WHERE g.school_id = conversation.school_id
          AND g.user_id = NULLIF(current_setting('app.current_parent_user', true), '')::uuid
      )
    )
  );
CREATE POLICY parent_no_update ON conversation AS RESTRICTIVE FOR UPDATE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
CREATE POLICY parent_no_delete ON conversation AS RESTRICTIVE FOR DELETE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);

-- ---- inbox_message — READ unchanged; parent INSERT pinned to INBOUND + own sent_by + own scoped
-- thread; UPDATE/DELETE denied for parents.
DROP POLICY IF EXISTS parent_deny ON inbox_message;
DROP POLICY IF EXISTS parent_scope ON inbox_message;
DROP POLICY IF EXISTS parent_no_update ON inbox_message;
DROP POLICY IF EXISTS parent_no_delete ON inbox_message;
CREATE POLICY parent_scope ON inbox_message AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR conversation_id IN (
      SELECT cv.id FROM conversation cv
      WHERE cv.school_id = inbox_message.school_id
        AND cv.student_id IN (
          SELECT parent_student_ids(
            inbox_message.school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
        )
        AND cv.contact_phone IN (
          SELECT g.phone FROM student_guardian g
          WHERE g.school_id = inbox_message.school_id
            AND g.user_id = NULLIF(current_setting('app.current_parent_user', true), '')::uuid
        )
    )
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR (
      direction = 'INBOUND'
      AND sent_by_user_id = NULLIF(current_setting('app.current_parent_user', true), '')::uuid
      AND conversation_id IN (
        SELECT cv.id FROM conversation cv
        WHERE cv.school_id = inbox_message.school_id
          AND cv.student_id IN (
            SELECT parent_student_ids(
              inbox_message.school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
          )
          AND cv.contact_phone IN (
            SELECT g.phone FROM student_guardian g
            WHERE g.school_id = inbox_message.school_id
              AND g.user_id = NULLIF(current_setting('app.current_parent_user', true), '')::uuid
          )
      )
    )
  );
CREATE POLICY parent_no_update ON inbox_message AS RESTRICTIVE FOR UPDATE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
CREATE POLICY parent_no_delete ON inbox_message AS RESTRICTIVE FOR DELETE TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);

-- ---- parent_bump_conversation — the scoped SECURITY DEFINER bump the parent write action calls.
-- 🔴 WHY THIS EXISTS. A parent reply must advance conversation.last_message_at AND reopen a CLOSED
-- thread, but parent_no_update (just above) DENIES every direct parent UPDATE on conversation. The
-- staff inbox derives unread (read_at IS NULL OR last_message_at > read_at), recency (ORDER BY
-- last_message_at DESC) and the OPEN unread-count from those two columns — so a naive
-- `tx.update(conversation).set({last_message_at, status})` inside withParentScope hits parent_no_update
-- and updates 0 ROWS *SILENTLY*: the inbox_message INSERT still succeeds (the parent sees their reply),
-- but staff NEVER see the unread/recency signal and a CLOSED thread never reopens. DEV masks this — its
-- superuser owner bypasses RLS — so 22/22 policy-shape + source-shape tests stayed green (Quinn MAJOR).
-- 🔴 MECHANISM. This SECURITY DEFINER fn performs the bump with elevated privilege but is INTERNALLY
-- scoped. Ownership alone CANNOT bypass the deny here: there is NO BYPASSRLS role and FORCE RLS binds
-- the owner too, so the fn CLEARS `app.current_parent_user` for exactly the one privileged UPDATE
-- (parent_no_update USING pu IS NULL → TRUE) then RESTORES it — the same portable device as
-- app.bypass_rls, applied surgically to just the parent GUC. `app.current_school` stays set so
-- tenant_isolation still fences the school (defence in depth); the WHERE (own school + own child via
-- parent_student_ids + own STORED phone, all on the CAPTURED pu) is the parent scope. It writes ONLY
-- last_message_at + status — never read_at / assigned_to_user_id / topic / routed_by_* — so
-- parent_no_update stays intact for every other column and for a direct parent UPDATE.
-- STAFF ARE UNAFFECTED: staff/webhook/escalated sessions never set app.current_parent_user → pu IS
-- NULL → early RETURN → total no-op; staff bump their own threads by direct UPDATE exactly as before.
-- search_path = public, pg_temp (pg_temp LAST) so a session TEMP relation cannot shadow the tables in
-- the definer body. Depends on parent_student_ids() (prod-paste-0055), already on prod. Idempotent.
CREATE OR REPLACE FUNCTION parent_bump_conversation(p_conversation_id uuid) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  pu uuid := NULLIF(current_setting('app.current_parent_user', true), '')::uuid;
  sc uuid := NULLIF(current_setting('app.current_school', true), '')::uuid;
BEGIN
  IF pu IS NULL OR sc IS NULL THEN RETURN; END IF;  -- only a parent session bumps via this fn
  PERFORM set_config('app.current_parent_user', '', true);  -- relax parent_no_update for THIS update only
  UPDATE conversation c
     SET last_message_at = now(), status = 'OPEN'
   WHERE c.id = p_conversation_id
     AND c.school_id = sc
     AND c.student_id IN (SELECT parent_student_ids(c.school_id, pu))
     AND c.contact_phone IN (
       SELECT g.phone FROM student_guardian g
       WHERE g.school_id = c.school_id AND g.user_id = pu);
  PERFORM set_config('app.current_parent_user', pu::text, true);  -- restore the caller's session GUC
END;
$$;
-- On Supabase every public function is a PostgREST RPC (EXECUTE defaults to PUBLIC); a privileged
-- SECURITY DEFINER write must not be anon-callable. The owner keeps EXECUTE regardless of the REVOKE.
REVOKE EXECUTE ON FUNCTION parent_bump_conversation(uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnischools_app') THEN
    GRANT EXECUTE ON FUNCTION parent_bump_conversation(uuid) TO omnischools_app;
  END IF;
END $$;

-- ---- layer 1: parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql ----
-- 🔴 RUN THIS. It re-affirms RESTRICTIVE parent_deny on every FORCE-RLS + school_id table that does NOT
-- already carry a parent_scope policy. conversation + inbox_message still carry parent_scope, so they stay
-- EXCLUDED; every other tenant table (and any future one) stays auto-denied. Idempotent.
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
