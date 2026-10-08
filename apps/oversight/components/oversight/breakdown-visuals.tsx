import { cn } from "@/lib/utils";
import {
  rankEnds,
  spreadOf,
  teacherEstablishmentOf,
  type BreakdownRow,
  type ChildBreakdown,
} from "@/lib/oversight/breakdown";
import { Panel } from "./primitives";
import { formatCount, formatRatio, formatRatioPercent } from "./kpi-card";
import { pluralNoun, type BreakdownChrome } from "./tier-chrome";
import { vacancyTone } from "./vacancy-tone";

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
 *
 * (`projectVacancyRate` below is the FAIL-LOUD pattern this one predates: it returns null and the panel
 * withholds the bar with a reason, which is what a new projection should copy.)
 */
function projectPtr(value: number): number {
  return Math.min(1, Math.max(0, (value - PTR_AXIS.lo) / (PTR_AXIS.hi - PTR_AXIS.lo)));
}

/**
 * Gap in PERCENTAGE POINTS, derived — the mock's "18-point gap" is its own data, not a constant.
 *
 * `decimals` because the two callers quote the same idiom at different precisions: the equity caption's
 * whole points ("an 18-point WASSCE gap") and the vacancy caption's one decimal ("a 31.9-point spread").
 * It is one function and not two spellings of `(max − min) × 100` (Dex N5) — the figure is
 * axis-independent, so it must not drift between the surfaces that quote it.
 */
function gapPoints(min: number, max: number, decimals = 0): string {
  return ((max - min) * 100).toFixed(decimals);
}

/**
 * THE END-DOT TONE VOCABULARY for a measure with NO good end — a CLOSED union, deliberately (Dex N4).
 *
 * The only two tones such an axis may use are the neutral navy and the adverse terra. The union is what
 * makes `endTones={{ low: "text-green", … }}` (or `bg-green`, or any passing string) a TYPE ERROR rather
 * than a quiet re-introduction of the green dot the vacancy ruling exists to forbid (Kofi V6/V8).
 */
type EndDotTone = "bg-navy" | "bg-terra";

/**
 * HOW THE TWO END DOTS ARE TONED — exactly ONE of the two modes, never both (Dex N2).
 *
 * They are mutually exclusive by type because they are mutually exclusive in meaning: `goodEnd` says
 * "this axis has a good end, put the green dot there", and `endTones` says "this axis has none, here are
 * the two tones". A caller passing both would be asserting both at once, and the implementation would
 * have to pick a winner silently — so the type refuses the call instead.
 */
type SpreadEnds =
  | {
      /**
       * Which END of the axis is good: "high" puts the green dot at the high/right end (the rate bars),
       * "low" at the low/left end (PTR, where fewer pupils per teacher is better). The axis itself still
       * increases left→right — "inverted" is purely which end is green.
       */
      goodEnd: "high" | "low";
      endTones?: never;
    }
  | {
      goodEnd?: never;
      /**
       * THE TWO END DOTS' TONES, for a measure whose axis has NO "good" end.
       *
       * The VACANCY-RATE bar is the one caller, because its axis CROSSES ZERO: the low end is surplus
       * (teachers over establishment), which is an allocation inefficiency and NOT a good outcome, so a
       * green dot there would read "too many teachers here while the north is short" as success (Kofi
       * V6/V8). It takes the neutral navy instead, with terra kept for the shortage end, which IS the
       * adverse state.
       */
      endTones: { low: EndDotTone; high: EndDotTone };
    };

/**
 * One spread row. Takes TRACK POSITIONS (0..1), not raw figures, so a rate bar (0–100% axis) and the
 * PTR bar (projected onto PTR_AXIS) share one component. The end dots are toned either by `goodEnd` or
 * by an explicit `endTones` pair — see `SpreadEnds`.
 */
