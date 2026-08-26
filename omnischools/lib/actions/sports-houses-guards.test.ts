import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * 🔴 OC-295-A — the sports-house CRUD gate (Sarah) + the roster assign kind-validation (Sarah).
 *
 *   • CRUD gate — createSportsHouse / updateSportsHouse / archiveSportsHouse are refused for any role
 *     outside SPORTS_HOUSE_WRITE_ROLES (ADMIN / HEADMASTER) BEFORE any DB work — a hand-crafted POST
 *     that never touched the admin-only settings surface is still refused.
 *   • kind immutability — updateSportsHouse never writes `kind` (the SET payload is captured; it has
 *     no kind key), and never accepts it from the client (the Zod schema strips it).
 *   • assign kind-validation — assignStudentHouse refuses a target that is not a same-tenant SPORTS
 *     house (a boarding-house id, another school's id) and writes NOTHING; a real sports id is accepted
 *     and updates the student. Dropping the kind check would let a boarding house through → RED.
 */

const dialect = new PgDialect();
const paramsOf = (cond: unknown): unknown[] => {
  try {
    return dialect.sqlToQuery(cond as SQL).params;
  } catch {
    return [];
  }
};

// ===========================================================================
// CRUD gate + kind immutability (lib/actions/sports-houses.ts)
// ===========================================================================
describe("sports-house CRUD", () => {
  const setPayloads: Array<Record<string, unknown>> = [];
  const withSchoolSpy = vi.fn(async (_id: string, cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      select: () => {
        const b: Record<string, unknown> = {
          from: () => b,
          where: () => b,
          limit: () => Promise.resolve([{ id: "house-sports", name: "Red", kind: "SPORTS", active: true }]),
          then: (r: (v: unknown) => unknown) =>
            Promise.resolve([{ id: "house-sports", name: "Red", kind: "SPORTS", active: true }]).then(r),
        };
        return b;
      },
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: "new-house" }]) }) }),
      update: () => ({
        set: (payload: Record<string, unknown>) => {
          setPayloads.push(payload);
          return { where: () => Promise.resolve() };
        },
      }),
    };
    return cb(tx);
  });

  const currentUser = { roles: ["ADMIN"] as string[] };

  beforeEach(() => {
    vi.resetModules();
    setPayloads.length = 0;
    withSchoolSpy.mockClear();
    currentUser.roles = ["ADMIN"];

    vi.doMock("@/lib/auth/server", () => ({
      requireSchool: vi.fn(async () => ({ school: { id: "s1" } })),
      resolveActor: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
    }));
    vi.doMock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => currentUser) }));
    vi.doMock("@/lib/db/rls", () => ({
      withSchool: (...a: [string, (tx: unknown) => Promise<unknown>]) => withSchoolSpy(...a),
      isUniqueViolation: () => false,
    }));
    vi.doMock("@/lib/db/audit", () => ({ recordAudit: vi.fn() }));
    vi.doMock("@/lib/revalidate", () => ({ safeRevalidate: vi.fn() }));
  });

  const UUID = "11111111-1111-4111-8111-111111111111";

  it("a non-management role (TEACHER) is refused create/update/archive — no DB access", async () => {
    currentUser.roles = ["TEACHER"];
    const { createSportsHouse, updateSportsHouse, archiveSportsHouse } = await import("./sports-houses");
    for (const res of [
      await createSportsHouse({ name: "Red", colour: "#E4572E" }),
      await updateSportsHouse({ houseId: UUID, name: "Red", colour: "#E4572E" }),
      await archiveSportsHouse({ houseId: UUID }),
    ]) {
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/role/i);
    }
    expect(withSchoolSpy).not.toHaveBeenCalled();
  });

  it("ADMIN create reaches the DB and writes kind='SPORTS'", async () => {
    const { createSportsHouse } = await import("./sports-houses");
    const res = await createSportsHouse({ name: "Blue", colour: "#3858A8" });
    expect(res.ok).toBe(true);
    expect(withSchoolSpy).toHaveBeenCalledTimes(1);
  });

  it("updateSportsHouse NEVER writes `kind` — the SET payload has name + colour only", async () => {
    const { updateSportsHouse } = await import("./sports-houses");
    // Even if a client smuggles kind, the schema strips it and the SET omits it.
    const res = await updateSportsHouse({ houseId: UUID, name: "Green", colour: "#2E7D32", kind: "BOARDING" });
    expect(res.ok).toBe(true);
    expect(setPayloads).toHaveLength(1);
    expect(Object.keys(setPayloads[0])).toEqual(["name", "colour"]);
    expect(setPayloads[0]).not.toHaveProperty("kind");
  });

  it("archive is a SOFT delete — the SET payload is { active: false }, never a hard delete", async () => {
    const { archiveSportsHouse } = await import("./sports-houses");
    const res = await archiveSportsHouse({ houseId: UUID });
    expect(res.ok).toBe(true);
    expect(setPayloads).toEqual([{ active: false }]);
  });
});

