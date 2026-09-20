import Link from "next/link";

export type TeacherAssignment = {
  /** Class name, e.g. "JHS 2A". */
  className: string;
  /** Sub-note, e.g. "Mathematics · Form teacher" or "Form teacher". */
  note: string;
};

function greetingFor(hour: number): string {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/**
 * §02 teacher welcome hero (first-run dashboard) — a navy hero card.
 * Replicates Surfaces/schoolup-empty-states.html §02.
 * Navy-card text uses text-bg / text-gold-soft / text-gold (NO slash-opacity
 * on custom tokens); translucent fills use inline rgba / bg-white tints.
 */
export function TeacherHero({
  name,
  assignments,
}: {
  name?: string | null;
  assignments: TeacherAssignment[];
}) {
  const firstName = name?.trim().split(/\s+/)[0] ?? "there";
  const greeting = greetingFor(new Date().getHours());
  const n = assignments.length;
  const summary =
    n > 0
      ? `You're teaching ${n} ${n === 1 ? "class" : "classes"} this term.`
      : "Your classes will be assigned by the school admin shortly.";

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
        Dashboard
      </div>
      <h1 className="font-display text-3xl font-semibold text-navy">
        Good {greeting},{" "}
        <em className="not-italic text-gold [font-style:italic]">{firstName}</em>.
      </h1>
      <p className="mt-1.5 text-sm text-navy-2">{summary} Your students are on their way.</p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-start">
        {/* Navy welcome hero card */}
        <div className="relative overflow-hidden rounded-xl bg-navy p-7 text-bg">
          {/* decorative gold glow — inline rgba (no slash-opacity on tokens) */}
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-16 -right-16 h-52 w-52 rounded-full"
            style={{ background: "rgba(200,151,91,0.10)" }}
          />
          <div className="relative z-[2]">
            <div className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
              Your assignments
            </div>
            <h2 className="font-display text-2xl font-semibold leading-tight text-bg">
              {n > 0 ? (
                <>
                  {n} {n === 1 ? "class" : "classes"} at this school
                </>
              ) : (
                <>You&apos;re part of the team now</>
              )}
            </h2>
            <p className="mt-3 max-w-md text-[13px] leading-relaxed text-gold-soft">
              You&apos;re set up. {n > 0 ? "Your classes are listed below — " : ""}
              student rosters are being uploaded by the admin and will appear here
              within the next day or two.
            </p>

            {/* Assignment list */}
            {n > 0 ? (
              <div
                className="mt-5 rounded-lg border p-4"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  borderColor: "rgba(255,255,255,0.10)",
                }}
              >
                <div className="mb-2.5 text-[9px] font-bold uppercase tracking-[0.14em] text-gold">
                  Your classes
                </div>
                {assignments.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between border-b py-1.5 text-xs last:border-b-0"
                    style={{ borderColor: "rgba(255,255,255,0.10)" }}
                  >
                    <span className="font-semibold text-bg">{a.className}</span>
                    <span className="text-gold-soft">{a.note}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="mt-5 rounded-lg border p-4 text-xs text-gold-soft"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  borderColor: "rgba(255,255,255,0.10)",
                }}
              >
                Your classes will appear here once you&apos;re assigned.
              </div>
            )}

            {/* CTAs — "Take a quick tour" is MVP2 (non-functional, muted) */}
            <div className="mt-5 flex flex-wrap gap-2">
              <span
                aria-disabled
                className="inline-flex cursor-default items-center gap-1.5 rounded-md border px-4 py-2.5 text-[13px] font-semibold text-bg"
                style={{ borderColor: "rgba(255,255,255,0.30)" }}
              >
                Take a quick tour
              </span>
              <Link
                href="/classes"
                className="inline-flex items-center gap-1.5 rounded-md bg-gold px-4 py-2.5 text-[13px] font-semibold text-navy transition-colors hover:bg-gold-soft"
              >
                View my classes →
              </Link>
            </div>
          </div>
        </div>

        {/* Suggestion tiles (gold-bg icon tiles) */}
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-surface p-6">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-[10px] bg-gold-bg font-display text-base font-bold text-gold">
              i
            </div>
            <h3 className="font-display text-sm font-semibold text-navy">
              Get oriented in 3 minutes
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-navy-3">
              A short tour of how to take attendance, post assignments, and grade
              work. You can skip and explore on your own — nothing is locked.
            </p>
            {/* Tour is MVP2 — shown as a static, non-functional hint */}
            <div className="mt-3 text-[11px] font-bold uppercase tracking-[0.04em] text-navy-3">
              Tour coming soon
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-6">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-[10px] bg-gold-bg font-display text-base font-bold text-gold">
              !
            </div>
            <h3 className="font-display text-sm font-semibold text-navy">
              While you wait for students
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-navy-3">
              Draft assignments, prep your gradebook columns, write an announcement —
              you don&apos;t have to wait for the roster.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
