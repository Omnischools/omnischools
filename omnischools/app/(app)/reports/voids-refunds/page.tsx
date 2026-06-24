import { requireSchool } from "@/lib/auth/server";
import { getFinanceReport, ghs, num, METHOD_LABEL } from "@/lib/reports/finance-data";
import { ExportCsv } from "@/components/reports/export-csv";
import { PrintButton } from "@/components/reports/print-button";
import { ReportHeader } from "@/components/reports/report-header";
import { schoolFile } from "@/lib/filename";

export const dynamic = "force-dynamic";
export const metadata = { title: "Voids & refunds" };

export default async function VoidsRefundsPage() {
  const { school } = await requireSchool();
  const r = await getFinanceReport(school.id, null);
  const refunds = r.voids.filter((v) => v.isRefund);
  const justVoids = r.voids.filter((v) => !v.isRefund);
  const refundTotal = refunds.reduce((s, v) => s + num(v.amount), 0);
  const voidOnlyTotal = justVoids.reduce((s, v) => s + num(v.amount), 0);
  const ratio = r.collected > 0 ? (r.voidTotal / r.collected) * 100 : 0;
  const healthy = ratio < 2;

  return (
    <div className="mx-auto max-w-page">
      <ReportHeader
        crumb="Voids & refunds"
        pre="Voids &"
        gold="refunds"
        lede="Reversed transactions with their reasons. Low numbers are healthy; spikes warrant a closer look."
        actions={
          <>
            {r.voids.length > 0 && (
              <ExportCsv
                filename={schoolFile(school.name, "voids-refunds.csv")}
                headers={["Date", "Student", "Receipt", "Amount", "Method", "Type", "Reason", "By"]}
                rows={r.voids.map((v) => [
                  v.voidedAt ? new Date(v.voidedAt).toISOString().slice(0, 10) : "",
                  `${v.lastName}, ${v.firstName}`,
                  v.receiptNumber ?? "",
                  num(v.amount).toFixed(2),
                  METHOD_LABEL[v.method] ?? v.method,
                  v.isRefund ? "Refund" : "Void",
                  v.reason ?? "",
                  v.voidedBy ?? "",
                ])}
              />
            )}
            <PrintButton label="Export PDF" />
          </>
        }
      />

      {/* Health banner */}
      <div
        className={`mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 text-sm ${
          healthy ? "border-green/40 bg-green-bg/50" : "border-warn/40 bg-warn-bg/50"
        }`}
      >
        <span className={`font-semibold ${healthy ? "text-green" : "text-warn"}`}>
          {healthy ? "Healthy reversal rate" : "Elevated reversal rate"} · {ratio.toFixed(2)}% of collected
        </span>
        <span className="text-navy-2">
          benchmark <b className="font-semibold">under 2%</b> · {r.voids.length} event
          {r.voids.length === 1 ? "" : "s"} this period.
        </span>
      </div>

      {/* KPI strip */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-terra/50 bg-terra-bg/40 p-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-terra">Total reversed</div>
          <div className="mt-1.5 font-display text-2xl font-semibold text-terra">
            {r.voidTotal > 0 ? `−${ghs(r.voidTotal)}` : ghs(0)}
          </div>
          <div className="mt-0.5 text-xs text-navy-3">{ratio.toFixed(2)}% of {ghs(r.collected)} collected</div>
        </div>
        <Kpi label="Voids" value={String(justVoids.length)} sub={`${ghs(voidOnlyTotal)} · record corrections`} />
        <Kpi label="Refunds" value={String(refunds.length)} sub={`${ghs(refundTotal)} · money returned`} />
        <Kpi
          label="Avg per event"
          value={r.voids.length ? ghs(r.voidTotal / r.voids.length) : ghs(0)}
          sub="across all reversals"
        />
      </div>

      {/* Event list */}
      <h2 className="mb-3 font-display text-lg font-semibold text-navy">Every reversal this period</h2>
      {r.voids.length === 0 ? (
        <Empty>No voided or refunded payments.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-4 py-3 font-semibold">When</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Student &amp; reason</th>
                <th className="px-4 py-3 text-right font-semibold">Amount</th>
                <th className="px-4 py-3 font-semibold">Receipt</th>
                <th className="px-4 py-3 font-semibold">Recorded by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {r.voids.map((v, i) => (
                <tr key={i} className={v.isRefund ? "bg-terra-bg/30" : "hover:bg-bg"}>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-navy-3">
                    {v.voidedAt
                      ? new Date(v.voidedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-pill px-2 py-0.5 text-xs font-medium ${v.isRefund ? "bg-terra-bg text-terra" : "bg-bg text-navy-3"}`}>
                      {v.isRefund ? "Refund" : "Void"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-navy">{v.lastName}, {v.firstName}</div>
                    <div className="text-xs italic text-navy-3">{v.reason ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-navy">{ghs(num(v.amount))}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gold">{v.receiptNumber ?? "—"}</td>
                  <td className="px-4 py-3 text-navy-3">{v.voidedBy ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs italic text-navy-3">
        Void-vs-refund split cards, weekly trend chart and recorder analysis are coming in a later
        slice.
      </p>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">{label}</div>
      <div className="mt-1.5 font-display text-2xl font-semibold text-navy">{value}</div>
      <div className="mt-0.5 text-xs text-navy-3">{sub}</div>
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
