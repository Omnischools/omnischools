import { requireSchool } from "@/lib/auth/server";
import { getFinanceReport, ghs, num, METHOD_LABEL } from "@/lib/reports/finance-data";
import { ExportCsv } from "@/components/reports/export-csv";
import { PrintButton } from "@/components/reports/print-button";
import { ReportHeader } from "@/components/reports/report-header";
import { VoidsTable, type VoidRow } from "@/components/reports/voids-table";
import { schoolFile } from "@/lib/filename";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";
export const metadata = { title: "Voids & refunds" };

const REASON_CATS = [
  { key: "dispute", label: "Parent disputed charge", match: /disput/i, tone: "bg-terra" },
  { key: "duplicate", label: "Duplicate payment record", match: /duplicate|double/i, tone: "bg-warn" },
  { key: "entry", label: "Wrong amount entered", match: /wrong amount|incorrect|amount/i, tone: "bg-gold" },
  { key: "student", label: "Wrong student", match: /wrong student|misallocat/i, tone: "bg-navy-2" },
  { key: "withdrawal", label: "Student withdrew", match: /withdr|left school|transferred/i, tone: "bg-navy-3" },
  { key: "overpayment", label: "Overpayment refund", match: /overpay|over-pay|excess/i, tone: "bg-green" },
] as const;
const catOf = (reason: string | null) => {
  const r = reason ?? "";
  return REASON_CATS.find((c) => c.match.test(r)) ?? { key: "other", label: "Other", tone: "bg-border-2" };
};

const fmtFull = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const weekKey = (d: Date | string) => {
  const dt = new Date(d);
  const mon = new Date(dt);
  mon.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return mon.toISOString().slice(0, 10);
};

