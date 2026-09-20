import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireSchool, assertAnyRole } from "@/lib/auth/server";
import { recordAudit } from "@/lib/db/audit";

/**
 * GOV-7 · behavioural proof of the facilities capture action (AC GOV7-02/04/05/14/16/17). The DB layer
 * (CHECKs, the composite UNIQUE, FORCE-RLS) is Wells's; THIS pins the app-layer guards:
 *   • the management write gate is re-checked BEFORE any DB work (a hand-crafted POST is still refused), and
 *     it is exactly FACILITIES_WRITE_ROLES [ADMIN, HEADMASTER] — no VHA (estates ≠ academics) (GOV7-14);
 *   • the two cross-column CHECKs (good+repair ≤ total; working ≤ total) reject before the DB (GOV7-04);
 *   • core fields are required, optional detail is nullable (GOV7-05);
 *   • the write is an UPSERT on (school, period) — idempotent (GOV7-02);
 *   • there is NO import/bulk action on the module (GOV7-16);
 *   • the audit row is entityType `facilities_snapshot` (SHOWN — GOV7-17).
 */

vi.mock("@/lib/auth/server", () => ({
  requireSchool: vi.fn(),
  assertAnyRole: vi.fn(async () => {}),
  resolveActor: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
}));
vi.mock("@/lib/db/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ safeRevalidate: vi.fn() }));

const onConflictSpy = vi.fn();
const valuesSpy = vi.fn(() => ({ onConflictDoUpdate: onConflictSpy }));
const insertSpy = vi.fn(() => ({ values: valuesSpy }));
const fakeTx = { insert: insertSpy };
const withSchoolMock = vi.fn(async (_id: string, fn: (tx: unknown) => unknown) => fn(fakeTx));
vi.mock("@/lib/db/rls", () => ({
  withSchool: (id: string, fn: (tx: unknown) => unknown) => withSchoolMock(id, fn),
}));

const mod = await import("./facilities");
const { saveFacilitiesSnapshot } = mod;

const validSnapshot = (over: Record<string, unknown> = {}) => ({
  // A valid RFC-4122 v4 uuid (zod v4 `.uuid()` checks the version + variant nibbles); real period ids qualify.
  periodId: "11111111-1111-4111-8111-111111111111",
  classroomsTotal: 20,
  classroomsGood: 15,
  classroomsRepair: 5,
  waterSource: "BOREHOLE",
  electricitySource: "GRID",
  latrinesBoys: 4,
  latrinesGirls: 6,
  latrinesStaff: 2,
  latrineType: "KVIP",
  handwashing: true,
  hasLibrary: true,
  hasIctLab: true,
  internet: true,
  hasKitchen: true,
  gsfpParticipating: true,
  libraryBookCount: null,
  libraryStaffFte: null,
  computersTotal: null,
  computersWorking: null,
  internetType: null,
  mealsServedLastTerm: null,
  pupilsFedDailyAvg: null,
  catererName: null,
  textbookAvailability: null,
  studentDesksUsable: null,
  studentDesksBroken: null,
  teacherDesks: null,
  chalkboards: null,
  whiteboards: null,
  projectors: null,
  note: null,
  ...over,
});

beforeEach(() => {
  vi.mocked(requireSchool).mockResolvedValue({
    school: { id: "s1", name: "Demo", schoolType: "COMBINED" },
    user: { roles: ["ADMIN"] },
  } as never);
  vi.mocked(assertAnyRole).mockReset();
  vi.mocked(assertAnyRole).mockResolvedValue(undefined);
  vi.mocked(recordAudit).mockReset();
  withSchoolMock.mockClear();
  insertSpy.mockClear();
  valuesSpy.mockClear();
  onConflictSpy.mockClear();
});

// ── write gate (dual) ───────────────────────────────────────────────────────────────────────────
describe("GOV7-14 · management write gate, re-checked before any DB work", () => {
  it("throws + never touches the DB when the role gate fails (a hand-crafted POST is refused)", async () => {
    vi.mocked(assertAnyRole).mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(saveFacilitiesSnapshot(validSnapshot())).rejects.toThrow();
    expect(withSchoolMock).not.toHaveBeenCalled();
  });

  it("the gate is exactly FACILITIES_WRITE_ROLES [ADMIN, HEADMASTER] — no VICE_HEADMASTER_ACADEMIC", async () => {
    await saveFacilitiesSnapshot(validSnapshot());
    const arg = vi.mocked(assertAnyRole).mock.calls[0]?.[0];
    expect([...(arg as readonly string[])]).toEqual(["ADMIN", "HEADMASTER"]);
  });
});

// ── cross-column CHECKs surfaced ──────────────────────────────────────────────────────────────────
describe("GOV7-04 · the DB CHECKs are surfaced before the DB", () => {
  it("good + repair > total is rejected — no DB write", async () => {
    const res = await saveFacilitiesSnapshot(validSnapshot({ classroomsGood: 15, classroomsRepair: 10 }));
    expect(res.ok).toBe(false);
    expect(withSchoolMock).not.toHaveBeenCalled();
  });

  it("working computers > total computers is rejected — no DB write", async () => {
    const res = await saveFacilitiesSnapshot(validSnapshot({ computersTotal: 10, computersWorking: 20 }));
    expect(res.ok).toBe(false);
    expect(withSchoolMock).not.toHaveBeenCalled();
  });

  it("a negative count is rejected — no DB write", async () => {
    const res = await saveFacilitiesSnapshot(validSnapshot({ latrinesBoys: -1 }));
    expect(res.ok).toBe(false);
    expect(withSchoolMock).not.toHaveBeenCalled();
  });
});

// ── required vs nullable ──────────────────────────────────────────────────────────────────────────
describe("GOV7-05 · core required, optional detail nullable", () => {
  it("a missing core field is rejected — no DB write", async () => {
    const bad = validSnapshot();
    delete (bad as Record<string, unknown>).waterSource;
    const res = await saveFacilitiesSnapshot(bad);
    expect(res.ok).toBe(false);
    expect(withSchoolMock).not.toHaveBeenCalled();
  });

  it("all-optional-null (core only) is accepted and reaches the upsert", async () => {
    const res = await saveFacilitiesSnapshot(validSnapshot());
    expect(res.ok).toBe(true);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it("optional detail present (incl. numeric FTE) is accepted", async () => {
    const res = await saveFacilitiesSnapshot(
      validSnapshot({ computersTotal: 30, computersWorking: 24, libraryStaffFte: 1.5, catererName: "Akos" }),
    );
    expect(res.ok).toBe(true);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});

// ── idempotent upsert ─────────────────────────────────────────────────────────────────────────────
describe("GOV7-02 · idempotent UPSERT on (school, period)", () => {
  it("issues onConflictDoUpdate on the 2-column target with the core columns in the set", async () => {
    await saveFacilitiesSnapshot(validSnapshot());
    expect(onConflictSpy).toHaveBeenCalledTimes(1);
    const conflict = onConflictSpy.mock.calls[0][0] as { target: unknown[]; set: Record<string, unknown> };
    expect(conflict.target).toHaveLength(2); // schoolId, periodId
    for (const k of ["classroomsTotal", "classroomsGood", "classroomsRepair", "waterSource", "handwashing"]) {
      expect(conflict.set).toHaveProperty(k);
    }
  });
});

// ── no CSV import (R383) ──────────────────────────────────────────────────────────────────────────
describe("GOV7-16 · no CSV / bulk import path exists", () => {
  it("the module exports saveFacilitiesSnapshot and NO import/bulk action", async () => {
    const names = Object.keys(mod);
    expect(names).toContain("saveFacilitiesSnapshot");
    expect(names.some((n) => /import|bulk|csv/i.test(n))).toBe(false);
  });
});

// ── audit (SHOWN) ─────────────────────────────────────────────────────────────────────────────────
describe("GOV7-17 · audit row is entityType facilities_snapshot (SHOWN)", () => {
  it("records an audit row with entityType facilities_snapshot in the same tx", async () => {
    await saveFacilitiesSnapshot(validSnapshot());
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(recordAudit).mock.calls[0][1];
    expect(entry.entityType).toBe("facilities_snapshot");
    expect(entry.actionType).toBe("captured");
  });
});
