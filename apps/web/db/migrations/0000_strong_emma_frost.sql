CREATE TYPE "public"."anomaly_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."app_role" AS ENUM('ADMIN', 'HEADMASTER', 'VICE_HEADMASTER_ACADEMIC', 'TEACHER', 'FORM_MASTER', 'HOUSEMASTER', 'STUDENT', 'PARENT', 'BURSAR', 'DEAN_OF_BOARDING', 'MATRON');--> statement-breakpoint
CREATE TYPE "public"."ownership_type" AS ENUM('PUBLIC', 'PRIVATE', 'MISSION', 'INTERNATIONAL');--> statement-breakpoint
CREATE TYPE "public"."period_source" AS ENUM('GES_DEFAULT', 'SCHOOL_OVERRIDE');--> statement-breakpoint
CREATE TYPE "public"."period_type" AS ENUM('TERM', 'SEMESTER');--> statement-breakpoint
CREATE TYPE "public"."product" AS ENUM('BASIC', 'SENIOR', 'OVERSIGHT');--> statement-breakpoint
CREATE TYPE "public"."school_type" AS ENUM('BASIC', 'SENIOR', 'COMBINED');--> statement-breakpoint
CREATE TYPE "public"."shs_category" AS ENUM('A', 'B', 'C', 'D', 'E', 'F');--> statement-breakpoint
CREATE TABLE "ref_district" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "ref_district_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ref_region" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "ref_region_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ref_school_product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"product" "product" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_school_product" UNIQUE("school_id","product")
);
--> statement-breakpoint
CREATE TABLE "ref_school" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"ges_code" text NOT NULL,
	"school_type" "school_type" DEFAULT 'BASIC' NOT NULL,
	"shs_category" "shs_category",
	"ownership_type" "ownership_type" DEFAULT 'PRIVATE' NOT NULL,
	"district_id" uuid,
	"region_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ref_school_ges_code_unique" UNIQUE("ges_code")
);
--> statement-breakpoint
CREATE TABLE "role_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_ref" uuid,
	"start_date" date DEFAULT now() NOT NULL,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "app_role" NOT NULL,
	"label" text NOT NULL,
	"description" text,
	CONSTRAINT "ref_role_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ref_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"full_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ref_user_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "academic_period" (
	"period_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year" text NOT NULL,
	"period_number" smallint NOT NULL,
	"period_label" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_academic_period_config" (
	"school_id" uuid NOT NULL,
	"academic_year" text NOT NULL,
	"period_type" "period_type" NOT NULL,
	"period_count" smallint NOT NULL,
	"source" "period_source" NOT NULL,
	"configured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"configured_by" uuid,
	CONSTRAINT "ref_academic_period_config_school_id_academic_year_pk" PRIMARY KEY("school_id","academic_year")
);
--> statement-breakpoint
CREATE TABLE "gen_period_defaults" (
	"academic_year" text NOT NULL,
	"product_line" text NOT NULL,
	"period_number" smallint NOT NULL,
	"period_label" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"source_url" text,
	"extracted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "gen_period_defaults_academic_year_product_line_period_number_pk" PRIMARY KEY("academic_year","product_line","period_number")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"audit_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text,
	"action_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before_jsonb" jsonb,
	"after_jsonb" jsonb,
	"reason" text,
	"ip_address" text,
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_anomaly_rule" (
	"rule_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_code" text NOT NULL,
	"severity" "anomaly_severity" NOT NULL,
	"description" text NOT NULL,
	"applies_to" text NOT NULL,
	"threshold_jsonb" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ref_anomaly_rule_rule_code_unique" UNIQUE("rule_code")
);
--> statement-breakpoint
ALTER TABLE "ref_district" ADD CONSTRAINT "ref_district_region_id_ref_region_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."ref_region"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_school_product" ADD CONSTRAINT "ref_school_product_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_school" ADD CONSTRAINT "ref_school_district_id_ref_district_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."ref_district"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_school" ADD CONSTRAINT "ref_school_region_id_ref_region_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."ref_region"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_user_id_ref_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_role_id_ref_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."ref_role"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_period" ADD CONSTRAINT "academic_period_school_id_academic_year_ref_academic_period_config_school_id_academic_year_fk" FOREIGN KEY ("school_id","academic_year") REFERENCES "public"."ref_academic_period_config"("school_id","academic_year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_academic_period_config" ADD CONSTRAINT "ref_academic_period_config_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_academic_period_config" ADD CONSTRAINT "ref_academic_period_config_configured_by_ref_user_id_fk" FOREIGN KEY ("configured_by") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen_period_defaults" ADD CONSTRAINT "gen_period_defaults_reviewed_by_ref_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_ref_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_school_time_idx" ON "audit_log" USING btree ("school_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");