import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { WASSCE_SETUP_ROLES } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { loadCohortReadiness, type HouseCardView } from "@/lib/wassce/cohort-data";
import { RISK_REASON_LABEL, TIER_COLORS, type RiskReason } from "@/lib/wassce/cohort";
import { TARGET_TIER_BANDS } from "@/lib/wassce/university-match";
import { GRADE_COLORS, GRADE_CHIP_TEXT } from "@/lib/wassce/grade-colors";
import { WASSCE_GRADES } from "@/lib/wassce/mock-grades";
import { PROGRAMME_TRACKS } from "@/lib/wassce/constants";

export const dynamic = "force-dynamic";

/**
 * WASSCE cohort readiness — the Head of Academics whole-cohort surface (SHS module 4.3 / INCR-18 ·
 * `schoolup-wassce-cohort-readiness`, all four frames). READ + aggregate only; the increment's single
 * WRITE (moderation) lives on the INCR-16 mark-entry grid, which each heatmap row deep-links into.
 *
 * AUTHZ (Kofi R8): gated `WASSCE_SETUP_ROLES` BEFORE any PII read. A TEACHER — *including* one with a
 * live `senior_subject_teacher` assignment — gets a hard redirect, NOT a filtered view: INCR-16 scopes
 * teachers per-subject, whole-cohort is HoA-only. `SENIOR_LEDGER_ROLES` is deliberately NOT used here
 * (it contains TEACHER and FORM_MASTER).
 *
 * WHAT IS DELIBERATELY ABSENT (Kofi R4g/R6, AC22 — absent, never placeholdered):
 *   • the regional/national comparison callout — `benchmark_reference.subject_name` is NOT NULL, so no
 *     school-wide median/tier-share row is representable. Inventing one is false precision.
 *   • the §3 case-management columns (`Last action`, `Next`), the Dean cadence card and the
 *     `Followup pending` filter — there is no interview/worklist entity in the schema.
 *   • any attendance claim ("in centre", "underway", "no other anomalies") — nothing records attendance.
 */
