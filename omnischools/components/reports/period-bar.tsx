"use client";
import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { PERIOD_KEYS, PERIOD_LABELS, type PeriodKey } from "@/lib/reports/period";

/**
 * Functional PERIOD filter. Each pill writes `?period=<key>` (plus `from`/`to`
 * for custom) to the URL; the server page resolves the window and re-queries.
 */
export function PeriodBar({
  activeKey,
  termLabel,
  termWeeks,
  from = "",
  to = "",
}: {
  activeKey: PeriodKey;
  termLabel?: string | null;
  termWeeks?: number | null;
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(activeKey === "custom");
  const [cFrom, setCFrom] = useState(from);
  const [cTo, setCTo] = useState(to);

  function go(next: Record<string, string | undefined>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    router.push(`${pathname}?${sp.toString()}`);
  }

  function pick(key: PeriodKey) {
    if (key === "custom") {
      setOpen(true);
      if (cFrom && cTo) go({ period: "custom", from: cFrom, to: cTo });
      return;
    }
    setOpen(false);
    go({ period: key, from: undefined, to: undefined });
  }

  const labelFor = (key: PeriodKey) =>
    key === "term" && termLabel ? termLabel : PERIOD_LABELS[key];

  return (
    <div className="mb-6 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">Period</span>
        {PERIOD_KEYS.map((key) => {
          const active = key === activeKey;
          return (
            <button
              key={key}
              onClick={() => pick(key)}
              className={cn(
                "rounded-pill border px-3 py-1 text-xs font-semibold transition-colors",
                active
                  ? "border-navy bg-navy text-bg"
                  : "border-border-2 bg-surface text-navy-3 hover:border-gold hover:text-navy-2",
              )}
            >
              {labelFor(key)}
              {key === "term" && active && termWeeks ? (
                <span className="ml-1 font-normal text-gold-soft">{termWeeks} weeks</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {open && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-3">
          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-navy-3">
            From
            <input
              type="date"
              value={cFrom}
              onChange={(e) => setCFrom(e.target.value)}
              className="rounded-md border border-border-2 bg-bg px-2 py-1.5 text-xs text-navy outline-none focus:border-gold"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-navy-3">
            To
            <input
              type="date"
              value={cTo}
              onChange={(e) => setCTo(e.target.value)}
              className="rounded-md border border-border-2 bg-bg px-2 py-1.5 text-xs text-navy outline-none focus:border-gold"
            />
          </label>
          <button
            onClick={() => cFrom && cTo && go({ period: "custom", from: cFrom, to: cTo })}
            disabled={!cFrom || !cTo}
            className="rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
