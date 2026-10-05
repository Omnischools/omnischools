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
