-- Omnischools — migration 0036 (parent-receipt branch): receipt.public_token. An unguessable
-- token for the parent-facing SMS receipt link (/r/{token}); access to the PDF is further
-- gated by the student code. Idempotent — safe to run more than once. Paste into the Supabase
-- SQL editor on PROD after merging. (Numbering note: the student-health PR is also 0036 — the
-- two are independent; run both pastes. Only the drizzle journal collides at merge, not prod.)
--
-- No RLS changes: this only adds a column to the existing "receipt" table, which is already
-- tenant-scoped. New columns are covered by the table's existing policies. (The public parent
-- flow reads it via a token lookup that bypasses tenant scope server-side — never the Data API.)

ALTER TABLE "receipt" ADD COLUMN IF NOT EXISTS "public_token" text;

DO $$ BEGIN
  ALTER TABLE "receipt" ADD CONSTRAINT "receipt_public_token_unique" UNIQUE ("public_token");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
