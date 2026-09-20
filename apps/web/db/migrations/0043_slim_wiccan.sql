CREATE TABLE "senior_score_ledger_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"batch_id" uuid NOT NULL,
	"asgn_score" numeric(5, 2),
	"mid_sem_score" numeric(5, 2),
	"end_sem_score" numeric(5, 2),
	"project_score" numeric(5, 2),
	"portfolio_score" numeric(5, 2),
	"weighted_total" numeric(5, 2),
	"status" "ledger_status" NOT NULL,
	"path_used" "capture_path" NOT NULL,
	"committed_by_user_id" uuid,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"supersedes_id" uuid,
	CONSTRAINT "senior_score_ledger_version_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "uniq_ledger_version_grain_number" UNIQUE("school_id","student_id","subject_id","period_id","version_number")
);
--> statement-breakpoint
ALTER TABLE "senior_score_ledger_version" ADD CONSTRAINT "senior_score_ledger_version_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_score_ledger_version" ADD CONSTRAINT "senior_score_ledger_version_committed_by_user_id_ref_user_id_fk" FOREIGN KEY ("committed_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_score_ledger_version" ADD CONSTRAINT "senior_score_ledger_version_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_score_ledger_version" ADD CONSTRAINT "senior_score_ledger_version_school_id_subject_id_subject_school_id_id_fk" FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."subject"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_score_ledger_version" ADD CONSTRAINT "senior_score_ledger_version_school_id_period_id_academic_period_school_id_period_id_fk" FOREIGN KEY ("school_id","period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_score_ledger_version" ADD CONSTRAINT "senior_score_ledger_version_school_id_supersedes_id_senior_score_ledger_version_school_id_id_fk" FOREIGN KEY ("school_id","supersedes_id") REFERENCES "public"."senior_score_ledger_version"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "senior_ledger_version_prune_idx" ON "senior_score_ledger_version" USING btree ("school_id","period_id");