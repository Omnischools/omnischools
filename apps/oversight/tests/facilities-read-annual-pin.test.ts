/**
 * Regression guard for the fact_infrastructure ANNUAL re-grain (two behaviours that the rest of the
 * suite does not otherwise pin, because no fixture places a fact row on a TERM period):
 *
 *   1. the facilities read is PINNED to the ANNUAL grain (`dp.period_type = 'ANNUAL'`), so a stale
 *      TERM-grain row for the SAME (school, academic_year) — the orphan shape the old pipeline left
 *      behind — cannot be served. The negative-control case re-states the pre-pin query shape to
 *      prove the pin is load-bearing, not decoration.
 *   2. migration 0005 deletes EXACTLY the non-ANNUAL fact_infrastructure rows, nothing else, and is
 *      idempotent on replay.
 *
 * Without this file, removing the `and dp.period_type = 'ANNUAL'` pin from
 * lib/oversight/infrastructure.ts leaves every committed test green while the facilities page
 * silently serves stale term-grain data. (Originated as a QA probe in Dex's B1 re-gate.)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { getSchoolFacilitiesCensus } from "@/lib/oversight/infrastructure";
import { JUR, PERIOD_ID_ANNUAL, PERIOD_ID_TERM } from "./fixtures/ids";
import { adminAnalytics, districtOfficer } from "./helpers";
import { scopeFor } from "@/lib/db/rls";

const scope = scopeFor(districtOfficer);
const ANNUAL_PERIOD = PERIOD_ID_ANNUAL;
const TERM_PERIOD = PERIOD_ID_TERM;
const MIGRATION = join(process.cwd(), "db/migrations/0005_lucky_sentinel.sql");

/** Clone the seeded ANNUAL census row onto the TERM period, with unmistakable values. */
async function insertStaleTermRow(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    insert into fact_infrastructure
    select r.* from fact_infrastructure fi
    cross join lateral jsonb_populate_record(
      null::fact_infrastructure,
      to_jsonb(fi) || jsonb_build_object(
        'fact_id', gen_random_uuid(),
        'period_id', '${TERM_PERIOD}',
        'classrooms_total', 999,
        'latrines_girls', 777
      )
    ) r
    where fi.jurisdiction_id = '${JUR.schoolPublicConsented}'
      and fi.period_id = '${ANNUAL_PERIOD}'
  `);
}

async function tableCounts(sql: postgres.Sql): Promise<Record<string, number>> {
  const tables = (await sql`
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name
  `) as unknown as { table_name: string }[];
  const union = tables
    .map((t) => `select '${t.table_name}' as t, count(*)::int as n from "${t.table_name}"`)
    .join(" union all ");
  const rows = (await sql.unsafe(union)) as unknown as { t: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.t, r.n]));
}

describe("facilities read is pinned to ANNUAL, with a stale TERM row beside it", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = adminAnalytics();
    await insertStaleTermRow(sql);
  });

  afterAll(async () => {
    await sql`delete from fact_infrastructure where period_id = ${TERM_PERIOD}::uuid`;
    await sql.end({ timeout: 5 });
  });

  it("the stale TERM row really is present, current, and same-year — a live candidate", async () => {
    const rows = (await sql`
      select dp.period_type::text as period_type, dp.term, dp.academic_year, dp.is_current,
             fi.classrooms_total, fi.latrines_girls
        from fact_infrastructure fi
        join dim_period dp on dp.period_id = fi.period_id
       where fi.jurisdiction_id = ${JUR.schoolPublicConsented}::uuid
       order by dp.period_type::text
    `) as unknown as Record<string, unknown>[];
    // One ANNUAL row (the real one) and one TERM row (the orphan), same academic_year, both current.
    expect(rows.map((r) => [r.period_type, r.term, r.academic_year, r.is_current])).toEqual([
      ["ANNUAL", null, "2025/26", true],
      ["TERM", 2, "2025/26", true],
    ]);
    expect(rows.map((r) => Number(r.classrooms_total))).toEqual([24, 999]);
  });

  it("the read returns the ANNUAL row, not the TERM row", async () => {
    const census = await getSchoolFacilitiesCensus(scope, JUR.schoolPublicConsented);
    expect(census).not.toBeNull();
    expect(census!.classroomsTotal).toBe(24);
    expect(census!.latrinesGirls).toBe(8);
    expect(census!.academicYear).toBe("2025/26");
    // Not the orphan's values, under any key.
    expect(JSON.stringify(census)).not.toContain("999");
    expect(JSON.stringify(census)).not.toContain("777");
  });

  it("what it returned hangs off a period with period_type ANNUAL and term IS NULL", async () => {
    const census = await getSchoolFacilitiesCensus(scope, JUR.schoolPublicConsented);
    const rows = (await sql`
      select dp.period_type::text as period_type, dp.term
        from fact_infrastructure fi
        join dim_period dp on dp.period_id = fi.period_id
       where fi.jurisdiction_id = ${JUR.schoolPublicConsented}::uuid
         and fi.classrooms_total = ${census!.classroomsTotal}
         and fi.latrines_girls = ${census!.latrinesGirls}
    `) as unknown as { period_type: string; term: number | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.period_type).toBe("ANNUAL");
    expect(rows[0]!.term).toBeNull();
  });

  it("the PIN is what rejects it: the pre-fix query shape serves the stale 999 row", async () => {
    // Byte-for-byte the WHERE/ORDER BY of the query as it stood at 712ab64 (no period_type pin,
    // `term desc nulls last` tie-break). If this returns the ANNUAL row too, the pin is decoration.
    const prefix = (await sql`
      select dp.period_type::text as period_type, dp.term, fi.classrooms_total
        from fact_infrastructure fi
        join dim_period dp on dp.period_id = fi.period_id
       where fi.jurisdiction_id = ${JUR.schoolPublicConsented}::uuid
       order by dp.academic_year desc, dp.term desc nulls last
       limit 1
    `) as unknown as { period_type: string; classrooms_total: number }[];
    expect(prefix[0]!.period_type).toBe("TERM");
    expect(Number(prefix[0]!.classrooms_total)).toBe(999);
  });
});

describe("migration 0005 deletes exactly the non-ANNUAL rows, and is replay-safe", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = adminAnalytics();
  });

  afterAll(async () => {
    await sql`delete from fact_infrastructure where period_id = ${TERM_PERIOD}::uuid`;
    await sql.end({ timeout: 5 });
  });

  it("the migration file is pure DML — no CREATE/ALTER/RENAME/TRUNCATE/DROP/GRANT", () => {
    const text = readFileSync(MIGRATION, "utf8");
    const code = text
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/\b(create|alter|rename|truncate|drop|grant|revoke)\b/i);
    expect(code.trim()).toMatch(/^DELETE FROM fact_infrastructure/i);
    // Exactly one statement.
    expect(code.trim().replace(/;$/, "")).not.toContain(";");
  });

  it("deletes exactly the TERM orphan, leaves the ANNUAL row and every other table untouched", async () => {
    await insertStaleTermRow(sql);
    const before = await tableCounts(sql);
    const stmt = readFileSync(MIGRATION, "utf8");
    const res = await sql.unsafe(stmt);
    expect(res.count).toBe(1);
    const after = await tableCounts(sql);
    const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
    expect(changed).toEqual(["fact_infrastructure"]);
    expect(after.fact_infrastructure).toBe(before.fact_infrastructure! - 1);
    const survivors = (await sql`
      select dp.period_type::text as period_type, fi.classrooms_total
        from fact_infrastructure fi join dim_period dp on dp.period_id = fi.period_id
       where fi.jurisdiction_id = ${JUR.schoolPublicConsented}::uuid
    `) as unknown as { period_type: string; classrooms_total: number }[];
    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.period_type).toBe("ANNUAL");
    expect(Number(survivors[0]!.classrooms_total)).toBe(24);
  });

  it("a second and third apply are no-ops (0 rows, nothing else moves)", async () => {
    const before = await tableCounts(sql);
    const stmt = readFileSync(MIGRATION, "utf8");
    for (const _ of [1, 2]) {
      const res = await sql.unsafe(stmt);
      expect(res.count).toBe(0);
    }
    expect(await tableCounts(sql)).toEqual(before);
  });

  it("the read path still works after the migration (ANNUAL row survived and is served)", async () => {
    const census = await getSchoolFacilitiesCensus(scope, JUR.schoolPublicConsented);
    expect(census!.classroomsTotal).toBe(24);
    expect(census!.source).toBe("OPERATIONAL_AGG");
  });
});
