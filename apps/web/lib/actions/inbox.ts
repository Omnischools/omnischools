"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { recordAudit } from "@/lib/db/audit";
import { normalizeGhanaPhone } from "@/lib/auth";
import { sendSms } from "@/lib/sms";
import { safeRevalidate } from "@/lib/revalidate";
import { conversations, inboxMessages } from "@/db/schema";

type Result = { ok: boolean; error?: string; id?: string };

const StartSchema = z.object({
  contactPhone: z.string().min(7, "Enter a valid phone number"),
  contactName: z.string().max(120).optional().nullable(),
  studentId: z.string().uuid().optional().nullable(),
  subject: z.string().max(140).optional().nullable(),
  body: z.string().min(1, "Enter a message").max(1000),
});

export async function startConversation(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = StartSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const phone = normalizeGhanaPhone(d.contactPhone);
  const actor = await resolveActor(school.id);
  try {
    const now = new Date();
    const id = await withSchool(school.id, async (tx) => {
      const [c] = await tx
        .insert(conversations)
        .values({
          schoolId: school.id,
          contactPhone: phone,
          contactName: d.contactName?.trim() || null,
          studentId: d.studentId || null,
          subject: d.subject?.trim() || null,
          status: "OPEN",
          assignedToUserId: actor.id ?? undefined,
          // Staff started this thread, so it's already "read" by them — stamp both to the
          // same instant so the unread test (last_message_at > read_at) is false.
          lastMessageAt: now,
          readAt: now,
        })
        .returning({ id: conversations.id });
      await tx.insert(inboxMessages).values({
        schoolId: school.id,
        conversationId: c.id,
        direction: "OUTBOUND",
        body: d.body.trim(),
        sentByUserId: actor.id ?? undefined,
      });
      return c.id;
    });
    await sendSms(phone, d.body.trim());
    safeRevalidate("/inbox");
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Could not start the conversation." };
  }
}

const ReplySchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().min(1, "Enter a reply").max(1000),
});

export async function sendReply(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = ReplySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const actor = await resolveActor(school.id);
  try {
    const phone = await withSchool(school.id, async (tx) => {
      const [c] = await tx
        .select({ phone: conversations.contactPhone })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, parsed.data.conversationId),
            eq(conversations.schoolId, school.id),
          ),
        );
      if (!c) throw new Error("not found");
      await tx.insert(inboxMessages).values({
        schoolId: school.id,
        conversationId: parsed.data.conversationId,
        direction: "OUTBOUND",
        body: parsed.data.body.trim(),
        sentByUserId: actor.id ?? undefined,
      });
      const now = new Date();
      await tx
        .update(conversations)
        // Replying implies the staffer has read the thread — keep read_at == last_message_at.
        .set({ lastMessageAt: now, readAt: now, status: "OPEN" })
        .where(eq(conversations.id, parsed.data.conversationId));
      return c.phone;
    });
    await sendSms(phone, parsed.data.body.trim());
    safeRevalidate(`/inbox/${parsed.data.conversationId}`);
    safeRevalidate("/inbox");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not send the reply." };
  }
}

const AssignSchema = z.object({
  conversationId: z.string().uuid(),
  userId: z.string().optional().nullable(),
});

export async function assignConversation(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = AssignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = parsed.data.userId?.trim() || null;
  try {
    await withSchool(school.id, (tx) =>
      tx
        .update(conversations)
        .set({ assignedToUserId: userId })
        .where(
          and(
            eq(conversations.id, parsed.data.conversationId),
            eq(conversations.schoolId, school.id),
          ),
        ),
    );
    safeRevalidate(`/inbox/${parsed.data.conversationId}`);
    safeRevalidate("/inbox");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not assign." };
  }
}

const StatusSchema = z.object({
  conversationId: z.string().uuid(),
  status: z.enum(["OPEN", "CLOSED"]),
});

export async function setConversationStatus(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = StatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try {
    await withSchool(school.id, (tx) =>
      tx
        .update(conversations)
        .set({ status: parsed.data.status })
        .where(
          and(
            eq(conversations.id, parsed.data.conversationId),
            eq(conversations.schoolId, school.id),
          ),
        ),
    );
    safeRevalidate(`/inbox/${parsed.data.conversationId}`);
    safeRevalidate("/inbox");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update status." };
  }
}

// ------------------------------------------------------- reassign (with handoff)
const ReassignSchema = z.object({
  conversationId: z.string().uuid(),
  toUserId: z.string().uuid().optional().or(z.literal("")), // "" = leave unassigned
  handoffNote: z.string().max(600).optional().or(z.literal("")),
});

/**
 * Reassign a thread to a colleague with an optional handoff note. This is an explicit
 * human hand-off, so it clears the auto-route provenance and is written to the audit
 * log (the note is the reason). Never silently overwrites without a trail.
 */
export async function reassignConversation(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = ReassignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const toUserId = parsed.data.toUserId?.trim() || null;
  const note = parsed.data.handoffNote?.trim() || null;
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await tx
        .update(conversations)
        .set({ assignedToUserId: toUserId, routedByRuleId: null, routedByRuleName: null })
        .where(
          and(
            eq(conversations.id, parsed.data.conversationId),
            eq(conversations.schoolId, school.id),
          ),
        );
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "reassigned",
        entityType: "conversation",
        entityId: parsed.data.conversationId,
        after: { assignedToUserId: toUserId },
        reason: note ?? "Thread reassigned",
      });
    });
    safeRevalidate(`/inbox/${parsed.data.conversationId}`);
    safeRevalidate("/inbox");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reassign." };
  }
}
