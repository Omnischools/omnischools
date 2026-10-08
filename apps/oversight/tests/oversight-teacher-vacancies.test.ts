import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { scopeFor, type JurisdictionScope } from "@/lib/db/rls";
import { unavailable, isOk, type Reading } from "@/lib/oversight/reading";
import {
  childLevelFor,
  getChildBreakdown,
  spreadOf,
  teacherEstablishmentOf,
  type BreakdownRow,
  type ChildBreakdown,
} from "@/lib/oversight/breakdown";
import {
  buildComparison,
  comparisonMetrics,
  weightedBenchmark,
} from "@/lib/oversight/comparison";
import { BreakdownTable } from "@/components/oversight/breakdown-table";
import { BreakdownSection } from "@/components/oversight/breakdown-section";
import {
  TeacherEstablishmentPanel,
  VACANCY_AXIS,
} from "@/components/oversight/breakdown-visuals";
import { ComparisonTable } from "@/components/oversight/comparison-table";
import { breakdownChrome } from "@/components/oversight/tier-chrome";
import {
  JUR,
  OFFICER,
  PERIOD_ID_ANNUAL,
  PERIOD_ID_EXAM_COHORT,
  PERIOD_ID_TERM,
} from "./fixtures/ids";
import { adminAnalytics, districtOfficer, nationalOfficer, officerFixture } from "./helpers";

/**
 * INCREMENT J · TEACHER-VACANCY SURFACING — the QA gate for VACANCY-SURFACING-RULING ACs 1–22.
 *
 * The slice is PRESENTATION ONLY: `fact_staffing.teaching_posts_established` and the SIGNED `vacancies`
 * already exist (STAFFING-PTR-DOMAIN-RULING §4, proved by tests/etl-staffing-establishment.test.ts).
 * What is new, and what every assertion below is about, is the five honesty properties that a reviewer
 * cannot see by reading the SQL:
 *
 *  1. THE PUBLIC-ONLY DENOMINATOR (ACs 1–3). Establishment and vacancies are NULL for PRIVATE/MISSION
 *     schools, so every sum is over `teaching_posts_established IS NOT NULL` and those schools are
 *     VISIBLY EXCLUDED — never zero'd into the denominator, never a false "0 unfilled".
 *  2. NET CANCELLATION IS BANNED (ACs 4–6). Ghana's distribution is shortage in the rural north and
 *     surplus in the urban south, so a lone net Σ(vacancies) at tier grain can read "balanced" over a
 *     country that is not. The surfaces present the two GROSS magnitudes; the net is subordinate and
 *     labelled; shortage − surplus == net is checked as arithmetic, never as a floored read.
 *  3. THE DISPERSION IS WEIGHTED (ACs 7–9). The spread's mean is the tier total's OWN vacancy rate, not
 *     the unweighted mean of child rates, and the caption names no geography.
 *  4. UNAVAILABLE ≠ ZERO (ACs 16–18). A tier with no public-establishment school is absent; a tier whose
 *     shortage and surplus cancel to a real 0 is "balanced" and must render the decomposition.
 *  5. RLS IS THE ONLY CEILING (ACs 20–21). No read here writes a jurisdiction WHERE of its own, matching
 *     the ptr.ts / enrolment.ts precedent, and a district officer's figures are their own subtree's.
 *
 * Every database assertion runs through `withJurisdiction()` as the NON-OWNER `ov_app` role, so each is
 * also an RLS assertion. Rows planted by a test are removed by that test, narrowly, so the analytics
 * seed is left exactly as found (`fileParallelism: false`; tests/rls-tier-matrix.test.ts counts globally).
 */

// ── the shared fixture's arithmetic, in one place ────────────────────────────────────────────────
const F = {
  /** Asankrangwa SHS (…011), PUBLIC, in Wassa Amenfi West (…003): 38 posts established, 41 teachers. */
  wassaPosts: 38,
  wassaTeachers: 41,
  /** …so its SIGNED vacancies is −3: a SURPLUS of 3 teachers over establishment (never floored to 0). */
  wassaVacancies: -3,
  /** The school in Sekondi-Takoradi Metro (…004) is PRIVATE-shaped: NULL establishment, NULL vacancies. */
  sekondiPosts: null,
} as const;

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

let owner: postgres.Sql;

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

function named(breakdown: ChildBreakdown, name: string): BreakdownRow {
  const row = breakdown.children.find((r) => r.name === name);
  expect(row, `no child row named "${name}"`).toBeDefined();
  return row!;
}

function allRows(breakdown: ChildBreakdown): BreakdownRow[] {
  return breakdown.unattributed === null
    ? breakdown.children
    : [...breakdown.children, breakdown.unattributed];
}

const ROOT = process.cwd();

/** Comments stripped, strings kept — the auth-boundaries idiom, since the patterns live in SQL. */
function readCode(file: string): string {
  return readFileSync(join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line) && !/^\s*--/.test(line))
    .join("\n");
}

