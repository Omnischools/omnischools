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
import {
  aggregateSchoolAttendance,
  writeAttendanceFactsTx,
  type FactAttendanceRow,
} from "./attendance";
import {
  countMarksOutsideDeclaredTerms,
  readAttendanceMarkGroups,
  type AttendanceMarkGroupRow,
} from "./attendance-source";
import { aggregateSchoolFees, ghsOf, writeFeesFactsTx, type FactFeesRow } from "./fees";
import {
  deriveSchoolStaffing,
  readCurrentEstablishment,
  writeStaffingFactsTx,
  type FactStaffingRow,
} from "./staffing";
import {
  countInvoicesWithoutPeriod,
  readFeeLineGroups,
  type FeeLineGroupRow,
} from "./fees-source";
import {
  buildSchoolPlcRows,
  // The CPD points totals are carried as exact integer HUNDREDTHS and formatted ONCE, by the arm's own
  // helper, so a report figure and a stored figure cannot disagree by a float rounding.
  pointsOf as plcPointsOf,
  writePlcFactsTx,
  type PlcTermInput,
  type PlcWriteBatch,
} from "./plc";
import {
  readPlcAnnualPoints,
  readPlcGroups,
  readPlcProgrammes,
  readPlcSchoolMemberCounts,
  readPlcSessionAggregates,
  type PlcAnnualPointsRow,
  type PlcGroupRow,
  type PlcProgrammeRow,
  type PlcSessionAggregateRow,
} from "./plc-source";
import { readNtcCpdSummaries, type NtcCpdSourceResult } from "./ntc-cpd-source";
import type { OvFeeCategory } from "./fee-category";
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
 * computes and writes ALL FOUR arms — `fact_infrastructure`, `fact_enrolment`, `fact_performance_exam`
 * AND `fact_attendance` — under ONE verdict and in ONE transaction (see the FOUR FACTS, ONE RUN note
 * below).
 *
 *   1  open the `etl_run` row (RUNNING)
 *   2  refresh dimensions — `dim_jurisdiction` spine + `dim_period` (the TERM rows, which `fact_attendance`
 *      is written at; the ANNUAL cut of each academic year, which the first two arms are written at; and
 *      one EXAM_COHORT row per declared sitting), then ASSERT the spine
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
 * ⚠ SEVEN FACTS, ONE RUN (increment L, the CPD/PLC slice). `fact_plc_participation` is the SEVENTH
 * ARM, and it is the first arm that writes at **TWO PERIOD CUTS IN ONE PASS** — a TERM participation
 * row set and an ANNUAL CPD row set, on different `period_id`s. It sits INSIDE the ANNUAL period loop,
 * immediately AFTER the staffing arm, under the SAME current-academic-year guard, and it consumes the
 * staffing arm's own in-memory rows. Everything structural about it follows from that and from Kofi's
 * `CPD-SURFACING-RULING.md`:
 *   · `teacher_headcount` IS PINNED STRUCTURALLY TO `fact_staffing.teachers_on_roll`, on BOTH cuts —
 *     the schema's ETL CONTRACT, and the second-order version of the pin staffing itself takes on
 *     enrolment. PLC coverage and the CPD-target rate therefore divide the SAME roll that PTR and the
 *     vacancy figures divide, rather than counting a quietly different set of people. A THIRD source
 *     read for a teacher count would have turned the pin back into a reconciliation problem.
 *   · IT CANNOT RUN FOR A YEAR THE STAFFING ARM SKIPPED — its denominator would not exist. On a
 *     non-current year it is a clean no-op: zero rows, EMPTY delete scope, nothing added to
 *     `attempted`, so that year keeps whatever it had. THE TERM ROWS USE THE SAME YEAR'S ROLL as the
 *     annual row, so the two sub-panels of the CPD surface cannot disagree about the staff count.
 *   · A SCHOOL WHOSE RECONCILED ROLL IS 0 PRODUCES NO STAFFING ROW AND THEREFORE NO PLC ROWS, and is
 *     out of the delete scope. A headcount of 0 is not a denominator.
 *   · ⚠ A SCHOOL THAT RUNS NO PLC *IS* COMPUTED AND DOES WRITE ROWS, with
 *     `schools_running_plc_count = 0`. That is the opposite of the "no source row → not computed"
 *     rule every other arm follows, and it is forced by the metric: the count is the NUMERATOR of
 *     "N of Y schools run a PLC" and the Y is the number of ROWS, so suppressing PLC-less schools
 *     would make every tier report 100% coverage.
 *   · ⚠ THE NTC HALF OF THE ANNUAL ROW COMES FROM A SEPARATE, SWAPPABLE SOURCE (`ntcSourceSchema` →
 *     `lib/etl/ntc-cpd-source.ts`), and when that source is ABSENT the category / threshold columns
 *     stay NULL — never 0. The fact builder invents nothing. ONE CODE PATH, TWO DATA STATES.
 *   · IT IS REPORTED UNDER `PeriodOutcome.plc`, with its TERM cut as a LIST inside that outcome —
 *     the attendance arm's `terms` shape nested under the staffing arm's `PeriodOutcome` slot,
 *     because the arm genuinely has both grains and one verdict.
 *
 * ⚠ SIX FACTS, ONE RUN (increment I, the staffing/PTR slice). `fact_staffing` is the SIXTH ARM, and it
 * is the FIRST ARM WITH NO SOURCE READ OF ITS OWN. It sits INSIDE the ANNUAL period loop, immediately
 * after the enrolment arm, under the SAME current-academic-year guard, and its input is the enrolment
 * arm's own in-memory `FactEnrolmentRow[]` — not a second source. Everything structural about it
 * follows from that and from Kofi's `STAFFING-PTR-DOMAIN-RULING.md`:
 *   · THE PTR DENOMINATOR IS PINNED STRUCTURALLY, NOT RECONCILED. `enrolment_total` is
 *     Σ headcount WHERE sex='ALL' AND class_form IS NULL over the rows this same transaction is about
 *     to write, so there is ONE number rather than two numbers and a hope. A separate source read
 *     (plan §2.2 Option B) would have turned the pin back into a reconciliation problem plus a test.
 *   · IT CANNOT RUN FOR A YEAR THE ENROLMENT ARM SKIPPED — its denominator would not exist. On a
 *     non-current year it is a clean no-op: zero rows, EMPTY delete scope, nothing added to
 *     `attempted`, so that year keeps whatever it had (stale-but-honest).
 *   · A SCHOOL WHOSE RECONCILED ROLL IS 0 EMITS NO ROW and is OUT of the delete scope (ruling §5):
 *     there is no ratio to compute, and a stored `0.00` ptr would be a false measurement.
 *   · IT IS A STOCK AT ANNUAL GRAIN, so it fits `PeriodOutcome` directly (unlike the term/cohort arms)
 *     and is reported as `PeriodOutcome.staffing`. NEVER sum `teachers_on_roll` across periods.
 *   · NO NATIONAL `ptr` IS REPORTED ANYWHERE on the run report, deliberately: a run-level PTR field
 *     would be an invitation to average. Any PTR above one school is Σ enrolment_total ÷ Σ
 *     teachers_on_roll (ruling §6), so the outcome carries the two SUMMABLE INPUTS and no rate.
 *
 * ⚠ FIVE FACTS, ONE RUN (increment H fifth slice, task H11). `fact_fees` is the FIFTH ARM, threaded
 * exactly as the fourth was — a SELF-CONTAINED PER-TERM LOOP, computed in 5a under `computePerSchool`, its
 * failures tallied into the SAME run-wide verdict, its rows written in the SAME `sql.begin` in 5c with its
 * own per-term delete scope, and reported under `EtlRunReport.feeTerms` (a TERM outcome does not fit
 * `PeriodOutcome`, which is ANNUAL by construction). What is NOT like any earlier arm is its MEASURE
 * SHAPE, and every structural difference follows from it:
 *   · IT IS THE FIRST **NON-ADDITIVE** TABLE, IN BOTH TIME AND SPACE. `fact_fees` stores `mean_amount`
 *     and `median_amount` and no summable column at all, so there is NO roll-up: a district fee figure is
 *     neither the sum nor the average of its schools' rows, and a year's figure is not a combination of
 *     its terms'. The H19 roll-up harness must EXCLUDE this table (see `lib/etl/fees.ts`).
 *   · IT WRITES A `stage IS NULL` ALL-STAGES ROW — the MIRROR-IMAGE of the attendance arm, which writes
 *     none. Attendance's stages Σ-reconstruct the whole; fees' do not reconstruct it at all, so the
 *     whole-school figure must be materialised from the POOLED per-student distribution or it does not
 *     exist.
 *   · ITS PERIOD COMES FROM THE INVOICE, NOT FROM A DATE ON THE ROW. An invoice carries `period_id` →
 *     operational `academic_period`, and the TERM is resolved from that period's `academic_year` plus its
 *     own `starts_on` (never `period_number`, which means a term on BASIC and a semester on SENIOR — the
 *     Q3 problem). `period_id IS NULL` invoices are TALLIED, not dropped
 *     (`EtlRunReport.feesNullPeriodInvoices`).
 *   · ZERO IS A MEASUREMENT AND ABSENCE IS NOT: a billed-0 tuition row is the FREE SHS signal and is
 *     WRITTEN, while a category nobody billed produces no row. That is the opposite of attendance's
 *     zero-denominator suppression — see `lib/etl/fees.ts`.
 *
 * ⚠ FOUR FACTS, ONE RUN (increment H fourth slice, task H10). `fact_attendance` is the FOURTH ARM,
 * threaded exactly as the second and third were: computed in 5a under `computePerSchool`, its failures
 * tallied into the SAME run-wide verdict, its rows written in the SAME `sql.begin` in 5c, with its own
 * explicit per-term delete scope. What is NOT like any earlier arm is its TIME SHAPE, and every structural
 * difference follows from it:
 *   · IT IS THE FIRST GENUINE **FLOW**, AND IT IS **TERM**-GRAINED. `present_days` / `enrolled_days` are
 *     pupil-days accumulated over a window, so they are additive across TIME as well as across schools.
 *     The arm therefore runs ONCE PER DECLARED TERM — not current-year-only (the enrolment rule, which
 *     exists because a roster has no period) and not per-cohort (the performance rule) — and files against
 *     `period_type = 'TERM'`, the rows `refreshPeriods` has always upserted and no fact table used until
 *     now. There is deliberately NO ANNUAL attendance row: the year's figure is Σ term present ÷ Σ term
 *     enrolled, a reader-side sum, because a materialised annual row would be a second copy of a figure
 *     the term rows already determine (see `lib/etl/attendance.ts`).
 *   · ITS WINDOW IS THE TERM'S OWN DATES. Each mark is assigned to the declared TERM whose
 *     [starts_on, ends_on] contains its civil date, so a TERM spec with no dates CANNOT be aggregated and
 *     the run refuses it by name rather than filing a term from an empty window.
 *   · MARKS NO DECLARED TERM CLAIMS ARE TALLIED, NOT DROPPED — `attendanceOutOfWindowMarks` on the report.
 *   · A SCHOOL WITH NO MARKS IN A TERM IS NOT COMPUTED for that term, so it is not in that term's delete
 *     scope and keeps its prior rows. That is NOT the same as a school whose marks are ALL ABSENT, which is
 *     computed and produces real rows with a 0.00 rate.
 * Because it runs per TERM rather than per academic year, it is reported under `EtlRunReport.terms` rather
 * than squeezed into `PeriodOutcome` (which is ANNUAL by construction).
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
  /**
   * THE NTC CPD SEAM (increment L, Kofi's C2) — where `fact_plc_participation`'s NTC columns come
   * from. A SEPARATE option from `sourceSchema`, because it names a THIRD PARTY'S system rather than
   * Omnischools' own operational Postgres, and the two swap independently.
   *
   *   omitted / `"demo_ntc_source"`  the demo stand-in (`db/seed/demo/demo-source-schema.sql`).
   *   `"public"`                     a live NTC-portal / authoritative-extract connection.
   *   any schema with no
   *   `ntc_cpd_summary` table        ⚠ THE SOURCING GATE STAYS CLOSED: the reader returns nothing
   *                                  (it asks the catalog, it does not throw), and the category /
   *                                  threshold columns stay **NULL — never 0**. This is the state the
   *                                  real product is in today, and it is a NORMAL run, not a failure.
   *
   * Nothing else in the pipeline, the fact builder or any dashboard changes when the real feed lands.
   */
  ntcSourceSchema?: string;
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

