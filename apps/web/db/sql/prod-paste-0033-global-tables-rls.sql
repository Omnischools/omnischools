-- Omnischools — migration 0033: enable RLS on the 7 global (non-tenant) tables that the
-- Supabase security advisor flagged as fully exposed to the anon/authenticated Data API.
-- Idempotent — safe to run more than once. Paste into the Supabase SQL editor on PROD.
-- (db:policies only configures local dev; RLS changes need pasting on prod by hand.)
--
-- These tables have NO school_id, so they intentionally do NOT get the tenant_isolation
-- policy the other tables use. We ENABLE RLS but deliberately do NOT FORCE it and add NO
-- policy: the postgres table owner (the app's direct connection) stays exempt and keeps
-- full access, while the anon/authenticated Data API roles are denied — closing the
-- anon-key exposure without imposing tenant isolation on global data.
--
--   ref_region / ref_district / ref_role / ref_anomaly_rule / gen_period_defaults
--       global reference data, read across tenants (often inside withSchool).
--   ref_user      identity table, read under withoutTenantScope during pre-tenant auth.
--   marketing_lead pre-signup demo-form leads, written with no tenant context at all.

ALTER TABLE public.ref_region          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ref_district        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ref_role            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ref_anomaly_rule    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gen_period_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ref_user            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_lead      ENABLE ROW LEVEL SECURITY;
