CREATE TYPE "public"."ov_anomaly_severity" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."ov_anomaly_status" AS ENUM('NEW', 'IN_REVIEW', 'ASSIGNED', 'RESOLVED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."assessment_type" AS ENUM('TERMLY', 'ANNUAL', 'MOCK');--> statement-breakpoint
CREATE TYPE "public"."etl_status" AS ENUM('RUNNING', 'SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."exam" AS ENUM('BECE', 'WASSCE');--> statement-breakpoint
CREATE TYPE "public"."ov_fee_category" AS ENUM('TUITION', 'BOARDING', 'FEEDING', 'EXAM', 'PTA_DUES', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."jurisdiction_level" AS ENUM('SCHOOL', 'DISTRICT', 'REGION', 'NATIONAL');--> statement-breakpoint
CREATE TYPE "public"."ov_ownership_type" AS ENUM('PUBLIC', 'PRIVATE', 'MISSION');--> statement-breakpoint
CREATE TYPE "public"."period_type" AS ENUM('TERM', 'ANNUAL', 'EXAM_COHORT');--> statement-breakpoint
CREATE TYPE "public"."record_type" AS ENUM('STUDENT', 'TEACHER');--> statement-breakpoint
CREATE TYPE "public"."access_review_status" AS ENUM('CLEARED', 'QUERIED', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."ov_school_level" AS ENUM('BASIC', 'JHS', 'SHS');--> statement-breakpoint
CREATE TYPE "public"."ov_school_type" AS ENUM('KG', 'PRIMARY', 'JHS', 'SHS', 'COMBINED');--> statement-breakpoint
CREATE TYPE "public"."ov_sex" AS ENUM('MALE', 'FEMALE', 'ALL');--> statement-breakpoint
CREATE TYPE "public"."ov_source" AS ENUM('OPERATIONAL_AGG', 'SCHOOL_ENTERED', 'SCHOOL_GRADEBOOK', 'WAEC_EXTRACT', 'EMIS_EXTRACT', 'GSS_CENSUS', 'GES_ESTABLISHMENT');--> statement-breakpoint
CREATE TABLE "dim_jurisdiction" (
	"jurisdiction_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" "jurisdiction_level" NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"ges_code" text,
	"school_type" "ov_school_type",
	"ownership_type" "ov_ownership_type",
	"founded_year" integer,
	"is_reporting" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dim_period" (
	"period_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_year" text NOT NULL,
	"term" integer,
	"period_type" "period_type" NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"is_current" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dim_stage" (
	"stage" text PRIMARY KEY NOT NULL,
	"official_age_low" integer NOT NULL,
	"official_age_high" integer NOT NULL,
	"display_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dim_subject" (
	"subject" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"is_core" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_anomaly_rule" (
	"rule_code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"predicate_json" jsonb NOT NULL,
	"severity" "ov_anomaly_severity" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_assessment_weights" (
	"weights_config_id" bigserial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"assignments_weight" numeric(5, 2) NOT NULL,
	"mid_sem_weight" numeric(5, 2) NOT NULL,
	"end_sem_weight" numeric(5, 2) NOT NULL,
	"project_weight" numeric(5, 2) NOT NULL,
	"portfolio_weight" numeric(5, 2) NOT NULL,
	"effective_from" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_emis_school_register" (
	"emis_school_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"district_id" uuid,
	"region_id" uuid,
	"school_type" "ov_school_type",
	"ownership_type" "ov_ownership_type",
	"on_schoolup" boolean DEFAULT false NOT NULL,
	"source" "ov_source" DEFAULT 'EMIS_EXTRACT' NOT NULL,
	"as_of_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_ges_teacher_establishment" (
	"establishment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"emis_school_id" text NOT NULL,
	"teaching_posts_established" integer NOT NULL,
	"staff_ids" jsonb,
	"source" "ov_source" DEFAULT 'GES_ESTABLISHMENT' NOT NULL,
	"as_of_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_gss_population" (
	"district_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"population" integer NOT NULL,
	"source" "ov_source" DEFAULT 'GSS_CENSUS' NOT NULL,
	"as_of_date" date NOT NULL,
	CONSTRAINT "ref_gss_population_district_id_stage_as_of_date_pk" PRIMARY KEY("district_id","stage","as_of_date")
);
--> statement-breakpoint
CREATE TABLE "ref_waec_results_extract" (
	"extract_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"emis_school_id" text NOT NULL,
	"academic_year" text NOT NULL,
	"exam" text NOT NULL,
	"subject" text,
	"candidates" integer NOT NULL,
	"qualified" integer NOT NULL,
	"source" "ov_source" DEFAULT 'WAEC_EXTRACT' NOT NULL,
	"as_of_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_access_log" (
	"access_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"officer_id" uuid NOT NULL,
	"officer_role" text NOT NULL,
	"jurisdiction_id" uuid,
	"reason_code" text NOT NULL,
	"case_reference" text,
	"record_type" "record_type" NOT NULL,
	"target_ref" text NOT NULL,
	"fields_released" jsonb,
	"roster_browsed" boolean DEFAULT false NOT NULL,
	"exported" boolean DEFAULT false NOT NULL,
	"export_format" text,
	"review_status" "access_review_status" DEFAULT 'PENDING' NOT NULL,
	"review_note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "etl_run" (
	"run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "etl_status" DEFAULT 'RUNNING' NOT NULL,
	"error_text" text
);
--> statement-breakpoint
CREATE TABLE "fact_anomaly" (
	"anomaly_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"rule_code" text NOT NULL,
	"severity" "ov_anomaly_severity" NOT NULL,
	"status" "ov_anomaly_status" DEFAULT 'NEW' NOT NULL,
	"cluster_id" uuid,
	"detail_json" jsonb,
	"raised_etl_run_id" uuid,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fact_attendance" (
	"fact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"stage" text,
	"class_form" text,
	"enrolled_days" integer NOT NULL,
	"present_days" integer NOT NULL,
	"attendance_rate" numeric(5, 2) NOT NULL,
	"source" "ov_source" NOT NULL,
	"as_of_date" timestamp with time zone NOT NULL,
	"etl_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "fact_enrolment" (
	"fact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"class_form" text,
	"sex" "ov_sex" NOT NULL,
	"headcount" integer NOT NULL,
	"source" "ov_source" NOT NULL,
	"as_of_date" timestamp with time zone NOT NULL,
	"etl_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "fact_fees" (
	"fact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"fee_category" "ov_fee_category" NOT NULL,
	"stage" text,
	"mean_amount" numeric(10, 2),
	"median_amount" numeric(10, 2),
	"source" "ov_source" NOT NULL,
	"as_of_date" timestamp with time zone NOT NULL,
	"etl_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "fact_performance_exam" (
	"fact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"exam" "exam" NOT NULL,
	"sex" "ov_sex" NOT NULL,
	"candidates" integer NOT NULL,
	"qualified" integer NOT NULL,
	"qualification_rate" numeric(5, 2) NOT NULL,
	"source" "ov_source" NOT NULL,
	"as_of_date" timestamp with time zone NOT NULL,
	"etl_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "fact_performance_internal" (
	"fact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"assessment_type" "assessment_type" NOT NULL,
	"school_level" "ov_school_level" NOT NULL,
	"stage" text,
	"class_form" text,
	"subject" text,
	"sex" "ov_sex" NOT NULL,
	"subject_score_mean" numeric(5, 2),
	"assignments_score_mean" numeric(5, 2),
	"mid_sem_score_mean" numeric(5, 2),
	"end_sem_score_mean" numeric(5, 2),
	"project_score_mean" numeric(5, 2),
	"portfolio_score_mean" numeric(5, 2),
	"weights_config_id" bigint,
	"paths_used" jsonb,
	"credit_rate" numeric(5, 2),
	"gradebook_coverage_flag" boolean DEFAULT false NOT NULL,
	"score_ledger_coverage_flag" boolean,
	"source" "ov_source" NOT NULL,
	"as_of_date" timestamp with time zone NOT NULL,
	"etl_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "fact_performance_subject" (
	"fact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"exam" "exam" NOT NULL,
	"subject" text NOT NULL,
	"sex" "ov_sex" NOT NULL,
	"candidates" integer NOT NULL,
	"qualified" integer NOT NULL,
	"qualification_rate" numeric(5, 2) NOT NULL,
	"source" "ov_source" NOT NULL,
	"as_of_date" timestamp with time zone NOT NULL,
	"etl_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "fact_staffing" (
	"fact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"teachers_on_roll" integer NOT NULL,
	"teaching_posts_established" integer,
	"enrolment_total" integer NOT NULL,
	"ptr" numeric(5, 2),
	"vacancies" integer,
	"source" "ov_source" NOT NULL,
	"as_of_date" timestamp with time zone NOT NULL,
	"etl_run_id" uuid
);
--> statement-breakpoint
ALTER TABLE "dim_jurisdiction" ADD CONSTRAINT "dim_jurisdiction_parent_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_emis_school_register" ADD CONSTRAINT "ref_emis_school_register_district_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_emis_school_register" ADD CONSTRAINT "ref_emis_school_register_region_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_ges_teacher_establishment" ADD CONSTRAINT "ref_ges_teacher_establishment_emis_school_id_ref_emis_school_register_emis_school_id_fk" FOREIGN KEY ("emis_school_id") REFERENCES "public"."ref_emis_school_register"("emis_school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_gss_population" ADD CONSTRAINT "ref_gss_population_district_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_gss_population" ADD CONSTRAINT "ref_gss_population_stage_dim_stage_stage_fk" FOREIGN KEY ("stage") REFERENCES "public"."dim_stage"("stage") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_waec_results_extract" ADD CONSTRAINT "ref_waec_results_extract_emis_school_id_ref_emis_school_register_emis_school_id_fk" FOREIGN KEY ("emis_school_id") REFERENCES "public"."ref_emis_school_register"("emis_school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_waec_results_extract" ADD CONSTRAINT "ref_waec_results_extract_subject_dim_subject_subject_fk" FOREIGN KEY ("subject") REFERENCES "public"."dim_subject"("subject") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_access_log" ADD CONSTRAINT "audit_access_log_jurisdiction_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_anomaly" ADD CONSTRAINT "fact_anomaly_jurisdiction_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_anomaly" ADD CONSTRAINT "fact_anomaly_raised_etl_run_id_etl_run_run_id_fk" FOREIGN KEY ("raised_etl_run_id") REFERENCES "public"."etl_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_attendance" ADD CONSTRAINT "fact_attendance_jurisdiction_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_attendance" ADD CONSTRAINT "fact_attendance_period_id_dim_period_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."dim_period"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_attendance" ADD CONSTRAINT "fact_attendance_stage_dim_stage_stage_fk" FOREIGN KEY ("stage") REFERENCES "public"."dim_stage"("stage") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_attendance" ADD CONSTRAINT "fact_attendance_etl_run_id_etl_run_run_id_fk" FOREIGN KEY ("etl_run_id") REFERENCES "public"."etl_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_enrolment" ADD CONSTRAINT "fact_enrolment_jurisdiction_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_enrolment" ADD CONSTRAINT "fact_enrolment_period_id_dim_period_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."dim_period"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_enrolment" ADD CONSTRAINT "fact_enrolment_stage_dim_stage_stage_fk" FOREIGN KEY ("stage") REFERENCES "public"."dim_stage"("stage") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_enrolment" ADD CONSTRAINT "fact_enrolment_etl_run_id_etl_run_run_id_fk" FOREIGN KEY ("etl_run_id") REFERENCES "public"."etl_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_fees" ADD CONSTRAINT "fact_fees_jurisdiction_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_fees" ADD CONSTRAINT "fact_fees_period_id_dim_period_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."dim_period"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_fees" ADD CONSTRAINT "fact_fees_stage_dim_stage_stage_fk" FOREIGN KEY ("stage") REFERENCES "public"."dim_stage"("stage") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_fees" ADD CONSTRAINT "fact_fees_etl_run_id_etl_run_run_id_fk" FOREIGN KEY ("etl_run_id") REFERENCES "public"."etl_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_performance_exam" ADD CONSTRAINT "fact_performance_exam_jurisdiction_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_performance_exam" ADD CONSTRAINT "fact_performance_exam_period_id_dim_period_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."dim_period"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_performance_exam" ADD CONSTRAINT "fact_performance_exam_etl_run_id_etl_run_run_id_fk" FOREIGN KEY ("etl_run_id") REFERENCES "public"."etl_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_performance_internal" ADD CONSTRAINT "fact_performance_internal_jurisdiction_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_performance_internal" ADD CONSTRAINT "fact_performance_internal_period_id_dim_period_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."dim_period"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_performance_internal" ADD CONSTRAINT "fact_performance_internal_stage_dim_stage_stage_fk" FOREIGN KEY ("stage") REFERENCES "public"."dim_stage"("stage") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_performance_internal" ADD CONSTRAINT "fact_performance_internal_subject_dim_subject_subject_fk" FOREIGN KEY ("subject") REFERENCES "public"."dim_subject"("subject") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_performance_internal" ADD CONSTRAINT "fact_performance_internal_weights_config_id_ref_assessment_weights_weights_config_id_fk" FOREIGN KEY ("weights_config_id") REFERENCES "public"."ref_assessment_weights"("weights_config_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_performance_internal" ADD CONSTRAINT "fact_performance_internal_etl_run_id_etl_run_run_id_fk" FOREIGN KEY ("etl_run_id") REFERENCES "public"."etl_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_performance_subject" ADD CONSTRAINT "fact_performance_subject_jurisdiction_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_performance_subject" ADD CONSTRAINT "fact_performance_subject_period_id_dim_period_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."dim_period"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_performance_subject" ADD CONSTRAINT "fact_performance_subject_subject_dim_subject_subject_fk" FOREIGN KEY ("subject") REFERENCES "public"."dim_subject"("subject") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_performance_subject" ADD CONSTRAINT "fact_performance_subject_etl_run_id_etl_run_run_id_fk" FOREIGN KEY ("etl_run_id") REFERENCES "public"."etl_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_staffing" ADD CONSTRAINT "fact_staffing_jurisdiction_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_staffing" ADD CONSTRAINT "fact_staffing_period_id_dim_period_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."dim_period"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_staffing" ADD CONSTRAINT "fact_staffing_etl_run_id_etl_run_run_id_fk" FOREIGN KEY ("etl_run_id") REFERENCES "public"."etl_run"("run_id") ON DELETE no action ON UPDATE no action;