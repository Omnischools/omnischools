CREATE TABLE "sen_support_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"grantee_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"granted_by_user_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "sen_support_grant" ADD CONSTRAINT "sen_support_grant_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sen_support_grant" ADD CONSTRAINT "sen_support_grant_grantee_user_id_ref_user_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."ref_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sen_support_grant" ADD CONSTRAINT "sen_support_grant_granted_by_user_id_ref_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sen_support_grant" ADD CONSTRAINT "sen_support_grant_revoked_by_user_id_ref_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sen_support_grant" ADD CONSTRAINT "sen_support_grant_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sen_support_grant_grantee_idx" ON "sen_support_grant" USING btree ("school_id","grantee_user_id");--> statement-breakpoint
CREATE INDEX "sen_support_grant_student_idx" ON "sen_support_grant" USING btree ("school_id","student_id");