CREATE TABLE "vlc_pastoral_paragraph" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_user_id" uuid,
	"updated_by_user_id" uuid,
	"locked_at" timestamp with time zone,
	"locked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_vlc_pastoral_paragraph_student" UNIQUE("school_id","student_id"),
	CONSTRAINT "vlc_pastoral_paragraph_body_len" CHECK (char_length("vlc_pastoral_paragraph"."body") <= 3000)
);
--> statement-breakpoint
ALTER TABLE "vlc_pastoral_paragraph" ADD CONSTRAINT "vlc_pastoral_paragraph_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_paragraph" ADD CONSTRAINT "vlc_pastoral_paragraph_author_user_id_ref_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_paragraph" ADD CONSTRAINT "vlc_pastoral_paragraph_updated_by_user_id_ref_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_paragraph" ADD CONSTRAINT "vlc_pastoral_paragraph_locked_by_user_id_ref_user_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_pastoral_paragraph" ADD CONSTRAINT "vlc_pastoral_paragraph_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;