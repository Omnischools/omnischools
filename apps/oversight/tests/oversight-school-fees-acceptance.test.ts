import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postgres from "postgres";
import { scopeFor } from "@/lib/db/rls";
import { isOk, type Reading } from "@/lib/oversight/reading";
import { getSchoolFees, type SchoolFeesPanel as SchoolFeesPanelData } from "@/lib/oversight/fees";
import { FeeRangeBar, SchoolFeesPanel } from "@/components/oversight/fees-visuals";
import { JUR, PERIOD_ID_TERM } from "./fixtures/ids";
import { adminAnalytics, districtOfficer } from "./helpers";

/**
 * SCHOOL FEES — the acceptance-criteria closure suite (Quinn, increment K QA gate).
 *
 * `tests/oversight-school-fees.test.ts` (the implementer's suite) covers the bulk of
 * FEES-SURFACING-RULING's 26 criteria. This file closes the ones it leaves unexercised, and is
 * deliberately written as the ADVERSARY of the no-district-average ban:
 *
 *  · AC-3  — no standalone single-school fees route exists.
 *  · AC-4  — a STRUCTURAL check that the reader computes no average of the amount columns.
 *  · AC-5  — the breakdown total row carries no fee cell at all (the column is deferred, E-FEE-2).
 *  · AC-6  — THE CORE PROBE: a live-seeded district of GHS 0 / 500 / 5,000 tuition yields counts and a
 *            centre-less range and NO averaged amount of any kind — proven by extracting EVERY GHS
 *            amount from the rendered panel and asserting the set is exactly the real school figures.
 *  · AC-9  — three categories on one school render three independent figures and no sum.
 *  · AC-10/21 — TUITION is the first column, OTHER the last, muted and labelled "uncategorised".
 *  · AC-13 — the `< 2 schools` guard: no range at all with a single figure-carrying school.
 *  · AC-14/15 — the equity contrast is counts + range; no per-ownership averaged amount is produced.
 *  · AC-18 — a school that filed nothing is absent from the panel, never shown with an invented 0.
 *  · AC-19 — the KPI strip still has exactly four cards on `xl:grid-cols-4`.
 *  · AC-22 — no non-bridge PTA re-derivation; the billed-students caveat rides with the figures.
 *  · AC-23 — fees are still absent from the comparison workspace; no ranking, no term trend.
 *  · AC-24 — the provenance "Fees" line is gated on DISTRICT tier AND a readable fees `Reading`.
 *  · AC-25 — the ISOLATION probe in BOTH directions, as the non-superuser `ov_app` role: the sibling
 *            district's officer sees ONLY their own school, and no app-side jurisdiction ceiling exists.
 *  · AC-26 — byte-identical (JSON-identical) re-read.
 *
 * Fixture discipline (identical to the implementer's suite): every planted `fact_fees` row is removed
 * in `afterAll`, keyed on (period, jurisdiction), so `tests/rls-tier-matrix.test.ts` — the last-running
 * global-count canary — is untouched. `fileParallelism` is false, so the two fee suites never overlap.
 */

const APP = join(process.cwd());
const source = (relative: string) => readFileSync(join(APP, relative), "utf8");
/**
 * The module with its COMMENTS STRIPPED. These files are heavily annotated and the annotations quote
 * the very bans being asserted ("MUST NOT sum", "fees are never ranked", "an implicit LIMIT 1"), so a
 * structural ban has to be asserted against the executable text or it fails on the prose that forbids
 * the thing. Template literals (the SQL) survive, which is the part that matters.
 */
