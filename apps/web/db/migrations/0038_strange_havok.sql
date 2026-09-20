CREATE TYPE "public"."assessment_category" AS ENUM('ASSIGNMENT', 'MID_SEM_EXAM', 'END_SEM_EXAM', 'PROJECT');--> statement-breakpoint
CREATE TYPE "public"."ledger_status" AS ENUM('DRAFT', 'COMPLETE', 'STPSHS_READY');--> statement-breakpoint
CREATE TYPE "public"."programme" AS ENUM('GENERAL_ARTS', 'GENERAL_SCIENCE', 'BUSINESS', 'AGRICULTURE', 'VISUAL_ARTS', 'HOME_ECONOMICS', 'TECHNICAL');--> statement-breakpoint
CREATE TYPE "public"."residency" AS ENUM('BOARDER', 'DAY', 'DEBOARDINIZED');--> statement-breakpoint
CREATE TABLE "house" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"colour" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_house_per_school" UNIQUE("school_id","name"),
	CONSTRAINT "house_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "ref_assessment_weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"subject_id" uuid,
	"asgn_weight" smallint DEFAULT 15 NOT NULL,
	"mid_sem_weight" smallint DEFAULT 15 NOT NULL,
	"end_sem_weight" smallint DEFAULT 40 NOT NULL,
	"project_weight" smallint DEFAULT 15 NOT NULL,
	"portfolio_weight" smallint DEFAULT 15 NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_weights_per_school_subject" UNIQUE("school_id","subject_id"),
	CONSTRAINT "assessment_weights_sum_100" CHECK ("ref_assessment_weights"."asgn_weight" + "ref_assessment_weights"."mid_sem_weight" + "ref_assessment_weights"."end_sem_weight" + "ref_assessment_weights"."project_weight" + "ref_assessment_weights"."portfolio_weight" = 100)
);
--> statement-breakpoint
CREATE TABLE "senior_assessment_score" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"raw_mark" numeric(5, 2),
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_assessment_score_per_student" UNIQUE("school_id","assessment_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "senior_assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"category" "assessment_category" NOT NULL,
	"title" text NOT NULL,
	"max_mark" numeric(5, 2) NOT NULL,
	"assessed_on" date,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_assessment_per_context" UNIQUE("school_id","class_id","subject_id","period_id","category","title"),
	CONSTRAINT "senior_assessment_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "senior_score_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"asgn_score" numeric(5, 2),
	"mid_sem_score" numeric(5, 2),
	"end_sem_score" numeric(5, 2),
	"project_score" numeric(5, 2),
	"portfolio_score" numeric(5, 2),
	"weighted_total" numeric(5, 2),
	"asgn_weight_used" smallint,
	"mid_sem_weight_used" smallint,
	"end_sem_weight_used" smallint,
	"project_weight_used" smallint,
	"portfolio_weight_used" smallint,
	"portfolio_manual" boolean DEFAULT false NOT NULL,
	"status" "ledger_status" DEFAULT 'DRAFT' NOT NULL,
	"compiled_by_user_id" uuid,
	"compiled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_ledger_student_subject_period" UNIQUE("school_id","student_id","subject_id","period_id")
);
--> statement-breakpoint
ALTER TABLE "class" ADD COLUMN "programme" "programme";--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "programme" "programme";--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "residency" "residency";--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "house_id" uuid;--> statement-breakpoint
ALTER TABLE "house" ADD CONSTRAINT "house_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_assessment_weights" ADD CONSTRAINT "ref_assessment_weights_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_assessment_weights" ADD CONSTRAINT "ref_assessment_weights_updated_by_user_id_ref_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_assessment_weights" ADD CONSTRAINT "ref_assessment_weights_school_id_subject_id_subject_school_id_id_fk" FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."subject"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_assessment_score" ADD CONSTRAINT "senior_assessment_score_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_assessment_score" ADD CONSTRAINT "senior_assessment_score_updated_by_user_id_ref_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_assessment_score" ADD CONSTRAINT "senior_assessment_score_school_id_assessment_id_senior_assessment_school_id_id_fk" FOREIGN KEY ("school_id","assessment_id") REFERENCES "public"."senior_assessment"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_assessment_score" ADD CONSTRAINT "senior_assessment_score_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_assessment" ADD CONSTRAINT "senior_assessment_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_assessment" ADD CONSTRAINT "senior_assessment_created_by_user_id_ref_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_assessment" ADD CONSTRAINT "senior_assessment_school_id_class_id_class_school_id_id_fk" FOREIGN KEY ("school_id","class_id") REFERENCES "public"."class"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_assessment" ADD CONSTRAINT "senior_assessment_school_id_subject_id_subject_school_id_id_fk" FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."subject"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_assessment" ADD CONSTRAINT "senior_assessment_school_id_period_id_academic_period_school_id_period_id_fk" FOREIGN KEY ("school_id","period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_score_ledger" ADD CONSTRAINT "senior_score_ledger_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_score_ledger" ADD CONSTRAINT "senior_score_ledger_compiled_by_user_id_ref_user_id_fk" FOREIGN KEY ("compiled_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_score_ledger" ADD CONSTRAINT "senior_score_ledger_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_score_ledger" ADD CONSTRAINT "senior_score_ledger_school_id_subject_id_subject_school_id_id_fk" FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."subject"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_score_ledger" ADD CONSTRAINT "senior_score_ledger_school_id_period_id_academic_period_school_id_period_id_fk" FOREIGN KEY ("school_id","period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_school_default_weights" ON "ref_assessment_weights" USING btree ("school_id") WHERE "ref_assessment_weights"."subject_id" IS NULL;--> statement-breakpoint
CREATE INDEX "senior_assessment_score_assessment_idx" ON "senior_assessment_score" USING btree ("assessment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_one_mid_sem_per_context" ON "senior_assessment" USING btree ("school_id","class_id","subject_id","period_id") WHERE "senior_assessment"."category" = 'MID_SEM_EXAM';--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_one_end_sem_per_context" ON "senior_assessment" USING btree ("school_id","class_id","subject_id","period_id") WHERE "senior_assessment"."category" = 'END_SEM_EXAM';--> statement-breakpoint
CREATE INDEX "senior_assessment_context_idx" ON "senior_assessment" USING btree ("period_id","subject_id","class_id");--> statement-breakpoint
CREATE INDEX "senior_ledger_period_subject_idx" ON "senior_score_ledger" USING btree ("period_id","subject_id");--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_house_id_house_school_id_id_fk" FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE set null ON UPDATE no action;