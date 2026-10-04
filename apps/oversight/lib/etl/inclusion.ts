import type postgres from "postgres";
import type { JurisdictionIndex } from "./dimensions";

/**
 * THE INCLUSION SET AND COVERAGE (scope §3, task H5).
 *
 * ═══ THE ASYMMETRY THAT *IS* THE COVERAGE FIGURE ════════════════════════════════════════════════
 *   inclusion set  = EMIS-REGISTERED **and** live on Omnischools
 *   register count = EMIS-REGISTERED, full stop
 * A school GES recognises but that is not on Omnischools is EXCLUDED FROM FACTS and STILL COUNTED IN
 * THE REGISTER. That is not a bug to be smoothed over — it is the measurement. Coverage is
 * `on_schoolup ÷ registered`, so the only way coverage can read 100% is if every recognised school is
 * actually reporting. Filtering non-live schools out of the register instead would make coverage
 * identically 100% at every tier, for ever, which is the single most flattering and least true number
 * this product could print.
 *
 * NO CONSENT GATE. Statutory oversight: GES and MoE are regulators with mandatory oversight of every
 * recognised school, so there is no opt-in to gate the ETL on (see the note at the end of
 * `db/schema/ref.ts`). The inclusion set is register ∧ live, and nothing else.
 *
 * ═══ WHY `operational_school_id` IS PART OF BEING INCLUDED ══════════════════════════════════════
 * A school flagged `on_schoolup` whose `operational_school_id` is NULL is registered, claims to be
 * live, and cannot be read: there is no tenant uuid to aggregate from. It is reported as an
 * UNMAPPED school rather than silently dropped, because the two have very different fixes (map it vs
 * onboard it) and because an unmapped school would otherwise depress every figure with no trace.
 *
 * ═══ THE DELETE SCOPE (the trap scope §3 names explicitly) ══════════════════════════════════════
 * Idempotency is delete-then-insert, and the delete MUST be bounded by
 * `(period_id, jurisdiction_id ∈ this run's inclusion set)`. A bare period-wide delete would wipe the
 * rows of schools that dropped out of the inclusion set since the last run and never re-insert them —
 * so a district total would SHRINK with no error and no empty table to notice. `includedJurisdictionIds`
 * is the bound, and `lib/etl/infrastructure.ts` takes it as a required argument for that reason.
 */

export interface IncludedSchool {
  emisSchoolId: string;
  /** SCHOOL-level `dim_jurisdiction.jurisdiction_id` — the fact row's grain key. */
  jurisdictionId: string;
  /** The operational tenant uuid to aggregate from. */
  operationalSchoolId: string;
}

export interface CoverageFigures {
  /** Every row in `ref_emis_school_register` — the Y. */
  registered: number;
  /** Registered AND `on_schoolup` — the X. */
  onSchoolup: number;
  /** Registered, `on_schoolup`, AND resolvable to a jurisdiction node + a tenant uuid. */
  included: number;
  /** `on_schoolup` but no `operational_school_id` — reported, never silently dropped. */
  unmapped: string[];
  /** `on_schoolup` but no SCHOOL node in `dim_jurisdiction` — a dimension-refresh defect. */
  unresolved: string[];
}

export interface InclusionResult {
  schools: IncludedSchool[];
  coverage: CoverageFigures;
}

/**
 * Build the inclusion set from the LOADED REGISTER (not from the extract file), so what the run
 * includes is exactly what the register says — the same table every coverage figure is read from.
 */
export async function buildInclusionSet(
  sql: postgres.Sql,
  index: JurisdictionIndex,
): Promise<InclusionResult> {
  const rows = await sql<
    {
      emis_school_id: string;
      on_schoolup: boolean;
      operational_school_id: string | null;
    }[]
  >`
    select emis_school_id, on_schoolup, operational_school_id::text as operational_school_id
      from ref_emis_school_register
     order by emis_school_id`;

  const registered = rows.length;
  const live = rows.filter((r) => r.on_schoolup);
  const unmapped: string[] = [];
  const unresolved: string[] = [];
  const schools: IncludedSchool[] = [];

  for (const row of live) {
    const jurisdictionId = index.schools.get(row.emis_school_id);
    if (!jurisdictionId) {
      unresolved.push(row.emis_school_id);
      continue;
    }
    if (!row.operational_school_id) {
      unmapped.push(row.emis_school_id);
      continue;
    }
    schools.push({
      emisSchoolId: row.emis_school_id,
      jurisdictionId,
      operationalSchoolId: row.operational_school_id,
    });
  }

  return {
    schools,
    coverage: {
      registered,
      onSchoolup: live.length,
      included: schools.length,
      unmapped,
      unresolved,
    },
  };
}

/** The bound for every delete this run performs. See THE DELETE SCOPE above. */
export function includedJurisdictionIds(result: InclusionResult): string[] {
  return result.schools.map((s) => s.jurisdictionId);
}
