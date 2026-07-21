CREATE TYPE "public"."sickbay_mode" AS ENUM('FULL', 'FIRST_AID', 'REFERRAL_ONLY');--> statement-breakpoint
CREATE TYPE "public"."sickbay_slot_kind" AS ENUM('MEDICATION_ROUND', 'CLINIC', 'DOCTOR_VISIT', 'ON_CALL');--> statement-breakpoint
CREATE TABLE "sickbay_bed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"bed_number" smallint NOT NULL,
	"is_isolation" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_sickbay_bed_number" UNIQUE("school_id","bed_number"),
	CONSTRAINT "sickbay_bed_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "sickbay_schedule_slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"kind" "sickbay_slot_kind" NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"staffing" text,
	"days_of_week" jsonb NOT NULL,
	"runs_on_holidays" boolean DEFAULT false NOT NULL,
	"is_anchor" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sickbay_schedule_slot_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "sickbay_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"mode" "sickbay_mode" DEFAULT 'REFERRAL_ONLY' NOT NULL,
	"matron_user_id" uuid,
	"assistant_matron_user_id" uuid,
	"visiting_doctor_name" text,
	"visiting_doctor_affiliation" text,
	"configured_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sickbay_settings_school_id_unique" UNIQUE("school_id")
);
--> statement-breakpoint
ALTER TABLE "staff_profile" ADD COLUMN "nmc_licence_number" text;--> statement-breakpoint
ALTER TABLE "staff_profile" ADD COLUMN "nmc_licence_expiry" date;--> statement-breakpoint
ALTER TABLE "sickbay_bed" ADD CONSTRAINT "sickbay_bed_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_schedule_slot" ADD CONSTRAINT "sickbay_schedule_slot_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_settings" ADD CONSTRAINT "sickbay_settings_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_settings" ADD CONSTRAINT "sickbay_settings_matron_user_id_ref_user_id_fk" FOREIGN KEY ("matron_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_settings" ADD CONSTRAINT "sickbay_settings_assistant_matron_user_id_ref_user_id_fk" FOREIGN KEY ("assistant_matron_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_sickbay_anchor_slot" ON "sickbay_schedule_slot" USING btree ("school_id") WHERE "sickbay_schedule_slot"."is_anchor";