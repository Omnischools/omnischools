import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { BOARDING_ROLES } from "@/lib/access";
import { getExeatBoard, listExeatBoarders, type ExeatRow, type ExeatStage } from "@/lib/boarding/exeat-data";
import { canSignSpecial } from "@/lib/boarding/exeat-decision";
import { ActionBar, BulkApprove, NewExeatButton, RunLateChecks } from "@/components/boarding/exeat-console";

export const dynamic = "force-dynamic";

const TYPE_PILL: Record<ExeatRow["type"], { label: string; cls: string }> = {
  SCHEDULED: { label: "SCHED", cls: "bg-green-bg text-green" },
  SPECIAL: { label: "SPECIAL", cls: "bg-gold-bg text-gold" },
  FEE_COLLECTION: { label: "FEE", cls: "bg-warn-bg text-warn" },
};
const APPROVAL_CLS: Record<ExeatRow["approval"], string> = {
  approved: "text-green",
  pending: "text-warn",
  needs: "text-terra",
};

export default async function ExeatManagementPage() {
  const { school, user } = await requireSchoolRole(BOARDING_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const userId = current?.id ?? user.id;

  const [board, boarders] = await Promise.all([
    getExeatBoard(school.id, roles, userId),
    listExeatBoarders(school.id, roles, userId),
  ]);
  const canSign = canSignSpecial(roles);

  return (
    <div className="mx-auto max-w-page pb-16">
      <div className="mb-5">
        <Link
          href="/senior/boarding"
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-navy-3 hover:text-navy"
        >
          ← Boarding · Houses
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Boarding · Operations · Exeat management
        </div>
        <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
          Exeats · <em className="italic text-gold">in flight &amp; in queue.</em>
        </h1>
        <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
        <p className="max-w-2xl text-sm text-navy-3">
          The formal contract by which a boarder leaves campus — request → HM review → Senior-HM sign
          (special only) → depart → return, each stage timestamped. A fee-owing boarder is routed to a
          fee-collection exeat (never detained — GES rule). Return-by{" "}
          <b className="text-navy-2">{board.policy.returnByTime}</b> is enforced; past it, a late-return
          SMS chain fires to the parent.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="text-[12px] text-navy-3">
          {board.periodLabel ? `${board.periodLabel} · ` : ""}
          {board.windowLabel
            ? `Next window: ${board.windowLabel}`
            : "No scheduled exeat window ahead"}
        </div>
        <NewExeatButton boarders={boarders} />
      </div>

      {/* Summary strip — 5 DERIVED cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <SumCard featured label="Exeats in flight" big={board.summary.inFlight}>
          {board.summary.inFlightSub}
        </SumCard>
        <SumCard label="In queue" big={board.summary.inQueue}>
          {board.summary.queueBreakdown}
        </SumCard>
        <SumCard warn label="Awaiting Senior HM" big={board.summary.awaitingSrHm}>
          Special exeats · HM approved, Senior HM signs
        </SumCard>
        <SumCard label="Returns today" big={board.summary.returnsToday}>
          {board.returnsToday.filter((r) => r.late).length} late · rest on time
        </SumCard>
        <SumCard terra label="Late returns" big={board.summary.lateReturns}>
          {board.summary.lateReturns === 0 ? "Clean · none overdue now" : "Overdue — chain active"}
        </SumCard>
      </div>

      {/* In flight */}
      <Section
        eyebrow={`Currently in flight · ${board.summary.inFlight} exeat${board.summary.inFlight === 1 ? "" : "s"}`}
        title="The exeat in motion"
        meta="5 stages · timestamped at each transition"
      >
        {board.inFlight.length === 0 ? (
          <Empty>No boarder is off campus on exeat right now.</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {board.inFlight.map((ex) => (
              <div key={ex.id} className="overflow-hidden rounded-xl border border-border bg-surface">
                <div className="flex items-center justify-between bg-gold px-5 py-3 text-navy">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em]">
                    {TYPE_PILL[ex.type].label} exeat · in flight · {ex.refCode}
                  </span>
                  <span className="font-mono text-[11px] font-bold">{ex.elapsedLabel}</span>
                </div>
                <div className="px-5 py-4">
                  <div className="mb-3 flex items-center gap-3 border-b border-dashed border-border pb-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-navy font-display text-base font-semibold text-gold">
                      {ex.initials}
                    </span>
                    <div>
                      <div className="font-display text-base font-semibold text-navy">{ex.fullName}</div>
                      <div className="text-[11px] text-navy-3">{ex.addressLine}</div>
                    </div>
                    <div className="ml-auto text-right text-[11px]">
                      <span className="font-mono font-bold text-navy-2">Fees:</span>{" "}
                      <span className={ex.fee.owed ? "font-mono font-bold text-terra" : "font-mono font-bold text-green"}>
                        {ex.fee.label}
                      </span>
                    </div>
                  </div>
                  <Timeline stages={ex.stages} />
                  {ex.reason && <p className="mt-3 text-[11px] italic text-navy-3">Reason · {ex.reason}</p>}
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border bg-bg px-5 py-3">
                  <span className="text-[11px] text-navy-3">Dress · {board.policy.dressCode}</span>
                  <ActionBar exeat={ex} canSign={canSign} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Queue */}
      <Section
        eyebrow={board.windowLabel ? `In queue · ${board.windowLabel}` : "In queue"}
        title="Queue for the next gate"
        meta={`${board.queue.length} request${board.queue.length === 1 ? "" : "s"}`}
        actions={<BulkApprove count={board.cleanCount} />}
      >
        {board.queue.length === 0 ? (
          <Empty>No exeat requests in the queue.</Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="grid grid-cols-[80px_1fr_1fr_140px_110px_120px_minmax(180px,auto)] gap-3 border-b border-border bg-bg px-4 py-2 text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">
              <div>Type</div>
              <div>Student</div>
              <div>Reason</div>
              <div>Out / In</div>
              <div>Fees</div>
              <div>Approval</div>
              <div>Action</div>
            </div>
            {board.queue.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[80px_1fr_1fr_140px_110px_120px_minmax(180px,auto)] items-center gap-3 border-b border-border px-4 py-2.5 text-[12px] last:border-0"
              >
                <div>
                  <span className={`inline-block rounded-pill px-2 py-0.5 text-[9px] font-bold tracking-wide ${TYPE_PILL[r.type].cls}`}>
                    {TYPE_PILL[r.type].label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy text-[9px] font-bold text-gold">
                    {r.initials}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-navy">{r.studentName}</div>
                    <div className="truncate text-[9px] text-navy-3">{r.addressLine}</div>
                  </div>
                </div>
                <div className="truncate text-[11px] text-navy-3">{r.reason ?? "—"}</div>
                <div className="font-mono text-[10px] text-navy-2">
                  {r.outLabel ?? "—"}
                  <br />
                  {r.inLabel ?? "—"}
                </div>
                <div className={`font-mono text-[10px] font-bold ${r.fee.owed ? "text-terra" : "text-green"}`}>
                  {r.fee.label}
                </div>
                <div className={`text-[10px] font-bold ${APPROVAL_CLS[r.approval]}`}>{r.approvalLabel}</div>
                <div>
                  <ActionBar exeat={r} canSign={canSign} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Returns today */}
      <Section
        eyebrow={`Today's returns · ${board.returnsToday.length} back`}
        title="Returns logged today"
        meta={board.returnsToday.some((r) => r.late) ? "some late" : "all on time"}
      >
        {board.returnsToday.length === 0 ? (
          <Empty>No returns logged today yet.</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-2 rounded-xl border border-green bg-green-bg p-4 sm:grid-cols-2">
            {board.returnsToday.map((r) => (
              <div key={r.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 text-[11px]">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-bg ${r.late ? "bg-terra" : "bg-green"}`}>
                  {r.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-navy">{r.studentName}</div>
                  <div className="truncate text-[9px] text-navy-3">{r.addressLine}</div>
                </div>
                <span className={`font-mono text-[10px] font-bold ${r.late ? "text-terra" : "text-green"}`}>
                  {r.timeLabel}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Late-return band */}
      <Section
        eyebrow={`Late-return enforcement · the ${board.policy.returnByTime} line`}
        title={board.late.length === 0 ? "No late returns · the chain is wired" : "Late returns · chain active"}
        meta={`SMS chain relative to ${board.policy.returnByTime}`}
        actions={<RunLateChecks />}
      >
        <div className="rounded-xl border-[1.5px] border-terra bg-terra-bg p-5">
          <div className="mb-3 border-b border-dashed border-terra pb-2">
            <h4 className="font-display text-base font-semibold text-navy">
              Late-return SMS chain · <em className="italic text-terra">three-stage escalation</em>
            </h4>
            <p className="mt-1 text-[11px] text-navy-2">
              Offsets computed from the return-by time ({board.policy.returnByTime}), not hard-coded.
              Sends via the console provider — no real message until Hubtel go-live.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            {board.lateStages.map((st, i) => (
              <div
                key={st.kind}
                className="grid grid-cols-[1fr_90px_120px] items-center gap-3 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[11px]"
              >
                <div className="text-navy-2">
                  <b className="text-navy">Stage {i + 1} · {st.label}</b> ·{" "}
                  {i === 0
                    ? "“Student is now overdue. Please confirm return ETA.” · parent SMS"
                    : i === 1
                      ? "“Student remains overdue. Senior HM notified.” · parent + Senior HM"
                      : "Housemaster calls the parent directly; a formal note may be raised if unresolved (discipline record is INCR-13 — not written here)."}
                </div>
                <div className="font-mono font-bold text-terra">+{st.offsetMin} MIN</div>
                <div className="text-[10px] font-semibold text-navy-3">
                  {i === 2 ? "NOTE · stubbed" : "Auto · console"}
                </div>
              </div>
            ))}
          </div>

          {board.late.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-terra">
                Active late returns
              </div>
              {board.late.map((l) => (
                <div key={l.id} className="grid grid-cols-[1fr_100px_1fr] items-center gap-3 rounded-lg border border-terra bg-surface px-3.5 py-2.5 text-[11px]">
                  <div className="text-navy-2">
                    <b className="text-navy">{l.studentName}</b> · {l.addressLine} · {l.refCode}
                    <div className="text-[10px] text-navy-3">Due {l.returnByLabel ?? "—"}</div>
                  </div>
                  <div className="font-mono font-bold text-terra">{l.overdueLabel}</div>
                  <div className="text-[10px] text-navy-3">
                    Due now: {l.dueStages.length ? l.dueStages.map((k) => k.replace("OVERDUE_STAGE_", "S")).join(" · ") : "—"}
                    {l.sentStages.length > 0 && (
                      <>
                        <br />
                        <span className="text-green">Sent: {l.sentStages.length} stage(s)</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

function Timeline({ stages }: { stages: ExeatStage[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {stages.map((st, i) => (
        <div key={i} className="grid grid-cols-[16px_1fr_auto] items-center gap-3 text-[11px]">
          <span
            className={`h-3.5 w-3.5 rounded-full ${
              st.done ? "bg-green" : st.active ? "bg-gold ring-2 ring-gold-soft" : "bg-border-2"
            }`}
          />
          <span className="text-navy-2">
            <b className={st.active ? "text-gold" : "text-navy"}>{st.label}</b>
            {st.actor ? ` · ${st.actor}` : ""}
          </span>
          <span className={`font-mono text-[10px] ${st.done ? "text-green" : "text-navy-3"}`}>
            {st.timeLabel ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function Section({
  eyebrow,
  title,
  meta,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  meta?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">{eyebrow}</div>
          <h3 className="mt-0.5 font-display text-xl font-semibold text-navy">{title}</h3>
        </div>
        <div className="flex items-center gap-3">
          {meta && <span className="text-[11px] text-navy-3">{meta}</span>}
          {actions}
        </div>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border-2 bg-surface px-4 py-8 text-center text-sm text-navy-3">
      {children}
    </p>
  );
}

function SumCard({
  label,
  big,
  children,
  featured,
  warn,
  terra,
}: {
  label: string;
  big: string | number;
  children: React.ReactNode;
  featured?: boolean;
  warn?: boolean;
  terra?: boolean;
}) {
  const tone = featured
    ? "bg-navy text-bg border-navy"
    : warn
      ? "bg-warn-bg border-warn"
      : terra
        ? "bg-terra-bg border-terra"
        : "bg-surface border-border";
  // Featured muted text uses the SOLID gold-soft token (never slash-opacity on a raw-hex token —
  // no-alpha discipline; proven safe in the roster page's featured card).
  const labelCls = featured
    ? "text-gold-soft"
    : warn
      ? "text-warn"
      : terra
        ? "text-terra"
        : "text-navy-3";
  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className={`text-[10px] font-bold uppercase tracking-[0.12em] ${labelCls}`}>{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold leading-none">{big}</div>
      <div className={`mt-1.5 text-[11px] ${labelCls}`}>{children}</div>
    </div>
  );
}
