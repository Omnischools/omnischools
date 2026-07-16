CREATE TYPE "public"."boarding_day_type" AS ENUM('WEEKDAY', 'SATURDAY', 'SUNDAY', 'VISITING_SUNDAY');--> statement-breakpoint
CREATE TYPE "public"."boarding_event_type" AS ENUM('VISITING', 'EXEAT_WINDOW');--> statement-breakpoint
CREATE TABLE "boarding_calendar_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year" text NOT NULL,
	"event_type" "boarding_event_type" NOT NULL,
	"event_date" date NOT NULL,
	"label" text NOT NULL,
	"form_scope" text,
	"sequence" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_boarding_calendar_event" UNIQUE("school_id","academic_year","event_type","event_date")
);
--> statement-breakpoint
CREATE TABLE "boarding_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"exeat_scheduled_per_term" smallint DEFAULT 3 NOT NULL,
	"exeat_return_by" text DEFAULT '16:00' NOT NULL,
	"exeat_fee_owing_must_collect" boolean DEFAULT true NOT NULL,
	"exeat_special_approver" text DEFAULT 'Senior HM only' NOT NULL,
	"exeat_parent_initiated" boolean DEFAULT true NOT NULL,
	"exeat_dress_code" text DEFAULT 'Uniform or outing dress' NOT NULL,
	"exeat_card_signer" text DEFAULT 'Signed by Housemaster' NOT NULL,
	"visiting_cadence" text DEFAULT '2nd Sun · monthly' NOT NULL,
	"visiting_hours_start" text DEFAULT '12:00' NOT NULL,
	"visiting_hours_end" text DEFAULT '16:00' NOT NULL,
	"visiting_lunch_time" text DEFAULT '11:30' NOT NULL,
	"visiting_dormitories_rule" text DEFAULT 'Out of bounds' NOT NULL,
	"visiting_approved_visitors" text DEFAULT 'Parent · guardian · sibling' NOT NULL,
	"visiting_book_owner" text DEFAULT 'Digital · SoD owns' NOT NULL,
	"inspection_daily_start" text DEFAULT '06:10' NOT NULL,
	"inspection_daily_end" text DEFAULT '06:20' NOT NULL,
	"inspection_daily_scope" text DEFAULT 'Bunks · lockers · attire' NOT NULL,
	"inspection_weekly" text DEFAULT 'Saturday 08:00' NOT NULL,
	"inspection_weekly_scope" text DEFAULT 'Whole House · top to bottom' NOT NULL,
	"inspection_scrubbing" text DEFAULT 'Wed 16:00 — 17:00' NOT NULL,
	"inspection_washing_days" text DEFAULT 'Wed & Fri afternoons' NOT NULL,
	"inspection_inspector" text DEFAULT 'HM & House Prefects' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boarding_settings_school_id_unique" UNIQUE("school_id")
);
--> statement-breakpoint
CREATE TABLE "daily_schedule_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"day_type" "boarding_day_type" NOT NULL,
	"form_scope" text DEFAULT 'ALL' NOT NULL,
	"activities_json" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_schedule_template" UNIQUE("school_id","day_type","form_scope")
);
--> statement-breakpoint
ALTER TABLE "house" ADD COLUMN "founded_year" smallint;--> statement-breakpoint
ALTER TABLE "house" ADD COLUMN "named_after" text;--> statement-breakpoint
ALTER TABLE "boarding_calendar_event" ADD CONSTRAINT "boarding_calendar_event_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_settings" ADD CONSTRAINT "boarding_settings_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_schedule_template" ADD CONSTRAINT "daily_schedule_template_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boarding_calendar_event_year_idx" ON "boarding_calendar_event" USING btree ("school_id","academic_year");