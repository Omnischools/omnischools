import { cn } from "@/lib/utils";
import type { PerfTone } from "@/lib/reports/grade-band";

/**
 * Shared page primitives for the report detail routes, lifted verbatim from the
 * school-stats reference report so every report reads as one system: the snapshot pill,
 * the KPI strip (featured navy card + plain cards), the section card, and the perf/rate bar.
 */

const BAR_TONE: Record<PerfTone, string> = {
  green: "bg-green",
  gold: "bg-gold",
  terra: "bg-terra",
  none: "bg-navy-3",
};
const NUM_TONE: Record<PerfTone, string> = {
  green: "text-green",
  gold: "text-gold",
  terra: "text-terra",
  none: "text-navy",
};

export function SnapshotPill({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 inline-flex items-center gap-2 rounded-pill border border-gold-soft bg-gold-bg px-3 py-1.5 text-[11px] text-navy-2">
      <span className="h-1.5 w-1.5 rounded-full bg-green" />
      {children}
    </div>
  );
}

export function KpiStrip({ children }: { children: React.ReactNode }) {
  return <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">{children}</div>;
}

export function FeaturedKpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-navy bg-navy p-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold-soft">{label}</div>
      <div className="mt-1.5 font-display text-3xl font-semibold leading-none text-bg">{value}</div>
      {sub && <div className="mt-2 text-xs text-gold-soft">{sub}</div>}
    </div>
  );
}

export function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">{label}</div>
      <div className="mt-1.5 font-display text-3xl font-semibold leading-none text-navy">{value}</div>
      {sub && <div className="mt-2 text-xs text-navy-3">{sub}</div>}
    </div>
  );
}

export function SectionCard({
  eyebrow,
  title,
  meta,
  children,
}: {
  eyebrow: string;
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <div className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-gold">
            {eyebrow}
          </div>
          <h3 className="font-display text-[17px] font-semibold text-navy">{title}</h3>
        </div>
        {meta && <div className="max-w-[16rem] text-right text-[11px] text-navy-3">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

/** Column-head row (hidden on mobile), matching the school-stats table heads. */
export function ColumnHeads({ cols, children }: { cols: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "hidden items-center gap-3 border-b border-border bg-bg px-6 py-3 text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3 lg:grid",
        cols,
      )}
    >
      {children}
    </div>
  );
}

/** A performance / rate bar: track + tone fill (capped at 100%) + numeric on the right. */
export function PerfBar({
  value,
  tone,
  suffix = "",
}: {
  value: number | null;
  tone: PerfTone;
  suffix?: string;
}) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative h-2.5 flex-1 rounded-pill border border-border bg-bg">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-pill", BAR_TONE[tone])}
          style={{ width: `${width}%` }}
        />
      </div>
      <span
        className={cn(
          "min-w-[42px] text-right font-mono text-xs font-semibold",
          NUM_TONE[tone],
        )}
      >
        {value == null ? "—" : `${value}${suffix}`}
      </span>
    </div>
  );
}
