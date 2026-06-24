import { requireSchool } from "@/lib/auth/server";
import { getFinanceReport, ghs, num, ordinal } from "@/lib/reports/finance-data";
import { ExportCsv } from "@/components/reports/export-csv";
import { PrintButton } from "@/components/reports/print-button";
import { ReportHeader } from "@/components/reports/report-header";
import { schoolFile } from "@/lib/filename";

export const dynamic = "force-dynamic";
export const metadata = { title: "Discounts given" };

export default async function DiscountsPage() {
  const { school } = await requireSchool();
  const r = await getFinanceReport(school.id, null);

  const catName = new Map(r.catRows.map((c) => [c.id, c.name]));
  const tiersByDiscount = new Map<string, { rank: number; value: number }[]>();
  for (const t of r.discTierRows) {
    const arr = tiersByDiscount.get(t.discountId) ?? [];
    arr.push({ rank: t.rank, value: num(t.value) });
    tiersByDiscount.set(t.discountId, arr);
  }
  const valueText = (d: (typeof r.discRows)[number]) => {
    if (d.isTiered) {
      return (tiersByDiscount.get(d.id) ?? [])
        .sort((a, b) => a.rank - b.rank)
        .map((t) => `${ordinal(t.rank)} ${d.kind === "PERCENT" ? `${t.value}%` : ghs(t.value)}`)
        .join(" · ");
    }
    return d.kind === "PERCENT" ? `${num(d.value)}%` : ghs(num(d.value));
  };

  return (
    <div className="mx-auto max-w-page">
      <ReportHeader
        crumb="Discounts given"
        pre="Discounts"
        gold="given"
        lede="The fees you chose not to collect — by tier and by recipient."
        actions={
          <>
            {r.discRows.length > 0 && (
              <ExportCsv
                filename={schoolFile(school.name, "discounts.csv")}
                headers={["Discount", "Value", "Applies to", "Tiered", "Approval", "Applied"]}
                rows={r.discRows.map((d) => [
                  d.name,
                  valueText(d),
                  d.appliesToCategoryId ? (catName.get(d.appliesToCategoryId) ?? "Whole invoice") : "Whole invoice",
                  d.isTiered ? "Yes" : "No",
                  d.requiresApproval ? (d.approvedAt ? "Approved" : "Pending") : "—",
                  String(d.appliedCount),
                ])}
              />
            )}
            <PrintButton label="Export PDF" />
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-navy bg-navy p-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-gold-soft">Total discounted</div>
          <div className="mt-1.5 font-display text-2xl font-semibold text-bg">{ghs(r.discountTotal)}</div>
          <div className="mt-0.5 text-xs text-bg/60">
            {r.billed > 0 ? `${Math.round((r.discountTotal / r.billed) * 100)}% of total billed` : "no invoices yet"}
          </div>
        </div>
        <Kpi label="Discounted invoices" value={String(r.discountedCount)} sub="this period" />
        <Kpi label="Discounts configured" value={String(r.discRows.length)} sub="active rules" />
        <Kpi
          label="Tiered discounts"
          value={String(r.discRows.filter((d) => d.isTiered).length)}
          sub="e.g. sibling 1st/2nd/3rd"
        />
      </div>

      <h2 className="mb-3 font-display text-lg font-semibold text-navy">Discounts in effect</h2>
      {r.discRows.length === 0 ? (
        <Empty>No discounts configured. Set them up under Billing.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Discount</th>
                <th className="px-4 py-3 font-semibold">Value</th>
                <th className="px-4 py-3 font-semibold">Applies to</th>
                <th className="px-4 py-3 text-right font-semibold">Applied</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {r.discRows.map((d) => (
                <tr key={d.id} className="hover:bg-bg">
                  <td className="px-4 py-3 font-medium text-navy">
                    {d.name}
                    {d.requiresApproval && !d.approvedAt && (
                      <span className="ml-2 rounded-pill bg-warn-bg px-2 py-0.5 text-[11px] font-medium text-warn">
                        Pending approval
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-navy-2">{valueText(d)}</td>
                  <td className="px-4 py-3 text-navy-2">
                    {d.appliesToCategoryId ? (catName.get(d.appliesToCategoryId) ?? "Whole invoice") : "Whole invoice"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-navy-2">{d.appliedCount}×</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs italic text-navy-3">
        Per-application breakdown (tier shares, timeline, top recipients, per-student rows) needs a
        discount-application table — flagged for a schema-backed slice.
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
