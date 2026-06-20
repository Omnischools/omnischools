ALTER TABLE "ref_school" ADD COLUMN "billing_cadence" text;--> statement-breakpoint
ALTER TABLE "ref_school" ADD COLUMN "payment_methods" jsonb;--> statement-breakpoint
ALTER TABLE "ref_school" ADD COLUMN "terms_accepted_at" timestamp with time zone;