import type { ReactNode } from "react";
import { requireBoard } from "@/lib/auth/server";
import {
  getSchoolRollup,
  type AttendanceArm,
  type AttendanceStatusTotals,
  type EnrolmentArm,
  type NetPositionFinanceArm,
  type PerformanceArm,
  type PendingArm,
  type RollupArm,
} from "@/lib/rollup/school-rollup";
import { boardGhs } from "@/lib/board/tiles";
import { ReportFilters } from "@/components/reports/report-filters";
import { PerfBar } from "@/components/reports/report-kit";
import { ATTENDANCE_STATUS_ORDER, ATTENDANCE_STATUS_META } from "@/lib/attendance-status";
import { TrendPill, ComingSoon, AbsencePanel } from "@/components/board/board-tiles";
import { cn } from "@/lib/utils";

/**
 * GOV-4 · the read-only board/director dashboard (`/board`, `requireBoard()` — BOARD_MEMBER only).
 * Supersedes the GOV-2/3 minimal shell with Lucy's designed 5-tile dashboard: a summary scan strip +
 * Finance (full-width) · Attendance | Enrolment · Performance | Infrastructure. It reads the SESSION
 * school id (never a URL school id — R339); `?periodId` only picks the term. Every value flows through
 * the omit-not-fake convention:
 *   • treatment A — a solid-border reason for NOT_CAPTURED / NOT_APPLICABLE (no number);
 *   • treatment B — a real, coloured/typed zero for a captured 0;
 *   • treatment C — a dashed, italic "coming soon" for a not-yet-built PendingArm (never a number).
 * Finance appears exactly ONCE (the Finance tile owns the GHS streams; the summary strip carries
 * finance only as the collection-rate %). Trend pills come from EXPOSED deltas only — no fabricated
 * health verdict (the rollup strips ops thresholds — §10 honesty boundary).
 */
export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ periodId?: string }>;
}) {
  const { school } = await requireBoard();
  const { periodId } = await searchParams;
  const rollup = await getSchoolRollup(school.id, { periodId });

  const termLabel = rollup.period
    ? `${rollup.period.label} · ${rollup.period.academicYear}`
    : "No academic period configured";

  const academic = academicSummary(rollup.performance);

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
        {/* Board-pack PDF is a curated GOV-5 artefact — a disabled honest stub until then, never a raw print. */}
        <button
          type="button"
          disabled
          title="Coming soon · GOV-5"
          className="cursor-not-allowed rounded-md border border-border-2 bg-surface px-3 py-1.5 text-xs font-semibold text-navy-3 print:hidden"
        >
          Board pack (PDF)
        </button>
      </div>

      {/* ── Period selector ── */}
      <ReportFilters
        terms={rollup.terms}
        activePeriodId={rollup.period?.periodId ?? null}
        showClass={false}
      />

      {/* ── Summary strip — the scan layer ── */}
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

        {/* Cell 5 · Infrastructure — coming-soon chip (treatment C), never a number. */}
        <div className="rounded-xl border border-dashed border-border-2 bg-bg px-4 py-3.5">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
            Infrastructure
          </div>
          <div className="mt-1 font-display text-lg italic text-navy-3">Not yet captured</div>
          <div className="mt-1 text-[11px] text-navy-3">Coming soon · GOV-7</div>
        </div>
      </div>

      {/* ── Detail tiles — the read layer ── */}
      <FinanceTile arm={rollup.netPositionFinance} />

      <div className="grid gap-4 lg:grid-cols-2">
        <AttendanceTile arm={rollup.attendance} />
        <EnrolmentTile arm={rollup.enrolment} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PerformanceTile performance={rollup.performance} terminal={rollup.terminalResults} />
        <InfrastructureTile arm={rollup.infrastructure} />
      </div>
    </div>
  );
}

/* ───────────────────────────── Summary strip ───────────────────────────── */

function SummaryCell({
  label,
  value,
  sub,
  lead,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  lead?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3.5",
        lead ? "border-gold-soft bg-gold-bg" : "border-border bg-surface",
      )}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">{label}</div>
      <div className="mt-1 font-display text-3xl font-medium leading-none text-navy">{value}</div>
      {sub && <div className="mt-1.5 text-xs leading-relaxed text-navy-3">{sub}</div>}
    </div>
  );
}

