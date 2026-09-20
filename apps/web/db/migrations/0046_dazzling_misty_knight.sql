CREATE TYPE "public"."exeat_notification_kind" AS ENUM('DEPARTURE', 'REMINDER', 'OVERDUE_STAGE_1', 'OVERDUE_STAGE_2', 'OVERDUE_STAGE_3');--> statement-breakpoint
CREATE TYPE "public"."exeat_status" AS ENUM('REQUESTED', 'HM_APPROVED', 'SR_HM_SIGNED', 'DEPARTED', 'RETURNED', 'DECLINED');--> statement-breakpoint
CREATE TYPE "public"."exeat_type" AS ENUM('SCHEDULED', 'SPECIAL', 'FEE_COLLECTION');--> statement-breakpoint
CREATE TABLE "boarding_exeat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"house_id" uuid NOT NULL,
	"academic_period_id" uuid NOT NULL,
	"calendar_event_id" uuid,
	"exeat_type" "exeat_type" NOT NULL,
	"status" "exeat_status" DEFAULT 'REQUESTED' NOT NULL,
	"ref_code" text NOT NULL,
	"reason" text,
	"parent_initiated" boolean DEFAULT true NOT NULL,
	"depart_at" timestamp with time zone,
	"return_by" timestamp with time zone,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by_user_id" uuid,
	"hm_approved_at" timestamp with time zone,
	"hm_approved_by_user_id" uuid,
	"sr_hm_signed_at" timestamp with time zone,
	"sr_hm_signed_by_user_id" uuid,
	"departed_at" timestamp with time zone,
	"departed_by_user_id" uuid,
	"returned_at" timestamp with time zone,
	"returned_by_user_id" uuid,
	"declined_at" timestamp with time zone,
	"declined_by_user_id" uuid,
	"decline_reason" text,
	"fee_owing_snapshot" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boarding_exeat_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "uniq_exeat_ref_code" UNIQUE("school_id","ref_code")
);
--> statement-breakpoint
CREATE TABLE "exeat_notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"exeat_id" uuid NOT NULL,
	"kind" "exeat_notification_kind" NOT NULL,
	"to_phone" text NOT NULL,
	"body" text NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"error" text,
	"ok" boolean NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_calendar_event_id_boarding_calendar_event_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."boarding_calendar_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_requested_by_user_id_ref_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_hm_approved_by_user_id_ref_user_id_fk" FOREIGN KEY ("hm_approved_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_sr_hm_signed_by_user_id_ref_user_id_fk" FOREIGN KEY ("sr_hm_signed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_departed_by_user_id_ref_user_id_fk" FOREIGN KEY ("departed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_returned_by_user_id_ref_user_id_fk" FOREIGN KEY ("returned_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_declined_by_user_id_ref_user_id_fk" FOREIGN KEY ("declined_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_school_id_house_id_house_school_id_id_fk" FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_exeat" ADD CONSTRAINT "boarding_exeat_school_id_academic_period_id_academic_period_school_id_period_id_fk" FOREIGN KEY ("school_id","academic_period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exeat_notification" ADD CONSTRAINT "exeat_notification_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exeat_notification" ADD CONSTRAINT "exeat_notification_sent_by_user_id_ref_user_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exeat_notification" ADD CONSTRAINT "exeat_notification_school_id_exeat_id_boarding_exeat_school_id_id_fk" FOREIGN KEY ("school_id","exeat_id") REFERENCES "public"."boarding_exeat"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boarding_exeat_student_period_idx" ON "boarding_exeat" USING btree ("school_id","student_id","academic_period_id");--> statement-breakpoint
CREATE INDEX "exeat_notification_exeat_idx" ON "exeat_notification" USING btree ("school_id","exeat_id");