import Link from "next/link";
import { requireSchool } from "@/lib/auth/server";
import { getFinanceReport, ghs, num, AGING } from "@/lib/reports/finance-data";
import { ExportCsv } from "@/components/reports/export-csv";
import { PrintButton } from "@/components/reports/print-button";
import { ReportHeader } from "@/components/reports/report-header";
import { schoolFile } from "@/lib/filename";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outstanding balances" };

export default async function OutstandingPage() {
  const { school } = await requireSchool();
  const r = await getFinanceReport(school.id, null);
  const agingMax = Math.max(1, ...AGING.map((b) => r.agingMap.get(b.key)?.amount ?? 0));
  const debtors = r.byClass.filter((c) => num(c.outstanding) > 0);

  return (
    <div className="mx-auto max-w-page">
      <ReportHeader
        crumb="Outstanding balances"
        pre="Who hasn't"
        gold="paid"
        lede="Unpaid balances grouped by how far past due they are."
        actions={
          <>
            <ExportCsv
              filename={schoolFile(school.name, "outstanding.csv")}
              headers={["Bucket", "Outstanding", "Invoices"]}
              rows={AGING.map((b) => {
                const a = r.agingMap.get(b.key);
                return [b.label, num(a?.amount).toFixed(2), String(a?.count ?? 0)];
              })}
            />
            <PrintButton label="Export PDF" />
          </>
        }
      />

      {/* Hero callout */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-terra/40 bg-terra-bg/40 p-5">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
            Currently outstanding
          </div>
          <div className="mt-1 font-display text-3xl font-semibold text-terra">
            {ghs(r.outstanding)}
          </div>
        </div>
        <p className="max-w-sm text-sm text-navy-3">
          <b className="text-terra">{ghs(r.overdueTotal)}</b> of it is overdue ·{" "}
          <b className="text-navy-2">{r.overdue30PlusCount}</b> student
          {r.overdue30PlusCount === 1 ? "" : "s"} are overdue 30+ days.
        </p>
      </div>

      {/* Aging strip */}
      {r.outstanding <= 0 ? (
        <Empty>Nothing outstanding — every invoice is settled.</Empty>
      ) : (
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="space-y-2">
            {AGING.map((b) => {
              const a = r.agingMap.get(b.key);
              const amt = a?.amount ?? 0;
              return (
                <div key={b.key} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 text-xs text-navy-2">{b.label}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded-full bg-bg">
                    <div className={`h-full rounded-full ${b.tone}`} style={{ width: `${(amt / agingMax) * 100}%` }} />
                  </div>
                  <span className="w-14 shrink-0 text-right text-[11px] text-navy-3">{a?.count ?? 0} inv</span>
                  <span className="w-28 shrink-0 text-right text-xs font-medium text-navy-2">{ghs(amt)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* By class */}
      <h2 className="mb-3 mt-8 font-display text-lg font-semibold text-navy">Outstanding by class</h2>
      {debtors.length === 0 ? (
        <Empty>No outstanding balances by class.</Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Class</th>
                <th className="px-4 py-3 text-right font-semibold">Billed</th>
                <th className="px-4 py-3 text-right font-semibold">Collected</th>
                <th className="px-4 py-3 text-right font-semibold">Outstanding</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {debtors.map((c) => (
                <tr key={c.className} className="hover:bg-bg">
                  <td className="px-4 py-3 font-medium text-navy">{c.className}</td>
                  <td className="px-4 py-3 text-right text-navy-2">{ghs(num(c.billed))}</td>
                  <td className="px-4 py-3 text-right text-green">{ghs(num(c.collected))}</td>
                  <td className="px-4 py-3 text-right font-medium text-terra">{ghs(num(c.outstanding))}</td>
                  <td className="px-4 py-3 text-right">
                    {c.classId && (
                      <Link href={`/reports/class/${c.classId}`} className="text-xs font-semibold text-gold hover:underline">
                        View debtors →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs italic text-navy-3">
        Student-level outstanding table with guardian contact and per-row reminders is coming in
        the next slice.
      </p>
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
