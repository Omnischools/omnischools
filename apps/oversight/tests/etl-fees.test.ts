import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { adminDemoAnalytics } from "./helpers";
import {
  DEMO_DUES_CATEGORY,
  DEMO_OTHER_CATEGORY,
  DEMO_TERMS,
  emisExtractFor,
  generateDemoDataset,
  loadDemoSource,
  type DemoClassRow,
  type DemoDataset,
  type DemoSchool,
  type DemoTerm,
} from "@/scripts/seed-demo-data";
import { runOversightEtl, type EtlRunReport } from "@/lib/etl/pipeline";
import {
  FeesTransformError,
  aggregateSchoolFees,
  distributionKey,
  ghsOf,
  meanPesewas,
  medianPesewas,
  writeFeesFacts,
  type FactFeesRow,
} from "@/lib/etl/fees";
import {
  BILLED_INVOICE_STATUSES,
  countInvoicesWithoutPeriod,
  readFeeLineGroups,
  type FeeLineGroupRow,
} from "@/lib/etl/fees-source";
import {
  OV_FEE_CATEGORIES,
  feeCategoryOf,
  type OvFeeCategory,
} from "@/lib/etl/fee-category";
import { stageOf, type AnalyticsStage } from "@/lib/etl/stage";

/**
 * INCREMENT H FIFTH SLICE — `fact_fees` end-to-end (task H11, Kofi's 23 acceptance criteria).
 *
 * Same posture as the four earlier slices' suites, deliberately: the REAL five-arm pipeline runs over the
 * deterministic demo dataset, every fact row is produced by `aggregateSchoolFees` from operational-shaped
 * `invoice` / `invoice_line_item` / `fee_category` / `pta_dues_charge` rows, and NOTHING HERE HAND-SEEDS A
 * FACT except where a write-path property can only be staged (the injected duplicate, the bystander
 * delete). The expected figures are HAND-COMPUTED IN TYPESCRIPT from the generated invoice bands — not
 * read back out of SQL and compared to another SQL query, which would only prove Postgres agrees with
 * itself. Two criteria (5 and 6) additionally re-derive the stored figures in POSTGRES, with its own
 * `round()` and `percentile_cont()`, so the published mean and median are pinned against an engine that
 * shares no code with the transform.
 *
 * ⚠ WHY THE GENERATED DATASET IS A SUFFICIENT EXPECTATION even though the loader picks WHICH pupil gets
 * which bill: `fact_fees` depends on nothing about an invoice except the PER-PUPIL AMOUNT PER CATEGORY,
 * and a band lists exactly that for exactly that many pupils (`DemoInvoiceRun`). The pupil identities the
 * loader assigns are invisible to every published figure — which is itself the privacy claim this slice
 * makes, and criterion 19 asserts it from the other end.
 *
 * It runs against the increment-H demo analytics database (`adminDemoAnalytics`) and sorts after the
 * attendance files, which leave the demo source loaded and the facts written; its own `beforeAll` reloads
 * and re-runs, so it is independent of them.
 */

let sql: postgres.Sql;
let dataset: DemoDataset;
let report: EtlRunReport;

const ACADEMIC_YEAR = DEMO_TERMS[0]!.academicYear;
const FIRST_TERM = DEMO_TERMS[0]!;
const LAST_TERM = DEMO_TERMS[DEMO_TERMS.length - 1]!;

let schoolByEmis: Map<string, DemoSchool>;
/** `${emis}|${term}|${category}|${stage}` → the hand-computed per-student pesewas, UNSORTED. */
let expected: Map<string, number[]>;
/** `${emis}|${term}` → billed pesewas that reached NO row, by reason. */
let expectedOutOfScope: Map<string, number>;
let expectedUnmapped: Map<string, number>;
/** `${emis}|${term}` → billed pesewas published under OTHER, and the distinct unmapped names. */
let expectedOther: Map<string, number>;
let expectedOtherNames: Map<string, Set<string>>;
/** `${emis}` → BILLED invoices carrying no `period_id`. Tallied, never written. */
let expectedNullPeriod: Map<string, number>;
/** `${emis}|${term}` → the expected `as_of_date` (max included `issued_at`). */
let expectedAsOf: Map<string, string>;

const key = (
  emis: string,
  term: number,
  category: string,
  stage: string | null,
): string => `${emis}|${term}|${category}|${stage ?? ""}`;

function extractText(d: DemoDataset): string {
  return JSON.stringify(emisExtractFor(d));
}

function periodsOption(terms: readonly DemoTerm[] = DEMO_TERMS) {
  return terms.map((t) => ({
    academicYear: t.academicYear,
    term: t.term,
    startsOn: t.startsOn,
    endsOn: t.endsOn,
    isCurrent: t.isCurrent,
  }));
}

async function runEtl(
  over: {
    d?: DemoDataset;
    terms?: readonly DemoTerm[];
    extractText?: string;
    policy?: { maxFailureRate: number };
  } = {},
): Promise<EtlRunReport> {
  return runOversightEtl(sql, {
    emisExtractText: over.extractText ?? extractText(over.d ?? dataset),
    periods: periodsOption(over.terms),
    sourceSchema: "demo_source",
    ...(over.policy ? { policy: over.policy } : {}),
  });
}

// ── the suite's OWN money arithmetic, independent of the transform's ────────────────────────────

/** `round(total/n)` in pesewas, half away from zero — restated here rather than imported. */
function meanOf(distribution: readonly number[]): number {
  const total = distribution.reduce((t, v) => t + v, 0);
  const n = distribution.length;
  const whole = Math.floor(total / n);
  const rem = total - whole * n;
  return rem * 2 >= n ? whole + 1 : whole;
}

function medianOf(distribution: readonly number[]): number {
  const sorted = [...distribution].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  const sum = sorted[mid - 1]! + sorted[mid]!;
  return sum % 2 === 0 ? sum / 2 : Math.floor(sum / 2) + 1;
}

function ghs(pesewas: number): string {
  return `${Math.floor(pesewas / 100)}.${String(pesewas % 100).padStart(2, "0")}`;
}

/**
 * THE EXPECTATION, RE-DERIVED FROM THE GENERATED INVOICE BANDS IN TYPESCRIPT.
 *
 * It applies the SAME rules the ETL applies — the dues bridge outranks the category name, the resolver
 * reads the name, DRAFT and VOIDED contribute nothing, the stage comes from the invoiced pupil's own
 * class, out-of-scope/unmapped are tallied and never bucketed, a no-period invoice is tallied and never
 * written, and the measures are a PER-PUPIL distribution — but over the GENERATOR's objects rather than
 * over anything the pipeline produced. `stageOf` and `feeCategoryOf` are shared on purpose (they ARE the
 * rulings, and they have their own unit blocks below); every AMOUNT and every COUNT here is independent.
 */
function buildExpectations(d: DemoDataset): void {
  const classById = new Map<string, DemoClassRow>(d.classes.map((c) => [c.classId, c]));
  const emisByOpId = new Map<string, string>(
    d.schools
      .filter((s) => s.operationalSchoolId)
      .map((s) => [s.operationalSchoolId!, s.emisSchoolId]),
  );
  expected = new Map();
  expectedOutOfScope = new Map();
  expectedUnmapped = new Map();
  expectedOther = new Map();
  expectedOtherNames = new Map();
  expectedNullPeriod = new Map();
  expectedAsOf = new Map();

  const push = (k: string, value: number, times: number) => {
    const held = expected.get(k) ?? [];
    for (let i = 0; i < times; i++) held.push(value);
    expected.set(k, held);
  };
  const bump = (map: Map<string, number>, k: string, value: number) =>
    map.set(k, (map.get(k) ?? 0) + value);

  for (const run of d.invoiceRuns) {
    const emis = emisByOpId.get(run.schoolId)!;
    // THE STATUS FILTER: DRAFT and VOIDED contribute NOTHING, anywhere — not to a row, not to a tally.
    if (!(BILLED_INVOICE_STATUSES as readonly string[]).includes(run.status)) continue;
    const pupils = run.toRank - run.fromRank + 1;
    // A bill with no period belongs to no term: TALLIED, never written.
    if (run.periodId === null || run.term === null) {
      bump(expectedNullPeriod, emis, pupils);
      continue;
    }
    const scope = `${emis}|${run.term}`;
    // The vintage is max(issued_at) over INCLUDED invoices, whatever stage their pupils resolve to.
    const held = expectedAsOf.get(scope);
    if (!held || run.issuedAt > held) expectedAsOf.set(scope, run.issuedAt);

    // Per CATEGORY per pupil: the band's own lines, with the DUES BRIDGE taking precedence over the name.
    const perCategory = new Map<OvFeeCategory, number>();
    for (const line of run.lines) {
      const category: OvFeeCategory = line.dues
        ? "PTA_DUES"
        : feeCategoryOf(line.categoryName);
      perCategory.set(category, (perCategory.get(category) ?? 0) + line.amountPesewas);
      if (category === "OTHER" && line.categoryName !== null) {
        const names = expectedOtherNames.get(scope) ?? new Set<string>();
        names.add(line.categoryName);
        expectedOtherNames.set(scope, names);
      }
    }

    const klass = classById.get(run.classId)!;
    const stage = stageOf(klass.level, klass.name);
    const billed = [...perCategory.values()].reduce((t, v) => t + v, 0);
    if (stage === "OUT_OF_SCOPE") {
      bump(expectedOutOfScope, scope, billed * pupils);
      continue;
    }
    if (stage === "UNMAPPED") {
      bump(expectedUnmapped, scope, billed * pupils);
      continue;
    }
    for (const [category, amount] of perCategory) {
      push(key(emis, run.term, category, stage), amount, pupils);
      // The POOLED all-stages distribution, accumulated INDEPENDENTLY — so "the stage-NULL row is the
      // pooled distribution" is a claim about the ETL and not a restatement of this loop.
      push(key(emis, run.term, category, null), amount, pupils);
      if (category === "OTHER") bump(expectedOther, scope, amount * pupils);
    }
  }
}

beforeAll(async () => {
  sql = adminDemoAnalytics();
  dataset = generateDemoDataset();
  await loadDemoSource(sql, dataset);
  schoolByEmis = new Map(dataset.schools.map((s) => [s.emisSchoolId, s]));
  buildExpectations(dataset);
  report = await runEtl();
}, 900_000);

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

// ── helpers over the written facts ──────────────────────────────────────────────────────────────

async function termPeriodId(term: number): Promise<string> {
  const rows = await sql<{ period_id: string }[]>`
    select period_id::text as period_id from dim_period
     where academic_year = ${ACADEMIC_YEAR} and term = ${term} and period_type = 'TERM'`;
  expect(rows).toHaveLength(1);
  return rows[0]!.period_id;
}

interface DbFeeRow {
  emis: string;
  term: number;
  period_type: string;
  fee_category: OvFeeCategory;
  stage: string | null;
  mean_amount: string;
  median_amount: string;
  source: string;
  as_of: string;
}

/** Every written row, keyed back to its EMIS id and its term. The whole table. */
async function allRows(): Promise<DbFeeRow[]> {
  return sql<DbFeeRow[]>`
    select d.ges_code as emis, dp.term, dp.period_type::text as period_type,
           f.fee_category::text as fee_category, f.stage,
           f.mean_amount::text as mean_amount, f.median_amount::text as median_amount,
           f.source::text as source, f.as_of_date::text as as_of
      from fact_fees f
      join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
      join dim_period dp on dp.period_id = f.period_id`;
}

async function fingerprint(): Promise<string> {
  const rows = await sql<{ f: string }[]>`
    select md5(string_agg(t.row, '|' order by t.row)) as f
      from (select (to_jsonb(f) - 'fact_id' - 'etl_run_id')::text as row from fact_fees f) t`;
  return rows[0]!.f;
}

async function rowCount(): Promise<number> {
  return (await sql<{ n: number }[]>`select count(*)::int as n from fact_fees`)[0]!.n;
}

