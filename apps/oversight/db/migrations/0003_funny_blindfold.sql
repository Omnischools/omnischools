-- ---------------------------------------------------------------------------
-- GES ESTABLISHMENT ETL — NTC-based reshape (Kofi AC-1.1, AC-2.1..2.3).
--
-- HAND-EDITED. Lines 1–3 (the two ADD COLUMN, the ADD CONSTRAINT) are drizzle-kit output verbatim;
-- the DROP COLUMN below is hand-appended. drizzle-kit 0.31.10 refuses to emit a same-table
-- drop+add without a TTY (it treats it as a possible column rename and prompts), so the migration
-- was generated with `staff_ids` still present (additive only), then `staff_ids` was removed from
-- db/schema/ref.ts and this DROP appended by hand. The 0003 snapshot was edited to match (the
-- `staff_ids` column object was removed from ref_ges_teacher_establishment). Re-add this DROP and
-- re-remove the snapshot column if this file is ever regenerated.
--
-- Why DROP + ADD and NOT rename: the lookup key changed from an opaque GES staff id (array of
-- strings) to `{ ntc_licence_number, name? }` objects keyed on the NTC licence number. A rename
-- would carry the OLD, mis-shaped data under the new name; the register is reloaded fresh by the
-- ETL, so a clean swap is correct. On the analytics DEV DB the table is empty; on prod the ETL
-- reloads per (emis_school_id, as_of_date).
--
-- RLS: ref_ges_teacher_establishment and ref_emis_school_register already have RLS ENABLED (not
-- FORCE) with a `jurisdiction_scope` SELECT policy from db/sql/policies.sql (applied at initial
-- provisioning). A policy declared without a column list covers every column, present and future,
-- so the new `operational_school_id` / `establishment_teachers` columns are covered automatically
-- and the DROP touches no policy (the policy references only emis_school_id). Because this is a
-- RESHAPE + new UNIQUE (not a purely-additive column change), it still carries a prod-paste per
-- PROVISIONING §2a: db/sql/prod-paste-0004-establishment-ntc.sql re-asserts the ENABLE-RLS posture
-- and the UNIQUE idempotently and verifies both on the live analytics DB after this migration runs.
-- ---------------------------------------------------------------------------
ALTER TABLE "ref_emis_school_register" ADD COLUMN "operational_school_id" uuid;--> statement-breakpoint
ALTER TABLE "ref_ges_teacher_establishment" ADD COLUMN "establishment_teachers" jsonb;--> statement-breakpoint
ALTER TABLE "ref_ges_teacher_establishment" ADD CONSTRAINT "uniq_establishment_vintage" UNIQUE("emis_school_id","as_of_date");--> statement-breakpoint
ALTER TABLE "ref_ges_teacher_establishment" DROP COLUMN "staff_ids";
