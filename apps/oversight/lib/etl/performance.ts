import type postgres from "postgres";
import type { TerminalExamSourceRow, WaecExtractCohortRow } from "./performance-source";
import { stampProvenance, type EtlSource } from "./run";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `terminal_exam_result` → `fact_performance_exam` — THE TRANSFORM AND THE WRITE (task H14, Kofi's
 * ruling).
 *
 * The THIRD fact slice, and the third arm of the SAME nightly run. It reuses the proven machinery
 * wholesale — the ETL harness, the dimension refresh, the EMIS register, the inclusion set, the
 * provenance stamper, per-school compute isolation, delete-then-insert inside the run's single
 * transaction — and adds exactly two new things: an EXAM_COHORT period, and a SECOND SOURCE for one
 * table.
 *
 * ── THE GRAIN ──────────────────────────────────────────────────────────────────────────────────
 *     (jurisdiction_id, period_id[EXAM_COHORT], exam, sex)
 * One row-set per school per SITTING, `period_type = 'EXAM_COHORT'`, `term IS NULL`, resolved from the
 * sitting calendar year by `examCohortAcademicYear()` (lib/etl/dimensions.ts). One EXAM_COHORT period
 * per sitting year carries BOTH exams; they are separated by the `exam` column, never by the period.
 *
 * ⚠ `source` IS PROVENANCE AND IS **NOT** PART OF THE GRAIN. It records WHO SAID SO — the school's own
 * keyed figures (SCHOOL_ENTERED) or the official extract (WAEC_EXTRACT) — and if it were part of any
 * uniqueness key then BOTH sources could insert the same cohort and every roll-up above it would
 * DOUBLE, while staying internally consistent at every tier and therefore invisible. Instead the
 * precedence WAEC_EXTRACT > SCHOOL_ENTERED is resolved AT WRITE TIME to exactly ONE surviving row per
 * (jurisdiction, period, exam, sex) — see `collapseBySourcePrecedence` — and the post-insert duplicate
 * assertion is the enforcement backstop.
 *
 * ── TIME SEMANTICS: A PER-COHORT SNAPSHOT. NOT A STOCK AND NOT A FLOW. ─────────────────────────
 * DO NOT reuse `fact_infrastructure`'s ANNUAL stock ruling or `fact_enrolment`'s roll ruling here. A
 * sitting is a CLOSED COHORT of candidates who sat once:
 *   · SUM SPATIALLY, across schools, within ONE (period_id, exam). That is the district/region/national
 *     figure, and it is exact.
 *   · NEVER SUM ACROSS PERIODS/SITTINGS. The 2025 and 2026 BECE candidates are DIFFERENT CHILDREN, and
 *     adding two sittings does not produce a bigger cohort — it produces a number with no referent. (It
 *     is not the stock mistake either: nothing is double-counted, the quantity simply is not additive
 *     over time.) A multi-year trend is a SERIES of per-sitting figures, never a sum.
 *   · A SITTING IS IMMUTABLE once filed, which is exactly why BACKFILLING past sittings is legitimate
 *     and why this arm — unlike the enrolment arm — runs for EVERY declared cohort, not just the current
 *     year. The 2025 figures do not change because it is now 2026.
 *
 * ── `qualified := passed`. ENTERED, UNTHRESHOLDED (GOV6-03). ───────────────────────────────────
 * `qualified = female_passed + male_passed`, copied. The operational system applies NO GRADE THRESHOLD
 * (apps/web/lib/reports/terminal-results-data.ts: "`passed` is the ENTERED WAEC outcome (no mark
 * threshold applied)"), and this transform MUST NOT invent one: there is no grade scale in the source to
 * recompute from — no grades at all, only counts — so any "credit or above" recomputation here would be
 * a fabrication. `db/schema/fact.ts`'s column comment ("graded credit-or-above") describes what a WAEC
 * extract will one day mean by it; on the SCHOOL_ENTERED arm it means whatever the school meant by
 * "passed", and that is the honest reading of the only figure that exists.
 *
 * ── THE RATE IS RE-DERIVED PER ROW, NEVER SUMMED AND NEVER AVERAGED ────────────────────────────
 *     qualification_rate = round(qualified / candidates * 100, 2)
 * computed from THAT ROW'S OWN two counts — including the synthesised ALL row, whose rate comes from
 * ALL's candidates and ALL's qualified and is NOT the mean of the MALE and FEMALE rates (you cannot
 * average rates over unequal denominators). A zero-candidate sex row yields 0.00 rather than a
 * divide-by-zero, mirroring the operational reader's own `totalCandidates > 0` guard. Both inputs are
 * stored beside the rate so a roll-up re-derives a correctly weighted figure from summed counts (§4.2
 * doctrine), and ALL always has candidates ≥ 1 because the operational CHECK guarantees it.
 *
 * ── SEX: 'ALL' IS SYNTHESISED, AND THE INVARIANT IS STRICT EQUALITY ────────────────────────────
 * The source's four leaves are per-sex and NOT NULL, so MALE and FEMALE are read and 'ALL' is computed
 * here as MALE + FEMALE — never read, never approximated. Per (jurisdiction, period, exam), asserted
 * per school BEFORE the write:
 *       candidates(ALL) = candidates(MALE) + candidates(FEMALE)
 *       qualified(ALL)  = qualified(MALE)  + qualified(FEMALE)
 * STRICT equality, because there is no third category and no unknown-sex bucket to absorb a difference.
 *
 * ⚠ AND THE ONE PLACE THAT EQUALITY DOES **NOT** HOLD IN THE TABLE: a MIXED cohort. The WAEC extract
 * supplies `sex = 'ALL'` only, so when both sources cover one (school, sitting, exam) the precedence
 * collapse replaces ONLY the contested ALL key and the MALE/FEMALE rows remain the SCHOOL'S OWN. For such
 * a school ALL ≠ MALE + FEMALE, because the total and the split are then measurements by DIFFERENT
 * AUTHORITIES of the same sitting. That is the precedence ruling applied literally — the alternative
 * (deleting a split WAEC cannot replace, or scaling it to WAEC's total) would either destroy the only
 * sex information that exists or fabricate it. Hence the strict equality is asserted PER ARM at transform
 * time, never over the mixed table, and a reader comparing the two must expect the official total to win.
 *
 * ⚠ THE COROLLARY FOR EVERY READER: a roll-up above the school MUST filter `sex = 'ALL'` (or
 * `sex IN ('MALE','FEMALE')` for the split) AND to ONE `exam` AND to ONE `period_id`. Omitting the sex
 * filter doubles every figure; omitting the exam filter mixes two different cohorts of children; and
 * `tests/etl-performance.test.ts` states both, executably, in both directions.
 *
 * ── THREE LANDMINES, WRITTEN DOWN BECAUSE NOTHING IN THE DATA SAYS THEM ────────────────────────
 *  1. `candidates` IS PRESENTED CANDIDATES — the children the school ENTERED for the exam. It is NOT
 *     final-year enrolment. Absentees, withdrawals, repeaters and private entries all move it away from
 *     any roll figure, so this slice DELIBERATELY DOES NOT RECONCILE it against `fact_enrolment`, and no
 *     reader should: a "candidates ≠ JHS3 roll" gap is normal, not an anomaly.
 *  2. `candidates − qualified` IS NOT "FAILED". It conflates genuine failures with candidates who were
 *     absent, whose results were withheld or cancelled, and whose entries were incomplete. The source
 *     has NO FIELD for any of those, so the difference cannot be decomposed — label it "not qualified",
 *     never "failed".
 *  3. SCHOOL_ENTERED COVERS THE REGULAR MAY/JUNE SITTING ONLY. Omnischools captures one row per exam per
 *     year; NovDec and private-candidate sittings are not in the source at all, so they are absent from
 *     these figures rather than filtered out of them.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Raised for a sitting this ETL refuses to aggregate. Per-school isolated by `computePerSchool`. */
export class PerformanceTransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerformanceTransformError";
  }
}

/** The analytics exam vocabulary (`exam`). Mapped 1:1 from operational `exam_type`. */
export const EXAMS = ["BECE", "WASSCE"] as const;
export type Exam = (typeof EXAMS)[number];

/** The analytics sex vocabulary (`ov_sex`). MALE/FEMALE are read; ALL is synthesised. */
export const EXAM_SEXES = ["MALE", "FEMALE", "ALL"] as const;
export type ExamSex = (typeof EXAM_SEXES)[number];

/** One `fact_performance_exam` row, ready to insert. Column-for-column with `db/schema/fact.ts`. */
export interface FactPerformanceExamRow {
  jurisdictionId: string;
  periodId: string;
  exam: Exam;
  sex: ExamSex;
  /** PRESENTED candidates — not final-year enrolment. See landmine 1. */
  candidates: number;
  /** ENTERED passes, unthresholded (GOV6-03). `candidates − qualified` is NOT "failed" — landmine 2. */
  qualified: number;
  /** `round(qualified/candidates*100, 2)` from THIS row's own counts, as a numeric(5,2) literal. */
  qualificationRate: string;
  /** PROVENANCE ONLY — never part of the grain. SCHOOL_ENTERED here; WAEC_EXTRACT on the other arm. */
  source: EtlSource;
  asOfDate: string;
  etlRunId: string;
}

/** One school's aggregated sittings for ONE cohort: the rows to write, plus what is not a row. */
export interface SchoolPerformanceResult {
  rows: FactPerformanceExamRow[];
  /** The exams this school filed for this sitting — BECE, WASSCE, or both (a COMBINED school). */
  exams: Exam[];
  /** Σ candidates over the sex='ALL' rows, across the exams filed. A COUNT — never a rate input. */
  candidates: number;
  /** Σ qualified over the sex='ALL' rows, across the exams filed. */
  qualified: number;
}

/**
 * `round(qualified/candidates*100, 2)`, as the string a `numeric(5,2)` column takes.
 *
 * ZERO CANDIDATES → "0.00", not NaN and not a throw. A single-sex school really does file
 * `female_candidates = 0` (the operational CHECK only requires the two to sum to ≥ 1), so the
 * zero-denominator sex row is a NORMAL row, not a defect — exactly the case
 * `deriveTerminalSummary`'s own `totalCandidates > 0` guard exists for.
 */
export function qualificationRate(qualified: number, candidates: number): string {
  if (candidates <= 0) return "0.00";
  return (Math.round((qualified / candidates) * 10_000) / 100).toFixed(2);
}

/**
 * THE PURE AGGREGATION. No DB, no clock, no randomness — same source rows + same target in, same rows
 * out, which is what makes the idempotency test meaningful.
 *
 * It FAILS LOUDLY rather than coercing, and the failure costs ONE SCHOOL rather than the run
 * (`computePerSchool`): a sitting whose `exam_type` is outside the allow-list, whose counts are not
 * non-negative integers, or whose passes exceed its candidates is one nobody can honestly aggregate.
 * The exam allow-list check mirrors the drift discipline in `lib/etl/infrastructure.ts` — the
 * operational CHECK (`exam_type IN ('BECE','WASSCE')`) and the analytics `exam` enum must match
 * byte-for-byte, and if they ever drift this says so in the school's own failure message rather than
 * writing a row against an exam nobody has a rule for.
 */
export function aggregateSchoolSitting(
  sourceRows: TerminalExamSourceRow[],
  target: {
    jurisdictionId: string;
    periodId: string;
    emisSchoolId: string;
    etlRunId: string;
    /** The COHORT's frozen vintage — the sitting period's `ends_on`, never `now()`. */
    asOfDate: string;
  },
): SchoolPerformanceResult {
  const { emisSchoolId } = target;
  const byExam = new Map<Exam, TerminalExamSourceRow>();

  for (const row of sourceRows) {
    if (!(EXAMS as readonly string[]).includes(row.examType))
      throw new PerformanceTransformError(
        `${emisSchoolId}: exam_type "${row.examType}" is outside the allow-list ` +
          `${EXAMS.join("|")} — the operational CHECK (terminal_exam_result_exam_type_valid) and the ` +
          "analytics `exam` enum have drifted.",
      );
    const exam = row.examType as Exam;
    if (byExam.has(exam))
      throw new PerformanceTransformError(
        `${emisSchoolId}: two ${exam} sittings for year ${row.year} reached the transform — the source ` +
          "read is grouped by (school, exam_type, year), so a second one would double this cohort.",
      );
    for (const [field, value] of [
      ["female_candidates", row.femaleCandidates],
      ["male_candidates", row.maleCandidates],
      ["female_passed", row.femalePassed],
      ["male_passed", row.malePassed],
    ] as const)
      if (!Number.isInteger(value) || value < 0)
        throw new PerformanceTransformError(
          `${emisSchoolId}: ${exam} "${field}" must be a non-negative integer, got ${String(value)}.`,
        );
    // The operational per-sex CHECK (0 ≤ passed ≤ candidates), restated — because this ETL may one day
    // read a source that lost it (a CSV hand-off, a restored table), and a pass rate above 100% is the
    // kind of figure that gets screenshotted.
    if (row.femalePassed > row.femaleCandidates)
      throw new PerformanceTransformError(
        `${emisSchoolId}: ${exam} female_passed ${row.femalePassed} exceeds female_candidates ` +
          `${row.femaleCandidates} — a pass count can never exceed its sitters.`,
      );
    if (row.malePassed > row.maleCandidates)
      throw new PerformanceTransformError(
        `${emisSchoolId}: ${exam} male_passed ${row.malePassed} exceeds male_candidates ` +
          `${row.maleCandidates} — a pass count can never exceed its sitters.`,
      );
    byExam.set(exam, row);
  }

  // SCHOOL_ENTERED: the school keyed these figures itself. `as_of_date` is the COHORT's vintage, not the
  // run's clock — so a re-run of an unchanged sitting is byte-identical.
  const provenance = stampProvenance(target.etlRunId, target.asOfDate, "SCHOOL_ENTERED");
  const rows: FactPerformanceExamRow[] = [];
  const exams: Exam[] = [];
  let candidates = 0;
  let qualified = 0;

  // EXAMS order, not source order: the emitted row order is deterministic, which is what makes "a
  // re-run is byte-identical" meaningful rather than accidental.
  for (const exam of EXAMS) {
    const row = byExam.get(exam);
    if (!row) continue;
    exams.push(exam);
    const male = { candidates: row.maleCandidates, qualified: row.malePassed };
    const female = { candidates: row.femaleCandidates, qualified: row.femalePassed };
    const all = {
      candidates: male.candidates + female.candidates,
      qualified: male.qualified + female.qualified,
    };
    candidates += all.candidates;
    qualified += all.qualified;
    const base = {
      jurisdictionId: target.jurisdictionId,
      periodId: target.periodId,
      exam,
      ...provenance,
    };
    rows.push(
      // The rate on EVERY row — including ALL — is re-derived from that row's own two counts.
      {
        ...base,
        sex: "MALE" as const,
        ...male,
        qualificationRate: qualificationRate(male.qualified, male.candidates),
      },
      {
        ...base,
        sex: "FEMALE" as const,
        ...female,
        qualificationRate: qualificationRate(female.qualified, female.candidates),
      },
      {
        ...base,
        sex: "ALL" as const,
        ...all,
        qualificationRate: qualificationRate(all.qualified, all.candidates),
      },
    );
  }

  const result: SchoolPerformanceResult = { rows, exams, candidates, qualified };
  assertSchoolExamInvariants(result, emisSchoolId);
  return result;
}

/**
 * THE ARITHMETIC SELF-CHECK, per school, before anything is written.
 *
 * Four claims, all of them things a reader will rely on and none of them expressible as a table CHECK
 * (each spans several rows):
 *   1. every (exam, sex) key appears exactly once, and all three sexes are present;
 *   2. candidates(ALL) = candidates(MALE) + candidates(FEMALE) — STRICT;
 *   3. qualified(ALL)  = qualified(MALE)  + qualified(FEMALE)  — STRICT;
 *   4. every row's stored rate is the rate its OWN counts imply (so a summed or averaged rate, or a
 *      stale one left behind by an edit, cannot ship).
 * A failure here is a defect in `aggregateSchoolSitting`, not in the data, so it names the key.
 */
export function assertSchoolExamInvariants(
  result: SchoolPerformanceResult,
  emisSchoolId: string,
): void {
  const byKey = new Map<string, Map<ExamSex, FactPerformanceExamRow>>();
  for (const row of result.rows) {
    if (row.qualified > row.candidates)
      throw new PerformanceTransformError(
        `${emisSchoolId}: (${row.exam}, ${row.sex}) has qualified ${row.qualified} > candidates ` +
          `${row.candidates}.`,
      );
    if (row.qualificationRate !== qualificationRate(row.qualified, row.candidates))
      throw new PerformanceTransformError(
        `${emisSchoolId}: (${row.exam}, ${row.sex}) stores rate ${row.qualificationRate} but its own ` +
          `counts imply ${qualificationRate(row.qualified, row.candidates)} — the rate is re-derived ` +
          "per row, never summed and never averaged across the sex split.",
      );
    let sexes = byKey.get(row.exam);
    if (!sexes) {
      sexes = new Map<ExamSex, FactPerformanceExamRow>();
      byKey.set(row.exam, sexes);
    }
    if (sexes.has(row.sex))
      throw new PerformanceTransformError(
        `${emisSchoolId}: duplicate (${row.exam}, ${row.sex}) row — a duplicate at this grain silently ` +
          "doubles every roll-up above it.",
      );
    sexes.set(row.sex, row);
  }

  for (const [exam, sexes] of byKey) {
    const male = sexes.get("MALE");
    const female = sexes.get("FEMALE");
    const all = sexes.get("ALL");
    if (!male || !female || !all)
      throw new PerformanceTransformError(
        `${emisSchoolId}: ${exam} is missing one of MALE/FEMALE/ALL — the sex split and its total are ` +
          "written together or not at all.",
      );
    if (all.candidates !== male.candidates + female.candidates)
      throw new PerformanceTransformError(
        `${emisSchoolId}: ${exam} has candidates(ALL)=${all.candidates} but MALE+FEMALE=` +
          `${male.candidates + female.candidates}. sex='ALL' is SYNTHESISED and the equality is strict.`,
      );
    if (all.qualified !== male.qualified + female.qualified)
      throw new PerformanceTransformError(
        `${emisSchoolId}: ${exam} has qualified(ALL)=${all.qualified} but MALE+FEMALE=` +
          `${male.qualified + female.qualified}. sex='ALL' is SYNTHESISED and the equality is strict.`,
      );
  }
}

// ── the WAEC_EXTRACT arm (explicitly empty today — see lib/etl/performance-source.ts) ────────────

/**
 * Transform the WAEC extract's exam-level rows into fact rows. **WRITES `sex = 'ALL'` ONLY**, because
 * the extract carries no sex column at all (db/schema/ref.ts) — synthesising a split from a total is
 * the one thing this must never do, so MALE and FEMALE rows are ABSENT rather than zero.
 *
 * The documented asymmetry, binding on every reader: over a WAEC-ONLY cohort a
 * `sex IN ('MALE','FEMALE')` read returns NOTHING while `sex = 'ALL'` is complete. Absent is the honest
 * encoding — zeros would report "no girls sat the exam", which is a measurement and a false one.
 *
 * It is reachable, tested and today yields zero rows, because the feed is empty/absent.
 */