// ===========================================================================
// assign kind-validation (lib/actions/classes.ts · assignStudentHouse)
// ===========================================================================
describe("assignStudentHouse kind-validation", () => {
  // Fake house table the tx honours: a query returns a row iff its id is bound AND (the kind fence is
  // absent OR the house is SPORTS). Modelling the DB this way makes dropping the kind check RED the
  // "boarding house is rejected" test (a boarding id would then match).
  const FAKE: Record<string, { kind: string }> = {
    "house-sports": { kind: "SPORTS" },
    "house-boarding": { kind: "BOARDING" },
  };
  const updatedTables: string[] = [];
  const auditCalls: Array<Record<string, unknown>> = [];

  const withSchoolSpy = vi.fn(async (_id: string, cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      select: () => {
        let cond: unknown;
        const b: Record<string, unknown> = {
          from: () => b,
          where: (c: unknown) => {
            cond = c;
            return b;
          },
          limit: () => Promise.resolve(resolveHouse(cond)),
          then: (r: (v: unknown) => unknown) => Promise.resolve(resolveHouse(cond)).then(r),
        };
        return b;
      },
      update: (t: unknown) => {
        updatedTables.push(getTableName(t as never));
        return { set: () => ({ where: () => Promise.resolve() }) };
      },
    };
    return cb(tx);
  });

  function resolveHouse(cond: unknown): Array<{ id: string }> {
    const params = paramsOf(cond);
    const requireSports = params.includes("SPORTS");
    return Object.entries(FAKE)
      .filter(([id, h]) => params.includes(id) && (!requireSports || h.kind === "SPORTS"))
      .map(([id]) => ({ id }));
  }

  const STUDENT = "22222222-2222-4222-8222-222222222222";
  const SPORTS = "aaaaaaaa-0000-4000-8000-000000000001";
  const BOARDING = "bbbbbbbb-0000-4000-8000-000000000002";
  const OTHER_TENANT = "cccccccc-0000-4000-8000-000000000003";

  // The fake keys must be the real UUIDs the action receives.
  beforeEach(() => {
    vi.resetModules();
    updatedTables.length = 0;
    auditCalls.length = 0;
    withSchoolSpy.mockClear();
    delete FAKE["house-sports"];
    delete FAKE["house-boarding"];
    FAKE[SPORTS] = { kind: "SPORTS" };
    FAKE[BOARDING] = { kind: "BOARDING" };

    vi.doMock("@/lib/auth/server", () => ({
      requireSchool: vi.fn(async () => ({ school: { id: "s1" } })),
      assertWriteAccess: vi.fn(async () => {}),
      resolveActor: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
    }));
    vi.doMock("@/lib/db/rls", () => ({
      withSchool: (...a: [string, (tx: unknown) => Promise<unknown>]) => withSchoolSpy(...a),
    }));
    vi.doMock("@/lib/db/audit", () => ({ recordAudit: vi.fn(async (_tx, row) => auditCalls.push(row)) }));
    vi.doMock("@/lib/revalidate", () => ({ safeRevalidate: vi.fn() }));
  });

  it("a BOARDING house id is refused and the student is NOT updated", async () => {
    const { assignStudentHouse } = await import("./classes");
    const res = await assignStudentHouse({ studentId: STUDENT, houseId: BOARDING });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not available/i);
    expect(updatedTables).not.toContain("students");
    expect(auditCalls).toHaveLength(0);
  });

  it("another school's house id is refused (tenant isolation) — no student update", async () => {
    const { assignStudentHouse } = await import("./classes");
    const res = await assignStudentHouse({ studentId: STUDENT, houseId: OTHER_TENANT });
    expect(res.ok).toBe(false);
    expect(updatedTables).not.toContain("students");
  });

  it("a same-tenant SPORTS house id is accepted and updates the student", async () => {
    const { assignStudentHouse } = await import("./classes");
    const res = await assignStudentHouse({ studentId: STUDENT, houseId: SPORTS });
    expect(res.ok).toBe(true);
    expect(updatedTables).toContain("students");
    expect(auditCalls).toHaveLength(1);
  });

  it("houseId null ('None') clears the house without a lookup and updates the student", async () => {
    const { assignStudentHouse } = await import("./classes");
    const res = await assignStudentHouse({ studentId: STUDENT, houseId: null });
    expect(res.ok).toBe(true);
    expect(updatedTables).toContain("students");
  });
});
