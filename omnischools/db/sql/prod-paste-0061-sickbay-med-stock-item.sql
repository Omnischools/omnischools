-- Omnischools — migration 0061: sickbay_med_admin.stock_item_id (SHS module 4.4 / INCR-24b, R168).
-- ONE new nullable column + ONE composite RESTRICT FK + ONE CHECK on the EXISTING, already-RLS'd
-- sickbay_med_admin table (the MAR, shipped 0060). Idempotent — safe to run more than once. Paste
-- into the Supabase SQL editor on PROD after merging, at deploy WITH the increment.
--
-- ⚠ NO RLS CHANGE. This adds a column + FK + CHECK to sickbay_med_admin, which ALREADY carries
-- ENABLE + FORCE RLS + tenant_isolation + parent_deny from prod-paste-0060-sickbay-medication.sql.
-- New columns and constraints are covered by the table's existing policies; there is no new table, no
-- new policy, no verify-prod-rls delta. (Still hand-run: db:policies configures LOCAL DEV only, but
-- there is simply no RLS to apply here — the row-security boundary is unchanged.)
--
-- WHAT IT DOES (R168): records WHICH sickbay_stock_item a MAR dose drew from, and makes it MANDATORY
-- for a controlled dose. `stock_item_id` is nullable because a CHRONIC "patient's own surrendered
-- bottle" dose (R163) draws no school stock; the CHECK `med_admin_controlled_needs_stock_item` is the
-- exact twin of the shipped `med_admin_controlled_needs_qty`, on the same is_controlled key, so a
-- controlled row without a stock item is rejected. Both bite on ALL controlled rows (not just GIVEN);
-- a controlled REFUSED/HELD/OMITTED carries dispensed_qty=0 + a stock_item_id, and the derived balance
-- sums only GIVEN so the 0 never moves it. The composite (school_id, stock_item_id) FK →
-- sickbay_stock_item_tenant_uk is ON DELETE RESTRICT (a stocked item with administration history must
-- not vanish) and makes a cross-tenant stock reference structurally impossible.
--
-- ⚠ DDL ORDER — no 0033 hazard here: the FK target `sickbay_stock_item_tenant_uk` shipped in 0060, so
-- it already exists before this ADD FOREIGN KEY. Statements are emitted COLUMN → FK → CHECK, matching
-- db\migrations\0061_careless_klaw.sql exactly. The FK constraint name is written PRE-truncation as
-- drizzle emits it (>63 chars); Postgres truncates it identically on both the migrate and paste paths
-- (a NOTICE, not an error), keeping the catalog byte-identical (pg_get_constraintdef).
--
-- SCOPE: ONE existing table, ADD-only. No data change, no backfill, no seed, no GLOBAL-table change,
-- no RLS. The MAR write that fills stock_item_id + the getControlledRegister reader switch (drug_name
-- → stock_item_id) are Claude Code's 24b app-layer work, not this file.

ALTER TABLE "sickbay_med_admin" ADD COLUMN IF NOT EXISTS "stock_item_id" uuid;

DO $$ BEGIN
  ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_school_id_stock_item_id_sickbay_stock_item_school_id_id_fk" FOREIGN KEY ("school_id","stock_item_id") REFERENCES "public"."sickbay_stock_item"("school_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "med_admin_controlled_needs_stock_item" CHECK (NOT "sickbay_med_admin"."is_controlled" OR "sickbay_med_admin"."stock_item_id" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
