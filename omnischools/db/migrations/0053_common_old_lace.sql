CREATE TYPE "public"."parent_ack_method" AS ENUM('PHONE_OTP', 'IN_PERSON', 'PDF_UPLOAD');--> statement-breakpoint
CREATE TYPE "public"."sc_form" AS ENUM('SC-3', 'SC-7', 'SC-12');--> statement-breakpoint
CREATE TYPE "public"."sc_status" AS ENUM('DRAFT', 'FILED', 'ACKNOWLEDGED', 'APPROVED', 'SCHEDULED', 'COMPLETED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "readiness_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"mock_2_id" uuid NOT NULL,
	"projected_aggregate" smallint,
	"projected_band" text,
	"projection_snapshot_json" jsonb NOT NULL,
	"target_universities_json" jsonb,
	"generated_at" timestamp with time zone NOT NULL,
	"generated_by_user_id" uuid,
	"superseded_at" timestamp with time zone,
	"parent_acknowledged_at" timestamp with time zone,
	"parent_acknowledged_signature_method" "parent_ack_method",
	"parent_acknowledged_phone" text,
	"parent_concerns_text" text,
	"parent_signature_pdf_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "readiness_statements_projected_aggregate_range" CHECK ("readiness_statements"."projected_aggregate" IS NULL OR ("readiness_statements"."projected_aggregate" BETWEEN 6 AND 54))
);
--> statement-breakpoint
CREATE TABLE "waec_special_consideration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"sc_form" "sc_form" NOT NULL,
	"status" "sc_status" NOT NULL,
	"filed_at" timestamp with time zone,
	"filed_by_user_id" uuid,
	"medical_cert_file_id" uuid,
	"clinician_letter_file_id" uuid,
	"waec_acknowledged_at" timestamp with time zone,
	"waec_ref" text,
	"approved_at" timestamp with time zone,
	"make_up_scheduled_at" timestamp with time zone,
	"make_up_centre" text,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_waec_sc_candidate_form" UNIQUE("school_id","candidate_id","sc_form")
);
--> statement-breakpoint
ALTER TABLE "readiness_statements" ADD CONSTRAINT "readiness_statements_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_statements" ADD CONSTRAINT "readiness_statements_generated_by_user_id_ref_user_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_statements" ADD CONSTRAINT "readiness_statements_school_id_candidate_id_wassce_candidates_school_id_id_fk" FOREIGN KEY ("school_id","candidate_id") REFERENCES "public"."wassce_candidates"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_statements" ADD CONSTRAINT "readiness_statements_school_id_mock_2_id_mock_exams_school_id_id_fk" FOREIGN KEY ("school_id","mock_2_id") REFERENCES "public"."mock_exams"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waec_special_consideration" ADD CONSTRAINT "waec_special_consideration_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waec_special_consideration" ADD CONSTRAINT "waec_special_consideration_filed_by_user_id_ref_user_id_fk" FOREIGN KEY ("filed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waec_special_consideration" ADD CONSTRAINT "waec_special_consideration_school_id_candidate_id_wassce_candidates_school_id_id_fk" FOREIGN KEY ("school_id","candidate_id") REFERENCES "public"."wassce_candidates"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "readiness_statements_candidate_idx" ON "readiness_statements" USING btree ("school_id","candidate_id");--> statement-breakpoint
CREATE INDEX "readiness_statements_current_idx" ON "readiness_statements" USING btree ("school_id","candidate_id") WHERE "readiness_statements"."superseded_at" IS NULL;