CREATE TABLE "boarding_visit_rsvp_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"calendar_event_id" uuid,
	"token_hash" text NOT NULL,
	"issued_to_phone" text,
	"guardian_id" uuid,
	"visit_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"issued_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_boarding_visit_rsvp_token_hash" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "boarding_visit_rsvp_token" ADD CONSTRAINT "boarding_visit_rsvp_token_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit_rsvp_token" ADD CONSTRAINT "boarding_visit_rsvp_token_calendar_event_id_boarding_calendar_event_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."boarding_calendar_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit_rsvp_token" ADD CONSTRAINT "boarding_visit_rsvp_token_guardian_id_student_guardian_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."student_guardian"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit_rsvp_token" ADD CONSTRAINT "boarding_visit_rsvp_token_visit_id_boarding_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."boarding_visit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit_rsvp_token" ADD CONSTRAINT "boarding_visit_rsvp_token_issued_by_user_id_ref_user_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_visit_rsvp_token" ADD CONSTRAINT "boarding_visit_rsvp_token_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boarding_visit_rsvp_token_event_idx" ON "boarding_visit_rsvp_token" USING btree ("school_id","calendar_event_id");