CREATE TABLE "gradebook_config" (
	"school_id" uuid PRIMARY KEY NOT NULL,
	"class_weight" smallint DEFAULT 50 NOT NULL,
	"exam_weight" smallint DEFAULT 50 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gradebook_score" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"class_score" numeric(5, 2),
	"exam_score" numeric(5, 2),
	"total" numeric(5, 2),
	"grade" text,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_score_student_subject_period" UNIQUE("school_id","student_id","subject_id","period_id")
);
--> statement-breakpoint
CREATE TABLE "report_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"overall_total" numeric(5, 2),
	"overall_grade" text,
	"subject_count" smallint,
	"remark" text,
	"generated_by_user_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_report_student_period" UNIQUE("school_id","student_id","period_id")
);
--> statement-breakpoint
CREATE TABLE "subject" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_subject_per_school" UNIQUE("school_id","name")
);
--> statement-breakpoint
ALTER TABLE "gradebook_config" ADD CONSTRAINT "gradebook_config_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_score" ADD CONSTRAINT "gradebook_score_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_score" ADD CONSTRAINT "gradebook_score_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_score" ADD CONSTRAINT "gradebook_score_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_score" ADD CONSTRAINT "gradebook_score_period_id_academic_period_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."academic_period"("period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_score" ADD CONSTRAINT "gradebook_score_updated_by_user_id_ref_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_card" ADD CONSTRAINT "report_card_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_card" ADD CONSTRAINT "report_card_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_card" ADD CONSTRAINT "report_card_period_id_academic_period_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."academic_period"("period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_card" ADD CONSTRAINT "report_card_generated_by_user_id_ref_user_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "score_period_subject_idx" ON "gradebook_score" USING btree ("period_id","subject_id");