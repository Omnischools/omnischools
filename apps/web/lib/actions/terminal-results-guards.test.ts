import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireSchool, assertAnyRole } from "@/lib/auth/server";

/**
 * GOV-6 · behavioural proof of the terminal-results capture actions (AC GOV6-14/15/16/17). The DB layer
 * (CHECKs, the composite UNIQUE, FORCE-RLS) is Wells's; THIS pins the app-layer guards:
 *   • the management write gate is re-checked in EVERY action BEFORE any DB work (a hand-crafted POST is
 *     still refused), and it is exactly TERMINAL_RESULTS_WRITE_ROLES (self-bless fence);
 *   • the school's tier gates exam_type (a WASSCE row for a BASIC school never reaches the DB);
 *   • the four-leaf invariants (passed ≤ candidates per sex, ≥ 1 candidate) reject before the DB;
 *   • the write is an UPSERT on (school, exam_type, year) — idempotent (GOV6-14);
 *   • CSV import is REJECT-NOT-FABRICATE server-side: a wrong-tier row is skipped, the rest still import.
 */

vi.mock("@/lib/auth/server", () => ({
  requireSchool: vi.fn(),
  assertAnyRole: vi.fn(async () => {}),
  resolveActor: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
}));
vi.mock("@/lib/db/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ safeRevalidate: vi.fn() }));

// withSchool runs the callback with a fake tx that records the insert().values().onConflictDoUpdate()
// chain — so accepted paths reach the (fake) DB and rejected paths can be asserted un-called.
const onConflictSpy = vi.fn();
const valuesSpy = vi.fn(() => ({ onConflictDoUpdate: onConflictSpy }));
const insertSpy = vi.fn(() => ({ values: valuesSpy }));
const fakeTx = { insert: insertSpy };
const withSchoolMock = vi.fn(async (_id: string, fn: (tx: unknown) => unknown) => fn(fakeTx));
vi.mock("@/lib/db/rls", () => ({
  withSchool: (id: string, fn: (tx: unknown) => unknown) => withSchoolMock(id, fn),
}));

const { saveTerminalResult, importTerminalResults } = await import("./terminal-results");

const school = (schoolType: string) => ({ id: "s1", name: "Demo", schoolType });
const validSitting = (over: Record<string, unknown> = {}) => ({
  examType: "BECE",
  year: 2025,
  femaleCandidates: 58,
  maleCandidates: 62,
  femalePassed: 51,
  malePassed: 49,
  note: "",
  ...over,
});

beforeEach(() => {
  vi.mocked(requireSchool).mockResolvedValue({
    school: school("COMBINED"),
    user: { roles: ["ADMIN"] },
  } as never);
  vi.mocked(assertAnyRole).mockReset();
  vi.mocked(assertAnyRole).mockResolvedValue(undefined);
  withSchoolMock.mockClear();
  insertSpy.mockClear();
  valuesSpy.mockClear();
  onConflictSpy.mockClear();
});

// ── write gate ────────────────────────────────────────────────────────────────────────────────────
describe("GOV6 · management write gate, re-checked in every action", () => {
  it("saveTerminalResult throws + never touches the DB when the role gate fails", async () => {
    vi.mocked(assertAnyRole).mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(saveTerminalResult(validSitting())).rejects.toThrow();
    expect(withSchoolMock).not.toHaveBeenCalled();
  });

  it("importTerminalResults throws + never touches the DB when the role gate fails", async () => {
    vi.mocked(assertAnyRole).mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(importTerminalResults({ rows: [validSitting()] })).rejects.toThrow();
    expect(withSchoolMock).not.toHaveBeenCalled();
  });

  it("GOV6-15 · the gate is exactly TERMINAL_RESULTS_WRITE_ROLES [ADMIN, HEADMASTER, VICE_HEADMASTER_ACADEMIC]", async () => {
    await saveTerminalResult(validSitting());
    const arg = vi.mocked(assertAnyRole).mock.calls[0]?.[0];
    expect([...(arg as readonly string[])]).toEqual([
      "ADMIN",
      "HEADMASTER",
      "VICE_HEADMASTER_ACADEMIC",
    ]);
  });
});

// ── tier gate ─────────────────────────────────────────────────────────────────────────────────────
describe("GOV6-17 · exam_type is tier-gated to the school", () => {
  it("a WASSCE sitting for a BASIC school is rejected — no DB write", async () => {
    vi.mocked(requireSchool).mockResolvedValueOnce({
      school: school("BASIC"),
      user: { roles: ["ADMIN"] },
    } as never);
    const res = await saveTerminalResult(validSitting({ examType: "WASSCE" }));
    expect(res.ok).toBe(false);
    expect(withSchoolMock).not.toHaveBeenCalled();
  });

  it("a BECE sitting for a BASIC school is accepted (reaches the upsert)", async () => {
    vi.mocked(requireSchool).mockResolvedValueOnce({
      school: school("BASIC"),
      user: { roles: ["ADMIN"] },
    } as never);
    const res = await saveTerminalResult(validSitting({ examType: "BECE" }));
    expect(res.ok).toBe(true);
    expect(withSchoolMock).toHaveBeenCalledTimes(1);
  });
});

// ── leaf invariants ─────────────────────────────────────────────────────────────────────────────────
describe("GOV6 · four-leaf invariants reject before the DB", () => {
  it("passed > candidates (per sex) is rejected — no DB write", async () => {
    const res = await saveTerminalResult(validSitting({ femalePassed: 999 }));
    expect(res.ok).toBe(false);
    expect(withSchoolMock).not.toHaveBeenCalled();
  });

  it("a zero-candidate sitting is rejected — no DB write", async () => {
    const res = await saveTerminalResult(
      validSitting({ femaleCandidates: 0, maleCandidates: 0, femalePassed: 0, malePassed: 0 }),
    );
    expect(res.ok).toBe(false);
    expect(withSchoolMock).not.toHaveBeenCalled();
  });

  it("a negative count is rejected — no DB write", async () => {
    const res = await saveTerminalResult(validSitting({ maleCandidates: -1 }));
    expect(res.ok).toBe(false);
    expect(withSchoolMock).not.toHaveBeenCalled();
  });
});

// ── idempotent upsert ───────────────────────────────────────────────────────────────────────────────
describe("GOV6-14 · idempotent UPSERT on (school, exam_type, year)", () => {
  it("saveTerminalResult issues onConflictDoUpdate on the 3-column target with the leaves in the set", async () => {
    await saveTerminalResult(validSitting());
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(onConflictSpy).toHaveBeenCalledTimes(1);
    const conflict = onConflictSpy.mock.calls[0][0] as { target: unknown[]; set: Record<string, unknown> };
    expect(conflict.target).toHaveLength(3); // schoolId, examType, year
    for (const k of ["femaleCandidates", "maleCandidates", "femalePassed", "malePassed"]) {
      expect(conflict.set).toHaveProperty(k);
    }
  });
});

// ── CSV import: reject-not-fabricate (server side) ───────────────────────────────────────────────────
describe("GOV6-16 · import skips wrong-tier rows, imports the rest", () => {
  it("a BASIC-school file with a BECE + a WASSCE row imports 1, skips 1", async () => {
    vi.mocked(requireSchool).mockResolvedValueOnce({
      school: school("BASIC"),
      user: { roles: ["ADMIN"] },
    } as never);
    const res = await importTerminalResults({
      rows: [validSitting({ examType: "BECE" }), validSitting({ examType: "WASSCE" })],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.imported).toBe(1); // BECE
    expect(res.skipped).toBe(1); // WASSCE — wrong tier, skipped not fabricated
    expect(insertSpy).toHaveBeenCalledTimes(1); // only the BECE row reached the DB
  });
});
