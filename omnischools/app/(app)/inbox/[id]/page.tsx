import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { conversations, inboxMessages, students, users } from "@/db/schema";
import { loadStaffOptions } from "@/lib/data/staff-options";
import { topicLabel } from "@/lib/inbox/topics";
import { ReplyBox } from "@/components/inbox/reply-box";
import { ConversationControls } from "@/components/inbox/conversation-controls";
import { ReassignDrawer } from "@/components/inbox/reassign-drawer";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";

const when = (d: Date) =>
  new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Topic chip colours — solid tokens / -bg tints / bordered neutrals only. */
function topicChipClass(topic: string): string {
  switch (topic) {
    case "URGENT":
      return "bg-terra text-bg";
    case "BILLING":
      return "bg-gold-bg text-gold";
    case "ACADEMIC":
      return "bg-green-bg text-green";
    case "ATTENDANCE":
    case "SCHEDULE":
      return "bg-bg text-navy-2 border border-border-2";
    default:
      return "bg-bg text-navy-3";
  }
}

export default async function ConversationPage({ params }: { params: { id: string } }) {
  const { user, school } = await requireSchool();
  const id = params.id;

  const [conv] = await withSchool(school.id, (tx) =>
    tx
      .select({
        id: conversations.id,
        contactName: conversations.contactName,
        contactPhone: conversations.contactPhone,
        subject: conversations.subject,
        status: conversations.status,
        assignedToUserId: conversations.assignedToUserId,
        assignedName: users.fullName,
        topic: conversations.topic,
        routedByRuleName: conversations.routedByRuleName,
        studentFirst: students.firstName,
        studentLast: students.lastName,
        studentClass: students.currentClassLabel,
      })
      .from(conversations)
      .leftJoin(students, eq(conversations.studentId, students.id))
      .leftJoin(users, eq(conversations.assignedToUserId, users.id))
      .where(and(eq(conversations.id, id), eq(conversations.schoolId, school.id))),
  );
  if (!conv) notFound();
  const studentName = conv.studentFirst
    ? `${conv.studentFirst} ${conv.studentLast ?? ""}`.trim()
    : null;

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
        <BackLink href="/inbox" label="Inbox" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-navy">
              {conv.contactName ?? conv.contactPhone}
            </h1>
            {studentName && (
              <p className="text-sm text-navy-2">
                Guardian of <span className="font-medium text-navy">{studentName}</span>
                {conv.studentClass ? ` · ${conv.studentClass}` : ""}
              </p>
            )}
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

      {/* Assignment bar — who owns the thread, auto-route provenance, topic, reassign */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gold-soft bg-gold-bg px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-gold">
            Assigned to
          </div>
          <p className="mt-0.5 text-sm">
            <span className="font-semibold text-navy">
              {conv.assignedName ?? "Unassigned"}
            </span>
            {conv.assignedToUserId === user.id ? (
              <span className="text-navy-3"> · you</span>
            ) : null}
            {conv.routedByRuleName ? (
              <span className="italic text-navy-3">
                {" "}
                · auto-routed by{" "}
                <span className="font-medium not-italic text-navy-2">
                  {conv.routedByRuleName}
                </span>
              </span>
            ) : null}
          </p>
        </div>
        {conv.topic ? (
          <span
            className={`rounded-pill px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] ${topicChipClass(
              conv.topic,
            )}`}
          >
            {topicLabel(conv.topic)}
          </span>
        ) : null}
        <ReassignDrawer
          conversationId={conv.id}
          currentAssigneeName={conv.assignedName}
          staff={staff}
          currentUserId={user.id}
        />
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
