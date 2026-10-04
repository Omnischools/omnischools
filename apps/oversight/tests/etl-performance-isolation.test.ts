import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { adminDemoAnalytics, testDbConfig } from "./helpers";
import {
  DEMO_EXAM_COHORTS,
  DEMO_TERMS,
  emisExtractFor,
  generateDemoDataset,
  loadDemoSource,
  type DemoDataset,
} from "@/scripts/seed-demo-data";
import { runOversightEtl } from "@/lib/etl/pipeline";

/**
 * QA PROBE (Quinn, H14 gate) — TENANT / JURISDICTION ISOLATION OF `fact_performance_exam`, read as the
 * NON-OWNER APP ROLE (`ov_app`), mirroring `tests/etl-enrolment.test.ts`'s criterion-18 block.
 *
 * `tests/etl-performance.test.ts` asserts the slice's 21 criteria against the OWNER connection, which
 * BYPASSES row-level security — so nothing in that file proves a district officer cannot read another
 * district's exam results. This file closes that gap: the real three-arm pipeline writes the rows, then
 * every read is issued over an `ov_app` connection with the officer GUCs set, which is the credential the
 * product actually serves dashboards with.
 *
 * It sorts BEFORE `etl-performance.test.ts` ('-' < '.') and leaves the shared demo database as found:
 * `fact_performance_exam` and the EXAM_COHORT `dim_period` rows are removed in `afterAll`, for the same
 * reason that file gives (the enrolment suite deletes the 2024/25 period outright).
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
    examCohorts: DEMO_EXAM_COHORTS.map((c) => ({
      sittingYear: c.sittingYear,
      startsOn: c.startsOn,
      endsOn: c.endsOn,
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
}, 300_000);

afterAll(async () => {
  if (app) await app.end({ timeout: 5 });
  if (sql) {
    await sql`delete from fact_performance_exam`;
    await sql`delete from dim_period where period_type = 'EXAM_COHORT'`;
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

describe("fact_performance_exam is jurisdiction-isolated as ov_app (not the owner)", () => {
  it("a district officer reads its OWN district's exam rows and ZERO of another district's", async () => {
    const districts = await sql<{ jurisdiction_id: string; name: string }[]>`
      select jurisdiction_id::text as jurisdiction_id, name from dim_jurisdiction
       where level = 'DISTRICT' order by name`;
    // Two districts that BOTH carry exam rows, so "zero" is a refusal rather than an absence.
    const withRows: string[] = [];
    for (const d of districts) {
      const under = await schoolsUnder(d.jurisdiction_id);
      if (under.length === 0) continue;
      const n = (
        await sql<{ n: number }[]>`
          select count(*)::int as n from fact_performance_exam
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
        select count(*)::int as n from fact_performance_exam
         where jurisdiction_id = any(${own}::uuid[])`;
      const theirs = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_performance_exam
         where jurisdiction_id = any(${other}::uuid[])`;
      const unfiltered = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_performance_exam`;
      const leak = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_performance_exam f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id`;
      return {
        mine: mine[0]!.n,
        theirs: theirs[0]!.n,
        unfiltered: unfiltered[0]!.n,
        leak: leak[0]!.n,
      };
    });
    expect(seen.mine).toBeGreaterThan(0);
    // THE DECISIVE PAIR: another district's rows are invisible, and the UNQUALIFIED count — the query a
    // reporting bug would write — returns the officer's own subtree and nothing more.
    expect(seen.theirs).toBe(0);
    expect(seen.unfiltered).toBe(seen.mine);
    expect(seen.leak).toBe(seen.mine);

    // The owner connection really does see more than the officer did — so the equality above is RLS
    // working, not an empty table.
    const total = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_performance_exam`
    )[0]!.n;
    expect(total).toBeGreaterThan(seen.mine);
  });

  it("a national officer reads every row, and the app role cannot write or delete one", async () => {
    const total = (
      await sql<{ n: number }[]>`select count(*)::int as n from fact_performance_exam`
    )[0]!.n;
    expect(total).toBeGreaterThan(0);
    const national = (
      await sql<{ jurisdiction_id: string }[]>`
        select jurisdiction_id::text as jurisdiction_id from dim_jurisdiction
         where level = 'NATIONAL' and name = 'Ghana'`
    )[0]!.jurisdiction_id;
    const seen = await asOfficer(national, "NATIONAL", async (tx) => {
      const r = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_performance_exam`;
      return r[0]!.n;
    });
    expect(seen).toBe(total);

    // The ETL's credential is the owner; the app role holds no INSERT/UPDATE/DELETE on the fact table,
    // and the ABSENT GRANT — not a policy — is what makes that unforgeable.
    await expect(
      asOfficer(national, "NATIONAL", async (tx) => {
        await tx`delete from fact_performance_exam`;
      }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asOfficer(national, "NATIONAL", async (tx) => {
        await tx`update fact_performance_exam set candidates = 0`;
      }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asOfficer(national, "NATIONAL", async (tx) => {
        await tx`
          insert into fact_performance_exam
            (jurisdiction_id, period_id, exam, sex, candidates, qualified, qualification_rate,
             source, as_of_date)
          select jurisdiction_id, period_id, exam, sex, candidates, qualified, qualification_rate,
                 source, as_of_date
            from fact_performance_exam limit 1`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("a SCHOOL-tier officer sees only its own school's exam rows", async () => {
    const school = (
      await sql<{ jurisdiction_id: string; n: number }[]>`
        select f.jurisdiction_id::text as jurisdiction_id, count(*)::int as n
          from fact_performance_exam f
         group by f.jurisdiction_id having count(*) >= 3
         order by f.jurisdiction_id limit 1`
    )[0]!;
    const seen = await asOfficer(school.jurisdiction_id, "SCHOOL", async (tx) => {
      const all = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_performance_exam`;
      const others = await tx<{ n: number }[]>`
        select count(*)::int as n from fact_performance_exam
         where jurisdiction_id <> ${school.jurisdiction_id}::uuid`;
      return { all: all[0]!.n, others: others[0]!.n };
    });
    expect(seen.others).toBe(0);
    expect(seen.all).toBe(school.n);
  });
});
