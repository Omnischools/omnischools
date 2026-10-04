import type postgres from "postgres";
import type { FeeLineGroupRow } from "./fees-source";
import { OV_FEE_CATEGORIES, feeCategoryOf, type OvFeeCategory } from "./fee-category";
import { ANALYTICS_STAGES, stageOf, type AnalyticsStage } from "./stage";
import { stampProvenance, type Provenance } from "./run";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `invoice_line_item` ⋈ `invoice` ⋈ `fee_category` ⋈ `pta_dues_charge` → `fact_fees` — THE TRANSFORM
 * AND THE WRITE (task H11, Kofi's ruling).
 *
 * The FIFTH fact slice and the FIFTH ARM of the SAME nightly run. It reuses the proven machinery
 * wholesale — the harness, the dimension refresh, the EMIS register, the inclusion set, the provenance
 * stamper, per-school compute isolation, `lib/etl/stage.ts` UNCHANGED, the per-TERM loop the attendance
 * arm established and the NULL-safe duplicate assertion — and adds exactly one genuinely new thing:
 * THIS IS THE FIRST **NON-ADDITIVE** FACT TABLE.
 *
 * ── ⚠ DO NOT REUSE ANY OF THE FOUR EARLIER TIME/SPACE RULINGS. THIS ONE IS A DISTRIBUTION. ──────
 *   `fact_infrastructure`   a STOCK at ANNUAL grain: sum SPATIALLY, never across periods.
 *   `fact_enrolment`        a STOCK (the roll) at ANNUAL grain, for the same reason.
 *   `fact_performance_exam` a per-cohort SNAPSHOT: not additive over TIME, but its candidate/qualified
 *                           COUNTS are additive over SPACE, so a district total is a real figure.
 *   `fact_attendance`       a FLOW at TERM grain: additive over BOTH time and space (pupil-days).
 *   `fact_fees`             **A DISTRIBUTION. NON-ADDITIVE IN BOTH TIME AND SPACE.** The table stores
 *                           `mean_amount` and `median_amount` and NOTHING ELSE — no summable column
 *                           exists (db/schema/fact.ts:167-181), by design and by Kofi's ruling. Two
 *                           schools' mean fees do not add to anything; three terms' medians do not add
 *                           to a year; and the AVERAGE OF TWO MEANS IS NOT THE MEAN unless both schools
 *                           billed the same number of children. A median cannot be recombined AT ALL
 *                           from medians, at any weighting, ever.
 *
 * ⚠ THE COROLLARY FOR EVERY READER, AND THE REASON IT IS WRITTEN HERE FIRST. There is no roll-up of
 * `fact_fees`. A district figure is NOT Σ (or mean of) its schools' rows: the only correct district mean
 * is re-derived from the district's own pooled per-student distribution, which this table does not store
 * and therefore cannot produce. So:
 *   · the district/regional/national cut of fees is a FUTURE slice that must re-read the source, not a
 *     query over this table;
 *   · the H19 "district = Σ schools" roll-up harness MUST EXCLUDE `fact_fees` when it lands (it does not
 *     exist yet, so this comment and `tests/etl-fees.test.ts`'s non-additivity assertions are the whole
 *     guard today — do not delete either without reading the test);
 *   · a reader wanting the whole-school figure takes the `stage IS NULL` ROW (below). It never sums the
 *     stage rows.
 * What IS stored and what a reader may do with it is therefore narrow on purpose: these are SCHOOL-level
 * distributional figures, comparable BETWEEN schools and ACROSS terms by inspection, and summable in no
 * direction at all.
 *
 * ── THE GRAIN: (jurisdiction_id, period_id[TERM], fee_category, stage) ──────────────────────────
 * `fee_category` is the `ov_fee_category` member resolved by `lib/etl/fee-category.ts` (a PURE FUNCTION,
 * not a mapping table — see that module's header for why), with ONE exception that outranks it:
 *
 * ⚠ PTA PRECEDENCE. A line item with a `pta_dues_charge` row IS `PTA_DUES`, whatever its
 * `fee_category.name` says, and the bridge is consulted BEFORE the resolver. A school that files its
 * dues under a category called "General Levy" must still land in PTA_DUES, because the PTA module's own
 * Treasurer report counts exactly those bridged lines and the two figures must not disagree about the
 * same money. The billed figure is the LINE's `amount` — `rate_snapshot` is NEVER summed beside it (that
 * would double-count) and never read INSTEAD of it (it would disagree with the invoice the parent was
 * handed whenever the rate moved after issuance). A line with NO `fee_category_id` and NO dues bridge
 * has nothing to resolve from and lands in OTHER.
 *
 * ── THE MEASURES ARE A PER-**STUDENT** DISTRIBUTION (Kofi's ruling, in full) ────────────────────
 * Within a (fee_category, stage) group:
 *   1. SUM EACH STUDENT'S line-item amounts in the group — one figure per CHILD, not per line and not
 *      per invoice. A child billed tuition on two invoices in one term was billed one tuition total.
 *   2. `mean_amount`   = round(Σ billed ÷ COUNT(DISTINCT billed students), 2)
 *   3. `median_amount` = the median of those per-student totals (sorted; an EVEN count takes the mean of
 *      the two middle values)
 * Both are RE-DERIVED FROM THE GROUP'S OWN DISTRIBUTION and never from an upstream figure — never from
 * `invoice.billed_amount`, never from another row, and never from a parent group's answer.
 *
 * ⚠ THE DENOMINATOR IS BILLED STUDENTS, NOT ENROLLED ONES, and the difference is the figure's main
 * caveat: a school that bills only half its pupils for boarding has a BOARDING mean over the boarders,
 * which is the right number for "what does boarding cost here" and the wrong one for "what does a pupil
 * here pay on average". The table cannot express the second, because it stores no denominator — which is
 * exactly why the mean and the median are published TOGETHER: a mean far above the median is a long
 * right tail (a few large bills), and that shape is the only thing a reader can honestly infer.
 *
 * ⚠ BILLED, NOT COLLECTED. This arm never touches the payment estate (see `lib/etl/fees-source.ts`).
 * "Mean fee" here means "mean amount CHARGED", and arrears/collection analytics is a different slice.
 *
 * ── THE `stage IS NULL` ALL-STAGES ROW — THE MIRROR-IMAGE OF `fact_attendance` ───────────────────
 * Per (jurisdiction, period, fee_category) this slice writes ONE row with `stage IS NULL`, and that is
 * the OPPOSITE of what the attendance arm does (it writes NO stage-NULL row at all, because its stages
 * Σ-reconstruct the whole). The asymmetry is forced by the arithmetic:
 *   · attendance's whole-school figure IS Σ its stage rows, so materialising it would duplicate a figure
 *     the stage rows already determine;
 *   · fees' whole-school figure is NOT recoverable from its stage rows AT ALL — means and medians do not
 *     recombine — so if it is not materialised it does not exist.
 * ⚠ IT IS COMPUTED FROM THE **POOLED CROSS-STAGE PER-STUDENT DISTRIBUTION**, never derived from the
 * per-stage rows. Its mean is generally not any weighting of theirs and its median is generally not
 * between them. `assertSchoolFeesInvariants` asserts the two properties that DO hold (the pooled
 * distribution is the UNION of the per-stage ones — same students, same total) precisely so that the
 * ones that do not hold are not assumed by the next reader.
 *
 * ── ZERO IS A MEASUREMENT HERE, AND ABSENCE IS NOT (the Free SHS rule) ──────────────────────────
 * A (category, stage) group with AT LEAST ONE DISTINCT BILLED STUDENT WRITES A ROW — even when every
 * amount is 0.00 and therefore mean = median = 0.00. That row is the FREE SHS SIGNAL: a Government SHS
 * that issues every pupil a tuition line of GHS 0 is making a true and important statement, and
 * suppressing it as "no data" would erase the single most consequential fee-policy fact in Ghana.
 * A category with NO LINE ITEMS AT ALL produces NO ROW — there is no distribution, so there is nothing
 * to publish. The two are DISTINCT and must stay so:
 *     BILLED ZERO   → a row, 0.00 / 0.00. "This school charges nothing for this."
 *     NOT BILLED    → no row.            "This school does not bill this category."
 * ⚠ THIS IS THE OPPOSITE OF `fact_attendance`'s zero rule (which SUPPRESSES a zero-denominator row), and
 * the difference is that attendance's zero would be a zero DENOMINATOR (undefined) while this one is a
 * zero NUMERATOR over a real denominator (defined, and true).
 *
 * ── THE TWO NON-STAGES ARE TALLIED, EXACTLY AS ON THE ROSTER AND THE REGISTER ───────────────────
 * `stageOf` is REUSED UNCHANGED (`lib/etl/stage.ts` — the same ruling, the same "Basic 7-9 is JHS", the
 * same "Form is SHS"), resolved from the INVOICED PUPIL'S OWN CLASS (`invoice.student_id` →
 * `students.class_id` → `class.level`/`class.name`, falling back to `students.current_class_label` for a
 * pupil with no class row — the roster arm's precedence, verbatim). A line whose pupil's class resolves
 * OUT_OF_SCOPE (below KG) or UNMAPPED is TALLIED in GHS per school and reaches NO row — never coerced
 * into a stage, never silently dropped.
 *
 * ── `as_of_date` IS DETERMINISTIC AND IS NEVER `now()` ─────────────────────────────────────────
 * MAX(`invoice.issued_at`) among the INCLUDED invoices in the term, falling back to the TERM's `ends_on`.
 * The same three properties the attendance arm's vintage has, for the same reasons: a re-run over
 * unchanged invoices is BYTE-IDENTICAL; a closed term is IMMUTABLE; and an open term is an honestly
 * stamped moving snapshot ("fees as billed up to the last invoice issued").
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Raised for a term's fee lines this ETL refuses to aggregate. Per-school isolated by `computePerSchool`. */
export class FeesTransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeesTransformError";
  }
}