export function waecExtractFactRows(
  rows: WaecExtractCohortRow[],
  target: {
    periodId: string;
    etlRunId: string;
    /** emis_school_id → SCHOOL-level jurisdiction_id. An unresolvable school is SKIPPED, not guessed. */
    jurisdictionOf: (emisSchoolId: string) => string | undefined;
    /** Fallback vintage when an extract row carries none. The cohort's `ends_on`, never `now()`. */
    asOfDate: string;
  },
): FactPerformanceExamRow[] {
  const out: FactPerformanceExamRow[] = [];
  for (const row of rows) {
    if (!(EXAMS as readonly string[]).includes(row.exam))
      throw new PerformanceTransformError(
        `${row.emisSchoolId}: WAEC extract exam "${row.exam}" is outside the allow-list ` +
          `${EXAMS.join("|")}.`,
      );
    const jurisdictionId = target.jurisdictionOf(row.emisSchoolId);
    if (!jurisdictionId) continue; // not in the inclusion set: the extract is wider than the run
    out.push({
      jurisdictionId,
      periodId: target.periodId,
      exam: row.exam as Exam,
      // 'ALL' ONLY. See the header: there is no sex column to split by.
      sex: "ALL",
      candidates: row.candidates,
      qualified: row.qualified,
      qualificationRate: qualificationRate(row.qualified, row.candidates),
      ...stampProvenance(
        target.etlRunId,
        row.asOfDate ?? target.asOfDate,
        "WAEC_EXTRACT",
      ),
    });
  }
  return out;
}

// ── the write ───────────────────────────────────────────────────────────────────────────────────

/**
 * THE PRECEDENCE COLLAPSE — WAEC_EXTRACT > SCHOOL_ENTERED, resolved HERE, at write time.
 *
 * WHY IT IS A COLLAPSE AND NOT A UNIQUE KEY. `source` is PROVENANCE, not grain (see the module header):
 * if it were part of a uniqueness key, both sources would insert the same cohort and every roll-up above
 * it would double — internally consistent at every tier, and therefore invisible to every reader and
 * every reviewer. So exactly ONE row per (jurisdiction, period, exam, sex) survives, and when both
 * sources offer that key the WAEC one wins: the official extract is the authority, and the school's own
 * keyed figures are the stand-in used until it arrives.
 *
 * It is written and tested NOW even though only the SCHOOL_ENTERED arm is exercised, because the day the
 * WAEC feed lands is the day this would otherwise double the country.
 *
 * Order is preserved for the survivors (first-seen order per key), so the write stays deterministic.
 */
export function collapseBySourcePrecedence(
  rows: FactPerformanceExamRow[],
): FactPerformanceExamRow[] {
  const PRECEDENCE: Record<string, number> = { WAEC_EXTRACT: 2, SCHOOL_ENTERED: 1 };
  const rank = (row: FactPerformanceExamRow) => PRECEDENCE[row.source] ?? 0;
  const keyOf = (r: FactPerformanceExamRow) =>
    `${r.jurisdictionId}\u0000${r.periodId}\u0000${r.exam}\u0000${r.sex}`;
  const winners = new Map<string, FactPerformanceExamRow>();
  const order: string[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    const held = winners.get(key);
    if (!held) {
      winners.set(key, row);
      order.push(key);
      continue;
    }
    // Strictly greater: a second row of the SAME source does not replace the first (it is a defect, and
    // the post-insert duplicate assertion is not the place to discover it) — it is dropped, and the
    // per-school invariants above are what stop one being produced in the first place.
    if (rank(row) > rank(held)) winners.set(key, row);
  }
  return order.map((key) => winners.get(key)!);
}

/**
 * One cohort's computed rows, with the DELETE SCOPE stated explicitly.
 *
 * ⚠ WHY THE SCOPE IS NOT DERIVED FROM `rows` (as `writeInfrastructureFacts` derives it) — the same
 * ruling `fact_enrolment` follows, for a sharper reason here. A school in the inclusion set that filed
 * NO `terminal_exam_result` row for this sitting is NOT in the scope and KEEPS ITS PRIOR ROWS: a KG or
 * PRIMARY school never presents candidates at all, and a JHS that has not keyed its results yet is in a
 * normal, temporary state. Deleting their rows because tonight's read returned nothing would empty a
 * published sitting on the basis of an absence. Equally, a school that WAS computed is in the scope even
 * if it computed to zero rows, so a withdrawn filing really disappears.
 */
