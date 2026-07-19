CREATE TYPE "public"."target_rank" AS ENUM('FIRST_CHOICE', 'SECOND_CHOICE', 'THIRD_CHOICE');--> statement-breakpoint
CREATE TYPE "public"."university_type" AS ENUM('PUBLIC_UNIVERSITY', 'PRIVATE_UNIVERSITY', 'TECHNICAL_UNIVERSITY', 'POLYTECHNIC', 'NURSING_COLLEGE', 'EDUCATION_COLLEGE');--> statement-breakpoint
CREATE TABLE "universities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"university_type" "university_type" NOT NULL,
	"location" text NOT NULL,
	"region" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "university_programmes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qualification" text NOT NULL,
	"duration_years" smallint,
	"current_cut_off" smallint NOT NULL,
	"cut_off_reference_year" smallint NOT NULL,
	"cut_off_history_json" jsonb,
	"prerequisite_subjects_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "university_programmes_current_cut_off_range" CHECK ("university_programmes"."current_cut_off" BETWEEN 6 AND 54)
);
--> statement-breakpoint
CREATE TABLE "university_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"university_programme_id" uuid NOT NULL,
	"target_rank" "target_rank",
	"tagged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tagged_by_user_id" uuid,
	"parent_acknowledged_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_university_target_programme" UNIQUE("school_id","candidate_id","university_programme_id")
);
--> statement-breakpoint
DROP INDEX "readiness_statements_current_idx";--> statement-breakpoint
ALTER TABLE "university_programmes" ADD CONSTRAINT "university_programmes_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_targets" ADD CONSTRAINT "university_targets_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_targets" ADD CONSTRAINT "university_targets_university_programme_id_university_programmes_id_fk" FOREIGN KEY ("university_programme_id") REFERENCES "public"."university_programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_targets" ADD CONSTRAINT "university_targets_tagged_by_user_id_ref_user_id_fk" FOREIGN KEY ("tagged_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_targets" ADD CONSTRAINT "university_targets_school_id_candidate_id_wassce_candidates_school_id_id_fk" FOREIGN KEY ("school_id","candidate_id") REFERENCES "public"."wassce_candidates"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "university_programmes_university_idx" ON "university_programmes" USING btree ("university_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_university_target_rank" ON "university_targets" USING btree ("school_id","candidate_id","target_rank") WHERE "university_targets"."target_rank" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "university_targets_candidate_idx" ON "university_targets" USING btree ("school_id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "readiness_statements_current_idx" ON "readiness_statements" USING btree ("school_id","candidate_id") WHERE "readiness_statements"."superseded_at" IS NULL;