/** One `fact_fees` row, ready to insert. Column-for-column with `db/schema/fact.ts`. */
export interface FactFeesRow {
  jurisdictionId: string;
  periodId: string;
  feeCategory: OvFeeCategory;
  /**
   * The `dim_stage` key, or NULL — and NULL means THE ALL-STAGES ROW, computed from the POOLED
   * cross-stage distribution. It is NOT "a stage we could not resolve": those reach no row at all.
   */
  stage: AnalyticsStage | null;
  /** `round(Σ per-student billed ÷ distinct billed students, 2)` as a numeric(10,2) literal. */
  meanAmount: string;
  /** The median per-student billed amount as a numeric(10,2) literal. Even count = mean of two middles. */
  medianAmount: string;
  source: Provenance["source"];
  asOfDate: string;
  etlRunId: string;
}

/** One school's aggregated term: the rows to write, plus everything that is NOT a row. */
export interface SchoolFeesResult {
  rows: FactFeesRow[];
  /** Billed pesewas that reached a row (i.e. whose pupil resolved to a real stage). */
  billedPesewas: number;
  /** Billed pesewas published under OTHER — the resolver's own coverage signal. */
  otherBilledPesewas: number;
  /**
   * The DISTINCT `fee_category.name` values that resolved to OTHER. Collected regardless of stage
   * (name resolution does not depend on the pupil's class), and NULL-named lines are not in it: a line
   * with no `fee_category_id` has no name to be unmapped.
   */
  otherCategoryNames: string[];
  /** Billed pesewas whose pupil is in a below-KG class. In NO row, never dropped. */
  outOfScopeBilledPesewas: number;
  /** Billed pesewas whose pupil's class label resolved to no stage. In NO row, never dropped. */
  unmappedBilledPesewas: number;
  /** The distinct pupils who reached a row — the measures' denominator, pooled over categories. */
  billedStudents: number;
  /** The categories this school billed. In `ov_fee_category` order. */
  categories: OvFeeCategory[];
  /** The row's frozen vintage: max included `issued_at`, else the term's `ends_on`. NEVER `now()`. */
  asOfDate: string;
  /**
   * THE DISTRIBUTIONS the rows were computed from, keyed `${category}\u0000${stage ?? ""}` → the sorted
   * per-student pesewas. NEVER WRITTEN — it exists so `assertSchoolFeesInvariants` can re-derive each
   * stored figure from the very numbers it came from (the row itself carries no denominator, unlike
   * `fact_attendance`, so the self-check has nowhere else to get them), and so the suite can assert the
   * pooled row is not a recombination of the per-stage ones.
   */
  distributions: Map<string, number[]>;
}