export default async function VoidsRefundsPage() {
  const { school } = await requireSchool();
  const r = await getFinanceReport(school.id, null);
  const events = r.voids;
  const refunds = events.filter((v) => v.isRefund);
  const justVoids = events.filter((v) => !v.isRefund);
  const refundTotal = refunds.reduce((s, v) => s + num(v.amount), 0);
  const voidOnlyTotal = justVoids.reduce((s, v) => s + num(v.amount), 0);
  const ratio = r.collected > 0 ? (r.voidTotal / r.collected) * 100 : 0;
  const healthy = ratio < 2;

  // Reason breakdown (free-text voidReason → keyword categories).
  const reasonAgg = new Map<string, { count: number; amount: number }>();
  for (const v of events) {
    const c = catOf(v.reason);
    const a = reasonAgg.get(c.key) ?? { count: 0, amount: 0 };
    a.count++;
    a.amount += num(v.amount);
    reasonAgg.set(c.key, a);
  }

  // Recorder analysis.
  const recAgg = new Map<string, { voids: number; refunds: number }>();
  for (const v of events) {
    const who = v.voidedBy ?? "—";
    const a = recAgg.get(who) ?? { voids: 0, refunds: 0 };
    if (v.isRefund) a.refunds++;
    else a.voids++;
    recAgg.set(who, a);
  }
  const recorders = Array.from(recAgg.entries())
    .map(([name, a]) => ({ name, ...a, total: a.voids + a.refunds }))
    .sort((x, y) => y.total - x.total);

  // Weekly trend.
  const weekAgg = new Map<string, { voids: number; refunds: number }>();
  for (const v of events) {
    if (!v.voidedAt) continue;
    const k = weekKey(v.voidedAt);
    const a = weekAgg.get(k) ?? { voids: 0, refunds: 0 };
    if (v.isRefund) a.refunds++;
    else a.voids++;
    weekAgg.set(k, a);
  }
  const weeks = Array.from(weekAgg.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const weekMax = Math.max(1, ...weeks.map(([, a]) => a.voids + a.refunds));

  const rows: VoidRow[] = events.map((v, i) => ({
    id: String(i),
    dateLabel: v.voidedAt ? fmtFull(v.voidedAt) : "—",
    isRefund: !!v.isRefund,
    studentName: `${v.firstName} ${v.lastName}`,
    reason: v.reason ?? "—",
    amount: ghs(num(v.amount)),
    receiptNumber: v.receiptNumber ?? "—",
    recordedBy: v.voidedBy ?? "—",
  }));

  return (
    <div className="mx-auto max-w-page">
      <ReportHeader
        crumb="Voids & refunds"
        pre="Voids &"
        gold="refunds"
        lede="Reversed transactions with their reasons. Low numbers are healthy; spikes warrant a closer look."
        actions={
          <>
            {events.length > 0 && (
              <ExportCsv
                filename={schoolFile(school.name, "voids-refunds.csv")}
                headers={["Date", "Student", "Receipt", "Amount", "Method", "Type", "Reason", "By"]}
                rows={events.map((v) => [
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
          benchmark <b className="font-semibold">under 2%</b> · {events.length} event
          {events.length === 1 ? "" : "s"} · no concerning patterns detected.
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
        <Kpi label="Avg per event" value={events.length ? ghs(r.voidTotal / events.length) : ghs(0)} sub="across all reversals" />
      </div>

      {events.length === 0 ? (
        <EmptyState tone="muted">No voided or refunded payments.</EmptyState>
      ) : (
        <>
          {/* Split cards */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SplitCard
              icon="V"
              title={`Voids · ${justVoids.length} event${justVoids.length === 1 ? "" : "s"}`}
              quote={"“the record was wrong”"}
              total={ghs(voidOnlyTotal)}
              sharePct={r.voidTotal > 0 ? Math.round((voidOnlyTotal / r.voidTotal) * 100) : 0}
              pill="Money usually didn't move"
              tone="text-navy"
            />
            <SplitCard
              icon="R"
              title={`Refunds · ${refunds.length} event${refunds.length === 1 ? "" : "s"}`}
              quote="&ldquo;we sent money back&rdquo;"
              total={ghs(refundTotal)}
              sharePct={r.voidTotal > 0 ? Math.round((refundTotal / r.voidTotal) * 100) : 0}
              pill="Money actually went back"
              tone="text-terra"
            />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Reason breakdown */}
            <div className="rounded-xl border border-border bg-surface p-5">
              <h2 className="mb-3 font-display text-base font-semibold text-navy">Why reversals happened</h2>
              <div className="space-y-2">
                {REASON_CATS.map((c) => {
                  const a = reasonAgg.get(c.key) ?? { count: 0, amount: 0 };
                  return (
                    <div key={c.key} className={`flex items-center gap-2.5 ${a.count === 0 ? "opacity-50" : ""}`}>
                      <span className={`h-3 w-3 shrink-0 rounded-sm ${c.tone}`} />
                      <span className="flex-1 text-sm text-navy-2">{c.label}</span>
                      <span className="font-mono text-xs text-navy-3">{a.count}</span>
                      <span className="w-24 text-right text-xs font-medium text-navy-2">
                        {a.count ? ghs(a.amount) : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Weekly trend */}
            <div className="rounded-xl border border-border bg-surface p-5">
              <h2 className="mb-3 font-display text-base font-semibold text-navy">Trend across the term</h2>
              {weeks.length === 0 ? (
                <p className="text-sm text-navy-3">No reversals to chart.</p>
              ) : (
                <div className="space-y-2">
                  {weeks.map(([wk, a]) => (
                    <div key={wk} className="flex items-center gap-3">
                      <span className="w-20 shrink-0 font-mono text-[10px] text-navy-3">{fmtFull(wk).slice(0, 6)}</span>
                      <div className="flex h-4 flex-1 overflow-hidden rounded bg-bg">
                        {a.voids > 0 && (
                          <div className="bg-terra/60" style={{ width: `${(a.voids / weekMax) * 100}%` }} />
                        )}
                        {a.refunds > 0 && (
                          <div className="bg-terra" style={{ width: `${(a.refunds / weekMax) * 100}%` }} />
                        )}
                      </div>
                      <span className="w-14 shrink-0 text-right font-mono text-[10px] text-navy-3">
                        {a.voids}v · {a.refunds}r
                      </span>
                    </div>
                  ))}
                  <div className="flex gap-4 pt-1 text-[10px] text-navy-3">
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-terra/60" /> Voids</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-terra" /> Refunds</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Recorder analysis */}
          <h2 className="mb-3 font-display text-base font-semibold text-navy">Who recorded the reversals</h2>
          <div className="mb-6 overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">Person</th>
                  <th className="px-4 py-3 text-right font-semibold">Voids</th>
                  <th className="px-4 py-3 text-right font-semibold">Refunds</th>
                  <th className="px-4 py-3 text-right font-semibold">Share</th>
                  <th className="px-4 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recorders.map((p) => {
                  const share = events.length ? Math.round((p.total / events.length) * 100) : 0;
                  const flag = share > 50;
                  return (
                    <tr key={p.name} className="hover:bg-bg">
                      <td className="px-4 py-3 font-medium text-navy">{p.name}</td>
                      <td className="px-4 py-3 text-right font-mono text-navy-2">{p.voids}</td>
                      <td className="px-4 py-3 text-right font-mono text-navy-2">{p.refunds}</td>
                      <td className="px-4 py-3 text-right font-mono text-navy-2">{share}%</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${flag ? "bg-warn-bg text-warn" : "bg-bg text-navy-3"}`}>
                          {flag ? "Concentrated" : "Normal"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Event list */}
          <h2 className="mb-3 font-display text-base font-semibold text-navy">Every reversal this period</h2>
          <VoidsTable rows={rows} />
        </>
      )}
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

function SplitCard({
  icon,
  title,
  quote,
  total,
  sharePct,
  pill,
  tone,
}: {
  icon: string;
  title: string;
  quote: string;
  total: string;
  sharePct: number;
  pill: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-terra-bg font-display text-sm font-bold text-terra">
          {icon}
        </span>
        <div>
          <div className="font-display text-sm font-semibold text-navy">{title}</div>
          <div className="text-xs italic text-navy-3" dangerouslySetInnerHTML={{ __html: quote }} />
        </div>
      </div>
      <div className={`mt-3 font-display text-2xl font-semibold ${tone}`}>{total}</div>
      <div className="mt-0.5 text-xs text-navy-3">{sharePct}% of total reversed value</div>
      <div className="mt-3 inline-block rounded-pill bg-bg px-2.5 py-1 text-[11px] font-medium text-navy-3">{pill}</div>
    </div>
  );
}