/**
 * What the staffing arm produced for one period, as the run reports it. See `PeriodOutcome.staffing`.
 *
 * ALL ZEROES AND EMPTY LISTS on a NON-CURRENT academic year: the arm did not run there, by design (it
 * has no denominator outside the year the enrolment arm ran for). Zero `schoolsComputed` is therefore
 * also an empty delete scope, so that year's existing rows are left exactly as they were.
 *
 * ⚠ THERE IS NO `ptr` FIELD HERE, AND THAT IS THE RULING MADE PHYSICAL (Kofi §6). `teachersOnRoll` and
 * `enrolmentTotal` are the two SUMMABLE INPUTS and are reported as counts; a national PTR is
 * `enrolmentTotal / teachersOnRoll`, computed at the point of display from those two. A stored
 * national `ptr` field on this outcome would be an invitation for the next reader to average the
 * schools' stored rates instead, which weights a 40-pupil school equally with a 1,200-pupil one.
 */
export interface StaffingOutcome {
  /** Schools that produced A ROW — the DELETE SCOPE. Zero-roll schools are NOT in it (ruling §5). */
  schoolsComputed: number;
  deleted: number;
  inserted: number;
  /** Σ `teachers_on_roll` over the written rows. A count of POSTS FILLED, never a teacher. */
  teachersOnRoll: number;
  /** Σ `enrolment_total` — the pinned roll, identical to the enrolment arm's `headcount`. */
  enrolmentTotal: number;
  /**
   * Σ `teaching_posts_established` and Σ `vacancies`, over the PUBLIC schools only — the rows where
   * the establishment is NOT NULL (ruling §6). `postsEstablishedSchools` is that sum's denominator and
   * is reported beside it so a reader can state it; mixing a NULL establishment into the sum would
   * understate the district establishment and silently widen the vacancy base.
   */
  postsEstablished: number;
  /** SIGNED (ruling §4): a national surplus and a national shortage can cancel, and should be able to. */
  vacancies: number;
  postsEstablishedSchools: number;
  /**
   * Included, rostered schools whose RECONCILED roll came to 0 — all-nursery or wholly-unmapped
   * classes. NOT a failure, NO row, and NOT in the delete scope: they keep whatever they had. Listed
   * rather than inferred from a subtraction, because "no PTR" and "a PTR of 0.00" are different claims.
   */
  noEnrolment: string[];
  failures: SchoolFailure[];
}

/**
 * What the PLC/CPD arm produced for one TERM of the academic year. One entry per declared term.
 *
 * ⚠ NO RATE IS REPORTED HERE, ONLY ITS TWO INPUTS, and that is the C12 roll-up rule made physical: a
 * national participation rate is Σ attendance_events ÷ Σ attendance_expected, computed at the point of
 * display from the two summable counts. A `participationRate` field on this outcome would be an
 * invitation for the next reader to average the schools' stored rates instead, which weights a
 * 4-teacher school equally with a 60-teacher one.
 *
 * ⚠ THE COUNTS ARE `sex = 'ALL'` TOTALS. The sexed split lives in the fact rows, where it belongs; a
 * pooled report figure that mixed the ALL row with the split would be exactly 2× the truth.
 */
export interface PlcTermOutcome {
  academicYear: string;
  /** 1 | 2 | 3 — the TERM cut is always numbered. */
  term: number;
  /** ALWAYS "TERM". Stated so a reader never re-derives it from `term`. */
  periodType: "TERM";
  periodId: string;
  startsOn: string;
  endsOn: string;
  deleted: number;
  inserted: number;
  /** ⚠ SEX-INVARIANT: Σ over schools of a per-school count, read at sex='ALL'. Never the split sum. */
  schoolsRunningPlc: number;
  sessionsHeld: number;
  /** Σ over the schools that HAVE a configured cadence. Its own denominator, stated not implied. */
  sessionsExpected: number;
  /** Schools whose `sessions_expected` is NULL (no programme row) — `sessionsExpected`'s exclusions. */
  schoolsWithoutCadence: number;
  attendanceEvents: number;
  attendanceExpected: number;
  teachersInPlc: number;
  /** Σ `teacher_headcount` — the PINNED roll, identical to the staffing arm's `teachersOnRoll`. */
  teacherHeadcount: number;
  /** Sessions belonging to an ARCHIVED PLC. In NO fact column, and never silently dropped. */
  orphanSessions: number;
}

/**
 * What the PLC/CPD arm produced at the ANNUAL cut, as the run reports it.
 *
 * ⚠ THE TWO PROVENANCE HALVES ARE REPORTED APART AND ARE NEVER POOLED INTO ONE "CPD POINTS" FIGURE.
 * `plcPoints` is GENUINELY OBSERVED (the operational ledger); `cpdPointsTotal` is the all-category
 * figure, which in the demo state is NTC-stand-in-augmented. A single pooled number would make the
 * synthetic half indistinguishable from the measured half in the one artefact an operator reads at
 * 3am — which is the exact misread the ruling's per-figure DEMO marking exists to prevent.
 */
