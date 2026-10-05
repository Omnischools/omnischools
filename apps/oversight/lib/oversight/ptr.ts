import { sql } from "drizzle-orm";
import { rowsOf, withJurisdiction, type JurisdictionScope } from "@/lib/db/rls";
import { ok, unavailable, type Reading } from "./reading";

/**
 * PUPIL–TEACHER RATIO — the National Overview's fourth KPI (Lucy §3.3 card 4), held back from slices
 * 1–3 because `fact_staffing` had no ETL producer. It does now (PR #385), so the card is additive.
 *
 * ═══ THE ROLL-UP IS Σenrolment ÷ Σteachers, NEVER avg(stored ptr) ═════════════════════════════════
 * `fact_staffing` stores a per-school `ptr`, but a national (or regional, or district) PTR is NOT the
 * mean of those. Averaging stored ratios weights a 40-pupil school the same as a 1,200-pupil one; the
 * honest tier figure divides the tier's total enrolment by the tier's total teachers. So this read
 * sums the two COUNTS — `enrolment_total` and `teachers_on_roll` — and divides once, here, after the
 * sum. The stored `ptr` column is deliberately NOT selected: it is a per-school presentation figure,
 * out of every roll-up allow-list (the same rule `lib/oversight/performance.ts` states for rates, and
 * `lib/oversight/breakdown.ts` restates for the per-child PTR column).
 *
 * `enrolment_total` is the staffing arm's OWN pinned roll (ETL §5: Σ fact_enrolment headcount at
 * `sex='ALL' AND class_form IS NULL`), so PTR divides exactly the roll the staffing row recorded —
 * not a second, independently-summed enrolment that might drift from it.
 *
 * ═══ EXACTLY ONE PERIOD, AND IT IS THE ANNUAL ONE ════════════════════════════════════════════════
 * `fact_staffing` is ANNUAL grain, one row per school per academic year (ETL §1): staff are a STOCK,
 * not a per-term flow, so summing two years' `teachers_on_roll` invents staff. The caller pins the
 * ANNUAL period through `getCurrentPeriod(scope, "ANNUAL")` (lib/oversight/period.ts) — NOT the TERM
 * period the enrolment card uses. `is_current` is true on both the TERM and the ANNUAL row of one
 * year, which is why the resolver pins `period_type`.
 *
 * NO SEX FILTER. `fact_staffing` has no `sex` column (it is a count of posts filled, never a sexed
 * cohort), so unlike enrolment there is no `sex='ALL'` pin to forget and no inflation to guard.
 *
 * NO SUBTREE `WHERE`. RLS (`ov_in_subtree(jurisdiction_id)`) has already bounded the visible rows to
 * the officer's subtree, so Σ over what is visible IS the subtree total; `ov_is_national()`
 * short-circuits it for a national officer. An app-side jurisdiction filter would be a second,
 * hand-written copy of the ceiling (the `lib/oversight/enrolment.ts` precedent, binding here).
 */

export interface PupilTeacherRatio {
  /** Σ enrolment_total ÷ Σ teachers_on_roll over the pinned ANNUAL period — the weighted tier PTR. */
  ratio: number;
  /** The numerator, carried so a caller can show the roll the ratio divides if it wants to. */
  enrolmentTotal: number;
  /** The denominator — total teachers on roll across the subtree's reporting schools. */
  teachersOnRoll: number;
  /** Distinct SCHOOL jurisdictions that contributed a staffing row — the honest "Across N" denominator. */
  schoolsCounted: number;
}

export async function getPupilTeacherRatio(
  scope: JurisdictionScope,
  periodId: string,
): Promise<Reading<PupilTeacherRatio>> {
  try {
    return await withJurisdiction(scope, async (tx) => {
      // Explicit column allow-list (the house precedent): two named SUMs of COUNTS, plus the honest
      // denominator and a row count. The stored `ptr` is NOT here — a roll-up never reads it.
      const result = await tx.execute(sql`
        select coalesce(sum(fs.enrolment_total), 0)::bigint   as enrolment_total,
               coalesce(sum(fs.teachers_on_roll), 0)::bigint  as teachers_on_roll,
               count(distinct fs.jurisdiction_id)::int        as schools_counted,
               count(*)::int                                  as row_count
          from fact_staffing fs
         where fs.period_id = ${periodId}::uuid
      `);
      const row = rowsOf(result)[0];
      if (!row) return unavailable<PupilTeacherRatio>();
      // An aggregate always returns a row, so "nothing matched" shows up as row_count = 0 — the
      // ABSENCE of a measurement, which `coalesce(...,0)` would otherwise launder into a false "0".
      if (Number(row.row_count) === 0) return unavailable<PupilTeacherRatio>();
      const enrolmentTotal = Number(row.enrolment_total);
      const teachersOnRoll = Number(row.teachers_on_roll);
      // The ETL guarantees teachers_on_roll ≥ 1 on every row, so Σ ≥ 1 whenever any row exists; a zero
      // here would be a data defect, and dividing by it is not a PTR — it is unstateable, so say so.
      if (teachersOnRoll === 0) return unavailable<PupilTeacherRatio>();
      return ok({
        ratio: enrolmentTotal / teachersOnRoll,
        enrolmentTotal,
        teachersOnRoll,
        schoolsCounted: Number(row.schools_counted),
      });
    });
  } catch {
    return unavailable<PupilTeacherRatio>();
  }
}
