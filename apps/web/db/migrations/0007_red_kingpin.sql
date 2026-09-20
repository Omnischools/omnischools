CREATE TABLE "timetable_slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"period_index" smallint NOT NULL,
	"start_time" text,
	"end_time" text,
	"subject_id" uuid,
	"teacher_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_timetable_class_slot" UNIQUE("school_id","class_id","day_of_week","period_index")
);
--> statement-breakpoint
ALTER TABLE "class" ADD COLUMN "class_teacher_user_id" uuid;--> statement-breakpoint
ALTER TABLE "timetable_slot" ADD CONSTRAINT "timetable_slot_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slot" ADD CONSTRAINT "timetable_slot_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slot" ADD CONSTRAINT "timetable_slot_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slot" ADD CONSTRAINT "timetable_slot_teacher_user_id_ref_user_id_fk" FOREIGN KEY ("teacher_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timetable_teacher_slot_idx" ON "timetable_slot" USING btree ("school_id","teacher_user_id","day_of_week","period_index");--> statement-breakpoint
ALTER TABLE "class" ADD CONSTRAINT "class_class_teacher_user_id_ref_user_id_fk" FOREIGN KEY ("class_teacher_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;