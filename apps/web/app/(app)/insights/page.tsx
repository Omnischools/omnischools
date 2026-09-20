import { requireSchoolRole } from "@/lib/auth/server";
import { INSIGHTS_READ_ROLES } from "@/lib/access";
import { getDirectorsInsights, buildAttention } from "@/lib/insights/insights-data";
import { ReportFilters } from "@/components/reports/report-filters";
import {
  SummaryStrip,
  AttentionPanel,
  FinanceTile,
  AttendanceTile,
  EnrolmentTile,
  PerformanceTile,
  InfrastructureTile,
} from "@/components/dashboard/insight-tiles";

/**
 * INS · Directors' Insights (`/insights`) — the acting director/admin's consolidated analytics
 * dashboard. It renders the SHARED aggregate dashboard tiles (`components/dashboard/insight-tiles.tsx`,
 * also behind `/board`) — the summary scan strip, a "Needs your attention" action panel (WITH links
 * here) and real AGGREGATE drill-ins (Performance/Attendance/Enrolment by class · year-group · subject,
 * + gender & age), Finance (3-stream) and Infrastructure.
 *
 * HARD INVARIANT (owner-stated, INS-21..24): everything on this page is AGGREGATE — class / year-group
 * (level) / subject / age-band — NEVER an individual student. The data comes from `getDirectorsInsights`,
 * whose type carries no student-identifying field, and `getAttendanceSummary` (which carries per-student
 * `needsAttention[]`) is never in the path — attendance is the PII-stripped `rollup.attendance`.
 * Reads the SESSION school id via `requireSchoolRole`, never a URL/query id.
 */
export const dynamic = "force-dynamic";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ periodId?: string }>;
}) {
  const { school } = await requireSchoolRole(INSIGHTS_READ_ROLES);
  const { periodId } = await searchParams;
  const data = await getDirectorsInsights(school.id, { periodId });
  const { rollup, census } = data;

  const termLabel = rollup.period
    ? `${rollup.period.label} · ${rollup.period.academicYear}`
    : "No academic period configured";
  const attention = buildAttention(data, termLabel);

  return (
    <div className="mx-auto max-w-page space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-medium text-navy">
            Directors&apos; <em className="not-italic text-gold">insights</em>.
          </h1>
          <p className="mt-1 text-[13px] text-navy-2">{termLabel} · consolidated director dashboard</p>
        </div>
        {/* Board-pack PDF (§17-F) — the SAME aggregate governance pack the board gets (GOV-5), re-gated for
            directors. Streams the on-screen term; lives at /api so the download convention holds. */}
        <a
          href={`/api/insights/board-pack${rollup.period?.periodId ? `?periodId=${rollup.period.periodId}` : ""}`}
          target="_blank"
          rel="noopener"
          className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-xs font-semibold text-navy hover:bg-bg print:hidden"
        >
          Board pack (PDF)
        </a>
      </div>

      {/* ── Period selector ── */}
      <ReportFilters
        terms={rollup.terms}
        activePeriodId={rollup.period?.periodId ?? null}
        showClass={false}
      />

      {/* ── Summary strip — the scan layer ── */}
      <SummaryStrip rollup={rollup} />

      {/* ── Needs your attention — the act-on-it panel (LINKED on /insights) ── */}
      <AttentionPanel items={attention} />

      {/* ── Financial position ── */}
      <FinanceTile arm={rollup.netPositionFinance} />

      {/* ── Attendance | Enrolment ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <AttendanceTile arm={rollup.attendance} byLevel={data.attendanceByLevel} />
        <EnrolmentTile arm={rollup.enrolment} census={census} />
      </div>

      {/* ── Performance | Infrastructure ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PerformanceTile data={data} termLabel={termLabel} />
        <InfrastructureTile arm={rollup.infrastructure} />
      </div>
    </div>
  );
}
