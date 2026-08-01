CREATE TABLE "pta_dues_charge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"line_item_id" uuid NOT NULL,
	"pta_id" uuid NOT NULL,
	"tier_type" text NOT NULL,
	"academic_year" text NOT NULL,
	"academic_period_id" uuid,
	"basis" text NOT NULL,
	"cadence" text NOT NULL,
	"subject_student_id" uuid NOT NULL,
	"household_id" uuid,
	"rate_snapshot" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_pta_dues_charge_line_item" UNIQUE("school_id","line_item_id"),
	CONSTRAINT "pta_dues_charge_tier_type_valid" CHECK ("pta_dues_charge"."tier_type" IN ('FORM', 'HOUSE', 'GENERAL', 'EMERGENCY')),
	CONSTRAINT "pta_dues_charge_basis_valid" CHECK ("pta_dues_charge"."basis" IN ('PER_STUDENT', 'PER_FAMILY')),
	CONSTRAINT "pta_dues_charge_cadence_valid" CHECK ("pta_dues_charge"."cadence" IN ('PER_TERM', 'PER_YEAR', 'ONE_OFF'))
);
--> statement-breakpoint
-- ⚠ ORDER (the 0033 target-before-FK discipline, [[dev-db-built-via-push]]): the two composite-FK TARGET
-- UNIQUEs on the pre-existing invoice_line_item / household tables MUST be added BEFORE the pta_dues_charge
-- FKs that reference them, or ALTER … ADD FOREIGN KEY errors with "no unique constraint matching given keys".
-- drizzle-kit emitted these two ADD UNIQUEs LAST; they are hand-hoisted here ahead of the FK block.
ALTER TABLE "household" ADD CONSTRAINT "household_tenant_uk" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "invoice_line_item" ADD CONSTRAINT "invoice_line_item_tenant_uk" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "pta_dues_charge" ADD CONSTRAINT "pta_dues_charge_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_dues_charge" ADD CONSTRAINT "pta_dues_charge_school_id_line_item_id_invoice_line_item_school_id_id_fk" FOREIGN KEY ("school_id","line_item_id") REFERENCES "public"."invoice_line_item"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_dues_charge" ADD CONSTRAINT "pta_dues_charge_school_id_pta_id_ptas_school_id_id_fk" FOREIGN KEY ("school_id","pta_id") REFERENCES "public"."ptas"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_dues_charge" ADD CONSTRAINT "pta_dues_charge_school_id_academic_period_id_academic_period_school_id_period_id_fk" FOREIGN KEY ("school_id","academic_period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_dues_charge" ADD CONSTRAINT "pta_dues_charge_school_id_subject_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","subject_student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_dues_charge" ADD CONSTRAINT "pta_dues_charge_school_id_household_id_household_school_id_id_fk" FOREIGN KEY ("school_id","household_id") REFERENCES "public"."household"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_pta_dues_per_student" ON "pta_dues_charge" USING btree ("school_id","pta_id","academic_period_id","subject_student_id") WHERE "pta_dues_charge"."basis" = 'PER_STUDENT';--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_pta_dues_per_family" ON "pta_dues_charge" USING btree ("school_id","pta_id","academic_year","household_id") WHERE "pta_dues_charge"."basis" = 'PER_FAMILY' AND "pta_dues_charge"."household_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_pta_dues_per_family_of_one" ON "pta_dues_charge" USING btree ("school_id","pta_id","academic_year","subject_student_id") WHERE "pta_dues_charge"."basis" = 'PER_FAMILY' AND "pta_dues_charge"."household_id" IS NULL;--> statement-breakpoint
CREATE INDEX "pta_dues_charge_pta_idx" ON "pta_dues_charge" USING btree ("school_id","pta_id");
