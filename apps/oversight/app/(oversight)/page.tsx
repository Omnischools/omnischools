import type { ReactNode } from "react";
import { getOfficerSession } from "@/lib/auth";
import { scopeFor, type JurisdictionLevel } from "@/lib/db/rls";
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
import { isOk, unavailable, type Reading } from "@/lib/oversight/reading";
import { PageBody, PageHead } from "@/components/oversight/shell";
import { Banner, Provenance } from "@/components/oversight/primitives";
import { PeriodBanner } from "@/components/oversight/period-banner";
import {
  KpiCard,
  formatCount,
  formatPupilCount,
  formatRatioPercent,
} from "@/components/oversight/kpi-card";

/**
 * THE NATIONAL OVERVIEW DASHBOARD — increment I slice 1, Lucy's design map Section 01.
 *
 * It replaces the increment-G scaffold body in place, as the `(oversight)` landing, rather than
 * mounting at `/national`: the shell's sole "Dashboard" link points here, so a second route would
 * either orphan this one or need a `NAV` edit that belongs with the per-tier landings in slice 2.
 * The scaffold's un-provisioned-analytics pill and its static `TIERS` table are gone — the analytics
 * DB is provisioned now, and a table of hard-coded tier descriptions was documentation wearing a
 * dashboard's clothes.
 *
 * ═══ EVERY FIGURE ON THIS PAGE IS COMPUTED AT REQUEST TIME ═══════════════════════════════════════
 * Lucy's map carries the mock's numbers (6,940 / 9,180 · 2.41M · 64% · 75.6% · 16 regions) as LAYOUT
 * PLACEHOLDERS. None of them appears in this file. Every stat fragment in the lede, every KPI value
 * and sub-line, the banner's period and vintage, and the provenance Coverage line are derived from
 * `lib/oversight/{period,enrolment,coverage,performance}.ts` and `getLatestSuccessfulEtlRun()`. A
 * hard-coded figure here would be a defect, not a shortcut.
 *
 * ═══ THREE CARDS, NOT FOUR ══════════════════════════════════════════════════════════════════════
 * Lucy's §3.3 specifies a fourth card, Pupil-teacher ratio. It is NOT built: `fact_staffing` has no
 * ETL producer (zero writers in `lib/etl/`), so PTR has no data at any tier. A dash-filled
 * placeholder card would claim the measure exists and is merely missing tonight, which is a
 * different and false statement. When a staffing arm lands, the card is additive.
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
export const metadata = { title: "National dashboard" };

/** The tier word the copy uses for "whose figures are these". */
const TIER_LABEL: Record<JurisdictionLevel, string> = {
  NATIONAL: "National",
  REGION: "Regional",
  DISTRICT: "District",
  SCHOOL: "School",
};

/** Lucy's `.lede b` — the bolded stat fragments. */
function Stat({ children }: { children: ReactNode }) {
  return <b className="text-navy-2">{children}</b>;
}

/**
 * ONE RULE FOR EVERY KPI VALUE, so no card can invent a number.
 *
 * The no-run case wins over the per-card case deliberately: with no successful ETL run there is no
 * vintage for ANY figure, so "No successful run yet" is the true statement for all three — and it is
 * the honesty rule the scaffold's as-of card already followed.
 */
function kpiValue<T>(
  reading: Reading<T>,
  hasRun: boolean,
  format: (value: T) => string,
): string {
  if (!hasRun) return "No successful run yet";
  if (!isOk(reading)) return "Unavailable";
  return format(reading.value);
}

