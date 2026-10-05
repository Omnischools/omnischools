import { sql } from "drizzle-orm";
import { rowsOf, withJurisdiction, type JurisdictionScope } from "@/lib/db/rls";
import { ok, unavailable, type Reading } from "./reading";

/**
 * SCHOOL COVERAGE — "how much of the country can this dashboard actually see" (Lucy §3.3 card 2).
 *
 * ═══ THE DENOMINATOR IS THE REGISTER, AND THAT IS THE POINT ══════════════════════════════════════
 * reporting ÷ registered, both counted from `ref_emis_school_register`:
 *   reporting  = COUNT(*) WHERE on_schoolup       — schools live on Omnischools, i.e. feeding the ETL
 *   registered = COUNT(*)                         — every school EMIS knows about
 *
 * Counting the numerator from a fact table's `schools_reporting` instead would make this figure 100%
 * by construction: a school that files nothing has no fact row, so it would vanish from numerator AND
 * denominator together. The register is the only source that knows about the schools we CANNOT see,
 * which is the entire measurement. Lucy's map calls partial coverage "the honest national headline"
 * and an always-on state rather than an error; this query is where that is either true or quietly
 * false.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * NO PERIOD PIN. The register is single-vintage reference data (one row per school, carrying its own
 * `as_of_date`), not a per-period fact — there is nothing to pin and no double-count hazard.
 *
 * NO SUBTREE `WHERE`: `ref_emis_school_register` is RLS-scoped on `district_id`
 * (db/sql/policies.sql — a DIFFERENT column from the fact tables' `jurisdiction_id`, same
 * `ov_in_subtree` predicate), so both counts scope to the officer's subtree automatically and the
 * ratio is the subtree's own coverage. Confirmed against the policy, and exercised by the
 * tier-matrix fixtures (EMIS-OUT-008 is invisible to a Wassa Amenfi West officer).
 *
 * ⚠ `on_schoolup` IS NOT `dim_jurisdiction.is_reporting`. The two are kept in step by the ETL's
 * register load, and only the register one is a statement about the REGISTERED population — so only
 * it can be a coverage numerator.
 */

export interface SchoolCoverage {
  reporting: number;
  registered: number;
  /** reporting ÷ registered, in 0..1. */
  ratio: number;
  /**
   * Distinct regions present in the visible register — the "rolled up from N regions" claim the
   * PageHead lede and the provenance Source line make. Counted HERE, off the same RLS-scoped table
   * in the same round trip, rather than hard-coded as 16: at a region or district scope the honest
   * answer is 1, and "16" would be a statement about Ghana made on a page showing one district.
   *
   * ⚠ NULLABLE, AND THE TYPE IS THE FIX (Quinn L2 / Dex's widening of it). `region_id` is nullable on
   * `ref_emis_school_register`, so `count(distinct region_id)` is 0 for a register whose rows all
   * lack a region — a real state, and NOT "this subtree contains zero regions". It surfaced in two
   * separate sentences on the page, so gating each one would be two chances to forget. Returning
   * `null` instead makes "absent" un-ignorable at every call site: a third sentence added later
   * cannot print it without handling the absent case first.
   */
  regions: number | null;
}

export async function getSchoolCoverage(
  scope: JurisdictionScope,
): Promise<Reading<SchoolCoverage>> {
  try {
    return await withJurisdiction(scope, async (tx) => {
      // Explicit allow-list: three named aggregates over two columns (`on_schoolup`, `region_id`),
      // so the register's `name` and `operational_school_id` never cross into this process.
      const result = await tx.execute(sql`
        select count(*) filter (where r.on_schoolup)::int as reporting,
               count(*)::int                             as registered,
               count(distinct r.region_id)::int          as regions
          from ref_emis_school_register r
      `);
      const row = rowsOf(result)[0];
      if (!row) return unavailable<SchoolCoverage>();
      const reporting = Number(row.reporting);
      const registered = Number(row.registered);
      // An EMPTY register is not "0% coverage" — it is no register, so there is no ratio to state.
      // Dividing anyway would print a confident 0% for a subtree whose register simply has not loaded.
      if (registered === 0) return unavailable<SchoolCoverage>();
      const regions = Number(row.regions);
      return ok({
        reporting,
        registered,
        ratio: reporting / registered,
        // 0 distinct regions means the visible register names none, not that none exist — see the
        // field's note. Null here rather than a 0 the copy would happily pluralise.
        regions: regions === 0 ? null : regions,
      });
    });
  } catch {
    return unavailable<SchoolCoverage>();
  }
}
