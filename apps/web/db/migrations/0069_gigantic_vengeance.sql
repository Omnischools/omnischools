CREATE TABLE "vlc_pastoral_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"flag_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_revised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_revised_by_user_id" uuid,
	CONSTRAINT "uniq_vlc_pastoral_case_flag" UNIQUE("school_id","flag_id"),
	CONSTRAINT "vlc_pastoral_case_summary_len" CHECK (char_length("vlc_pastoral_case"."summary") <= 8000)
);
--> statement-breakpoint
CREATE TABLE "vlc_pastoral_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"session_id" uuid,
	"recorded_by_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vlc_pastoral_journal_body_len" CHECK (char_length("vlc_pastoral_journal"."body") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "vlc_pastoral_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vlc_pastoral_note_body_len" CHECK (char_length("vlc_pastoral_note"."body") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "vlc_pastoral_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"observed_by" text NOT NULL,
	"recorded_by_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vlc_pastoral_observation_observed_by_len" CHECK (char_length("vlc_pastoral_observation"."observed_by") <= 80),
	CONSTRAINT "vlc_pastoral_observation_body_len" CHECK (char_length("vlc_pastoral_observation"."body") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "vlc_pastoral_flag" ADD CONSTRAINT "vlc_pastoral_flag_tenant_uk" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "vlc_pastoral_case" ADD CONSTRAINT "vlc_pastoral_case_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_case" ADD CONSTRAINT "vlc_pastoral_case_last_revised_by_user_id_ref_user_id_fk" FOREIGN KEY ("last_revised_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_case" ADD CONSTRAINT "vlc_pastoral_case_school_id_flag_id_vlc_pastoral_flag_school_id_id_fk" FOREIGN KEY ("school_id","flag_id") REFERENCES "public"."vlc_pastoral_flag"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_journal" ADD CONSTRAINT "vlc_pastoral_journal_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_journal" ADD CONSTRAINT "vlc_pastoral_journal_recorded_by_user_id_ref_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_journal" ADD CONSTRAINT "vlc_pastoral_journal_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_journal" ADD CONSTRAINT "vlc_pastoral_journal_school_id_session_id_vlc_session_school_id_id_fk" FOREIGN KEY ("school_id","session_id") REFERENCES "public"."vlc_session"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_note" ADD CONSTRAINT "vlc_pastoral_note_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_note" ADD CONSTRAINT "vlc_pastoral_note_author_user_id_ref_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_note" ADD CONSTRAINT "vlc_pastoral_note_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_observation" ADD CONSTRAINT "vlc_pastoral_observation_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_observation" ADD CONSTRAINT "vlc_pastoral_observation_recorded_by_user_id_ref_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_observation" ADD CONSTRAINT "vlc_pastoral_observation_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vlc_pastoral_journal_student_idx" ON "vlc_pastoral_journal" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "vlc_pastoral_note_student_idx" ON "vlc_pastoral_note" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "vlc_pastoral_observation_student_idx" ON "vlc_pastoral_observation" USING btree ("school_id","student_id");