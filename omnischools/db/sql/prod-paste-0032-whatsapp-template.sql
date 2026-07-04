-- Omnischools — migration 0032: whatsapp_template (composed WhatsApp templates + their
-- Meta-approval lifecycle) + RLS. Idempotent — safe to run more than once. Paste into
-- the Supabase SQL editor on PROD after merging. (db:policies only configures local dev;
-- new tenant tables need their RLS pasted on prod by hand.)

CREATE TABLE IF NOT EXISTS "whatsapp_template" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "name" text NOT NULL,
  "category" text DEFAULT 'UTILITY' NOT NULL,
  "language" text DEFAULT 'en_GH' NOT NULL,
  "header_type" text DEFAULT 'NONE' NOT NULL,
  "header_text" text,
  "header_filename" text,
  "body" text NOT NULL,
  "footer" text,
  "buttons" jsonb,
  "sample_values" jsonb,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "rejection_reason" text,
  "submitted_at" timestamptz,
  "decided_at" timestamptz,
  "created_by_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_whatsapp_template_name_per_school" UNIQUE ("school_id", "name")
);

DO $$ BEGIN
  ALTER TABLE "whatsapp_template" ADD CONSTRAINT "whatsapp_template_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school" ("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp_template" ADD CONSTRAINT "whatsapp_template_created_by_user_id_ref_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."ref_user" ("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "whatsapp_template_school_idx"
  ON "whatsapp_template" USING btree ("school_id");

-- RLS — the same tenant_isolation policy every other tenant table uses.
ALTER TABLE "whatsapp_template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_template" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "whatsapp_template";
CREATE POLICY tenant_isolation ON "whatsapp_template" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );
