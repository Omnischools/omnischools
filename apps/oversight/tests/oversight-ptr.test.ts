import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { scopeFor, type JurisdictionScope } from "@/lib/db/rls";
import { isOk, type Reading } from "@/lib/oversight/reading";
import { getCurrentPeriod } from "@/lib/oversight/period";
import { getEnrolmentTotal } from "@/lib/oversight/enrolment";
import { getPupilTeacherRatio } from "@/lib/oversight/ptr";
import {
  childLevelFor,
  getChildBreakdown,
  spreadOf,
  type BreakdownRow,
  type ChildBreakdown,
} from "@/lib/oversight/breakdown";
import { formatRatio } from "@/components/oversight/kpi-card";
import { BreakdownTable } from "@/components/oversight/breakdown-table";
import { PTR_AXIS, SpreadPanel } from "@/components/oversight/breakdown-visuals";
import { breakdownChrome } from "@/components/oversight/tier-chrome";
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
} from "./helpers";

/**
 * INCREMENT I · PTR SURFACING — the QA gate for `lib/oversight/ptr.ts`, the breakdown's third
 * (staffing) UNION arm, and the three surfaces that render the figure.
 *
 * WHY THIS FILE EXISTS SEPARATELY. The PTR slice shipped with `lib/oversight/ptr.ts` carrying NO
 * test of its own, and `tests/oversight-child-breakdown.test.ts` threading `annualPeriodId` through
 * its call sites without ever asserting a PTR VALUE. Every property below is one a reviewer cannot
 * see by reading the SQL:
 *
 *  1. Σenrolment ÷ Σteachers, NEVER avg(stored ptr). The shared fixture seeds two deliberately
 *     lopsided staffing pairs — 410 pupils / 41 teachers (ptr 10.00) and 720 / 18 (ptr 40.00) — so
 *     the weighted figure (1130 ÷ 59 = 19.15…) and the naive mean (25.00) are 5.8 ratio points
 *     apart. A roll-up that averaged the stored column would still print a plausible national PTR.
 *  2. THE ANNUAL PIN. `is_current` is true on the TERM *and* the ANNUAL row of one academic year, so
 *     a read that forgot `period_type` would silently key on the wrong period. Proved by passing the
 *     TERM id and asserting PTR vanishes while enrolment is untouched.
 *  3. THE LEFT-JOIN LEVEL PIN, WITH A THIRD ARM. Adding a UNION arm to the facts CTE is exactly where
 *     the ancestor walk gets re-broken; a mis-parented school's staffing must land in the
 *     unattributed bucket, never on a wrong child, and a district officer must not get zero rows.
 *  4. NULL HONESTY AND DIVIDE-BY-ZERO. No staffing row → `null` → `—`. Zero teachers → unavailable,
 *     never `Infinity` and never a fabricated 0.
 *  5. THE THREE-WAY CHIP GATE (Kofi §10.1). A conformance chip is a CLAIM. Only a blend at/below the
 *     tightest norm (25) may say "within GES level norms" (green); only one above the loosest (35) may
 *     say "above GES level norms" (terra); between the two a blend cannot certify level-dependent norms,
 *     so NO chip renders — proved by planting high/mid/low-PTR rows and re-rendering the page.
 *
 * Every database assertion runs through `withJurisdiction()` as the NON-OWNER `ov_app` role (or, for
 * the raw probes, with the same GUCs on an app-role connection), so each is also an RLS assertion.
 */

// ── the fixture's arithmetic, in one place, so a failure reads as arithmetic ─────────────────────
const S = {
  /** Asankrangwa SHS (…011), in Wassa Amenfi West (…003), in Western Region (…002). */
  wassaEnrolment: 410,
  wassaTeachers: 41,
  /** Its STORED ptr — the column no roll-up may read. 410/41 = 10.00. */
  wassaStoredPtr: 10,
  /** The school in Sekondi-Takoradi Metro (…004), the other district of Western Region. */
  sekondiEnrolment: 720,
  sekondiTeachers: 18,
  /** Its STORED ptr — 720/18 = 40.00. */
  sekondiStoredPtr: 40,
} as const;

/** Σ÷Σ over Western Region (and, in this fixture, over the nation): 1130 ÷ 59 = 19.1525… */
const WEIGHTED_REGION_PTR =
  (S.wassaEnrolment + S.sekondiEnrolment) / (S.wassaTeachers + S.sekondiTeachers);
/** The WRONG answer: the unweighted mean of the two stored ptr values. 25.00. */
const NAIVE_AVG_PTR = (S.wassaStoredPtr + S.sekondiStoredPtr) / 2;

const districtScope = scopeFor(districtOfficer);
const nationalScope = scopeFor(nationalOfficer);
const regionOfficer = officerFixture({
  officerId: OFFICER.regionId,
  officerRole: OFFICER.regionRole,
  jurisdictionId: JUR.region,
  level: "REGION",
});
const regionScope: JurisdictionScope = scopeFor(regionOfficer);

let owner: postgres.Sql;

