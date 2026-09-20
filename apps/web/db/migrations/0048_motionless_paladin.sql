-- Migration 0048 — Boarding resumption/vacation (SHS module 4.2 / INCR-11) + two co-migrated tweaks.
-- Hand-edited after drizzle-kit generate to add the data backfills/seed drizzle cannot emit:
--   • NEW tenant table boarding_arrival + boarding_mode enum (RLS is pasted separately — db:policies
--     dev + prod-paste-0048-boarding-resumption.sql prod).
--   • TWEAK #1: academic_period.product_line (NOT NULL) — added NULLABLE → backfilled from
--     ref_academic_period_config.period_type (SEMESTER→SENIOR, TERM→BASIC) → SENIOR_F3 rows seeded
--     for existing SHS schools from gen_period_defaults → SET NOT NULL (the safe NOT-NULL-add order).
--   • TWEAK #3: inspections.dormitory_id → nullable, add house_id (composite FK) → backfill WEEKLY rows.
--
-- DDL ORDER (recall the 0033 FK-before-UNIQUE bug): enum → table → column ALTERs → FKs → indexes,
-- with the DML (backfill/seed) slotted after the column exists and before any dependent NOT NULL.
-- Every composite-FK target here is an ALREADY-SHIPPED UK/PK (students_tenant_uk, house_tenant_uk,
-- academic_period_tenant_uk, ref_school PK, ref_user PK) — so no FK-before-UNIQUE hazard. boarding_arrival
-- is a LEAF table: its uniq_boarding_arrival UNIQUE is a business key (the upsert target), NOT a tenant-FK
-- target, so it is carried INLINE in CREATE TABLE and NO composite (school_id, id) tenant UK is added.

CREATE TYPE "public"."boarding_mode" AS ENUM('RESUMPTION', 'VACATION');--> statement-breakpoint
CREATE TABLE "boarding_arrival" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"house_id" uuid NOT NULL,
	"academic_period_id" uuid NOT NULL,
	"mode" "boarding_mode" NOT NULL,
	"checklist_json" jsonb NOT NULL,
	"fee_owing_snapshot" numeric(12, 2),
	"note" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_boarding_arrival" UNIQUE("school_id","student_id","academic_period_id","mode")
);
--> statement-breakpoint
-- ---- TWEAK #3: inspections dormitory_id → nullable, add house_id (WEEKLY anchor) ----
ALTER TABLE "inspections" ALTER COLUMN "dormitory_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "house_id" uuid;--> statement-breakpoint
-- ---- TWEAK #1: academic_period.product_line — NOT-NULL add via nullable → backfill → seed → SET NOT NULL ----
-- Step 1: add NULLABLE (a bare NOT NULL add would reject every existing row — there is no safe default).
ALTER TABLE "academic_period" ADD COLUMN "product_line" text;--> statement-breakpoint
-- Step 2: backfill existing rows from their term model. period_type is TERM|SEMESTER only (exhaustive);
-- the composite configFk (school_id, academic_year) guarantees every academic_period row joins a config
-- row, so no pre-existing row is left NULL.
UPDATE "academic_period" ap
SET "product_line" = CASE c."period_type" WHEN 'SEMESTER' THEN 'SENIOR' WHEN 'TERM' THEN 'BASIC' END
FROM "ref_academic_period_config" c
WHERE ap."school_id" = c."school_id" AND ap."academic_year" = c."academic_year"
  AND ap."product_line" IS NULL;--> statement-breakpoint
-- Step 3: seed the per-school SENIOR_F3 academic_period row for existing SHS schools (school_type
-- IN ('SENIOR','COMBINED')), copying the LAST SENIOR_F3 period of gen_period_defaults for the school's
-- year — that final period carries Form 3's early post-WASSCE vacation date, exactly what the current
-- getBoardingCalendar reads (orderBy desc(period_number) limit 1). One SENIOR_F3 row per (school × year).
-- NOT EXISTS makes it re-run-safe (dev is applied by hand). New schools get this row at onboarding.
INSERT INTO "academic_period"
  ("school_id","academic_year","period_number","period_label","starts_on","ends_on","product_line")
SELECT c."school_id", c."academic_year", g."period_number", g."period_label", g."starts_on", g."ends_on", 'SENIOR_F3'
FROM "ref_academic_period_config" c
JOIN "ref_school" s ON s."id" = c."school_id"
JOIN "gen_period_defaults" g
  ON g."academic_year" = c."academic_year" AND g."product_line" = 'SENIOR_F3'
WHERE s."school_type" IN ('SENIOR','COMBINED')
  AND g."period_number" = (
    SELECT max(g2."period_number") FROM "gen_period_defaults" g2
    WHERE g2."academic_year" = c."academic_year" AND g2."product_line" = 'SENIOR_F3'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "academic_period" ap
    WHERE ap."school_id" = c."school_id" AND ap."academic_year" = c."academic_year"
      AND ap."product_line" = 'SENIOR_F3'
  );--> statement-breakpoint
-- Step 4: every row now carries a product_line — enforce NOT NULL (matches the Drizzle schema).
ALTER TABLE "academic_period" ALTER COLUMN "product_line" SET NOT NULL;--> statement-breakpoint
-- ---- foreign keys (targets are all already-shipped UKs/PKs — no FK-before-UNIQUE hazard) ----
ALTER TABLE "boarding_arrival" ADD CONSTRAINT "boarding_arrival_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_arrival" ADD CONSTRAINT "boarding_arrival_checked_by_user_id_ref_user_id_fk" FOREIGN KEY ("checked_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_arrival" ADD CONSTRAINT "boarding_arrival_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_arrival" ADD CONSTRAINT "boarding_arrival_school_id_house_id_house_school_id_id_fk" FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_arrival" ADD CONSTRAINT "boarding_arrival_school_id_academic_period_id_academic_period_school_id_period_id_fk" FOREIGN KEY ("school_id","academic_period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_school_id_house_id_house_school_id_id_fk" FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- ---- indexes ----
CREATE INDEX "boarding_arrival_house_period_mode_idx" ON "boarding_arrival" USING btree ("school_id","house_id","academic_period_id","mode");--> statement-breakpoint
CREATE INDEX "inspections_house_time_idx" ON "inspections" USING btree ("school_id","house_id","inspected_at");--> statement-breakpoint
-- ---- TWEAK #3 backfill: existing WEEKLY rows anchored on a dormitory get house_id = that dorm's House ----
-- (so a WEEKLY row still reads by house_id after its former anchor dorm is deactivated — AC K2/K4).
-- DAILY rows keep house_id NULL. Runs after the house_id FK: the backfilled (school_id, house_id) is the
-- dormitory's own valid (school_id, house_id), so it satisfies the composite FK.
UPDATE "inspections" i
SET "house_id" = d."house_id"
FROM "boarding_dormitory" d
WHERE i."dormitory_id" = d."id" AND i."school_id" = d."school_id"
  AND i."type" = 'WEEKLY' AND i."house_id" IS NULL;
