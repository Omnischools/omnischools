-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- VERIFY PROD RLS — READ-ONLY. Safe to run on production. Makes NO changes (SELECT only).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS
--   `db:policies` only configures LOCAL DEV. On prod, RLS is applied solely by hand-pasting the
--   `db/sql/prod-paste-*.sql` files (28 of them as of INCR-20). A single missed paste means those
--   tables have NO tenant isolation on prod — one school reads another school's children's data.
--
--   Do NOT try to verify "did I run file 0042?" — provenance is unknowable after the fact. Verify
--   the OUTCOME instead: is every tenant table isolated RIGHT NOW. That is strictly stronger than
--   a checklist, and it is exactly the check that caught `student_health_record` sitting with RLS
--   off since migration 0036 (found on dev during INCR-19a).
--
-- VERIFIED 2026-07-21 (post-INCR-20): prod PASSED — Query 1 returned zero rows.
--   Prod counts: 88 tenant tables / 88 forced / 88 tenant_isolation / 9 parent-readable + 79 denied / 3 global.
--   Dev counts:  87 / 87 / 87 / 9 + 78 / 3.
--
--   The one-table difference is `student_subject_enrolment` — present on PROD ONLY, 0 rows, 24 kB,
--   correctly ENABLE+FORCE with tenant_isolation + parent_deny. It appears NOWHERE in this repo: not in
--   db/schema, not in any migration, not in db/sql, not in application code, and not in any commit on any
--   branch (`git log -S --all` is empty). Since tenant_isolation is applied from a hardcoded array (below)
--   and 0055's catalog loop only adds parent_deny to already-FORCE-RLS tables, BOTH the table and its RLS
--   were applied to prod outside this repository. It is inert and isolated — but it is evidence that
--   something once wrote directly to production. If prod's tenant_tables exceeds dev's again, re-run the
--   diff (list dev's tenant tables, then `... AND c.relname NOT IN (<that list>)` on prod) before assuming
--   a new leak. Drop it only after confirming no dependent objects; it is safe to leave.
--
-- HOW TO USE
--   Open the Supabase SQL editor on the PROD project. Run QUERY 1. Then run QUERY 2.
--   (Run them one at a time — the editor shows only the last result set.)
--
--   QUERY 1 returns ONE ROW PER PROBLEM.  ► ZERO ROWS = PASS. ◄
--   Anything returned is a live misconfiguration; paste the matching prod-paste file, then re-run.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- QUERY 1 — THE PROBLEM REPORT.  Zero rows = every check passed.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
WITH tt AS (
  -- Every TENANT table = a real table in `public` carrying a school_id column.
  SELECT c.oid,
         c.relname,
         c.relrowsecurity      AS rls_on,
         c.relforcerowsecurity AS rls_forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.oid
                    AND a.attname  = 'school_id'
                    AND NOT a.attisdropped)
),
p AS (
  SELECT polrelid, polname, polpermissive FROM pg_policy
),
glob AS (
  -- Global reference tables hold NO tenant data. They are CORRECTLY bare-ENABLE:
  -- RLS on, FORCE off, zero policies. (Owner stays exempt; the Data API is denied.)
  SELECT c.oid,
         c.relname,
         c.relrowsecurity      AS rls_on,
         c.relforcerowsecurity AS rls_forced,
         (SELECT count(*) FROM pg_policy x WHERE x.polrelid = c.oid) AS npol
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname IN ('benchmark_reference', 'universities', 'university_programmes')
)

-- A · TENANT ISOLATION — the headline leak check.
--     A table here is readable across schools, or readable by the owner role despite RLS.
SELECT 'A · tenant isolation'::text AS check_name,
       tt.relname::text             AS object,
       concat_ws(' · ',
         CASE WHEN NOT tt.rls_on     THEN 'RLS NOT ENABLED — table is fully cross-tenant readable' END,
         CASE WHEN NOT tt.rls_forced THEN 'FORCE missing — the table owner bypasses RLS entirely'  END,
         CASE WHEN NOT EXISTS (SELECT 1 FROM p WHERE p.polrelid = tt.oid AND p.polname = 'tenant_isolation')
              THEN 'no tenant_isolation policy' END,
         CASE WHEN EXISTS (SELECT 1 FROM p WHERE p.polrelid = tt.oid AND p.polname = 'tenant_isolation'
                             AND NOT p.polpermissive)
              THEN 'tenant_isolation is RESTRICTIVE (it must be PERMISSIVE)' END
       )::text AS problem
  FROM tt
 WHERE NOT tt.rls_on
    OR NOT tt.rls_forced
    OR NOT EXISTS (SELECT 1 FROM p WHERE p.polrelid = tt.oid AND p.polname = 'tenant_isolation')
    OR EXISTS     (SELECT 1 FROM p WHERE p.polrelid = tt.oid AND p.polname = 'tenant_isolation'
                     AND NOT p.polpermissive)

