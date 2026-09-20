import Link from "next/link";

export type ChecklistStep = {
  /** Step title (surface t1). */
  title: string;
  /** Sub-copy (surface t2). */
  sub: string;
  /** Whether this step is complete. */
  done: boolean;
  /** Where the CTA points. */
  href: string;
  /** CTA label for the active state, e.g. "Add students →". */
  cta: string;
  /** Locked until a prerequisite is met (e.g. invoices need students). */
  locked?: boolean;
  /** Optional step — offers "Skip for now" instead of being required. */
  optional?: boolean;
};

/**
 * §01 admin guided checklist (first-run dashboard).
 * Replicates Surfaces/schoolup-empty-states.html §01.
 * Token-safe: raw-hex tokens, no slash-opacity on custom tokens.
 */
export function AdminChecklist({
  steps,
  progressPct,
  firstName,
}: {
  steps: ChecklistStep[];
  progressPct: number;
  firstName?: string | null;
}) {
  const total = steps.length;
  const doneCount = steps.filter((s) => s.done).length;
  const remaining = total - doneCount;
  // The first pending, actionable (not locked) step is the highlighted one.
  const activeIndex = steps.findIndex((s) => !s.done && !s.locked);

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
        Dashboard
      </div>
      <h1 className="font-display text-3xl font-semibold text-navy">
        Welcome to{" "}
        <em className="not-italic text-gold [font-style:italic]">Omnischools</em>
        {firstName ? `, ${firstName}.` : "."}
      </h1>
      <p className="mt-1.5 text-sm text-navy-2">
        Your school is set up.{" "}
        {remaining > 0
          ? `${remaining} ${remaining === 1 ? "thing" : "things"} left to do before students and parents can start using it.`
          : "Everything's ready — students and parents can start using it."}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-start">
        {/* Checklist card */}
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-6 pb-4 pt-5">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
              Get-started checklist
            </div>
            <h2 className="font-display text-xl font-semibold text-navy">
              You&apos;re{" "}
              <em className="not-italic text-gold [font-style:italic]">
                {progressPct}%
              </em>{" "}
              of the way there
            </h2>

            {/* Segmented progress bar */}
            <div className="mt-3.5 flex gap-1">
              {steps.map((s, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-sm ${s.done ? "bg-gold" : "bg-border"}`}
                />
              ))}
            </div>
            <div className="mt-2 text-[11px] font-semibold text-navy-3">
              <b className="text-gold">
                {doneCount} of {total} done
              </b>
              {remaining > 0 ? " · a few minutes left" : " · all set"}
            </div>
          </div>

          <ol>
            {steps.map((step, i) => {
              const isActive = i === activeIndex;
              const num = i + 1;
              return (
                <li
                  key={i}
                  className={`grid grid-cols-[36px_1fr_auto] items-center gap-3.5 border-b border-border px-6 py-4 last:border-b-0 ${
                    step.done ? "bg-bg" : isActive ? "bg-gold-bg" : ""
                  }`}
                >
                  {/* Numbered circle */}
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full font-display text-[13px] font-semibold ${
                      step.done
                        ? "border-[1.5px] border-gold bg-gold text-navy"
                        : isActive
                          ? "border-[1.5px] border-gold bg-surface text-navy"
                          : "border-[1.5px] border-border-2 bg-bg text-navy-3"
                    }`}
                  >
                    {step.done ? "✓" : num}
                  </div>

                  {/* Body */}
                  <div>
                    <div
                      className={`font-display text-sm font-semibold ${
                        step.done ? "text-navy-3 line-through" : "text-navy"
                      }`}
                    >
                      {step.title}
                    </div>
                    <div className="mt-0.5 text-[11px] text-navy-3">{step.sub}</div>
                  </div>

                  {/* Action */}
                  <div className="text-right">
                    {step.done ? (
                      <span className="inline-block rounded-md border border-border px-3 py-1.5 text-[11px] font-semibold text-navy-3">
                        Done ✓
                      </span>
                    ) : step.locked ? (
                      <span className="inline-block cursor-not-allowed rounded-md border border-border bg-bg px-3 py-1.5 text-[11px] font-semibold text-navy-3">
                        Locked
                      </span>
                    ) : isActive ? (
                      <Link
                        href={step.href}
                        className="inline-block rounded-md bg-gold px-3 py-1.5 text-[11px] font-semibold text-navy transition-colors hover:bg-gold-soft"
                      >
                        {step.cta}
                      </Link>
                    ) : step.optional ? (
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <span className="text-[11px] font-semibold text-navy-3">
                          Skip for now
                        </span>
                        <Link
                          href={step.href}
                          className="text-[11px] font-semibold text-gold hover:underline"
                        >
                          {step.cta}
                        </Link>
                      </span>
                    ) : (
                      <Link
                        href={step.href}
                        className="inline-block rounded-md border border-border px-3 py-1.5 text-[11px] font-semibold text-navy transition-colors hover:border-gold-soft"
                      >
                        {step.cta}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {/* What to expect side note (callback is MVP2 — no functional CTA) */}
        <div className="rounded-xl border border-border bg-surface p-6">
          <div className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
            What to expect
          </div>
          <h3 className="font-display text-base font-semibold text-navy">
            Your dashboard fills up{" "}
            <em className="not-italic text-gold [font-style:italic]">this week</em>
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-navy-2">
            As you add students and teachers post their first work, this page will
            surface daily activity, fee collections, and what needs your attention.{" "}
            <b className="text-navy">
              Right now it&apos;s quiet because nobody has done anything yet
            </b>{" "}
            — that&apos;s the way it should be.
          </p>
          {/* Timeline — what happens as the school comes online (surface §01). */}
          <ol className="mt-4 space-y-3 border-t border-border pt-4">
            {[
              { t: "Students get added", s: "Today · then parents are invited" },
              { t: "Term 1 invoices issued", s: "When you trigger them" },
              {
                t: "First payments & grades arrive",
                s: "Within the first week of class",
              },
            ].map((step, i) => (
              <li key={step.t} className="flex items-start gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold-bg font-display text-[10px] font-semibold text-navy">
                  {i + 1}
                </span>
                <div>
                  <div className="text-xs font-semibold text-navy">{step.t}</div>
                  <div className="text-[11px] text-navy-3">{step.s}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Need help? — the surface's second side panel (§01). Callback is MVP2. */}
        <div className="mt-3 rounded-xl border border-border bg-surface p-6">
          <div className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
            Need help?
          </div>
          <h3 className="font-display text-base font-semibold text-navy">We can call you</h3>
          <p className="mt-2 text-xs leading-relaxed text-navy-2">
            If anything feels stuck, reach out — our team is in Accra and we&apos;ll pick
            up. We&apos;ll also check in with you this week.
          </p>
        </div>
      </div>
    </div>
  );
}
