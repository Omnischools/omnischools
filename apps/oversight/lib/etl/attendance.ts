import type postgres from "postgres";
import type { AttendanceMarkGroupRow } from "./attendance-source";
import { ANALYTICS_STAGES, classFormOf, stageOf, type AnalyticsStage } from "./stage";
import { stampProvenance, type Provenance } from "./run";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `attendance_record` ⋈ `class` → `fact_attendance` — THE TRANSFORM AND THE WRITE (task H10, Kofi's
 * ruling).
 *
 * The FOURTH fact slice and the FOURTH ARM of the SAME nightly run. It reuses the proven machinery
 * wholesale — the harness, the dimension refresh, the EMIS register, the inclusion set, the provenance
 * stamper, per-school compute isolation, `lib/etl/stage.ts` UNCHANGED, the class_form-total idiom and the
 * NULL-safe duplicate assertion — and adds exactly one genuinely new thing: THIS IS THE FIRST FLOW.
 *
 * ── ⚠ DO NOT REUSE THE OTHER THREE TIME RULINGS. THIS ONE IS A FLOW. ───────────────────────────
 *   `fact_infrastructure`   a STOCK at ANNUAL grain: sum SPATIALLY, never across periods (a borehole
 *                           counted in term 1 and again in term 3 is one borehole).
 *   `fact_enrolment`        a STOCK (the roll) at ANNUAL grain, for the same reason: a child on roll in
 *                           two terms is one child.
 *   `fact_performance_exam` a per-cohort SNAPSHOT at EXAM_COHORT grain: not additive over time at all —
 *                           two sittings are different children.
 *   `fact_attendance`       **A FLOW, AT TERM GRAIN.** `present_days` and `enrolled_days` are COUNTS OF
 *                           PUPIL-DAYS ACCUMULATED OVER A WINDOW, so they ARE additive across time as
 *                           well as across schools: a pupil-day in term 1 and a pupil-day in term 2 are
 *                           TWO pupil-days, and adding them is the annual figure rather than a
 *                           double-count. That is the opposite of the other three, which is exactly why
 *                           it is written down here and asserted executably in `tests/etl-attendance.test.ts`.
 *
 * ⚠ THE ANNUAL FIGURE IS A READER-SIDE SUM AND IS **NOT MATERIALISED**. There is no ANNUAL
 * `fact_attendance` row. The year's rate is
 *       Σ present_days over the year's TERM rows  ÷  Σ enrolled_days over the same rows
 * which is a WEIGHTED rate — NOT the average of the three term rates, which weights a 6-week term equally
 * with a 13-week one and is wrong by construction. Materialising an ANNUAL row would create a second,
 * independently-maintained copy of a figure the term rows already determine, and the two would eventually
 * disagree with nothing to say which was right. Storing both counts beside the rate (§4.2) is precisely
 * what makes the reader-side sum exact.
 *
 * ── THE GRAIN: (jurisdiction_id, period_id[TERM], stage, class_form). THERE IS NO SEX. ──────────
 * `fact_attendance` has NO `sex` column (db/schema/fact.ts) and this slice does not invent one: a mark is
 * a mark, and the operational source this reads carries no sex on the register
 * (`lib/etl/attendance-source.ts` deliberately never touches the pupil table). An attendance gender gap is
 * a real and interesting question; it is a different slice with a different source read, not a column to
 * be half-filled here.
 *
 * ── THE RATE (Kofi Q5 — unrecoverable once loaded, so it is stated in full) ─────────────────────
 *     present_days  = count(PRESENT) + count(LATE)                    — LATE COUNTS AS PRESENT
 *     enrolled_days = count of ALL FIVE STATES                        — EXCUSED and MEDICAL STAY IN
 *     attendance_rate = round(100 * present_days / enrolled_days, 2)  — re-derived from the counts
 * The two halves people get wrong, both decided deliberately:
 *   · LATE IS PRESENT. A child who arrived at 08:20 was in school. Counting them absent would make
 *     "attendance" measure punctuality, which the product measures separately (`late_threshold`).
 *   · EXCUSED AND MEDICAL ARE **IN THE DENOMINATOR**, counted as NOT PRESENT. Removing them would raise
 *     every rate — a school whose pupils are chronically ill or routinely excused would look like a school
 *     with excellent attendance, and the children missing school would be invisible in the one figure that
 *     is supposed to see them. This matches the SHIPPED operational rate exactly
 *     (apps/web/lib/reports/attendance-summary-data.ts:16-17,82-85), so the head teacher's own report and
 *     the national dashboard cannot disagree about her school.
 * The rate is NEVER stored from a rate: it is recomputed from this row's own two counts, and the invariant
 * is asserted before the write. A group whose `enrolled_days` is 0 PRODUCES NO ROW (there is nothing to
 * divide, and a 0.00 rate would be a measurement — a false one).
 *
 * ⚠ ONLY THREE MEASURES EXIST, AND THE TWO-STATE MODEL IS PHYSICAL. The table has `enrolled_days`,
 * `present_days` and `attendance_rate` and NOTHING ELSE — no excused / medical / absent column. So the
 * published split is present vs not-present, permanently: nobody downstream can reconstruct how much of a
 * 78% was medical and how much was truancy. That is a real limitation of this grain, written here so it is
 * not rediscovered as a bug.
 *
 * ── `enrolled_days` IS MARKED PUPIL-DAYS, NOT AN EXPECTED-DAYS CALENDAR ────────────────────────
 * There is no instructional-calendar table anywhere in the operational estate, so "days the school was
 * open" cannot be computed and is not guessed. The denominator is therefore the days that were ACTUALLY
 * MARKED, which has three consequences, all accepted:
 *   · HOLIDAYS AND NON-INSTRUCTIONAL DAYS carry no marks and fall out automatically. Good.
 *   · A SCHOOL THAT STOPS MARKING THE REGISTER looks FINE rather than empty — its denominator shrinks with
 *     its numerator. This is the figure's central weakness, and the thing a coverage card (increment I)
 *     has to show beside it: `enrolled_days` itself is the marking-effort signal.
 *   · MID-TERM ENROLMENT SELF-CORRECTS. A child who joins in week 6 has marks from week 6, so she adds ~7
 *     weeks to both counts instead of being charged for the weeks before she arrived. This is also why the
 *     source read does NOT filter by pupil status: a withdrawn child's marks from the weeks she WAS in
 *     school are real pupil-days, and dropping them would silently shrink a term that already happened.
 *
 * ── class_form TOTALS, AND WHY EVERY ROW CARRIES A STAGE ───────────────────────────────────────
 * Per (school, term, stage): one row for EVERY present `class_form`, PLUS one `class_form IS NULL` STAGE
 * TOTAL. The reasoning is `fact_enrolment`'s verbatim and is not re-argued (read that header): `class_form`
 * is per-school free text, so it is comparable WITHIN a stage but not SUMMABLE ACROSS schools, which makes
 * the stage total the only roll-up-safe figure and therefore one that must be materialised rather than
 * left to each reader. The invariant — stage total = Σ its class_form rows, on BOTH counts — is asserted
 * per school before the write.
 *
 * ⚠ THE COROLLARY FOR EVERY READER: a roll-up above the school MUST filter `class_form IS NULL` AND pin
 * ONE `period_id`. Summing unfiltered double-counts (breakdown plus total, once per stage present), and
 * forgetting the period silently adds terms together — which for a FLOW produces a figure that looks
 * entirely plausible because it IS a valid sum, just of a window nobody asked for.
 *
 * `db/schema/fact.ts` leaves `stage` NULLABLE on this table (headroom for a whole-school row at a future
 * grain). THIS SLICE NEVER WRITES A STAGE-NULL ROW: every row carries a non-null stage, and the
 * whole-school figure is Σ the stage totals. A stage-NULL row would be indistinguishable from "a stage we
 * could not resolve" and would double every whole-school read that forgot to exclude it. The nullability
 * is headroom, not a gap.
 *
 * ── THE TWO NON-STAGES ARE TALLIED, EXACTLY AS ON THE ROSTER ───────────────────────────────────
 * `stageOf` / `classFormOf` are REUSED UNCHANGED (`lib/etl/stage.ts` — the same ruling, the same
 * "Basic 7-9 is JHS" correction, the same "Form is SHS"), resolved from the MARK'S OWN CLASS
 * (`attendance_record.class_id` → `class.level` / `class.name`). A mark whose class resolves OUT_OF_SCOPE
 * (below KG) or UNMAPPED is TALLIED per school and reaches NO row — never coerced into a stage, never
 * silently dropped. `class_id` is NOT NULL operationally, so unlike the roster there is no
 * class_id-NULL fallback path to write.
 *
 * ── `as_of_date` IS DETERMINISTIC AND IS NEVER `now()` ─────────────────────────────────────────
 * The MAX INCLUDED MARK DATE in the window, falling back to the TERM'S `ends_on`. Three properties follow,
 * and all three are the point:
 *   · a re-run over unchanged marks is BYTE-IDENTICAL (`now()` would make every night differ and make
 *     provenance claim a fresh measurement of data nobody touched);
 *   · a CLOSED/PAST term is IMMUTABLE — its last mark is in the past, so its rows never move again;
 *   · the CURRENT/OPEN term is a MOVING SNAPSHOT, honestly stamped: "attendance as of the last day marked",
 *     which is the one true thing that can be said about a term that has not finished.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Raised for a term's marks this ETL refuses to aggregate. Per-school isolated by `computePerSchool`. */
