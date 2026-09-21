-- Omnischools — Oversight §6 read-back role `oversight_readback` on the OPERATIONAL PROD project
-- (omnischools-prod). Implements apps/oversight/docs/PROVISIONING.md §4a EXACTLY. Idempotent — safe to
-- run more than once. Paste into the Supabase SQL editor on omnischools-prod AFTER
-- prod-paste-0102-oversight-consent.sql (the grant list references school_staff_oversight_consent).
--
-- ⚠ PASSWORD IS SET OUT-OF-BAND — this file NEVER contains one. The role is created LOGIN NOINHERIT with
-- no password; the owner runs `ALTER ROLE oversight_readback PASSWORD '…';` separately and stores the
-- resulting OPERATIONAL_READBACK_URL as a Vercel secret on the `omnischools-oversight` project ONLY. This
-- is the only thread from Oversight back to operational data; every privacy property reduces to how narrow
-- this role is (§4a). SELECT-only, explicit table allow-list, read-only tx, tight timeouts.

-- ---- 1. the role (idempotent) ----
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oversight_readback') THEN
    CREATE ROLE oversight_readback LOGIN NOINHERIT;
  END IF;
END $$;

-- ---- 2. schema access: usage only, never create ----
REVOKE ALL ON SCHEMA public FROM oversight_readback;
GRANT USAGE ON SCHEMA public TO oversight_readback;

-- ---- 3. structural read-only + tight timeouts (apply on login as this role) ----
ALTER ROLE oversight_readback SET default_transaction_read_only = on;
ALTER ROLE oversight_readback SET statement_timeout = '5s';
ALTER ROLE oversight_readback SET idle_in_transaction_session_timeout = '10s';

-- ---- 4. explicit table allow-list — SELECT only, table by table (NO `grant select on all tables`) ----
--   staff_profile                       the individual record itself
--   ref_role + role_assignment          derive the subject's staff_category (GES_TEACHER | OTHER_STAFF)
--   facilities_snapshot                 the school-context fields some reason codes unlock
--   school_staff_oversight_consent      the consent check, read LIVE inside the read-back transaction
--   ref_school                          confirm the operational tenant uuid == the EMIS school picked
GRANT SELECT ON staff_profile, ref_role, role_assignment,
                facilities_snapshot, school_staff_oversight_consent, ref_school
  TO oversight_readback;

-- ref_user is GLOBAL (no tenant key). A table-wide grant here would be a platform-wide PII enumeration
-- primitive, so grant COLUMN-SCOPED — and NOT email (no reason code releases an email; the grant is the
-- only place that makes that structural).
GRANT SELECT (id, full_name, phone) ON ref_user TO oversight_readback;

-- ⚠ staff_compensation: NO GRANT. Salary is not oversight data; the only durable way to say so is for the
-- role to be unable to read it. Do not add it "for symmetry".

-- ---- 5. confirm-not-enumerate RLS policies (PROVISIONING lines 251-265) ----
-- ref_user / ref_role are RLS-ENABLED-NO-POLICY on prod (prod-paste-0033), i.e. deny-all to any non-owner
-- role. A bare grant returns ZERO rows and the identity spine's INNER join yields nothing → the audit log
-- would overstate a disclosure that never happened. So the grant and these narrow policies land TOGETHER.
-- Belt-and-braces re-affirm RLS is enabled (idempotent; prod-paste-0033 already did this):
ALTER TABLE ref_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE ref_role ENABLE ROW LEVEL SECURITY;

-- ref_user: the role may CONFIRM a user IS staff at the school it is currently scoped into, never enumerate
-- the platform. Keyed on app.current_school (the read-back sets it to the one school being drilled into).
DROP POLICY IF EXISTS oversight_readback_confirm ON ref_user;
CREATE POLICY oversight_readback_confirm ON ref_user
  FOR SELECT TO oversight_readback
  USING (EXISTS (
    SELECT 1 FROM staff_profile sp
    WHERE sp.user_id = ref_user.id
      AND sp.school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  ));

-- ref_role: same shape, via role_assignment — only roles actually assigned in the scoped school.
DROP POLICY IF EXISTS oversight_readback_confirm ON ref_role;
CREATE POLICY oversight_readback_confirm ON ref_role
  FOR SELECT TO oversight_readback
  USING (EXISTS (
    SELECT 1 FROM role_assignment ra
    WHERE ra.role_id = ref_role.id
      AND ra.school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  ));

-- =============================================================================================
-- VERIFICATION — run AS oversight_readback (NOT the owner; an owner is exempt from RLS and would false-pass).
-- Replace <SCHOOL_A> with a real operational school uuid. Wrap in a transaction and ROLLBACK so SET ROLE and
-- any GUC do not leak. (Note: default_transaction_read_only applies on LOGIN as the role; under SET ROLE the
-- write-DENIAL below comes from the ABSENT grant — permission denied — which is the stronger, structural
-- guarantee. C1..C6 mirror the non-superuser db:rls-test harness section.)
--
--   BEGIN;
--   SET ROLE oversight_readback;
--
--   -- C1  no GUC ⇒ zero rows, never an error, never another school's rows
--   SELECT count(*) FROM school_staff_oversight_consent;   -- expect 0
--   SELECT count(*) FROM ref_user;                         -- expect 0
--   SELECT count(*) FROM ref_role;                         -- expect 0
--
--   -- C2  scoped ⇒ exactly this school's rows (confirm-not-enumerate)
--   SELECT set_config('app.current_school', '<SCHOOL_A>', false);
--   SELECT count(*) FROM school_staff_oversight_consent;   -- expect ≤ 1 (0 or 1 for (school,NON_GES_STAFF))
--   SELECT count(*) FROM ref_user;                         -- expect = SCHOOL_A's staff_profile distinct-user count
--   SELECT count(*) FROM ref_role;                         -- expect = SCHOOL_A's distinct assigned roles
--
--   -- A4  the EXACT Oversight read predicate resolves + casts against the table
--   SELECT id::text, state::text, revoked_at::text, granted_at::text, consent_statement_version
--     FROM school_staff_oversight_consent
--    WHERE school_id = '<SCHOOL_A>'::uuid AND scope::text = 'NON_GES_STAFF' LIMIT 1;
--
--   -- C3  email is unreachable at the GRANT, not merely unselected
--   SELECT email FROM ref_user LIMIT 1;                    -- expect: ERROR permission denied for column email
--
--   -- C4  salary is unreadable
--   SELECT * FROM staff_compensation LIMIT 1;              -- expect: ERROR permission denied for table staff_compensation
--
--   -- C6  no write path on the consent table (no INSERT/UPDATE/DELETE grant)
--   INSERT INTO school_staff_oversight_consent (school_id, scope, state, consent_statement_version)
--     VALUES ('<SCHOOL_A>'::uuid, 'NON_GES_STAFF', 'GRANTED', 'v1');  -- expect: ERROR permission denied / read-only
--
--   ROLLBACK;  -- clears SET ROLE + the GUC
