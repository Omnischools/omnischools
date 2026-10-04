import type postgres from "postgres";
import {
  annualPeriodSpecs,
  assertSpineIntact,
  examCohortAcademicYear,
  examCohortPeriodKey,
  examCohortPeriodSpec,
  periodKey,
  refreshJurisdictions,
  refreshPeriods,
  type JurisdictionIndex,
  type PeriodSpec,
} from "./dimensions";
import { buildInclusionSet, type CoverageFigures } from "./inclusion";
import {
  decomposeFacilitiesSnapshot,
  writeInfrastructureFactsTx,
  type FactInfrastructureRow,
} from "./infrastructure";
import {
  aggregateSchoolRoster,
  assertStagesSeeded,
  writeEnrolmentFactsTx,
  type FactEnrolmentRow,
} from "./enrolment";
import { readActiveRosterGroups, type RosterGroupSourceRow } from "./enrolment-source";
import {
  EXAMS,
  aggregateSchoolSitting,
  assertExamCohortPeriodsSeeded,
  waecExtractFactRows,
  writePerformanceExamFactsTx,
  type Exam,
  type FactPerformanceExamRow,
} from "./performance";
import {
  readTerminalExamResults,
  readTerminalExamSittingYears,
  readWaecExtractCohort,
  type TerminalExamSourceRow,
} from "./performance-source";
import { loadEmisRegister, parseEmisExtract, type RegisterRow } from "./register";
import { readLatestFacilitiesSnapshots } from "./source";
import type { AnalyticsStage } from "./stage";
import {
  closeEtlRun,
  computePerSchool,
  failureVerdict,
  openEtlRun,
  runAnomalyHook,
  type SchoolFailure,
  type SchoolFailurePolicy,
} from "./run";

/**
 * THE RUN SEQUENCE (spec §7 / scope §3), end-to-end for the increment-H fact slices — ONE run that
 * computes and writes BOTH arms, `fact_infrastructure` AND `fact_enrolment`, under one verdict and in
 * one transaction (see the TWO FACTS, ONE RUN note below).
 *
 *   1  open the `etl_run` row (RUNNING)
 *   2  refresh dimensions — `dim_jurisdiction` spine + `dim_period` (TERM rows AND the ANNUAL cut of
 *      each academic year, which is the grain this fact is written at), then ASSERT the spine
 *   3  load the EMIS register (reference delta) — the coverage denominator
 *   4  build the inclusion set — registered ∧ live ∧ mapped
 *   5a COMPUTE every period's facts, per school, isolated — no writes at all
 *   5b TAKE THE VERDICT over the whole run's failures
 *   5c WRITE, once, in ONE transaction across every period — only if the verdict is SUCCESS
 *   6  anomaly hook — a NO-OP (increment J)
 *   7  close the run (SUCCESS / SUCCESS-with-gaps / FAILED)
 *
 * ⚠ WHY 5 IS THREE PHASES AND NOT A LOOP THAT WRITES AS IT GOES. "A FAILED run wrote nothing" is the
 * claim the as-of banner rests on (`lib/oversight/etl-status.ts`): the banner shows the latest SUCCESS
 * run because a FAILED one is assumed not to have touched the data. A loop that wrote each period
 * before the verdict existed would falsify that twice over — a run that breached the failure-rate
 * policy would already have published the surviving schools, and a throw while writing period 2 would
 * leave period 1 committed under a FAILED banner. The verdict also NEEDS all periods first, since the
 * failure RATE is over the whole run's attempted schools. This slice sets the pattern H8–H16 copy, so
 * the ordering is part of the deliverable.
 *
 * Steps 2 and 3 are in that order even though the register is step 2's own input: the extract is
 * PARSED once up front, the spine is built from the parsed region/district names, and the register
 * rows are then written with the resolved jurisdiction uuids (see `lib/etl/register.ts`).
 *
 * ANY step throwing closes the run FAILED with `error_text` and leaves the prior data in place. The
 * only per-school-tolerant step is 5, and its tolerance is the stated `SchoolFailurePolicy`.
 *
 * ⚠ THREE FACTS, ONE RUN (increment H third slice, task H14). `fact_performance_exam` is the THIRD ARM,
 * threaded exactly as the enrolment arm was: computed in 5a under `computePerSchool`, its failures
 * tallied into the SAME run-wide verdict, its rows written in the SAME `sql.begin` in 5c, with its own
 * explicit delete scope. Two things about it are NOT the enrolment arm's shape, and both follow from the
 * grain:
 *   · IT RUNS FOR EVERY DECLARED SITTING COHORT, not just the current year. A sitting is a CLOSED,
 *     IMMUTABLE cohort of candidates, so backfilling 2025's BECE is legitimate in a way that
 *     backfilling a past year's ROSTER is not (there is only ever one roster, and it is tonight's).
 *   · ITS PERIOD IS NOT THE ANNUAL ONE. It files against `period_type = 'EXAM_COHORT'` (one period per
 *     sitting year, both exams on it), so it does not belong inside the ANNUAL period loop and the run
 *     reports it under `EtlRunReport.examCohorts` rather than squeezing it into `PeriodOutcome`.
 *
 * ⚠ TWO FACTS, ONE RUN, ONE VERDICT, ONE TRANSACTION (increment H second slice, task H9).
 * `fact_enrolment` is computed as a PARALLEL ARM inside exactly the same 5a/5b/5c phasing, not as a
 * second pipeline: one `etl_run` row, one failure verdict over BOTH arms' per-school failures, and ONE
 * transaction that writes both fact tables (step 5c calls the `…Tx` writers inside a single
 * `sql.begin`). A second pipeline would mean two runs per night, two as-of banners and — the real
 * defect — a night in which infrastructure published and enrolment did not, with nothing on screen
 * saying so. Both arms file at the SAME ANNUAL period, so a dashboard that joins them is joining one
 * vintage.
 *
 * ⚠ THE ENROLMENT ARM RUNS FOR THE CURRENT ACADEMIC YEAR ONLY; the infrastructure arm runs for every
 * year in the run. The asymmetry is forced by the two sources. A census row carries `captured_at` and
 * is SELECTED BY academic year, so a backfill of 2024/25 reads 2024/25's censuses and the figure is
 * genuinely that year's. The ROSTER carries no period at all (`students` is the live state of the
 * school), so there is exactly ONE roster and it is tonight's: filing it against a PAST year's ANNUAL
 * period would publish tonight's roll as that year's MEASURED enrolment, stamped with that year's
 * `ends_on` — a provenance falsehood with nothing downstream able to detect it. What a past year's
 * roll ought to be (an archived roster? a census table? nothing at all?) is a future Kofi question,
 * not something to invent here, so until it is ruled the honest answer for a non-current year is NO
 * ENROLMENT ROWS — and `fact_enrolment`'s bounded delete means the year simply keeps whatever it had.
 *
 * ⚠ THE GRAIN IS ANNUAL (Kofi's Q3 ruling — the mapping rule and its reasoning are in
 * `lib/etl/dimensions.ts`). `options.periods` still DECLARES the run in terms, because the terms are
 * what the calendar is made of and the TERM rows of `dim_period` are still upserted for the other
 * fact tables; but step 5 loops over the ANNUAL cut of those terms — one period per academic_year —
 * and each school contributes ONE row, decomposed from its latest census in that year on any product
 * line. A BASIC school that filed three term censuses therefore produces one row, not three.
 */

