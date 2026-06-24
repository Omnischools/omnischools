CREATE TABLE "invoice_discount_application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"discount_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"kind_snapshot" "discount_kind",
	"rank" integer,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "invoice_discount_application" ADD CONSTRAINT "invoice_discount_application_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_discount_application" ADD CONSTRAINT "invoice_discount_application_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_discount_application" ADD CONSTRAINT "invoice_discount_application_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_discount_application" ADD CONSTRAINT "invoice_discount_application_discount_id_discount_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discount"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_discount_application" ADD CONSTRAINT "invoice_discount_application_applied_by_user_id_ref_user_id_fk" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_discount_app_school_idx" ON "invoice_discount_application" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "invoice_discount_app_invoice_idx" ON "invoice_discount_application" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_discount_app_discount_idx" ON "invoice_discount_application" USING btree ("discount_id");