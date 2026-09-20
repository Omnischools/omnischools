CREATE TABLE "vlc_programme" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"session_day" smallint DEFAULT 3 NOT NULL,
	"session_start" text DEFAULT '14:30' NOT NULL,
	"opener_min" smallint DEFAULT 5 NOT NULL,
	"small_group_min" smallint DEFAULT 25 NOT NULL,
	"plenary_min" smallint DEFAULT 15 NOT NULL,
	"reflection_min" smallint DEFAULT 10 NOT NULL,
	"close_min" smallint DEFAULT 5 NOT NULL,
	"configured_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vlc_programme_school_id_unique" UNIQUE("school_id"),
	CONSTRAINT "vlc_programme_session_day_range" CHECK ("vlc_programme"."session_day" BETWEEN 1 AND 7),
	CONSTRAINT "vlc_programme_opener_min_positive" CHECK ("vlc_programme"."opener_min" > 0),
	CONSTRAINT "vlc_programme_small_group_min_positive" CHECK ("vlc_programme"."small_group_min" > 0),
	CONSTRAINT "vlc_programme_plenary_min_positive" CHECK ("vlc_programme"."plenary_min" > 0),
	CONSTRAINT "vlc_programme_reflection_min_positive" CHECK ("vlc_programme"."reflection_min" > 0),
	CONSTRAINT "vlc_programme_close_min_positive" CHECK ("vlc_programme"."close_min" > 0)
);
--> statement-breakpoint
CREATE TABLE "vlc_session_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"value_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_vlc_session_template_value_slot" UNIQUE("school_id","value_id","slot"),
	CONSTRAINT "vlc_session_template_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "vlc_session_template_slot_valid" CHECK ("vlc_session_template"."slot" IN ('A', 'B'))
);
--> statement-breakpoint
CREATE TABLE "vlc_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"ordinal" smallint NOT NULL,
	"name_en" text NOT NULL,
	"name_twi" text,
	"term_group" smallint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_vlc_value_ordinal" UNIQUE("school_id","ordinal"),
	CONSTRAINT "vlc_value_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "vlc_value_term_group_range" CHECK ("vlc_value"."term_group" BETWEEN 1 AND 3)
);
--> statement-breakpoint
ALTER TABLE "vlc_programme" ADD CONSTRAINT "vlc_programme_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_session_template" ADD CONSTRAINT "vlc_session_template_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_session_template" ADD CONSTRAINT "vlc_session_template_school_id_value_id_vlc_value_school_id_id_fk" FOREIGN KEY ("school_id","value_id") REFERENCES "public"."vlc_value"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlc_value" ADD CONSTRAINT "vlc_value_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;