export class AttendanceTransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceTransformError";
  }
}

/**
 * The five operational mark states (`attendance_status`), and the two that count as PRESENT.
 *
 * The allow-list is restated here rather than imported from apps/web because this ETL may one day read a
 * source that has drifted (a CSV hand-off, a restored table): a sixth state must FAIL THE SCHOOL loudly
 * rather than silently land in the denominator as not-present, which is what a permissive transform would
 * do and which would move every rate in the country by an unknown amount.
 */
export const ATTENDANCE_STATES = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "EXCUSED",
  "MEDICAL",
] as const;
export type AttendanceState = (typeof ATTENDANCE_STATES)[number];

/** The states counted into `present_days`. LATE is one of them — see the header. */
export const PRESENT_STATES: readonly AttendanceState[] = ["PRESENT", "LATE"];

/** One `fact_attendance` row, ready to insert. Column-for-column with `db/schema/fact.ts`. */
export interface FactAttendanceRow {
  jurisdictionId: string;
  periodId: string;
  /** ALWAYS non-null, even though the column is nullable. See the header. */
  stage: AnalyticsStage;
  /** The normalised year-group token, or NULL — and NULL means THE STAGE TOTAL. */
  classForm: string | null;
  /** Marked pupil-days in the term: ALL FIVE states. Never an expected-days calendar. */
  enrolledDays: number;
  /** PRESENT + LATE pupil-days. */
  presentDays: number;
  /** `round(100*present/enrolled, 2)` from THIS row's own counts, as a numeric(5,2) literal. */
  attendanceRate: string;
  source: Provenance["source"];
  asOfDate: string;
  etlRunId: string;
}

