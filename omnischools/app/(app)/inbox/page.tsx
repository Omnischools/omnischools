import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { desc, eq, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { conversations, users } from "@/db/schema";
import { NewConversationForm } from "@/components/inbox/new-conversation-form";
import { InboxBrowser } from "@/components/inbox/inbox-browser";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const { user, school } = await requireSchool();

  const rows = await withSchool(school.id, (tx) =>
    tx
      .select({
        id: conversations.id,
        contactName: conversations.contactName,
        contactPhone: conversations.contactPhone,
        subject: conversations.subject,
        status: conversations.status,
        lastMessageAt: conversations.lastMessageAt,
        assignedName: users.fullName,
        assignedToUserId: conversations.assignedToUserId,
        channel: conversations.channel,
        topic: conversations.topic,
        routedByRuleName: conversations.routedByRuleName,
        unread: sql<boolean>`(${conversations.readAt} is null or ${conversations.lastMessageAt} > ${conversations.readAt})`,
        lastBody: sql<
          string | null
        >`(select body from inbox_message m where m.conversation_id = ${conversations.id} order by m.created_at desc limit 1)`,
        lastDir: sql<
          string | null
        >`(select direction from inbox_message m where m.conversation_id = ${conversations.id} order by m.created_at desc limit 1)`,
      })
      .from(conversations)
      .leftJoin(users, eq(conversations.assignedToUserId, users.id))
      .where(eq(conversations.schoolId, school.id))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(200),
  );

  const open = rows.filter((r) => r.status === "OPEN").length;
  const unread = rows.filter((r) => r.unread && r.status === "OPEN").length;

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
            Omnischools · Inbox
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
            When parents <em className="text-gold">reply</em>
          </h1>
          <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
          <p className="max-w-2xl text-sm text-navy-3">
            {open} open
            {unread > 0 ? (
              <>
                {" · "}
                <span className="font-semibold text-navy">{unread} unread</span>
              </>
            ) : null}{" "}
            · two-way SMS conversations with parents.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <Link
            href="/settings/inbox/routing"
            className="text-sm font-semibold text-gold hover:underline"
          >
            Routing rules →
          </Link>
          <NewConversationForm />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="h-5 w-5" />}
          title="No conversations yet."
          body={
            <>
              Start a message to a parent, or wire your SMS provider’s webhook to{" "}
              <code className="font-mono text-xs">/api/inbox/inbound</code> so replies land
              here.
            </>
          }
        />
      ) : (
        <InboxBrowser rows={rows} currentUserId={user.id} />
      )}
    </div>
  );
}
