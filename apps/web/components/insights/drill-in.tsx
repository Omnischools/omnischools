"use client";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * INS · the ONLY client component on `/insights`. It holds two pieces of local UI state — `open` (the
 * disclosure) and `activeDim` (which dimension shows) — and renders the SERVER-PRE-RENDERED aggregate
 * `content` node for the active dimension. It NEVER refetches and NEVER holds student data: every
 * dimension's node is already-rendered aggregate JSX in the RSC payload (memory
 * `reports-data-is-server-only` — the server owns data + formatting). Switching dimension is instant.
 *
 * A single-dimension drill still gets the disclosure; the segmented control is suppressed (mirrors the
 * ledger class-switcher's "suppressed when only one" rule).
 */
export type DrillDimension = { key: string; label: string; content: ReactNode };

export function DrillIn({
  toggleLabel = "Break down",
  dimensions,
  defaultDim,
}: {
  toggleLabel?: string;
  dimensions: DrillDimension[];
  defaultDim?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeDim, setActiveDim] = useState(defaultDim ?? dimensions[0]?.key);
  const panelId = useId();

  if (dimensions.length === 0) return null;
  const active = dimensions.find((d) => d.key === activeDim) ?? dimensions[0];

  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs font-semibold text-gold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        {open ? `Hide breakdown ▴` : `${toggleLabel} ▾`}
      </button>

      {open && (
        <div id={panelId} className="mt-3">
          {dimensions.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Break down by">
              {dimensions.map((d) => {
                const on = d.key === active.key;
                return (
                  <button
                    key={d.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setActiveDim(d.key)}
                    className={cn(
                      "rounded-pill border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
                      on
                        ? "border-navy bg-navy text-bg"
                        : "border-border-2 bg-surface text-navy-3 hover:border-gold hover:text-navy-2",
                    )}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          )}
          <div role="tabpanel">{active.content}</div>
        </div>
      )}
    </div>
  );
}
