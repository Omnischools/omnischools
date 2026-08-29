import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { withParentScope } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { conversations, inboxMessages } from "@/db/schema";

/**
 * 🔴 INCR-COMM · the PARENT-facing Communications (2-way messages) READER (SHS module 4.3 · Kofi
 * AC-COMM-01..05, Lucy §9). SERVER-ONLY — imports the db driver, so a client component must never import
 * it (only `pnpm build` catches that leak; the parent-*-data precedent).
 *
 * RLS is ROW-level and CANNOT mask a column, so THIS PROJECTION is the ONLY column guard. `conversation` +
 * `inbox_message` carry `parent_scope` (own child + own phone), so the parent already reads only their own
 * threads — but the SAFE KEY-SET is enforced HERE by selecting ONLY the parent-facing fields. NEVER select
 * (the deny-list, Lucy §9 / Kofi R-COMM-5): `assigned_to_user_id` (staff routing PII), `routed_by_rule_id`
 * / `routed_by_rule_name` / `topic` (system routing provenance), `read_at` (STAFF read-state — leaking it
 * tells the parent whether staff opened it), the raw `sent_by_user_id` UUID, `channel` / any cost/segment
 * provenance (that lives on `notification_log`, which stays parent_deny). `direction` is mapped to the
 * sender SIDE ("school" / "you") — never the raw "outbound/inbound" admin vocabulary. Staff NAMES are not
 * read at all (an OUTBOUND message is labelled by the school, keeping this reader off the `users` table).
 *
 * Scope by the parent's OWN stored phone (`contact_phone = guardianPhone`), NOT by student — a child with
 * two guardians has two phone-keyed threads, so scoping by student would leak the co-guardian's thread
 * (RLS already fences this; the explicit phone predicate is the matching belt).
 */

export type ParentCommsMessage = {
  sender: "school" | "you"; // OUTBOUND → school, INBOUND → you (never the raw admin direction)
  body: string;
  createdAt: Date;
};

export type ParentComms = {
  messages: ParentCommsMessage[]; // ONE merged stream, chronological (ascending)
  total: number;
  repliedByYou: number; // count of the parent's own (INBOUND) messages
  lastMessageAt: Date | null;
};

/** A raw message row as read from `inbox_message` (the only three parent-facing columns). */
export type CommsRow = { direction: string; body: string; createdAt: Date };

/** PURE — map the safe rows (already ordered ascending) into the parent stream. No db, unit-tested. */
export function buildParentComms(rows: CommsRow[]): ParentComms {
  const messages: ParentCommsMessage[] = rows.map((r) => ({
    sender: r.direction === "OUTBOUND" ? "school" : "you",
    body: r.body,
    createdAt: r.createdAt,
  }));
  return {
    messages,
    total: messages.length,
    repliedByYou: messages.filter((m) => m.sender === "you").length,
    lastMessageAt: messages.length ? messages[messages.length - 1].createdAt : null,
  };
}

/** MUST run on a `tx` already scoped by `withParentScope`. */
export async function loadParentCommsTx(
  tx: Tx,
  schoolId: string,
  guardianPhone: string,
): Promise<ParentComms> {
  // The parent's own threads (RLS additionally fences to own child + own phone). Belt: own phone only.
  const convs = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.schoolId, schoolId), eq(conversations.contactPhone, guardianPhone)));
  if (convs.length === 0) return buildParentComms([]);

  // Safe key-set ONLY: direction/body/created_at. Merge every own-thread's messages into one stream.
  const rows = await tx
    .select({
      direction: inboxMessages.direction,
      body: inboxMessages.body,
      createdAt: inboxMessages.createdAt,
    })
    .from(inboxMessages)
    .where(
      and(
        eq(inboxMessages.schoolId, schoolId),
        inArray(
          inboxMessages.conversationId,
          convs.map((c) => c.id),
        ),
      ),
    )
    .orderBy(asc(inboxMessages.createdAt));

  return buildParentComms(rows);
}

/** Entry point — the parent's message stream under `withParentScope` (never `withSchool`). */
export async function loadParentComms(
  schoolId: string,
  userId: string,
  guardianPhone: string | null,
): Promise<ParentComms> {
  if (!guardianPhone) return buildParentComms([]); // no stored phone → no threads (honest empty)
  return withParentScope(schoolId, userId, (tx) => loadParentCommsTx(tx, schoolId, guardianPhone));
}