export interface PerformanceWriteBatch {
  periodId: string;
  /** SCHOOL-level jurisdiction ids successfully computed this run, for THIS cohort. THE DELETE BOUND. */
  jurisdictionIds: string[];
  rows: FactPerformanceExamRow[];
}

export interface PerformanceWriteResult {
  deleted: number;
  inserted: number;
  /** Rows dropped by the precedence collapse — SCHOOL_ENTERED keys a WAEC row superseded. */
  superseded: number;
  perPeriod: {
    periodId: string;
    deleted: number;
    inserted: number;
    superseded: number;
  }[];
}

/**
 * DELETE-BY-(PERIOD, JURISDICTION ∈ SCOPE)-THEN-INSERT, inside the caller's transaction. The three
 * properties `writeInfrastructureFacts` documents hold here verbatim — bounded delete, ONE transaction
 * for the whole run, delete-then-insert rather than upsert — and are not re-argued; read that header.
 *
 * ⚠ WHAT IS DIFFERENT, AND WHY IT IS THE MOST IMPORTANT TEN LINES IN THIS FILE:
 * `fact_performance_exam` IS ONE OF THE PK-ONLY ORIGINAL EIGHT (db/schema/fact.ts) — it has NO grain
 * UNIQUE. A duplicate at the full grain would therefore INSERT HAPPILY and silently DOUBLE every
 * roll-up above it, and the result would stay internally consistent at every tier (the doubled total
 * would still equal the doubled split, and the stored RATE would still read correctly because the
 * doubling cancels in the ratio — which is what makes this one dangerous). The POST-INSERT DUPLICATE
 * ASSERTION below is the only guard that exists, and it is also the ENFORCEMENT BACKSTOP for the
 * precedence collapse: if the collapse is ever bypassed, the run FAILS instead of publishing.
 *
 * The assertion is a PLAIN `group by jurisdiction_id, period_id, exam, sex having count(*) > 1`. It does
 * NOT need `fact_enrolment`'s NULL-safe coalesce dance, and copying it would only obscure the check:
 * EVERY column of this grain is NOT NULL (`exam` and `sex` are enums, both `notNull()`), so there is no
 * legitimate NULL to distinguish from an empty string and nothing for GROUP BY to collapse wrongly.
 */
