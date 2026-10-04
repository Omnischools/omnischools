import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { adminDemoAnalytics } from "./helpers";
import {
  DEMO_TERMS,
  emisExtractFor,
  generateDemoDataset,
  loadDemoSource,
  type DemoDataset,
} from "@/scripts/seed-demo-data";
import { runOversightEtl } from "@/lib/etl/pipeline";
import { annualPeriodSpecs, refreshPeriods } from "@/lib/etl/dimensions";

/**
 * QA GATE (Quinn) — the two properties of Kofi's ANNUAL re-grain that
 * `tests/etl-infrastructure.test.ts` does not reach, each in its own file so the ordering
 * conventions of that one are untouched.
 *
 *  1. THE TIE-BREAK IS REAL AND TOTAL. Every census the demo generates is captured at
 *     `${term.endsOn}T12:00:00Z`, so within a school `captured_at` alone already decides the winner
 *     and `period_number DESC, product_line DESC` is never consulted. The ruling says the order is
 *     TOTAL precisely because two censuses CAN share a timestamp (a backfill, two configurations
 *     keyed the same day), and `LIMIT 1` over a partial order is non-deterministic. This injects the
 *     tie and asserts WHICH row wins, and that it keeps winning across re-runs.
 *
 *  2. "EXACTLY ONE ANNUAL PERIOD PER ACADEMIC YEAR" HOLDS OVER MORE THAN ONE YEAR. The demo run is a
 *     single academic year, so a multi-year run (a backfill — the real multi-period case) never
 *     exercises `annualPeriodSpecs` grouping or `refreshPeriods`' `term IS NOT DISTINCT FROM` upsert
 *     across years.
 *
 * It uses the same throwaway demo analytics database, reloads the source stand-in itself, and leaves
 * the database in the same state `etl-infrastructure.test.ts`'s own `beforeAll` produces, so the two
 * files are order-independent.
 */

let sql: postgres.Sql;
let dataset: DemoDataset;

const ACADEMIC_YEAR = DEMO_TERMS[0]!.academicYear;
const TERM_2 = DEMO_TERMS[1]!;

/** Injected periods for the tie-break probe. Removed in `afterAll`. */
const TIED = [
  {
    periodId: "b1000099-0000-4000-8000-00000000aa01",
    periodNumber: 9,
    productLine: "SENIOR",
    classroomsTotal: 33,
  },
  {
    periodId: "b1000099-0000-4000-8000-00000000aa02",
    periodNumber: 9,
    productLine: "SENIOR_F3",
    classroomsTotal: 55, // THE WINNER: same captured_at, same period_number, SENIOR_F3 > SENIOR
  },
  {
    periodId: "b1000099-0000-4000-8000-00000000aa03",
    periodNumber: 8,
    productLine: "BASIC",
    classroomsTotal: 77, // loses on period_number, despite the same captured_at
  },
];

