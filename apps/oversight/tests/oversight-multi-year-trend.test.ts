import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { scopeFor } from "@/lib/db/rls";
import { isOk } from "@/lib/oversight/reading";
import {
  examQualificationYoy,
  getExamQualificationTrend,
  type ExamQualificationPoint,
} from "@/lib/oversight/performance";
import { KDelta } from "@/components/oversight/kpi-card";
import {
  DEMO_CURRENT_EXAM_COHORTS,
  DEMO_EXAM_COHORTS,
  DEMO_PRIOR_EXAM_COHORTS,
  generateDemoDataset,
} from "@/scripts/seed-demo-data";
import { JUR } from "./fixtures/ids";
import { adminAnalytics, districtOfficer } from "./helpers";

/**
 * INCREMENT M · MULTI-YEAR TREND — the WASSCE year-over-year surface, against Kofi's ACs
 * (MULTI-YEAR-TREND-RULING). Three bodies of proof:
 *   1. the demo seeds FOUR period-stamped sittings and nothing else trends (AC2/AC3/AC5);
 *   2. the series reader re-derives Σ/Σ per sitting, never pools exams or sittings, excludes a 0/0
 *      cohort, and is RLS-bounded (AC6/AC7/AC20);
 *   3. the pill's semantics distinguish a real change from a measured no-change from "no comparator"
 *      (AC9/AC10), the glyph tones match the mock, and no trend is fabricated or DEMO-chipped
 *      (AC1/AC12/AC17).
 */

const districtScope = scopeFor(districtOfficer);

