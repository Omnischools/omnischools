import { sql } from "drizzle-orm";
import { withJurisdiction, type JurisdictionScope } from "@/lib/db/rls";
import { ok, rowsOf, unavailable, type Reading } from "./reading";

/**
 * TOTAL ENROLMENT — the National Overview's lead KPI (Lucy §3.3 card 1).
 *
 * ═══ THE TWO FILTERS ARE THE WHOLE QUERY ════════════════════════════════════════════════════════
 * `fact_enrolment` stores TOTALS BESIDE THEIR PARTS, twice over, so a sum with no filter is wrong in
 * two independent ways — and wrong by a factor, which means the result still LOOKS like a plausible
 * national enrolment:
 *
 *   1. `sex = 'ALL'` — the ETL writes the ALL row IN ADDITION to MALE and FEMALE (db/schema/fact.ts
 *      states the rule for every sexed fact table). Dropping this filter TRIPLES the figure.
 *   2. `class_form is null` — a null `class_form` IS the stage total ("Form 2" / "P4" rows sit beside
 *      it; see db/schema/fact.ts: "null when the row is a stage total"). Dropping this filter adds
 *      every per-form row to the stage total that already contains it, roughly DOUBLING the figure.
 *
 * Neither is enforceable by a constraint — there is no DB object that can tell a correct sum from an
 * inflated one — so they are a query-authoring rule, and tests/oversight-national-kpis.test.ts proves
 * each one is load-bearing by re-running the query without it.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * EXACTLY ONE PERIOD, passed in, never resolved here: enrolment is a FLOW measured per term, and two
 * terms of the same year count the same children twice. The caller pins the TERM period through
 * `getCurrentPeriod(scope, "TERM")` (lib/oversight/period.ts).
 *
 * NO SUBTREE `WHERE` CLAUSE. RLS has already restricted the visible rows to the officer's subtree
 * (`ov_in_subtree(jurisdiction_id)` on every fact table, db/sql/policies.sql), so Σ over what is
 * visible IS the subtree total — and a national officer's Σ is the national total because
 * `ov_is_national()` short-circuits the predicate. An app-side jurisdiction filter here would be a
 * second, hand-written copy of the ceiling: redundant when it agrees and a boundary bug when it does
 * not.
 *
 * `stage` is deliberately NOT summed-over-selectively: every stage total belongs in a national
 * enrolment figure, and the stage breakdown is a different surface.
 */

export interface EnrolmentTotal {
  /** Σ headcount over the pinned period's stage totals. */
  total: number;
  /**
   * Distinct SCHOOL jurisdictions that contributed a row — the "Across N reporting schools" sub-line.
   * Counted here rather than taken from the register's coverage numerator because this is the honest
   * denominator for THIS figure: schools that actually filed enrolment for the pinned term.
   */
  schoolsCounted: number;
}

export async function getEnrolmentTotal(
  scope: JurisdictionScope,
  periodId: string,
): Promise<Reading<EnrolmentTotal>> {
  try {
    return await withJurisdiction(scope, async (tx) => {
      // Explicit column allow-list (the lib/oversight/infrastructure.ts precedent): two named
      // aggregates, so a column added to fact_enrolment later cannot arrive here unasked.
      const result = await tx.execute(sql`
        select coalesce(sum(fe.headcount), 0)::bigint        as headcount_total,
               count(distinct fe.jurisdiction_id)::int       as schools_counted,
               count(*)::int                                 as row_count
          from fact_enrolment fe
         where fe.period_id = ${periodId}::uuid
           -- Both mandatory. See THE TWO FILTERS above; dropping either inflates the total.
           and fe.sex = 'ALL'::ov_sex
           and fe.class_form is null
      `);
      const row = rowsOf(result)[0];
      if (!row) return unavailable<EnrolmentTotal>();
      // An aggregate always returns a row, so "no rows matched" shows up as row_count = 0. That is
      // NOT a measured zero enrolment — it is the absence of a measurement, and `coalesce(...,0)`
      // would otherwise launder it into a confident "0 pupils".
      if (Number(row.row_count) === 0) return unavailable<EnrolmentTotal>();
      return ok({
        total: Number(row.headcount_total),
        schoolsCounted: Number(row.schools_counted),
      });
    });
  } catch {
    return unavailable<EnrolmentTotal>();
  }
}
