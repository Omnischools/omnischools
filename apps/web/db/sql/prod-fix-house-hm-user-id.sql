-- ---------------------------------------------------------------------------
-- PROD PREREQUISITE for prod-paste-0058-sickbay-chronic.sql
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS. Pasting 0058 on prod failed at `chronic_entry_readable` with:
--     ERROR: 42703: column h.hm_user_id does not exist   (LINE 444: AND h.hm_user_id = su)
--
-- The reference is CORRECT — `house.hm_user_id` is the boarding-tier housemaster pointer, added by
-- migration 0044 (`0044_sturdy_post.sql`: `ALTER TABLE "house" ADD COLUMN "hm_user_id" uuid`) and
-- present on dev. The `house` TABLE exists on prod (0038 — 0058's grant→house FK to house(school_id,id)
-- applied before the failure), but 0044's COLUMN-ADD was never hand-applied to prod. R107's house-tie
-- grant liveness (`houses.hm_user_id = grantee`) needs it, so the fix is to bring prod's `house` up to
-- 0044, NOT to weaken the function.
--
-- ⚠ BROADER SIGNAL: prod is behind on the boarding-tier column migrations (0044/0045 add gender,
-- capacity, founded_year, named_after to `house` too). 0058 only needs `hm_user_id`, so this file adds
-- only that. Reconcile prod's full boarding schema against the migration chain before the senior tier
-- serves prod traffic.
--
-- SAFE TO RE-RUN — idempotent (`ADD COLUMN IF NOT EXISTS`, FK guarded against duplicate_object).
--
-- ORDER ON PROD:
--   1. (optional) the diagnostic below — expect house=1, hm_user_id=0, students.house_id=1
--   2. this file
--   3. re-run prod-paste-0058-sickbay-chronic.sql  (idempotent — completes helpers 2/3 + the four
--      staff_grant_scope policies + delete/freeze + the parent_deny loop, none of which applied)
--   4. re-run prod-paste-0055-parent-linkage.sql   (the parent_student_ids search_path fix)
--   5. db/sql/verify-prod-rls.sql — Query 1 zero rows; the header pg_policy query returns 17 chronic
--      policies (entry 4 / med 4 / grant 4 / read 5)
-- ---------------------------------------------------------------------------

-- Diagnostic (read-only) — confirm the gap before writing. If `students_house_id` comes back 0, STOP
-- and report it: the function also reads `students.house_id` (0038) and prod is missing more than one
-- boarding column; this file does not cover that case.
--   SELECT to_regclass('public.house')                                                   AS house_table,
--          (SELECT count(*) FROM information_schema.columns
--             WHERE table_name='house'    AND column_name='hm_user_id')                   AS house_hm_user_id,
--          (SELECT count(*) FROM information_schema.columns
--             WHERE table_name='students' AND column_name='house_id')                     AS students_house_id;

-- The fix — matches 0044 exactly.
ALTER TABLE "house" ADD COLUMN IF NOT EXISTS "hm_user_id" uuid;

DO $$ BEGIN
  ALTER TABLE "house" ADD CONSTRAINT "house_hm_user_id_ref_user_id_fk"
    FOREIGN KEY ("hm_user_id") REFERENCES "public"."ref_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