/** The distribution key. `stage === null` is the POOLED all-stages distribution. */
export function distributionKey(
  category: OvFeeCategory,
  stage: AnalyticsStage | null,
): string {
  return `${category}\u0000${stage ?? ""}`;
}

// ── the money helpers: exact integer pesewas in, numeric(10,2) literals out ──────────────────────

/** numeric(10,2) holds ±99,999,999.99 — the write-time bound every figure is checked against. */
const MAX_PESEWAS = 9_999_999_999;

/**
 * `round(total / n)` in PESEWAS, HALF AWAY FROM ZERO — the same rule Postgres `round(numeric)` uses, and
 * the reason this is integer arithmetic rather than `Math.round(total / n)`: the float form rounds
 * exact-half cases the other way (and `tests/etl-fees.test.ts` re-asserts the STORED value against
 * Postgres's own `round()`, so a float helper is a latent flake that real money trips).
 */
function divideRound(total: number, n: number): number {
  if (!Number.isInteger(total))
    throw new FeesTransformError(
      `billed pesewas ${String(total)} is not an integer — the source read converts numeric(12,2) ` +
        "GHS to exact pesewas precisely so no published fee is decided by float arithmetic.",
    );
  if (n <= 0)
    throw new FeesTransformError(
      `a fee distribution with ${String(n)} billed students has no mean — a group with no billed ` +
        "student produces NO ROW (and a group with one billed student billed 0.00 produces a REAL " +
        "0.00 row, which is a different thing).",
    );
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const whole = Math.floor(abs / n);
  const rem = abs - whole * n;
  return sign * (rem * 2 >= n ? whole + 1 : whole);
}

