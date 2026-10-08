import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postgres from "postgres";
import { scopeFor, type JurisdictionScope } from "@/lib/db/rls";
import { isOk, type Reading } from "@/lib/oversight/reading";
import {
  childLevelFor,
  getChildBreakdown,
  spreadOf,
  teacherEstablishmentOf,
  type BreakdownRow,
  type ChildBreakdown,
} from "@/lib/oversight/breakdown";
import { buildComparison, comparisonMetrics } from "@/lib/oversight/comparison";
import { BreakdownTable } from "@/components/oversight/breakdown-table";
import { TeacherEstablishmentPanel } from "@/components/oversight/breakdown-visuals";
import { breakdownChrome, tierChrome } from "@/components/oversight/tier-chrome";
import {
  JUR,
  OFFICER,
  PERIOD_ID_ANNUAL,
  PERIOD_ID_EXAM_COHORT,
  PERIOD_ID_TERM,
} from "./fixtures/ids";
import {
  adminAnalytics,
  districtOfficer,
  nationalOfficer,
  officerFixture,
  testDbConfig,
} from "./helpers";

/**
 * QA GATE PROBE — the TEACHER-ESTABLISHMENT (vacancy) arm, against a REAL database as the NON-OWNER
 * `ov_app` role. Companion to tests/oversight-teacher-vacancies.test.ts, which the implementer wrote;
 * this file closes the five things nothing executed yet proved:
 *
 *  1. AC-18's FIRST HALF, which the implementer recorded as "not coverable — no single-school vacancy
 *     surface exists in this slice". It does exist: `childLevelFor("DISTRICT") === "SCHOOL"`, so a
 *     DISTRICT officer's breakdown table IS the single-school grain, and its Vacancies cell is the
 *     stored signed `vacancies` value shown with a word. That is testable, so it is tested here.
 *  2. The tier figures against an INDEPENDENT Σ taken in SQL under each officer's own RLS GUCs, rather
 *     than against the fixture's hand-arithmetic. This is what proves ACs 1/2/20/21 as a property of
 *     the database's own visibility rather than of a constant in the test file.
 *  3. A real `ownership_type = 'MISSION'` row. The implementer's fixture plants PRIVATE only (one row is
 *     NAMED "Vac Mission B" but inserted PRIVATE), so the panel's verbatim claim that "private and
 *     mission schools are excluded" was never exercised against a MISSION row.
 *  4. Simultaneous shortage > 0 AND surplus > 0 at the NATIONAL tier specifically (AC-5 names national),
 *     with each magnitude proved distinct from |net| so a cancelled net cannot pass.
 *  5. The COMPARISON BENCHMARK in the V11 cross-module identity, on live data. The shipped test checks
 *     the benchmark against synthetic rows; AC-9/V11 binds it to the same subtree sums as the panel.
 *  6. THE ANNUAL PIN ON THE ESTABLISHMENT ARM. `fact_staffing` is a STOCK, so an unfiltered sum across
 *     academic years is demonstrably wrong (STAFFING-PTR-DOMAIN-RULING AC-18). The arm is a NEW union
 *     branch with its OWN `where period_id = …`; nothing proved that a second ANNUAL period's rows stay
 *     out of the pinned period's shortage/surplus, which is the one way this arm could silently
 *     double-count a country.
 *  7. THE RENDERED FIGURES, not just the read's. ACs 9/11 bind the panel's net to the breakdown TOTAL
 *     cell — and a reader sees STRINGS. The two are compared as rendered magnitudes here, so a
 *     formatter that dropped a sign or a thousands separator on one surface and not the other fails.
 *  8. THE OPPOSITE-SIGNED PAIR IN ONE RENDERED TABLE (ACs 10/11): a net-short child in terra beside a
 *     net-surplus child in navy, in the same markup, with NO green anywhere on the column.
 *  9. AN ALL-MISSION TIER as the AC-16 unavailable case (the shipped test's all-absent tier is
 *     PRIVATE-shaped), asserting the absence note states no NUMBER at all — the strongest form of
 *     "unavailable, never 0".
 * 10. BYTE-IDENTICAL RENDERED MARKUP on a re-read (AC-22 at the surface, not only at the read).
 *
 * Fixture discipline: every planted row is removed in a `finally` keyed on the planted ids only, and
 * every extra period is its own ANNUAL pin, so tests/rls-tier-matrix.test.ts's global counts are
 * untouched (`fileParallelism: false`).
 */

/** Seed figures (tests/fixtures/analytics-seed.sql, fact_staffing). */
const SEED = {
  /** Asankrangwa SHS …011, PUBLIC, in the officer's district …003. */
  publicSchool: "10000000-0000-4000-8000-000000000011",
  posts: 38,
  teachers: 41,
  /** SIGNED: a surplus of 3 teachers over establishment. Never floored. */
  vacancies: -3,
  /** …018, in the OTHER district …004: NULL establishment, NULL vacancies. */
  privateSchool: "10000000-0000-4000-8000-000000000018",
} as const;

let owner: postgres.Sql;

const districtScope = scopeFor(districtOfficer);
const nationalScope = scopeFor(nationalOfficer);
const regionOfficer = officerFixture({
  officerId: OFFICER.regionId,
  officerRole: OFFICER.regionRole,
  jurisdictionId: JUR.region,
  level: "REGION",
});
const regionScope: JurisdictionScope = scopeFor(regionOfficer);

