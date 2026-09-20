import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { BOARDING_ROLES, BOARDING_SCHOOL_SCOPED_ROLES, hasAnyRole } from "@/lib/access";
import { getProgrammeConfig } from "@/lib/boarding/programme-data";
import type { DeboardinizationRung } from "@/lib/boarding/config";
import { HousesEditor } from "@/components/boarding/houses-editor";
import { ScheduleEditor } from "@/components/boarding/schedule-editor";
import { PolicyEditor } from "@/components/boarding/policy-editor";
import { CalendarEditor } from "@/components/boarding/calendar-editor";

export const dynamic = "force-dynamic";

export default async function BoardingProgrammePage() {
  const { school, user } = await requireSchoolRole(BOARDING_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  // Edit gate — a plain HOUSEMASTER reads but cannot edit (mirrored server-side in every action).
  const canEdit = hasAnyRole(roles, BOARDING_SCHOOL_SCOPED_ROLES);

  const cfg = await getProgrammeConfig(school.id);
  const s = cfg.summary;
  const nextVisiting = cfg.calendar.nextVisiting;
  const nextVisitingLabel = nextVisiting
    ? `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${nextVisiting.date}T00:00:00`))}`
    : null;

  return (
    <div className="mx-auto max-w-page pb-20">
      <div className="mb-5">
        <Link
          href="/senior/boarding"
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-navy-3 hover:text-navy"
        >
          ← Boarding · Houses
        </Link>
      </div>

      {/* Hero */}
      <header className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Omnischools Senior · Boarding · Programme setup
        </div>
        <h1 className="mt-1 font-display text-4xl font-medium leading-tight text-navy">
          The <em className="italic text-gold">boarding programme</em> · structure, rhythm, ladder
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          What the Senior Housemaster and Admin configure once at programme setup, and revisit at
          start-of-session. <b className="text-navy-2">The foundation surface</b> — every other
          boarding surface reads from this. {school.name} · {cfg.academicYear} academic year.
          {!canEdit && (
            <span className="ml-1 italic text-navy-3">You have read-only access to this surface.</span>
          )}
        </p>
      </header>

      {/* Summary strip — every number derived from the roster/config, nothing hard-coded. */}
      <div className="mb-10 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <SumCard featured label="Houses configured" big={s.housesConfigured}>
          <b className="text-gold">{s.boysHouses} boys&apos;</b> · {s.girlsHouses} girls&apos; · {s.capEachLabel}
        </SumCard>
        <SumCard label="Boarder capacity" big={`${s.totalCapacity}`}>
          <b className="text-navy-2">{s.boardingCount} boarding</b> · {s.vacantBunks} vacant bunks · {s.utilisationPct}% utilisation
        </SumCard>
        <SumCard label="Day students" big={s.dayStudents}>
          Not in boarding rolls · {s.totalEnrolment} total enrolment
        </SumCard>
        <SumCard label="Deboardinized" big={`${s.deboardinizedCount} active`}>
          Reverted to day · board review → INCR-13
        </SumCard>
        <SumCard label="Exeat quota · term" big={`${s.exeatQuota} ×`}>
          Per semester · plus special exeats · parent-initiated
        </SumCard>
      </div>

      {/* Houses */}
      <Section eyebrow="The six Houses · the social and pastoral unit" title="Houses" em="· named, coloured, capped, staffed">
        <HousesEditor houses={cfg.housesGrid} staff={cfg.staff} canEdit={canEdit} />
      </Section>

      {/* Daily rhythm */}
      <Section
        eyebrow="The daily rhythm · Monday — Friday template"
        title="From rising at 4:30 AM"
        em="to lights out at 9:30 PM"
        meta="Weekday shown · Saturday, Sunday & Visiting Sunday are separate templates · Form 3 is an inline WASSCE variant"
      >
        <ScheduleEditor templates={cfg.templates} canEdit={canEdit} />
      </Section>

      {/* Policies */}
      <Section
        eyebrow="The three gate policies · how a student crosses the school boundary"
        title="Exeats, visiting, inspection"
        em="· the operational doctrines"
        meta="Editable per school · GES default values shown"
      >
        <PolicyEditor settings={cfg.settings} nextVisitingLabel={nextVisitingLabel} canEdit={canEdit} />
      </Section>

      {/* Calendar */}
      <Section
        eyebrow="Term calendar · keyed to the GES single-track calendar"
        title="Resumption · vacation · exeat windows"
        em="· the boarding year"
        meta="Resumption/vacation derived from the academic calendar · F3 ends earlier post-WASSCE"
      >
        <CalendarEditor calendar={cfg.calendar} academicYear={cfg.academicYear} canEdit={canEdit} />
      </Section>

      {/* Deboardinization ladder — read-only from the canonical constant. */}
      <Section
        eyebrow="Discipline escalation · the boarding ladder"
        title="Five rungs"
        em="· bond to board referral"
        meta="Defaults · read-only in this release (editable store → INCR-13)"
      >
        <LadderView rungs={cfg.ladder} />
      </Section>
    </div>
  );
}

/** The navy ladder card — TRAP 2: rung tints use literal rgba / bg-white/[0.04], never a
 *  slash-opacity on a raw-hex token (which silently breaks). Read-only from the constant. */
function LadderView({ rungs }: { rungs: readonly DeboardinizationRung[] }) {
  return (
    <div className="rounded-2xl bg-navy p-7 text-bg">
      <div className="mb-4 flex items-end justify-between border-b border-white/10 pb-3.5">
        <h4 className="font-display text-lg font-medium">
          Five rungs <em className="italic text-gold">· bond to board referral</em>
        </h4>
        <span className="font-mono text-[11px] font-semibold text-gold-soft">DEFAULTS · READ-ONLY</span>
      </div>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3 lg:grid-cols-5">
        {rungs.map((r) => {
          const tint =
            r.severity === "DEBOARDINIZATION"
              ? "bg-[rgba(184,74,57,0.15)] border-terra"
              : r.severity === "BOND" || r.severity === "SUSPENSION"
                ? "bg-[rgba(197,138,46,0.12)] border-warn"
                : "bg-white/[0.04] border-[rgba(232,212,184,0.15)]";
          return (
            <div key={r.stage} className={`rounded-xl border p-3.5 ${tint}`}>
              <div className="font-display text-[13px] font-semibold italic text-gold">
                {String(r.stage).padStart(2, "0")}
              </div>
              <div className="mt-1.5 font-display text-[15px] font-semibold leading-tight text-bg">{r.name}</div>
              <div className="mt-2 text-[10px] leading-relaxed text-gold-soft">{r.description}</div>
              {r.coSignCount > 0 && (
                <div className="mt-2 text-[9px] font-semibold uppercase tracking-[0.06em] text-gold-soft">
                  Co-sign × {r.coSignCount} · {r.coSignRoles.join(" + ")}
                </div>
              )}
              {r.reversalNote && (
                <div className="mt-1 text-[9px] italic text-gold-soft">{r.reversalNote}</div>
              )}
              <div className="mt-2.5 border-t border-white/10 pt-2 text-[9px] font-bold uppercase tracking-[0.06em] text-gold">
                {r.penaltyLabel}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  em,
  meta,
  children,
}: {
  eyebrow: string;
  title: string;
  em?: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-border pb-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">{eyebrow}</div>
          <h3 className="mt-0.5 font-display text-2xl font-semibold text-navy">
            {title} {em && <em className="italic text-gold">{em}</em>}
          </h3>
        </div>
        {meta && <div className="max-w-md text-right text-[11px] text-navy-3">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

function SumCard({
  label,
  big,
  children,
  featured,
}: {
  label: string;
  big: string | number;
  children: React.ReactNode;
  featured?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${featured ? "border-navy bg-navy text-bg" : "border-border bg-surface"}`}>
      <div className={`text-[10px] font-bold uppercase tracking-[0.12em] ${featured ? "text-gold-soft" : "text-navy-3"}`}>
        {label}
      </div>
      <div className={`mt-1 font-display text-2xl font-semibold leading-none ${featured ? "text-gold" : "text-navy"}`}>
        {big}
      </div>
      <div className={`mt-1.5 text-[11px] leading-snug ${featured ? "text-gold-soft" : "text-navy-3"}`}>{children}</div>
    </div>
  );
}