/** Exact pesewas → the string a `numeric(10,2)` column takes. Never via a float. */
export function ghsOf(pesewas: number): string {
  if (!Number.isInteger(pesewas))
    throw new FeesTransformError(`pesewas ${String(pesewas)} is not an integer.`);
  const sign = pesewas < 0 ? "-" : "";
  const abs = Math.abs(pesewas);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** The arithmetic mean of a per-student distribution, in pesewas. */
export function meanPesewas(distribution: readonly number[]): number {
  return divideRound(
    distribution.reduce((t, v) => t + v, 0),
    distribution.length,
  );
}

/**
 * The median of a per-student distribution, in pesewas. ODD count = the middle value; EVEN count = the
 * mean of the two middle values, rounded half away from zero.
 *
 * The input must already be sorted ascending — `aggregateSchoolFees` sorts once, numerically. (A default
 * `Array.sort()` is LEXICAL, which would put 1000 before 200 and silently publish the wrong median; the
 * comparator is written out at the call site for that reason.)
 */
export function medianPesewas(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0)
    throw new FeesTransformError(
      "a fee distribution with no billed students has no median — such a group produces NO ROW.",
    );
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid]!;
  return divideRound(sorted[mid - 1]! + sorted[mid]!, 2);
}

/**
 * THE PURE AGGREGATION. No DB, no clock, no randomness — same groups + same target in, same rows out,
 * which is what makes the idempotency test meaningful (and is why `as_of_date` is derived from the
 * INVOICES' `issued_at` rather than from the run's clock).
 *
 * It FAILS LOUDLY rather than coercing, for the same reason the other four transforms do, and the
 * failure costs ONE SCHOOL rather than the run (`computePerSchool`).
 */
