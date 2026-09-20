CREATE TYPE "public"."allocation_method" AS ENUM('MANUAL', 'AUTO_OLDEST_FIRST', 'AUTO_NEWEST_FIRST');--> statement-breakpoint
CREATE TYPE "public"."allocation_type" AS ENUM('INVOICE', 'CREDIT', 'REFUND');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'ISSUED', 'PARTIAL', 'PAID', 'OVERDUE', 'EXEMPT', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."payment_actor_type" AS ENUM('ADMIN', 'SYSTEM', 'WEBHOOK', 'RECONCILIATION_JOB');--> statement-breakpoint
CREATE TYPE "public"."payment_event_type" AS ENUM('CREATED', 'ALLOCATION_ADDED', 'ALLOCATION_VOIDED', 'SETTLED', 'VOIDED', 'SMS_SENT', 'SMS_FAILED', 'REFUNDED', 'DISCOUNT_OVERRIDDEN');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('MTN_MOMO', 'TELECEL_CASH', 'AIRTELTIGO_MONEY', 'BANK_TRANSFER', 'CASH', 'CHEQUE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('PENDING', 'CONFIRMED', 'SETTLED', 'RECONCILED', 'DISPUTED');--> statement-breakpoint
CREATE TABLE "fee_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_fee_category_per_school" UNIQUE("school_id","name")
);
--> statement-breakpoint
CREATE TABLE "invoice_line_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"fee_category_id" uuid,
	"description" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"academic_year" text NOT NULL,
	"period_id" uuid,
	"subtotal_amount" numeric(12, 2) NOT NULL,
	"discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"billed_amount" numeric(12, 2) NOT NULL,
	"paid_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"balance_amount" numeric(12, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'ISSUED' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	CONSTRAINT "uniq_invoice_number_per_school" UNIQUE("school_id","invoice_number")
);
--> statement-breakpoint
CREATE TABLE "payment_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid,
	"allocation_type" "allocation_type" DEFAULT 'INVOICE' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"allocation_method" "allocation_method" DEFAULT 'MANUAL' NOT NULL,
	"allocated_by_user_id" uuid,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"payment_id" uuid,
	"invoice_id" uuid,
	"event_type" "payment_event_type" NOT NULL,
	"actor_user_id" uuid,
	"actor_type" "payment_actor_type" DEFAULT 'ADMIN' NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"recorded_by_user_id" uuid,
	"gross_amount" numeric(12, 2) NOT NULL,
	"fee_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'GHS' NOT NULL,
	"method" "payment_method" NOT NULL,
	"method_reference" text,
	"aggregator" text,
	"settlement_status" "settlement_status" DEFAULT 'PENDING' NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"receipt_number" text NOT NULL,
	"student_id" uuid NOT NULL,
	"pdf_url" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"void_replacement_id" uuid,
	CONSTRAINT "receipt_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "uniq_receipt_number_per_school" UNIQUE("school_id","receipt_number")
);
--> statement-breakpoint
ALTER TABLE "fee_category" ADD CONSTRAINT "fee_category_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_item" ADD CONSTRAINT "invoice_line_item_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_item" ADD CONSTRAINT "invoice_line_item_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_item" ADD CONSTRAINT "invoice_line_item_fee_category_id_fee_category_id_fk" FOREIGN KEY ("fee_category_id") REFERENCES "public"."fee_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_period_id_academic_period_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."academic_period"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_allocated_by_user_id_ref_user_id_fk" FOREIGN KEY ("allocated_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_audit_log" ADD CONSTRAINT "payment_audit_log_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_audit_log" ADD CONSTRAINT "payment_audit_log_actor_user_id_ref_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_recorded_by_user_id_ref_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_voided_by_user_id_ref_user_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_student_idx" ON "invoice" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "payment_audit_school_time_idx" ON "payment_audit_log" USING btree ("school_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_student_idx" ON "payment" USING btree ("student_id");