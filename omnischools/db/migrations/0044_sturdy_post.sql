CREATE TYPE "public"."house_gender" AS ENUM('BOYS', 'GIRLS', 'COED');--> statement-breakpoint
CREATE TYPE "public"."prefect_role" AS ENUM('HEAD', 'DINING', 'SANITATION', 'PREP', 'SICKBAY');--> statement-breakpoint
CREATE TABLE "boarding_bunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"dormitory_id" uuid NOT NULL,
	"position_number" integer NOT NULL,
	"prefect_role" "prefect_role",
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_bunk_per_dormitory" UNIQUE("school_id","dormitory_id","position_number"),
	CONSTRAINT "boarding_bunk_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "boarding_dormitory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"house_id" uuid NOT NULL,
	"name" text NOT NULL,
	"section_label" text,
	"bunk_count" integer DEFAULT 15 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_dormitory_per_house" UNIQUE("school_id","house_id","name"),
	CONSTRAINT "boarding_dormitory_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "bunk_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"bunk_id" uuid NOT NULL,
	"from_at" timestamp with time zone DEFAULT now() NOT NULL,
	"to_at" timestamp with time zone,
	"reason" text NOT NULL,
	"allocated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "house" ADD COLUMN "gender" "house_gender";--> statement-breakpoint
ALTER TABLE "house" ADD COLUMN "capacity" integer;--> statement-breakpoint
ALTER TABLE "house" ADD COLUMN "hm_user_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "current_bunk_id" uuid;--> statement-breakpoint
ALTER TABLE "boarding_bunk" ADD CONSTRAINT "boarding_bunk_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_bunk" ADD CONSTRAINT "boarding_bunk_school_id_dormitory_id_boarding_dormitory_school_id_id_fk" FOREIGN KEY ("school_id","dormitory_id") REFERENCES "public"."boarding_dormitory"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_dormitory" ADD CONSTRAINT "boarding_dormitory_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_dormitory" ADD CONSTRAINT "boarding_dormitory_school_id_house_id_house_school_id_id_fk" FOREIGN KEY ("school_id","house_id") REFERENCES "public"."house"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bunk_allocation" ADD CONSTRAINT "bunk_allocation_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bunk_allocation" ADD CONSTRAINT "bunk_allocation_allocated_by_user_id_ref_user_id_fk" FOREIGN KEY ("allocated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bunk_allocation" ADD CONSTRAINT "bunk_allocation_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bunk_allocation" ADD CONSTRAINT "bunk_allocation_school_id_bunk_id_boarding_bunk_school_id_id_fk" FOREIGN KEY ("school_id","bunk_id") REFERENCES "public"."boarding_bunk"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bunk_allocation_student_idx" ON "bunk_allocation" USING btree ("school_id","student_id");--> statement-breakpoint
ALTER TABLE "house" ADD CONSTRAINT "house_hm_user_id_ref_user_id_fk" FOREIGN KEY ("hm_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_current_bunk_id_boarding_bunk_school_id_id_fk" FOREIGN KEY ("school_id","current_bunk_id") REFERENCES "public"."boarding_bunk"("school_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_student_current_bunk" ON "students" USING btree ("current_bunk_id") WHERE "students"."current_bunk_id" IS NOT NULL;