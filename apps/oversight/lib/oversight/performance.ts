import { sql } from "drizzle-orm";
import { examEnum } from "@/db/schema/_enums";
import { rowsOf, withJurisdiction, type JurisdictionScope } from "@/lib/db/rls";
import { ok, unavailable, type Reading } from "./reading";

/**
 * EXAM QUALIFICATION — the WASSCE KPI (Lucy §3.3 card 3): the share of candidates graded credit or
 * above (A1–C6).
 *
 * ═══ Σqualified ÷ Σcandidates — NEVER avg(qualification_rate) ════════════════════════════════════
 * `fact_performance_exam` stores the rate AND its two inputs, by the §4.2 doctrine: the stored rate
 * so a SINGLE-SCHOOL card is a no-math read, the inputs so a ROLL-UP can re-derive a correctly
 * weighted figure. A roll-up that averaged the stored rates would weight a 12-candidate school
 * equally with a 600-candidate one — "you cannot average rates" (db/schema/fact.ts). The error is
 * small when schools are similar and large exactly where it matters (a national figure across very
 * unequal schools), and it is invisible in the output. So this query never reads
 * `qualification_rate` at all; the column is not in the allow-list below, which is the structural
 * version of the rule.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `sex = 'ALL'` IS MANDATORY — the ALL row is stored beside MALE and FEMALE (db/schema/fact.ts), so
 * without it both sums TRIPLE. Note the rate would still come out *right* (the factor cancels in
 * numerator and denominator), which is what makes this one dangerous: nothing in the output signals
 * it, and the candidate count behind the figure would be three times the real cohort.
 *
 * EXACTLY ONE PERIOD, passed in. The 2025 and 2026 sittings are DIFFERENT CHILDREN; summing across
 * sittings produces a number with no referent (lib/etl/dimensions.ts). The caller pins the sitting
 * with `getLatestExamCohortPeriod(scope, exam)`.
 *
 * `exam` is a bound parameter cast to the `exam` enum, so an unknown value is a type error from
 * Postgres rather than a silent empty sum — and the TypeScript union makes it an allow-list of two.
 *
 * NO SUBTREE `WHERE`: RLS has already scoped the rows (`ov_in_subtree(jurisdiction_id)`), so Σ/Σ over
 * what is visible is the subtree's own weighted rate.
 */

/**
 * The exams the analytics DB knows about, DERIVED FROM THE SCHEMA rather than restated (Dex M2).
 *
 * It was hand-written as `"WASSCE" | "BECE"` in three signatures across two files, each a copy that
 * could drift from `examEnum` — and a drift here is not a type error anywhere: the value is
 * interpolated into `::exam`, so a stale member would be a Postgres cast failure at request time, on
 * the one surface that must not throw. Taken off `examEnum.enumValues`, adding a third exam to the
 * schema widens this automatically and the compiler finds the switch statements that have to grow.
 */
export type Exam = (typeof examEnum.enumValues)[number];

export interface ExamQualification {
  exam: Exam;
  candidates: number;
  qualified: number;
  /** Σqualified ÷ Σcandidates, in 0..1. Re-derived, never an average of stored rates. */
  rate: number;
}

export async function getExamQualification(
  scope: JurisdictionScope,
  exam: Exam,
  periodId: string,
): Promise<Reading<ExamQualification>> {
  try {
    return await withJurisdiction(scope, async (tx) => {
      // Explicit allow-list — and `qualification_rate` is absent from it ON PURPOSE (see above).
      const result = await tx.execute(sql`
        select coalesce(sum(fpe.candidates), 0)::bigint as candidates,
               coalesce(sum(fpe.qualified), 0)::bigint  as qualified,
               count(*)::int                            as row_count
          from fact_performance_exam fpe
         where fpe.period_id = ${periodId}::uuid
           and fpe.exam = ${exam}::exam
           -- Mandatory: the ALL row sits beside MALE/FEMALE. Without it both sums triple.
           and fpe.sex = 'ALL'::ov_sex
      `);
      const row = rowsOf(result)[0];
      if (!row) return unavailable<ExamQualification>();
      if (Number(row.row_count) === 0) return unavailable<ExamQualification>();
      const candidates = Number(row.candidates);
      const qualified = Number(row.qualified);
      // No candidates = no cohort = no rate. 0/0 is not 0%, and printing 0% would report every
      // school in the subtree as having failed.
      if (candidates === 0) return unavailable<ExamQualification>();
      return ok({ exam, candidates, qualified, rate: qualified / candidates });
    });
  } catch {
    return unavailable<ExamQualification>();
  }
}

