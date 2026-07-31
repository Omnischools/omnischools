CREATE TABLE "plc_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"plc_id" uuid NOT NULL,
	"academic_period_id" uuid NOT NULL,
	"session_date" date NOT NULL,
	"topic" text,
	"agenda_json" jsonb DEFAULT '{"items": []}'::jsonb NOT NULL,
	"opened_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plc_session_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "uniq_plc_session" UNIQUE("school_id","plc_id","session_date")
);
--> statement-breakpoint
CREATE TABLE "plc_session_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid,
	"status" "attendance_status" NOT NULL,
	"minutes_late" integer,
	"note" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_plc_session_attendance" UNIQUE("school_id","session_id","user_id"),
	CONSTRAINT "plc_session_attendance_minutes_late_nonneg" CHECK ("plc_session_attendance"."minutes_late" >= 0)
);
--> statement-breakpoint
CREATE TABLE "plc_session_reflection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid,
	"q1" text,
	"q2" text,
	"q3" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_plc_session_reflection" UNIQUE("school_id","session_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "plc_session" ADD CONSTRAINT "plc_session_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_session" ADD CONSTRAINT "plc_session_opened_by_user_id_ref_user_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_session" ADD CONSTRAINT "plc_session_school_id_plc_id_plc_school_id_id_fk" FOREIGN KEY ("school_id","plc_id") REFERENCES "public"."plc"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_session" ADD CONSTRAINT "plc_session_school_id_academic_period_id_academic_period_school_id_period_id_fk" FOREIGN KEY ("school_id","academic_period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_session_attendance" ADD CONSTRAINT "plc_session_attendance_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_session_attendance" ADD CONSTRAINT "plc_session_attendance_user_id_ref_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_session_attendance" ADD CONSTRAINT "plc_session_attendance_recorded_by_user_id_ref_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_session_attendance" ADD CONSTRAINT "plc_session_attendance_school_id_session_id_plc_session_school_id_id_fk" FOREIGN KEY ("school_id","session_id") REFERENCES "public"."plc_session"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_session_reflection" ADD CONSTRAINT "plc_session_reflection_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_session_reflection" ADD CONSTRAINT "plc_session_reflection_user_id_ref_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_session_reflection" ADD CONSTRAINT "plc_session_reflection_confirmed_by_user_id_ref_user_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_session_reflection" ADD CONSTRAINT "plc_session_reflection_school_id_session_id_plc_session_school_id_id_fk" FOREIGN KEY ("school_id","session_id") REFERENCES "public"."plc_session"("school_id","id") ON DELETE cascade ON UPDATE no action;