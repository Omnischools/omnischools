CREATE TABLE "gradebook_column_score" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"column_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"raw_score" numeric(5, 2),
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_column_score_per_student" UNIQUE("school_id","column_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "gradebook_column" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'CA' NOT NULL,
	"max_score" numeric(5, 2) NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_column_per_class_subject_period" UNIQUE("school_id","class_id","subject_id","period_id","name")
);
--> statement-breakpoint
ALTER TABLE "gradebook_column_score" ADD CONSTRAINT "gradebook_column_score_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_column_score" ADD CONSTRAINT "gradebook_column_score_column_id_gradebook_column_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."gradebook_column"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_column_score" ADD CONSTRAINT "gradebook_column_score_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_column_score" ADD CONSTRAINT "gradebook_column_score_updated_by_user_id_ref_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_column" ADD CONSTRAINT "gradebook_column_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_column" ADD CONSTRAINT "gradebook_column_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_column" ADD CONSTRAINT "gradebook_column_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_column" ADD CONSTRAINT "gradebook_column_period_id_academic_period_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."academic_period"("period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_column" ADD CONSTRAINT "gradebook_column_created_by_user_id_ref_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gradebook_column_score_column_idx" ON "gradebook_column_score" USING btree ("column_id");--> statement-breakpoint
CREATE INDEX "gradebook_column_context_idx" ON "gradebook_column" USING btree ("period_id","subject_id","class_id");