export default async function WassceCohortReadinessPage(props: {
  searchParams: Promise<{ risk?: string }>;
}) {
  const searchParams = await props.searchParams;
  const { school } = await requireSchoolRole(WASSCE_SETUP_ROLES);
  if (school.schoolType === "BASIC") redirect("/gradebook");

  const data = await withSchool(school.id, (tx) => loadCohortReadiness(tx, school.id));

  if (!data) {
    return (
      <div className="mx-auto max-w-page">
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center text-sm text-navy-3">
          No frozen WASSCE cohort has been set up for this school yet.
        </div>
      </div>
    );
  }

  const { tiles, summary } = data;
  const predictor = data.predictorName ?? "the predictor mock";
  const activeFilter = (searchParams.risk ?? "ALL").toUpperCase();
  const filtered =
    activeFilter === "ALL"
      ? data.atRisk
      : data.atRisk.filter((r) => r.reasons.includes(activeFilter as RiskReason));
  // The list is unbounded by nature (a cohort with no targets tagged puts EVERY candidate in clause 2).
  // Render the head of the sorted list and state the remainder honestly — the surface's own overflow row.
  const VISIBLE = 50;
  const shown = filtered.slice(0, VISIBLE);
  const overflow = filtered.length - shown.length;

  const FILTERS: { key: string; label: string; count: number }[] = [
    { key: "ALL", label: "At-risk · all", count: data.atRisk.length },
    ...(
      [
        "NO_TARGET_TAGGED",
        "PROJECTION_NOT_COMPUTABLE",
        "OPEN_SC12",
        "ABOVE_LOWEST_CUTOFF",
      ] as RiskReason[]
    ).map((k) => ({
      key: k,
      label: RISK_REASON_LABEL[k],
      count: data.atRisk.filter((r) => r.reasons.includes(k)).length,
    })),
  ];

  return (
    <div className="mx-auto max-w-page space-y-10">
      {/* ================= §1 — The cohort at a glance ================= */}
      <section id="glance" className="space-y-4">
        <div className="border-b border-border pb-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-navy-3">
            WASSCE · Cohort readiness
          </div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <h1 className="font-display text-2xl font-medium text-navy">
              Cohort <em className="italic text-gold">readiness</em> · F3 {data.examYear}.
            </h1>
            <span className="text-[11px] text-navy-3">
              {summary.total} candidates · {predictor}
              {data.markingComplete ? " · marking complete" : " · marking in progress"}
            </span>
          </div>
          <p className="mt-2 max-w-[760px] text-[13px] text-navy-3">
            {data.markingComplete ? (
              <b className="font-semibold text-navy-2">{predictor} projection frozen.</b>
            ) : (
              <b className="font-semibold text-navy-2">{predictor} marking in progress.</b>
            )}{" "}
            Every figure below derives on read from the mock results — median, tiers, the heatmap and the
            at-risk list all move the moment a grade is moderated.{" "}
            {summary.notComputable > 0 && (
              <b className="font-semibold text-navy-2">
                {summary.notComputable} of {summary.total} candidates have no computable projection yet
                and are excluded from the median, mean, tiers and histogram.
              </b>
            )}
          </p>
        </div>

        {/* Live banner — Day-N + the SCHEDULED clock windows. Both derive from wassce_papers; it makes
            no claim about who is in the centre (nothing records attendance). */}
        {data.banner && (
          <div
            className="rounded-xl p-4 text-bg"
            style={{ background: "linear-gradient(135deg, var(--navy), var(--navy-2))" }}
          >
            <div className="font-display text-[16px] font-medium text-bg">{data.banner.title}</div>
            <div className="mt-1 text-[12px] text-gold-soft">
              {data.banner.papers.map((p) => `${p.name} · ${p.window}`).join(" · ")}
              {data.banner.exemptedNote ? ` · ${data.banner.exemptedNote}` : ""}
            </div>
            <div className="mt-1 text-[10px] text-gold-soft">
              Scheduled timetable only — attendance is not recorded in the system.
            </div>
          </div>
        )}

        {/* Summary strip */}
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Tile
            accent="ok"
            label="Expected in centre today"
            value={tiles.expectedInCentre == null ? "—" : String(tiles.expectedInCentre)}
            sub={
              tiles.expectedInCentre == null
                ? tiles.nextPaperLabel
                  ? `Next paper · ${tiles.nextPaperLabel}`
                  : "No paper scheduled"
                : `${tiles.scheduledToday} scheduled · ${tiles.exemptedToday} exempted`
            }
          />
          <Tile
            label={`${predictor} median agg.`}
            value={tiles.median == null ? "—" : String(tiles.median)}
            gold
            sub={
              tiles.median == null
                ? `No computable projection of ${summary.total}`
                : `Mean ${tiles.mean} · ${tiles.medianTierLabel} · over ${summary.computable} of ${summary.total}`
            }
          />
          <Tile
            accent="ok"
            label="All-credit candidates"
            value={String(tiles.allCreditNumerator)}
            unit={`/ ${tiles.allCreditDenominator}`}
            sub="Every graded result at C6 or better"
          />
          <Tile
            accent="flag"
            label="At-risk"
            value={String(tiles.atRisk)}
            sub="Any of the five at-risk reasons"
          />
          <Tile
            accent="terra"
            label="No target tagged"
            value={String(tiles.noTargetTagged)}
            sub="Zero university targets on file"
          />
          <Tile
            label="Marking progress"
            value={String(tiles.gradedResults)}
            unit={`/ ${tiles.expectedResults}`}
            sub={
              tiles.markingComplete
                ? "Marking closed for this mock"
                : "Registered subject entries marked"
            }
          />
        </div>

        {/* Stale readiness statements — derived on read (R1.6). No stored flag, nothing regenerates. */}
        {data.stale.length > 0 && (
          <div className="rounded-lg border-l-[3px] border-warn bg-warn-bg p-3 text-[11px] text-navy-2">
            <b className="font-semibold">
              {data.stale.length} issued readiness statement{data.stale.length === 1 ? "" : "s"} no
              longer match the live projection.
            </b>{" "}
            The frozen statement is unchanged by design; regenerate it from the candidate&apos;s page to
            reflect the current grades.
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-navy-3">
              {data.stale.map((s) => (
                <Link
                  key={s.indexNumber}
                  href={`/senior/wassce/candidates/${s.indexNumber}`}
                  className="hover:text-gold"
                >
                  {s.name} · frozen {s.frozenAggregate ?? "—"} → live {s.liveLabel}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Histogram */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-[15px] font-medium text-navy">
              Projected <em className="italic text-gold">aggregate</em> distribution · {predictor}
            </h2>
            <span className="text-[10px] uppercase tracking-wide text-navy-3">
              {summary.computable} computable projections · binned by aggregate point
            </span>
          </div>
          {summary.computable === 0 ? (
            <EmptyNote>
              No candidate has a computable projection yet — the distribution is pending.
            </EmptyNote>
          ) : (
            <>
              <div className="flex h-[200px] items-end gap-1.5 border-b border-border">
                {data.histogram.map((b) => (
                  <div key={b.label} className="flex flex-1 flex-col items-center justify-end">
                    {b.count > 0 && (
                      <span className="mb-1 font-mono text-[10px] font-bold text-navy">{b.count}</span>
                    )}
                    <div
                      className="w-full rounded-t"
                      style={{
                        height: `${Math.max(b.count === 0 ? 1 : 4, (b.count / data.histogramMax) * 100)}%`,
                        background: b.count === 0 ? "var(--bg)" : TIER_COLORS[b.tierKey],
                      }}
                    />
                    <span className="mt-1 font-mono text-[9px] text-navy-3">{b.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-4 border-t border-border pt-3 text-[11px] text-navy-2">
                {TARGET_TIER_BANDS.map((band) => (
                  <span key={band.key} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-[3px]"
                      style={{ background: TIER_COLORS[band.key] }}
                    />
                    <b className="font-semibold">
                      {band.name} · {band.range}
                    </b>{" "}
                    · {summary.tierCounts[band.key]} candidates
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Programme breakdown */}
        {data.programmes.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-[15px] font-medium text-navy">
                By <em className="italic text-gold">programme</em>
              </h2>
              <span className="text-[10px] uppercase tracking-wide text-navy-3">
                Tier distribution per programme
              </span>
            </div>
            <div className="space-y-0">
              {data.programmes.map((p) => (
                <div
                  key={p.key}
                  className="grid grid-cols-[110px_1fr] items-center gap-4 border-b border-border py-3 last:border-b-0"
                >
                  <div>
                    <div className="font-display text-[14px] font-semibold text-navy">{p.label}</div>
                    <div className="mt-0.5 text-[10px] text-navy-3">
                      {p.total} candidate{p.total === 1 ? "" : "s"}
                      {p.computable < p.total ? ` · ${p.computable} computable` : ""}
                    </div>
                  </div>
                  {p.computable === 0 ? (
                    <span className="text-[11px] text-navy-3">projection pending</span>
                  ) : (
                    <div className="flex h-6 overflow-hidden rounded-md bg-bg">
                      {p.tiers
                        .filter((t) => t.count > 0)
                        .map((t) => (
                          <span
                            key={t.key}
                            className="flex items-center justify-center font-mono text-[9px] font-bold"
                            style={{
                              width: `${(t.count / p.computable) * 100}%`,
                              background: t.color,
                              color: t.key === "tier-2" ? "#1A2B47" : "#FAF7F2",
                            }}
                            title={`${t.name} · ${t.count} (${t.pct}%)`}
                          >
                            {t.count}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Moderation trail — READ-ONLY here; the write lives on the mark-entry grid (Decision 10). */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-[15px] font-medium text-navy">
              Moderation <em className="italic text-gold">trail</em>
            </h2>
            <span className="text-[10px] uppercase tracking-wide text-navy-3">
              {data.trail.length} moderated result{data.trail.length === 1 ? "" : "s"} · {predictor}
            </span>
          </div>
          {data.trail.length === 0 ? (
            <EmptyNote>No results have been moderated for this mock.</EmptyNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[11.5px]">
                <thead className="border-b border-border-2 bg-bg text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
                  <tr>
                    <th className="px-3 py-2.5 text-left">Candidate</th>
                    <th className="px-3 py-2.5 text-left">Subject</th>
                    <th className="px-3 py-2.5 text-center">Grade</th>
                    <th className="px-3 py-2.5 text-left">Moderated by</th>
                    <th className="px-3 py-2.5 text-left">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trail.map((t) => (
                    <tr
                      key={`${t.indexNumber}-${t.subjectId}`}
                      className="border-b border-border last:border-b-0 text-navy-2"
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-display text-[12px] font-semibold text-navy">
                          {t.candidateName}
                        </div>
                        <div className="font-mono text-[9px] text-navy-3">{t.indexNumber}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/senior/wassce/subject?subjectId=${t.subjectId}`}
                          className="text-gold hover:underline"
                        >
                          {t.subjectName}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="inline-flex flex-col items-center gap-0.5">
                          <span className="inline-flex items-center gap-1">
                            <Chip grade={t.moderatedGrade} />
                            <span className="rounded bg-navy px-1 py-0.5 text-[8px] font-bold uppercase text-gold">
                              MOD
                            </span>
                          </span>
                          <Chip grade={t.grade} dim />
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-display text-[12px] font-semibold text-navy">
                          {t.moderatorLabel}
                        </div>
                        <div className="font-mono text-[9px] text-navy-3">{t.moderatedAtLabel}</div>
                      </td>
                      <td className="px-3 py-2.5 text-[10px] text-navy-3">{t.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ================= §2 — Subject heatmap ================= */}
      <section id="heatmap" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border pb-3">
          <h2 className="font-display text-2xl font-medium text-navy">
            Subject <em className="italic text-gold">heatmap.</em>
          </h2>
          <span className="max-w-[560px] text-[11px] text-navy-3">
            Each cell is the count of candidates at that grade. The colour is the GRADE column, not the
            count — green = credit-pass bands (A1–C6), terra = below credit (D7–F9).
          </span>
        </div>

        {data.heatmap.length === 0 ? (
          <EmptyNote>No subject has a registered candidate for this cohort.</EmptyNote>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface p-4">
            <div
              className="grid min-w-[720px] gap-[3px] text-[10px]"
              style={{ gridTemplateColumns: "150px repeat(9, minmax(0, 1fr))" }}
            >
              <span className="rounded-[3px] bg-bg px-1.5 py-2" />
              {WASSCE_GRADES.map((g) => (
                <span
                  key={g}
                  className="rounded-[3px] bg-bg px-1.5 py-2 text-center text-[9px] font-bold uppercase tracking-[0.08em] text-navy-3"
                >
                  {g}
                </span>
              ))}
              {data.heatmap.map((row) => (
                <Row key={row.subjectId} row={row} />
              ))}
            </div>
            <p className="mt-3 text-[11px] text-navy-3">
              {data.resultCreditPct}% of all {tiles.gradedResults} graded results are at credit (C6 or
              better). Rows are every WASSCE subject with at least one registered candidate — cores
              first, then electives.
            </p>
          </div>
        )}

        {data.concerns.length > 0 && (
          <div className="grid gap-3 md:grid-cols-3">
            {data.concerns.map((c) => (
              <div
                key={c.subjectId}
                className={`rounded-lg border-l-[3px] p-3 text-[11px] text-navy-2 ${
                  c.tag === "CONCERN" ? "border-terra bg-terra-bg" : "border-warn bg-warn-bg"
                }`}
              >
                <b className="font-semibold text-navy">{c.heading}</b> {c.body}{" "}
                <Link
                  href={`/senior/wassce/subject?subjectId=${c.subjectId}`}
                  className="text-gold hover:underline"
                >
                  Open subject view
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ================= §3 — At-risk list ================= */}
      <section id="at-risk" className="space-y-3">
        <div className="border-b border-border pb-3">
          <h2 className="font-display text-2xl font-medium text-navy">
            The <em className="italic text-gold">{data.atRisk.length}</em> at-risk candidates.
          </h2>
          <p className="mt-1.5 max-w-[760px] text-[12px] text-navy-3">
            A candidate is at risk on <b className="font-semibold text-navy-2">any</b> of five derived
            reasons: no computable projection, no target tagged, a projected aggregate above their lowest
            (least ambitious) target&apos;s cut-off, an unmet prerequisite on that target, or an open
            SC-12. Sorted by gap, largest first; candidates with no gap to measure come first.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">Show</span>
          {FILTERS.map((f) => {
            const active = f.key === activeFilter;
            return (
              <Link
                key={f.key}
                href={f.key === "ALL" ? "?" : `?risk=${f.key}`}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
                  active ? "border-navy bg-navy text-bg" : "border-border-2 bg-surface text-navy-2"
                }`}
              >
                {f.label}
                <span
                  className={`ml-1.5 rounded-full px-1.5 font-mono text-[10px] ${
                    active ? "text-gold-soft" : "text-gold"
                  }`}
                  style={{ background: "rgba(200,151,91,0.18)" }}
                >
                  {f.count}
                </span>
              </Link>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <EmptyNote>
            {data.atRisk.length === 0
              ? "No candidate meets any at-risk reason."
              : "No candidates match this filter."}
          </EmptyNote>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[820px] border-collapse text-[11.5px]">
              <thead className="border-b border-border-2 bg-bg text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
                <tr>
                  <th className="px-3 py-2.5 text-left">Candidate</th>
                  <th className="px-3 py-2.5 text-left">Programme</th>
                  <th className="px-3 py-2.5 text-right">{predictor}</th>
                  <th className="px-3 py-2.5 text-left">Lowest target</th>
                  <th className="px-3 py-2.5 text-center">Gap</th>
                  <th className="px-3 py-2.5 text-left">Reasons</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const track = r.programmeKey ? PROGRAMME_TRACKS[r.programmeKey] : null;
                  return (
                    <tr
                      key={r.candidateId}
                      className="border-b border-border align-middle text-navy-2 last:border-b-0"
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gold-soft font-display text-[10px] font-semibold text-navy">
                            {r.initials}
                          </span>
                          <span>
                            <Link
                              href={`/senior/wassce/candidates/${r.indexNumber}`}
                              className="font-display text-[12px] font-semibold text-navy hover:text-gold"
                            >
                              {r.name}
                            </Link>
                            <span className="block font-mono text-[9px] text-navy-3">
                              {r.indexNumber}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] ${
                            track?.pillBgClass ?? ""
                          }`}
                          style={
                            track?.pillBgStyle
                              ? { background: track.pillBgStyle, color: track.color }
                              : undefined
                          }
                        >
                          {r.programmeLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {r.aggregate == null ? (
                          <span className="text-[11px] italic text-navy-3">projection pending</span>
                        ) : (
                          <span
                            className={`font-mono text-[13px] font-bold ${
                              r.aggregateTierKey === "tier-4"
                                ? "text-terra"
                                : r.aggregateTierKey === "tier-1"
                                  ? "text-green"
                                  : "text-warn"
                            }`}
                          >
                            {r.aggregate}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {r.lowestTargetLabel ? (
                          <>
                            <span className="font-display text-[12px] text-navy">
                              {r.lowestTargetLabel}
                            </span>
                            <span className="block text-[10px] text-navy-3">{r.lowestTargetSub}</span>
                          </>
                        ) : (
                          <span className="text-navy-3">No target tagged</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${
                            r.gapTone === "over"
                              ? "bg-terra-bg text-terra"
                              : r.gapTone === "tight"
                                ? "bg-warn-bg text-warn"
                                : r.gapTone === "ok"
                                  ? "bg-green-bg text-green"
                                  : "bg-bg text-navy-3"
                          }`}
                        >
                          {r.gapLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap gap-1">
                          {r.reasons.map((reason) => (
                            <span
                              key={reason}
                              className="rounded-full bg-bg px-2 py-0.5 text-[9px] font-semibold text-navy-3"
                            >
                              {RISK_REASON_LABEL[reason]}
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {overflow > 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-3.5 text-center text-[11px] italic text-navy-3"
                    >
                      + {overflow} more candidate{overflow === 1 ? "" : "s"} match, sorted after these.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ================= §4 — House × tier ================= */}
      {data.houses.length > 0 && (
        <section id="houses" className="space-y-3">
          <div className="border-b border-border pb-3">
            <h2 className="font-display text-2xl font-medium text-navy">
              By <em className="italic text-gold">house.</em>
            </h2>
            <p className="mt-1.5 max-w-[760px] text-[12px] text-navy-3">
              Boarding allocation is academic-blind, so each house&apos;s readiness reflects the mix of
              candidates inside it, not a selection effect. Day candidates hold no House and are bucketed
              explicitly — the cards sum to the full cohort of {summary.total}.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.houses.map((h) => (
              <HouseCard key={h.key} house={h} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------- display helpers */

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border-2 bg-bg p-6 text-center text-[12px] text-navy-3">
      {children}
    </div>
  );
}

function Tile({
  accent,
  label,
  value,
  unit,
  sub,
  gold,
}: {
  accent?: "ok" | "flag" | "terra";
  label: string;
  value: string;
  unit?: string;
  sub: string | null;
  gold?: boolean;
}) {
  const border =
    accent === "ok"
      ? "border-l-[3px] border-l-green"
      : accent === "flag"
        ? "border-l-[3px] border-l-warn"
        : accent === "terra"
          ? "border-l-[3px] border-l-terra"
          : "";
  const tone =
    accent === "ok"
      ? "text-green"
      : accent === "flag"
        ? "text-warn"
        : accent === "terra"
          ? "text-terra"
          : gold
            ? "text-gold"
            : "text-navy";
  return (
    <div className={`rounded-[10px] border border-border ${border} bg-surface p-3.5`}>
      <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-navy-3">{label}</div>
      <div className={`mt-1 font-display text-[28px] font-medium leading-none ${tone}`}>
        {value}
        {unit && <span className="ml-1.5 text-[12px] font-normal text-navy-3">{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 text-[10px] text-navy-3">{sub}</div>}
    </div>
  );
}

/** A grade chip — Palette A, solid fill, zero alpha. `dim` renders the superseded teacher original. */
function Chip({ grade, dim }: { grade: string; dim?: boolean }) {
  return (
    <span
      className="inline-flex h-5 items-center justify-center rounded-md px-1.5 font-display text-[10px] font-semibold"
      style={
        dim
          ? { background: "transparent", color: "#8A93A6", textDecoration: "line-through" }
          : {
              background: GRADE_COLORS[grade as keyof typeof GRADE_COLORS],
              color: GRADE_CHIP_TEXT,
            }
      }
    >
      {grade}
    </span>
  );
}

/**
 * One heatmap row. The fill of every cell is `GRADE_COLORS[column]` — CONSTANT down each column,
 * independent of the count. This is a grade gradient table, not a magnitude heatmap: `HEAT_COLORS`
 * (INCR-16's count-driven scale) would be a category error here. A genuine zero renders "0", the
 * documented exception to the em-dash rule — the coloured cell carries the meaning.
 */
function Row({
  row,
}: {
  row: {
    subjectId: string;
    label: string;
    graded: number;
    registered: number;
    /** Per-programme copies merged into this row; >1 means the deep link opens only one of them. */
    copies: number;
    counts: { grade: string; count: number }[];
    tag: "CONCERN" | "WATCH" | null;
  };
}) {
  return (
    <>
      <Link
        href={`/senior/wassce/subject?subjectId=${row.subjectId}`}
        className="flex flex-col justify-center rounded-[3px] bg-bg px-3 py-2 font-display text-[11px] font-semibold text-navy hover:text-gold"
      >
        {row.label}
        <span className="font-body text-[9px] font-normal text-navy-3">
          {row.graded} of {row.registered} marked
          {row.tag ? ` · ${row.tag.toLowerCase()}` : ""}
          {/* This row merges the subject's per-programme copies, but the mark-entry grid is scoped to
              ONE copy — so a "240 registered" row would otherwise land on a ~60-row page with no
              explanation. Say what the drill-down opens instead of letting the numbers disagree. */}
          {row.copies > 1 ? ` · opens 1 of ${row.copies} programme views` : ""}
        </span>
      </Link>
      {row.counts.map((c) => (
        <span
          key={c.grade}
          className="rounded-[3px] px-1.5 py-2 text-center font-mono text-[10px] font-bold"
          style={{
            background: GRADE_COLORS[c.grade as keyof typeof GRADE_COLORS],
            color: GRADE_CHIP_TEXT,
          }}
        >
          {c.count}
        </span>
      ))}
    </>
  );
}

function HouseCard({ house }: { house: HouseCardView }) {
  const s = house.summary;
  return (
    <div
      className="rounded-[10px] border border-border bg-surface p-4"
      style={{ borderTop: `3px solid ${house.colour ?? "var(--navy-3)"}` }}
    >
      <div className="font-display text-[14px] font-semibold text-navy">
        <em className="italic text-gold">{house.name}</em>
      </div>
      <div className="mb-2.5 text-[10px] text-navy-3">
        {s.total} F3 candidate{s.total === 1 ? "" : "s"}
        {house.hmLabel ? ` · ${house.hmLabel}` : house.isNoHouseBucket ? " · no housemaster" : ""}
      </div>
      <HouseRow label="Median aggregate" value={s.median == null ? "—" : String(s.median)} first />
      {TARGET_TIER_BANDS.map((band) => (
        <HouseRow
          key={band.key}
          label={`${band.name} (${band.range})`}
          value={String(s.tierCounts[band.key])}
        />
      ))}
      <div className="flex justify-between border-t border-gold py-1.5">
        <span className="text-[10px] text-gold">At-risk count</span>
        <span className="font-mono text-[12px] font-bold text-terra">{s.atRisk}</span>
      </div>
      <HouseRow label="Open SC-12" value={String(house.openSc12)} />
      {s.notComputable > 0 && (
        <div className="mt-1.5 text-[9px] text-navy-3">
          {s.notComputable} without a computable projection (excluded from median and tiers)
        </div>
      )}
    </div>
  );
}

function HouseRow({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <div className={`flex justify-between py-1.5 ${first ? "" : "border-t border-border"}`}>
      <span className="text-[10px] text-navy-3">{label}</span>
      <span className="font-mono text-[12px] font-bold text-navy">{value}</span>
    </div>
  );
}
