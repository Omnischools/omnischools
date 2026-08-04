CREATE TABLE "census_return" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"cadence" text NOT NULL,
	"academic_year" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"census_date" date NOT NULL,
	"auto_snapshot" jsonb NOT NULL,
	"hand_fill" jsonb,
	"generated_by" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_census_return_filing" UNIQUE("school_id","cadence","academic_year"),
	CONSTRAINT "census_return_cadence_valid" CHECK ("census_return"."cadence" IN ('MID_YEAR', 'ANNUAL')),
	CONSTRAINT "census_return_status_valid" CHECK ("census_return"."status" IN ('DRAFT', 'COMPLETED'))
);
--> statement-breakpoint
ALTER TABLE "census_return" ADD CONSTRAINT "census_return_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "census_return" ADD CONSTRAINT "census_return_generated_by_ref_user_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;