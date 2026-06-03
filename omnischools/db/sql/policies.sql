-- Row-Level Security for Omnischools (applied after `db:push`).
--
-- Production (Supabase) connects as a NON-superuser role, so these policies are
-- enforced automatically. Locally the Docker superuser bypasses RLS, so we also
-- create a NOSUPERUSER `omnischools_app` role; the RLS test SET ROLEs to it to prove
-- isolation. `omnischools_admin` (BYPASSRLS) backs lib/db withoutTenantScope().

-- ---- roles ----
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnischools_app') THEN
    CREATE ROLE omnischools_app NOSUPERUSER NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnischools_admin') THEN
    CREATE ROLE omnischools_admin NOSUPERUSER BYPASSRLS NOINHERIT;
  END IF;
END
$$;

GRANT omnischools_app TO CURRENT_USER;
GRANT omnischools_admin TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO omnischools_app, omnischools_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO omnischools_app, omnischools_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO omnischools_app, omnischools_admin;

-- ---- tenant-isolation policies ----
-- ref_school: a tenant sees only its own row (keyed on id).
ALTER TABLE ref_school ENABLE ROW LEVEL SECURITY;
ALTER TABLE ref_school FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ref_school;
CREATE POLICY tenant_isolation ON ref_school
  FOR ALL TO public
  USING (id = NULLIF(current_setting('app.current_school', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.current_school', true), '')::uuid);

-- All other tenant tables key on school_id.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'ref_school_product',
    'role_assignment',
    'ref_academic_period_config',
    'academic_period',
    'audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO public '
      'USING (school_id = NULLIF(current_setting(''app.current_school'', true), '''')::uuid) '
      'WITH CHECK (school_id = NULLIF(current_setting(''app.current_school'', true), '''')::uuid);',
      tbl
    );
  END LOOP;
END
$$;
