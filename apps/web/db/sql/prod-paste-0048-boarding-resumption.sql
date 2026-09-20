-- Omnischools — migration 0048: Boarding resumption/vacation (SHS module 4.2 / INCR-11).
-- The ONE NEW tenant table (boarding_arrival) plus its enum + its RLS. Idempotent — safe to run more
-- than once. Paste into the Supabase SQL editor on PROD after merging. (db:policies only configures
-- local dev; a new tenant table needs its RLS pasted on prod by hand, or it leaks across schools.)
--
-- SCOPE: this file is the NEW-TABLE half of 0048 — boarding_arrival + the boarding_mode enum + FORCE
-- RLS on boarding_arrival. It is the RLS companion to migration 0048, NOT a replacement: run migration
-- 0048 on prod too (it also carries the two ALTER/backfill tweaks below, which need NO new RLS):
--   • TWEAK #1 — academic_period.product_line (column ALTER + backfill/seed on the already-RLS'd
--     academic_period). No new table, no new RLS.
--   • TWEAK #3 — inspections.dormitory_id → nullable + inspections.house_id (ALTER + WEEKLY backfill on
--     the already-RLS'd inspections). No new table, no new RLS.
-- Neither tweak adds a tenant table, so neither appears here — only boarding_arrival needs a policy.
--
-- DDL ORDER (recall the 0033 FK-before-UNIQUE bug): enum → table → FKs → indexes → RLS. boarding_arrival
-- is a LEAF table (nothing references it) so it carries NO composite (school_id, id) tenant UK; its
-- uniq_boarding_arrival UNIQUE is a business key (the upsert conflict target), carried INLINE in CREATE
-- TABLE. Every composite-FK target is an already-SHIPPED UK/PK (students_tenant_uk, house_tenant_uk,
-- academic_period_tenant_uk, ref_school PK, ref_user PK) — so no FK-before-UNIQUE hazard here.

-- ---- enum needed by the arrival table ----
DO $$ BEGIN
  CREATE TYPE "public"."boarding_mode" AS ENUM('RESUMPTION', 'VACATION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- table (LEAF: no tenant UK; business-key UK inline; FKs added after) ----
-- boarding_arrival — one gate-check per boarder per (semester × mode), discriminated by `mode`
-- (RESUMPTION arrival / VACATION departure — one surface, one table). checklist_json shape is
-- discriminated by `mode` and validated in lib/ (NO DB CHECK — portability). fee_owing_snapshot is a
-- frozen FLAG (never a block — GES cannot-detain, mirrors boarding_exeat). checked_at = arrived_at
-- (RESUMPTION) / departed_at (VACATION). NO bunk_id (current_bunk_id read live), NO window column
-- (derived). uniq_boarding_arrival is the upsert / re-scan idempotency target — mode in the key lets a
-- RESUMPTION + VACATION row coexist per (student × period).
CREATE TABLE IF NOT EXISTS "boarding_arrival" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "house_id" uuid NOT NULL,
  "academic_period_id" uuid NOT NULL,
  "mode" "boarding_mode" NOT NULL,
  "checklist_json" jsonb NOT NULL,
  "fee_owing_snapshot" numeric(12, 2),
  "note" text,
  "checked_at" timestamptz DEFAULT now() NOT NULL,
  "checked_by_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_boarding_arrival" UNIQUE("school_id","student_id","academic_period_id","mode")
);

-- ---- foreign keys ----
-- single-column school_id -> ref_school; single-column SET NULL actor -> ref_user; composite
-- (school_id, student_id) -> students, (school_id, house_id) -> house, (school_id, academic_period_id)
-- -> academic_period (each an already-shipped tenant UK/PK).
DO $$ BEGIN
  ALTER TABLE "boarding_arrival" ADD CONSTRAINT "boarding_arrival_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_arrival" ADD CONSTRAINT "boarding_arrival_checked_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("checked_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_arrival" ADD CONSTRAINT "boarding_arrival_school_id_student_id_students_school_id_id_fk"
    FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_arrival" ADD CONSTRAINT "boarding_arrival_school_id_house_id_house_school_id_id_fk"
    FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "boarding_arrival" ADD CONSTRAINT "boarding_arrival_school_id_academic_period_id_academic_period_s"
    FOREIGN KEY ("school_id","academic_period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- index ----
CREATE INDEX IF NOT EXISTS "boarding_arrival_house_period_mode_idx"
  ON "boarding_arrival" USING btree ("school_id","house_id","academic_period_id","mode");

-- ---- RLS — the same tenant_isolation policy every other tenant table uses ----
ALTER TABLE "boarding_arrival" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boarding_arrival" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "boarding_arrival";
CREATE POLICY tenant_isolation ON "boarding_arrival" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );
