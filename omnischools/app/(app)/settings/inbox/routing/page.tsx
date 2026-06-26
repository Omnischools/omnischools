import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { inboxRoutingRules } from "@/db/schema";
import { loadStaffOptions } from "@/lib/data/staff-options";
import { ensureFallback } from "@/lib/actions/inbox-routing";
import {
  InboxRoutingManager,
  type RuleRow,
} from "@/components/settings/inbox-routing-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox routing" };

export default async function InboxRoutingPage() {
  const { school } = await requireSchool();

  // Make sure the school has its single fallback row before we read the list.
  await ensureFallback();

  const [allRules, staff] = await Promise.all([
    withSchool(school.id, (tx) =>
      tx
        .select({
          id: inboxRoutingRules.id,
          name: inboxRoutingRules.name,
          position: inboxRoutingRules.position,
          enabled: inboxRoutingRules.enabled,
          isFallback: inboxRoutingRules.isFallback,
          matchTopic: inboxRoutingRules.matchTopic,
          matchClass: inboxRoutingRules.matchClass,
          matchKeywords: inboxRoutingRules.matchKeywords,
          assignToUserId: inboxRoutingRules.assignToUserId,
          notifyAllAdmins: inboxRoutingRules.notifyAllAdmins,
        })
        .from(inboxRoutingRules)
        .where(eq(inboxRoutingRules.schoolId, school.id))
        .orderBy(asc(inboxRoutingRules.isFallback), asc(inboxRoutingRules.position)),
    ),
    loadStaffOptions(school.id),
  ]);

  const rules: RuleRow[] = allRules.filter((r) => !r.isFallback);
  const fallback: RuleRow | null = allRules.find((r) => r.isFallback) ?? null;

  return (
    <div className="mx-auto max-w-page">
      <div className="text-xs uppercase tracking-wide text-navy-3">
        <Link href="/settings" className="font-semibold text-gold hover:underline">
          Settings
        </Link>{" "}
        / Inbox routing
      </div>

      {/* Header — black & gold hero */}
      <div className="mb-6 mt-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Omnischools · Inbox
        </div>
        <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
          Routing <em className="text-gold">rules</em>
        </h1>
        <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
        <p className="max-w-2xl text-sm text-navy-3">
          When a parent messages, these rules decide who handles it — evaluated top to
          bottom, first match wins; the fallback catches the rest.
        </p>
      </div>

      <InboxRoutingManager rules={rules} fallback={fallback} staff={staff} />
    </div>
  );
}
