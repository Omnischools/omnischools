CREATE TYPE "public"."nhis_holder_kind" AS ENUM('STUDENT', 'GUARDIAN');--> statement-breakpoint
CREATE TYPE "public"."sickbay_notify_channel" AS ENUM('SMS', 'CALL', 'IN_APP', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."sickbay_notify_direction" AS ENUM('OUTBOUND', 'INBOUND');--> statement-breakpoint
CREATE TYPE "public"."sickbay_notify_recipient" AS ENUM('PARENT', 'HOUSEMASTER', 'HEADMASTER', 'DISTRICT_HEALTH');--> statement-breakpoint
CREATE TYPE "public"."sickbay_referral_status" AS ENUM('REFERRED', 'INPATIENT', 'RETURNING', 'RETURNED');--> statement-breakpoint
CREATE TABLE "sickbay_hospital" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"distance_km" numeric,
	"services" text,
	"notes" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"accepts_nhis" boolean DEFAULT false NOT NULL,
	"tags" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sickbay_hospital_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "sickbay_notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"visit_id" uuid,
	"referral_id" uuid,
	"notification_log_id" uuid,
	"retry_of_id" uuid,
	"created_by_user_id" uuid,
	"tier" smallint NOT NULL,
	"channel" "sickbay_notify_channel" NOT NULL,
	"direction" "sickbay_notify_direction" NOT NULL,
	"recipient" "sickbay_notify_recipient" NOT NULL,
	"trigger_label" text,
	"body" text,
	"private_note" text,
	"call_duration_seconds" smallint,
	"answered" boolean,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sickbay_notification_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "sickbay_notification_tier_range" CHECK ("sickbay_notification"."tier" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "sickbay_referral" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"hospital_id" uuid NOT NULL,
	"accompanied_by_user_id" uuid,
	"hm_authorised_by_user_id" uuid,
	"recorded_by_user_id" uuid,
	"status" "sickbay_referral_status" DEFAULT 'REFERRED' NOT NULL,
	"transport_mode" text,
	"hospital_ward" text,
	"hospital_bed" text,
	"attending_clinician_name" text,
	"hm_authorised_at" timestamp with time zone,
	"departed_at" timestamp with time zone,
	"expected_return_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"return_note" text,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" uuid,
	"void_reason" text,
	"nhis_card_number" text,
	"nhis_valid" boolean,
	"reason_referred_out" text NOT NULL,
	"pre_referral_care" text,
	"handoff_labs" text,
	"last_meal" text,
	"menses_note" text,
	"travel_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sickbay_referral_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "sickbay_referral_cost_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"referral_id" uuid NOT NULL,
	"item_label" text,
	"provider" text,
	"nhis_covered" boolean NOT NULL,
	"out_of_pocket_amount" numeric,
	"billing_line_item_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sickbay_referral_update" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"referral_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"clinician_name" text,
	"clinician_affiliation" text,
	"body" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_nhis_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"card_number" text NOT NULL,
	"holder_name" text,
	"holder_kind" "nhis_holder_kind" DEFAULT 'STUDENT' NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"student_guardian_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_student_nhis_card" UNIQUE("school_id","student_id")
);
--> statement-breakpoint
ALTER TABLE "sickbay_hospital" ADD CONSTRAINT "sickbay_hospital_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_notification" ADD CONSTRAINT "sickbay_notification_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_notification" ADD CONSTRAINT "sickbay_notification_notification_log_id_notification_log_id_fk" FOREIGN KEY ("notification_log_id") REFERENCES "public"."notification_log"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_notification" ADD CONSTRAINT "sickbay_notification_created_by_user_id_ref_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_notification" ADD CONSTRAINT "sickbay_notification_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_notification" ADD CONSTRAINT "sickbay_notification_school_id_visit_id_sickbay_visit_school_id_id_fk" FOREIGN KEY ("school_id","visit_id") REFERENCES "public"."sickbay_visit"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_notification" ADD CONSTRAINT "sickbay_notification_school_id_referral_id_sickbay_referral_school_id_id_fk" FOREIGN KEY ("school_id","referral_id") REFERENCES "public"."sickbay_referral"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_notification" ADD CONSTRAINT "sickbay_notification_retry_of_fk" FOREIGN KEY ("school_id","retry_of_id") REFERENCES "public"."sickbay_notification"("school_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_accompanied_by_user_id_ref_user_id_fk" FOREIGN KEY ("accompanied_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_hm_authorised_by_user_id_ref_user_id_fk" FOREIGN KEY ("hm_authorised_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_recorded_by_user_id_ref_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_voided_by_user_id_ref_user_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_school_id_visit_id_sickbay_visit_school_id_id_fk" FOREIGN KEY ("school_id","visit_id") REFERENCES "public"."sickbay_visit"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_referral" ADD CONSTRAINT "sickbay_referral_school_id_hospital_id_sickbay_hospital_school_id_id_fk" FOREIGN KEY ("school_id","hospital_id") REFERENCES "public"."sickbay_hospital"("school_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_referral_cost_line" ADD CONSTRAINT "sickbay_referral_cost_line_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_referral_cost_line" ADD CONSTRAINT "sickbay_referral_cost_line_billing_line_item_id_invoice_line_item_id_fk" FOREIGN KEY ("billing_line_item_id") REFERENCES "public"."invoice_line_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_referral_cost_line" ADD CONSTRAINT "sickbay_referral_cost_line_school_id_referral_id_sickbay_referral_school_id_id_fk" FOREIGN KEY ("school_id","referral_id") REFERENCES "public"."sickbay_referral"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_referral_update" ADD CONSTRAINT "sickbay_referral_update_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_referral_update" ADD CONSTRAINT "sickbay_referral_update_recorded_by_user_id_ref_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_referral_update" ADD CONSTRAINT "sickbay_referral_update_school_id_referral_id_sickbay_referral_school_id_id_fk" FOREIGN KEY ("school_id","referral_id") REFERENCES "public"."sickbay_referral"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_nhis_card" ADD CONSTRAINT "student_nhis_card_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_nhis_card" ADD CONSTRAINT "student_nhis_card_student_guardian_id_student_guardian_id_fk" FOREIGN KEY ("student_guardian_id") REFERENCES "public"."student_guardian"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_nhis_card" ADD CONSTRAINT "student_nhis_card_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sickbay_notification_referral_idx" ON "sickbay_notification" USING btree ("school_id","referral_id","created_at");--> statement-breakpoint
CREATE INDEX "sickbay_notification_student_idx" ON "sickbay_notification" USING btree ("school_id","student_id","created_at");--> statement-breakpoint
CREATE INDEX "sickbay_referral_status_idx" ON "sickbay_referral" USING btree ("school_id","status");--> statement-breakpoint
CREATE INDEX "sickbay_referral_departed_idx" ON "sickbay_referral" USING btree ("school_id","departed_at");--> statement-breakpoint
CREATE INDEX "sickbay_referral_cost_line_referral_idx" ON "sickbay_referral_cost_line" USING btree ("school_id","referral_id");--> statement-breakpoint
CREATE INDEX "sickbay_referral_update_referral_idx" ON "sickbay_referral_update" USING btree ("school_id","referral_id","occurred_at");