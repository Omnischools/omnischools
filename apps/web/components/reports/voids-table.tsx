"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

export type VoidRow = {
  id: string;
  dateLabel: string;
  isRefund: boolean;
  studentName: string;
  reason: string;
  amount: string;
  receiptNumber: string;
  recordedBy: string;
};

const FILTERS: { key: "all" | "void" | "refund"; label: string }[] = [
  { key: "all", label: "All events" },
  { key: "void", label: "Voids" },
  { key: "refund", label: "Refunds" },
];

export function VoidsTable({ rows }: { rows: VoidRow[] }) {
  const [tab, setTab] = useState<"all" | "void" | "refund">("all");
  const [q, setQ] = useState("");
  const count = (k: "all" | "void" | "refund") =>
    k === "all" ? rows.length : rows.filter((r) => (k === "refund") === r.isRefund).length;

  const shown = rows.filter((r) => {
    if (tab !== "all" && (tab === "refund") !== r.isRefund) return false;
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      if (
        !r.studentName.toLowerCase().includes(n) &&
        !r.reason.toLowerCase().includes(n) &&
        !r.receiptNumber.toLowerCase().includes(n)
      )
        return false;
    }
    return true;
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        {FILTERS.map((f) => {
          const active = tab === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setTab(f.key)}
              className={cn(
                "rounded-pill border px-2.5 py-1 text-xs font-semibold transition-colors",
                active ? "border-navy bg-navy text-bg" : "border-border-2 bg-surface text-navy-2 hover:border-gold",
              )}
            >
              {f.label} <span className={active ? "text-bg/70" : "text-navy-3"}>{count(f.key)}</span>
            </button>
          );
        })}
        <span className="mx-1 h-5 w-px bg-border" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by student, receipt, or reason…"
          className="w-64 rounded-md border border-border-2 bg-bg px-3 py-1.5 text-xs text-navy outline-none placeholder:italic placeholder:text-navy-3 focus:border-gold"
        />
      </div>

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
            {shown.map((r) => (
              <tr key={r.id} className={r.isRefund ? "bg-terra-bg/30" : "hover:bg-bg"}>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-navy-3">{r.dateLabel}</td>
                <td className="px-4 py-3">
                  <span className={cn("rounded-pill px-2 py-0.5 text-xs font-medium", r.isRefund ? "bg-terra-bg text-terra" : "bg-bg text-navy-3")}>
                    {r.isRefund ? "Refund" : "Void"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-navy">{r.studentName}</div>
                  <div className="text-xs italic text-navy-3">{r.reason}</div>
                </td>
                <td className="px-4 py-3 text-right font-medium text-navy">{r.amount}</td>
                <td className="px-4 py-3 font-mono text-xs text-gold">{r.receiptNumber}</td>
                <td className="px-4 py-3 text-navy-3">{r.recordedBy}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-navy-3">
                  No reversals match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
