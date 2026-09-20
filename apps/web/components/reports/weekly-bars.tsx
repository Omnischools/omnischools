import { ghs } from "@/lib/reports/finance-data";

export type WeekBar = { label: string; amount: number };

const kLabel = (n: number) =>
  n >= 1000 ? `${(n / 1000).toLocaleString("en-GH", { maximumFractionDigits: n % 1000 === 0 ? 0 : 1 })}k` : String(Math.round(n));

/**
 * Vertical weekly collection chart — replicates the surface's bar-chart:
 * grid lines with k-labels, one column per week, the peak week in green, the rest navy.
 */
export function WeeklyBars({ weeks }: { weeks: WeekBar[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.amount));
  const peak = weeks.reduce((p, w, i) => (w.amount > weeks[p].amount ? i : p), 0);
  const lines = [1, 0.75, 0.5, 0.25].map((f) => ({ pct: f * 100, label: kLabel(max * f) }));

  return (
    <div>
      {/* plot area */}
      <div className="relative ml-10 flex h-56 items-end gap-1.5">
        {/* grid lines */}
        {lines.map((l) => (
          <div
            key={l.pct}
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border"
            style={{ bottom: `${l.pct}%` }}
          >
            <span className="absolute -left-10 -top-2 w-9 text-right font-mono text-[10px] text-navy-3">
              {l.label}
            </span>
          </div>
        ))}
        {/* bars */}
        {weeks.map((w, i) => (
          <div key={w.label} className="group flex h-full flex-1 items-end justify-center">
            <div
              className={`w-full max-w-[28px] rounded-t-sm transition-opacity ${i === peak ? "bg-green" : "bg-navy opacity-80 group-hover:opacity-100"}`}
              style={{ height: `${Math.max(1.5, (w.amount / max) * 100)}%` }}
              title={`${w.label}: ${ghs(w.amount)}`}
            />
          </div>
        ))}
      </div>
      {/* x-axis labels */}
      <div className="ml-10 flex gap-1.5">
        {weeks.map((w) => (
          <span key={w.label} className="flex-1 text-center font-mono text-[10px] text-navy-3">
            {w.label}
          </span>
        ))}
      </div>
    </div>
  );
}
