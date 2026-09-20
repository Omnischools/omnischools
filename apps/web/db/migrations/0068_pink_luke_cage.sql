CREATE TABLE "vlc_pastoral_flag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"session_id" uuid,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raised_by_user_id" uuid,
	"surfaced_by" text,
	"severity" text NOT NULL,
	"context" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vlc_pastoral_flag_surfaced_by_len" CHECK (char_length("vlc_pastoral_flag"."surfaced_by") <= 80),
	CONSTRAINT "vlc_pastoral_flag_severity_valid" CHECK ("vlc_pastoral_flag"."severity" IN ('NOTE', 'CONCERN', 'CRISIS')),
	CONSTRAINT "vlc_pastoral_flag_context_len" CHECK (char_length("vlc_pastoral_flag"."context") <= 280)
);
--> statement-breakpoint
ALTER TABLE "vlc_pastoral_flag" ADD CONSTRAINT "vlc_pastoral_flag_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_flag" ADD CONSTRAINT "vlc_pastoral_flag_raised_by_user_id_ref_user_id_fk" FOREIGN KEY ("raised_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_flag" ADD CONSTRAINT "vlc_pastoral_flag_resolved_by_user_id_ref_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_flag" ADD CONSTRAINT "vlc_pastoral_flag_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_flag" ADD CONSTRAINT "vlc_pastoral_flag_school_id_session_id_vlc_session_school_id_id_fk" FOREIGN KEY ("school_id","session_id") REFERENCES "public"."vlc_session"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vlc_pastoral_flag_active_idx" ON "vlc_pastoral_flag" USING btree ("school_id","student_id") WHERE "vlc_pastoral_flag"."resolved_at" IS NULL;