/** One school's aggregated term: the rows to write, plus everything that is NOT a row. */
export interface SchoolAttendanceResult {
  rows: FactAttendanceRow[];
  /** Every mark the reader returned for this school in the window — rows + the two tallies below. */
  markedDays: number;
  /** Marks counted into a stage row's `enrolled_days`. */
  enrolledDays: number;
  /** Marks counted into a stage row's `present_days`. */
  presentDays: number;
  /** Marks in a below-KG class (Nursery/Creche/Pre-K). In no stage row, never dropped. */
  outOfScopeMarks: number;
  /** Marks whose class label resolved to no stage. In no stage row, never dropped. */
  unmappedMarks: number;
  /** The stages this school marked a register for, per its own class labels. */
  stages: AnalyticsStage[];
  /** The row's frozen vintage: max included mark date, else the term's `ends_on`. NEVER `now()`. */
  asOfDate: string;
}

/**
 * `round(100 * present/enrolled, 2)`, as the string a `numeric(5,2)` column takes.
 *
 * ZERO ENROLLED DAYS THROWS, and that asymmetry with `fact_performance_exam`'s `qualificationRate` (which
 * returns "0.00") is deliberate: there, a zero-candidate FEMALE row is a REAL row about a real single-sex
 * school. Here, a (stage, class_form) group with no marked days is not a measurement of anything — it
 * exists only if this transform built a bucket it should not have — so the honest response is to refuse
 * rather than publish a 0.00 that reads as "nobody attended".
 */
