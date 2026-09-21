import { sql } from "drizzle-orm";
import { withJurisdiction, type JurisdictionScope } from "@/lib/db/rls";
import type { OwnershipType } from "@/lib/oversight/consent";

/**
 * THE JURISDICTION CEILING AT THE GATE (Lucy §A1.1 step 2: "within Wassa Amenfi West only").
 *
 * Every school the gate will act on is resolved HERE, from the analytics register, under the
 * officer's own jurisdiction RLS (`ref_emis_school_register` is scoped by `ov_in_subtree`,
 * db/sql/policies.sql). A school outside the officer's subtree simply does not resolve, so the
 * ceiling is a property of the read rather than a check someone has to remember to write — a
 * district director cannot name a school in another region even by typing its EMIS id directly.
 *
 * `ownershipType` is read here and carried into the gate because the non-public feature flag must
 * be evaluated BEFORE any operational connection is opened (lib/oversight/consent.ts), and because
 * ownership must come from the GES register rather than from the school's own operational row: it
 * decides whether a consent branch is even offered, and a school should not be able to change that
 * by editing its own profile.
 */
export interface ResolvedSchool {
  emisSchoolId: string;
  name: string;
  ownershipType: OwnershipType | null;
  /** The SCHOOL-level `dim_jurisdiction` node, matched on `ges_code = emis_school_id`. */
  jurisdictionId: string | null;
  districtId: string | null;
  onSchoolup: boolean;
}

const SELECT_SCHOOLS = sql`
  select
    r.emis_school_id                 as emis_school_id,
    r.name                           as name,
    r.ownership_type::text           as ownership_type,
    dj.jurisdiction_id::text         as jurisdiction_id,
    r.district_id::text              as district_id,
    r.on_schoolup                    as on_schoolup
  from ref_emis_school_register r
  left join dim_jurisdiction dj
    on dj.ges_code = r.emis_school_id and dj.level = 'SCHOOL'
`;

function mapRow(row: Record<string, unknown>): ResolvedSchool {
  const ownership = row.ownership_type as string | null;
  return {
    emisSchoolId: row.emis_school_id as string,
    name: row.name as string,
    ownershipType:
      ownership === "PUBLIC" || ownership === "PRIVATE" || ownership === "MISSION"
        ? ownership
        : null,
    jurisdictionId: (row.jurisdiction_id as string | null) ?? null,
    districtId: (row.district_id as string | null) ?? null,
    onSchoolup: Boolean(row.on_schoolup),
  };
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (
    Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  ) as Record<string, unknown>[];
}

/** The gate's school picker. Returns only schools inside the officer's subtree. */
export async function listSchoolsInJurisdiction(
  scope: JurisdictionScope,
  limit = 200,
): Promise<ResolvedSchool[]> {
  return withJurisdiction(scope, async (tx) => {
    const result = await tx.execute(
      sql`${SELECT_SCHOOLS} order by r.name asc limit ${limit}`,
    );
    return rowsOf(result).map(mapRow);
  });
}

/** Null when the school does not exist OR is outside the officer's ceiling — the same answer. */
export async function resolveSchool(
  scope: JurisdictionScope,
  emisSchoolId: string,
): Promise<ResolvedSchool | null> {
  return withJurisdiction(scope, async (tx) => {
    const result = await tx.execute(
      sql`${SELECT_SCHOOLS} where r.emis_school_id = ${emisSchoolId} limit 1`,
    );
    const row = rowsOf(result)[0];
    return row ? mapRow(row) : null;
  });
}
