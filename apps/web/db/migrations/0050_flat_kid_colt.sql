CREATE TYPE "public"."infraction_severity" AS ENUM('NOTE', 'WARNING', 'BOND', 'SUSPENSION', 'DEBOARDINIZATION');--> statement-breakpoint
CREATE TYPE "public"."infraction_source" AS ENUM('MANUAL', 'EXEAT_OVERDUE', 'INSPECTION_DAILY', 'INSPECTION_WEEKLY', 'VISIT_OVERSTAY', 'RESUMPTION_ABSENT');--> statement-breakpoint
CREATE TYPE "public"."infraction_status" AS ENUM('OPEN', 'RESOLVED', 'SUPERSEDED');--> statement-breakpoint
CREATE TABLE "boarding_infractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"house_id" uuid,
	"severity" "infraction_severity" NOT NULL,
	"narrative_text" text NOT NULL,
	"status" "infraction_status" DEFAULT 'OPEN' NOT NULL,
	"co_signs_json" jsonb,
	"parent_infraction_id" uuid,
	"source_kind" "infraction_source" DEFAULT 'MANUAL' NOT NULL,
	"source_ref_id" text,
	"logged_by_user_id" uuid,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parents_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boarding_infractions_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "bond_artefacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"infraction_id" uuid NOT NULL,
	"student_signature_at" timestamp with time zone,
	"hm_witness_user_id" uuid,
	"hm_witness_at" timestamp with time zone,
	"senior_hm_witness_user_id" uuid,
	"senior_hm_witness_at" timestamp with time zone,
	"scanned_pdf_file_id" uuid,
	"bond_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_bond_per_infraction" UNIQUE("school_id","infraction_id")
);
--> statement-breakpoint
CREATE TABLE "deboardinization_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"infraction_id" uuid NOT NULL,
	"hm_sign_user_id" uuid,
	"hm_sign_at" timestamp with time zone,
	"senior_hm_sign_user_id" uuid,
	"senior_hm_sign_at" timestamp with time zone,
	"headmaster_sign_user_id" uuid,
	"headmaster_sign_at" timestamp with time zone,
	"effective_at" timestamp with time zone,
	"board_review_at" timestamp with time zone,
	"board_decision_text" text,
	"reinstated_at" timestamp with time zone,
	"reinstated_by_user_id" uuid,
	"fee_penalty_invoice_id" uuid,
	"penalty_days" integer,
	"penalty_per_day_amount" numeric(12, 2),
	"penalty_adjusted_amount" numeric(12, 2),
	"penalty_adjustment_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deboard_effective_needs_all_signs" CHECK ("deboardinization_records"."effective_at" IS NULL OR ("deboardinization_records"."hm_sign_at" IS NOT NULL AND "deboardinization_records"."senior_hm_sign_at" IS NOT NULL AND "deboardinization_records"."headmaster_sign_at" IS NOT NULL)),
	CONSTRAINT "reinstate_needs_board_decision" CHECK ("deboardinization_records"."reinstated_at" IS NULL OR "deboardinization_records"."board_decision_text" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "boarding_infractions" ADD CONSTRAINT "boarding_infractions_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_infractions" ADD CONSTRAINT "boarding_infractions_logged_by_user_id_ref_user_id_fk" FOREIGN KEY ("logged_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_infractions" ADD CONSTRAINT "boarding_infractions_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_infractions" ADD CONSTRAINT "boarding_infractions_school_id_house_id_house_school_id_id_fk" FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_infractions" ADD CONSTRAINT "boarding_infractions_school_id_parent_infraction_id_boarding_infractions_school_id_id_fk" FOREIGN KEY ("school_id","parent_infraction_id") REFERENCES "public"."boarding_infractions"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_artefacts" ADD CONSTRAINT "bond_artefacts_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_artefacts" ADD CONSTRAINT "bond_artefacts_hm_witness_user_id_ref_user_id_fk" FOREIGN KEY ("hm_witness_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_artefacts" ADD CONSTRAINT "bond_artefacts_senior_hm_witness_user_id_ref_user_id_fk" FOREIGN KEY ("senior_hm_witness_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_artefacts" ADD CONSTRAINT "bond_artefacts_school_id_infraction_id_boarding_infractions_school_id_id_fk" FOREIGN KEY ("school_id","infraction_id") REFERENCES "public"."boarding_infractions"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deboardinization_records" ADD CONSTRAINT "deboardinization_records_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deboardinization_records" ADD CONSTRAINT "deboardinization_records_hm_sign_user_id_ref_user_id_fk" FOREIGN KEY ("hm_sign_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deboardinization_records" ADD CONSTRAINT "deboardinization_records_senior_hm_sign_user_id_ref_user_id_fk" FOREIGN KEY ("senior_hm_sign_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deboardinization_records" ADD CONSTRAINT "deboardinization_records_headmaster_sign_user_id_ref_user_id_fk" FOREIGN KEY ("headmaster_sign_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deboardinization_records" ADD CONSTRAINT "deboardinization_records_reinstated_by_user_id_ref_user_id_fk" FOREIGN KEY ("reinstated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deboardinization_records" ADD CONSTRAINT "deboardinization_records_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deboardinization_records" ADD CONSTRAINT "deboardinization_records_school_id_infraction_id_boarding_infractions_school_id_id_fk" FOREIGN KEY ("school_id","infraction_id") REFERENCES "public"."boarding_infractions"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_infraction_source" ON "boarding_infractions" USING btree ("school_id","source_kind","source_ref_id") WHERE "boarding_infractions"."source_ref_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "boarding_infractions_student_idx" ON "boarding_infractions" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "boarding_infractions_status_idx" ON "boarding_infractions" USING btree ("school_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_deboard_per_student" ON "deboardinization_records" USING btree ("school_id","student_id") WHERE "deboardinization_records"."effective_at" IS NOT NULL AND "deboardinization_records"."reinstated_at" IS NULL;