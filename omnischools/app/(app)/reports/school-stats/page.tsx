import { requireSchool } from "@/lib/auth/server";
import { getSchoolStats, type ClassComposition } from "@/lib/reports/school-stats-data";
import { ExportCsv } from "@/components/reports/export-csv";
import { PrintButton } from "@/components/reports/print-button";
import { ReportHeader } from "@/components/reports/report-header";
import { schoolFile } from "@/lib/filename";

export const dynamic = "force-dynamic";
export const metadata = { title: "School at a glance" };

// Quiet pink/blue gender palette — deliberately distinct from the gold/terra of fee data.
const FEMALE = "#C77B9E";
const MALE = "#6B86B0";

const fmtSnapshot = (d: Date) =>
  d.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

export default async function SchoolStatsPage() {
  const { school } = await requireSchool();
  const s = await getSchoolStats(school.id);
  const { gender, enrolmentFlow: flow } = s;
  const term = s.term;

  const ratioLabel = s.studentTeacherRatio == null ? "—" : `${s.studentTeacherRatio}:1`;
  const flowLabel = term
    ? `Enrolment flow · ${term.periodLabel} · ${term.academicYear}`
    : "Enrolment flow";

  return (
    <div className="mx-auto max-w-page">
      <ReportHeader
        crumb="School stats / At a glance"
        pre="School"
        gold="at a glance"
        lede="Headcount, composition, and the term's enrolment flow. Updated live as records change."
        actions={
          <>
            <ExportCsv
              filename={schoolFile(school.name, "school-at-a-glance.csv")}
              headers={["Class", "Capacity", "Students", "Female", "Male", "Utilisation %"]}
              rows={s.byClass.map((c) => [
                c.name,
                c.targetCapacity == null ? "" : String(c.targetCapacity),
                String(c.enrolled),
                String(c.femaleCount),
                String(c.maleCount),
                c.utilisationPct == null ? "" : String(c.utilisationPct),
              ])}
            />
            <PrintButton label="GES return PDF" />
          </>
        }
      />

      {/* Snapshot pill */}
      <div className="mb-5 inline-flex items-center gap-2 rounded-pill border border-gold-soft bg-gold-bg px-3 py-1.5 text-[11px] text-navy-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green" />
        Snapshot as of <b className="font-bold text-navy">{fmtSnapshot(s.snapshotAt)}</b>
        {term ? (
          <>
            {" "}
            · academic year <b className="font-bold text-navy">{term.academicYear}</b> · Term{" "}
            <b className="font-bold text-navy">{term.periodNumber}</b>
          </>
        ) : (
          <>
            {" "}
            · academic year <b className="font-bold text-navy">—</b>
          </>
        )}
      </div>

      {/* Headcount KPI strip */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Featured: total students */}
        <div className="rounded-xl border border-navy bg-navy p-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold-soft">
            Total students
          </div>
          <div className="mt-1.5 font-display text-3xl font-semibold leading-none text-bg">
            {s.totalStudents}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-gold-soft">
            <span className="text-green">↑</span>
            <span>
              <b className="font-semibold text-bg">+{s.joinedThisTerm}</b>{" "}
              {term ? "since the start of this term" : "joined (no term configured)"}
            </span>
          </div>
        </div>

        <Kpi
          label="Teaching staff"
          value={String(s.teachingStaff)}
          sub={
            <>
              student:teacher ratio <b className="font-semibold text-navy">{ratioLabel}</b>
            </>
          }
        />
        <Kpi
          label="Active classes"
          value={String(s.activeClasses)}
          sub={<>{s.levelSummary}</>}
        />
        <Kpi
          label="Avg class size"
          value={String(s.avgClassSize)}
          sub={
            <>
              range{" "}
              <b className="font-semibold text-navy">
                {s.classSizeMin} — {s.classSizeMax}
              </b>
            </>
          }
        />
      </div>

      {/* Class composition + gender breakdown */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        {/* Class composition (load-bearing) */}
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
            <div>
              <div className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-gold">
                Class composition
              </div>
              <h3 className="font-display text-[17px] font-semibold text-navy">
                Students per class
              </h3>
            </div>
            <div className="max-w-[14rem] text-right text-[11px] text-navy-3">
              The vertical line marks each class&apos;s target capacity
            </div>
          </div>

          {s.byClass.length === 0 ? (
            <Empty>No active classes yet. Create classes to see composition here.</Empty>
          ) : (
            <>
              {/* Column heads */}
              <div className="hidden grid-cols-[100px_1fr_64px_72px_1fr] items-center gap-3 border-b border-border bg-bg px-6 py-3 text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3 lg:grid">
                <div>Class</div>
                <div>Capacity</div>
                <div className="text-right">Students</div>
                <div></div>
                <div>Gender</div>
              </div>
              <div>
                {s.byClass.map((c) => (
                  <ClassRow key={c.classId} c={c} />
                ))}
              </div>
            </>
          )}
        </section>

        {/* Gender breakdown */}
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-6 py-4">
            <div className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-gold">
              Gender breakdown
            </div>
            <h3 className="font-display text-[17px] font-semibold text-navy">
              School-wide ratio
            </h3>
          </div>
          <div className="px-6 py-6">
            {gender.total === 0 ? (
              <Empty>No active students to break down yet.</Empty>
            ) : (
              <div className="text-center">
                <GenderDonut female={gender.female} total={gender.total} />
                <div className="mt-5 grid grid-cols-2 gap-3 text-left">
                  <div
                    className="rounded-lg border p-3"
                    style={{ backgroundColor: "#FBF1F6", borderColor: "rgba(199,123,158,0.22)" }}
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: FEMALE }}
                      />
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
                        Female
                      </span>
                    </div>
                    <div className="font-display text-lg font-semibold text-navy">
                      {gender.female}
                    </div>
                    <div className="mt-0.5 text-[11px] text-navy-3">
                      {gender.femalePct}%
                      {gender.femalePct >= 50 && gender.femalePct <= 55 ? " · slight majority" : ""}
                    </div>
                  </div>
                  <div
                    className="rounded-lg border p-3"
                    style={{ backgroundColor: "#F0F3F8", borderColor: "rgba(107,134,176,0.22)" }}
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: MALE }}
                      />
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
                        Male
                      </span>
                    </div>
                    <div className="font-display text-lg font-semibold text-navy">
                      {gender.male}
                    </div>
                    <div className="mt-0.5 text-[11px] text-navy-3">
                      {gender.malePct}%
                      {gender.malePct >= 50 && gender.malePct <= 55 ? " · slight majority" : ""}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Enrolment flow */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <div className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-gold">
              {flowLabel}
            </div>
            <h3 className="font-display text-[17px] font-semibold text-navy">
              Who joined, who left
            </h3>
          </div>
          <div className="text-[11px] text-navy-3">Net change since the start of this term</div>
        </div>
        <div className="px-6 py-5">
          <div className="divide-y divide-border">
            <FlowRow
              icon="+"
              tone="in"
              what="New admissions"
              sub="Joined this term"
              value={`+${flow.newAdmissions}`}
            />
            <FlowRow
              icon="−"
              tone="out"
              what="Withdrew"
              sub="Parent-initiated departures"
              value={`−${flow.withdrew}`}
            />
            <FlowRow
              icon="→"
              tone="out"
              what="Transferred out"
              sub="Moved to another school"
              value={`−${flow.transferred}`}
            />
            <FlowRow
              icon="G"
              tone="grad"
              what="Graduated"
              sub="Completed their final year"
              value={String(flow.graduated)}
            />
          </div>

          {/* Net change footer */}
          <div className="mt-4 flex items-center justify-between rounded-lg bg-bg px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
              Net change since start of term
            </div>
            <div className="font-display text-lg font-semibold text-green">
              {flow.netChange >= 0 ? "+" : "−"}
              {Math.abs(flow.netChange)} students
            </div>
          </div>

          <p className="mt-3 text-[11px] italic text-navy-3">
            Withdrawals, transfers and graduations shown are current totals — per-term exit dating
            arrives when status history is tracked.
          </p>
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">{label}</div>
      <div className="mt-1.5 font-display text-3xl font-semibold leading-none text-navy">{value}</div>
      <div className="mt-2 text-xs text-navy-3">{sub}</div>
    </div>
  );
}

