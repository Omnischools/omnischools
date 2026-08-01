CREATE TABLE "pta_action_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"agenda_item_id" uuid NOT NULL,
	"description" text NOT NULL,
	"person_user_id" uuid,
	"external_name" text,
	"deadline" date,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pta_action_item_at_most_one_owner" CHECK (NOT ("pta_action_item"."person_user_id" IS NOT NULL AND "pta_action_item"."external_name" IS NOT NULL)),
	CONSTRAINT "pta_action_item_status_valid" CHECK ("pta_action_item"."status" IN ('PENDING', 'DONE'))
);
--> statement-breakpoint
CREATE TABLE "pta_agenda_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"minutes_id" uuid NOT NULL,
	"seq_no" integer NOT NULL,
	"title" text NOT NULL,
	"classification" text,
	"narrative" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pta_agenda_item_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "pta_agenda_item_classification_valid" CHECK ("pta_agenda_item"."classification" IS NULL OR "pta_agenda_item"."classification" IN ('DISCUSSION', 'ACTION', 'RESOLUTION'))
);
--> statement-breakpoint
CREATE TABLE "pta_minutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"secretary_id" uuid,
	"adopted_by_user_id" uuid,
	"adopted_at" timestamp with time zone,
	"distributed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_pta_minutes_meeting" UNIQUE("school_id","meeting_id"),
	CONSTRAINT "pta_minutes_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "pta_minutes_status_valid" CHECK ("pta_minutes"."status" IN ('DRAFT', 'CHAIR_REVIEW', 'ADOPTED'))
);
--> statement-breakpoint
CREATE TABLE "pta_resolution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"agenda_item_id" uuid NOT NULL,
	"resolution_no" text,
	"resolution_text" text NOT NULL,
	"votes_for" integer NOT NULL,
	"votes_against" integer NOT NULL,
	"votes_abstain" integer NOT NULL,
	"binding" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_pta_resolution_no" UNIQUE("school_id","resolution_no"),
	CONSTRAINT "pta_resolution_votes_for_nonneg" CHECK ("pta_resolution"."votes_for" >= 0),
	CONSTRAINT "pta_resolution_votes_against_nonneg" CHECK ("pta_resolution"."votes_against" >= 0),
	CONSTRAINT "pta_resolution_votes_abstain_nonneg" CHECK ("pta_resolution"."votes_abstain" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pta_action_item" ADD CONSTRAINT "pta_action_item_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_action_item" ADD CONSTRAINT "pta_action_item_person_user_id_ref_user_id_fk" FOREIGN KEY ("person_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_action_item" ADD CONSTRAINT "pta_action_item_school_id_agenda_item_id_pta_agenda_item_school_id_id_fk" FOREIGN KEY ("school_id","agenda_item_id") REFERENCES "public"."pta_agenda_item"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_agenda_item" ADD CONSTRAINT "pta_agenda_item_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_agenda_item" ADD CONSTRAINT "pta_agenda_item_school_id_minutes_id_pta_minutes_school_id_id_fk" FOREIGN KEY ("school_id","minutes_id") REFERENCES "public"."pta_minutes"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_minutes" ADD CONSTRAINT "pta_minutes_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_minutes" ADD CONSTRAINT "pta_minutes_secretary_id_ref_user_id_fk" FOREIGN KEY ("secretary_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_minutes" ADD CONSTRAINT "pta_minutes_adopted_by_user_id_ref_user_id_fk" FOREIGN KEY ("adopted_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_minutes" ADD CONSTRAINT "pta_minutes_school_id_meeting_id_pta_meeting_school_id_id_fk" FOREIGN KEY ("school_id","meeting_id") REFERENCES "public"."pta_meeting"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_resolution" ADD CONSTRAINT "pta_resolution_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pta_resolution" ADD CONSTRAINT "pta_resolution_school_id_agenda_item_id_pta_agenda_item_school_id_id_fk" FOREIGN KEY ("school_id","agenda_item_id") REFERENCES "public"."pta_agenda_item"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pta_action_item_agenda_item_idx" ON "pta_action_item" USING btree ("school_id","agenda_item_id");--> statement-breakpoint
CREATE INDEX "pta_agenda_item_minutes_idx" ON "pta_agenda_item" USING btree ("school_id","minutes_id","seq_no");--> statement-breakpoint
CREATE INDEX "pta_resolution_agenda_item_idx" ON "pta_resolution" USING btree ("school_id","agenda_item_id");