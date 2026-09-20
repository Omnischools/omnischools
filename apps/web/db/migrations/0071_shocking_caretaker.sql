CREATE TABLE "plc" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"facilitator_user_id" uuid,
	"override_frequency" text,
	"override_session_day" smallint,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plc_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "plc_type_valid" CHECK ("plc"."type" IN ('subject', 'cross-cutting', 'new-teacher')),
	CONSTRAINT "plc_override_frequency_valid" CHECK ("plc"."override_frequency" IN ('WEEKLY', 'BIWEEKLY')),
	CONSTRAINT "plc_override_session_day_range" CHECK ("plc"."override_session_day" BETWEEN 1 AND 7)
);
--> statement-breakpoint
CREATE TABLE "plc_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"plc_id" uuid NOT NULL,
	"user_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_plc_membership" UNIQUE("school_id","plc_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "plc_programme" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"session_day" smallint DEFAULT 5 NOT NULL,
	"session_start" text DEFAULT '15:30' NOT NULL,
	"session_length_min" integer DEFAULT 60 NOT NULL,
	"weeks_per_semester" integer DEFAULT 12 NOT NULL,
	"pts_per_attended_session" numeric(5, 2) DEFAULT '0.5' NOT NULL,
	"pts_per_reflection" numeric(5, 2) DEFAULT '0.5' NOT NULL,
	"reflection_window_hours" integer DEFAULT 48 NOT NULL,
	"annual_plc_target" numeric(5, 2) DEFAULT '8' NOT NULL,
	"configured_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plc_programme_school_id_unique" UNIQUE("school_id"),
	CONSTRAINT "plc_programme_session_day_range" CHECK ("plc_programme"."session_day" BETWEEN 1 AND 7),
	CONSTRAINT "plc_programme_session_length_min_positive" CHECK ("plc_programme"."session_length_min" > 0),
	CONSTRAINT "plc_programme_weeks_per_semester_positive" CHECK ("plc_programme"."weeks_per_semester" > 0),
	CONSTRAINT "plc_programme_reflection_window_hours_positive" CHECK ("plc_programme"."reflection_window_hours" > 0),
	CONSTRAINT "plc_programme_pts_per_attended_session_nonneg" CHECK ("plc_programme"."pts_per_attended_session" >= 0),
	CONSTRAINT "plc_programme_pts_per_reflection_nonneg" CHECK ("plc_programme"."pts_per_reflection" >= 0),
	CONSTRAINT "plc_programme_annual_plc_target_nonneg" CHECK ("plc_programme"."annual_plc_target" >= 0)
);
--> statement-breakpoint
CREATE TABLE "plc_term_focus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"plc_id" uuid NOT NULL,
	"academic_period_id" uuid NOT NULL,
	"focus" text NOT NULL,
	"set_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_plc_term_focus" UNIQUE("school_id","plc_id","academic_period_id"),
	CONSTRAINT "plc_term_focus_focus_len" CHECK (char_length("plc_term_focus"."focus") <= 500)
);
--> statement-breakpoint
ALTER TABLE "plc" ADD CONSTRAINT "plc_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc" ADD CONSTRAINT "plc_facilitator_user_id_ref_user_id_fk" FOREIGN KEY ("facilitator_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_membership" ADD CONSTRAINT "plc_membership_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_membership" ADD CONSTRAINT "plc_membership_user_id_ref_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_membership" ADD CONSTRAINT "plc_membership_school_id_plc_id_plc_school_id_id_fk" FOREIGN KEY ("school_id","plc_id") REFERENCES "public"."plc"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_programme" ADD CONSTRAINT "plc_programme_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_term_focus" ADD CONSTRAINT "plc_term_focus_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_term_focus" ADD CONSTRAINT "plc_term_focus_set_by_user_id_ref_user_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_term_focus" ADD CONSTRAINT "plc_term_focus_school_id_plc_id_plc_school_id_id_fk" FOREIGN KEY ("school_id","plc_id") REFERENCES "public"."plc"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_term_focus" ADD CONSTRAINT "plc_term_focus_school_id_academic_period_id_academic_period_school_id_period_id_fk" FOREIGN KEY ("school_id","academic_period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plc_membership_user_idx" ON "plc_membership" USING btree ("school_id","user_id");