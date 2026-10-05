import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { adminDemoAnalytics, testDbConfig } from "./helpers";
import {
  DEMO_TERMS,
  emisExtractFor,
  generateDemoDataset,
  loadDemoSource,
  type DemoDataset,
} from "@/scripts/seed-demo-data";
import { runOversightEtl } from "@/lib/etl/pipeline";

/**
 * QA PROBE (Quinn, H11 gate) — TENANT / JURISDICTION ISOLATION OF `fact_fees`, read as the NON-OWNER APP
 * ROLE (`ov_app`), mirroring `tests/etl-attendance-isolation.test.ts`.
 *
 * `tests/etl-fees.test.ts` asserts the slice's 23 criteria against the OWNER connection, which BYPASSES
 * row-level security — so nothing in that file proves a district officer cannot read another district's
 * fee figures. This file closes that gap: the real five-arm pipeline writes the rows, then every read is
 * issued over an `ov_app` connection with the officer GUCs set, which is the credential the product
 * actually serves dashboards with.
 *
 * ⚠ WHY IT MATTERS MORE ON THIS TABLE THAN ON ANY OF THE OTHER FOUR. A fee figure is a statement about
 * MONEY AND MEANS. "The school down the road charges GHS 1,400 for boarding" is competitively sensitive
 * before it is anything else; a PTA_DUES mean for a small rural JHS is close to a household figure; and a
 * TUITION row with a distribution of three pupils describes three families. The measures are also the raw
 * material for a fee league table nobody has agreed to publish. So the jurisdiction boundary is not a
 * formality here, and it is asserted as the APP ROLE rather than as the owner.
 *
 * ⚠ AND THE AGGREGATE-LEAK CHECK IS DIFFERENT IN KIND HERE. On `fact_attendance` the leak to rule out was
 * a SUM. There is nothing to sum on `fact_fees` — so the probe asks for `avg()`, `min()`, `max()` and
 * `count()` over another district's rows, which are the aggregate shapes a reporting bug would actually
 * write against a distributional table, and every one of them must come back empty.
 *
 * It sorts BEFORE `etl-fees.test.ts` ('-' < '.') and leaves the shared demo database as found: the
 * `fact_fees` rows it writes are removed in `afterAll`, since the file that owns the table's assertions
 * re-runs the pipeline in its own `beforeAll`.
 */

let sql: postgres.Sql;
let app: postgres.Sql;
let dataset: DemoDataset;

const OFFICER = "60000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  sql = adminDemoAnalytics();
  dataset = generateDemoDataset();
  await loadDemoSource(sql, dataset);
  await runOversightEtl(sql, {
    emisExtractText: JSON.stringify(emisExtractFor(dataset)),
    periods: DEMO_TERMS.map((t) => ({
      academicYear: t.academicYear,
      term: t.term,
      startsOn: t.startsOn,
      endsOn: t.endsOn,
      isCurrent: t.isCurrent,
    })),
    sourceSchema: "demo_source",
  });

  // The RLS half: the real policies file, and the real app-role grant posture.
  await sql.unsafe(readFileSync(join(process.cwd(), "db/sql/policies.sql"), "utf8"));
  await sql.unsafe(`
    grant usage on schema public to ov_app;
    grant select on all tables in schema public to ov_app;
    grant execute on all functions in schema public to ov_app;
  `);
  const url = new URL(testDbConfig.demoAnalyticsUrl);
  url.username = "ov_app";
  url.password = "";
  app = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });
}, 900_000);

afterAll(async () => {
  if (app) await app.end({ timeout: 5 });
  if (sql) {
    await sql`delete from fact_fees`;
    await sql.end({ timeout: 5 });
  }
});

async function asOfficer<T>(
  jurisdictionId: string,
  level: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  let captured: T;
  try {
    await app.begin(async (tx) => {
      await tx`select set_config('app.current_jurisdiction', ${jurisdictionId}, true)`;
      await tx`select set_config('app.current_level', ${level}, true)`;
      await tx`select set_config('app.current_officer', ${OFFICER}, true)`;
      captured = await fn(tx as unknown as postgres.TransactionSql);
      throw new Error("__rollback__");
    });
  } catch (err) {
    if ((err as Error).message !== "__rollback__") throw err;
  }
  return captured!;
}

async function schoolsUnder(districtId: string): Promise<string[]> {
  return (
    await sql<{ jurisdiction_id: string }[]>`
      select jurisdiction_id::text as jurisdiction_id from dim_jurisdiction
       where parent_id = ${districtId}::uuid`
  ).map((r) => r.jurisdiction_id);
}