beforeAll(() => {
  owner = adminAnalytics();
});

afterAll(async () => {
  await owner.end({ timeout: 5 });
});

function okValue<T>(reading: Reading<T>): T {
  expect(reading.status).toBe("ok");
  if (!isOk(reading)) throw new Error("expected an `ok` reading, got `unavailable`");
  return reading.value;
}

async function readBreakdown(
  scope: JurisdictionScope,
  overrides: { annualPeriodId?: string | null } = {},
): Promise<ChildBreakdown> {
  return okValue(
    await getChildBreakdown(scope, {
      childLevel: childLevelFor(scope.level),
      termPeriodId: PERIOD_ID_TERM,
      examPeriodId: PERIOD_ID_EXAM_COHORT,
      annualPeriodId: PERIOD_ID_ANNUAL,
      exam: "WASSCE",
      ...overrides,
    }),
  );
}

/** A raw read with the GUCs `withJurisdiction()` would set, as the NON-OWNER APP role. Rolled back. */
async function asOfficer<T>(
  scope: JurisdictionScope,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const app = postgres(testDbConfig.analyticsUrl, { max: 1, prepare: false });
  try {
    let captured: T;
    try {
      await app.begin(async (tx) => {
        await tx`select set_config('app.current_jurisdiction', ${scope.jurisdictionId ?? ""}, true)`;
        await tx`select set_config('app.current_level', ${scope.level}, true)`;
        await tx`select set_config('app.current_officer', ${scope.officerId ?? ""}, true)`;
        captured = await fn(tx as unknown as postgres.TransactionSql);
        throw new Error("__rollback__");
      });
    } catch (err) {
      if ((err as Error).message !== "__rollback__") throw err;
    }
    return captured!;
  } finally {
    await app.end({ timeout: 5 });
  }
}

/**
 * THE INDEPENDENT Σ — the ruling's arithmetic written out in SQL, read as the app role under the
 * officer's own GUCs, so whatever rows RLS lets this officer see are exactly what it folds. Nothing
 * here references `jurisdiction_id`: the subtree bound is RLS's, which is the point of the comparison.
 */
async function independentSum(
  scope: JurisdictionScope,
  periodId = PERIOD_ID_ANNUAL,
): Promise<{
  schools: number;
  posts: number | null;
  shortage: number | null;
  surplus: number | null;
  net: number | null;
}> {
  return asOfficer(scope, async (tx) => {
    const rows = (await tx`
      select count(distinct jurisdiction_id)::int        as schools,
             sum(teaching_posts_established)::int        as posts,
             sum(greatest(vacancies, 0))::int            as shortage,
             sum(greatest(-vacancies, 0))::int           as surplus,
             sum(vacancies)::int                         as net
        from fact_staffing
       where period_id = ${periodId}::uuid
         and teaching_posts_established is not null
    `) as unknown as {
      schools: number;
      posts: number | null;
      shortage: number | null;
      surplus: number | null;
      net: number | null;
    }[];
    return rows[0]!;
  });
}

const CHROME = breakdownChrome("REGION", "Western Region");

/** The panel takes a RESOLVED breakdown — the unread case is BreakdownSection's (Dex N1). */
function panelText(breakdown: ChildBreakdown, tierNoun = "region"): string {
  return textOf(
    renderToStaticMarkup(
      createElement(TeacherEstablishmentPanel, { breakdown, chrome: CHROME, tierNoun }),
    ),
  );
}

function stripTags(markup: string): string {
  // Char-scan rather than a `<…>`-matching regex (CodeQL js/bad-tag-filter, CWE-116) — the
  // oversight-ptr.test.ts idiom.
  let out = "";
  for (let i = 0; i < markup.length; i++) {
    if (markup[i] !== "<") {
      out += markup[i];
      continue;
    }
    const close = markup.indexOf(">", i);
    if (close === -1) {
      out += markup.slice(i);
      break;
    }
    out += " ";
    i = close;
  }
  return out;
}

