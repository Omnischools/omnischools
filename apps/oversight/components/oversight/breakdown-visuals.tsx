import { cn } from "@/lib/utils";
import {
  rankEnds,
  spreadOf,
  type BreakdownRow,
  type ChildBreakdown,
} from "@/lib/oversight/breakdown";
import { Panel } from "./primitives";
import { formatRatioPercent } from "./kpi-card";
import type { BreakdownChrome } from "./tier-chrome";

/**
 * THE SPREAD PANEL AND THE RANK STRIP (increment I slice 3, Lucy's breakdown map §4.4 / §4.5).
 *
 * ═══ PURE CSS DIV-BARS — NO CHART LIBRARY ════════════════════════════════════════════════════════
 * No charting dependency is installed in this app and none is added: the whole visual is four
 * absolutely-positioned divs in a track, positioned by percent through an inline `style`. That inline
 * style is the ONE sanctioned use of one on this surface — the position IS the datum, so it cannot be a
 * class — and it keeps a 40kB dependency out of a page that needs two bars.
 *
 * ═══ THE ONE GENUINELY TIER-DIVERGENT PIECE OF LAYOUT ════════════════════════════════════════════
 * The national mock has a spread panel and no rank strip; the regional mock has rank cards and no
 * spread. That asymmetry is the design's, and it is the only `officer.level` gate in this slice (made in
 * the section component): everything else that varies by tier is a string in `breakdownChrome()`.
 *
 * ═══ TWO BARS, NOT THREE ═════════════════════════════════════════════════════════════════════════
 * The mock's third bar is Pupil-teacher ratio, which has no ETL producer — the same reason the PTR KPI
 * card and the PTR column are absent. The caption's "all three" is trimmed with it: the text may not
 * out-claim the chart. When staffing lands, the row is additive and is INVERTED (lower is better), which
 * is why that is written down here rather than rediscovered.
 */

/** 0..1 → a percent of the track's width. The track's axis is a plain 0–100% visual scale. */
function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Gap in PERCENTAGE POINTS, derived — the mock's "18-point gap" is its own data, not a constant. */
function gapPoints(min: number, max: number): string {
  return ((max - min) * 100).toFixed(0);
}

function SpreadBar({
  label,
  min,
  max,
  mean,
  decimals,
}: {
  label: string;
  min: number;
  max: number;
  mean: number | null;
  decimals: number;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border-1 py-3 last:border-b-0">
      <span className="w-[140px] shrink-0 text-[11.5px] font-semibold text-navy">
        {label}
      </span>
      <span className="relative h-[26px] flex-1 rounded-md bg-bg">
        {/* the best-to-worst band */}
        <span
          aria-hidden
          className="absolute bottom-[5px] top-[5px] rounded-[4px] bg-gold-soft"
          style={{ left: pct(min), right: pct(1 - max) }}
        />
        {/* the WEIGHTED mean (the tier total's own rate) — never the unweighted mean of the children */}
        {mean === null ? null : (
          <span
            aria-hidden
            className="absolute inset-y-0 w-[2px] bg-navy"
            style={{ left: pct(mean) }}
          />
        )}
        <span
          aria-hidden
          className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-terra"
          style={{ left: pct(min) }}
        />
        <span
          aria-hidden
          className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-green"
          style={{ left: pct(max) }}
        />
      </span>
      <span className="w-[120px] shrink-0 text-right text-[10px] text-navy-3">
        <b className="text-navy-2">
          {formatRatioPercent(min, decimals)}% – {formatRatioPercent(max, decimals)}%
        </b>
        <br />
        {mean === null ? "mean unavailable" : `mean ${formatRatioPercent(mean, decimals)}%`}
      </span>
    </div>
  );
}

