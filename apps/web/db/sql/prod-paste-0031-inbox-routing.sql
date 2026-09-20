-- Omnischools — migration 0031: inbox routing rules + conversation channel/topic/
-- provenance columns + RLS. Idempotent — safe to run more than once. Paste into the
-- Supabase SQL editor on PROD after merging. (db:policies only configures local dev;
-- new tenant tables need their RLS pasted on prod by hand.)

CREATE TABLE IF NOT EXISTS "inbox_routing_rule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "name" text NOT NULL,
  "position" smallint DEFAULT 0 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "is_fallback" boolean DEFAULT false NOT NULL,
  "match_topic" text,
  "match_class" text,
  "match_keywords" text,
  "assign_to_user_id" uuid,
  "notify_all_admins" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "inbox_routing_rule" ADD CONSTRAINT "inbox_routing_rule_school_id_ref_school_id_fk"
    FOREIGN KEY ("school_id") REFERENCES "public"."ref_school" ("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "inbox_routing_rule" ADD CONSTRAINT "inbox_routing_rule_assign_to_user_id_ref_user_id_fk"
    FOREIGN KEY ("assign_to_user_id") REFERENCES "public"."ref_user" ("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "inbox_routing_rule_school_pos_idx"
  ON "inbox_routing_rule" USING btree ("school_id", "position");

-- New conversation columns (channel / detected topic / routing provenance).
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "channel" text DEFAULT 'SMS' NOT NULL;
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "topic" text;
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "routed_by_rule_id" uuid;
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "routed_by_rule_name" text;

-- RLS — the same tenant_isolation policy every other tenant table uses.
ALTER TABLE "inbox_routing_rule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbox_routing_rule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "inbox_routing_rule";
CREATE POLICY tenant_isolation ON "inbox_routing_rule" FOR ALL TO public
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR school_id = NULLIF(current_setting('app.current_school', true), '')::uuid
  );
