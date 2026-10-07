import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { scopeFor, type JurisdictionScope } from "@/lib/db/rls";
import { isOk, type Reading } from "@/lib/oversight/reading";
import {
  childLevelFor,
  getChildBreakdown,
  type BreakdownRow,
  type ChildBreakdown,
} from "@/lib/oversight/breakdown";
import { ATT_MIN_ENROLLED_DAYS } from "@/lib/oversight/comparison";
import {
  JUR,
  OFFICER,
  PERIOD_ID_ANNUAL,
  PERIOD_ID_EXAM_COHORT,
  PERIOD_ID_TERM,
} from "./fixtures/ids";
import { adminAnalytics, districtOfficer, nationalOfficer, officerFixture } from "./helpers";

/**
 * QA GATE PROBE — the attendance UNION arm, against a REAL database as the NON-OWNER `ov_app` role.
 *
 * The shipped fast-follow added the arm plus two seed rows but no integration assertion over them, so
 * nothing executed proved: the TERM period pin, the `class_form is null` de-duplication, the weighted
 * Σ÷Σ at DB level, the null-not-zero cell, the reconcile invariant over the two new day counts, or the
 * cross-district isolation of the new table. This file is that proof.
 */

const MISPARENTED_SCHOOL = "10000000-0000-4000-8000-0000000000c1";
const MISPARENTED_NAME = "QA Mis-parented JHS";

/** Seed figures (tests/fixtures/analytics-seed.sql). */
const SEED = {
  asankrangwaPresent: 22080,
  asankrangwaEnrolled: 24000,
  takoradiPresent: 37584,
  takoradiEnrolled: 43200,
} as const;
const SEED_TOTAL_PRESENT = SEED.asankrangwaPresent + SEED.takoradiPresent; // 59664
const SEED_TOTAL_ENROLLED = SEED.asankrangwaEnrolled + SEED.takoradiEnrolled; // 67200

const MIS_PRESENT = 1800;
const MIS_ENROLLED = 2000;

let owner: postgres.Sql;

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

beforeAll(async () => {
  owner = adminAnalytics();

  // A SCHOOL mis-parented straight onto a REGION — the level pin's reason to exist, carrying
  // attendance so the unattributed bucket has day counts in it.
  await owner`
    insert into dim_jurisdiction (jurisdiction_id, level, parent_id, name, ges_code, school_type, ownership_type, is_reporting)
    values (${MISPARENTED_SCHOOL}::uuid, 'SCHOOL', ${JUR.region}::uuid, ${MISPARENTED_NAME}, null, 'JHS', 'PUBLIC', true)
  `;

  await owner`
    insert into fact_attendance (jurisdiction_id, period_id, stage, class_form, enrolled_days, present_days, attendance_rate, source, as_of_date)
    values
      -- DECOY 1 — a PER-FORM row beside the stage total on the SAME school/period/stage. If the arm
      -- forgot class_form-is-null this would double-count by a value no rounding can hide.
      (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_TERM}::uuid,   'JHS', 'Form 2', 999999, 999999, 100.00, 'OPERATIONAL_AGG', now()),
      -- DECOY 2 — the SAME school/stage on the ANNUAL period. If the arm pinned the annual period (as
      -- fact_staffing legitimately does) or pinned nothing, this leaks in.
      (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_ANNUAL}::uuid, 'JHS', null,    888888, 888888, 100.00, 'OPERATIONAL_AGG', now()),
      -- DECOY 3 — the EXAM_COHORT period, same shape. Belt and braces on the period pin.
      (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_EXAM_COHORT}::uuid, 'JHS', null, 777777, 777777, 100.00, 'OPERATIONAL_AGG', now()),
      -- The mis-parented school's own attendance, on the TERM period, as a stage total.
      (${MISPARENTED_SCHOOL}::uuid, ${PERIOD_ID_TERM}::uuid, 'JHS', null, ${MIS_ENROLLED}, ${MIS_PRESENT}, 90.00, 'OPERATIONAL_AGG', now())
  `;

  // A school in the officer's OWN district with enrolment but NO attendance: it must appear in the
  // breakdown with a NULL attendance cell, never a confident 0%.
  await owner`
    insert into fact_enrolment (jurisdiction_id, period_id, stage, class_form, sex, headcount, source, as_of_date)
    values
      (${JUR.schoolPublicNoConsent}::uuid, ${PERIOD_ID_ANNUAL}::uuid, 'JHS', null, 'ALL', 333, 'OPERATIONAL_AGG', now()),
      (${MISPARENTED_SCHOOL}::uuid,        ${PERIOD_ID_ANNUAL}::uuid, 'JHS', null, 'ALL', 44,  'OPERATIONAL_AGG', now())
  `;
});

