import { requireSchool } from "@/lib/auth/server";
import { getSubjectPerformance } from "@/lib/reports/subject-performance-data";
import { listReportClasses } from "@/lib/reports/academic-term";
import { performanceTone } from "@/lib/reports/grade-band";
import { schoolFile } from "@/lib/filename";
import { ReportHeader } from "@/components/reports/report-header";
import { ReportFilters } from "@/components/reports/report-filters";
import { ExportCsv } from "@/components/reports/export-csv";
import { PrintButton } from "@/components/reports/print-button";
import { EmptyState } from "@/components/ui/empty-state";
import { GradeChip, PointsDelta } from "@/components/reports/perf-chips";
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
export const metadata = { title: "Subject performance" };

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

export default async function SubjectPerformancePage(props: {
  searchParams: Promise<{ periodId?: string; classId?: string }>;
}) {
  const { school } = await requireSchool();
  const sp = await props.searchParams;
  const [data, classes] = await Promise.all([
    getSubjectPerformance(school.id, { periodId: sp.periodId, classId: sp.classId }),
    listReportClasses(school.id),
  ]);
  const { term, terms, priorTerm, rows } = data;
  const hasPrior = !!priorTerm;
  const scopeLabel = data.classId
    ? (classes.find((c) => c.classId === data.classId)?.name ?? null)
    : null;

  const csvRows = rows.map((r) => [
    r.name,
    r.code ?? "",
    r.studentsGraded,
    r.average ?? "",
    r.grade ?? "",
    r.priorAverage ?? "",
    r.delta ?? "",
    r.passRate ?? "",
  ]);

  return (
    <div className="mx-auto max-w-page">
      <ReportHeader
        crumb="Academic / Subject performance"
        pre="Subject"
        gold="performance"
        lede="How each subject is doing across the school this term, on your grade scale — the strong subjects and the ones needing attention."
        actions={
          <>
            <ExportCsv
              filename={schoolFile(school.name, "subject-performance.csv")}
              headers={[
                "Subject",
                "Code",
                "Students assessed",
                "School average",
                "Grade",
                "Last term average",
                "Change (pts)",
                "Pass rate %",
              ]}
              rows={csvRows}
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
        classes={classes}
        activeClassId={data.classId}
      />

      {!term ? (
        <EmptyState tone="muted" className="mt-6">
          No academic term configured yet. Set up a term to see subject performance.
        </EmptyState>
      ) : (
        <>
          <SnapshotPill>
            Snapshot as of <b className="font-bold text-navy">{fmtNow()}</b> · {term.label} ·{" "}
            {term.academicYear}
            {scopeLabel ? <> · {scopeLabel}</> : null}
          </SnapshotPill>

          <KpiStrip>
            <FeaturedKpi
              label={scopeLabel ? `${scopeLabel} average` : "School average"}
              value={data.schoolAverage ?? "—"}
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
                  "first graded term"
                )
              }
            />
            <Kpi
              label="Subjects assessed"
              value={String(data.subjectsAssessed)}
              sub={<>of {data.subjectsTaught} active</>}
            />
            <Kpi
              label="Strongest"
              value={data.strongest ? <span className="text-green">{data.strongest.average}</span> : "—"}
              sub={data.strongest ? data.strongest.name : "no scores yet"}
            />
            <Kpi
              label="Needs attention"
              value={
                data.needsAttention ? (
                  <span className="text-terra">{data.needsAttention.average}</span>
                ) : (
                  "—"
                )
              }
              sub={data.needsAttention ? data.needsAttention.name : "no scores yet"}
            />
          </KpiStrip>

          <SectionCard
            eyebrow={scopeLabel ? `Across ${scopeLabel}` : "Subject averages · school-wide"}
            title="Strongest first"
            meta={`${data.subjectsAssessed} assessed`}
          >
            {!data.hasAnyScores ? (
              <EmptyState tone="muted" className="m-6">
                No graded scores this term. Once teachers enter subject scores in the Gradebook,
                subject performance appears here.
              </EmptyState>
            ) : (
              <>
                <ColumnHeads cols="grid-cols-[1fr_150px_64px_88px_64px_110px]">
                  <div>Subject</div>
                  <div>Average</div>
                  <div>Grade</div>
                  <div>vs last term</div>
                  <div className="text-right">Students</div>
                  <div>Pass rate</div>
                </ColumnHeads>
                {rows.map((r) => (
                  <div
                    key={r.subjectId}
                    className="grid grid-cols-1 items-center gap-3 border-b border-border px-6 py-3.5 text-xs last:border-b-0 hover:bg-bg lg:grid-cols-[1fr_150px_64px_88px_64px_110px]"
                  >
                    <div className="font-display text-sm font-semibold text-navy">
                      {r.name}
                      {r.code ? (
                        <span className="ml-1.5 font-mono text-[10px] text-navy-3">{r.code}</span>
                      ) : null}
                    </div>
                    <PerfBar value={r.average} tone={r.tone} />
                    <div>
                      <GradeChip grade={r.grade} tone={r.tone} />
                    </div>
                    <div>
                      <PointsDelta delta={r.delta} hasPrior={hasPrior} />
                    </div>
                    <div className="text-right font-mono text-[11px] text-navy-3">
                      {r.studentsGraded}
                    </div>
                    <PerfBar value={r.passRate} tone={performanceTone(r.passRate)} suffix="%" />
                  </div>
                ))}
              </>
            )}
          </SectionCard>

          {!hasPrior && data.hasAnyScores && (
            <p className="mt-2 text-[11px] italic text-navy-3">
              Term-on-term comparison appears once a second term has graded scores.
            </p>
          )}
        </>
      )}
    </div>
  );
}
