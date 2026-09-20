import { cn } from "@/lib/utils";

// Oversight reads only the analytics DB (populated nightly by the ETL). This scaffold page renders
// no live data yet — the surfaces are built on top of withJurisdiction() reads in follow-up work.
export const dynamic = "force-dynamic";

const TIERS = [
  { level: "National (MoE)", scope: "All regions, districts and schools", filter: "no filter" },
  { level: "Regional director", scope: "The region, its districts, their schools", filter: "subtree" },
  { level: "District director", scope: "The district and the schools under it", filter: "subtree" },
];

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border-1 bg-surface p-5 shadow-sm">
      <div className="text-navy-3 text-xs uppercase tracking-wide">{label}</div>
      <div className="font-display text-navy mt-1 text-3xl">{value}</div>
      <div className="text-navy-3 mt-1 text-xs">{sub}</div>
    </div>
  );
}

export default function OversightHome() {
  return (
    <main className="mx-auto max-w-page px-4 py-10 md:px-8">
      <header className="border-border-1 mb-8 border-b pb-6">
        <p className="text-gold text-xs font-semibold uppercase tracking-[0.14em]">
          Omnischools Oversight
        </p>
        <h1 className="font-display text-navy mt-2 text-3xl md:text-4xl">
          GES <span className="accent-italic">monitoring</span> tier
        </h1>
        <p className="text-navy-2 mt-3 max-w-prose text-sm">
          Observational dashboards for district and regional directors and the Ministry of
          Education. Every figure is an aggregate read from the analytics database — never a named
          pupil record — and every figure carries its source and vintage.
        </p>
        <div className="text-navy-3 mt-4 inline-flex items-center gap-2 rounded-pill border border-border-1 bg-gold-bg px-3 py-1 text-xs">
          <span className="bg-warn inline-block h-2 w-2 rounded-full" aria-hidden />
          Scaffold — analytics DB not yet provisioned. As-of banner reads the latest successful ETL run.
        </div>
      </header>

      <section aria-label="Headline coverage" className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Reporting coverage" value="— of —" sub="Schools live on Omnischools ÷ EMIS register" />
        <StatCard label="Regions" value="16" sub="Ghana administrative regions" />
        <StatCard label="Data as of" value="—" sub="Latest successful nightly ETL run" />
      </section>

      <section aria-label="Jurisdiction tiers" className="mt-10">
        <h2 className="font-display text-navy text-xl">Jurisdiction tiers</h2>
        <p className="text-navy-3 mt-1 text-sm">
          One RLS predicate against <code className="font-mono text-xs">dim_jurisdiction</code>{" "}
          scopes every read to the user&apos;s subtree.
        </p>
        <div className="border-border-1 mt-4 overflow-hidden rounded-lg border">
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
                  <td className="text-navy px-4 py-2 font-medium">{t.level}</td>
                  <td className="text-navy-2 px-4 py-2">{t.scope}</td>
                  <td className="text-navy-3 px-4 py-2 font-mono text-xs">{t.filter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
