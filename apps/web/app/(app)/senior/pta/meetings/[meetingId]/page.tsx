import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireSchool } from "@/lib/auth/server";
import { isStaff } from "@/lib/access";
import { getPtaMeeting } from "@/lib/pta/meeting-data";
import {
  PtaAgendaChecklist,
  PtaDualRegister,
  PtaQuorumPanel,
} from "@/components/pta/meeting-register";

export const dynamic = "force-dynamic";

/**
 * `/senior/pta/meetings/[meetingId]` — the live dual teacher/parent register (SHS module 4.7 / INCR-52):
 * the derived lifecycle bar, the context bar, the two parallel registers (teacher present-by-default vs
 * parent absent-by-default), the agenda checklist, and the quorum panel. READ = the shared `isStaff` (R433)
 * + BASIC redirect; WRITE = the PTA's Secretary by identity ∥ break-glass (`canWrite` from the reader, the
 * SAME decision the server actions enforce). Everything DERIVES — no stored status/counts (R432/R435).
 */
export default async function PtaMeetingRegisterPage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const { meetingId } = await params;
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");
  if (!isStaff(user.roles)) redirect("/dashboard");

  const view = await getPtaMeeting(school.id, meetingId, { userId: user.id, roles: user.roles });
  if (!view) notFound();

  const { clock, quorum } = view;
  // The minutes CTA appears once the meeting has ENDED (now ≥ end) AND the viewer may write (Secretary ∥
  // break-glass) — the same conditions the draft-create action enforces (R450).
  const meetingEnded = Date.now() >= clock.endMs;

  return (
    <div className="pb-24">
      <header className="mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
          <Link href="/senior/pta/meetings" className="hover:text-navy">PTA · Meetings</Link> · {view.tierLabel}
          {view.periodLabel ? ` · ${view.periodLabel}` : ""}
        </div>
        <h1 className="mt-1 font-display text-3xl font-medium leading-tight text-navy">
          {view.label} <em className="italic text-gold">· {view.dateLabel}</em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          {view.meetingType} · {view.timeLabel}
          {view.location ? ` · ${view.location}` : ""}.
          {clock.state === "held" && !clock.writeLocked && (
            <span className="ml-1 text-navy-2">Live now — mark arrivals as they come.</span>
          )}
          {clock.writeLocked && <span className="ml-1 italic text-navy-3">This meeting has locked — the register is read-only.</span>}
          {!view.canWrite && !clock.writeLocked && (
            <span className="ml-1 italic text-navy-3">You have read-only access to this register.</span>
          )}
        </p>
      </header>

      {/* lifecycle bar (4 derived pills) */}
      <section className="mb-8">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Meeting lifecycle</div>
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
                  {p.state === "active" && <span className="ml-1 text-[10px] text-gold">· NOW</span>}
                </div>
                <div className="mt-0.5 text-[10px] text-navy-3">{p.detail}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* context bar */}
      <section className="mb-8 rounded-2xl border border-border bg-bg p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-navy font-display text-lg font-semibold text-bg">
            {view.iconInitials}
          </div>
          <div className="min-w-[220px] flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
              {view.label} · {view.tierLabel}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-navy-2">
              <span>
                Teachers <b className="font-semibold text-navy">{quorum.teacherPresent} / {quorum.teacherTotal} present</b>
              </span>
              <span className="text-navy-3">·</span>
              <span>
                Parents <b className="font-semibold text-navy">{quorum.presentCount} / {quorum.totalParents} present</b>
              </span>
              <span className="text-navy-3">·</span>
              <span>{clock.writeLocked ? "Closed" : clock.state === "scheduled" ? "Scheduled" : `${clock.elapsedMin} min in`}</span>
            </div>
          </div>
          <span
            className={`rounded-pill border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] ${
              clock.writeLocked ? "border-border-2 bg-surface text-navy-3" : clock.state === "held" ? "border-gold bg-gold-bg text-gold" : "border-navy bg-bg text-navy"
            }`}
          >
            {clock.writeLocked ? "Recorded" : clock.state === "held" ? "Live" : "Scheduled"}
          </span>
        </div>
      </section>

      {/* post-meeting minutes CTA — appears once ended + the viewer can write (R450) */}
      {meetingEnded && view.canWrite && (
        <section className="mb-8">
          <Link
            href={`/senior/pta/meetings/${view.meetingId}/minutes`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold-soft bg-gold-bg p-5 hover:brightness-[0.98]"
          >
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Post-meeting</div>
              <div className="font-display text-lg font-semibold text-navy">Draft the minutes</div>
              <p className="mt-0.5 text-[12px] text-navy-3">
                Classify each agenda item, capture actions and resolutions, then submit to the Chair.
              </p>
            </div>
            <span className="rounded-md border border-navy bg-navy px-4 py-2 text-[13px] font-bold text-bg">Draft minutes →</span>
          </Link>
        </section>
      )}

      {/* dual register */}
      <section className="mb-8">
        <PtaDualRegister
          meetingId={view.meetingId}
          teacherRows={view.teacherRows}
          parentRows={view.parentRows}
          canWrite={view.canWrite}
          closed={clock.parentsFinalised}
        />
      </section>

      {/* quorum panel */}
      <section className="mb-8">
        <PtaQuorumPanel
          meetingId={view.meetingId}
          ruleText={quorum.ruleText}
          presentCount={quorum.presentCount}
          totalParents={quorum.totalParents}
          pct={quorum.pct}
          quorumMet={quorum.quorumMet}
          canWrite={view.canWrite}
          writeLocked={clock.writeLocked}
        />
      </section>

      {/* agenda */}
      <section className="mb-8">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Agenda</div>
        <PtaAgendaChecklist meetingId={view.meetingId} items={view.agenda} canWrite={view.canWrite} />
      </section>

      {/* foot bar (derived · navy ground, SOLID gold-soft — no-alpha discipline) */}
      <section className="rounded-2xl border border-navy bg-navy p-5 text-bg">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <FootStat lab="Parents present" val={`${quorum.presentCount} / ${quorum.totalParents}`}>
            P + L (counts toward quorum)
          </FootStat>
          <FootStat lab="Teachers present" val={`${quorum.teacherPresent} / ${quorum.teacherTotal}`}>
            present-by-default
          </FootStat>
          <FootStat lab="Quorum" val={quorum.quorumMet === true ? "Met" : quorum.quorumMet === false ? "Not met" : "—"}>
            {quorum.pct != null ? `${quorum.pct}% turned up` : "the Secretary's call"}
          </FootStat>
          <FootStat lab={clock.writeLocked ? "Status" : "State"} val={clock.writeLocked ? "Locked" : clock.state === "held" ? "Live" : "Scheduled"}>
            {clock.writeLocked ? `Locked ${clock.lockLabel}` : `Locks ${clock.lockLabel}`}
          </FootStat>
        </div>
      </section>
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
