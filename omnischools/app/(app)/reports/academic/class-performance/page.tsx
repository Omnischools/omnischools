import { requireSchool } from "@/lib/auth/server";
import { hasAnyRole } from "@/lib/access";
import { getClassPerformance } from "@/lib/reports/class-performance-data";
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
export const metadata = { title: "Class performance" };

const ADMIN_WIDE = ["ADMIN", "HEADMASTER", "VICE_HEADMASTER_ACADEMIC", "BURSAR", "ACCOUNTANT"];
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

export default async function ClassPerformancePage(props: {
  searchParams: Promise<{ periodId?: string }>;
}) {
  const { school, user } = await requireSchool();
  const sp = await props.searchParams;
  const teacherScoped =
    !hasAnyRole(user.roles, ADMIN_WIDE) && hasAnyRole(user.roles, TEACHER_ROLES);
  const data = await getClassPerformance(school.id, {
    periodId: sp.periodId,
    teacherUserId: teacherScoped ? user.id : null,
  });
  const { term, terms, priorTerm, rows, scoped } = data;
  const hasPrior = !!priorTerm;

  const csvRows = rows.map((r) => [
    r.name,
    r.teacherName ?? "",
    r.studentsGraded,
    r.average ?? "",
    r.grade ?? "",
    r.priorAverage ?? "",
    r.delta ?? "",
  ]);

  return (
    <div className="mx-auto max-w-page">
      <ReportHeader
        crumb="Academic / Class performance"
        pre="Class"
        gold="performance"
        lede="Average grades by class this term, set against last term — weighted totals on your school's grade scale."
        actions={
          <>
            <ExportCsv
              filename={schoolFile(school.name, "class-performance.csv")}
              headers={[
                "Class",
                "Teacher",
                "Students graded",
                "This term average",
                "Grade",
                "Last term average",
                "Change (pts)",
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
        showClass={false}
      />

      {!term ? (
        <EmptyState tone="muted" className="mt-6">
          No academic term configured yet. Set up a term to see class performance.
        </EmptyState>
      ) : rows.length === 0 && scoped ? (
        <EmptyState tone="muted" className="mt-6">
          You have no classes assigned this term.
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
              label={scoped ? "Your average" : "School average"}
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
              label="Classes graded"
              value={`${data.classesGraded}/${data.totalClasses}`}
              sub={<>with ≥1 score this term</>}
            />
            <Kpi
              label="Highest class"
              value={data.highest ? <span className="text-green">{data.highest.average}</span> : "—"}
              sub={data.highest ? data.highest.name : "no scores yet"}
            />
            <Kpi
              label="Needs support"
              value={
                data.needsSupport ? (
                  <span className="text-terra">{data.needsSupport.average}</span>
                ) : (
                  "—"
                )
              }
              sub={data.needsSupport ? data.needsSupport.name : "no scores yet"}
            />
          </KpiStrip>

          <SectionCard
            eyebrow="Class averages"
            title="This term vs last"
            meta={hasPrior ? "Weighted totals on the grade scale" : "No prior term to compare"}
          >
            {!data.hasAnyScores ? (
              <EmptyState tone="muted" className="m-6">
                No graded scores in {term.label} yet. Enter scores in the Gradebook and class
                performance appears here.
              </EmptyState>
            ) : (
              <>
                <ColumnHeads cols="grid-cols-[130px_1fr_64px_96px_64px]">
                  <div>Class</div>
                  <div>This term</div>
                  <div>Grade</div>
                  <div>vs last term</div>
                  <div className="text-right">Entries</div>
                </ColumnHeads>
                {rows.map((r) => (
                  <div
                    key={r.classId}
                    className="grid grid-cols-1 items-center gap-3 border-b border-border px-6 py-3.5 text-xs last:border-b-0 hover:bg-bg lg:grid-cols-[130px_1fr_64px_96px_64px]"
                  >
                    <div className="font-display text-sm font-semibold text-navy">
                      {r.name}
                      <div className="mt-0.5 text-[10px] font-medium text-navy-3">
                        {r.teacherName ?? "No class teacher"}
                      </div>
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
