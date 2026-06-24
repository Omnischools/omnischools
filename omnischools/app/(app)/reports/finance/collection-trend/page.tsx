import Link from "next/link";
import { requireSchool } from "@/lib/auth/server";
import { getFinanceReport, ghs, num } from "@/lib/reports/finance-data";
import { ExportCsv } from "@/components/reports/export-csv";
import { PrintButton } from "@/components/reports/print-button";
import { ReportHeader } from "@/components/reports/report-header";
import { schoolFile } from "@/lib/filename";

export const dynamic = "force-dynamic";
export const metadata = { title: "Collection trend" };

export default async function CollectionTrendPage() {
  const { school } = await requireSchool();
  const r = await getFinanceReport(school.id, null);
  const maxMonth = Math.max(1, ...r.monthly.map((m) => num(m.amount)));
  const peak = r.monthly.reduce((p, m) => (num(m.amount) > num(p?.amount ?? 0) ? m : p), r.monthly[0]);

  return (
    <div className="mx-auto max-w-page">
      <ReportHeader
        crumb="Finance / Collection trend"
        pre="Collection"
        gold="trend"
        lede="Collection timing and pace across the period."
        actions={
          <>
            <ExportCsv
              filename={schoolFile(school.name, "collection-trend.csv")}
              headers={["Month", "Collected"]}
              rows={r.monthly.map((m) => [m.month, num(m.amount).toFixed(2)])}
            />
            <PrintButton label="Export PDF" />
            <Link
              href="/reports/outstanding"
              className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-bg hover:bg-navy-deep"
            >
              Open balances report →
            </Link>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi featured label="Collected to date" value={ghs(r.collected)} sub={`${r.rate}% of ${ghs(r.billed)} invoiced`} />
        <Kpi label="Still outstanding" value={ghs(r.outstanding)} tone="text-terra" sub="across all classes" />
        <Kpi label="Collection rate" value={`${r.rate}%`} sub={r.rate >= 80 ? "healthy" : "needs follow-up"} />
        <Kpi label="Peak month" value={peak ? ghs(num(peak.amount)) : "—"} sub={peak?.month ?? "no payments yet"} />
      </div>

      <h2 className="mb-3 font-display text-lg font-semibold text-navy">Collection over time</h2>
      {r.monthly.length === 0 ? (
        <Empty>No payments recorded yet.</Empty>
      ) : (
        <div className="space-y-2 rounded-xl border border-border bg-surface p-5">
          {r.monthly.map((m) => {
            const isPeak = m.month === peak?.month;
            return (
              <div key={m.month} className="flex items-center gap-3">
                <span className="w-16 shrink-0 font-mono text-xs text-navy-3">{m.month}</span>
                <div className="h-5 flex-1 overflow-hidden rounded-full bg-bg">
                  <div className={`h-full rounded-full ${isPeak ? "bg-green" : "bg-gold"}`} style={{ width: `${(num(m.amount) / maxMonth) * 100}%` }} />
                </div>
                <span className="w-28 shrink-0 text-right text-xs font-medium text-navy-2">{ghs(num(m.amount))}</span>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-xs italic text-navy-3">
        Term-on-term cumulative overlay, weekly grid and aging-by-household are coming in a later
        slice (needs a completed prior term).
      </p>
    </div>
  );
}

function Kpi({ label, value, sub, tone, featured }: { label: string; value: string; sub: string; tone?: string; featured?: boolean }) {
  return (
    <div className={`rounded-xl border p-5 ${featured ? "border-navy bg-navy" : "border-border bg-surface"}`}>
      <div className={`text-[10px] font-bold uppercase tracking-[0.1em] ${featured ? "text-gold-soft" : "text-navy-3"}`}>{label}</div>
      <div className={`mt-1.5 font-display text-2xl font-semibold ${featured ? "text-bg" : (tone ?? "text-navy")}`}>{value}</div>
      <div className={`mt-0.5 text-xs ${featured ? "text-bg/60" : "text-navy-3"}`}>{sub}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
      {children}
    </p>
  );
}
