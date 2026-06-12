CREATE TYPE "public"."discount_kind" AS ENUM('PERCENT', 'FIXED');--> statement-breakpoint
CREATE TABLE "discount" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "discount_kind" DEFAULT 'FIXED' NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_discount_per_school" UNIQUE("school_id","name")
);
--> statement-breakpoint
CREATE TABLE "fee_structure_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"fee_structure_id" uuid NOT NULL,
	"fee_category_id" uuid,
	"description" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_structure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" text,
	"academic_year" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_fee_structure_per_school" UNIQUE("school_id","name")
);
--> statement-breakpoint
ALTER TABLE "discount" ADD CONSTRAINT "discount_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_item" ADD CONSTRAINT "fee_structure_item_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_item" ADD CONSTRAINT "fee_structure_item_fee_structure_id_fee_structure_id_fk" FOREIGN KEY ("fee_structure_id") REFERENCES "public"."fee_structure"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_item" ADD CONSTRAINT "fee_structure_item_fee_category_id_fee_category_id_fk" FOREIGN KEY ("fee_category_id") REFERENCES "public"."fee_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure" ADD CONSTRAINT "fee_structure_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;