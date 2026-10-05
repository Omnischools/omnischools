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
 * QA PROBE (Quinn gate) — TENANT / JURISDICTION ISOLATION OF `fact_staffing`, read as the NON-OWNER
 * APP ROLE (`ov_app`), mirroring `tests/etl-fees-isolation.test.ts`.
 *
 * `tests/etl-staffing.test.ts` asserts the ruling's 21 criteria against the OWNER connection, which
 * BYPASSES row-level security — so nothing in that file proves a district officer cannot read another
 * district's staffing figures. This file closes that gap with NON-EMPTY `fact_staffing`: a policy test
 * over an empty table proves nothing at all, which is the whole reason this arm needed one.
 *
 * ⚠ WHAT IS SPECIFICALLY AT STAKE ON THIS TABLE. `teachers_on_roll` is a COUNT OF TEACHERS, NEVER A
 * TEACHER — but a one- or two-teacher school's row, combined with a district roster the gated §6
 * read-back could supply, sits closer to a named person than any other fact row in this database. And
 * `vacancies` is a statement about a school's staffing deficit that a neighbouring district has no
 * business reading. So the boundary is asserted as the credential the product actually serves
 * dashboards with, not as the owner.
 *
 * ⚠ THE AGGREGATE-LEAK CHECK IS THE Σ÷Σ ROLL-UP ITSELF. The leak a reporting bug would actually write
 * here is not `select *` — it is `sum(enrolment_total) / sum(teachers_on_roll)` across a tier, which is
 * the CORRECT formula pointed at the WRONG subtree. So the probe issues exactly that query from inside
 * a sibling district's session and requires it to come back NULL/empty rather than merely "smaller".
 *
 * It sorts BEFORE `etl-staffing.test.ts` ('-' < '.') and leaves the demo database as found: the rows it
 * writes are removed in `afterAll`, since the file that owns the table's assertions re-runs the
 * pipeline in its own `beforeAll`.
 */

let sql: postgres.Sql;
let app: postgres.Sql;
let dataset: DemoDataset;

const OFFICER = "60000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  sql = adminDemoAnalytics();
  dataset = generateDemoDataset();
  await loadDemoSource(sql, dataset);
  const report = await runOversightEtl(sql, {
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
  expect(report.status).toBe("SUCCESS");

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
    await sql`delete from fact_staffing`;
    await sql.end({ timeout: 5 });
  }
});

