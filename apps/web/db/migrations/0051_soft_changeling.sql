CREATE TYPE "public"."wassce_candidate_status" AS ENUM('REGISTERED', 'ACTIVE', 'WITHDRAWN', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."wassce_paper_type" AS ENUM('OBJECTIVE', 'ESSAY', 'PRACTICAL', 'ORAL', 'COMBINED');--> statement-breakpoint
CREATE TYPE "public"."wassce_reg_flag" AS ENUM('ON_MEDICAL', 'NHIS_ISSUE', 'FEE');--> statement-breakpoint
CREATE TYPE "public"."wassce_subject_type" AS ENUM('CORE', 'ELECTIVE', 'OPTIONAL');--> statement-breakpoint
CREATE TABLE "wassce_candidate_subject" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_wassce_candidate_subject" UNIQUE("school_id","candidate_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "wassce_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"cohort_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"programme_id" uuid NOT NULL,
	"index_number" text NOT NULL,
	"centre_code" text NOT NULL,
	"candidate_status" "wassce_candidate_status" DEFAULT 'REGISTERED' NOT NULL,
	"reg_flag" "wassce_reg_flag",
	"accommodations_json" jsonb,
	"note" text,
	"mock_2_aggregate" smallint,
	"projected_aggregate" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_wassce_index_number" UNIQUE("school_id","index_number"),
	CONSTRAINT "uniq_wassce_candidate_student_cohort" UNIQUE("school_id","cohort_id","student_id"),
	CONSTRAINT "wassce_candidates_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "wassce_cohort" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"exam_year" integer NOT NULL,
	"setup_frozen_at" timestamp with time zone,
	"headmaster_cosign_user_id" uuid,
	"headmaster_cosign_at" timestamp with time zone,
	"academic_cosign_user_id" uuid,
	"academic_cosign_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_wassce_cohort_per_year" UNIQUE("school_id","exam_year"),
	CONSTRAINT "wassce_cohort_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "wassce_cohort_freeze_needs_both_cosigns" CHECK ("wassce_cohort"."setup_frozen_at" IS NULL OR ("wassce_cohort"."headmaster_cosign_at" IS NOT NULL AND "wassce_cohort"."academic_cosign_at" IS NOT NULL)),
	CONSTRAINT "wassce_cohort_distinct_cosigners" CHECK ("wassce_cohort"."headmaster_cosign_user_id" IS NULL OR "wassce_cohort"."academic_cosign_user_id" IS NULL OR "wassce_cohort"."headmaster_cosign_user_id" <> "wassce_cohort"."academic_cosign_user_id")
);
--> statement-breakpoint
CREATE TABLE "wassce_paper_sittings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"paper_id" uuid NOT NULL,
	"sat_at" timestamp with time zone,
	"exempted_at" timestamp with time zone,
	"exemption_reason_text" text,
	"make_up_at" timestamp with time zone,
	"make_up_centre" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_wassce_paper_sitting" UNIQUE("school_id","candidate_id","paper_id")
);
--> statement-breakpoint
CREATE TABLE "wassce_papers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"cohort_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"name" text NOT NULL,
	"paper_number" smallint,
	"paper_type" "wassce_paper_type" NOT NULL,
	"waec_paper_code" text,
	"scheduled_date" date,
	"scheduled_time" text,
	"duration_minutes" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_wassce_paper" UNIQUE("school_id","cohort_id","subject_id","name"),
	CONSTRAINT "wassce_papers_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "wassce_programmes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"programme" "programme" NOT NULL,
	"name" text NOT NULL,
	"active_flag" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_wassce_programme_per_school" UNIQUE("school_id","programme"),
	CONSTRAINT "wassce_programmes_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "wassce_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"programme_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject_type" "wassce_subject_type" NOT NULL,
	"active_flag" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_wassce_subject_per_programme" UNIQUE("school_id","programme_id","name"),
	CONSTRAINT "wassce_subjects_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
ALTER TABLE "wassce_candidate_subject" ADD CONSTRAINT "wassce_candidate_subject_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_candidate_subject" ADD CONSTRAINT "wassce_candidate_subject_school_id_candidate_id_wassce_candidates_school_id_id_fk" FOREIGN KEY ("school_id","candidate_id") REFERENCES "public"."wassce_candidates"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_candidate_subject" ADD CONSTRAINT "wassce_candidate_subject_school_id_subject_id_wassce_subjects_school_id_id_fk" FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."wassce_subjects"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_candidates" ADD CONSTRAINT "wassce_candidates_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_candidates" ADD CONSTRAINT "wassce_candidates_school_id_cohort_id_wassce_cohort_school_id_id_fk" FOREIGN KEY ("school_id","cohort_id") REFERENCES "public"."wassce_cohort"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_candidates" ADD CONSTRAINT "wassce_candidates_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_candidates" ADD CONSTRAINT "wassce_candidates_school_id_programme_id_wassce_programmes_school_id_id_fk" FOREIGN KEY ("school_id","programme_id") REFERENCES "public"."wassce_programmes"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_cohort" ADD CONSTRAINT "wassce_cohort_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_cohort" ADD CONSTRAINT "wassce_cohort_headmaster_cosign_user_id_ref_user_id_fk" FOREIGN KEY ("headmaster_cosign_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_cohort" ADD CONSTRAINT "wassce_cohort_academic_cosign_user_id_ref_user_id_fk" FOREIGN KEY ("academic_cosign_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_paper_sittings" ADD CONSTRAINT "wassce_paper_sittings_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_paper_sittings" ADD CONSTRAINT "wassce_paper_sittings_school_id_candidate_id_wassce_candidates_school_id_id_fk" FOREIGN KEY ("school_id","candidate_id") REFERENCES "public"."wassce_candidates"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_paper_sittings" ADD CONSTRAINT "wassce_paper_sittings_school_id_paper_id_wassce_papers_school_id_id_fk" FOREIGN KEY ("school_id","paper_id") REFERENCES "public"."wassce_papers"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_papers" ADD CONSTRAINT "wassce_papers_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_papers" ADD CONSTRAINT "wassce_papers_school_id_cohort_id_wassce_cohort_school_id_id_fk" FOREIGN KEY ("school_id","cohort_id") REFERENCES "public"."wassce_cohort"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_papers" ADD CONSTRAINT "wassce_papers_school_id_subject_id_wassce_subjects_school_id_id_fk" FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."wassce_subjects"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_programmes" ADD CONSTRAINT "wassce_programmes_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_subjects" ADD CONSTRAINT "wassce_subjects_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wassce_subjects" ADD CONSTRAINT "wassce_subjects_school_id_programme_id_wassce_programmes_school_id_id_fk" FOREIGN KEY ("school_id","programme_id") REFERENCES "public"."wassce_programmes"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wassce_candidate_subject_subject_idx" ON "wassce_candidate_subject" USING btree ("school_id","subject_id");--> statement-breakpoint
CREATE INDEX "wassce_candidates_cohort_idx" ON "wassce_candidates" USING btree ("school_id","cohort_id");--> statement-breakpoint
CREATE INDEX "wassce_candidates_programme_idx" ON "wassce_candidates" USING btree ("school_id","programme_id");--> statement-breakpoint
CREATE INDEX "wassce_paper_sittings_paper_idx" ON "wassce_paper_sittings" USING btree ("school_id","paper_id");--> statement-breakpoint
CREATE INDEX "wassce_papers_cohort_subject_idx" ON "wassce_papers" USING btree ("school_id","cohort_id","subject_id");--> statement-breakpoint
CREATE INDEX "wassce_subjects_programme_idx" ON "wassce_subjects" USING btree ("school_id","programme_id");