CREATE TYPE "public"."inspection_result" AS ENUM('PASS', 'PARTIAL', 'FAIL');--> statement-breakpoint
CREATE TYPE "public"."inspection_type" AS ENUM('DAILY', 'WEEKLY');--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"dormitory_id" uuid NOT NULL,
	"type" "inspection_type" NOT NULL,
	"result" "inspection_result" NOT NULL,
	"bunks_clean" smallint,
	"bunks_total" smallint,
	"findings_json" jsonb NOT NULL,
	"anomalies_count" smallint DEFAULT 0 NOT NULL,
	"inspected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inspected_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prep_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"house_id" uuid NOT NULL,
	"session_date" date NOT NULL,
	"status" "attendance_status" NOT NULL,
	"minutes_late" smallint,
	"note" text,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"logged_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_prep_attendance" UNIQUE("school_id","student_id","session_date")
);
--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspected_by_user_id_ref_user_id_fk" FOREIGN KEY ("inspected_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_school_id_dormitory_id_boarding_dormitory_school_id_id_fk" FOREIGN KEY ("school_id","dormitory_id") REFERENCES "public"."boarding_dormitory"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_attendance" ADD CONSTRAINT "prep_attendance_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_attendance" ADD CONSTRAINT "prep_attendance_logged_by_user_id_ref_user_id_fk" FOREIGN KEY ("logged_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_attendance" ADD CONSTRAINT "prep_attendance_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_attendance" ADD CONSTRAINT "prep_attendance_school_id_house_id_house_school_id_id_fk" FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inspections_dorm_time_idx" ON "inspections" USING btree ("school_id","dormitory_id","inspected_at");--> statement-breakpoint
CREATE INDEX "prep_attendance_house_date_idx" ON "prep_attendance" USING btree ("school_id","house_id","session_date");