export function aggregateSchoolFees(
  groups: FeeLineGroupRow[],
  target: {
    jurisdictionId: string;
    periodId: string;
    emisSchoolId: string;
    etlRunId: string;
    /** The DECLARED TERM's `ends_on` — the `as_of_date` FALLBACK when no invoice date is included. */
    termEndsOn: string;
  },
): SchoolFeesResult {
  const { emisSchoolId } = target;

  // (category, stage) → studentId → billed pesewas. And, ACCUMULATED INDEPENDENTLY FROM THE SAME SOURCE
  // ROWS rather than from the map above, category → studentId → billed pesewas: the POOLED cross-stage
  // distribution the `stage IS NULL` row is computed from. Deriving it from the per-stage buckets would
  // be arithmetically identical for the SUM and the COUNT and WRONG for the MEDIAN, so it is never
  // derived at all.
  const byStage = new Map<AnalyticsStage, Map<OvFeeCategory, Map<string, number>>>();
  const pooled = new Map<OvFeeCategory, Map<string, number>>();
  const allStudents = new Set<string>();
  let billedPesewas = 0;
  let otherBilledPesewas = 0;
  let outOfScopeBilledPesewas = 0;
  let unmappedBilledPesewas = 0;
  const otherCategoryNames = new Set<string>();
  /** The latest `issued_at` among INCLUDED invoices — the vintage. See the header. */
  let lastIssuedAt: string | null = null;

  const bump = (
    bucket: Map<string, number>,
    studentId: string,
    pesewas: number,
  ): void => {
    bucket.set(studentId, (bucket.get(studentId) ?? 0) + pesewas);
  };

  for (const group of groups) {
    if (!Number.isInteger(group.billedPesewas))
      throw new FeesTransformError(
        `${emisSchoolId}: billed pesewas ${String(group.billedPesewas)} is not an integer — the ` +
          "source read converts numeric(12,2) GHS to exact pesewas so that no published fee is " +
          "decided by float arithmetic.",
      );
    if (group.billedPesewas < 0)
      // A negative billed total is a credit, not a fee, and a negative published mean is a figure
      // nobody can read. Refusing THIS SCHOOL (not the run) is the honest response: whether a credit
      // note belongs in a billed distribution at all is a Kofi question this slice must not answer by
      // quietly averaging one in.
      throw new FeesTransformError(
        `${emisSchoolId}: a pupil's billed total in category "${String(group.categoryName)}" is ` +
          `${ghsOf(group.billedPesewas)} GHS — negative. fact_fees publishes BILLED distributions, and ` +
          "a credit note is not a fee: whether it belongs in the mean is a ruling nobody has made, so " +
          "this school is refused rather than averaged.",
      );
    // ISO timestamps compare lexicographically, which is why this is a string max and not a Date parse.
    if (lastIssuedAt === null || group.lastIssuedAt > lastIssuedAt)
      lastIssuedAt = group.lastIssuedAt;

    // ⚠ PTA PRECEDENCE, AHEAD OF THE RESOLVER. The bridge decides; the name does not get a vote.
    const category: OvFeeCategory = group.isDues
      ? "PTA_DUES"
      : feeCategoryOf(group.categoryName);
    if (category === "OTHER" && group.categoryName !== null)
      otherCategoryNames.add(group.categoryName);

    // THE LABEL, NOT THE SCHOOL TYPE, and the label of the INVOICED PUPIL'S OWN CLASS — falling back to
    // `current_class_label` for a pupil with no class row, exactly as the roster arm does.
    const level = group.hasClass ? group.classLevel : group.currentClassLabel;
    const name = group.hasClass ? group.className : null;
    const stage = stageOf(level, name);
    if (stage === "OUT_OF_SCOPE") {
      outOfScopeBilledPesewas += group.billedPesewas;
      continue;
    }
    if (stage === "UNMAPPED") {
      unmappedBilledPesewas += group.billedPesewas;
      continue;
    }

    let categories = byStage.get(stage);
    if (!categories) {
      categories = new Map<OvFeeCategory, Map<string, number>>();
      byStage.set(stage, categories);
    }
    let bucket = categories.get(category);
    if (!bucket) {
      bucket = new Map<string, number>();
      categories.set(category, bucket);
    }
    bump(bucket, group.studentId, group.billedPesewas);

    let pooledBucket = pooled.get(category);
    if (!pooledBucket) {
      pooledBucket = new Map<string, number>();
      pooled.set(category, pooledBucket);
    }
    bump(pooledBucket, group.studentId, group.billedPesewas);

    allStudents.add(group.studentId);
    billedPesewas += group.billedPesewas;
    if (category === "OTHER") otherBilledPesewas += group.billedPesewas;
  }

  // THE VINTAGE — max included `issued_at`, else the term's own close. Never `now()`.
  const asOfDate = lastIssuedAt ?? target.termEndsOn;
  const provenance = stampProvenance(target.etlRunId, asOfDate);
  const rows: FactFeesRow[] = [];
  const distributions = new Map<string, number[]>();
  const categories: OvFeeCategory[] = [];

  // Category order is `ov_fee_category`'s own and stage order is `dim_stage.display_order`, so the
  // emitted row order is deterministic — which is what makes "a re-run is byte-identical" a property
  // rather than a coincidence.
  for (const category of OV_FEE_CATEGORIES) {
    const pooledBucket = pooled.get(category);
    // NO LINE ITEMS AT ALL → NO ROW. (A group WITH a billed student whose every amount is 0 is a
    // different case entirely and DOES write a row — see the header's Free SHS note.)
    if (!pooledBucket || pooledBucket.size === 0) continue;
    categories.push(category);
    for (const stage of ANALYTICS_STAGES) {
      const bucket = byStage.get(stage)?.get(category);
      if (!bucket || bucket.size === 0) continue;
      rows.push(
        factRow({ ...target, ...provenance, category, stage }, bucket, distributions),
      );
    }
    // THE ALL-STAGES ROW — `stage IS NULL`, from the POOLED distribution. Written, never derived from
    // the rows above (see the header).
    rows.push(
      factRow(
        { ...target, ...provenance, category, stage: null },
        pooledBucket,
        distributions,
      ),
    );
  }

  const result: SchoolFeesResult = {
    rows,
    billedPesewas,
    otherBilledPesewas,
    otherCategoryNames: [...otherCategoryNames].sort(),
    outOfScopeBilledPesewas,
    unmappedBilledPesewas,
    billedStudents: allStudents.size,
    categories,
    asOfDate,
    distributions,
  };
  assertSchoolFeesInvariants(result, emisSchoolId);
  return result;
}

