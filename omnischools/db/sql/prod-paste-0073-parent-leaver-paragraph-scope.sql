-- Omnischools — PROD paste 0073: PARENT-LEAVER-PARAGRAPH SCOPE (SHS module 4.5 / INCR-46). POLICY-ONLY —
-- ZERO new tables, ZERO enums, ZERO altered columns, ZERO backfills, ZERO migration. It adds a narrow
-- `parent_scope` policy to EXACTLY ONE existing table (vlc_pastoral_paragraph) and re-runs the
-- catalog-driven parent_deny loop. Idempotent — safe to run more than once. Paste into the Supabase SQL
-- editor on PROD after merging. Byte-identical in effect to the INCR-46 block in db/sql/policies.sql
-- (dev, db:policies). The table + locked_at column already shipped at migration 0070 (prod-paste-0072).
--
-- 🔴 WHY THIS IS THE MODULE'S MOST SENSITIVE PASTE. This is the FOURTH widening of the INCR-19a parent
-- boundary (12 → 13 parent_scope tables) AND the FIRST break in owner-#4 ("parents see NOTHING VLC-wide")
-- — the FIRST & ONLY VLC content a parent ever reads. Before it, vlc_pastoral_paragraph (like every other
-- vlc_* table) kept parent_deny; INCR-46 (owner-authorised, 2026-07-30) opens ROW access to EXACTLY ONE
-- row — a parent's OWN child's FINALISED paragraph — so the read-only parent portal can show the
-- FM-authored school-leaver character reference. A DRAFT (locked_at IS NULL) is NEVER visible to a parent
-- — the finalised-only guard lives IN the predicate.
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN — FAIL-CLOSED, NEVER A LEAK. db:policies configures LOCAL DEV ONLY.
-- Without this paste, vlc_pastoral_paragraph keeps its existing parent_deny on prod, so a parent session
-- (app.current_parent_user set) reads ZERO rows → the parent leaver-reference card is an honest empty
-- state, never a cross-tenant, cross-child, or draft leak. The cost of skipping is a blank card, not
-- exposure. Run it to actually ship the feature.
--
-- 🔴 COLUMN CONTROL LIVES IN THE READER. RLS is ROW-level and CANNOT mask columns. Once parent_scope
-- opens the row, an in-scope parent session CAN select any column off it (author/updated_by/locked_by
-- provenance actors, timestamps). The ONLY guard against those columns reaching the wire is the reader's
-- frozen key-set projection (R360) in lib/parent/parent-reference-data.ts — it selects `body` only and
-- re-filters locked_at IS NOT NULL (belt-and-suspenders). A view over a parent_deny base table does NOT
-- solve this: it is non-functional here (FORCE RLS + a single shared non-superuser app role + no
-- BYPASSRLS) — it returns 0 rows to a parent on prod. Column control is in the app reader by construction.
--
-- SCOPE — EXACTLY ONE TABLE CHANGES. Only vlc_pastoral_paragraph gains parent_scope (its old parent_deny
-- is dropped). EVERY OTHER vlc_* table is UNAFFECTED: the catalog parent_deny loop at the bottom
-- re-affirms parent_deny on vlc_pastoral_flag, vlc_pastoral_journal, vlc_pastoral_note,
-- vlc_pastoral_observation, vlc_pastoral_case, vlc_session, vlc_session_attendance, vlc_programme,
-- vlc_value, vlc_session_template, vlc_peer_guide, vlc_training and vlc_training_absence (it auto-EXCLUDES
-- vlc_pastoral_paragraph, which now carries parent_scope, exactly as it excludes the 12 shipped ones).
-- Tenant isolation is untouched on every table.
--
-- Verify afterwards:
--   -- exactly vlc_pastoral_paragraph carries parent_scope, every other vlc_* carries parent_deny:
--   select c.relname, p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
--   where c.relname like 'vlc_%' and p.polname in ('parent_scope','parent_deny') order by 1, 2;
--   -- and db/sql/verify-prod-rls.sql: Query 1 must return ZERO ROWS; tenant_tables unchanged;
--   -- parent_scope up by 1 (13) and parent_denied down by 1.

-- ---- layer 2: the ONE new parent_scope policy (byte-identical to db/sql/policies.sql INCR-46 block) ----
-- Shape mirrors the 12 shipped policies (student_id IN parent_student_ids(school_id, <parent GUC>)) PLUS
-- the readiness_statements STATE restriction (superseded_at IS NULL there → locked_at IS NOT NULL here).
-- vlc_pastoral_paragraph carries student_id + school_id + locked_at directly, so this is the simplest
-- child-reach form, gated by the finalised state. FINALISED-only is the crux: a DRAFT (locked_at IS NULL)
-- is NEVER returned to a parent by RLS. USING doubles as WITH CHECK, so a parent write is confined to the
-- same finalised-own-child scope — no draft insert, no unlock, no cross-child write.

-- vlc_pastoral_paragraph — the parent reads their OWN child's FINALISED leaver paragraph (drafts never).
DROP POLICY IF EXISTS parent_deny ON vlc_pastoral_paragraph;
DROP POLICY IF EXISTS parent_scope ON vlc_pastoral_paragraph;
CREATE POLICY parent_scope ON vlc_pastoral_paragraph AS RESTRICTIVE FOR ALL TO public
  USING (
    NULLIF(current_setting('app.current_parent_user', true), '') IS NULL
    OR (
      locked_at IS NOT NULL
      AND student_id IN (
        SELECT parent_student_ids(
          school_id, NULLIF(current_setting('app.current_parent_user', true), '')::uuid)
      )
    )
  );

-- ---- layer 1: parent_deny — the CATALOG-DRIVEN loop, verbatim from db/sql/policies.sql ----
-- 🔴 RUN THIS. It is NOT a hand-list: it applies parent_deny to every FORCE-RLS + school_id table that
-- does NOT already carry a parent_scope policy — which, after the block above, is every tenant table
-- EXCEPT the 13 parent-readable ones (the 12 shipped + the 1 added here). It re-creates identical
-- policies on the already-covered tables (hence idempotent) and, crucially, KEEPS vlc_pastoral_paragraph
-- EXCLUDED (it now carries parent_scope) while re-affirming parent_deny on every other vlc_* table. It
-- is what keeps a FUTURE tenant table auto-denied with zero code change.
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
