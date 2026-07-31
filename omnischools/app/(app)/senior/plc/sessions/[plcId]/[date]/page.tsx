import { notFound, redirect } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { canFacilitatePlcSession } from "@/lib/access";
import { getPlcSession } from "@/lib/plc/session-data";
import { PLC_REFLECTION_QUESTIONS } from "@/lib/plc/defaults";
import { SectionHead } from "@/components/vlc/chrome";
import {
  PlcAgendaChecklist,
  PlcAttendanceRegister,
  PlcOpenSessionForm,
  PlcReflectionPanel,
} from "@/components/plc/session-register";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `/senior/plc/sessions/[plcId]/[date]` — the PLC live session register (SHS module 4.6 / INCR-48): the
 * derived lifecycle clock, the term-focus banner, the present-by-default P/L/A register, the facilitator's
 * agenda checklist, the in-app reflection loop, and the DERIVED CPD-points preview. READ = the shared
 * `isStaff` (R368) + BASIC redirect; WRITE = the PLC facilitator (identity) ∥ a break-glass role
 * (`canFacilitatePlcSession`). Everything DERIVES — no stored status/points (R381/R391).
 *
 * Honesty (R394): the SMS arm is entirely absent (in-app only); no NTC-sync/NEW badge/action-items/
 * "sessions cancelled"; the points card is a DERIVED PREVIEW ("will award"), never "auto-posted to
 * ledger" (that is INCR-49). An un-held session shows only "Open session".
 */
