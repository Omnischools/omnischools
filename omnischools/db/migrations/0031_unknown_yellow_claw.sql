CREATE TABLE "inbox_routing_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_fallback" boolean DEFAULT false NOT NULL,
	"match_topic" text,
	"match_class" text,
	"match_keywords" text,
	"assign_to_user_id" uuid,
	"notify_all_admins" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "channel" text DEFAULT 'SMS' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "routed_by_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "routed_by_rule_name" text;--> statement-breakpoint
ALTER TABLE "inbox_routing_rule" ADD CONSTRAINT "inbox_routing_rule_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_routing_rule" ADD CONSTRAINT "inbox_routing_rule_assign_to_user_id_ref_user_id_fk" FOREIGN KEY ("assign_to_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_routing_rule_school_pos_idx" ON "inbox_routing_rule" USING btree ("school_id","position");