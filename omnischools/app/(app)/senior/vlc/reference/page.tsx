import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSchoolRole } from "@/lib/auth/server";
import { VLC_PARAGRAPH_READ_ROLES } from "@/lib/access";
import { getVlcLeaverRoster } from "@/lib/vlc/dashboard-data";
import { SectionHead } from "@/components/vlc/chrome";

export const dynamic = "force-dynamic";

/**
 * 🔴 INCR-44 — `/senior/vlc/reference` — the discoverable LEAVER ROSTER (SHS module 4.5), the entry point the
 * 43b character-reference route (`/senior/vlc/reference/[studentId]`) lacked (previously deep-link-only for the
 * HM). Gated to VLC_PARAGRAPH_READ_ROLES (own-class FM + Dean + HEADMASTER; ADMIN excluded, so ADMIN reaches
 * NO names). It lists the Form-3 leaver cohort as NON-confidential directory data ONLY — full name + class +
 * form, NO paragraph body, NO draft/locked state, NO flag existence. Each row links to the EXISTING gated
 * per-student reference route, which SELF-RE-GATES server-side (own-class-FM identity / Dean / HM finalised-
 * only; a mis-routed viewer or an HM on a draft still `notFound()`s at the reader — no existence leak).
 */
export default async function VlcReferenceRosterPage() {
  const { school } = await requireSchoolRole(VLC_PARAGRAPH_READ_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const roster = await getVlcLeaverRoster(school.id);

  return (
    <div className="pb-20">
      <header className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
          Pastoral &amp; values · VLC · Leaver references
        </div>
        <h1 className="mt-1 font-display text-4xl font-medium leading-tight text-navy">
          Form 3 <em className="italic text-gold">leavers</em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          {roster.length} Form 3 {roster.length === 1 ? "student" : "students"} · open a student to read or write
          their school-leaver character reference. The reference itself is gated per student.
        </p>
      </header>

      <section>
        <SectionHead eyebrow="Leaver roster" meta="Name · class · form · click through to the character reference">
          The <em className="italic text-gold">leaving cohort</em>
        </SectionHead>
        {roster.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">No Form 3 students</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-navy-3">
              No Form 3 (leaver) students are enrolled for this school yet.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            {roster.map((s) => (
              <Link
                key={s.studentId}
                href={`/senior/vlc/reference/${s.studentId}`}
                className="grid grid-cols-1 gap-1 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-gold-bg sm:grid-cols-[1.4fr_1fr_auto] sm:items-center sm:gap-3"
              >
                <div className="font-display text-[15px] font-semibold text-navy">{s.fullName}</div>
                <div className="text-[12px] text-navy-3">{s.className ?? "—"}</div>
                <div className="text-[12px] font-semibold text-navy-3 sm:text-right">
                  {s.formLabel} · Character reference →
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
