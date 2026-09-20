CREATE TYPE "public"."sen_category" AS ENUM('VISUAL', 'HEARING', 'PHYSICAL', 'INTELLECTUAL', 'SPEECH', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."sen_consent_state" AS ENUM('GRANTED', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."sen_diagnosis_source" AS ENUM('CLINICAL_DIAGNOSIS', 'SCHOOL_OBSERVED');--> statement-breakpoint
CREATE TYPE "public"."sen_severity" AS ENUM('MILD', 'MODERATE', 'SEVERE');--> statement-breakpoint
CREATE TABLE "sen_module_adoption" (
	"school_id" uuid PRIMARY KEY NOT NULL,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enabled_by" uuid
);
--> statement-breakpoint
CREATE TABLE "sen_register" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"category" "sen_category" NOT NULL,
	"severity" "sen_severity",
	"support_notes" text,
	"accommodations" text[],
	"diagnosis_source" "sen_diagnosis_source",
	"diagnosing_clinician" text,
	"diagnosing_institution" text,
	"diagnosis_year" smallint,
	"consent_state" "sen_consent_state" NOT NULL,
	"consent_on_file_at" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_sen_register_student" UNIQUE("school_id","student_id"),
	CONSTRAINT "sen_register_pending_no_detail" CHECK ("sen_register"."consent_state" = 'GRANTED' OR (
        "sen_register"."severity" IS NULL
        AND "sen_register"."diagnosis_source" IS NULL
        AND "sen_register"."diagnosing_clinician" IS NULL
        AND "sen_register"."diagnosing_institution" IS NULL
        AND "sen_register"."diagnosis_year" IS NULL
        AND "sen_register"."support_notes" IS NULL
        AND "sen_register"."accommodations" IS NULL
      ))
);
--> statement-breakpoint
ALTER TABLE "sen_module_adoption" ADD CONSTRAINT "sen_module_adoption_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sen_module_adoption" ADD CONSTRAINT "sen_module_adoption_enabled_by_ref_user_id_fk" FOREIGN KEY ("enabled_by") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sen_register" ADD CONSTRAINT "sen_register_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sen_register" ADD CONSTRAINT "sen_register_created_by_ref_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sen_register" ADD CONSTRAINT "sen_register_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;