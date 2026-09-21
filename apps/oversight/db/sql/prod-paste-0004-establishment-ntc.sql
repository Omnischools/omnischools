-- =============================================================================
-- Omnischools OVERSIGHT — PROD hand-paste 0004: GES establishment ETL, NTC-based reshape
--   ref_ges_teacher_establishment: staff_ids (GES id array) → establishment_teachers
--     ({ ntc_licence_number, name? } array) + UNIQUE (emis_school_id, as_of_date)
--   ref_emis_school_register: + operational_school_id (additive; no paste needed for THAT column,
--     included here only in the verification block)
--
-- ⚠ JURISDICTION RLS IS NOT AUTO-APPLIED ON PROD. `pnpm db:policies` (scripts/apply-policies.ts →
-- db/sql/policies.sql) only configures LOCAL DEV. Per docs/PROVISIONING.md §2a a purely-additive
-- column needs the migration only (no paste), but a RESHAPE + new CONSTRAINT needs this paste. Paste
-- it into the Supabase SQL editor on `omnischools-analytics-prod` AFTER migration
-- 0003_funny_blindfold.sql has run — never before. Run the verification block at the foot.
--
-- POSTURE PRESERVED — ENABLE, NEVER FORCE. Both tables already carry RLS ENABLED (not FORCE) with a
-- `jurisdiction_scope` SELECT policy from the initial db/sql/policies.sql application. The nightly
-- ETL loader connects as the owner / a BYPASSRLS role and MUST keep writing, so FORCE would break
-- the load. This paste RE-ASSERTS that exact posture idempotently — it does not change it. Dropping
-- a column and adding a UNIQUE does not disable RLS or drop a policy (the policy has no column list,
-- so it already covers establishment_teachers / operational_school_id), so the re-assert is a no-op
-- on a correctly-migrated DB and a repair if a prior step was lost.
--
-- WHY A PASTE FOR A RESHAPE. The migration (step 1, applied by hand per §2a.1) carries the DDL: the
-- two ADD COLUMNs, the ADD CONSTRAINT and the DROP COLUMN. This paste (step 2) is the RLS/constraint
-- backstop the convention requires for any non-additive change: it re-asserts the jurisdiction
-- isolation and the vintage UNIQUE, then PROVES both on prod. Idempotent: safe to re-run any number
-- of times, in any order after the migration.
-- =============================================================================

-- Fail-closed guard: the table and the shared predicate must exist (migration + initial policies.sql).
DO $$
BEGIN
  IF to_regclass('public.ref_ges_teacher_establishment') IS NULL THEN
    RAISE EXCEPTION 'ref_ges_teacher_establishment missing — run migration 0003_funny_blindfold BEFORE this paste';
  END IF;
  IF to_regclass('public.ref_emis_school_register') IS NULL THEN
    RAISE EXCEPTION 'ref_emis_school_register missing — run migration 0003_funny_blindfold BEFORE this paste';
  END IF;
  IF to_regprocedure('public.ov_in_subtree(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ov_in_subtree(uuid) is missing — apply db/sql/policies.sql to this database first';
  END IF;
END
$$;

-- The reshape must have landed before RLS is (re-)asserted: establishment_teachers present,
-- staff_ids gone. If this fails, the migration was not applied — stop and apply it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ref_ges_teacher_establishment'
      AND column_name='establishment_teachers'
  ) THEN
    RAISE EXCEPTION 'establishment_teachers column missing — migration 0003_funny_blindfold not applied';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ref_ges_teacher_establishment'
      AND column_name='staff_ids'
  ) THEN
    RAISE EXCEPTION 'staff_ids column still present — migration 0003_funny_blindfold DROP did not run';
  END IF;
END
$$;

-- ---- Idempotently ensure the vintage UNIQUE (create only if absent) --------
-- The migration adds it; this is the repair path if that step was lost. One establishment vintage
-- per (school, as-of date) — the current vintage is MAX(as_of_date), and this stops a duplicate
-- same-date load from creating two "current" rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.ref_ges_teacher_establishment'::regclass
      AND conname='uniq_establishment_vintage'
  ) THEN
    ALTER TABLE ref_ges_teacher_establishment
      ADD CONSTRAINT uniq_establishment_vintage UNIQUE (emis_school_id, as_of_date);
  END IF;
END
$$;

-- ---- Re-assert ENABLE RLS + the standard jurisdiction_scope SELECT policy ----
-- Scoped through the register (the table is keyed by emis_school_id, not a dim uuid) — the SAME
-- predicate db/sql/policies.sql installs. NOT FORCE: the ETL owner/BYPASSRLS loader must keep writing.
ALTER TABLE ref_ges_teacher_establishment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jurisdiction_scope ON ref_ges_teacher_establishment;
CREATE POLICY jurisdiction_scope ON ref_ges_teacher_establishment
  FOR SELECT USING ( EXISTS (
    SELECT 1 FROM ref_emis_school_register r
    WHERE r.emis_school_id = ref_ges_teacher_establishment.emis_school_id
      AND ov_in_subtree(r.district_id)
  ) );

ALTER TABLE ref_emis_school_register ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jurisdiction_scope ON ref_emis_school_register;
CREATE POLICY jurisdiction_scope ON ref_emis_school_register
  FOR SELECT USING ( ov_in_subtree(district_id) );

-- No new grant to the read-back role: the STATUTORY branch reads this register over
-- ANALYTICS_DATABASE_URL under jurisdiction RLS (classify.ts), and the operational binding reads
-- staff_profile.ntc_licence_number, already covered by the table-wide staff_profile grant
-- (PROVISIONING §4a). ref_ges_teacher_establishment stays OUT of the operational read-back grant.

-- ---- Verification (run after the paste) ------------------------------------
-- 1) Reshape + posture (expect: rls_enabled=t, rls_forced=f, policies=jurisdiction_scope, has UNIQUE):
-- SELECT c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
--        (SELECT string_agg(polname, ',') FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
--        EXISTS (SELECT 1 FROM pg_constraint k
--                WHERE k.conrelid=c.oid AND k.conname='uniq_establishment_vintage') AS has_vintage_unique
--   FROM pg_class c
--  WHERE c.relname IN ('ref_ges_teacher_establishment','ref_emis_school_register')
--  ORDER BY c.relname;
--
-- 2) operational_school_id landed on the register (additive column, expect one row, is_nullable=YES):
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--  WHERE table_name='ref_emis_school_register' AND column_name='operational_school_id';
--
-- 3) As the NON-OWNER app role (the owner masks RLS), the boundary still holds:
-- SET app.current_level = 'DISTRICT';
-- SET app.current_jurisdiction = '<some district uuid>';
-- SELECT count(*) FROM ref_ges_teacher_establishment;   -- only that district's schools, never another's