function moduleText(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const point = (
  academicYear: string,
  qualified: number,
  candidates: number,
): ExamQualificationPoint => ({
  academicYear,
  candidates,
  qualified,
  rate: candidates === 0 ? 0 : qualified / candidates,
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (1) THE DEMO SEEDS FOUR PERIOD-STAMPED SITTINGS — AND NOTHING ELSE GAINS A YEAR (AC2/AC3/AC5)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the demo seeds a four-sitting performance history and nothing else (AC2/AC3/AC5)", () => {
  const dataset = generateDemoDataset();

  it("AC3 · the exam source carries exactly the four sitting years 2023–2026", () => {
    const years = [...new Set(dataset.terminalExamResults.map((r) => r.year))].sort();
    expect(years).toEqual([2023, 2024, 2025, 2026]);
    const declared = [...DEMO_EXAM_COHORTS].map((c) => c.sittingYear).sort();
    expect(declared).toEqual([2023, 2024, 2025, 2026]);
    // The declared set the dataset reports is the same four — what the run declares and the dashboard
    // trends over.
    expect([...dataset.examCohorts].map((c) => c.sittingYear).sort()).toEqual([
      2023, 2024, 2025, 2026,
    ]);
  });

  it("AC3 · the four sittings vary genuinely (a real series, not one rate repeated)", () => {
    // Pool each sitting to a national Σqualified ÷ Σcandidates and assert they are not all equal — the
    // demo draws each sitting's rate independently, so a flat line would be a generator bug.
    const byYear = new Map<number, { q: number; c: number }>();
    for (const r of dataset.terminalExamResults) {
      const acc = byYear.get(r.year) ?? { q: 0, c: 0 };
      acc.q += r.femalePassed + r.malePassed;
      acc.c += r.femaleCandidates + r.maleCandidates;
      byYear.set(r.year, acc);
    }
    const rates = [...byYear.values()].map((a) => Math.round((a.q / a.c) * 1000));
    expect(new Set(rates).size).toBeGreaterThan(1);
  });

  it("AC5 · enrolment/staffing/PLC stay a single academic year — no synthetic prior roster", () => {
    // `terms` is the ANNUAL/TERM declaration the stock arms file against; one academic year means no
    // prior-year roster was manufactured to fake a trend (ruling M6/M2).
    const years = new Set(dataset.terms.map((t) => t.academicYear));
    expect(years.size).toBe(1);
  });

  it("the prior sittings are drawn in their OWN salted pass (byte-stability of shipped arms)", () => {
    const generator = moduleText("scripts/seed-demo-data.ts");
    // The dedicated salt exists and is distinct from the four already-shipped passes.
    expect(generator).toContain("rngOf(seed ^ 0x5349_5454)"); // "SITT"
    for (const salt of ["0x4154_5445", "0x4645_4553", "0x4350_4443"])
      expect(generator).toContain(`rngOf(seed ^ ${salt})`);
    // The CURRENT sittings are what the main shared-rng loop draws, so its draws are unchanged.
    expect(generator).toContain("DEMO_CURRENT_EXAM_COHORTS");
    expect(generator).toContain("DEMO_PRIOR_EXAM_COHORTS");
  });

  it("the split constants are the two current + two prior sittings, union chronological", () => {
    expect([...DEMO_CURRENT_EXAM_COHORTS].map((c) => c.sittingYear)).toEqual([
      2025, 2026,
    ]);
    expect([...DEMO_PRIOR_EXAM_COHORTS].map((c) => c.sittingYear)).toEqual([2023, 2024]);
    expect([...DEMO_EXAM_COHORTS].map((c) => c.sittingYear)).toEqual([
      2023, 2024, 2025, 2026,
    ]);
    // Distinct `ends_on` per sitting, so no two collide onto one as_of vintage.
    expect(new Set(DEMO_EXAM_COHORTS.map((c) => c.endsOn)).size).toBe(4);
  });

  it("the generator is deterministic — the same seed reproduces the four-sitting history byte-for-byte", () => {
    const fresh = generateDemoDataset();
    expect(JSON.stringify(fresh.terminalExamResults)).toBe(
      JSON.stringify(dataset.terminalExamResults),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (2) THE YEAR-OVER-YEAR HELPER — absent vs measured-zero vs real change (AC9/AC10), pure
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("examQualificationYoy distinguishes a real change, a measured no-change and no comparator", () => {
  const series = [
    point("2022/23", 50, 100), // 0.50
    point("2023/24", 55, 100), // 0.55
    point("2024/25", 55, 100), // 0.55 — equal to prior (a MEASURED no-change)
    point("2025/26", 64, 100), // 0.64
  ];

  it("AC9 · the EARLIEST sitting has no prior comparator → null (the em-dash state, never ▲0%)", () => {
    expect(examQualificationYoy(series, "2022/23")).toBeNull();
  });

  it("a sitting absent from the series → null (nothing to compare)", () => {
    expect(examQualificationYoy(series, "2099/00")).toBeNull();
  });

  it("AC10 · two equal re-derived rates → a MEASURED zero, not null (distinct from em-dash)", () => {
    const yoy = examQualificationYoy(series, "2024/25");
    expect(yoy).not.toBeNull();
    expect(yoy!.deltaRatio).toBe(0);
    expect(yoy!.priorAcademicYear).toBe("2023/24");
  });

  it("a rise reports the signed delta and the immediately-prior sitting as baseline", () => {
    const yoy = examQualificationYoy(series, "2025/26");
    expect(yoy!.priorAcademicYear).toBe("2024/25");
    expect(yoy!.currentRate).toBeCloseTo(0.64, 10);
    expect(yoy!.priorRate).toBeCloseTo(0.55, 10);
    expect(yoy!.deltaRatio).toBeCloseTo(0.09, 10);
  });

  it("compares against the immediately-PRIOR sitting in the series, not a fixed calendar year back", () => {
    // A gap year (a sitting nobody sat) is simply absent from the series; the delta uses the last
    // sitting that genuinely happened.
    const gapped = [point("2021/22", 40, 100), point("2025/26", 60, 100)];
    const yoy = examQualificationYoy(gapped, "2025/26");
    expect(yoy!.priorAcademicYear).toBe("2021/22");
    expect(yoy!.deltaRatio).toBeCloseTo(0.2, 10);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (3) THE `.k-delta` PILL — tones, glyphs, and the two flat semantics (AC1/AC9/AC10)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("KDelta renders Lucy's three tones and never fabricates a direction (AC1/AC9/AC10)", () => {
  const render = (tone: "up" | "down" | "flat", label: string) =>
    renderToStaticMarkup(createElement(KDelta, { tone, children: label }));

  it("up is green with a ▲ glyph", () => {
    const html = render("up", "2 pts vs 2025");
    expect(html).toContain("▲");
    expect(html).toContain("bg-green-bg");
    expect(html).toContain("text-green");
    expect(html).toContain("2 pts vs 2025");
    expect(html).not.toContain("▼");
  });

  it("down is terra with a ▼ glyph", () => {
    const html = render("down", "3 pts vs 2024");
    expect(html).toContain("▼");
    expect(html).toContain("bg-terra-bg");
    expect(html).toContain("text-terra");
    expect(html).not.toContain("▲");
  });

  it("flat carries NO direction glyph — it is a no-change or an absent comparator, never ▲/▼", () => {
    const html = render("flat", "— no prior sitting yet");
    expect(html).not.toContain("▲");
    expect(html).not.toContain("▼");
    expect(html).toContain("bg-bg");
    expect(html).toContain("text-navy-3");
    expect(html).toContain("— no prior sitting yet");
  });

  it("AC1 · the pill carries no DEMO chip — a trend figure is measured, not illustrative", () => {
    expect(render("up", "1 pt vs 2025")).not.toContain("DEMO");
    const card = moduleText("components/oversight/kpi-card.tsx");
    // The KDelta component itself emits no DEMO marking.
    expect(card.slice(card.indexOf("export function KDelta"))).not.toContain(">DEMO<");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (4) STATIC SCOPE GUARDS — no fee trend, no migration, the page wires the pills (AC17/AC22/AC12)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("scope boundaries hold (AC12/AC17/AC22)", () => {
  it("AC17 · the fees surface carries no trend/delta pill — fees are non-additive in time", () => {
    const fees = moduleText("components/oversight/fees-section.tsx");
    expect(fees).not.toContain("KDelta");
    expect(fees.toLowerCase()).not.toContain("year-over-year");
  });

  it("AC12 · enrolment and coverage render the honest 'no comparator yet' pill, never a feed claim", () => {
    const page = moduleText("app/(oversight)/page.tsx");
    expect(page).toContain("enrolmentDelta");
    expect(page).toContain("coverageDelta");
    expect(page).toContain("noComparatorYet");
    // The tooltip must NOT imply a backfill is coming (ruling M2/M13).
    expect(page).not.toContain("not yet sourced from a feed");
    expect(page).toContain("appears as further years are measured");
  });

  it("AC22 · this increment adds no migration file", () => {
    const migrations = readdirSync(join(process.cwd(), "db/migrations")).filter((f) =>
      f.endsWith(".sql"),
    );
    // The last migration before increment M was 0006; the trend adds no 0007.
    expect(migrations.some((f) => f.startsWith("0007"))).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (5) THE SERIES READER — Σ/Σ per sitting, no pooling, 0/0 excluded, RLS-bounded (AC6/AC7/AC20)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

// Four in-subtree sittings + one sitting visible ONLY outside the subtree (to prove exclusion). Minted
// period ids that do not collide with the shared fixture's single 2025/26 EXAM_COHORT row.
const TREND = {
  y1: { id: "2a000000-0000-4000-8000-000000002122", ay: "2021/22", ends: "2022-06-24" },
  y2: { id: "2a000000-0000-4000-8000-000000002223", ay: "2022/23", ends: "2023-06-23" },
  y3: { id: "2a000000-0000-4000-8000-000000002324", ay: "2023/24", ends: "2024-06-21" },
  y4: { id: "2a000000-0000-4000-8000-000000002425", ay: "2024/25", ends: "2025-06-27" },
  // Only an OUT-OF-SUBTREE school sat this one, so the district officer sees 0 candidates → excluded.
  empty: {
    id: "2a000000-0000-4000-8000-000000002021",
    ay: "2020/21",
    ends: "2021-06-25",
  },
} as const;

let owner: postgres.Sql;

beforeAll(async () => {
  owner = adminAnalytics();
  for (const s of Object.values(TREND))
    await owner`
      insert into dim_period (period_id, academic_year, term, period_type, starts_on, ends_on, is_current)
      values (${s.id}::uuid, ${s.ay}, null, 'EXAM_COHORT', ${`${Number(s.ends.slice(0, 4))}-05-05`}, ${s.ends}, false)
    `;

  // y1: two IN-SUBTREE schools with divergent rates — 80/100 beside 2/10 → Σ/Σ = 82/110 = 0.745, which
  // is NOT the unweighted mean of 0.8 and 0.2 (0.5). Plus MALE/FEMALE rows beside ALL (the triple decoy)
  // and a BECE row (the wrong exam) — both must be excluded from the WASSCE series.
  await owner`
    insert into fact_performance_exam
      (jurisdiction_id, period_id, exam, sex, candidates, qualified, qualification_rate, source, as_of_date)
    values
      (${JUR.schoolPublicConsented}::uuid, ${TREND.y1.id}::uuid, 'WASSCE', 'ALL',    100, 80, 80.00, 'WAEC_EXTRACT', now()),
      (${JUR.schoolPublicConsented}::uuid, ${TREND.y1.id}::uuid, 'WASSCE', 'MALE',    50, 40, 80.00, 'WAEC_EXTRACT', now()),
      (${JUR.schoolPublicConsented}::uuid, ${TREND.y1.id}::uuid, 'WASSCE', 'FEMALE',  50, 40, 80.00, 'WAEC_EXTRACT', now()),
      (${JUR.schoolPublicConsented}::uuid, ${TREND.y1.id}::uuid, 'BECE',   'ALL',    200, 10,  5.00, 'SCHOOL_ENTERED', now()),
      (${JUR.schoolPublicNoConsent}::uuid, ${TREND.y1.id}::uuid, 'WASSCE', 'ALL',     10,  2, 20.00, 'WAEC_EXTRACT', now()),
      (${JUR.schoolOutsideSubtree}::uuid,  ${TREND.y1.id}::uuid, 'WASSCE', 'ALL',    400,400,100.00, 'WAEC_EXTRACT', now())
  `;
  // y2/y3/y4: one in-subtree ALL row each, rising 50% → 60% → 60% (a rise then a measured no-change).
  await owner`
    insert into fact_performance_exam
      (jurisdiction_id, period_id, exam, sex, candidates, qualified, qualification_rate, source, as_of_date)
    values
      (${JUR.schoolPublicConsented}::uuid, ${TREND.y2.id}::uuid, 'WASSCE', 'ALL', 100, 50, 50.00, 'WAEC_EXTRACT', now()),
      (${JUR.schoolPublicConsented}::uuid, ${TREND.y3.id}::uuid, 'WASSCE', 'ALL', 100, 60, 60.00, 'WAEC_EXTRACT', now()),
      (${JUR.schoolPublicConsented}::uuid, ${TREND.y4.id}::uuid, 'WASSCE', 'ALL', 100, 60, 60.00, 'WAEC_EXTRACT', now())
  `;
  // The "empty" sitting: an out-of-subtree row only — the district officer must see this sitting as
  // carrying no candidates, so it drops out of the series rather than appearing as 0/0.
  await owner`
    insert into fact_performance_exam
      (jurisdiction_id, period_id, exam, sex, candidates, qualified, qualification_rate, source, as_of_date)
    values
      (${JUR.schoolOutsideSubtree}::uuid, ${TREND.empty.id}::uuid, 'WASSCE', 'ALL', 300, 150, 50.00, 'WAEC_EXTRACT', now())
  `;
});

afterAll(async () => {
  const ids = Object.values(TREND).map((s) => s.id);
  await owner`delete from fact_performance_exam where period_id = any(${ids}::uuid[])`;
  await owner`delete from dim_period where period_id = any(${ids}::uuid[])`;
  await owner.end({ timeout: 5 });
});

describe("getExamQualificationTrend re-derives one Σ/Σ per sitting (AC6/AC7/AC20)", () => {
  it("AC6 · each sitting is candidate-weighted Σ/Σ, not the mean of per-school rates, ordered earliest-first", async () => {
    const reading = await getExamQualificationTrend(districtScope, "WASSCE");
    expect(isOk(reading)).toBe(true);
    if (!isOk(reading)) return;
    const points = reading.value.points;
    // Four sittings visible in-subtree; the out-of-subtree-only sitting (2020/21) is excluded.
    expect(points.map((p) => p.academicYear)).toEqual([
      "2021/22",
      "2022/23",
      "2023/24",
      "2024/25",
    ]);
    // y1 = (80 + 2) / (100 + 10) = 82/110 = 0.7454… — NOT avg(0.8, 0.2) = 0.5, NOT tripled by the
    // MALE/FEMALE rows, and the out-of-subtree 400/400 is not in it.
    const y1 = points[0]!;
    expect(y1.candidates).toBe(110);
    expect(y1.qualified).toBe(82);
    expect(y1.rate).toBeCloseTo(0.7454, 3);
  });

  it("AC7 · the WASSCE series excludes the BECE row entirely (exams are never pooled)", async () => {
    const reading = await getExamQualificationTrend(districtScope, "WASSCE");
    if (!isOk(reading)) throw new Error("expected ok");
    // The BECE row on y1 added 200 candidates; its absence proves the exam filter is load-bearing.
    expect(reading.value.points[0]!.candidates).toBe(110);
    const bece = await getExamQualificationTrend(districtScope, "BECE");
    // BECE has exactly the one planted sitting in-subtree.
    if (!isOk(bece)) throw new Error("expected ok");
    expect(bece.value.points.map((p) => p.academicYear)).toEqual(["2021/22"]);
    expect(bece.value.points[0]!.candidates).toBe(200);
  });

  it("AC20 · the series is the officer's OWN subtree — no out-of-subtree school's candidates appear", async () => {
    const reading = await getExamQualificationTrend(districtScope, "WASSCE");
    if (!isOk(reading)) throw new Error("expected ok");
    // No sitting carries the out-of-subtree 400-candidate school, and the empty (out-of-subtree-only)
    // sitting is absent entirely — a 0/0 cohort is excluded, never published as 0%.
    expect(reading.value.points.map((p) => p.academicYear)).not.toContain("2020/21");
    for (const p of reading.value.points) expect(p.candidates).toBeLessThan(400);
  });

  it("feeds a correct end-to-end year-over-year delta off the real series", async () => {
    const reading = await getExamQualificationTrend(districtScope, "WASSCE");
    if (!isOk(reading)) throw new Error("expected ok");
    // 2023/24 (0.60) vs 2022/23 (0.50) → +0.10; 2024/25 (0.60) vs 2023/24 (0.60) → measured 0.
    expect(examQualificationYoy(reading.value.points, "2023/24")!.deltaRatio).toBeCloseTo(
      0.1,
      10,
    );
    expect(examQualificationYoy(reading.value.points, "2024/25")!.deltaRatio).toBe(0);
    // The earliest in-subtree sitting has no prior comparator.
    expect(examQualificationYoy(reading.value.points, "2021/22")).toBeNull();
  });
});
