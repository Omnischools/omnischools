import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type {
  ComparisonModel,
  ComparisonMetricRow,
  MetricKind,
  Mark,
} from "@/lib/oversight/comparison";
import { initialsOf } from "./breakdown-table";
import { formatCount, formatPupilCount, formatRatio, formatRatioPercent } from "./kpi-card";

/**
 * THE COMPARISON TABLE (increment I — comparison workspace, Lucy's map §2).
 *
 * The breakdown table TRANSPOSED: metrics are rows, entities are columns, and a pinned "District/Region
 * average" benchmark column sits apart on the right. Read ACROSS a row to compare, DOWN a column to
 * profile one school. It is a NEW component rather than a reuse of `BreakdownTable` because the axes are
 * swapped, but it shares the breakdown's atoms (`initialsOf`, the kpi-card formatters, the green/terra
 * tone) so the two surfaces state the same number the same way.
 *
 * ═══ RANKING IS RELATIVE, PER ROW — the single biggest divergence from the breakdown table ═══════════
 * `BreakdownTable` colours each cell by an ABSOLUTE band (coverage ≥85% green, WASSCE ≥67% green). This
 * table marks the LEADER and LAGGARD among the SELECTED entities instead — the comparison's whole point
 * is relative, and the marks + colours are already computed in `lib/oversight/comparison.ts` (direction-
 * aware, floored, ≥2-eligible, ties handled). This component only RENDERS `model`; it re-decides nothing.
 * The benchmark column is never marked (it is the reference, not a participant).
 */

type MarkTone = "best" | "worst" | "none";

/** cv value / bar colour follows the RELATIVE mark, not an absolute band (see file note). */
const CV_TEXT: Record<MarkTone, string> = {
  best: "text-green",
  worst: "text-terra",
  none: "text-navy",
};
const BAR_FILL: Record<MarkTone, string> = {
  best: "bg-green",
  worst: "bg-terra",
  none: "bg-navy",
};
const DOT_TONE: Record<"best" | "worst", string> = {
  best: "bg-green-bg text-green",
  worst: "bg-terra-bg text-terra",
};

function toneOf(mark: Mark | null): MarkTone {
  return mark ?? "none";
}

/** Format a cell/benchmark value by metric kind. The ONE place numbers become strings. */
function formatValue(kind: MetricKind, value: number): string {
  switch (kind) {
    case "pupils":
      return formatPupilCount(value);
    case "count":
      return formatCount(value);
    case "rate":
      return `${formatRatioPercent(value, 0)}%`;
    case "ratio":
      return `${formatRatio(value, 1)}:1`;
  }
}

/** The muted `—`: a measure not filed. Never a fabricated 0. */
function Absent() {
  return (
    <span className="text-navy-3" title="Not filed">
      —
    </span>
  );
}

/** One entity column's header: badge + name + meta ("public · est. 1960" / "your district"). */
export interface ComparisonColumnHeader {
  id: string;
  name: string;
  meta: string | null;
  /** The officer's anchor entity (gold badge), mirroring the breakdown's home-row tint. */
  anchor?: boolean;
  /**
   * True when this entity's register coverage is too thin to read a rate honestly (district/region
   * depth only). The engine already excludes it from rate MARKING; the header states WHY, so a rate that
   * silently loses its mark is instead visibly flagged (Kofi R5.1 — the caveat beside the finding).
   */
  coverageAmbiguous?: boolean;
}

const TH_ENTITY =
  "border-b-2 border-border-2 px-3.5 py-3 text-center align-bottom min-w-[130px]";
const TD = "border-b border-border-1 px-3.5 py-3 text-center align-top";

