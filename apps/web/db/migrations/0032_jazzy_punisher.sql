CREATE TABLE "whatsapp_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'UTILITY' NOT NULL,
	"language" text DEFAULT 'en_GH' NOT NULL,
	"header_type" text DEFAULT 'NONE' NOT NULL,
	"header_text" text,
	"header_filename" text,
	"body" text NOT NULL,
	"footer" text,
	"buttons" jsonb,
	"sample_values" jsonb,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"rejection_reason" text,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_whatsapp_template_name_per_school" UNIQUE("school_id","name")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_template" ADD CONSTRAINT "whatsapp_template_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_template" ADD CONSTRAINT "whatsapp_template_created_by_user_id_ref_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_template_school_idx" ON "whatsapp_template" USING btree ("school_id");