import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath, relative as relativePath } from "node:path";
import { getTableName, and, eq, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { houses } from "@/db/schema";

/**
 * 🔴 OC-295-A — THE FENCE. Nine boarding/WASSCE/sickbay/PTA reads enumerate ALL houses by school_id;
 * in a COMBINED school (boarding + sports houses in the same `house` table) they must pick up BOARDING
 * houses ONLY. Each read carries its own `eq(houses.kind, "BOARDING")` predicate (they share no helper).
 *
 * Two layers of proof:
 *   1. DYNAMIC SOURCE-SCAN — glob every source file under lib/ · app/ · features/ and find each
 *      school-scoped `houses` read (`.from(houses)` / `Join(houses`). A read is an ENUMERATOR unless its
 *      statement binds `houses.id` (a by-id point read / by-id join — those are safe and skipped). Every
 *      enumerator MUST carry `eq(houses.kind, "BOARDING")` — or be a listed sports-house surface that
 *      instead fences `eq(houses.kind, "SPORTS")`. No hardcoded site list: a 12th unfenced enumerator
 *      added anywhere reds this on its own.
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
// 1) DYNAMIC SOURCE-SCAN — every school-scoped houses ENUMERATOR carries the kind fence.
//    No hardcoded site list: a new unfenced enumerator reds this test on its own.
// ---------------------------------------------------------------------------
// Test file lives at <repo>/lib/actions; the app root is two levels up.
const REPO_ROOT = resolvePath(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const SCAN_DIRS = ["lib", "app", "features"];

// The Basic sports-house surfaces read `kind='SPORTS'` (the roster picker + the settings list). They are
// deliberately NOT boarding-fenced. Each is asserted below to carry an explicit `eq(houses.kind, "SPORTS")`
// fence, so an allowlist entry can never hide an unfenced boarding leak. Genuine by-id point reads / by-id
// joins need no entry — they are auto-skipped because their statement binds `houses.id`.
const SPORTS_SURFACE_ALLOWLIST = [
  "app/(app)/classes/[id]/page.tsx",
  "app/(app)/settings/houses/page.tsx",
];

function walkTsFiles(dir: string): string[] {
  let out: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // dir absent (e.g. no features/) — skip
  }
  for (const e of entries) {
    const full = resolvePath(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      out = out.concat(walkTsFiles(full));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

type Site = { file: string; line: number; window: string };

// Every `.from(houses)` / `Join(houses` read + its statement text (from the read line through the first
// line that closes the statement with a `;`). Drizzle read chains are single semicolon-terminated
// statements, so this reliably captures the WHERE / join-ON predicates that belong to THIS read.
function houseReadSites(): Site[] {
  const sites: Site[] = [];
  for (const rel of SCAN_DIRS) {
    for (const file of walkTsFiles(resolvePath(REPO_ROOT, rel))) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!/\.from\(houses\)|Join\(houses/.test(lines[i])) continue;
        const parts: string[] = [];
        for (let j = i; j < lines.length && j < i + 30; j++) {
          parts.push(lines[j]);
          if (lines[j].includes(";")) break;
        }
        sites.push({
          file: relativePath(REPO_ROOT, file).replace(/\\/g, "/"),
          line: i + 1,
          window: parts.join("\n"),
        });
      }
    }
  }
  return sites;
}

describe("🔴 every school-scoped houses enumerator carries the kind fence (dynamic source-scan)", () => {
  const sites = houseReadSites();
  const byId = sites.filter((s) => s.window.includes("houses.id"));
  const enumerators = sites.filter((s) => !s.window.includes("houses.id"));
  const boardingFenced = enumerators.filter((s) =>
    s.window.includes(`eq(houses.kind, "BOARDING")`),
  );
  const notBoarding = enumerators.filter(
    (s) => !s.window.includes(`eq(houses.kind, "BOARDING")`),
  );
  const sportsSurface = notBoarding.filter((s) =>
    SPORTS_SURFACE_ALLOWLIST.includes(s.file),
  );
  const unfenced = notBoarding.filter((s) => !SPORTS_SURFACE_ALLOWLIST.includes(s.file));

  it("the scan is live — it finds by-id point reads AND boarding-fenced enumerators (never vacuous)", () => {
    expect(sites.length).toBeGreaterThan(0);
    expect(byId.length).toBeGreaterThan(0);
    expect(boardingFenced.length).toBeGreaterThan(0);
  });

  it("every allowlist entry is a real sports-surface read that explicitly fences kind='SPORTS'", () => {
    for (const f of SPORTS_SURFACE_ALLOWLIST) {
      const hit = sportsSurface.find((s) => s.file === f);
      expect(hit, `stale allowlist entry — no unfenced houses read in ${f}`).toBeTruthy();
      expect(hit!.window, `${f} must fence kind='SPORTS'`).toContain(
        `eq(houses.kind, "SPORTS")`,
      );
    }
  });

  it("NO school-scoped houses enumerator is unfenced — a new one reds this on its own", () => {
    expect(
      unfenced.map((s) => `${s.file}:${s.line}`),
      'unfenced houses enumerator(s) — add eq(houses.kind, "BOARDING") or the SPORTS-surface allowlist',
    ).toEqual([]);
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
