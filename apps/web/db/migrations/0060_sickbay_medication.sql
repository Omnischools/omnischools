CREATE TYPE "public"."sickbay_med_source" AS ENUM('CHRONIC', 'STANDING_ORDER', 'DOCTOR_ORDERED', 'AD_HOC');--> statement-breakpoint
CREATE TYPE "public"."sickbay_med_status" AS ENUM('GIVEN', 'REFUSED', 'HELD', 'OMITTED');--> statement-breakpoint
CREATE TYPE "public"."sickbay_stock_movement_type" AS ENUM('RECEIPT', 'WASTAGE', 'ADJUSTMENT');--> statement-breakpoint
CREATE TABLE "sickbay_controlled_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"movement_type" "sickbay_stock_movement_type" NOT NULL,
	"quantity" numeric NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_user_id" uuid,
	"witness_user_id" uuid,
	"batch_ref" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sickbay_med_admin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"visit_id" uuid,
	"slot_id" uuid,
	"source" "sickbay_med_source" NOT NULL,
	"chronic_med_id" uuid,
	"standing_order_id" uuid,
	"consult_id" uuid,
	"drug_name" text NOT NULL,
	"dose_label" text NOT NULL,
	"route" text,
	"is_controlled" boolean DEFAULT false NOT NULL,
	"dispensed_qty" numeric,
	"status" "sickbay_med_status" NOT NULL,
	"administered_at" timestamp with time zone NOT NULL,
	"administered_by_user_id" uuid,
	"witness_user_id" uuid,
	"witness_override_reason" text,
	"notes" text,
	"corrects_admin_id" uuid,
	"amendment_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sickbay_med_admin_tenant_uk" UNIQUE("school_id","id"),
	CONSTRAINT "med_admin_controlled_needs_qty" CHECK ("sickbay_med_admin"."is_controlled" = false OR "sickbay_med_admin"."dispensed_qty" IS NOT NULL),
	CONSTRAINT "med_admin_controlled_given_witness" CHECK (NOT ("sickbay_med_admin"."is_controlled" AND "sickbay_med_admin"."status" = 'GIVEN') OR "sickbay_med_admin"."witness_user_id" IS NOT NULL OR "sickbay_med_admin"."witness_override_reason" IS NOT NULL),
	CONSTRAINT "med_admin_witness_not_self" CHECK ("sickbay_med_admin"."witness_user_id" IS NULL OR "sickbay_med_admin"."witness_user_id" <> "sickbay_med_admin"."administered_by_user_id"),
	CONSTRAINT "med_admin_source_pointer_match" CHECK (("sickbay_med_admin"."source" = 'CHRONIC' AND "sickbay_med_admin"."standing_order_id" IS NULL AND "sickbay_med_admin"."consult_id" IS NULL)
       OR ("sickbay_med_admin"."source" = 'STANDING_ORDER' AND "sickbay_med_admin"."standing_order_id" IS NOT NULL AND "sickbay_med_admin"."chronic_med_id" IS NULL AND "sickbay_med_admin"."consult_id" IS NULL)
       OR ("sickbay_med_admin"."source" = 'DOCTOR_ORDERED' AND "sickbay_med_admin"."consult_id" IS NOT NULL AND "sickbay_med_admin"."chronic_med_id" IS NULL AND "sickbay_med_admin"."standing_order_id" IS NULL)
       OR ("sickbay_med_admin"."source" = 'AD_HOC' AND "sickbay_med_admin"."chronic_med_id" IS NULL AND "sickbay_med_admin"."standing_order_id" IS NULL AND "sickbay_med_admin"."consult_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sickbay_standing_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"complaint" text NOT NULL,
	"treatment" text NOT NULL,
	"escalation" text,
	"ordered_by_doctor_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sickbay_standing_order_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "sickbay_stock_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"drug_name" text NOT NULL,
	"form_label" text,
	"unit" text,
	"qty_on_hand" numeric DEFAULT '0' NOT NULL,
	"reorder_point" numeric,
	"last_restocked_at" timestamp with time zone,
	"is_controlled" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sickbay_stock_item_tenant_uk" UNIQUE("school_id","id")
);
--> statement-breakpoint
ALTER TABLE "sickbay_doctor_consult" ADD CONSTRAINT "sickbay_doctor_consult_tenant_uk" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "sickbay_controlled_movement" ADD CONSTRAINT "sickbay_controlled_movement_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_controlled_movement" ADD CONSTRAINT "sickbay_controlled_movement_actor_user_id_ref_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_controlled_movement" ADD CONSTRAINT "sickbay_controlled_movement_witness_user_id_ref_user_id_fk" FOREIGN KEY ("witness_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_controlled_movement" ADD CONSTRAINT "sickbay_controlled_movement_school_id_stock_item_id_sickbay_stock_item_school_id_id_fk" FOREIGN KEY ("school_id","stock_item_id") REFERENCES "public"."sickbay_stock_item"("school_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_administered_by_user_id_ref_user_id_fk" FOREIGN KEY ("administered_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_witness_user_id_ref_user_id_fk" FOREIGN KEY ("witness_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_school_id_visit_id_sickbay_visit_school_id_id_fk" FOREIGN KEY ("school_id","visit_id") REFERENCES "public"."sickbay_visit"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_school_id_slot_id_sickbay_schedule_slot_school_id_id_fk" FOREIGN KEY ("school_id","slot_id") REFERENCES "public"."sickbay_schedule_slot"("school_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_school_id_chronic_med_id_sickbay_chronic_med_school_id_id_fk" FOREIGN KEY ("school_id","chronic_med_id") REFERENCES "public"."sickbay_chronic_med"("school_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_school_id_standing_order_id_sickbay_standing_order_school_id_id_fk" FOREIGN KEY ("school_id","standing_order_id") REFERENCES "public"."sickbay_standing_order"("school_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_school_id_consult_id_sickbay_doctor_consult_school_id_id_fk" FOREIGN KEY ("school_id","consult_id") REFERENCES "public"."sickbay_doctor_consult"("school_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_med_admin" ADD CONSTRAINT "sickbay_med_admin_corrects_fk" FOREIGN KEY ("school_id","corrects_admin_id") REFERENCES "public"."sickbay_med_admin"("school_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_standing_order" ADD CONSTRAINT "sickbay_standing_order_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_standing_order" ADD CONSTRAINT "sickbay_standing_order_created_by_user_id_ref_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sickbay_stock_item" ADD CONSTRAINT "sickbay_stock_item_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sickbay_controlled_movement_item_idx" ON "sickbay_controlled_movement" USING btree ("school_id","stock_item_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sickbay_med_admin_student_idx" ON "sickbay_med_admin" USING btree ("school_id","student_id","administered_at");--> statement-breakpoint
CREATE INDEX "sickbay_med_admin_slot_idx" ON "sickbay_med_admin" USING btree ("school_id","slot_id","administered_at");--> statement-breakpoint
CREATE INDEX "sickbay_med_admin_visit_idx" ON "sickbay_med_admin" USING btree ("school_id","visit_id");--> statement-breakpoint
CREATE INDEX "sickbay_admission_student_admitted_idx" ON "sickbay_admission" USING btree ("school_id","student_id","admitted_at");