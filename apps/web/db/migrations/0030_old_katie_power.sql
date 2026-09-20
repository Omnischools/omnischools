CREATE TABLE "staff_compensation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"salary_status" text DEFAULT 'SCHOOL_PAID' NOT NULL,
	"monthly_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"pay_method" text DEFAULT 'BANK' NOT NULL,
	"pay_cadence" text DEFAULT 'MONTHLY' NOT NULL,
	"ssnit_deduction" numeric(12, 2) DEFAULT '0' NOT NULL,
	"paye_deduction" numeric(12, 2) DEFAULT '0' NOT NULL,
	"effective_from" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_staff_compensation_per_school" UNIQUE("school_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "staff_compensation" ADD CONSTRAINT "staff_compensation_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_compensation" ADD CONSTRAINT "staff_compensation_user_id_ref_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_compensation_school_idx" ON "staff_compensation" USING btree ("school_id");