function CvBar({ fraction, tone }: { fraction: number; tone: MarkTone }) {
  // 0..1 clamped — a rate never over-draws its track.
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="mt-1.5 h-[5px] overflow-hidden rounded-pill bg-bg">
      <div className={cn("h-full rounded-pill", BAR_FILL[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

function RankDot({ mark, label }: { mark: "best" | "worst"; label: string }) {
  return (
    <span
      className={cn(
        "mt-1 inline-block rounded-pill px-1.5 py-[1px] text-[9px] font-bold",
        DOT_TONE[mark],
      )}
    >
      {label}
    </span>
  );
}

function MetricRows({ row }: { row: ComparisonMetricRow }) {
  const { metric, cells, benchmark } = row;
  return (
    <tr>
      <td className="border-b border-border-1 bg-bg px-3.5 py-3 text-left align-top">
        <span className="text-[11.5px] font-semibold text-navy">{metric.label}</span>
        <span className="mt-0.5 block text-[9.5px] font-medium text-navy-3">
          {metric.subLabel}
        </span>
      </td>
      {cells.map((cell, i) => {
        const tone = toneOf(cell.mark);
        return (
          <td key={i} className={TD}>
            {cell.value === null ? (
              <Absent />
            ) : (
              <>
                <div className={cn("font-mono text-[14px] font-bold", CV_TEXT[tone])}>
                  {formatValue(metric.kind, cell.value)}
                </div>
                {cell.mark && metric.markLabel ? (
                  <RankDot mark={cell.mark} label={metric.markLabel[cell.mark]} />
                ) : null}
                {metric.bar ? <CvBar fraction={cell.value} tone={tone} /> : null}
              </>
            )}
          </td>
        );
      })}
      {/* The benchmark cell — shaded, never marked (Kofi R4.1). `—` when the metric has no benchmark. */}
      <td className={cn(TD, "bg-navy/5")}>
        {benchmark === null ? (
          <Absent />
        ) : (
          <>
            <div className="font-mono text-[14px] font-bold text-navy">
              {formatValue(metric.kind, benchmark)}
            </div>
            {metric.bar ? <CvBar fraction={benchmark} tone="none" /> : null}
          </>
        )}
      </td>
    </tr>
  );
}

export function ComparisonTable({
  model,
  columns,
  benchmarkLabel,
  benchmarkMeta,
  footnote,
}: {
  model: ComparisonModel;
  columns: ComparisonColumnHeader[];
  /** "District average" / "Region average" — the pinned benchmark column's name. */
  benchmarkLabel: string;
  benchmarkMeta: string;
  footnote: ReactNode;
}) {
  const span = 1 + columns.length + 1; // metric label + entities + benchmark

  return (
    <div className="overflow-hidden rounded-xl border border-border-1 bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Comparison across {columns.length} entities against the {benchmarkLabel}, by metric.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="w-[200px] border-b-2 border-border-2 bg-bg px-3.5 py-3 text-left align-bottom text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3"
              >
                Metric
              </th>
              {columns.map((col) => (
                <th key={col.id} scope="col" className={TH_ENTITY}>
                  <span
                    aria-hidden
                    className={cn(
                      "mx-auto mb-1.5 flex h-[34px] w-[34px] items-center justify-center rounded-md font-display text-[12px] font-semibold",
                      col.anchor ? "bg-gold text-navy" : "bg-navy text-bg",
                    )}
                  >
                    {initialsOf(col.name)}
                  </span>
                  <span className="block font-display text-[13px] font-semibold leading-tight text-navy">
                    {col.name}
                  </span>
                  {col.meta ? (
                    <span className="mt-0.5 block text-[9px] font-semibold text-navy-3">
                      {col.meta}
                    </span>
                  ) : null}
                  {col.coverageAmbiguous ? (
                    <span
                      className="mt-1 inline-block rounded-pill bg-warn-bg px-1.5 py-[1px] text-[8.5px] font-bold uppercase tracking-wide text-warn"
                      title="Register coverage is thin — rates are shown but not ranked"
                    >
                      thin coverage
                    </span>
                  ) : null}
                </th>
              ))}
              <th
                scope="col"
                className={cn(TH_ENTITY, "bg-navy/5")}
                title="Pinned reference — not ranked"
              >
                <span
                  aria-hidden
                  className="mx-auto mb-1.5 flex h-[34px] w-[34px] items-center justify-center rounded-md bg-gold font-display text-[12px] font-semibold text-navy"
                >
                  Ø
                </span>
                <span className="block font-display text-[13px] font-semibold leading-tight text-navy">
                  {benchmarkLabel}
                </span>
                <span className="mt-0.5 block text-[9px] font-semibold text-navy-3">
                  {benchmarkMeta}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {model.sections.map((section) => (
              <Fragment key={`sec-${section.title}`}>
                <tr>
                  <td
                    colSpan={span}
                    className="bg-navy px-3.5 py-2 text-left text-[9px] font-bold uppercase tracking-[0.14em] text-gold-soft"
                  >
                    {section.title}
                  </td>
                </tr>
                {section.rows.map((row) => (
                  <MetricRows key={row.metric.key} row={row} />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border-1 px-5 py-3 text-[10.5px] leading-relaxed text-navy-3">
        {footnote}
      </p>
    </div>
  );
}
