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
import { vacancyTone } from "./vacancy-tone";

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

/**
 * The like-for-like group the benchmark column is drawn from: its SIZE and the NOUN for one of its
 * members ("schools", "districts", "SHS"). One object rather than a pre-baked string because the two
 * parts are used in two places that say different things — the column header names the population,
 * each benchmark cell divides its own contributor count by it.
 */
export interface BenchmarkPopulation {
  count: number;
  noun: string;
}

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
    // UNSIGNED by contract: every `rate` metric here (qualification, attendance, coverage, girls'
    // share) is a 0..1 proportion. A measure that can go negative takes `signedRate` below — this arm
    // is deliberately NOT taught to handle a sign, so a new signed measure cannot quietly inherit the
    // bare-percentage rendering this file's `signedCount` rule exists to forbid.
    case "rate":
      return `${formatRatioPercent(value, 0)}%`;
    case "ratio":
      return `${formatRatio(value, 1)}:1`;
    /**
     * A SIGNED count always carries a WORD (VACANCY-SURFACING-RULING V6): a bare "−3" in a vacancy cell
     * is unreadable to the MoE/GES officer the surface is for, and "3" with no sign is a lie by omission.
     * Positive = posts unfilled (shortage); negative = teachers over establishment (surplus), written
     * unsigned beside the word so it does not read as a double negative; a real 0 is "balanced".
     */
    case "signedCount":
      return value > 0
        ? `+${formatCount(value)} unfilled`
        : value < 0
          ? `${formatCount(Math.abs(value))} over`
          : "balanced";
    /**
     * A SIGNED RATE OBEYS THE SAME RULE AS A SIGNED COUNT — the vacancy row's benchmark (Kofi V6/V10).
     *
     * This is the one cell on the surface where a percentage crosses zero, and it sits under the
     * "District average" header: "−6%" there reads as "6% below average", which is the opposite of what
     * it means. So the word carries the sign and the magnitude is written UNSIGNED beside it, exactly as
     * `signedCount` does — "6% short" (posts unfilled against establishment), "6% over" (teachers over
     * establishment), and a true zero is "at establishment", the panel's own wording for a real balance.
     */
    case "signedRate":
      return value > 0
        ? `${formatRatioPercent(value, 0)}% short`
        : value < 0
          ? `${formatRatioPercent(Math.abs(value), 0)}% over`
          : "at establishment";
  }
}

/**
 * THE VALUE'S TONE. Normally the RELATIVE mark (see the file note) — this table's colour channel means
 * rank, not an absolute band.
 *
 * `signedCount` is the one exception, and it is a ruling: the SIGN carries a valence of its own, and that
 * mapping is `vacancyTone()` — the ONE home for it, shared with the establishment panel and the breakdown
 * table, never re-decided here (Dex N6). Such a row is unranked by construction, so there is no mark for
 * this to override.
 */
function valueTone(kind: MetricKind, value: number, tone: MarkTone): string {
  if (kind === "signedCount") return vacancyTone(value);
  return CV_TEXT[tone];
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

function MetricRows({
  row,
  benchmarkPopulation,
}: {
  row: ComparisonMetricRow;
  benchmarkPopulation: BenchmarkPopulation;
}) {
  const { metric, cells, benchmark, benchmarkContributors } = row;
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
                <div
                  className={cn(
                    "font-mono text-[14px] font-bold",
                    valueTone(metric.kind, cell.value, tone),
                  )}
                >
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
            {/* `benchmarkKind` where the benchmark is a different UNIT from the cells — the vacancy
                row's cells are signed counts of posts while its benchmark is the weighted vacancy RATE
                (Kofi V10), itself SIGNED and therefore worded ("6% short" / "6% over"), never a bare
                percentage under this header. Every other metric leaves it unset and formats both the
                same way. */}
            <div className="font-mono text-[14px] font-bold text-navy">
              {formatValue(metric.benchmarkKind ?? metric.kind, benchmark)}
            </div>
            {/* THE FIGURE'S OWN BASE, per row. The benchmark folds over the children that FILED this
                measure, and which those are is per-metric: vacancies is public-only, attendance is
                gradebook adopters only, qualification is the schools that sat. So each cell states how
                many of the like-for-like population stand behind IT, instead of the column header's
                population size being read as every row's denominator. */}
            <div className="mt-1 text-[8.5px] font-semibold leading-tight text-navy-3">
              {benchmarkContributors} of {benchmarkPopulation.count}{" "}
              {benchmarkPopulation.noun}
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
  benchmarkPopulation,
  footnote,
}: {
  model: ComparisonModel;
  columns: ComparisonColumnHeader[];
  /** "District average" / "Region average" — the pinned benchmark column's name. */
  benchmarkLabel: string;
  /**
   * The like-for-like POPULATION the benchmark column is drawn from — a neutral label for the header,
   * and the denominator of each cell's own "k of N" contributor line. It replaces the old
   * `benchmarkMeta` string, which was a single population-wide count that the header asserted as if it
   * were every row's contributor count (see `benchmarkContributorsOf`).
   */
  benchmarkPopulation: BenchmarkPopulation;
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
                {/* The POPULATION, named neutrally — "the group this column is drawn from", not a
                    claim that every figure below it averages all of them. The per-row contributor
                    count lives in each benchmark cell. */}
                <span className="mt-0.5 block text-[9px] font-semibold text-navy-3">
                  like-for-like: {benchmarkPopulation.count} {benchmarkPopulation.noun}
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
                  <MetricRows
                    key={row.metric.key}
                    row={row}
                    benchmarkPopulation={benchmarkPopulation}
                  />
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