beforeAll(async () => {
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

const ROOT = process.cwd();

/** Comments stripped, strings kept — the auth-boundaries idiom, since the patterns live in SQL. */
function readCode(file: string): string {
  return readFileSync(join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

function stripTags(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ");
}

function textOf(markup: string): string {
  return stripTags(markup)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (1) THE ROLL-UP IS Σ÷Σ, NEVER avg(stored ptr) — at EVERY tier
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the KPI read is Σenrolment ÷ Σteachers, never the mean of the stored ptr column", () => {
  it("the fixture really is lopsided — the two answers differ by 5.8 ratio points", () => {
    // If this ever stops holding, every assertion below degenerates into "two equal numbers agree".
    expect(S.wassaEnrolment / S.wassaTeachers).toBeCloseTo(S.wassaStoredPtr, 10);
    expect(S.sekondiEnrolment / S.sekondiTeachers).toBeCloseTo(S.sekondiStoredPtr, 10);
    expect(Math.abs(WEIGHTED_REGION_PTR - NAIVE_AVG_PTR)).toBeGreaterThan(5);
  });

  it("the stored ptr column really is in the table, so 'never read' is a choice and not an absence", async () => {
    const stored = await asOfficer(nationalScope, async (tx) => {
      const rows = (await tx`
        select jurisdiction_id, ptr::float8 as ptr
          from fact_staffing
         where period_id = ${PERIOD_ID_ANNUAL}::uuid
         order by ptr
      `) as unknown as { jurisdiction_id: string; ptr: number }[];
      return rows;
    });
    expect(stored.map((r) => r.ptr)).toEqual([S.wassaStoredPtr, S.sekondiStoredPtr]);
  });

  it("NATIONAL: 1130 ÷ 59, not 25.00", async () => {
    const ptr = okValue(await getPupilTeacherRatio(nationalScope, PERIOD_ID_ANNUAL));
    expect(ptr.enrolmentTotal).toBe(S.wassaEnrolment + S.sekondiEnrolment);
    expect(ptr.teachersOnRoll).toBe(S.wassaTeachers + S.sekondiTeachers);
    expect(ptr.ratio).toBeCloseTo(WEIGHTED_REGION_PTR, 10);
    // The mutation this catches: `avg(fs.ptr)` in place of the two sums.
    expect(Math.abs(ptr.ratio - NAIVE_AVG_PTR)).toBeGreaterThan(5);
    // …and the honest denominator is schools, not rows.
    expect(ptr.schoolsCounted).toBe(2);
  });

  it("REGION: the same two schools, the same weighted figure", async () => {
    const ptr = okValue(await getPupilTeacherRatio(regionScope, PERIOD_ID_ANNUAL));
    expect(ptr.ratio).toBeCloseTo(WEIGHTED_REGION_PTR, 10);
    expect(Math.abs(ptr.ratio - NAIVE_AVG_PTR)).toBeGreaterThan(5);
  });

  it("DISTRICT: RLS has already cut the other district's school out of the Σ", async () => {
    const ptr = okValue(await getPupilTeacherRatio(districtScope, PERIOD_ID_ANNUAL));
    // 410 ÷ 41 — the OTHER district's 720/18 is not in the sum, and the module writes no WHERE that
    // could have removed it. The only thing that did is `ov_in_subtree`.
    expect(ptr.enrolmentTotal).toBe(S.wassaEnrolment);
    expect(ptr.teachersOnRoll).toBe(S.wassaTeachers);
    expect(ptr.ratio).toBeCloseTo(S.wassaEnrolment / S.wassaTeachers, 10);
    expect(ptr.schoolsCounted).toBe(1);
    // A leak would be identifiable BY VALUE: the region figure, or the other school's own.
    expect(ptr.ratio).not.toBeCloseTo(WEIGHTED_REGION_PTR, 3);
    expect(ptr.ratio).not.toBeCloseTo(S.sekondiStoredPtr, 3);
  });

  it("the breakdown's per-child PTR is the SAME weighted form, per child", async () => {
    const b = await readBreakdown(regionScope);
    expect(named(b, "Wassa Amenfi West").ptr).toBeCloseTo(
      S.wassaEnrolment / S.wassaTeachers,
      10,
    );
    expect(named(b, "Sekondi-Takoradi Metro").ptr).toBeCloseTo(
      S.sekondiEnrolment / S.sekondiTeachers,
      10,
    );
    // The TOTAL is weighted, which is exactly where avg() hides: the unweighted mean of the two
    // child ptrs is 25.00 and would look entirely plausible printed on the total row.
    const childPtrs = b.children.map((r) => r.ptr).filter((p): p is number => p !== null);
    const unweighted = childPtrs.reduce((a, c) => a + c, 0) / childPtrs.length;
    expect(unweighted).toBeCloseTo(NAIVE_AVG_PTR, 10);
    expect(b.total.ptr).toBeCloseTo(WEIGHTED_REGION_PTR, 10);
    expect(Math.abs(b.total.ptr! - unweighted)).toBeGreaterThan(5);
  });

  it("the stored ptr column is structurally out of reach in BOTH reading modules", () => {
    for (const file of ["lib/oversight/ptr.ts", "lib/oversight/breakdown.ts"]) {
      const code = readCode(file);
      // `fs` is the alias both modules give fact_staffing. The re-derived `row.ptr` / `ratio` field
      // legitimately contains the substring, so the guard is on the SELECTED COLUMN.
      expect(code, file).not.toMatch(/\bfs\.ptr\b/);
      // No aggregate over the stored rate, under any alias. (`avg(stored ptr)` in the modules' own
      // SQL comments is the prohibition being stated, not an occurrence of it.)
      expect(code, file).not.toMatch(/avg\s*\(\s*(fs\.)?ptr\b/i);
      // Both summed COUNTS must be there — the Σ÷Σ form is two sums, not one stored rate.
      // breakdown.ts sums the CTE's aliases (`staff_enrolment`/`teachers`); ptr.ts sums the columns.
      expect(code, file).toMatch(/sum\(\s*(fs\.)?(staff_)?enrolment(_total)?\b/);
      expect(code, file).toMatch(/sum\(\s*(fs\.)?teachers(_on_roll)?\b/);
      // …and both source columns are named somewhere in the file, so neither sum is of something else.
      expect(code, file).toContain("enrolment_total");
      expect(code, file).toContain("teachers_on_roll");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (2) THE ANNUAL PERIOD PIN — `is_current` alone matches the TERM row too
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("PTR keys on the ANNUAL period, and nothing else", () => {
  it("the collision is real: the fixture's TERM and ANNUAL rows share an academic year", async () => {
    const rows = await asOfficer(nationalScope, async (tx) => {
      return (await tx`
        select period_type::text as period_type, academic_year, is_current from dim_period
         where period_id in (${PERIOD_ID_TERM}::uuid, ${PERIOD_ID_ANNUAL}::uuid)
         order by period_type::text
      `) as unknown as {
        period_type: string;
        academic_year: string;
        is_current: boolean;
      }[];
    });
    expect(rows.map((r) => r.period_type)).toEqual(["ANNUAL", "TERM"]);
    // BOTH are current, in the SAME academic year: `period_type` is the only thing separating them,
    // which is the whole trap a PTR read keyed on `is_current` alone would fall into.
    expect(rows.every((r) => r.is_current)).toBe(true);
    expect(new Set(rows.map((r) => r.academic_year)).size).toBe(1);
  });

  it("the page's resolver pins ANNUAL and lands on the staffing period", async () => {
    const annual = okValue(await getCurrentPeriod(nationalScope, "ANNUAL"));
    const term = okValue(await getCurrentPeriod(nationalScope, "TERM"));
    expect(annual.periodId).toBe(PERIOD_ID_ANNUAL);
    expect(term.periodId).toBe(PERIOD_ID_TERM);
    expect(annual.periodId).not.toBe(term.periodId);
  });

  it("the TERM period yields NO PTR — not a wrong one, and not a zero", async () => {
    // fact_staffing has no TERM row, so the read must report ABSENCE rather than coalesce(…,0).
    expect(await getPupilTeacherRatio(nationalScope, PERIOD_ID_TERM)).toEqual({
      status: "unavailable",
    });
    // …and the enrolment card, which legitimately keys on TERM, is entirely unaffected.
    const enrolment = okValue(await getEnrolmentTotal(nationalScope, PERIOD_ID_TERM));
    expect(enrolment.total).toBeGreaterThan(0);
  });

  it("the breakdown's PTR column empties on the TERM period while enrolment stands", async () => {
    const b = await readBreakdown(regionScope, { annualPeriodId: PERIOD_ID_TERM });
    for (const row of [...allRows(b), b.total]) expect(row.ptr).toBeNull();
    // The enrolment column, which legitimately IS the TERM period, is untouched — so this proves the
    // pin rather than merely that the whole read collapsed.
    expect(b.total.enrolment).toBeGreaterThan(0);
    expect(b.children.every((r) => r.enrolment !== null)).toBe(true);
  });

  it("a NULL annual period is the same honest absence, not a crash", async () => {
    const b = await readBreakdown(regionScope, { annualPeriodId: null });
    for (const row of [...allRows(b), b.total]) expect(row.ptr).toBeNull();
    expect(b.total.enrolment).toBeGreaterThan(0);
  });

  it("the page resolves ANNUAL separately and does not reuse termPeriod for PTR", () => {
    const code = readCode("app/(oversight)/page.tsx");
    expect(code).toMatch(/getCurrentPeriod\(scope,\s*"ANNUAL"\)/);
    expect(code).toMatch(/getPupilTeacherRatio\(scope,\s*annualPeriod\.value\.periodId\)/);
    // The defect this forbids: PTR handed the TERM id.
    expect(code).not.toMatch(/getPupilTeacherRatio\(scope,\s*termPeriod/);
    expect(code).toMatch(/annualPeriodId:\s*isOk\(annualPeriod\)/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (3) THE LEVEL-PINNED LEFT-JOIN WALK STILL HOLDS WITH A THIRD UNION ARM
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the staffing arm goes through the same ancestry walk as the other two", () => {
  it("a DISTRICT officer's breakdown is NOT empty and carries the PTR column", async () => {
    // The INNER-join regression fails as a BLANK TABLE for exactly this tier (RLS hides an officer's
    // own ancestors), and passes at national where the predicate short-circuits.
    const b = await readBreakdown(districtScope);
    expect(b.children.length).toBeGreaterThan(0);
    const withPtr = b.children.filter((r) => r.ptr !== null);
    expect(withPtr).toHaveLength(1);
    expect(withPtr[0]!.ptr).toBeCloseTo(S.wassaEnrolment / S.wassaTeachers, 10);
    expect(b.total.ptr).toBeCloseTo(S.wassaEnrolment / S.wassaTeachers, 10);
  });

  it("a mis-parented school's STAFFING lands in the unattributed bucket, never on a wrong child", async () => {
    // A SCHOOL whose parent is a REGION. Without the `level` pin on the ancestor hop, its staffing
    // would be attributed to a REGION row sitting inside a DISTRICT breakdown — a wrong number with
    // a plausible name beside it.
    const SCHOOL = "10000000-0000-4000-8000-0000000000c1";
    const ORPHAN_ENROLMENT = 300;
    const ORPHAN_TEACHERS = 5;
    await owner`
      insert into dim_jurisdiction (jurisdiction_id, level, parent_id, name, school_type, ownership_type, is_reporting)
      values (${SCHOOL}::uuid, 'SCHOOL', ${JUR.region}::uuid, 'PTR Mis-parented JHS', 'JHS', 'PUBLIC', true)
    `;
    await owner`
      insert into fact_staffing (jurisdiction_id, period_id, teachers_on_roll, teaching_posts_established, enrolment_total, ptr, vacancies, source, as_of_date)
      values (${SCHOOL}::uuid, ${PERIOD_ID_ANNUAL}::uuid, ${ORPHAN_TEACHERS}, null, ${ORPHAN_ENROLMENT}, 60.00, null, 'OPERATIONAL_AGG', now())
    `;
    try {
      const b = await readBreakdown(regionScope);
      // It is in the bucket, with its OWN Σ÷Σ…
      expect(b.unattributed).not.toBeNull();
      expect(b.unattributed!.ptr).toBeCloseTo(ORPHAN_ENROLMENT / ORPHAN_TEACHERS, 10);
      // …and no child row absorbed it: the two real districts are unchanged.
      expect(named(b, "Wassa Amenfi West").ptr).toBeCloseTo(
        S.wassaEnrolment / S.wassaTeachers,
        10,
      );
      expect(named(b, "Sekondi-Takoradi Metro").ptr).toBeCloseTo(
        S.sekondiEnrolment / S.sekondiTeachers,
        10,
      );
      expect(b.children.some((r) => r.name === "PTR Mis-parented JHS")).toBe(false);
      // The TOTAL includes it — the bucket is returned, not filtered, so the table's rows still add up.
      expect(b.total.ptr).toBeCloseTo(
        (S.wassaEnrolment + S.sekondiEnrolment + ORPHAN_ENROLMENT) /
          (S.wassaTeachers + S.sekondiTeachers + ORPHAN_TEACHERS),
        10,
      );
      // …and the KPI read, which has no ancestry walk at all, agrees with it.
      const kpi = okValue(await getPupilTeacherRatio(regionScope, PERIOD_ID_ANNUAL));
      expect(kpi.ratio).toBeCloseTo(b.total.ptr!, 10);
    } finally {
      await owner`delete from fact_staffing where jurisdiction_id = ${SCHOOL}::uuid`;
      await owner`delete from dim_jurisdiction where jurisdiction_id = ${SCHOOL}::uuid`;
    }
  });

  it("the ancestor hop is a LEFT join and the child level is pinned — in the shipped SQL", () => {
    const code = readCode("lib/oversight/breakdown.ts");
    // The two properties the third arm could have broken, asserted textually as a belt beside the
    // behavioural tests above (an INNER hop is a one-word edit).
    expect(code).toMatch(/left join/i);
    expect(code).toMatch(/childLevel\}::jurisdiction_level/);
    // The staffing arm is INSIDE the shared `facts` CTE — i.e. before the walk, not a second walk.
    const factsCte = code.slice(code.indexOf("facts as ("), code.indexOf("attributed as ("));
    expect(factsCte).toContain("fact_staffing");
    expect(factsCte).toContain("fact_enrolment");
    expect(factsCte).toContain("fact_performance_exam");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (4) RECONCILIATION INCLUDES THE STAFFING COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the children + the bucket reconcile to the total on BOTH staffing components", () => {
  for (const [name, scope] of [
    ["district", districtScope],
    ["region", regionScope],
    ["national", nationalScope],
  ] as const) {
    it(`${name}: Σ of the rows' numerators and denominators IS the total's`, async () => {
      const b = await readBreakdown(scope);
      // PTR is a ratio and cannot be summed, so the reconciliation is over its two COMPONENTS. They
      // are not on `BreakdownRow` (deliberately — the surface reads a ratio), so this re-derives the
      // same invariant from the database the same way the guard does, and then checks the guard's
      // own OUTPUT: a breakdown that did not reconcile would have come back `unavailable`.
      const components = await asOfficer(scope, async (tx) => {
        const rows = (await tx`
          select coalesce(sum(enrolment_total), 0)::int as e,
                 coalesce(sum(teachers_on_roll), 0)::int as t
            from fact_staffing where period_id = ${PERIOD_ID_ANNUAL}::uuid
        `) as unknown as { e: number; t: number }[];
        return rows[0]!;
      });
      if (components.t === 0) {
        expect(b.total.ptr).toBeNull();
      } else {
        expect(b.total.ptr).toBeCloseTo(components.e / components.t, 10);
      }
      // The other measures still reconcile beside it — the third arm did not disturb them.
      const sum = (pick: (r: BreakdownRow) => number | null) =>
        allRows(b).reduce((acc, r) => acc + (pick(r) ?? 0), 0);
      expect(sum((r) => r.enrolment)).toBe(b.total.enrolment ?? 0);
      expect(sum((r) => r.candidates)).toBe(b.total.candidates ?? 0);
      expect(sum((r) => r.qualified)).toBe(b.total.qualified ?? 0);
    });
  }

  it("PTR reconciles through its summed COMPONENTS on the row, like every additive measure", () => {
    const code = readCode("lib/oversight/breakdown.ts");
    // N1 (Dex): the two PTR components ride on `BreakdownRow` now (like candidates/qualified behind
    // wassceRate), so they reconcile via the SAME `sumOf` over the rows as enrolment/candidates/
    // qualified — no special fact-side pass, so `factSumOf` is gone.
    expect(code).not.toMatch(/factSumOf/);
    expect(code).toMatch(/sumOf\(\(r\) => r\.staffEnrolment\)/);
    expect(code).toMatch(/sumOf\(\(r\) => r\.teachers\)/);
    // Both must be ANDed into `reconciles`, not computed and dropped.
    const guard = code.slice(code.indexOf("const reconciles ="));
    expect(guard.slice(0, 600)).toContain("sumOf((r) => r.staffEnrolment)");
    expect(guard.slice(0, 600)).toContain("sumOf((r) => r.teachers)");
  });

  it("an unreconciled read degrades the WHOLE section, never a partial total", async () => {
    // The sibling rule, reachable: any unstateable read returns `unavailable` for the section rather
    // than a table whose total is not the sum of the rows above it.
    expect(
      await getChildBreakdown(regionScope, {
        childLevel: "DISTRICT",
        termPeriodId: PERIOD_ID_TERM,
        examPeriodId: PERIOD_ID_EXAM_COHORT,
        annualPeriodId: "not-a-uuid",
        exam: "WASSCE",
      }),
    ).toEqual({ status: "unavailable" });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (5) CROSS-MODULE COMMITMENT — the KPI, the total row and the spread mean are ONE figure
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the KPI card, the breakdown total and the spread mean are the same Σ÷Σ", () => {
  it("region: all three agree to the last bit, and to the same printed string", async () => {
    const b = await readBreakdown(regionScope);
    const kpi = okValue(await getPupilTeacherRatio(regionScope, PERIOD_ID_ANNUAL));
    const spread = spreadOf(b, (r) => r.ptr);
    expect(spread).not.toBeNull();
    expect(kpi.ratio).toBeCloseTo(WEIGHTED_REGION_PTR, 10);
    expect(b.total.ptr).toBeCloseTo(kpi.ratio, 10);
    expect(spread!.mean).toBeCloseTo(kpi.ratio, 10);
    // The commitment the officer can actually see: the three render identically at one decimal.
    expect(formatRatio(kpi.ratio, 1)).toBe("19.2");
    expect(formatRatio(b.total.ptr!, 1)).toBe(formatRatio(kpi.ratio, 1));
    expect(formatRatio(spread!.mean!, 1)).toBe(formatRatio(kpi.ratio, 1));
  });

  it("the spread's mean is the WEIGHTED total, not the mean of the children", async () => {
    const b = await readBreakdown(regionScope);
    const spread = spreadOf(b, (r) => r.ptr)!;
    expect(spread.min).toBeCloseTo(S.wassaStoredPtr, 10);
    expect(spread.max).toBeCloseTo(S.sekondiStoredPtr, 10);
    // 19.15, not 25.00 — the midpoint of the band is NOT the mean marker's position.
    expect(Math.abs(spread.mean! - (spread.min + spread.max) / 2)).toBeGreaterThan(5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (6) NULL HONESTY AND DIVIDE-BY-ZERO
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("absence is absence — never a fabricated 0 and never an Infinity", () => {
  it("a child with no staffing row is `null`, beside children that have one", async () => {
    // A school that filed ENROLMENT but no staffing — the ordinary partial-return case. It has to sit
    // BESIDE a school that did file, because a read that collapsed absence to 0 still produces a
    // non-null total, so a test that only looked at the total would pass.
    const SCHOOL = "10000000-0000-4000-8000-0000000000c4";
    await owner`
      insert into dim_jurisdiction (jurisdiction_id, level, parent_id, name, school_type, ownership_type, is_reporting)
      values (${SCHOOL}::uuid, 'SCHOOL', ${JUR.district}::uuid, 'PTR No-staffing JHS', 'JHS', 'PUBLIC', true)
    `;
    await owner`
      insert into fact_enrolment (jurisdiction_id, period_id, stage, class_form, sex, headcount, source, as_of_date)
      values (${SCHOOL}::uuid, ${PERIOD_ID_TERM}::uuid, 'JHS', null, 'ALL', 95, 'OPERATIONAL_AGG', now())
    `;
    try {
      const b = await readBreakdown(districtScope);
      const blank = b.children.find((r) => r.name === "PTR No-staffing JHS");
      expect(blank, "the staffing-less school is not in the breakdown").toBeDefined();
      expect(blank!.enrolment).toBe(95);
      // Absence, not a measured zero and not a divide-by-zero.
      expect(blank!.ptr).toBeNull();
      expect(blank!.ptr).not.toBe(0);
      // …beside the school that DID file, whose figure is unchanged by its neighbour's silence.
      expect(named(b, "Asankrangwa SHS").ptr).toBeCloseTo(
        S.wassaEnrolment / S.wassaTeachers,
        10,
      );
      // And the total divides only the roll the staffing rows actually reported — the 95 pupils with
      // no teacher count behind them are NOT in the PTR numerator.
      expect(b.total.ptr).toBeCloseTo(S.wassaEnrolment / S.wassaTeachers, 10);
      expect(b.total.enrolment).toBe(S.wassaEnrolment + 95);
    } finally {
      await owner`delete from fact_enrolment where jurisdiction_id = ${SCHOOL}::uuid`;
      await owner`delete from dim_jurisdiction where jurisdiction_id = ${SCHOOL}::uuid`;
    }
  });

  it("a staffing row with ZERO teachers is UNAVAILABLE, not Infinity and not 0", async () => {
    // `teachers_on_roll` is NOT NULL but carries no CHECK > 0, so a defective ETL row is reachable.
    // Dividing by it is not a PTR; it is unstateable, and the read must say so.
    const SCHOOL = "10000000-0000-4000-8000-0000000000c2";
    const PERIOD = "20000000-0000-4000-8000-0000000000c3";
    await owner`
      insert into dim_period (period_id, academic_year, term, period_type, is_current)
      values (${PERIOD}::uuid, '2019/20', null, 'ANNUAL', false)
    `;
    await owner`
      insert into dim_jurisdiction (jurisdiction_id, level, parent_id, name, school_type, ownership_type, is_reporting)
      values (${SCHOOL}::uuid, 'SCHOOL', ${JUR.district}::uuid, 'PTR Zero-teacher JHS', 'JHS', 'PUBLIC', true)
    `;
    await owner`
      insert into fact_staffing (jurisdiction_id, period_id, teachers_on_roll, teaching_posts_established, enrolment_total, ptr, vacancies, source, as_of_date)
      values (${SCHOOL}::uuid, ${PERIOD}::uuid, 0, null, 120, null, null, 'OPERATIONAL_AGG', now())
    `;
    try {
      // A row EXISTS (row_count = 1), so this is not the "no rows" branch — it is the Σteachers = 0
      // branch, which is the one a `coalesce(...,0)` read would turn into a division by zero.
      expect(await getPupilTeacherRatio(districtScope, PERIOD)).toEqual({
        status: "unavailable",
      });
      const b = await readBreakdown(districtScope, { annualPeriodId: PERIOD });
      const row = b.children.find((r) => r.name === "PTR Zero-teacher JHS");
      expect(row).toBeDefined();
      expect(row!.ptr).toBeNull();
      expect(Number.isFinite(row!.ptr as number)).toBe(false);
      expect(b.total.ptr).toBeNull();
    } finally {
      await owner`delete from fact_staffing where jurisdiction_id = ${SCHOOL}::uuid`;
      await owner`delete from dim_jurisdiction where jurisdiction_id = ${SCHOOL}::uuid`;
      await owner`delete from dim_period where period_id = ${PERIOD}::uuid`;
    }
  });

  it("a period with no staffing rows at all is UNAVAILABLE, never 0 ÷ 0", async () => {
    expect(await getPupilTeacherRatio(nationalScope, PERIOD_ID_EXAM_COHORT)).toEqual({
      status: "unavailable",
    });
  });

  it("the empty-state colSpan still spans EVERY column, with and without coverage", () => {
    // The PTR column moved the count 6→7 / 4→5. A colSpan that no longer matches the header row is a
    // visible layout break that only appears in the EMPTY state, which no value assertion reaches.
    for (const [hasCoverage, expected] of [
      [true, 7],
      [false, 5],
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
      // The PTR header is one of them at BOTH settings — PTR has no `hasCoverage` gate.
      expect(markup).toContain(">PTR</th>");
    }
  });

  it("a null PTR renders the muted em-dash, not a 0:1", () => {
    const markup = renderToStaticMarkup(
      createElement(BreakdownTable, {
        chrome: breakdownChrome("REGION", "Western Region"),
        homeId: null,
        breakdown: {
          childLevel: "DISTRICT",
          hasCoverage: true,
          unattributed: null,
          children: [
            blankRow({ childId: "a", name: "Has staffing", enrolment: 410, ptr: 10 }),
            blankRow({ childId: "b", name: "No staffing", enrolment: 50, ptr: null }),
          ],
          total: blankRow({ enrolment: 460, ptr: 19.1525 }),
        },
      }),
    );
    const text = textOf(markup);
    expect(text).toContain("10.0:1");
    expect(text).toContain("19.2:1");
    // `\b` so "10.0:1" is not mistaken for a fabricated "0.0:1".
    expect(text).not.toMatch(/\b0\.0:1/);
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
    // The blank row has a PTR cell, and it is the absence affordance rather than a missing <td>.
    const blankRowMarkup = /No staffing([\s\S]*?)<\/tr>/.exec(markup)?.[1] ?? "";
    expect(blankRowMarkup).toContain('title="No return filed"');
    expect(blankRowMarkup).not.toContain(":1");
    // The shipped absence affordance, with its own title attribute.
    expect(markup).toContain('title="No return filed"');
  });
});

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
    ...fields,
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (7) ONE DECIMAL EVERYWHERE, AND THE SPREAD BAR'S INVERSION (Kofi §10.5 and §10.3/§10.4)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("Kofi's precision ruling: ONE decimal, on the Σ÷Σ figure, everywhere", () => {
  it("formatRatio does not multiply by 100 and does not keep the stored 2dp scale", () => {
    expect(formatRatio(WEIGHTED_REGION_PTR, 1)).toBe("19.2");
    expect(formatRatio(28.333333, 1)).toBe("28.3");
    // The two defects the formatter exists to prevent.
    expect(formatRatio(26.9, 1)).not.toBe("2690");
    expect(formatRatio(28.33, 1)).not.toBe("28.33");
  });

  it("the KPI card, the table cell and the spread all print exactly one decimal", async () => {
    const b = await readBreakdown(regionScope);
    const table = textOf(
      renderToStaticMarkup(
        createElement(BreakdownTable, {
          chrome: breakdownChrome("REGION", "Western Region"),
          homeId: null,
          breakdown: b,
        }),
      ),
    );
    const spread = textOf(
      renderToStaticMarkup(
        createElement(SpreadPanel, {
          breakdown: b,
          chrome: breakdownChrome("REGION", "Western Region"),
        }),
      ),
    );
    // Every PTR figure that appears, in either surface, has exactly one digit after the point.
    for (const printed of [...table.matchAll(/(\d+\.\d+):1/g)].map((m) => m[1]!)) {
      expect(printed, `table cell "${printed}"`).toMatch(/^\d+\.\d$/);
    }
    expect(table).toContain("10.0:1");
    expect(table).toContain("40.0:1");
    expect(table).toContain("19.2:1");
    expect(spread).toContain("10.0 – 40.0");
    expect(spread).toContain("mean 19.2");
    // Rounded AFTER the division: 19.2, never the 2dp 19.15 and never avg(ptr) 25.0.
    expect(spread).not.toContain("mean 25.0");
    expect(spread).not.toContain("mean 19.15");
    expect(table).not.toContain("25.0:1");
  });
});

describe("the PTR spread bar is INVERTED — green at the low end", () => {
  // The shipped axis, imported (not restated) so this bar's projection can never drift from the
  // component's. Pinned to Kofi §10.4's widened window so a silent edit back to a narrow axis fails.
  it("the axis is the §10.4 widened window [10, 60], which contains the whole seeded range", () => {
    expect(PTR_AXIS).toEqual({ lo: 10, hi: 60 });
  });
  const project = (v: number) =>
    Math.min(1, Math.max(0, (v - PTR_AXIS.lo) / (PTR_AXIS.hi - PTR_AXIS.lo)));

  async function ptrBarMarkup(): Promise<string> {
    const b = await readBreakdown(regionScope);
    const markup = renderToStaticMarkup(
      createElement(SpreadPanel, {
        breakdown: b,
        chrome: breakdownChrome("REGION", "Western Region"),
      }),
    );
    // Only the PTR row, so a WASSCE dot cannot be mistaken for a PTR one.
    const start = markup.indexOf("Pupil-teacher ratio");
    expect(start, "no PTR spread bar rendered").toBeGreaterThan(-1);
    return markup.slice(start);
  }

  function leftOf(markup: string, colourClass: string): number {
    const re = new RegExp(`${colourClass}[^>]*?left:\\s*([\\d.]+)%`);
    const alt = new RegExp(`left:\\s*([\\d.]+)%[^>]*?${colourClass}`);
    const m = re.exec(markup) ?? alt.exec(markup);
    expect(m, `no dot with class ${colourClass}`).not.toBeNull();
    return Number(m![1]);
  }

  it("the GREEN (best) dot sits at the MIN and the TERRA (worst) dot at the MAX", async () => {
    const bar = await ptrBarMarkup();
    const green = leftOf(bar, "bg-green");
    const terra = leftOf(bar, "bg-terra");
    // On the [10, 60] axis: min = 10.0 sits at the floor (0%); max = 40.0 projects to 60% — neither
    // clamps (the whole seeded range fits), so the dots track the real values, not a rail.
    expect(green).toBeCloseTo(project(S.wassaStoredPtr) * 100, 1);
    expect(terra).toBeCloseTo(project(S.sekondiStoredPtr) * 100, 1);
    // THE INVERSION, stated as the thing that must not flip back: for PTR the green dot is LEFT of
    // the terra one. (For a rate bar it is the other way round — asserted below.)
    expect(green).toBeLessThan(terra);
  });

  it("the two RATE bars are NOT inverted — green stays at the high end, on the same panel", () => {
    // All three bars at once, so the inversion is proved as a DIFFERENCE between measures in one
    // render rather than as two separate facts. (The shared fixture has no exam rows, so the rate
    // bars need a synthetic breakdown to exist at all.)
    const markup = renderToStaticMarkup(
      createElement(SpreadPanel, {
        breakdown: {
          childLevel: "DISTRICT",
          hasCoverage: true,
          unattributed: null,
          children: [
            blankRow({ childId: "a", name: "A", wassceRate: 0.5, coverageRatio: 0.6, ptr: 10 }),
            blankRow({ childId: "b", name: "B", wassceRate: 0.9, coverageRatio: 1, ptr: 40 }),
          ],
          total: blankRow({ wassceRate: 0.6, coverageRatio: 0.7, ptr: WEIGHTED_REGION_PTR }),
        },
        chrome: breakdownChrome("REGION", "Western Region"),
      }),
    );
    const wassceStart = markup.indexOf("WASSCE qualification");
    const coverageStart = markup.indexOf("School coverage");
    const ptrStart = markup.indexOf("Pupil-teacher ratio");
    expect(wassceStart).toBeGreaterThan(-1);
    expect(coverageStart).toBeGreaterThan(wassceStart);
    expect(ptrStart).toBeGreaterThan(coverageStart);
    const wassceBar = markup.slice(wassceStart, coverageStart);
    const coverageBar = markup.slice(coverageStart, ptrStart);
    const ptrBar = markup.slice(ptrStart);
    // Rates: green RIGHT of terra. PTR: green LEFT of terra. That difference is the whole inversion.
    expect(leftOf(wassceBar, "bg-green")).toBeGreaterThan(leftOf(wassceBar, "bg-terra"));
    expect(leftOf(coverageBar, "bg-green")).toBeGreaterThan(leftOf(coverageBar, "bg-terra"));
    expect(leftOf(ptrBar, "bg-green")).toBeLessThan(leftOf(ptrBar, "bg-terra"));
  });

  it("the mean marker sits at the projected WEIGHTED mean, not at the band's midpoint", async () => {
    const bar = await ptrBarMarkup();
    const m = /w-\[2px\] bg-navy"[^>]*?left:\s*([\d.]+)%/.exec(bar);
    expect(m, "no mean marker on the PTR bar").not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(project(WEIGHTED_REGION_PTR) * 100, 1);
    // The 10–40 band's midpoint is 25; the weighted mean 19.2 sits well below it, so the marker is in
    // the left (better-staffed) half of the bar, not at the band centre.
    expect(Number(m![1])).toBeLessThan(50);
  });

  it("the caption's PTR gap is in RATIO points, and claims nothing about geography", async () => {
    const b = await readBreakdown(regionScope);
    const text = textOf(
      renderToStaticMarkup(
        createElement(SpreadPanel, {
          breakdown: b,
          chrome: breakdownChrome("REGION", "Western Region"),
        }),
      ),
    );
    // 40.0 − 10.0 = 30.0 ratio points, phrased "spread in…" not "gap" (Kofi §10.3). `gapPoints` would
    // have said "3000-point".
    expect(text).toContain("30.0-point spread in pupil-teacher ratio");
    expect(text).not.toContain("pupil-teacher-ratio gap");
    expect(text).not.toContain("3000-point");
    // Kofi §10.3: the caption must not re-state the inversion as a geography claim, and "all three" must
    // never be a literal — it is derived from how many bars rendered.
    expect(text).not.toContain("all three");
    expect(text.toLowerCase()).not.toContain("low end");
    expect(text.toLowerCase()).not.toContain("northern");
  });

  it("the gap sentence is derived: with no PTR spread, no PTR clause appears", () => {
    const text = textOf(
      renderToStaticMarkup(
        createElement(SpreadPanel, {
          breakdown: {
            childLevel: "DISTRICT",
            hasCoverage: true,
            unattributed: null,
            children: [
              blankRow({ childId: "a", name: "A", wassceRate: 0.5, coverageRatio: 0.5 }),
              blankRow({ childId: "b", name: "B", wassceRate: 0.7, coverageRatio: 0.9 }),
            ],
            total: blankRow({ wassceRate: 0.6, coverageRatio: 0.7 }),
          },
          chrome: breakdownChrome("REGION", "Western Region"),
        }),
      ),
    );
    expect(text).not.toContain("pupil-teacher-ratio gap");
    expect(text).toContain("are the disparities");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (8) THE CONFORMANCE CHIP IS A CLAIM, AND IT IS A THREE-WAY GATE — rendered against the real page
// ══════════════════════════════════════════════════════════════════════════════════════════════════

function chromeSession(base: unknown, jurisdictionName: string) {
  return { ...(base as object), displayName: "Test Officer", jurisdictionName };
}

/** Just the `aria-label="Headline indicators"` KPI strip — the four cards, and nothing else. */
function stripOf(markup: string): string {
  const anchor = markup.indexOf('aria-label="Headline indicators"');
  expect(anchor, "no headline-indicator strip in the markup").toBeGreaterThan(-1);
  // Back to the opening `<section` tag, forward to the next one, so the slice is well-formed markup.
  const start = markup.lastIndexOf("<section", anchor);
  const end = markup.indexOf("<section", anchor);
  return markup.slice(start, end === -1 ? undefined : end);
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

/**
 * THE KPI STRIP IS GATED ON A SUCCESSFUL ETL RUN. `shown()` is `hasRun && isOk(reading)`, so with no
 * `etl_run` row every card — all four, PTR included — reads "No successful run yet" and NO card value,
 * unit, sub-line or chip renders at all. The shared fixture has no run, which is why nothing in the
 * shipped suite asserts a KPI VALUE on the page. So these tests plant one SUCCESS run, and remove it,
 * leaving the database as they found it (`fileParallelism: false`; `tests/etl-status.test.ts` and the
 * other page-render suites measure the no-run banner).
 */
const PTR_ETL_RUN = "80000000-0000-4000-8000-0000000000d1";

async function withEtlRun(fn: () => Promise<void>): Promise<void> {
  await owner`
    insert into etl_run (run_id, started_at, finished_at, status)
    values (${PTR_ETL_RUN}::uuid, now() - interval '1 hour', now() - interval '30 minutes', 'SUCCESS')
  `;
  try {
    await fn();
  } finally {
    await owner`delete from etl_run where run_id = ${PTR_ETL_RUN}::uuid`;
  }
}

describe("the PTR KPI card states Kofi's ruling, and the norms chip is gated on the ratio", () => {
  it("the strip is gated on a run at all — the premise of every assertion below", async () => {
    // With no run, the card names itself and refuses to state a figure. This is the shipped
    // honesty rule, asserted so the plant below is understood as setup and not as a fix.
    const markup = await renderPage(
      chromeSession(nationalOfficer, "National · Ministry of Education"),
    );
    const strip = textOf(stripOf(markup));
    expect(strip).toContain("Pupil-teacher ratio");
    // The PTR card refuses like the other three — it does not quietly print a figure with no vintage.
    expect(strip).toContain("No successful run yet");
    expect(strip).not.toMatch(/\d/);
    expect(strip).not.toContain("within GES level norms");
    expect(strip).not.toContain("above GES level norms");
    expect(strip).not.toContain("GES norm");
    // The BREAKDOWN table is a separate section and is not run-gated; it still prints the figure. That
    // asymmetry is the shipped design, recorded here so the plant below is read as setup, not a fix.
    expect(textOf(markup)).toContain("19.2:1");
  });

  it("the card prints the Σ÷Σ figure at one decimal with ': 1' as the UNIT", async () => {
    await withEtlRun(async () => {
      const markup = await renderPage(
        chromeSession(nationalOfficer, "National · Ministry of Education"),
      );
      const text = textOf(markup);
      expect(text).toContain("Pupil-teacher ratio");
      // 1130 ÷ 59 = 19.2 — the weighted figure, not avg(ptr) 25.0 and not either stored 10/40.
      expect(text).toMatch(/19\.2\s*:\s*1/);
      expect(text).not.toMatch(/25\.0\s*:\s*1/);
      expect(text).not.toContain("2690");
      // `: 1` is the card's UNIT span (the way `%` is coverage's), never part of the value string.
      const strip = stripOf(markup);
      expect(strip).toMatch(/19\.2<span[^>]*text-navy-3[^>]*>:\s*1<\/span>/);
      // …and the card is NOT the gold-italic lead treatment (only card 1 is).
      const card = strip.slice(strip.indexOf("Pupil-teacher ratio"));
      expect(card).not.toContain("accent-italic");
      // The KPI figure and the breakdown total row are the ONE Σ÷Σ figure, on one request.
      expect(text).toContain("19.2:1");
    });
  });

  it("the sub-line is BLENDED and names BOTH norm ends — never a flat 25:1 target", async () => {
    await withEtlRun(async () => {
      const text = textOf(
        await renderPage(chromeSession(nationalOfficer, "National · Ministry of Education")),
      );
      expect(text).toContain("National average");
      expect(text).toContain("25:1");
      expect(text).toContain("35:1");
      // Kofi §10.2: the level-dependent BAND, not a single target, and no pass/fail verdict glyph.
      expect(text).not.toContain("GES target 25:1");
      expect(text).not.toContain("above target");
      expect(text).not.toContain("▼");
      expect(text).not.toContain("▲");
    });
  });

  it("WITHIN branch: a blend at/below the tightest norm (25) gets the GREEN 'within' chip", async () => {
    // National blend 1130 ÷ 59 = 19.2 ≤ 25, so it is within EVERY level ceiling whatever the mix
    // (Kofi §10.1 branch 1) → an affirmative chip in the green tone.
    await withEtlRun(async () => {
      const markup = await renderPage(
        chromeSession(nationalOfficer, "National · Ministry of Education"),
      );
      expect(textOf(markup)).toContain("within GES level norms");
      const chip = /<span class="([^"]*)">within GES level norms<\/span>/.exec(markup);
      expect(chip, "no 'within GES level norms' chip rendered").not.toBeNull();
      // Green (`bg-green-bg` / `text-green`), never terra, and no ▲/▼ glyph.
      expect(chip![1]).toContain("bg-green-bg");
      expect(chip![1]).toContain("text-green");
      expect(chip![1]).not.toContain("terra");
      expect(markup).not.toContain("▲");
      expect(markup).not.toContain("▼");
    });
  });

  it("ABOVE branch: a blend beyond the loosest norm (35) gets the TERRA 'above' chip", async () => {
    // The district blend is 410/41 = 10.0 today. Plant a second, badly-staffed school in the SAME
    // district so the blend becomes (410+4000) ÷ (41+50) = 48.5 — above 35, so above EVERY level
    // ceiling whatever the mix (Kofi §10.1 branch 2) → an adverse chip in the terra tone.
    const SCHOOL = JUR.schoolPublicNoConsent; // already a SCHOOL under JUR.district
    await owner`
      insert into fact_staffing (jurisdiction_id, period_id, teachers_on_roll, teaching_posts_established, enrolment_total, ptr, vacancies, source, as_of_date)
      values (${SCHOOL}::uuid, ${PERIOD_ID_ANNUAL}::uuid, 50, null, 4000, 80.00, null, 'OPERATIONAL_AGG', now())
    `;
    try {
      const kpi = okValue(await getPupilTeacherRatio(districtScope, PERIOD_ID_ANNUAL));
      expect(kpi.ratio).toBeCloseTo(4410 / 91, 10);
      expect(kpi.ratio).toBeGreaterThan(35);

      await withEtlRun(async () => {
        const markup = await renderPage(chromeSession(districtOfficer, "Wassa Amenfi West"));
        const text = textOf(markup);
        // The figure itself is still published.
        expect(text).toMatch(/48\.5\s*:\s*1/);
        expect(text).toContain("District average");
        // The adverse CLAIM is made — and it is "above GES level norms", never a "within" lie and never
        // the mock's "above target" single-target wording.
        expect(text).toContain("above GES level norms");
        expect(text).not.toContain("within GES level norms");
        expect(text).not.toContain("above target");
        const chip = /<span class="([^"]*)">above GES level norms<\/span>/.exec(markup);
        expect(chip, "no 'above GES level norms' chip rendered").not.toBeNull();
        expect(chip![1]).toContain("bg-terra-bg");
        expect(chip![1]).toContain("text-terra");
        expect(chip![1]).not.toContain("green");
        expect(markup).not.toContain("▼");
      });
    } finally {
      await owner`
        delete from fact_staffing
         where jurisdiction_id = ${SCHOOL}::uuid and period_id = ${PERIOD_ID_ANNUAL}::uuid
      `;
    }
  });

  it("⚠ INDETERMINATE branch: a blend BETWEEN the norms (25 < b ≤ 35) gets NO chip at all", async () => {
    // The honesty case (Kofi §10.1 branch 3): a single blend cannot certify conformance to
    // level-dependent norms, so between the two ends the card makes NO claim. Plant a school so the
    // district blend is (410+2590) ÷ (41+50) = 3000/91 = 33.0 — inside the (25, 35] band.
    const SCHOOL = JUR.schoolPublicNoConsent;
    await owner`
      insert into fact_staffing (jurisdiction_id, period_id, teachers_on_roll, teaching_posts_established, enrolment_total, ptr, vacancies, source, as_of_date)
      values (${SCHOOL}::uuid, ${PERIOD_ID_ANNUAL}::uuid, 50, null, 2590, 51.80, null, 'OPERATIONAL_AGG', now())
    `;
    try {
      const kpi = okValue(await getPupilTeacherRatio(districtScope, PERIOD_ID_ANNUAL));
      expect(kpi.ratio).toBeCloseTo(3000 / 91, 10); // 32.97 → displays 33.0
      expect(kpi.ratio).toBeGreaterThan(25);
      expect(kpi.ratio).toBeLessThanOrEqual(35);

      await withEtlRun(async () => {
        const text = textOf(await renderPage(chromeSession(districtOfficer, "Wassa Amenfi West")));
        // The figure is published; the norm RANGE is still stated in the sub-line so the reader judges.
        expect(text).toMatch(/33\.0\s*:\s*1/);
        expect(text).toContain("GES norm 25:1");
        // But NO conformance chip of EITHER tone — not a "within…" lie, not a substitute neutral text.
        expect(text).not.toContain("within GES level norms");
        expect(text).not.toContain("above GES level norms");
      });
    } finally {
      await owner`
        delete from fact_staffing
         where jurisdiction_id = ${SCHOOL}::uuid and period_id = ${PERIOD_ID_ANNUAL}::uuid
      `;
    }
  });

  it("the gate reads the named level-norm constant, not inline literals (Kofi §10.1/§10.2)", () => {
    const page = readCode("app/(oversight)/page.tsx");
    // The three-way verdict and the band ends come from lib/oversight/ptr.ts — the one source the
    // sub-line also reads — never a bare 35/25 in the gate (Dex B2b/B2c; Kofi §10.1).
    expect(page).toMatch(/ptrNormVerdict\(/);
    expect(page).toMatch(/GES_PTR_NORM_MIN/);
    expect(page).toMatch(/GES_PTR_NORM_MAX/);
    expect(page).not.toMatch(/GES_PTR_NORM_CEILING/);
    // No inline "<= 35" / "<= 25" ratio comparison survives in the page; the thresholds live in ptr.ts.
    expect(page).not.toMatch(/ratio\s*<=\s*3[05]\b/);

    const lib = readCode("lib/oversight/ptr.ts");
    // The constant is the §3 level-norm map; MIN/MAX are DERIVED from it (bound to one source), not
    // re-typed literals, so the chip and sub-line cannot drift.
    expect(lib).toMatch(/GES_PTR_LEVEL_NORMS\s*=\s*\{[^}]*PRIMARY:\s*35[^}]*\}/);
    expect(lib).toMatch(/GES_PTR_NORM_MIN\s*=\s*Math\.min\(/);
    expect(lib).toMatch(/GES_PTR_NORM_MAX\s*=\s*Math\.max\(/);
  });
});

describe("the provenance ledger carries the PTR-not-PTTR caveat (Kofi §10.5)", () => {
  it("there is a 'Measure' item carrying the §10.5 verbatim all-teacher-PTR caveat", async () => {
    const markup = await renderPage(
      chromeSession(nationalOfficer, "National · Ministry of Education"),
    );
    const found = /<dt[^>]*>Measure<\/dt><dd[^>]*>([^<]*)<\/dd>/.exec(markup);
    expect(found, "no provenance <dd> for 'Measure'").not.toBeNull();
    const line = textOf(found![1]!);
    // Kofi §10.5 verbatim: the measure is all-teacher PTR, never PTTR.
    expect(line).toContain("All-teacher PTR (trained + untrained); not the trained-teacher ratio (PTTR).");
    // The surface must not claim to publish PTTR anywhere else.
    expect(textOf(markup).match(/PTTR/g) ?? []).toHaveLength(1);
  });

  it("it renders at EVERY tier — the caveat is not a national-only courtesy", async () => {
    for (const [officer, name] of [
      [regionOfficer, "Western Region"],
      [districtOfficer, "Wassa Amenfi West"],
    ] as const) {
      const markup = await renderPage(chromeSession(officer, name));
      expect(
        /<dt[^>]*>Measure<\/dt><dd[^>]*>([^<]*)<\/dd>/.exec(markup)?.[1],
        name,
      ).toContain("PTTR");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (9) RLS / ISOLATION — fact_staffing is bounded by the POLICY, not by app SQL
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("tenant isolation over fact_staffing, as the non-superuser app role", () => {
  it("the owner sees both districts' rows; each officer sees only their own subtree's", async () => {
    const asOwner = (await owner`
      select count(*)::int as n from fact_staffing where period_id = ${PERIOD_ID_ANNUAL}::uuid
    `) as unknown as { n: number }[];
    expect(Number(asOwner[0]!.n)).toBe(2);

    const seen = async (scope: JurisdictionScope) =>
      asOfficer(scope, async (tx) => {
        const rows = (await tx`
          select jurisdiction_id, enrolment_total, teachers_on_roll
            from fact_staffing where period_id = ${PERIOD_ID_ANNUAL}::uuid
           order by enrolment_total
        `) as unknown as { jurisdiction_id: string; enrolment_total: number }[];
        return rows;
      });

    const district = await seen(districtScope);
    expect(district).toHaveLength(1);
    expect(district[0]!.jurisdiction_id).toBe(JUR.schoolPublicConsented);
    // The other district's row is not merely filtered out of the Σ — it is INVISIBLE.
    expect(district.map((r) => r.enrolment_total)).not.toContain(S.sekondiEnrolment);

    expect(await seen(regionScope)).toHaveLength(2);
    expect(await seen(nationalScope)).toHaveLength(2);
  });

  it("a DISTRICT officer scoped to the OTHER district gets that district's figure and no other", async () => {
    const otherDistrictOfficer = officerFixture({
      officerId: OFFICER.districtId,
      officerRole: "DISTRICT_DIRECTOR",
      jurisdictionId: JUR.otherDistrict,
      level: "DISTRICT",
    });
    const ptr = okValue(
      await getPupilTeacherRatio(scopeFor(otherDistrictOfficer), PERIOD_ID_ANNUAL),
    );
    expect(ptr.enrolmentTotal).toBe(S.sekondiEnrolment);
    expect(ptr.teachersOnRoll).toBe(S.sekondiTeachers);
    expect(ptr.schoolsCounted).toBe(1);
    // Neither neighbour's figure, nor the region's blend, is reachable from here.
    expect(ptr.enrolmentTotal).not.toBe(S.wassaEnrolment);
    expect(ptr.ratio).not.toBeCloseTo(WEIGHTED_REGION_PTR, 3);
  });

  it("the read module writes no ceiling of its own — RLS is the only one", () => {
    const code = readCode("lib/oversight/ptr.ts");
    expect(code).toMatch(
      /import\s*\{[^}]*withJurisdiction[^}]*\}\s*from\s*"@\/lib\/db\/rls"/,
    );
    expect(code).not.toMatch(/from\s*"@\/lib\/db"/);
    expect(code).not.toMatch(/\bdb\s*\.\s*(execute|transaction|select)\b/);
    expect(code).not.toMatch(/ov_in_subtree/);
    expect(code).not.toMatch(/app\.current_(jurisdiction|level|officer)/);
    expect(code).not.toMatch(/scope\.(jurisdictionId|level)/);
    // Exactly one read, and it is inside the one chokepoint wrapper.
    expect((code.match(/tx\.execute\(/g) ?? []).length).toBe(1);
    expect((code.match(/withJurisdiction\(/g) ?? []).length).toBe(1);
    expect(code.indexOf("withJurisdiction(")).toBeLessThan(code.indexOf("tx.execute("));
  });

  it("it names no individual-level column, like every other analytics read", () => {
    const code = readCode("lib/oversight/ptr.ts");
    for (const column of ["full_name", "first_name", "surname", "ntc_licence", "captured_by"]) {
      expect(code, column).not.toContain(column);
    }
  });
});
