import { sql } from "drizzle-orm";
import { withJurisdiction, type JurisdictionScope } from "@/lib/db/rls";
import { ok, rowsOf, unavailable, type Reading } from "./reading";

/**
 * PERIOD RESOLUTION FOR THE NATIONAL OVERVIEW — the one place a dashboard figure learns WHICH period
 * it is a figure OF.
 *
 * ⚠ `is_current` IS NOT UNIQUE PER ACADEMIC YEAR, so every lookup here pins `period_type`. Since the
 * `fact_infrastructure` ANNUAL re-grain, the TERM row and the derived ANNUAL row of the SAME
 * academic_year are BOTH `is_current = true` (db/schema/dim.ts says so in as many words, and
 * tests/fixtures/analytics-seed.sql carries that exact shape). An `is_current` lookup that does not
 * name a `period_type` therefore matches more than one row, and `limit 1` would make the choice
 * silently — handing the enrolment card a period its facts do not hang off. The pin is the whole
 * point of this module existing instead of an inline `where is_current` in each reader.
 *
 * `dim_period` carries no jurisdiction column, so `db/sql/policies.sql` leaves it readable at every
 * tier. The read still goes through `withJurisdiction()` because that is the app's single sanctioned
 * read path (lib/db/rls.ts), not because a predicate applies.
 *
 * Fail-soft, in the lib rather than at the call site: a period that cannot be resolved yields
 * `unavailable`, and the card that depends on it says so in words. See lib/oversight/reading.ts.
 */

export interface AnalyticsPeriod {
  periodId: string;
  academicYear: string;
  /** 1,2,3 on a TERM row; null on ANNUAL and EXAM_COHORT. */
  term: number | null;
  periodType: "TERM" | "ANNUAL" | "EXAM_COHORT";
}

/** The period types a dashboard read may pin. EXAM_COHORT is NOT here — see below. */
export type CurrentPeriodType = "TERM" | "ANNUAL";

function toPeriod(row: Record<string, unknown>): AnalyticsPeriod {
  return {
    periodId: row.period_id as string,
    academicYear: row.academic_year as string,
    term: row.term === null ? null : Number(row.term),
    periodType: row.period_type as AnalyticsPeriod["periodType"],
  };
}

/**
 * The CURRENT period of one explicitly-named type. `periodType` is a required argument and not a
 * default, so no caller can forget it.
 *
 * The allow-list is TERM | ANNUAL by TYPE, and EXAM_COHORT's absence is load-bearing rather than an
 * oversight: an exam sitting is a closed, immutable cohort and the ETL NEVER marks one current
 * (lib/etl/dimensions.ts `examCohortPeriodSpec`: "A sitting is never 'the current period'"). A
 * `getCurrentPeriod(scope, "EXAM_COHORT")` would therefore return nothing, for every sitting, for
 * ever — a permanently blank WASSCE card whose cause is invisible. `getLatestExamCohortPeriod()`
 * below is the sitting's resolver.
 */
export async function getCurrentPeriod(
  scope: JurisdictionScope,
  periodType: CurrentPeriodType,
): Promise<Reading<AnalyticsPeriod>> {
  try {
    return await withJurisdiction(scope, async (tx) => {
      const result = await tx.execute(sql`
        select dp.period_id::text   as period_id,
               dp.academic_year     as academic_year,
               dp.term              as term,
               dp.period_type::text as period_type
          from dim_period dp
         where dp.is_current = true
           -- MANDATORY. Without it this matches the TERM *and* the ANNUAL row of the same year.
           and dp.period_type = ${periodType}::period_type
         -- A tie would mean two current rows of ONE type (an ETL defect, not a readable state);
         -- order so the choice is at least deterministic rather than planner-dependent.
         order by dp.academic_year desc
         limit 1
      `);
      const row = rowsOf(result)[0];
      return row ? ok(toPeriod(row)) : unavailable<AnalyticsPeriod>();
    });
  } catch {
    return unavailable<AnalyticsPeriod>();
  }
}

/**
 * THE SITTING COHORT a performance figure belongs to: the most recent EXAM_COHORT period that
 * actually carries rows for this exam.
 *
 * ⚠ DEVIATION, FLAGGED. The slice brief routes the WASSCE card through
 * `getCurrentPeriod(scope, "EXAM_COHORT")`. That cannot work against this data model — no
 * EXAM_COHORT row is ever `is_current` (see above), in the demo seed or in the test fixture — so the
 * card would be permanently "Unavailable". "Latest sitting WITH WASSCE rows" is the honest
 * substitute: it still pins exactly ONE period_id (the §4 rule that matters — candidates from two
 * sittings are different children and must never be summed), it still pins `period_type`, and it
 * cannot resolve to a sitting that would then produce a 0/0 rate.
 *
 * The existence check is on `fact_performance_exam` and NOT on the period alone, because the two
 * exams sit on the SAME cohort period (separated by the fact's own `exam` column, never by the
 * period — lib/etl/dimensions.ts), so "the latest sitting" and "the latest sitting of THIS exam" are
 * genuinely different questions. The check is RLS-filtered like everything else, so a region whose
 * schools have no WASSCE rows for the newest national sitting resolves to ITS own latest sitting.
 */
export async function getLatestExamCohortPeriod(
  scope: JurisdictionScope,
  exam: "WASSCE" | "BECE",
): Promise<Reading<AnalyticsPeriod>> {
  try {
    return await withJurisdiction(scope, async (tx) => {
      const result = await tx.execute(sql`
        select dp.period_id::text   as period_id,
               dp.academic_year     as academic_year,
               dp.term              as term,
               dp.period_type::text as period_type
          from dim_period dp
         where dp.period_type = 'EXAM_COHORT'::period_type
           and exists (
             select 1
               from fact_performance_exam fpe
              where fpe.period_id = dp.period_id
                and fpe.exam = ${exam}::exam
           )
         -- academic_year is "(N-1)/N" for sitting year N, so a lexical sort IS chronological.
         order by dp.academic_year desc
         limit 1
      `);
      const row = rowsOf(result)[0];
      return row ? ok(toPeriod(row)) : unavailable<AnalyticsPeriod>();
    });
  } catch {
    return unavailable<AnalyticsPeriod>();
  }
}

/**
 * The SITTING CALENDAR YEAR an EXAM_COHORT `academic_year` describes — the inverse of
 * `examCohortAcademicYear()` in lib/etl/dimensions.ts (calendar year N → "(N-1)/N").
 *
 * The dashboard needs it because the WASSCE card names the sitting ("National · 2026 · credit or
 * above"), and that label must be DERIVED rather than typed: a hard-coded year is wrong the night
 * the next sitting loads, and silently so.
 */
export function sittingYearOf(academicYear: string): number | null {
  const match = /^(\d{4})\/(\d{2})$/.exec(academicYear);
  if (!match) return null;
  const startYear = Number(match[1]);
  // "2025/26" → the century of the START year carries over; the sitting concludes the second year.
  const candidate = Math.floor(startYear / 100) * 100 + Number(match[2]);
  // "2099/00" is the next century's 2100, not 2000 — the one case a bare carry-over gets wrong.
  return candidate < startYear ? candidate + 100 : candidate;
}