export async function writePerformanceExamFactsTx(
  tx: postgres.TransactionSql,
  batches: PerformanceWriteBatch[],
): Promise<PerformanceWriteResult> {
  const perPeriod: PerformanceWriteResult["perPeriod"] = [];
  let totalDeleted = 0;
  let totalInserted = 0;
  let totalSuperseded = 0;

  for (const batch of batches) {
    const { periodId, jurisdictionIds } = batch;
    // THE PRECEDENCE COLLAPSE, before anything is written: one row per grain key, WAEC first.
    const rowsToWrite = collapseBySourcePrecedence(batch.rows);
    const superseded = batch.rows.length - rowsToWrite.length;

    let deleted = 0;
    if (jurisdictionIds.length > 0) {
      const removed = await tx`
        delete from fact_performance_exam
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
        exam: r.exam,
        sex: r.sex,
        candidates: r.candidates,
        qualified: r.qualified,
        qualification_rate: r.qualificationRate,
        source: r.source,
        as_of_date: r.asOfDate,
        etl_run_id: r.etlRunId,
      }));
      const result = await tx`insert into fact_performance_exam ${tx(chunk)}`;
      inserted += result.count;
    }

    // THE DUPLICATE ASSERTION OVER THE FULL GRAIN — see the header. Inside the transaction, so tripping
    // it rolls the whole run back. Period-wide on purpose: a duplicate left in this sitting by an
    // earlier buggy run must fail the run that notices it, not be skipped because tonight's scope
    // happened not to cover that school.
    const dupes = await tx<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id, exam, sex
          from fact_performance_exam
         where period_id = ${periodId}::uuid
         group by jurisdiction_id, period_id, exam, sex
        having count(*) > 1
      ) d`;
    if ((dupes[0]?.n ?? 0) > 0)
      throw new Error(
        `fact_performance_exam has ${dupes[0]!.n} duplicated grain key(s) ` +
          `(jurisdiction_id, period_id, exam, sex) for period ${periodId}. ` +
          "fact_performance_exam has NO grain UNIQUE, so a duplicate inserts happily and silently " +
          "DOUBLES every roll-up above it while the stored rate still reads correctly — which is why " +
          "this assertion exists, and why `source` is NOT part of the grain.",
      );

    perPeriod.push({ periodId, deleted, inserted, superseded });
    totalDeleted += deleted;
    totalInserted += inserted;
    totalSuperseded += superseded;
  }

  return {
    deleted: totalDeleted,
    inserted: totalInserted,
    superseded: totalSuperseded,
    perPeriod,
  };
}

/** The standalone form — its OWN transaction. The pipeline uses the `…Tx` form instead, so that all
 *  THREE arms of one run are ONE transaction (see `lib/etl/pipeline.ts`). */
export async function writePerformanceExamFacts(
  sql: postgres.Sql,
  batches: PerformanceWriteBatch[],
): Promise<PerformanceWriteResult> {
  return (await sql.begin(async (tx) =>
    writePerformanceExamFactsTx(tx as unknown as postgres.TransactionSql, batches),
  )) as unknown as PerformanceWriteResult;
}

/**
 * THE SEEDED-PERIOD ASSERTION (the `assertStagesSeeded` discipline, applied to the sitting calendar).
 *
 * `fact_performance_exam.period_id` is a FK to `dim_period`, so a sitting year the run cannot resolve to
 * an EXAM_COHORT period fails LATE — hundreds of rows into the write, as a raw foreign-key violation
 * naming a constraint — or, worse, is quietly skipped and the sitting is simply missing from the
 * dashboard with nothing to point at.
 *
 * So the run asserts UP FRONT that every sitting year PRESENT IN THE SOURCE resolves to a declared,
 * seeded EXAM_COHORT period, and the message carries the FIX AND THE NAMING RULE: calendar year N maps
 * to academic_year "(N-1)/N", `term IS NULL`, `period_type = 'EXAM_COHORT'`. Never a late FK error,
 * never a silent drop.
 */
export async function assertExamCohortPeriodsSeeded(
  sql: postgres.Sql,
  sittingYears: number[],
  academicYearOf: (sittingYear: number) => string,
): Promise<void> {
  if (sittingYears.length === 0) return;
  const wanted = new Map(sittingYears.map((y) => [academicYearOf(y), y]));
  const rows = await sql<{ academic_year: string }[]>`
    select academic_year from dim_period
     where period_type = 'EXAM_COHORT' and term is null
       and academic_year = any(${[...wanted.keys()]})`;
  const have = new Set(rows.map((r) => r.academic_year));
  const missing = [...wanted.entries()].filter(
    ([academicYear]) => !have.has(academicYear),
  );
  if (missing.length > 0)
    throw new Error(
      `dim_period has no EXAM_COHORT row for sitting year(s) ` +
        `${missing.map(([ay, y]) => `${y} (academic_year "${ay}")`).join(", ")}, but ` +
        "terminal_exam_result carries sittings for them. The naming rule is: sitting calendar year N → " +
        "academic_year \"(N-1)/N\", term IS NULL, period_type = 'EXAM_COHORT'. Declare the sitting in " +
        "the run's `examCohorts` option (the demo declares `DEMO_EXAM_COHORTS` in " +
        "scripts/seed-demo-data.ts) so step 2's refreshPeriods upserts it — fact_performance_exam." +
        "period_id is a FK to dim_period, so this would otherwise fail deep inside the write.",
    );
}
