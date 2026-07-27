import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, VLC_CONFIG_READ_ROLES, VLC_CONFIG_WRITE_ROLES } from "@/lib/access";
import { getPeerGuides } from "@/lib/vlc/peer-guides-data";
import { VLC_TENURE_RULES } from "@/lib/vlc/defaults";
import { SectionHead, SumCard } from "@/components/vlc/chrome";
import { PeerGuideRoster } from "@/components/vlc/peer-guide-roster";
import { TrainingCalendar } from "@/components/vlc/training-calendar";

export const dynamic = "force-dynamic";

/**
 * `/senior/vlc/peer-guides` — the VLC Peer Guides roster (SHS module 4.5 / INCR-41): the per-class PG
 * slots (2 per Form 2 / Form 3 class, one boy + one girl by default), the DERIVED vacancy protocol, and
 * the monthly training calendar. READ gate VLC_CONFIG_READ_ROLES (Dean / Admin / Headmaster / Form
 * Master); WRITE gate VLC_CONFIG_WRITE_ROLES (Dean / Admin) — HM/FM see the surface read-only and every
 * server action re-checks the write gate. OPERATIONAL, SHOWN audit, NO pastoral PII.
 *
 * Everything on this page is DERIVED (R302/R307) — no stored count/status/gender-balance. The INCR-42/43
 * tiles ("hours of practice" needs vlc_session; "recognised on character ref" needs the character
 * paragraph) are OMITTED, not faked.
 */
export default async function VlcPeerGuidesPage() {
  const { school, user } = await requireSchoolRole(VLC_CONFIG_READ_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const canEdit = hasAnyRole(roles, VLC_CONFIG_WRITE_ROLES);

  const view = await getPeerGuides(school.id);
  const s = view.summary;
  const nextTraining = view.trainings.find((t) => t.status === "NEXT");
  const vacancyClause =
    s.vacancyCount > 0
      ? `${s.vacancyCount} ${s.vacancyCount === 1 ? "vacancy" : "vacancies"} open`
      : "no open vacancies";

  return (
    <div className="pb-20">
      {/* ── Hero (in-app head-row) ── */}
      <header className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
          Pastoral &amp; values · VLC · Peer Guides roster
        </div>
        <h1 className="mt-1 font-display text-4xl font-medium leading-tight text-navy">
          Peer Guides{" "}
          <em className="italic text-gold">
            · {view.periodLabel ?? "no active semester"} · {view.academicYear}
          </em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          {view.hasPeriod ? (
            <>
              {s.activeCount} of {s.slots} slots filled · {s.boys} boys + {s.girls} girls · {s.f2} Form 2
              + {s.f3} Form 3 ·{" "}
              {nextTraining
                ? `next training ${nextTraining.day} ${nextTraining.month}`
                : "no upcoming training"}{" "}
              · {vacancyClause}.
            </>
          ) : (
            <>No active semester is configured for this school yet.</>
          )}
          {!canEdit && (
            <span className="ml-1 italic text-navy-3">
              You have read-only access to this surface.
            </span>
          )}
        </p>
      </header>

      {/* ── Summary strip — 5 cards, all derived ── */}
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SumCard featured label="Active Peer Guides" big={`${s.activeCount} / ${s.slots}`}>
          {s.fillPct}% · {s.openSlots} {s.openSlots === 1 ? "slot" : "slots"} open
        </SumCard>
        <SumCard label="Gender balance" big={`${s.boys} · ${s.girls}`}>
          Boys / girls · advisory 1 + 1 pattern
        </SumCard>
        <SumCard label="Form distribution" big={`${s.f2} · ${s.f3}`}>
          F2 / F3 · F3 rotate out for WASSCE
        </SumCard>
        <SumCard
          label="Training attendance"
          big={s.trainingPct !== null ? `${s.trainingPct}%` : "—"}
        >
          {s.trainingsDone} {s.trainingsDone === 1 ? "training" : "trainings"} done
          {s.trainingAvgPresent !== null
            ? ` · avg ${s.trainingAvgPresent} of ${s.trainingTotal} attended`
            : ""}
        </SumCard>
        <SumCard warn label="Rotating after this term" big={`${s.rotatingCount} PGs`}>
          Form 3 Peer Guides roll off for WASSCE
        </SumCard>
      </div>

      {/* ── Term-context banner ── */}
      {view.hasPeriod && (
        <div className="mb-10 rounded-2xl border border-gold-soft bg-gold-bg p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="rounded-pill bg-gold px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-navy">
                {view.periodLabel} · in tenure
              </span>
              <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-navy-2">
                <b className="font-semibold text-navy">Current selection in tenure</b> · {view.periodLabel}{" "}
                Peer Guides serve this semester · {s.rotatingCount} of {s.activeCount} will rotate (Form 3
                finishing for WASSCE, voluntary step-aside, end of one-semester tenure).
              </p>
            </div>
            <details className="text-[12px]">
              <summary className="cursor-pointer rounded-md border border-border-2 bg-surface px-3 py-1.5 font-semibold text-navy hover:bg-gold-bg">
                View tenure rules
              </summary>
              <ul className="mt-2 max-w-md list-disc space-y-1 rounded-md border border-border bg-surface p-3 pl-6 text-navy-2">
                {VLC_TENURE_RULES.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      )}

      {/* ── Per-class roster ── */}
      <section className="mb-10">
        <SectionHead
          eyebrow="Per-class roster"
          meta="Two Peer Guides per Form 2 / Form 3 class · Form 1 receives, it does not lead"
        >
          Each class <em className="italic text-gold">· two Peer Guides</em> · except Form 1
        </SectionHead>
        <PeerGuideRoster classes={view.classes} canEdit={canEdit} />
      </section>

      {/* ── Training calendar ── */}
      <section className="mb-10">
        <SectionHead
          eyebrow="Monthly training · last Saturday morning"
          meta="Attendance below 80% starts a Dean conversation"
        >
          Training <em className="italic text-gold">calendar</em>
        </SectionHead>
        <TrainingCalendar
          trainings={view.trainings}
          activePeerGuides={view.activePeerGuides}
          canEdit={canEdit}
        />
      </section>

      {/* ── Leadership development — roster-derived slice only (§2.7); INCR-42/43 tiles omitted ── */}
      {view.hasPeriod && (
        <section className="rounded-2xl border border-border bg-navy p-5 text-bg">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
            Leadership development
          </div>
          <p className="mt-1 font-display text-lg font-medium">
            {s.activeCount} students{" "}
            <em className="italic text-gold">hold a Peer Guide role</em> this semester
          </p>
          <p className="mt-1.5 text-[11px] text-gold-soft">
            Hours of facilitation practice and the school-leaver character-reference line arrive with
            later increments — they are not shown here until the data exists.
          </p>
        </section>
      )}
    </div>
  );
}
