CREATE TYPE "public"."sickbay_consult_mode" AS ENUM('PHONE', 'IN_PERSON');--> statement-breakpoint
CREATE TYPE "public"."sickbay_disposition" AS ENUM('DISCHARGE', 'ADMIT', 'REFER');--> statement-breakpoint
CREATE TABLE "sickbay_admission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"bed_id" uuid NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"admitted_by_user_id" uuid,
	"is_isolation" boolean DEFAULT false NOT NULL,
	"expected_discharge_at" timestamp with time zone,
	"discharge_criteria" text,
	"overnight_plan" text,
	"discharged_at" timestamp with time zone,
	"discharged_by_user_id" uuid,
	"discharge_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sickbay_admission_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "uniq_sickbay_admission_visit" UNIQUE("school_id","visit_id")
);
--> statement-breakpoint
CREATE TABLE "sickbay_doctor_consult" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"mode" "sickbay_consult_mode" NOT NULL,
	"clinician_name" text NOT NULL,
	"clinician_affiliation" text,
	"note" text NOT NULL,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sickbay_visit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"presented_at" timestamp with time zone NOT NULL,
	"presenting_complaint" text NOT NULL,
	"intake_reported_by" text,
	"recorded_by_user_id" uuid,
	"started_at" timestamp with time zone,
	"attending_user_id" uuid,
	"working_impression" text,
	"red_flags_screened" text,
	"hydration_status" text,
	"plan" text,
	"escalation_triggers" text,
	"assessed_at" timestamp with time zone,
	"disposition" "sickbay_disposition",
	"disposition_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sickbay_visit_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "sickbay_vital_reading" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"taken_by_user_id" uuid,
	"context" text,
	"temp_c" numeric(3, 1),
	"systolic" smallint,
	"diastolic" smallint,
	"pulse_bpm" smallint,
	"spo2_pct" smallint,
	"pain_score" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sickbay_admission" ADD CONSTRAINT "sickbay_admission_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_admission" ADD CONSTRAINT "sickbay_admission_admitted_by_user_id_ref_user_id_fk" FOREIGN KEY ("admitted_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_admission" ADD CONSTRAINT "sickbay_admission_discharged_by_user_id_ref_user_id_fk" FOREIGN KEY ("discharged_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_admission" ADD CONSTRAINT "sickbay_admission_school_id_visit_id_sickbay_visit_school_id_id_fk" FOREIGN KEY ("school_id","visit_id") REFERENCES "public"."sickbay_visit"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_admission" ADD CONSTRAINT "sickbay_admission_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_admission" ADD CONSTRAINT "sickbay_admission_school_id_bed_id_sickbay_bed_school_id_id_fk" FOREIGN KEY ("school_id","bed_id") REFERENCES "public"."sickbay_bed"("school_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_doctor_consult" ADD CONSTRAINT "sickbay_doctor_consult_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_doctor_consult" ADD CONSTRAINT "sickbay_doctor_consult_recorded_by_user_id_ref_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_doctor_consult" ADD CONSTRAINT "sickbay_doctor_consult_school_id_visit_id_sickbay_visit_school_id_id_fk" FOREIGN KEY ("school_id","visit_id") REFERENCES "public"."sickbay_visit"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_visit" ADD CONSTRAINT "sickbay_visit_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_visit" ADD CONSTRAINT "sickbay_visit_recorded_by_user_id_ref_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_visit" ADD CONSTRAINT "sickbay_visit_attending_user_id_ref_user_id_fk" FOREIGN KEY ("attending_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_visit" ADD CONSTRAINT "sickbay_visit_voided_by_user_id_ref_user_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_visit" ADD CONSTRAINT "sickbay_visit_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_vital_reading" ADD CONSTRAINT "sickbay_vital_reading_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_vital_reading" ADD CONSTRAINT "sickbay_vital_reading_taken_by_user_id_ref_user_id_fk" FOREIGN KEY ("taken_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_vital_reading" ADD CONSTRAINT "sickbay_vital_reading_school_id_visit_id_sickbay_visit_school_id_id_fk" FOREIGN KEY ("school_id","visit_id") REFERENCES "public"."sickbay_visit"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_sickbay_open_admission_bed" ON "sickbay_admission" USING btree ("school_id","bed_id") WHERE "sickbay_admission"."discharged_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_sickbay_open_admission_student" ON "sickbay_admission" USING btree ("school_id","student_id") WHERE "sickbay_admission"."discharged_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sickbay_doctor_consult_visit_idx" ON "sickbay_doctor_consult" USING btree ("school_id","visit_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_sickbay_open_visit_student" ON "sickbay_visit" USING btree ("school_id","student_id") WHERE "sickbay_visit"."disposition" IS NULL AND "sickbay_visit"."voided_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sickbay_visit_presented_idx" ON "sickbay_visit" USING btree ("school_id","presented_at");--> statement-breakpoint
CREATE INDEX "sickbay_vital_reading_visit_idx" ON "sickbay_vital_reading" USING btree ("school_id","visit_id","taken_at");