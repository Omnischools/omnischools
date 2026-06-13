"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { requireSchool, resolveActor } from "@/lib/auth/server";
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
      await tx
        .update(conversations)
        .set({ lastMessageAt: new Date(), status: "OPEN" })
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
