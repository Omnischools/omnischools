-- Omnischools — migration 0034: composite school-scoped foreign keys (defence in depth).
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD.
-- (db:policies only configures local dev; this hardening is applied to prod by hand.)
--
-- WHAT — Every intra-tenant reference (a tenant table pointing at another tenant table)
-- is upgraded from a single-column FK (`fk -> parent.id`, existence-only) to a COMPOSITE
-- FK `(school_id, fk) -> parent(school_id, id)`. This makes it structurally impossible
-- for a row in school A to reference a parent row in school B — the database now enforces
-- co-tenancy directly, on top of RLS (which was, and remains, the primary guard).
--
-- SCOPE — Covers the 33 mandatory/structural FKs (ON DELETE CASCADE / NO ACTION /
-- RESTRICT). The 9 nullable `ON DELETE SET NULL` FKs (e.g. students.household_id,
-- conversation.student_id, notification_log.template_id) are deliberately left as
-- single-column: a composite SET NULL would try to null the NOT NULL school_id, and the
-- Postgres 15+ `SET NULL (column)` form that avoids this is not expressible in Drizzle,
-- so forcing it would permanently desync the ORM schema from the DB. Those references are
-- optional pointers already protected by RLS.
--
-- Mirrors the Drizzle schema (db/schema/*.ts), which was updated in the same change so
-- `drizzle-kit generate` produces no drift.

-- 1) Parent tables get a UNIQUE (school_id, <pk>) so a composite FK can target it.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('academic_period','period_id'),
    ('admission_application','id'),
    ('attendance_record','id'),
    ('class','id'),
    ('conversation','id'),
    ('discount','id'),
    ('fee_category','id'),
    ('fee_structure','id'),
    ('gradebook_column','id'),
    ('invoice','id'),
    ('payment','id'),
    ('students','id'),
    ('subject','id')
  ) AS t(parent, refcol)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.parent || '_tenant_uk') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (school_id, %I)',
                     r.parent, r.parent || '_tenant_uk', r.refcol);
    END IF;
  END LOOP;
END $$;

-- 2) Replace each single-column intra-tenant FK with a composite (school_id, fk) FK,
--    preserving the original ON DELETE action. New constraint: <child>_<col>_tenant_fk.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- child, fk column, old constraint name, parent, parent ref col, on delete
    ('gradebook_column','period_id','gradebook_column_period_id_fkey','academic_period','period_id','CASCADE'),
    ('gradebook_score','period_id','gradebook_score_period_id_academic_period_period_id_fk','academic_period','period_id','CASCADE'),
    ('invoice','period_id','invoice_period_id_academic_period_period_id_fk','academic_period','period_id','NO ACTION'),
    ('report_card','period_id','report_card_period_id_academic_period_period_id_fk','academic_period','period_id','CASCADE'),
    ('admission_document','application_id','admission_document_application_id_admission_application_id_fk','admission_application','id','CASCADE'),
    ('attendance_correction','attendance_record_id','attendance_correction_attendance_record_id_attendance_record_id','attendance_record','id','CASCADE'),
    ('attendance_record','class_id','attendance_record_class_id_class_id_fk','class','id','CASCADE'),
    ('gradebook_column','class_id','gradebook_column_class_id_fkey','class','id','CASCADE'),
    ('students','class_id','students_class_id_class_id_fk','class','id','NO ACTION'),
    ('timetable_slot','class_id','timetable_slot_class_id_fkey','class','id','CASCADE'),
    ('inbox_message','conversation_id','inbox_message_conversation_id_fkey','conversation','id','CASCADE'),
    ('discount_tier','discount_id','discount_tier_discount_id_discount_id_fk','discount','id','CASCADE'),
    ('invoice_discount_application','discount_id','invoice_discount_application_discount_id_fkey','discount','id','RESTRICT'),
    ('invoice_line_item','fee_category_id','invoice_line_item_fee_category_id_fee_category_id_fk','fee_category','id','NO ACTION'),
    ('fee_structure_item','fee_structure_id','fee_structure_item_fee_structure_id_fkey','fee_structure','id','CASCADE'),
    ('gradebook_column_score','column_id','gradebook_column_score_column_id_fkey','gradebook_column','id','CASCADE'),
    ('invoice_discount_application','invoice_id','invoice_discount_application_invoice_id_fkey','invoice','id','CASCADE'),
    ('invoice_line_item','invoice_id','invoice_line_item_invoice_id_invoice_id_fk','invoice','id','CASCADE'),
    ('payment_allocation','invoice_id','payment_allocation_invoice_id_invoice_id_fk','invoice','id','NO ACTION'),
    ('payment_allocation','payment_id','payment_allocation_payment_id_payment_id_fk','payment','id','CASCADE'),
    ('receipt','payment_id','receipt_payment_id_payment_id_fk','payment','id','CASCADE'),
    ('admission_application','student_id','admission_application_student_id_students_id_fk','students','id','NO ACTION'),
    ('attendance_record','student_id','attendance_record_student_id_students_id_fk','students','id','CASCADE'),
    ('gradebook_column_score','student_id','gradebook_column_score_student_id_fkey','students','id','CASCADE'),
    ('gradebook_score','student_id','gradebook_score_student_id_students_id_fk','students','id','CASCADE'),
    ('invoice','student_id','invoice_student_id_students_id_fk','students','id','CASCADE'),
    ('invoice_discount_application','student_id','invoice_discount_application_student_id_fkey','students','id','CASCADE'),
    ('payment','student_id','payment_student_id_students_id_fk','students','id','CASCADE'),
    ('receipt','student_id','receipt_student_id_students_id_fk','students','id','CASCADE'),
    ('report_card','student_id','report_card_student_id_students_id_fk','students','id','CASCADE'),
    ('student_guardian','student_id','student_guardian_student_id_students_id_fk','students','id','CASCADE'),
    ('gradebook_column','subject_id','gradebook_column_subject_id_fkey','subject','id','CASCADE'),
    ('gradebook_score','subject_id','gradebook_score_subject_id_subject_id_fk','subject','id','CASCADE')
  ) AS r(child, col, oldname, parent, refcol, ondel)
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', r.child, r.oldname);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.child || '_' || r.col || '_tenant_fk') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (school_id, %I) REFERENCES %I (school_id, %I) ON DELETE %s',
        r.child, r.child || '_' || r.col || '_tenant_fk', r.col, r.parent, r.refcol, r.ondel
      );
    END IF;
  END LOOP;
END $$;