export function SpreadPanel({
  breakdown,
  chrome,
}: {
  breakdown: ChildBreakdown;
  chrome: BreakdownChrome;
}) {
  const wassce = spreadOf(breakdown, (row) => row.wassceRate);
  const coverage = spreadOf(breakdown, (row) => row.coverageRatio);

  return (
    <Panel
      title={
        <>
          The national <em className="accent-italic">spread</em>
        </>
      }
      meta={`Best to worst ${chrome.childNounSingular}`}
    >
      {wassce === null && coverage === null ? (
        // Lucy §6: an empty note, never zero-width bars. A spread needs at least two children to be one.
        <p className="text-xs italic text-navy-3">
          No spread to show yet — a range needs at least two {chrome.childNounPlural} with
          a measured figure.
        </p>
      ) : (
        <>
          {wassce === null ? null : (
            <SpreadBar
              label="WASSCE qualification"
              min={wassce.min}
              max={wassce.max}
              mean={wassce.mean}
              decimals={0}
            />
          )}
          {coverage === null ? null : (
            <SpreadBar
              label="School coverage"
              min={coverage.min}
              max={coverage.max}
              mean={coverage.mean}
              decimals={1}
            />
          )}
          {/*
            The caption, Lucy's verbatim equity sentence with two edits she asked for: "all three" is
            gone with the PTR bar, and the gap figures are COMPUTED rather than the mock's 18/33. The
            mock's closing claim about which regions sit at the low end is dropped — it is a statement
            about Ghana's geography that nothing in this read supports, and the page's rule is that every
            figure and every claim on it is derived.
          */}
          <p className="mt-3 text-[10.5px] text-navy-3">
            The spread is the national tier&apos;s most important read — not the mean, but
            the{" "}
            <b className="text-navy-2">
              distance between the best and worst {chrome.childNounSingular}
            </b>
            .
            {wassce === null
              ? null
              : ` A ${gapPoints(wassce.min, wassce.max)}-point WASSCE gap`}
            {wassce !== null && coverage !== null ? " and" : null}
            {coverage === null
              ? null
              : ` a ${gapPoints(coverage.min, coverage.max)}-point coverage gap`}
            {wassce === null && coverage === null
              ? null
              : ` ${
                  wassce !== null && coverage !== null
                    ? "are the disparities"
                    : "is the disparity"
                } national policy exists to close.`}{" "}
            Equity, not the average, is the national question.
          </p>
        </>
      )}
    </Panel>
  );
}

function RankCard({
  label,
  row,
  tone,
}: {
  label: string;
  row: BreakdownRow;
  tone: "green" | "terra";
}) {
  return (
    <div
      className={cn(
        "flex-1 rounded-[11px] border border-border-1 bg-surface px-4 py-[14px]",
        tone === "green" ? "border-l-[3px] border-l-green" : "border-l-[3px] border-l-terra",
      )}
    >
      <div className="mb-[6px] text-[9px] font-bold uppercase tracking-[0.11em] text-navy-3">
        {label}
      </div>
      <div className="font-display text-[15px] font-semibold text-navy">
        {row.name ?? "Name unavailable"}
      </div>
      {/*
        BOTH figures, deliberately: the rate AND its coverage. "Naming the ends honestly" — a trailing
        child's case stays provisional while its coverage is thin, so dropping coverage from the
        needs-attention card would hide the read-with-coverage caveat the whole surface is built on.
      */}
      <div
        className={cn(
          "mt-[3px] font-mono text-[12px] font-bold",
          tone === "green" ? "text-green" : "text-terra",
        )}
      >
        {row.wassceRate === null
          ? "qualification unavailable"
          : `${formatRatioPercent(row.wassceRate, 0)}% qualification`}
        {row.coverageRatio === null
          ? null
          : ` · ${formatRatioPercent(row.coverageRatio, 0)}% coverage`}
      </div>
    </div>
  );
}

/**
 * The regional rank strip: the max and min child BY THE ACTIVE SORT.
 *
 * Renders NOTHING when fewer than two children clear the candidate floor (Wells §5): a child with 7
 * candidates and 7 credits is 100%, and naming it "Strongest district" would be a superlative the cohort
 * cannot support. The table still lists every child, with its candidate count, so the floor qualifies
 * the claim rather than hiding the data.
 */
export function RankStrip({ breakdown }: { breakdown: ChildBreakdown }) {
  const ends = rankEnds(breakdown);
  if (ends === null) return null;
  return (
    <div className="flex flex-col gap-[10px] sm:flex-row">
      <RankCard
        label="Strongest · WASSCE qualification"
        row={ends.strongest}
        tone="green"
      />
      <RankCard
        label="Needs attention · WASSCE qualification"
        row={ends.weakest}
        tone="terra"
      />
    </div>
  );
}
