import Link from "next/link";
import { requireSchool } from "@/lib/auth/server";
import { getFinanceReport, ghs, num, METHOD_LABEL } from "@/lib/reports/finance-data";
import { ExportCsv } from "@/components/reports/export-csv";
import { PrintButton } from "@/components/reports/print-button";
import { ReportHeader } from "@/components/reports/report-header";
import { schoolFile } from "@/lib/filename";

export const dynamic = "force-dynamic";
export const metadata = { title: "Term collection" };

const classRate = (b: unknown, c: unknown) =>
  num(b) > 0 ? Math.round((num(c) / num(b)) * 100) : 0;

export default async function TermCollectionPage() {
  const { school } = await requireSchool();
  const r = await getFinanceReport(school.id, null);
  const maxMonth = Math.max(1, ...r.monthly.map((m) => num(m.amount)));
  const methodTotal = Math.max(1, r.byMethod.reduce((s, m) => s + num(m.amount), 0));

  const kpis = [
    { label: "Total billed", value: ghs(r.billed), sub: `${num(r.totals?.invoiceCount)} invoices`, featured: false, tone: "text-navy" },
    { label: "Collected", value: ghs(r.collected), sub: `${r.rate}% of billed`, featured: true, tone: "" },
    { label: "Outstanding", value: ghs(r.outstanding), sub: "across all classes", featured: false, tone: "text-terra" },
    { label: "Collection rate", value: `${r.rate}%`, sub: r.rate >= 80 ? "healthy" : "needs follow-up", featured: false, tone: "text-navy" },
  ];

  return (
    <div className="mx-auto max-w-page">
      <ReportHeader
        crumb="Term collection"
        pre="Term"
        gold="collection"
        lede="How much you've collected so far, by method and by class."
        actions={
          <>
            <ExportCsv
              filename={schoolFile(school.name, "term-collection.csv")}
              headers={["Class", "Billed", "Collected", "Outstanding", "Rate %"]}
              rows={r.byClass.map((c) => [
                c.className,
                num(c.billed).toFixed(2),
                num(c.collected).toFixed(2),
                num(c.outstanding).toFixed(2),
                String(classRate(c.billed, c.collected)),
              ])}
            />
            <PrintButton label="Export PDF" />
          </>
        }
      />

      {/* KPI strip */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className={`rounded-xl border p-5 ${k.featured ? "border-navy bg-navy" : "border-border bg-surface"}`}
          >
            <div className={`text-[10px] font-bold uppercase tracking-[0.1em] ${k.featured ? "text-gold-soft" : "text-navy-3"}`}>
              {k.label}
            </div>
            <div className={`mt-1.5 font-display text-2xl font-semibold ${k.featured ? "text-bg" : k.tone}`}>
              {k.value}
            </div>
            <div className={`mt-0.5 text-xs ${k.featured ? "text-bg/60" : "text-navy-3"}`}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* By class */}
      <h2 className="mb-3 font-display text-lg font-semibold text-navy">Collection rate per class</h2>
      {r.byClass.length === 0 ? (
        <Empty>No invoices yet. Issue fees from the Fees module to see collections here.</Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Class</th>
                <th className="px-4 py-3 font-semibold">Collection rate</th>
                <th className="px-4 py-3 text-right font-semibold">Billed</th>
                <th className="px-4 py-3 text-right font-semibold">Collected</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {r.byClass.map((c) => {
                const rate = classRate(c.billed, c.collected);
                const tone = rate >= 70 ? "bg-green" : rate >= 50 ? "bg-gold" : "bg-terra";
                return (
                  <tr key={c.className} className="hover:bg-bg">
                    <td className="px-4 py-3 font-medium text-navy">{c.className}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-bg">
                          <div className={`h-full rounded-full ${tone}`} style={{ width: `${rate}%` }} />
                        </div>
                        <span className="font-mono text-xs font-semibold text-navy-2">{rate}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-navy-2">{ghs(num(c.billed))}</td>
                    <td className="px-4 py-3 text-right text-green">{ghs(num(c.collected))}</td>
                    <td className="px-4 py-3 text-right">
                      {c.classId && (
                        <Link href={`/reports/class/${c.classId}`} className="text-xs font-semibold text-gold hover:underline">
                          View →
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Monthly */}
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-navy">Collection over time</h2>
          {r.monthly.length === 0 ? (
            <Empty>No payments recorded yet.</Empty>
          ) : (
            <div className="space-y-2 rounded-xl border border-border bg-surface p-5">
              {r.monthly.map((m) => (
                <div key={m.month} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 font-mono text-xs text-navy-3">{m.month}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded-full bg-bg">
                    <div className="h-full rounded-full bg-gold" style={{ width: `${(num(m.amount) / maxMonth) * 100}%` }} />
                  </div>
                  <span className="w-28 shrink-0 text-right text-xs font-medium text-navy-2">{ghs(num(m.amount))}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* By method */}
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-navy">Where it came from</h2>
          {r.byMethod.length === 0 ? (
            <Empty>No payments recorded yet.</Empty>
          ) : (
            <div className="space-y-2 rounded-xl border border-border bg-surface p-5">
              {r.byMethod
                .slice()
                .sort((a, b) => num(b.amount) - num(a.amount))
                .map((m) => {
                  const pct = Math.round((num(m.amount) / methodTotal) * 100);
                  return (
                    <div key={m.method} className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-navy">{METHOD_LABEL[m.method] ?? m.method}</span>
                      <span className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-navy-2">{ghs(num(m.amount))}</span>
                        <span className="w-9 text-right font-mono text-xs text-navy-3">{pct}%</span>
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      </div>
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