/**
 * One (category, stage) key's single row. BOTH measures are derived HERE, from that key's own
 * per-student distribution — never from another row and never from an upstream figure.
 */
function factRow(
  input: {
    jurisdictionId: string;
    periodId: string;
    category: OvFeeCategory;
    stage: AnalyticsStage | null;
    source: Provenance["source"];
    asOfDate: string;
    etlRunId: string;
  },
  bucket: Map<string, number>,
  distributions: Map<string, number[]>,
): FactFeesRow {
  // NUMERIC sort, written out: the default `Array.sort()` is LEXICAL, which would order 1000 before 200
  // and publish a median from the wrong middle of the distribution.
  const sorted = [...bucket.values()].sort((a, b) => a - b);
  distributions.set(distributionKey(input.category, input.stage), sorted);
  return {
    jurisdictionId: input.jurisdictionId,
    periodId: input.periodId,
    feeCategory: input.category,
    stage: input.stage,
    meanAmount: ghsOf(meanPesewas(sorted)),
    medianAmount: ghsOf(medianPesewas(sorted)),
    source: input.source,
    asOfDate: input.asOfDate,
    etlRunId: input.etlRunId,
  };
}

/**
 * THE ARITHMETIC SELF-CHECK, per school, before anything is written.
 *
 * Six claims, all of them things a reader will rely on and none of them expressible as a table CHECK
 * (each spans several rows, or restates a formula):
 *   1. `fee_category` is an `ov_fee_category` member and `stage` is a `dim_stage` key or NULL;
 *   2. both measures are numeric(10,2)-representable and are re-derived from THIS row's own
 *      distribution, so a stale or borrowed figure cannot ship;
 *   3. every (fee_category, stage) key appears EXACTLY ONCE — a duplicate at this grain silently doubles
 *      nothing (there is nothing to sum) and instead makes the SAME question return two different
 *      answers depending on which row the reader's LIMIT 1 happened to pick, and the table has no grain
 *      UNIQUE to stop it;
 *   4. every category present has EXACTLY ONE `stage IS NULL` all-stages row;
 *   5. the POOLED distribution is the UNION of the per-stage ones — same distinct students, same billed
 *      total. (The two properties that DO hold. The mean and median emphatically do NOT recombine, which
 *      is why they are not asserted and must not be assumed.)
 *   6. no row exists for a category with an empty distribution.
 * A failure here is a defect in `aggregateSchoolFees`, not in the data, so it names the key.
 */
