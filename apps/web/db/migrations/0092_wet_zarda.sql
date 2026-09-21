CREATE TYPE "public"."oversight_consent_event_type" AS ENUM('GRANT', 'REVOKE', 'REGRANT');--> statement-breakpoint
CREATE TYPE "public"."oversight_consent_scope" AS ENUM('NON_GES_STAFF');--> statement-breakpoint
CREATE TYPE "public"."oversight_consent_state" AS ENUM('GRANTED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "school_staff_oversight_consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"scope" "oversight_consent_scope" NOT NULL,
	"state" "oversight_consent_state" NOT NULL,
	"granted_by_user_id" uuid,
	"granted_by_role" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"consent_statement_version" text NOT NULL,
	CONSTRAINT "school_staff_oversight_consent_school_scope_uk" UNIQUE("school_id","scope"),
	CONSTRAINT "school_staff_oversight_consent_state_revoked_agree" CHECK (("school_staff_oversight_consent"."state" = 'GRANTED' AND "school_staff_oversight_consent"."revoked_at" IS NULL)
        OR ("school_staff_oversight_consent"."state" = 'REVOKED' AND "school_staff_oversight_consent"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "school_staff_oversight_consent_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"scope" "oversight_consent_scope" NOT NULL,
	"event_type" "oversight_consent_event_type" NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text,
	"consent_statement_version" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_profile" ADD COLUMN "ges_staff_id" text;--> statement-breakpoint
ALTER TABLE "school_staff_oversight_consent" ADD CONSTRAINT "school_staff_oversight_consent_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_staff_oversight_consent" ADD CONSTRAINT "school_staff_oversight_consent_granted_by_user_id_ref_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_staff_oversight_consent_event" ADD CONSTRAINT "school_staff_oversight_consent_event_school_id_ref_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."ref_school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_staff_oversight_consent_event" ADD CONSTRAINT "school_staff_oversight_consent_event_actor_user_id_ref_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."ref_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_staff_oversight_consent_event_school_time_idx" ON "school_staff_oversight_consent_event" USING btree ("school_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
-- ⚠ RLS — drizzle-kit cannot express it, so it is appended here by hand (re-append after any regenerate).
-- The FAIL-CLOSED property comes from THIS migration, not from db:policies / the prod-paste: a tenant table
-- shipped without ENABLE+FORCE is fully readable by any SELECT-granted non-owner role for the whole window
-- before the paste. Mirrors db/sql/prod-paste-0029-staff-profile.sql (tenant_isolation) and
-- apps/oversight/db/sql/policies.sql (ov_audit_append_only). Also carried in db/sql/policies.sql (dev
-- db:policies) + db/sql/prod-paste-0102-oversight-consent.sql (hand-paste on prod).
ALTER TABLE "school_staff_oversight_consent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "school_staff_oversight_consent" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "school_staff_oversight_consent";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "school_staff_oversight_consent" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );--> statement-breakpoint
ALTER TABLE "school_staff_oversight_consent_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "school_staff_oversight_consent_event" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "school_staff_oversight_consent_event";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "school_staff_oversight_consent_event" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );--> statement-breakpoint
-- APPEND-ONLY: reject UPDATE/DELETE on the consent history (mirror ov_audit_append_only). A grant/revoke/
-- re-grant only ever INSERTs a row; consent that can be silently rewritten is not consent.
CREATE OR REPLACE FUNCTION oversight_consent_event_append_only() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp AS $$
  BEGIN
    RAISE EXCEPTION 'school_staff_oversight_consent_event is append-only (% rejected)', tg_op;
  END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS oversight_consent_event_append_only ON "school_staff_oversight_consent_event";--> statement-breakpoint
CREATE TRIGGER oversight_consent_event_append_only
  BEFORE UPDATE OR DELETE ON "school_staff_oversight_consent_event"
  FOR EACH ROW EXECUTE FUNCTION oversight_consent_event_append_only();