export function attendanceRateOf(presentDays: number, enrolledDays: number): string {
  if (enrolledDays <= 0)
    throw new AttendanceTransformError(
      `attendance_rate is undefined for enrolled_days ${String(enrolledDays)}: a group with no marked ` +
        "pupil-days produces NO ROW, because 0.00 would read as 'nobody attended' rather than 'nobody " +
        "marked the register'.",
    );
  // Integer arithmetic, half away from zero, so this equals Postgres `round(100.0 * present / enrolled, 2)`
  // on EVERY input — including the exact-half cases a float `Math.round((present / enrolled) * 10_000)`
  // rounds the other way (p=57, e=800 → 7.12 by float, 7.13 by Postgres). CRITERION 3 re-asserts the
  // STORED value against that very Postgres expression, so a float helper is a latent flake real data trips.
  // basis points = round(10_000 * present / enrolled), formatted straight from the integer — never back
  // through a float. The floor/rem normalisation corrects any drift in the float division of two integers.
  const scaled = presentDays * 10_000;
  let whole = Math.floor(scaled / enrolledDays);
  let rem = scaled - whole * enrolledDays;
  if (rem < 0) {
    whole -= 1;
    rem += enrolledDays;
  } else if (rem >= enrolledDays) {
    whole += 1;
    rem -= enrolledDays;
  }
  const basisPoints = rem * 2 >= enrolledDays ? whole + 1 : whole;
  return `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, "0")}`;
}

interface Bucket {
  enrolled: number;
  present: number;
}

const emptyBucket = (): Bucket => ({ enrolled: 0, present: 0 });

/**
 * THE PURE AGGREGATION. No DB, no clock, no randomness — same groups + same target in, same rows out,
 * which is what makes the idempotency test meaningful (and is why `as_of_date` is derived from the MARK
 * DATES rather than from the run's clock).
 *
 * It FAILS LOUDLY rather than coercing, for the same reason the other three transforms do, and the failure
 * costs ONE SCHOOL rather than the run (`computePerSchool`): a mark state outside the five, or a negative
 * count, is something nobody can honestly aggregate.
 */
