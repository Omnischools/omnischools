import type { ReactNode } from "react";
import Link from "next/link";
import { requireSchoolRole } from "@/lib/auth/server";
import { INSIGHTS_READ_ROLES } from "@/lib/access";
import { getDirectorsInsights, censusNudge, type DirectorsInsights } from "@/lib/insights/insights-data";
import type {
  AttendanceArm,
  EnrolmentArm,
  InfrastructureSummary,
  NetPositionFinanceArm,
  PerformanceArm,
  RollupArm,
  TerminalResultSummary,
} from "@/lib/rollup/school-rollup";
import type { ClassPerfRow, LevelPerfRow } from "@/lib/reports/class-performance-data";
import { compareLevelLabel } from "@/lib/reports/class-performance-data";
import type { SubjectPerfRow } from "@/lib/reports/subject-performance-data";
import type {
  CensusEnrolment,
  CensusClassRow,
  CensusLevelRow,
} from "@/lib/reports/census-enrolment-data";
import type { InsightsAttendanceLevelRow } from "@/lib/insights/insights-data";
import { attendanceTone } from "@/lib/reports/grade-band";
import { boardGhs } from "@/lib/board/tiles";
import { ReportFilters } from "@/components/reports/report-filters";
import { PerfBar, ColumnHeads } from "@/components/reports/report-kit";
import {
  TrendPill,
  AbsencePanel,
  Tile,
  SummaryCell,
  StatusSplit,
  Line,
  StreamCard,
  FEMALE_HEX,
  MALE_HEX,
} from "@/components/board/board-tiles";
import { DrillIn, type DrillDimension } from "@/components/insights/drill-in";
import { cn } from "@/lib/utils";

/**
 * INS · Directors' Insights (`/insights`) — the acting director/admin's consolidated analytics
 * dashboard. It EXTENDS the read-only board (`app/(board)/board/page.tsx`, shared primitives lifted to
 * `components/board/board-tiles.tsx`) with a "Needs your attention" action panel and real AGGREGATE
 * drill-ins (Performance/Attendance/Enrolment by class · by year-group · by subject, + gender & age).
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
  const academic = academicSummary(rollup.performance);
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

      {/* ── Period selector (verbatim board) ── */}
      <ReportFilters
        terms={rollup.terms}
        activePeriodId={rollup.period?.periodId ?? null}
        showClass={false}
      />

      {/* ── Summary strip — the scan layer (verbatim board) ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCell
          lead
          label="Students on roll"
          value={
            rollup.enrolment.status === "CAPTURED"
              ? rollup.enrolment.data.roll.toLocaleString("en-GH")
              : "—"
          }
          sub={
            rollup.enrolment.status === "CAPTURED" ? (
              <>
                {rollup.enrolment.data.gender.male} boys · {rollup.enrolment.data.gender.female} girls{" "}
                <TrendPill
                  delta={rollup.enrolment.data.netChange}
                  context="this term"
                  flatLabel="no change"
                />
              </>
            ) : (
              rollup.enrolment.reason
            )
          }
        />
        <SummaryCell
          label="Attendance rate"
          value={
            rollup.attendance.status === "CAPTURED"
              ? rollup.attendance.data.schoolRate == null
                ? "—"
                : `${rollup.attendance.data.schoolRate}%`
              : "—"
          }
          sub={
            rollup.attendance.status === "CAPTURED" ? (
              rollup.attendance.data.schoolDelta == null ? (
                "(present + late) ÷ all marks"
              ) : (
                <TrendPill delta={rollup.attendance.data.schoolDelta} unit="pts" context="vs last term" />
              )
            ) : (
              rollup.attendance.reason
            )
          }
        />
        <SummaryCell label="Academic standing" value={academic.value} sub={academic.sub} />
        <SummaryCell
          label="Fee collection"
          value={
            rollup.feeCollections.status === "CAPTURED"
              ? `${rollup.feeCollections.data.collectionRate}%`
              : "—"
          }
          sub={
            rollup.feeCollections.status === "CAPTURED"
              ? `${boardGhs(rollup.feeCollections.data.collected)} of ${boardGhs(rollup.feeCollections.data.billed)} billed`
              : rollup.feeCollections.reason
          }
        />
        <SummaryCell
          label="Facilities"
          value={
            rollup.infrastructure.status === "CAPTURED"
              ? rollup.infrastructure.data.classrooms.pctGood == null
                ? "—"
                : `${rollup.infrastructure.data.classrooms.pctGood}%`
              : "—"
          }
          sub={
            rollup.infrastructure.status === "CAPTURED"
              ? `${rollup.infrastructure.data.classrooms.good}/${rollup.infrastructure.data.classrooms.total} classrooms sound`
              : rollup.infrastructure.reason
          }
        />
      </div>

      {/* ── Needs your attention — the act-on-it panel [NEW] ── */}
      <AttentionPanel items={attention} />

      {/* ── Financial position (verbatim board) ── */}
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

