import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSchool } from "@/lib/auth/server";
import { isStaff } from "@/lib/access";
import { getPtaMeetingsLanding, type PtaMeetingListItem } from "@/lib/pta/meeting-data";

export const dynamic = "force-dynamic";

/**
 * `/senior/pta/meetings` — the PTA meeting-register landing (SHS module 4.7 / INCR-52): the school's PTA
 * meetings bucketed live / upcoming / past, each a link into its dual register. READ = the shared `isStaff`
 * (R433 — the Secretary is often a non-admin Form Master) + BASIC redirect. WRITE (convene / mark) is gated
 * per-meeting by the server-loaded officer write-gate. OPERATIONAL, SHOWN; State-1 SMS-scheduling DEFERRED.
 */
export default async function PtaMeetingsLandingPage() {
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");
  if (!isStaff(user.roles)) redirect("/dashboard");

  const view = await getPtaMeetingsLanding(school.id, { userId: user.id, roles: user.roles });

  return (
    <div className="pb-20">
      <header className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
          PTA governance · Meeting register
        </div>
        <h1 className="mt-1 font-display text-4xl font-medium leading-tight text-navy">
          Two registers, <em className="italic text-gold">one meeting</em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          Convene a Form, House, or General PTA meeting, then mark two parallel registers on the day — teachers
          and parents, side by side (GES counts both). Teachers are present-by-default; parents are
          absent-by-default until they arrive.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          {view.canConveneAny && (
            <Link
              href="/senior/pta/meetings/new"
              className="rounded-md border border-navy bg-navy px-4 py-2.5 text-[13px] font-bold text-bg hover:brightness-110"
            >
              Convene a meeting
            </Link>
          )}
          {view.canConveneEmergency && (
            <Link
              href="/senior/pta/meetings/new?tier=emergency"
              className="rounded-md border border-terra bg-terra-bg px-4 py-2.5 text-[13px] font-bold text-terra hover:brightness-95"
            >
              Emergency meeting
            </Link>
          )}
        </div>
      </header>

      <Bucket title="Live now" accent="gold" items={view.live} emptyHint="No meeting is live right now." />
      <Bucket title="Upcoming" accent="navy" items={view.upcoming} emptyHint="No upcoming meetings convened." />
      <Bucket title="Past" accent="muted" items={view.past} emptyHint="No past meetings yet." />

      {view.live.length + view.upcoming.length + view.past.length === 0 && (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">No meetings yet</div>
          <p className="mx-auto mt-1 max-w-md text-sm text-navy-3">
            No PTA meeting has been convened. When one is, its dual register appears here.
            {!view.canConveneAny && " Ask an admin or the PTA Secretary to convene the first meeting."}
          </p>
        </div>
      )}
    </div>
  );
}

function Bucket({
  title,
  accent,
  items,
  emptyHint,
}: {
  title: string;
  accent: "gold" | "navy" | "muted";
  items: PtaMeetingListItem[];
  emptyHint: string;
}) {
  if (items.length === 0) return null;
  const tone =
    accent === "gold" ? "text-gold" : accent === "navy" ? "text-navy" : "text-navy-3";
  return (
    <section className="mb-8">
      <div className={`mb-3 text-[10px] font-bold uppercase tracking-[0.14em] ${tone}`}>
        {title} · {items.length}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {items.map((m) => {
          const stateTone =
            m.state === "held"
              ? "border-gold bg-gold-bg text-gold"
              : m.state === "scheduled"
                ? "border-navy bg-bg text-navy"
                : "border-border-2 bg-surface text-navy-3";
          const stateLabel = m.state === "held" ? "Live" : m.state === "scheduled" ? "Upcoming" : "Closed";
          return (
            <Link
              key={m.meetingId}
              href={`/senior/pta/meetings/${m.meetingId}`}
              className="grid grid-cols-1 gap-1 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-gold-bg sm:grid-cols-[1fr_1fr_auto] sm:items-center sm:gap-3"
            >
              <div className="font-display text-[15px] font-semibold text-navy">
                {m.label} <span className="text-[11px] font-normal text-navy-3">· {m.tierLabel}</span>
              </div>
              <div className="text-[12px] text-navy-3">
                {m.dateLabel} · {m.timeLabel} · {m.meetingType}
              </div>
              <span
                className={`justify-self-start rounded-pill border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] sm:justify-self-end ${stateTone}`}
              >
                {stateLabel}
              </span>
            </Link>
          );
        })}
      </div>
      <span className="sr-only">{emptyHint}</span>
    </section>
  );
}