function SpreadBar({
  label,
  lowPos,
  highPos,
  meanPos,
  goodEnd,
  rangeText,
  meanText,
  endTones,
}: {
  label: string;
  lowPos: number;
  highPos: number;
  meanPos: number | null;
  rangeText: string;
  meanText: string | null;
} & SpreadEnds) {
  // The green (best) dot goes to whichever END this measure counts as good; terra (worst) to the other.
  // The dots are positioned by END (low/high) and TONED by valence, which is what lets a measure with
  // no good end (the vacancy rate) tone them explicitly without a second pair of dots.
  const lowTone = endTones ? endTones.low : goodEnd === "low" ? "bg-green" : "bg-terra";
  const highTone = endTones ? endTones.high : goodEnd === "high" ? "bg-green" : "bg-terra";
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
        {/*
          The two END dots, positioned by END and toned by VALENCE. Under `goodEnd` the mapping is green
          on the good side and terra on the other; under `endTones` the caller states both, which is how
          a measure with no good end avoids a green dot without needing a second pair of dots.

          The HIGH dot carries `z-10` so the overlap is STATED rather than left to source order: when the
          two extremes coincide (every child on the same rate — `spreadOf` permits min === max) the dots
          sit on the same point, and the high/worse end is the one that must be visible. The DOM order is
          unchanged (low first, then high), so nothing else about the bar moves.
        */}
        <span
          aria-hidden
          className={cn(
            "absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface",
            lowTone,
          )}
          style={{ left: pct(lowPos) }}
        />
        <span
          aria-hidden
          className={cn(
            "absolute top-1/2 z-10 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface",
            highTone,
          )}
          style={{ left: pct(highPos) }}
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

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * THE TEACHER-ESTABLISHMENT PANEL (increment J — VACANCY-SURFACING-RULING V8)
 *
 * ═══ WHY THIS IS A PANEL AND NOT A FIFTH KPI CARD ════════════════════════════════════════════════
 * Kofi V7: the KPI strip has four settled cards on `md:grid-cols-2 xl:grid-cols-4`, and a fifth
 * single-number vacancy card would be both a broken grid and the exact trap this panel exists to avoid.
 * A tier's `Σ vacancies` nets the rural-north SHORTAGE against the urban-south SURPLUS (the gradient
 * `establishmentFactor` in lib/etl/staffing.ts bakes in) and can print "roughly balanced" over a country
 * that is nothing of the kind. A LONE NET IS BANNED above single-school grain (V1), so the primary
 * presentation is the TWO-SIDED DECOMPOSITION — shortage and surplus as two separate magnitudes — with
 * the net subordinate to them and explicitly labelled "net" (V2).
 *
 * ═══ THE DENOMINATOR IS NARROWER THAN EVERY OTHER FIGURE ON THE PAGE ═════════════════════════════
 * GES sets an establishment for PUBLIC schools only, so every sum here is over
 * `teaching_posts_established IS NOT NULL` (V4, AC-17) and the panel STATES that count verbatim (V5).
 * The PTR card above sums teachers over ALL schools, public and private; these two populations are
 * different and the caption says so, or a reader folds them into one.
 *
 * ═══ IT IS DERIVED, NOT RE-READ ══════════════════════════════════════════════════════════════════
 * Every figure comes off `breakdown.total` and `breakdown.children` — the one staffing scan — so the
 * panel, the table's total-row cell and the comparison benchmark cannot disagree (V11). It has ONE
 * fail-soft of its own: an all-private/mission tier renders the absence note and leaves the rest of the
 * page standing. An UNREADABLE roll-up is not its business — it mounts inside `BreakdownSection`, whose
 * single amber banner reports that once for the whole section (Dex N1).
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * VACANCY_AXIS — STATED presentation domain for the vacancy-RATE spread (owner/Kofi-movable, exactly as
 * `PTR_AXIS` above; Lucy §3D asked for it by name).
 *
 * The plotted measure is the SIGNED vacancy rate Σvacancies ÷ Σestablished, so ZERO — "at
 * establishment" — sits at mid-track and the axis is symmetric about it: surplus to the left, shortage
 * to the right. ±0.40 CONTAINS the whole seeded single-school range: `establishmentFactor` draws the
 * establishment multiplier from [1 − 0.15, 1 + 0.20] of the roll, so a school's rate
 * (1 − teachers/established) lies within about [−0.18, +0.17], and a per-child Σ÷Σ is tighter still.
 * The headroom is deliberate: this is load-bearing for honesty, because the caption quotes the TRUE
 * (max − min) spread, so any value that clamped to a rail would make the bar UNDER-DRAW the stated
 * figure. `projectVacancyRate` therefore returns NULL rather than clamping, and the panel then omits the
 * bar WITH A VISIBLE NOTE — fail loud, never a silently shortened bar. Widen the axis before plotting
 * any real/future value outside [lo, hi].
 */
export const VACANCY_AXIS = { lo: -0.4, hi: 0.4 } as const;

/** A vacancy rate → its 0..1 track position, or NULL when it falls outside the stated axis. */
function projectVacancyRate(value: number): number | null {
  if (value < VACANCY_AXIS.lo || value > VACANCY_AXIS.hi) return null;
  return (value - VACANCY_AXIS.lo) / (VACANCY_AXIS.hi - VACANCY_AXIS.lo);
}

