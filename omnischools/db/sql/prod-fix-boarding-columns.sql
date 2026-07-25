-- ---------------------------------------------------------------------------
-- PROD FIX — the boarding-tier columns prod-fix-house-hm-user-id.sql flagged.
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS. `prod-fix-house-hm-user-id.sql` closed only `house.hm_user_id` (0058's immediate
-- blocker) and explicitly flagged the rest: "prod is behind on the boarding-tier column migrations
-- (0044/0045 add gender, capacity, founded_year, named_after to `house` too)". A full prod↔migrations
-- schema diff (scripts/prod-schema-diff.ts) then confirmed the COMPLETE set of drift — five columns,
-- one enum type, and one composite FK — all added by migrations 0044/0045, never hand-applied to prod:
--
--     house.gender        (enum house_gender)   house.capacity     (integer)
--     house.founded_year  (smallint)            house.named_after  (text)
--     students.current_bunk_id (uuid) + its (school_id, current_bunk_id) → boarding_bunk FK
--
-- The enum TYPE `house_gender` was ALSO missing — it rides with `house.gender`, which was never
-- pasted, so the type was never created. `ADD COLUMN ... house_gender` fails until the type exists.
--
-- Every column is NULLABLE, so ADD COLUMN is instant on the populated prod tables — no rewrite, no
-- default. Nothing on prod referenced these yet (same as hm_user_id — latent until 0058 touched it).
--
-- SAFE TO RE-RUN — idempotent (enum guarded by duplicate_object, ADD COLUMN IF NOT EXISTS, FK guarded
-- by duplicate_object). Applied to prod 2026-07-23 via read/write SQL; recorded here for the audit
-- trail and so any environment rebuilt by hand-paste can reach parity.
-- ---------------------------------------------------------------------------

-- 1) the enum type house.gender needs (BOYS/GIRLS/COED, migration 0044)
do $$ begin
  create type public.house_gender as enum ('BOYS', 'GIRLS', 'COED');
exception when duplicate_object then null;
end $$;

-- 2) the four boarding columns on the (existing) house table
alter table public.house add column if not exists gender       house_gender;
alter table public.house add column if not exists capacity     integer;
alter table public.house add column if not exists founded_year smallint;
alter table public.house add column if not exists named_after  text;

-- 3) students.current_bunk_id and its composite tenant FK (ON DELETE SET NULL)
alter table public.students add column if not exists current_bunk_id uuid;

do $$ begin
  alter table public.students
    add constraint students_current_bunk_id_tenant_fk
    foreign key (school_id, current_bunk_id)
    references public.boarding_bunk (school_id, id)
    on delete set null;
exception when duplicate_object then null;
end $$;

-- verify (read-only): house should have 11 columns, students.current_bunk_id present.
--   SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='house';
--   -- expect 11