export function aggregateSchoolAttendance(
  groups: AttendanceMarkGroupRow[],
  target: {
    jurisdictionId: string;
    periodId: string;
    emisSchoolId: string;
    etlRunId: string;
    /** The DECLARED TERM's `ends_on` — the `as_of_date` FALLBACK when no mark date is included. */
    termEndsOn: string;
  },
): SchoolAttendanceResult {
  const { emisSchoolId } = target;

  // stage → class_form → {enrolled, present}. `class_form` NULL is NOT a key here: the stage total is
  // DERIVED below, so it cannot drift from the breakdown it is supposed to total.
  const byStage = new Map<AnalyticsStage, Map<string, Bucket>>();
  let markedDays = 0;
  let outOfScopeMarks = 0;
  let unmappedMarks = 0;
  /** The latest date among marks that reached a stage row — the vintage. */
  let lastIncludedDate: string | null = null;

  for (const group of groups) {
    if (!Number.isInteger(group.marks) || group.marks < 0)
      throw new AttendanceTransformError(
        `${emisSchoolId}: mark count must be a non-negative integer, got ${String(group.marks)}.`,
      );
    if (!(ATTENDANCE_STATES as readonly string[]).includes(group.status))
      throw new AttendanceTransformError(
        `${emisSchoolId}: attendance status "${group.status}" is outside the allow-list ` +
          `${ATTENDANCE_STATES.join("|")} — the operational \`attendance_status\` enum and this ` +
          "transform have drifted, and a silent fallthrough would land the state in the denominator " +
          "as not-present and move every rate by an unknown amount.",
      );
    markedDays += group.marks;

    // THE LABEL, NOT THE SCHOOL TYPE, and the label of the MARK'S OWN CLASS. `class_id` is NOT NULL
    // operationally, so there is exactly one place a stage can come from.
    const stage = stageOf(group.classLevel, group.className);
    if (stage === "OUT_OF_SCOPE") {
      outOfScopeMarks += group.marks;
      continue;
    }
    if (stage === "UNMAPPED") {
      unmappedMarks += group.marks;
      continue;
    }
    const classForm = classFormOf(group.classLevel, group.className);
    if (classForm === null)
      // Unreachable by construction (a resolved stage always carries a token), and asserted anyway: a
      // null token here would be written as a SECOND stage-total row and double the stage.
      throw new AttendanceTransformError(
        `${emisSchoolId}: stage ${stage} resolved with no class_form token from ` +
          `level="${String(group.classLevel)}" name="${String(group.className)}" — the stage-total row ` +
          "would be duplicated.",
      );

    let forms = byStage.get(stage);
    if (!forms) {
      forms = new Map<string, Bucket>();
      byStage.set(stage, forms);
    }
    let bucket = forms.get(classForm);
    if (!bucket) {
      bucket = emptyBucket();
      forms.set(classForm, bucket);
    }
    // EVERY state goes into `enrolled_days`; only PRESENT and LATE also go into `present_days`.
    bucket.enrolled += group.marks;
    if (PRESENT_STATES.includes(group.status as AttendanceState))
      bucket.present += group.marks;
    // ISO dates compare lexicographically, which is why this is a string max and not a Date parse.
    if (group.marks > 0 && (lastIncludedDate === null || group.lastMarkDate > lastIncludedDate))
      lastIncludedDate = group.lastMarkDate;
  }

  // THE VINTAGE — max included mark date, else the term's own close. Never `now()`.
  const asOfDate = lastIncludedDate ?? target.termEndsOn;
  const provenance = stampProvenance(target.etlRunId, asOfDate);
  const rows: FactAttendanceRow[] = [];
  const stages: AnalyticsStage[] = [];
  let enrolledDays = 0;
  let presentDays = 0;

  // Stage order is `dim_stage.display_order` and class_form order is lexical within the stage, so the
  // emitted row order is deterministic — which is what makes "a re-run is byte-identical" meaningful
  // rather than accidental.
  for (const stage of ANALYTICS_STAGES) {
    const forms = byStage.get(stage);
    if (!forms || forms.size === 0) continue;
    const total = emptyBucket();
    for (const classForm of [...forms.keys()].sort()) {
      const bucket = forms.get(classForm)!;
      // A group with no marked pupil-days produces NO ROW — there is nothing to divide. Unreachable from
      // a grouped source read (every group carries ≥ 1 mark) and guarded anyway, because the alternative
      // is a divide-by-zero or a fabricated 0.00.
      if (bucket.enrolled === 0) continue;
      total.enrolled += bucket.enrolled;
      total.present += bucket.present;
      rows.push(factRow({ ...target, ...provenance, stage, classForm, bucket }));
    }
    if (total.enrolled === 0) continue;
    stages.push(stage);
    enrolledDays += total.enrolled;
    presentDays += total.present;
    // THE STAGE TOTAL — `class_form IS NULL`. Written, not left to the reader (see the header).
    rows.push(factRow({ ...target, ...provenance, stage, classForm: null, bucket: total }));
  }

  const result: SchoolAttendanceResult = {
    rows,
    markedDays,
    enrolledDays,
    presentDays,
    outOfScopeMarks,
    unmappedMarks,
    stages,
    asOfDate,
  };
  assertSchoolAttendanceInvariants(result, emisSchoolId);
  return result;
}