export default async function OversightHome() {
  const officer = await getOfficerSession();

  if (!officer) {
    // The group layout normally refuses first; this is the per-page backstop (see its note).
    return (
      <>
        <PageHead
          crumb="Oversight · National dashboard"
          title={
            <>
              Ghana · <em className="accent-italic">national dashboard.</em>
            </>
          }
          lede="Every figure on this dashboard is scoped to your officer identity."
        />
        <PageBody>
          <Banner tone="gold" glyph="⊘" title="Sign in required.">
            National figures are read under your jurisdiction ceiling, so there is nothing
            to show without a resolved officer session.
          </Banner>
        </PageBody>
      </>
    );
  }

  const scope = scopeFor(officer);
  const tier = TIER_LABEL[officer.level];

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
  const [enrolment, wassce] = await Promise.all([
    isOk(termPeriod)
      ? getEnrolmentTotal(scope, termPeriod.value.periodId)
      : unavailable<EnrolmentTotal>(),
    isOk(wassceCohort)
      ? getExamQualification(scope, "WASSCE", wassceCohort.value.periodId)
      : unavailable<ExamQualification>(),
  ]);

  const hasRun = latestRun !== null;
  const enrolmentValue = kpiValue(enrolment, hasRun, (e) => formatPupilCount(e.total));
  const coverageValue = kpiValue(coverage, hasRun, (c) => formatRatioPercent(c.ratio, 1));
  const wassceValue = kpiValue(wassce, hasRun, (w) => formatRatioPercent(w.rate, 0));
  const sittingYear = isOk(wassceCohort)
    ? sittingYearOf(wassceCohort.value.academicYear)
    : null;

  // The lede's stat fragments follow the SAME rule as the cards: with no successful ETL run there is
  // no vintage for any figure, so the lede states that instead of quoting numbers the strip is
  // refusing to show. Each fragment is also independently omitted when its read is unavailable —
  // better a shorter true sentence than a placeholder inside one.
  const ledeFragments: ReactNode[] = [];
  if (hasRun && isOk(coverage)) {
    ledeFragments.push(
      <>
        Rolled up from{" "}
        <Stat>
          {formatCount(coverage.value.regions)}{" "}
          {coverage.value.regions === 1 ? "region" : "regions"}
        </Stat>
      </>,
      <>
        <Stat>
          {formatCount(coverage.value.reporting)} of{" "}
          {formatCount(coverage.value.registered)} schools
        </Stat>{" "}
        reporting into Omnischools
      </>,
    );
  }
  if (hasRun && isOk(enrolment)) {
    ledeFragments.push(
      <>
        <Stat>{formatCount(enrolment.value.total)} pupils</Stat>
      </>,
    );
  }

  return (
    <>
      <PageHead
        crumb="Oversight · National dashboard"
        title={
          <>
            Ghana · <em className="accent-italic">national dashboard.</em>
          </>
        }
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
              {isOk(coverage) && coverage.value.regions > 1 ? (
                <>
                  {" "}
                  Every figure is the sum or mean of {formatCount(
                    coverage.value.regions,
                  )}{" "}
                  regions.
                </>
              ) : null}
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
            unit={isOk(enrolment) && hasRun ? "pupils" : undefined}
            sub={
              isOk(enrolment) && hasRun ? (
                <>
                  Across {formatCount(enrolment.value.schoolsCounted)} reporting schools
                </>
              ) : null
            }
          />
          <KpiCard
            label="School coverage"
            value={coverageValue}
            unit={isOk(coverage) && hasRun ? "%" : undefined}
            sub={
              isOk(coverage) && hasRun ? (
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
            unit={isOk(wassce) && hasRun ? "%" : undefined}
            sub={
              isOk(wassce) && hasRun ? (
                <>
                  {tier}
                  {sittingYear !== null ? ` · ${sittingYear}` : ""} · credit or above
                </>
              ) : null
            }
          />
        </section>

        {/*
          Lucy §3.4. Four items against the primitive's `sm:grid-cols-3`, so the fourth wraps — which
          §3.4 rules acceptable. The Coverage line is COMPUTED, including the "not yet on Omnischools"
          gap: it is the surface's core discipline, not decoration, so it must be the real number.
        */}
        <Provenance
          items={[
            [
              "Source",
              isOk(coverage)
                ? `Omnischools analytics DB · ${formatCount(coverage.value.regions)} region rollup${
                    coverage.value.regions === 1 ? "" : "s"
                  }`
                : "Omnischools analytics DB",
            ],
            [
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
              "Scope",
              officer.level === "NATIONAL"
                ? "national · no jurisdiction ceiling — all regions visible"
                : // Tier-honest, because this line is a claim about the RLS ceiling rather than copy.
                  // The per-tier TITLE and lede are slice 2's question (district/regional landings).
                  `${officer.level.toLowerCase()} · scoped to your jurisdiction subtree`,
            ],
          ]}
        />
      </PageBody>
    </>
  );
}
