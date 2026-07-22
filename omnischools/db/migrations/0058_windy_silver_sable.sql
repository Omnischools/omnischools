CREATE TYPE "public"."chronic_condition" AS ENUM('SICKLE_CELL', 'ASTHMA', 'EPILEPSY', 'ALLERGY', 'MENTAL_HEALTH', 'DIABETES', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."chronic_status" AS ENUM('STABLE', 'MONITOR', 'ACTIVE_CRISIS');--> statement-breakpoint
CREATE TYPE "public"."sickbay_grant_scope" AS ENUM('FULL_PLAN', 'PARTIAL', 'DIRECTIVE');--> statement-breakpoint
CREATE TABLE "sickbay_chronic_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"condition" "chronic_condition" NOT NULL,
	"condition_label" text,
	"condition_detail" text,
	"status" "chronic_status" DEFAULT 'STABLE' NOT NULL,
	"on_site_treatable" boolean DEFAULT true NOT NULL,
	"referral_managed" boolean DEFAULT false NOT NULL,
	"baseline_status" text,
	"care_goals" text,
	"emergency_protocol" text,
	"discharge_criteria" text,
	"triggers" text,
	"red_flags" text,
	"first_action" text,
	"external_clinical_home" text,
	"external_pastoral_home" text,
	"external_care_cadence" text,
	"external_next_visit_at" timestamp with time zone,
	"version" smallint DEFAULT 1 NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"co_reviewer_note" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sickbay_chronic_entry_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "chronic_mental_health_referral_managed" CHECK ("sickbay_chronic_entry"."condition" <> 'MENTAL_HEALTH' OR ("sickbay_chronic_entry"."on_site_treatable" = false AND "sickbay_chronic_entry"."referral_managed" = true))
);
--> statement-breakpoint
CREATE TABLE "sickbay_chronic_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"grantee_user_id" uuid NOT NULL,
	"scope" "sickbay_grant_scope" NOT NULL,
	"scope_label" text,
	"reason" text,
	"directive_note" text,
	"house_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by_user_id" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	CONSTRAINT "chronic_grant_directive_needs_note" CHECK ("sickbay_chronic_grant"."scope" <> 'DIRECTIVE' OR "sickbay_chronic_grant"."directive_note" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "sickbay_chronic_med" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"drug_name" text NOT NULL,
	"dose_label" text NOT NULL,
	"is_prn" boolean DEFAULT false NOT NULL,
	"slot_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sickbay_chronic_med_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "uniq_sickbay_chronic_med_dose" UNIQUE("school_id","entry_id","drug_name","slot_id"),
	CONSTRAINT "chronic_med_prn_xor_slot" CHECK ("sickbay_chronic_med"."is_prn" = ("sickbay_chronic_med"."slot_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sickbay_chronic_read" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"read_on" date NOT NULL,
	"scope" "sickbay_grant_scope",
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_sickbay_chronic_read_day" UNIQUE("school_id","entry_id","actor_user_id","read_on")
);
--> statement-breakpoint
ALTER TABLE "sickbay_chronic_entry" ADD CONSTRAINT "sickbay_chronic_entry_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_chronic_entry" ADD CONSTRAINT "sickbay_chronic_entry_reviewed_by_user_id_ref_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_chronic_entry" ADD CONSTRAINT "sickbay_chronic_entry_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_chronic_grant" ADD CONSTRAINT "sickbay_chronic_grant_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_chronic_grant" ADD CONSTRAINT "sickbay_chronic_grant_grantee_user_id_ref_user_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."ref_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_chronic_grant" ADD CONSTRAINT "sickbay_chronic_grant_granted_by_user_id_ref_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_chronic_grant" ADD CONSTRAINT "sickbay_chronic_grant_revoked_by_user_id_ref_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_chronic_grant" ADD CONSTRAINT "sickbay_chronic_grant_school_id_entry_id_sickbay_chronic_entry_school_id_id_fk" FOREIGN KEY ("school_id","entry_id") REFERENCES "public"."sickbay_chronic_entry"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_chronic_grant" ADD CONSTRAINT "sickbay_chronic_grant_school_id_house_id_house_school_id_id_fk" FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_chronic_med" ADD CONSTRAINT "sickbay_chronic_med_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_chronic_med" ADD CONSTRAINT "sickbay_chronic_med_school_id_entry_id_sickbay_chronic_entry_school_id_id_fk" FOREIGN KEY ("school_id","entry_id") REFERENCES "public"."sickbay_chronic_entry"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_chronic_med" ADD CONSTRAINT "sickbay_chronic_med_school_id_slot_id_sickbay_schedule_slot_school_id_id_fk" FOREIGN KEY ("school_id","slot_id") REFERENCES "public"."sickbay_schedule_slot"("school_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_chronic_read" ADD CONSTRAINT "sickbay_chronic_read_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_chronic_read" ADD CONSTRAINT "sickbay_chronic_read_actor_user_id_ref_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."ref_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_chronic_read" ADD CONSTRAINT "sickbay_chronic_read_school_id_entry_id_sickbay_chronic_entry_school_id_id_fk" FOREIGN KEY ("school_id","entry_id") REFERENCES "public"."sickbay_chronic_entry"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_sickbay_chronic_entry_condition" ON "sickbay_chronic_entry" USING btree ("school_id","student_id","condition") WHERE "sickbay_chronic_entry"."active" AND "sickbay_chronic_entry"."condition" <> 'OTHER';--> statement-breakpoint
CREATE INDEX "sickbay_chronic_entry_student_idx" ON "sickbay_chronic_entry" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "sickbay_chronic_grant_entry_idx" ON "sickbay_chronic_grant" USING btree ("school_id","entry_id");--> statement-breakpoint
CREATE INDEX "sickbay_chronic_grant_grantee_idx" ON "sickbay_chronic_grant" USING btree ("school_id","grantee_user_id");--> statement-breakpoint
CREATE INDEX "sickbay_chronic_med_slot_idx" ON "sickbay_chronic_med" USING btree ("school_id","slot_id");