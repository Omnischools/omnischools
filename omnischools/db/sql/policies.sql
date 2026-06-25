-- Row-Level Security for Omnischools (applied after migrations via scripts/apply-policies.ts).
--
-- Tenant isolation is enforced by RLS on every tenant table, keyed on the
-- `app.current_school` GUC set per-transaction (lib/db/rls.ts → withSchool).
--
-- Privileged, cross-tenant work (onboarding, identity lookups, ETL) sets the
-- `app.bypass_rls` GUC to 'on' for the transaction (withoutTenantScope); the
-- policies below honour that flag. This GUC approach is deliberately portable: it
-- needs NO `BYPASSRLS` role (Supabase's non-superuser `postgres` cannot create
-- one) and no superuser. The flag is only ever set by trusted server code in
-- withoutTenantScope — never from user input — so it cannot be forged by a request.
--
-- FORCE RLS is kept so even the table-owning connection role is subject to the
-- policies: a query that forgets to scope (no GUC set) returns zero rows — fails
-- safe — rather than leaking across tenants.
--
-- `omnischools_app` (NOSUPERUSER, no bypass) exists so scripts/rls-test.ts can
-- prove isolation as a non-privileged role even on a local superuser database.

-- ---- role (used by the RLS test; harmless in prod) ----
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnischools_app') THEN
    CREATE ROLE omnischools_app NOSUPERUSER NOINHERIT;
  END IF;
END
$$;

GRANT omnischools_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO omnischools_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO omnischools_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO omnischools_app;

-- ---- tenant-isolation policies ----
-- ref_school: a tenant sees only its own row (keyed on id).
ALTER TABLE ref_school ENABLE ROW LEVEL SECURITY;
ALTER TABLE ref_school FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ref_school;
CREATE POLICY tenant_isolation ON ref_school
  FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

-- All other tenant tables key on school_id.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'ref_school_product',
    'role_assignment',
    'staff_profile',
    'staff_compensation',
    'ref_academic_period_config',
    'academic_period',
    'school_holiday',
    'audit_log',
    'students',
    'student_guardian',
    'household',
    'admission_application',
    'admission_document',
    'fee_category',
    'fee_structure',
    'fee_structure_item',
    'discount',
    'discount_tier',
    'invoice_discount_application',
    'invoice',
    'invoice_line_item',
    'payment',
    'payment_allocation',
    'receipt',
    'payment_audit_log',
    'class',
    'timetable_slot',
    'attendance_record',
    'attendance_correction',
    'attendance_settings',
    'subject',
    'gradebook_config',
    'gradebook_score',
    'gradebook_column',
    'gradebook_column_score',
    'grade_scale',
    'report_card',
    'announcement',
    'sms_template',
    'notification_log',
    'conversation',
    'inbox_message',
    'invite',
    'book_category',
    'book_entry',
    'fixed_asset'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO public '
      'USING (current_setting(''app.bypass_rls'', true) = ''on'' '
      '  OR school_id = NULLIF(current_setting(''app.current_school'', true), '''')::uuid) '
      'WITH CHECK (current_setting(''app.bypass_rls'', true) = ''on'' '
      '  OR school_id = NULLIF(current_setting(''app.current_school'', true), '''')::uuid);',
      tbl
    );
  END LOOP;
END
$$;
