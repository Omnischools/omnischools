import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireSchool, assertAnyRole } from "@/lib/auth/server";
import { recordAudit } from "@/lib/db/audit";

/**
 * GOV-9 · behavioural proof of the two annual-census hand-fill actions (AC GOV9-05/14/17). The DB lock
 * (`WHERE status='DRAFT'`) is proven end-to-end in scripts/verify-census-handfill.ts (a rolled-back live
 * round-trip); THIS pins the app-layer guards without a DB:
 *   • the write gate [ADMIN, HEADMASTER] is re-checked BEFORE any DB work (a hand-crafted POST is refused);
 *   • the write targets the SESSION school id — never a request-supplied one (GOV9-17);
 *   • saveCensusHandFill writes the mapped keys + version:1 to the ANNUAL row, DRAFT-guarded (GOV9-05);
 *   • when no DRAFT row matches (missing OR already COMPLETED → 0 rows) BOTH actions refuse, no audit (14);
 *   • the audit row is entityType `census_return` (SHOWN), carrying only year / section names.
 */

vi.mock("@/lib/auth/server", () => ({
  requireSchool: vi.fn(),
  requireSchoolRole: vi.fn(),
  assertAnyRole: vi.fn(async () => {}),
  resolveActor: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
}));
vi.mock("@/lib/db/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ safeRevalidate: vi.fn() }));
vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));
// Keep saveCensusReturn's heavy imports inert (this file exercises only the two hand-fill actions).
vi.mock("@/lib/reports/census/generate", () => ({ generateCensusSnapshot: vi.fn() }));
vi.mock("@/lib/reports/census/schema", () => ({ parseCensusSnapshot: (x: unknown) => x }));
vi.mock("@/lib/reports/census/view", () => ({ computeCensusView: () => ({}) }));

// A drizzle update chain: update(table).set(cols).where(cond).returning(cols) → rows.
let updateRows: { academicYear: string }[] = [];
const returningSpy = vi.fn(() => Promise.resolve(updateRows));
const whereSpy = vi.fn(() => ({ returning: returningSpy }));
const setSpy = vi.fn((_cols: unknown) => ({ where: whereSpy }));
const updateSpy = vi.fn(() => ({ set: setSpy }));
const fakeTx = { update: updateSpy };
const withSchoolMock = vi.fn(async (_id: string, fn: (tx: unknown) => unknown) => fn(fakeTx));
vi.mock("@/lib/db/rls", () => ({
  withSchool: (id: string, fn: (tx: unknown) => unknown) => withSchoolMock(id, fn),
}));

const { saveCensusHandFill, markCensusCompleted } = await import("./census");

beforeEach(() => {
  updateRows = [{ academicYear: "2025/26" }]; // default: a DRAFT row matched
  vi.mocked(requireSchool).mockResolvedValue({
    school: { id: "s1", name: "Demo", schoolType: "SENIOR", gesCode: "X", shortName: "DEMO" },
    user: { roles: ["ADMIN"] },
  } as never);
  vi.mocked(assertAnyRole).mockReset().mockResolvedValue(undefined);
  vi.mocked(recordAudit).mockReset();
  withSchoolMock.mockClear();
  updateSpy.mockClear();
  setSpy.mockClear();
  whereSpy.mockClear();
  returningSpy.mockClear();
});

const validHandFill = {
  academicYear: "2025/26",
  handFill: {
    repetition: { male: 5, female: 3 },
    qualifications: null,
    movementExits: null,
    feeding: null,
    textbooks: null,
    specialNeeds: null,
  },
};

describe("GOV9-17 · saveCensusHandFill — dual write gate, re-checked before any DB work", () => {
  it("throws + never touches the DB when the role gate fails", async () => {
    vi.mocked(assertAnyRole).mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(saveCensusHandFill(validHandFill)).rejects.toThrow();
    expect(withSchoolMock).not.toHaveBeenCalled();
  });

  it("the gate is exactly CENSUS_WRITE_ROLES [ADMIN, HEADMASTER]", async () => {
    await saveCensusHandFill(validHandFill);
    expect([...(vi.mocked(assertAnyRole).mock.calls[0]?.[0] as readonly string[])]).toEqual([
      "ADMIN",
      "HEADMASTER",
    ]);
  });

  it("writes for the SESSION school id — never a request-supplied one (GOV9-17)", async () => {
    await saveCensusHandFill({ ...validHandFill, schoolId: "attacker-school" } as never);
    expect(withSchoolMock.mock.calls[0][0]).toBe("s1");
  });
});

describe("GOV9-05 · saveCensusHandFill writes the mapped keys + version, DRAFT-guarded", () => {
  it("persists {version:1, …mapped sections} and updatedAt on the ANNUAL DRAFT row", async () => {
    const res = await saveCensusHandFill(validHandFill);
    expect(res).toEqual({ ok: true });
    const set = setSpy.mock.calls[0][0] as { handFill: Record<string, unknown>; updatedAt: Date };
    expect(set.handFill.version).toBe(1);
    expect(set.handFill.repetition).toEqual({ male: 5, female: 3 });
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  it("the audit row is SHOWN entityType census_return, carrying only year + filled section names", async () => {
    await saveCensusHandFill(validHandFill);
    const entry = vi.mocked(recordAudit).mock.calls[0][1];
    expect(entry.entityType).toBe("census_return");
    expect(entry.actionType).toBe("hand_filled");
    expect(entry.after).toEqual({ academicYear: "2025/26", sections: ["repetition"] });
  });

  it("an invalid hand-fill (negative count) is refused before any DB work", async () => {
    const res = await saveCensusHandFill({
      academicYear: "2025/26",
      handFill: { repetition: { male: -1, female: 0 } },
    });
    expect(res.ok).toBe(false);
    expect(withSchoolMock).not.toHaveBeenCalled();
  });
});

describe("GOV9-14 · a COMPLETED / missing row is LOCKED — no DRAFT matched → refused, no audit", () => {
  it("saveCensusHandFill: 0 rows updated → ok:false, no audit written", async () => {
    updateRows = []; // WHERE status='DRAFT' matched nothing (row is COMPLETED, or absent)
    const res = await saveCensusHandFill(validHandFill);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toMatch(/already completed|generate it first/i);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("markCensusCompleted: a DRAFT row → flips to COMPLETED, audited (completed)", async () => {
    const res = await markCensusCompleted({ academicYear: "2025/26" });
    expect(res).toEqual({ ok: true });
    expect(setSpy.mock.calls[0][0]).toMatchObject({ status: "COMPLETED" });
    const entry = vi.mocked(recordAudit).mock.calls[0][1];
    expect(entry.entityType).toBe("census_return");
    expect(entry.actionType).toBe("completed");
  });

  it("markCensusCompleted: missing / already-completed (0 rows) → refused, no audit", async () => {
    updateRows = [];
    const res = await markCensusCompleted({ academicYear: "2025/26" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toMatch(/missing or already completed/i);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("markCensusCompleted: an empty academicYear is refused before any DB work", async () => {
    const res = await markCensusCompleted({ academicYear: "" });
    expect(res.ok).toBe(false);
    expect(withSchoolMock).not.toHaveBeenCalled();
  });
});
