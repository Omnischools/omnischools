CREATE TYPE "public"."benchmark_metric" AS ENUM('CREDIT_RATE', 'DISTINCTION_RATE');--> statement-breakpoint
CREATE TYPE "public"."benchmark_quality" AS ENUM('STRONG', 'MODERATE', 'DIRECTIONAL');--> statement-breakpoint
CREATE TYPE "public"."benchmark_scope" AS ENUM('SCHOOL', 'REGION', 'NATIONAL');--> statement-breakpoint
CREATE TYPE "public"."benchmark_source" AS ENUM('SCHOOLUP_DIRECT', 'WAEC_NATIONAL', 'WAEC_REGIONAL_SUMMARY', 'INTERPOLATED', 'MULTI_SCHOOL_POOL');--> statement-breakpoint
CREATE TYPE "public"."wassce_grade" AS ENUM('A1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'E8', 'F9');--> statement-breakpoint
CREATE TABLE "benchmark_data_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"subject_id" uuid,
	"metric" "benchmark_metric" NOT NULL,
	"scope" "benchmark_scope" NOT NULL,
	"value" numeric(5, 2) NOT NULL,
	"source" "benchmark_source" NOT NULL,
	"quality" "benchmark_quality" NOT NULL,
	"confidence_interval_pp" numeric(5, 2),
	"reference_year" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_reference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_name" text NOT NULL,
	"region" text,
	"metric" "benchmark_metric" NOT NULL,
	"scope" "benchmark_scope" NOT NULL,
	"value" numeric(5, 2) NOT NULL,
	"source" "benchmark_source" NOT NULL,
	"quality" "benchmark_quality" NOT NULL,
	"confidence_interval_pp" numeric(5, 2),
	"reference_year" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"cohort_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mock_number" smallint NOT NULL,
	"is_predictor" boolean DEFAULT false NOT NULL,
	"scheduled_start" date,
	"scheduled_end" date,
	"marking_complete_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_mock_exam_number" UNIQUE("school_id","cohort_id","mock_number"),
	CONSTRAINT "mock_exams_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "mock_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"mock_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"grade" "wassce_grade" NOT NULL,
	"raw_score" numeric(5, 2),
	"max_score" numeric(5, 2),
	"marked_by_user_id" uuid,
	"marked_at" timestamp with time zone,
	"moderated_grade" "wassce_grade",
	"moderator_user_id" uuid,
	"moderated_at" timestamp with time zone,
	"moderation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_mock_result" UNIQUE("school_id","mock_id","candidate_id","subject_id"),
	CONSTRAINT "mock_results_moderation_trail" CHECK ("mock_results"."moderated_grade" IS NULL OR ("mock_results"."moderator_user_id" IS NOT NULL AND "mock_results"."moderated_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "benchmark_data_points" ADD CONSTRAINT "benchmark_data_points_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_data_points" ADD CONSTRAINT "benchmark_data_points_school_id_subject_id_wassce_subjects_school_id_id_fk" FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."wassce_subjects"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_school_id_cohort_id_wassce_cohort_school_id_id_fk" FOREIGN KEY ("school_id","cohort_id") REFERENCES "public"."wassce_cohort"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_results" ADD CONSTRAINT "mock_results_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_results" ADD CONSTRAINT "mock_results_marked_by_user_id_ref_user_id_fk" FOREIGN KEY ("marked_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_results" ADD CONSTRAINT "mock_results_moderator_user_id_ref_user_id_fk" FOREIGN KEY ("moderator_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_results" ADD CONSTRAINT "mock_results_school_id_mock_id_mock_exams_school_id_id_fk" FOREIGN KEY ("school_id","mock_id") REFERENCES "public"."mock_exams"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_results" ADD CONSTRAINT "mock_results_school_id_candidate_id_wassce_candidates_school_id_id_fk" FOREIGN KEY ("school_id","candidate_id") REFERENCES "public"."wassce_candidates"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_results" ADD CONSTRAINT "mock_results_school_id_subject_id_wassce_subjects_school_id_id_fk" FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."wassce_subjects"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_mock_exam_predictor" ON "mock_exams" USING btree ("school_id","cohort_id") WHERE "mock_exams"."is_predictor";--> statement-breakpoint
CREATE INDEX "mock_results_mock_subject_idx" ON "mock_results" USING btree ("school_id","mock_id","subject_id");--> statement-breakpoint
CREATE INDEX "mock_results_candidate_idx" ON "mock_results" USING btree ("school_id","candidate_id");