const codeOf = (relative: string) =>
  source(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]+\/\/[^\n"'`]*$/gm, "");

const districtScope = scopeFor(districtOfficer);
/** The SIBLING district's officer. Derived (not minted) so the session brand survives — see helpers.ts. */
const siblingScope = scopeFor({ ...districtOfficer, jurisdictionId: JUR.otherDistrict });

function render(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

/** Every `GHS n.nn` amount in a rendered surface, de-duplicated. The ban is tested against THIS set. */
function ghsAmountsIn(html: string): string[] {
  return [...new Set(html.match(/GHS\s[\d,]+\.\d{2}/g) ?? [])].sort();
}

function okValue<T>(reading: Reading<T>): T {
  expect(reading.status).toBe("ok");
  if (!isOk(reading)) throw new Error("expected an `ok` reading");
  return reading.value;
}

/* ══════════════════════════════════ STRUCTURAL CHECKS (no DB) ══════════════════════════════════ */

describe("fees — structural bans (AC-3,4,5,19,22,23,24,25)", () => {
  const reader = source("lib/oversight/fees.ts");
  const readerCode = codeOf("lib/oversight/fees.ts");

  it("AC-4: the reader runs no SQL aggregate and no cross-school arithmetic on the amounts", () => {
    // No avg/sum/percentile/group-by/window anywhere in the module's executable text.
    expect(readerCode).not.toMatch(/\bavg\s*\(/i);
    expect(readerCode).not.toMatch(/\bsum\s*\(/i);
    expect(readerCode).not.toMatch(/percentile_(cont|disc)/i);
    expect(readerCode).not.toMatch(/\bgroup\s+by\b/i);
    expect(readerCode).not.toMatch(/\bover\s*\(/i);
    // No arithmetic that could divide or add amounts across schools. The ONLY arithmetic the module
    // performs on amounts is the skew ratio comparison (`t.mean >= t.median * FEE_SKEW_RATIO`, a
    // boolean, not a figure) and `a.median - b.median` (a sort comparator). Nothing is divided by a
    // school count, and no two schools' amounts are ever added.
    expect(readerCode).not.toMatch(/(mean|median)[A-Za-z]*\s*\/\s*/i);
    expect(readerCode).not.toMatch(/\/\s*(schools?|schoolCount|length|rows)/);
    expect(readerCode).not.toMatch(/(mean|median)[A-Za-z]*\s*\+=?\s*[a-z]*(mean|median)/i);
  });

  it("AC-4: nothing in the fees visuals averages the amounts either", () => {
    const visuals = codeOf("components/oversight/fees-visuals.tsx");
    expect(visuals).not.toMatch(/\bavg\s*\(/i);
    expect(visuals).not.toMatch(/(median|mean)\s*\/\s*/i);
    // `reduce` is how a cross-school total would be built; the fees visuals must not contain one.
    expect(visuals).not.toContain(".reduce(");
    expect(codeOf("components/oversight/fees-section.tsx")).not.toContain(".reduce(");
    // The only division in the visuals is a COUNT as a percent of N and a GHS position on the STATED
    // axis — both presentation geometry, neither a fee figure.
    expect(visuals).toMatch(/\(count \/ total\)/);
    expect(visuals).toMatch(/\(ghs - FEE_AXIS\.lo\) \/ \(FEE_AXIS\.hi - FEE_AXIS\.lo\)/);
  });

  it("AC-25: the fees read writes no app-side jurisdiction ceiling and no read-back path", () => {
    // RLS (`ov_in_subtree`) bounds the subtree — the enrolment/ptr/breakdown precedent. A hand-written
    // jurisdiction predicate here would be a second copy of the ceiling.
    expect(readerCode).not.toMatch(/ov_in_subtree/);
    expect(readerCode).not.toMatch(/jurisdiction_id\s*=\s*\$\{/);
    expect(readerCode).not.toMatch(/current_jurisdiction/);
    expect(readerCode).not.toMatch(/scope\.jurisdictionId/);
    // The WHERE clause is exactly the period pin and the stage-IS-NULL grain.
    expect(reader).toMatch(/where\s+ff\.period_id = \$\{termPeriodId\}::uuid\s*\n\s*and ff\.stage is null/);
    // Aggregate-only: no named pupil, no operational read-back import (ruling F19).
    for (const file of [
      "lib/oversight/fees.ts",
      "components/oversight/fees-visuals.tsx",
      "components/oversight/fees-section.tsx",
    ]) {
      expect(codeOf(file)).not.toMatch(/readback|pupil_name|student_name|learner_name/);
    }
  });

  it("AC-25/AC-26: the read is deterministic by construction and carries no clock", () => {
    expect(reader).toMatch(/distinct on \(ff\.jurisdiction_id, ff\.fee_category\)/);
    expect(reader).toMatch(/order by ff\.jurisdiction_id, ff\.fee_category/);
    expect(readerCode).not.toMatch(/now\(\)|current_date|current_timestamp|Date\.now|new Date\(/i);
    expect(readerCode).not.toMatch(/\blimit\b/i);
    expect(readerCode).not.toMatch(/Math\.random/);
  });

  it("AC-3: no standalone single-school fees route exists", () => {
    const page = source("app/(oversight)/page.tsx");
    expect(page).toContain("<FeesSection");
    // The oversight route group carries comparison/compliance-records/schools and nothing fee-shaped,
    // at any depth: the per-school figures exist ONLY as rows of the district panel (ruling F3).
    const routeFiles = readdirSync(join(APP, "app"), {
      withFileTypes: true,
      recursive: true,
    });
    expect(routeFiles.filter((e) => /fee/i.test(e.name)).map((e) => e.name)).toEqual([]);
  });

  it("AC-5: the breakdown table has no fee cell and therefore no total-row fee amount", () => {
    const table = source("components/oversight/breakdown-table.tsx");
    expect(table).not.toMatch(/fee|Ghs|GHS/i);
  });

  it("AC-19: the KPI strip is still exactly four cards on xl:grid-cols-4", () => {
    const page = source("app/(oversight)/page.tsx");
    expect(page).toContain('className="grid grid-cols-1 gap-[14px] md:grid-cols-2 xl:grid-cols-4"');
    expect(page.match(/<KpiCard\b/g) ?? []).toHaveLength(4);
    // The fees surface is a PANEL mounted after the breakdown section, not a fifth card: the
    // `<FeesSection` mount sits outside (after) the KPI grid's closing tag.
    expect(page.indexOf("<FeesSection")).toBeGreaterThan(
      page.indexOf("xl:grid-cols-4"),
    );
    expect(page.indexOf("<FeesSection")).toBeGreaterThan(page.indexOf("<BreakdownSection"));
  });

  it("AC-23: fees are not in the comparison workspace, and nothing ranks or trends them", () => {
    const comparison = source("lib/oversight/comparison.ts");
    // The only mentions of fees in comparison.ts are the DEFERRED prose; no metric is registered.
    expect(comparison).not.toMatch(/getSchoolFees|fact_fees|mean_amount|median_amount/);
    expect(comparison).toMatch(/FEES is DEFERRED/);
    for (const file of [
      "lib/oversight/fees.ts",
      "components/oversight/fees-visuals.tsx",
      "components/oversight/fees-section.tsx",
    ]) {
      const text = codeOf(file);
      expect(text).not.toMatch(/cheapest|priciest|rank|sparkline|trend/i);
      // No multi-term read: one period_id in, one term's figures out (ruling F20).
      expect(text).not.toMatch(/periodIds|previousTerm|priorTerm/);
    }
  });

  it("AC-22: PTA dues come only from fact_fees — no second derivation route", () => {
    expect(readerCode).not.toMatch(/pta_dues_charge|ptaDues|getPta/i);
    expect(reader).toMatch(/from fact_fees ff/);
    // fact_fees is the ONE fact table the module reads — plus the dimension it joins for labels.
    const fromTables = [...codeOf("lib/oversight/fees.ts").matchAll(/\bfrom\s+([a-z_]+)\b/g)].map(
      (m) => m[1],
    );
    expect(fromTables).toEqual(["fact_fees"]);
    expect(readerCode).toMatch(/join dim_jurisdiction s/);
    expect(readerCode).not.toMatch(/fact_(enrolment|attendance|staffing|performance)/);
  });

  it("AC-24: the provenance Fees line is gated on DISTRICT tier AND a readable fees Reading", () => {
    const page = source("app/(oversight)/page.tsx");
    expect(page).toMatch(/officer\.level === "DISTRICT" && isOk\(fees\)/);
    expect(page).toMatch(/"Fees",/);
    // The five things the line must state (ruling F21).
    expect(page).toContain("amounts billed (charged), not collected");
    expect(page).toContain("mean and median over the students billed for that category");
    expect(page).toContain("what an average pupil pays");
    expect(page).toContain("fees do not roll up, so there is no district, regional or national fee average");
    expect(page).toMatch(/for Term \$\{/);
  });
});

/* ══════════════════════════════════ COMPONENT CLOSURE ══════════════════════════════════ */

describe("fees — component closure (AC-9,10,13,14,21)", () => {
  const panel: SchoolFeesPanelData = {
    schoolCount: 2,
    summaries: [
      { category: "TUITION", positive: 1, chargesNothing: 1, notBilled: 0 },
      { category: "BOARDING", positive: 1, chargesNothing: 0, notBilled: 1 },
      { category: "PTA_DUES", positive: 1, chargesNothing: 0, notBilled: 1 },
      { category: "OTHER", positive: 1, chargesNothing: 0, notBilled: 1 },
    ],
    schools: [
      {
        jurisdictionId: JUR.schoolPublicConsented,
        name: "Asankrangwa SHS",
        ownershipType: "PUBLIC",
        schoolType: "SHS",
        figures: { TUITION: { median: 0, mean: 0, zero: true } },
        onlyOther: false,
      },
      {
        jurisdictionId: JUR.schoolPrivateConsented,
        name: "St. Monica SHS",
        ownershipType: "PRIVATE",
        schoolType: "SHS",
        figures: {
          TUITION: { median: 500, mean: 500, zero: false },
          BOARDING: { median: 1200, mean: 1200, zero: false },
          PTA_DUES: { median: 50, mean: 50, zero: false },
          OTHER: { median: 60, mean: 60, zero: false },
        },
        onlyOther: false,
      },
    ],
    tuitionRange: { min: { name: "Asankrangwa SHS", median: 0 }, max: { name: "St. Monica SHS", median: 500 } },
    tuitionSkew: false,
  };
  const html = render(createElement(SchoolFeesPanel, { data: panel, termLabel: "Term 2" }));

  it("AC-9: three categories on one school render three independent figures and NO sum", () => {
    expect(html).toContain("typical GHS 500.00");
    expect(html).toContain("typical GHS 1,200.00");
    expect(html).toContain("typical GHS 50.00");
    // 500 + 1200 + 50 = 1750 — the banned cross-category total, in either format.
    expect(html).not.toContain("1,750");
    expect(html).not.toContain("1750");
    expect(html).not.toMatch(/total\s*(bill|fee)/i);
  });

  it("AC-16: the billed-zero is NEUTRAL NAVY — no green, terra, warn or red anywhere on the surface", () => {
    // A zero fee is a POLICY FACT, not a performance win (green) or a failure (terra/warn). The whole
    // fees surface therefore carries none of the valenced tone families the rest of the app uses.
    for (const tone of ["green", "terra", "warn", "red", "emerald"]) {
      expect(html).not.toMatch(new RegExp(`(bg|text|border)-${tone}\\b`));
    }
    // The zero cell IS navy and IS a stated figure — not the muted absence tone.
    expect(html).toMatch(/text-navy">GHS 0\.00</);
    expect(html).toContain("charges nothing");
    // The absence state, by contrast, is the muted em-dash with its own title.
    expect(html).toContain('<span class="text-navy-3" title="Not billed this term">—</span>');
  });

  it("AC-10/21: TUITION is the first column, OTHER the last and labelled uncategorised", () => {
    const order = ["Tuition", "Boarding", "PTA dues", "Other charges (uncategorised)"];
    const positions = order.map((label) => html.indexOf(label));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // OTHER's count bar is visually muted (ruling F15).
    expect(html).toContain("opacity-75");
  });

  it("AC-13: the range is omitted entirely when fewer than two schools carry a figure", () => {
    const lone = render(
      createElement(SchoolFeesPanel, {
        data: { ...panel, schoolCount: 1, schools: [panel.schools[0]!], tuitionRange: null },
        termLabel: "Term 2",
      }),
    );
    expect(lone).not.toContain("schools range");
    expect(lone).not.toContain("Tuition · schools range");
  });

  it("AC-13: the range bar emits NO centre/midpoint element of any kind", () => {
    const bar = render(
      createElement(FeeRangeBar, {
        range: { min: { name: "Asankrangwa SHS", median: 0 }, max: { name: "St. Monica SHS", median: 500 } },
      }),
    );
    // Asserted against the VISIBLE TEXT, not the markup: Tailwind's layout classes legitimately
    // contain "items-center", which is geometry, not a centre figure.
    const text = bar.replace(/<[^>]*>/g, " ").toLowerCase();
    for (const banned of ["mean", "midpoint", "centre", "center", "mid-point", "weighted"]) {
      expect(text).not.toContain(banned);
    }
    // The word "average" appears exactly once, and only to DENY one (the ban is on a rendered
    // averaged figure; honest copy may say the figure does not exist).
    expect(text.match(/average/g) ?? []).toHaveLength(1);
    expect(text).toContain("there is no district average");
    // Exactly two end-dots and one band — three positioned children, no third marker.
    expect((bar.match(/rounded-full/g) ?? []).length).toBe(2);
    expect(bar).toContain("GHS 0.00 – GHS 500.00");
  });

  it("AC-14/15: the equity contrast is counts + range; no per-ownership averaged amount", () => {
    // The panel shape itself offers nowhere to put one.
    expect(Object.keys(panel).sort()).toEqual([
      "schoolCount",
      "schools",
      "summaries",
      "tuitionRange",
      "tuitionSkew",
    ]);
    expect(html).toContain("Public");
    expect(html).toContain("Private");
    expect(html).toContain("SHS");
    expect(html).not.toMatch(/private (average|mean|median)/i);
    expect(html).not.toMatch(/(average|mean|median) (for|across) (public|private|mission)/i);
    // Every GHS amount on the surface is a REAL school figure or a real range endpoint.
    expect(ghsAmountsIn(html)).toEqual(
      ["GHS 0.00", "GHS 50.00", "GHS 500.00", "GHS 1,200.00", "GHS 60.00"].sort(),
    );
  });
});

/* ══════════════════════════════════ LIVE PG — THE CORE PROBE ══════════════════════════════════ */

/**
 * THE 0 / 500 / 5,000 DISTRICT (AC-6). Three reporting schools in the officer's district, plus the
 * sibling district's school (AC-25) and two district schools that file NOTHING (AC-18).
 *
 * The averages a careless reader would want, for the record: mean-of-means = 1,833.33,
 * median-of-medians = 500 (indistinguishable from a real figure, hence the whole-set assertion),
 * (min+max)/2 midpoint = 2,500. None may appear.
 */
interface FeeSeed {
  jurisdiction: string;
  category: string;
  stage: string | null;
  mean: string;
  median: string;
}

const SEED: FeeSeed[] = [
  // …011 public SHS — a REAL billed zero (Free SHS).
  { jurisdiction: JUR.schoolPublicConsented, category: "TUITION", stage: null, mean: "0.00", median: "0.00" },
  // …013 private SHS — GHS 500 tuition, plus BOARDING and PTA_DUES (AC-9 against live data).
  { jurisdiction: JUR.schoolPrivateConsented, category: "TUITION", stage: null, mean: "500.00", median: "500.00" },
  { jurisdiction: JUR.schoolPrivateConsented, category: "BOARDING", stage: null, mean: "1200.00", median: "1200.00" },
  { jurisdiction: JUR.schoolPrivateConsented, category: "PTA_DUES", stage: null, mean: "50.00", median: "50.00" },
  // …017 private JHS — GHS 5,000 tuition, the high extreme.
  { jurisdiction: JUR.schoolPrivateNoConsent, category: "TUITION", stage: null, mean: "5000.00", median: "5000.00" },
  // …018, in the SIBLING district — the RLS exclusion target (a distinctive amount, so a leak into
  // the officer's own reading is unmistakable) AND the AC-7 stage decoy.
  //
  // ⚠ THE DECOY IS DELIBERATELY *LOWER* THAN THE ALL-STAGES ROW. The reader's determinism clause is
  // `DISTINCT ON (jurisdiction_id, fee_category) … ORDER BY … mean_amount ASC`, so a decoy ABOVE the
  // all-stages figure would lose that ordering anyway and the test would pass even with
  // `stage is null` deleted from the WHERE clause. A decoy BELOW it WINS the ordering, so this pair
  // fails the moment the all-stages grain stops being pinned. (Verified by mutation: removing
  // `and ff.stage is null` turns this school's figure into 111.)
  { jurisdiction: JUR.schoolOutsideSubtree, category: "TUITION", stage: null, mean: "7777.00", median: "7777.00" },
  { jurisdiction: JUR.schoolOutsideSubtree, category: "TUITION", stage: "JHS", mean: "111.00", median: "111.00" },
  // …015 and …019 are in the officer's district and deliberately file NOTHING (AC-18).
];

const PLANTED = [...new Set(SEED.map((s) => s.jurisdiction))];

let owner: postgres.Sql;

beforeAll(async () => {
  owner = adminAnalytics();
  // Defensive, and order-independent: `fact_fees` carries NO seed rows, and the sibling fee suite
  // cleans its own plants in `afterAll` — but vitest does not guarantee file order, so clear the whole
  // TERM period here rather than assume this file runs first. Scoped to the period, so nothing else
  // in the fixture DB is touched and tests/rls-tier-matrix.test.ts's global counts are unaffected.
  await owner`delete from fact_fees where period_id = ${PERIOD_ID_TERM}::uuid`;
  for (const s of SEED) {
    await owner`
      insert into fact_fees
        (jurisdiction_id, period_id, fee_category, stage, mean_amount, median_amount, source, as_of_date)
      values
        (${s.jurisdiction}::uuid, ${PERIOD_ID_TERM}::uuid, ${s.category}::ov_fee_category,
         ${s.stage}, ${s.mean}, ${s.median}, 'OPERATIONAL_AGG'::ov_source, '2026-03-31T00:00:00Z')
    `;
  }
});

afterAll(async () => {
  try {
    await owner`
      delete from fact_fees
       where period_id = ${PERIOD_ID_TERM}::uuid
         and jurisdiction_id = any(${PLANTED}::uuid[])
    `;
  } finally {
    await owner.end({ timeout: 5 });
  }
});

describe("getSchoolFees — the 0 / 500 / 5,000 district (AC-6,9,11,18,25,26)", () => {
  it("AC-6: yields counts and a centre-less range — and NO averaged figure anywhere", async () => {
    const panel = okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM));
    expect(panel.schoolCount).toBe(3);

    const tuition = panel.summaries.find((s) => s.category === "TUITION")!;
    expect(tuition).toMatchObject({ positive: 2, chargesNothing: 1, notBilled: 0 });

    // The range is the REAL extremes, with no centre field in the shape at all.
    expect(panel.tuitionRange).toEqual({
      min: { name: expect.any(String), median: 0 },
      max: { name: expect.any(String), median: 5000 },
    });
    expect(Object.keys(panel.tuitionRange!).sort()).toEqual(["max", "min"]);

    // No value anywhere in the reader's output equals any of the fabrications.
    const serialised = JSON.stringify(panel);
    // mean-of-means = 1833.33…, the (min+max)/2 midpoint = 2750, the naive sum = 5500. None exist.
    for (const fabrication of [1833.33, 1833, 1833.3333333333333, 2750, 5500]) {
      expect(serialised).not.toContain(String(fabrication));
    }

    // And the RENDERED surface's every GHS amount is a real school figure or real endpoint.
    const html = render(createElement(SchoolFeesPanel, { data: panel, termLabel: "Term 2" }));
    expect(ghsAmountsIn(html)).toEqual(
      ["GHS 0.00", "GHS 500.00", "GHS 5,000.00", "GHS 1,200.00", "GHS 50.00"].sort(),
    );
    expect(html).toContain("1 of 3 schools charge nothing for tuition");
    expect(html).toContain("GHS 0.00 – GHS 5,000.00");
    expect(html).not.toMatch(/district (average|mean|median) (fee|of)/i);
  });

  it("AC-9: the three categories of one school are independent — no live-data total", async () => {
    const panel = okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM));
    const priv = panel.schools.find((s) => s.jurisdictionId === JUR.schoolPrivateConsented)!;
    expect(Object.keys(priv.figures).sort()).toEqual(["BOARDING", "PTA_DUES", "TUITION"]);
    expect(priv.figures.TUITION!.median).toBe(500);
    expect(priv.figures.BOARDING!.median).toBe(1200);
    expect(priv.figures.PTA_DUES!.median).toBe(50);
    // 1750 is the banned cross-category total.
    expect(JSON.stringify(panel)).not.toContain("1750");
  });

  it("AC-11: every category's three buckets sum to N", async () => {
    const panel = okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM));
    expect(panel.summaries.length).toBeGreaterThan(1);
    for (const s of panel.summaries) {
      expect(s.positive + s.chargesNothing + s.notBilled).toBe(panel.schoolCount);
    }
  });

  it("AC-18: a school that filed no fee data is absent, never shown with an invented 0", async () => {
    const panel = okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM));
    const ids = panel.schools.map((s) => s.jurisdictionId);
    expect(ids).not.toContain(JUR.schoolPublicRevoked); // …015 filed nothing
    expect(ids).not.toContain(JUR.schoolUnmappedOperational); // …019 filed nothing
    expect(ids).toHaveLength(3);
    // Nor does a non-filer get a figure smuggled in via a bucket: N counts only reporting schools.
    expect(panel.schoolCount).toBe(ids.length);
  });

  it("AC-25: isolation holds in BOTH directions, as the non-superuser app role", async () => {
    // The owner can see all four planted schools — so the district officer's narrower view is RLS,
    // not an empty table.
    const all = (await owner`
      select jurisdiction_id::text as id from fact_fees
       where period_id = ${PERIOD_ID_TERM}::uuid and stage is null
    `) as unknown as { id: string }[];
    for (const id of PLANTED) expect(all.map((r) => r.id)).toContain(id);

    const mine = okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM));
    expect(mine.schools.map((s) => s.jurisdictionId)).not.toContain(JUR.schoolOutsideSubtree);
    // The sibling's distinctive GHS 7,777 must appear nowhere in my district's reading or render.
    expect(JSON.stringify(mine)).not.toContain("7777");
    expect(render(createElement(SchoolFeesPanel, { data: mine, termLabel: "Term 2" }))).not.toContain(
      "7,777",
    );

    // And the sibling officer sees ONLY their own school — the mirror image.
    const theirs = okValue(await getSchoolFees(siblingScope, PERIOD_ID_TERM));
    expect(theirs.schools.map((s) => s.jurisdictionId)).toEqual([JUR.schoolOutsideSubtree]);
    expect(theirs.schoolCount).toBe(1);
    expect(theirs.schools[0]!.figures.TUITION!.median).toBe(7777);
    // One figure-carrying school → no range (AC-13's guard, against live data).
    expect(theirs.tuitionRange).toBeNull();
  });

  it("AC-7: the all-stages row wins over a per-stage decoy that would otherwise be selected", async () => {
    // …018 carries BOTH a `stage IS NULL` TUITION row of 7,777 and a per-stage ('JHS') row of 111.
    // The whole-school figure must be the stored all-stages row — not the per-stage row, not their
    // average (3,944), not their sum (7,888). See the SEED note: the decoy is below the all-stages
    // figure precisely so it would WIN the reader's deterministic ordering if the grain pin were lost.
    const theirs = okValue(await getSchoolFees(siblingScope, PERIOD_ID_TERM));
    const school = theirs.schools[0]!;
    expect(school.figures.TUITION).toEqual({ median: 7777, mean: 7777, zero: false });
    const serialised = JSON.stringify(theirs);
    expect(serialised).not.toContain("111");
    expect(serialised).not.toContain("3944");
    expect(serialised).not.toContain("7888");
    // One (school, category) → exactly one figure, never two rows for the same cell.
    expect(Object.keys(school.figures)).toEqual(["TUITION"]);
  });

  it("AC-26: the re-read is byte-identical (JSON-identical), not merely deep-equal", async () => {
    const a = JSON.stringify(okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM)));
    const b = JSON.stringify(okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM)));
    expect(b).toBe(a);

    // Determinism DESPITE the missing grain UNIQUE: plant an exact duplicate (school, category, stage)
    // row with a DIFFERENT amount and confirm the reader still returns one stable answer.
    await owner`
      insert into fact_fees
        (jurisdiction_id, period_id, fee_category, stage, mean_amount, median_amount, source, as_of_date)
      values
        (${JUR.schoolPrivateConsented}::uuid, ${PERIOD_ID_TERM}::uuid, 'TUITION'::ov_fee_category,
         null, '9999.00', '9999.00', 'OPERATIONAL_AGG'::ov_source, '2026-03-31T00:00:00Z')
    `;
    try {
      const c = JSON.stringify(okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM)));
      const d = JSON.stringify(okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM)));
      expect(d).toBe(c);
      // DISTINCT ON + the total ORDER BY picks the lower amount every time — one answer, not two.
      const withDup = okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM));
      expect(withDup.schools.find((s) => s.jurisdictionId === JUR.schoolPrivateConsented)!.figures
        .TUITION!.median).toBe(500);
    } finally {
      await owner`
        delete from fact_fees
         where period_id = ${PERIOD_ID_TERM}::uuid
           and jurisdiction_id = ${JUR.schoolPrivateConsented}::uuid
           and mean_amount = '9999.00'
      `;
    }
  });
});
