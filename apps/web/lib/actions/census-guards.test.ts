import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireSchool, assertAnyRole } from "@/lib/auth/server";
import { recordAudit } from "@/lib/db/audit";
import { generateCensusSnapshot } from "@/lib/reports/census/generate";

/**
 * GOV-8 · behavioural proof of the census generation action (AC GOV8-01/14/15 + audit + status-lock). The DB
 * layer (the composite UNIQUE, FORCE-RLS) is Wells's; THIS pins the app-layer guards:
 *   • the write gate [ADMIN, HEADMASTER] is re-checked BEFORE any DB work (a hand-crafted POST is refused);
 *   • the snapshot is generated server-side for the SESSION school — never a request-supplied school id (14);
 *   • the write is an UPSERT on (school, cadence, academic_year) — idempotent (01);
 *   • a COMPLETED return is not clobbered by a regenerate;
 *   • the audit row is entityType `census_return` (SHOWN), carrying only cadence/year/coverage counts.
 */

vi.mock("@/lib/auth/server", () => ({
  requireSchool: vi.fn(),
  assertAnyRole: vi.fn(async () => {}),
  resolveActor: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
}));
vi.mock("@/lib/db/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ safeRevalidate: vi.fn() }));
vi.mock("@/lib/reports/census/generate", () => ({ generateCensusSnapshot: vi.fn() }));
vi.mock("@/lib/reports/census/schema", () => ({ parseCensusSnapshot: (x: unknown) => x }));
vi.mock("@/lib/reports/census/view", () => ({
  computeCensusView: () => ({ fillPct: 90, fullCount: 9, inScopeCount: 10 }),
}));

const onConflictSpy = vi.fn();
const valuesSpy = vi.fn(() => ({ onConflictDoUpdate: onConflictSpy }));
const insertSpy = vi.fn(() => ({ values: valuesSpy }));
let existingRows: { status: string }[] = [];
const selectChain = {
  from: () => selectChain,
  where: () => selectChain,
  limit: () => Promise.resolve(existingRows),
};
const fakeTx = { select: () => selectChain, insert: insertSpy };
const withSchoolMock = vi.fn(async (_id: string, fn: (tx: unknown) => unknown) => fn(fakeTx));
vi.mock("@/lib/db/rls", () => ({
  withSchool: (id: string, fn: (tx: unknown) => unknown) => withSchoolMock(id, fn),
}));

const { saveCensusReturn } = await import("./census");

const snapshotFixture = {
  version: 1 as const,
  cadence: "MID_YEAR" as const,
  academicYear: "2025/26",
  censusDate: "2026-03-15",
  generatedAt: "2026-03-15T00:00:00.000Z",
  period: null,
  identification: {},
  sections: {},
};

beforeEach(() => {
  existingRows = [];
  vi.mocked(requireSchool).mockResolvedValue({
    school: { id: "s1", name: "Demo", schoolType: "BASIC", gesCode: "X", shortName: "DEMO" },
    user: { roles: ["ADMIN"] },
  } as never);
  vi.mocked(assertAnyRole).mockReset().mockResolvedValue(undefined);
  vi.mocked(recordAudit).mockReset();
  vi.mocked(generateCensusSnapshot).mockReset().mockResolvedValue(snapshotFixture as never);
  withSchoolMock.mockClear();
  insertSpy.mockClear();
  valuesSpy.mockClear();
  onConflictSpy.mockClear();
});

describe("GOV8-14 · dual write gate, re-checked before any DB work", () => {
  it("throws + never touches the DB when the role gate fails", async () => {
    vi.mocked(assertAnyRole).mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(saveCensusReturn({ cadence: "MID_YEAR" })).rejects.toThrow();
    expect(withSchoolMock).not.toHaveBeenCalled();
  });

  it("the gate is exactly CENSUS_WRITE_ROLES [ADMIN, HEADMASTER]", async () => {
    await saveCensusReturn({ cadence: "MID_YEAR" });
    expect([...(vi.mocked(assertAnyRole).mock.calls[0]?.[0] as readonly string[])]).toEqual(["ADMIN", "HEADMASTER"]);
  });

  it("generates for the SESSION school id — never a request-supplied one", async () => {
    await saveCensusReturn({ cadence: "MID_YEAR", schoolId: "attacker-school" } as never);
    expect(vi.mocked(generateCensusSnapshot).mock.calls[0][0]).toBe("s1");
  });
});

describe("GOV8-01 · idempotent UPSERT on (school, cadence, academic_year)", () => {
  it("issues onConflictDoUpdate on the 3-column target, DRAFT-guarded, with the snapshot in the set", async () => {
    const res = await saveCensusReturn({ cadence: "MID_YEAR" });
    expect(res).toEqual({ ok: true, academicYear: "2025/26" });
    expect(onConflictSpy).toHaveBeenCalledTimes(1);
    const conflict = onConflictSpy.mock.calls[0][0] as { target: unknown[]; set: Record<string, unknown>; where: unknown };
    expect(conflict.target).toHaveLength(3); // schoolId, cadence, academicYear
    expect(conflict.where).toBeDefined(); // WHERE status = 'DRAFT'
    for (const k of ["status", "autoSnapshot", "censusDate"]) expect(conflict.set).toHaveProperty(k);
  });
});

describe("status lock + cadence + audit", () => {
  it("a COMPLETED return is not clobbered — no insert, returns a friendly error", async () => {
    existingRows = [{ status: "COMPLETED" }];
    const res = await saveCensusReturn({ cadence: "MID_YEAR" });
    expect(res.ok).toBe(false);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("GOV8-15 · the cadence is carried into generation + the audit row (SHOWN entityType)", async () => {
    await saveCensusReturn({ cadence: "ANNUAL" });
    expect(vi.mocked(generateCensusSnapshot).mock.calls[0][1]).toMatchObject({ cadence: "ANNUAL" });
    const entry = vi.mocked(recordAudit).mock.calls[0][1];
    expect(entry.entityType).toBe("census_return");
    expect(entry.actionType).toBe("generated");
    expect(entry.after).toMatchObject({ cadence: "ANNUAL", academicYear: "2025/26", fillPct: 90 });
  });

  it("rejects an invalid cadence before any DB work", async () => {
    const res = await saveCensusReturn({ cadence: "WEEKLY" });
    expect(res.ok).toBe(false);
    expect(withSchoolMock).not.toHaveBeenCalled();
  });
});
