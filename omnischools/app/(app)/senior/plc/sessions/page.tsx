import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSchool } from "@/lib/auth/server";
import { hasAnyRole, PLC_SESSION_BREAKGLASS_ROLES } from "@/lib/access";
import { getPlcSessionsLanding } from "@/lib/plc/session-data";
import { SectionHead } from "@/components/vlc/chrome";

export const dynamic = "force-dynamic";

/**
 * `/senior/plc/sessions` — the PLC session-register landing (SHS module 4.6 / INCR-48): the viewer's PLCs
 * (facilitator ∥ member, or all for a break-glass role) with this week's Friday state, plus recent held
 * sessions. READ gate = the shared `isStaff` (R368, delivered by `requireSchool`) + BASIC redirect. A
 * facilitator (or break-glass) opens/runs a session; a plain member reaches the register to reflect.
 * OPERATIONAL, SHOWN, no PII.
 */
export default async function PlcSessionsLandingPage() {
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const seesAll = hasAnyRole(user.roles, PLC_SESSION_BREAKGLASS_ROLES);
  const view = await getPlcSessionsLanding(school.id, { userId: user.id, roles: user.roles }, seesAll);

  return (
    <div className="pb-20">
      <header className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
          Teacher development · PLC · Session register
        </div>
        <h1 className="mt-1 font-display text-4xl font-medium leading-tight text-navy">
          The {view.dayName} <em className="italic text-gold">session</em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          {view.cards.length} {view.cards.length === 1 ? "PLC" : "PLCs"} in your view · the facilitator marks
          attendance, runs the agenda, and each teacher captures a short reflection in-app over the next 48
          hours. Both count toward the CPD point.
          {!view.configured && (
            <span className="ml-1 italic text-navy-3">
              The PLC programme has not been configured yet — set the cadence on the Setup tab.
            </span>
          )}
        </p>
      </header>

      {/* ── your PLCs · this week ── */}
      <section className="mb-10">
        <SectionHead
          eyebrow="Your PLCs · this week"
          meta="One session per PLC per week · the facilitator opens it, then marks the register"
        >
          This week&rsquo;s <em className="italic text-gold">sessions</em>
        </SectionHead>
        {view.cards.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">No PLCs yet</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-navy-3">
              You are not a facilitator or member of any PLC. Ask the PLC coordinator to add you, or
              configure PLCs on the Setup tab.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {view.cards.map((c) => {
              const tone =
                c.state === "held"
                  ? "border-green bg-green-bg text-green"
                  : c.state === "missed"
                    ? "border-terra bg-terra-bg text-terra"
                    : "border-gold bg-gold-bg text-gold";
              const stateLabel = c.state === "held" ? "Held" : c.state === "missed" ? "Not held" : "Scheduled";
              return (
                <Link
                  key={c.plcId}
                  href={`/senior/plc/sessions/${c.plcId}/${c.sessionDate}`}
                  className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-gold hover:bg-gold-bg"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-display text-lg font-semibold text-navy">{c.name}</div>
                    <span className={`rounded-pill border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] ${tone}`}>
                      {stateLabel}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-navy-3">
                    {c.typeLabel} · {c.dateLabel}
                    {c.isFacilitator ? " · you facilitate" : c.canOpen ? " · break-glass" : " · member"}
                  </div>
                  <div className="mt-3 text-[11px] font-semibold text-navy">
                    {c.state === "held" ? "Open the register →" : c.canOpen ? "Open this session →" : "View →"}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── recent held sessions ── */}
      <section>
        <SectionHead eyebrow="Recorded sessions" meta="Most recent first · attendance derives from the P/L/A rows">
          Recent <em className="italic text-gold">sessions</em>
        </SectionHead>
        {view.recent.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-navy-3">
            No PLC sessions have been recorded yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            {view.recent.map((s) => (
              <Link
                key={`${s.plcId}-${s.sessionDate}`}
                href={`/senior/plc/sessions/${s.plcId}/${s.sessionDate}`}
                className="grid grid-cols-1 gap-1 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-gold-bg sm:grid-cols-[1fr_1fr_auto] sm:items-center sm:gap-3"
              >
                <div className="font-display text-[15px] font-semibold text-navy">{s.plcName}</div>
                <div className="text-[12px] text-navy-3">{s.dateLabel}</div>
                <div className="text-[12px] font-semibold text-navy sm:text-right">
                  {s.present} / {s.memberCount} present{" "}
                  <span className="text-navy-3">· {s.awardedPts} attended pts</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
