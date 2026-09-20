CREATE TYPE "public"."ledger_correction_reason" AS ENUM('RE_GRADED', 'TRANSCRIPTION_ERROR', 'OTHER');--> statement-breakpoint
ALTER TABLE "ref_assessment_weights" ADD COLUMN "asgn_denominator" smallint DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "ref_assessment_weights" ADD COLUMN "mid_sem_denominator" smallint DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "ref_assessment_weights" ADD COLUMN "end_sem_denominator" smallint DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "ref_assessment_weights" ADD COLUMN "project_denominator" smallint DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "ref_assessment_weights" ADD COLUMN "portfolio_denominator" smallint DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "ref_assessment_weights" ADD CONSTRAINT "assessment_denominators_positive" CHECK ("ref_assessment_weights"."asgn_denominator" > 0 AND "ref_assessment_weights"."mid_sem_denominator" > 0 AND "ref_assessment_weights"."end_sem_denominator" > 0 AND "ref_assessment_weights"."project_denominator" > 0 AND "ref_assessment_weights"."portfolio_denominator" > 0);