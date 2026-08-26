import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableName, and, eq, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { houses } from "@/db/schema";

/**
 * 🔴 OC-295-A — THE FENCE. Nine boarding/WASSCE/sickbay/PTA reads enumerate ALL houses by school_id;
 * in a COMBINED school (boarding + sports houses in the same `house` table) they must pick up BOARDING
 * houses ONLY. Each read carries its own `eq(houses.kind, "BOARDING")` predicate (they share no helper).
 *
 * Two layers of proof:
 *   1. SOURCE-SCAN — every one of the 11 enumerator sites literally carries the kind predicate (drop one
 *      → its file's count falls → RED). This is the per-predicate mutation guard the AC demands.
 *   2. BEHAVIOURAL — a filtering fake tx returns BOTH houses when a query's WHERE lacks the BOARDING
 *      param and BOARDING-only when it carries it (serialised via PgDialect). The boarding landing and
 *      the PTA House-PTA auto-create are run against it: the sports house appears in NEITHER. Removing
 *      the predicate from the query flips the fake tx to two houses → the sports house leaks → RED.
 */

const dialect = new PgDialect();

/** True iff the serialised WHERE binds "BOARDING" as a param — i.e. the kind fence is present. */
function whereFencesBoarding(cond: unknown): boolean {
  if (!cond) return false;
  try {
    const { params } = dialect.sqlToQuery(cond as SQL);
    return params.some((p) => p === "BOARDING");
  } catch {
    return false;
  }
}

