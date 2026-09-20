ALTER TABLE "student_guardian" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "invite" ADD COLUMN "student_id" uuid;--> statement-breakpoint
ALTER TABLE "student_guardian" ADD CONSTRAINT "student_guardian_user_id_ref_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guardian_user_idx" ON "student_guardian" USING btree ("school_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_guardian_user_per_child" ON "student_guardian" USING btree ("school_id","student_id","user_id") WHERE "student_guardian"."user_id" IS NOT NULL;