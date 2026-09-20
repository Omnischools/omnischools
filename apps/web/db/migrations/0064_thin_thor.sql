CREATE TABLE "user_school_block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"blocked_by" uuid,
	"blocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	CONSTRAINT "user_school_block_school_user_uk" UNIQUE("school_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "user_school_block" ADD CONSTRAINT "user_school_block_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_school_block" ADD CONSTRAINT "user_school_block_user_id_ref_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_school_block" ADD CONSTRAINT "user_school_block_blocked_by_ref_user_id_fk" FOREIGN KEY ("blocked_by") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;