/**
 * THIS PANEL'S WORDING for the signed net (Kofi V6) — never a bare signed integer.
 *
 * The WORDS are this surface's own: the panel has room for the full phrase ("12 posts unfilled",
 * "12 teachers over establishment"), where the breakdown table's narrow cell writes "+12 unfilled" and
 * the comparison's benchmark writes a rate. Three legitimate phrasings, one per column width.
 *
 * The TONE is NOT decided here — it comes from `vacancyTone()`, the single home for the never-green
 * rule that all three surfaces share (Dex N6). Positive is a SHORTAGE, the adverse state, in terra;
 * negative is a SURPLUS in neutral navy; exactly 0, with a real public denominator, is "at
 * establishment".
 */
function vacancyWords(net: number): { text: string; tone: string } {
  const tone = vacancyTone(net);
  if (net > 0) {
    return { text: `${formatCount(net)} posts unfilled`, tone };
  }
  if (net < 0) {
    return { text: `${formatCount(Math.abs(net))} teachers over establishment`, tone };
  }
  return { text: "at establishment", tone };
}

/** One of the two GROSS magnitudes — a number and a word, never a number alone. */
function Magnitude({
  label,
  value,
  word,
  tone,
  bg,
}: {
  label: string;
  value: number;
  word: string;
  tone: string;
  bg: string;
}) {
  return (
    <div className={cn("flex-1 rounded-[11px] border border-border-1 px-4 py-[14px]", bg)}>
      <div className="mb-[6px] text-[9px] font-bold uppercase tracking-[0.11em] text-navy-3">
        {label}
      </div>
      <div className={cn("font-mono text-[22px] font-bold leading-none", tone)}>
        {formatCount(value)}
      </div>
      <div className={cn("mt-1 text-[11px] font-semibold", tone)}>{word}</div>
    </div>
  );
}