export interface EtlRunOptions {
  /** The EMIS extract file's contents. Parsed, never trusted. */
  emisExtractText: string;
  /**
   * The terms in the run. `dim_period` TERM rows are upserted for all of them, AND one ANNUAL row per
   * distinct `academicYear` — which is the period `fact_infrastructure` rows are actually written
   * against. A spec with `term: null` is itself an ANNUAL declaration and collapses into that year's
   * single ANNUAL row, so passing the terms or passing the year is the same run.
   */
  periods: PeriodSpec[];
  /** `"demo_source"` for the demo; `"public"` on an `oversight_etl` operational connection. */
  sourceSchema: string;
  policy?: SchoolFailurePolicy;
  nationalName?: string;
  /**
   * THE ROSTER'S FROZEN VINTAGE — `fact_enrolment.as_of_date`, as an ISO date/timestamp.
   *
   * `fact_infrastructure` gets its vintage for free: a census row carries `captured_at`, the moment a
   * school answered. A ROSTER CARRIES NO SUCH COLUMN — `students` is the live state of the school, so
   * "when was this true?" is a question only the RUN can answer, and the two obvious answers are both
   * wrong:
   *   `now()`        would make every nightly re-run of an unchanged roll produce a different row, so
   *                  "a re-run is byte-identical" would be untestable and provenance would say the
   *                  figure was freshly measured when nothing had changed.
   *   the roll date  does not exist. There is nothing to read.
   * So the run DECLARES a frozen census date, exactly as `apps/web/lib/reports/census-enrolment-data.ts`
   * freezes its `censusDate` at generation (GOV8-02) rather than ageing children against the clock.
   *
   * Default: the CURRENT academic year's ANNUAL `ends_on` (i.e. the last declared term's end), falling
   * back to its `starts_on`, which reads as "the roll as filed for this academic year". Pass this
   * option to pin a real census date.
   *
   * `startsOn`/`endsOn` are both OPTIONAL on `PeriodSpec` (`{ academicYear, term: null }` is a blessed
   * ANNUAL declaration), so there is a shape of run in which NEITHER default exists. That case THROWS,
   * naming this option as the fix: `fact_enrolment.as_of_date` is a `timestamptz`, and the old final
   * fallback — the bare academic-year string, "2025/26" — died much later, inside step 5c, as a raw
   * Postgres cast error with no indication of which option to set.
   */
  rosterAsOf?: string;
  /**
   * THE SITTING COHORTS THIS RUN FILES — `fact_performance_exam`'s third arm (task H14).
   *
   * DECLARED, exactly as `periods` declares the academic years, and for the same reason: the run states
   * which cohorts it is responsible for, and `dim_period`'s EXAM_COHORT rows are upserted from that
   * declaration in step 2 (so no analytics object is invented — see `lib/etl/dimensions.ts`).
   *
   * OMITTED OR EMPTY ⇒ THE ARM DOES NOT RUN. Zero rows, an EMPTY delete scope (so any previously
   * published sitting keeps its figures) and nothing added to `attempted` — the same clean no-op shape
   * the enrolment arm takes when no academic year is current. It is NOT a silent swallow of a real
   * sitting: a run that DOES declare cohorts and whose source carries a sitting year it did NOT declare
   * FAILS, up front, naming the naming rule (`assertExamCohortPeriodsSeeded`).
   *
   * `endsOn` is the cohort's FROZEN VINTAGE: `fact_performance_exam.as_of_date` is the sitting's own
   * `ends_on`, never `now()`, so a re-run of a closed sitting is byte-identical and provenance says
   * "this is the June 2026 sitting" rather than "we recomputed it last night".
   */
  examCohorts?: ExamCohortDeclaration[];
}

