CREATE TABLE "pta_meeting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"pta_id" uuid NOT NULL,
	"academic_period_id" uuid NOT NULL,
	"meeting_type" text NOT NULL,
	"meeting_date" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"location" text,
	"agenda_json" jsonb DEFAULT '{"items": []}'::jsonb NOT NULL,
	"invited_teacher_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quorum_met" boolean,
	"convened_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pta_meeting_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "pta_meeting_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"register" text NOT NULL,
	"user_id" uuid,
	"student_guardian_id" uuid,
	"status" "attendance_status" NOT NULL,
	"minutes_late" integer,
	"note" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pta_meeting_attendance_register_valid" CHECK ("pta_meeting_attendance"."register" IN ('TEACHER', 'PARENT')),
	CONSTRAINT "pta_meeting_attendance_register_identity" CHECK (("pta_meeting_attendance"."register" = 'TEACHER' AND "pta_meeting_attendance"."user_id" IS NOT NULL AND "pta_meeting_attendance"."student_guardian_id" IS NULL)
        OR ("pta_meeting_attendance"."register" = 'PARENT' AND "pta_meeting_attendance"."student_guardian_id" IS NOT NULL AND "pta_meeting_attendance"."user_id" IS NULL)),
	CONSTRAINT "pta_meeting_attendance_minutes_late_nonneg" CHECK ("pta_meeting_attendance"."minutes_late" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pta_meeting" ADD CONSTRAINT "pta_meeting_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_meeting" ADD CONSTRAINT "pta_meeting_convened_by_user_id_ref_user_id_fk" FOREIGN KEY ("convened_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_meeting" ADD CONSTRAINT "pta_meeting_school_id_pta_id_ptas_school_id_id_fk" FOREIGN KEY ("school_id","pta_id") REFERENCES "public"."ptas"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_meeting" ADD CONSTRAINT "pta_meeting_school_id_academic_period_id_academic_period_school_id_period_id_fk" FOREIGN KEY ("school_id","academic_period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_meeting_attendance" ADD CONSTRAINT "pta_meeting_attendance_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_meeting_attendance" ADD CONSTRAINT "pta_meeting_attendance_user_id_ref_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_meeting_attendance" ADD CONSTRAINT "pta_meeting_attendance_student_guardian_id_student_guardian_id_fk" FOREIGN KEY ("student_guardian_id") REFERENCES "public"."student_guardian"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_meeting_attendance" ADD CONSTRAINT "pta_meeting_attendance_recorded_by_user_id_ref_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_meeting_attendance" ADD CONSTRAINT "pta_meeting_attendance_school_id_meeting_id_pta_meeting_school_id_id_fk" FOREIGN KEY ("school_id","meeting_id") REFERENCES "public"."pta_meeting"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pta_meeting_pta_idx" ON "pta_meeting" USING btree ("school_id","pta_id","meeting_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_pta_meeting_attendance_teacher" ON "pta_meeting_attendance" USING btree ("school_id","meeting_id","user_id") WHERE "pta_meeting_attendance"."register" = 'TEACHER';--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_pta_meeting_attendance_parent" ON "pta_meeting_attendance" USING btree ("school_id","meeting_id","student_guardian_id") WHERE "pta_meeting_attendance"."register" = 'PARENT';