function stripTags(markup: string): string {
  // Char-scan rather than a `<…>`-matching regex (CodeQL js/bad-tag-filter, CWE-116) — the
  // oversight-ptr.test.ts idiom, copied so the two render suites read text the same way.
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

const CHROME = breakdownChrome("REGION", "Western Region");

/**
 * The panel takes a RESOLVED `ChildBreakdown`, not a `Reading` (Dex N1): the unread case belongs to
 * `BreakdownSection`'s one amber banner, which is asserted below through the section itself.
 */
function panelMarkup(breakdown: ChildBreakdown, tierNoun = "region"): string {
  return renderToStaticMarkup(
    createElement(TeacherEstablishmentPanel, { breakdown, chrome: CHROME, tierNoun }),
  );
}

function tableMarkup(breakdown: ChildBreakdown, chrome = CHROME): string {
  return renderToStaticMarkup(
    createElement(BreakdownTable, { breakdown, chrome, homeId: null }),
  );
}

/**
 * Plant SCHOOL nodes and their staffing rows, run the body, then remove exactly those rows.
 *
 * Every delete is keyed on the planted `jurisdiction_id`s only — never a broad `where period_id = …`,
 * which would take the analytics seed's own rows (and the global counts tests/rls-tier-matrix.test.ts
 * asserts) with it.
 */
async function withSchools(
  schools: {
    id: string;
    name: string;
    parent: string;
    periodId?: string;
    teachers: number;
    posts: number | null;
    enrolment?: number;
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
    await owner`
      insert into dim_jurisdiction (jurisdiction_id, level, parent_id, name, school_type, ownership_type, is_reporting)
      values (${s.id}::uuid, 'SCHOOL', ${s.parent}::uuid, ${s.name}, 'JHS',
              ${s.posts === null ? "PRIVATE" : "PUBLIC"}, true)
    `;
    const enrolment = s.enrolment ?? s.teachers * 20;
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
// (1) THE PUBLIC-ONLY DENOMINATOR — ACs 1, 2, 3
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("every vacancy figure sums PUBLIC-establishment rows only (ACs 1–3)", () => {
  it("the fixture is the right shape: one public row with an establishment, one private row without", async () => {
    // If this stops holding, every public-only assertion below degenerates.
    const b = await readBreakdown(regionScope);
    const wassa = named(b, "Wassa Amenfi West");
    const sekondi = named(b, "Sekondi-Takoradi Metro");
    expect(wassa.postsEstablished).toBe(F.wassaPosts);
    expect(wassa.vacancyNet).toBe(F.wassaVacancies);
    expect(wassa.schoolsWithEstablishment).toBe(1);
    // The private-shaped child has a STAFFING row (so its PTR is real) and NO establishment figure.
    expect(sekondi.ptr).not.toBeNull();
    expect(sekondi.postsEstablished).toBe(F.sekondiPosts);
    expect(sekondi.vacancyNet).toBeNull();
    expect(sekondi.schoolsWithEstablishment).toBeNull();
  });

  it("the tier total is over public rows ONLY — adding private/mission schools changes nothing (AC-1)", async () => {
    const before = teacherEstablishmentOf(await readBreakdown(regionScope));
    expect(before).not.toBeNull();
    await withSchools(
      [
        // Two more PRIVATE-shaped schools, one per district, each with a real staffing row and a NULL
        // establishment. AC-1 in its exact form: the tier figures must be identical with and without them.
        { id: "10000000-0000-4000-8000-0000000000e1", name: "Vac Private A", parent: JUR.district, teachers: 9, posts: null },
        { id: "10000000-0000-4000-8000-0000000000e2", name: "Vac Mission B", parent: JUR.otherDistrict, teachers: 7, posts: null },
      ],
      async () => {
        const after = await readBreakdown(regionScope);
        expect(teacherEstablishmentOf(after)).toEqual(before);
        // …and they are VISIBLY there, so this is not "the rows were never read" (their PTR moved).
        expect(after.total.teachers).toBeGreaterThan(F.wassaTeachers);
      },
    );
  });

  it("the stated denominator is the PUBLIC-establishment school count, not the PTR/enrolment one (AC-2)", async () => {
    const b = await readBreakdown(regionScope);
    const est = teacherEstablishmentOf(b)!;
    // Two schools file staffing (the PTR population); exactly ONE has a GES establishment.
    const staffingSchools = await asOfficer(regionScope, async (tx) => {
      const rows = (await tx`
        select count(distinct jurisdiction_id)::int as n
          from fact_staffing where period_id = ${PERIOD_ID_ANNUAL}::uuid
      `) as unknown as { n: number }[];
      return rows[0]!.n;
    });
    expect(staffingSchools).toBe(2);
    expect(est.schoolsWithEstablishment).toBe(1);
    // The panel STATES it, verbatim, with the exclusion named (Kofi V5).
    const text = textOf(panelMarkup(b));
    expect(text).toContain("Across 1 public school with a GES establishment");
    expect(text).toContain("private and mission schools are excluded");
  });

  it("an all-private child renders the em-dash titled 'No GES establishment', never a 0 (AC-3)", async () => {
    const b = await readBreakdown(regionScope);
    const markup = tableMarkup(b);
    const sekondiRow = /Sekondi-Takoradi Metro([\s\S]*?)<\/tr>/.exec(markup)?.[1] ?? "";
    expect(sekondiRow).toContain('title="No GES establishment"');
    // The two defects: a fabricated zero, and the wrong absence affordance (the generic "no return").
    expect(sekondiRow).not.toContain("0 unfilled");
    expect(sekondiRow).not.toContain("balanced");
    // The public child's own cell is beside it, so this is not "the column failed to render".
    const wassaRow = /Wassa Amenfi West([\s\S]*?)<\/tr>/.exec(markup)?.[1] ?? "";
    expect(wassaRow).toContain("3 over");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (2) NET CANCELLATION IS BANNED — ACs 4, 5, 6
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the two-sided decomposition, never a lone net (ACs 4–6)", () => {
  /** A tier with BOTH a net-shortage child and a net-surplus child — Ghana's real shape, in miniature. */
  const SHORT = {
    id: "10000000-0000-4000-8000-0000000000e3",
    name: "Vac Northern-shaped JHS",
    parent: JUR.otherDistrict,
    teachers: 38,
    posts: 50,
  };

  it("shortage and surplus are DISTINCT non-zero magnitudes, and net == shortage − surplus (ACs 5, 6)", async () => {
    await withSchools([SHORT], async () => {
      const b = await readBreakdown(regionScope);
      const est = teacherEstablishmentOf(b)!;
      // +12 unfilled in one district, 3 over establishment in the other. A lone net would print 9 and
      // hide both; the read carries the two magnitudes separately.
      expect(est.shortage).toBe(12);
      expect(est.surplus).toBe(3);
      expect(est.shortage).toBeGreaterThan(0);
      expect(est.surplus).toBeGreaterThan(0);
      expect(est.net).toBe(est.shortage - est.surplus);
      expect(est.net).toBe(9);
      // The decomposition is the SIGNED column split by sign at school grain — never floored in the
      // read. The proof: Σ of the two magnitudes is Σ|vacancies|, which is 15 and not |net| = 9.
      expect(est.shortage + est.surplus).toBe(15);
      expect(est.postsEstablished).toBe(F.wassaPosts + SHORT.posts);
      // Each child keeps its own sign — the children ARE the split the net cancels (Kofi V9).
      expect(named(b, "Wassa Amenfi West").vacancyNet).toBe(-3);
      expect(named(b, "Sekondi-Takoradi Metro").vacancyNet).toBe(12);
    });
  });

  it("the panel shows both magnitudes BESIDE the net, and the net is labelled 'net' (AC-4)", async () => {
    await withSchools([SHORT], async () => {
      const text = textOf(panelMarkup(await readBreakdown(regionScope)));
      // Both gross magnitudes, each with its word.
      expect(text).toContain("Shortage");
      expect(text).toContain("12");
      expect(text).toContain("posts unfilled against establishment");
      expect(text).toContain("Surplus");
      expect(text).toContain("teachers over establishment");
      // The net, LABELLED, and never alone: the word "Net" precedes it.
      expect(text).toMatch(/Net\s+9 posts unfilled/);
    });
  });

  it("the breakdown TOTAL cell shows the net and defers the decomposition to the panel (AC-14)", async () => {
    await withSchools([SHORT], async () => {
      const markup = tableMarkup(await readBreakdown(regionScope));
      const totalRow = /bg-gold-bg([\s\S]*?)<\/tr>/.exec(markup)?.[1] ?? "";
      expect(totalRow).toContain("+9 unfilled");
      // Its title carries the gross split and points at the honesty anchor — the total cell is not it.
      expect(totalRow).toContain("12 posts unfilled");
      expect(totalRow).toContain("3 teachers over establishment");
      expect(totalRow).toContain("see the Teacher establishment panel");
    });
  });

  it("no surface computes a net by summing the signed column — it is derived from the two magnitudes (AC-6)", () => {
    const code = readCode("lib/oversight/breakdown.ts");
    // The two gross magnitudes ARE summed, from the signed column, split per school.
    expect(code).toMatch(/greatest\(fs\.vacancies, 0\)/);
    expect(code).toMatch(/greatest\(-fs\.vacancies, 0\)/);
    // What must NOT exist: a lone Σ of the signed column, which is the banned tier net.
    expect(code).not.toMatch(/sum\(\s*fs\.vacancies/);
    expect(code).not.toMatch(/sum\(vacancies\)/);
    // …and no floor anywhere in the read: `max(0, …)`/`abs()` would erase the surplus half.
    expect(code).not.toMatch(/abs\(\s*fs\.vacancies/);
    // The net on the row is shortage − surplus, in TS.
    expect(code).toMatch(/fact\.vacancyShortage - fact\.vacancySurplus/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (3) THE DISPERSION VIEW — ACs 7, 8, 9
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the vacancy-rate spread is weighted, guarded and geography-free (ACs 7–9)", () => {
  const SHORT = {
    id: "10000000-0000-4000-8000-0000000000e4",
    name: "Vac Shortage JHS",
    parent: JUR.otherDistrict,
    teachers: 38,
    posts: 50,
  };

  it("per-child rate is Σvacancies ÷ Σestablished and the mean is the TIER's own rate, not the children's (AC-7)", async () => {
    await withSchools([SHORT], async () => {
      const b = await readBreakdown(regionScope);
      const spread = spreadOf(b, (r) => r.vacancyRate)!;
      expect(spread).not.toBeNull();
      // −3/38 and +12/50 — each a Σ÷Σ over the child's public rows.
      expect(named(b, "Wassa Amenfi West").vacancyRate).toBeCloseTo(-3 / 38, 10);
      expect(named(b, "Sekondi-Takoradi Metro").vacancyRate).toBeCloseTo(12 / 50, 10);
      expect(spread.min).toBeCloseTo(-3 / 38, 10);
      expect(spread.max).toBeCloseTo(12 / 50, 10);
      // THE WEIGHTED MEAN: 9 ÷ 88, NOT the unweighted mean of the two child rates.
      const weighted = 9 / 88;
      const unweighted = (-3 / 38 + 12 / 50) / 2;
      expect(spread.mean).toBeCloseTo(weighted, 10);
      expect(Math.abs(weighted - unweighted)).toBeGreaterThan(0.01);
      expect(spread.mean).not.toBeCloseTo(unweighted, 4);
      // AC-9, the cross-module commitment: the spread's mean IS the panel's net over the panel's
      // establishment, and the breakdown total row's own rate.
      const est = teacherEstablishmentOf(b)!;
      expect(est.vacancyRate).toBeCloseTo(spread.mean!, 10);
      expect(b.total.vacancyRate).toBeCloseTo(spread.mean!, 10);
      expect(est.net).toBe(b.total.vacancyNet);
    });
  });

  it("the bar renders only with ≥2 children carrying a rate (AC-8)", async () => {
    // The shared fixture has exactly ONE child with an establishment, so there is no spread to draw…
    const one = await readBreakdown(regionScope);
    expect(spreadOf(one, (r) => r.vacancyRate)).toBeNull();
    const oneText = textOf(panelMarkup(one));
    expect(oneText).not.toContain("Vacancy rate");
    expect(oneText).not.toContain("-point spread");
    // …but the two magnitudes and the net still render: the missing bar degrades ONE element.
    expect(oneText).toContain("Surplus");
    expect(oneText).toMatch(/Net\s+3 teachers over establishment/);
    // …and with a second rate-carrying child it appears.
    await withSchools([SHORT], async () => {
      const twoText = textOf(panelMarkup(await readBreakdown(regionScope)));
      expect(twoText).toContain("Vacancy rate");
      expect(twoText).toContain("-point spread");
    });
  });

  it("the spread caption states only the magnitude and names NO geography (AC-8)", async () => {
    await withSchools([SHORT], async () => {
      const text = textOf(panelMarkup(await readBreakdown(regionScope)));
      // (12/50) − (−3/38) = 0.3189… → 31.9 points.
      expect(text).toContain("31.9-point spread");
      for (const forbidden of ["northern", "north", "greater accra", "rural", "urban"]) {
        expect(text.toLowerCase(), `caption names geography: ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    });
  });

  it("the bar's dots are navy at the surplus end and terra at the shortage end — never green", async () => {
    await withSchools([SHORT], async () => {
      const markup = panelMarkup(await readBreakdown(regionScope));
      const bar = markup.slice(markup.indexOf("Vacancy rate"));
      // Kofi V6/V8: a green dot at the surplus end would read "too many teachers here while the north
      // is short" as success. The surplus end is NEUTRAL navy; terra marks the adverse shortage end.
      expect(bar).toContain("bg-terra");
      expect(bar).not.toMatch(/rounded-full[^>]*bg-green/);
      const dotPos = (cls: string) => {
        const m = new RegExp(`${cls}"[^>]*?left:\\s*([\\d.]+)%`).exec(bar);
        expect(m, `no dot with class ${cls}`).not.toBeNull();
        return Number(m![1]);
      };
      // The surplus (low/navy) end sits LEFT of the shortage (high/terra) end on the signed axis.
      expect(dotPos("bg-navy")).toBeLessThan(dotPos("bg-terra"));
    });
  });

  it("VACANCY_AXIS is stated, symmetric about zero, and contains the seeded range — never clamps", async () => {
    expect(VACANCY_AXIS).toEqual({ lo: -0.4, hi: 0.4 });
    // Zero ("at establishment") is mid-track, which is what makes a diverging bar readable.
    expect(VACANCY_AXIS.lo + VACANCY_AXIS.hi).toBe(0);
    // `establishmentFactor` draws the multiplier from [0.85, 1.20] of the roll, so a school's rate is
    // within about ±0.18 — well inside the axis, so nothing in the demo clamps.
    await withSchools([SHORT], async () => {
      const b = await readBreakdown(regionScope);
      for (const row of [...allRows(b), b.total]) {
        if (row.vacancyRate === null) continue;
        expect(row.vacancyRate).toBeGreaterThan(VACANCY_AXIS.lo);
        expect(row.vacancyRate).toBeLessThan(VACANCY_AXIS.hi);
      }
    });
  });

  it("a rate OUTSIDE the axis fails LOUD — the bar is withheld with a reason, never silently clamped", () => {
    // The one thing a spread surface must never do is under-draw a gap its caption quotes. So an
    // out-of-axis value withholds the bar and says why, rather than pinning a dot to the rail.
    const text = textOf(
      panelMarkup({
        childLevel: "DISTRICT",
        hasCoverage: true,
        unattributed: null,
        children: [
          blankRow({ childId: "a", name: "A", postsEstablished: 10, vacancyShortage: 9, vacancySurplus: 0, vacancyNet: 9, vacancyRate: 0.9, schoolsWithEstablishment: 1 }),
          blankRow({ childId: "b", name: "B", postsEstablished: 10, vacancyShortage: 0, vacancySurplus: 1, vacancyNet: -1, vacancyRate: -0.1, schoolsWithEstablishment: 1 }),
        ],
        total: blankRow({ postsEstablished: 20, vacancyShortage: 9, vacancySurplus: 1, vacancyNet: 8, vacancyRate: 0.4, schoolsWithEstablishment: 2 }),
      }),
    );
    expect(text).toContain("spread is not drawn");
    expect(text).toContain("Widen VACANCY_AXIS");
    // The rest of the panel still stands — the magnitudes are not withheld with the bar.
    expect(text).toContain("Shortage");
    expect(text).toContain("Surplus");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (4) SIGN / LABEL CONVENTION — ACs 10, 11, 18
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("a number is never shown without a word, and a surplus is never green (ACs 10, 11)", () => {
  const rows: ChildBreakdown = {
    childLevel: "DISTRICT",
    hasCoverage: true,
    unattributed: null,
    children: [
      blankRow({ childId: "s", name: "Short District", postsEstablished: 100, vacancyShortage: 14, vacancySurplus: 0, vacancyNet: 14, vacancyRate: 0.14, schoolsWithEstablishment: 2 }),
      blankRow({ childId: "o", name: "Over District", postsEstablished: 100, vacancyShortage: 0, vacancySurplus: 6, vacancyNet: -6, vacancyRate: -0.06, schoolsWithEstablishment: 2 }),
      blankRow({ childId: "b", name: "Balanced District", postsEstablished: 100, vacancyShortage: 5, vacancySurplus: 5, vacancyNet: 0, vacancyRate: 0, schoolsWithEstablishment: 2 }),
      blankRow({ childId: "n", name: "No Establishment District" }),
    ],
    total: blankRow({ postsEstablished: 300, vacancyShortage: 19, vacancySurplus: 11, vacancyNet: 8, vacancyRate: 8 / 300, schoolsWithEstablishment: 6 }),
  };

  it("positive is terra and worded, negative is navy and worded, a real 0 is 'balanced' (AC-10)", () => {
    const markup = tableMarkup(rows);
    const cell = (name: string) => new RegExp(`${name}([\\s\\S]*?)</tr>`).exec(markup)?.[1] ?? "";
    expect(cell("Short District")).toContain("+14 unfilled");
    expect(cell("Short District")).toContain("text-terra");
    expect(cell("Over District")).toContain("6 over");
    expect(cell("Over District")).toContain("text-navy");
    // THE TONE RULE, as a prohibition: a surplus must never be tinted green ("good").
    expect(cell("Over District")).not.toContain("text-green");
    expect(cell("Balanced District")).toContain("balanced");
    expect(cell("No Establishment District")).toContain('title="No GES establishment"');
  });

  it("no vacancy cell is a bare signed integer (AC-11)", () => {
    const text = textOf(tableMarkup(rows));
    // Every vacancy figure in the rendered text carries one of the three words.
    for (const [value, word] of [
      ["14", "unfilled"],
      ["6", "over"],
    ] as const) {
      const re = new RegExp(`${value}\\s+${word}`);
      expect(text, `"${value}" appears without "${word}"`).toMatch(re);
    }
    // The bare forms a careless formatter would print: a magnitude NOT followed by its word, and the
    // signed integer a `formatCount` of the raw column would have produced for the surplus side.
    expect(text).not.toMatch(/\+14(?!\s+unfilled)/);
    expect(text).not.toMatch(/-6\b/);
    expect(text).not.toMatch(/\+8(?!\s+unfilled)/);
  });

  it("the panel's wording follows the same three-way convention (AC-10)", () => {
    const shortText = textOf(panelMarkup(rows));
    expect(shortText).toMatch(/Net\s+8 posts unfilled/);
    const balanced: ChildBreakdown = {
      ...rows,
      total: blankRow({ postsEstablished: 100, vacancyShortage: 7, vacancySurplus: 7, vacancyNet: 0, vacancyRate: 0, schoolsWithEstablishment: 4 }),
    };
    const balancedText = textOf(panelMarkup(balanced));
    expect(balancedText).toContain("at establishment");
    expect(balancedText).toContain("balanced");
  });

  it("the stored per-school `vacancies` column is never summed into a lone tier net (AC-18)", () => {
    for (const file of ["lib/oversight/breakdown.ts", "lib/oversight/ptr.ts"]) {
      const code = readCode(file);
      expect(code, file).not.toMatch(/sum\(\s*fs\.vacancies/);
      expect(code, file).not.toMatch(/avg\(\s*fs\.vacancies/);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (5) UNAVAILABLE ≠ ZERO — ACs 16, 17
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("absence is absence; a cancelled zero is a measurement (ACs 16, 17)", () => {
  const PERIOD = "20000000-0000-4000-8000-0000000000f1";

  it("a tier whose schools all lack an establishment is UNAVAILABLE, never '0 unfilled' (AC-16)", async () => {
    // A period on which the district's ONLY staffing row is private-shaped: staffing rows EXIST (so
    // this is not the "no rows at all" branch) and not one carries an establishment. That is the branch
    // a `coalesce(sum(vacancies), 0)` anywhere upstream would have printed as "0 unfilled / fully staffed".
    await withSchools(
      [
        {
          id: "10000000-0000-4000-8000-0000000000f2",
          name: "Vac All-Private JHS",
          parent: JUR.district,
          periodId: PERIOD,
          teachers: 11,
          posts: null,
        },
      ],
      async () => {
        const b = await readBreakdown(districtScope, { annualPeriodId: PERIOD });
        // The staffing row is read (PTR is real) …
        expect(b.total.ptr).not.toBeNull();
        // … and the establishment reading is ABSENT, with its two-state gate reporting it.
        expect(b.total.schoolsWithEstablishment).toBeNull();
        expect(b.total.postsEstablished).toBeNull();
        expect(b.total.vacancyNet).toBeNull();
        expect(b.total.vacancyNet).not.toBe(0);
        expect(teacherEstablishmentOf(b)).toBeNull();
        // The panel says so, in the tier's own words, and the rest of the page is unaffected.
        const text = textOf(panelMarkup(b, "district"));
        expect(text).toContain("No GES establishment in this district");
        expect(text).toContain("private and mission schools carry none");
        expect(text).not.toContain("0 posts unfilled");
        expect(text).not.toContain("fully staffed");
        // …and the table cell is the em-dash, never a 0.
        const markup = tableMarkup(b, breakdownChrome("DISTRICT", "Wassa Amenfi West"));
        expect(markup).toContain('title="No GES establishment"');
      },
      { id: PERIOD, academicYear: "2018/19" },
    );
  });

  it("a TRUE net-zero renders the decomposition and the word 'balanced', not 'unavailable' (AC-17)", async () => {
    const PERIOD_B = "20000000-0000-4000-8000-0000000000f3";
    await withSchools(
      [
        // +3 unfilled in one district, 3 over establishment in the other: net 0, both magnitudes real.
        { id: "10000000-0000-4000-8000-0000000000f4", name: "Vac Zero A", parent: JUR.district, periodId: PERIOD_B, teachers: 17, posts: 20 },
        { id: "10000000-0000-4000-8000-0000000000f5", name: "Vac Zero B", parent: JUR.otherDistrict, periodId: PERIOD_B, teachers: 23, posts: 20 },
      ],
      async () => {
        const b = await readBreakdown(regionScope, { annualPeriodId: PERIOD_B });
        const est = teacherEstablishmentOf(b);
        // NOT unavailable: there is a real public denominator behind the zero.
        expect(est).not.toBeNull();
        expect(est!.schoolsWithEstablishment).toBe(2);
        expect(est!.net).toBe(0);
        expect(est!.shortage).toBe(3);
        expect(est!.surplus).toBe(3);
        const text = textOf(panelMarkup(b));
        // The decomposition is rendered, and the zero is explained rather than printed bare.
        expect(text).toContain("Across 2 public schools with a GES establishment");
        expect(text).toContain("at establishment");
        expect(text).toContain("3 posts unfilled offset by 3 over establishment");
        expect(text).not.toContain("No GES establishment in this");
      },
      { id: PERIOD_B, academicYear: "2017/18" },
    );
  });

  it("a period with no staffing rows at all is also absent, not zero", async () => {
    const b = await readBreakdown(nationalScope, { annualPeriodId: PERIOD_ID_EXAM_COHORT });
    expect(b.total.schoolsWithEstablishment).toBeNull();
    expect(teacherEstablishmentOf(b)).toBeNull();
    // …and on the TERM period, the ANNUAL-pin decoy (fact_staffing is an ANNUAL stock).
    const term = await readBreakdown(nationalScope, { annualPeriodId: PERIOD_ID_TERM });
    expect(teacherEstablishmentOf(term)).toBeNull();
  });

  it("an unreadable roll-up is reported ONCE, by the section, not twice (AC-13)", () => {
    // The panel mounts inside `BreakdownSection` (Dex N1), so the section's single amber banner owns
    // the unread case: the panel takes a resolved breakdown and cannot stack a second "could not be
    // read" note above it. The fail-soft behaviour is unchanged — one statement instead of two.
    const text = textOf(
      renderToStaticMarkup(
        createElement(BreakdownSection, {
          level: "REGION",
          jurisdictionName: "Western Region",
          homeId: null,
          breakdown: unavailable<ChildBreakdown>(),
          termLabel: null,
          sittingLabel: null,
        }),
      ),
    );
    expect(text).toContain("could not be read");
    expect(text).toContain("headline figures above are unaffected");
    // EXACTLY ONE report of the absence — the double-reporting Dex N1 names.
    expect(text.match(/could not be read/g)!).toHaveLength(1);
    // The panel does not render its own absence note in this state at all.
    expect(text).not.toContain("GES-authorised posts");
    // No figure is invented in the failure state.
    expect(text).not.toMatch(/\d/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (6) RECONCILIATION AND THE CROSS-MODULE COMMITMENT — ACs 9, 11 (V11)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("Σchildren + unattributed = total, on each establishment component", () => {
  for (const [name, scope] of [
    ["district", districtScope],
    ["region", regionScope],
    ["national", nationalScope],
  ] as const) {
    it(`${name}: the three public-only sums reconcile`, async () => {
      const b = await readBreakdown(scope);
      const sum = (pick: (r: BreakdownRow) => number | null) =>
        allRows(b).reduce((acc, r) => acc + (pick(r) ?? 0), 0);
      expect(sum((r) => r.postsEstablished)).toBe(b.total.postsEstablished ?? 0);
      expect(sum((r) => r.vacancyShortage)).toBe(b.total.vacancyShortage ?? 0);
      expect(sum((r) => r.vacancySurplus)).toBe(b.total.vacancySurplus ?? 0);
    });
  }

  it("the guard ANDs the new sums into `reconciles`, not computes and drops them", () => {
    const code = readCode("lib/oversight/breakdown.ts");
    const guard = code.slice(code.indexOf("const reconciles ="));
    for (const field of ["postsEstablished", "vacancyShortage", "vacancySurplus"]) {
      expect(guard.slice(0, 1400)).toContain(`sumOf((r) => r.${field})`);
    }
  });

  it("a mis-parented school's establishment lands in the unattributed bucket, never on a sibling (AC-21)", async () => {
    await withSchools(
      [
        {
          id: "10000000-0000-4000-8000-0000000000f6",
          name: "Vac Mis-parented JHS",
          parent: JUR.region, // a SCHOOL hung straight off a REGION — the level-pin's reason to exist
          teachers: 20,
          posts: 26,
        },
      ],
      async () => {
        const b = await readBreakdown(regionScope);
        expect(b.unattributed).not.toBeNull();
        expect(b.unattributed!.vacancyNet).toBe(6);
        // No child absorbed it, and no sibling's name carries its figure.
        expect(named(b, "Wassa Amenfi West").vacancyNet).toBe(F.wassaVacancies);
        expect(b.children.some((r) => r.name === "Vac Mis-parented JHS")).toBe(false);
        // The TOTAL includes it, so the rendered rows still add up to the panel's figures.
        const est = teacherEstablishmentOf(b)!;
        expect(est.shortage).toBe(6);
        expect(est.surplus).toBe(3);
        expect(est.net).toBe(3);
      },
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (7) RLS IS THE ONLY CEILING — ACs 20, 21, 22
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** A raw read with the GUCs `withJurisdiction()` would set, as the NON-OWNER APP role. Rolled back. */
async function asOfficer<T>(
  scope: JurisdictionScope,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const { testDbConfig } = await import("./helpers");
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

describe("the subtree bound is RLS's, and the figures are each officer's own (ACs 20–22)", () => {
  it("a DISTRICT officer's figures are their district's; a REGION/NATIONAL officer's are theirs (AC-20)", async () => {
    await withSchools(
      [
        // A shortage school in the SIBLING district. The district officer must not see a trace of it.
        {
          id: "10000000-0000-4000-8000-0000000000f7",
          name: "Vac Sibling Shortage JHS",
          parent: JUR.otherDistrict,
          teachers: 30,
          posts: 47,
        },
      ],
      async () => {
        const district = teacherEstablishmentOf(await readBreakdown(districtScope))!;
        const region = teacherEstablishmentOf(await readBreakdown(regionScope))!;
        const national = teacherEstablishmentOf(await readBreakdown(nationalScope))!;
        // The district sees ONLY its own public school: the surplus of 3, and no shortage at all.
        expect(district.schoolsWithEstablishment).toBe(1);
        expect(district.surplus).toBe(3);
        expect(district.shortage).toBe(0);
        expect(district.postsEstablished).toBe(F.wassaPosts);
        // A leak would be identifiable BY VALUE — the sibling's 17 unfilled, or the region's net.
        expect(district.shortage).not.toBe(17);
        expect(district.net).not.toBe(region.net);
        // The region sees both; the national officer sees the same two in this fixture.
        expect(region.shortage).toBe(17);
        expect(region.surplus).toBe(3);
        expect(region.net).toBe(14);
        expect(national).toEqual(region);
        // …and no sibling NAME reaches the district officer's children.
        const names = (await readBreakdown(districtScope)).children.map((r) => r.name);
        expect(names).not.toContain("Vac Sibling Shortage JHS");
        expect(names).not.toContain("Sekondi-Takoradi Metro");
      },
    );
  });

  it("the read writes NO jurisdiction ceiling of its own (AC-20, the static check)", () => {
    const code = readCode("lib/oversight/breakdown.ts");
    // The ESTABLISHMENT arm's ONLY predicates are the period pin and the public-only establishment
    // filter. A `jurisdiction_id = …` of its own would be a second, hand-written copy of the ceiling —
    // the prohibition `lib/oversight/ptr.ts` and `lib/oversight/enrolment.ts` state.
    const arm = code.slice(
      code.indexOf("'ESTABLISHMENT'::text"),
      code.indexOf("attributed as ("),
    );
    expect(arm).toContain("teaching_posts_established is not null");
    expect(arm).not.toMatch(/jurisdiction_id\s*=/);
    expect(code).not.toContain("scope.jurisdictionId");
  });

  it("two reads of byte-identical data give byte-identical figures — no now(), deterministic (AC-22)", async () => {
    const first = teacherEstablishmentOf(await readBreakdown(regionScope));
    const second = teacherEstablishmentOf(await readBreakdown(regionScope));
    expect(second).toEqual(first);
    const code = readCode("lib/oversight/breakdown.ts");
    expect(code).not.toMatch(/\bnow\(\)/);
    expect(code).not.toMatch(/current_date/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (8) THE SURFACES — ACs 12, 13, 14, 15, 19
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the column sits after PTR and spans every row (AC-14)", () => {
  it("the empty-state colSpan still spans EVERY column, with and without coverage", () => {
    // The Vacancies column moved the count 7→8 / 5→6. A stale colSpan is a layout break that only
    // appears in the EMPTY state, which no value assertion reaches.
    for (const [hasCoverage, expected] of [
      [true, 8],
      [false, 6],
    ] as const) {
      const markup = renderToStaticMarkup(
        createElement(BreakdownTable, {
          chrome: breakdownChrome(hasCoverage ? "NATIONAL" : "DISTRICT", "Western Region"),
          homeId: null,
          breakdown: {
            childLevel: hasCoverage ? "REGION" : "SCHOOL",
            hasCoverage,
            unattributed: null,
            children: [],
            total: blankRow({}),
          },
        }),
      );
      const headers = (markup.match(/<th\b/g) ?? []).length;
      const colSpan = Number(/colspan="(\d+)"/i.exec(markup)?.[1]);
      expect(headers, `hasCoverage=${hasCoverage}: header count`).toBe(expected);
      expect(colSpan, `hasCoverage=${hasCoverage}: empty-state colSpan`).toBe(expected);
      // The column renders at BOTH settings — it has no `hasCoverage` gate.
      expect(markup).toContain(">Vacancies</th>");
    }
  });

  it("Vacancies comes immediately AFTER PTR, and the header carries the public denominator", () => {
    const markup = renderToStaticMarkup(
      createElement(BreakdownTable, {
        chrome: breakdownChrome("NATIONAL", "Ghana"),
        homeId: null,
        breakdown: {
          childLevel: "REGION",
          hasCoverage: true,
          unattributed: null,
          children: [],
          total: blankRow({}),
        },
      }),
    );
    const headers = [...markup.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]!.trim());
    expect(headers.indexOf("Vacancies")).toBe(headers.indexOf("PTR") + 1);
    // …and before Candidates, which stays last (the ranking weight).
    expect(headers.indexOf("Vacancies")).toBeLessThan(headers.indexOf("Candidates"));
    const header = /<th[^>]*>Vacancies<\/th>/.exec(markup)![0];
    expect(header).toContain("PUBLIC schools with an establishment only");
    expect(header).toContain("private and mission schools carry none");
  });
});

describe("the comparison row is UNRANKED, signed and benchmarked over public children (AC-15)", () => {
  const metrics = comparisonMetrics({ exam: "WASSCE", hasCoverage: true });
  const vacancy = metrics.find((m) => m.key === "teacherVacancies");

  it("it exists, in Staffing, directly after PTR", () => {
    expect(vacancy, "no teacherVacancies metric in the catalogue").toBeDefined();
    const staffing = metrics.filter((m) => m.section === "Staffing").map((m) => m.key);
    expect(staffing).toEqual(["ptr", "teacherVacancies"]);
    // The mock's verbatim strings (Lucy §2).
    expect(vacancy!.label).toBe("Teacher vacancies");
    expect(vacancy!.subLabel).toBe("vs GES establishment");
  });

  it("it is never crowned best/worst, and carries no rank-dot config", () => {
    expect(vacancy!.direction).toBe("none");
    expect(vacancy!.markLabel).toBeUndefined();
    // …proved behaviourally too: build a model and assert no cell is marked.
    const columns = [
      { id: "s", row: blankRow({ childId: "s", name: "Short", postsEstablished: 40, vacancyShortage: 9, vacancySurplus: 0, vacancyNet: 9 }), coverageAmbiguous: false },
      { id: "o", row: blankRow({ childId: "o", name: "Over", postsEstablished: 40, vacancyShortage: 0, vacancySurplus: 4, vacancyNet: -4 }), coverageAmbiguous: false },
      { id: "p", row: blankRow({ childId: "p", name: "Private" }), coverageAmbiguous: false },
    ];
    const model = buildComparison({
      metrics: [vacancy!],
      benchmarkPopulation: columns.map((c) => c.row),
      columns,
    });
    const row = model.sections[0]!.rows[0]!;
    expect(row.cells.map((c) => c.mark)).toEqual([null, null, null]);
    // The private column is a named `—`, never 0, and the benchmark is the weighted vacancy RATE over
    // the like-for-like PUBLIC children only: (9 − 4) ÷ 80.
    expect(row.cells[2]!.value).toBeNull();
    expect(row.benchmark).toBeCloseTo(5 / 80, 10);
    expect(row.benchmark).toBe(
      weightedBenchmark(
        columns.map((c) => c.row),
        (r) => r.vacancyNet,
        (r) => r.postsEstablished,
      ),
    );
  });

  /** Render the vacancy row alone, over two columns whose nets the caller chooses. */
  const renderVacancyRow = (shortNet: number, overNet: number) => {
    const columns = [
      { id: "s", row: blankRow({ childId: "s", name: "Short", postsEstablished: 40, vacancyShortage: Math.max(shortNet, 0), vacancySurplus: Math.max(-shortNet, 0), vacancyNet: shortNet }), coverageAmbiguous: false },
      { id: "o", row: blankRow({ childId: "o", name: "Over", postsEstablished: 40, vacancyShortage: Math.max(overNet, 0), vacancySurplus: Math.max(-overNet, 0), vacancyNet: overNet }), coverageAmbiguous: false },
    ];
    const model = buildComparison({
      metrics: [vacancy!],
      benchmarkPopulation: columns.map((c) => c.row),
      columns,
    });
    return renderToStaticMarkup(
      createElement(ComparisonTable, {
        model,
        columns: [
          { id: "s", name: "Short", meta: null },
          { id: "o", name: "Over", meta: null },
        ],
        benchmarkLabel: "District average",
        benchmarkPopulation: { count: 2, noun: "JHS" },
        footnote: null,
      }),
    );
  };

  it("the rendered cells carry words, and the benchmark is written as a rate", () => {
    const markup = renderVacancyRow(9, -4);
    const text = textOf(markup);
    expect(text).toContain("+9 unfilled");
    expect(text).toContain("4 over");
    // 5/80 = 6.25% → "6%", the benchmark's own unit (a rate), not a count of posts.
    expect(text).toContain("6%");
    // The surplus cell is navy, never green; the shortage cell is terra.
    const cells = markup.slice(markup.indexOf("Teacher vacancies"));
    expect(cells).toContain("text-terra");
    expect(cells).not.toContain("text-green");
  });

  /**
   * THE BENCHMARK CELL CARRIES A WORD TOO (Dex B1). It is a SIGNED rate under a header that reads
   * "District average", so a bare "-6%" there misreads as "6% below average" — the exact failure the
   * signed-count rule forbids one column to the left. `signedRate` is the arm that fixes it.
   */
  it("the benchmark is WORDED, never a bare signed percentage (B1)", () => {
    // Net −5 over 80 posts = −6.25% → a SURPLUS reference line.
    const over = textOf(renderVacancyRow(-9, 4));
    expect(over).toContain("6% over");
    expect(over).not.toMatch(/[-−]\s?6%/);

    // Net +5 over 80 = +6.25% → a SHORTAGE reference line, worded and unsigned.
    const short = textOf(renderVacancyRow(9, -4));
    expect(short).toContain("6% short");
    expect(short).not.toMatch(/\+\s?6%/);

    // A true zero reference line is the panel's own wording, not "0%".
    const balanced = textOf(renderVacancyRow(4, -4));
    const benchmarkText = balanced.slice(balanced.indexOf("Teacher vacancies"));
    expect(benchmarkText).toContain("at establishment");
  });

  it("the stale 'Teacher vacancies … stay ABSENT' comment is gone, and the others stand", () => {
    const raw = readFileSync(join(ROOT, "lib/oversight/comparison.ts"), "utf8");
    // A comment asserting the catalogue omits a measure it now carries is a reverted decision
    // reintroduced as a lie about the code (Lucy §2, "Comment to update — critical").
    expect(raw).not.toMatch(/Teacher vacancies and the 4-year\s+\*?\s*trend stay ABSENT/);
    expect(raw).not.toMatch(/Teacher vacancies[^.]*stay ABSENT/);
    // The two UNRELATED omissions keep their comments.
    expect(raw).toContain("4-year");
    expect(raw).toContain("FEES is DEFERRED");
  });
});

// ── the dashboard page: four cards still, and the provenance caveat (ACs 12, 13, 19) ─────────────

function chromeSession(base: unknown, jurisdictionName: string) {
  return { ...(base as object), displayName: "Test Officer", jurisdictionName };
}

async function renderPage(officer: unknown): Promise<string> {
  vi.resetModules();
  vi.doMock("@/lib/auth", async (orig) => ({
    ...(await orig<typeof import("@/lib/auth")>()),
    getOfficerSession: async () => officer,
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

/** Just the `aria-label="Headline indicators"` KPI strip — the four cards, and nothing else. */
function stripOf(markup: string): string {
  const anchor = markup.indexOf('aria-label="Headline indicators"');
  expect(anchor, "no headline-indicator strip in the markup").toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<section", anchor);
  const end = markup.indexOf("<section", anchor);
  return markup.slice(start, end === -1 ? undefined : end);
}

describe("the dashboard page: no fifth KPI card, a panel below the strip, a ledger line (ACs 12, 13, 19)", () => {
  for (const [tier, officer, name] of [
    ["national", nationalOfficer, "National · Ministry of Education"],
    ["district", districtOfficer, "Wassa Amenfi West"],
  ] as const) {
    it(`${tier}: the strip still holds EXACTLY four cards and no vacancy card (AC-12)`, async () => {
      const strip = stripOf(await renderPage(chromeSession(officer, name)));
      // The grid is unchanged — a fifth card would have forced `xl:grid-cols-5`.
      expect(strip).toContain("xl:grid-cols-4");
      const labels = [
        "Total enrolment",
        "School coverage",
        "WASSCE qualification",
        "Pupil-teacher ratio",
      ];
      for (const label of labels) expect(strip).toContain(label);
      // Four cards, counted by the label class the KpiCard emits.
      const cards = (strip.match(/tracking-\[0\.15em\]/g) ?? []).length;
      expect(cards).toBe(4);
      // …and no vacancy figure anywhere in the strip.
      expect(strip).not.toContain("Teacher vacancies");
      expect(strip).not.toContain("establishment");
    });

    it(`${tier}: the Teacher establishment panel renders below the strip (AC-13)`, async () => {
      const markup = await renderPage(chromeSession(officer, name));
      const stripAt = markup.indexOf('aria-label="Headline indicators"');
      const panelAt = markup.indexOf("Teacher ");
      expect(markup).toContain("establishment");
      expect(panelAt).toBeGreaterThan(stripAt);
      expect(textOf(markup)).toContain("GES-authorised posts");
    });

    it(`${tier}: the provenance ledger carries the Establishment caveat (AC-19)`, async () => {
      const text = textOf(await renderPage(chromeSession(officer, name)));
      expect(text).toContain("GES-authorised establishment");
      expect(text).toContain("not a measured headcount");
      expect(text).toContain("private and mission schools carry no establishment");
      expect(text).toContain("positive = posts unfilled");
      expect(text).toContain("negative = teachers over establishment");
      // The PTR caveat is still there beside it — the new line is additive.
      expect(text).toContain("All-teacher PTR (trained + untrained)");
    });
  }
});

/** A `BreakdownRow` factory — every measure null by default, so a test states only what it exercises. */
function blankRow(fields: Partial<BreakdownRow>): BreakdownRow {
  return {
    childId: null,
    name: null,
    enrolment: null,
    schoolsFiling: null,
    candidates: null,
    qualified: null,
    wassceRate: null,
    schoolsReporting: null,
    schoolsRegistered: null,
    coverageRatio: null,
    ptr: null,
    staffEnrolment: null,
    teachers: null,
    presentDays: null,
    enrolledDays: null,
    attendanceRate: null,
    femaleEnrolment: null,
    girlsShare: null,
    postsEstablished: null,
    vacancyShortage: null,
    vacancySurplus: null,
    vacancyNet: null,
    vacancyRate: null,
    schoolsWithEstablishment: null,
    ...fields,
  };
}