export interface PlcAnnualOutcome {
  periodId: string;
  /** ALWAYS "ANNUAL". */
  periodType: "ANNUAL";
  deleted: number;
  inserted: number;
  schoolsRunningPlc: number;
  teacherHeadcount: number;
  /** Σ the OBSERVED PLC-earned points, as a numeric(_,2) GHS-style string. Real shape, demo volume. */
  plcPoints: string;
  /** Σ `cpd_points_total`: all-category in the demo state, the PLC-only subtotal when NTC is absent. */
  cpdPointsTotal: string;
  /** Σ `teachers_meeting_cpd_threshold` over the schools where it is NOT NULL. NULL if nowhere. */
  teachersMeetingCpdThreshold: number | null;
  /** That sum's own denominator: the schools whose NTC columns were populated FROM the seam. */
  ntcSourcedSchools: number;
}

/**
 * What the SEVENTH arm produced for one academic year. See `PeriodOutcome.plc`.
 *
 * ALL ZEROES AND EMPTY LISTS on a NON-CURRENT academic year: the arm did not run there, by design (it
 * has no pinned roll outside the year the staffing arm ran for). Zero `schoolsComputed` is therefore
 * also an empty delete scope — at BOTH cuts — so that year keeps exactly what it had.
 */
export interface PlcOutcome {
  /** Schools that produced ROWS — the DELETE SCOPE at every one of this arm's periods. */
  schoolsComputed: number;
  /** THE NTC SOURCING STATE, resolved ONCE for the run and reported in one place (ruling C5). */
  ntcProvenance: "DEMO" | "ABSENT";
  annual: PlcAnnualOutcome;
  /** The TERM cut — one entry per declared term of this academic year. */
  terms: PlcTermOutcome[];
  /**
   * Computed schools that run NO active PLC. NOT a failure and NOT an exclusion: they are computed and
   * DO write rows, with `schools_running_plc_count = 0`, because that count's denominator is the row
   * count. Listed so "N of Y" is checkable against the report.
   */
  noPlc: string[];
  /**
   * NTC-sourced teacher counts that had to be CLAMPED to this warehouse's own roll — NTC counts
   * against its own roll of licensed teachers, which is not the roll derived here. Reported rather
   * than absorbed, so a systematic mismatch between the two rolls is visible. See `clampToRoll`.
   */
  ntcCountsClamped: number;
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
  /** The SIXTH arm, at the SAME ANNUAL period and pinned to `enrolment`. See `StaffingOutcome`. */
  staffing: StaffingOutcome;
  /**
   * The SEVENTH arm, pinned to `staffing` — at the SAME ANNUAL period AND at this year's TERM
   * periods, which is why its outcome carries a `terms` list of its own. See `PlcOutcome`.
   */
  plc: PlcOutcome;
}

/**
 * What the attendance arm produced for ONE DECLARED TERM. One of these per TERM spec in the run.
 *
 * ⚠ `presentDays` / `enrolledDays` ARE REPORTED PER TERM AND NEVER POOLED INTO ONE PAIR HERE, even though
 * (unlike every earlier arm) pooling them across terms would be ARITHMETICALLY VALID — attendance is a
 * FLOW. They are kept apart because the reader has to see WHICH window each figure belongs to: a term with
 * one week of marking and a term with thirteen produce wildly different pupil-day counts, and a single
 * pooled pair invites a pooled rate presented as "the year" when a term is missing from it.
 */
export interface TermAttendanceOutcome {
  academicYear: string;
  /** 1 | 2 | 3 — a TERM outcome is always numbered. Never null (that would be the ANNUAL cut). */
  term: number;
  /** ALWAYS "TERM". Stated so a reader never re-derives it from `term`. */
  periodType: "TERM";
  periodId: string;
  /** The term's civil-date window — the window every mark was assigned by. */
  startsOn: string;
  endsOn: string;
  /** Grouped mark slices read from the source — counts of pupil-days, never pupils. */
  sourceGroups: number;
  /** Schools whose marks were aggregated (including to ZERO rows) — the DELETE scope for this term. */
  schoolsComputed: number;
  deleted: number;
  inserted: number;
  /** Σ `present_days` over the class_form IS NULL stage totals, nationally, for this term. */
  presentDays: number;
  /** Σ `enrolled_days` over the same rows. The rate is Σpresent ÷ Σenrolled — NEVER an average of rates. */
  enrolledDays: number;
  /** Marks in a below-KG class. In NO stage row, and never silently dropped. */
  outOfScopeMarks: number;
  /** Marks whose class label resolved to no stage. In NO stage row, never dropped. */
  unmappedMarks: number;
  /**
   * Included schools that marked NO register at all inside this term's window. NOT a failure, NOT computed
   * and NOT in the delete scope: they keep whatever they had (stale-but-honest). DISTINCT from a school
   * whose marks were all ABSENT, which is computed and gets real rows with a 0.00 rate.
   */
  noMarks: string[];
  failures: SchoolFailure[];
}

/**
 * ONE SCHOOL'S FEE TALLIES for one term — the degradation-visibility signals, PER SCHOOL so a bad figure
 * is attributable to the school that produced it rather than only to the country.
 *
 * All three money figures are GHS strings (numeric(10,2) shaped), never floats: they come from exact
 * integer pesewas (see `lib/etl/fees-source.ts`) and a float would make a published national figure
 * depend on binary rounding.
 */
export interface SchoolFeeTally {
  emisSchoolId: string;
  /** Billed GHS published under OTHER — the pure resolver's own coverage signal. */
  otherBilled: string;
  /** DISTINCT `fee_category.name` values that resolved to OTHER. A count, never the names. */
  otherCategoryNames: number;
  /** Billed GHS whose invoiced pupil is in a below-KG class. In NO row, never dropped. */
  outOfScopeBilled: string;
  /** Billed GHS whose invoiced pupil's class label resolved to no stage. In NO row, never dropped. */
  unmappedStageBilled: string;
}

/**
 * What the fees arm produced for ONE DECLARED TERM. One of these per TERM spec in the run.
 *
 * ⚠ THERE IS NO NATIONAL MEAN ON THIS OUTCOME, AND THAT IS THE RULING MADE PHYSICAL. Every other arm
 * reports a pooled figure beside its per-period rows; this one reports only COUNTS and the TALLIES,
 * because a national mean fee cannot be computed from school means (and a national median cannot be
 * computed from school medians at all). Publishing one here would be the exact mistake the table's
 * non-additivity exists to prevent — so the field simply does not exist.
 */