/* ───────────────────────────── Summary academic cell (verbatim board) ───────────────────────────── */

/** Cell 3 headline: prefer the captured Basic average; else Senior readiness; else the applicable
 *  tier's honest reason. NO blend across tiers (R357). Copied from the board (page-local, can't import). */
function academicSummary(p: PerformanceArm): { value: string; sub: ReactNode } {
  if (p.basic.status === "CAPTURED" && p.basic.data.overallAverage != null) {
    const d = p.basic.data;
    return {
      value: `${d.overallAverage}%`,
      sub: (
        <>
          {d.passRate != null && <>{d.passRate}% pass · </>}
          {d.gradedClasses} {d.gradedClasses === 1 ? "class" : "classes"} graded{" "}
          <TrendPill delta={d.overallDelta} unit="pts" context="vs last term" />
        </>
      ),
    };
  }
  if (p.senior.status === "CAPTURED") {
    const d = p.senior.data;
    return { value: `${d.subjectsReady}/${d.subjectsTotal}`, sub: "subjects STPSHS-ready" };
  }
  const applicable = p.basic.status !== "NOT_APPLICABLE" ? p.basic : p.senior;
  return { value: "—", sub: applicable.status === "CAPTURED" ? null : applicable.reason };
}

/* ───────────────────────────── Needs your attention [NEW] ───────────────────────────── */

type ActionSeverity = "terra" | "warn" | "navy-2";
type ActionItem = { key: string; href: string; dot: ActionSeverity; label: string; value: string };
const DOT: Record<ActionSeverity, string> = {
  terra: "bg-terra",
  warn: "bg-warn",
  "navy-2": "bg-navy-2",
};

/**
 * The conditional action rows — each rendered ONLY when its condition is genuinely true (omit-not-fake:
 * an absent problem is absent, never a green "all good" row). Every row is a school-wide count/amount or
 * a subject count — NEVER a per-student list.
 */
function buildAttention(d: DirectorsInsights, termLabel: string): ActionItem[] {
  const items: ActionItem[] = [];
  const { rollup, classPerf } = d;

  const fees = rollup.feeCollections;
  if (fees.status === "CAPTURED" && fees.data.outstanding > 0) {
    items.push({
      key: "fees",
      href: "/billing",
      dot: fees.data.collectionRate < 60 ? "terra" : "warn",
      label: "Outstanding fees",
      value: `${boardGhs(fees.data.outstanding)} outstanding · ${fees.data.collectionRate}% collected`,
    });
  }

  // Ungraded classes — Basic tier only; count from getClassPerformance (§17-E), not the rollup arm.
  if (rollup.performance.basic.status !== "NOT_APPLICABLE") {
    const ungraded = classPerf.totalClasses - classPerf.classesGraded;
    if (ungraded > 0) {
      items.push({
        key: "ungraded",
        href: "/gradebook",
        dot: "warn",
        label: "Ungraded classes",
        value: `${ungraded} of ${classPerf.totalClasses} ${
          classPerf.totalClasses === 1 ? "class has" : "classes have"
        } no gradebook scores for ${termLabel}`,
      });
    }
  }

  if (rollup.attendance.status !== "CAPTURED") {
    items.push({
      key: "attendance",
      href: "/attendance",
      dot: "warn",
      label: "Attendance not captured",
      value: rollup.attendance.reason,
    });
  }

  if (rollup.infrastructure.status !== "CAPTURED") {
    items.push({
      key: "facilities",
      href: "/reports/facilities",
      dot: "navy-2",
      label: "Facilities snapshot missing",
      value: rollup.infrastructure.reason,
    });
  }

  const sen = rollup.performance.senior;
  if (sen.status === "CAPTURED" && sen.data.subjectsAtRisk > 0) {
    items.push({
      key: "senior",
      href: "/senior/headmaster-summary",
      dot: "terra",
      label: "Senior readiness at risk",
      value: `${sen.data.subjectsAtRisk} subject${sen.data.subjectsAtRisk === 1 ? "" : "s"} at risk for STPSHS · ${sen.data.subjectsPartial} partial`,
    });
  }

  // GES annual census — DRAFT (warn) or not-started (navy-2), only once the resolved year is underway
  // and not yet filed (§17-D, Kofi's ruling). Suppressed when no academic year is configured.
  const nudge = censusNudge(d.censusFiling, rollup.terms, new Date().toISOString().slice(0, 10));
  if (nudge) {
    items.push({
      key: "census",
      href: "/reports/statutory/generate-annual-census",
      dot: nudge.dot,
      label: "GES annual census",
      value: nudge.value,
    });
  }

  const order: Record<ActionSeverity, number> = { terra: 0, warn: 1, "navy-2": 2 };
  return items.sort((a, b) => order[a.dot] - order[b.dot]);
}

