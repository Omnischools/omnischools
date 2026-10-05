import { cn } from "@/lib/utils";
import {
  rankEnds,
  spreadOf,
  type BreakdownRow,
  type ChildBreakdown,
} from "@/lib/oversight/breakdown";
import { Panel } from "./primitives";
import { formatRatio, formatRatioPercent } from "./kpi-card";
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
 * ═══ THREE BARS — AND THE THIRD IS INVERTED ══════════════════════════════════════════════════════
 * The third bar is Pupil-teacher ratio, held back in slice 3 because `fact_staffing` had no ETL
 * producer. It does now (lib/etl/staffing.ts), so the bar is live — and it is INVERTED: for WASSCE and
 * coverage higher is better, so the green dot sits at the high/right end; for PTR LOWER is better
 * (fewer pupils per teacher), so the green dot sits at the low/left end. "Inverted" is purely which end
 * is green — the axis still increases left→right. `SpreadBar` takes track POSITIONS and a `goodEnd`
 * rather than raw rates, so each measure's own scale lives in `SpreadPanel`: the two rate bars project
 * onto the plain 0–100% axis, and PTR projects onto a STATED, owner-movable domain (`PTR_AXIS`) because
 * a pupils-per-teacher count has no natural 0–100 scale. The caption lists one gap per bar that
 * rendered, derived — never a hard-coded "all three".
 */

/** 0..1 → a percent of the track's width. Works for a 0–100% rate axis AND for a projected position. */
function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

// PTR_AXIS — STATED presentation domain (owner/Kofi-movable, cf. SCHOOL_LEVEL_BANDS; Kofi §10.4).
// lo/hi CONTAIN the full §3 seeded single-school range (JHS floor ~12 → primary-north ceiling ~60),
// so no demo value clamps. This is load-bearing for honesty: the equity caption (§10.3) quotes the
// TRUE (max − min) gap, so any value that clamped to a rail would make the bar UNDER-DRAW the stated
// gap. Therefore the axis MUST be widened before plotting any real/future value outside [lo,hi];
// never let projectPtr silently clamp data the caption then over-states. Prefer a dev assertion that
// every plotted min/max lies within [lo,hi] (fail loud) over a silent clamp.
export const PTR_AXIS = { lo: 10, hi: 60 } as const;

/**
 * A PTR value → its 0..1 position on `PTR_AXIS`. The clamp is a LAST RESORT: a value outside [lo,hi]
 * would make the bar under-draw a gap the §10.3 caption still quotes, so the axis is sized to contain
 * the whole §3 seeded range and `tests/oversight-child-breakdown.test.ts` asserts no seeded tier/child
 * value clamps (Kofi §10.4). Widen PTR_AXIS, do not let this clamp silently, before plotting any future
 * value outside the window.
 */
function projectPtr(value: number): number {
  return Math.min(1, Math.max(0, (value - PTR_AXIS.lo) / (PTR_AXIS.hi - PTR_AXIS.lo)));
}

/** Gap in PERCENTAGE POINTS, derived — the mock's "18-point gap" is its own data, not a constant. */
function gapPoints(min: number, max: number): string {
  return ((max - min) * 100).toFixed(0);
}

/**
 * One spread row. Takes TRACK POSITIONS (0..1), not raw figures, so a rate bar (0–100% axis) and the
 * PTR bar (projected onto PTR_AXIS) share one component. `goodEnd` is the ONLY thing the inversion
 * changes: "high" puts the green dot at the high/right end (rates), "low" at the low/left end (PTR).
 */
