import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, VLC_CONFIG_READ_ROLES, VLC_CONFIG_WRITE_ROLES } from "@/lib/access";
import { getVlcSetup } from "@/lib/vlc/setup-data";
import { VLC_TERM_ARCS } from "@/lib/vlc/defaults";
import { RhythmEditor } from "@/components/vlc/rhythm-editor";
import { CurriculumLibrary } from "@/components/vlc/curriculum-library";

export const dynamic = "force-dynamic";

/**
 * `/senior/vlc/setup` — the VLC F0 config spine (SHS module 4.5 / INCR-40): the Wednesday rhythm
 * (cadence + 5 phases), the sequence-locked three-term arc, and the curriculum library (11 values ×
 * A/B sessions). READ gate VLC_CONFIG_READ_ROLES (Dean / Admin / Headmaster / Form Master); WRITE
 * gate VLC_CONFIG_WRITE_ROLES (Dean / Admin) — HM/FM see the same surface read-only, every server
 * action re-checks the write gate. Config only; NO pastoral PII (journal / flags are INCR-42/43).
 *
 * Summary strip: cards 1–2 only (Core values · Active classes). The Peer Guides / sessions-held /
 * pastoral-flags cards are omit-not-fake — they belong to later modules, so they are absent, never
 * stubbed with zeros.
 */
export default async function VlcSetupPage() {
  const { school, user } = await requireSchoolRole(VLC_CONFIG_READ_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const canEdit = hasAnyRole(roles, VLC_CONFIG_WRITE_ROLES);

  const setup = await getVlcSetup(school.id);
  const valuesByGroup = (g: number) => setup.values.filter((v) => v.termGroup === g);

  return (
    <div className="mx-auto max-w-page pb-20">
      {/* ── Hero (in-app head-row) ── */}
      <header className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
          Pastoral &amp; values · VLC · Programme setup
        </div>
        <h1 className="mt-1 font-display text-4xl font-medium leading-tight text-navy">
          VLC <em className="italic text-gold">· academic year {setup.academicYear}</em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          {school.name} · {setup.academicYear} · {setup.valueCount} values · {setup.sessionCount}{" "}
          sessions · {setup.classCount} classes · the Wednesday rhythm.
          {!canEdit && (
            <span className="ml-1 italic text-navy-3">
              You have read-only access to this surface.
            </span>
          )}
        </p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          <a
            href="#curriculum"
            className="rounded-md border border-border-2 bg-transparent px-3.5 py-2 text-xs font-semibold text-navy hover:bg-gold-bg"
          >
            Open curriculum library
          </a>
          {canEdit && (
            <a
              href="#rhythm"
              className="rounded-md border border-gold bg-gold px-3.5 py-2 text-xs font-bold text-navy hover:brightness-95"
            >
              Edit programme
            </a>
          )}
        </div>
      </header>

      {/* ── Summary strip — cards 1 & 2 only (omit-not-fake) ── */}
      <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SumCard featured label="Core values · annual" big={`${setup.valueCount} values`}>
          <b className="text-bg">{setup.sessionCount} sessions</b> · 2 per value (A intro, B applied)
        </SumCard>
        <SumCard label="Active classes" big={`${setup.classCount} classes`}>
          Form 1 · Form 2 · Form 3 · all programmes
        </SumCard>
      </div>

      {/* ── The Wednesday rhythm ── */}
      <section id="rhythm" className="mb-10 scroll-mt-6">
        <SectionHead
          eyebrow="When and how it runs"
          meta="Locked at programme level · individual class can defer with Dean approval"
        >
          The <em className="italic text-gold">{setup.programme.dayName} rhythm</em> ·{" "}
          {setup.programme.totalMin} minutes, every class, every week
        </SectionHead>
        <RhythmEditor programme={setup.programme} canEdit={canEdit} />
      </section>

      {/* ── Three-term curriculum arc (read-only, sequence-locked) ── */}
      <section className="mb-10">
        <SectionHead
          eyebrow="Three-term curriculum arc"
          meta="Sequence locked at programme level · same order every academic year"
        >
          Foundations <em className="italic text-gold">→ Interpersonal → Integration</em>
        </SectionHead>

        <div className="rounded-2xl border border-border bg-surface p-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
                The 11 values, grouped by term
              </div>
              <h4 className="mt-0.5 font-display text-lg font-medium text-navy">
                Building from <em className="italic text-gold">self → others → community</em>
              </h4>
            </div>
            <span className="rounded-pill bg-gold-bg px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-gold">
              Sequence locked
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {VLC_TERM_ARCS.map((arc) => {
              const t = ARC_TOKENS[arc.accent];
              return (
                <div key={arc.group} className={`rounded-xl border-t-[3px] p-4 ${t.bg} ${t.border}`}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-navy-3">
                    {arc.termLab}
                  </div>
                  <div className="mt-1 font-display text-base font-semibold text-navy">
                    {arc.name} <em className={`italic ${t.text}`}>{arc.subtitle}</em>
                  </div>
                  <div className="mb-2.5 border-b border-dashed border-border-2 pb-2 text-[10px] tracking-[0.02em] text-navy-3">
                    {arc.valuesSub}
                  </div>
                  <div className="space-y-1 text-[11px] leading-relaxed text-navy-2">
                    {valuesByGroup(arc.group).map((v) => (
                      <div key={v.ordinal}>
                        <span className={`mr-1 font-display font-semibold italic ${t.text}`}>
                          {v.ordinal}
                        </span>
                        <b className="font-semibold text-navy">{v.nameEn}</b>
                        {v.nameTwi ? ` · ${v.nameTwi}` : ""}
                        {v.capstone && (
                          <em className="ml-1 not-italic text-terra">capstone</em>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Curriculum library (11 values × A/B) ── */}
      <section id="curriculum" className="mb-10 scroll-mt-6">
        <SectionHead eyebrow={`Curriculum library · ${setup.valueCount} values, ${setup.sessionCount} sessions`}>
          Each value{" "}
          <em className="italic text-gold">· session A intro, session B application</em>
        </SectionHead>
        <CurriculumLibrary values={setup.values} canEdit={canEdit} />
      </section>
    </div>
  );
}

const ARC_TOKENS = {
  gold: { bg: "bg-gold-bg", border: "border-gold", text: "text-gold" },
  green: { bg: "bg-green-bg", border: "border-green", text: "text-green" },
  terra: { bg: "bg-terra-bg", border: "border-terra", text: "text-terra" },
} as const;

function SectionHead({
  eyebrow,
  meta,
  children,
}: {
  eyebrow: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-border pb-3">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">{eyebrow}</div>
        <h3 className="mt-0.5 font-display text-2xl font-semibold text-navy">{children}</h3>
      </div>
      {meta && <div className="max-w-md text-right text-[11px] text-navy-3">{meta}</div>}
    </div>
  );
}

function SumCard({
  label,
  big,
  children,
  featured,
}: {
  label: string;
  big: string;
  children: React.ReactNode;
  featured?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${featured ? "border-navy bg-navy text-bg" : "border-border bg-surface"}`}
    >
      <div
        className={`text-[10px] font-bold uppercase tracking-[0.12em] ${featured ? "text-gold-soft" : "text-navy-3"}`}
      >
        {label}
      </div>
      <div
        className={`mt-1 font-display text-2xl font-semibold leading-none ${featured ? "text-gold" : "text-navy"}`}
      >
        {big}
      </div>
      <div
        className={`mt-1.5 text-[11px] leading-snug ${featured ? "text-gold-soft" : "text-navy-3"}`}
      >
        {children}
      </div>
    </div>
  );
}