function AttentionPanel({ items }: { items: ActionItem[] }) {
  return (
    <Tile
      title="Needs your"
      accent="attention"
      meta={items.length > 0 ? `${items.length} item${items.length === 1 ? "" : "s"}` : undefined}
    >
      {items.length === 0 ? (
        <p className="mt-3 text-[13px] text-navy-3">
          Everything&apos;s current — nothing needs your attention this term.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map((it) => (
            <Link
              key={it.key}
              href={it.href}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-4 py-3 hover:bg-gold-bg"
            >
              <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[it.dot])} aria-hidden />
              <span className="text-[13px] font-semibold text-navy">{it.label}</span>
              <span className="text-xs text-navy-3">{it.value}</span>
              <span className="ml-auto text-navy-3" aria-hidden>
                ›
              </span>
            </Link>
          ))}
        </div>
      )}
    </Tile>
  );
}

/* ───────────────────────────── Drill-in bar-list primitives ───────────────────────────── */

const PERF_COLS = "lg:grid-cols-[minmax(7rem,1fr)_1.7fr_minmax(9rem,auto)]";
const SUBJ_COLS = "lg:grid-cols-[minmax(7rem,1fr)_1.5fr_minmax(11rem,auto)]";
const ATT_COLS = "lg:grid-cols-[minmax(7rem,1fr)_1.7fr_minmax(5rem,auto)]";
const ENROL_COLS = "lg:grid-cols-[minmax(7rem,1fr)_1.7fr_minmax(9rem,auto)]";

function DrillList({
  cols,
  heads,
  children,
}: {
  cols: string;
  heads: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mt-1 overflow-hidden rounded-lg border border-border">
      <ColumnHeads cols={cols}>{heads}</ColumnHeads>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

/** A single aggregate bar row: label (+sub) · bar · trailing readout. Stacks on mobile, grid on lg. */
function BarRow({
  cols,
  label,
  sub,
  bar,
  trailing,
}: {
  cols: string;
  label: ReactNode;
  sub?: ReactNode;
  bar: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5 px-6 py-2.5 lg:grid lg:items-center lg:gap-4 lg:space-y-0", cols)}>
      <div className="min-w-0">
        <div className="truncate text-[13px] text-navy">{label}</div>
        {sub && <div className="mt-0.5 font-mono text-[10px] text-navy-3">{sub}</div>}
      </div>
      <div>{bar}</div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:justify-end">{trailing}</div>
    </div>
  );
}

function GenderBar({
  female,
  male,
  heightClass = "h-2.5",
}: {
  female: number;
  male: number;
  heightClass?: string;
}) {
  return (
    <div className={cn("flex w-full overflow-hidden rounded-pill border border-border bg-bg", heightClass)}>
      {female > 0 && <div style={{ flexGrow: female, backgroundColor: FEMALE_HEX }} aria-hidden />}
      {male > 0 && <div style={{ flexGrow: male, backgroundColor: MALE_HEX }} aria-hidden />}
    </div>
  );
}

/* ───────────────────────────── Performance tile + drill-in ───────────────────────────── */

function PerformanceTile({ data, termLabel }: { data: DirectorsInsights; termLabel: string }) {
  const { rollup, classPerf, subjectPerf, levelPerf } = data;
  const { basic, senior } = rollup.performance;
  const terminal = rollup.terminalResults;

  const dims: DrillDimension[] = [
    {
      key: "class",
      label: "By class",
      content: classPerf.hasAnyScores ? (
        <ClassPerfBars rows={classPerf.rows} />
      ) : (
        <div className="mt-1">
          <AbsencePanel>{perfReason(basic, termLabel)}</AbsencePanel>
        </div>
      ),
    },
    {
      key: "year",
      label: "By year group",
      content: levelPerf.hasAnyScores ? (
        <LevelPerfBars rows={levelPerf.rows} />
      ) : (
        <div className="mt-1">
          <AbsencePanel>{perfReason(basic, termLabel)}</AbsencePanel>
        </div>
      ),
    },
    {
      key: "subject",
      label: "By subject",
      content: subjectPerf.hasAnyScores ? (
        <SubjectPerfBars rows={subjectPerf.rows} />
      ) : (
        <div className="mt-1">
          <AbsencePanel>{perfReason(basic, termLabel)}</AbsencePanel>
        </div>
      ),
    },
  ];

  return (
    <Tile title="Academic" accent="performance" meta="cross-tier · this term">
      <div className="mt-3 space-y-3">
        {basic.status !== "NOT_APPLICABLE" && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
              Basic · gradebook
            </div>
            {basic.status === "CAPTURED" ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="font-display text-3xl font-medium leading-none text-navy">
                  {basic.data.overallAverage == null ? "—" : `${basic.data.overallAverage}%`}
                </div>
                {basic.data.passRate != null && (
                  <span className="text-[11px] font-semibold text-navy-2">
                    {basic.data.passRate}% pass rate
                  </span>
                )}
                <span className="text-[11px] text-navy-3">
                  {basic.data.gradedClasses} {basic.data.gradedClasses === 1 ? "class" : "classes"} graded
                </span>
                <TrendPill delta={basic.data.overallDelta} unit="pts" context="vs last term" />
              </div>
            ) : (
              <p className="mt-1 text-[13px] leading-relaxed text-navy-3">{basic.reason}</p>
            )}
          </div>
        )}

        {senior.status !== "NOT_APPLICABLE" && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
              Senior · STPSHS readiness
            </div>
            {senior.status === "CAPTURED" ? (
              <div className="mt-1 text-[13px] text-navy-2">
                <span className="font-display text-xl font-medium text-navy">
                  {senior.data.subjectsReady}
                </span>{" "}
                of {senior.data.subjectsTotal} subjects ready ·{" "}
                <span className="font-semibold text-gold">{senior.data.subjectsPartial} partial</span> ·{" "}
                <span className="font-semibold text-terra">{senior.data.subjectsAtRisk} at risk</span>
              </div>
            ) : (
              <p className="mt-1 text-[13px] leading-relaxed text-navy-3">{senior.reason}</p>
            )}
          </div>
        )}

        {(terminal.bece.status !== "NOT_APPLICABLE" ||
          terminal.wassce.status !== "NOT_APPLICABLE") && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
              Terminal exams
            </div>
            <div className="mt-1 space-y-2">
              <TerminalLine label="BECE" arm={terminal.bece} />
              <TerminalLine label="WASSCE" arm={terminal.wassce} />
            </div>
          </div>
        )}
      </div>

      <DrillIn dimensions={dims} defaultDim="class" />
    </Tile>
  );
}

