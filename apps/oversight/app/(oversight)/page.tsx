import { getOfficerSession } from "@/lib/auth";
import { scopeFor } from "@/lib/db/rls";
import { formatAsOf, getLatestSuccessfulEtlRun } from "@/lib/oversight/etl-status";
import { cn } from "@/lib/utils";

// Oversight reads only the analytics DB (populated nightly by the ETL). This scaffold page renders
// no live data yet — the surfaces are built on top of withJurisdiction() reads in follow-up work.
//
// MOVED INTO THE `(oversight)` GROUP in increment G, which is the whole of Lucy G2's "post-sign-in
// landing". It used to sit at `app/page.tsx`, OUTSIDE the group — so the landing rendered with no
// app shell, no identity strip, and (once the layout became the authorization half of route
// protection) no provisioning check. An officer who was authenticated but not provisioned would have
// seen the dashboard frame rather than the G4 "your access isn't set up yet" state, which is exactly
// the window Lucy's map says must not exist. Inside the group it inherits the shell (real officer
// name, role, tier, jurisdiction) and the guard, and the sidebar's "Dashboard" link now lands
// somewhere that has a sidebar.
export const dynamic = "force-dynamic";

const TIERS = [
  {
    level: "National (MoE)",
    scope: "All regions, districts and schools",
    filter: "no filter",
  },
  {
    level: "Regional director",
    scope: "The region, its districts, their schools",
    filter: "subtree",
  },
  {
    level: "District director",
    scope: "The district and the schools under it",
    filter: "subtree",
  },
];

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border-1 bg-surface p-5 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-navy-3">{label}</div>
      <div className="mt-1 font-display text-3xl text-navy">{value}</div>
      <div className="mt-1 text-xs text-navy-3">{sub}</div>
    </div>
  );
}

/**
 * THE AS-OF BANNER (increment H, task H20). The card's value was a hard-coded `"—"`; it now reads the
 * latest SUCCESS `etl_run`.
 *
 * THE FALLBACK IS HONEST, NOT COSMETIC. With no successful run the card says "No successful run yet",
 * never a dash: a dash on a regulator's dashboard is ambiguous between "no data", "loading" and
 * "broken", and the first thing an officer needs to know about a figure is whether it was ever
 * computed. The read itself is fail-soft (a null, never a thrown page) for the same reason the
 * jurisdiction-chrome read is: losing the vintage label must degrade the chrome, not take down the
 * landing page.
 *
 * NOT TOUCHED HERE: the "Reporting coverage" card, still `"— of —"`. The coverage figure is real and
 * available (`ref_emis_school_register`), but wiring it is its own slice — it needs Lucy's copy for the
 * sub-line at each tier and a ruling on whether a district officer's card shows their district's
 * coverage or the national one. Left honestly blank rather than guessed.
 */
export default async function OversightHome() {
  const officer = await getOfficerSession();
  const latestRun = officer
    ? await getLatestSuccessfulEtlRun(scopeFor(officer)).catch(() => null)
    : null;

  return (
    <main className="mx-auto max-w-page px-4 py-10 md:px-8">
      <header className="mb-8 border-b border-border-1 pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">
          Omnischools Oversight
        </p>
        <h1 className="mt-2 font-display text-3xl text-navy md:text-4xl">
          GES <span className="accent-italic">monitoring</span> tier
        </h1>
        <p className="mt-3 max-w-prose text-sm text-navy-2">
          Observational dashboards for district and regional directors and the Ministry of
          Education. Every figure is an aggregate read from the analytics database — never
          a named pupil record — and every figure carries its source and vintage.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-pill border border-border-1 bg-gold-bg px-3 py-1 text-xs text-navy-3">
          <span className="inline-block h-2 w-2 rounded-full bg-warn" aria-hidden />
          Scaffold — analytics DB not yet provisioned. As-of banner reads the latest
          successful ETL run.
        </div>
      </header>

      <section aria-label="Headline coverage" className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Reporting coverage"
          value="— of —"
          sub="Schools live on Omnischools ÷ EMIS register"
        />
        <StatCard label="Regions" value="16" sub="Ghana administrative regions" />
        <StatCard
          label="Data as of"
          value={formatAsOf(latestRun)}
          sub="Latest successful nightly ETL run"
        />
      </section>

      <section aria-label="Jurisdiction tiers" className="mt-10">
        <h2 className="font-display text-xl text-navy">Jurisdiction tiers</h2>
        <p className="mt-1 text-sm text-navy-3">
          One RLS predicate against{" "}
          <code className="font-mono text-xs">dim_jurisdiction</code> scopes every read to
          the user&apos;s subtree.
        </p>
        <div className="mt-4 overflow-hidden rounded-lg border border-border-1">
          <table className="w-full text-left text-sm">
            <thead className="bg-gold-bg text-navy-2">
              <tr>
                <th className="px-4 py-2 font-semibold">Tier</th>
                <th className="px-4 py-2 font-semibold">Sees</th>
                <th className="px-4 py-2 font-semibold">RLS</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map((t, i) => (
                <tr key={t.level} className={cn(i % 2 === 1 && "bg-bg")}>
                  <td className="px-4 py-2 font-medium text-navy">{t.level}</td>
                  <td className="px-4 py-2 text-navy-2">{t.scope}</td>
                  <td className="px-4 py-2 font-mono text-xs text-navy-3">{t.filter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
