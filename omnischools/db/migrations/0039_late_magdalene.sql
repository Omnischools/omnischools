CREATE TYPE "public"."capture_path" AS ENUM('AUTO_COMPILE', 'SCAN_EXTRACT', 'DIRECT_ENTRY');--> statement-breakpoint
CREATE TABLE "senior_ledger_path" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"path" "capture_path" DEFAULT 'AUTO_COMPILE' NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_ledger_path_context" UNIQUE("school_id","class_id","subject_id","period_id")
);
--> statement-breakpoint
ALTER TABLE "senior_ledger_path" ADD CONSTRAINT "senior_ledger_path_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_ledger_path" ADD CONSTRAINT "senior_ledger_path_updated_by_user_id_ref_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_ledger_path" ADD CONSTRAINT "senior_ledger_path_school_id_class_id_class_school_id_id_fk" FOREIGN KEY ("school_id","class_id") REFERENCES "public"."class"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_ledger_path" ADD CONSTRAINT "senior_ledger_path_school_id_subject_id_subject_school_id_id_fk" FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."subject"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_ledger_path" ADD CONSTRAINT "senior_ledger_path_school_id_period_id_academic_period_school_id_period_id_fk" FOREIGN KEY ("school_id","period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade ON UPDATE no action;