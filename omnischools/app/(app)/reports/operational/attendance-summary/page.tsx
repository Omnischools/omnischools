import { requireSchool } from "@/lib/auth/server";
import { hasAnyRole } from "@/lib/access";
import { getAttendanceSummary, type StatusCounts } from "@/lib/reports/attendance-summary-data";
import { schoolFile } from "@/lib/filename";
import {
  ATTENDANCE_STATUS_META,
  ATTENDANCE_STATUS_ORDER,
  type AttendanceStatus,
} from "@/lib/attendance-status";
import { ReportHeader } from "@/components/reports/report-header";
import { ReportFilters } from "@/components/reports/report-filters";
import { ExportCsv } from "@/components/reports/export-csv";
import { PrintButton } from "@/components/reports/print-button";
import { EmptyState } from "@/components/ui/empty-state";
import { PointsDelta } from "@/components/reports/perf-chips";
import {
  SnapshotPill,
  KpiStrip,
  FeaturedKpi,
  Kpi,
  SectionCard,
  ColumnHeads,
  PerfBar,
} from "@/components/reports/report-kit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Attendance summary" };

const ADMIN_WIDE = ["ADMIN", "HEADMASTER", "VICE_HEADMASTER_ACADEMIC"];
const TEACHER_ROLES = ["TEACHER", "FORM_MASTER"];

const fmtNow = () =>
  new Date().toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

const statusValue = (c: StatusCounts, s: AttendanceStatus): number =>
  s === "PRESENT"
    ? c.present
    : s === "LATE"
      ? c.late
      : s === "EXCUSED"
        ? c.excused
        : s === "MEDICAL"
          ? c.medical
          : c.absent;

