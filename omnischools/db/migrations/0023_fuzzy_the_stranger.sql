CREATE TABLE "attendance_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"day_start" text DEFAULT '08:00' NOT NULL,
	"late_threshold" text DEFAULT '08:15' NOT NULL,
	"day_end" text DEFAULT '15:00' NOT NULL,
	"edit_window_hours" integer DEFAULT 24 NOT NULL,
	"absence_sms" boolean DEFAULT true NOT NULL,
	"abs_watch_days" integer DEFAULT 3 NOT NULL,
	"abs_critical_days" integer DEFAULT 5 NOT NULL,
	"pct_watch" integer DEFAULT 70 NOT NULL,
	"pct_critical" integer DEFAULT 60 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_settings_school_id_unique" UNIQUE("school_id")
);
--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD CONSTRAINT "attendance_settings_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;