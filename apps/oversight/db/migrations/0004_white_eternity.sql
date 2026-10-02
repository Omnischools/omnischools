-- ---------------------------------------------------------------------------
-- OFFICER AUTH (increment G) — ref_oversight_officer + audit_officer_provisioning.
--
-- Statements 1–14 are drizzle-kit output VERBATIM (one CREATE TYPE, two CREATE TABLE, two FKs,
-- three indexes). The RLS block at the foot is HAND-APPENDED and must be re-appended after any
-- regeneration of this file — see db/schema/officer.ts and docs/PROVISIONING.md §2a.
--
-- PURELY ADDITIVE: one new type, two new tables. No existing table, column, constraint, policy or
-- row is touched, so the chain replays from empty and applies to a live prod with data.
--
-- ⚠ `ALTER TYPE ... ADD VALUE` HAZARD — NOT PRESENT, AND DELIBERATELY SO. `ov_officer_role` is
-- CREATEd here, and a type created in the same transaction may be used immediately (the "unsafe use
-- of new value" restriction applies only to values ADDED to a pre-existing type — see the 0002
-- header). The one place this migration could have hit the hazard is `ref_oversight_officer.source`:
-- it would naturally have been the pre-existing `ov_source` enum plus a new 'GES_HR_DIRECTORY'
-- value, which could NOT then have been used as this column's DEFAULT in the same migration. That
-- column is `text` instead, so no ALTER TYPE appears anywhere in this file and nothing here needs
-- isolating into a 0005.
-- ---------------------------------------------------------------------------
CREATE TYPE "public"."ov_officer_role" AS ENUM('DISTRICT_OVERSIGHT', 'REGIONAL_OVERSIGHT', 'NATIONAL_OVERSIGHT');--> statement-breakpoint
CREATE TABLE "audit_officer_provisioning" (
	"provisioning_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"approver_id" uuid,
	"target_officer_id" uuid NOT NULL,
	"target_jurisdiction_id" uuid NOT NULL,
	"target_tier" "jurisdiction_level" NOT NULL,
	"role_before" text,
	"role_after" text,
	"active_before" boolean,
	"active_after" boolean NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_officer_provisioning_action" CHECK ("audit_officer_provisioning"."action" in ('PROVISION','ROLE_CHANGE','DEACTIVATE','REACTIVATE','APPROVE')),
	CONSTRAINT "ck_officer_provisioning_tier_not_school" CHECK ("audit_officer_provisioning"."target_tier" <> 'SCHOOL'),
	CONSTRAINT "ck_officer_provisioning_two_person" CHECK ("audit_officer_provisioning"."target_tier" = 'DISTRICT' or "audit_officer_provisioning"."approver_id" is not null),
	CONSTRAINT "ck_officer_provisioning_distinct_approver" CHECK ("audit_officer_provisioning"."approver_id" is null or "audit_officer_provisioning"."approver_id" <> "audit_officer_provisioning"."actor_id"),
	CONSTRAINT "ck_officer_provisioning_active_after" CHECK (case "audit_officer_provisioning"."action"
            when 'DEACTIVATE' then "audit_officer_provisioning"."active_after" = false
            when 'PROVISION'  then "audit_officer_provisioning"."active_after" = true
            when 'REACTIVATE' then "audit_officer_provisioning"."active_after" = true
            else true
          end)
);
--> statement-breakpoint
CREATE TABLE "ref_oversight_officer" (
	"officer_id" uuid PRIMARY KEY NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"officer_role" "ov_officer_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"full_name" text,
	"work_email" text,
	"source" text DEFAULT 'GES_HR_DIRECTORY' NOT NULL,
	"as_of_date" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_officer_provisioning" ADD CONSTRAINT "audit_officer_provisioning_target_jurisdiction_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("target_jurisdiction_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_oversight_officer" ADD CONSTRAINT "ref_oversight_officer_jurisdiction_id_dim_jurisdiction_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."dim_jurisdiction"("jurisdiction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_officer_provisioning_target_idx" ON "audit_officer_provisioning" USING btree ("target_officer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ref_oversight_officer_jurisdiction_idx" ON "ref_oversight_officer" USING btree ("jurisdiction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ref_oversight_officer_active_email_idx" ON "ref_oversight_officer" USING btree ("work_email") WHERE "ref_oversight_officer"."is_active";--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- HAND-APPENDED (drizzle-kit cannot express RLS in the Drizzle schema — re-add after any
-- regeneration of this file; same convention as 0001's foot).
--
-- RLS IS ENABLED HERE, AT CREATE TIME, NOT LATER BY policies.sql / THE PROD-PASTE. Without it both
-- tables would sit with RLS DISABLED for the whole window between `db:migrate` and the manual paste,
-- and any SELECT-granted non-owner role — including Supabase `anon`/`authenticated` on `public` —
-- could read them. For these two tables that window is worse than for a fact table: the directory is
-- the complete roster of every GES oversight officer with their tier and work email, and the
-- provisioning log is the complete history of who granted national access to whom.
--
-- WHAT THE SKIP-THE-PASTE STATE IS. RLS-enabled-with-no-policy ⇒ ZERO rows to a non-owner role.
-- For `audit_officer_provisioning` that is the steady state anyway (the app role must never read
-- it). For `ref_oversight_officer` it means the no-policy table is unreadable by direct SELECT and
-- the ONLY read path is the SECURITY DEFINER `ov_resolve_officer()` installed by policies.sql /
-- db/sql/prod-paste-0005-officer-directory.sql. So a missed paste on prod does not leak a roster —
-- it means NO OFFICER CAN SIGN IN AT ALL (the bootstrap read has no function to call). That is a
-- total, instantly-obvious outage rather than a quiet leak, which is the right way round. Note it is
-- a louder failure than the empty-panel signature §2a describes for fact tables: expect
-- "function ov_resolve_officer(uuid) does not exist", not an empty screen.
--
-- Deliberately ENABLE, never FORCE: the provisioner / owner connection writes both tables, and FORCE
-- would subject the owner to policies that are written to admit nobody. Idempotent — policies.sql
-- and the prod-paste both re-issue these two statements.
-- ---------------------------------------------------------------------------
ALTER TABLE "ref_oversight_officer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_officer_provisioning" ENABLE ROW LEVEL SECURITY;