function perfReason(basic: PerformanceArm["basic"], termLabel: string): string {
  if (basic.status !== "CAPTURED") return basic.reason;
  return `No gradebook scores recorded for ${termLabel}.`;
}

function ClassPerfBars({ rows }: { rows: ClassPerfRow[] }) {
  return (
    <DrillList
      cols={PERF_COLS}
      heads={
        <>
          <span>Class</span>
          <span>Average</span>
          <span className="lg:text-right">Grade · vs last term</span>
        </>
      }
    >
      {rows.map((r) => (
        <BarRow
          key={r.classId}
          cols={PERF_COLS}
          label={r.name}
          sub={`${r.studentsGraded} graded`}
          bar={<PerfBar value={r.average} tone={r.tone} suffix="%" />}
          trailing={
            <>
              <span className="font-mono text-xs text-navy-2">{r.grade ?? "—"}</span>
              <TrendPill delta={r.delta} unit="pts" context="vs last term" />
            </>
          }
        />
      ))}
    </DrillList>
  );
}

function LevelPerfBars({ rows }: { rows: LevelPerfRow[] }) {
  return (
    <DrillList
      cols={PERF_COLS}
      heads={
        <>
          <span>Year group</span>
          <span>Average</span>
          <span className="lg:text-right">Pass · vs last term</span>
        </>
      }
    >
      {rows.map((r) => (
        <BarRow
          key={r.level}
          cols={PERF_COLS}
          label={<span className="font-mono">{r.level}</span>}
          sub={`${r.classesGraded} of ${r.classes} ${r.classes === 1 ? "class" : "classes"} graded`}
          bar={<PerfBar value={r.average} tone={r.tone} suffix="%" />}
          trailing={
            <>
              <span className="font-mono text-xs text-navy-2">
                {r.passRate == null ? "—" : `${r.passRate}% pass`}
              </span>
              <TrendPill delta={r.delta} unit="pts" context="vs last term" />
            </>
          }
        />
      ))}
    </DrillList>
  );
}

function SubjectPerfBars({ rows }: { rows: SubjectPerfRow[] }) {
  return (
    <DrillList
      cols={SUBJ_COLS}
      heads={
        <>
          <span>Subject</span>
          <span>Average</span>
          <span className="lg:text-right">Grade · Pass · vs last term</span>
        </>
      }
    >
      {rows.map((r) => (
        <BarRow
          key={r.subjectId}
          cols={SUBJ_COLS}
          label={r.name}
          sub={r.code ?? undefined}
          bar={<PerfBar value={r.average} tone={r.tone} suffix="%" />}
          trailing={
            <>
              <span className="font-mono text-xs text-navy-2">{r.grade ?? "—"}</span>
              <span className="font-mono text-xs text-navy-3">
                {r.passRate == null ? "—" : `${r.passRate}% pass`}
              </span>
              <TrendPill delta={r.delta} unit="pts" context="vs last term" />
            </>
          }
        />
      ))}
    </DrillList>
  );
}

/* ───────────────────────────── Attendance tile + drill-in ───────────────────────────── */

