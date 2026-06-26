import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { desc, eq, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { conversations, users } from "@/db/schema";
import { NewConversationForm } from "@/components/inbox/new-conversation-form";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

const when = (d: Date) =>
  new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export default async function InboxPage() {
  const { school } = await requireSchool();

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
            {open} open · two-way SMS conversations with parents.
          </p>
        </div>
        <NewConversationForm />
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
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/inbox/${r.id}`}
              className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-bg"
            >
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  r.status === "OPEN" ? "bg-green" : "bg-border-2"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium text-navy">
                    {r.contactName ?? r.contactPhone}
                    {r.subject ? (
                      <span className="font-normal text-navy-3"> · {r.subject}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-navy-3">
                    {when(r.lastMessageAt)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm text-navy-3">
                  {r.lastDir === "INBOUND" ? "↩ " : "→ "}
                  {r.lastBody ?? "—"}
                </p>
              </div>
              {r.assignedName && (
                <span className="shrink-0 rounded-pill bg-gold-bg px-2 py-0.5 text-xs font-medium text-navy">
                  {r.assignedName.split(" ")[0]}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
