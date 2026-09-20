import { EmptyState } from "@/components/ui/empty-state";
import { SectionHead, SumCard } from "@/components/vlc/chrome";
import type { CpdBand, CpdDashboard, CpdStaffRow } from "@/lib/plc/cpd-data";

/**
 * The school CPD dashboard (surface schoolup-cpd-school-dashboard, PLC 8-pt arm ONLY). Server-safe,
 * purely presentational — the page (management-gated) passes a pre-formatted `CpdDashboard`.
 *
 * DROPPED (omit-not-fake, R404/R407–R409): the 20-pt "Annual progress" column, the "Sync to NTC now"
 * button, the licence-renews column + rolling renewal calendar, the dept + special-category filter bar,
 * the department pill (no field), the cross-teacher drilldown (→ arrow / row click), and the mock at-risk
 * narratives + action buttons ("Schedule 1-on-1s" / "Notify HoDs"). The at-risk reason is the DERIVED
 * shortfall signal, never a fabricated story. X/8 is NOT clamped (a facilitator/keen teacher may exceed 8).
 */
const BAND_LABEL: Record<CpdBand, string> = {
  "at-risk": "At risk",
  "below-pace": "Below pace",
  "on-track": "On track",
};
const PILL_CLASS: Record<CpdBand, string> = {
  "at-risk": "bg-terra-bg text-terra",
  "below-pace": "bg-warn-bg text-warn",
  "on-track": "bg-green-bg text-green",
};
const PTS_CLASS: Record<CpdBand, string> = {
  "at-risk": "text-terra",
  "below-pace": "text-warn",
  "on-track": "text-navy",
};

export function CpdDashboardView({ dashboard }: { dashboard: CpdDashboard }) {
  const d = dashboard;
  return (
    <div className="pb-20">
      <header className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
          Teacher development · CPD · School-wide dashboard
        </div>
        <h1 className="mt-1 font-display text-4xl font-medium leading-tight text-navy">
          CPD{" "}
          <em className="italic text-gold">
            · {d.academicYear ? `academic year ${d.academicYear}` : "this year"}
          </em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          {d.staffCount} {d.staffCount === 1 ? "teacher" : "teachers"} in a PLC · each staffer&rsquo;s
          school-based PLC points ({d.target} of NTC&rsquo;s 20 annual points come from PLCs) against the
          points made available by the sessions held so far. Who&rsquo;s on track, who needs a nudge.
        </p>
      </header>

      {!d.hasSettledSessions ? (
        <EmptyState
          eyebrow="No CPD points yet"
          title="No PLC session has settled yet"
          body="Points post here automatically once a held PLC session passes its reflection window. Once sessions settle, each teacher's PLC points and pace appear on this dashboard."
        />
      ) : (
        <>
          {/* ── Summary strip ── */}
          <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SumCard featured label="School average · PLC" big={`${d.avgEarned} / ${d.target}`}>
              Mean PLC points across {d.staffCount} staff · this academic year
            </SumCard>
            <SumCard label="On track" big={`${d.onTrackCount} / ${d.staffCount}`}>
              ≥ 75% of the points held sessions made available
            </SumCard>
            <SumCard warn label="Below pace" big={`${d.belowPaceCount}`}>
              50–75% of what was reachable · worth a nudge
            </SumCard>
            <SumCard terra label="At risk · escalate" big={`${d.atRiskCount}`}>
              Below 50% of the held-session points to date
            </SumCard>
          </div>

          {/* ── Staff table ── */}
          <section className="mb-8">
            <SectionHead
              eyebrow={`${d.staffCount} staff · sorted at-risk first`}
              meta="PLC points only · point-in-time from the CPD ledger"
            >
              Staff <em className="italic text-gold">PLC points</em>
            </SectionHead>
            <div className="overflow-hidden rounded-2xl border border-border bg-surface">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="border-b border-border bg-bg px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
                      Staff
                    </th>
                    <th className="w-[22%] border-b border-border bg-bg px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
                      PLC points
                    </th>
                    <th className="w-[18%] border-b border-border bg-bg px-4 py-3 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.staff.map((row) => (
                    <StaffRow key={row.userId} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── At-risk callout (only when there ARE at-risk staff) ── */}
          {d.atRisk.length > 0 && (
            <section className="rounded-2xl border-[1.5px] border-terra bg-terra-bg p-6">
              <div className="mb-4 flex items-center gap-4 border-b border-terra pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-terra font-display text-lg font-bold text-bg">
                  !
                </div>
                <div>
                  <h4 className="font-display text-xl font-semibold text-navy">
                    <em className="italic text-terra">
                      {d.atRisk.length} {d.atRisk.length === 1 ? "teacher" : "teachers"} at risk
                    </em>{" "}
                    · below half of the reachable PLC points
                  </h4>
                  <div className="mt-0.5 text-[11px] text-navy-2">
                    The gap is derived from held sessions only — attend + reflect to close it.
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {d.atRisk.map((row) => (
                  <div
                    key={row.userId}
                    className="rounded-xl border border-terra bg-surface p-4"
                  >
                    <div className="mb-2.5 flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-terra font-display text-[11px] font-bold text-bg">
                        {row.initials}
                      </div>
                      <div>
                        <div className="text-[12px] font-semibold text-navy">{row.name}</div>
                        <div className="text-[10px] text-navy-3">{row.roleLabel}</div>
                      </div>
                    </div>
                    <div className="mb-2 flex items-baseline gap-1.5 border-b border-border pb-2">
                      <span className="font-display text-2xl font-semibold text-terra">
                        {row.earned}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-navy-3">
                        of {row.target} PLC pts
                      </span>
                    </div>
                    <div className="text-[11px] leading-snug text-navy-2">{row.reason}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function StaffRow({ row }: { row: CpdStaffRow }) {
  return (
    <tr>
      <td className="border-b border-border px-4 py-3 align-middle">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gold-bg font-display text-[11px] font-bold text-gold">
            {row.initials}
          </div>
          <div>
            <div className="text-[12px] font-semibold text-navy">{row.name}</div>
            <div className="mt-0.5 text-[10px] text-navy-3">{row.roleLabel}</div>
          </div>
        </div>
      </td>
      <td className="border-b border-border px-4 py-3 align-middle">
        <span className={`font-display text-base font-semibold ${PTS_CLASS[row.band]}`}>
          {row.earned}
        </span>
        <span className="text-[11px] text-navy-3"> / {row.target}</span>
      </td>
      <td className="border-b border-border px-4 py-3 text-center align-middle">
        <span
          className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.04em] ${PILL_CLASS[row.band]}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
          {BAND_LABEL[row.band]}
        </span>
      </td>
    </tr>
  );
}