function AttendanceTile({
  arm,
  byLevel,
}: {
  arm: RollupArm<AttendanceArm>;
  byLevel: InsightsAttendanceLevelRow[];
}) {
  if (arm.status !== "CAPTURED") {
    return (
      <Tile title="Attendance" accent="this term">
        <div className="mt-4">
          <AbsencePanel>{arm.reason}</AbsencePanel>
        </div>
      </Tile>
    );
  }

  // Worst-first (Lucy §9.1 flag #5 — the director's watch-list read): ascending by rate, null last.
  const byClass = [...arm.data.byClass].sort(
    (a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.name.localeCompare(b.name),
  );

  const dims: DrillDimension[] = [
    {
      key: "class",
      label: "By class",
      content: (
        <AttendanceBars
          cols={ATT_COLS}
          headLabel="Class"
          rows={byClass.map((c) => ({
            key: c.classId,
            label: c.name,
            rate: c.rate,
            marked: c.marked,
            counts: c.counts,
          }))}
        />
      ),
    },
    {
      key: "year",
      label: "By year group",
      content: (
        <AttendanceBars
          cols={ATT_COLS}
          headLabel="Year group"
          rows={byLevel.map((l) => ({
            key: l.level,
            label: <span className="font-mono">{l.level}</span>,
            rate: l.rate,
            marked: l.marked,
            counts: l.counts,
          }))}
        />
      ),
    },
  ];

  return (
    <Tile
      title="Attendance"
      accent="this term"
      meta={`${arm.data.totalMarked.toLocaleString("en-GH")} marks recorded`}
    >
      <div className="mt-3 flex items-center gap-3">
        <div className="font-display text-3xl font-medium leading-none text-navy">
          {arm.data.schoolRate == null ? "—" : `${arm.data.schoolRate}%`}
        </div>
        {arm.data.schoolDelta == null ? (
          <span className="text-[11px] text-navy-3">(present + late) ÷ all marks</span>
        ) : (
          <TrendPill delta={arm.data.schoolDelta} unit="pts" context="vs last term" />
        )}
      </div>
      <StatusSplit totals={arm.data.statusTotals} />
      <DrillIn dimensions={dims} defaultDim="class" />
    </Tile>
  );
}

type AttendanceBarRow = {
  key: string;
  label: ReactNode;
  rate: number | null;
  marked: number;
  counts: { present: number; late: number; excused: number; medical: number; absent: number };
};

function AttendanceBars({
  cols,
  headLabel,
  rows,
}: {
  cols: string;
  headLabel: string;
  rows: AttendanceBarRow[];
}) {
  return (
    <DrillList
      cols={cols}
      heads={
        <>
          <span>{headLabel}</span>
          <span>Rate · P L E M A</span>
          <span className="lg:text-right">Marks</span>
        </>
      }
    >
      {rows.map((r) => (
        <div key={r.key} className="px-6 py-3">
          <div className={cn("space-y-1.5 lg:grid lg:items-center lg:gap-4 lg:space-y-0", cols)}>
            <div className="truncate text-[13px] text-navy">{r.label}</div>
            <PerfBar value={r.rate} tone={attendanceTone(r.rate)} suffix="%" />
            <div className="font-mono text-[10px] text-navy-3 lg:text-right">
              {r.marked.toLocaleString("en-GH")} marks
            </div>
          </div>
          <StatusSplit totals={r.counts} className="mt-2" />
        </div>
      ))}
    </DrillList>
  );
}

/* ───────────────────────────── Enrolment tile + drill-in ───────────────────────────── */

function EnrolmentTile({
  arm,
  census,
}: {
  arm: RollupArm<EnrolmentArm>;
  census: CensusEnrolment;
}) {
  const byLevel = [...census.byLevel].sort((a, b) => compareLevelLabel(a.level, b.level));

  const dims: DrillDimension[] = [
    { key: "class", label: "By class", content: <EnrolClassBars rows={census.byClass} /> },
    { key: "year", label: "By year group", content: <EnrolLevelBars rows={byLevel} /> },
    { key: "gender", label: "Gender", content: <GenderViz census={census} /> },
    { key: "age", label: "Age", content: <AgeViz census={census} /> },
  ];

  return (
    <Tile
      title="Enrolment"
      accent="at a glance"
      meta={arm.status === "CAPTURED" ? arm.data.levelSummary : undefined}
    >
      {arm.status !== "CAPTURED" ? (
        <div className="mt-4">
          <AbsencePanel>{arm.reason}</AbsencePanel>
        </div>
      ) : (
        <>
          <EnrolmentBody d={arm.data} />
          {census.roll > 0 && <DrillIn dimensions={dims} defaultDim="class" />}
        </>
      )}
    </Tile>
  );
}

function EnrolmentBody({ d }: { d: EnrolmentArm }) {
  const dash = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-GH"));
  return (
    <div className="mt-3 space-y-4">
      <div className="flex items-center gap-3">
        <div className="font-display text-3xl font-medium leading-none text-navy">
          {d.roll.toLocaleString("en-GH")}
        </div>
        <TrendPill delta={d.netChange} context="this term" flatLabel="no change" />
      </div>

      <div>
        <GenderBar female={d.gender.female} male={d.gender.male} />
        <div className="mt-1.5 font-mono text-[10px] text-navy-3">
          {d.gender.female}F · {d.gender.male}M
        </div>
      </div>

      <dl className="space-y-1 text-[13px]">
        <Line label="Active classes" value={d.activeClasses.toLocaleString("en-GH")} />
        <Line label="Avg class size" value={d.avgClassSize.toLocaleString("en-GH")} />
        <Line label="Teaching staff" value={d.teachingStaff.toLocaleString("en-GH")} />
        <Line
          label="Student : teacher"
          value={d.studentTeacherRatio == null ? "—" : `${d.studentTeacherRatio}:1`}
        />
      </dl>

      <div className="border-t border-border pt-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
          Intake this term
        </div>
        <div className="mt-1 text-[13px] text-navy-2">
          {dash(d.admissionsThisTerm)} new{" "}
          <span className="text-navy-3">
            ({dash(d.intakeFemale)}F · {dash(d.intakeMale)}M)
          </span>
        </div>
        <div className="mt-2 text-[13px] text-navy-2">
          <span className="text-navy-3">Lifetime exits:</span> {d.withdrew.toLocaleString("en-GH")}{" "}
          withdrew · {d.transferred.toLocaleString("en-GH")} transferred ·{" "}
          {d.graduated.toLocaleString("en-GH")} graduated ({d.lifetimeExits.toLocaleString("en-GH")}{" "}
          total)
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-navy-3">
          Withdrawals, transfers and graduations are current lifetime totals — per-term exit dating
          arrives when status history is tracked.
        </p>
      </div>
    </div>
  );
}

function EnrolClassBars({ rows }: { rows: CensusClassRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="mt-1">
        <AbsencePanel>No students currently enrolled.</AbsencePanel>
      </div>
    );
  }
  return (
    <DrillList
      cols={ENROL_COLS}
      heads={
        <>
          <span>Class</span>
          <span>Girls / boys</span>
          <span className="lg:text-right">Enrolled</span>
        </>
      }
    >
      {rows.map((r) => (
        <BarRow
          key={r.classId}
          cols={ENROL_COLS}
          label={r.name}
          bar={<GenderBar female={r.female} male={r.male} />}
          trailing={
            <span className="font-mono text-xs text-navy-2">
              {r.total} · {r.female}F · {r.male}M
            </span>
          }
        />
      ))}
    </DrillList>
  );
}