/**
 * THE MULTI-YEAR QUALIFICATION SERIES (increment M, MULTI-YEAR-TREND-RULING M7/M8) — one
 * Σqualified ÷ Σcandidates PER SITTING, for ONE exam, across every EXAM_COHORT period that carries
 * rows in the officer's subtree.
 *
 * ═══ WHY THIS IS A NEW READ, NOT `getExamQualification` IN A LOOP ════════════════════════════════
 * A trend is a SERIES of per-sitting figures, each re-derived from that sitting's OWN candidates and
 * passes — NEVER a difference of stored per-school rates, and NEVER a sum across sittings (a 2025
 * candidate and a 2026 candidate are different children; lib/etl/dimensions.ts). So this groups by the
 * period's `academic_year` and re-derives Σ/Σ within each group, exactly as the single-period reader
 * does within one period. `qualification_rate` is NOT in the allow-list, for the same structural reason
 * it is absent from `getExamQualification`: a roll-up that averaged the stored rate would misweight a
 * 12-candidate school against a 600-candidate one.
 *
 * `sex = 'ALL'` IS MANDATORY (the ALL row sits beside MALE/FEMALE — without it every sum triples), and
 * `exam` is one bound value, so BECE and WASSCE are never pooled into one series.
 *
 * ORDERED CHRONOLOGICALLY (earliest first). `academic_year` is "(N-1)/N" for sitting year N, so a
 * lexical sort IS chronological (period.ts `getLatestExamCohortPeriod` relies on the same fact). A
 * sitting with no candidates in THIS subtree is EXCLUDED by the `having` clause rather than published as
 * a 0/0 point — 0/0 is not 0%, and a phantom point would pull a delta toward a cohort that does not
 * exist for this officer. The caller decides what "no comparator" renders (the flat em-dash pill, M9).
 *
 * NO SUBTREE `WHERE`: RLS has already scoped the rows, so each year's Σ/Σ is the subtree's own weighted
 * rate for that sitting — a region officer's series is its OWN schools' pooled rate per year (M20).
 *
 * GROUPS BY `academic_year`, NOT `period_id`: one series point per sitting YEAR is what a trend means, and
 * `refreshPeriods` upserts EXAM_COHORT rows keyed on exactly `(academic_year, term, period_type)` with the
 * sitting-year → "(N-1)/N" map bijective, so one academic_year resolves to exactly one EXAM_COHORT period.
 * Two EXAM_COHORT rows sharing an academic_year (which would pool two sittings here) therefore cannot be
 * produced by the pipeline; a unique constraint would be belt-and-braces, not a live fix, so none is added
 * (AC22 — no migration). The single-period card reader pins `period_id` because it wants exactly one.
 */

/** One sitting's re-derived figure. `academicYear` is the EXAM_COHORT period's "(N-1)/N" label. */
export interface ExamQualificationPoint {
  academicYear: string;
  candidates: number;
  qualified: number;
  /** Σqualified ÷ Σcandidates for THIS sitting, in 0..1. Re-derived, never an average of stored rates. */
  rate: number;
}

export interface ExamQualificationTrend {
  exam: Exam;
  /** Chronological, earliest first. Only sittings with candidates > 0 in the subtree. May be length 1. */
  points: ExamQualificationPoint[];
}

export async function getExamQualificationTrend(
  scope: JurisdictionScope,
  exam: Exam,
): Promise<Reading<ExamQualificationTrend>> {
  try {
    return await withJurisdiction(scope, async (tx) => {
      const result = await tx.execute(sql`
        select dp.academic_year                   as academic_year,
               coalesce(sum(fpe.candidates), 0)::bigint as candidates,
               coalesce(sum(fpe.qualified), 0)::bigint  as qualified
          from fact_performance_exam fpe
          join dim_period dp on dp.period_id = fpe.period_id
         where dp.period_type = 'EXAM_COHORT'::period_type
           and fpe.exam = ${exam}::exam
           -- Mandatory: the ALL row sits beside MALE/FEMALE. Without it every sum triples.
           and fpe.sex = 'ALL'::ov_sex
         group by dp.academic_year
         -- A sitting with no candidates here is EXCLUDED, not a 0/0 point (0/0 is not 0%).
        having coalesce(sum(fpe.candidates), 0) > 0
         -- "(N-1)/N" sorts chronologically, so earliest sitting first.
         order by dp.academic_year asc
      `);
      const points = rowsOf(result).map((row) => {
        const candidates = Number(row.candidates);
        const qualified = Number(row.qualified);
        return {
          academicYear: row.academic_year as string,
          candidates,
          qualified,
          rate: qualified / candidates,
        };
      });
      if (points.length === 0) return unavailable<ExamQualificationTrend>();
      return ok({ exam, points });
    });
  } catch {
    return unavailable<ExamQualificationTrend>();
  }
}

/** A year-over-year change against the sitting immediately before `academicYear`. */
export interface ExamQualificationYoy {
  /** The comparator sitting's "(N-1)/N" label (the one immediately before `academicYear`). */
  priorAcademicYear: string;
  /** The current sitting's re-derived rate, 0..1. Carried so the surface rounds endpoints the way it displays them. */
  currentRate: number;
  /** The comparator sitting's re-derived rate, 0..1. */
  priorRate: number;
  /** current.rate − prior.rate, in 0..1 (a 0.03 means "3 points"). Signed; may be exactly 0 (M10). */
  deltaRatio: number;
}

/**
 * The year-over-year delta for the sitting labelled `currentAcademicYear`, derived from a trend series
 * (MULTI-YEAR-TREND-RULING M7/M9/M10). Pure, so the pill's semantics are unit-testable without a DB.
 *
 * Returns `null` when there is NO prior-year comparator — the current sitting is the earliest in the
 * series, or is not in it at all. `null` is the "flat em-dash" state (M9): a claim about change that the
 * data does not support, which must never render as a fake `▲ 0%`. A genuine `deltaRatio === 0` (both
 * years present, equal re-derived rates) is a MEASURED no-change (M10) and is NOT null — the caller
 * renders it as a definite "no change", distinct from the em-dash.
 *
 * The delta is between the current sitting and the one IMMEDIATELY before it in the series (not a fixed
 * calendar year back), so a gap year — a sitting nobody in the subtree sat — compares against the last
 * sitting that genuinely happened rather than inventing a missing one.
 */
export function examQualificationYoy(
  points: readonly ExamQualificationPoint[],
  currentAcademicYear: string,
): ExamQualificationYoy | null {
  const currentIndex = points.findIndex((p) => p.academicYear === currentAcademicYear);
  // Not found, or it is the earliest point → no prior sitting to compare against.
  if (currentIndex <= 0) return null;
  const current = points[currentIndex]!;
  const prior = points[currentIndex - 1]!;
  return {
    priorAcademicYear: prior.academicYear,
    currentRate: current.rate,
    priorRate: prior.rate,
    deltaRatio: current.rate - prior.rate,
  };
}
