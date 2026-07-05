CREATE TABLE "senior_subject_teacher" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"teacher_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_subject_teacher_context" UNIQUE("school_id","class_id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "senior_subject_teacher" ADD CONSTRAINT "senior_subject_teacher_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_subject_teacher" ADD CONSTRAINT "senior_subject_teacher_teacher_user_id_ref_user_id_fk" FOREIGN KEY ("teacher_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_subject_teacher" ADD CONSTRAINT "senior_subject_teacher_school_id_class_id_class_school_id_id_fk" FOREIGN KEY ("school_id","class_id") REFERENCES "public"."class"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_subject_teacher" ADD CONSTRAINT "senior_subject_teacher_school_id_subject_id_subject_school_id_id_fk" FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."subject"("school_id","id") ON DELETE cascade ON UPDATE no action;