export function assertSchoolFeesInvariants(
  result: SchoolFeesResult,
  emisSchoolId: string,
): void {
  const seen = new Set<string>();
  for (const row of result.rows) {
    const where = `(${row.feeCategory}, ${row.stage ?? "all stages"})`;
    if (!(OV_FEE_CATEGORIES as readonly string[]).includes(row.feeCategory))
      throw new FeesTransformError(
        `${emisSchoolId}: ${where} carries fee_category "${String(row.feeCategory)}", which is not an ` +
          `ov_fee_category member (${OV_FEE_CATEGORIES.join("|")}).`,
      );
    if (
      row.stage !== null &&
      !(ANALYTICS_STAGES as readonly string[]).includes(row.stage)
    )
      throw new FeesTransformError(
        `${emisSchoolId}: ${where} carries stage "${String(row.stage)}", which is not a dim_stage key. ` +
          "stage IS NULL means the ALL-STAGES row; an unresolved stage reaches no row at all.",
      );
    const distribution = result.distributions.get(
      distributionKey(row.feeCategory, row.stage),
    );
    if (!distribution || distribution.length === 0)
      throw new FeesTransformError(
        `${emisSchoolId}: ${where} has a row but no per-student distribution — a group with no billed ` +
          "student must produce NO ROW.",
      );
    // CLAIM 2 — the stored figures are the ones this row's OWN distribution implies.
    const mean = ghsOf(meanPesewas(distribution));
    const median = ghsOf(medianPesewas(distribution));
    if (row.meanAmount !== mean)
      throw new FeesTransformError(
        `${emisSchoolId}: ${where} stores mean_amount ${row.meanAmount} but its own per-student ` +
          `distribution implies ${mean} — the mean is RE-DERIVED from the distribution and is never ` +
          "taken from an upstream figure or another row.",
      );
    if (row.medianAmount !== median)
      throw new FeesTransformError(
        `${emisSchoolId}: ${where} stores median_amount ${row.medianAmount} but its own per-student ` +
          `distribution implies ${median}.`,
      );
    for (const [field, value] of [
      ["mean_amount", row.meanAmount],
      ["median_amount", row.medianAmount],
    ] as const) {
      if (!/^-?\d+\.\d{2}$/.test(value))
        throw new FeesTransformError(
          `${emisSchoolId}: ${where} ${field} "${value}" is not a numeric(10,2) literal.`,
        );
      if (Math.abs(Math.round(Number(value) * 100)) > MAX_PESEWAS)
        throw new FeesTransformError(
          `${emisSchoolId}: ${where} ${field} ${value} does not fit numeric(10,2) ` +
            "(±99,999,999.99) — fact_fees would reject the row at the INSERT.",
        );
    }
    // CLAIM 3 — the key appears once. NULL-safe by construction: the all-stages row's key is distinct
    // from every stage key, and from an (impossible) empty-string stage.
    const key = `${row.feeCategory}\u0000${row.stage ?? "\u0001ALL"}`;
    if (seen.has(key))
      throw new FeesTransformError(
        `${emisSchoolId}: duplicate ${where} row — fact_fees has NO grain UNIQUE, so a duplicate ` +
          "inserts happily and makes the same question return two different answers.",
      );
    seen.add(key);
  }

  for (const category of result.categories) {
    const stageRows = result.rows.filter(
      (r) => r.feeCategory === category && r.stage !== null,
    );
    const allStages = result.rows.filter(
      (r) => r.feeCategory === category && r.stage === null,
    );
    // CLAIM 4 — exactly one all-stages row per category. Its ABSENCE is the serious direction: the
    // whole-school figure is NOT recoverable from the stage rows, so a missing all-stages row is a
    // figure that simply does not exist anywhere.
    if (allStages.length !== 1)
      throw new FeesTransformError(
        `${emisSchoolId}: category ${category} has ${allStages.length} stage IS NULL rows; exactly one ` +
          "is required. The all-stages figure cannot be reconstructed from the per-stage rows (means " +
          "and medians do not recombine), so it must be materialised exactly once.",
      );
    // CLAIM 5 — the pooled distribution is the UNION of the per-stage ones, on COUNT and on TOTAL.
    const pooledDistribution = result.distributions.get(distributionKey(category, null))!;
    const stageCount = stageRows.reduce(
      (t, r) => t + result.distributions.get(distributionKey(category, r.stage))!.length,
      0,
    );
    const stageTotal = stageRows.reduce(
      (t, r) =>
        t +
        result.distributions
          .get(distributionKey(category, r.stage))!
          .reduce((s, v) => s + v, 0),
      0,
    );
    if (pooledDistribution.length !== stageCount)
      throw new FeesTransformError(
        `${emisSchoolId}: category ${category}'s pooled distribution covers ` +
          `${pooledDistribution.length} billed pupil(s) but its stage rows cover ${stageCount} — the ` +
          "pooled distribution must be the UNION of the per-stage ones (each pupil has one class, so " +
          "one stage).",
      );
    const pooledTotal = pooledDistribution.reduce((t, v) => t + v, 0);
    if (pooledTotal !== stageTotal)
      throw new FeesTransformError(
        `${emisSchoolId}: category ${category}'s pooled billed total is ${ghsOf(pooledTotal)} GHS but ` +
          `its stage rows total ${ghsOf(stageTotal)} GHS.`,
      );
  }
}

// ── the write ───────────────────────────────────────────────────────────────────────────────────

/**
 * ONE TERM's computed rows, with the DELETE SCOPE stated explicitly.
 *
 * The scope is "every school this run SUCCESSFULLY COMPUTED FOR THIS TERM" — which includes a school
 * that computed to ZERO rows (every invoiced pupil out-of-scope/unmapped), so an emptied category really
 * empties. It EXCLUDES — deliberately — a school with NO BILLED INVOICES AT ALL in the term. That school
 * is not computed, so it is not in the delete scope and KEEPS ITS PRIOR ROWS: stale-but-honest. The case
 * must be DISTINGUISHED from the one it resembles and is not:
 *     NO INVOICES IN THE TERM   → not computed, no rows written, prior rows kept. "We do not know."
 *     BILLED ZERO               → computed: a REAL row, mean 0.00 / median 0.00. The Free SHS signal,
 *                                 and the row a "treat zero as no data" reader would erase.
 */