/** One sitting the run files. `sittingYear` is `terminal_exam_result.year` — a bare calendar year. */
export interface ExamCohortDeclaration {
  sittingYear: number;
  /** The sitting window. `endsOn` becomes every row's `as_of_date`; `startsOn` is the fallback. */
  startsOn?: string | null;
  endsOn?: string | null;
}

/**
 * What the performance arm produced for ONE sitting cohort. One of these per declared cohort.
 *
 * ⚠ `candidates` / `qualified` are reported PER EXAM (`byExam`), never pooled into one pair, because a
 * pooled pair invites a pooled RATE — and a BECE candidate and a WASSCE candidate are different children
 * (JHS 3 leavers vs SHS 3 leavers), so one rate over both describes a cohort that does not exist.
 */
export interface ExamCohortOutcome {
  /** The sitting CALENDAR year (2026). */
  sittingYear: number;
  /** The EXAM_COHORT period's `academic_year` — "(N-1)/N". */
  academicYear: string;
  /** ALWAYS "EXAM_COHORT". Stated so a reader never re-derives it from `term`. */
  periodType: "EXAM_COHORT";
  periodId: string;
  /** The cohort's frozen vintage — the sitting's `ends_on`. Never `now()`. */
  asOfDate: string;
  /** Filed sittings read from the source (one per school × exam). */
  sourceRows: number;
  /** Schools whose sittings were aggregated (including to ZERO rows) — the DELETE scope. */
  schoolsComputed: number;
  deleted: number;
  inserted: number;
  /**
   * Rows dropped by the PER-COHORT WAEC>SCHOOL precedence collapse at write time: a cohort WAEC covers
   * loses ALL its school-entered rows (MALE, FEMALE and ALL), so a WAEC-covered cohort is ALL-only.
   */
  superseded: number;
  /** Per exam, the `sex='ALL'` totals. Counts only — the rate is re-derived per row, never from these. */
  byExam: { exam: Exam; candidates: number; qualified: number }[];
  /**
   * Included schools that filed NO sitting for this cohort — a KG/PRIMARY school (which never presents
   * candidates) or a JHS/SHS that has not keyed its results yet. NOT a failure, and NOT in the delete
   * scope: they keep whatever they had.
   */
  noResults: string[];
  /** Rows the WAEC_EXTRACT arm produced. ZERO today — the feed is empty/absent, by design. */
  waecRows: number;
  failures: SchoolFailure[];
}

/**
 * What the enrolment arm produced for one period, as the run reports it. See `PeriodOutcome.enrolment`.
 *
 * ALL ZEROES AND EMPTY LISTS on a NON-CURRENT academic year: the arm did not run there, by design (see
 * the header). Zero `schoolsComputed` is therefore also an empty delete scope, so that year's existing
 * rows are left exactly as they were rather than deleted-and-not-reinserted.
 */
export interface EnrolmentOutcome {
  /** Grouped roster slices read from the source — counts of children, never children. */
  sourceGroups: number;
  /** Schools whose roster was aggregated (including to ZERO rows) — the DELETE scope. */
  schoolsComputed: number;
  deleted: number;
  inserted: number;
  /** ACTIVE children counted into a stage row, nationally — the `sex=ALL, class_form IS NULL` sum. */
  headcount: number;
  /** ACTIVE children in a below-KG class. In NO stage row, and never silently dropped. */
  outOfScopeHeadcount: number;
  /** ACTIVE children whose class label resolved to no stage. In NO stage row, never dropped. */
  unmappedHeadcount: number;
  /** Included schools whose roster read returned NOTHING AT ALL. Not a failure; keeps prior rows. */
  noRoster: string[];
  /** Schools teaching a stage their register `school_type` does not account for. A hint, not a fault. */
  stageDrift: {
    emisSchoolId: string;
    schoolType: string | null;
    stages: AnalyticsStage[];
  }[];
  failures: SchoolFailure[];
}

export interface PeriodOutcome {
  academicYear: string;
  /** ALWAYS null: the grain is the academic YEAR, and `term = null` is what makes a period ANNUAL. */
  term: null;
  /** ALWAYS "ANNUAL". Stated on the outcome so a reader never has to re-derive it from `term`. */
  periodType: "ANNUAL";
  periodId: string;
  /** Census rows selected as authoritative — at most one per school, so also the candidate count. */
  sourceRows: number;
  deleted: number;
  inserted: number;
  failures: SchoolFailure[];
  /**
   * Included schools that filed NO census row ANYWHERE in the academic year — on any product line,
   * for any period number. They are not a failure (a school that has not filed yet is a normal state)
   * but they ARE the difference between the inclusion set and `schools_reporting`, so they are listed
   * rather than left to be inferred from a subtraction. Increment I's coverage card reads this.
   *
   * THE ACCOUNTING IDENTITY, revised by the re-grain (the skipped-product-line term is gone):
   *   inserted + noSourceRow + failures = coverage.included
   * which is the property `tests/etl-infrastructure.test.ts` asserts, and the only way to know no
   * school vanished quietly between the inclusion set and the facts. EMIS ids, not tenant uuids —
   * this is reportable, and the tenant uuid is not.
   */
  noSourceRow: string[];
  /** The second fact table's arm, at the SAME ANNUAL period. See `EnrolmentOutcome`. */
  enrolment: EnrolmentOutcome;
}

export interface EtlRunReport {
  runId: string;
  status: "SUCCESS" | "FAILED";
  errorText: string | null;
  registerRows: number;
  coverage: CoverageFigures;
  periods: PeriodOutcome[];
  /** The THIRD arm, at its OWN EXAM_COHORT periods — one entry per declared sitting. */
  examCohorts: ExamCohortOutcome[];
}

