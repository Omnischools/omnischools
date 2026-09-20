import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSchoolRole } from "@/lib/auth/server";
import { VLC_CONFIG_READ_ROLES } from "@/lib/access";
import { canWriteSession } from "@/lib/vlc/authz";
import { getVlcSessionsLanding } from "@/lib/vlc/session-data";
import { SectionHead } from "@/components/vlc/chrome";

export const dynamic = "force-dynamic";

/**
 * `/senior/vlc/sessions` — the VLC session-register landing (SHS module 4.5 / INCR-42a): the recent held
 * sessions across the viewer's scope + the classes a writer may open a session for today. READ gate
 * VLC_CONFIG_READ_ROLES + BASIC redirect (the shipped VLC page idiom); each class the current user may
 * write (own-class Form Master ∥ Dean ∥ Admin) links to today's register. OPERATIONAL, SHOWN, no PII.
 */
export default async function VlcSessionsLandingPage() {
  const { school, user } = await requireSchoolRole(VLC_CONFIG_READ_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const view = await getVlcSessionsLanding(school.id);
  const writable = view.classes.filter(
    (c) =>
      c.eligible &&
      canWriteSession({ roles: user.roles, userId: user.id, classTeacherUserId: c.classTeacherUserId }),
  );

  return (
    <div className="pb-20">
      {/* ── hero ── */}
      <header className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-3">
          Pastoral &amp; values · VLC · Session register
        </div>
        <h1 className="mt-1 font-display text-4xl font-medium leading-tight text-navy">
          The Wednesday <em className="italic text-gold">session</em>
        </h1>
        <div className="mb-3 mt-4 h-0.5 w-16 bg-gold" />
        <p className="max-w-3xl text-sm leading-relaxed text-navy-3">
          {view.recent.length} recorded {view.recent.length === 1 ? "session" : "sessions"} · the whole
          class attends a single 60-minute session, marked P / L / A by the class Form Master.
          {writable.length === 0 && (
            <span className="ml-1 italic text-navy-3">You have read-only access to this surface.</span>
          )}
        </p>
      </header>

      {/* ── open today's session (writers only) ── */}
      {writable.length > 0 && (
        <section className="mb-10">
          <SectionHead
            eyebrow="Open a session"
            meta="Pick your class · records today's register (one per class per date)"
          >
            Your <em className="italic text-gold">classes</em> · today
          </SectionHead>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {writable.map((c) => (
              <Link
                key={c.classId}
                href={`/senior/vlc/sessions/${c.classId}/${view.today}`}
                className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-gold hover:bg-gold-bg"
              >
                <div className="font-display text-lg font-semibold text-navy">{c.name}</div>
                <div className="mt-1 text-[11px] text-navy-3">
                  {c.formLabel} · Form Master {c.fmName ?? "—"} · go to today&rsquo;s register
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── recent sessions ── */}
      <section>
        <SectionHead eyebrow="Recorded sessions" meta="Most recent first · attendance derives from the P/L/A rows">
          Recent <em className="italic text-gold">sessions</em>
        </SectionHead>
        {view.recent.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
              No sessions recorded yet
            </div>
            <p className="mx-auto mt-1 max-w-md text-sm text-navy-3">
              {writable.length > 0
                ? "Open a session for one of your classes above to take the first register."
                : "No VLC session register has been recorded for this school yet."}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            {view.recent.map((s) => (
              <Link
                key={s.sessionId}
                href={`/senior/vlc/sessions/${s.classId}/${s.sessionDate}`}
                className="grid grid-cols-1 gap-1 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-gold-bg sm:grid-cols-[1fr_1.4fr_auto] sm:items-center sm:gap-3"
              >
                <div className="font-display text-[15px] font-semibold text-navy">{s.className}</div>
                <div className="text-[12px] text-navy-3">
                  {s.dateLabel} · {s.valueLabel}
                </div>
                <div className="text-[12px] font-semibold text-navy sm:text-right">
                  {s.present} / {s.enrolled} present{" "}
                  <span className="text-navy-3">· {s.presentPct}%</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
