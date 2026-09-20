CREATE TYPE "public"."admission_status" AS ENUM('SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'WAITLISTED');--> statement-breakpoint
CREATE TYPE "public"."guardian_relation" AS ENUM('MOTHER', 'FATHER', 'GUARDIAN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('MALE', 'FEMALE');--> statement-breakpoint
CREATE TYPE "public"."student_status" AS ENUM('ACTIVE', 'INACTIVE', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED');--> statement-breakpoint
CREATE TABLE "student_guardian" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" "guardian_relation" DEFAULT 'GUARDIAN' NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"is_primary" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_code" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"other_names" text,
	"sex" "sex" NOT NULL,
	"date_of_birth" date,
	"status" "student_status" DEFAULT 'ACTIVE' NOT NULL,
	"current_class_label" text,
	"enrolled_on" date,
	"admission_application_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_student_code_per_school" UNIQUE("school_id","student_code")
);
--> statement-breakpoint
CREATE TABLE "admission_application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"applicant_first_name" text NOT NULL,
	"applicant_last_name" text NOT NULL,
	"applicant_other_names" text,
	"sex" "sex" NOT NULL,
	"date_of_birth" date,
	"desired_class_label" text,
	"guardian_name" text NOT NULL,
	"guardian_phone" text NOT NULL,
	"guardian_email" text,
	"status" "admission_status" DEFAULT 'SUBMITTED' NOT NULL,
	"notes" text,
	"student_id" uuid,
	"decided_by_user_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admission_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"label" text NOT NULL,
	"file_key" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_guardian" ADD CONSTRAINT "student_guardian_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardian" ADD CONSTRAINT "student_guardian_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_application" ADD CONSTRAINT "admission_application_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_application" ADD CONSTRAINT "admission_application_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_application" ADD CONSTRAINT "admission_application_decided_by_user_id_ref_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_document" ADD CONSTRAINT "admission_document_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_document" ADD CONSTRAINT "admission_document_application_id_admission_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."admission_application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guardian_student_idx" ON "student_guardian" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "students_school_idx" ON "students" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "admission_school_status_idx" ON "admission_application" USING btree ("school_id","status");