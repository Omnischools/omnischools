import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { conversations, inboxMessages } from "@/db/schema";
import { loadStaffOptions } from "@/lib/data/staff-options";
import { ReplyBox } from "@/components/inbox/reply-box";
import { ConversationControls } from "@/components/inbox/conversation-controls";

export const dynamic = "force-dynamic";

const when = (d: Date) =>
  new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export default async function ConversationPage({ params }: { params: { id: string } }) {
  const { school } = await requireSchool();
  const id = params.id;

  const [conv] = await withSchool(school.id, (tx) =>
    tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.schoolId, school.id))),
  );
  if (!conv) notFound();

  const [messages, staff] = await Promise.all([
    withSchool(school.id, (tx) =>
      tx
        .select()
        .from(inboxMessages)
        .where(
          and(
            eq(inboxMessages.conversationId, id),
            eq(inboxMessages.schoolId, school.id),
          ),
        )
        .orderBy(asc(inboxMessages.createdAt)),
    ),
    loadStaffOptions(school.id),
  ]);

  return (
    <div className="mx-auto flex max-w-prose flex-col gap-4">
      <div>
        <Link href="/inbox" className="text-sm text-navy-3 hover:text-gold">
          ← Inbox
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-navy">
              {conv.contactName ?? conv.contactPhone}
            </h1>
            <p className="text-sm text-navy-3">
              {conv.contactPhone}
              {conv.subject ? ` · ${conv.subject}` : ""} ·{" "}
              <span className={conv.status === "OPEN" ? "text-green" : "text-navy-3"}>
                {conv.status === "OPEN" ? "Open" : "Closed"}
              </span>
            </p>
          </div>
          <ConversationControls
            conversationId={conv.id}
            status={conv.status}
            assignedTo={conv.assignedToUserId}
            staff={staff}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
        {messages.map((m) => {
          const outbound = m.direction === "OUTBOUND";
          return (
            <div
              key={m.id}
              className={`flex flex-col ${outbound ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                  outbound
                    ? "rounded-br-sm bg-navy text-bg"
                    : "rounded-bl-sm bg-bg text-navy"
                }`}
              >
                {m.body}
              </div>
              <span className="mt-1 px-1 text-[11px] text-navy-3">
                {outbound ? "Sent" : "Received"} · {when(m.createdAt)}
              </span>
            </div>
          );
        })}
      </div>

      <ReplyBox conversationId={conv.id} />
    </div>
  );
}
