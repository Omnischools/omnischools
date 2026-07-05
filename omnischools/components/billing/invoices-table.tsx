"use client";
import { useMemo, useState } from "react";
import Link from "next/link";

export type InvoiceRow = {
  invoiceId: string;
  studentId: string;
  student: string;
  className: string | null;
  invoiceNumber: string;
  billed: number;
  paid: number;
  balance: number;
  discountPct: number | null; // for the tag; null when no discount
  exempt: boolean;
  status: "PAID" | "PARTIAL" | "OVERDUE" | "UNPAID" | "EXEMPT";
  overdueDays: number;
  receiptPaymentId: string | null; // latest payment that settled this invoice → its receipt
};

type Filter = "ALL" | "UNPAID" | "PARTIAL" | "OVERDUE";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "UNPAID", label: "Unpaid" },
  { key: "PARTIAL", label: "Partial" },
  { key: "OVERDUE", label: "Overdue" },
];

const ghs = (v: number) =>
  `GHS ${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS: Record<InvoiceRow["status"], { label: (r: InvoiceRow) => string; cls: string }> = {
  PAID: { label: () => "Paid", cls: "bg-green-bg text-green" },
  EXEMPT: { label: () => "Exempted", cls: "bg-green-bg text-green" },
  PARTIAL: { label: () => "Partial", cls: "bg-gold-bg text-gold" },
  OVERDUE: { label: (r) => `Overdue ${r.overdueDays}d`, cls: "bg-terra-bg text-terra" },
  UNPAID: { label: () => "Unpaid", cls: "bg-bg text-navy-3" },
};

/**
 * School-wide invoices table (sms-mvp1 §03 "admin billing"): filter pills, per-student
 * rows with billed/paid/balance, discount tags and status badges. Rows link to the
 * student's billing statement where a payment can be recorded.
 */
export function InvoicesTable({ rows }: { rows: InvoiceRow[] }) {
  const [filter, setFilter] = useState<Filter>("ALL");

  const shown = useMemo(() => {
    switch (filter) {
      case "UNPAID":
        return rows.filter((r) => r.status === "UNPAID");
      case "PARTIAL":
        return rows.filter((r) => r.status === "PARTIAL");
      case "OVERDUE":
        return rows.filter((r) => r.status === "OVERDUE");
      default:
        return rows;
    }
  }, [rows, filter]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3.5">
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-pill border px-3 py-1 text-xs font-semibold transition-colors ${
                on
                  ? "border-navy bg-navy text-bg"
                  : "border-border-2 bg-bg text-navy-3 hover:bg-gold-bg"
              }`}
            >
              {f.label}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-navy-3">
          Showing <span className="font-semibold text-navy">{shown.length}</span> of{" "}
          {rows.length}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-navy-3">
          No invoices in this filter.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-[10px] uppercase tracking-[0.08em] text-navy-3">
              <tr>
                <th className="px-4 py-3 font-bold">Student</th>
                <th className="px-4 py-3 font-bold">Class</th>
                <th className="px-4 py-3 font-bold">Invoice</th>
                <th className="px-4 py-3 text-right font-bold">Billed</th>
                <th className="px-4 py-3 text-right font-bold">Paid</th>
                <th className="px-4 py-3 text-right font-bold">Balance</th>
                <th className="px-4 py-3 font-bold">Status</th>
                <th className="px-4 py-3 text-right font-bold">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => {
                const st = STATUS[r.status];
                return (
                  <tr key={r.invoiceId} className="transition-colors hover:bg-gold-bg">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/students/${r.studentId}/billing`}
                        className="font-semibold text-navy hover:text-gold hover:underline"
                      >
                        {r.student}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-navy-2">{r.className ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-navy-2">
                      {r.invoiceNumber}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="font-medium text-navy">{ghs(r.billed)}</span>
                      {r.exempt ? (
                        <span className="ml-1.5 rounded-[3px] bg-green-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-green">
                          Exempt
                        </span>
                      ) : r.discountPct != null ? (
                        <span className="ml-1.5 rounded-[3px] bg-gold-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-gold">
                          −{r.discountPct}%
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right text-navy-2">
                      {r.paid > 0 ? ghs(r.paid) : "—"}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-medium ${
                        r.balance > 0 ? "text-terra" : "text-navy-3"
                      }`}
                    >
                      {r.balance > 0 ? ghs(r.balance) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] ${st.cls}`}
                      >
                        {st.label(r)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.receiptPaymentId ? (
                        <a
                          href={`/api/receipts/${r.receiptPaymentId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block rounded-md border border-border-2 px-2.5 py-1 text-xs font-semibold text-navy transition-colors hover:border-gold-soft hover:bg-gold-bg"
                        >
                          Receipt
                        </a>
                      ) : (
                        <span className="text-xs text-navy-3">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