const FLAG_STYLE: Record<string, string> = {
  Under: "border border-border bg-bg text-navy-3",
  Ok: "bg-green-bg text-green",
  Full: "bg-gold-bg text-gold",
  Over: "bg-terra-bg text-terra",
};

function ClassRow({ c }: { c: ClassComposition }) {
  const util = c.utilisationPct;
  const over = util != null && util > 110;
  // Bar fill colour: green under target, gold/warn at-or-near 100–110, terra over.
  const fillClass =
    util == null
      ? "bg-navy-3"
      : util > 110
        ? "bg-terra"
        : util >= 100
          ? "bg-gold"
          : "bg-green";
  // Visual fill — cap at 100% of the track; over-capacity is signalled by colour + %.
  const fillWidth = util == null ? 0 : Math.min(100, util);
  // Target line sits at the 100% mark, but pulled in when the class is over so it stays visible.
  const targetLeft = over ? 86 : 97;

  const genderTotal = c.femaleCount + c.maleCount;
  const femaleFlex = genderTotal > 0 ? c.femaleCount : 1;
  const maleFlex = genderTotal > 0 ? c.maleCount : 1;

  return (
    <div className="grid grid-cols-1 items-center gap-3 border-b border-border px-6 py-3.5 text-xs last:border-b-0 hover:bg-bg lg:grid-cols-[100px_1fr_64px_72px_1fr]">
      {/* Class + teacher */}
      <div className="font-display text-sm font-semibold text-navy">
        {c.name}
        <div className="mt-0.5 text-[10px] font-medium text-navy-3">
          {c.teacherName ?? "No class teacher"}
        </div>
      </div>

      {/* Capacity */}
      {c.targetCapacity == null ? (
        <div className="text-[11px] italic text-navy-3">no target set</div>
      ) : (
        <div className="flex items-center gap-2.5">
          <div className="relative h-2.5 flex-1 rounded-pill border border-border bg-bg">
            <div className="absolute inset-0 overflow-hidden rounded-pill">
              <div
                className={`h-full rounded-pill ${fillClass}`}
                style={{ width: `${fillWidth}%` }}
              />
            </div>
            {/* target marker — vertical line at the 100% position, atop the bar */}
            <span
              className="absolute -top-0.5 h-3.5 w-0.5 rounded-sm bg-navy"
              style={{ left: `${targetLeft}%` }}
            />
          </div>
          <span
            className={`min-w-[34px] text-right font-display text-xs font-semibold ${over ? "text-terra" : "text-navy"}`}
          >
            {util}%
          </span>
        </div>
      )}

      {/* Students */}
      <div className={`text-right font-display text-sm font-semibold ${over ? "text-terra" : "text-navy"}`}>
        {c.enrolled}
      </div>

      {/* Flag */}
      <div>
        {c.flag && (
          <span
            className={`inline-flex rounded-pill px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] ${FLAG_STYLE[c.flag]}`}
          >
            {c.flag}
          </span>
        )}
      </div>

      {/* Gender mini-bar */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-2 flex-1 gap-1 overflow-hidden rounded-pill">
          <span
            className="h-full rounded-pill"
            style={{ flex: femaleFlex, backgroundColor: FEMALE }}
          />
          <span
            className="h-full rounded-pill"
            style={{ flex: maleFlex, backgroundColor: MALE }}
          />
        </div>
        <span className="shrink-0 font-mono text-[10px] text-navy-3">
          {c.femaleCount}F · {c.maleCount}M
        </span>
      </div>
    </div>
  );
}

function GenderDonut({ female, total }: { female: number; total: number }) {
  const r = 56;
  const c = 2 * Math.PI * r;
  const femaleLen = total > 0 ? (female / total) * c : 0;
  return (
    <div className="relative mx-auto h-40 w-40">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
        {/* male = full ring underneath */}
        <circle cx="70" cy="70" r={r} fill="none" stroke={MALE} strokeWidth="22" />
        {/* female arc on top */}
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={FEMALE}
          strokeWidth="22"
          strokeDasharray={`${femaleLen} ${c - femaleLen}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-display text-3xl font-semibold leading-none text-navy">{total}</div>
        <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
          Total
        </div>
      </div>
    </div>
  );
}

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
    tone === "in"
      ? "bg-green-bg text-green"
      : tone === "out"
        ? "bg-terra-bg text-terra"
        : "bg-gold-bg text-gold";
  const numTone = tone === "in" ? "text-green" : tone === "out" ? "text-terra" : "text-gold";
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
      <div className={`font-display text-[22px] font-semibold ${numTone}`}>{value}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-6 rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
      {children}
    </p>
  );
}
