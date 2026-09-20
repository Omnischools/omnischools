CREATE TABLE "student_subject_enrolment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_student_subject_enrolment" UNIQUE("school_id","student_id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "student_subject_enrolment" ADD CONSTRAINT "student_subject_enrolment_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subject_enrolment" ADD CONSTRAINT "student_subject_enrolment_created_by_user_id_ref_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subject_enrolment" ADD CONSTRAINT "student_subject_enrolment_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subject_enrolment" ADD CONSTRAINT "student_subject_enrolment_school_id_subject_id_subject_school_id_id_fk" FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."subject"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_subject_enrolment_subject_idx" ON "student_subject_enrolment" USING btree ("school_id","subject_id");