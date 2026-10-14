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
import { periodTypeEnum } from "@/db/schema/_enums";
import { JUR } from "./fixtures/ids";
import { adminAnalytics, districtOfficer, nationalOfficer, sqlTextOf } from "./helpers";

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

  it("up is green with a ▲ glyph and a screen-reader 'up' word (not colour/glyph alone)", () => {
    const html = render("up", "2 pts vs 2025");
    expect(html).toContain("▲");
    expect(html).toContain("bg-green-bg");
    expect(html).toContain("text-green");
    expect(html).toContain("2 pts vs 2025");
    expect(html).not.toContain("▼");
    // Dex B1 / WCAG 1.4.1: the direction must reach assistive tech, since the label is the ABSOLUTE
    // size and the glyph is aria-hidden. A visually-hidden word carries it.
    expect(html).toContain('<span class="sr-only">up </span>');
  });

  it("down is terra with a ▼ glyph and a screen-reader 'down' word", () => {
    const html = render("down", "3 pts vs 2024");
    expect(html).toContain("▼");
    expect(html).toContain("bg-terra-bg");
    expect(html).toContain("text-terra");
    expect(html).not.toContain("▲");
    expect(html).toContain('<span class="sr-only">down </span>');
  });

  it("flat carries NO direction glyph or word — a no-change or absent comparator, never ▲/▼", () => {
    const html = render("flat", "— no prior sitting yet");
    expect(html).not.toContain("▲");
    expect(html).not.toContain("▼");
    expect(html).toContain("bg-bg");
    expect(html).toContain("text-navy-3");
    expect(html).toContain("— no prior sitting yet");
    // No fabricated direction: flat has none to announce.
    expect(html).not.toContain("sr-only");
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

  it("AC21 · two consecutive reads of the same ETL output yield byte-identical points/deltas", async () => {
    const a = await getExamQualificationTrend(districtScope, "WASSCE");
    const b = await getExamQualificationTrend(districtScope, "WASSCE");
    if (!isOk(a) || !isOk(b)) throw new Error("expected ok");
    expect(JSON.stringify(b.value)).toBe(JSON.stringify(a.value));
    expect(JSON.stringify(examQualificationYoy(b.value.points, "2023/24"))).toBe(
      JSON.stringify(examQualificationYoy(a.value.points, "2023/24")),
    );
  });

  it("AC20 · a SIBLING district officer sees ONLY its own schools' figure — the two views are disjoint", async () => {
    // Derived from the sealed fixture (helpers.ts sanctions this) so the brand survives: the SAME
    // officer row, re-pointed at the other district. `ov_app` is the connecting role, so RLS — not an
    // app-side `where` — is what separates the two readings.
    const siblingScope = scopeFor({ ...districtOfficer, jurisdictionId: JUR.otherDistrict });
    const sibling = await getExamQualificationTrend(siblingScope, "WASSCE");
    if (!isOk(sibling)) throw new Error("expected ok");
    const y1 = sibling.value.points.find((p) => p.academicYear === "2021/22")!;
    // The other district holds ONLY the 400/400 school: not one of the home district's 110 candidates
    // appears, and no blended figure is produced for either officer.
    expect(y1.candidates).toBe(400);
    expect(y1.qualified).toBe(400);
    expect(y1.rate).toBe(1);
    // The sitting only that district sat IS in its own series, and is absent from the home officer's.
    expect(sibling.value.points.map((p) => p.academicYear)).toContain("2020/21");
    const home = await getExamQualificationTrend(districtScope, "WASSCE");
    if (!isOk(home)) throw new Error("expected ok");
    expect(home.value.points.map((p) => p.academicYear)).not.toContain("2020/21");
    for (const p of home.value.points)
      expect(sibling.value.points.some((s) => s.candidates === p.candidates)).toBe(false);
  });

  it("AC20 · the NATIONAL officer's figure is the pooled total of both districts (no app-side ceiling)", async () => {
    const national = await getExamQualificationTrend(scopeFor(nationalOfficer), "WASSCE");
    if (!isOk(national)) throw new Error("expected ok");
    const y1 = national.value.points.find((p) => p.academicYear === "2021/22")!;
    // 100 + 10 (home district) + 400 (the other) — proving the rows EXIST and that RLS, not a missing
    // row, is what the district officer's 110 came from.
    expect(y1.candidates).toBe(510);
    expect(y1.qualified).toBe(482);
    // And the out-of-subtree-only sitting is visible HERE, which is the same proof from the other side.
    expect(national.value.points.map((p) => p.academicYear)).toContain("2020/21");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (6) AC6 IN ITS LITERAL FORM — a 40-candidate school beside a 400-candidate one, across two sittings
// ══════════════════════════════════════════════════════════════════════════════════════════════════

const WEIGHT = {
  base: { id: "2b000000-0000-4000-8000-000000001718", ay: "2017/18", ends: "2018-06-22" },
  next: { id: "2b000000-0000-4000-8000-000000001819", ay: "2018/19", ends: "2019-06-21" },
} as const;

describe("AC6 · the small school is not equally weighted and the delta is not an average of per-school changes", () => {
  beforeAll(async () => {
    for (const s of Object.values(WEIGHT))
      await owner`
        insert into dim_period (period_id, academic_year, term, period_type, starts_on, ends_on, is_current)
        values (${s.id}::uuid, ${s.ay}, null, 'EXAM_COHORT', ${`${Number(s.ends.slice(0, 4))}-05-05`}, ${s.ends}, false)
      `;
    // BOTH schools are in the officer's district. The BIG one improves +10 points, the SMALL one
    // collapses −50. Candidate-weighted the subtree IMPROVED; equally weighted it would appear to have
    // fallen 20 points. The two answers have OPPOSITE SIGNS, so a misweighted reader cannot pass.
    await owner`
      insert into fact_performance_exam
        (jurisdiction_id, period_id, exam, sex, candidates, qualified, qualification_rate, source, as_of_date)
      values
        (${JUR.schoolPublicConsented}::uuid, ${WEIGHT.base.id}::uuid, 'WASSCE', 'ALL', 400, 200,  50.00, 'WAEC_EXTRACT', '2018-06-22'),
        (${JUR.schoolPublicNoConsent}::uuid, ${WEIGHT.base.id}::uuid, 'WASSCE', 'ALL',  40,  40, 100.00, 'WAEC_EXTRACT', '2018-06-22'),
        (${JUR.schoolPublicConsented}::uuid, ${WEIGHT.next.id}::uuid, 'WASSCE', 'ALL', 400, 240,  60.00, 'WAEC_EXTRACT', '2019-06-21'),
        (${JUR.schoolPublicNoConsent}::uuid, ${WEIGHT.next.id}::uuid, 'WASSCE', 'ALL',  40,  20,  50.00, 'WAEC_EXTRACT', '2019-06-21')
    `;
  });

  afterAll(async () => {
    const ids = Object.values(WEIGHT).map((s) => s.id);
    await owner`delete from fact_performance_exam where period_id = any(${ids}::uuid[])`;
    await owner`delete from dim_period where period_id = any(${ids}::uuid[])`;
  });

  it("each sitting's rate is Σ/Σ — nearer the 400-candidate school than the midpoint", async () => {
    const reading = await getExamQualificationTrend(districtScope, "WASSCE");
    if (!isOk(reading)) throw new Error("expected ok");
    const base = reading.value.points.find((p) => p.academicYear === "2017/18")!;
    const next = reading.value.points.find((p) => p.academicYear === "2018/19")!;
    expect([base.candidates, next.candidates]).toEqual([440, 440]);
    expect([base.qualified, next.qualified]).toEqual([240, 260]);
    expect(base.rate).toBeCloseTo(240 / 440, 12); // 0.54545…
    expect(next.rate).toBeCloseTo(260 / 440, 12); // 0.59090…
    // The equally-weighted (mean-of-rates) answers would be 0.75 and 0.55 — neither appears, and the
    // pooled figure sits nearer the big school's 0.50 than the small school's 1.00.
    expect(base.rate).not.toBeCloseTo(0.75, 3);
    expect(next.rate).not.toBeCloseTo(0.55, 3);
    expect(Math.abs(base.rate - 0.5)).toBeLessThan(Math.abs(base.rate - 1));
  });

  it("the YoY delta is the difference of the two pooled rates, NOT the average of per-school changes", async () => {
    const reading = await getExamQualificationTrend(districtScope, "WASSCE");
    if (!isOk(reading)) throw new Error("expected ok");
    const yoy = examQualificationYoy(reading.value.points, "2018/19")!;
    expect(yoy.priorAcademicYear).toBe("2017/18");
    expect(yoy.deltaRatio).toBeCloseTo(260 / 440 - 240 / 440, 12); // +0.04545… → "▲ 5 pts"
    // ⚠ THE SIGN IS THE WHOLE POINT. The average of the per-school rate CHANGES is (+0.10 + −0.50)/2 =
    // −0.20, and the difference of the equally-weighted rates is 0.55 − 0.75 = −0.20: a reader that did
    // either would publish a 20-point DECLINE where the subtree's candidates saw an improvement.
    expect(yoy.deltaRatio).toBeGreaterThan(0);
    expect(yoy.deltaRatio).not.toBeCloseTo(-0.2, 6);
    expect(yoy.deltaRatio).not.toBeCloseTo(0.1, 6); // nor the big school's own change
    expect(yoy.deltaRatio).not.toBeCloseTo(-0.5, 6); // nor the small school's own change
  });

  it("AC7 · no cross-sitting sum: the two sittings stay two points, never one 880-candidate figure", async () => {
    const reading = await getExamQualificationTrend(districtScope, "WASSCE");
    if (!isOk(reading)) throw new Error("expected ok");
    const total = reading.value.points.reduce((a, p) => a + p.candidates, 0);
    // Every point is strictly smaller than the series total, so no published figure is a cross-sitting
    // candidate sum (and 440+440 = 880 appears nowhere).
    for (const p of reading.value.points) expect(p.candidates).toBeLessThan(total);
    expect(reading.value.points.some((p) => p.candidates === 880)).toBe(false);
    // One point per sitting — the academic years are unique.
    const years = reading.value.points.map((p) => p.academicYear);
    expect(new Set(years).size).toBe(years.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (7) AC4 · THE KPI DELTA NEEDS ONLY THE TWO CURRENT SITTINGS (no dependency on 2023/2024)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("AC4 · the WASSCE KPI delta is computable from the two current sittings alone", () => {
  const dataset = generateDemoDataset();

  const pooledWassceRate = (sittingYear: number) => {
    const rows = dataset.terminalExamResults.filter(
      (r) => r.year === sittingYear && r.examType === "WASSCE",
    );
    const q = rows.reduce((a, r) => a + r.femalePassed + r.malePassed, 0);
    const c = rows.reduce((a, r) => a + r.femaleCandidates + r.maleCandidates, 0);
    return { q, c, rate: q / c };
  };

  it("a series of ONLY 2024/25 + 2025/26 still yields a non-null delta", () => {
    // The pre-increment-M demo (sittings 2025 and 2026 only) — the exact state M4 says ships today.
    const only2025 = pooledWassceRate(2025);
    const only2026 = pooledWassceRate(2026);
    const series = [
      point("2024/25", only2025.q, only2025.c),
      point("2025/26", only2026.q, only2026.c),
    ];
    const yoy = examQualificationYoy(series, "2025/26");
    expect(yoy).not.toBeNull();
    expect(yoy!.priorAcademicYear).toBe("2024/25");
    // Non-degenerate at the card's 0-dp display precision, so the pill is a real ▲/▼ and not a
    // "no change" that only looks honest.
    const deltaPts =
      Math.round(yoy!.currentRate * 100) - Math.round(yoy!.priorRate * 100);
    expect(deltaPts).not.toBe(0);
    // The two extra sittings are PRESENT but IRRELEVANT: adding them in front cannot change this delta,
    // which is what "no dependency on 2023/2024" means arithmetically.
    const p2023 = pooledWassceRate(2023);
    const p2024 = pooledWassceRate(2024);
    const withHistory = [
      point("2022/23", p2023.q, p2023.c),
      point("2023/24", p2024.q, p2024.c),
      ...series,
    ];
    expect(JSON.stringify(examQualificationYoy(withHistory, "2025/26"))).toBe(
      JSON.stringify(yoy),
    );
  });

  it("the current-sitting constant is self-sufficient (two sittings, two distinct ends_on)", () => {
    expect(DEMO_CURRENT_EXAM_COHORTS.length).toBe(2);
    expect(new Set(DEMO_CURRENT_EXAM_COHORTS.map((c) => c.endsOn)).size).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (8) THE REMAINING SURFACE/STATIC GUARDS — AC1, AC9/AC10 distinctness, AC11, AC18, AC21, AC22
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the pill semantics and the scope guards the surface must keep (AC1/AC9/AC10/AC11/AC18/AC21/AC22)", () => {
  const page = moduleText("app/(oversight)/page.tsx");
  const performance = moduleText("lib/oversight/performance.ts");

  it("AC9/AC10 · absent and measured-zero are the same TONE but never the same MARKUP", () => {
    const absent = renderToStaticMarkup(
      createElement(KDelta, { tone: "flat", children: "— no prior sitting yet" }),
    );
    const zero = renderToStaticMarkup(
      createElement(KDelta, { tone: "flat", children: "no change vs 2025" }),
    );
    expect(absent).not.toBe(zero);
    // The em-dash appears ONLY in the absent state; the measured zero is a definite figure in words.
    expect(absent).toContain("—");
    expect(zero).not.toContain("—");
    expect(zero).toContain("no change");
    // Neither fabricates a direction.
    for (const html of [absent, zero]) {
      expect(html).not.toContain("▲");
      expect(html).not.toContain("▼");
      expect(html).not.toContain("0%");
    }
  });

  it("AC9/AC10 · the page has BOTH branches and no fake zero-percent delta", () => {
    expect(page).toContain('noComparatorYet("— no prior sitting yet")');
    expect(page).toContain("no change");
    // A fake "▲ 0" is unreachable: the zero case RETURNS the flat "no change" before the ▲/▼ branch,
    // and the em-dash case returns before that. (The only "▲ 0%" text in the file is the prose
    // forbidding it.)
    expect(page.indexOf("yoy === null")).toBeLessThan(page.indexOf("deltaPts === 0"));
    expect(page.indexOf("deltaPts === 0")).toBeLessThan(page.indexOf("deltaPts > 0"));
    // The zero branch returns a MEASURED flat "no change" pill (and marks the trend measured, so the
    // provenance ledger explains it — AC19), reached only after the em-dash and before the ▲/▼ branch.
    expect(page).toContain("return { node: <KDelta tone=\"flat\">no change");
  });

  it("AC1 · no enrolment/staffing/PLC year-over-year VALUE is produced anywhere", () => {
    // The pills those cards carry are the em-dash constants — no figure, no DEMO chip.
    expect(page).toContain('const enrolmentDelta = shown(enrolment)');
    expect(page).toContain('const coverageDelta = shown(coverage)');
    expect(page).toContain('noComparatorYet("— no prior year yet")');
    // And no reader exists that could produce one: `performance.ts` is the ONLY trend/YoY data layer.
    for (const file of readdirSync(join(process.cwd(), "lib/oversight"))) {
      if (!file.endsWith(".ts") || file === "performance.ts") continue;
      const text = moduleText(join("lib/oversight", file));
      expect(text).not.toMatch(/export (async )?function \w*(Yoy|QualificationTrend)\w*/);
      expect(text).not.toMatch(/export (async )?function get\w*Trend\b/);
    }
  });

  it("AC11 · the PTR pill is the TARGET chip, unchanged and not gated on any comparator year", () => {
    // The PTR card's delta slot holds the three-way GES-norm Chip — not a KDelta, not a YoY.
    const ptrBlock = page.slice(page.indexOf('label="Pupil-teacher ratio"'));
    const ptrDelta = ptrBlock.slice(ptrBlock.indexOf("delta={"), ptrBlock.indexOf("</section>"));
    expect(ptrDelta).toContain("ptrVerdict");
    expect(ptrDelta).toContain("Chip");
    expect(ptrDelta).toContain("above GES level norms");
    expect(ptrDelta).not.toContain("KDelta");
    expect(ptrDelta).not.toContain("Yoy");
    expect(ptrDelta).not.toContain("Trend");
    // The verdict is derived from the norm constants and the current PTR only — no period/series input.
    expect(page).toMatch(/ptrVerdict\s*=/);
    expect(page.slice(page.indexOf("ptrVerdict ="), page.indexOf("ptrVerdict =") + 400)).not.toContain(
      "Trend",
    );
  });

  it("AC18 · attendance (and fees) carry no delta: the strip has exactly four delta slots", () => {
    const strip = page.slice(
      page.indexOf('aria-label="Headline indicators"'),
      page.indexOf("</section>", page.indexOf('aria-label="Headline indicators"')),
    );
    expect(strip.match(/delta=\{/g)?.length).toBe(4);
    expect(strip).not.toContain("attendance");
    expect(strip).not.toContain("fee");
    // No attendance trend reader exists either (the AC1 scan covers the whole data layer).
    expect(page).not.toContain("attendanceDelta");
  });

  it("AC21 · the series query is deterministic — no now()/current_date in the trend SQL", () => {
    const querySql = sqlTextOf(performance);
    expect(querySql).toContain("group by dp.academic_year");
    expect(querySql.toLowerCase()).not.toContain("now()");
    expect(querySql.toLowerCase()).not.toContain("current_date");
    expect(querySql.toLowerCase()).not.toContain("current_timestamp");
    // AC6/AC7 structurally: the stored rate is never selected, the ALL row is pinned, and the exam is a
    // bound parameter in BOTH reads (so BECE and WASSCE can never share a series).
    expect(querySql).not.toContain("qualification_rate");
    expect((querySql.match(/::exam/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((querySql.match(/sex = 'ALL'::ov_sex/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("AC22 · no new period_type, no new table, no migration", () => {
    expect([...periodTypeEnum.enumValues]).toEqual(["TERM", "ANNUAL", "EXAM_COHORT"]);
    const migrations = readdirSync(join(process.cwd(), "db/migrations")).filter((f) =>
      f.endsWith(".sql"),
    );
    expect(migrations.length).toBe(7); // 0000–0006; increment M adds none
    for (const file of migrations) {
      const text = moduleText(join("db/migrations", file));
      // No migration teaches `period_type` a fourth member.
      expect(text).not.toMatch(/alter type\s+"?period_type"?\s+add value/i);
    }
    // The seeding is DEMO_EXAM_COHORTS entries plus the run declaration — not a schema change.
    expect(moduleText("scripts/seed-demo-data.ts")).toContain("DEMO_PRIOR_EXAM_COHORTS");
  });
});