function EnrolLevelBars({ rows }: { rows: CensusLevelRow[] }) {
  return (
    <DrillList
      cols={ENROL_COLS}
      heads={
        <>
          <span>Year group</span>
          <span>Girls / boys</span>
          <span className="lg:text-right">Enrolled</span>
        </>
      }
    >
      {rows.map((r) => (
        <BarRow
          key={r.level}
          cols={ENROL_COLS}
          label={<span className="font-mono">{r.level}</span>}
          bar={<GenderBar female={r.female} male={r.male} />}
          trailing={
            <span className="font-mono text-xs text-navy-2">
              {r.total} · {r.female}F · {r.male}M
            </span>
          }
        />
      ))}
    </DrillList>
  );
}

/** Gender dimension = the school headline bar (the per-class/level splits are the two lists above). */
function GenderViz({ census }: { census: CensusEnrolment }) {
  const g = census.gender;
  const femalePct = g.total > 0 ? Math.round((g.female / g.total) * 100) : 0;
  const malePct = g.total > 0 ? Math.round((g.male / g.total) * 100) : 0;
  return (
    <div className="mt-1 rounded-lg border border-border p-4">
      <GenderBar female={g.female} male={g.male} heightClass="h-3" />
      <div className="mt-2 font-mono text-[11px] text-navy-2">
        {femalePct}% girls · {malePct}% boys · {g.total} on roll
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-navy-3">
        Girls and boys per class and per year-group are in the “By class” and “By year group”
        breakdowns.
      </p>
    </div>
  );
}

/**
 * Age dimension — the school-scope age histogram (gender-split stacked bars, normalised to the modal
 * age) + the GES "enrolment by approved age" bands + the honest DOB-unknown footnote. A student with no
 * DOB is NEVER assigned an age (GOV8-05): they surface in the `dobUnknown` footnote and the approved-age
 * `unknown` band, shown, never dropped. (A by-level age sub-toggle is a v1 follow-up.)
 */
