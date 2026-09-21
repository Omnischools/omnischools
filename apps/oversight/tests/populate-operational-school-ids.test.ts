import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { adminAnalytics, adminOperational, testDbConfig } from "./helpers";
import { populateOperationalSchoolIds } from "@/scripts/populate-operational-school-ids";

/**
 * #1 — operational-school-uuid populate.
 *
 * Reads operational `ref_school` (a PRIVILEGED cross-tenant reader — here the superuser, standing in
 * for the broad ETL reader; the §6 read-back role is RLS-scoped and cannot enumerate, proved below),
 * and writes analytics `ref_emis_school_register.operational_school_id` as the owner. Dedicated
 * ETL-* rows isolate the probe from the §6 gate fixtures, and populating the seeded on_schoolup rows
 * only ever restores them to their existing (identical) ids, so the shared DB is left as it was.
 */

const OP_A = "aa000000-0000-4000-8000-000000000001"; // ref_school ETL-MATCH-A → register match
const OP_B = "aa000000-0000-4000-8000-000000000002"; // ref_school ETL-MATCH-B → on_schoolup=false
const OP_NOREG = "aa000000-0000-4000-8000-000000000003"; // ref_school with NO register row

let analyticsSql: postgres.Sql;
let operationalSql: postgres.Sql;

async function opId(emisSchoolId: string): Promise<string | null> {
  const rows = await analyticsSql<{ op: string | null }[]>`
    select operational_school_id::text as op from ref_emis_school_register
    where emis_school_id = ${emisSchoolId}`;
  return rows[0]?.op ?? null;
}

beforeAll(async () => {
  analyticsSql = adminAnalytics();
  operationalSql = adminOperational();

  await operationalSql`
    insert into ref_school (id, name, ges_code, ownership_type) values
      (${OP_A}, 'ETL Match A', 'ETL-MATCH-A', 'PUBLIC'),
      (${OP_B}, 'ETL Match B', 'ETL-MATCH-B', 'PUBLIC'),
      (${OP_NOREG}, 'ETL No Register', 'ETL-NOREG', 'PUBLIC')
    on conflict (id) do nothing`;

  await analyticsSql`
    insert into ref_emis_school_register (emis_school_id, name, on_schoolup, operational_school_id, as_of_date) values
      ('ETL-MATCH-A', 'ETL Match A', true,  null, current_date),
      ('ETL-MATCH-B', 'ETL Match B', false, null, current_date),
      ('ETL-NOOPS',   'ETL No Ops',  true,  null, current_date)
    on conflict (emis_school_id) do nothing`;
});

afterAll(async () => {
  await analyticsSql`delete from ref_emis_school_register where emis_school_id in ('ETL-MATCH-A','ETL-MATCH-B','ETL-NOOPS')`;
  await operationalSql`delete from ref_school where id in (${OP_A}, ${OP_B}, ${OP_NOREG})`;
  await analyticsSql.end({ timeout: 5 });
  await operationalSql.end({ timeout: 5 });
});

describe("populate-operational-school-ids (#1)", () => {
  it("populates only on_schoolup=true exact matches; leaves the rest NULL", async () => {
    const result = await populateOperationalSchoolIds({ operationalSql, analyticsSql });

    // AC-1.2 — the on_schoolup=true row whose ges_code matches an operational school gets that id.
    expect(await opId("ETL-MATCH-A")).toBe(OP_A);
    // AC-1.4 — never school A's id on school B's row.
    expect(await opId("ETL-MATCH-A")).not.toBe(OP_B);
    // AC-1.3 — on_schoolup=false is never touched.
    expect(await opId("ETL-MATCH-B")).toBeNull();
    // AC-1.4 — an on_schoolup register row with no operational match stays NULL.
    expect(await opId("ETL-NOOPS")).toBeNull();

    // AC-1.4 — the operational school with NO register row (ETL-NOREG) is written nowhere.
    const [{ n }] = await analyticsSql<{ n: number }[]>`
      select count(*)::int n from ref_emis_school_register where operational_school_id = ${OP_NOREG}::uuid`;
    expect(n).toBe(0);

    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(result.skippedNotOnSchoolup).toBeGreaterThanOrEqual(1);
    expect(result.skippedNoMatch).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent — a second run leaves the same values", async () => {
    await populateOperationalSchoolIds({ operationalSql, analyticsSql });
    expect(await opId("ETL-MATCH-A")).toBe(OP_A);
    expect(await opId("ETL-MATCH-B")).toBeNull();
  });

  it("fails LOUD when the operational read is the RLS-scoped read-back role (returns zero rows)", async () => {
    // The §6 read-back role's ref_school tenant_isolation returns 0 rows with no app.current_school,
    // so a bulk populate over it would silently populate nothing. The guard turns that into an error.
    const readback = postgres(testDbConfig.operationalUrl, { max: 1, prepare: false });
    try {
      await expect(
        populateOperationalSchoolIds({ operationalSql: readback, analyticsSql }),
      ).rejects.toThrow(/ZERO rows/i);
    } finally {
      await readback.end({ timeout: 5 });
    }
  });
});
