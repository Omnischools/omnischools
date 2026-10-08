import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postgres from "postgres";
import { scopeFor, type JurisdictionScope } from "@/lib/db/rls";
import { isOk, type Reading } from "@/lib/oversight/reading";
import {
  getSchoolFees,
  type SchoolFeeRow,
  type SchoolFeesPanel as SchoolFeesPanelData,
} from "@/lib/oversight/fees";
import { FeeRangeBar, SchoolFeesPanel } from "@/components/oversight/fees-visuals";
import { FeesSection } from "@/components/oversight/fees-section";
import { JUR, OFFICER, PERIOD_ID_ANNUAL, PERIOD_ID_TERM } from "./fixtures/ids";
import {
  adminAnalytics,
  districtOfficer,
  nationalOfficer,
  officerFixture,
} from "./helpers";

/**
 * SCHOOL FEES — surfacing tests (increment K, FEES-SURFACING-RULING).
 *
 * Two halves:
 *  · COMPONENT RENDER (no DB) — the three-state cell, the count sentence, the centre-less range, the
 *    tier drill-down note, Free-SHS, OTHER-last, no-total. These prove the HONESTY rules a reader sees.
 *  · READER (live PG as the non-owner ov_app role) — tier gating, RLS isolation, the stage-IS-NULL
 *    read, the count-bucket arithmetic, determinism. These prove the figures are the database's own.
 *
 * Fixture discipline: every planted fact_fees row is removed in afterAll keyed on the planted
 * (period, jurisdiction) pairs, so tests/rls-tier-matrix.test.ts's global counts are untouched
 * (fileParallelism:false). fact_fees has no seed rows, so the table is empty again at teardown.
 */

const districtScope = scopeFor(districtOfficer);
const nationalScope = scopeFor(nationalOfficer);
const regionScope: JurisdictionScope = scopeFor(
  officerFixture({
    officerId: OFFICER.regionId,
    officerRole: OFFICER.regionRole,
    jurisdictionId: JUR.region,
    level: "REGION",
  }),
);

/* ─────────────────────────────── component helpers ─────────────────────────────── */

function fig(median: number, mean: number) {
  return { median, mean, zero: median === 0 && mean === 0 };
}