UNION ALL

-- B · PARENT BOUNDARY (INCR-19a, prod-paste-0055) — the per-user parent scope.
--     Every FORCE-RLS tenant table must carry either `parent_scope` (the small readable set) or
--     `parent_deny` (everything else). Both MUST be RESTRICTIVE: Postgres OR's permissive policies
--     together, so a PERMISSIVE parent policy would OR with tenant_isolation and hand a claimed
--     parent the entire school.
SELECT 'B · parent boundary'::text,
       tt.relname::text,
       concat_ws(' · ',
         CASE WHEN NOT EXISTS (SELECT 1 FROM p WHERE p.polrelid = tt.oid
                                 AND p.polname IN ('parent_deny', 'parent_scope'))
              THEN 'neither parent_deny nor parent_scope — a claimed parent can read this table' END,
         CASE WHEN EXISTS (SELECT 1 FROM p WHERE p.polrelid = tt.oid
                             AND p.polname IN ('parent_deny', 'parent_scope')
                             AND p.polpermissive)
              THEN 'parent policy is PERMISSIVE — must be RESTRICTIVE, or it ORs with tenant_isolation and leaks the whole school' END
       )::text
  FROM tt
 WHERE tt.rls_forced
   AND ( NOT EXISTS (SELECT 1 FROM p WHERE p.polrelid = tt.oid
                       AND p.polname IN ('parent_deny', 'parent_scope'))
      OR EXISTS     (SELECT 1 FROM p WHERE p.polrelid = tt.oid
                       AND p.polname IN ('parent_deny', 'parent_scope')
                       AND p.polpermissive) )

UNION ALL

-- C · GLOBAL REFERENCE TABLES — must be ENABLE only (no FORCE, no policy).
--     A FORCE or a stray policy here breaks legitimate global reads.
SELECT 'C · global reference'::text,
       g.relname::text,
       concat_ws(' · ',
         CASE WHEN NOT g.rls_on THEN 'RLS NOT ENABLED' END,
         CASE WHEN g.rls_forced THEN 'FORCE is set — global tables must NOT be forced' END,
         CASE WHEN g.npol > 0   THEN g.npol || ' policy/policies present — global tables must have none' END
       )::text
  FROM glob g
 WHERE NOT g.rls_on OR g.rls_forced OR g.npol > 0

 ORDER BY 1, 2;


-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- QUERY 2 — CONFIDENCE SUMMARY. Run separately. Confirms the check above actually saw your data
-- (a zero-row PASS is only meaningful if `tenant_tables` is a plausible number, not 0).
-- Reference shape as of INCR-20: ~87 tenant tables, 9 with parent_scope, the rest parent_deny,
-- 3 global reference tables. Exact counts grow each increment — the ratios are what matter.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
WITH tt AS (
  SELECT c.oid, c.relrowsecurity AS rls_on, c.relforcerowsecurity AS rls_forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'school_id' AND NOT a.attisdropped)
)
SELECT (SELECT count(*) FROM tt)                                                  AS tenant_tables,
       (SELECT count(*) FROM tt WHERE rls_on AND rls_forced)                      AS fully_forced,
       (SELECT count(*) FROM tt t JOIN pg_policy p ON p.polrelid = t.oid
         WHERE p.polname = 'tenant_isolation')                                    AS with_tenant_isolation,
       (SELECT count(*) FROM tt t JOIN pg_policy p ON p.polrelid = t.oid
         WHERE p.polname = 'parent_scope')                                        AS parent_readable,
       (SELECT count(*) FROM tt t JOIN pg_policy p ON p.polrelid = t.oid
         WHERE p.polname = 'parent_deny')                                         AS parent_denied,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'
           AND c.relname IN ('benchmark_reference','universities','university_programmes')
           AND c.relrowsecurity AND NOT c.relforcerowsecurity)                    AS global_ok;