/** One (stage, class_form) key's single row. The rate is derived HERE, from that key's own counts. */
function factRow(input: {
  jurisdictionId: string;
  periodId: string;
  stage: AnalyticsStage;
  classForm: string | null;
  bucket: Bucket;
  source: Provenance["source"];
  asOfDate: string;
  etlRunId: string;
}): FactAttendanceRow {
  return {
    jurisdictionId: input.jurisdictionId,
    periodId: input.periodId,
    stage: input.stage,
    classForm: input.classForm,
    enrolledDays: input.bucket.enrolled,
    presentDays: input.bucket.present,
    attendanceRate: attendanceRateOf(input.bucket.present, input.bucket.enrolled),
    source: input.source,
    asOfDate: input.asOfDate,
    etlRunId: input.etlRunId,
  };
}

/**
 * THE ARITHMETIC SELF-CHECK, per school, before anything is written.
 *
 * Five claims, all of them things a reader will rely on and none of them expressible as a table CHECK
 * (each spans several rows, or restates a formula):
 *   1. both counts are non-negative integers and `present_days ≤ enrolled_days` (a rate above 100% is the
 *      kind of figure that gets screenshotted);
 *   2. every (stage, class_form) key appears EXACTLY ONCE — a duplicate at this grain doubles every
 *      roll-up above it, and the table has no grain UNIQUE to stop it;
 *   3. the stored rate is the rate the row's OWN counts imply, so a stale or averaged rate cannot ship;
 *   4. the `class_form IS NULL` stage total = Σ that stage's class_form rows, on BOTH counts;
 *   5. every row carries a NON-NULL stage in `dim_stage`'s vocabulary — this slice writes no
 *      whole-school row (see the header).
 * A failure here is a defect in `aggregateSchoolAttendance`, not in the data, so it names the key.
 */
export function assertSchoolAttendanceInvariants(
  result: SchoolAttendanceResult,
  emisSchoolId: string,
): void {
  const seen = new Set<string>();
  for (const row of result.rows) {
    const where = `(${row.stage}, ${row.classForm ?? "stage total"})`;
    for (const [field, value] of [
      ["enrolled_days", row.enrolledDays],
      ["present_days", row.presentDays],
    ] as const)
      if (!Number.isInteger(value) || value < 0)
        throw new AttendanceTransformError(
          `${emisSchoolId}: ${where} ${field} ${String(value)} is not a non-negative integer.`,
        );
    if (row.enrolledDays === 0)
      throw new AttendanceTransformError(
        `${emisSchoolId}: ${where} has enrolled_days 0 — such a group produces NO ROW, because the rate ` +
          "would be undefined and a 0.00 would read as 'nobody attended'.",
      );
    if (row.presentDays > row.enrolledDays)
      throw new AttendanceTransformError(
        `${emisSchoolId}: ${where} has present_days ${row.presentDays} > enrolled_days ` +
          `${row.enrolledDays} — present days are a SUBSET of marked days (PRESENT + LATE of five states).`,
      );
    if (row.attendanceRate !== attendanceRateOf(row.presentDays, row.enrolledDays))
      throw new AttendanceTransformError(
        `${emisSchoolId}: ${where} stores rate ${row.attendanceRate} but its own counts imply ` +
          `${attendanceRateOf(row.presentDays, row.enrolledDays)} — the rate is RE-DERIVED from the two ` +
          "counts and is never stored from a rate.",
      );
    if (!(ANALYTICS_STAGES as readonly string[]).includes(row.stage))
      throw new AttendanceTransformError(
        `${emisSchoolId}: ${where} carries stage "${String(row.stage)}", which is not a dim_stage key. ` +
          "fact_attendance.stage is nullable as HEADROOM, but this slice writes a non-null stage on " +
          "every row and no whole-school row at all.",
      );
    const key = `${row.stage}\u0000${row.classForm ?? "\u0001TOTAL"}`;
    if (seen.has(key))
      throw new AttendanceTransformError(
        `${emisSchoolId}: duplicate ${where} row — a duplicate at this grain silently doubles every ` +
          "roll-up above it, and fact_attendance has NO grain UNIQUE to catch it.",
      );
    seen.add(key);
  }

  // Claim 4 — the stage total really totals its own breakdown, on BOTH counts.
  for (const stage of result.stages) {
    const breakdown = result.rows.filter(
      (r) => r.stage === stage && r.classForm !== null,
    );
    const total = result.rows.find((r) => r.stage === stage && r.classForm === null);
    if (!total)
      throw new AttendanceTransformError(
        `${emisSchoolId}: stage ${stage} has breakdown rows but no class_form IS NULL total. The stage ` +
          "total is the only roll-up-safe figure, so its absence is a silent undercount.",
      );
    for (const [field, pick] of [
      ["present_days", (r: FactAttendanceRow) => r.presentDays],
      ["enrolled_days", (r: FactAttendanceRow) => r.enrolledDays],
    ] as const) {
      const sum = breakdown.reduce((t, r) => t + pick(r), 0);
      if (pick(total) !== sum)
        throw new AttendanceTransformError(
          `${emisSchoolId}: stage ${stage} total ${field} is ${pick(total)} but its class_form breakdown ` +
            `sums to ${sum}.`,
        );
    }
  }
}

