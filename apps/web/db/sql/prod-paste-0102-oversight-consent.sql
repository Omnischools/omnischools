-- Omnischools — migration 0092: Oversight staff-consent capture — the two consent tables
-- (school_staff_oversight_consent current-state + school_staff_oversight_consent_event append-only
-- history) + their enums + RLS + the append-only trigger. Idempotent — safe to run more than once.
-- Paste into the Supabase SQL editor on the OPERATIONAL PROD project (omnischools-prod) AFTER applying
-- migration 0092. (db:policies only configures local dev; new tenant tables need their RLS pasted on
-- prod by hand or they leak across schools — RLS is NOT auto-applied on prod.)
--
-- Also apply db/sql/prod-paste-0103-oversight-readback-role.sql AFTER this file (the read-back role's
-- grant list references school_staff_oversight_consent, so this table must exist first).

-- ---- enums (idempotent) ----
DO $$ BEGIN CREATE TYPE "oversight_consent_scope" AS ENUM ('NON_GES_STAFF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "oversight_consent_state" AS ENUM ('GRANTED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "oversight_consent_event_type" AS ENUM ('GRANT', 'REVOKE', 'REGRANT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- current-state table: one row per (school, scope) ----
CREATE TABLE IF NOT EXISTS "school_staff_oversight_consent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "scope" "oversight_consent_scope" NOT NULL,
  "state" "oversight_consent_state" NOT NULL,
  "granted_by_user_id" uuid,
  "granted_by_role" text,
  "granted_at" timestamptz DEFAULT now() NOT NULL,
  "revoked_at" timestamptz,
  "consent_statement_version" text NOT NULL,
  CONSTRAINT "school_staff_oversight_consent_school_scope_uk" UNIQUE ("school_id", "scope"),
  -- A5 (load-bearing): the reader's `state='GRANTED' AND revoked_at IS NULL` predicate can only ever be
  -- decided consistently — a one-sided write is structurally impossible.
  CONSTRAINT "school_staff_oversight_consent_state_revoked_agree" CHECK (
    ("state" = 'GRANTED' AND "revoked_at" IS NULL)
    OR ("state" = 'REVOKED' AND "revoked_at" IS NOT NULL)
  )
);

DO $$ BEGIN
  ALTER TABLE "school_staff_oversight_consent"
    ADD CONSTRAINT "school_staff_oversight_consent_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school" ("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "school_staff_oversight_consent"
    ADD CONSTRAINT "school_staff_oversight_consent_granted_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."ref_user" ("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- append-only history table ----
CREATE TABLE IF NOT EXISTS "school_staff_oversight_consent_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "scope" "oversight_consent_scope" NOT NULL,
  "event_type" "oversight_consent_event_type" NOT NULL,
  "actor_user_id" uuid,
  "actor_role" text,
  "consent_statement_version" text,
  "occurred_at" timestamptz DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "school_staff_oversight_consent_event"
    ADD CONSTRAINT "school_staff_oversight_consent_event_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school" ("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "school_staff_oversight_consent_event"
    ADD CONSTRAINT "school_staff_oversight_consent_event_actor_user_id_ref_user_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."ref_user" ("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "school_staff_oversight_consent_event_school_time_idx"
  ON "school_staff_oversight_consent_event" USING btree ("school_id", "occurred_at" DESC NULLS LAST);

-- ---- RLS — the same tenant_isolation policy every other tenant table uses ----
ALTER TABLE "school_staff_oversight_consent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_staff_oversight_consent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "school_staff_oversight_consent";
CREATE POLICY tenant_isolation ON "school_staff_oversight_consent" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

ALTER TABLE "school_staff_oversight_consent_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_staff_oversight_consent_event" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "school_staff_oversight_consent_event";
CREATE POLICY tenant_isolation ON "school_staff_oversight_consent_event" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );

-- parent_deny: on dev the catalog loop in db/sql/policies.sql adds this automatically (FORCE-RLS +
-- school_id + no parent_scope). On prod that loop is NOT run, so add it here too — a RESTRICTIVE policy
-- that denies any parent session (app.current_parent_user set) and is a no-op for staff (pu IS NULL).
DROP POLICY IF EXISTS parent_deny ON "school_staff_oversight_consent";
CREATE POLICY parent_deny ON "school_staff_oversight_consent" AS RESTRICTIVE FOR ALL TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);
DROP POLICY IF EXISTS parent_deny ON "school_staff_oversight_consent_event";
CREATE POLICY parent_deny ON "school_staff_oversight_consent_event" AS RESTRICTIVE FOR ALL TO public
  USING (NULLIF(current_setting('app.current_parent_user', true), '') IS NULL);

-- ---- APPEND-ONLY history (mirror apps/oversight ov_audit_append_only) ----
-- Reject UPDATE/DELETE on the history: a grant/revoke/re-grant only ever INSERTs. Consent that can be
-- silently rewritten is not consent.
CREATE OR REPLACE FUNCTION oversight_consent_event_append_only() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp AS $$
  BEGIN
    RAISE EXCEPTION 'school_staff_oversight_consent_event is append-only (% rejected)', tg_op;
  END $$;
DROP TRIGGER IF EXISTS oversight_consent_event_append_only ON "school_staff_oversight_consent_event";
CREATE TRIGGER oversight_consent_event_append_only
  BEFORE UPDATE OR DELETE ON "school_staff_oversight_consent_event"
  FOR EACH ROW EXECUTE FUNCTION oversight_consent_event_append_only();

-- ---- verification ----
--   \d school_staff_oversight_consent   -- confirm the columns + the A5 CHECK + the (school_id,scope) UNIQUE
-- select relforcerowsecurity from pg_class where relname='school_staff_oversight_consent';        -- expect t
-- select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
--   where c.relname='school_staff_oversight_consent';                                             -- expect 2 (tenant_isolation + parent_deny)
-- select tgname from pg_trigger where tgrelid='school_staff_oversight_consent_event'::regclass
--   and not tgisinternal;                                                                          -- expect oversight_consent_event_append_only
