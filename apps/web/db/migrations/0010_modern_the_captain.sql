CREATE TYPE "public"."invite_status" AS ENUM('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"token" text NOT NULL,
	"role" "app_role" NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"assignments" jsonb,
	"status" "invite_status" DEFAULT 'PENDING' NOT NULL,
	"invited_by_user_id" uuid,
	"accepted_user_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "invite_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_invited_by_user_id_ref_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_accepted_user_id_ref_user_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invite_school_status_idx" ON "invite" USING btree ("school_id","status");