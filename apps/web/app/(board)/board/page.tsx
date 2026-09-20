import { requireBoard } from "@/lib/auth/server";
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
 * GOV-4 · the read-only board dashboard (`/board`, `requireBoard()` — BOARD_MEMBER only). It renders the
 * SAME aggregate seam and SHARED tiles as Directors' Insights (`getDirectorsInsights` +
 * `components/dashboard/insight-tiles.tsx`) — the summary scan strip, Finance (full-width), Attendance |
 * Enrolment, Performance | Infrastructure, each with the class · year-group · subject drill-ins — but
 * keeps the board's OWN framing: "Board overview", a "read-only governance snapshot", and the board-pack
 * PDF under `/board` (so `requireBoard()`'s x-pathname confinement admits it).
 *
 * A board member is CONFINED to `/board*`, so the "Needs your attention" panel here is INFORMATIONAL:
 * `linkless` renders each signal as a text row with NO navigation (a link to /billing etc. would be a
 * dead end). Reads the SESSION school id (never a URL school id — R339); `?periodId` only picks the term.
 * Everything is AGGREGATE — no student name / id / code / DOB (arms-length governance).
 */
export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ periodId?: string }>;
}) {
  const { school } = await requireBoard();
  const { periodId } = await searchParams;
  const data = await getDirectorsInsights(school.id, { periodId });
  const { rollup, census } = data;

  const termLabel = rollup.period
    ? `${rollup.period.label} · ${rollup.period.academicYear}`
    : "No academic period configured";
  const attention = buildAttention(data, termLabel);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-medium text-navy">
            Board <em className="not-italic text-gold">overview</em>.
          </h1>
          <p className="mt-1 text-[13px] text-navy-2">{termLabel} · read-only governance snapshot</p>
        </div>
        {/* Board-pack PDF (GOV-5) — streams the governance overview for the on-screen term. It lives
            under /board so requireBoard()'s x-pathname confinement admits it. */}
        <a
          href={`/board/board-pack${rollup.period?.periodId ? `?periodId=${rollup.period.periodId}` : ""}`}
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

      {/* ── Needs your attention — INFORMATIONAL, link-free (the board is confined to /board*) ── */}
      <AttentionPanel items={attention} linkless />

      {/* ── Detail tiles — the read layer ── */}
      <FinanceTile arm={rollup.netPositionFinance} />

      <div className="grid gap-4 lg:grid-cols-2">
        <AttendanceTile arm={rollup.attendance} byLevel={data.attendanceByLevel} />
        <EnrolmentTile arm={rollup.enrolment} census={census} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PerformanceTile data={data} termLabel={termLabel} />
        <InfrastructureTile arm={rollup.infrastructure} />
      </div>
    </div>
  );
}