function AgeViz({ census }: { census: CensusEnrolment }) {
  const byAge = new Map<number, { female: number; male: number }>();
  for (const lvl of census.ageByLevel) {
    for (const b of lvl.byAge) {
      const e = byAge.get(b.age) ?? { female: 0, male: 0 };
      e.female += b.female;
      e.male += b.male;
      byAge.set(b.age, e);
    }
  }
  const ages = [...byAge.entries()]
    .map(([age, s]) => ({ age, female: s.female, male: s.male, total: s.female + s.male }))
    .sort((a, b) => a.age - b.age);
  const maxTotal = ages.reduce((m, a) => Math.max(m, a.total), 0);

  const appr = census.approvedAge.reduce(
    (acc, a) => ({
      under: acc.under + a.under,
      on: acc.on + a.on,
      over: acc.over + a.over,
      unknown: acc.unknown + a.unknown,
    }),
    { under: 0, on: 0, over: 0, unknown: 0 },
  );
  const apprTotal = appr.under + appr.on + appr.over + appr.unknown;

  const dobFootnote =
    census.dobUnknown > 0 ? (
      <p className="mt-3 text-[11px] leading-relaxed text-navy-3">
        {census.dobUnknown} student{census.dobUnknown === 1 ? "" : "s"} have no date of birth recorded
        — counted in the roll but never assigned an age.
      </p>
    ) : null;

  const asOf = (
    <p className="mt-3 text-[11px] text-navy-3">
      Enrolment, gender &amp; age are a point-in-time census snapshot, as of {census.censusDate}.
    </p>
  );

  if (ages.length === 0) {
    return (
      <div className="mt-1">
        <AbsencePanel>No date-of-birth data recorded yet — no age distribution to show.</AbsencePanel>
        {dobFootnote}
        {asOf}
      </div>
    );
  }

  return (
    <div className="mt-1 rounded-lg border border-border p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
        Age distribution · girls / boys
      </div>
      <div className="mt-2 space-y-1.5">
        {ages.map((a) => (
          <div key={a.age} className="grid items-center gap-2 lg:grid-cols-[3rem_1fr_auto] lg:gap-3">
            <div className="font-mono text-[11px] text-navy-2">{a.age} yrs</div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-pill border border-border bg-bg">
              <div
                className="flex h-full overflow-hidden"
                style={{ width: `${maxTotal > 0 ? (a.total / maxTotal) * 100 : 0}%` }}
              >
                {a.female > 0 && (
                  <div style={{ flexGrow: a.female, backgroundColor: FEMALE_HEX }} aria-hidden />
                )}
                {a.male > 0 && (
                  <div style={{ flexGrow: a.male, backgroundColor: MALE_HEX }} aria-hidden />
                )}
              </div>
            </div>
            <div className="font-mono text-[10px] text-navy-3 lg:text-right">
              {a.female}F · {a.male}M · {a.total}
            </div>
          </div>
        ))}
      </div>

      {apprTotal > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
            Enrolment by approved age
          </div>
          <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-pill border border-border bg-bg">
            {appr.on > 0 && <div className="bg-green" style={{ flexGrow: appr.on }} aria-hidden />}
            {appr.under > 0 && <div className="bg-gold" style={{ flexGrow: appr.under }} aria-hidden />}
            {appr.over > 0 && <div className="bg-terra" style={{ flexGrow: appr.over }} aria-hidden />}
            {appr.unknown > 0 && (
              <div className="bg-navy-3" style={{ flexGrow: appr.unknown }} aria-hidden />
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px]">
            <span className="text-green">{appr.on} on age</span>
            <span className="text-gold">{appr.under} under</span>
            <span className="text-terra">{appr.over} over</span>
            {appr.unknown > 0 && <span className="text-navy-3">{appr.unknown} unknown DOB</span>}
          </div>
        </div>
      )}

      {dobFootnote}
      {asOf}
    </div>
  );
}

/* ───────────────────────────── Finance tile (verbatim board) ───────────────────────────── */

function FinanceTile({ arm }: { arm: RollupArm<NetPositionFinanceArm> }) {
  return (
    <Tile title="Financial" accent="position" className="col-span-full">
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-navy-3">
        Three separate records shown side by side. Fee collections and the school&apos;s books are kept
        as separate ledgers and are not combined into a single profit; payroll is a current monthly
        figure.
      </p>

      {arm.status !== "CAPTURED" ? (
        <div className="mt-4">
          <AbsencePanel>{arm.reason}</AbsencePanel>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <StreamCard title="Fee collections">
            {arm.data.fees.status === "CAPTURED" ? (
              <>
                <Headline>{boardGhs(arm.data.fees.data.collected)}</Headline>
                <Caption>collected · this term</Caption>
                <div className="mt-3">
                  <PerfBar value={arm.data.fees.data.collectionRate} tone="gold" suffix="%" />
                </div>
                <div className="mt-1.5 text-[11px] text-navy-3">
                  {boardGhs(arm.data.fees.data.outstanding)} outstanding
                </div>
              </>
            ) : (
              <Reason>{arm.data.fees.reason}</Reason>
            )}
          </StreamCard>

          <StreamCard title="Books (this term)">
            {arm.data.books.status === "CAPTURED" ? (
              <dl className="mt-2 space-y-1 text-[13px]">
                <Line label="Income" value={boardGhs(arm.data.books.data.income)} />
                <Line label="Expense" value={boardGhs(arm.data.books.data.expense)} />
                <Line label="Net" value={boardGhs(arm.data.books.data.net)} strong />
              </dl>
            ) : (
              <Reason>{arm.data.books.reason}</Reason>
            )}
          </StreamCard>

          <StreamCard title="Payroll">
            {arm.data.payroll.status === "CAPTURED" ? (
              <>
                <Headline>{boardGhs(arm.data.payroll.data.schoolPaidMonthlyTotal)}</Headline>
                <Caption>school-paid · gross · monthly</Caption>
                <div className="mt-2 text-[11px] leading-relaxed text-navy-3">
                  GES-paid (memo, not added): {boardGhs(arm.data.payroll.data.gesPaidMonthlyMemo)}
                  {arm.data.payroll.data.allowanceMonthlyMemo > 0 && (
                    <>
                      <br />
                      Allowance (memo, not added):{" "}
                      {boardGhs(arm.data.payroll.data.allowanceMonthlyMemo)}
                    </>
                  )}
                </div>
              </>
            ) : (
              <Reason>{arm.data.payroll.reason}</Reason>
            )}
          </StreamCard>
        </div>
      )}
    </Tile>
  );
}