function moduleText(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

/** Block and line comments removed, so a DOCUMENTED name is not mistaken for a REFERENCED one. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Round-trip a written row back into the shape the writer takes. Used by the write-path tests. */
function factRowFrom(db: Record<string, unknown>, periodId: string): FactFeesRow {
  return {
    jurisdictionId: db.jurisdiction_id as string,
    periodId,
    feeCategory: db.fee_category as OvFeeCategory,
    stage: (db.stage as AnalyticsStage | null) ?? null,
    meanAmount: String(db.mean_amount),
    medianAmount: String(db.median_amount),
    source: "OPERATIONAL_AGG",
    asOfDate: (db.as_of_date as Date).toISOString(),
    etlRunId: db.etl_run_id as string,
  };
}

/** The pure transform's target, for the unit-level blocks. */
const TARGET = {
  jurisdictionId: "10000000-0000-4000-8000-000000000011",
  periodId: "20000000-0000-4000-8000-000000000001",
  emisSchoolId: "GH-TEST-0001",
  etlRunId: "30000000-0000-4000-8000-0000000000aa",
  termEndsOn: "2026-04-02",
};

let groupSeq = 0;
const group = (over: Partial<FeeLineGroupRow>): FeeLineGroupRow => ({
  schoolId: "a1000000-0000-4000-8000-000000000001",
  // A fresh pupil per call unless the caller pins one: the measures are a per-PUPIL distribution, so a
  // shared default id would silently sum two fixtures into one child.
  studentId: `s0000000-0000-4000-8000-${String(++groupSeq).padStart(12, "0")}`,
  categoryName: "Tuition",
  isDues: false,
  classLevel: "Primary 4",
  className: "Primary 4",
  currentClassLabel: "Primary 4",
  hasClass: true,
  billedPesewas: 10_000,
  lastIssuedAt: "2026-02-17T09:00:00.000Z",
  ...over,
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CATEGORY: THE PURE RESOLVER AND THE DUES PRECEDENCE (criteria 1, 2, 3, 4)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the run writes a FIFTH fact table under one verdict (criterion 1)", () => {
  it("reaches SUCCESS with nothing to confess, and reports every declared term", async () => {
    expect(report.status).toBe("SUCCESS");
    expect(report.errorText).toBeNull();
    expect(report.feeTerms).toHaveLength(DEMO_TERMS.length);
    for (const [i, term] of report.feeTerms.entries()) {
      expect(term).toMatchObject({
        academicYear: DEMO_TERMS[i]!.academicYear,
        term: DEMO_TERMS[i]!.term,
        periodType: "TERM",
        startsOn: DEMO_TERMS[i]!.startsOn,
        endsOn: DEMO_TERMS[i]!.endsOn,
        failures: [],
      });
      expect(term.inserted).toBeGreaterThan(1_000);
      expect(term.schoolsComputed).toBeGreaterThan(500);
      expect(term.billedStudents).toBeGreaterThan(1_000);
    }
    // ALL FIVE arms wrote in the SAME run.
    const counts = (
      await sql<{ infra: number; enrol: number; attend: number; fees: number }[]>`
        select (select count(*)::int from fact_infrastructure)  as infra,
               (select count(*)::int from fact_enrolment)       as enrol,
               (select count(*)::int from fact_attendance)      as attend,
               (select count(*)::int from fact_fees)            as fees`
    )[0]!;
    expect(counts.infra).toBeGreaterThan(0);
    expect(counts.enrol).toBeGreaterThan(0);
    expect(counts.attend).toBeGreaterThan(0);
    expect(counts.fees).toBe(report.feeTerms.reduce((t, f) => t + f.inserted, 0));
  });

  it("CRITERION 1 · every written fee_category is an ov_fee_category member, and nothing else exists", async () => {
    const written = (
      await sql<{ fee_category: string }[]>`
        select distinct fee_category::text as fee_category from fact_fees order by 1`
    ).map((r) => r.fee_category);
    for (const category of written)
      expect(OV_FEE_CATEGORIES as readonly string[]).toContain(category);
    // The demo bills all six buckets, so "⊂ the enum" is not vacuously true of a two-member set.
    expect(written.sort()).toEqual([...OV_FEE_CATEGORIES].sort());
    // …and the enum itself is unchanged by this slice (criterion 20's enum half).
    const values = (
      await sql<{ enumlabel: string }[]>`
        select e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid
         where t.typname = 'ov_fee_category' order by e.enumsortorder`
    ).map((r) => r.enumlabel);
    expect(values).toEqual([...OV_FEE_CATEGORIES]);
  });
});

describe("CRITERION 2 · the category comes from a PURE RESOLVER over the category NAME", () => {
  it("maps each keyword family, case- and space-insensitively", () => {
    for (const name of ["Tuition", "TUITION FEES", "  school   fees ", "Academic Fees"])
      expect(feeCategoryOf(name)).toBe("TUITION");
    for (const name of ["Boarding Fees", "HOSTEL", "dormitory levy", "Residential Fee"])
      expect(feeCategoryOf(name)).toBe("BOARDING");
    for (const name of ["Feeding", "canteen", "MEALS", "Food Levy", "GSFP top-up"])
      expect(feeCategoryOf(name)).toBe("FEEDING");
    for (const name of [
      "Exam Fees",
      "EXAMINATION",
      "WAEC",
      "bece registration",
      "Mock Fees",
    ])
      expect(feeCategoryOf(name)).toBe("EXAM");
    // THE RESIDUAL — and the deliberate demo case among them.
    for (const name of [
      "Uniform",
      "Books",
      "Transport",
      "Sports Levy",
      DEMO_OTHER_CATEGORY,
      DEMO_DUES_CATEGORY,
      "",
      "   ",
    ])
      expect(feeCategoryOf(name)).toBe("OTHER");
    expect(feeCategoryOf(null)).toBe("OTHER");
  });

  it("checks SPECIFIC before GENERIC, so a '…Fees' label is not swallowed by TUITION", () => {
    // The decisive set: every one of these contains the word FEES, which is TUITION's own keyword.
    expect(feeCategoryOf("Boarding Fees")).toBe("BOARDING");
    expect(feeCategoryOf("Feeding Fees")).toBe("FEEDING");
    expect(feeCategoryOf("Examination Fees")).toBe("EXAM");
    // …and the generic branch still works when nothing more specific claims the label.
    expect(feeCategoryOf("School Fees")).toBe("TUITION");
  });

  it("never returns PTA_DUES from a name — the bridge is the only route (the type says so too)", () => {
    for (const name of ["PTA", "PTA Dues", "P.T.A. Levy", DEMO_DUES_CATEGORY])
      expect(feeCategoryOf(name)).toBe("OTHER");
    // The resolver module is PURE: no database, no clock, no randomness, and no mapping table read.
    const code = stripComments(moduleText("lib/etl/fee-category.ts"));
    expect(code).not.toMatch(
      /\b(postgres|sql|select|from\s+\w+_map|Date\.now|Math\.random)\b/,
    );
    // PTA_DUES appears exactly TWICE — once as a member of the enum vocabulary, once in the `Exclude<>`
    // that removes it from this function's return type — and NEVER as a return. A call site that tried to
    // get dues out of a name would therefore not even typecheck.
    expect(code.match(/PTA_DUES/g)).toHaveLength(2);
    expect(code).not.toMatch(/return\s+"PTA_DUES"/);
    expect(code).toContain('Exclude<OvFeeCategory, "PTA_DUES">');
  });

  it("the transform resolves from the NAME and never from a line's free-text description", () => {
    const code = stripComments(moduleText("lib/etl/fees.ts"));
    expect(code).toContain("feeCategoryOf(group.categoryName)");
    expect(code).not.toMatch(/\bdescription\b/);
    expect(stripComments(moduleText("lib/etl/fees-source.ts"))).not.toMatch(
      /\bdescription\b/,
    );
  });

  it("there is NO mapping table anywhere — not in analytics, not in the demo stand-in", async () => {
    const tables = (
      await sql<{ table_name: string }[]>`
        select table_name from information_schema.tables
         where table_schema = 'public' and table_name like '%fee%' order by 1`
    ).map((r) => r.table_name);
    // The ONLY `public` object with "fee" in its name is the fact table, which predates this slice.
    expect(tables).toEqual(["fact_fees"]);
    const demo = (
      await sql<{ table_name: string }[]>`
        select table_name from information_schema.tables
         where table_schema = 'demo_source' order by 1`
    ).map((r) => r.table_name);
    expect(demo).toContain("fee_category");
    // `fee_category` is the OPERATIONAL table the names come FROM, not a category→enum mapping.
    expect(demo.filter((t) => /map|lookup|xref/.test(t))).toEqual([]);
  });
});

describe("CRITERION 3 · a dues-bridged line is PTA_DUES regardless of its name", () => {
  it("the bridge outranks the resolver, in the pure transform", () => {
    const result = aggregateSchoolFees(
      [
        // The SAME category name, billed twice: once bridged, once not. The bridge decides.
        group({ categoryName: DEMO_DUES_CATEGORY, isDues: true, billedPesewas: 2_000 }),
        group({ categoryName: DEMO_DUES_CATEGORY, isDues: false, billedPesewas: 2_000 }),
        // …and a name that LOOKS like tuition but carries a dues row.
        group({ categoryName: "School Fees", isDues: true, billedPesewas: 3_000 }),
      ],
      TARGET,
    );
    const dues = result.rows.filter(
      (r) => r.feeCategory === "PTA_DUES" && r.stage === null,
    );
    expect(dues).toHaveLength(1);
    expect(dues[0]!.meanAmount).toBe("25.00"); // (20.00 + 30.00) / 2
    const other = result.rows.filter(
      (r) => r.feeCategory === "OTHER" && r.stage === null,
    );
    expect(other).toHaveLength(1);
    expect(other[0]!.meanAmount).toBe("20.00");
    expect(result.rows.some((r) => r.feeCategory === "TUITION")).toBe(false);
  });

  it("in the demo, PTA_DUES money can ONLY have come from the bridge", async () => {
    // The dues category's NAME resolves to OTHER (asserted above), so a resolver that guessed dues from a
    // name would publish ZERO PTA_DUES rows and a doubled OTHER. Both halves are visible here.
    expect(feeCategoryOf(DEMO_DUES_CATEGORY)).toBe("OTHER");
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_fees where fee_category = 'PTA_DUES'`;
    expect(rows[0]!.n).toBeGreaterThan(100);
  });

  it("the LEFT JOIN cannot fan out a line item — the 1:1 UNIQUE is the guarantee", async () => {
    // The structural half: the bridge is strictly 1:1 with its line item, in the stand-in as upstream.
    const unique = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_constraint
       where conname = 'uniq_pta_dues_charge_line_item' and contype = 'u'`;
    expect(unique[0]!.n).toBe(1);
    // The behavioural half: the reader's billed total for the dues lines of one school equals the raw
    // Σ amount of those lines. A fan-out would DOUBLE it, and the mean would still look plausible.
    const school = (
      await sql<{ op: string; emis: string }[]>`
        select r.operational_school_id::text as op, r.emis_school_id as emis
          from ref_emis_school_register r
         where r.on_schoolup and r.operational_school_id is not null
         order by r.emis_school_id limit 1`
    )[0]!;
    const raw = await sql<{ total: string }[]>`
      select coalesce(sum(li.amount), 0)::text as total
        from demo_source.invoice_line_item li
        join demo_source.pta_dues_charge pd
          on pd.school_id = li.school_id and pd.line_item_id = li.id
        join demo_source.invoice i on i.school_id = li.school_id and i.id = li.invoice_id
        join demo_source.academic_period ap
          on ap.school_id = i.school_id and ap.period_id = i.period_id
       where li.school_id = ${school.op}::uuid
         and i.status::text = any(${[...BILLED_INVOICE_STATUSES]}::text[])
         and ap.academic_year = ${ACADEMIC_YEAR}
         and ap.starts_on between ${FIRST_TERM.startsOn}::date and ${FIRST_TERM.endsOn}::date`;
    const { groups } = await readFeeLineGroups(sql, {
      schemaName: "demo_source",
      operationalSchoolIds: [school.op],
      academicYear: ACADEMIC_YEAR,
      startsOn: FIRST_TERM.startsOn,
      endsOn: FIRST_TERM.endsOn,
    });
    const read = groups.filter((g) => g.isDues).reduce((t, g) => t + g.billedPesewas, 0);
    expect(read).toBe(Math.round(Number(raw[0]!.total) * 100));
    expect(read).toBeGreaterThan(0);
  });
});

describe("CRITERION 4 · a line with no category and no bridge is OTHER", () => {
  it("resolves to OTHER in the pure transform, and never fails the school", () => {
    const result = aggregateSchoolFees(
      [group({ categoryName: null, isDues: false, billedPesewas: 4_500 })],
      TARGET,
    );
    expect(result.rows.map((r) => r.feeCategory)).toEqual(["OTHER", "OTHER"]);
    // …and a NULL name contributes NO unmapped NAME: there is no name to be unmapped.
    expect(result.otherCategoryNames).toEqual([]);
  });

  it("the deliberate OTHER category lands only in OTHER, and is the demo's only unmapped NAME", async () => {
    expect(feeCategoryOf(DEMO_OTHER_CATEGORY)).toBe("OTHER");
    // Every distinct unmapped name in the whole run is exactly that one label (the dues label is
    // overridden to PTA_DUES by the bridge, so it never counts as unmapped).
    for (const term of report.feeTerms) expect(term.otherCategoryNames).toBe(1);
    const names = new Set<string>();
    for (const scope of expectedOtherNames.values()) for (const n of scope) names.add(n);
    expect([...names]).toEqual([DEMO_OTHER_CATEGORY]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MEASURES: A PER-STUDENT DISTRIBUTION (criteria 5, 6, 7)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the two measures are re-derived from the group's own distribution (criteria 5, 6)", () => {
  it("CRITERION 5+6 · EVERY written row equals the hand-computed mean and median for its (school, term, category, stage)", async () => {
    const rows = await allRows();
    expect(rows.length).toBeGreaterThan(1_000);
    for (const row of rows) {
      const distribution = expected.get(
        key(row.emis, Number(row.term), row.fee_category, row.stage),
      );
      expect(
        distribution,
        `no expectation for ${row.emis} term ${row.term} ${row.fee_category}/${row.stage}`,
      ).toBeTruthy();
      expect(row.mean_amount).toBe(ghs(meanOf(distribution!)));
      expect(row.median_amount).toBe(ghs(medianOf(distribution!)));
      expect(row.source).toBe("OPERATIONAL_AGG");
    }
    // …and nothing the expectation holds is MISSING from the table (the other direction).
    const written = new Set(
      rows.map((r) => key(r.emis, Number(r.term), r.fee_category, r.stage)),
    );
    const missing = [...expected.keys()].filter((k) => !written.has(k));
    expect(missing).toEqual([]);
  });

  it("CRITERION 5+6 · POSTGRES re-derives the same mean and median from the source, with its own round() and percentile_cont()", async () => {
    // An engine that shares no code with the transform, over the operational rows rather than over the
    // generator's objects. `percentile_cont(0.5)` interpolates, which for an EVEN count is exactly the
    // mean of the two middle values — i.e. Kofi's median rule, independently implemented.
    const period = await termPeriodId(FIRST_TERM.term);
    // A school whose every class resolves to a real stage, so the all-stages row covers all its billed
    // pupils and the SQL below needs no stage filter.
    const edgeFree = dataset.schools.filter((s) => {
      if (!s.operationalSchoolId) return false;
      const classes = dataset.classes.filter((c) => c.schoolId === s.operationalSchoolId);
      return (
        classes.length > 0 &&
        classes.every(
          (c) => !["OUT_OF_SCOPE", "UNMAPPED"].includes(stageOf(c.level, c.name)),
        )
      );
    });
    expect(edgeFree.length).toBeGreaterThan(10);
    let checked = 0;
    for (const school of edgeFree.slice(0, 5)) {
      const stored = await sql<{ mean: string; median: string }[]>`
        select f.mean_amount::text as mean, f.median_amount::text as median
          from fact_fees f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
         where d.ges_code = ${school.emisSchoolId} and f.period_id = ${period}::uuid
           and f.fee_category = 'TUITION' and f.stage is null`;
      if (stored.length === 0) continue;
      const derived = await sql<{ mean: string; median: string }[]>`
        with per_student as (
          select i.student_id, sum(li.amount) as billed
            from demo_source.invoice_line_item li
            join demo_source.invoice i
                   on i.school_id = li.school_id and i.id = li.invoice_id
            join demo_source.academic_period ap
                   on ap.school_id = i.school_id and ap.period_id = i.period_id
            join demo_source.fee_category fc
                   on fc.school_id = li.school_id and fc.id = li.fee_category_id
            left join demo_source.pta_dues_charge pd
                   on pd.school_id = li.school_id and pd.line_item_id = li.id
           where li.school_id = ${school.operationalSchoolId!}::uuid
             and i.status::text = any(${[...BILLED_INVOICE_STATUSES]}::text[])
             and ap.academic_year = ${ACADEMIC_YEAR}
             and ap.starts_on between ${FIRST_TERM.startsOn}::date and ${FIRST_TERM.endsOn}::date
             and pd.line_item_id is null
             and (fc.name ilike '%tuition%' or fc.name ilike '%school fees%')
           group by i.student_id)
        select round(sum(billed) / count(*), 2)::text as mean,
               round(percentile_cont(0.5) within group (order by billed)::numeric, 2)::text as median
          from per_student`;
      expect(derived[0]!.mean).toBe(stored[0]!.mean);
      expect(derived[0]!.median).toBe(stored[0]!.median);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("CRITERION 5 · the mean is Σ PER-STUDENT billed ÷ DISTINCT billed students — not per line and not per invoice", () => {
    // One pupil, THREE tuition lines; one pupil, ONE. The mean is over TWO children, not four lines.
    const pupilA = "s0000000-0000-4000-8000-00000000000a";
    const pupilB = "s0000000-0000-4000-8000-00000000000b";
    const result = aggregateSchoolFees(
      [
        group({ studentId: pupilA, billedPesewas: 10_000 }),
        group({ studentId: pupilA, categoryName: "School Fees", billedPesewas: 20_000 }),
        group({ studentId: pupilA, categoryName: "Tuition Fees", billedPesewas: 30_000 }),
        group({ studentId: pupilB, billedPesewas: 20_000 }),
      ],
      TARGET,
    );
    const row = result.rows.find((r) => r.feeCategory === "TUITION" && r.stage === null)!;
    // Pupil A: 600.00. Pupil B: 200.00. Mean 400.00, median 400.00 (two values).
    expect(row.meanAmount).toBe("400.00");
    expect(row.medianAmount).toBe("400.00");
    expect(result.distributions.get(distributionKey("TUITION", null))).toEqual([
      20_000, 60_000,
    ]);
  });

  it("CRITERION 6 · an EVEN count takes the mean of the two middles, and rounding is half away from zero", () => {
    // 1.00, 2.00, 3.01, 4.00 → median (2.00 + 3.01)/2 = 2.505 → 2.51 (half away from zero, as Postgres).
    expect(ghsOf(medianPesewas([100, 200, 301, 400]))).toBe("2.51");
    // ODD count takes the middle value, untouched.
    expect(ghsOf(medianPesewas([100, 200, 301]))).toBe("2.00");
    // The mean's own exact-half case: 7/2 pesewas → 4, not 3.
    expect(ghsOf(meanPesewas([300, 400]))).toBe("3.50");
    expect(ghsOf(meanPesewas([301, 400]))).toBe("3.51");
    // …and the published columns are numeric(10,2): two decimals, always.
    const rows = aggregateSchoolFees(
      [
        group({ billedPesewas: 1 }),
        group({ billedPesewas: 2 }),
        group({ billedPesewas: 2 }),
      ],
      TARGET,
    ).rows;
    for (const row of rows) {
      expect(row.meanAmount).toMatch(/^\d+\.\d{2}$/);
      expect(row.medianAmount).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("CRITERION 6 · the stored column really is numeric(10,2), and the mean differs from the median in real data", async () => {
    const types = await sql<
      { column_name: string; data_type: string; precision: number; scale: number }[]
    >`
      select column_name, data_type, numeric_precision as precision, numeric_scale as scale
        from information_schema.columns
       where table_schema = 'public' and table_name = 'fact_fees'
         and column_name in ('mean_amount', 'median_amount')
       order by column_name`;
    expect(types).toHaveLength(2);
    for (const t of types) {
      expect(t.data_type).toBe("numeric");
      expect(Number(t.precision)).toBe(10);
      expect(Number(t.scale)).toBe(2);
    }
    // THE WHOLE POINT OF PUBLISHING BOTH: in real data they diverge, and the gap is the distribution's
    // shape. If they were always equal the second column would be noise.
    const diverged = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_fees where mean_amount <> median_amount`;
    expect(diverged[0]!.n).toBeGreaterThan(100);
  });
});

describe("CRITERION 7 · billed ZERO is a row; NOT BILLED is not", () => {
  it("a group with ≥1 billed pupil writes a row even when every amount is 0.00", () => {
    const result = aggregateSchoolFees(
      [group({ billedPesewas: 0 }), group({ billedPesewas: 0 })],
      TARGET,
    );
    expect(result.rows).toHaveLength(2); // the PRIMARY row and the all-stages row
    for (const row of result.rows) {
      expect(row.meanAmount).toBe("0.00");
      expect(row.medianAmount).toBe("0.00");
    }
  });

  it("the planted FREE-SHS schools publish REAL 0.00 tuition rows", async () => {
    const zeroes = await sql<
      { emis: string; stage: string | null; mean: string; median: string }[]
    >`
      select d.ges_code as emis, f.stage, f.mean_amount::text as mean,
             f.median_amount::text as median
        from fact_fees f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where f.fee_category = 'TUITION' and f.mean_amount = 0
       order by d.ges_code, f.stage nulls last`;
    expect(zeroes.length).toBeGreaterThan(0);
    for (const row of zeroes) expect(row.median).toBe("0.00");
    // THE DISTINCTION, asserted: the billed-0 schools HAVE tuition rows; the schools that bill no
    // boarding at all have NO boarding row. Neither is representable as the other.
    const freeShs = [...new Set(zeroes.map((r) => r.emis))];
    for (const emis of freeShs) {
      const billed = await sql<{ n: number }[]>`
        select count(*)::int as n
          from demo_source.invoice_line_item li
          join demo_source.invoice i on i.school_id = li.school_id and i.id = li.invoice_id
          join ref_emis_school_register r on r.operational_school_id = i.school_id
          join demo_source.fee_category fc
            on fc.school_id = li.school_id and fc.id = li.fee_category_id
         where r.emis_school_id = ${emis} and li.amount = 0
           and i.status::text = any(${[...BILLED_INVOICE_STATUSES]}::text[])`;
      // The row exists BECAUSE there are billed-zero lines, not because of an empty bucket.
      expect(billed[0]!.n).toBeGreaterThan(0);
    }
  });

  it("a category with NO line items at all produces NO row", async () => {
    // A KG/PRIMARY/JHS school has no `Boarding Fees` category in its fee book at all, so it must have no
    // BOARDING row — not a 0.00 one. (A 0.00 would assert "boarding here is free", which is a lie.)
    const nonBoarding = dataset.schools.find(
      (s) =>
        s.operationalSchoolId !== null &&
        s.schoolType !== "SHS" &&
        s.schoolType !== "COMBINED",
    )!;
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_fees f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where d.ges_code = ${nonBoarding.emisSchoolId} and f.fee_category = 'BOARDING'`;
    expect(rows[0]!.n).toBe(0);
    // …while it does have TUITION rows, so the zero above is an absence of BOARDING and not of the school.
    const tuition = await sql<{ n: number }[]>`
      select count(*)::int as n from fact_fees f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where d.ges_code = ${nonBoarding.emisSchoolId} and f.fee_category = 'TUITION'`;
    expect(tuition[0]!.n).toBeGreaterThan(0);
    // The pure transform's own statement of the same rule: an empty group list writes nothing.
    expect(aggregateSchoolFees([], TARGET).rows).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STATUS FILTER AND THE BILLED FIGURE (criteria 8, 9)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("CRITERION 8 · DRAFT and VOIDED contribute nothing; the other five do", () => {
  it("the allow-list is explicit, and it is the one the reader filters on", () => {
    expect([...BILLED_INVOICE_STATUSES]).toEqual([
      "ISSUED",
      "PARTIAL",
      "PAID",
      "OVERDUE",
      "EXEMPT",
    ]);
    const code = moduleText("lib/etl/fees-source.ts");
    expect(code).toContain(
      "i.status::text = any(${[...BILLED_INVOICE_STATUSES]}::text[])",
    );
  });

  it("a DRAFT or VOIDED bill's pupil is absent from the reader's groups entirely", async () => {
    const school = (
      await sql<{ op: string }[]>`
        select r.operational_school_id::text as op from ref_emis_school_register r
         where r.on_schoolup and r.operational_school_id is not null
         order by r.emis_school_id limit 1`
    )[0]!;
    const excluded = await sql<{ student_id: string; status: string }[]>`
      select distinct i.student_id::text as student_id, i.status::text as status
        from demo_source.invoice i
       where i.school_id = ${school.op}::uuid and i.status::text in ('DRAFT', 'VOIDED')
       order by 1 limit 20`;
    expect(excluded.length).toBeGreaterThan(0);
    expect(new Set(excluded.map((e) => e.status)).size).toBe(2);
    const { groups } = await readFeeLineGroups(sql, {
      schemaName: "demo_source",
      operationalSchoolIds: [school.op],
      academicYear: ACADEMIC_YEAR,
      startsOn: FIRST_TERM.startsOn,
      endsOn: FIRST_TERM.endsOn,
    });
    const billedPupils = new Set(groups.map((g) => g.studentId));
    // A pupil whose ONLY bills are DRAFT/VOIDED cannot appear. (A pupil may hold a draft in one term and
    // a real bill in another, so the assertion is over pupils with no included bill at all.)
    for (const row of excluded) {
      const included = await sql<{ n: number }[]>`
        select count(*)::int as n from demo_source.invoice i
          join demo_source.academic_period ap
            on ap.school_id = i.school_id and ap.period_id = i.period_id
         where i.school_id = ${school.op}::uuid
           and i.student_id = ${row.student_id}::uuid
           and i.status::text = any(${[...BILLED_INVOICE_STATUSES]}::text[])
           and ap.academic_year = ${ACADEMIC_YEAR}
           and ap.starts_on between ${FIRST_TERM.startsOn}::date and ${FIRST_TERM.endsOn}::date`;
      if (included[0]!.n === 0) expect(billedPupils.has(row.student_id)).toBe(false);
    }
  });

  it("including the excluded pair would change the published figure — so the filter is load-bearing", async () => {
    const school = (
      await sql<{ op: string }[]>`
        select r.operational_school_id::text as op from ref_emis_school_register r
         where r.on_schoolup and r.operational_school_id is not null
         order by r.emis_school_id limit 1`
    )[0]!;
    const counts = await sql<{ billed: number; all_statuses: number }[]>`
      select count(distinct case when i.status::text = any(${[...BILLED_INVOICE_STATUSES]}::text[])
                                 then i.student_id end)::int as billed,
             count(distinct i.student_id)::int as all_statuses
        from demo_source.invoice i
        join demo_source.academic_period ap
          on ap.school_id = i.school_id and ap.period_id = i.period_id
       where i.school_id = ${school.op}::uuid
         and ap.academic_year = ${ACADEMIC_YEAR}
         and ap.starts_on between ${FIRST_TERM.startsOn}::date and ${FIRST_TERM.endsOn}::date`;
    expect(counts[0]!.billed).toBeLessThan(counts[0]!.all_statuses);
  });

  it("EXEMPT is INCLUDED and billed-as-charged — the flagged default, asserted so a change is deliberate", async () => {
    expect([...BILLED_INVOICE_STATUSES]).toContain("EXEMPT");
    const school = (
      await sql<{ op: string }[]>`
        select i.school_id::text as op from demo_source.invoice i
         where i.status = 'EXEMPT' group by 1 order by 1 limit 1`
    )[0]!;
    const exemptPupils = (
      await sql<{ student_id: string }[]>`
        select distinct i.student_id::text as student_id from demo_source.invoice i
          join demo_source.academic_period ap
            on ap.school_id = i.school_id and ap.period_id = i.period_id
         where i.school_id = ${school.op}::uuid and i.status = 'EXEMPT'
           and ap.starts_on between ${FIRST_TERM.startsOn}::date and ${FIRST_TERM.endsOn}::date
         order by 1`
    ).map((r) => r.student_id);
    expect(exemptPupils.length).toBeGreaterThan(0);
    const { groups } = await readFeeLineGroups(sql, {
      schemaName: "demo_source",
      operationalSchoolIds: [school.op],
      academicYear: ACADEMIC_YEAR,
      startsOn: FIRST_TERM.startsOn,
      endsOn: FIRST_TERM.endsOn,
    });
    const read = new Set(groups.map((g) => g.studentId));
    // Every exempt pupil is in the distribution, and with a NON-ZERO amount: the exemption is a
    // collection decision, and the published figure is what the school CHARGED.
    for (const pupil of exemptPupils) expect(read.has(pupil)).toBe(true);
    const exemptAmounts = groups.filter((g) => exemptPupils.includes(g.studentId));
    expect(exemptAmounts.some((g) => g.billedPesewas > 0)).toBe(true);
  });
});

describe("CRITERION 9 · the billed figure is the LINE's amount; rate_snapshot is never read", () => {
  it("the modules never mention rate_snapshot, and the stand-in does not even carry it", async () => {
    for (const path of ["lib/etl/fees-source.ts", "lib/etl/fees.ts"])
      expect(stripComments(moduleText(path))).not.toMatch(/\brate_snapshot\b/);
    const columns = (
      await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
         where table_schema = 'demo_source' and table_name = 'pta_dues_charge'
         order by 1`
    ).map((c) => c.column_name);
    expect(columns).toEqual(["id", "line_item_id", "school_id"]);
    // Non-vacuous: the REAL table carries `rate_snapshot` (and the identity columns), so omitting them
    // here is a choice rather than an accident.
    const real = moduleText("../web/db/schema/pta.ts");
    expect(real).toContain('money("rate_snapshot")');
    expect(real).toContain('uuid("subject_student_id")');
  });

  it("the published dues figure equals Σ the line amounts — not Σ the snapshots, and not both", async () => {
    // The decisive arithmetic: if the snapshot were summed beside the amount, every dues mean would be
    // exactly double. Compared against the raw line amounts for one school's whole dues distribution.
    const period = await termPeriodId(FIRST_TERM.term);
    const row = (
      await sql<{ emis: string; op: string; mean: string }[]>`
        select d.ges_code as emis, r.operational_school_id::text as op,
               f.mean_amount::text as mean
          from fact_fees f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
          join ref_emis_school_register r on r.emis_school_id = d.ges_code
         where f.period_id = ${period}::uuid and f.fee_category = 'PTA_DUES' and f.stage is null
         order by d.ges_code limit 1`
    )[0]!;
    const derived = await sql<{ mean: string }[]>`
      with per_student as (
        select i.student_id, sum(li.amount) as billed
          from demo_source.invoice_line_item li
          join demo_source.pta_dues_charge pd
                 on pd.school_id = li.school_id and pd.line_item_id = li.id
          join demo_source.invoice i on i.school_id = li.school_id and i.id = li.invoice_id
          join demo_source.academic_period ap
                 on ap.school_id = i.school_id and ap.period_id = i.period_id
          join demo_source.students st on st.school_id = i.school_id and st.id = i.student_id
          join demo_source.class c on c.school_id = st.school_id and c.id = st.class_id
         where li.school_id = ${row.op}::uuid
           and i.status::text = any(${[...BILLED_INVOICE_STATUSES]}::text[])
           and ap.academic_year = ${ACADEMIC_YEAR}
           and ap.starts_on between ${FIRST_TERM.startsOn}::date and ${FIRST_TERM.endsOn}::date
         group by i.student_id)
      select round(sum(billed) / count(*), 2)::text as mean from per_student`;
    expect(row.mean).toBe(derived[0]!.mean);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STAGE, ITS TWO NON-STAGES, AND THE ALL-STAGES ROW (criteria 10, 11, 12)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("CRITERION 10 · the stage comes from stageOf over the invoiced pupil's class", () => {
  it("the transform calls stageOf and re-implements no label parsing", () => {
    const code = stripComments(moduleText("lib/etl/fees.ts"));
    expect(code).toContain("stageOf(level, name)");
    // No regex literal and no hand-rolled label vocabulary: the ruling lives in ONE module.
    expect(code).not.toMatch(/\b(KINDERGARTEN|PRIMARY\s*\d|JHS|BASIC)\b/);
    for (const word of ["KG", "SHS"]) expect(code).not.toContain(`"${word}"`);
    // …and the precedence is the roster arm's, verbatim: the class's own label, else the pupil's label.
    expect(code).toContain("group.hasClass ? group.classLevel : group.currentClassLabel");
  });

  it("a pupil's own class decides the stage, not the school type", () => {
    const result = aggregateSchoolFees(
      [
        group({ classLevel: "Form 2", className: "Form 2 Science" }),
        group({ classLevel: "Basic 8", className: "Basic 8" }),
        group({
          classLevel: null,
          className: null,
          hasClass: false,
          currentClassLabel: "JHS 2",
        }),
      ],
      TARGET,
    );
    const stages = result.rows.filter((r) => r.stage !== null).map((r) => r.stage);
    // "Form" is SHS and "Basic 8" is JHS — the two corrections `stage.ts` exists for, reached from here.
    expect(new Set(stages)).toEqual(new Set(["SHS", "JHS"]));
  });

  it("every written stage is a dim_stage key, and the FK makes an invented one impossible", async () => {
    const stages = (
      await sql<{ stage: string | null }[]>`
        select distinct stage from fact_fees order by stage nulls last`
    ).map((r) => r.stage);
    expect(stages).toContain(null); // the all-stages row
    const keys = (
      await sql<{ stage: string }[]>`select stage from dim_stage order by display_order`
    ).map((r) => r.stage);
    for (const stage of stages.filter((s) => s !== null)) expect(keys).toContain(stage);
    // The structural floor: `fact_fees.stage` is a FK to `dim_stage`, so an empty-string or invented
    // stage cannot be written at all — which is also why criterion 16 below cannot test an '' collision.
    const fk = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_constraint
       where conrelid = 'fact_fees'::regclass and contype = 'f'
         and confrelid = 'dim_stage'::regclass`;
    expect(fk[0]!.n).toBe(1);
  });
});

describe("CRITERION 11 · out-of-scope and unmapped pupils reach NO row and are TALLIED", () => {
  it("the pure transform tallies the GHS and writes nothing for them", () => {
    const result = aggregateSchoolFees(
      [
        group({ classLevel: "Nursery 1", className: "Nursery 1", billedPesewas: 5_000 }),
        group({ classLevel: null, className: "Transition Stream", billedPesewas: 7_000 }),
        group({ billedPesewas: 9_000 }),
      ],
      TARGET,
    );
    expect(result.outOfScopeBilledPesewas).toBe(5_000);
    expect(result.unmappedBilledPesewas).toBe(7_000);
    // Only the resolvable pupil reached a row, and the tallied money is in NO row's distribution.
    expect(result.billedPesewas).toBe(9_000);
    expect(result.rows).toHaveLength(2);
    for (const row of result.rows) expect(row.meanAmount).toBe("90.00");
  });

  it("the demo's planted Nursery and Transition classes are tallied per school AND run-wide", async () => {
    for (const term of report.feeTerms) {
      const handOutOfScope = [...expectedOutOfScope.entries()]
        .filter(([k]) => k.endsWith(`|${term.term}`))
        .reduce((t, [, v]) => t + v, 0);
      const handUnmapped = [...expectedUnmapped.entries()]
        .filter(([k]) => k.endsWith(`|${term.term}`))
        .reduce((t, [, v]) => t + v, 0);
      expect(term.outOfScopeBilled).toBe(ghs(handOutOfScope));
      expect(term.unmappedStageBilled).toBe(ghs(handUnmapped));
      expect(handOutOfScope).toBeGreaterThan(0);
      expect(handUnmapped).toBeGreaterThan(0);
      // PER SCHOOL, too — a national total nobody can attribute is not a degradation signal.
      for (const school of term.perSchool) {
        const scope = `${school.emisSchoolId}|${term.term}`;
        expect(school.outOfScopeBilled).toBe(ghs(expectedOutOfScope.get(scope) ?? 0));
        expect(school.unmappedStageBilled).toBe(ghs(expectedUnmapped.get(scope) ?? 0));
      }
      expect(term.perSchool.length).toBeGreaterThan(0);
    }
  });
});

describe("CRITERION 12 · exactly one stage IS NULL row per (jurisdiction, period, category)", () => {
  it("every (school, period, category) has exactly one all-stages row", async () => {
    const offenders = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id, fee_category,
               count(*) filter (where stage is null) as all_stages
          from fact_fees
         group by jurisdiction_id, period_id, fee_category
        having count(*) filter (where stage is null) <> 1
      ) d`;
    expect(offenders[0]!.n).toBe(0);
  });

  it("the all-stages figures are the POOLED distribution's — NOT a sum or average of the stage rows", async () => {
    // A multi-stage school, where the two are genuinely different numbers.
    const multi = await sql<
      { emis: string; period_id: string; fee_category: string; stages: number }[]
    >`
        select d.ges_code as emis, f.period_id::text as period_id,
               f.fee_category::text as fee_category,
               count(*) filter (where f.stage is not null)::int as stages
          from fact_fees f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
         group by 1, 2, 3 having count(*) filter (where f.stage is not null) >= 3
         order by 1, 2, 3 limit 5`;
    expect(multi.length).toBeGreaterThan(0);
    let divergent = 0;
    for (const g of multi) {
      const rows = await sql<{ stage: string | null; mean: string; median: string }[]>`
        select f.stage, f.mean_amount::text as mean, f.median_amount::text as median
          from fact_fees f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
         where d.ges_code = ${g.emis} and f.period_id = ${g.period_id}::uuid
           and f.fee_category::text = ${g.fee_category}`;
      const pooled = rows.find((r) => r.stage === null)!;
      const stages = rows.filter((r) => r.stage !== null);
      const sumOfStages = stages.reduce((t, r) => t + Number(r.mean), 0);
      const avgOfStages = sumOfStages / stages.length;
      // The pooled mean is a WEIGHTED figure: it is neither the sum nor the unweighted average of the
      // stage means (unless every stage billed the same number of pupils, which real data does not).
      if (Number(pooled.mean) !== sumOfStages && Number(pooled.mean) !== avgOfStages)
        divergent += 1;
      // And the hand expectation agrees it came from the POOLED distribution.
      const term = (
        await sql<{ term: number }[]>`
          select term from dim_period where period_id = ${g.period_id}::uuid`
      )[0]!.term;
      const distribution = expected.get(key(g.emis, Number(term), g.fee_category, null))!;
      expect(pooled.mean).toBe(ghs(meanOf(distribution)));
      expect(pooled.median).toBe(ghs(medianOf(distribution)));
      // The pooled distribution covers EVERY stage's pupils — the property that DOES hold.
      const stageCount = stages.reduce(
        (t, r) =>
          t + expected.get(key(g.emis, Number(term), g.fee_category, r.stage))!.length,
        0,
      );
      expect(distribution.length).toBe(stageCount);
    }
    // At least one real group where recombining the stage rows would have produced a different answer.
    expect(divergent).toBeGreaterThan(0);
  });

  it("stage IS NULL means ALL STAGES — never 'a stage we could not resolve'", () => {
    // The unmapped pupil is tallied and reaches no row, so the only NULL-stage row is the pooled one,
    // and its distribution is the resolvable pupil's alone.
    const result = aggregateSchoolFees(
      [
        group({ billedPesewas: 10_000 }),
        group({
          classLevel: null,
          className: "Transition Stream",
          billedPesewas: 99_000,
        }),
      ],
      TARGET,
    );
    const pooled = result.rows.find((r) => r.stage === null)!;
    expect(pooled.meanAmount).toBe("100.00");
    expect(result.unmappedBilledPesewas).toBe(99_000);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PERIOD: TERM, VIA THE INVOICE'S OWN academic_period (criteria 13, 14)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("CRITERION 13 · the grain is TERM, resolved through academic_period and never period_number", () => {
  it("every row is at a TERM period, and no ANNUAL or EXAM_COHORT fee row exists", async () => {
    const rows = await sql<{ period_type: string; n: number }[]>`
      select dp.period_type::text as period_type, count(*)::int as n
        from fact_fees f join dim_period dp on dp.period_id = f.period_id
       group by 1 order by 1`;
    expect(rows).toEqual([{ period_type: "TERM", n: await rowCount() }]);
  });

  it("the resolution reads academic_period's academic_year and dates — NOT period_number", () => {
    const code = stripComments(moduleText("lib/etl/fees-source.ts"));
    expect(code).toContain(".academic_period ap");
    expect(code).toContain("ap.academic_year = ${query.academicYear}");
    expect(code).toContain("ap.starts_on >= ${query.startsOn}::date");
    // THE TRAP: `period_number` means a TERM on a BASIC row and a SEMESTER on a SENIOR one, so it is
    // never a mapping key. Nor is `period_label` ("Semester 1"), which is display only.
    expect(code).not.toMatch(/\bperiod_number\b/);
    expect(code).not.toMatch(/\bperiod_label\b/);
    expect(code).not.toMatch(/\bproduct_line\b/);
  });

  it("each term's groups are exactly the invoices whose operational period opens in ITS window", async () => {
    const operationalIds = (
      await sql<{ op: string }[]>`
        select r.operational_school_id::text as op from ref_emis_school_register r
         where r.on_schoolup and r.operational_school_id is not null
         order by r.emis_school_id limit 4`
    ).map((r) => r.op);
    for (const term of DEMO_TERMS) {
      const { groups } = await readFeeLineGroups(sql, {
        schemaName: "demo_source",
        operationalSchoolIds: operationalIds,
        academicYear: term.academicYear,
        startsOn: term.startsOn,
        endsOn: term.endsOn,
      });
      const expectedPupils = await sql<{ n: number }[]>`
        select count(distinct i.student_id)::int as n
          from demo_source.invoice i
          join demo_source.invoice_line_item li
            on li.school_id = i.school_id and li.invoice_id = i.id
          join demo_source.academic_period ap
            on ap.school_id = i.school_id and ap.period_id = i.period_id
         where i.school_id = any(${operationalIds}::uuid[])
           and i.status::text = any(${[...BILLED_INVOICE_STATUSES]}::text[])
           and ap.academic_year = ${term.academicYear}
           and ap.starts_on between ${term.startsOn}::date and ${term.endsOn}::date`;
      expect(new Set(groups.map((g) => g.studentId)).size).toBe(expectedPupils[0]!.n);
      expect(groups.length).toBeGreaterThan(0);
    }
    // SENIOR schools file SEMESTERS, whose `period_number` collides with a term's — and they still land
    // in exactly one term each, because the resolution is by date and not by number.
    const senior = await sql<{ n: number }[]>`
      select count(*)::int as n from demo_source.academic_period
       where product_line = 'SENIOR' and period_number = 1`;
    expect(senior[0]!.n).toBeGreaterThan(0);
  });
});

describe("CRITERION 14 · a period-less invoice is TALLIED, not written", () => {
  it("the run reports the count per school AND run-wide, matching the hand count", async () => {
    const handTotal = [...expectedNullPeriod.values()].reduce((t, v) => t + v, 0);
    expect(handTotal).toBeGreaterThan(0);
    expect(report.feesNullPeriodInvoices.total).toBe(handTotal);
    expect(report.feesNullPeriodInvoices.bySchool.length).toBe(expectedNullPeriod.size);
    for (const row of report.feesNullPeriodInvoices.bySchool)
      expect(row.invoices).toBe(expectedNullPeriod.get(row.emisSchoolId));
    // The source read really does return them to be counted, and the counter is bounded like every read.
    expect(
      await countInvoicesWithoutPeriod(sql, {
        schemaName: "demo_source",
        operationalSchoolIds: [],
      }),
    ).toEqual([]);
  });

  it("their money reaches no row: the planted school's figures are the ones WITHOUT that bill", async () => {
    const emis = report.feesNullPeriodInvoices.bySchool[0]!.emisSchoolId;
    const period = await termPeriodId(FIRST_TERM.term);
    const rows = await sql<
      { fee_category: string; stage: string | null; mean: string }[]
    >`
      select f.fee_category::text as fee_category, f.stage, f.mean_amount::text as mean
        from fact_fees f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
       where d.ges_code = ${emis} and f.period_id = ${period}::uuid`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const distribution = expected.get(
        key(emis, FIRST_TERM.term, row.fee_category, row.stage),
      )!;
      // `buildExpectations` skips the period-less bill entirely, so agreement here IS the claim.
      expect(row.mean).toBe(ghs(meanOf(distribution)));
    }
    // And the bill really exists in the source, unclaimed by any term.
    const unclaimed = await sql<{ n: number }[]>`
      select count(*)::int as n from demo_source.invoice i
        join ref_emis_school_register r on r.operational_school_id = i.school_id
       where r.emis_school_id = ${emis} and i.period_id is null`;
    expect(unclaimed[0]!.n).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WRITE: BOUNDED DELETE, DUPLICATE ASSERTION, VINTAGE (criteria 15, 16, 17)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("CRITERION 15 · the delete is bounded by (period, jurisdiction ∈ computed)", () => {
  it("a bystander school survives a rewrite of another school's term", async () => {
    const period = await termPeriodId(FIRST_TERM.term);
    const two = await sql<{ jurisdiction_id: string }[]>`
      select distinct jurisdiction_id::text as jurisdiction_id from fact_fees
       where period_id = ${period}::uuid order by jurisdiction_id limit 2`;
    const [bystander, rewritten] = two;
    const before = await sql<{ n: number; means: string }[]>`
      select count(*)::int as n, string_agg(mean_amount::text, ',' order by fee_category, stage) as means
        from fact_fees
       where period_id = ${period}::uuid and jurisdiction_id = ${bystander!.jurisdiction_id}::uuid`;
    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_fees
       where period_id = ${period}::uuid and jurisdiction_id = ${rewritten!.jurisdiction_id}::uuid`;
    const result = await writeFeesFacts(sql, [
      {
        periodId: period,
        jurisdictionIds: [rewritten!.jurisdiction_id],
        rows: existing.map((r) => factRowFrom(r, period)),
      },
    ]);
    expect(result).toMatchObject({
      deleted: existing.length,
      inserted: existing.length,
    });
    const after = await sql<{ n: number; means: string }[]>`
      select count(*)::int as n, string_agg(mean_amount::text, ',' order by fee_category, stage) as means
        from fact_fees
       where period_id = ${period}::uuid and jurisdiction_id = ${bystander!.jurisdiction_id}::uuid`;
    expect(after[0]).toEqual(before[0]);
  });

  it("the arm is PER TERM: rewriting one term leaves the other term's rows untouched", async () => {
    const first = await termPeriodId(FIRST_TERM.term);
    const last = await termPeriodId(LAST_TERM.term);
    const lastBefore = await fingerprintFor(last);
    const victim = (
      await sql<{ jurisdiction_id: string }[]>`
        select distinct jurisdiction_id::text as jurisdiction_id from fact_fees
         where period_id = ${first}::uuid order by jurisdiction_id limit 1`
    )[0]!;
    const rows = (
      await sql<Record<string, unknown>[]>`
        select * from fact_fees
         where period_id = ${first}::uuid and jurisdiction_id = ${victim.jurisdiction_id}::uuid`
    ).map((r) => factRowFrom(r, first));
    await writeFeesFacts(sql, [
      { periodId: first, jurisdictionIds: [victim.jurisdiction_id], rows },
    ]);
    expect(await fingerprintFor(last)).toBe(lastBefore);
  });

  it("a school COMPUTED TO ZERO is in the delete scope and really empties; one with NO invoices keeps its rows", async () => {
    // ⚠ THE TWO HALVES THAT LOOK THE SAME AND ARE NOT. Both are tested against the SAME school shape, so
    // the difference cannot be an accident of which school was picked.
    const last = await termPeriodId(LAST_TERM.term);
    const rowsFor = async (emis: string) =>
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n from fact_fees f
            join dim_jurisdiction d using (jurisdiction_id)
           where d.ges_code = ${emis} and f.period_id = ${last}::uuid`
      )[0]!.n;

    // (a) COMPUTED TO ZERO — a school whose only remaining invoiced pupils are in a below-KG class. It IS
    // computed (the read returns groups), produces NO rows, and is therefore in the delete scope: its
    // previously published rows must GO.
    const nursery = dataset.classes.find(
      (c) =>
        c.level === "Nursery 1" &&
        dataset.invoiceRuns.some((r) => r.classId === c.classId),
    )!;
    const zeroSchool = dataset.schools.find(
      (s) => s.operationalSchoolId === nursery.schoolId,
    )!;
    const zeroBefore = await rowsFor(zeroSchool.emisSchoolId);
    expect(zeroBefore).toBeGreaterThan(0);

    // (b) NO INVOICES AT ALL — not computed, not in the delete scope, keeps its prior rows.
    const keeper = (
      await sql<{ emis: string; op: string }[]>`
        select distinct d.ges_code as emis, r.operational_school_id::text as op
          from fact_fees f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
          join ref_emis_school_register r on r.emis_school_id = d.ges_code
         where f.period_id = ${last}::uuid and d.ges_code <> ${zeroSchool.emisSchoolId}
         order by d.ges_code limit 1`
    )[0]!;
    const keeperBefore = await sql<{ f: string | null }[]>`
      select md5(string_agg((to_jsonb(f) - 'fact_id' - 'etl_run_id')::text, '|' order by
             (to_jsonb(f) - 'fact_id' - 'etl_run_id')::text)) as f
        from fact_fees f join dim_jurisdiction d using (jurisdiction_id)
       where d.ges_code = ${keeper.emis} and f.period_id = ${last}::uuid`;

    try {
      // (a) keep ONLY the nursery pupils' invoices for this school.
      await sql`
        delete from demo_source.invoice
         where school_id = ${zeroSchool.operationalSchoolId!}::uuid
           and student_id not in (
             select id from demo_source.students
              where school_id = ${zeroSchool.operationalSchoolId!}::uuid
                and class_id = ${nursery.classId}::uuid)`;
      // (b) remove the keeper's invoices entirely.
      await sql`delete from demo_source.invoice where school_id = ${keeper.op}::uuid`;

      const run = await runEtl();
      expect(run.status).toBe("SUCCESS");
      const outcome = run.feeTerms.find((f) => f.term === LAST_TERM.term)!;
      expect(outcome.failures).toEqual([]);
      // (a) COMPUTED (so in the scope) → emptied. Its money is now entirely in the out-of-scope tally.
      expect(outcome.noInvoices).not.toContain(zeroSchool.emisSchoolId);
      expect(await rowsFor(zeroSchool.emisSchoolId)).toBe(0);
      expect(
        outcome.perSchool.find((p) => p.emisSchoolId === zeroSchool.emisSchoolId)
          ?.outOfScopeBilled,
      ).toBeDefined();
      // (b) NOT COMPUTED → named, and its rows are exactly as they were. Stale-but-honest.
      expect(outcome.noInvoices).toContain(keeper.emis);
      const keeperAfter = await sql<{ f: string | null }[]>`
        select md5(string_agg((to_jsonb(f) - 'fact_id' - 'etl_run_id')::text, '|' order by
               (to_jsonb(f) - 'fact_id' - 'etl_run_id')::text)) as f
          from fact_fees f join dim_jurisdiction d using (jurisdiction_id)
         where d.ges_code = ${keeper.emis} and f.period_id = ${last}::uuid`;
      expect(keeperAfter[0]!.f).toBe(keeperBefore[0]!.f);
    } finally {
      await loadDemoSource(sql, dataset);
      report = await runEtl();
    }
    expect(await rowsFor(zeroSchool.emisSchoolId)).toBe(zeroBefore);
  }, 900_000);

  it("ONE bad school fails ITSELF: the run survives, names it, and keeps its PRIOR rows", async () => {
    // Per-school isolation, through the REAL pipeline. A NEGATIVE billed total is the one way a school's
    // invoices can be unaggregatable (a credit note is not a fee — see `lib/etl/fees.ts`).
    const victim = (
      await sql<{ emis: string; op: string }[]>`
        select distinct d.ges_code as emis, r.operational_school_id::text as op
          from fact_fees f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
          join ref_emis_school_register r on r.emis_school_id = d.ges_code
         order by d.ges_code limit 1`
    )[0]!;
    const rowsFor = async (emis: string) =>
      (
        await sql<{ n: number; means: string | null }[]>`
          select count(*)::int as n,
                 string_agg(f.mean_amount::text, ',' order by f.period_id, f.fee_category, f.stage) as means
            from fact_fees f join dim_jurisdiction d using (jurisdiction_id)
           where d.ges_code = ${emis}`
      )[0]!;
    const before = await rowsFor(victim.emis);
    expect(before.n).toBeGreaterThan(0);
    try {
      await sql`
        update demo_source.invoice_line_item set amount = -500.00
         where id in (
           select li.id from demo_source.invoice_line_item li
             join demo_source.invoice i
               on i.school_id = li.school_id and i.id = li.invoice_id
            where li.school_id = ${victim.op}::uuid
              -- The lines must be ones the READ actually returns, or the school would compute fine and
              -- this would assert nothing. invoice.id is DB-generated, so it is NOT stable across the
              -- reloads the earlier tests perform — picking by li.id alone made this test pass
              -- or fail depending on whether the three it happened to hit were DRAFT/VOIDED.
              and i.status::text = any(${[...BILLED_INVOICE_STATUSES]}::text[])
              and i.period_id is not null
            order by li.id limit 3)`;
      const run = await runEtl();
      expect(run.status).toBe("SUCCESS");
      expect(run.errorText).toMatch(/SUCCESS WITH GAPS/);
      const named = run.feeTerms.flatMap((f) => f.failures);
      expect(named.some((f) => f.emisSchoolId === victim.emis)).toBe(true);
      expect(named.every((f) => /negative/.test(f.message))).toBe(true);
      // ⚠ A FAILED SCHOOL KEEPS ITS PRIOR ROWS — excluded from the delete scope, not emptied.
      expect(await rowsFor(victim.emis)).toEqual(before);
    } finally {
      await loadDemoSource(sql, dataset);
      report = await runEtl();
    }
    expect(await rowsFor(victim.emis)).toEqual(before);
  }, 900_000);
});

async function fingerprintFor(periodId: string): Promise<string | null> {
  const rows = await sql<{ f: string | null }[]>`
    select md5(string_agg(t.row, '|' order by t.row)) as f
      from (select (to_jsonb(f) - 'fact_id' - 'etl_run_id')::text as row
              from fact_fees f where f.period_id = ${periodId}::uuid) t`;
  return rows[0]!.f;
}

describe("CRITERION 16 · the NULL-safe duplicate assertion", () => {
  it("an injected duplicate of a STAGE row FAILS the write inside the txn and rolls everything back", async () => {
    const period = await termPeriodId(FIRST_TERM.term);
    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_fees where period_id = ${period}::uuid and stage is not null
       order by jurisdiction_id, fee_category, stage limit 1`;
    const row = factRowFrom(existing[0]!, period);
    const before = await rowCount();
    await expect(
      writeFeesFacts(sql, [
        {
          periodId: period,
          jurisdictionIds: [row.jurisdictionId],
          rows: [row, { ...row }],
        },
      ]),
    ).rejects.toThrow(/duplicated grain key/);
    expect(await rowCount()).toBe(before);
  });

  it("an injected duplicate of the stage IS NULL row ALSO fails — the NULL side of the key", async () => {
    const period = await termPeriodId(FIRST_TERM.term);
    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_fees where period_id = ${period}::uuid and stage is null
       order by jurisdiction_id, fee_category limit 1`;
    const row = factRowFrom(existing[0]!, period);
    expect(row.stage).toBeNull();
    const before = await rowCount();
    await expect(
      writeFeesFacts(sql, [
        {
          periodId: period,
          jurisdictionIds: [row.jurisdictionId],
          rows: [row, { ...row }],
        },
      ]),
    ).rejects.toThrow(/duplicated grain key/);
    expect(await rowCount()).toBe(before);
  });

  it("the LEGITIMATE stage IS NULL rows beside the stage rows are NOT flagged", async () => {
    const period = await termPeriodId(FIRST_TERM.term);
    const victim = (
      await sql<{ jurisdiction_id: string }[]>`
        select jurisdiction_id::text as jurisdiction_id from fact_fees
         where period_id = ${period}::uuid and stage is null limit 1`
    )[0]!;
    const existing = await sql<Record<string, unknown>[]>`
      select * from fact_fees
       where period_id = ${period}::uuid and jurisdiction_id = ${victim.jurisdiction_id}::uuid`;
    expect(existing.filter((r) => r.stage === null).length).toBeGreaterThanOrEqual(1);
    expect(existing.filter((r) => r.stage !== null).length).toBeGreaterThanOrEqual(1);
    const before = await fingerprint();
    const result = await writeFeesFacts(sql, [
      {
        periodId: period,
        jurisdictionIds: [victim.jurisdiction_id],
        rows: existing.map((r) => factRowFrom(r, period)),
      },
    ]);
    expect(result.inserted).toBe(existing.length);
    expect(await fingerprint()).toBe(before); // byte-identical, so nothing was mangled either
  });

  it("the assertion key distinguishes NULL from '' — and the dim_stage FK makes '' unwritable anyway", async () => {
    // The key carries `stage is null` as its own boolean beside `coalesce(stage, '')`, so a bare coalesce
    // collision is impossible. '' itself cannot be written at all (the FK to dim_stage, criterion 10), so
    // the defence is belt and braces rather than the only guard.
    const code = moduleText("lib/etl/fees.ts");
    expect(code).toContain("stage is null as is_all_stages");
    expect(code).toContain("coalesce(stage, '') as stage_key");
    await expect(
      sql`insert into fact_fees (jurisdiction_id, period_id, fee_category, stage, source, as_of_date)
          select jurisdiction_id, period_id, fee_category, '', source, as_of_date
            from fact_fees limit 1`,
    ).rejects.toThrow(/foreign key|violates/i);
  });
});

describe("CRITERION 17 · as_of_date is MAX(issued_at), else the term's ends_on, and never now()", () => {
  it("every row's vintage is the hand-computed max included issued_at", async () => {
    const rows = await sql<{ emis: string; term: number; as_of: string }[]>`
      select d.ges_code as emis, dp.term, f.as_of_date::text as as_of
        from fact_fees f
        join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
        join dim_period dp on dp.period_id = f.period_id`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const hand = expectedAsOf.get(`${row.emis}|${row.term}`)!;
      expect(new Date(row.as_of).toISOString()).toBe(new Date(hand).toISOString());
      // …and it is INSIDE the term, i.e. historic — never the run's clock.
      expect(new Date(row.as_of).getTime()).toBeLessThan(Date.now());
    }
    const code = stripComments(moduleText("lib/etl/fees.ts"));
    expect(code).not.toMatch(/\b(now\(\)|Date\.now|new Date\(\))/);
  });

  it("falls back to the term's ends_on when no invoice date is included", () => {
    // Unreachable from a grouped read (every group carries a date) and guarded anyway: the fallback is
    // the TERM's close, never the clock.
    const result = aggregateSchoolFees([], { ...TARGET });
    expect(result.asOfDate).toBe(TARGET.termEndsOn);
  });

  it("a re-run over unchanged invoices is BYTE-IDENTICAL, and REPLACES rather than appends", async () => {
    const before = await fingerprint();
    const beforeRows = await rowCount();
    const again = await runEtl();
    expect(again.status).toBe("SUCCESS");
    expect(await rowCount()).toBe(beforeRows);
    expect(await fingerprint()).toBe(before);
    // REPLACED, not appended: the second run deleted what the first wrote, in the same numbers.
    for (const term of again.feeTerms) expect(term.deleted).toBe(term.inserted);
    report = again;
  }, 900_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SOURCE READ: ALLOW-LIST, NO INDIVIDUAL, NO NEW OBJECT (criteria 18, 19, 20)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("CRITERION 18 · the fees read is a structural ALLOW-LIST, not a `select *`", () => {
  /** The names that must never cross the boundary. The payment estate is the bulk of it. */
  const FORBIDDEN = [
    "description",
    "payment",
    "payment_allocation",
    "receipt",
    "payment_audit_log",
    "recorded_by",
    "recorded_by_user_id",
    "void_reason",
    "voided_at",
    "marked_by",
    "marked_by_user_id",
    "captured_by",
    "invoice_number",
    "paid_amount",
    "balance_amount",
    "paid_at",
    "billed_amount",
    "first_name",
    "last_name",
    "student_code",
    "date_of_birth",
    "household_id",
    "subject_student_id",
    "rate_snapshot",
  ];
  const ALLOWED = [
    "school_id",
    "student_id",
    "invoice_id",
    "fee_category_id",
    "amount",
    "period_id",
    "status",
    "issued_at",
    "line_item_id",
    "class_id",
    "current_class_label",
    "level",
    "name",
  ];

  it("the forbidden names appear NOWHERE in the two modules' code, and the allow-list does", () => {
    for (const path of [
      "lib/etl/fees-source.ts",
      "lib/etl/fees.ts",
      "lib/etl/fee-category.ts",
    ]) {
      const code = stripComments(moduleText(path));
      for (const column of FORBIDDEN)
        expect(code, `${column} must not be referenced in ${path}`).not.toMatch(
          new RegExp(`\\b${column}\\b`),
        );
      expect(code).not.toContain("select *");
    }
    const reader = stripComments(moduleText("lib/etl/fees-source.ts"));
    for (const column of ALLOWED) expect(reader).toContain(column);
  });

  it("the demo stand-ins do not even CARRY the denied columns — the structural floor", async () => {
    const columnsOf = async (table: string) =>
      (
        await sql<{ column_name: string }[]>`
          select column_name from information_schema.columns
           where table_schema = 'demo_source' and table_name = ${table} order by 1`
      ).map((c) => c.column_name);
    expect(await columnsOf("invoice")).toEqual(
      ["id", "issued_at", "period_id", "school_id", "status", "student_id"].sort(),
    );
    expect(await columnsOf("invoice_line_item")).toEqual(
      ["amount", "fee_category_id", "id", "invoice_id", "school_id"].sort(),
    );
    expect(await columnsOf("fee_category")).toEqual(["id", "name", "school_id"]);
    expect(await columnsOf("pta_dues_charge")).toEqual([
      "id",
      "line_item_id",
      "school_id",
    ]);
    // THE WHOLE PAYMENT ESTATE HAS NO STAND-IN AT ALL — not a reduced one, none.
    const tables = (
      await sql<{ table_name: string }[]>`
        select table_name from information_schema.tables
         where table_schema = 'demo_source' order by 1`
    ).map((t) => t.table_name);
    for (const table of ["payment", "payment_allocation", "receipt", "payment_audit_log"])
      expect(tables).not.toContain(table);

    // Non-vacuous: the REAL schema carries every one of them, so the omissions are choices.
    const real = moduleText("../web/db/schema/fees.ts");
    expect(real).toContain('text("description")');
    expect(real).toContain('text("invoice_number")');
    expect(real).toContain('money("paid_amount")');
    expect(real).toContain('money("balance_amount")');
    expect(real).toContain('"payment"');
    expect(real).toContain('"receipt"');
    expect(real).toContain('uuid("recorded_by_user_id")');
    expect(real).toContain('text("void_reason")');
  });

  it("the seam is a PARAMETER and the read is bounded by the inclusion set", async () => {
    const code = moduleText("lib/etl/fees-source.ts");
    expect(code).toContain("${sql(query.schemaName)}.invoice_line_item");
    expect(code).toContain("= any(${query.operationalSchoolIds}::uuid[])");
    // AN EMPTY ID SET READS ZERO ROWS — and does not issue an unbounded query at all.
    expect(
      (
        await readFeeLineGroups(sql, {
          schemaName: "demo_source",
          operationalSchoolIds: [],
          academicYear: ACADEMIC_YEAR,
          startsOn: FIRST_TERM.startsOn,
          endsOn: FIRST_TERM.endsOn,
        })
      ).groups,
    ).toEqual([]);
    const operationalIds = (
      await sql<{ op: string }[]>`
        select r.operational_school_id::text as op from ref_emis_school_register r
         where r.on_schoolup and r.operational_school_id is not null
         order by r.emis_school_id limit 3`
    ).map((r) => r.op);
    const { groups } = await readFeeLineGroups(sql, {
      schemaName: "demo_source",
      operationalSchoolIds: operationalIds,
      academicYear: ACADEMIC_YEAR,
      startsOn: FIRST_TERM.startsOn,
      endsOn: FIRST_TERM.endsOn,
    });
    expect(groups.every((g) => operationalIds.includes(g.schoolId))).toBe(true);
    // …and an out-of-inclusion school would FAIL that school rather than be written.
    const pipeline = stripComments(moduleText("lib/etl/pipeline.ts"));
    expect(pipeline).toMatch(
      /is not in the inclusion set[\s\S]{0,200}the fees[\s\S]{0,80}read is not bounded by the inclusion set/,
    );
    expect(pipeline).toMatch(/aggregateSchoolFees\(item\.rows/);
  });
});

describe("CRITERION 19 · student_id is a join/group KEY and never a written column", () => {
  it("fact_fees carries no pupil, parent or actor identifier at all", async () => {
    const columns = (
      await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'fact_fees' order by 1`
    ).map((c) => c.column_name);
    expect(columns).toEqual(
      [
        "as_of_date",
        "etl_run_id",
        "fact_id",
        "fee_category",
        "jurisdiction_id",
        "mean_amount",
        "median_amount",
        "period_id",
        "source",
        "stage",
      ].sort(),
    );
    for (const forbidden of [
      "student_id",
      "subject_student_id",
      "pupil_id",
      "household_id",
      "invoice_id",
      "invoice_number",
      "recorded_by_user_id",
      "first_name",
      "last_name",
      "date_of_birth",
    ])
      expect(columns).not.toContain(forbidden);
  });

  it("the written row type has no pupil field, and the INSERT names only the ten columns", () => {
    const code = stripComments(moduleText("lib/etl/fees.ts"));
    // The reader's row carries `studentId`; the transform uses it ONLY as a map key, and the insert's
    // column list is explicit — so there is no path from the key to a column.
    expect(code).toContain("group.studentId");
    expect(code).not.toMatch(/student_id\s*:/);
    const insert = code.slice(code.indexOf("insert into fact_fees") - 900);
    for (const column of ["jurisdiction_id:", "fee_category:", "mean_amount:"])
      expect(insert).toContain(column);
    expect(insert).not.toContain("studentId");
  });

  it("the rows really are aggregates: one row covers many pupils", () => {
    // A distribution of one pupil is legal (a one-pupil boarding house exists), but the table is
    // overwhelmingly multi-pupil groups — asserted from the hand expectation, which knows the counts.
    const sizes = [...expected.values()].map((d) => d.length);
    const many = sizes.filter((n) => n > 1).length;
    expect(many).toBeGreaterThan(sizes.length * 0.8);
  });
});

describe("CRITERION 20 · H11 adds no analytics public TABLE, SEQUENCE or ROUTINE", () => {
  it("the migrations folder is unchanged and fact_fees predates this slice", () => {
    const files = readdirSync(join(process.cwd(), "db/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    // Six migrations, 0000–0005, exactly as before H11. A SEVENTH would trigger the §6 prod-paste-0006
    // re-run rule (a new object in the analytics `public` schema), which this slice deliberately does not.
    expect(files).toHaveLength(6);
    expect(files.map((f) => f.slice(0, 4))).toEqual([
      "0000",
      "0001",
      "0002",
      "0003",
      "0004",
      "0005",
    ]);
    expect(moduleText("db/migrations/0000_fuzzy_slipstream.sql")).toContain("fact_fees");
    // The category mapping is a FUNCTION in version control, not a seeded table (criterion 2).
    expect(moduleText("lib/etl/fee-category.ts")).toContain(
      "export function feeCategoryOf",
    );
    // `demo_source` is not in `public` and is created by a DEMO script that never runs against prod.
    for (const table of [
      "fee_category",
      "invoice",
      "invoice_line_item",
      "pta_dues_charge",
    ])
      expect(moduleText("db/seed/demo/demo-source-schema.sql")).toContain(
        `create table demo_source.${table}`,
      );
  });

  it("the analytics public schema gained nothing — no table, no sequence, no routine", async () => {
    // The whole `public` object inventory, compared against the migrations' own text: anything this slice
    // had added would be present here and absent there.
    const migrations = readdirSync(join(process.cwd(), "db/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => moduleText(join("db/migrations", f)))
      .join("\n");
    // TABLES. (Sequences are excluded because Postgres names a serial column's own sequence implicitly —
    // `ref_assessment_weights_weights_config_id_seq` has no literal mention in any migration and never
    // did; the sequence half of the claim is covered by the "nothing fee-shaped" sweep below.)
    const tables = await sql<{ name: string }[]>`
      select c.relname as name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by 1`;
    expect(tables.length).toBeGreaterThan(10);
    for (const table of tables)
      expect(migrations, `${table.name} is not in any migration`).toContain(table.name);
    // And NOTHING fee-shaped was added in any object class — no table, no sequence, no routine. The
    // resolver is TypeScript in version control, not a SQL function or a seeded mapping table.
    const feeShaped = await sql<{ name: string; kind: string }[]>`
      select c.relname as name, c.relkind::text as kind
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'S', 'v', 'm')
         and (c.relname like '%fee%' or c.relname like '%invoice%' or c.relname like '%dues%')
       order by 1`;
    expect(feeShaped).toEqual([{ name: "fact_fees", kind: "r" }]);
    const routines = await sql<{ routine_name: string }[]>`
      select routine_name from information_schema.routines
       where routine_schema = 'public'
         and (routine_name like '%fee%' or routine_name like '%invoice%')`;
    expect(routines).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// NON-ADDITIVITY, THE RUN REPORT, AND ONE ARM (criteria 21, 22, 23)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("CRITERION 21 · fact_fees is NON-ADDITIVE — no roll-up of it is correct", () => {
  it("summing or averaging a district's school means is NOT the district's mean", async () => {
    const period = await termPeriodId(FIRST_TERM.term);
    const district = (
      await sql<{ jurisdiction_id: string; name: string; n: number }[]>`
        select p.jurisdiction_id::text as jurisdiction_id, p.name,
               count(distinct f.jurisdiction_id)::int as n
          from fact_fees f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
          join dim_jurisdiction p on p.jurisdiction_id = d.parent_id
         where f.period_id = ${period}::uuid and p.level = 'DISTRICT'
           and f.fee_category = 'TUITION' and f.stage is null
         group by 1, 2 having count(distinct f.jurisdiction_id) >= 5
         order by 3 desc, 1 limit 1`
    )[0]!;
    const schoolMeans = (
      await sql<{ mean: string }[]>`
        select f.mean_amount::text as mean from fact_fees f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
         where f.period_id = ${period}::uuid and d.parent_id = ${district.jurisdiction_id}::uuid
           and f.fee_category = 'TUITION' and f.stage is null`
    ).map((r) => Number(r.mean));
    expect(schoolMeans.length).toBeGreaterThanOrEqual(5);
    const sum = schoolMeans.reduce((t, v) => t + v, 0);
    const average = sum / schoolMeans.length;

    // THE CORRECT district figure, which this table CANNOT produce: re-derived from the district's own
    // POOLED per-pupil distribution, straight from the source.
    const correct = (
      await sql<{ mean: string; median: string }[]>`
        with district_schools as (
          select r.operational_school_id as op
            from dim_jurisdiction d
            join ref_emis_school_register r on r.emis_school_id = d.ges_code
           where d.parent_id = ${district.jurisdiction_id}::uuid and d.level = 'SCHOOL'
        ), per_student as (
          select i.school_id, i.student_id, sum(li.amount) as billed
            from demo_source.invoice_line_item li
            join demo_source.invoice i on i.school_id = li.school_id and i.id = li.invoice_id
            join demo_source.academic_period ap
              on ap.school_id = i.school_id and ap.period_id = i.period_id
            join demo_source.fee_category fc
              on fc.school_id = li.school_id and fc.id = li.fee_category_id
            left join demo_source.pta_dues_charge pd
              on pd.school_id = li.school_id and pd.line_item_id = li.id
           where i.school_id in (select op from district_schools)
             and i.status::text = any(${[...BILLED_INVOICE_STATUSES]}::text[])
             and ap.academic_year = ${ACADEMIC_YEAR}
             and ap.starts_on between ${FIRST_TERM.startsOn}::date and ${FIRST_TERM.endsOn}::date
             and pd.line_item_id is null
             and (fc.name ilike '%tuition%' or fc.name ilike '%school fees%')
           group by i.school_id, i.student_id)
        select round(sum(billed) / count(*), 2)::text as mean,
               round(percentile_cont(0.5) within group (order by billed)::numeric, 2)::text as median
          from per_student`
    )[0]!;
    // ⚠ NEITHER naive roll-up equals it. Both are plausible cedi figures — which is exactly why the wrong
    // ones are dangerous, and why this table must be EXCLUDED from the H19 "district = Σ schools" harness
    // when that lands (it does not exist yet; this assertion and the marker below are the whole guard).
    expect(Number(correct.mean)).not.toBe(sum);
    expect(Number(correct.mean)).not.toBe(average);
    expect(Number(correct.mean)).toBeGreaterThan(0);
    // A median cannot be recombined AT ALL: the median of the school medians is not the district median.
    const schoolMedians = (
      await sql<{ median: string }[]>`
        select f.median_amount::text as median from fact_fees f
          join dim_jurisdiction d on d.jurisdiction_id = f.jurisdiction_id
         where f.period_id = ${period}::uuid and d.parent_id = ${district.jurisdiction_id}::uuid
           and f.fee_category = 'TUITION' and f.stage is null
         order by 1`
    ).map((r) => Number(r.median));
    const medianOfMedians = schoolMedians.sort((a, b) => a - b)[
      Math.floor(schoolMedians.length / 2)
    ]!;
    expect(Number(correct.median)).not.toBe(medianOfMedians);
  });

  it("the non-additivity and the H19 exclusion are written down where a reader will meet them", () => {
    // The MARKER. A future roll-up harness must exclude this table, and the only thing standing between
    // that and a plausible wrong national figure is this note plus the assertions above — so the test
    // fails if either is deleted.
    const code = moduleText("lib/etl/fees.ts");
    expect(code).toContain("NON-ADDITIVE");
    expect(code).toMatch(/H19[\s\S]{0,200}EXCLUDE `fact_fees`/);
    expect(moduleText("lib/etl/pipeline.ts")).toContain("NON-ADDITIVE");
    // …and no national mean is reported anywhere, because none can be computed from these rows.
    expect(JSON.stringify(report.feeTerms)).not.toMatch(
      /nationalMean|meanAmount|overallMean/,
    );
    expect(stripComments(moduleText("scripts/run-etl.ts"))).not.toMatch(
      /feeTerms[\s\S]{0,400}\bmean\b/,
    );
  });

  it("nor is fact_fees additive across TERMS: the two terms' figures are different measurements", async () => {
    const first = await termPeriodId(FIRST_TERM.term);
    const last = await termPeriodId(LAST_TERM.term);
    const pairs = await sql<{ a: string; b: string }[]>`
      select f1.mean_amount::text as a, f2.mean_amount::text as b
        from fact_fees f1
        join fact_fees f2
          on f2.jurisdiction_id = f1.jurisdiction_id
         and f2.fee_category = f1.fee_category
         and f2.stage is not distinct from f1.stage
         and f2.period_id = ${last}::uuid
       where f1.period_id = ${first}::uuid
       limit 200`;
    expect(pairs.length).toBeGreaterThan(50);
    // A term's mean is a mean of THAT term's bills. Adding two terms' means produces a figure with no
    // referent (it is not the year's mean bill, and it is not anything else either).
    expect(pairs.some((p) => p.a !== p.b)).toBe(true);
  });
});

describe("CRITERION 22 · the run report carries the fee tallies, per school and run-wide", () => {
  it("all four signals are present and equal the hand-computed figures", async () => {
    for (const term of report.feeTerms) {
      const handOther = [...expectedOther.entries()]
        .filter(([k]) => k.endsWith(`|${term.term}`))
        .reduce((t, [, v]) => t + v, 0);
      expect(term.otherBilled).toBe(ghs(handOther));
      expect(handOther).toBeGreaterThan(0);
      // DISTINCT names are a UNION across schools, not a sum of per-school counts.
      const names = new Set<string>();
      for (const [k, set] of expectedOtherNames)
        if (k.endsWith(`|${term.term}`)) for (const n of set) names.add(n);
      expect(term.otherCategoryNames).toBe(names.size);
      // PER SCHOOL — every school with something to report, and nothing else.
      for (const school of term.perSchool) {
        const scope = `${school.emisSchoolId}|${term.term}`;
        expect(school.otherBilled).toBe(ghs(expectedOther.get(scope) ?? 0));
        expect(school.otherCategoryNames).toBe(
          (expectedOtherNames.get(scope) ?? new Set()).size,
        );
      }
      const reported = new Set(term.perSchool.map((s) => s.emisSchoolId));
      for (const [scope, value] of expectedOther)
        if (scope.endsWith(`|${term.term}`) && value > 0)
          expect(reported.has(scope.split("|")[0]!)).toBe(true);
    }
    // The NULL-period count is run-wide AND per school (criterion 14 asserts the figures).
    expect(report.feesNullPeriodInvoices.total).toBeGreaterThan(0);
    expect(report.feesNullPeriodInvoices.bySchool.length).toBeGreaterThan(0);
  });

  it("the operator script prints them, so a degradation is visible without a database", () => {
    const script = moduleText("scripts/run-etl.ts");
    expect(script).toContain("report.feeTerms");
    expect(script).toContain("f.otherBilled");
    expect(script).toContain("f.otherCategoryNames");
    expect(script).toContain("f.outOfScopeBilled");
    expect(script).toContain("f.unmappedStageBilled");
    expect(script).toContain("report.feesNullPeriodInvoices.total");
  });
});

describe("CRITERION 23 · ONE arm, ONE fact_fees: dues and categorised lines share everything", () => {
  it("one source read, one transform, one delete-then-insert", () => {
    const pipeline = stripComments(moduleText("lib/etl/pipeline.ts"));
    // Exactly one read call, one transform call and one writer call for the arm.
    expect(pipeline.match(/readFeeLineGroups\(/g)).toHaveLength(1);
    expect(pipeline.match(/aggregateSchoolFees\(/g)).toHaveLength(1);
    expect(pipeline.match(/writeFeesFactsTx\(/g)).toHaveLength(1);
    // The reader's single query carries BOTH: the LEFT JOIN to the bridge is in the same statement as
    // the fee_category join, so a dues line and a tuition line arrive together.
    const reader = stripComments(moduleText("lib/etl/fees-source.ts"));
    // ONE statement reads the line items — there is no second pass over `invoice_line_item` anywhere —
    // and the dues bridge is joined INSIDE it. (The module's only other query counts period-less INVOICES
    // and touches no line item at all.)
    expect(reader.match(/\.invoice_line_item li/g)).toHaveLength(1);
    expect(reader).toContain(".pta_dues_charge pd");
    expect(reader).toContain(".fee_category fc");
  });

  it("a school's PTA_DUES rows and its categorised rows are deleted and rewritten TOGETHER", async () => {
    const period = await termPeriodId(FIRST_TERM.term);
    const victim = (
      await sql<{ jurisdiction_id: string }[]>`
        select f.jurisdiction_id::text as jurisdiction_id from fact_fees f
         where f.period_id = ${period}::uuid and f.fee_category = 'PTA_DUES'
         group by 1 order by 1 limit 1`
    )[0]!;
    const rows = await sql<Record<string, unknown>[]>`
      select * from fact_fees
       where period_id = ${period}::uuid and jurisdiction_id = ${victim.jurisdiction_id}::uuid`;
    const categories = new Set(rows.map((r) => r.fee_category as string));
    expect(categories.has("PTA_DUES")).toBe(true);
    expect(categories.size).toBeGreaterThan(1);
    // ONE batch, which deletes the dues rows alongside the rest and reinserts both.
    const result = await writeFeesFacts(sql, [
      {
        periodId: period,
        jurisdictionIds: [victim.jurisdiction_id],
        rows: rows.map((r) => factRowFrom(r, period)),
      },
    ]);
    expect(result.deleted).toBe(rows.length);
    expect(result.inserted).toBe(rows.length);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PRIOR ARMS ARE UNTOUCHED (the additivity claim of the demo seam itself)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the fees RNG pass leaves the four prior arms' demo figures BYTE-IDENTICAL", () => {
  it("a fresh salt means the censuses, rosters, sittings and registers are unchanged", () => {
    // The generator's fee pass draws from its OWN stream (`seed ^ 0x46454553`), so it cannot shift the
    // three earlier passes. Pinned as a SHA-256 of each prior artefact, computed from the dataset this
    // suite is running against: if a future edit moves a draw into an existing stream, every one of
    // these digests changes at once and this test says so before a reviewer has to diff demo figures.
    const digest = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const fresh = generateDemoDataset();
    for (const arm of [
      "schools",
      "periods",
      "facilities",
      "classes",
      "studentGroups",
      "terminalExamResults",
      "attendanceMarks",
    ] as const)
      expect(digest(fresh[arm]), `${arm} drifted`).toBe(digest(dataset[arm]));
    // The fee pass itself is deterministic too — same seed, same fee book.
    expect(digest(fresh.invoiceRuns)).toBe(digest(dataset.invoiceRuns));
    expect(digest(fresh.feeCategories)).toBe(digest(dataset.feeCategories));
    // And the salt really is distinct from the attendance one.
    const generator = moduleText("scripts/seed-demo-data.ts");
    expect(generator).toContain("rngOf(seed ^ 0x4154_5445)");
    expect(generator).toContain("rngOf(seed ^ 0x4645_4553)");
  });

  it("the transform refuses a negative billed total rather than publishing a negative mean", () => {
    expect(() => aggregateSchoolFees([group({ billedPesewas: -100 })], TARGET)).toThrow(
      FeesTransformError,
    );
  });
});