function textOf(markup: string): string {
  // `&amp;` is unescaped LAST (CodeQL js/double-escaping, CWE-116).
  return stripTags(markup)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Plant SCHOOL nodes + staffing rows, run the body, then delete exactly those rows.
 *
 * `ownership` is explicit here (the shipped fixture derives it from `posts`), because a MISSION school
 * with a NULL establishment is a DIFFERENT row from a PRIVATE one and the panel names both.
 */
async function withSchools(
  schools: {
    id: string;
    name: string;
    parent: string;
    periodId?: string;
    teachers: number;
    posts: number | null;
    ownership?: "PUBLIC" | "PRIVATE" | "MISSION";
  }[],
  body: () => Promise<void>,
  extraPeriod?: { id: string; academicYear: string },
): Promise<void> {
  if (extraPeriod) {
    await owner`
      insert into dim_period (period_id, academic_year, term, period_type, is_current)
      values (${extraPeriod.id}::uuid, ${extraPeriod.academicYear}, null, 'ANNUAL', false)
    `;
  }
  for (const s of schools) {
    const ownership = s.ownership ?? (s.posts === null ? "PRIVATE" : "PUBLIC");
    await owner`
      insert into dim_jurisdiction (jurisdiction_id, level, parent_id, name, school_type, ownership_type, is_reporting)
      values (${s.id}::uuid, 'SCHOOL', ${s.parent}::uuid, ${s.name}, 'JHS', ${ownership}, true)
    `;
    const enrolment = s.teachers * 20;
    const vacancies = s.posts === null ? null : s.posts - s.teachers;
    await owner`
      insert into fact_staffing (jurisdiction_id, period_id, teachers_on_roll, teaching_posts_established,
                                 enrolment_total, ptr, vacancies, source, as_of_date)
      values (${s.id}::uuid, ${s.periodId ?? PERIOD_ID_ANNUAL}::uuid, ${s.teachers}, ${s.posts},
              ${enrolment}, ${(enrolment / s.teachers).toFixed(2)}, ${vacancies},
              'OPERATIONAL_AGG', now())
    `;
  }
  try {
    await body();
  } finally {
    for (const s of schools) {
      await owner`delete from fact_staffing where jurisdiction_id = ${s.id}::uuid`;
      await owner`delete from dim_jurisdiction where jurisdiction_id = ${s.id}::uuid`;
    }
    if (extraPeriod) {
      await owner`delete from dim_period where period_id = ${extraPeriod.id}::uuid`;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (1) AC-18's FIRST HALF — the single-school surface the slice was said not to have
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the per-school signed value IS surfaced, at single-school grain, with a word (AC-18)", () => {
  it("a DISTRICT officer's children ARE schools, so the table is the single-school grain", () => {
    // The premise of the "not coverable" note. If this ever changes, the assertions below change with it.
    expect(childLevelFor("DISTRICT")).toBe("SCHOOL");
  });

  it("the school row's value IS the stored signed `vacancies`, shown with a word and never bare", async () => {
    const b = await readBreakdown(districtScope);
    expect(b.childLevel).toBe("SCHOOL");
    const school = b.children.find((r) => r.childId === SEED.publicSchool);
    expect(school, "the officer's own public school is not a child row").toBeDefined();

    // The STORED column, read back as the app role under the officer's own GUCs.
    const stored = await asOfficer(districtScope, async (tx) => {
      const rows = (await tx`
        select vacancies::int as v
          from fact_staffing
         where jurisdiction_id = ${SEED.publicSchool}::uuid
           and period_id = ${PERIOD_ID_ANNUAL}::uuid
      `) as unknown as { v: number }[];
      return rows[0]!.v;
    });
    expect(stored).toBe(SEED.vacancies);
    // At ONE school, shortage − surplus IS the stored signed value — the decomposition is lossless.
    expect(school!.vacancyNet).toBe(stored);
    expect(school!.vacancyShortage).toBe(0);
    expect(school!.vacancySurplus).toBe(3);

    // …and it is rendered SIGNED WITH A WORD, in neutral navy, never green, never a bare "-3".
    const markup = renderToStaticMarkup(
      createElement(BreakdownTable, {
        breakdown: b,
        chrome: breakdownChrome("DISTRICT", "Wassa Amenfi West"),
        homeId: null,
      }),
    );
    const row = new RegExp(`${SEED.publicSchool}[\\s\\S]*?</tr>`).test(markup)
      ? (new RegExp(`${SEED.publicSchool}([\\s\\S]*?)</tr>`).exec(markup)?.[1] ?? "")
      : (/Asankrangwa([\s\S]*?)<\/tr>/.exec(markup)?.[1] ?? "");
    expect(row, "no school row found in the district table").not.toBe("");
    expect(textOf(row)).toContain("3 over");
    expect(row).toContain("text-navy");
    expect(row).not.toContain("text-green");
    // The two defects AC-11 names: a bare signed integer, and an unworded magnitude.
    expect(textOf(row)).not.toMatch(/(^|\s)-3(\s|$)/);
  });

  it("the stored per-school column is never summed as a lone net anywhere in the read", () => {
    // The enforceable half, re-asserted over BOTH read modules rather than one, since the ruling's
    // prohibition is on every roll-up allow-list (§7), not only on breakdown.ts.
    for (const file of [
      "lib/oversight/breakdown.ts",
      "lib/oversight/ptr.ts",
      "lib/oversight/enrolment.ts",
    ]) {
      const code = readSource(file);
      expect(code, `${file} sums the signed column`).not.toMatch(
        /sum\(\s*-?\s*\w*\.?vacancies/,
      );
      expect(code, `${file} floors the signed column`).not.toMatch(
        /abs\(\s*\w*\.?vacancies/,
      );
      expect(code, `${file} floors the signed column`).not.toMatch(
        /max\(\s*0\s*,\s*\w*\.?vacancies/,
      );
      expect(code, `${file} averages the signed column`).not.toMatch(
        /avg\(\s*\w*\.?vacancies/,
      );
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (2) THE TIER FIGURES AGAINST AN INDEPENDENT SQL Σ, UNDER EACH OFFICER'S RLS — ACs 1, 2, 20, 21
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("every tier's figures equal an independent Σ over what RLS lets that officer see (ACs 1, 2, 20, 21)", () => {
  /** A big shortage in the SIBLING district, so the three tiers' figures differ BY VALUE. */
  const SIBLING = {
    id: "10000000-0000-4000-8000-0000000000a1",
    name: "QA Sibling Shortage JHS",
    parent: JUR.otherDistrict,
    teachers: 30,
    posts: 47,
  };

  it("district, region and national each match their own subtree's Σ — computed in SQL, not asserted from constants", async () => {
    await withSchools([SIBLING], async () => {
      for (const [tier, scope] of [
        ["district", districtScope],
        ["region", regionScope],
        ["national", nationalScope],
      ] as const) {
        const est = teacherEstablishmentOf(await readBreakdown(scope))!;
        const sum = await independentSum(scope);
        expect(est, `${tier}: no reading`).not.toBeNull();
        // AC-6's identity, taken from the DB's own signed column: the derived net IS Σ vacancies.
        expect(est.net, `${tier}: net != Σ signed vacancies`).toBe(sum.net);
        expect(est.shortage, `${tier}: shortage != Σ greatest(v,0)`).toBe(sum.shortage);
        expect(est.surplus, `${tier}: surplus != Σ greatest(-v,0)`).toBe(sum.surplus);
        expect(est.postsEstablished, `${tier}: posts != Σ established`).toBe(sum.posts);
        // AC-2: the stated N is count(distinct school) with a non-null establishment in the subtree.
        expect(est.schoolsWithEstablishment, `${tier}: wrong denominator`).toBe(
          sum.schools,
        );
      }
      // …and the tiers are NOT equal, so the agreement above is not three reads of one number.
      const district = teacherEstablishmentOf(await readBreakdown(districtScope))!;
      const region = teacherEstablishmentOf(await readBreakdown(regionScope))!;
      expect(district.schoolsWithEstablishment).toBe(1);
      expect(region.schoolsWithEstablishment).toBe(2);
      expect(district.shortage).toBe(0);
      expect(region.shortage).toBe(17);
      // No trace of the sibling reaches the district officer: not its magnitude, not its name.
      expect(district.shortage).not.toBe(region.shortage);
      expect(district.postsEstablished).toBe(SEED.posts);
      const names = (await readBreakdown(districtScope)).children.map((r) => r.name);
      expect(names).not.toContain(SIBLING.name);
      expect(panelText(await readBreakdown(districtScope), "district")).not.toContain(
        "17",
      );
    });
  });

  it("a district officer's raw subtree Σ cannot see the sibling row at all (the RLS proof, not the app's)", async () => {
    await withSchools([SIBLING], async () => {
      const district = await independentSum(districtScope);
      const region = await independentSum(regionScope);
      // The sibling's 17 unfilled is invisible to the district officer AS THE APP ROLE — so the
      // agreement proved above is RLS's ceiling, not an app-side WHERE the read could forget.
      expect(district.schools).toBe(1);
      expect(district.shortage).toBe(0);
      expect(region.shortage).toBe(17);
      const visible = await asOfficer(districtScope, async (tx) => {
        const rows = (await tx`
          select count(*)::int as n from fact_staffing
           where jurisdiction_id = ${SIBLING.id}::uuid
        `) as unknown as { n: number }[];
        return rows[0]!.n;
      });
      expect(
        visible,
        "the sibling's staffing row is visible to the district officer",
      ).toBe(0);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (3) A REAL `MISSION` ROW — the panel's claim names mission schools, so a mission row must prove it
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("a MISSION school is excluded exactly as a PRIVATE one is (ACs 1, 3)", () => {
  it("adding a MISSION school with no establishment changes no figure, and renders the em-dash", async () => {
    const before = teacherEstablishmentOf(await readBreakdown(regionScope));
    expect(before).not.toBeNull();
    await withSchools(
      [
        {
          id: "10000000-0000-4000-8000-0000000000a2",
          name: "QA Mission JHS",
          parent: JUR.district,
          teachers: 13,
          posts: null,
          ownership: "MISSION",
        },
      ],
      async () => {
        const after = await readBreakdown(regionScope);
        // Identical figures — the row contributes NOTHING to the establishment arm (AC-1).
        expect(teacherEstablishmentOf(after)).toEqual(before);
        // …and it was really read, so this is not "the row never landed": its teachers moved the PTR arm.
        expect(after.total.teachers).toBe(SEED.teachers + 18 + 13);
        // At DISTRICT grain the mission school is its OWN row, and it is the em-dash, never a 0.
        const d = await readBreakdown(districtScope);
        const mission = d.children.find((r) => r.name === "QA Mission JHS");
        expect(mission, "the mission school is not a child row").toBeDefined();
        expect(mission!.vacancyNet).toBeNull();
        expect(mission!.postsEstablished).toBeNull();
        expect(mission!.schoolsWithEstablishment).toBeNull();
        const markup = renderToStaticMarkup(
          createElement(BreakdownTable, {
            breakdown: d,
            chrome: breakdownChrome("DISTRICT", "Wassa Amenfi West"),
            homeId: null,
          }),
        );
        const row = /QA Mission JHS([\s\S]*?)<\/tr>/.exec(markup)?.[1] ?? "";
        expect(row).not.toBe("");
        expect(row).toContain('title="No GES establishment"');
        expect(textOf(row)).not.toContain("balanced");
        expect(textOf(row)).not.toContain("unfilled");
      },
    );
  });

  it("the panel's exclusion sentence names BOTH ownerships it excludes", async () => {
    const text = panelText(await readBreakdown(regionScope));
    expect(text).toContain("private and mission schools are excluded");
    expect(text).toContain("GES sets no establishment for them");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (4) SHORTAGE > 0 AND SURPLUS > 0 AT THE NATIONAL TIER, SIMULTANEOUSLY — AC-5
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the national tier shows two magnitudes, not one cancelled net (ACs 4, 5, 6)", () => {
  const SHORT = {
    id: "10000000-0000-4000-8000-0000000000a3",
    name: "QA Northern-shaped JHS",
    parent: JUR.otherDistrict,
    teachers: 38,
    posts: 50,
  };

  it("national shortage and surplus are both non-zero, and neither is |net| (AC-5)", async () => {
    await withSchools([SHORT], async () => {
      const national = teacherEstablishmentOf(await readBreakdown(nationalScope))!;
      expect(national.shortage).toBeGreaterThan(0);
      expect(national.surplus).toBeGreaterThan(0);
      expect(national.net).toBe(national.shortage - national.surplus);
      // A CANCELLED net would have left one magnitude equal to |net| and the other at 0. Neither is.
      expect(national.shortage).not.toBe(Math.abs(national.net));
      expect(national.surplus).not.toBe(Math.abs(national.net));
      expect(national.shortage + national.surplus).toBeGreaterThan(
        Math.abs(national.net),
      );
      // The two magnitudes are rendered as SEPARATE figures, each with its own word.
      const text = panelText(await readBreakdown(nationalScope), "country");
      expect(text).toMatch(
        /Shortage[\s\S]*12[\s\S]*posts unfilled against establishment/,
      );
      expect(text).toMatch(/Surplus[\s\S]*3[\s\S]*teachers over establishment/);
      expect(text).toMatch(/Net\s+9 posts unfilled/);
    });
  });

  it("the panel never renders the net without both magnitudes above it (AC-4)", async () => {
    await withSchools([SHORT], async () => {
      const text = panelText(await readBreakdown(nationalScope), "country");
      const netAt = text.indexOf("Net ");
      expect(netAt).toBeGreaterThan(-1);
      // Both gross magnitudes precede the net on the surface — the net cannot be read alone.
      expect(text.indexOf("Shortage")).toBeGreaterThan(-1);
      expect(text.indexOf("Shortage")).toBeLessThan(netAt);
      expect(text.indexOf("Surplus")).toBeLessThan(netAt);
      // …and the net is never a bare integer: it always carries one of the three words.
      expect(text.slice(netAt)).toMatch(
        /Net\s+[\d,]+ (posts unfilled|teachers over establishment)|Net\s+at establishment/,
      );
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (5) THE V11 CROSS-MODULE IDENTITY, INCLUDING THE COMPARISON BENCHMARK, ON LIVE DATA — ACs 7, 9
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("panel, total row, spread mean and comparison benchmark are ONE set of sums (ACs 7, 9)", () => {
  const SHORT = {
    id: "10000000-0000-4000-8000-0000000000a4",
    name: "QA Shortage JHS",
    parent: JUR.otherDistrict,
    teachers: 38,
    posts: 50,
  };

  it("the four figures agree for the same subtree and period", async () => {
    await withSchools([SHORT], async () => {
      const b = await readBreakdown(regionScope);
      const est = teacherEstablishmentOf(b)!;
      const spread = spreadOf(b, (r) => r.vacancyRate)!;

      // The comparison row, built over the SAME children as the panel's subtree.
      const vacancy = comparisonMetrics({ exam: "WASSCE", hasCoverage: true }).find(
        (m) => m.key === "teacherVacancies",
      )!;
      const columns = b.children.map((row: BreakdownRow) => ({
        id: row.childId ?? "null",
        row,
        coverageAmbiguous: false,
      }));
      const model = buildComparison({
        metrics: [vacancy],
        benchmarkPopulation: b.children,
        columns,
      });
      const benchmark = model.sections[0]!.rows[0]!.benchmark;

      // ONE rate: the tier's own Σvacancies ÷ Σestablished.
      expect(est.vacancyRate).toBeCloseTo(est.net / est.postsEstablished, 12);
      expect(b.total.vacancyRate).toBeCloseTo(est.vacancyRate!, 12);
      expect(spread.mean).toBeCloseTo(est.vacancyRate!, 12);
      expect(
        benchmark,
        "the comparison benchmark is not the tier's own rate",
      ).not.toBeNull();
      expect(benchmark!).toBeCloseTo(est.vacancyRate!, 12);

      // ONE net: the panel's, the breakdown total row's, and the sum of the per-entity cells.
      expect(b.total.vacancyNet).toBe(est.net);
      const cellSum = model.sections[0]!.rows[0]!.cells.reduce(
        (acc, c) => acc + (c.value ?? 0),
        0,
      );
      expect(cellSum).toBe(est.net);

      // …and the benchmark is NOT the mean of the per-entity nets, which is the error V10 forbids.
      const rates = b.children
        .map((r) => r.vacancyRate)
        .filter((v): v is number => v !== null);
      const unweighted = rates.reduce((a, v) => a + v, 0) / rates.length;
      expect(Math.abs(benchmark! - unweighted)).toBeGreaterThan(0.01);
    });
  });

  it("the private child is null in BOTH the cell and the benchmark population (AC-15)", async () => {
    // The DISTRICT grain, where the children ARE schools — so a PRIVATE school planted in the
    // officer's OWN district is a child column carrying no establishment at all. (The seed's
    // establishment-less school …018 is in the SIBLING district and is correctly invisible here,
    // which is why this test plants its own.)
    await withSchools(
      [
        {
          id: "10000000-0000-4000-8000-0000000000a5",
          name: "QA Private JHS",
          parent: JUR.district,
          teachers: 12,
          posts: null,
        },
      ],
      async () => {
        const vacancy = comparisonMetrics({ exam: "WASSCE", hasCoverage: true }).find(
          (m) => m.key === "teacherVacancies",
        )!;
        const d = await readBreakdown(districtScope);
        const privateRow = d.children.find((r) => r.postsEstablished === null);
        expect(privateRow, "no establishment-less child at district grain").toBeDefined();
        expect(vacancy.valueOf(privateRow!)).toBeNull();
        // Its presence in the population does not move the benchmark: a `0` contribution would.
        const withPrivate = buildComparison({
          metrics: [vacancy],
          benchmarkPopulation: d.children,
          columns: d.children.map((row) => ({
            id: row.childId ?? "x",
            row,
            coverageAmbiguous: false,
          })),
        }).sections[0]!.rows[0]!.benchmark;
        const withoutPrivate = buildComparison({
          metrics: [vacancy],
          benchmarkPopulation: d.children.filter((r) => r.postsEstablished !== null),
          columns: d.children.map((row) => ({
            id: row.childId ?? "x",
            row,
            coverageAmbiguous: false,
          })),
        }).sections[0]!.rows[0]!.benchmark;
        expect(withPrivate).toBe(withoutPrivate);
        // …and it is the public school's own rate, not diluted by the private school's 0 posts.
        expect(withPrivate).toBeCloseTo(SEED.vacancies / SEED.posts, 12);
      },
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (6) THE ANNUAL PIN — fact_staffing is a STOCK, so the establishment arm must never sum across years
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the establishment arm is pinned to ONE ANNUAL period (ruling §1 V1, staffing AC-18)", () => {
  const OTHER_PERIOD = "20000000-0000-4000-8000-0000000000c1";
  /** A deliberately HUGE shortage, parked on a DIFFERENT academic year. */
  const OTHER_YEAR = {
    id: "10000000-0000-4000-8000-0000000000a6",
    name: "QA Other-Year JHS",
    parent: JUR.district,
    periodId: OTHER_PERIOD,
    teachers: 10,
    posts: 100,
  };

  it("a second ANNUAL period's rows do not reach the pinned period's shortage, surplus or denominator", async () => {
    const before = teacherEstablishmentOf(await readBreakdown(nationalScope));
    expect(before, "no national reading to compare against").not.toBeNull();
    await withSchools(
      [OTHER_YEAR],
      async () => {
        // The pinned period is UNCHANGED — not the posts, not either magnitude, not the school count.
        // A missing `period_id` predicate on the new union arm would have added 90 unfilled posts here.
        const after = teacherEstablishmentOf(await readBreakdown(nationalScope));
        expect(after).toEqual(before);

        // …and the row really exists, on its OWN period, where it is the only establishment there.
        const other = teacherEstablishmentOf(
          await readBreakdown(nationalScope, { annualPeriodId: OTHER_PERIOD }),
        )!;
        expect(other, "the other-year row was never planted").not.toBeNull();
        expect(other.schoolsWithEstablishment).toBe(1);
        expect(other.shortage).toBe(90);
        expect(other.surplus).toBe(0);
        expect(other.net).toBe(90);
        expect(other.postsEstablished).toBe(OTHER_YEAR.posts);

        // The two periods are different figures, so "unchanged" above is a pin and not a coincidence.
        expect(other.shortage).not.toBe(before!.shortage);
      },
      { id: OTHER_PERIOD, academicYear: "2016/17" },
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (7)+(8) THE RENDERED SURFACES AGREE, AND THE SIGNS ARE TONED APART — ACs 9, 10, 11
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The CLASS LIST of a row's VACANCY cell, isolated from the rest of the row.
 *
 * Scoped to the one cell on purpose: a child row also carries a WASSCE qualification pill, which is
 * legitimately `text-green` at a high rate, so "no green in the row" would be the wrong assertion. The
 * claim AC-11 makes is about the VACANCY figure's own tone.
 */
function vacancyCellClass(row: string): string {
  const m = /<span class="((?:(?!").)*)"[^>]*>\s*(?:\+?[\d,]+ (?:unfilled|over)|balanced)\s*<\/span>/.exec(
    row,
  );
  expect(m, "no vacancy cell in this row").not.toBeNull();
  return m![1]!;
}

/** The region table, rendered. Separate from the panel so the two surfaces can be compared as text. */
function tableMarkup(breakdown: ChildBreakdown, level: "REGION" | "DISTRICT" = "REGION"): string {
  return renderToStaticMarkup(
    createElement(BreakdownTable, {
      breakdown,
      chrome: breakdownChrome(
        level,
        level === "REGION" ? "Western Region" : "Wassa Amenfi West",
      ),
      homeId: null,
    }),
  );
}

describe("what a reader actually SEES agrees across the two surfaces, and the signs are toned apart", () => {
  const SHORT = {
    id: "10000000-0000-4000-8000-0000000000a7",
    name: "QA Terra-shaped JHS",
    parent: JUR.otherDistrict,
    teachers: 38,
    posts: 50,
  };

  it("the panel's rendered net and the table total cell's rendered net are the same magnitude (AC-9)", async () => {
    await withSchools([SHORT], async () => {
      const b = await readBreakdown(regionScope);
      const est = teacherEstablishmentOf(b)!;

      const panel = panelText(b);
      const totalRow =
        /bg-gold-bg([\s\S]*?)<\/tr>/.exec(tableMarkup(b))?.[1] ?? "";
      expect(totalRow, "no total row in the rendered table").not.toBe("");

      // The panel states "Net {n} posts unfilled"; the table cell states "+{n} unfilled". Different
      // wording by design (V2 vs V9), so the test binds the MAGNITUDE and the SIDE, not the string.
      const panelNet = /Net\s+([\d,]+) posts unfilled/.exec(panel)?.[1] ?? null;
      const cellNet = /\+([\d,]+) unfilled/.exec(textOf(totalRow))?.[1] ?? null;
      expect(panelNet, "the panel printed no worded net").not.toBeNull();
      expect(cellNet, "the total cell printed no worded net").not.toBeNull();
      expect(cellNet).toBe(panelNet);
      // …and both are the read's own net, so neither surface is formatting a different number.
      expect(Number(panelNet!.replace(/,/g, ""))).toBe(est.net);

      // The total cell's title carries the GROSS split — the net is never the whole claim (AC-14/V9).
      expect(totalRow).toContain(`${est.shortage} posts unfilled`);
      expect(totalRow).toContain(`${est.surplus} teachers over establishment`);
    });
  });

  it("a net-short child is terra and a net-surplus child is navy, in ONE table, with no green (ACs 10, 11)", async () => {
    await withSchools([SHORT], async () => {
      const b = await readBreakdown(regionScope);
      const est = teacherEstablishmentOf(b)!;
      // The premise: this tier really holds BOTH signs, as two SEPARATE magnitudes (AC-5).
      expect(est.shortage).toBeGreaterThan(0);
      expect(est.surplus).toBeGreaterThan(0);

      const markup = tableMarkup(b);
      const rowFor = (name: string) =>
        new RegExp(`${name}([\\s\\S]*?)</tr>`).exec(markup)?.[1] ?? "";

      // Wassa Amenfi West is net −3 (a SURPLUS): neutral navy, worded, never green, never bare.
      const surplusRow = rowFor("Wassa Amenfi West");
      expect(surplusRow).not.toBe("");
      expect(textOf(surplusRow)).toContain("3 over");
      expect(vacancyCellClass(surplusRow)).toContain("text-navy");
      expect(vacancyCellClass(surplusRow)).not.toContain("text-green");
      expect(textOf(surplusRow)).not.toMatch(/(^|\s)-3(\s|$)/);

      // Sekondi-Takoradi Metro is net +12 (a SHORTAGE): terra, worded, the adverse state.
      const shortageRow = rowFor("Sekondi-Takoradi Metro");
      expect(shortageRow).not.toBe("");
      expect(textOf(shortageRow)).toContain("+12 unfilled");
      expect(vacancyCellClass(shortageRow)).toContain("text-terra");
      expect(vacancyCellClass(shortageRow)).not.toContain("text-green");

      // The two cells really are toned APART — this is not one class list read twice.
      expect(vacancyCellClass(shortageRow)).not.toBe(vacancyCellClass(surplusRow));

      // AC-11 over the WHOLE panel too: no green anywhere on the establishment surface.
      const panelMarkup = renderToStaticMarkup(
        createElement(TeacherEstablishmentPanel, {
          breakdown: b,
          chrome: CHROME,
          tierNoun: "region",
        }),
      );
      expect(panelMarkup).not.toContain("text-green");
      expect(panelMarkup).not.toContain("bg-green");
    });
  });

  it("the rendered markup is byte-identical on a re-read of byte-identical data (AC-22)", async () => {
    await withSchools([SHORT], async () => {
      const first = await readBreakdown(regionScope);
      const second = await readBreakdown(regionScope);
      expect(teacherEstablishmentOf(second)).toEqual(teacherEstablishmentOf(first));
      // The SURFACE, not only the read: a `now()` or a locale-sensitive formatter would diverge here.
      expect(panelText(second)).toBe(panelText(first));
      expect(tableMarkup(second)).toBe(tableMarkup(first));
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (9) AN ALL-MISSION TIER IS UNAVAILABLE, AND THE NOTE STATES NO NUMBER AT ALL — AC-16
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("an all-MISSION tier is unavailable, and prints no figure whatsoever (AC-16)", () => {
  const PERIOD = "20000000-0000-4000-8000-0000000000c2";

  it("staffing rows exist, no establishment does, and the panel states a number nowhere", async () => {
    await withSchools(
      [
        {
          id: "10000000-0000-4000-8000-0000000000a8",
          name: "QA All-Mission JHS",
          parent: JUR.district,
          periodId: PERIOD,
          teachers: 14,
          posts: null,
          ownership: "MISSION",
        },
      ],
      async () => {
        const b = await readBreakdown(districtScope, { annualPeriodId: PERIOD });
        // The staffing row IS read — so this is the "rows exist, establishment does not" branch, the
        // one a `coalesce(sum(vacancies), 0)` upstream would have printed as "0 unfilled".
        expect(b.total.ptr).not.toBeNull();
        expect(b.total.teachers).toBe(14);
        expect(b.total.schoolsWithEstablishment).toBeNull();
        expect(b.total.vacancyNet).toBeNull();
        expect(b.total.vacancyNet).not.toBe(0);
        expect(teacherEstablishmentOf(b)).toBeNull();

        const text = panelText(b, "district");
        expect(text).toContain("No GES establishment in this district");
        expect(text).toContain("private and mission schools carry none");
        // THE STRONGEST FORM OF "UNAVAILABLE, NEVER 0": the note states no digit at all, so there is
        // no number on the surface for a reader to mistake for a measurement.
        expect(text, `the absence note printed a figure: ${text}`).not.toMatch(/\d/);

        // …and the one child row is the em-dash with its OWN title, never a 0 and never "balanced".
        const row =
          /QA All-Mission JHS([\s\S]*?)<\/tr>/.exec(tableMarkup(b, "DISTRICT"))?.[1] ?? "";
        expect(row).not.toBe("");
        expect(row).toContain('title="No GES establishment"');
        expect(textOf(row)).not.toContain("balanced");
        expect(textOf(row)).not.toContain("unfilled");
      },
      { id: PERIOD, academicYear: "2015/16" },
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (11) THE ABSENCE SENTENCE AT EVERY TIER THE PANEL MOUNTS AT — AC-13 (tier-polymorphic) × AC-16
//
// AC-13 ruled the panel tier-polymorphic at NATIONAL, REGION and DISTRICT; AC-16 ruled the absence
// state's wording verbatim — "No GES establishment in this {tier}". The shipped page test covers
// national and district only, and the one string that varies by tier is the one it skips. So the tier
// noun the PAGE actually computes is checked here, at every tier, through the real page.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** The §6 fixture's one public-establishment school, rendered through the real dashboard route. */
async function renderPageAs(officer: unknown, jurisdictionName: string): Promise<string> {
  vi.resetModules();
  vi.doMock("@/lib/auth", async (orig) => ({
    ...(await orig<typeof import("@/lib/auth")>()),
    getOfficerSession: async () => ({
      ...(officer as object),
      displayName: "Test Officer",
      jurisdictionName,
    }),
  }));
  try {
    const mod = await import("@/app/(oversight)/page");
    const tree = await (mod.default as () => Promise<unknown>)();
    return renderToStaticMarkup(createElement(Fragment, null, tree as never));
  } finally {
    vi.doUnmock("@/lib/auth");
    vi.resetModules();
  }
}

/**
 * Blank the fixture's ONE establishment for the duration, so every tier's panel takes the AC-16
 * absence branch and its tier noun is observable. Both columns go NULL together, which is the only
 * state the ETL permits (STAFFING-PTR-DOMAIN-RULING AC-11: NULL iff NULL), and both are restored in
 * `finally` to their seeded values — the staffing ROW is never deleted, so no global count moves.
 */
async function withNoEstablishment(body: () => Promise<void>): Promise<void> {
  await owner`
    update fact_staffing set teaching_posts_established = null, vacancies = null
     where jurisdiction_id = ${SEED.publicSchool}::uuid and period_id = ${PERIOD_ID_ANNUAL}::uuid
  `;
  try {
    await body();
  } finally {
    await owner`
      update fact_staffing
         set teaching_posts_established = ${SEED.posts}, vacancies = ${SEED.vacancies}
       where jurisdiction_id = ${SEED.publicSchool}::uuid and period_id = ${PERIOD_ID_ANNUAL}::uuid
    `;
  }
}

describe("the absence sentence names a TIER at every tier the panel mounts at (ACs 13, 16)", () => {
  it("the probe is sound: blanking the one establishment makes every tier unavailable, and it restores", async () => {
    await withNoEstablishment(async () => {
      for (const scope of [districtScope, regionScope, nationalScope]) {
        expect(teacherEstablishmentOf(await readBreakdown(scope))).toBeNull();
      }
    });
    // Restored — the next test, and every later file, sees the seeded figures again.
    const est = teacherEstablishmentOf(await readBreakdown(districtScope))!;
    expect(est.postsEstablished).toBe(SEED.posts);
    expect(est.net).toBe(SEED.vacancies);
  });

  for (const [tier, officer, name, noun] of [
    ["national", nationalOfficer, "National · Ministry of Education", "country"],
    ["region", regionOfficer, "Western Region", "region"],
    ["district", districtOfficer, "Wassa Amenfi West", "district"],
  ] as const) {
    it(`${tier}: the panel says "No GES establishment in this ${noun}"`, async () => {
      await withNoEstablishment(async () => {
        const text = textOf(await renderPageAs(officer, name));
        // The panel mounts at this tier at all (AC-13, tier-polymorphic) …
        expect(text).toContain("GES-authorised posts");
        // … and its absence sentence names the officer's TIER, as a NOUN. `tierAdjective` is an
        // ADJECTIVE ("Regional"), so a page that lowercases it emits "in this regional", which is not
        // a tier and not a sentence.
        expect(text).toContain(`No GES establishment in this ${noun}`);
        expect(text).not.toMatch(/No GES establishment in this (regional|national|school)\b/);
        // …and the rest of the page is standing: the panel is fail-soft, not fatal (AC-13).
        expect(text).toContain("Pupil-teacher ratio");
      });
    });
  }

  it("the page derives the noun from a NOUN source, not from the tier ADJECTIVE", () => {
    // The static half: `tierChrome(...).tierAdjective` is "Regional"/"District"/"National" — an
    // adjective by name and by value. Lowercasing it does not make it a tier noun.
    expect(tierChrome("REGION", "Western Region").tierAdjective).toBe("Regional");
    const page = readSource("app/(oversight)/page.tsx");
    expect(
      page,
      "page.tsx lowercases the tier ADJECTIVE into the panel's tier-noun slot",
    ).not.toMatch(/tierNoun=\{[^}]*tierAdjective\.toLowerCase\(\)/);
  });
});

/** Comments stripped, strings kept — the auth-boundaries idiom, since the patterns live in SQL. */
function readSource(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line) && !/^\s*--/.test(line))
    .join("\n");
}
