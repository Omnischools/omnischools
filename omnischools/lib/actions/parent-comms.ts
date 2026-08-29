"use server";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { requireParent } from "@/lib/auth/server";
import { withParentScope } from "@/lib/db/rls";
import { loadParentPortal } from "@/lib/parent/parent-portal-data";
import { safeRevalidate } from "@/lib/revalidate";
import { conversations, inboxMessages } from "@/db/schema";

/**
 * 🔴 INCR-COMM · the parent Communications WRITE — the FIRST and ONLY sanctioned parent write path in the
 * portal (Kofi R-COMM-1/2, Lucy §6). A parent posts an in-app message to their school. Deliberately NOT the
 * staff `sendReply`/`startConversation` path (which call `sendSms`): this is the in-app equivalent of the
 * inbound webhook — direction=INBOUND, ZERO SMS/gateway (SMS stays deferred).
 *
 * Trust boundary (belt = server-forcing, braces = Wells's RLS WITH CHECK, prod-paste-0094):
 *  • `direction` is SERVER-FORCED to "INBOUND"; a parent can never author an OUTBOUND "from the school"
 *    message (the RLS WITH CHECK independently rejects a forged OUTBOUND).
 *  • `sent_by_user_id` is SERVER-FORCED to the session parent's id (the WITH CHECK requires
 *    sent_by_user_id = app.current_parent_user, so a forged sender is DB-rejected too).
 *  • the thread is RESOLVED from the session (child + the parent's OWN stored phone) — the client supplies
 *    ONLY `body`, never a conversation id / phone / child (so a parent can't name an arbitrary thread).
 *  • `read_at` is left UNTOUCHED so the parent's message correctly marks the thread UNREAD for staff.
 *  • runs under `withParentScope` ONLY. No `sendSms`. No staff-field mutation (assigned/routing/topic).
 */

const Schema = z.object({ body: z.string().min(1, "Enter a message").max(1000, "Message is too long") });

type Result = { ok: boolean; error?: string };

const DUP_WINDOW_MS = 60_000; // ignore an identical resend within 60s (double-tap / retry guard, AC-COMM-14)

export async function sendParentMessage(input: unknown): Promise<Result> {
  const { user, school } = await requireParent();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid message" };
  const body = parsed.data.body.trim();
  if (!body) return { ok: false, error: "Enter a message" };

  const portal = await loadParentPortal(school.id, user.id);
  const child = portal.children[0] ?? null;
  const phone = portal.guardianPhone;
  // A thread is keyed on the parent's OWN stored phone + their child; without either there is no scope to
  // write into (and the RLS own-child+own-phone WITH CHECK would reject the insert).
  if (!child || !phone) {
    return { ok: false, error: "We couldn't find your linked child. Please contact the school office." };
  }

  try {
    await withParentScope(school.id, user.id, async (tx) => {
      // Find the parent's own most-recent thread (RLS fences to own child + own phone); else start one.
      const [existing] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.schoolId, school.id), eq(conversations.contactPhone, phone)))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(1);

      const isReply = existing != null;
      let conversationId = existing?.id;
      const now = new Date();

      if (!conversationId) {
        // Start a thread — every column is server-forced; the RLS WITH CHECK also pins it to own-child +
        // own-phone (OC-COMM-NEWTHREAD: parent-initiated threads are enabled). NO read_at (→ unread to staff).
        const [created] = await tx
          .insert(conversations)
          .values({
            schoolId: school.id,
            contactPhone: phone,
            studentId: child.studentId,
            status: "OPEN",
            lastMessageAt: now,
          })
          .returning({ id: conversations.id });
        conversationId = created.id;
      } else {
        // Duplicate-submit guard — an identical INBOUND body to the same thread within the window is a no-op.
        const [dup] = await tx
          .select({ id: inboxMessages.id })
          .from(inboxMessages)
          .where(
            and(
              eq(inboxMessages.schoolId, school.id),
              eq(inboxMessages.conversationId, conversationId),
              eq(inboxMessages.direction, "INBOUND"),
              eq(inboxMessages.body, body),
              gt(inboxMessages.createdAt, new Date(now.getTime() - DUP_WINDOW_MS)),
            ),
          )
          .limit(1);
        if (dup) return; // idempotent: no second row, no second bump
      }

      // The one parent write — direction + sender SERVER-FORCED (and RLS-checked).
      await tx.insert(inboxMessages).values({
        schoolId: school.id,
        conversationId,
        direction: "INBOUND",
        body,
        sentByUserId: user.id,
      });
      // Bump activity so the thread surfaces as unread to staff + reopen a CLOSED thread (OC-COMM-REOPEN)
      // — via the scoped SECURITY DEFINER `parent_bump_conversation`. A DIRECT parent UPDATE is denied by
      // `parent_no_update` (INSERT+SELECT-only seam), so the bump must go through the fn, which is
      // own-child+own-phone scoped and touches ONLY last_message_at + status (never read_at/assigned/topic).
      // A freshly-created thread already carries now()+OPEN from its INSERT, so only a reply needs the bump.
      if (isReply) {
        await tx.execute(sql`select parent_bump_conversation(${conversationId}::uuid)`);
      }
    });
  } catch {
    return { ok: false, error: "Couldn't send your message. Please try again." };
  }

  safeRevalidate("/messages");
  return { ok: true };
}
