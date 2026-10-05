import { getOfficerSession } from "@/lib/auth";
import { scopeFor } from "@/lib/db/rls";
import { formatAsOf, getLatestSuccessfulEtlRun } from "@/lib/oversight/etl-status";
import {
  getCurrentPeriod,
  getLatestExamCohortPeriod,
  sittingYearOf,
} from "@/lib/oversight/period";
import { getEnrolmentTotal, type EnrolmentTotal } from "@/lib/oversight/enrolment";
import { getSchoolCoverage } from "@/lib/oversight/coverage";
import {
  getExamQualification,
  type ExamQualification,
} from "@/lib/oversight/performance";
import { childLevelFor, getChildBreakdown } from "@/lib/oversight/breakdown";
import { isOk, unavailable, type Reading } from "@/lib/oversight/reading";
import { BreakdownSection } from "@/components/oversight/breakdown-section";
import { PageBody, PageHead } from "@/components/oversight/shell";
import { Banner, Provenance } from "@/components/oversight/primitives";
import { PeriodBanner } from "@/components/oversight/period-banner";
import {
  KpiCard,
  formatCount,
  formatPupilCount,
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
 * ═══ THREE CARDS, NOT FOUR — AND THE SAME THREE AT EVERY TIER ═══════════════════════════════════
 * Lucy's §3.3 specifies a fourth card, Pupil-teacher ratio. It is NOT built: `fact_staffing` has no
 * ETL producer (zero writers in `lib/etl/`), so PTR has no data at any tier. A dash-filled
 * placeholder card would claim the measure exists and is merely missing tonight, which is a
 * different and false statement. When a staffing arm lands, the card is additive.
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
  const [latestRun, termPeriod, coverage, wassceCohort] = await Promise.all([
    getLatestSuccessfulEtlRun(scope),
    // period_type is NAMED. `is_current` alone matches the TERM *and* the ANNUAL row of the same
    // academic year (db/schema/dim.ts), and enrolment hangs off the TERM one.
    getCurrentPeriod(scope, "TERM"),
    getSchoolCoverage(scope),
    getLatestExamCohortPeriod(scope, "WASSCE"),
  ]);

  // Period-dependent reads. Pinning exactly one period_id is what keeps enrolment from summing two
  // terms of the same children and WASSCE from summing two sittings of different ones.
  const [enrolment, wassce, breakdown] = await Promise.all([
    isOk(termPeriod)
      ? getEnrolmentTotal(scope, termPeriod.value.periodId)
      : unavailable<EnrolmentTotal>(),
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
      termPeriodId: isOk(termPeriod) ? termPeriod.value.periodId : null,
      examPeriodId: isOk(wassceCohort) ? wassceCohort.value.periodId : null,
      exam: "WASSCE",
    }),
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
                  ? `${termPeriod.value.academicYear} academic year${
                      termPeriod.value.term === null
                        ? ""
                        : `, Term ${termPeriod.value.term}`
                    }`
                  : "current academic period"}
              </b>
              . Enrolment, attendance and fee figures synced from schools&apos;
              operational records <b className="text-navy">{formatAsOf(latestRun)} GMT</b>
              .
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

        {/* §9: the mock's 1280 cut becomes `xl:`, falling to 2-up and then 1-up. Three cards, not four. */}
        <section
          aria-label="Headline indicators"
          className="grid grid-cols-1 gap-[14px] md:grid-cols-2 xl:grid-cols-3"
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
          termLabel={
            isOk(termPeriod)
              ? `${termPeriod.value.academicYear}${
                  termPeriod.value.term === null ? "" : ` Term ${termPeriod.value.term}`
                }`
              : null
          }
          /* Wells trap 4: the table must STATE the sitting it ranks on, because the resolver is
             tier-sensitive and two officers can honestly be looking at two different sittings. */
          sittingLabel={sittingYear === null ? null : `${sittingYear} WASSCE`}
        />

        {/*
          Lucy §3.4. Four items against the primitive's `sm:grid-cols-3`, so the fourth wraps — which
          §3.4 rules acceptable. The Coverage line is COMPUTED, including the "not yet on Omnischools"
          gap: it is the surface's core discipline, not decoration, so it must be the real number.
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
