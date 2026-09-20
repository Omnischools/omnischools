-- Omnischools — migration 0034: inbox unread tracking. Adds conversation.read_at so the
-- inbox can flag threads a staffer hasn't opened (UNREAD when read_at IS NULL OR
-- last_message_at > read_at). Idempotent — safe to run more than once. Paste into the
-- Supabase SQL editor on PROD after merging.
--
-- No RLS changes: this only adds a column to the existing "conversation" table, which is
-- already tenant-isolated (its RLS was pasted with migration 0031). A new column is
-- covered by the table's existing policies — nothing to enable here.

ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "read_at" timestamptz;