async function asOfficer<T>(
  jurisdictionId: string | null,
  level: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  let captured: T;
  try {
    await app.begin(async (tx) => {
      await tx`select set_config('app.current_jurisdiction', ${jurisdictionId ?? ""}, true)`;
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

/** Two districts that BOTH carry staffing rows, so "zero" is a refusal and not an absence. */
async function twoPopulatedDistricts(): Promise<{ id: string; rows: number }[]> {
  const districts = await sql<{ jurisdiction_id: string; n: number }[]>`
    select d.jurisdiction_id::text as jurisdiction_id, count(*)::int as n
      from fact_staffing fs
      join dim_jurisdiction s on s.jurisdiction_id = fs.jurisdiction_id
      join dim_jurisdiction d on d.jurisdiction_id = s.parent_id
     group by d.jurisdiction_id having count(*) > 1
     order by count(*) desc limit 2`;
  return districts.map((d) => ({ id: d.jurisdiction_id, rows: d.n }));
}

describe("fact_staffing is jurisdiction-isolated as ov_app (not the owner)", () => {
  it("has rows at all — a policy test over an empty table proves nothing", async () => {
    const [total] = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_staffing`;
    expect(total!.n).toBeGreaterThan(100);
  });

  it("a district officer reads its OWN schools' rows and ZERO of a sibling district's", async () => {
    const [a, b] = await twoPopulatedDistricts();
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    const mine = await asOfficer(a!.id, "DISTRICT", async (tx) => {
      const r = (await tx`
        select count(*)::int as n from fact_staffing`) as unknown as { n: number }[];
      return r[0]!.n;
    });
    expect(mine).toBe(a!.rows);
    // The sibling's rows, named explicitly, are invisible — zero rows, not an error (fail CLOSED).
    const siblingSchools = (
      await sql<{ jurisdiction_id: string }[]>`
        select jurisdiction_id::text as jurisdiction_id from dim_jurisdiction
         where parent_id = ${b!.id}::uuid`
    ).map((r) => r.jurisdiction_id);
    const leaked = await asOfficer(a!.id, "DISTRICT", async (tx) => {
      const r = (await tx`
        select count(*)::int as n from fact_staffing
         where jurisdiction_id = any(${siblingSchools}::uuid[])`) as unknown as {
        n: number;
      }[];
      return r[0]!.n;
    });
    expect(leaked).toBe(0);
  });

  it("the Σ÷Σ ROLL-UP, pointed at a sibling subtree, returns NOTHING rather than a number", async () => {
    const [a, b] = await twoPopulatedDistricts();
    const siblingSchools = (
      await sql<{ jurisdiction_id: string }[]>`
        select jurisdiction_id::text as jurisdiction_id from dim_jurisdiction
         where parent_id = ${b!.id}::uuid`
    ).map((r) => r.jurisdiction_id);
    const leaked = await asOfficer(a!.id, "DISTRICT", async (tx) => {
      const r = (await tx`
        select sum(enrolment_total)::text          as e,
               sum(teachers_on_roll)::text        as t,
               sum(teaching_posts_established)::text as posts,
               sum(vacancies)::text               as vac,
               max(ptr)::text                     as worst
          from fact_staffing
         where jurisdiction_id = any(${siblingSchools}::uuid[])`) as unknown as {
        e: string | null;
        t: string | null;
        posts: string | null;
        vac: string | null;
        worst: string | null;
      }[];
      return r[0]!;
    });
    // Every aggregate shape a reporting bug would write — the ratio's two inputs, the establishment
    // pair, and the per-school rate's max — comes back NULL over an empty, filtered-away row set.
    expect(leaked.e).toBeNull();
    expect(leaked.t).toBeNull();
    expect(leaked.posts).toBeNull();
    expect(leaked.vac).toBeNull();
    expect(leaked.worst).toBeNull();
  });

  it("a region officer sees its districts' schools; the national officer sees them all", async () => {
    const [total] = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_staffing`;
    const national = await asOfficer(null, "NATIONAL", async (tx) => {
      const r = (await tx`
        select count(*)::int as n from fact_staffing`) as unknown as { n: number }[];
      return r[0]!.n;
    });
    expect(national).toBe(total!.n);

    const region = await sql<{ jurisdiction_id: string; n: number }[]>`
      select r.jurisdiction_id::text as jurisdiction_id, count(*)::int as n
        from fact_staffing fs
        join dim_jurisdiction s on s.jurisdiction_id = fs.jurisdiction_id
        join dim_jurisdiction d on d.jurisdiction_id = s.parent_id
        join dim_jurisdiction r on r.jurisdiction_id = d.parent_id
       group by r.jurisdiction_id order by count(*) desc limit 1`;
    const seen = await asOfficer(region[0]!.jurisdiction_id, "REGION", async (tx) => {
      const r = (await tx`
        select count(*)::int as n from fact_staffing`) as unknown as { n: number }[];
      return r[0]!.n;
    });
    expect(seen).toBe(region[0]!.n);
    expect(seen).toBeLessThan(total!.n);
  });

  it("an UNSET jurisdiction GUC yields ZERO rows — fail closed, not fail open", async () => {
    const seen = await asOfficer("", "DISTRICT", async (tx) => {
      const r = (await tx`
        select count(*)::int as n from fact_staffing`) as unknown as { n: number }[];
      return r[0]!.n;
    });
    expect(seen).toBe(0);
  });

  it("gives the app role NO write path into fact_staffing at all", async () => {
    // The ETL writes as the owner. `policies.sql` installs a SELECT-only policy, and the absent INSERT
    // GRANT — not the policy — is what makes this raise. A staffing figure is never user-submitted.
    await expect(
      asOfficer(null, "NATIONAL", async (tx) => {
        await tx`delete from fact_staffing`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});