// ── the write ───────────────────────────────────────────────────────────────────────────────────

/**
 * ONE TERM's computed rows, with the DELETE SCOPE stated explicitly.
 *
 * ⚠ WHY THE SCOPE IS NOT DERIVED FROM `rows`, and why it matters MORE here than on any earlier arm. The
 * scope is "every school this run SUCCESSFULLY COMPUTED FOR THIS TERM" — which includes a school that
 * computed to ZERO rows (every class out-of-scope/unmapped), so an emptied stage really empties.
 *
 * It EXCLUDES — deliberately — a school with NO MARKS AT ALL in the term. That school is not computed, so
 * it is not in the delete scope and KEEPS ITS PRIOR ROWS: stale-but-honest. The case must be
 * DISTINGUISHED from the one it resembles and is not:
 *     NO MARKS IN THE TERM      → not computed, no rows written, prior rows kept. "We do not know."
 *     ALL MARKS ABSENT          → computed: enrolled_days > 0, present_days = 0, rate 0.00. A REAL ROW,
 *                                 and the most important row in the table — a school whose children
 *                                 stopped coming. Suppressing it as "no data" would hide exactly the
 *                                 failure the regulator exists to see.
 * Deleting the first school's rows because tonight's read returned nothing would empty a published term on
 * the basis of an absence; publishing a zero for it would invent a measurement. `tests/etl-attendance.test.ts`
 * asserts the two are distinct, in both directions.
 */
export interface AttendanceWriteBatch {
  periodId: string;
  /** SCHOOL-level jurisdiction ids successfully computed FOR THIS TERM. THE DELETE BOUND. */
  jurisdictionIds: string[];
  rows: FactAttendanceRow[];
}

export interface AttendanceWriteResult {
  deleted: number;
  inserted: number;
  perPeriod: { periodId: string; deleted: number; inserted: number }[];
}

/**
 * DELETE-BY-(PERIOD, JURISDICTION ∈ SCOPE)-THEN-INSERT, **PER TERM**, inside the caller's transaction. The
 * three properties `writeInfrastructureFacts` documents hold here verbatim — bounded delete, ONE
 * transaction for the whole run, delete-then-insert rather than upsert — and are not re-argued.
 *
 * PER TERM is the part that is this slice's own: each declared TERM is its own flow window and its own
 * batch, with its own delete scope, so a school that marked registers in term 1 and not in term 2 has its
 * term-1 rows refreshed and its term-2 rows left alone. A single run-wide delete keyed only on jurisdiction
 * would wipe the terms the night had nothing to say about.
 *
 * ⚠ `fact_attendance` IS ONE OF THE PK-ONLY ORIGINAL EIGHT (db/schema/fact.ts) — it has NO grain UNIQUE.
 * A duplicate at the full grain INSERTS HAPPILY and silently DOUBLES both counts in every roll-up above it
 * — and because the doubling CANCELS IN THE RATIO, the published RATE still reads correctly, which makes
 * this table's duplicate the hardest of the four to see. The POST-INSERT DUPLICATE ASSERTION below is the
 * only guard that exists.
 *
 * It is NULL-SAFE on `class_form`, and that is not a detail: the `class_form IS NULL` stage-total rows are
 * LEGITIMATE and must not be flagged, while a genuine EMPTY-STRING token must not be collapsed INTO them.
 * So the key carries `class_form IS NULL` as its own boolean alongside the coalesced text — NULL and ''
 * stay distinguishable, and a genuine duplicate of either is caught. (Adapted from
 * `writeEnrolmentFactsTx`, minus the sex dimension.)
 */
