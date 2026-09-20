CREATE TABLE "discount_tier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"discount_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	CONSTRAINT "uniq_discount_tier_rank" UNIQUE("discount_id","rank")
);
--> statement-breakpoint
ALTER TABLE "discount" ADD COLUMN "applies_to_category_id" uuid;--> statement-breakpoint
ALTER TABLE "discount" ADD COLUMN "duration_label" text;--> statement-breakpoint
ALTER TABLE "discount" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "discount" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discount" ADD COLUMN "approved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "discount" ADD COLUMN "stackable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "discount" ADD COLUMN "is_tiered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "discount" ADD COLUMN "applied_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_tier" ADD CONSTRAINT "discount_tier_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_tier" ADD CONSTRAINT "discount_tier_discount_id_discount_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discount"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount" ADD CONSTRAINT "discount_applies_to_category_id_fee_category_id_fk" FOREIGN KEY ("applies_to_category_id") REFERENCES "public"."fee_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount" ADD CONSTRAINT "discount_approved_by_user_id_ref_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;