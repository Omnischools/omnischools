import { getOfficerSession } from "@/lib/auth";
import { scopeFor } from "@/lib/db/rls";
import { formatAsOf, getLatestSuccessfulEtlRun } from "@/lib/oversight/etl-status";
import {
  getCurrentPeriod,
  getLatestExamCohortPeriod,
  sittingYearOf,
} from "@/lib/oversight/period";
import { getEnrolmentTotal, type EnrolmentTotal } from "@/lib/oversight/enrolment";
import {
  getPupilTeacherRatio,
  ptrNormVerdict,
  GES_PTR_NORM_MIN,
  GES_PTR_NORM_MAX,
  type PupilTeacherRatio,
} from "@/lib/oversight/ptr";
import { getSchoolCoverage } from "@/lib/oversight/coverage";
import {
  getExamQualification,
  type ExamQualification,
} from "@/lib/oversight/performance";
import { childLevelFor, getChildBreakdown } from "@/lib/oversight/breakdown";
import { getSchoolFees, type SchoolFeesPanel } from "@/lib/oversight/fees";
import { getTeacherCpd, type TeacherCpdPanel } from "@/lib/oversight/cpd";
import { isOk, unavailable, type Reading } from "@/lib/oversight/reading";
import { BreakdownSection } from "@/components/oversight/breakdown-section";
import { CpdSection } from "@/components/oversight/cpd-section";
// The panel's own points formatter, so the ledger's stated threshold and the panel's "(20 pts)" can
// never disagree after a policy change (one formatter, two surfaces).
import { formatPoints } from "@/components/oversight/cpd-visuals";
import { FeesSection } from "@/components/oversight/fees-section";
import { PageBody, PageHead } from "@/components/oversight/shell";
import { Banner, Chip, Provenance } from "@/components/oversight/primitives";
import { PeriodBanner } from "@/components/oversight/period-banner";
import {
  KpiCard,
  formatCount,
  formatPupilCount,
  formatRatio,
  formatRatioPercent,
} from "@/components/oversight/kpi-card";
import {
  buildLedeFragments,
  buildTitle,
  childCountOf,
  pluralNoun,
  rollupClause,
  sourceLine,
  tierChrome,
} from "@/components/oversight/tier-chrome";