function SpreadBar({
  label,
  lowPos,
  highPos,
  meanPos,
  goodEnd,
  rangeText,
  meanText,
}: {
  label: string;
  lowPos: number;
  highPos: number;
  meanPos: number | null;
  goodEnd: "high" | "low";
  rangeText: string;
  meanText: string | null;
}) {
  // The green (best) dot goes to whichever END this measure counts as good; terra (worst) to the other.
  const greenPos = goodEnd === "high" ? highPos : lowPos;
  const terraPos = goodEnd === "high" ? lowPos : highPos;
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
          style={{ left: pct(lowPos), right: pct(1 - highPos) }}
        />
        {/* the WEIGHTED mean (the tier total's own rate) — never the unweighted mean of the children */}
        {meanPos === null ? null : (
          <span
            aria-hidden
            className="absolute inset-y-0 w-[2px] bg-navy"
            style={{ left: pct(meanPos) }}
          />
        )}
        <span
          aria-hidden
          className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-terra"
          style={{ left: pct(terraPos) }}
        />
        <span
          aria-hidden
          className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-green"
          style={{ left: pct(greenPos) }}
        />
      </span>
      <span className="w-[120px] shrink-0 text-right text-[10px] text-navy-3">
        <b className="text-navy-2">{rangeText}</b>
        <br />
        {meanText === null ? "mean unavailable" : meanText}
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
  const ptr = spreadOf(breakdown, (row) => row.ptr);

  /**
   * One clause per bar that rendered, derived — the mock's "18-point" figures are its own data. The list
   * is built from whichever spreads exist so "all three" is never a literal: WASSCE and coverage gaps are
   * PERCENTAGE points (×100), PTR's is RATIO points (max − min directly — not a rate, so ×100 would
   * invent an "810-point" gap). Kofi §10.3: PTR JOINS the shared equity framing as a DISPERSION clause —
   * honest whatever the level mix, because it states the spread, not a conformance verdict — and is
   * phrased "spread in pupil-teacher ratio", not "gap". It names no geography (§10.3(b)): the read
   * supports a dispersion number, not a geographic cause. The inversion (worst = highest) is carried by
   * the bar's dots, not re-stated here.
   */
  // "an" before a figure whose spoken form opens on a vowel (8-, 11-, 18-, 80-…), else "a".
  const article = (points: string) => (/^(8|11|18)/.test(points) ? "an" : "a");
  const gapClause = (points: string, measure: string) =>
    `${article(points)} ${points}-point ${measure} gap`;
  const ptrGap = ptr === null ? null : (ptr.max - ptr.min).toFixed(1);
  const gapClauses = [
    wassce === null ? null : gapClause(gapPoints(wassce.min, wassce.max), "WASSCE"),
    coverage === null ? null : gapClause(gapPoints(coverage.min, coverage.max), "coverage"),
    ptrGap === null ? null : `${article(ptrGap)} ${ptrGap}-point spread in pupil-teacher ratio`,
  ].filter((clause): clause is string => clause !== null);

  // "X is the disparity" / "X and Y are…" / "X, Y and Z are…" — grammatical for 1, 2 or 3 clauses, and
  // the first letter is capitalised because this is a new sentence after the "best and worst" clause's
  // full stop (the derived form must not lose the leading capital the inline fragments had).
  const gapList =
    gapClauses.length === 0
      ? null
      : gapClauses.length === 1
        ? gapClauses[0]
        : `${gapClauses.slice(0, -1).join(", ")} and ${gapClauses[gapClauses.length - 1]}`;
  const gapSentence =
    gapList === null
      ? null
      : `${gapList.charAt(0).toUpperCase()}${gapList.slice(1)} ${
          gapClauses.length === 1 ? "is the disparity" : "are the disparities"
        } national policy exists to close.`;

  return (
    <Panel
      title={
        <>
          The national <em className="accent-italic">spread</em>
        </>
      }
      meta={`Best to worst ${chrome.childNounSingular}`}
    >
      {wassce === null && coverage === null && ptr === null ? (
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
              lowPos={wassce.min}
              highPos={wassce.max}
              meanPos={wassce.mean}
              goodEnd="high"
              rangeText={`${formatRatioPercent(wassce.min, 0)}% – ${formatRatioPercent(wassce.max, 0)}%`}
              meanText={wassce.mean === null ? null : `mean ${formatRatioPercent(wassce.mean, 0)}%`}
            />
          )}
          {coverage === null ? null : (
            <SpreadBar
              label="School coverage"
              lowPos={coverage.min}
              highPos={coverage.max}
              meanPos={coverage.mean}
              goodEnd="high"
              rangeText={`${formatRatioPercent(coverage.min, 1)}% – ${formatRatioPercent(coverage.max, 1)}%`}
              meanText={coverage.mean === null ? null : `mean ${formatRatioPercent(coverage.mean, 1)}%`}
            />
          )}
          {/*
            PTR, INVERTED (Lucy §3; lower ratio = better-staffed, Kofi §10.2 norms): green dot at the LOW
            end, so `goodEnd="low"`. Positions project onto the STATED `PTR_AXIS` (§10.4), not the 0–100%
            rate axis — a pupils-per-teacher count has no natural percentage scale. The range/mean text is
            ratio points (formatRatio, no `%`), one decimal per Kofi's precision ruling (§10.5).
          */}
          {ptr === null ? null : (
            <SpreadBar
              label="Pupil-teacher ratio"
              lowPos={projectPtr(ptr.min)}
              highPos={projectPtr(ptr.max)}
              meanPos={ptr.mean === null ? null : projectPtr(ptr.mean)}
              goodEnd="low"
              rangeText={`${formatRatio(ptr.min, 1)} – ${formatRatio(ptr.max, 1)}`}
              meanText={ptr.mean === null ? null : `mean ${formatRatio(ptr.mean, 1)}`}
            />
          )}
          {/*
            The caption, Lucy's verbatim equity sentence with the gap figures COMPUTED rather than the
            mock's 18/33, and now listing whichever of the three bars rendered (never a hard-coded "all
            three"). The mock's closing geography claim about which regions sit where is still dropped — it
            is a statement about Ghana nothing in this read supports; the page's rule is that every figure
            and every claim on it is derived.
          */}
          <p className="mt-3 text-[10.5px] text-navy-3">
            The spread is the national tier&apos;s most important read — not the mean, but
            the{" "}
            <b className="text-navy-2">
              distance between the best and worst {chrome.childNounSingular}
            </b>
            .{gapSentence === null ? null : ` ${gapSentence}`} Equity, not the average, is
            the national question.
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
