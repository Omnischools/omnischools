"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { topicLabel } from "@/lib/inbox/topics";

export type InboxRow = {
  id: string;
  contactName: string | null;
  contactPhone: string;
  subject: string | null;
  status: "OPEN" | "CLOSED";
  lastMessageAt: Date;
  assignedName: string | null;
  assignedToUserId: string | null;
  channel: string;
  topic: string | null;
  routedByRuleName: string | null;
  lastBody: string | null;
  lastDir: string | null;
};

const when = (d: Date) =>
  new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Topic chip colours — solid tokens / -bg tints / bordered neutrals only (no slash-opacity). */
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
    default: // OTHER (or anything unmapped)
      return "bg-bg text-navy-3";
  }
}

type Bucket = "ALL" | "MINE" | "TEAM" | "UNASSIGNED" | "CLOSED";

const TAB_LABELS: Record<Bucket, string> = {
  ALL: "All",
  MINE: "Mine",
  TEAM: "Team",
  UNASSIGNED: "Unassigned",
  CLOSED: "Closed",
};

const TAB_ORDER: Bucket[] = ["ALL", "MINE", "TEAM", "UNASSIGNED", "CLOSED"];

function bucketOf(r: InboxRow, currentUserId: string): Exclude<Bucket, "ALL"> {
  if (r.status === "CLOSED") return "CLOSED";
  if (r.assignedToUserId == null) return "UNASSIGNED";
  return r.assignedToUserId === currentUserId ? "MINE" : "TEAM";
}

/**
 * Inbox list with ownership buckets (surface §01). Bucket tabs mirror the students-browser
 * tab pattern with live counts; each thread row carries a topic chip, a channel badge, an
 * assignee chip, and an "auto-routed" hint when the thread was routed by a rule.
 */
export function InboxBrowser({
  rows,
  currentUserId,
}: {
  rows: InboxRow[];
  currentUserId: string;
}) {
  const [active, setActive] = useState<Bucket>("ALL");

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = {
      ALL: rows.length,
      MINE: 0,
      TEAM: 0,
      UNASSIGNED: 0,
      CLOSED: 0,
    };
    for (const r of rows) c[bucketOf(r, currentUserId)]++;
    return c;
  }, [rows, currentUserId]);

  const filtered = useMemo(() => {
    if (active === "ALL") return rows;
    return rows.filter((r) => bucketOf(r, currentUserId) === active);
  }, [rows, active, currentUserId]);

  return (
    <div>
      {/* Bucket tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TAB_ORDER.map((b) => {
          const on = active === b;
          const isUnassigned = b === "UNASSIGNED";
          return (
            <button
              key={b}
              type="button"
              onClick={() => setActive(b)}
              className={`inline-flex items-center gap-2 rounded-pill border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                on
                  ? "border-navy bg-navy text-bg"
                  : "border-border-2 bg-surface text-navy-3 hover:bg-bg"
              }`}
            >
              {b === "MINE" && on ? (
                <em className="font-display not-italic text-gold [font-style:italic]">
                  Mine
                </em>
              ) : (
                TAB_LABELS[b]
              )}
              <span
                className={`rounded-pill px-1.5 py-0.5 text-[10px] font-bold ${
                  on
                    ? "bg-gold text-navy"
                    : isUnassigned && counts.UNASSIGNED > 0
                      ? "bg-warn-bg text-warn"
                      : "bg-bg text-navy-3"
                }`}
              >
                {counts[b]}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mb-3 text-xs text-navy-3">
        Showing <span className="font-semibold text-navy">{filtered.length}</span>{" "}
        {filtered.length === 1 ? "thread" : "threads"}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
          No threads in {TAB_LABELS[active]}.
        </p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {filtered.map((r) => {
            const mine =
              r.assignedToUserId != null && r.assignedToUserId === currentUserId;
            const colleague =
              r.assignedToUserId != null && r.assignedToUserId !== currentUserId;
            const topic = r.topic ?? "OTHER";
            const channelLabel = r.channel === "WHATSAPP" ? "WhatsApp" : "SMS";
            return (
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
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] ${topicChipClass(
                        topic,
                      )}`}
                    >
                      {topicLabel(topic)}
                    </span>
                    <span className="rounded-pill border border-border-2 bg-bg px-2 py-0.5 text-[10px] font-semibold text-navy-3">
                      {channelLabel}
                    </span>
                    {mine ? (
                      <span className="rounded-pill bg-green-bg px-2 py-0.5 text-[10px] font-bold text-green">
                        You
                      </span>
                    ) : colleague ? (
                      <span className="rounded-pill border border-border-2 bg-bg px-2 py-0.5 text-[10px] font-bold text-navy-2">
                        {firstName(r.assignedName ?? "—")}
                      </span>
                    ) : (
                      <span className="rounded-pill bg-terra-bg px-2 py-0.5 text-[10px] font-bold text-terra">
                        Unassigned
                      </span>
                    )}
                    {r.routedByRuleName ? (
                      <span className="text-[10px] italic text-navy-3">· auto-routed</span>
                    ) : null}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