/**
 * THE OVERSIGHT DASHBOARD — ONE TIER-POLYMORPHIC SURFACE (increment I, slices 1 and 2).
 *
 * Slice 1 built Lucy's Section 01 (period banner → three-card KPI strip → provenance) as the
 * `(oversight)` landing rather than `/national`. Slice 2 made its CHROME tier-aware, which is the last
 * reason anyone had to want three routes: the figures were already each officer's own, and now so are
 * the crumb, the headline, the lede's nouns, the banner's rollup sentence and the stated ceiling. See
 * the TIER-AWARE CHROME block below for the per-tier contract.
 *
 * STILL ONE ROUTE, DELIBERATELY. Lucy's tier map §0: the three mocks share an identical KPI strip,
 * banner and provenance row — "the unit is the same" — so three routes would be three copies of one
 * page differing by five strings, and the fourth tier would be a fourth copy. The shell's single
 * "Dashboard" link lands here at every tier; `NAV` is untouched.
 *
 * ═══ EVERY FIGURE ON THIS PAGE IS COMPUTED AT REQUEST TIME ═══════════════════════════════════════
 * Lucy's map carries the mock's numbers (6,940 / 9,180 · 2.41M · 64% · 75.6% · 16 regions) as LAYOUT
 * PLACEHOLDERS. None of them appears in this file. Every stat fragment in the lede, every KPI value
 * and sub-line, the banner's period and vintage, and the provenance Coverage line are derived from
 * `lib/oversight/{period,enrolment,coverage,performance}.ts` and `getLatestSuccessfulEtlRun()`. A
 * hard-coded figure here would be a defect, not a shortcut.
 *
 * ═══ FOUR CARDS, AND THE SAME FOUR AT EVERY TIER ═══════════════════════════════════════════════
 * Lucy's §3.3 fourth card, Pupil-teacher ratio, is now built: `fact_staffing` has an ETL producer
 * (`lib/etl/staffing.ts`), so PTR has data at every tier. It is the ANNUAL-pinned Σenrolment ÷
 * Σteachers (lib/oversight/ptr.ts), displayed to one decimal with a `: 1` unit. GES norms are
 * LEVEL-DEPENDENT (primary/FCUBE ~1:35, JHS/SHS ~1:25), and the card carries only a single BLENDED
 * figure, so a flat "above target 25:1" verdict would be a category error. The chip is a THREE-WAY
 * HONEST GATE on the displayed blend (Kofi §10.1): at or below the tightest norm (25) → green "within
 * GES level norms"; above the loosest norm (35) → terra "above GES level norms"; in between → NO chip,
 * because a blend genuinely cannot certify conformance to level-dependent norms (the sub-line's norm
 * RANGE is what lets the reader judge there). No pass/fail glyph, no YoY delta.
 *
 * Slice 2 adds NO tier-specific card (Lucy's tier map §2). The older district mock shows a different
 * strip — attendance and teachers-on-post in place of coverage and WASSCE — but that predates the
 * harmonisation the two newer mocks settle on, and of the two it swaps in, teachers-on-post is
 * staffing (no ETL) and attendance has an ETL but no `lib/oversight` read. So all three tiers render
 * the identical three cards, each already correct under its own RLS ceiling.
 *
 * ═══ NO DELTA PILLS ════════════════════════════════════════════════════════════════════════════
 * The demo carries one academic year, so there is no prior-year comparator to compute a change from.
 * `KpiCard` keeps the slot; nothing here fills it (see the component's note, and Lucy §3.5's "never
 * a fake ▲ 0%").
 *
 * ═══ FAIL-SOFT, PER CARD ═══════════════════════════════════════════════════════════════════════
 * Each read returns a two-state `Reading` (lib/oversight/reading.ts) and the fallback lives in the
 * lib, as `etl-status.ts` established. A failed or unstateable read renders that ONE card
 * "Unavailable"; no successful ETL run renders "No successful run yet" across the strip; the page
 * itself never throws and never prints a 0 or a bare dash in place of a figure.
 *
 * NO NAMED RECORDS AND NO READ-BACK. This surface is aggregate-only: nothing here imports
 * `lib/db/readback` or the gated path, directly or transitively (tests/readback-isolation.test.ts
 * enforces it for every App-Router entry point, this one included).
 */
export const dynamic = "force-dynamic";
// TIER-NEUTRAL, because one route serves three tiers and we CHOSE not to tier the browser tab. A
// `generateMetadata()` could read the session — App Router allows it — but `getAuthContext` is not
// `cache()`-wrapped, so it would cost a SECOND un-memoised `getOfficerSession()` per request (a
// directory lookup plus a jurisdiction-node read) to word a tab title. The in-page crumb and h1
// carry the tier; see `tierChrome()`.
export const metadata = { title: "Oversight dashboard" };

// ONE RULE FOR EVERY KPI VALUE, so no card can invent a number: `shown()` + `kpi()` below, built
// inside the component because the rule closes over `hasRun`.