export interface FeesWriteBatch {
  periodId: string;
  /** SCHOOL-level jurisdiction ids successfully computed FOR THIS TERM. THE DELETE BOUND. */
  jurisdictionIds: string[];
  rows: FactFeesRow[];
}

export interface FeesWriteResult {
  deleted: number;
  inserted: number;
  perPeriod: { periodId: string; deleted: number; inserted: number }[];
}

/**
 * DELETE-BY-(PERIOD, JURISDICTION ∈ SCOPE)-THEN-INSERT, **PER TERM**, inside the caller's transaction.
 * The properties `writeAttendanceFactsTx` documents hold here verbatim — bounded delete, ONE transaction
 * for the whole run, delete-then-insert rather than upsert, one batch per declared term — and are not
 * re-argued.
 *
 * ⚠ `fact_fees` IS ONE OF THE PK-ONLY ORIGINAL EIGHT (db/schema/fact.ts) — it has NO grain UNIQUE. A
 * duplicate at the full grain INSERTS HAPPILY, and because there is nothing to sum here it does not
 * inflate a total: it makes the SAME question return two different answers depending on which row the
 * reader's `LIMIT 1` or chart series happened to take — which is harder to notice than a doubled count,
 * because every individual figure still looks perfectly plausible. The POST-INSERT DUPLICATE ASSERTION
 * below is the only guard that exists.
 *
 * It is NULL-SAFE on `stage`, and that is not a detail: the `stage IS NULL` ALL-STAGES rows are
 * LEGITIMATE and must not be flagged, while a genuine EMPTY-STRING stage must not be collapsed INTO
 * them. So the key carries `stage IS NULL` as its own boolean alongside the coalesced text — NULL and ''
 * stay distinguishable, and a genuine duplicate of either is caught.
 */
export async function writeFeesFactsTx(
  tx: postgres.TransactionSql,
  batches: FeesWriteBatch[],
): Promise<FeesWriteResult> {
  const perPeriod: FeesWriteResult["perPeriod"] = [];
  let totalDeleted = 0;
  let totalInserted = 0;

  for (const batch of batches) {
    const { periodId, jurisdictionIds, rows: rowsToWrite } = batch;

    let deleted = 0;
    if (jurisdictionIds.length > 0) {
      const removed = await tx`
        delete from fact_fees
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
        fee_category: r.feeCategory,
        stage: r.stage,
        mean_amount: r.meanAmount,
        median_amount: r.medianAmount,
        source: r.source,
        as_of_date: r.asOfDate,
        etl_run_id: r.etlRunId,
      }));
      const result = await tx`insert into fact_fees ${tx(chunk)}`;
      inserted += result.count;
    }

    // THE DUPLICATE ASSERTION OVER THE FULL GRAIN — see the header. Inside the transaction, so tripping
    // it rolls the WHOLE RUN (all five arms) back. Period-wide on purpose: a duplicate left in this term
    // by an earlier buggy run must fail the run that notices it, not be skipped because tonight's scope
    // happened not to cover that school.
    const dupes = await tx<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id, fee_category,
               stage is null as is_all_stages,
               coalesce(stage, '') as stage_key
          from fact_fees
         where period_id = ${periodId}::uuid
         group by jurisdiction_id, period_id, fee_category, (stage is null),
                  coalesce(stage, '')
        having count(*) > 1
      ) d`;
    if ((dupes[0]?.n ?? 0) > 0)
      throw new Error(
        `fact_fees has ${dupes[0]!.n} duplicated grain key(s) ` +
          `(jurisdiction_id, period_id, fee_category, stage) for period ${periodId}. ` +
          "fact_fees has NO grain UNIQUE, so a duplicate inserts happily — and because nothing here is " +
          "summable it does not inflate a total, it makes the same question return two different " +
          "plausible answers. That is why this assertion exists.",
      );

    perPeriod.push({ periodId, deleted, inserted });
    totalDeleted += deleted;
    totalInserted += inserted;
  }

  return { deleted: totalDeleted, inserted: totalInserted, perPeriod };
}

/** The standalone form — its OWN transaction. The pipeline uses the `…Tx` form instead, so that all FIVE
 *  arms of one run are ONE transaction (see `lib/etl/pipeline.ts`). */
export async function writeFeesFacts(
  sql: postgres.Sql,
  batches: FeesWriteBatch[],
): Promise<FeesWriteResult> {
  return (await sql.begin(async (tx) =>
    writeFeesFactsTx(tx as unknown as postgres.TransactionSql, batches),
  )) as unknown as FeesWriteResult;
}
