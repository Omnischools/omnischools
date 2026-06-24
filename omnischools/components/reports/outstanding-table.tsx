"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { SendReminderButton } from "@/components/reports/send-reminder-button";

export type DebtorBucket = "notYetDue" | "dueThisWeek" | "d1to30" | "d30plus";
export type DebtorRow = {
  studentId: string;
  name: string;
  initials: string;
  code: string;
  className: string;
  billed: string;
  paid: string;
  balance: string;
  guardianName: string | null;
  guardianPhone: string | null;
  bucket: DebtorBucket;
  agingLabel: string;
};

const FILTERS: { key: "all" | DebtorBucket; label: string }[] = [
  { key: "all", label: "All" },
  { key: "notYetDue", label: "Not yet due" },
  { key: "dueThisWeek", label: "Due this week" },
  { key: "d1to30", label: "1–30 overdue" },
  { key: "d30plus", label: "30+ overdue" },
];

const PILL: Record<DebtorBucket, string> = {
  d30plus: "bg-terra-bg text-terra",
  d1to30: "bg-warn-bg text-warn",
  dueThisWeek: "bg-green-bg text-green",
  notYetDue: "bg-bg text-navy-3",
};

export function OutstandingTable({ rows, classes }: { rows: DebtorRow[]; classes: string[] }) {
  const [tab, setTab] = useState<"all" | DebtorBucket>("all");
  const [cls, setCls] = useState("all");
  const [q, setQ] = useState("");

  const count = (k: "all" | DebtorBucket) =>
    k === "all" ? rows.length : rows.filter((r) => r.bucket === k).length;

  const shown = rows.filter((r) => {
    if (tab !== "all" && r.bucket !== tab) return false;
    if (cls !== "all" && r.className !== cls) return false;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      if (
        !r.name.toLowerCase().includes(needle) &&
        !(r.guardianName ?? "").toLowerCase().includes(needle)
      )
        return false;
    }
    return true;
  });

  return (
    <div>
      {/* Filter strip */}
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        {FILTERS.map((f) => {
          const active = tab === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setTab(f.key)}
              className={cn(
                "rounded-pill border px-2.5 py-1 text-xs font-semibold transition-colors",
                active
                  ? "border-navy bg-navy text-bg"
                  : "border-border-2 bg-surface text-navy-2 hover:border-gold",
              )}
            >
              {f.label}{" "}
              <span className={active ? "text-bg/70" : "text-navy-3"}>{count(f.key)}</span>
            </button>
          );
        })}
        <span className="mx-1 h-5 w-px bg-border" />
        <select
          value={cls}
          onChange={(e) => setCls(e.target.value)}
          className="rounded-md border border-border-2 bg-bg px-2.5 py-1.5 text-xs text-navy outline-none focus:border-gold"
        >
          <option value="all">All classes</option>
          {classes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by student or guardian…"
          className="w-56 rounded-md border border-border-2 bg-bg px-3 py-1.5 text-xs text-navy outline-none placeholder:italic placeholder:text-navy-3 focus:border-gold"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
            <tr>
              <th className="px-4 py-3 font-semibold">Student</th>
              <th className="px-4 py-3 font-semibold">Class</th>
              <th className="px-4 py-3 text-right font-semibold">Billed</th>
              <th className="px-4 py-3 text-right font-semibold">Paid</th>
              <th className="px-4 py-3 text-right font-semibold">Balance</th>
              <th className="px-4 py-3 font-semibold">Aging</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((r) => {
              const overdue = r.bucket === "d1to30" || r.bucket === "d30plus";
              return (
                <tr
                  key={r.studentId}
                  className={r.bucket === "d30plus" ? "bg-terra-bg/30" : "hover:bg-bg"}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold-bg font-display text-[11px] font-semibold text-navy">
                        {r.initials}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium text-navy">{r.name}</div>
                        <div className="text-[11px] text-navy-3">
                          {r.guardianName ? (
                            <>
                              {r.guardianName}
                              {r.guardianPhone ? ` · ${r.guardianPhone}` : ""}
                            </>
                          ) : (
                            <span className="italic">no guardian on file</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-navy-2">{r.className}</td>
                  <td className="px-4 py-3 text-right text-navy-2">{r.billed}</td>
                  <td className="px-4 py-3 text-right text-green">{r.paid}</td>
                  <td className="px-4 py-3 text-right font-medium text-terra">{r.balance}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-pill px-2 py-0.5 text-xs font-medium",
                        PILL[r.bucket],
                      )}
                    >
                      {r.agingLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {overdue ? (
                      r.guardianPhone ? (
                        <SendReminderButton studentId={r.studentId} />
                      ) : (
                        <span className="text-[11px] italic text-navy-3">no phone</span>
                      )
                    ) : (
                      <span className="text-[11px] text-navy-3">Not yet due</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-navy-3">
                  No students match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
