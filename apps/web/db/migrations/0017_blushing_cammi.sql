ALTER TABLE "ref_school" ADD COLUMN "record_retention_months" smallint;--> statement-breakpoint
ALTER TABLE "ref_school" ADD COLUMN "audit_retention_months" smallint;--> statement-breakpoint
ALTER TABLE "ref_school" ADD COLUMN "require_2fa" boolean;--> statement-breakpoint
ALTER TABLE "ref_school" ADD COLUMN "session_hours" smallint;