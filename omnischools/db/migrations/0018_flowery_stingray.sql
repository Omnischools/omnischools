CREATE TYPE "public"."book_entry_kind" AS ENUM('INCOME', 'EXPENSE');--> statement-breakpoint
CREATE TABLE "book_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "book_entry_kind" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_book_category_per_school" UNIQUE("school_id","kind","name")
);
--> statement-breakpoint
CREATE TABLE "book_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"kind" "book_entry_kind" NOT NULL,
	"entry_date" date NOT NULL,
	"category_id" uuid,
	"description" text,
	"party" text,
	"method" text,
	"reference" text,
	"amount" numeric(12, 2) NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"acquired_on" date,
	"original_cost" numeric(12, 2) NOT NULL,
	"accumulated_depreciation" numeric(12, 2) DEFAULT '0' NOT NULL,
	"useful_life_years" smallint,
	"condition" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_category" ADD CONSTRAINT "book_category_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_entry" ADD CONSTRAINT "book_entry_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_entry" ADD CONSTRAINT "book_entry_category_id_book_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."book_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_entry" ADD CONSTRAINT "book_entry_created_by_user_id_ref_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_category_school_idx" ON "book_category" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "book_entry_school_date_idx" ON "book_entry" USING btree ("school_id","entry_date");--> statement-breakpoint
CREATE INDEX "fixed_asset_school_idx" ON "fixed_asset" USING btree ("school_id");