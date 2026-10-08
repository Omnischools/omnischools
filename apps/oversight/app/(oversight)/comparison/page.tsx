import { getOfficerSession } from "@/lib/auth";
import { scopeFor } from "@/lib/db/rls";
import { getCurrentPeriod, getLatestExamCohortPeriod, sittingYearOf } from "@/lib/oversight/period";
import type { AnalyticsPeriod } from "@/lib/oversight/period";
import { getChildBreakdown, type BreakdownRow, type ChildLevel } from "@/lib/oversight/breakdown";
import {
  getComparisonEntities,
  examForSchoolType,
  pinSelectionToLevel,
  type ComparisonEntity,
  type SchoolType,
} from "@/lib/oversight/comparison-entities";
import {
  buildComparison,
  comparisonMetrics,
  MAX_ENTITIES,
  type ComparisonColumnInput,
} from "@/lib/oversight/comparison";
import { isOk, unavailable } from "@/lib/oversight/reading";
import { PageBody, PageHead } from "@/components/oversight/shell";
import { Banner, Provenance } from "@/components/oversight/primitives";
import { COVERAGE_BANDS } from "@/components/oversight/breakdown-table";
import { ComparisonPicker, entityMeta } from "@/components/oversight/comparison-picker";
import {
  ComparisonTable,
  type ComparisonColumnHeader,
} from "@/components/oversight/comparison-table";

/**
 * THE COMPARISON WORKSPACE (increment I) — set the entities one level below the officer side by side.
 *
 * ONE ROUTE, EVERY TIER (the dashboard's single-route precedent). A district officer compares their
 * schools, a regional officer their districts, a national officer the regions — always the officer's
 * own DESCENDANTS, so every figure is served by reusing `getChildBreakdown` UNCHANGED under the officer's
 * existing RLS ceiling. Sibling / up-a-tier comparison (a district officer vs other districts) is NOT
 * served here: those rows are outside `ov_in_subtree` and the picker's tier toggle shows that tier
 * disabled rather than returning a silently empty table (COMPARISON-WORKSPACE-{DOMAIN-RULING,DATA-PLAN}).
 *
 * SELECTION IS IN THE URL (`?e=id,id,…`), so the surface is a server component with no client store; the
 * picker's add/remove are links. With no selection the page defaults to a readable starter set (the
 * officer's SHS, else the largest comparable group) so it demos populated, and the officer edits from
 * there.
 *
 * EVERY FIGURE IS COMPUTED AT REQUEST TIME and AGGREGATE-ONLY — no named records, nothing imported from
 * the gated read-back path. The benchmark is the LIKE-FOR-LIKE weighted roll-up over ALL children of the
 * compared type (never the selection), computed in TS from the components the breakdown already carries.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Comparison workspace" };

const BASE_PATH = "/comparison";
const DEFAULT_SELECTION = 4; // a readable starter set; the officer may grow it to MAX_ENTITIES.

/** The tier noun for the benchmark label — "District average" / "Region average" / "National average". */
function tierAverageLabel(level: string): string {
  if (level === "REGION") return "Region average";
  if (level === "NATIONAL") return "National average";
  return "District average";
}

/**
 * The starter selection when the URL names none: prefer the officer's SHS (the mock's demo and the most
 * compare-worthy group), else the largest same-type group, capped for legibility. Above SCHOOL depth all
 * children are one type, so just take the first few.
 */
function defaultSelection(entities: ComparisonEntity[], childLevel: ChildLevel): string[] {
  if (childLevel !== "SCHOOL") {
    return entities.slice(0, DEFAULT_SELECTION).map((e) => e.jurisdictionId);
  }
  const byType = new Map<SchoolType, ComparisonEntity[]>();
  for (const e of entities) {
    if (e.schoolType === null) continue;
    const list = byType.get(e.schoolType) ?? [];
    list.push(e);
    byType.set(e.schoolType, list);
  }
  const shs = byType.get("SHS");
  const largest = [...byType.values()].sort((a, b) => b.length - a.length)[0];
  const pick = (shs && shs.length > 0 ? shs : largest) ?? entities;
  return pick.slice(0, DEFAULT_SELECTION).map((e) => e.jurisdictionId);
}

