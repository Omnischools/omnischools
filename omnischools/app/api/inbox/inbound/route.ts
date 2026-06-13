import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/lib/env";
import { withSchool } from "@/lib/db/rls";
import { normalizeGhanaPhone } from "@/lib/auth";
import { conversations, inboxMessages } from "@/db/schema";

/**
 * Inbound message webhook (portability pattern): an SMS/WhatsApp provider POSTs a
 * received reply here. Guarded by a shared secret header — no user session. The
 * payload carries the schoolId (the integration knows which school's number got the
 * message). Appends to the open thread for that phone, or starts one.
 */
const Body = z.object({
  schoolId: z.string().uuid(),
  phone: z.string().min(7),
  message: z.string().min(1).max(2000),
  name: z.string().max(120).optional(),
});

export async function POST(request: Request) {
  const secret = request.headers.get("x-inbound-secret");
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid payload" }, { status: 400 });
  }
  const { schoolId, message } = parsed.data;
  const phone = normalizeGhanaPhone(parsed.data.phone);

  try {
    const conversationId = await withSchool(schoolId, async (tx) => {
      const [existing] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.schoolId, schoolId),
            eq(conversations.contactPhone, phone),
            eq(conversations.status, "OPEN"),
          ),
        )
        .orderBy(desc(conversations.lastMessageAt))
        .limit(1);

      let id = existing?.id;
      if (!id) {
        const [c] = await tx
          .insert(conversations)
          .values({
            schoolId,
            contactPhone: phone,
            contactName: parsed.data.name ?? null,
            status: "OPEN",
          })
          .returning({ id: conversations.id });
        id = c.id;
      } else {
        await tx
          .update(conversations)
          .set({ lastMessageAt: new Date(), status: "OPEN" })
          .where(eq(conversations.id, id));
      }

      await tx.insert(inboxMessages).values({
        schoolId,
        conversationId: id,
        direction: "INBOUND",
        body: message,
      });
      return id;
    });

    return NextResponse.json({ ok: true, conversationId });
  } catch {
    return NextResponse.json({ ok: false, error: "could not record" }, { status: 500 });
  }
}