/** Cell 3 headline: prefer the captured Basic average; else Senior readiness; else the applicable
 *  tier's honest reason. NO blend across tiers (R357) — one tier's figure, never a mixed number. */
function academicSummary(p: PerformanceArm): { value: string; sub: ReactNode } {
  if (p.basic.status === "CAPTURED" && p.basic.data.overallAverage != null) {
    const d = p.basic.data;
    return {
      value: `${d.overallAverage}%`,
      sub: (
        <>
          {/* GOV-4a — pass rate on the standing cell; null renders absent, never "0%". */}
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
  // Neither captured — surface the reason of the tier that APPLIES (skip a NOT_APPLICABLE tier).
  const applicable = p.basic.status !== "NOT_APPLICABLE" ? p.basic : p.senior;
  return { value: "—", sub: applicable.status === "CAPTURED" ? null : applicable.reason };
}

/* ───────────────────────────── Tile shell ───────────────────────────── */

function Tile({
  title,
  accent,
  meta,
  className,
  children,
}: {
  title: string;
  accent: string;
  meta?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-surface px-[22px] py-5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-medium text-navy">
          {title} <em className="not-italic text-gold">{accent}</em>.
        </h2>
        {meta && <div className="text-[11px] text-navy-3">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

/* ───────────────────────────── Finance tile ───────────────────────────── */

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
          {/* Stream 1 · Fee collections — the feeCollections arm reused verbatim, + a rate bar. */}
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

          {/* Stream 2 · Books — income / expense / net, all WITHIN the one books ledger. */}
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

          {/* Stream 3 · Payroll — school-paid gross monthly; GES/allowance are separate memos. */}
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

/* ───────────────────────────── Attendance tile ───────────────────────────── */

function AttendanceTile({ arm }: { arm: RollupArm<AttendanceArm> }) {
  return (
    <Tile
      title="Attendance"
      accent="this term"
      meta={arm.status === "CAPTURED" ? `${arm.data.totalMarked.toLocaleString("en-GH")} marks recorded` : undefined}
    >
      {arm.status !== "CAPTURED" ? (
        <div className="mt-4">
          <AbsencePanel>{arm.reason}</AbsencePanel>
        </div>
      ) : (
        <>
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
        </>
      )}
    </Tile>
  );
}

/** The five-status segmented bar + a P·L·E·M·A readout — aggregate, no PII. Medical (M) is its own
 *  status (navy-2), the sickbay→attendance readout, never folded into Absent. */
function StatusSplit({ totals }: { totals: AttendanceStatusTotals }) {
  const total =
    totals.present + totals.late + totals.excused + totals.medical + totals.absent;
  return (
    <div className="mt-4">
      <div className="flex h-2.5 w-full overflow-hidden rounded-pill border border-border bg-bg">
        {total > 0 &&
          ATTENDANCE_STATUS_ORDER.map((s) => {
            const count = totals[s.toLowerCase() as keyof AttendanceStatusTotals];
            if (count === 0) return null;
            return (
              <div
                key={s}
                className={ATTENDANCE_STATUS_META[s].seg}
                style={{ flexGrow: count }}
                aria-hidden
              />
            );
          })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px]">
        {ATTENDANCE_STATUS_ORDER.map((s) => {
          const meta = ATTENDANCE_STATUS_META[s];
          const count = totals[s.toLowerCase() as keyof AttendanceStatusTotals];
          return (
            <span key={s} className={meta.num}>
              {meta.letter} {count.toLocaleString("en-GH")}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────── Enrolment tile ───────────────────────────── */

const FEMALE_HEX = "#C77B9E";
const MALE_HEX = "#6B86B0";

function EnrolmentTile({ arm }: { arm: RollupArm<EnrolmentArm> }) {
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
        <EnrolmentBody d={arm.data} />
      )}
    </Tile>
  );
}

function EnrolmentBody({ d }: { d: EnrolmentArm }) {
  const dash = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-GH"));
  return (
    <div className="mt-3 space-y-4">
      {/* Roll headline + net-change pill. */}
      <div className="flex items-center gap-3">
        <div className="font-display text-3xl font-medium leading-none text-navy">
          {d.roll.toLocaleString("en-GH")}
        </div>
        <TrendPill delta={d.netChange} context="this term" flatLabel="no change" />
      </div>

      {/* Gender mini-bar (school-stats pink/blue — a sanctioned non-token exception). */}
      <div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-pill border border-border bg-bg">
          {d.gender.female > 0 && (
            <div style={{ flexGrow: d.gender.female, backgroundColor: FEMALE_HEX }} aria-hidden />
          )}
          {d.gender.male > 0 && (
            <div style={{ flexGrow: d.gender.male, backgroundColor: MALE_HEX }} aria-hidden />
          )}
        </div>
        <div className="mt-1.5 font-mono text-[10px] text-navy-3">
          {d.gender.female}F · {d.gender.male}M
        </div>
      </div>

      {/* Structure lines. */}
      <dl className="space-y-1 text-[13px]">
        <Line label="Active classes" value={d.activeClasses.toLocaleString("en-GH")} />
        <Line label="Avg class size" value={d.avgClassSize.toLocaleString("en-GH")} />
        <Line label="Teaching staff" value={d.teachingStaff.toLocaleString("en-GH")} />
        <Line
          label="Student : teacher"
          value={d.studentTeacherRatio == null ? "—" : `${d.studentTeacherRatio}:1`}
        />
      </dl>

      {/* Intake this term + lifetime exits. Term-windowed nulls render "—", never a fabricated 0. */}
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

/* ───────────────────────────── Performance tile ───────────────────────────── */

function PerformanceTile({
  performance,
  terminal,
}: {
  performance: PerformanceArm;
  terminal: PendingArm;
}) {
  const { basic, senior } = performance;
  return (
    <Tile title="Academic" accent="performance" meta="cross-tier · this term">
      <div className="mt-3 space-y-3">
        {/* Basic — omitted when the tier does not apply (omit-not-fake). */}
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
                {/* GOV-4a — pass rate beside the average; null renders absent, never "0%". */}
                {basic.data.passRate != null && (
                  <span className="text-[11px] font-semibold text-navy-2">
                    {basic.data.passRate}% pass rate
                  </span>
                )}
                <span className="text-[11px] text-navy-3">
                  {basic.data.gradedClasses} {basic.data.gradedClasses === 1 ? "class" : "classes"}{" "}
                  graded
                </span>
                <TrendPill delta={basic.data.overallDelta} unit="pts" context="vs last term" />
              </div>
            ) : (
              <p className="mt-1 text-[13px] leading-relaxed text-navy-3">{basic.reason}</p>
            )}
          </div>
        )}

        {/* Senior — STPSHS readiness completion counts (no scores, no names — §6.2). */}
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
                <span className="font-semibold text-gold">{senior.data.subjectsPartial} partial</span>{" "}
                · <span className="font-semibold text-terra">{senior.data.subjectsAtRisk} at risk</span>
              </div>
            ) : (
              <p className="mt-1 text-[13px] leading-relaxed text-navy-3">{senior.reason}</p>
            )}
          </div>
        )}

        {/* Terminal results — coming soon (GOV-6), treatment C. Reads the pending arm's reason. */}
        <ComingSoon
          eyebrow="Terminal results"
          label="BECE & WASSCE results — coming soon"
          body={pendingReason(terminal)}
          tag="GOV-6"
        />
      </div>
    </Tile>
  );
}

/* ───────────────────────────── Infrastructure tile ───────────────────────────── */

function InfrastructureTile({ arm }: { arm: PendingArm }) {
  return (
    <Tile title="Infrastructure" accent="& facilities">
      <div className="mt-3">
        <ComingSoon label="Not yet captured" body={pendingReason(arm)} tag="GOV-7" />
      </div>
    </Tile>
  );
}

/** A PendingArm is always NOT_CAPTURED at runtime, but the union still carries the (unreachable)
 *  CAPTURED member — narrow to read its forward-looking reason. */
function pendingReason(arm: PendingArm): string {
  return arm.status === "CAPTURED" ? "" : arm.reason;
}

/* ───────────────────────────── Shared stream/line bits ───────────────────────────── */

function StreamCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface px-[22px] py-[18px]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-navy-3">{title}</div>
      {children}
    </section>
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

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-navy-3">{label}</dt>
      <dd className={strong ? "font-display font-medium text-navy" : "font-mono text-navy-2"}>
        {value}
      </dd>
    </div>
  );
}
