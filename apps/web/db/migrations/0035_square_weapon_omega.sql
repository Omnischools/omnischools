ALTER TABLE "academic_period" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "academic_period" ADD COLUMN "closed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "academic_period" ADD CONSTRAINT "academic_period_closed_by_user_id_ref_user_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;