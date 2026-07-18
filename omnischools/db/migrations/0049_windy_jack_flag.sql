CREATE TYPE "public"."visit_notification_kind" AS ENUM('INVITATION', 'REMINDER_T3', 'REMINDER_T1', 'ARRIVAL_CONFIRM', 'OVERSTAY');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('RSVP', 'ARRIVED', 'DEPARTED');--> statement-breakpoint
CREATE TYPE "public"."visit_verification" AS ENUM('VERIFIED', 'FLAGGED', 'HM_AUTHORISED');--> statement-breakpoint
CREATE TYPE "public"."visitor_approval_status" AS ENUM('PENDING_REVIEW', 'APPROVED');--> statement-breakpoint
CREATE TABLE "boarding_approved_visitor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"id_hint" text,
	"phone" text,
	"status" "visitor_approval_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"pastoral_review" boolean DEFAULT false NOT NULL,
	"note" text,
	"added_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boarding_approved_visitor_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "boarding_visit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"house_id" uuid NOT NULL,
	"calendar_event_id" uuid,
	"approved_visitor_id" uuid,
	"visitor_name" text NOT NULL,
	"visitor_phone" text,
	"relationship" text,
	"status" "visit_status" DEFAULT 'RSVP' NOT NULL,
	"verification" "visit_verification" DEFAULT 'FLAGGED' NOT NULL,
	"zone_key" text,
	"note" text,
	"rsvp_by_user_id" uuid,
	"arrived_at" timestamp with time zone,
	"arrived_by_user_id" uuid,
	"departed_at" timestamp with time zone,
	"departed_by_user_id" uuid,
	"authorised_at" timestamp with time zone,
	"authorised_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boarding_visit_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "uniq_boarding_visit_rsvp" UNIQUE("school_id","student_id","calendar_event_id","approved_visitor_id")
);
--> statement-breakpoint
CREATE TABLE "boarding_visit_notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"visit_id" uuid,
	"calendar_event_id" uuid,
	"kind" "visit_notification_kind" NOT NULL,
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
ALTER TABLE "boarding_approved_visitor" ADD CONSTRAINT "boarding_approved_visitor_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_approved_visitor" ADD CONSTRAINT "boarding_approved_visitor_added_by_user_id_ref_user_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_approved_visitor" ADD CONSTRAINT "boarding_approved_visitor_approved_by_user_id_ref_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_approved_visitor" ADD CONSTRAINT "boarding_approved_visitor_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_calendar_event_id_boarding_calendar_event_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."boarding_calendar_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_approved_visitor_id_boarding_approved_visitor_id_fk" FOREIGN KEY ("approved_visitor_id") REFERENCES "public"."boarding_approved_visitor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_rsvp_by_user_id_ref_user_id_fk" FOREIGN KEY ("rsvp_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_arrived_by_user_id_ref_user_id_fk" FOREIGN KEY ("arrived_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_departed_by_user_id_ref_user_id_fk" FOREIGN KEY ("departed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_authorised_by_user_id_ref_user_id_fk" FOREIGN KEY ("authorised_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit" ADD CONSTRAINT "boarding_visit_school_id_house_id_house_school_id_id_fk" FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit_notification" ADD CONSTRAINT "boarding_visit_notification_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit_notification" ADD CONSTRAINT "boarding_visit_notification_calendar_event_id_boarding_calendar_event_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."boarding_calendar_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit_notification" ADD CONSTRAINT "boarding_visit_notification_sent_by_user_id_ref_user_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit_notification" ADD CONSTRAINT "boarding_visit_notification_school_id_visit_id_boarding_visit_school_id_id_fk" FOREIGN KEY ("school_id","visit_id") REFERENCES "public"."boarding_visit"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boarding_approved_visitor_student_idx" ON "boarding_approved_visitor" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "boarding_visit_event_house_idx" ON "boarding_visit" USING btree ("school_id","calendar_event_id","house_id");--> statement-breakpoint
CREATE INDEX "boarding_visit_notification_visit_idx" ON "boarding_visit_notification" USING btree ("school_id","visit_id");--> statement-breakpoint
CREATE INDEX "boarding_visit_notification_event_idx" ON "boarding_visit_notification" USING btree ("school_id","calendar_event_id");