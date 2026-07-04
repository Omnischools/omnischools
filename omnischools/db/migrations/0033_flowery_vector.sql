ALTER TABLE "student_guardian" DROP CONSTRAINT "student_guardian_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_class_id_class_id_fk";
--> statement-breakpoint
ALTER TABLE "admission_application" DROP CONSTRAINT "admission_application_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "admission_document" DROP CONSTRAINT "admission_document_application_id_admission_application_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_line_item" DROP CONSTRAINT "invoice_line_item_invoice_id_invoice_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_line_item" DROP CONSTRAINT "invoice_line_item_fee_category_id_fee_category_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice" DROP CONSTRAINT "invoice_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice" DROP CONSTRAINT "invoice_period_id_academic_period_period_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_allocation" DROP CONSTRAINT "payment_allocation_payment_id_payment_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_allocation" DROP CONSTRAINT "payment_allocation_invoice_id_invoice_id_fk";
--> statement-breakpoint
ALTER TABLE "payment" DROP CONSTRAINT "payment_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "receipt" DROP CONSTRAINT "receipt_payment_id_payment_id_fk";
--> statement-breakpoint
ALTER TABLE "receipt" DROP CONSTRAINT "receipt_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "discount_tier" DROP CONSTRAINT "discount_tier_discount_id_discount_id_fk";
--> statement-breakpoint
ALTER TABLE "fee_structure_item" DROP CONSTRAINT "fee_structure_item_fee_structure_id_fee_structure_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_discount_application" DROP CONSTRAINT "invoice_discount_application_invoice_id_invoice_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_discount_application" DROP CONSTRAINT "invoice_discount_application_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_discount_application" DROP CONSTRAINT "invoice_discount_application_discount_id_discount_id_fk";
--> statement-breakpoint
ALTER TABLE "attendance_correction" DROP CONSTRAINT "attendance_correction_attendance_record_id_attendance_record_id_fk";
--> statement-breakpoint
ALTER TABLE "attendance_record" DROP CONSTRAINT "attendance_record_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "attendance_record" DROP CONSTRAINT "attendance_record_class_id_class_id_fk";
--> statement-breakpoint
ALTER TABLE "gradebook_column_score" DROP CONSTRAINT "gradebook_column_score_column_id_gradebook_column_id_fk";
--> statement-breakpoint
ALTER TABLE "gradebook_column_score" DROP CONSTRAINT "gradebook_column_score_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "gradebook_column" DROP CONSTRAINT "gradebook_column_class_id_class_id_fk";
--> statement-breakpoint
ALTER TABLE "gradebook_column" DROP CONSTRAINT "gradebook_column_subject_id_subject_id_fk";
--> statement-breakpoint
ALTER TABLE "gradebook_column" DROP CONSTRAINT "gradebook_column_period_id_academic_period_period_id_fk";
--> statement-breakpoint
ALTER TABLE "gradebook_score" DROP CONSTRAINT "gradebook_score_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "gradebook_score" DROP CONSTRAINT "gradebook_score_subject_id_subject_id_fk";
--> statement-breakpoint
ALTER TABLE "gradebook_score" DROP CONSTRAINT "gradebook_score_period_id_academic_period_period_id_fk";
--> statement-breakpoint
ALTER TABLE "report_card" DROP CONSTRAINT "report_card_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "report_card" DROP CONSTRAINT "report_card_period_id_academic_period_period_id_fk";
--> statement-breakpoint
ALTER TABLE "timetable_slot" DROP CONSTRAINT "timetable_slot_class_id_class_id_fk";
--> statement-breakpoint
ALTER TABLE "inbox_message" DROP CONSTRAINT "inbox_message_conversation_id_conversation_id_fk";
--> statement-breakpoint
ALTER TABLE "student_guardian" ADD CONSTRAINT "student_guardian_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_class_id_class_school_id_id_fk" FOREIGN KEY ("school_id","class_id") REFERENCES "public"."class"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_application" ADD CONSTRAINT "admission_application_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_document" ADD CONSTRAINT "admission_document_school_id_application_id_admission_application_school_id_id_fk" FOREIGN KEY ("school_id","application_id") REFERENCES "public"."admission_application"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_item" ADD CONSTRAINT "invoice_line_item_school_id_invoice_id_invoice_school_id_id_fk" FOREIGN KEY ("school_id","invoice_id") REFERENCES "public"."invoice"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_item" ADD CONSTRAINT "invoice_line_item_school_id_fee_category_id_fee_category_school_id_id_fk" FOREIGN KEY ("school_id","fee_category_id") REFERENCES "public"."fee_category"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_school_id_period_id_academic_period_school_id_period_id_fk" FOREIGN KEY ("school_id","period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_school_id_payment_id_payment_school_id_id_fk" FOREIGN KEY ("school_id","payment_id") REFERENCES "public"."payment"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_school_id_invoice_id_invoice_school_id_id_fk" FOREIGN KEY ("school_id","invoice_id") REFERENCES "public"."invoice"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_school_id_payment_id_payment_school_id_id_fk" FOREIGN KEY ("school_id","payment_id") REFERENCES "public"."payment"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_tier" ADD CONSTRAINT "discount_tier_school_id_discount_id_discount_school_id_id_fk" FOREIGN KEY ("school_id","discount_id") REFERENCES "public"."discount"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_item" ADD CONSTRAINT "fee_structure_item_school_id_fee_structure_id_fee_structure_school_id_id_fk" FOREIGN KEY ("school_id","fee_structure_id") REFERENCES "public"."fee_structure"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_discount_application" ADD CONSTRAINT "invoice_discount_application_school_id_invoice_id_invoice_school_id_id_fk" FOREIGN KEY ("school_id","invoice_id") REFERENCES "public"."invoice"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_discount_application" ADD CONSTRAINT "invoice_discount_application_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_discount_application" ADD CONSTRAINT "invoice_discount_application_school_id_discount_id_discount_school_id_id_fk" FOREIGN KEY ("school_id","discount_id") REFERENCES "public"."discount"("school_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_school_id_attendance_record_id_attendance_record_school_id_id_fk" FOREIGN KEY ("school_id","attendance_record_id") REFERENCES "public"."attendance_record"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_school_id_class_id_class_school_id_id_fk" FOREIGN KEY ("school_id","class_id") REFERENCES "public"."class"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_column_score" ADD CONSTRAINT "gradebook_column_score_school_id_column_id_gradebook_column_school_id_id_fk" FOREIGN KEY ("school_id","column_id") REFERENCES "public"."gradebook_column"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_column_score" ADD CONSTRAINT "gradebook_column_score_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_column" ADD CONSTRAINT "gradebook_column_school_id_class_id_class_school_id_id_fk" FOREIGN KEY ("school_id","class_id") REFERENCES "public"."class"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_column" ADD CONSTRAINT "gradebook_column_school_id_subject_id_subject_school_id_id_fk" FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."subject"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_column" ADD CONSTRAINT "gradebook_column_school_id_period_id_academic_period_school_id_period_id_fk" FOREIGN KEY ("school_id","period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_score" ADD CONSTRAINT "gradebook_score_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_score" ADD CONSTRAINT "gradebook_score_school_id_subject_id_subject_school_id_id_fk" FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."subject"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_score" ADD CONSTRAINT "gradebook_score_school_id_period_id_academic_period_school_id_period_id_fk" FOREIGN KEY ("school_id","period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_card" ADD CONSTRAINT "report_card_school_id_student_id_students_school_id_id_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_card" ADD CONSTRAINT "report_card_school_id_period_id_academic_period_school_id_period_id_fk" FOREIGN KEY ("school_id","period_id") REFERENCES "public"."academic_period"("school_id","period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slot" ADD CONSTRAINT "timetable_slot_school_id_class_id_class_school_id_id_fk" FOREIGN KEY ("school_id","class_id") REFERENCES "public"."class"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD CONSTRAINT "inbox_message_school_id_conversation_id_conversation_school_id_id_fk" FOREIGN KEY ("school_id","conversation_id") REFERENCES "public"."conversation"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_period" ADD CONSTRAINT "academic_period_tenant_uk" UNIQUE("school_id","period_id");--> statement-breakpoint
ALTER TABLE "class" ADD CONSTRAINT "class_tenant_uk" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_uk" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "admission_application" ADD CONSTRAINT "admission_application_tenant_uk" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "fee_category" ADD CONSTRAINT "fee_category_tenant_uk" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenant_uk" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_uk" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "discount" ADD CONSTRAINT "discount_tenant_uk" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "fee_structure" ADD CONSTRAINT "fee_structure_tenant_uk" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_tenant_uk" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "gradebook_column" ADD CONSTRAINT "gradebook_column_tenant_uk" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_tenant_uk" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_tenant_uk" UNIQUE("school_id","id");