export function TeacherEstablishmentPanel({
  breakdown,
  chrome,
  /** The officer's OWN tier noun, for the absence sentence ("No GES establishment in this region"). */
  tierNoun,
}: {
  /**
   * The RESOLVED roll-up, not a `Reading` (Dex N1). The unread case is owned by `BreakdownSection`'s one
   * amber banner, which is the section this panel mounts inside: a second "could not be read" note here
   * stacked two reports of the same absence on the page.
   */
  breakdown: ChildBreakdown;
  chrome: BreakdownChrome;
  tierNoun: string;
}) {
  const title = (
    <>
      Teacher <em className="accent-italic">establishment</em>
    </>
  );
  const absence = (note: string) => (
    <Panel title={title} meta="GES-authorised posts">
      <p className="text-xs italic text-navy-3">{note}</p>
    </Panel>
  );

  const establishment = teacherEstablishmentOf(breakdown);
  // THE ONE FAIL-SOFT — and it is a RULING, not a failure (Kofi V12): a tier with no
  // public-establishment school is genuinely UNAVAILABLE. It is NOT "0 posts unfilled / fully staffed",
  // which is what a `coalesce(sum(…), 0)` anywhere upstream would have printed here.
  if (establishment === null) {
    return absence(
      `No GES establishment in this ${tierNoun} — private and mission schools carry none, so there is no authorised-post figure to state.`,
    );
  }

  const { shortage, surplus, net, schoolsWithEstablishment, postsEstablished } = establishment;
  const netWords = vacancyWords(net);

  /**
   * THE DISPERSION VIEW (V3) — the equity signal, because it is the one thing a net cannot cancel.
   *
   * `spreadOf` gives min/max across the children and the WEIGHTED mean, which is the tier total's OWN
   * vacancy rate (never the unweighted mean of child rates). It renders only with ≥2 children carrying a
   * rate — its own empty guard — so there are no zero-width bars.
   */
  const spread = spreadOf(breakdown, (row) => row.vacancyRate);
  const lowPos = spread === null ? null : projectVacancyRate(spread.min);
  const highPos = spread === null ? null : projectVacancyRate(spread.max);
  // FAIL LOUD, never a silently clamped bar: if either extreme lies outside the STATED axis the bar is
  // withheld and the reason is printed, because the caption below quotes the true (max − min) spread.
  const spreadClamped = spread !== null && (lowPos === null || highPos === null);
  // The shared idiom, not a second spelling of it (Dex N5) — and AXIS-INDEPENDENT, which is why the
  // clamp note below can still quote it after withholding the bar.
  const spreadPoints = spread === null ? null : gapPoints(spread.min, spread.max, 1);

  return (
    <Panel title={title} meta="GES-authorised posts">
      {/*
        THE TWO GROSS MAGNITUDES, SIDE BY SIDE AND NEVER NETTED (V1). Shortage in terra — the adverse
        state. Surplus in NEUTRAL NAVY, not green (V6): a surplus is a maldistribution, not a success.
      */}
      <div className="flex flex-col gap-[10px] sm:flex-row">
        <Magnitude
          label="Shortage · posts unfilled"
          value={shortage}
          word="posts unfilled against establishment"
          tone="text-terra"
          bg="bg-terra-bg"
        />
        <Magnitude
          label="Surplus · over establishment"
          value={surplus}
          word="teachers over establishment"
          tone="text-navy"
          bg="bg-bg"
        />
      </div>

      {/*
        THE PUBLIC-ONLY DENOMINATOR, STATED VERBATIM (V5). It is NARROWER than the PTR card's school
        count, which sums teachers over public AND private schools — so the exclusion is named here
        rather than left for the reader to assume the two populations are one.
      */}
      <p className="mt-3 text-[10.5px] text-navy-3">
        Across{" "}
        <b className="text-navy-2">
          {formatCount(schoolsWithEstablishment)} public{" "}
          {pluralNoun(schoolsWithEstablishment, "school")}
        </b>{" "}
        with a GES establishment — private and mission schools are excluded; GES sets no
        establishment for them. {formatCount(postsEstablished)} authorised{" "}
        {pluralNoun(postsEstablished, "post")} in total.
      </p>

      {/*
        THE NET, SUBORDINATE AND LABELLED (V2) — smaller than the two magnitudes above it, which is the
        whole point: it may be read only beside them. A true net-zero with real magnitudes on both sides
        is a REAL balance and says so (V13); it is not the unavailable state, which never reaches here.
      */}
      <p className="mt-2 text-[11.5px] text-navy-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.11em] text-navy-3">
          Net
        </span>{" "}
        <b className={cn("font-mono font-bold", netWords.tone)}>{netWords.text}</b>
        {net === 0 && shortage > 0 && surplus > 0 ? (
          <>
            {" "}
            — balanced: {formatCount(shortage)} posts unfilled offset by{" "}
            {formatCount(surplus)} over establishment, in different places
          </>
        ) : null}
      </p>

      {/*
        THE VACANCY-RATE SPREAD (V3). The axis crosses zero, so the bar's ends are labelled "surplus ↔
        shortage" rather than good/bad, and the dots are toned navy (surplus end) and terra (shortage
        end) instead of green/terra — see `SpreadBar`'s `endTones`.
      */}
      {spread === null || spreadClamped ? null : (
        <div className="mt-4 border-t border-border-1 pt-1">
          <SpreadBar
            label="Vacancy rate"
            lowPos={lowPos!}
            highPos={highPos!}
            meanPos={spread.mean === null ? null : projectVacancyRate(spread.mean)}
            /* No `goodEnd`: this axis HAS no good end (surplus is not success), so the two tones are
               stated outright. The two props are mutually exclusive by type (Dex N2/N3). */
            endTones={{ low: "bg-navy", high: "bg-terra" }}
            rangeText={`${formatRatioPercent(spread.min, 1)}% – ${formatRatioPercent(spread.max, 1)}%`}
            meanText={
              spread.mean === null ? null : `mean ${formatRatioPercent(spread.mean, 1)}%`
            }
          />
        </div>
      )}
      {spreadClamped ? (
        <p className="mt-4 border-t border-border-1 pt-3 text-[10.5px] italic text-navy-3">
          The vacancy-rate spread is not drawn: a {chrome.childNounSingular}&apos;s rate
          falls outside the stated axis ({formatRatioPercent(VACANCY_AXIS.lo, 0)}% to{" "}
          {formatRatioPercent(VACANCY_AXIS.hi, 0)}%), and a bar that clamped it would
          under-draw the real spread. Widen VACANCY_AXIS.
          {/*
            THE FIGURE SURVIVES THE BAR. Withholding the drawing is the honest move; withholding the
            SPREAD would be a second, unnecessary loss — the dispersion is (max − min), which is a fact
            about the data and not about the axis, so it is stated here exactly as the caption below
            states it when the bar does render.
          */}
          {spreadPoints === null ? null : ` The true spread is ${spreadPoints} points.`}
        </p>
      ) : null}
      {spread === null || spreadClamped || spreadPoints === null ? null : (
        /*
          The dispersion clause states ONLY the spread magnitude. It names NO geography (V3, mirroring
          the PTR caption's §10.3(b) constraint): the read supports a dispersion number, not a
          geographic cause. "Surplus ↔ shortage" names the ENDS of the axis, which is the bar's own
          scale and not a claim about where either end is.
        */
        <p className="mt-1 text-[10.5px] text-navy-3">
          A <b className="text-navy-2">{spreadPoints}-point spread</b> in vacancy rate
          across the {chrome.childNounPlural} that carry one — left is surplus (teachers
          over establishment), right is shortage (posts unfilled), and the marker is the
          weighted tier-wide rate, not the midpoint of the band.
        </p>
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
