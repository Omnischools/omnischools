import Link from "next/link";

/**
 * Marketing landing placeholder (Phase 0).
 * Faithful translation of omnischools-landing.html follows in Phase 2; this verifies
 * brand colours, fonts, and tokens render end-to-end.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-page flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <span className="font-display text-xl font-semibold text-navy">
          Omni<span className="accent-italic">schools</span>
        </span>
        <span className="rounded-pill border border-gold-soft bg-gold-bg px-3 py-1 text-xs font-medium uppercase tracking-[0.12em] text-navy-2">
          Phase 0 · Foundation
        </span>
      </header>

      <section className="flex flex-1 flex-col justify-center gap-6 py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
          School management, built for Ghana
        </p>
        <h1 className="max-w-prose font-display text-5xl font-semibold leading-tight text-navy md:text-6xl">
          One operating system for{" "}
          <span className="accent-italic">Basic, Senior &amp; Oversight</span> schools.
        </h1>
        <p className="text-md max-w-content text-navy-3">
          Admissions, fees, attendance, gradebook, and parent communication — multi-tenant
          from day one, with school-level data isolation and an append-only audit trail.
          Demo school:{" "}
          <span className="font-mono text-navy-2">Asankrangwa SHS (WR-WAW-014)</span>.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/start"
            className="text-md rounded-md bg-primary px-5 py-3 font-semibold text-primary-foreground shadow-md transition-colors hover:bg-navy-2"
          >
            Onboard a school
          </Link>
          <Link
            href="/pricing"
            className="bg-surface text-md rounded-md border border-input px-5 py-3 font-semibold text-navy transition-colors hover:bg-gold-bg"
          >
            View pricing
          </Link>
        </div>
      </section>

      <footer className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-6 text-sm text-navy-3">
        <span className="rounded-pill bg-green-bg px-2.5 py-0.5 text-green">
          ● Connected
        </span>
        <span>Omnischools Basic · Senior · Oversight</span>
        <span className="ml-auto font-mono text-xs">
          GHS · Next.js 14 · Supabase · Drizzle
        </span>
      </footer>
    </main>
  );
}