export default async function OversightHome() {
  const officer = await getOfficerSession();

  if (!officer) {
    // The group layout normally refuses first; this is the per-page backstop (see its note).
    //
    // TIER-NEUTRAL CHROME HERE, and it has to be: with no resolved session there is no tier, so the
    // slice-1 "Ghana · national dashboard" headline was claiming the widest one on the very screen
    // that is refusing to show anything. There is no `tierChrome()` call to make without a level.
    return (
      <>
        <PageHead
          crumb="Oversight · Dashboard"
          title={
            <>
              Oversight · <em className="accent-italic">dashboard.</em>
            </>
          }
          lede="Every figure on this dashboard is scoped to your officer identity."
        />
        <PageBody>
          <Banner tone="gold" glyph="⊘" title="Sign in required.">
            Every figure here is read under your jurisdiction ceiling, so there is nothing
            to show without a resolved officer session.
          </Banner>
        </PageBody>
      </>
    );
  }

  const scope = scopeFor(officer);
  // Everything tier-dependent on this page comes from here. `jurisdictionName` is chrome off the
  // session (lib/auth), already an RLS-scoped read of the officer's own node — never request input.
  const chrome = tierChrome(officer.level, officer.jurisdictionName);

  // Independent reads, in parallel: each is separately fail-soft, so one failure degrades one card.
  const [latestRun, termPeriod, annualPeriod, coverage, wassceCohort] = await Promise.all(
    [
      getLatestSuccessfulEtlRun(scope),
      // period_type is NAMED. `is_current` alone matches the TERM *and* the ANNUAL row of the same
      // academic year (db/schema/dim.ts). The TERM row is now resolved for attendance only (and for the
      // banner's human-readable term label).
      getCurrentPeriod(scope, "TERM"),
      // The ANNUAL row is the grain of fact_enrolment, fact_staffing and fact_infrastructure — all three
      // are stocks and hang off this one row. See lib/oversight/enrolment.ts and lib/oversight/ptr.ts.
      getCurrentPeriod(scope, "ANNUAL"),
      getSchoolCoverage(scope),
      getLatestExamCohortPeriod(scope, "WASSCE"),
    ],
  );

  // Period-dependent reads. Enrolment and PTR pin the ANNUAL row (stocks), attendance the TERM row (a
  // flow), WASSCE its own sitting — one period_id each, which is what keeps enrolment from summing two
  // terms of the same children and WASSCE from summing two sittings of different ones.
  const [enrolment, ptr, wassce, breakdown, fees, cpd] = await Promise.all([
    isOk(annualPeriod)
      ? getEnrolmentTotal(scope, annualPeriod.value.periodId)
      : unavailable<EnrolmentTotal>(),
    isOk(annualPeriod)
      ? getPupilTeacherRatio(scope, annualPeriod.value.periodId)
      : unavailable<PupilTeacherRatio>(),
    isOk(wassceCohort)
      ? getExamQualification(scope, "WASSCE", wassceCohort.value.periodId)
      : unavailable<ExamQualification>(),
    /**
     * SLICE 3 — the per-child roll-up behind the breakdown section below the strip.
     *
     * ⚠ THE PERIODS ARE RESOLVED ONCE, HERE, AND PASSED IN — never per child. Both resolvers are
     * tier-sensitive by design (a region whose schools have no rows for the newest national sitting
     * resolves to its OWN latest sitting), so a per-child resolution would rank children against
     * DIFFERENT sittings: a ranking with no referent. These are the very same two period ids the three
     * KPI cards above are computed on, which is also what makes the table's total row able to equal them.
     */
    getChildBreakdown(scope, {
      // A DISPLAY DEPTH, not a ceiling: RLS has already bounded the visible rows before it is applied.
      childLevel: childLevelFor(officer.level),
      // The TERM period for the attendance column (a flow), resolved once here (never per child).
      termPeriodId: isOk(termPeriod) ? termPeriod.value.periodId : null,
      examPeriodId: isOk(wassceCohort) ? wassceCohort.value.periodId : null,
      // The ANNUAL period for the enrolment and PTR columns (stocks on one dim_period row), resolved
      // once here like the other two (never per child).
      annualPeriodId: isOk(annualPeriod) ? annualPeriod.value.periodId : null,
      exam: "WASSCE",
    }),
    /**
     * INCREMENT K — the school-fees panel. fact_fees is TERM-grain (a per-term billing distribution),
     * so this is pinned to the TERM period, NOT the ANNUAL one the enrolment/PTR cards use. The reader
     * is DISTRICT-tier-only and returns `unavailable` above it (fees are non-additive — no district
     * average exists); `FeesSection` renders the honest drill-down note there. Separately fail-soft.
     */
    isOk(termPeriod)
      ? getSchoolFees(scope, termPeriod.value.periodId)
      : unavailable<SchoolFeesPanel>(),
    /**
     * INCREMENT L — the Teacher CPD & PLC panel. `fact_plc_participation` carries TWO period cuts on
     * TWO DIFFERENT period_ids, so the reader takes BOTH: the TERM row (the same one the fees panel and
     * the attendance column pin) for PLC participation, and the ANNUAL row (the same one enrolment and
     * PTR pin) for CPD points and national compliance. Handing it one id twice would read a cut whose
     * columns are all NULL. Tier-polymorphic (no gate — CPD rolls up honestly at every tier) and
     * separately fail-soft, like fees.
     */
    isOk(annualPeriod)
      ? getTeacherCpd(
          scope,
          isOk(termPeriod) ? termPeriod.value.periodId : null,
          annualPeriod.value.periodId,
        )
      : unavailable<TeacherCpdPanel>(),
  ]);

  const hasRun = latestRun !== null;

  /**
   * THE DISPLAY RULE, DEFINED ONCE (Dex M3) — "may this figure be stated at all?".
   *
   * It was `hasRun && isOk(x)` written out at seven call sites (the value, and each card's `unit` and
   * `sub`), which is the same rule hand-copied seven times; the eighth copy is the one that gets it
   * wrong and shows a unit beside the words "Unavailable". As a type predicate it also narrows, so
   * the sub-lines below can reach `.value` without a second check.
   */
  const shown = <T,>(reading: Reading<T>): reading is { status: "ok"; value: T } =>
    hasRun && isOk(reading);

  /**
   * …and the value string derives FROM that same predicate, so the two can never disagree. The no-run
   * case outranks the per-card one deliberately: with no successful ETL run there is no vintage for
   * ANY figure, so "No successful run yet" is the true statement for all three — the honesty rule the
   * scaffold's as-of card already followed.
   */
  const kpi = <T,>(reading: Reading<T>, format: (value: T) => string): string =>
    shown(reading)
      ? format(reading.value)
      : hasRun
        ? "Unavailable"
        : "No successful run yet";

  const enrolmentValue = kpi(enrolment, (e) => formatPupilCount(e.total));
  const coverageValue = kpi(coverage, (c) => formatRatioPercent(c.ratio, 1));
  const wassceValue = kpi(wassce, (w) => formatRatioPercent(w.rate, 0));
  // One decimal (Kofi §10.5): the Σ÷Σ tier figure's DISPLAY precision, not the stored numeric(5,2).
  const ptrValue = kpi(ptr, (p) => formatRatio(p.ratio, 1));
  // Kofi §10.1: a THREE-WAY HONEST GATE against the level-norm band (lib/oversight/ptr.ts owns the
  // thresholds AND the rounding). It takes the RAW ratio and rounds to the ONE-DECIMAL DISPLAYED value
  // itself, so the chip can never disagree with the number on the card: "within" only at/below the
  // tightest norm (25, within every level ceiling); "above" only beyond the loosest (35, above every
  // ceiling); between the two the blend cannot say, so NO chip.
  const ptrVerdict = shown(ptr) ? ptrNormVerdict(ptr.value.ratio) : null;
  const sittingYear = isOk(wassceCohort)
    ? sittingYearOf(wassceCohort.value.academicYear)
    : null;

  // The lede's stat fragments follow the SAME rule as the cards — `shown()`, so with no successful
  // ETL run the lede states that rather than quoting numbers the strip is refusing to show. The SHAPE
  // of the sentence is the tier's (see `buildLedeFragments`); what may be stated is this rule's.
  const coverageShown = shown(coverage) ? coverage.value : null;
  const ledeFragments = buildLedeFragments(
    chrome,
    coverageShown,
    shown(enrolment) ? enrolment.value : null,
  );
  /**
   * One child count, used by the banner clause and the provenance Source line alike, so the two
   * cannot disagree about how many districts/regions this officer is looking at.
   *
   * Derived from `isOk(coverage)` and NOT from `shown(coverage)` — the same vintage-independence the
   * provenance Coverage line documents (Dex M5): the register is reference data with its own
   * `as_of_date`, not an ETL product, so a count of districts in it is true whether or not a nightly
   * run has ever succeeded. The banner clause is inside the `hasRun` branch already, so this costs it
   * nothing; the Source line keeps its count on the night the pipeline has never run, exactly as it
   * did before this slice.
   */
  const childCount = childCountOf(chrome, isOk(coverage) ? coverage.value : null);
  const bannerRollup = rollupClause(chrome, childCount);

  return (
    <>
      <PageHead
        crumb={chrome.crumb}
        title={buildTitle(chrome)}
        lede={
          <>
            {ledeFragments.length > 0 ? (
              <>
                {ledeFragments.map((fragment, i) => (
                  <span key={i}>
                    {i > 0 ? " · " : null}
                    {fragment}
                  </span>
                ))}
                {". "}
              </>
            ) : null}
            {hasRun
              ? "Figures are as of the most recent nightly sync."
              : "No nightly sync has completed yet, so no figure here has a vintage."}
          </>
        }
        /*
         * NO ACTIONS. Lucy §3.1 specifies `2025/26 ▾`, `Export view` and `Open comparison →`; all
         * three target surfaces that do not exist (a period selector with one period, an export
         * route, the comparison workspace). Her §6 leaves the call here, and an omitted action beats
         * a button that does nothing and beats a link to a 404. They return with their surfaces —
         * which is also why no `Button` primitive is introduced by this slice.
         */
      />
      <PageBody>
        <PeriodBanner
          aside={
            <>
              Next sync
              <br />
              nightly at 02:00 GMT
            </>
          }
        >
          {hasRun ? (
            <>
              Data reflects the{" "}
              <b className="text-navy">
                {isOk(termPeriod)
                  ? `${termPeriod.value.academicYear} academic year`
                  : "current academic period"}
              </b>
              . Enrolment and staffing are year-to-date totals on roll
              {isOk(termPeriod) && termPeriod.value.term !== null ? (
                <>
                  ; attendance and fee figures are{" "}
                  <b className="text-navy">Term {termPeriod.value.term}</b>
                </>
              ) : null}
              . Synced from schools&apos; operational records{" "}
              <b className="text-navy">{formatAsOf(latestRun)} GMT</b>.
              {sittingYear !== null ? (
                <>
                  {" "}
                  Performance figures are the{" "}
                  <b className="text-navy">{sittingYear} WASSCE</b> results from the
                  official <b className="text-navy">WAEC</b> extract.
                </>
              ) : null}
              {/* The child-rollup sentence: "N regions" at national, "N districts" at region, and
                  ABSENT at district — a district has no child jurisdictions, and the district mock
                  has no such sentence (Lucy §1.4). `rollupClause` owns that decision. */}
              {bannerRollup !== null ? <> {bannerRollup}</> : null}
            </>
          ) : (
            // Lucy §3.5's empty state. The banner stays gold and informational: a pipeline that has
            // not run yet is a state of the data, not an error the officer caused.
            <>No nightly sync has completed yet.</>
          )}
        </PeriodBanner>

        {/* §9: the mock's 1280 cut becomes `xl:`, falling to 2-up and then 1-up. Four cards (md 2×2). */}
        <section
          aria-label="Headline indicators"
          className="grid grid-cols-1 gap-[14px] md:grid-cols-2 xl:grid-cols-4"
        >
          <KpiCard
            lead
            label="Total enrolment"
            value={enrolmentValue}
            /* `state` tells the card its value is an ABSENCE statement, not a figure, so it is not
               typeset as one (Dex M6). It is the negation of the one display rule, never a second. */
            state={!shown(enrolment)}
            unit={shown(enrolment) ? "pupils" : undefined}
            sub={
              shown(enrolment) ? (
                <>
                  Across {formatCount(enrolment.value.schoolsCounted)} reporting{" "}
                  {pluralNoun(enrolment.value.schoolsCounted, "school")}
                </>
              ) : null
            }
          />
          <KpiCard
            label="School coverage"
            value={coverageValue}
            state={!shown(coverage)}
            unit={shown(coverage) ? "%" : undefined}
            sub={
              shown(coverage) ? (
                <>
                  <b className="font-bold text-navy-2">
                    {formatCount(coverage.value.reporting)} of{" "}
                    {formatCount(coverage.value.registered)}
                  </b>{" "}
                  in the EMIS register
                </>
              ) : null
            }
          />
          <KpiCard
            label="WASSCE qualification"
            value={wassceValue}
            state={!shown(wassce)}
            unit={shown(wassce) ? "%" : undefined}
            sub={
              shown(wassce) ? (
                <>
                  {/* Already tier-aware since slice 1; it now reads the one chrome config rather
                      than a second tier-word table (Lucy §1.6). */}
                  {chrome.tierAdjective}
                  {sittingYear !== null ? ` · ${sittingYear}` : ""} · credit or above
                </>
              ) : null
            }
          />
          <KpiCard
            label="Pupil-teacher ratio"
            value={ptrValue}
            state={!shown(ptr)}
            /* The ":1" is the unit, the way "%" is coverage's — never part of the value (formatRatio
               returns just the number). Stripped automatically in the absence state by `shown`. */
            unit={shown(ptr) ? ": 1" : undefined}
            /* The norm RANGE, not a flat target (Kofi §10.2) — the min/max come from the one named
               constant the chip gate also reads, so the two can never drift. The number is NOT
               hard-coded here. */
            sub={
              shown(ptr) ? (
                <>
                  {chrome.tierAdjective} average · GES norm {GES_PTR_NORM_MIN}:1&ndash;
                  {GES_PTR_NORM_MAX}:1 (JHS/SHS&ndash;primary)
                </>
              ) : null
            }
            /* NOT a year-over-year delta (the "no delta pills" rule stands for those — one demo year,
               no comparator). This is the THREE-WAY conformance chip (Kofi §10.1): green "within" only
               at/below the tightest norm, terra "above" only beyond the loosest, and NO chip in between
               because a blend cannot certify level-dependent norms. No ▲/▼ glyph. */
            delta={
              ptrVerdict === "within" ? (
                <Chip tone="green">within GES level norms</Chip>
              ) : ptrVerdict === "above" ? (
                <Chip tone="terra">above GES level norms</Chip>
              ) : null
            }
          />
        </section>

        {/*
          SLICE 3 — Lucy's Section 02, as a SECTION rather than a route (see BreakdownSection's note).
          It sits below the KPI strip because its total row IS the strip's figures, computed from the same
          two periods in the same request: the one place that cross-module commitment can be read is with
          both on one screen. Fail-soft on its own: an unreadable roll-up renders a warn banner here and
          leaves everything above it standing.
        */}
        <BreakdownSection
          level={officer.level}
          jurisdictionName={officer.jurisdictionName}
          homeId={officer.jurisdictionId}
          breakdown={breakdown}
          /* The academic year only, never a term: every measure in this table (enrolment, PTR, WASSCE,
             coverage) is an annual stock or a sitting — none is termly — so a "Term N" vintage would
             over-claim. Attendance, the one term-grain measure, lives on the comparison workspace, which
             names its own term there. */
          termLabel={isOk(termPeriod) ? termPeriod.value.academicYear : null}
          /* Wells trap 4: the table must STATE the sitting it ranks on, because the resolver is
             tier-sensitive and two officers can honestly be looking at two different sittings. */
          sittingLabel={sittingYear === null ? null : `${sittingYear} WASSCE`}
        />

        {/*
          INCREMENT L — the Teacher CPD & PLC panel (C16), a sibling of the breakdown section below the
          KPI strip and mounted EXACTLY ONCE, here. It is deliberately OUTSIDE `BreakdownSection`: the
          panel is not derived from the roll-up, so a breakdown-reconciliation failure (its amber
          banner) must not take CPD down with it, and an unreadable CPD read must leave everything else
          standing (AC-20). That is the `FeesSection` precedent, and the surface map sanctions it as
          equivalent to the in-BreakdownSection mount.

          NO tier gate: unlike fees, CPD/PLC rolls up honestly at every tier (Σnum ÷ Σden), so the panel
          renders at NATIONAL, REGION and DISTRICT alike. The two vintages are passed separately because
          they genuinely differ — PLC participation is TERM-grain, CPD points ANNUAL.
        */}
        <CpdSection
          reading={cpd}
          tierNoun={chrome.tierNoun}
          termLabel={
            isOk(termPeriod) && termPeriod.value.term !== null
              ? `Term ${termPeriod.value.term}`
              : null
          }
          annualLabel={isOk(annualPeriod) ? annualPeriod.value.academicYear : null}
        />

        {/*
          INCREMENT K — the School fees panel, a sibling of the breakdown section below the KPI strip.
          It follows the breakdown (not before it) because the breakdown's total row must sit adjacent
          to the KPI strip for the reconciliation read; fees carry NO roll-up to reconcile. DISTRICT
          tier shows real per-school figures; REGION/NATIONAL show the honest drill-down note (fees do
          not roll up, so there is no regional/national average). Its own Reading, its own fail-soft.

          The vintage is the TERM, stated distinctly from the annual strip: fact_fees is a per-term
          billing distribution (never summed across terms into a year).
        */}
        <FeesSection
          level={officer.level}
          reading={fees}
          termLabel={
            isOk(termPeriod) && termPeriod.value.term !== null
              ? `Term ${termPeriod.value.term}`
              : null
          }
        />

        {/*
          Lucy §3.4. Five items against the primitive's `sm:grid-cols-3`, so the last two wrap — which
          §3.4 rules acceptable. The Coverage line is COMPUTED, including the "not yet on Omnischools"
          gap: it is the surface's core discipline, not decoration, so it must be the real number. The
          Measure line is the PTR honesty caveat (Kofi §10.5): PTR, not the trained-teacher ratio.
        */}
        <Provenance
          items={[
            [
              // `N region rollups` at national, `N district rollups` at region, and the district
              // tier's own phrasing where there are no child jurisdictions to count (Lucy §1.5). A
              // null count ⇒ the register names none, so the clause is dropped rather than printed as
              // "0 region rollups" (Quinn L2 — the type makes that impossible to forget).
              "Source",
              sourceLine(chrome, childCount),
            ],
            [
              // ⚠ INTENTIONALLY NOT GATED ON `hasRun`, unlike the coverage CARD above (Dex M5). The
              // register is reference data with its own `as_of_date`; it does not come from the
              // nightly ETL, so its counts are true whether or not a run has ever succeeded. Lucy
              // §3.5 requires this line to survive the empty state ("Keep the provenance Coverage
              // line") precisely because the coverage caveat is the surface's core discipline: the
              // one night the pipeline has never run is the night an officer most needs to know how
              // much of the country is missing. Do not "fix" the asymmetry by adding `shown()` here.
              "Coverage",
              isOk(coverage)
                ? `${formatCount(coverage.value.reporting)} of ${formatCount(
                    coverage.value.registered,
                  )} schools · ${formatCount(
                    coverage.value.registered - coverage.value.reporting,
                  )} not yet on Omnischools`
                : "unavailable — the EMIS register could not be read",
            ],
            ["Mode", "aggregate · no named records on this surface"],
            [
              // ⚠ THE PTR HONESTY CAVEAT (domain basis Kofi §2; surface wording ruled §10.5). This is
              // PTR — ALL teachers on roll, trained and untrained — NOT the trained-teacher ratio
              // (PTTR), which GES tracks as its sharpest equity signal and which a single un-split
              // column cannot carry. Stated here, in the surface's honesty ledger, so an official who
              // knows the PTTR distinction is not misled; the banner stays informational and omits it.
              "Measure",
              "All-teacher PTR (trained + untrained); not the trained-teacher ratio (PTTR).",
            ],
            /*
              ⚠ THE ESTABLISHMENT CAVEAT (Kofi V14), rendered whenever the vacancy panel can render — i.e.
              gated on the same `breakdown` reading the panel is derived from, so the ledger never explains
              a figure the page is not showing, and never omits the caveat for a figure it is.

              Three claims, each one the surface would otherwise let a reader get wrong: the establishment
              is AUTHORISED POSTS, not a measured headcount of people; it is demo-derived (or the loaded
              `ref_ges_teacher_establishment` vintage where one is present), not a GES publication; and
              private and mission schools carry NONE, which is why the panel's denominator is narrower than
              the PTR card's. Plus the signed convention, stated once in the officer's own words.
            */
            ...(isOk(breakdown)
              ? ([
                  [
                    "Establishment",
                    "Teaching posts established are the GES-authorised establishment (a demo-derived figure, or the loaded ref_ges_teacher_establishment vintage where present), not a measured headcount; private and mission schools carry no establishment. Vacancies are signed: positive = posts unfilled (shortage), negative = teachers over establishment (surplus).",
                  ],
                ] as [string, string][])
              : []),
            /*
              ⚠ THE FEES CAVEAT (ruling F21), rendered at DISTRICT tier whenever the fees panel can
              render — gated on the same `fees` reading the panel is derived from, so the ledger never
              explains a figure the page is not showing. Five things a reader would otherwise get wrong:
              billed-not-collected, the billed-students (not enrolled) denominator, the TERM grain, the
              source, and — the load-bearing one — that fees do NOT roll up, so no district/regional/
              national fee average exists.
            */
            ...(officer.level === "DISTRICT" && isOk(fees)
              ? ([
                  [
                    "Fees",
                    `Fee figures are amounts billed (charged), not collected, taken from schools' operational billing records${
                      isOk(termPeriod) && termPeriod.value.term !== null
                        ? ` for Term ${termPeriod.value.term}`
                        : ""
                    }. Each figure is a mean and median over the students billed for that category — "what this costs here", not "what an average pupil pays". Figures are per school: fees do not roll up, so there is no district, regional or national fee average.`,
                  ],
                ] as [string, string][])
              : []),
            /*
              ⚠ THE TWO CPD/PLC CAVEATS (Kofi C20 / AC-22), rendered whenever the CPD panel can render —
              gated on the same `cpd` reading the panel is derived from, so the ledger never explains a
              figure the page is not showing and never omits the caveat for one it is.

              The PLC line is unconditional: it states the TERM vintage and the re-derivation rule. The
              CPD/NTC line SWITCHES on the one `ntcProvenance` the reader resolved — the demo disclosure
              while the figures are illustrative, the sourcing-gate statement when there is no feed, and
              the measured-source provenance once the real NTC feed lands (at which point every per-figure
              DEMO chip vanishes with no other dashboard change).
            */
            ...(isOk(cpd)
              ? ([
                  [
                    "PLC participation",
                    `PLC participation is aggregated from schools' own Professional Learning Community registers${
                      isOk(termPeriod) && termPeriod.value.term !== null
                        ? ` for Term ${termPeriod.value.term}`
                        : ""
                    }: sessions held against the cadence each school set, attendance, and teachers taking part. Coverage and rates are re-derived from summed counts — never an average of school rates — so a region's figure is its schools' pooled total.`,
                  ],
                  [
                    "CPD points (NTC)",
                    cpd.value.ntcProvenance === "DEMO"
                      ? `CPD points by NTC category and the count of teachers meeting the national CPD requirement${
                          cpd.value.ntcCpdTarget === null
                            ? ""
                            : ` (${formatPoints(cpd.value.ntcCpdTarget)} points)`
                        } are ILLUSTRATIVE DEMO figures, shown to preview the full CPD dashboard. They are NOT measured: the live NTC CPD feed is not yet connected. Only PLC-earned points are observed today; Specialised, Recommended and the non-PLC half of Mandatory are synthetic. Every such figure is marked DEMO.`
                      : cpd.value.ntcProvenance === "ABSENT"
                        ? "CPD points by NTC category and national compliance are not yet sourced — the live NTC CPD feed is not connected. Those figures are shown as absent, never as a zero."
                        : "CPD points and national compliance are sourced from the NTC CPD extract.",
                  ],
                ] as [string, string][])
              : []),
            [
              // The ceiling, stated per tier (Lucy §1.5). This replaces slice 1's generic "scoped to
              // your jurisdiction subtree" placeholder. It is a SECURITY CLAIM, not copy: it tells the
              // officer what they are NOT seeing, which is the only way a bounded view can be honest
              // about being bounded. Verbatim strings live in `tierChrome()`.
              "Scope",
              chrome.scopeLine,
            ],
          ]}
        />
      </PageBody>
    </>
  );
}
