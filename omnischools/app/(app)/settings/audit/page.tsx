import Link from "next/link";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { ScrollText } from "lucide-react";
import { auditLog, users } from "@/db/schema";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState } from "@/components/ui/empty-state";
import { AuditActivityFeed } from "@/components/settings/audit-activity-feed";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

const ACTION_TONE: Record<string, string> = {
  created: "bg-green-bg text-green",
  updated: "bg-gold-bg text-gold",
  deleted: "bg-terra-bg text-terra",
  voided: "bg-terra-bg text-terra",
};

const title = (s?: string | null) =>
  s ? s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ") : "—";

function when(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(
    date.getHours(),
  )}:${p(date.getMinutes())}`;
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: { entity?: string };
}) {
  const { school } = await requireSchool();
  const entity = searchParams.entity;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const data = await withSchool(school.id, async (tx) => {
    // §01 feed — today's events, newest first.
    const todayEvents = await tx
      .select({
        id: auditLog.auditId,
        occurredAt: auditLog.occurredAt,
        actorName: users.fullName,
        actorRole: auditLog.actorRole,
        actionType: auditLog.actionType,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        reason: auditLog.reason,
        before: auditLog.beforeState,
        after: auditLog.afterState,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.actorUserId, users.id))
      .where(and(eq(auditLog.schoolId, school.id), gte(auditLog.occurredAt, startOfToday)))
      .orderBy(desc(auditLog.occurredAt))
      .limit(60);
    const kinds = await tx
      .select({ entityType: auditLog.entityType, n: sql<number>`count(*)` })
      .from(auditLog)
      .where(eq(auditLog.schoolId, school.id))
      .groupBy(auditLog.entityType)
      .orderBy(desc(sql`count(*)`));
    const rows = await tx
      .select({
        auditId: auditLog.auditId,
        occurredAt: auditLog.occurredAt,
        actorRole: auditLog.actorRole,
        actorName: users.fullName,
        actionType: auditLog.actionType,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        reason: auditLog.reason,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.actorUserId, users.id))
      .where(
        entity
          ? and(eq(auditLog.schoolId, school.id), eq(auditLog.entityType, entity))
          : eq(auditLog.schoolId, school.id),
      )
      .orderBy(desc(auditLog.occurredAt))
      .limit(200);
    return { kinds, rows, todayEvents };
  });

  const dayLabel = `Today · ${startOfToday.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })}`;

  const chip = (label: string, value: string | null, count?: number) => {
    const active = (value ?? undefined) === entity || (!value && !entity);
    const href = value ? `/settings/audit?entity=${value}` : "/settings/audit";
    return (
      <Link
        key={value ?? "all"}
        href={href}
        className={`rounded-pill px-3 py-1 text-xs font-semibold ${
          active ? "bg-navy text-bg" : "bg-bg text-navy-3 hover:bg-gold-bg"
        }`}
      >
        {label}
        {count != null && <span className="ml-1 opacity-70">{count}</span>}
      </Link>
    );
  };

  return (
    <div className="mx-auto max-w-page">
      <BackLink href="/settings" label="Settings" />
      <div className="mb-5 mt-2">
        <h1 className="font-display text-3xl font-semibold text-navy">
          Audit <em className="not-italic text-gold [font-style:italic]">log.</em>
        </h1>
        <p className="text-sm text-navy-3">
          Every action by every user, recorded as it happens — append-only: entries
          can&apos;t be edited or deleted.
        </p>
      </div>

      {/* Section 01 — Today's activity feed (surface §01) */}
      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <span className="font-display text-xl font-semibold italic text-gold">01</span>
          <h2 className="font-display text-lg font-semibold text-navy">
            Today&apos;s{" "}
            <em className="not-italic text-gold [font-style:italic]">activity</em> · most
            recent first
          </h2>
          <span className="ml-auto text-[11px] uppercase tracking-wide text-navy-3">
            {data.todayEvents.length} today
          </span>
        </div>
        <AuditActivityFeed events={data.todayEvents} dayLabel={dayLabel} />
      </section>

      {/* Section 02 — Full log (the existing table) */}
      <section>
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <span className="font-display text-xl font-semibold italic text-gold">02</span>
          <h2 className="font-display text-lg font-semibold text-navy">Full log</h2>
          <span className="ml-auto text-[11px] uppercase tracking-wide text-navy-3">
            latest {data.rows.length}
            {entity ? ` · ${title(entity)}` : ""}
          </span>
        </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {chip("All", null)}
        {data.kinds.map((k) => chip(title(k.entityType), k.entityType, Number(k.n)))}
      </div>

      {data.rows.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-5 w-5" />}
          title="No audit events yet."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-4 py-2.5 font-semibold">When</th>
                <th className="px-4 py-2.5 font-semibold">Who</th>
                <th className="px-4 py-2.5 font-semibold">Action</th>
                <th className="px-4 py-2.5 font-semibold">Entity</th>
                <th className="px-4 py-2.5 font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((r) => (
                <tr key={r.auditId} className="align-top hover:bg-bg">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-navy-2">
                    {when(r.occurredAt)}
                  </td>
                  <td className="px-4 py-2.5 text-navy-2">
                    {r.actorName ?? title(r.actorRole) ?? "System"}
                    {r.actorName && r.actorRole && (
                      <span className="text-navy-3"> · {title(r.actorRole)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-pill px-2 py-0.5 text-xs font-medium ${
                        ACTION_TONE[r.actionType] ?? "bg-bg text-navy-3"
                      }`}
                    >
                      {title(r.actionType)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-navy-2">
                    {title(r.entityType)}
                    {r.entityId && (
                      <span className="ml-1 font-mono text-[10px] text-navy-3">
                        {r.entityId.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-navy-3">{r.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </section>
    </div>
  );
}