async function runEtl() {
  return runOversightEtl(sql, {
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
}

beforeAll(async () => {
  sql = adminDemoAnalytics();
  dataset = generateDemoDataset();
  await loadDemoSource(sql, dataset);
  await runEtl();
}, 180_000);

afterAll(async () => {
  for (const t of TIED) {
    await sql`delete from demo_source.facilities_snapshot where period_id = ${t.periodId}::uuid`;
    await sql`delete from demo_source.academic_period where period_id = ${t.periodId}::uuid`;
  }
  await runEtl();
  await sql.end({ timeout: 5 });
}, 180_000);

describe("the latest-census tie-break is TOTAL, so the chosen row is deterministic", () => {
  it("on an identical captured_at the winner is period_number DESC then product_line DESC, every run", async () => {
    const victim = (
      await sql<{ emis: string; op: string; newest: Date }[]>`
        select e.emis_school_id as emis, e.operational_school_id::text as op,
               max(f.captured_at) as newest
          from ref_emis_school_register e
          join demo_source.academic_period p on p.school_id = e.operational_school_id
          join demo_source.facilities_snapshot f
            on f.school_id = p.school_id and f.period_id = p.period_id
         where e.on_schoolup and p.academic_year = ${ACADEMIC_YEAR}
         group by e.emis_school_id, e.operational_school_id
         order by e.emis_school_id limit 1`
    )[0]!;
    // ONE timestamp shared by all three injected censuses, newer than anything this school has filed
    // (derived from the data, never hardcoded — other files permanently bump some captured_at values).
    const tiedAt = new Date(victim.newest.getTime() + 86_400_000).toISOString();

    for (const t of TIED) {
      await sql`
        insert into demo_source.academic_period
          (period_id, school_id, academic_year, period_number, period_label,
           starts_on, ends_on, product_line)
        values (${t.periodId}::uuid, ${victim.op}::uuid, ${ACADEMIC_YEAR}, ${t.periodNumber},
                ${`Period ${t.periodNumber}`}, ${TERM_2.startsOn}, ${TERM_2.endsOn},
                ${t.productLine})`;
      await sql`
        insert into demo_source.facilities_snapshot
          (school_id, period_id, classrooms_total, classrooms_good, classrooms_repair,
           water_source, electricity_source, latrines_boys, latrines_girls, latrines_staff,
           latrine_type, handwashing, has_library, has_ict_lab, internet, has_kitchen,
           gsfp_participating, captured_at)
        values (${victim.op}::uuid, ${t.periodId}::uuid, ${t.classroomsTotal},
                ${t.classroomsTotal}, 0, 'PIPE', 'GRID', 3, 3, 2, 'WC',
                true, true, true, true, true, true, ${tiedAt}::timestamptz)`;
    }

    // The tie really is a tie in the source: three censuses, one timestamp.
    const tie = await sql<{ n: number }[]>`
      select count(*)::int as n from demo_source.facilities_snapshot
       where school_id = ${victim.op}::uuid and captured_at = ${tiedAt}::timestamptz`;
    expect(tie[0]!.n).toBe(3);

    // THREE runs: the answer must be the same every time. A selector that stopped at `captured_at`
    // would be free to return any of the three, and "it happened to be stable tonight" is the defect.
    for (let i = 0; i < 3; i++) {
      const run = await runEtl();
      expect(run.status).toBe("SUCCESS");
      const rows = await sql<{ n: number; total: number; as_of: string }[]>`
        select count(*)::int as n, max(f.classrooms_total) as total,
               max(f.as_of_date)::text as as_of
          from fact_infrastructure f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
         where d.ges_code = ${victim.emis}`;
      expect(rows[0]!.n).toBe(1);
      expect(Number(rows[0]!.total)).toBe(55);
      expect(Date.parse(rows[0]!.as_of)).toBe(Date.parse(tiedAt));
    }
  }, 180_000);
});

describe("exactly ONE ANNUAL dim_period row per academic_year, over a MULTI-YEAR run", () => {
  it("annualPeriodSpecs collapses each year's terms into one spanning ANNUAL spec", () => {
    const specs = annualPeriodSpecs([
      {
        academicYear: "2024/25",
        term: 1,
        startsOn: "2024-09-10",
        endsOn: "2024-12-20",
        isCurrent: false,
      },
      {
        academicYear: "2024/25",
        term: 3,
        startsOn: "2025-05-01",
        endsOn: "2025-07-31",
        isCurrent: false,
      },
      {
        academicYear: "2024/25",
        term: 2,
        startsOn: "2025-01-10",
        endsOn: "2025-04-03",
        isCurrent: true,
      },
      {
        academicYear: "2025/26",
        term: 1,
        startsOn: "2025-09-09",
        endsOn: "2025-12-19",
        isCurrent: false,
      },
    ]);
    expect(specs).toHaveLength(2); // one per YEAR, whatever the caller passed
    const y2425 = specs.find((s) => s.academicYear === "2024/25")!;
    expect(y2425).toMatchObject({
      term: null, // `term = null` IS what makes it ANNUAL — no second, disagreeable field
      startsOn: "2024-09-10", // earliest term's start
      endsOn: "2025-07-31", // latest term's end
      isCurrent: true, // ANY term current ⇒ the year is current
    });
    expect(specs.find((s) => s.academicYear === "2025/26")!.isCurrent).toBe(false);
  });

  it("refreshPeriods upserts one ANNUAL row per year and re-running inserts NOTHING", async () => {
    // Two synthetic years so this is a MULTI-year backfill, which the demo run never is. `term = null`
    // equality would insert a fresh indistinguishable ANNUAL row per year per run — the exact risk.
    const years = ["2098/99", "2099/00"];
    const terms = years.flatMap((academicYear) => [
      {
        academicYear,
        term: 1,
        startsOn: `${academicYear.slice(0, 4)}-09-09`,
        endsOn: `${academicYear.slice(0, 4)}-12-19`,
        isCurrent: false,
      },
      {
        academicYear,
        term: 2,
        startsOn: `${academicYear.slice(0, 4)}-01-10`,
        endsOn: `${academicYear.slice(0, 4)}-04-02`,
        isCurrent: false,
      },
    ]);
    const specs = [...terms, ...annualPeriodSpecs(terms)];

    try {
      const first = await refreshPeriods(sql, specs);
      const second = await refreshPeriods(sql, specs);

      const rows = await sql<
        { academic_year: string; period_type: string; term: number | null; n: number }[]
      >`
        select academic_year, period_type::text as period_type, term, count(*)::int as n
          from dim_period where academic_year = any(${years})
         group by academic_year, period_type, term
         order by academic_year, period_type, term`;
      // Per year: exactly two TERM rows and exactly ONE ANNUAL row, after TWO refreshes.
      expect(rows.map((r) => [r.academic_year, r.period_type, r.term, r.n])).toEqual([
        ["2098/99", "ANNUAL", null, 1],
        ["2098/99", "TERM", 1, 1],
        ["2098/99", "TERM", 2, 1],
        ["2099/00", "ANNUAL", null, 1],
        ["2099/00", "TERM", 1, 1],
        ["2099/00", "TERM", 2, 1],
      ]);
      // …and the SAME period_id came back both times, so facts cannot be split across duplicates.
      for (const year of years) {
        const key = `${year}|ANNUAL`;
        expect(first.get(key)).toBeTruthy();
        expect(second.get(key)).toBe(first.get(key));
      }
      // The ANNUAL row really does span its year's terms.
      const annual = await sql<{ starts_on: string; ends_on: string }[]>`
        select starts_on::text as starts_on, ends_on::text as ends_on from dim_period
         where academic_year = '2099/00' and term is null and period_type = 'ANNUAL'`;
      expect(annual[0]!.starts_on).toBe("2099-01-10");
      expect(annual[0]!.ends_on).toBe("2099-12-19");
    } finally {
      await sql`delete from dim_period where academic_year = any(${years})`;
    }
  }, 120_000);
});
