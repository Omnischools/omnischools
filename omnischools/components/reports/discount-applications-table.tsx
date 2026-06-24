"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

export type DiscountAppRow = {
  id: string;
  studentName: string;
  className: string;
  schemeName: string;
  kind: "FIXED" | "PERCENT" | null;
  rate: string; // "50%" | "GHS 400.00" | "tiered"
  amount: number;
  amountLabel: string; // pre-formatted "GHS 400.00" (client stays free of server-only db imports)
  appliedLabel: string;
  colorKey: string;
  discountId: string;
};

type Scheme = { discountId: string; name: string; colorKey: string };

/** colorKey → solid background + readable text classes for the tier tag. */
const TAG_CLASS: Record<string, string> = {
  gold: "bg-gold-bg text-gold",
  green: "bg-green-bg text-green",
  warn: "bg-warn-bg text-warn",
  terra: "bg-terra-bg text-terra",
  "navy-3": "bg-bg text-navy-2",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "—";
}

export function DiscountApplicationsTable({
  rows,
  schemes,
}: {
  rows: DiscountAppRow[];
  schemes: Scheme[];
}) {
  const [active, setActive] = useState<string>("all"); // "all" | discountId
  const [q, setQ] = useState("");

  const count = (discountId: string) =>
    discountId === "all" ? rows.length : rows.filter((r) => r.discountId === discountId).length;
  // Only schemes that have rows get a pill.
  const pillSchemes = schemes.filter((s) => count(s.discountId) > 0);

  const shown = rows.filter((r) => {
    if (active !== "all" && r.discountId !== active) return false;
    if (q.trim() && !r.studentName.toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <button
          onClick={() => setActive("all")}
          className={cn(
            "rounded-pill border px-2.5 py-1 text-xs font-semibold transition-colors",
            active === "all"
              ? "border-navy bg-navy text-bg"
              : "border-border-2 bg-surface text-navy-2 hover:border-gold",
          )}
        >
          All applications{" "}
          <span className={active === "all" ? "text-gold-soft" : "text-navy-3"}>{rows.length}</span>
        </button>
        {pillSchemes.length > 0 && <span className="mx-1 h-5 w-px bg-border" />}
        {pillSchemes.map((s) => {
          const isOn = active === s.discountId;
          return (
            <button
              key={s.discountId}
              onClick={() => setActive(s.discountId)}
              className={cn(
                "rounded-pill border px-2.5 py-1 text-xs font-semibold transition-colors",
                isOn
                  ? "border-navy bg-navy text-bg"
                  : "border-border-2 bg-surface text-navy-2 hover:border-gold",
              )}
            >
              {s.name} <span className={isOn ? "text-gold-soft" : "text-navy-3"}>{count(s.discountId)}</span>
            </button>
          );
        })}
        <span className="mx-1 h-5 w-px bg-border" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by student…"
          className="w-64 rounded-md border border-border-2 bg-bg px-3 py-1.5 text-xs text-navy outline-none placeholder:italic placeholder:text-navy-3 focus:border-gold"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
            <tr>
              <th className="px-4 py-3 font-semibold">Student</th>
              <th className="px-4 py-3 font-semibold">Tier</th>
              <th className="px-4 py-3 text-right font-semibold">Rate</th>
              <th className="px-4 py-3 text-right font-semibold">Term value</th>
              <th className="px-4 py-3 font-semibold">Applied</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((r) => (
              <tr key={r.id} className="hover:bg-bg">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg font-mono text-[11px] font-semibold text-navy-3">
                      {initials(r.studentName)}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium text-navy">{r.studentName}</div>
                      <div className="text-xs text-navy-3">{r.className}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "rounded-pill px-2 py-0.5 text-xs font-medium",
                      TAG_CLASS[r.colorKey] ?? "bg-bg text-navy-2",
                    )}
                  >
                    {r.schemeName}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-navy-2">{r.rate}</td>
                <td className="px-4 py-3 text-right font-medium text-terra">−{r.amountLabel}</td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-navy-3">
                  {r.appliedLabel}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-navy-3">
                  No applications match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
