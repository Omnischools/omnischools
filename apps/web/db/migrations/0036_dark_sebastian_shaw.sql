CREATE TABLE "student_health_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"blood_group" text,
	"allergies" text,
	"conditions" text,
	"medications" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"emergency_contact_relation" text,
	"notes" text,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_health_record_student_id_unique" UNIQUE("student_id")
);
--> statement-breakpoint
ALTER TABLE "student_health_record" ADD CONSTRAINT "student_health_record_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_health_record" ADD CONSTRAINT "student_health_record_updated_by_user_id_ref_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_health_record" ADD CONSTRAINT "student_health_record_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_student_idx" ON "student_health_record" USING btree ("student_id");