/**
 * Parse the `e` param into an ordered, de-duplicated list of ids the officer may see. It does NOT cap
 * here: the MAX_ENTITIES cap is applied AFTER level-pinning (Dex cap-before-pin fix), so a hand-edited
 * URL with off-level ids ahead of valid same-level ones can no longer spend cap slots on picks that
 * `pinSelectionToLevel` is about to drop — which previously under-filled the comparison.
 */
function parseSelection(raw: string | undefined, valid: Set<string>): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const id of raw.split(",")) {
    const trimmed = id.trim();
    // An id in neither read is dropped with no label and no echo — a uuid in a URL is not an existence
    // signal (Wells trap C).
    if (trimmed && valid.has(trimmed) && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

export default async function ComparisonWorkspace({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const officer = await getOfficerSession();
  if (!officer) {
    return (
      <>
        <PageHead
          crumb="Oversight · Comparison workspace"
          title={
            <>
              Comparison <em className="accent-italic">workspace.</em>
            </>
          }
          lede="Every figure in this workspace is scoped to your officer identity."
        />
        <PageBody>
          <Banner tone="gold" glyph="⊘" title="Sign in required.">
            This workspace is available to provisioned oversight officers.
          </Banner>
        </PageBody>
      </>
    );
  }

  const scope = scopeFor(officer);
  const entitiesReading = await getComparisonEntities(scope);
  const entities = isOk(entitiesReading) ? entitiesReading.value.entities : [];
  const childLevel: ChildLevel = isOk(entitiesReading)
    ? entitiesReading.value.childLevel
    : "SCHOOL";
  const childNoun =
    childLevel === "SCHOOL" ? "schools" : childLevel === "DISTRICT" ? "districts" : "regions";

  const params = await searchParams;
  const validIds = new Set(entities.map((e) => e.jurisdictionId));
  const requested = parseSelection(params.e, validIds);
  const selectedIds =
    requested.length > 0 ? requested : defaultSelection(entities, childLevel);

  const byId = new Map(entities.map((e) => [e.jurisdictionId, e]));
  const requestedEntities = selectedIds
    .map((id) => byId.get(id))
    .filter((e): e is ComparisonEntity => e !== undefined);

  // The first valid pick pins the school level and off-level picks are dropped — on the URL path too,
  // so `?e=<SHS>,<JHS>` cannot build a mixed-level comparison (Kofi R2.3). Pure + tested helper. The
  // MAX_ENTITIES cap is applied HERE, after pinning, so off-level picks never consume cap slots ahead
  // of valid same-level ones (Dex cap-before-pin fix).
  const { pinnedType, selected: pinnedSelection } = pinSelectionToLevel(
    requestedEntities,
    childLevel,
  );
  const selectedEntities = pinnedSelection.slice(0, MAX_ENTITIES);
  const effectiveIds = selectedEntities.map((e) => e.jurisdictionId);

  const exam = childLevel === "SCHOOL" ? examForSchoolType(pinnedType) : "WASSCE";

  // Periods resolved ONCE at the officer's scope and passed in — never per child (the breakdown rule).
  const [termPeriod, annualPeriod, examCohort] = await Promise.all([
    getCurrentPeriod(scope, "TERM"),
    getCurrentPeriod(scope, "ANNUAL"),
    exam ? getLatestExamCohortPeriod(scope, exam) : unavailable<AnalyticsPeriod>(),
  ]);

  const breakdownReading = await getChildBreakdown(scope, {
    childLevel,
    termPeriodId: isOk(termPeriod) ? termPeriod.value.periodId : null,
    examPeriodId: isOk(examCohort) ? examCohort.value.periodId : null,
    annualPeriodId: isOk(annualPeriod) ? annualPeriod.value.periodId : null,
    // A real exam is always passed (the arg cannot be null); when the level sits none, examPeriodId is
    // null so no exam rows match and the performance section is omitted below regardless.
    exam: exam ?? "WASSCE",
  });

  const pageHead = (
    <PageHead
      crumb={`Oversight · Comparison workspace`}
      title={
        <>
          Comparison <em className="accent-italic">workspace.</em>
        </>
      }
      lede="Choose what to compare and what to compare it on — the entities one level below you, set side by side against their average."
    />
  );

  const scopeNote = (
    <Banner tone="gold" glyph="i" title={`Scoped to your ${childNoun}.`}>
      You compare the <b className="font-semibold text-navy">{childNoun}</b> within your own
      jurisdiction, each read against their average. Comparing your own tier against its siblings, or any
      tier above you, needs higher-level access and is not offered here — the picker only lets you
      assemble what your jurisdiction permits.
    </Banner>
  );

  // Either read failing makes the surface unstateable — say so honestly rather than showing the
  // "pick some" prompt (which would imply the officer simply hasn't chosen), and keep the rest of
  // Oversight unaffected (the `Reading` fail-soft precedent).
  if (!isOk(entitiesReading) || !isOk(breakdownReading)) {
    return (
      <>
        {pageHead}
        <PageBody>
          {scopeNote}
          <Banner tone="warn" glyph="!" title="Comparison unavailable.">
            The underlying figures could not be read just now. The rest of Oversight is unaffected; try
            again shortly.
          </Banner>
        </PageBody>
      </>
    );
  }

  const breakdown = breakdownReading.value;

  // THE BENCHMARK POPULATION — the LIKE-FOR-LIKE child set, fixed by level, NEVER the selection. Above
  // SCHOOL depth every child is already one type, so it is all of them. At SCHOOL depth it is the
  // children whose school is the pinned type (all the district's SHS). When the depth is SCHOOL but NO
  // pinned type could be resolved (every selected school's type is null), there is NO like-for-like key
  // to average over, so the benchmark is SUPPRESSED (empty population → every benchmark cell "—")
  // rather than blending across school levels, which R3.3 forbids (Dex M3). Summed from the components
  // on each row — the sanctioned Σ÷Σ fold, not `breakdown.total` (which blends all school levels).
  const benchmarkPopulation: BreakdownRow[] =
    childLevel === "SCHOOL"
      ? pinnedType !== null
        ? breakdown.children.filter(
            (row) => row.childId !== null && byId.get(row.childId)?.schoolType === pinnedType,
          )
        : []
      : breakdown.children;

  const childById = new Map(
    breakdown.children.filter((r) => r.childId !== null).map((r) => [r.childId as string, r]),
  );

  // Columns, in selection order. A selected entity absent from the fact-driven breakdown gets a named
  // column of `—` (row: null), never dropped. Thin coverage disqualifies a column from RATE marking
  // (district/region only; at SCHOOL depth coverage is null, so the flag is always false).
  const columns: ComparisonColumnInput[] = selectedEntities.map((entity) => {
    const row = childById.get(entity.jurisdictionId) ?? null;
    const coverageAmbiguous =
      row?.coverageRatio != null && row.coverageRatio < COVERAGE_BANDS.amber;
    return { id: entity.jurisdictionId, row, coverageAmbiguous };
  });

  const metrics = comparisonMetrics({ exam, hasCoverage: breakdown.hasCoverage });
  const model = buildComparison({ metrics, benchmarkPopulation, columns });

  const headers: ComparisonColumnHeader[] = selectedEntities.map((entity, i) => ({
    id: entity.jurisdictionId,
    name: entity.name,
    meta: entityMeta(entity),
    anchor: i === 0,
    coverageAmbiguous: columns[i]?.coverageAmbiguous ?? false,
  }));

  // The thin-coverage entities — their low rates are shown but NOT ranked, and the caveat must say so
  // beside the finding (Kofi R5.1), never let a mark silently vanish. Empty at SCHOOL depth (no coverage).
  const thinCoverage = selectedEntities.filter((_, i) => columns[i]?.coverageAmbiguous);

  const benchmarkLabel = tierAverageLabel(officer.level);
  // The benchmark names the group it is computed over: `benchmarkPopulation` itself — the like-for-like
  // children with a row in the roll-up — not the full registered list (Dex M1: the old count took
  // `entities.filter`, which includes schools that filed nothing, so a weighted Σ÷Σ or mean-per-filer
  // divisor could sit below the numeral the label asserted). Empty population ⇒ no benchmark column, so
  // no meta is needed.
  //
  // And it names the POPULATION, only that. It used to be printed as the base of every benchmark
  // figure — but the benchmark skips children that did not file the measure, and which children those
  // are is per-METRIC (vacancies is public-only, attendance gradebook-adopters-only, qualification the
  // schools that sat), so one population-wide numeral asserted a base most rows do not have. The real
  // per-row base is `row.benchmarkContributors` (lib/oversight/comparison.ts), which the table now
  // states inside each benchmark cell; this count is the DENOMINATOR those cells divide by.
  const benchmarkPopulationMeta = {
    count: benchmarkPopulation.length,
    noun: childLevel === "SCHOOL" && pinnedType !== null ? pinnedType : childNoun,
  };
  const benchmarkMeta = `${benchmarkPopulationMeta.count} ${benchmarkPopulationMeta.noun}`;

  const sittingYear = isOk(examCohort) ? sittingYearOf(examCohort.value.academicYear) : null;

  return (
    <>
      {pageHead}
      <PageBody>
        {scopeNote}

        <ComparisonPicker
          basePath={BASE_PATH}
          childLevel={childLevel}
          entities={entities}
          selectedIds={effectiveIds}
          benchmarkLabel={benchmarkLabel}
        />

        {selectedEntities.length === 0 ? (
          <Banner tone="gold" glyph="+" title={`Select ${childNoun} to compare.`}>
            Add two or more {childNoun} from the picker to set them side by side. One on its own reads
            against the average as a profile.
          </Banner>
        ) : (
          <ComparisonTable
            model={model}
            columns={headers}
            benchmarkLabel={benchmarkLabel}
            benchmarkPopulation={benchmarkPopulationMeta}
            footnote={
              <>
                Read <b className="font-semibold text-navy-2">across a row</b> to compare,{" "}
                <b className="font-semibold text-navy-2">down a column</b> to profile one{" "}
                {childLevel === "SCHOOL" ? "school" : childNoun.replace(/s$/, "")}. The best and
                worst entity in each ranked row is marked; total enrolment and cohort size carry no
                mark — size is not a measure of quality. The benchmark column is the like-for-like
                average over the {benchmarkMeta} at this level (rate rows weighted Σ÷Σ, count rows the
                mean per filer), pinned and never ranked; each benchmark cell names how many of them
                filed <i>that</i> measure, which is fewer wherever a measure does not apply to every
                one of them.
              </>
            }
          />
        )}

        {thinCoverage.length > 0 ? (
          <Banner tone="warn" glyph="!" title="What this comparison cannot yet show.">
            {thinCoverage.map((e) => e.name).join(", ")}{" "}
            {thinCoverage.length === 1 ? "has" : "have"} thin register coverage, so{" "}
            {thinCoverage.length === 1 ? "its" : "their"} rate is shown but{" "}
            <b className="font-semibold text-navy">not ranked</b> — a low rate at thin coverage is
            ambiguous, part real and part simply unmeasured, not confirmed under-performance.
          </Banner>
        ) : null}

        <Provenance
          items={[
            ["Aggregate only", "institutions compared, never named pupils or staff"],
            [
              "Like-for-like",
              childLevel === "SCHOOL"
                ? "only schools of the same level compare directly"
                : `every ${childNoun.replace(/s$/, "")} is the same tier`,
            ],
            [
              "Benchmark",
              `like-for-like average over the ${benchmarkMeta} at this level, each row over those of them that filed it — moves with the data, not your selection`,
            ],
            [
              "Attendance",
              "internal gradebook data · termly, shown only where schools use the gradebook",
            ],
            [
              // The vacancy row's honest denominator, made legible (Lucy §2; the read rule it states is
              // lib/etl/staffing.ts's). Signed, and public-only: GES sets no establishment for private
              // or mission schools, so they are a named `—` in both the cell and the benchmark.
              //
              // The line names the WORDS the cells actually render, not a `+ / −` sign convention they
              // never show (Dex N7): every vacancy figure on this surface is worded by ruling (V6), so a
              // ledger line teaching the reader to decode a sign would document a rendering that does not
              // exist. The benchmark cell is a RATE and worded the same way, which is also stated.
              "Vacancies",
              "signed net vs GES establishment · posts unfilled / over establishment · benchmark is the weighted vacancy rate, worded the same way · GES-establishment schools only (private and mission excluded)",
            ],
            ...(exam && sittingYear
              ? ([[`${exam} sitting`, `${sittingYear} cohort · credit or above`]] as [
                  string,
                  string,
                ][])
              : []),
          ]}
        />
      </PageBody>
    </>
  );
}