const Headline = ({ children }: { children: ReactNode }) => (
  <div className="mt-2 font-display text-2xl font-medium text-navy">{children}</div>
);
const Caption = ({ children }: { children: ReactNode }) => (
  <div className="mt-0.5 text-[11px] text-navy-3">{children}</div>
);
const Reason = ({ children }: { children: ReactNode }) => (
  <div className="mt-2 text-[13px] leading-relaxed text-navy-3">{children}</div>
);

/* ───────────────────────────── Terminal line (verbatim board) ───────────────────────────── */

function TerminalLine({ label, arm }: { label: string; arm: RollupArm<TerminalResultSummary> }) {
  if (arm.status === "NOT_APPLICABLE") return null;
  return (
    <div>
      <div className="text-[11px] font-semibold text-navy-2">{label}</div>
      {arm.status === "CAPTURED" ? (
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-display text-xl font-medium text-navy">{arm.data.passRate}%</span>
          <span className="text-[12px] text-navy-3">pass · {arm.data.year}</span>
          <span className="text-[12px] text-navy-3">
            {arm.data.passedCount.toLocaleString("en-GH")}/
            {arm.data.totalCandidates.toLocaleString("en-GH")} passed
          </span>
          <span className="font-mono text-[10px] text-navy-3">
            {arm.data.female.passed}/{arm.data.female.candidates}F ·{" "}
            {arm.data.male.passed}/{arm.data.male.candidates}M
          </span>
        </div>
      ) : (
        <p className="mt-0.5 text-[13px] leading-relaxed text-navy-3">{arm.reason}</p>
      )}
    </div>
  );
}

/* ───────────────────────────── Infrastructure tile (verbatim board) ───────────────────────────── */

const yesNo = (b: boolean) => (b ? "Yes" : "No");
const dashNum = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-GH"));

function InfrastructureTile({ arm }: { arm: RollupArm<InfrastructureSummary> }) {
  return (
    <Tile
      title="Infrastructure"
      accent="& facilities"
      meta={
        arm.status === "CAPTURED"
          ? `${arm.data.capturedFor.periodLabel} · ${arm.data.capturedFor.academicYear}`
          : undefined
      }
    >
      {arm.status !== "CAPTURED" ? (
        <div className="mt-4">
          <AbsencePanel>{arm.reason}</AbsencePanel>
        </div>
      ) : (
        <InfrastructureBody d={arm.data} />
      )}
    </Tile>
  );
}

function InfrastructureBody({ d }: { d: InfrastructureSummary }) {
  return (
    <div className="mt-3 space-y-4">
      <div className="flex items-center gap-3">
        <div className="font-display text-3xl font-medium leading-none text-navy">
          {d.classrooms.pctGood == null ? "—" : `${d.classrooms.pctGood}%`}
        </div>
        <div className="text-[11px] leading-tight text-navy-3">
          classrooms sound
          <br />
          {d.classrooms.good}/{d.classrooms.total} good · {d.classrooms.needingRepair} need repair
        </div>
      </div>

      <dl className="space-y-1 text-[13px]">
        <Line label="Water" value={d.utilities.waterSource} />
        <Line label="Electricity" value={d.utilities.electricitySource} />
        <Line
          label="Sanitation"
          value={`${d.utilities.latrineType} · ${d.utilities.latrinesTotal.toLocaleString("en-GH")} latrines`}
        />
        <Line label="Handwashing" value={yesNo(d.utilities.handwashing)} />
        <Line
          label="ICT lab"
          value={
            d.ict.hasLab ? `Yes · ${dashNum(d.ict.working)}/${dashNum(d.ict.computers)} working` : "No"
          }
        />
        <Line label="Internet" value={yesNo(d.ict.internet)} />
        <Line
          label="Library"
          value={d.library.has ? `Yes · ${dashNum(d.library.bookCount)} books` : "No"}
        />
        <Line
          label="Feeding"
          value={
            d.feeding.gsfpParticipating
              ? `GSFP · ${dashNum(d.feeding.pupilsFedDaily)} fed daily`
              : d.feeding.hasKitchen
                ? "Own kitchen"
                : "None"
          }
        />
        {d.textbooks.availability && <Line label="Textbooks" value={d.textbooks.availability} />}
      </dl>
    </div>
  );
}