export default async function AttendanceSummaryPage(props: {
  searchParams: Promise<{ periodId?: string }>;
}) {
  const { school, user } = await requireSchool();
  const sp = await props.searchParams;
  const teacherScoped =
    !hasAnyRole(user.roles, ADMIN_WIDE) && hasAnyRole(user.roles, TEACHER_ROLES);
  const data = await getAttendanceSummary(school.id, {
    periodId: sp.periodId,
    teacherUserId: teacherScoped ? user.id : null,
  });
  const { term, terms, priorTerm, scoped, statusTotals } = data;
  const hasPrior = !!priorTerm;

  const classCsv = data.byClass.map((c) => [
    c.name,
    c.teacherName ?? "",
    c.rate ?? "",
    c.counts.present,
    c.counts.late,
    c.counts.excused,
    c.counts.medical,
    c.counts.absent,
    c.marked,
    c.priorRate ?? "",
  ]);
  const flagCsv = data.needsAttention.map((n) => [
    n.name,
    n.studentCode,
    n.className,
    n.rate ?? "",
    n.daysAbsent,
    n.severity === "CRITICAL" ? "Critical" : "Watch",
  ]);

  return (
    <div className="mx-auto max-w-page">
      <ReportHeader
        crumb="Operational / Attendance summary"
        pre="Attendance"
        gold="summary"
        lede="Term attendance rates by class, the five-status breakdown, and the students who need attention."
        actions={
          <>
            <ExportCsv
              filename={schoolFile(school.name, "attendance-summary.csv")}
              headers={[
                "Class",
                "Teacher",
                "Attendance rate %",
                "Present",
                "Late",
                "Excused",
                "Medical",
                "Absent",
                "Sessions marked",
                "Last term rate %",
              ]}
              rows={classCsv}
            />
            <ExportCsv
              label="Needs-attention CSV"
              filename={schoolFile(school.name, "attendance-needs-attention.csv")}
              headers={["Student", "Student code", "Class", "Attendance rate %", "Days absent", "Flag"]}
              rows={flagCsv}
            />
            <PrintButton label="Export PDF" />
          </>
        }
      />

      <ReportFilters
        terms={terms.map((t) => ({
          periodId: t.periodId,
          label: t.label,
          academicYear: t.academicYear,
        }))}
        activePeriodId={term?.periodId ?? null}
        showClass={false}
      />

      {!term ? (
        <EmptyState tone="muted" className="mt-6">
          No academic term configured yet. Set up a term to see attendance.
        </EmptyState>
      ) : (
        <>
          <SnapshotPill>
            Snapshot as of <b className="font-bold text-navy">{fmtNow()}</b> · {term.label} ·{" "}
            {term.academicYear}
            {scoped ? <> · your classes</> : null}
          </SnapshotPill>

          <KpiStrip>
            <FeaturedKpi
              label="Attendance rate"
              value={data.schoolRate == null ? "—" : `${data.schoolRate}%`}
              sub={
                hasPrior && data.schoolDelta != null ? (
                  <span>
                    <span className={data.schoolDelta >= 0 ? "text-green" : "text-terra"}>
                      {data.schoolDelta >= 0 ? "↑" : "↓"}
                    </span>{" "}
                    <b className="font-semibold text-bg">
                      {data.schoolDelta >= 0 ? "+" : "−"}
                      {Math.abs(data.schoolDelta)} pts
                    </b>{" "}
                    vs {priorTerm!.label}
                  </span>
                ) : (
                  "(present + late) ÷ all marks"
                )
              }
            />
            <Kpi
              label="Marks recorded"
              value={String(data.totalMarked)}
              sub={<>student-days marked this term</>}
            />
            <Kpi
              label="Students needing attention"
              value={<span className="text-terra">{data.needsAttention.length}</span>}
              sub={
                <>
                  {data.criticalCount} critical · {data.watchCount} watch
                </>
              }
            />
            <Kpi
              label="Perfect attendance"
              value={<span className="text-green">{data.perfectCount}</span>}
              sub={<>students with zero absences</>}
            />
          </KpiStrip>

          {!data.hasAnyMarks ? (
            <EmptyState tone="muted" className="mt-6">
              No attendance marked in {term.label} yet. Take attendance from the Attendance module to
              see rates here.
            </EmptyState>
          ) : (
            <>
              {/* Section A — status breakdown */}
              <SectionCard
                eyebrow="Status breakdown"
                title="Every mark this term"
                meta={`${data.totalMarked} marks`}
              >
                <div className="px-6 py-5">
                  <div className="mb-4 flex h-3 gap-1 overflow-hidden rounded-pill">
                    {ATTENDANCE_STATUS_ORDER.map((s) => {
                      const v = statusValue(statusTotals, s);
                      return v > 0 ? (
                        <span
                          key={s}
                          className={`h-full rounded-pill ${ATTENDANCE_STATUS_META[s].seg}`}
                          style={{ flexGrow: v }}
                        />
                      ) : null;
                    })}
                  </div>
                  <div className="grid grid-cols-5 gap-3">
                    {ATTENDANCE_STATUS_ORDER.map((s) => {
                      const meta = ATTENDANCE_STATUS_META[s];
                      const v = statusValue(statusTotals, s);
                      const pct = data.totalMarked > 0 ? Math.round((v / data.totalMarked) * 100) : 0;
                      return (
                        <div
                          key={s}
                          className={`rounded-lg border border-l-2 border-border bg-surface p-3 ${meta.borderL}`}
                        >
                          <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">
                            {meta.letter} · {meta.label}
                          </div>
                          <div className={`mt-1 font-display text-lg font-semibold ${meta.num}`}>
                            {v}
                          </div>
                          <div className="font-mono text-[10px] text-navy-3">{pct}% of marked</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </SectionCard>

              {/* Section B — by class */}
              <SectionCard
                eyebrow="By class"
                title="Rate and mix per class"
                meta={hasPrior ? "vs last term's rate" : "No prior term to compare"}
              >
                <ColumnHeads cols="grid-cols-[130px_1fr_150px_64px_88px]">
                  <div>Class</div>
                  <div>Rate</div>
                  <div>P · L · E · M · A</div>
                  <div className="text-right">Marked</div>
                  <div>vs last</div>
                </ColumnHeads>
                {data.byClass.map((c) => (
                  <div
                    key={c.classId}
                    className="grid grid-cols-1 items-center gap-3 border-b border-border px-6 py-3.5 text-xs last:border-b-0 hover:bg-bg lg:grid-cols-[130px_1fr_150px_64px_88px]"
                  >
                    <div className="font-display text-sm font-semibold text-navy">
                      {c.name}
                      <div className="mt-0.5 text-[10px] font-medium text-navy-3">
                        {c.teacherName ?? "No class teacher"}
                      </div>
                    </div>
                    <PerfBar value={c.rate} tone={c.tone} suffix="%" />
                    <div className="flex items-center gap-2">
                      <div className="flex h-2 flex-1 gap-0.5 overflow-hidden rounded-pill">
                        {ATTENDANCE_STATUS_ORDER.map((s) => {
                          const v = statusValue(c.counts, s);
                          return v > 0 ? (
                            <span
                              key={s}
                              className={`h-full rounded-pill ${ATTENDANCE_STATUS_META[s].seg}`}
                              style={{ flexGrow: v }}
                            />
                          ) : null;
                        })}
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-navy-3">
                        {c.counts.present}·{c.counts.late}·{c.counts.excused}·{c.counts.medical}·
                        {c.counts.absent}
                      </span>
                    </div>
                    <div className="text-right font-mono text-[11px] text-navy-3">{c.marked}</div>
                    <div>
                      <PointsDelta delta={c.delta} hasPrior={hasPrior} />
                    </div>
                  </div>
                ))}
              </SectionCard>

              {/* Section C — needs attention */}
              <SectionCard
                eyebrow="Needs attention"
                title="Below the attendance threshold"
                meta={`Watch < ${data.thresholds.pctWatch}% · Critical < ${data.thresholds.pctCritical}%`}
              >
                {data.needsAttention.length === 0 ? (
                  <EmptyState tone="muted" className="m-6">
                    Every student is above the attention threshold this term. Nothing to flag.
                  </EmptyState>
                ) : (
                  <>
                    <ColumnHeads cols="grid-cols-[1fr_120px_72px_88px_80px]">
                      <div>Student</div>
                      <div>Class</div>
                      <div className="text-right">Rate</div>
                      <div className="text-right">Days absent</div>
                      <div>Flag</div>
                    </ColumnHeads>
                    {data.needsAttention.map((n) => (
                      <div
                        key={n.studentId}
                        className="grid grid-cols-1 items-center gap-3 border-b border-border px-6 py-3 text-xs last:border-b-0 hover:bg-bg lg:grid-cols-[1fr_120px_72px_88px_80px]"
                      >
                        <div className="font-display text-sm font-semibold text-navy">
                          {n.name}
                          <span className="ml-1.5 font-mono text-[10px] text-navy-3">
                            {n.studentCode}
                          </span>
                        </div>
                        <div className="text-navy-2">{n.className}</div>
                        <div className="text-right font-mono text-terra">
                          {n.rate == null ? "—" : `${n.rate}%`}
                        </div>
                        <div className="text-right font-mono text-navy-2">{n.daysAbsent}</div>
                        <div>
                          <span
                            className={`inline-flex rounded-pill px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] ${
                              n.severity === "CRITICAL"
                                ? "bg-terra-bg text-terra"
                                : "bg-warn-bg text-warn"
                            }`}
                          >
                            {n.severity === "CRITICAL" ? "Critical" : "Watch"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </SectionCard>
            </>
          )}
        </>
      )}
    </div>
  );
}
