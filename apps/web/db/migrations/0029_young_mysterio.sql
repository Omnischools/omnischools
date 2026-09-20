CREATE TABLE "staff_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date_of_birth" date,
	"gender" text,
	"address" text,
	"emergency_contact" text,
	"qualification_level" text,
	"highest_qualification" text,
	"undergraduate" text,
	"ntc_licence_number" text,
	"ntc_licence_expiry" date,
	"specialisations" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_staff_profile_per_school" UNIQUE("school_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "staff_profile" ADD CONSTRAINT "staff_profile_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profile" ADD CONSTRAINT "staff_profile_user_id_ref_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_profile_school_idx" ON "staff_profile" USING btree ("school_id");