export interface TermFeesOutcome {
  academicYear: string;
  /** 1 | 2 | 3 — a TERM outcome is always numbered. Never null (that would be the ANNUAL cut). */
  term: number;
  /** ALWAYS "TERM". Stated so a reader never re-derives it from `term`. */
  periodType: "TERM";
  periodId: string;
  /** The term's civil-date window — the window each invoice's operational period was assigned by. */
  startsOn: string;
  endsOn: string;
  /** Grouped billed-line slices read from the source — (pupil × label × dues × class) keys, never lines. */
  sourceGroups: number;
  /** Schools whose invoices were aggregated (including to ZERO rows) — the DELETE scope for this term. */
  schoolsComputed: number;
  deleted: number;
  inserted: number;
  /** Distinct pupils who reached a row, nationally. The measures' denominator — NOT a published figure. */
  billedStudents: number;
  /** The categories written anywhere in this term. */
  categories: OvFeeCategory[];
  /** Run-wide sums of the per-school tallies below. Money, so GHS strings. */
  otherBilled: string;
  /** DISTINCT unmapped category names across the WHOLE term (a union, not a sum of per-school counts). */
  otherCategoryNames: number;
  outOfScopeBilled: string;
  unmappedStageBilled: string;
  /** The same four tallies, PER SCHOOL. Only schools with something to report appear. */
  perSchool: SchoolFeeTally[];
  /**
   * Included schools that issued NO billed invoice at all in this term. NOT a failure, NOT computed and
   * NOT in the delete scope: they keep whatever they had (stale-but-honest). DISTINCT from a school that
   * billed ZERO, which is computed and gets real 0.00 rows (the Free SHS signal).
   */
  noInvoices: string[];
  failures: SchoolFailure[];
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
  /** The FOURTH arm, at its OWN TERM periods — one entry per declared term. */
  terms: TermAttendanceOutcome[];
  /**
   * Marks whose civil date falls inside NO declared term window — holiday marking, a mis-keyed date, or a
   * term the run forgot to declare. They reach no fact row, and they are COUNTED rather than dropped: the
   * third case is a real gap in the published figures and is otherwise completely invisible.
   */
  attendanceOutOfWindowMarks: number;
  /** The FIFTH arm, at its OWN TERM periods — one entry per declared term. */
  feeTerms: TermFeesOutcome[];
  /**
   * BILLED invoices carrying NO `period_id` — a real operational state (`invoice.period_id` is nullable)
   * and one that reaches no fact row, because `fact_fees` is TERM-grained and there is no term to file
   * them against. They are COUNTED rather than dropped, per school AND run-wide: a school that stopped
   * filling in the term on its invoices would otherwise publish a shrinking fee book and look like a
   * school that stopped charging. Period-INDEPENDENT, so it is one figure for the run rather than one
   * per term.
   */
  feesNullPeriodInvoices: {
    total: number;
    bySchool: { emisSchoolId: string; invoices: number }[];
  };
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
      /** The staffing arm's rows and its delete scope, held unwritten until the verdict. */
      staffingRows: FactStaffingRow[];
      staffingScope: string[];
      staffing: StaffingOutcome;
      /**
       * The PLC arm's write batches — ONE PER PERIOD, because this arm spans two cuts: the year's
       * ANNUAL period and each of its declared TERM periods, each with its OWN (identical) delete
       * scope. Held unwritten until the verdict, like every other arm's rows.
       */
      plcBatches: PlcWriteBatch[];
      plc: PlcOutcome;
    }
    const schoolTypeOf = new Map(registerRows.map((r) => [r.emisSchoolId, r.schoolType]));
    // The staffing arm's gradient drivers and its ownership rule come from the REGISTER, which is the
    // only statement of a school's region/district/ownership the ETL has. `ownership_type` is
    // load-bearing rather than descriptive: PRIVATE and MISSION schools are not on the GES payroll
    // establishment, so they get a NULL `teaching_posts_established` (Kofi §4).
    const registerByEmis = new Map(registerRows.map((r) => [r.emisSchoolId, r]));
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

    // ── the STAFFING arm's ONE reference read — the GES establishment's current vintage ──────────
    //
    // Read ONCE for the whole run, not per school and not per year: `ref_ges_teacher_establishment` is
    // reference data keyed by EMIS id with one vintage per `as_of_date`, and the current vintage is the
    // MAX. Where a school has one, the REAL loaded figure is preferred over a generated establishment
    // (Kofi §4) — free fidelity, no new object, no new grant. An EMPTY table is the normal demo state
    // (nothing is loaded until `pnpm db:load-establishment` runs) and is not an error: the generated
    // branch is then the one the demo exercises. It is hoisted above the loop because the establishment
    // is a property of the SCHOOL, not of the academic year.
    const establishmentByEmis = await readCurrentEstablishment(
      sql,
      inclusion.schools.map((s) => s.emisSchoolId),
    );

    // ── the PLC/CPD arm's SOURCE READS — HOISTED, and for ONE year only ──────────────────────────
    //
    // The arm runs for the CURRENT ACADEMIC YEAR ONLY, because `teacher_headcount` is PINNED to the
    // staffing arm's `teachers_on_roll` and the staffing arm only runs there (which in turn is because
    // the roster carries no period — see the enrolment note above). So the reads are issued ONCE,
    // against that year's windows, rather than per year inside the loop.
    //
    // FOUR READS, SPLIT BY WHAT THEY DEPEND ON (see `lib/etl/plc-source.ts`):
    //   programmes / groups / member counts   window-INDEPENDENT — a cadence is a configuration and
    //                                         membership is an open row with no period. Read once for
    //                                         the whole country.
    //   session aggregates                    WINDOWED, once PER DECLARED TERM — the TERM cut.
    //   annual points                         WINDOWED on the academic year — the ANNUAL cut.
    // And one more, through a DIFFERENT SEAM entirely: the NTC extract (`ntcSourceSchema`), which is a
    // third party's system and is read once for the year. Its ABSENCE is a normal outcome.
    //
    // NO current annual spec SKIPS THE ARM CLEANLY (zero rows, zero delete scope, nothing attempted),
    // exactly as it skips the enrolment and staffing arms.
    /** ONE declared term of the current year, with every school's session aggregates for it. */
    interface PendingPlcTerm {
      spec: PeriodSpec;
      periodId: string;
      term: number;
      startsOn: string;
      endsOn: string;
      /** operational school id → that school's per-PLC aggregates in this window. */
      sessions: Map<string, PlcSessionAggregateRow[]>;
    }
    interface PlcArm {
      spec: PeriodSpec;
      /** The ANNUAL period's own close — the `as_of_date` fallback for a school that earned nothing. */
      annualEndsOn: string;
      programmes: Map<string, PlcProgrammeRow>;
      groups: Map<string, PlcGroupRow[]>;
      members: Map<string, number>;
      points: Map<string, PlcAnnualPointsRow>;
      terms: PendingPlcTerm[];
      ntc: NtcCpdSourceResult;
    }
    const plcSpec = enrolmentSpec;
    let plcArm: PlcArm | null = null;
    if (plcSpec) {
      // BOTH dates are required, for the attendance arm's reason applied to a different source: the
      // ANNUAL points read is a civil-date WINDOW over `plc_session.session_date` (never the
      // operational `academic_period_id` — the Q3 problem), so a year with no window would claim no
      // session, publish an empty CPD cut and leave it stale under a SUCCESS banner.
      if (!plcSpec.startsOn || !plcSpec.endsOn)
        throw new Error(
          `the current academic year ${plcSpec.academicYear} declares ` +
            `${plcSpec.startsOn ? "no ends_on" : plcSpec.endsOn ? "no starts_on" : "neither starts_on nor ends_on"}` +
            ", so fact_plc_participation has no window to aggregate the PLC ledger over. A PLC " +
            "session belongs to the TERM containing its civil `session_date`, so declare the terms' " +
            "dates in `options.periods`.",
        );
      const operationalIds = inclusion.schools.map((s) => s.operationalSchoolId);
      const plcQuery = { schemaName: options.sourceSchema, operationalSchoolIds: operationalIds };
      const programmes = await readPlcProgrammes(sql, plcQuery);
      const groups = await readPlcGroups(sql, plcQuery);
      const members = await readPlcSchoolMemberCounts(sql, plcQuery);
      const points = await readPlcAnnualPoints(sql, {
        ...plcQuery,
        startsOn: plcSpec.startsOn,
        endsOn: plcSpec.endsOn,
      });
      const groupsBySchool = new Map<string, PlcGroupRow[]>();
      for (const group of groups) {
        const held = groupsBySchool.get(group.schoolId);
        if (held) held.push(group);
        else groupsBySchool.set(group.schoolId, [group]);
      }
      // THE TERM CUT — one windowed read per declared term OF THIS YEAR. A term of another year is not
      // read at all: its rows would need that year's roll, which does not exist.
      const plcTerms: PendingPlcTerm[] = [];
      for (const spec of options.periods) {
        if (spec.term === null || spec.periodType === "EXAM_COHORT") continue;
        if (spec.academicYear !== plcSpec.academicYear) continue;
        const termPeriodId = periodIndex.get(periodKey(spec.academicYear, spec.term));
        if (!termPeriodId)
          throw new Error(
            `dim_period has no TERM row for ${spec.academicYear} term ${String(spec.term)} after ` +
              "the refresh.",
          );
        if (!spec.startsOn || !spec.endsOn)
          throw new Error(
            `the ${spec.academicYear} term ${String(spec.term)} declares no window, so ` +
              "fact_plc_participation's TERM cut has no dates to assign PLC sessions to. A session " +
              "belongs to the term containing its civil `session_date`.",
          );
        const sessions = await readPlcSessionAggregates(sql, {
          ...plcQuery,
          startsOn: spec.startsOn,
          endsOn: spec.endsOn,
        });
        const bySchool = new Map<string, PlcSessionAggregateRow[]>();
        for (const row of sessions) {
          const held = bySchool.get(row.schoolId);
          if (held) held.push(row);
          else bySchool.set(row.schoolId, [row]);
        }
        plcTerms.push({
          spec,
          periodId: termPeriodId,
          term: spec.term,
          startsOn: spec.startsOn,
          endsOn: spec.endsOn,
          sessions: bySchool,
        });
      }
      // ⚠ THE NTC SEAM. Read through `lib/etl/ntc-cpd-source.ts`, keyed by EMIS code (NTC has never
      // heard of an Omnischools tenant uuid), and ABSENT is a NORMAL result rather than an error —
      // which is what keeps "the NTC feed is not connected" from taking six other arms down nightly.
      const ntc = await readNtcCpdSummaries(sql, {
        schemaName: options.ntcSourceSchema ?? "demo_ntc_source",
        academicYear: plcSpec.academicYear,
        emisSchoolIds: inclusion.schools.map((s) => s.emisSchoolId),
      });
      plcArm = {
        spec: plcSpec,
        annualEndsOn: plcSpec.endsOn,
        programmes: new Map(programmes.map((p) => [p.schoolId, p])),
        groups: groupsBySchool,
        members: new Map(members.map((m) => [m.schoolId, m.distinctMembers])),
        points: new Map(points.map((p) => [p.schoolId, p])),
        terms: plcTerms,
        ntc,
      };
    }
    /** EMIS id → operational tenant uuid. The PLC arm's inputs are keyed operationally; its PIN is not. */
    const operationalByEmis = new Map(
      inclusion.schools.map((s) => [s.emisSchoolId, s.operationalSchoolId]),
    );

    /** The arm did not run for this year. Zero everything — and an EMPTY delete scope at BOTH cuts. */
    const noPlcOutcome = (annualPeriodId: string): PlcOutcome => ({
      schoolsComputed: 0,
      ntcProvenance: "ABSENT",
      annual: {
        periodId: annualPeriodId,
        periodType: "ANNUAL",
        deleted: 0,
        inserted: 0,
        schoolsRunningPlc: 0,
        teacherHeadcount: 0,
        plcPoints: "0.00",
        cpdPointsTotal: "0.00",
        teachersMeetingCpdThreshold: null,
        ntcSourcedSchools: 0,
      },
      terms: [],
      noPlc: [],
      ntcCountsClamped: 0,
      failures: [],
    });

    /** The arm did not run for this year. Zero everything — and an EMPTY delete scope. */
    const noStaffing = (): StaffingOutcome => ({
      schoolsComputed: 0,
      deleted: 0,
      inserted: 0,
      teachersOnRoll: 0,
      enrolmentTotal: 0,
      postsEstablished: 0,
      vacancies: 0,
      postsEstablishedSchools: 0,
      noEnrolment: [],
      failures: [],
    });

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
          // THE SIXTH ARM IS SKIPPED HERE TOO, AND IT HAS NO CHOICE: its `enrolment_total` is the
          // enrolment arm's own figure, so a year with no enrolment rows has no PTR denominator to pin
          // to. Inventing one from a past census would publish tonight's teachers against a year whose
          // roll nobody measured. Zero rows, EMPTY delete scope, nothing attempted — that year keeps
          // whatever staffing it had.
          staffingRows: [],
          staffingScope: [],
          staffing: noStaffing(),
          // THE SEVENTH ARM IS SKIPPED HERE TOO, AND IT HAS LESS CHOICE THAN ANY ARM BEFORE IT: its
          // `teacher_headcount` IS the staffing arm's `teachers_on_roll`, so a year with no staffing
          // rows has no denominator for PLC coverage OR for the CPD-target rate — and the schema
          // calls an ANNUAL row with a NULL headcount an ETL defect rather than a valid row. Zero
          // rows, EMPTY delete scope at both cuts, nothing attempted: that year keeps whatever it had.
          plcBatches: [],
          plc: noPlcOutcome(periodId),
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

      // ── the STAFFING arm, SAME period, SAME isolation, PINNED to the rows just computed ────────
      //
      // Its input is `enrolmentCompute.computed` — the enrolment arm's own per-school result objects —
      // so the PTR denominator is the enrolment figure BY IDENTITY rather than by reconciliation. It
      // runs only here, inside the current-year branch, for the reason the header gives.
      //
      // ⚠ `attempted` GROWS AGAIN, by the same schools the enrolment arm already added. That is
      // consistent with every arm before it (one run, one verdict, a pooled rate) and it dilutes the
      // same 1% a sixth time — and it is the FIRST arm whose schools were ALREADY counted by another
      // arm, so the pooled denominator now double-counts the roster estate. The behaviour is kept
      // deliberately unchanged: per-arm budgets are a Kofi decision with their own acceptance
      // criteria, not something this slice may take on its own initiative. What it means in practice
      // is that the tolerated ABSOLUTE failure count is a little higher again, never that a staffing
      // failure is hidden — every one of them is named in the gap report.
      const staffingItems = enrolmentCompute.computed;
      attempted += staffingItems.length;

      const staffingCompute = computePerSchool<
        (typeof staffingItems)[number],
        ReturnType<typeof deriveSchoolStaffing>
      >(
        staffingItems,
        (item) => ({
          emisSchoolId: item.emisSchoolId,
          jurisdictionId: item.jurisdictionId,
        }),
        (item) => {
          const register = registerByEmis.get(item.emisSchoolId);
          if (!register)
            throw new Error(
              `${item.emisSchoolId} is not in the loaded EMIS register, so its region/district/ownership ` +
                "are unknown — the inclusion set is built FROM the register, so this cannot happen " +
                "without a defect in `buildInclusionSet`.",
            );
          return deriveSchoolStaffing(item.rows, {
            jurisdictionId: item.jurisdictionId,
            periodId,
            emisSchoolId: item.emisSchoolId,
            etlRunId: runId,
            academicYear: spec.academicYear,
            // THE SAME FROZEN VINTAGE AS THE ROSTER, never `now()`: the staffing figures describe the
            // same population at the same moment as the roll they are divided into (Kofi AC 21).
            asOfDate: rosterAsOf,
            regionName: register.regionName,
            districtName: register.districtName,
            ownershipType: register.ownershipType,
            schoolType: register.schoolType,
            refPostsEstablished: establishmentByEmis.get(item.emisSchoolId) ?? null,
          });
        },
      );
      allFailures.push(...staffingCompute.failures);

      // A school with NO row (reconciled roll 0) is deliberately absent from BOTH the rows and the
      // scope — see `StaffingWriteBatch`.
      const staffingWithRow = staffingCompute.computed.filter((c) => c.row !== null);
      const staffingRows = staffingWithRow.map((c) => c.row!);
      const staffingScope = staffingWithRow.map((c) => c.jurisdictionId);
      const staffing: StaffingOutcome = {
        schoolsComputed: staffingWithRow.length,
        deleted: 0,
        inserted: 0,
        teachersOnRoll: staffingRows.reduce((t, r) => t + r.teachersOnRoll, 0),
        enrolmentTotal: staffingRows.reduce((t, r) => t + r.enrolmentTotal, 0),
        // PUBLIC-ESTABLISHMENT ROWS ONLY (Kofi §6). The filter is the figure's denominator, not a tidy-up.
        postsEstablished: staffingRows.reduce(
          (t, r) => t + (r.teachingPostsEstablished ?? 0),
          0,
        ),
        vacancies: staffingRows.reduce((t, r) => t + (r.vacancies ?? 0), 0),
        postsEstablishedSchools: staffingRows.filter(
          (r) => r.teachingPostsEstablished !== null,
        ).length,
        noEnrolment: staffingCompute.computed
          .filter((c) => c.row === null)
          .map((c) => c.emisSchoolId),
        failures: staffingCompute.failures,
      };

      // ── the PLC/CPD arm, PINNED to the staffing rows just computed ─────────────────────────────
      //
      // Its input is `staffingWithRow` — the staffing arm's own per-school results — so
      // `teacher_headcount` is `teachers_on_roll` BY IDENTITY rather than by reconciliation, on BOTH
      // cuts. A school with NO staffing row (reconciled roll 0, or a failed staffing compute) is
      // absent from this arm too and keeps its prior PLC rows.
      //
      // ⚠ `attempted` GROWS A SEVENTH TIME, by schools three earlier arms have already counted. The
      // dilution of the single pooled 1% failure policy is by now substantial and is deliberately
      // left unchanged: one run, one verdict is the shipped contract, and per-arm budgets are a Kofi
      // decision with their own acceptance criteria. This is the fifth consecutive slice to record the
      // same note, which is itself the argument for ruling it rather than re-noting it.
      const plcItems = plcArm === null ? [] : staffingWithRow;
      attempted += plcItems.length;
      const plcCompute = computePerSchool<
        (typeof plcItems)[number],
        ReturnType<typeof buildSchoolPlcRows>
      >(
        plcItems,
        (item) => ({
          emisSchoolId: item.emisSchoolId,
          jurisdictionId: item.jurisdictionId,
        }),
        (item) => {
          const arm = plcArm!;
          const operationalId = operationalByEmis.get(item.emisSchoolId);
          if (!operationalId)
            throw new Error(
              `${item.emisSchoolId} has no operational_school_id, so its PLC source rows cannot be ` +
                "keyed — the inclusion set requires one, so this cannot happen without a defect in " +
                "`buildInclusionSet`.",
            );
          const terms: PlcTermInput[] = arm.terms.map((t) => ({
            periodId: t.periodId,
            term: t.term,
            startsOn: t.startsOn,
            endsOn: t.endsOn,
            sessions: t.sessions.get(operationalId) ?? [],
          }));
          return buildSchoolPlcRows(
            {
              programme: arm.programmes.get(operationalId) ?? null,
              groups: arm.groups.get(operationalId) ?? [],
              distinctMembers: arm.members.get(operationalId) ?? 0,
              annualPoints: arm.points.get(operationalId) ?? null,
              // ⚠ THE SOURCING GATE, PER SCHOOL. `undefined` → null → every NTC column NULL on this
              // school's rows while a covered neighbour's are populated. An extract that omits a
              // school is not asserting that its teachers earned nothing.
              ntc: arm.ntc.bySchool.get(item.emisSchoolId) ?? null,
            },
            {
              jurisdictionId: item.jurisdictionId,
              emisSchoolId: item.emisSchoolId,
              etlRunId: runId,
              academicYear: spec.academicYear,
              annualPeriodId: periodId,
              annualEndsOn: arm.annualEndsOn,
              // THE PIN. Not adjustable, and not re-derived from a second source.
              teachersOnRoll: item.row!.teachersOnRoll,
              terms,
            },
          );
        },
      );
      allFailures.push(...plcCompute.failures);

      const plcScope = plcCompute.computed.map((c) => c.jurisdictionId);
      // ONE BATCH PER PERIOD — the ANNUAL cut and each TERM cut are different `period_id`s, so each
      // gets its own bounded delete over the SAME scope.
      const plcBatches: PlcWriteBatch[] = [
        {
          periodId,
          jurisdictionIds: plcScope,
          rows: plcCompute.computed.flatMap((c) =>
            c.rows.filter((r) => r.periodId === periodId),
          ),
        },
        ...(plcArm?.terms ?? []).map((t) => ({
          periodId: t.periodId,
          jurisdictionIds: plcScope,
          rows: plcCompute.computed.flatMap((c) =>
            c.rows.filter((r) => r.periodId === t.periodId),
          ),
        })),
      ];
      // Every reported figure is Σ over the `sex = 'ALL'` rows, stated here once: mixing the ALL row
      // with the split would be exactly 2× on every additive column and the derived rates would still
      // read correctly, which is what makes that mistake invisible.
      const plcAll = plcCompute.computed;
      const plcOutcome: PlcOutcome = {
        schoolsComputed: plcAll.length,
        // ⚠ ONE SOURCE OF TRUTH FOR THE DEMO/LIVE SWITCH (ruling C5), resolved from the seam's own
        // `sourcePresent` rather than re-derived from whether any figure happens to be non-null.
        ntcProvenance: plcArm?.ntc.sourcePresent ? "DEMO" : "ABSENT",
        annual: {
          periodId,
          periodType: "ANNUAL",
          deleted: 0,
          inserted: 0,
          schoolsRunningPlc: plcAll.filter((c) => c.runsPlc).length,
          teacherHeadcount: plcAll.reduce((t, c) => t + c.annual.teacherHeadcount, 0),
          plcPoints: plcPointsOf(
            plcAll.reduce((t, c) => t + c.annual.plcPointsHundredths, 0),
          ),
          cpdPointsTotal: plcPointsOf(
            plcAll.reduce((t, c) => t + c.annual.cpdPointsTotalHundredths, 0),
          ),
          // Σ over the schools where it is NOT NULL, and NULL — not 0 — when it is null everywhere.
          // Coalescing an unsourced threshold into a national 0 is the precise failure the sourcing
          // gate exists to prevent, and the run report is not exempt from it.
          teachersMeetingCpdThreshold: plcAll.some(
            (c) => c.annual.teachersMeetingCpdThreshold !== null,
          )
            ? plcAll.reduce((t, c) => t + (c.annual.teachersMeetingCpdThreshold ?? 0), 0)
            : null,
          ntcSourcedSchools: plcAll.filter((c) => c.annual.ntcSourced).length,
        },
        terms: (plcArm?.terms ?? []).map((t) => {
          const summaries = plcAll
            .map((c) => c.terms.find((s) => s.periodId === t.periodId))
            .filter((s): s is NonNullable<typeof s> => s !== undefined);
          return {
            academicYear: t.spec.academicYear,
            term: t.term,
            periodType: "TERM" as const,
            periodId: t.periodId,
            startsOn: t.startsOn,
            endsOn: t.endsOn,
            deleted: 0,
            inserted: 0,
            schoolsRunningPlc: plcAll.filter((c) => c.runsPlc).length,
            sessionsHeld: summaries.reduce((x, s) => x + s.sessionsHeld, 0),
            sessionsExpected: summaries.reduce((x, s) => x + (s.sessionsExpected ?? 0), 0),
            schoolsWithoutCadence: summaries.filter((s) => s.sessionsExpected === null).length,
            attendanceEvents: summaries.reduce((x, s) => x + s.attendanceEvents, 0),
            attendanceExpected: summaries.reduce((x, s) => x + s.attendanceExpected, 0),
            teachersInPlc: summaries.reduce((x, s) => x + s.teachersInPlc, 0),
            teacherHeadcount: summaries.reduce((x, s) => x + s.teacherHeadcount, 0),
            orphanSessions: summaries.reduce((x, s) => x + s.orphanSessions, 0),
          };
        }),
        noPlc: plcAll.filter((c) => !c.runsPlc).map((c) => c.emisSchoolId),
        ntcCountsClamped: plcAll.reduce((t, c) => t + c.ntcCountsClamped, 0),
        failures: plcCompute.failures,
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
        staffingRows,
        staffingScope,
        staffing,
        plcBatches,
        plc: plcOutcome,
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
      // THE DECLARED-AND-SEEDED COHORT ASSERTION, BEFORE ANY COMPUTE AND LONG BEFORE ANY WRITE. Every
      // sitting year the SOURCE carries must be (1) one this run DECLARED and (2) resolvable to a seeded
      // EXAM_COHORT period. The loop below iterates the DECLARATIONS, so an undeclared source sitting
      // would otherwise be silently not refreshed — absent from the dashboard, or stale in place from an
      // earlier run, under a SUCCESS banner. It fails here, naming the naming rule, rather than hundreds
      // of rows into step 5c as a raw FK violation or not at all.
      const sourceYears = await readTerminalExamSittingYears(sql, {
        schemaName: options.sourceSchema,
        operationalSchoolIds: operationalIds,
      });
      await assertExamCohortPeriodsSeeded(
        sql,
        sourceYears,
        examCohortAcademicYear,
        cohortDeclarations.map((c) => c.sittingYear),
      );

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

    // ── step 5a (continued) · THE FOURTH ARM: fact_attendance, at its OWN TERM periods ─────────────
    //
    // SEPARATE FROM BOTH LOOPS ABOVE, because the grain is: a TERM is neither an academic year nor a
    // sitting cohort, and attendance is the first FLOW in this database — a window of pupil-days, which is
    // exactly what a term is. It runs for EVERY DECLARED TERM (not current-year-only: last term's marks are
    // a closed, immutable fact about days that happened, so refreshing or backfilling them is honest in a
    // way that backfilling a ROSTER is not).
    //
    // NOTHING IS WRITTEN HERE either: each term's rows and its own delete scope are held until the verdict.
    interface PendingTermAttendance {
      outcome: TermAttendanceOutcome;
      rows: FactAttendanceRow[];
      scope: string[];
    }
    const pendingTerms: PendingTermAttendance[] = [];
    let outOfWindowMarks = 0;
    // EXAM_COHORT specs are excluded explicitly: they carry `term: null` today, so `term !== null` already
    // excludes them, but naming the exclusion is what stops a future numbered sitting from being read as a
    // term of attendance.
    const termSpecs = options.periods.filter(
      (spec) => spec.term !== null && spec.periodType !== "EXAM_COHORT",
    );
    if (termSpecs.length > 0) {
      const operationalIds = inclusion.schools.map((s) => s.operationalSchoolId);
      for (const spec of termSpecs) {
        const periodId = periodIndex.get(periodKey(spec.academicYear, spec.term));
        if (!periodId)
          throw new Error(
            `dim_period has no TERM row for ${spec.academicYear} term ${String(spec.term)} after the ` +
              "refresh.",
          );
        // THE WINDOW IS NOT OPTIONAL. A term with no dates cannot claim a single mark — every mark is
        // assigned by its civil date — so a dates-less TERM spec would silently produce an EMPTY term and
        // an empty delete scope, i.e. a published term left stale under a SUCCESS banner. Refuse it here,
        // naming the fix, exactly as the enrolment arm refuses a vintage-less current year.
        if (!spec.startsOn || !spec.endsOn)
          throw new Error(
            `the ${spec.academicYear} term ${String(spec.term)} declares ` +
              `${spec.startsOn ? "no ends_on" : spec.endsOn ? "no starts_on" : "neither starts_on nor ends_on"}` +
              ", so fact_attendance has no window to aggregate over. Attendance is a FLOW measured over a " +
              "term's civil dates (a mark belongs to the term containing its `date`), so declare the " +
              "term's dates in `options.periods` — an undated term would publish nothing and look fine.",
          );

        // Bound into locals so the narrowing above survives into the per-school closure below.
        const startsOn: string = spec.startsOn;
        const endsOn: string = spec.endsOn;
        // `termSpecs` already filtered `term !== null`; an array filter does not narrow the element type.
        const term: number = spec.term!;

        const { groups } = await readAttendanceMarkGroups(sql, {
          schemaName: options.sourceSchema,
          operationalSchoolIds: operationalIds,
          startsOn,
          endsOn,
        });
        const bySchool = new Map<string, AttendanceMarkGroupRow[]>();
        for (const group of groups) {
          const held = bySchool.get(group.schoolId);
          if (held) held.push(group);
          else bySchool.set(group.schoolId, [group]);
        }
        // A school that marked NO register inside this window is not a failure and NOT computed: it keeps
        // its prior rows for this term. A school that DID mark registers but whose every class is
        // out-of-scope/unmapped IS computed — to zero rows — and is therefore in the delete scope, so a
        // stage that stopped existing really empties.
        const noMarks = inclusion.schools
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
            typeof aggregateSchoolAttendance
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
                `operational school ${item.schoolId} is not in the inclusion set — the attendance ` +
                  "read is not bounded by the inclusion set.",
              );
            return {
              jurisdictionId: school.jurisdictionId,
              emisSchoolId: school.emisSchoolId,
              ...aggregateSchoolAttendance(item.rows, {
                jurisdictionId: school.jurisdictionId,
                periodId,
                emisSchoolId: school.emisSchoolId,
                etlRunId: runId,
                // The FALLBACK vintage only. The real `as_of_date` is the max INCLUDED MARK DATE, derived
                // inside the transform — never `now()`, so a closed term is immutable and a re-run of an
                // unchanged term is byte-identical.
                termEndsOn: endsOn,
              }),
            };
          },
        );
        allFailures.push(...compute.failures);

        pendingTerms.push({
          rows: compute.computed.flatMap((c) => c.rows),
          scope: compute.computed.map((c) => c.jurisdictionId),
          outcome: {
            academicYear: spec.academicYear,
            term,
            periodType: "TERM",
            periodId,
            startsOn,
            endsOn,
            sourceGroups: groups.length,
            schoolsComputed: compute.computed.length,
            deleted: 0,
            inserted: 0,
            presentDays: compute.computed.reduce((t, c) => t + c.presentDays, 0),
            enrolledDays: compute.computed.reduce((t, c) => t + c.enrolledDays, 0),
            outOfScopeMarks: compute.computed.reduce((t, c) => t + c.outOfScopeMarks, 0),
            unmappedMarks: compute.computed.reduce((t, c) => t + c.unmappedMarks, 0),
            noMarks,
            failures: compute.failures,
          },
        });
      }

      // ONE counting query for the WHOLE declared calendar — a mark in NO window is not derivable from the
      // per-term reads above (the windows may be adjacent, and there is no lower bound on how old a
      // mis-keyed date can be). See `countMarksOutsideDeclaredTerms`.
      outOfWindowMarks = await countMarksOutsideDeclaredTerms(sql, {
        schemaName: options.sourceSchema,
        operationalSchoolIds: operationalIds,
        windows: termSpecs.map((spec) => ({
          startsOn: spec.startsOn!,
          endsOn: spec.endsOn!,
        })),
      });
    }

    // ── step 5a (continued) · THE FIFTH ARM: fact_fees, at the SAME TERM periods ───────────────────
    //
    // A SELF-CONTAINED PER-TERM LOOP, deliberately separate from the attendance loop above even though
    // both iterate `termSpecs`: the two arms share a GRAIN but nothing else — different source tables,
    // different allow-lists, different delete scopes, different zero rule — and fusing them would make
    // one arm's failure mode reach into the other's rows. They are reported apart for the same reason.
    //
    // ⚠ WHAT IS NOT HERE: any pooling of the measures. `fact_fees` is NON-ADDITIVE, so this loop sums
    // COUNTS and TALLIES only; a national mean would be arithmetically wrong and is not computed anywhere.
    //
    // NOTHING IS WRITTEN HERE either: each term's rows and its own delete scope are held until the verdict.
    interface PendingTermFees {
      outcome: TermFeesOutcome;
      rows: FactFeesRow[];
      scope: string[];
    }
    const pendingFeeTerms: PendingTermFees[] = [];
    let nullPeriodInvoices: { emisSchoolId: string; invoices: number }[] = [];
    if (termSpecs.length > 0) {
      const operationalIds = inclusion.schools.map((s) => s.operationalSchoolId);
      for (const spec of termSpecs) {
        const periodId = periodIndex.get(periodKey(spec.academicYear, spec.term));
        if (!periodId)
          throw new Error(
            `dim_period has no TERM row for ${spec.academicYear} term ${String(spec.term)} after the ` +
              "refresh.",
          );
        // THE WINDOW IS NOT OPTIONAL, for the attendance arm's reason adapted to this source: the TERM an
        // invoice belongs to is resolved from its operational period's own `starts_on` falling inside this
        // window (never from `period_number` — see the header), so a dates-less TERM spec would claim NO
        // invoice, produce an EMPTY term and an empty delete scope, and leave a published term stale under
        // a SUCCESS banner.
        if (!spec.startsOn || !spec.endsOn)
          throw new Error(
            `the ${spec.academicYear} term ${String(spec.term)} declares ` +
              `${spec.startsOn ? "no ends_on" : spec.endsOn ? "no starts_on" : "neither starts_on nor ends_on"}` +
              ", so fact_fees has no window to assign invoices to. An invoice is filed against the " +
              "declared TERM containing its operational period's `starts_on`, so declare the term's " +
              "dates in `options.periods` — an undated term would publish nothing and look fine.",
          );
        const startsOn: string = spec.startsOn;
        const endsOn: string = spec.endsOn;
        const term: number = spec.term!;

        const { groups } = await readFeeLineGroups(sql, {
          schemaName: options.sourceSchema,
          operationalSchoolIds: operationalIds,
          academicYear: spec.academicYear,
          startsOn,
          endsOn,
        });
        const bySchool = new Map<string, FeeLineGroupRow[]>();
        for (const group of groups) {
          const held = bySchool.get(group.schoolId);
          if (held) held.push(group);
          else bySchool.set(group.schoolId, [group]);
        }
        // A school that issued NO billed invoice in this term is not a failure and NOT computed: it keeps
        // its prior rows for this term. A school that DID bill but whose every invoiced pupil is
        // out-of-scope/unmapped IS computed — to zero rows — and is therefore in the delete scope, so a
        // category that stopped being billed really empties.
        const noInvoices = inclusion.schools
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
            typeof aggregateSchoolFees
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
                `operational school ${item.schoolId} is not in the inclusion set — the fees ` +
                  "read is not bounded by the inclusion set.",
              );
            return {
              jurisdictionId: school.jurisdictionId,
              emisSchoolId: school.emisSchoolId,
              ...aggregateSchoolFees(item.rows, {
                jurisdictionId: school.jurisdictionId,
                periodId,
                emisSchoolId: school.emisSchoolId,
                etlRunId: runId,
                // The FALLBACK vintage only. The real `as_of_date` is MAX(invoice.issued_at) among the
                // term's included invoices, derived inside the transform — never `now()`, so a closed
                // term is immutable and a re-run of an unchanged term is byte-identical.
                termEndsOn: endsOn,
              }),
            };
          },
        );
        allFailures.push(...compute.failures);

        // The DISTINCT unmapped names are a UNION across schools, not a sum of per-school counts: two
        // schools that both call their printing levy "Printing" are one unmapped name, and summing would
        // report two.
        const unmappedNames = new Set<string>();
        for (const c of compute.computed)
          for (const name of c.otherCategoryNames) unmappedNames.add(name);

        pendingFeeTerms.push({
          rows: compute.computed.flatMap((c) => c.rows),
          scope: compute.computed.map((c) => c.jurisdictionId),
          outcome: {
            academicYear: spec.academicYear,
            term,
            periodType: "TERM",
            periodId,
            startsOn,
            endsOn,
            sourceGroups: groups.length,
            schoolsComputed: compute.computed.length,
            deleted: 0,
            inserted: 0,
            billedStudents: compute.computed.reduce((t, c) => t + c.billedStudents, 0),
            categories: [
              ...new Set(compute.computed.flatMap((c) => c.categories)),
            ] as OvFeeCategory[],
            otherBilled: ghsOf(
              compute.computed.reduce((t, c) => t + c.otherBilledPesewas, 0),
            ),
            otherCategoryNames: unmappedNames.size,
            outOfScopeBilled: ghsOf(
              compute.computed.reduce((t, c) => t + c.outOfScopeBilledPesewas, 0),
            ),
            unmappedStageBilled: ghsOf(
              compute.computed.reduce((t, c) => t + c.unmappedBilledPesewas, 0),
            ),
            perSchool: compute.computed
              .filter(
                (c) =>
                  c.otherBilledPesewas > 0 ||
                  c.otherCategoryNames.length > 0 ||
                  c.outOfScopeBilledPesewas > 0 ||
                  c.unmappedBilledPesewas > 0,
              )
              .map((c) => ({
                emisSchoolId: c.emisSchoolId,
                otherBilled: ghsOf(c.otherBilledPesewas),
                otherCategoryNames: c.otherCategoryNames.length,
                outOfScopeBilled: ghsOf(c.outOfScopeBilledPesewas),
                unmappedStageBilled: ghsOf(c.unmappedBilledPesewas),
              })),
            noInvoices,
            failures: compute.failures,
          },
        });
      }

      // ONE counting query for the WHOLE run — a `period_id IS NULL` invoice belongs to no term, so it is
      // not derivable from the per-term reads above and is not per-term to report. See
      // `countInvoicesWithoutPeriod`.
      const emisByOperational = new Map(
        inclusion.schools.map((s) => [s.operationalSchoolId, s.emisSchoolId]),
      );
      nullPeriodInvoices = (
        await countInvoicesWithoutPeriod(sql, {
          schemaName: options.sourceSchema,
          operationalSchoolIds: operationalIds,
        })
      ).map((r) => ({
        emisSchoolId: emisByOperational.get(r.schoolId) ?? r.schoolId,
        invoices: r.invoices,
      }));
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
    //
    // ⚠ AND NOW A FOURTH ARM SHARES IT (task H10) — consistent with the two notes above, and worth one more
    // line because attendance adds schools to `attempted` ONCE PER DECLARED TERM, not once per run. A
    // three-term run therefore contributes roughly three times the inclusion set to the denominator on this
    // arm alone, which dilutes the same 1% further than any earlier arm did. The behaviour is again kept
    // deliberately unchanged — one run, one verdict is the shipped contract, and per-arm (or per-term)
    // budgets are a Kofi decision with their own acceptance criteria, not something this slice may take on
    // its own initiative.
    //
    // ⚠ AND NOW A FIFTH ARM SHARES IT (task H11), on the SAME per-term basis as attendance: every
    // invoice-issuing school of every declared term is added to `attempted`. A two-term run therefore adds
    // roughly two inclusion sets on this arm alone, so the pooled 1% now tolerates five arms' worth of
    // absolute failures. The behaviour is again kept deliberately unchanged — one run, one verdict is the
    // shipped contract — and this is now the fourth consecutive slice to record the same dilution, which
    // is itself the argument for per-arm budgets being ruled rather than re-noted.
    const verdict = failureVerdict(attempted, allFailures, options.policy);

    // ── step 5c · WRITE — once, one transaction, every period; only on SUCCESS ───────────────────
    // A FAILED verdict writes NOTHING. The prior night's data stays exactly as it was: stale, labelled
    // with its own older as-of, and honest. That is what makes the banner's "latest SUCCESS" read
    // correct rather than merely plausible.
    // ALL SIX fact tables in ONE `sql.begin`, so a throw while writing any arm — including the
    // performance arm's precedence collapse and any table's post-insert duplicate assertion — rolls the
    // other five back with it. Two transactions would reintroduce the half-published night between the
    // arms that each writer's own transaction rules out within one arm. For the staffing arm this is
    // not merely consistency: `fact_staffing.enrolment_total` is pinned to `fact_enrolment`'s headcount,
    // so a night that committed one and rolled back the other would publish a PTR dividing a roll the
    // enrolment panel does not show.
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
            // PER TERM: one batch per declared term, each with its OWN delete scope, so a school that
            // marked registers in term 1 and not in term 2 has term 1 refreshed and term 2 left alone.
            const attendance = await writeAttendanceFactsTx(
              tx as unknown as postgres.TransactionSql,
              pendingTerms.map((t) => ({
                periodId: t.outcome.periodId,
                jurisdictionIds: t.scope,
                rows: t.rows,
              })),
            );
            // PER TERM again, with its OWN delete scope — and ONE batch for BOTH the PTA dues rows and
            // the categorised ones (Kofi's "one arm, one fact_fees": they came through one transform, so
            // they go through one delete-then-insert).
            const fees = await writeFeesFactsTx(
              tx as unknown as postgres.TransactionSql,
              pendingFeeTerms.map((t) => ({
                periodId: t.outcome.periodId,
                jurisdictionIds: t.scope,
                rows: t.rows,
              })),
            );
            // THE SIXTH ARM, at the SAME ANNUAL period as `enrol` and with its OWN delete scope — which
            // is NARROWER than the enrolment scope by exactly the zero-roll schools (ruling §5), so a
            // school with no ratio keeps its prior row instead of being emptied.
            const staffing = await writeStaffingFactsTx(
              tx as unknown as postgres.TransactionSql,
              pending.map((p) => ({
                periodId: p.periodId,
                jurisdictionIds: p.staffingScope,
                rows: p.staffingRows,
              })),
            );
            // THE SEVENTH ARM, at the SAME ANNUAL period as `enrol`/`staffing` AND at this year's TERM
            // periods — one batch per period, each with its own bounded delete over the same scope.
            // ⚠ IT MUST WRITE *AFTER* `staffing` IN THIS TRANSACTION, and not for ordering's sake:
            // `fact_plc_participation.teacher_headcount` IS `fact_staffing.teachers_on_roll`, so a
            // night that committed one and rolled back the other would publish a CPD-compliance rate
            // dividing a staff count the PTR panel does not show. One transaction makes that
            // unreachable; writing them adjacently makes the dependency legible.
            const plc = await writePlcFactsTx(
              tx as unknown as postgres.TransactionSql,
              pending.flatMap((p) => p.plcBatches),
            );
            return { infra, enrol, exams, attendance, fees, staffing, plc };
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
            attendance: {
              perPeriod: { periodId: string; deleted: number; inserted: number }[];
            };
            fees: {
              perPeriod: { periodId: string; deleted: number; inserted: number }[];
            };
            staffing: {
              perPeriod: { periodId: string; deleted: number; inserted: number }[];
            };
            plc: {
              perPeriod: { periodId: string; deleted: number; inserted: number }[];
            };
          })
        : {
            infra: { perPeriod: [] },
            enrol: { perPeriod: [] },
            exams: { perPeriod: [] },
            attendance: { perPeriod: [] },
            fees: { perPeriod: [] },
            staffing: { perPeriod: [] },
            plc: { perPeriod: [] },
          };
    const writtenByPeriod = new Map(written.infra.perPeriod.map((p) => [p.periodId, p]));
    const enrolledByPeriod = new Map(written.enrol.perPeriod.map((p) => [p.periodId, p]));
    const examsByPeriod = new Map(written.exams.perPeriod.map((p) => [p.periodId, p]));
    const attendanceByPeriod = new Map(
      written.attendance.perPeriod.map((p) => [p.periodId, p]),
    );
    const feesByPeriod = new Map(written.fees.perPeriod.map((p) => [p.periodId, p]));
    const staffingByPeriod = new Map(
      written.staffing.perPeriod.map((p) => [p.periodId, p]),
    );
    // PER PERIOD rather than per arm-run: this arm wrote at the ANNUAL period AND at each TERM period,
    // so its outcome's `annual` and each entry of its `terms` take their own counts from this map.
    const plcByPeriod = new Map(written.plc.perPeriod.map((p) => [p.periodId, p]));

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
      staffing: {
        ...p.staffing,
        deleted: staffingByPeriod.get(p.periodId)?.deleted ?? 0,
        inserted: staffingByPeriod.get(p.periodId)?.inserted ?? 0,
      },
      plc: {
        ...p.plc,
        annual: {
          ...p.plc.annual,
          deleted: plcByPeriod.get(p.periodId)?.deleted ?? 0,
          inserted: plcByPeriod.get(p.periodId)?.inserted ?? 0,
        },
        terms: p.plc.terms.map((t) => ({
          ...t,
          deleted: plcByPeriod.get(t.periodId)?.deleted ?? 0,
          inserted: plcByPeriod.get(t.periodId)?.inserted ?? 0,
        })),
      },
    }));

    const cohortOutcomes: ExamCohortOutcome[] = pendingCohorts.map((c) => ({
      ...c.outcome,
      deleted: examsByPeriod.get(c.outcome.periodId)?.deleted ?? 0,
      inserted: examsByPeriod.get(c.outcome.periodId)?.inserted ?? 0,
      superseded: examsByPeriod.get(c.outcome.periodId)?.superseded ?? 0,
    }));

    const termOutcomes: TermAttendanceOutcome[] = pendingTerms.map((t) => ({
      ...t.outcome,
      deleted: attendanceByPeriod.get(t.outcome.periodId)?.deleted ?? 0,
      inserted: attendanceByPeriod.get(t.outcome.periodId)?.inserted ?? 0,
    }));

    const feeTermOutcomes: TermFeesOutcome[] = pendingFeeTerms.map((t) => ({
      ...t.outcome,
      deleted: feesByPeriod.get(t.outcome.periodId)?.deleted ?? 0,
      inserted: feesByPeriod.get(t.outcome.periodId)?.inserted ?? 0,
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
      terms: termOutcomes,
      attendanceOutOfWindowMarks: outOfWindowMarks,
      feeTerms: feeTermOutcomes,
      feesNullPeriodInvoices: {
        total: nullPeriodInvoices.reduce((t, r) => t + r.invoices, 0),
        bySchool: nullPeriodInvoices,
      },
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
