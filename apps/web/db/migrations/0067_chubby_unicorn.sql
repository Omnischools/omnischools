CREATE TABLE "vlc_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"session_template_id" uuid NOT NULL,
	"session_date" date NOT NULL,
	"held_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vlc_session_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "uniq_vlc_session" UNIQUE("school_id","class_id","session_date")
);
--> statement-breakpoint
CREATE TABLE "vlc_session_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "attendance_status" NOT NULL,
	"minutes_late" smallint,
	"note" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_vlc_session_attendance" UNIQUE("school_id","session_id","student_id"),
	CONSTRAINT "vlc_session_attendance_minutes_late_nonneg" CHECK ("vlc_session_attendance"."minutes_late" >= 0)
);
--> statement-breakpoint
ALTER TABLE "vlc_session" ADD CONSTRAINT "vlc_session_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_session" ADD CONSTRAINT "vlc_session_held_by_user_id_ref_user_id_fk" FOREIGN KEY ("held_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_session" ADD CONSTRAINT "vlc_session_school_id_class_id_class_school_id_id_fk" FOREIGN KEY ("school_id","class_id") REFERENCES "public"."class"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_session" ADD CONSTRAINT "vlc_session_school_id_session_template_id_vlc_session_template_school_id_id_fk" FOREIGN KEY ("school_id","session_template_id") REFERENCES "public"."vlc_session_template"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_session_attendance" ADD CONSTRAINT "vlc_session_attendance_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_session_attendance" ADD CONSTRAINT "vlc_session_attendance_recorded_by_user_id_ref_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_session_attendance" ADD CONSTRAINT "vlc_session_attendance_school_id_session_id_vlc_session_school_id_id_fk" FOREIGN KEY ("school_id","session_id") REFERENCES "public"."vlc_session"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_session_attendance" ADD CONSTRAINT "vlc_session_attendance_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;