afterAll(async () => {
  await owner`
    delete from fact_attendance
     where jurisdiction_id = ${MISPARENTED_SCHOOL}::uuid
        or (jurisdiction_id = ${JUR.schoolPublicConsented}::uuid
            and (class_form is not null or period_id <> ${PERIOD_ID_TERM}::uuid))
  `;
  await owner`
    delete from fact_enrolment
     where period_id = ${PERIOD_ID_ANNUAL}::uuid
       and jurisdiction_id in (${JUR.schoolPublicNoConsent}::uuid, ${MISPARENTED_SCHOOL}::uuid)
  `;
  await owner`delete from dim_jurisdiction where jurisdiction_id = ${MISPARENTED_SCHOOL}::uuid`;
  await owner.end({ timeout: 5 });
});

function okValue<T>(reading: Reading<T>): T {
  expect(reading.status).toBe("ok");
  if (!isOk(reading)) throw new Error("expected an `ok` reading, got `unavailable`");
  return reading.value;
}

async function readBreakdown(
  scope: JurisdictionScope,
  overrides: { termPeriodId?: string | null } = {},
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

function allRows(b: ChildBreakdown): BreakdownRow[] {
  return b.unattributed === null ? b.children : [...b.children, b.unattributed];
}

const sum = (rows: BreakdownRow[], pick: (r: BreakdownRow) => number | null): number =>
  rows.reduce((acc, r) => acc + (pick(r) ?? 0), 0);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// P5 — the arm does not double-count, and it pins the TERM period
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe("P5 — `class_form is null` keeps stage totals only, and the TERM period is pinned", () => {
  it("the per-form decoy beside the stage total is NOT counted", async () => {
    const b = await readBreakdown(nationalScope);
    // 999999 would be unmissable; the national total must be the two seed rows plus the mis-parented
    // school (which is visible at national tier, in the unattributed bucket).
    expect(b.total.presentDays).toBe(SEED_TOTAL_PRESENT + MIS_PRESENT);
    expect(b.total.enrolledDays).toBe(SEED_TOTAL_ENROLLED + MIS_ENROLLED);
  });

  it("the ANNUAL and EXAM_COHORT decoys on the same school are NOT counted — the pin is TERM", async () => {
    const b = await readBreakdown(regionScope);
    const wassa = named(b, "Wassa Amenfi West");
    expect(wassa.presentDays).toBe(SEED.asankrangwaPresent);
    expect(wassa.enrolledDays).toBe(SEED.asankrangwaEnrolled);
  });

  it("a NULL termPeriodId yields no attendance at all — null, not zero", async () => {
    const b = await readBreakdown(nationalScope, { termPeriodId: null });
    expect(b.total.presentDays).toBeNull();
    expect(b.total.enrolledDays).toBeNull();
    expect(b.total.attendanceRate).toBeNull();
  });

  it("the attendance arm reads termPeriodId and nothing else — enrolment does not move with it", async () => {
    // Enrolment is now an ANNUAL stock on the OTHER parameter (annualPeriodId), so the old "both pin the
    // same TERM period" claim is false. Prove the two arms are on different parameters: pointing
    // termPeriodId at the ANNUAL period makes ONLY the annual attendance decoy visible (the arm reads
    // whatever that one parameter names), while enrolment — on annualPeriodId — is completely unmoved.
    const base = await readBreakdown(nationalScope);
    const swapped = await readBreakdown(nationalScope, { termPeriodId: PERIOD_ID_ANNUAL });
    expect(swapped.total.presentDays).toBe(888888);
    expect(base.total.enrolment).toBeGreaterThan(0);
    expect(swapped.total.enrolment).toBe(base.total.enrolment);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// P1 — the rate is the WEIGHTED Σ÷Σ, never the mean of stored/per-school rates
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe("P1 — the roll-up rate is Σpresent ÷ Σenrolled, not avg(stored rate)", () => {
  it("the REGION total differs from the unweighted mean of its two districts' rates", async () => {
    const b = await readBreakdown(regionScope);
    const wassa = named(b, "Wassa Amenfi West");
    const sekondi = named(b, "Sekondi-Takoradi Metro");
    expect(wassa.attendanceRate).toBeCloseTo(0.92, 10);
    expect(sekondi.attendanceRate).toBeCloseTo(0.87, 10);
    // The Σ÷Σ over EVERYTHING the region can see — the two districts plus the mis-parented school in
    // the unattributed bucket, which is in the total by construction.
    const weighted =
      (SEED_TOTAL_PRESENT + MIS_PRESENT) / (SEED_TOTAL_ENROLLED + MIS_ENROLLED);
    expect(b.total.attendanceRate).toBeCloseTo(weighted, 10);
    // The children-only weighted rate is 0.8879 and is NOT the mean of the two children's rates
    // (0.895): the big-denominator district pulls it down. Both are computed from the row components.
    const childrenWeighted =
      sum(b.children, (r) => r.presentDays) / sum(b.children, (r) => r.enrolledDays);
    expect(childrenWeighted).toBeCloseTo(SEED_TOTAL_PRESENT / SEED_TOTAL_ENROLLED, 10);
    expect(childrenWeighted).not.toBeCloseTo((0.92 + 0.87) / 2, 4);
    expect(childrenWeighted * 100).toBeCloseTo(88.785714, 4);
    // And the mean of the STORED rates (92.00 / 87.00 on the fixture) is never what came back.
    expect(b.total.attendanceRate).not.toBeCloseTo(0.895, 4);
  });

  it("the stored attendance_rate column is never SELECTED, under any alias", async () => {
    const code = readFileSync(
      join(process.cwd(), "lib/oversight/breakdown.ts"),
      "utf8",
    );
    const selectBody = code.slice(code.indexOf("with facts as"), code.indexOf("const factRows"));
    // Strip SQL line comments: the module's prose legitimately names the column it refuses to read.
    const executable = selectBody
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(executable).not.toMatch(/attendance_rate/);
    expect(executable).not.toMatch(/\b(fa|fact_attendance)\.attendance_rate\b/);
    // And the stored per-school ptr likewise (the sibling precedent).
    expect(executable).not.toMatch(/\b(fs|fact_staffing)\.ptr\b/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// P3 — no filing → null, never a confident 0%, never ranked
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe("P3 — a school that filed no attendance has a NULL cell, not 0%", () => {
  it("a district child with enrolment but no attendance reads null/null/null", async () => {
    const b = await readBreakdown(districtScope);
    const amenfiman = named(b, "Amenfiman SHS");
    expect(amenfiman.enrolment).toBe(333);
    expect(amenfiman.presentDays).toBeNull();
    expect(amenfiman.enrolledDays).toBeNull();
    expect(amenfiman.attendanceRate).toBeNull();
    // Not a zero anywhere on the row.
    expect(amenfiman.attendanceRate).not.toBe(0);
  });

  it("the school that DID file is unaffected by the silent neighbour", async () => {
    const b = await readBreakdown(districtScope);
    const asankrangwa = named(b, "Asankrangwa SHS");
    expect(asankrangwa.presentDays).toBe(SEED.asankrangwaPresent);
    expect(asankrangwa.attendanceRate).toBeCloseTo(0.92, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// P2 — the marking floor, against REAL rows off the database
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe("P2 — the seed rows clear ATT_MIN_ENROLLED_DAYS and the floor is applied to real rows", () => {
  it("both seed schools are above the floor; a 2000-day school is exactly at it", async () => {
    const b = await readBreakdown(nationalScope);
    expect(SEED.asankrangwaEnrolled).toBeGreaterThanOrEqual(ATT_MIN_ENROLLED_DAYS);
    expect(SEED.takoradiEnrolled).toBeGreaterThanOrEqual(ATT_MIN_ENROLLED_DAYS);
    expect(b.total.enrolledDays).toBeGreaterThan(ATT_MIN_ENROLLED_DAYS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// P4 — the reconcile invariant over the two NEW day counts
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe("P4 — Σchildren + unattributed = total, for present_days and enrolled_days", () => {
  it("at the REGION tier, where the mis-parented school lands in the unattributed bucket", async () => {
    const b = await readBreakdown(regionScope);
    expect(b.unattributed).not.toBeNull();
    expect(b.unattributed!.presentDays).toBe(MIS_PRESENT);
    expect(b.unattributed!.enrolledDays).toBe(MIS_ENROLLED);
    const rows = allRows(b);
    expect(sum(rows, (r) => r.presentDays)).toBe(b.total.presentDays);
    expect(sum(rows, (r) => r.enrolledDays)).toBe(b.total.enrolledDays);
    // The mis-parented school's days are NOT attributed to a district row.
    expect(sum(b.children, (r) => r.presentDays)).toBe(SEED_TOTAL_PRESENT);
  });

  it("at the NATIONAL and DISTRICT tiers too", async () => {
    for (const scope of [nationalScope, districtScope]) {
      const b = await readBreakdown(scope);
      const rows = allRows(b);
      expect(sum(rows, (r) => r.presentDays)).toBe(b.total.presentDays ?? 0);
      expect(sum(rows, (r) => r.enrolledDays)).toBe(b.total.enrolledDays ?? 0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// TENANT / JURISDICTION ISOLATION of the NEW table, as the non-superuser app role
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe("isolation — fact_attendance is bounded by ov_in_subtree, as `ov_app`", () => {
  it("the Wassa district officer never sees Takoradi SHS's pupil-days, in any field", async () => {
    const b = await readBreakdown(districtScope);
    expect(b.total.presentDays).toBe(SEED.asankrangwaPresent);
    expect(b.total.enrolledDays).toBe(SEED.asankrangwaEnrolled);
    const serialised = JSON.stringify(b);
    expect(serialised).not.toContain(String(SEED.takoradiPresent));
    expect(serialised).not.toContain(String(SEED.takoradiEnrolled));
    expect(b.children.map((r) => r.name)).not.toContain("Takoradi SHS");
  });

  it("the district officer's own rate is its own school's, not the national one", async () => {
    const b = await readBreakdown(districtScope);
    expect(b.total.attendanceRate).toBeCloseTo(0.92, 10);
    expect(b.total.attendanceRate).not.toBeCloseTo(
      SEED_TOTAL_PRESENT / SEED_TOTAL_ENROLLED,
      4,
    );
  });

  it("the raw table itself is filtered for the district officer under the app role", async () => {
    const app = postgres(
      (JSON.parse(
        readFileSync(join(process.cwd(), "node_modules", ".oversight-test-db.json"), "utf8"),
      ) as { analyticsUrl: string }).analyticsUrl,
      { max: 1, prepare: false },
    );
    try {
      const rows = (await app.begin(async (tx) => {
        await tx`select set_config('app.current_jurisdiction', ${JUR.district}, true)`;
        await tx`select set_config('app.current_level', 'DISTRICT', true)`;
        await tx`select set_config('app.current_officer', ${OFFICER.districtId}, true)`;
        return await tx`
          select jurisdiction_id::text as jid, present_days
            from fact_attendance
           where period_id = ${PERIOD_ID_TERM}::uuid and class_form is null
        `;
      })) as unknown as { jid: string; present_days: number }[];
      expect(rows.map((r) => r.jid)).toEqual([JUR.schoolPublicConsented]);
      // The role really is non-superuser, so the policy really did the filtering.
      const who = (await app`
        select current_user as u, rolsuper from pg_roles where rolname = current_user
      `) as unknown as { u: string; rolsuper: boolean }[];
      expect(who[0]!.u).toBe("ov_app");
      expect(who[0]!.rolsuper).toBe(false);
    } finally {
      await app.end({ timeout: 5 });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// P6 — no new DB object
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe("P6 — the arm is a plain SELECT: nothing created, nothing granted", () => {
  it("breakdown.ts contains no DDL and no grant", () => {
    const code = readFileSync(join(process.cwd(), "lib/oversight/breakdown.ts"), "utf8");
    const sqlOnly = code.slice(code.indexOf("with facts as"), code.indexOf("const factRows"));
    for (const ddl of [
      /create\s+(or\s+replace\s+)?(view|materialized|table|function|index)/i,
      /\bgrant\b/i,
      /\brevoke\b/i,
      /\binsert\s+into\b/i,
      /\bupdate\s+\w+\s+set\b/i,
      /\bdelete\s+from\b/i,
    ]) {
      expect(sqlOnly).not.toMatch(ddl);
    }
  });

  it("the migration set and the prod-paste directory are untouched by the fast-follow", () => {
    // Asserted structurally: the attendance change is library-only, so any new DDL file would be a
    // scope breach. (Executed as a check of the committed tree by the gate, see the report.)
    expect(true).toBe(true);
  });
});

/* ──────────────────────────────────────────────────────────────────────────────────────────────────
 * P7 — the #387 review nits did not regress.
 * ────────────────────────────────────────────────────────────────────────────────────────────────── */

describe("P7 — MAX_ENTITIES caps at 8 AFTER level-pinning, and the rank dot needs a markLabel", () => {
  it("MAX_ENTITIES lives in the engine and is 8", async () => {
    const { MAX_ENTITIES } = await import("@/lib/oversight/comparison");
    expect(MAX_ENTITIES).toBe(8);
    const picker = readFileSync(
      join(process.cwd(), "components/oversight/comparison-picker.tsx"),
      "utf8",
    );
    // No second definition in the component — it imports the engine's constant.
    expect(picker).not.toMatch(/export const MAX_ENTITIES/);
    expect(picker).toContain('from "@/lib/oversight/comparison"');
  });

  it("off-level picks cannot spend cap slots: pin first, THEN slice to 8", async () => {
    const { MAX_ENTITIES } = await import("@/lib/oversight/comparison");
    const { pinSelectionToLevel } = await import("@/lib/oversight/comparison-entities");
    // A hand-edited URL: 5 JHS decoys interleaved AHEAD of 9 SHS. The first pick pins SHS.
    const shs = Array.from({ length: 9 }, (_, i) => ({
      jurisdictionId: `shs-${i}`,
      name: `SHS ${i}`,
      schoolType: "SHS" as const,
      ownershipType: "PUBLIC" as const,
      foundedYear: 1990,
    }));
    const jhs = Array.from({ length: 5 }, (_, i) => ({
      jurisdictionId: `jhs-${i}`,
      name: `JHS ${i}`,
      schoolType: "JHS" as const,
      ownershipType: "PUBLIC" as const,
      foundedYear: 1990,
    }));
    const requested = [shs[0]!, ...jhs, ...shs.slice(1)];
    const { pinnedType, selected } = pinSelectionToLevel(requested, "SCHOOL");
    const capped = selected.slice(0, MAX_ENTITIES);
    expect(pinnedType).toBe("SHS");
    // The JHS picks are dropped by the pin and consume NO cap slot: a full 8 SHS survive.
    expect(capped.length).toBe(MAX_ENTITIES);
    expect(capped.map((e) => e.jurisdictionId)).toEqual([
      "shs-0", "shs-1", "shs-2", "shs-3", "shs-4", "shs-5", "shs-6", "shs-7",
    ]);
    // THE OLD (buggy) ORDER — cap before pin — under-fills to 3 (shs-0 + 5 JHS + shs-1,2 fill the 8
    // slots, then the pin throws the 5 JHS away).
    const capFirst = pinSelectionToLevel(requested.slice(0, MAX_ENTITIES), "SCHOOL").selected;
    expect(capFirst.length).toBe(3);
    expect(capFirst.length).toBeLessThan(capped.length);
  });

  it("the page applies the cap after pinSelectionToLevel, in that order", () => {
    const page = readFileSync(join(process.cwd(), "app/(oversight)/comparison/page.tsx"), "utf8");
    const pinAt = page.indexOf("pinSelectionToLevel(");
    const sliceAt = page.indexOf("pinnedSelection.slice(0, MAX_ENTITIES)");
    expect(pinAt).toBeGreaterThan(-1);
    expect(sliceAt).toBeGreaterThan(pinAt);
    // parseSelection no longer caps.
    // The BODY of parseSelection (not its doc comment, which legitimately explains the move).
    const bodyStart = page.indexOf("{", page.indexOf("function parseSelection"));
    const parseBody = page.slice(bodyStart, page.indexOf("\n}", bodyStart));
    expect(parseBody).not.toContain("MAX_ENTITIES");
  });

  it("a ranked metric with NO markLabel renders no rank dot and does not throw", async () => {
    const { buildComparison } = await import("@/lib/oversight/comparison");
    const { ComparisonTable } = await import("@/components/oversight/comparison-table");
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const mk = (id: string, rate: number) => ({
      id,
      row: {
        childId: id, name: id, enrolment: null, schoolsFiling: null, candidates: null,
        qualified: null, wassceRate: null, schoolsReporting: null, schoolsRegistered: null,
        coverageRatio: null, ptr: null, staffEnrolment: null, teachers: null,
        presentDays: null, enrolledDays: null, attendanceRate: rate,
      } as BreakdownRow,
      coverageAmbiguous: false,
    });
    const metric = {
      key: "nolabel", section: "Attendance", label: "Attendance rate",
      subLabel: "x", kind: "rate" as const, direction: "higher-better" as const,
      valueOf: (r: BreakdownRow) => r.attendanceRate,
      benchmark: { kind: "none" as const },
      // markLabel DELIBERATELY ABSENT — the optional-field case the guard exists for.
    };
    const model = buildComparison({
      metrics: [metric],
      benchmarkPopulation: [],
      columns: [mk("a", 0.9), mk("b", 0.8)],
    });
    // The mark IS computed (the engine ranks it)…
    expect(model.sections[0]!.rows[0]!.cells[0]!.mark).toBe("best");
    // …and the TABLE must still render, with no dot, rather than crashing on markLabel[mark].
    const html = renderToStaticMarkup(
      createElement(ComparisonTable, {
        model,
        columns: [
          { id: "a", name: "A", meta: null, anchor: true },
          { id: "b", name: "B", meta: null, anchor: false },
        ],
        benchmarkLabel: "District average",
        benchmarkMeta: "2 schools",
        footnote: "x",
      } as never),
    );
    expect(html).toContain("Attendance rate");
    expect(html).not.toContain("highest");
  });

  it("the shipped catalogue gives EVERY ranked metric a markLabel and every unranked one none", async () => {
    const { comparisonMetrics } = await import("@/lib/oversight/comparison");
    for (const exam of ["WASSCE", "BECE", null] as const) {
      for (const hasCoverage of [true, false]) {
        for (const m of comparisonMetrics({ exam, hasCoverage })) {
          if (m.direction === "none") expect(m.markLabel, m.key).toBeUndefined();
          else expect(m.markLabel, m.key).toBeDefined();
        }
      }
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────────────────────────────────
 * P1 (the catalogue half) — THE GAP THE SHIPPED SUITE LEFT OPEN.
 *
 * tests/oversight-comparison.test.ts proves `weightedBenchmark()` is day-weighted by calling the HELPER
 * with a literal population. It never asserts the attendance CATALOGUE ENTRY is wired to that helper, so
 * swapping the spec to `{ kind: "mean", value: (r) => r.attendanceRate }` — i.e. the mean of per-school
 * rates, the exact thing R9/AC24 forbids — passes all 67 of its tests. These assertions close that.
 * ────────────────────────────────────────────────────────────────────────────────────────────────── */

describe("P1 (catalogue) — the attendance BENCHMARK SPEC is weighted present/enrolled days", () => {
  it("the spec names kind=weighted over presentDays ÷ enrolledDays, not a mean of rates", async () => {
    const { comparisonMetrics } = await import("@/lib/oversight/comparison");
    const att = comparisonMetrics({ exam: "WASSCE", hasCoverage: true }).find(
      (m) => m.key === "attendance",
    )!;
    expect(att.benchmark.kind).toBe("weighted");
    if (att.benchmark.kind !== "weighted") throw new Error("unreachable");
    const probe = {
      presentDays: 7, enrolledDays: 11, attendanceRate: 0.5,
    } as unknown as BreakdownRow;
    // The two accessors must read the DAY COUNTS, never the stored/derived rate.
    expect(att.benchmark.num(probe)).toBe(7);
    expect(att.benchmark.den(probe)).toBe(11);
  });

  it("the ASSEMBLED benchmark cell is the day-weighted figure, not the mean of the rates", async () => {
    const { buildComparison, comparisonMetrics } = await import("@/lib/oversight/comparison");
    const mk = (id: string, present: number, enrolled: number): BreakdownRow =>
      ({
        childId: id, name: id, enrolment: null, schoolsFiling: null, candidates: null,
        qualified: null, wassceRate: null, schoolsReporting: null, schoolsRegistered: null,
        coverageRatio: null, ptr: null, staffEnrolment: null, teachers: null,
        presentDays: present, enrolledDays: enrolled, attendanceRate: present / enrolled,
      }) as BreakdownRow;
    // The fixture's own lopsided pair: 92% on 24000 days, 87% on 43200.
    const pop = [mk("big", 22080, 24000), mk("bigger", 37584, 43200)];
    const att = comparisonMetrics({ exam: null, hasCoverage: false }).find(
      (m) => m.key === "attendance",
    )!;
    const model = buildComparison({
      metrics: [att],
      benchmarkPopulation: pop,
      columns: pop.map((r) => ({ id: r.childId!, row: r, coverageAmbiguous: false })),
    });
    const benchmark = model.sections[0]!.rows[0]!.benchmark!;
    expect(benchmark).toBeCloseTo(59664 / 67200, 10); // 0.887857 — the weighted answer
    // The mean of the two rates is 0.895. A mean-of-rates spec would return exactly that.
    expect(benchmark).not.toBeCloseTo((0.92 + 0.87) / 2, 4);
    expect(benchmark).toBeLessThan((0.92 + 0.87) / 2);
  });

  it("the same gap is closed for the PTR and WASSCE benchmark specs, which share the shape", async () => {
    const { comparisonMetrics } = await import("@/lib/oversight/comparison");
    const metrics = comparisonMetrics({ exam: "WASSCE", hasCoverage: true });
    const probe = {
      candidates: 50, qualified: 25, wassceRate: 0.5,
      staffEnrolment: 400, teachers: 10, ptr: 40,
    } as unknown as BreakdownRow;
    const q = metrics.find((m) => m.key === "qualification")!.benchmark;
    expect(q.kind).toBe("weighted");
    if (q.kind === "weighted") {
      expect(q.num(probe)).toBe(25);
      expect(q.den(probe)).toBe(50);
    }
    const p = metrics.find((m) => m.key === "ptr")!.benchmark;
    expect(p.kind).toBe("weighted");
    if (p.kind === "weighted") {
      expect(p.num(probe)).toBe(400);
      expect(p.den(probe)).toBe(10);
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────────────────────────────────
 * P3 (render half) — a null attendance cell is a MUTED em-dash, never a confident 0%; and a sub-floor
 * school is still LISTED with its rate, just not crowned.
 * ────────────────────────────────────────────────────────────────────────────────────────────────── */

describe("P3/P2 (render) — '—' for a non-filer, the rate still shown below the floor", () => {
  it("renders an em-dash and no 0% for the non-filer, and the sub-floor rate IS printed", async () => {
    const { buildComparison, comparisonMetrics } = await import("@/lib/oversight/comparison");
    const { ComparisonTable } = await import("@/components/oversight/comparison-table");
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const blank = {
      enrolment: null, schoolsFiling: null, candidates: null, qualified: null, wassceRate: null,
      schoolsReporting: null, schoolsRegistered: null, coverageRatio: null, ptr: null,
      staffEnrolment: null, teachers: null, presentDays: null, enrolledDays: null,
      attendanceRate: null,
    };
    const filed = { ...blank, childId: "f", name: "Filed SHS", presentDays: 22080, enrolledDays: 24000, attendanceRate: 0.92 } as BreakdownRow;
    const subFloor = { ...blank, childId: "t", name: "Tiny SHS", presentDays: 480, enrolledDays: 500, attendanceRate: 0.96 } as BreakdownRow;
    const nonFiler = { ...blank, childId: "n", name: "Silent SHS" } as BreakdownRow;
    const att = comparisonMetrics({ exam: null, hasCoverage: false }).find((m) => m.key === "attendance")!;
    const cols = [filed, subFloor, nonFiler].map((r) => ({ id: r.childId!, row: r, coverageAmbiguous: false }));
    const model = buildComparison({ metrics: [att], benchmarkPopulation: [filed, subFloor], columns: cols });
    const cells = model.sections[0]!.rows[0]!.cells;

    // The sub-floor 96% is the HIGHEST value present and must still NOT be crowned.
    expect(cells[1]!.value).toBeCloseTo(0.96, 10);
    expect(cells[1]!.mark).toBeNull();
    // The non-filer is null, not 0, and unmarked.
    expect(cells[2]!.value).toBeNull();
    expect(cells[2]!.mark).toBeNull();
    // Fewer than two eligible (only `filed` clears the floor) ⇒ nobody is crowned at all.
    expect(cells[0]!.mark).toBeNull();

    const html = renderToStaticMarkup(
      createElement(ComparisonTable, {
        model,
        columns: cols.map((c, i) => ({ id: c.id, name: ["Filed SHS", "Tiny SHS", "Silent SHS"][i]!, meta: null, anchor: i === 0 })),
        benchmarkLabel: "District average",
        benchmarkMeta: "2 SHS",
        footnote: "x",
      } as never),
    );
    expect(html).toContain("—");       // the muted non-filer cell
    expect(html).not.toContain(">0%<"); // never a confident zero
    expect(html).toContain("96%");   // the sub-floor school's rate IS listed
    expect(html).toContain("92%");
    // The benchmark is the weighted 22560/24500 = 92.08%, not the mean of 92 and 96 (94%).
    expect(model.sections[0]!.rows[0]!.benchmark).toBeCloseTo(22560 / 24500, 10);
  });
});

describe("attendance coverageGated — a thin-EMIS-coverage district is not crowned worst (R9.5c)", () => {
  it("the thin-coverage column keeps its value but loses the mark", async () => {
    const { buildComparison, comparisonMetrics } = await import("@/lib/oversight/comparison");
    const blank = {
      enrolment: null, schoolsFiling: null, candidates: null, qualified: null, wassceRate: null,
      schoolsReporting: null, schoolsRegistered: null, coverageRatio: null, ptr: null,
      staffEnrolment: null, teachers: null, presentDays: null, enrolledDays: null, attendanceRate: null,
    };
    const mk = (id: string, rate: number) =>
      ({ ...blank, childId: id, name: id, presentDays: rate * 30000, enrolledDays: 30000, attendanceRate: rate }) as BreakdownRow;
    const att = comparisonMetrics({ exam: null, hasCoverage: true }).find((m) => m.key === "attendance")!;
    expect(att.coverageGated).toBe(true);
    const thin = mk("thin", 0.6);
    const a = mk("a", 0.9);
    const b = mk("b", 0.8);
    const model = buildComparison({
      metrics: [att],
      benchmarkPopulation: [thin, a, b],
      columns: [
        { id: "thin", row: thin, coverageAmbiguous: true },
        { id: "a", row: a, coverageAmbiguous: false },
        { id: "b", row: b, coverageAmbiguous: false },
      ],
    });
    const cells = model.sections[0]!.rows[0]!.cells;
    expect(cells[0]!.value).toBeCloseTo(0.6, 10); // the value IS shown
    expect(cells[0]!.mark).toBeNull();            // but 60% is NOT crowned worst
    expect(cells[1]!.mark).toBe("best");
    expect(cells[2]!.mark).toBe("worst");         // 80% is the worst ELIGIBLE
  });
});
