CREATE TABLE "pta_dues_config_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"tier_type" text NOT NULL,
	"dues_enabled" boolean NOT NULL,
	"dues_amount" numeric(12, 2),
	"dues_basis" text,
	"dues_cadence" text,
	"effective_from" date NOT NULL,
	"reason" text NOT NULL,
	"changed_by_user_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pta_tiers_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"tier_type" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"frequency_norm" text,
	"officer_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quorum_rule" text,
	"dues_enabled" boolean DEFAULT false NOT NULL,
	"dues_amount" numeric(12, 2),
	"dues_basis" text,
	"dues_cadence" text,
	"tier_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"configured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_pta_tiers_config" UNIQUE("school_id","tier_type"),
	CONSTRAINT "pta_tiers_config_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "pta_tiers_config_tier_type_valid" CHECK ("pta_tiers_config"."tier_type" IN ('FORM', 'HOUSE', 'GENERAL', 'EMERGENCY')),
	CONSTRAINT "pta_tiers_config_dues_basis_valid" CHECK ("pta_tiers_config"."dues_basis" IN ('PER_STUDENT', 'PER_FAMILY')),
	CONSTRAINT "pta_tiers_config_dues_cadence_valid" CHECK ("pta_tiers_config"."dues_cadence" IN ('PER_TERM', 'PER_YEAR', 'ONE_OFF')),
	CONSTRAINT "pta_tiers_config_emergency_no_officers_no_dues" CHECK ("pta_tiers_config"."tier_type" <> 'EMERGENCY' OR ("pta_tiers_config"."officer_roles" = '[]'::jsonb AND "pta_tiers_config"."dues_enabled" = false))
);
--> statement-breakpoint
CREATE TABLE "ptas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"tier_type" text NOT NULL,
	"class_id" uuid,
	"house_id" uuid,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ptas_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "ptas_tier_type_valid" CHECK ("ptas"."tier_type" IN ('FORM', 'HOUSE', 'GENERAL', 'EMERGENCY')),
	CONSTRAINT "ptas_status_valid" CHECK ("ptas"."status" IN ('ACTIVE', 'CLOSED')),
	CONSTRAINT "ptas_tier_scope_binding" CHECK (("ptas"."tier_type" = 'FORM' AND "ptas"."class_id" IS NOT NULL AND "ptas"."house_id" IS NULL)
        OR ("ptas"."tier_type" = 'HOUSE' AND "ptas"."house_id" IS NOT NULL AND "ptas"."class_id" IS NULL)
        OR ("ptas"."tier_type" IN ('GENERAL', 'EMERGENCY') AND "ptas"."class_id" IS NULL AND "ptas"."house_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "pta_dues_config_history" ADD CONSTRAINT "pta_dues_config_history_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_dues_config_history" ADD CONSTRAINT "pta_dues_config_history_changed_by_user_id_ref_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_dues_config_history" ADD CONSTRAINT "pta_dues_config_history_school_id_tier_type_pta_tiers_config_school_id_tier_type_fk" FOREIGN KEY ("school_id","tier_type") REFERENCES "public"."pta_tiers_config"("school_id","tier_type") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_tiers_config" ADD CONSTRAINT "pta_tiers_config_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ptas" ADD CONSTRAINT "ptas_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ptas" ADD CONSTRAINT "ptas_school_id_class_id_class_school_id_id_fk" FOREIGN KEY ("school_id","class_id") REFERENCES "public"."class"("school_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ptas" ADD CONSTRAINT "ptas_school_id_house_id_house_school_id_id_fk" FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pta_dues_config_history_tier_idx" ON "pta_dues_config_history" USING btree ("school_id","tier_type","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_pta_form_scope" ON "ptas" USING btree ("school_id","class_id") WHERE "ptas"."tier_type" = 'FORM';--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_pta_house_scope" ON "ptas" USING btree ("school_id","house_id") WHERE "ptas"."tier_type" = 'HOUSE';--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_pta_general_singleton" ON "ptas" USING btree ("school_id") WHERE "ptas"."tier_type" = 'GENERAL';