// The fake mechanism must NOT be vacuous: an unfenced school-scope WHERE reads false, the fenced one true.
describe("filtering fake tx mechanism is not vacuous", () => {
  it("a school-only WHERE is treated as UNFENCED (would return both houses)", () => {
    expect(whereFencesBoarding(eq(houses.schoolId, "s1"))).toBe(false);
  });
  it("a kind='BOARDING' WHERE is treated as FENCED (BOARDING-only)", () => {
    expect(
      whereFencesBoarding(and(eq(houses.schoolId, "s1"), eq(houses.kind, "BOARDING"))),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1) SOURCE-SCAN — every enumerator site carries eq(houses.kind, "BOARDING").
// ---------------------------------------------------------------------------
const FENCE_SITES: Array<[string, number]> = [
  ["../boarding/roster-data.ts", 1],
  ["../boarding/discipline-data.ts", 1],
  ["../boarding/visiting-notify.ts", 2], // two enumerators in one file
  ["../boarding/resumption-data.ts", 1],
  ["../boarding/visiting-data.ts", 1],
  ["../boarding/programme-data.ts", 1],
  ["../wassce/cohort-data.ts", 1],
  ["./pta.ts", 1],
  ["../pta/setup-data.ts", 1],
  ["../sickbay/chronic-reads.ts", 1],
];

describe("🔴 every all-house enumerator literally carries the kind fence (mutation-per-predicate)", () => {
  for (const [rel, expected] of FENCE_SITES) {
    it(`${rel} fences ${expected} house enumerator(s)`, () => {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      const count = src.split(`eq(houses.kind, "BOARDING")`).length - 1;
      expect(count).toBe(expected);
    });
  }

  it("the fence total across all sites is 11", () => {
    const total = FENCE_SITES.reduce((n, [, c]) => n + c, 0);
    expect(total).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// Filtering fake tx — house query returns BOARDING-only when fenced, both when not.
// ---------------------------------------------------------------------------
const BOARDING_HOUSE = {
  id: "house-boarding",
  name: "Aggrey",
  colour: "#1A2B47",
  gender: null,
  capacity: null,
  hmUserId: null,
  hmName: null,
  kind: "BOARDING",
  active: true,
  foundedYear: null,
  namedAfter: null,
};
const SPORTS_HOUSE = {
  ...BOARDING_HOUSE,
  id: "house-sports",
  name: "Red",
  colour: "#E4572E",
  kind: "SPORTS",
};

const HOUSE_TIER_ROW = {
  tierType: "HOUSE",
  active: true,
  frequencyNorm: null,
  officerRoles: null,
  quorumRule: null,
  duesEnabled: false,
  duesAmount: null,
  duesBasis: null,
  duesCadence: null,
  tierSettings: null,
  configuredAt: new Date(),
};

type Overrides = Record<string, unknown[]>;
const insertedPtaRows: Array<Record<string, unknown>> = [];

function makeTx(overrides: Overrides) {
  const builder = (primary: string | null, whereCond: unknown): Record<string, unknown> => {
    const resolve = () => {
      if (primary === "house") {
        return whereFencesBoarding(whereCond) ? [BOARDING_HOUSE] : [BOARDING_HOUSE, SPORTS_HOUSE];
      }
      return overrides[primary ?? ""] ?? [];
    };
    const b: Record<string, unknown> = {
      from: (t: unknown) => builder(getTableName(t as never), whereCond),
      leftJoin: () => b,
      innerJoin: () => b,
      where: (c: unknown) => builder(primary, c),
      orderBy: () => b,
      groupBy: () => b,
      limit: () => Promise.resolve(resolve()),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(res, rej),
    };
    return b;
  };
  return {
    select: () => builder(null, undefined),
    insert: () => ({
      values: (rows: Record<string, unknown>[]) => {
        insertedPtaRows.push(...rows);
        return { onConflictDoNothing: () => Promise.resolve() };
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
}

// ---------------------------------------------------------------------------
// 2a) BEHAVIOURAL — the boarding landing (listAccessibleHouses) shows NO sports house.
// ---------------------------------------------------------------------------
describe("🔴 boarding landing excludes sports houses at runtime", () => {
  beforeEach(() => vi.resetModules());

  it("listAccessibleHouses returns BOARDING houses only (a COMBINED school's sports house is absent)", async () => {
    vi.doMock("@/lib/db/rls", () => ({
      withSchool: (_id: string, cb: (tx: unknown) => Promise<unknown>) => cb(makeTx({})),
    }));
    const { listAccessibleHouses } = await import("../boarding/roster-data");
    const cards = await listAccessibleHouses("s1", ["ADMIN"], "u1");
    expect(cards.map((c) => c.name)).toContain("Aggrey"); // non-vacuous: the boarding house IS returned
    expect(cards.some((c) => c.name === "Red")).toBe(false); // the sports house is fenced out
    expect(cards).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2b) BEHAVIOURAL — PTA generation creates NO House-PTA for a sports house (the write-path fence).
// ---------------------------------------------------------------------------
describe("🔴 PTA House-PTA auto-create never spawns a governance row for a sports house", () => {
  beforeEach(() => {
    vi.resetModules();
    insertedPtaRows.length = 0;
  });

  it("generatePtas inserts a House-PTA for the boarding house ONLY, never the sports house", async () => {
    vi.doMock("@/lib/auth/server", () => ({
      requireSchool: vi.fn(async () => ({ school: { id: "s1" }, user: { roles: ["ADMIN"] } })),
      assertAnyRole: vi.fn(async () => {}),
      resolveActor: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
    }));
    vi.doMock("@/lib/db/audit", () => ({ recordAudit: vi.fn() }));
    vi.doMock("@/lib/revalidate", () => ({ safeRevalidate: vi.fn() }));
    vi.doMock("@/lib/db/rls", () => ({
      withSchool: (_id: string, cb: (tx: unknown) => Promise<unknown>) =>
        cb(makeTx({ pta_tiers_config: [HOUSE_TIER_ROW] })),
    }));

    const { generatePtas } = await import("./pta");
    const res = await generatePtas();
    expect(res.ok).toBe(true);

    const houseIds = insertedPtaRows
      .filter((r) => r.tierType === "HOUSE")
      .map((r) => r.houseId);
    expect(houseIds).toContain("house-boarding"); // non-vacuous: reconcile DID create a House-PTA
    expect(houseIds).not.toContain("house-sports"); // the sports house got NO governance row
  });
});
