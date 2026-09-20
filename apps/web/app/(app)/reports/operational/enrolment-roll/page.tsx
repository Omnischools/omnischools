import { requireSchool } from "@/lib/auth/server";
import { getEnrolmentRoll } from "@/lib/reports/enrolment-roll-data";
import { schoolFile } from "@/lib/filename";
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
} from "@/components/reports/report-kit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Enrolment & roll" };

const FEMALE = "#C77B9E";
const MALE = "#6B86B0";

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

function FlowRow({
  icon,
  tone,
  what,
  sub,
  value,
}: {
  icon: string;
  tone: "in" | "out" | "grad";
  what: string;
  sub: string;
  value: string;
}) {
  const dot =
    tone === "in" ? "bg-green-bg text-green" : tone === "out" ? "bg-terra-bg text-terra" : "bg-gold-bg text-gold";
  const num = tone === "in" ? "text-green" : tone === "out" ? "text-terra" : "text-gold";
  return (
    <div className="flex items-center gap-3 py-3">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${dot}`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-display text-[13px] font-semibold text-navy">{what}</div>
        <div className="mt-px text-[11px] text-navy-3">{sub}</div>
      </div>
      <div className={`font-display text-[22px] font-semibold ${num}`}>{value}</div>
    </div>
  );
}

export default async function EnrolmentRollPage(props: {
  searchParams: Promise<{ periodId?: string }>;
}) {
  const { school } = await requireSchool();
  const sp = await props.searchParams;
  const data = await getEnrolmentRoll(school.id, { periodId: sp.periodId });
  const { term, terms, priorTerm } = data;
  const hasPrior = !!priorTerm;

  const classCsv = data.byClass.map((c) => [
    c.name,
    c.admitted,
    c.female,
    c.male,
    c.currentSize,
    c.priorAdmitted ?? "",
  ]);
  const flowCsv: (string | number)[][] = [
    ["New admissions", data.admissionsThisTerm, "this term"],
    ["Withdrew", data.withdrew, "lifetime total"],
    ["Transferred out", data.transferred, "lifetime total"],
    ["Graduated", data.graduated, "lifetime total"],
    ["Net change", data.netChange, "this term"],
  ];
  const maxAdmitted = Math.max(1, ...data.byClass.map((c) => c.admitted));

  return (
    <div className="mx-auto max-w-page">
      <ReportHeader
        crumb="Operational / Enrolment & roll"
        pre="Enrolment &"
        gold="roll"
        lede="Admissions this term and the current roll — with lifetime exits, honestly labelled."
        actions={
          <>
            <ExportCsv
              filename={schoolFile(school.name, "enrolment-by-class.csv")}
              headers={["Class", "Admitted this term", "Girls", "Boys", "Current size", "Last term admitted"]}
              rows={classCsv}
            />
            <ExportCsv
              label="Enrolment-flow CSV"
              filename={schoolFile(school.name, "enrolment-flow.csv")}
              headers={["Metric", "Count", "Basis"]}
              rows={flowCsv}
            />
            <PrintButton label="GES return PDF" />
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
          No academic term configured yet. Set up a term to see enrolment.
        </EmptyState>
      ) : !data.hasAnyStudents ? (
        <EmptyState tone="muted" className="mt-6">
          No students on the roll yet. Admit students to see enrolment here.
        </EmptyState>
      ) : (
        <>
          <SnapshotPill>
            Snapshot as of <b className="font-bold text-navy">{fmtNow()}</b> · {term.label} ·{" "}
            {term.academicYear}
          </SnapshotPill>

          <KpiStrip>
            <FeaturedKpi
              label="Current roll"
              value={data.currentRoll}
              sub={
                data.admissionsThisTerm > 0 ? (
                  <span>
                    <span className="text-green">↑</span>{" "}
                    <b className="font-semibold text-bg">+{data.admissionsThisTerm}</b> of these
                    joined this term
                  </span>
                ) : (
                  "active students on the roll today"
                )
              }
            />
            <Kpi
              label="Admissions this term"
              value={<span className="text-green">+{data.admissionsThisTerm}</span>}
              sub={
                hasPrior && data.priorAdmissions != null ? (
                  <>vs +{data.priorAdmissions} admitted last term</>
                ) : (
                  <>no earlier term to compare</>
                )
              }
            />
            <Kpi
              label="Intake mix"
              value={`${data.intakeFemale}/${data.intakeMale}`}
              sub={<>girls / boys in this term&apos;s intake</>}
            />
            <Kpi
              label="Lifetime exits"
              value={<span className="text-navy-3">{data.lifetimeExits}</span>}
              sub={<>withdrawn + transferred + graduated</>}
            />
          </KpiStrip>

          {/* Section A — flow */}
          <SectionCard
            eyebrow={`Enrolment flow · ${term.label} · ${term.academicYear}`}
            title="Who joined, who left"
            meta="This term's admissions · lifetime exits"
          >
            <div className="px-6 py-5">
              <div className="divide-y divide-border">
                <FlowRow
                  icon="+"
                  tone="in"
                  what="New admissions"
                  sub="Joined this term"
                  value={`+${data.admissionsThisTerm}`}
                />
                <FlowRow
                  icon="−"
                  tone="out"
                  what="Withdrew"
                  sub="Parent-initiated departures · lifetime total"
                  value={`−${data.withdrew}`}
                />
                <FlowRow
                  icon="→"
                  tone="out"
                  what="Transferred out"
                  sub="Moved to another school · lifetime total"
                  value={`−${data.transferred}`}
                />
                <FlowRow
                  icon="G"
                  tone="grad"
                  what="Graduated"
                  sub="Completed their final year · lifetime total"
                  value={String(data.graduated)}
                />
              </div>
              <div className="mt-4 flex items-center justify-between rounded-lg bg-bg px-4 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
                  Net change this term
                </div>
                <div className="font-display text-lg font-semibold text-green">
                  +{data.netChange} students
                </div>
              </div>
              <p className="mt-3 text-[11px] italic text-navy-3">
                Withdrawals, transfers and graduations shown are current totals — per-term exit
                dating arrives when status history is tracked.
              </p>
            </div>
          </SectionCard>

          {/* Section B — admissions by class */}
          <SectionCard
            eyebrow="Admissions by class"
            title="New students per class"
            meta={hasPrior ? "vs last term's intake" : "No prior term to compare"}
          >
            {data.admissionsThisTerm === 0 ? (
              <EmptyState tone="muted" className="m-6">
                No admissions recorded in {term.label}. New enrolments appear here as students are
                admitted.
              </EmptyState>
            ) : (
              <>
                <ColumnHeads cols="grid-cols-[130px_1fr_120px_88px_88px]">
                  <div>Class</div>
                  <div>Admitted</div>
                  <div>Girls / Boys</div>
                  <div className="text-right">Current size</div>
                  <div>vs last</div>
                </ColumnHeads>
                {data.byClass.map((c) => {
                  const genderTotal = c.female + c.male;
                  return (
                    <div
                      key={c.classId}
                      className="grid grid-cols-1 items-center gap-3 border-b border-border px-6 py-3.5 text-xs last:border-b-0 hover:bg-bg lg:grid-cols-[130px_1fr_120px_88px_88px]"
                    >
                      <div className="font-display text-sm font-semibold text-navy">
                        {c.name}
                        <div className="mt-0.5 text-[10px] font-medium text-navy-3">
                          {c.teacherName ?? "No class teacher"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className="relative h-2.5 flex-1 rounded-pill border border-border bg-bg">
                          <div
                            className="absolute inset-y-0 left-0 rounded-pill bg-green"
                            style={{ width: `${Math.round((c.admitted / maxAdmitted) * 100)}%` }}
                          />
                        </div>
                        <span className="min-w-[24px] text-right font-mono text-xs font-semibold text-navy">
                          {c.admitted}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex h-2 flex-1 gap-1 overflow-hidden rounded-pill">
                          <span
                            className="h-full rounded-pill"
                            style={{ flexGrow: genderTotal > 0 ? c.female : 1, backgroundColor: FEMALE }}
                          />
                          <span
                            className="h-full rounded-pill"
                            style={{ flexGrow: genderTotal > 0 ? c.male : 1, backgroundColor: MALE }}
                          />
                        </div>
                        <span className="shrink-0 font-mono text-[10px] text-navy-3">
                          {c.female}F·{c.male}M
                        </span>
                      </div>
                      <div className="text-right font-mono text-navy">{c.currentSize}</div>
                      <div>
                        <PointsDelta delta={c.delta} hasPrior={hasPrior} unit="students" />
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
