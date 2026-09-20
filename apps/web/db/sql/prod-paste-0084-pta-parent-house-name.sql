-- Omnischools — PROD paste 0084: PTA PARENT HOUSE-NAME read (SHS module 4.7 / INCR-58 Item 1; Kofi R483).
-- FUNCTION ONLY — ZERO new tables, ZERO enums, ZERO altered columns, ZERO backfills, ZERO migration, and
-- ZERO policy changes. It adds ONE SECURITY DEFINER helper (parent_house_names) so the parent portal can
-- resolve the NAME of their OWN children's houses and relabel the generic "House PTA". Idempotent
-- (CREATE OR REPLACE) — safe to run more than once. Paste into the Supabase SQL editor on PROD after
-- merging. Byte-identical in effect to the INCR-58 block in db/sql/policies.sql (dev, db:policies). The
-- `house` and `students` tables + every column read here already shipped; parent_student_ids() already
-- exists on prod (prod-paste-0055, INCR-19a) and is NOT re-created here.
--
-- 🔴 THE `house` TABLE STAYS parent_deny — DO NOT OPEN IT. It carries staff PII IN-ROW (hm_user_id, the
-- resident housemaster) plus colour / capacity / gender / founded_year / named_after / active. Opening the
-- row with a parent_scope policy (Kofi's Option 1) would leave the reader projection as the ONLY guard on
-- the housemaster. This function (Kofi's Option 2) IS the immutable column guard: it returns ONLY (id, name),
-- so a parent can never reach hm_user_id / colour / capacity / etc. even via a mutated reader — strictly
-- tighter than a row-opening parent_scope. There is NO change to the parent_deny catalog here: `house` keeps
-- parent_deny on prod (already applied), and no table's parent_scope status changes, so the catalog loop is
-- NOT re-run and the parent_readable / parent_denied counts are UNCHANGED.
--
-- 🔴 ACYCLIC. No parent_scope policy on `house` exists, so there is no policy-reads-its-own-table concern —
-- this is a plain definer read, the parent_student_ids / parent_pta_ids idiom. STABLE, SECURITY DEFINER,
-- search_path = public, pg_temp with pg_temp LAST (an injected temp `house`/`students` cannot spoof the
-- answer). The reach set = the parent's OWN children's houses via students.house_id. `pu` is the GUC arg,
-- NEVER a row column; a NULL pu → empty parent_student_ids → 0 rows (fail-closed).
--
-- ⚠ WHAT HAPPENS IF THIS IS NOT RUN — FAIL-CLOSED, NEVER A LEAK. db:policies configures LOCAL DEV ONLY.
-- Without this paste the function is simply absent on prod; the parent House-PTA card keeps the generic
-- "House PTA" label and never leaks a housemaster, a colour, or another family's house — the cost of
-- skipping is a generic label, not exposure.
--
-- Verify afterwards (db/sql/verify-prod-rls.sql):
--   -- Query 1 must return ZERO ROWS (no table opened); Query 2 tenant_tables / parent_readable /
--   -- parent_denied are ALL UNCHANGED (a function was added, no policy moved).
--   -- Presence check: SELECT proname FROM pg_proc WHERE proname = 'parent_house_names';  -- one row.

-- ---- SECURITY DEFINER helper: the parent's OWN children's houses as (id, name) ONLY (R483) ----
CREATE OR REPLACE FUNCTION parent_house_names(school uuid, pu uuid)
  RETURNS TABLE(house_id uuid, house_name text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT h.id, h.name
  FROM house h
  WHERE h.school_id = school
    AND h.id IN (
      SELECT DISTINCT s.house_id
      FROM students s
      WHERE s.school_id = school
        AND s.house_id IS NOT NULL
        AND s.id IN (SELECT parent_student_ids(school, pu))
    )
$$;
