-- ---------------------------------------------------------------------------
-- HAND-APPENDED COMMENTARY ONLY (no statement added, removed or reordered — the seven statements
-- below are drizzle-kit output verbatim). Two hazards are load-bearing here; re-add these notes if
-- this file is ever regenerated.
--
-- 1 · `ALTER TYPE ... ADD VALUE` (line below) is legal inside a transaction block on PG 12+, but
--     the new value CANNOT BE USED in the same transaction — Postgres raises
--     `ERROR: unsafe use of new value "STAFF" of enum type record_type`. drizzle-kit runs each
--     migration file in one transaction, so nothing later in THIS file may mention 'STAFF':
--     no column default, no CHECK, no backfill. Verified: it does not. If a future change needs to
--     write 'STAFF' (e.g. a default or a data fix), it must go in a SEPARATE, LATER migration.
--     Note the two CREATE TYPEs are safe to use immediately — the restriction applies only to
--     values added to a PRE-EXISTING type, not to a type created in the same transaction.
--
-- 2 · PRECONDITION: `ADD COLUMN ... NOT NULL` with NO DEFAULT fails if audit_access_log already has
--     rows. That is intentional. The correct backfill for a pre-existing audit row does not exist:
--     stamping legal_basis = 'STATUTORY' onto accesses made before the column existed would
--     FABRICATE a legal claim about them, which is precisely what this table is supposed to make
--     impossible. Before applying to prod, run:
--         select count(*) from audit_access_log;
--     Expected 0 (the §6 named-record surface is not live). If it is non-zero, STOP and get an
--     explicit classification decision for the legacy rows — do not add a default to make it pass.
--
-- RLS: audit_access_log already has RLS enabled with audit_scope / audit_insert policies and the
-- append-only trigger (db/sql/policies.sql). Adding columns changes none of them — a policy with no
-- column list covers every column of the table, present and future — so there is NO prod-paste for
-- this migration. The migration SQL itself is still applied to prod by hand (PROVISIONING §2a.1).
-- ---------------------------------------------------------------------------
CREATE TYPE "public"."access_legal_basis" AS ENUM('STATUTORY', 'CONSENT');--> statement-breakpoint
CREATE TYPE "public"."access_outcome" AS ENUM('GRANTED', 'DENIED_NO_CONSENT', 'DENIED_STALE_ESTABLISHMENT', 'DENIED_FIELD_SCOPE');--> statement-breakpoint
ALTER TYPE "public"."record_type" ADD VALUE 'STAFF';--> statement-breakpoint
ALTER TABLE "audit_access_log" ADD COLUMN "legal_basis" "access_legal_basis" NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_access_log" ADD COLUMN "consent_ref" uuid;--> statement-breakpoint
ALTER TABLE "audit_access_log" ADD COLUMN "outcome" "access_outcome" NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_access_log" ADD COLUMN "staff_category" text;