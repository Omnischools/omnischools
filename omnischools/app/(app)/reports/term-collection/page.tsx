import Link from "next/link";
import { requireSchool } from "@/lib/auth/server";
import { getFinanceReport, ghs, num, METHOD_LABEL } from "@/lib/reports/finance-data";
import { ExportCsv } from "@/components/reports/export-csv";
import { PrintButton } from "@/components/reports/print-button";
import { ReportHeader } from "@/components/reports/report-header";
import { WeeklyBars } from "@/components/reports/weekly-bars";
import { EmptyState } from "@/components/ui/empty-state";
import { PeriodBar } from "@/components/reports/period-bar";
import { resolvePeriod, weeksIn } from "@/lib/reports/period";
import { getReportTerm } from "@/lib/reports/report-term";
import { schoolFile } from "@/lib/filename";

export const dynamic = "force-dynamic";
export const metadata = { title: "Term collection" };

const classRate = (b: unknown, c: unknown) =>
  num(b) > 0 ? Math.round((num(c) / num(b)) * 100) : 0;

const METHOD_SWATCH: Record<string, string> = {
  MTN_MOMO: "#C8975B",
  CASH: "#2F6B47",
  BANK_TRANSFER: "#1A2B47",
  TELECEL_CASH: "#B84A39",
  AIRTELTIGO_MONEY: "#C58A2E",
};

const fmtWeek = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function TermCollectionPage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string };
}) {
  const { school } = await requireSchool();
  const term = await getReportTerm(school.id);
  const period = resolvePeriod(searchParams, term, new Date());
  const r = await getFinanceReport(school.id, null, { start: period.start, end: period.end });

  // Trailing window so the chart reads like a term rather than the whole history.
  const weeksAll = r.weekly.map((w) => ({ iso: w.weekStart, amount: num(w.amount) }));
  const weeksWin = weeksAll.slice(-16);
  const weeks = weeksWin.map((w, i) => ({ label: `W${i + 1}`, amount: w.amount, iso: w.iso }));
  const peakIdx = weeks.length
    ? weeks.reduce((p, w, i) => (w.amount > weeks[p].amount ? i : p), 0)
    : 0;
  const methodTotal = Math.max(1, r.byMethod.reduce((s, m) => s + num(m.amount), 0));

  const kpis = [
    { label: "Total billed", value: ghs(r.billed), sub: `${num(r.totals?.invoiceCount)} invoices · ${num(r.totals?.studentCount)} students`, featured: false, tone: "text-navy" },
    { label: "Collected", value: ghs(r.collected), sub: `${r.rate}% of billed`, featured: true, tone: "", arrow: true },
    { label: "Outstanding", value: ghs(r.outstanding), sub: `${num(r.totals?.debtorCount)} students with balances`, featured: false, tone: "text-navy" },
    { label: "Reversed", value: `−${ghs(r.voidTotal)}`, sub: `${r.voids.length} voids & refunds`, featured: false, tone: "text-terra" },
  ];

  return (
    <div className="mx-auto max-w-page">
      <ReportHeader
        crumb="Term collection"
        pre="Term"
        gold="collection"
        lede="How much you've collected this term, by method and by class."
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

      {/* Period bar */}
      <PeriodBar
        activeKey={period.key}
        termLabel={term ? `${term.label} · ${term.academicYear}` : null}
        termWeeks={term ? weeksIn(term.start, term.end) : null}
        from={period.from}
        to={period.to}
      />

      {/* KPI strip */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
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
            <div className={`mt-0.5 text-xs ${k.featured ? "text-gold-soft" : "text-navy-3"}`}>
              {k.arrow && <span className="mr-1 text-green">↑</span>}
              {k.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Weekly chart + method, side by side */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">Weekly collection</div>
              <h3 className="mt-0.5 font-display text-lg font-semibold text-navy">Pattern across the term</h3>
            </div>
            {weeks.length > 0 && (
              <div className="max-w-[10rem] text-right text-xs text-navy-3">
                Peak in <b className="text-navy">Week {peakIdx + 1}</b> when most parents settle term fees
              </div>
            )}
          </div>
          {weeks.length === 0 ? (
            <EmptyState tone="muted">No payments recorded yet.</EmptyState>
          ) : (
            <>
              <WeeklyBars weeks={weeks.map((w) => ({ label: w.label, amount: w.amount }))} />
              <div className="mt-4 flex justify-between text-[11px] text-navy-3">
                <span>
                  Collecting since <b className="text-navy">{fmtWeek(weeks[0].iso)}</b>
                </span>
                <span>
                  <b className="text-navy">{weeks.length}</b> {weeks.length === 1 ? "week" : "weeks"} shown
                </span>
              </div>
            </>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">By payment method</div>
            <h3 className="mt-0.5 font-display text-lg font-semibold text-navy">Where it came from</h3>
          </div>
          {r.byMethod.length === 0 ? (
            <EmptyState tone="muted">No payments recorded yet.</EmptyState>
          ) : (
            <div className="space-y-3">
              {r.byMethod
                .slice()
                .sort((a, b) => num(b.amount) - num(a.amount))
                .map((m) => {
                  const pct = Math.round((num(m.amount) / methodTotal) * 100);
                  return (
                    <div key={m.method} className="flex items-center gap-3">
                      <span
                        className="h-3 w-3 shrink-0 rounded-sm"
                        style={{ backgroundColor: METHOD_SWATCH[m.method] ?? "#5C6675" }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-navy">{METHOD_LABEL[m.method] ?? m.method}</div>
                        <div className="font-mono text-xs text-navy-3">{ghs(num(m.amount))}</div>
                      </div>
                      <span className="w-10 shrink-0 text-right font-mono text-sm font-semibold text-navy-2">{pct}%</span>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      </div>

      {/* By class */}
      <section className="mt-8 rounded-xl border border-border bg-surface p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">By class</div>
            <h3 className="mt-0.5 font-display text-lg font-semibold text-navy">Collection rate per class</h3>
          </div>
          <div className="max-w-[12rem] text-right text-xs text-navy-3">
            Click a class to see <b className="text-navy">which students</b> are outstanding
          </div>
        </div>
        {r.byClass.length === 0 ? (
          <EmptyState tone="muted">No invoices yet. Issue fees from the Fees module to see collections here.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-navy-3">
                <tr>
                  <th className="py-2 font-semibold">Class</th>
                  <th className="py-2 font-semibold">Collection rate</th>
                  <th className="py-2 text-right font-semibold">Billed</th>
                  <th className="py-2 text-right font-semibold">Collected</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.byClass.map((c) => {
                  const rate = classRate(c.billed, c.collected);
                  const tone = rate >= 70 ? "bg-green" : rate >= 50 ? "bg-warn" : "bg-terra";
                  const pctTone = rate >= 70 ? "text-green" : rate >= 50 ? "text-warn" : "text-terra";
                  return (
                    <tr key={c.className} className="hover:bg-bg">
                      <td className="py-3 font-medium text-navy">{c.className}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-32 overflow-hidden rounded-full bg-bg">
                            <div className={`h-full rounded-full ${tone}`} style={{ width: `${rate}%` }} />
                          </div>
                          <span className={`font-mono text-xs font-semibold ${pctTone}`}>{rate}%</span>
                        </div>
                      </td>
                      <td className="py-3 text-right text-navy-2">{ghs(num(c.billed))}</td>
                      <td className="py-3 text-right text-green">{ghs(num(c.collected))}</td>
                      <td className="py-3 text-right">
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
      </section>
    </div>
  );
}