describe("fact_fees is jurisdiction-isolated as ov_app (not the owner)", () => {
  it("a district officer reads its OWN district's fee rows and ZERO of another district's", async () => {
    const districts = await sql<{ jurisdiction_id: string; name: string }[]>`
      select jurisdiction_id::text as jurisdiction_id, name from dim_jurisdiction
       where level = 'DISTRICT' order by name`;
    // Two districts that BOTH carry fee rows, so "zero" is a refusal rather than an absence.
    const withRows: string[] = [];
    for (const d of districts) {
      const under = await schoolsUnder(d.jurisdiction_id);
      if (under.length === 0) continue;
      const n = (
        await sql<{ n: number }[]>`
          select count(*)::int as n from fact_fees
           where jurisdiction_id = any(${under}::uuid[])`
      )[0]!.n;
      if (n > 0) withRows.push(d.jurisdiction_id);
      if (withRows.length === 2) break;
    }
    expect(withRows).toHaveLength(2);
    const own = await schoolsUnder(withRows[0]!);
    const other = await schoolsUnder(withRows[1]!);

    const seen = await asOfficer(withRows[0]!, "DISTRICT", async (tx) => {
      const mine = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_fees
         where jurisdiction_id = any(${own}::uuid[])`;
      const theirs = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_fees
         where jurisdiction_id = any(${other}::uuid[])`;
      const unfiltered = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_fees`;
      const leak = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_fees f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id`;
      // ⚠ THE DISTRIBUTIONAL AGGREGATE LEAK. There is nothing to SUM on this table, so the shapes a
      // reporting bug would really write are avg/min/max over the measures — "what does the next district
      // charge?" — and every one of them must be NULL rather than a number.
      const theirMoney = await tx<
        { mean: string | null; lo: string | null; hi: string | null; n: number }[]
      >`
        select avg(mean_amount)::text as mean, min(mean_amount)::text as lo,
               max(median_amount)::text as hi, count(*)::int as n
          from fact_fees where jurisdiction_id = any(${other}::uuid[])`;
      // …including the one a league table would write: ORDER BY the measure, LIMIT a few.
      const theirTop = await tx<{ mean: string }[]>`
        select mean_amount::text as mean from fact_fees
         where jurisdiction_id = any(${other}::uuid[])
         order by mean_amount desc limit 5`;
      return {
        mine: mine[0]!.n,
        theirs: theirs[0]!.n,
        unfiltered: unfiltered[0]!.n,
        leak: leak[0]!.n,
        theirMoney: theirMoney[0]!,
        theirTop: theirTop.length,
      };
    });
    expect(seen.mine).toBeGreaterThan(0);
    // THE DECISIVE PAIR: another district's rows are invisible, and the UNQUALIFIED count — the query a
    // reporting bug would write — returns the officer's own subtree and nothing more.
    expect(seen.theirs).toBe(0);
    expect(seen.unfiltered).toBe(seen.mine);
    expect(seen.leak).toBe(seen.mine);
    expect(seen.theirMoney.n).toBe(0);
    expect(seen.theirMoney.mean).toBeNull();
    expect(seen.theirMoney.lo).toBeNull();
    expect(seen.theirMoney.hi).toBeNull();
    expect(seen.theirTop).toBe(0);

    // The owner connection really does see more than the officer did — so the equalities above are RLS
    // working, not an empty table.
    const total = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_fees`
    )[0]!.n;
    expect(total).toBeGreaterThan(seen.mine);
  });

  it("a national officer reads every row, and the app role cannot write or delete one", async () => {
    const total = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_fees`
    )[0]!.n;
    expect(total).toBeGreaterThan(0);
    const national = (
      await sql<{ jurisdiction_id: string }[]>`
        select jurisdiction_id::text as jurisdiction_id from dim_jurisdiction
         where level = 'NATIONAL' and name = 'Ghana'`
    )[0]!.jurisdiction_id;
    const seen = await asOfficer(national, "NATIONAL", async (tx) => {
      const r = await tx<{ n: number }[]>`select count(*)::int as n from fact_fees`;
      return r[0]!.n;
    });
    expect(seen).toBe(total);

    // The ETL's credential is the owner; the app role holds no INSERT/UPDATE/DELETE on the fact table, and
    // the ABSENT GRANT — not a policy — is what makes that unforgeable.
    await expect(
      asOfficer(national, "NATIONAL", async (tx) => {
        await tx`delete from fact_fees`;
      }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asOfficer(national, "NATIONAL", async (tx) => {
        await tx`update fact_fees set mean_amount = 0`;
      }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asOfficer(national, "NATIONAL", async (tx) => {
        await tx`
          insert into fact_fees
            (jurisdiction_id, period_id, fee_category, stage, mean_amount, median_amount,
             source, as_of_date)
          select jurisdiction_id, period_id, fee_category, stage, mean_amount, median_amount,
                 source, as_of_date
            from fact_fees limit 1`;
      }),
    ).rejects.toThrow(/permission denied/i);
    // The absent grant, read from the catalogue rather than inferred from the three failures above.
    const grants = await sql<{ privilege_type: string }[]>`
      select privilege_type from information_schema.role_table_grants
       where grantee = 'ov_app' and table_schema = 'public' and table_name = 'fact_fees'
       order by 1`;
    expect(grants.map((g) => g.privilege_type)).toEqual(["SELECT"]);
  });

  it("a SCHOOL-tier officer sees only its own school's fee rows", async () => {
    const school = (
      await sql<{ jurisdiction_id: string; n: number }[]>`
        select f.jurisdiction_id::text as jurisdiction_id, count(*)::int as n
          from fact_fees f
         group by f.jurisdiction_id having count(*) >= 4
         order by f.jurisdiction_id limit 1`
    )[0]!;
    const seen = await asOfficer(school.jurisdiction_id, "SCHOOL", async (tx) => {
      const all = await tx<{ n: number }[]>`select count(*)::int as n from fact_fees`;
      const others = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_fees
         where jurisdiction_id <> ${school.jurisdiction_id}::uuid`;
      // The all-stages row is the whole-school figure, and it is as isolated as the stage rows: a reader
      // that reached for `stage IS NULL` across the country gets its own school and nothing else.
      const allStages = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_fees where stage is null`;
      return { all: all[0]!.n, others: others[0]!.n, allStages: allStages[0]!.n };
    });
    expect(seen.others).toBe(0);
    expect(seen.all).toBe(school.n);
    expect(seen.allStages).toBeGreaterThan(0);
    const ownAllStages = (
      await sql<{ n: number }[]>`
        select count(*)::int as n from fact_fees
         where jurisdiction_id = ${school.jurisdiction_id}::uuid and stage is null`
    )[0]!.n;
    expect(seen.allStages).toBe(ownAllStages);
  });
});