export async function writeAttendanceFactsTx(
  tx: postgres.TransactionSql,
  batches: AttendanceWriteBatch[],
): Promise<AttendanceWriteResult> {
  const perPeriod: AttendanceWriteResult["perPeriod"] = [];
  let totalDeleted = 0;
  let totalInserted = 0;

  for (const batch of batches) {
    const { periodId, jurisdictionIds, rows: rowsToWrite } = batch;

    let deleted = 0;
    if (jurisdictionIds.length > 0) {
      const removed = await tx`
        delete from fact_attendance
         where period_id = ${periodId}::uuid
           and jurisdiction_id = any(${jurisdictionIds}::uuid[])`;
      deleted = removed.count;
    }

    let inserted = 0;
    const CHUNK = 1000;
    for (let i = 0; i < rowsToWrite.length; i += CHUNK) {
      const chunk = rowsToWrite.slice(i, i + CHUNK).map((r) => ({
        jurisdiction_id: r.jurisdictionId,
        period_id: r.periodId,
        stage: r.stage,
        class_form: r.classForm,
        enrolled_days: r.enrolledDays,
        present_days: r.presentDays,
        attendance_rate: r.attendanceRate,
        source: r.source,
        as_of_date: r.asOfDate,
        etl_run_id: r.etlRunId,
      }));
      const result = await tx`insert into fact_attendance ${tx(chunk)}`;
      inserted += result.count;
    }

    // THE DUPLICATE ASSERTION OVER THE FULL GRAIN — see the header. Inside the transaction, so tripping it
    // rolls the WHOLE RUN (all four arms) back. Period-wide on purpose: a duplicate left in this term by
    // an earlier buggy run must fail the run that notices it, not be skipped because tonight's scope
    // happened not to cover that school.
    const dupes = await tx<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id, stage,
               class_form is null as is_stage_total,
               coalesce(class_form, '') as class_form_key
          from fact_attendance
         where period_id = ${periodId}::uuid
         group by jurisdiction_id, period_id, stage, (class_form is null),
                  coalesce(class_form, '')
        having count(*) > 1
      ) d`;
    if ((dupes[0]?.n ?? 0) > 0)
      throw new Error(
        `fact_attendance has ${dupes[0]!.n} duplicated grain key(s) ` +
          `(jurisdiction_id, period_id, stage, class_form) for period ${periodId}. ` +
          "fact_attendance has NO grain UNIQUE, so a duplicate inserts happily and silently DOUBLES both " +
          "counts in every roll-up above it — while the published RATE still reads correctly, because the " +
          "doubling cancels in the ratio. That is why this assertion exists.",
      );

    perPeriod.push({ periodId, deleted, inserted });
    totalDeleted += deleted;
    totalInserted += inserted;
  }

  return { deleted: totalDeleted, inserted: totalInserted, perPeriod };
}

/** The standalone form — its OWN transaction. The pipeline uses the `…Tx` form instead, so that all FOUR
 *  arms of one run are ONE transaction (see `lib/etl/pipeline.ts`). */
export async function writeAttendanceFacts(
  sql: postgres.Sql,
  batches: AttendanceWriteBatch[],
): Promise<AttendanceWriteResult> {
  return (await sql.begin(async (tx) =>
    writeAttendanceFactsTx(tx as unknown as postgres.TransactionSql, batches),
  )) as unknown as AttendanceWriteResult;
}