function render(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

/* ══════════════════════════════════ COMPONENT RENDER ══════════════════════════════════ */

describe("fees — tier gating (component)", () => {
  const panel: SchoolFeesPanelData = {
    schoolCount: 1,
    summaries: [{ category: "TUITION", positive: 1, chargesNothing: 0, notBilled: 0 }],
    schools: [
      {
        jurisdictionId: JUR.schoolPublicConsented,
        name: "Asankrangwa SHS",
        ownershipType: "PUBLIC",
        schoolType: "SHS",
        figures: { TUITION: fig(800, 900) },
        onlyOther: false,
      },
    ],
    tuitionRange: null,
    tuitionSkew: false,
  };

  it("REGION renders the drill-down note and NO amounts (AC-1,2)", () => {
    const html = render(
      createElement(FeesSection, {
        level: "REGION",
        reading: { status: "ok", value: panel } as Reading<SchoolFeesPanelData>,
        termLabel: "Term 2",
      }),
    );
    expect(html).toContain("Drill into a district");
    expect(html).toContain("there is no regional fee average");
    // No fee figure, count, or GHS AMOUNT of any kind at REGION (the "GHS" unit word in the meta is
    // fine; a "GHS 1,200.00" amount is not).
    expect(html).not.toMatch(/GHS\s[\d,]/);
    expect(html).not.toContain("typical");
    expect(html).not.toContain("charge nothing");
  });

  it("NATIONAL renders the drill-down note and NO amounts (AC-1,2)", () => {
    const html = render(
      createElement(FeesSection, {
        level: "NATIONAL",
        reading: { status: "ok", value: panel } as Reading<SchoolFeesPanelData>,
        termLabel: "Term 2",
      }),
    );
    expect(html).toContain("Drill into a region, then a district");
    expect(html).toContain("there is no national fee average");
    expect(html).not.toMatch(/GHS\s[\d,]/);
  });

  it("DISTRICT unavailable renders the fail-soft note, never throws (AC-20)", () => {
    const html = render(
      createElement(FeesSection, {
        level: "DISTRICT",
        reading: { status: "unavailable" } as Reading<SchoolFeesPanelData>,
        termLabel: "Term 2",
      }),
    );
    expect(html).toContain("could not be read for this term");
    expect(html).not.toMatch(/GHS\s[\d,]/);
  });
});

describe("fees — the three-state cell (component, AC-16,17,18)", () => {
  const schools: SchoolFeeRow[] = [
    {
      jurisdictionId: JUR.schoolPublicConsented,
      name: "Asankrangwa SHS",
      ownershipType: "PUBLIC",
      schoolType: "SHS",
      // TUITION a REAL billed zero (Free SHS); BOARDING not billed (absent).
      figures: { TUITION: fig(0, 0) },
      onlyOther: false,
    },
    {
      jurisdictionId: JUR.schoolPrivateConsented,
      name: "St. Monica SHS",
      ownershipType: "PRIVATE",
      schoolType: "SHS",
      // TUITION billed with mean ≫ median (skew); BOARDING billed.
      figures: { TUITION: fig(1200, 1500), BOARDING: fig(3000, 3000) },
      onlyOther: false,
    },
  ];
  const panel: SchoolFeesPanelData = {
    schoolCount: 2,
    summaries: [
      { category: "TUITION", positive: 1, chargesNothing: 1, notBilled: 0 },
      { category: "BOARDING", positive: 1, chargesNothing: 0, notBilled: 1 },
    ],
    schools,
    tuitionRange: { min: { name: "Asankrangwa SHS", median: 0 }, max: { name: "St. Monica SHS", median: 1200 } },
    tuitionSkew: true,
  };
  const html = render(createElement(SchoolFeesPanel, { data: panel, termLabel: "Term 2" }));

  it("a billed figure shows typical (median) AND avg (mean) together (F5/F13/AC-8)", () => {
    expect(html).toContain("typical GHS 1,200.00");
    expect(html).toContain("avg GHS 1,500.00");
    expect(html).toContain("typical GHS 3,000.00");
  });

  it("a real billed-zero reads 'charges nothing' with GHS 0.00, NOT an em-dash (F11/AC-16)", () => {
    expect(html).toContain("charges nothing");
    expect(html).toContain("GHS 0.00");
  });

  it("a public SHS zero-tuition cell carries the Free SHS chip (F11)", () => {
    expect(html).toContain("Free SHS");
  });

  it("a not-billed category reads the absence em-dash with its distinct title (F12/AC-17)", () => {
    // BOARDING is absent for Asankrangwa → the muted em-dash, titled 'Not billed this term'.
    expect(html).toContain('title="Not billed this term"');
    expect(html).toContain("—");
  });

  it("the billed-zero and the not-billed states are distinct strings (F12/AC-17)", () => {
    // 'charges nothing' (a stated GHS 0) must never be the same rendering as the absence em-dash.
    expect(html).toContain("charges nothing");
    expect(html).toContain('title="Not billed this term"');
    expect(html.indexOf("charges nothing")).not.toBe(html.indexOf('title="Not billed this term"'));
  });

  it("the skew caption renders when a mean materially tops its median (F13)", () => {
    expect(html).toContain("a few larger bills pull the average up");
  });

  it("the billed-students denominator caveat is always present (F16/AC-22)", () => {
    expect(html).toContain("billed");
    expect(html).toContain("what an average pupil pays");
  });
});

describe("fees — honest summaries and bans (component)", () => {
  const panel: SchoolFeesPanelData = {
    schoolCount: 4,
    summaries: [
      { category: "TUITION", positive: 1, chargesNothing: 2, notBilled: 1 },
      { category: "OTHER", positive: 1, chargesNothing: 0, notBilled: 3 },
    ],
    schools: [
      {
        jurisdictionId: JUR.schoolPublicConsented,
        name: "Asankrangwa SHS",
        ownershipType: "PUBLIC",
        schoolType: "SHS",
        figures: { TUITION: fig(0, 0) },
        onlyOther: false,
      },
      {
        jurisdictionId: JUR.schoolUnknownOwnership,
        name: "Nkwanta JHS",
        ownershipType: null,
        schoolType: "JHS",
        figures: { OTHER: fig(60, 60) },
        onlyOther: true,
      },
    ],
    tuitionRange: { min: { name: "Asankrangwa SHS", median: 0 }, max: { name: "Bethel", median: 400 } },
    tuitionSkew: false,
  };
  const html = render(createElement(SchoolFeesPanel, { data: panel, termLabel: "Term 2" }));

  it("the count sentence reads 'X of N schools charge nothing …' (F7/AC-11)", () => {
    expect(html).toContain("2 of 4 schools charge nothing for tuition");
    expect(html).toContain("1 bill a positive amount");
    expect(html).toContain("1 do not bill it");
  });

  it("the centre-less range shows the GHS extremes and NO 'mean' marker (F8/AC-13)", () => {
    // Rendered in ISOLATION: SpreadBar emits a 'mean' marker line; FeeRangeBar must not — any centre
    // would be the banned district average. (The panel's denominator caveat legitimately says "a mean
    // and median", which is why this is asserted on the bar alone, not the whole panel.)
    const rangeHtml = render(
      createElement(FeeRangeBar, {
        range: { min: { name: "Asankrangwa SHS", median: 0 }, max: { name: "Bethel", median: 400 } },
      }),
    );
    expect(rangeHtml).toContain("GHS 0.00 – GHS 400.00");
    expect(rangeHtml).not.toContain("mean");
    // The panel does carry the range, and its extremes.
    expect(html).toContain("GHS 0.00 – GHS 400.00");
  });

  it("OTHER is labelled 'uncategorised' and a school billing only OTHER is flagged (F15/AC-21)", () => {
    expect(html).toContain("Other charges (uncategorised)");
    expect(html).toContain("only uncategorised charges");
  });

  it("renders NO total row/column — no district fee amount is summed (F6/F9/AC-5)", () => {
    // No "Total" header or row exists; the only summaries are counts and the centre-less range. (The
    // honest copy may NEGATE a district average in words — the ban is on a rendered averaged FIGURE.)
    expect(html).not.toContain("Total");
  });

  it("ownership chips render for PUBLIC/null; MISSION renders when present", () => {
    expect(html).toContain("Public");
    const missionHtml = render(
      createElement(SchoolFeesPanel, {
        data: {
          ...panel,
          schools: [
            { ...panel.schools[0]!, ownershipType: "MISSION", name: "Mission SHS" },
          ],
        },
        termLabel: null,
      }),
    );
    expect(missionHtml).toContain("Mission");
  });
});

/* ══════════════════════════════════════ READER (live PG) ══════════════════════════════════════ */

/** Rows to plant. stage null = the all-stages whole-school figure the surface reads (ruling F4). */
interface FeeSeed {
  jurisdiction: string;
  category: string;
  stage: string | null;
  mean: string;
  median: string;
}

const SEED: FeeSeed[] = [
  // In the officer's district (…003):
  { jurisdiction: JUR.schoolPublicConsented, category: "TUITION", stage: null, mean: "0.00", median: "0.00" }, // Free SHS
  { jurisdiction: JUR.schoolPublicNoConsent, category: "TUITION", stage: null, mean: "0.00", median: "0.00" }, // Free SHS
  { jurisdiction: JUR.schoolPrivateConsented, category: "TUITION", stage: null, mean: "1500.00", median: "1200.00" }, // skew
  { jurisdiction: JUR.schoolPrivateConsented, category: "BOARDING", stage: null, mean: "3000.00", median: "3000.00" },
  { jurisdiction: JUR.schoolPrivateNoConsent, category: "TUITION", stage: null, mean: "400.00", median: "350.00" }, // Bethel, private JHS
  { jurisdiction: JUR.schoolUnknownOwnership, category: "OTHER", stage: null, mean: "60.00", median: "60.00" }, // only OTHER
  // …014 public JHS: a stage-NULL tuition row of 0 AND a per-stage DECOY of 999 — the surface must read
  // the stage-NULL row, never the per-stage one (ruling F4 / AC-7).
  { jurisdiction: JUR.schoolPublicStale, category: "TUITION", stage: null, mean: "0.00", median: "0.00" },
  { jurisdiction: JUR.schoolPublicStale, category: "TUITION", stage: "JHS", mean: "999.00", median: "999.00" },
  // OUTSIDE the district (…004) — the RLS exclusion target. A district officer must never see it.
  { jurisdiction: JUR.schoolOutsideSubtree, category: "TUITION", stage: null, mean: "250.00", median: "250.00" },
];

/** The (period, jurisdiction) pairs to clean — every school we plant, on the TERM period. */
const PLANTED_JURISDICTIONS = [...new Set(SEED.map((s) => s.jurisdiction))];

let owner: postgres.Sql;

beforeAll(async () => {
  owner = adminAnalytics();
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
         and jurisdiction_id = any(${PLANTED_JURISDICTIONS}::uuid[])
    `;
  } finally {
    await owner.end({ timeout: 5 });
  }
});

function okValue<T>(reading: Reading<T>): T {
  expect(reading.status).toBe("ok");
  if (!isOk(reading)) throw new Error("expected an `ok` reading");
  return reading.value;
}

describe("getSchoolFees — tier gating & RLS", () => {
  it("REGION and NATIONAL tiers are unavailable — no amounts leak above school grain (AC-1,2)", async () => {
    expect((await getSchoolFees(regionScope, PERIOD_ID_TERM)).status).toBe("unavailable");
    expect((await getSchoolFees(nationalScope, PERIOD_ID_TERM)).status).toBe("unavailable");
  });

  it("a null or wrong (non-term) period is unavailable (F20)", async () => {
    expect((await getSchoolFees(districtScope, null)).status).toBe("unavailable");
    // fact_fees is TERM-grain; nothing is planted on the ANNUAL period.
    expect((await getSchoolFees(districtScope, PERIOD_ID_ANNUAL)).status).toBe("unavailable");
  });

  it("a district officer sees only their own district's schools (RLS, AC-25)", async () => {
    const panel = okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM));
    const ids = panel.schools.map((s) => s.jurisdictionId);
    expect(ids).not.toContain(JUR.schoolOutsideSubtree);
    expect(panel.schools.every((s) => s.name !== "Takoradi SHS")).toBe(true);
    // The six reporting schools in the district (…015 and …019 filed no fee row → out of N).
    expect(panel.schoolCount).toBe(6);
  });
});

describe("getSchoolFees — figures & honest summaries", () => {
  it("reads the stage-IS-NULL row, never the per-stage decoy (F4/AC-7)", async () => {
    const panel = okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM));
    const stale = panel.schools.find((s) => s.jurisdictionId === JUR.schoolPublicStale);
    expect(stale?.figures.TUITION).toEqual({ median: 0, mean: 0, zero: true });
    // The 999 per-stage decoy must not have leaked into the whole-school figure.
    expect(stale?.figures.TUITION?.median).not.toBe(999);
  });

  it("the three TUITION buckets sum to the school count (F7/AC-11)", async () => {
    const panel = okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM));
    const tuition = panel.summaries.find((s) => s.category === "TUITION")!;
    // chargesNothing: …011, …012, …014 (three real 0.00 rows); positive: …013, …017; notBilled: …016.
    expect(tuition.chargesNothing).toBe(3);
    expect(tuition.positive).toBe(2);
    expect(tuition.notBilled).toBe(1);
    expect(tuition.positive + tuition.chargesNothing + tuition.notBilled).toBe(panel.schoolCount);
  });

  it("'charges nothing' counts only real 0.00 rows, not absent ones (F7/AC-12)", async () => {
    const panel = okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM));
    const other = panel.summaries.find((s) => s.category === "OTHER")!;
    // Only …016 filed OTHER (positive); nobody filed a 0.00 OTHER row.
    expect(other.positive).toBe(1);
    expect(other.chargesNothing).toBe(0);
  });

  it("the tuition range is centre-less with real-school extremes (F8/AC-13)", async () => {
    const panel = okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM));
    expect(panel.tuitionRange).not.toBeNull();
    // min is a free-SHS 0 (…011/…012/…014 tie, broken by name), max is the private school's 1200.
    expect(panel.tuitionRange!.min.median).toBe(0);
    expect(panel.tuitionRange!.max.median).toBe(1200);
    expect(panel.tuitionRange!.max.name).toBe("St. Monica Mission SHS");
  });

  it("carries ownership and school_type from dim_jurisdiction (F10/AC-14)", async () => {
    const panel = okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM));
    const priv = panel.schools.find((s) => s.jurisdictionId === JUR.schoolPrivateConsented);
    expect(priv?.ownershipType).toBe("PRIVATE");
    expect(priv?.schoolType).toBe("SHS");
    const unknown = panel.schools.find((s) => s.jurisdictionId === JUR.schoolUnknownOwnership);
    expect(unknown?.ownershipType).toBeNull();
    expect(unknown?.onlyOther).toBe(true);
  });

  it("the skew flag is set from the private school's mean ≫ median (F13)", async () => {
    const panel = okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM));
    expect(panel.tuitionSkew).toBe(true);
  });

  it("is deterministic — a re-read is deep-equal (AC-26)", async () => {
    const a = okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM));
    const b = okValue(await getSchoolFees(districtScope, PERIOD_ID_TERM));
    expect(b).toEqual(a);
  });
});