export default async function PlcSessionRegisterPage({
  params,
}: {
  params: Promise<{ plcId: string; date: string }>;
}) {
  const { plcId, date } = await params;
  if (!DATE.test(date)) notFound();

  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const view = await getPlcSession(school.id, plcId, date);
  if (!view) notFound();

  const canFacilitate = canFacilitatePlcSession(user.roles, user.id, view.facilitatorUserId);

  // ── un-held: only "Open session" (facilitator / break-glass), never a register or points ──
  if (!view.held) {
    const stateLabel = view.clock.state === "missed" ? "Not held" : "Scheduled";
    return (
      <div className="pb-20">
        <Crumb>PLC · {view.plcName} · {view.typeLabel}</Crumb>
        <h1 className="mt-1 font-display text-3xl font-medium leading-tight text-navy">
          {view.plcName} <em className="italic text-gold">· {view.dateLabel}</em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <div className="rounded-2xl border border-border bg-surface p-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">{stateLabel}</div>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-navy-3">
            No session has been recorded for {view.plcName} on {view.dateLabel}. The facilitator opens the
            session to take the register — a single {view.clock.totalMin}-minute {view.clock.startLabel}
            {" "}meeting.
            {view.termFocus && (
              <>
                {" "}This term&rsquo;s focus: <b className="font-semibold text-navy-2">{view.termFocus}</b>.
              </>
            )}
          </p>
          <div className="mt-5">
            {canFacilitate ? (
              <PlcOpenSessionForm plcId={plcId} date={date} />
            ) : (
              <p className="text-[13px] italic text-navy-3">
                Only the PLC facilitator can open this session.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { clock, points, termProgress, topCpd } = view;
  const canEditRegister = canFacilitate && !clock.writeLocked;

  const viewerMember = view.members.find((m) => m.userId === user.id);
  const viewer = {
    isMember: !!viewerMember,
    isFacilitator: !!viewerMember?.isFacilitator,
    state: viewerMember?.reflectionState ?? null,
  };

  return (
    <div className="pb-24">
      {/* ── head ── */}
      <header className="mb-6">
        <Crumb>PLC · {view.plcName} · {view.typeLabel}{view.periodLabel ? ` · ${view.periodLabel}` : ""}</Crumb>
        <h1 className="mt-1 font-display text-3xl font-medium leading-tight text-navy">
          {view.plcName} <em className="italic text-gold">· {view.dateLabel}</em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          {points.attendedCount} of {view.members.length} present · {clock.state === "held" && !clock.writeLocked
            ? `${clock.remainingMin} min remaining in the live hour`
            : "session recorded"}
          .
          {canFacilitate && clock.writeLocked && (
            <span className="ml-1 italic text-navy-3">
              This session has locked — the register is read-only.
            </span>
          )}
          {!canFacilitate && (
            <span className="ml-1 italic text-navy-3">You have read-only access to this register.</span>
          )}
        </p>
      </header>

      {/* ── lifecycle bar (4 pills — SMS pill removed, R394) ── */}
      <section className="mb-8">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
          Session lifecycle
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {clock.pills.map((p, i) => {
            const tone =
              p.state === "active"
                ? "border-l-gold bg-gold-bg"
                : p.state === "done"
                  ? "border-l-green bg-surface"
                  : "border-l-border-2 bg-surface";
            return (
              <div key={i} className={`rounded-lg border border-border border-l-[3px] p-3 ${tone}`}>
                <div className="text-[12px] font-semibold text-navy">
                  {p.label}
                  {p.state === "active" && <span className="ml-1 text-[10px] text-gold">· LIVE</span>}
                </div>
                <div className="mt-0.5 text-[10px] text-navy-3">{p.detail}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── context bar (NO room, NO "(HoD)" — R373: facilitator is a manual assignment) ── */}
      <section className="mb-8 rounded-2xl border border-border bg-bg p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-navy font-display text-lg font-semibold text-bg">
            {view.iconInitials}
          </div>
          <div className="min-w-[220px] flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
              {view.plcName} · {view.typeLabel}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-navy-2">
              <span>
                Facilitator{" "}
                <b className="font-semibold text-navy">{view.facilitatorName ?? "not assigned"}</b>
              </span>
              <span className="text-navy-3">·</span>
              <span>
                Members <b className="font-semibold text-navy">{view.members.length} expected · {points.attendedCount} present</b>
              </span>
              <span className="text-navy-3">·</span>
              <span>
                {clock.writeLocked ? "Closed" : `${clock.elapsedMin} min in`}
              </span>
            </div>
          </div>
          <span
            className={`rounded-pill border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] ${
              clock.writeLocked ? "border-border-2 bg-surface text-navy-3" : "border-gold bg-gold-bg text-gold"
            }`}
          >
            {clock.writeLocked ? "Recorded" : clock.state === "held" && clock.remainingMin === 0 ? "Reflection window" : "Live"}
          </span>
        </div>
      </section>

      {/* ── focus banner: term focus = HEADLINE (R375), topic beneath — navy ground, SOLID gold-soft ── */}
      <section className="mb-10 rounded-2xl border border-navy bg-navy p-6 text-bg">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold-soft">
          {view.periodLabel ? `${view.periodLabel} focus` : "Term focus"}
        </div>
        <h3 className="mt-1 font-display text-2xl font-semibold text-bg">
          {view.termFocus ?? <span className="text-gold-soft">No term focus set yet</span>}
        </h3>
        {view.topic && (
          <p className="mt-3 rounded-lg border border-gold-soft bg-navy-2 p-3 text-[13px] leading-relaxed text-gold-soft">
            <b className="font-semibold text-gold-soft">This session:</b> {view.topic}
          </p>
        )}
      </section>

      {/* ── attendance register (present-by-default; Late == Present) ── */}
      <section className="mb-10">
        <SectionHead
          eyebrow={`Register · ${points.attendedCount} of ${view.members.length} present`}
          meta="Present-by-default · P or L counts toward CPD attendance · A does not"
        >
          Attendance <em className="italic text-gold">· P / L / A</em>
        </SectionHead>
        <PlcAttendanceRegister sessionId={view.sessionId} members={view.members} canEdit={canEditRegister} />
      </section>

      {/* ── agenda checklist ── */}
      <section className="mb-10">
        <SectionHead eyebrow="Session agenda · facilitator's running checklist" meta="Tick as you go · editable until the session locks">
          Agenda <em className="italic text-gold">· tick as you go</em>
        </SectionHead>
        <PlcAgendaChecklist sessionId={view.sessionId} items={view.agenda} canEdit={canEditRegister} />
      </section>

      {/* ── reflection: the 3 fixed prompts + the in-app loop (member submit + facilitator confirm) ── */}
      <section className="mb-10">
        <SectionHead
          eyebrow="After the session · in-app reflection window"
          meta={`Opens at close · ${clock.reflectionWindowHours}h · closes ${clock.reflectionCloseLabel}`}
        >
          Reflection <em className="italic text-gold">· every attending teacher</em>
        </SectionHead>
        <div className="mb-4 rounded-2xl border border-green bg-green-bg p-5">
          <p className="mb-3 text-[12px] leading-relaxed text-navy-2">
            Each teacher who attended answers three short questions <b className="font-semibold text-navy">in-app</b> within the
            window. A confirmed reflection earns the reflection point (0.5 of the 1-point CPD contract);
            attendance alone earns the attendance point.
          </p>
          {PLC_REFLECTION_QUESTIONS.map((q, i) => (
            <div key={i} className="mb-2 rounded-md border-l-[3px] border-green bg-surface px-4 py-2.5 text-[12px] italic text-navy-2">
              <b className="not-italic font-semibold text-navy">Q{i + 1} ·</b> {q}
            </div>
          ))}
        </div>
        <PlcReflectionPanel
          sessionId={view.sessionId}
          questions={PLC_REFLECTION_QUESTIONS}
          viewer={viewer}
          windowOpen={clock.reflectionWindowOpen}
          canConfirm={canFacilitate}
          members={view.members}
        />
      </section>

      {/* ── derived CPD-points PREVIEW (navy; no-alpha discipline — bg-white/5, text-gold-soft) ── */}
      <section className="mb-10 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-navy bg-navy p-6 text-bg">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold-soft">
            CPD ledger preview · derived, posts to the ledger later
          </div>
          <h3 className="mt-1 font-display text-xl font-medium text-bg">
            Points <em className="italic text-gold">this session will award</em>
          </h3>
          <div className="mt-4 space-y-0">
            <PtsRow label={`${points.attendedCount} attended (P / L)`} value={`+${points.attendedPtsTotal}`} gold />
            <PtsRow label={`${points.absentCount} absent`} value="0.0" />
            <PtsRow
              label={`Reflections confirmed · ${points.reflectionsConfirmed} of ${points.reflectionsConfirmed + points.reflectionsPending}`}
              value={`+${points.reflectionPtsTotal}`}
              gold
            />
            <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-3">
              <span className="text-[12px] font-semibold text-gold-soft">Will award · derived preview</span>
              <b className="font-display text-lg font-semibold text-gold">
                {points.awardedPts} of {points.ceilingPts} pts
              </b>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-snug text-gold-soft">
            A derived preview — nothing is posted to a CPD ledger in this release. Points accrue when the
            ledger ships.
          </p>
        </div>

        {/* side cards: term progress + top CPD */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
              {view.plcName} · term progress
            </div>
            <h4 className="mb-2 mt-1 font-display text-[15px] font-semibold text-navy">
              Sessions <em className="italic text-gold">this term</em>
            </h4>
            <MetaRow label="Sessions held" value={`${termProgress.held} of ${termProgress.target}`} />
            {termProgress.avgAttendancePct != null && (
              <MetaRow label="Avg attendance" value={`${termProgress.avgAttendancePct}%`} />
            )}
            {termProgress.reflectionRatePct != null && (
              <MetaRow label="Reflection confirmed" value={`${termProgress.reflectionRatePct}%`} />
            )}
            <MetaRow label="CPD points dispensed" value={`${termProgress.cpdDispensed}`} last />
          </div>

          {topCpd.length > 0 && (
            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
                Members earning fastest
              </div>
              <h4 className="mb-2 mt-1 font-display text-[15px] font-semibold text-navy">
                Top <em className="italic text-gold">CPD this term</em>
              </h4>
              {topCpd.map((r, i) => (
                <MetaRow key={r.name + i} label={r.name} value={`${r.pts} pts`} last={i === topCpd.length - 1} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── foot bar (derived stats; navy ground, SOLID gold-soft) ── */}
      <section className="rounded-2xl border border-navy bg-navy p-5 text-bg">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <FootStat lab="Attendance" val={`${points.attendedCount} / ${view.members.length}`}>
            {points.absentCount} absent
          </FootStat>
          <FootStat lab="Agenda done" val={`${view.agenda.filter((a) => a.done).length} / ${view.agenda.length}`}>
            items complete
          </FootStat>
          <FootStat lab="Will award" val={`${points.awardedPts} pts`}>
            of {points.ceilingPts} possible
          </FootStat>
          <FootStat lab={clock.writeLocked ? "Status" : "Remaining"} val={clock.writeLocked ? "Recorded" : `${clock.remainingMin} min`}>
            {clock.writeLocked ? `Locked ${clock.reflectionCloseLabel}` : `Closes ${clock.closeLabel}`}
          </FootStat>
        </div>
      </section>
    </div>
  );
}

function Crumb({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">{children}</div>;
}

function PtsRow({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-white/10 py-2 text-[12px] text-gold-soft last:border-b-0">
      <span>{label}</span>
      <b className={`font-semibold ${gold ? "text-gold" : "text-bg"}`}>{value}</b>
    </div>
  );
}

function MetaRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1.5 text-[11px] text-navy-2 ${last ? "" : "border-b border-border"}`}>
      <span>{label}</span>
      <b className="font-semibold text-navy">{value}</b>
    </div>
  );
}

function FootStat({ lab, val, children }: { lab: string; val: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gold-soft">{lab}</div>
      <div className="mt-1 font-display text-2xl font-semibold leading-none text-gold">{val}</div>
      <div className="mt-1.5 text-[11px] leading-snug text-gold-soft">{children}</div>
    </div>
  );
}