export async function runOversightEtl(
  sql: postgres.Sql,
  options: EtlRunOptions,
): Promise<EtlRunReport> {
  // Parsing happens BEFORE the run is opened: a malformed extract is not a failed run, it is a
  // rejected input, and opening a RUNNING row for it would put noise in the banner's history.
  const registerRows: RegisterRow[] = parseEmisExtract(options.emisExtractText);

  const runId = await openEtlRun(sql); // step 1
  try {
    // ── step 2 · dimensions ─────────────────────────────────────────────────────────────────────
    const index: JurisdictionIndex = await refreshJurisdictions(
      sql,
      registerRows,
      options.nationalName,
    );
    await assertSpineIntact(sql, index);
    // The TERM rows AND the ANNUAL cut, in ONE upsert call: the ANNUAL rows are DERIVED from the
    // declared terms (`annualPeriodSpecs`), so "exactly one ANNUAL row per academic_year in the run"
    // cannot be violated by a caller passing two.
    const annualSpecs = annualPeriodSpecs(options.periods);
    // The EXAM_COHORT rows are upserted in the SAME call as the TERM and ANNUAL ones — one sitting
    // period per declared cohort, `term IS NULL`, academic_year derived from the sitting year. No new
    // analytics OBJECT is created by any of this (`period_type` already carries EXAM_COHORT), which is
    // what keeps this slice clear of the §6 prod-paste-0006 re-run rule.
    const cohortDeclarations = options.examCohorts ?? [];
    const cohortSpecs = cohortDeclarations.map((c) => examCohortPeriodSpec(c));
    const periodIndex = await refreshPeriods(sql, [
      ...options.periods,
      ...annualSpecs,
      ...cohortSpecs,
    ]);
    // `dim_stage` is CONFIG (seeded by `pnpm db:seed`), not a dimension this ETL refreshes, and
    // `fact_enrolment.stage` is a FK to it. Asserted HERE so an unseeded database fails in step 2 with
    // the fix in the message, rather than hundreds of rows into step 5c with a constraint name.
    await assertStagesSeeded(sql);

    // ── step 3 · reference delta: the EMIS register ──────────────────────────────────────────────
    await loadEmisRegister(sql, registerRows, (row) => {
      const regionId = index.regions.get(row.regionName);
      const districtId = index.districts.get(
        `${row.regionName}\u0000${row.districtName}`,
      );
      if (!regionId || !districtId)
        throw new Error(
          `${row.emisSchoolId}: region/district did not resolve to a dim_jurisdiction node ` +
            `(${row.regionName} / ${row.districtName}). The dimension refresh is the bug, not the extract.`,
        );
      return { districtId, regionId };
    });

    // ── step 4 · inclusion set + coverage ───────────────────────────────────────────────────────
    const inclusion = await buildInclusionSet(sql, index);
    const jurisdictionOf = new Map(
      inclusion.schools.map((s) => [s.operationalSchoolId, s]),
    );

    // ── step 5a · COMPUTE every period. NOTHING IS WRITTEN IN THIS LOOP. ────────────────────────
    interface PendingPeriod {
      spec: PeriodSpec;
      periodId: string;
      sourceRows: number;
      computed: FactInfrastructureRow[];
      failures: SchoolFailure[];
      noSourceRow: string[];
      /** The enrolment arm's rows and its delete scope, held unwritten until the verdict. */
      enrolmentRows: FactEnrolmentRow[];
      enrolmentScope: string[];
      enrolment: EnrolmentOutcome;
    }
    const schoolTypeOf = new Map(registerRows.map((r) => [r.emisSchoolId, r.schoolType]));
    const pending: PendingPeriod[] = [];
    const allFailures: SchoolFailure[] = [];
    let attempted = 0;

    // ── the ENROLMENT arm's SOURCE READ — ONCE for the whole run, and for ONE year only ──────────
    //
    // HOISTED OUT OF THE PERIOD LOOP for two independent reasons:
    //
    //  1. CORRECTNESS. `readActiveRosterGroups` takes NO academic year — `students` is the live state
    //     of the school and carries no period (see `lib/etl/enrolment-source.ts`) — so the read returns
    //     the SAME roster however many times it is issued. Calling it per year and writing the result
    //     against each year's ANNUAL period stamped that year's `ends_on` published TONIGHT'S roll as a
    //     PAST year's measured roll. Hence the second half: the arm attaches to the CURRENT academic
    //     year only, and a non-current year in a multi-year/backfill run gets NO enrolment rows. The
    //     INFRASTRUCTURE arm is unaffected and still backfills every year — its source really is
    //     selected by academic year. See the header for why a past year's roll is a Kofi question.
    //  2. COST. One aggregate read over the whole national roster (~200k rows) instead of one per year.
    //
    // NO current annual spec (which should not happen in the nightly run, where `is_current` comes from
    // the calendar) SKIPS THE ARM CLEANLY — zero rows, zero delete scope, nothing attempted — rather
    // than erroring or guessing a year.
    const enrolmentSpec = annualSpecs.find((s) => s.isCurrent === true) ?? null;
    let enrolmentArm: {
      spec: PeriodSpec;
      rosterAsOf: string;
      sourceGroups: number;
      /** Schools that returned ANY roster row, keyed by operational id. The compute candidates. */
      items: { schoolId: string; rows: RosterGroupSourceRow[] }[];
      noRoster: string[];
    } | null = null;
    if (enrolmentSpec) {
      // `as_of_date` is a `timestamptz` and MUST resolve to a real timestamp. `startsOn`/`endsOn` are
      // optional on `PeriodSpec`, so refuse the run here, naming the option — the old bare-year-string
      // fallback ("2025/26") reached the INSERT and died as a raw Postgres cast error.
      const rosterAsOf =
        options.rosterAsOf ?? enrolmentSpec.endsOn ?? enrolmentSpec.startsOn;
      if (!rosterAsOf)
        throw new Error(
          `the current academic year ${enrolmentSpec.academicYear} declares neither starts_on nor ` +
            "ends_on, so fact_enrolment.as_of_date has no vintage to freeze. Pass the `rosterAsOf` " +
            "option (an ISO date/timestamp) or declare the terms' dates in `options.periods`.",
        );
      const { groups } = await readActiveRosterGroups(sql, {
        schemaName: options.sourceSchema,
        operationalSchoolIds: inclusion.schools.map((s) => s.operationalSchoolId),
      });
      const groupsBySchool = new Map<string, RosterGroupSourceRow[]>();
      for (const group of groups) {
        const held = groupsBySchool.get(group.schoolId);
        if (held) held.push(group);
        else groupsBySchool.set(group.schoolId, [group]);
      }
      // A school whose roster read returned NOTHING AT ALL is not a failure and not computed: it keeps
      // its prior rows (stale-but-honest), exactly as a census-less school does on the other arm. A
      // school that DID return groups but whose every class is out-of-scope/unmapped IS computed — to
      // zero rows — and is therefore in the delete scope, so an emptied stage really empties.
      enrolmentArm = {
        spec: enrolmentSpec,
        rosterAsOf,
        sourceGroups: groups.length,
        items: [...groupsBySchool.entries()].map(([schoolId, rows]) => ({
          schoolId,
          rows,
        })),
        noRoster: inclusion.schools
          .filter((s) => !groupsBySchool.has(s.operationalSchoolId))
          .map((s) => s.emisSchoolId),
      };
    }

    /** The arm did not run for this year. Zero everything — and an EMPTY delete scope. */
    const noEnrolment = (): EnrolmentOutcome => ({
      sourceGroups: 0,
      schoolsComputed: 0,
      deleted: 0,
      inserted: 0,
      headcount: 0,
      outOfScopeHeadcount: 0,
      unmappedHeadcount: 0,
      noRoster: [],
      stageDrift: [],
      failures: [],
    });

    // ONE ITERATION PER ACADEMIC YEAR, not per term — the ANNUAL grain.
    for (const spec of annualSpecs) {
      const periodId = periodIndex.get(periodKey(spec.academicYear, null));
      if (!periodId)
        throw new Error(
          `dim_period has no ANNUAL row for ${spec.academicYear} after the refresh.`,
        );

      // Each school's AUTHORITATIVE census for the year: the latest it filed, on ANY product line.
      // At most one row per school comes back, so the ANNUAL grain is the query's property.
      const { rows: sourceRows } = await readLatestFacilitiesSnapshots(sql, {
        schemaName: options.sourceSchema,
        academicYear: spec.academicYear,
        operationalSchoolIds: inclusion.schools.map((s) => s.operationalSchoolId),
      });
      attempted += sourceRows.length;

      // "No census row ANYWHERE IN THE YEAR" — the only remaining non-failure gap. There is no
      // skipped-product-line bucket to be disjoint from any more: a school either filed something in
      // the year (and its latest is above) or it filed nothing at all. That is what makes the revised
      // accounting identity exact:
      //   inserted + noSourceRow + failures = the inclusion set
      // which is the property `tests/etl-infrastructure.test.ts` asserts, and the only way to know no
      // school vanished quietly between the inclusion set and the facts.
      const sawAnyCensus = new Set<string>(sourceRows.map((r) => r.schoolId));
      const noSourceRow = inclusion.schools
        .filter((s) => !sawAnyCensus.has(s.operationalSchoolId))
        .map((s) => s.emisSchoolId);

      // PER-SCHOOL ISOLATION — compute everything first, tally failures, then (in 5c) write the
      // survivors. A try/catch around a per-school INSERT would not isolate anything (the first error
      // aborts the whole transaction); see `computePerSchool`.
      const { computed, failures } = computePerSchool<
        (typeof sourceRows)[number],
        FactInfrastructureRow
      >(
        sourceRows,
        (row) => ({
          emisSchoolId: jurisdictionOf.get(row.schoolId)?.emisSchoolId ?? row.schoolId,
          jurisdictionId: jurisdictionOf.get(row.schoolId)?.jurisdictionId ?? null,
        }),
        (row) => {
          const school = jurisdictionOf.get(row.schoolId);
          if (!school)
            throw new Error(
              `operational school ${row.schoolId} is not in the inclusion set — the source read is ` +
                "not bounded by the inclusion set.",
            );
          return decomposeFacilitiesSnapshot(row, {
            jurisdictionId: school.jurisdictionId,
            periodId,
            emisSchoolId: school.emisSchoolId,
            etlRunId: runId,
          });
        },
      );
      allFailures.push(...failures);

      // ── the ENROLMENT arm, same period, same isolation — CURRENT YEAR ONLY ────────────────────
      // The roster was read ONCE, above the loop, and belongs to exactly one year: tonight's. On any
      // other year this arm WRITES nothing — no rows, no delete scope, and nothing added to
      // `attempted` (pooling roster schools into the denominator of a year the arm never ran would
      // inflate the tolerated absolute failure count for free). One thing it does still touch, by
      // design, is the duplicate assertion in `writeEnrolmentFactsTx`: that check is deliberately
      // period-wide, so it re-scans even a non-current year's rows and, if some earlier buggy run
      // left a duplicated grain key there, rolls back THIS whole dual-arm run. That is the intended
      // (loud, run-wide-fatal) failure direction for a table with no grain UNIQUE, not a leak.
      // Match by academic_year, not object identity: `annualPeriodSpecs` dedups by year so the
      // reference happens to be the same today, but comparing the year is the contract that matters.
      if (!enrolmentArm || enrolmentArm.spec.academicYear !== spec.academicYear) {
        pending.push({
          spec,
          periodId,
          sourceRows: sourceRows.length,
          computed,
          failures,
          noSourceRow,
          enrolmentRows: [],
          enrolmentScope: [],
          enrolment: noEnrolment(),
        });
        continue;
      }
      const { rosterAsOf, items: rosterItems } = enrolmentArm;
      attempted += rosterItems.length;

      const enrolmentCompute = computePerSchool<
        (typeof rosterItems)[number],
        { jurisdictionId: string; emisSchoolId: string } & ReturnType<
          typeof aggregateSchoolRoster
        >
      >(
        rosterItems,
        (item) => ({
          emisSchoolId: jurisdictionOf.get(item.schoolId)?.emisSchoolId ?? item.schoolId,
          jurisdictionId: jurisdictionOf.get(item.schoolId)?.jurisdictionId ?? null,
        }),
        (item) => {
          const school = jurisdictionOf.get(item.schoolId);
          if (!school)
            throw new Error(
              `operational school ${item.schoolId} is not in the inclusion set — the roster read is ` +
                "not bounded by the inclusion set.",
            );
          return {
            jurisdictionId: school.jurisdictionId,
            emisSchoolId: school.emisSchoolId,
            ...aggregateSchoolRoster(item.rows, {
              jurisdictionId: school.jurisdictionId,
              periodId,
              emisSchoolId: school.emisSchoolId,
              etlRunId: runId,
              asOfDate: rosterAsOf,
              schoolType: schoolTypeOf.get(school.emisSchoolId) ?? null,
            }),
          };
        },
      );
      allFailures.push(...enrolmentCompute.failures);

      const enrolmentRows = enrolmentCompute.computed.flatMap((c) => c.rows);
      const enrolmentScope = enrolmentCompute.computed.map((c) => c.jurisdictionId);
      const enrolment: EnrolmentOutcome = {
        sourceGroups: enrolmentArm.sourceGroups,
        schoolsComputed: enrolmentCompute.computed.length,
        deleted: 0,
        inserted: 0,
        headcount: enrolmentRows
          .filter((r) => r.sex === "ALL" && r.classForm === null)
          .reduce((t, r) => t + r.headcount, 0),
        outOfScopeHeadcount: enrolmentCompute.computed.reduce(
          (t, c) => t + c.outOfScopeHeadcount,
          0,
        ),
        unmappedHeadcount: enrolmentCompute.computed.reduce(
          (t, c) => t + c.unmappedHeadcount,
          0,
        ),
        noRoster: enrolmentArm.noRoster,
        stageDrift: enrolmentCompute.computed
          .filter((c) => c.stageDrift.length > 0)
          .map((c) => ({
            emisSchoolId: c.emisSchoolId,
            schoolType: schoolTypeOf.get(c.emisSchoolId) ?? null,
            stages: c.stageDrift,
          })),
        failures: enrolmentCompute.failures,
      };

      pending.push({
        spec,
        periodId,
        sourceRows: sourceRows.length,
        computed,
        failures,
        noSourceRow,
        enrolmentRows,
        enrolmentScope,
        enrolment,
      });
    }

    // ── step 5a (continued) · THE THIRD ARM: fact_performance_exam, at its OWN EXAM_COHORT periods ──
    //
    // SEPARATE FROM THE ANNUAL LOOP ABOVE, because the grain is: a sitting cohort is not an academic
    // year, and one EXAM_COHORT period carries both exams of one sitting. It runs for EVERY declared
    // cohort — a sitting is CLOSED and IMMUTABLE, so backfilling 2025's BECE is honest in a way that
    // backfilling a past year's roster is not.
    //
    // NOTHING IS WRITTEN HERE either: the rows and each cohort's delete scope are held until the verdict.
    interface PendingCohort {
      outcome: ExamCohortOutcome;
      rows: FactPerformanceExamRow[];
      scope: string[];
    }
    const pendingCohorts: PendingCohort[] = [];
    if (cohortDeclarations.length > 0) {
      const operationalIds = inclusion.schools.map((s) => s.operationalSchoolId);
      // THE SEEDED-PERIOD ASSERTION, BEFORE ANY COMPUTE AND LONG BEFORE ANY WRITE. Every sitting year
      // the SOURCE carries must resolve to a declared/seeded EXAM_COHORT period; an undeclared sitting
      // fails the run here, naming the naming rule, rather than hundreds of rows into step 5c as a raw
      // FK violation — or, worse, vanishing from the dashboard with nothing to point at.
      const sourceYears = await readTerminalExamSittingYears(sql, {
        schemaName: options.sourceSchema,
        operationalSchoolIds: operationalIds,
      });
      await assertExamCohortPeriodsSeeded(sql, sourceYears, examCohortAcademicYear);

      for (const cohort of cohortDeclarations) {
        const academicYear = examCohortAcademicYear(cohort.sittingYear);
        const periodId = periodIndex.get(examCohortPeriodKey(academicYear));
        if (!periodId)
          throw new Error(
            `dim_period has no EXAM_COHORT row for ${academicYear} after the refresh.`,
          );
        // THE COHORT'S FROZEN VINTAGE — the sitting's `ends_on`, falling back to `starts_on`. NEVER
        // `now()`: a sitting is a closed cohort, so a re-run must be byte-identical and provenance must
        // say WHICH sitting rather than when it was last recomputed.
        const asOfDate = cohort.endsOn ?? cohort.startsOn ?? null;
        if (!asOfDate)
          throw new Error(
            `the ${cohort.sittingYear} exam cohort declares neither startsOn nor endsOn, so ` +
              "fact_performance_exam.as_of_date has no vintage to freeze. Declare the sitting window " +
              "in `options.examCohorts` — as_of_date is a timestamptz and must not be now().",
          );

        const { rows: sittings } = await readTerminalExamResults(sql, {
          schemaName: options.sourceSchema,
          sittingYear: cohort.sittingYear,
          operationalSchoolIds: operationalIds,
        });
        const bySchool = new Map<string, TerminalExamSourceRow[]>();
        for (const row of sittings) {
          const held = bySchool.get(row.schoolId);
          if (held) held.push(row);
          else bySchool.set(row.schoolId, [row]);
        }
        // A school that filed NOTHING for this sitting is not a failure and NOT computed, so it is not
        // in the delete scope and keeps its prior rows. A KG or PRIMARY school never presents candidates
        // at all; a JHS that has not keyed its results yet is in a normal, temporary state.
        const noResults = inclusion.schools
          .filter((s) => !bySchool.has(s.operationalSchoolId))
          .map((s) => s.emisSchoolId);

        const items = [...bySchool.entries()].map(([schoolId, rows]) => ({
          schoolId,
          rows,
        }));
        attempted += items.length;

        const compute = computePerSchool<
          (typeof items)[number],
          { jurisdictionId: string; emisSchoolId: string } & ReturnType<
            typeof aggregateSchoolSitting
          >
        >(
          items,
          (item) => ({
            emisSchoolId:
              jurisdictionOf.get(item.schoolId)?.emisSchoolId ?? item.schoolId,
            jurisdictionId: jurisdictionOf.get(item.schoolId)?.jurisdictionId ?? null,
          }),
          (item) => {
            const school = jurisdictionOf.get(item.schoolId);
            if (!school)
              throw new Error(
                `operational school ${item.schoolId} is not in the inclusion set — the exam-results ` +
                  "read is not bounded by the inclusion set.",
              );
            return {
              jurisdictionId: school.jurisdictionId,
              emisSchoolId: school.emisSchoolId,
              ...aggregateSchoolSitting(item.rows, {
                jurisdictionId: school.jurisdictionId,
                periodId,
                emisSchoolId: school.emisSchoolId,
                etlRunId: runId,
                asOfDate,
              }),
            };
          },
        );
        allFailures.push(...compute.failures);

        // ── THE WAEC_EXTRACT ARM — reachable, tested, and EMPTY today (by design) ────────────────
        // `ref_waec_results_extract` has no loader and no feed yet, so this yields zero rows; the path
        // exists so the precedence collapse in the writer is exercised by real code rather than only by
        // a unit test. It writes sex='ALL' ONLY: the extract carries no sex column, and synthesising a
        // split from a total is the one thing it must never do.
        const waec = await readWaecExtractCohort(sql, {
          academicYear,
          emisSchoolIds: inclusion.schools.map((s) => s.emisSchoolId),
        });
        const jurisdictionByEmis = new Map(
          inclusion.schools.map((s) => [s.emisSchoolId, s.jurisdictionId]),
        );
        const waecRows = waecExtractFactRows(waec.rows, {
          periodId,
          etlRunId: runId,
          asOfDate,
          jurisdictionOf: (emis) => jurisdictionByEmis.get(emis),
        });

        const schoolRows = compute.computed.flatMap((c) => c.rows);
        const byExam = EXAMS.map((exam) => ({
          exam,
          candidates: schoolRows
            .filter((r) => r.exam === exam && r.sex === "ALL")
            .reduce((t, r) => t + r.candidates, 0),
          qualified: schoolRows
            .filter((r) => r.exam === exam && r.sex === "ALL")
            .reduce((t, r) => t + r.qualified, 0),
        }));

        pendingCohorts.push({
          // The WAEC rows are appended AFTER the school-entered ones; the collapse in the writer is what
          // resolves the precedence, so the order here is not the authority — but it is deterministic.
          rows: [...schoolRows, ...waecRows],
          // A school the WAEC arm covers is in the delete scope too: its old SCHOOL_ENTERED row must go.
          scope: [
            ...new Set([
              ...compute.computed.map((c) => c.jurisdictionId),
              ...waecRows.map((r) => r.jurisdictionId),
            ]),
          ],
          outcome: {
            sittingYear: cohort.sittingYear,
            academicYear,
            periodType: "EXAM_COHORT",
            periodId,
            asOfDate,
            sourceRows: sittings.length,
            schoolsComputed: compute.computed.length,
            deleted: 0,
            inserted: 0,
            superseded: 0,
            byExam,
            noResults,
            waecRows: waecRows.length,
            failures: compute.failures,
          },
        });
      }
    }

    // ── step 5b · THE VERDICT, over the WHOLE run ───────────────────────────────────────────────
    // Before any write, and over every period's failures together, because the policy is a RATE over
    // the run's attempted schools.
    //
    // ⚠ `attempted` IS POOLED ACROSS BOTH ARMS — census schools plus roster schools — so with two arms
    // the denominator is roughly double what it was for infrastructure alone, and therefore so is the
    // ABSOLUTE number of failed schools the same percentage policy tolerates. That is the shipped
    // behaviour (one run, one verdict), but it means a wholesale enrolment breakage can hide inside the
    // combined rate while every infrastructure school computes fine. PER-ARM BUDGETS are the right
    // shape once a third arm lands — by then the pooled rate will be tolerating three arms' worth of
    // absolute failures and the signal will be too diluted to act on.
    //
    // ⚠ THE THIRD ARM NOW SHARES THAT POOLED DENOMINATOR (task H14), exactly as the note above
    // anticipated: every exam-filing school of every declared cohort is added to `attempted`, so the
    // dilution it warns about is now REAL rather than prospective. The behaviour is kept deliberately
    // unchanged here — one run, one verdict is the shipped contract, and re-cutting the policy into
    // per-arm budgets is a Kofi decision with its own acceptance criteria, not something this slice may
    // decide on its own initiative. What is new is only the size of the dilution: a cohort arm that
    // fails wholesale while the other two are clean can now sit inside the same 1%.
    const verdict = failureVerdict(attempted, allFailures, options.policy);

    // ── step 5c · WRITE — once, one transaction, every period; only on SUCCESS ───────────────────
    // A FAILED verdict writes NOTHING. The prior night's data stays exactly as it was: stale, labelled
    // with its own older as-of, and honest. That is what makes the banner's "latest SUCCESS" read
    // correct rather than merely plausible.
    // ALL THREE fact tables in ONE `sql.begin`, so a throw while writing any arm — including the
    // performance arm's duplicate assertion — rolls the other two back with it. Two transactions would
    // reintroduce the half-published night between the arms that each writer's own transaction rules out
    // within one arm.
    const written =
      verdict.status === "SUCCESS"
        ? ((await sql.begin(async (tx) => {
            const infra = await writeInfrastructureFactsTx(
              tx as unknown as postgres.TransactionSql,
              pending.map((p) => ({ periodId: p.periodId, rows: p.computed })),
            );
            const enrol = await writeEnrolmentFactsTx(
              tx as unknown as postgres.TransactionSql,
              pending.map((p) => ({
                periodId: p.periodId,
                jurisdictionIds: p.enrolmentScope,
                rows: p.enrolmentRows,
              })),
            );
            const exams = await writePerformanceExamFactsTx(
              tx as unknown as postgres.TransactionSql,
              pendingCohorts.map((c) => ({
                periodId: c.outcome.periodId,
                jurisdictionIds: c.scope,
                rows: c.rows,
              })),
            );
            return { infra, enrol, exams };
          })) as unknown as {
            infra: {
              perPeriod: { periodId: string; deleted: number; inserted: number }[];
            };
            enrol: {
              perPeriod: { periodId: string; deleted: number; inserted: number }[];
            };
            exams: {
              perPeriod: {
                periodId: string;
                deleted: number;
                inserted: number;
                superseded: number;
              }[];
            };
          })
        : {
            infra: { perPeriod: [] },
            enrol: { perPeriod: [] },
            exams: { perPeriod: [] },
          };
    const writtenByPeriod = new Map(written.infra.perPeriod.map((p) => [p.periodId, p]));
    const enrolledByPeriod = new Map(written.enrol.perPeriod.map((p) => [p.periodId, p]));
    const examsByPeriod = new Map(written.exams.perPeriod.map((p) => [p.periodId, p]));

    const outcomes: PeriodOutcome[] = pending.map((p) => ({
      academicYear: p.spec.academicYear,
      term: null,
      periodType: "ANNUAL",
      periodId: p.periodId,
      sourceRows: p.sourceRows,
      deleted: writtenByPeriod.get(p.periodId)?.deleted ?? 0,
      inserted: writtenByPeriod.get(p.periodId)?.inserted ?? 0,
      failures: p.failures,
      noSourceRow: p.noSourceRow,
      enrolment: {
        ...p.enrolment,
        deleted: enrolledByPeriod.get(p.periodId)?.deleted ?? 0,
        inserted: enrolledByPeriod.get(p.periodId)?.inserted ?? 0,
      },
    }));

    const cohortOutcomes: ExamCohortOutcome[] = pendingCohorts.map((c) => ({
      ...c.outcome,
      deleted: examsByPeriod.get(c.outcome.periodId)?.deleted ?? 0,
      inserted: examsByPeriod.get(c.outcome.periodId)?.inserted ?? 0,
      superseded: examsByPeriod.get(c.outcome.periodId)?.superseded ?? 0,
    }));

    // ── step 6 · anomaly hook (increment J — a no-op, by name) ──────────────────────────────────
    await runAnomalyHook(sql, runId);

    // ── step 7 · close ──────────────────────────────────────────────────────────────────────────
    // `error_text` is now the VERDICT's text and nothing else. The unmapped-product-line note that
    // used to be appended here — "the SHS estate is absent and here is why" — has no referent at the
    // ANNUAL grain: every product line is consumed, so a clean run has nothing to confess and
    // `error_text` is null. A SENIOR estate going missing would now be a FAILURE, not a footnote.
    const errorText = verdict.errorText;
    await closeEtlRun(sql, runId, verdict.status, errorText);
    return {
      runId,
      status: verdict.status,
      errorText,
      registerRows: registerRows.length,
      coverage: inclusion.coverage,
      periods: outcomes,
      examCohorts: cohortOutcomes,
    };
  } catch (err) {
    // A FAILED run leaves the prior night's data in place. Two mechanisms, both needed: the whole
    // run's delete-then-insert is ONE transaction (so a throw during the write rolls the deletes back
    // too), and the write does not happen at all unless the verdict is SUCCESS (step 5c).
    const message = err instanceof Error ? err.message : String(err);
    await closeEtlRun(sql, runId, "FAILED", message);
    throw err;
  }
}
