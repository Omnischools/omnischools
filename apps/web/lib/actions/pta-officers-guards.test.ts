import { describe, it, expect, vi, beforeEach } from "vitest";
import { assertAnyRole } from "@/lib/auth/server";

/**
 * INCR-51 (Quinn) — behavioural proof of the officer-write guards that reject BEFORE any DB access.
 * The office ∈ officer_roles + not-ex-officio guard runs inside the tx (it needs the tier config) and
 * is unit-proven purely in lib/pta/officers.test.ts (assignmentOfficeError); THIS pins the pre-DB gates:
 *   • the role gate (PTA_CONFIG_WRITE_ROLES) is re-checked in EVERY action before a row is touched;
 *   • election_ref is mandatory (empty / whitespace rejected pre-DB);
 *   • exactly-one holder — neither and both rejected pre-DB (R419).
 *
 * withSchoolSpy throws if reached, so every rejection asserts it un-called and every accepted input
 * asserts it called — separating "refused at validation" from "passed to the DB".
 */
vi.mock("@/lib/auth/server", () => ({
  requireSchool: vi.fn(async () => ({ school: { id: "s1" }, user: { roles: ["ADMIN"] } })),
  assertAnyRole: vi.fn(async () => {}),
  resolveActor: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
}));

const withSchoolSpy = vi.fn(async (..._a: unknown[]) => {
  throw new Error("DB_REACHED");
});
vi.mock("@/lib/db/rls", () => ({ withSchool: (...a: unknown[]) => withSchoolSpy(...a) }));
vi.mock("@/lib/db/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ safeRevalidate: vi.fn() }));

const { assignPtaOfficer, editPtaOfficer, endPtaOfficer } = await import("./pta-officers");

const PTA = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const OFFICER = "33333333-3333-4333-8333-333333333333";

const validAssign = (over: Record<string, unknown> = {}) => ({
  ptaId: PTA,
  office: "Treasurer",
  personUserId: PERSON,
  assignmentBasis: "ELECTED" as const,
  electionRef: "AGM 2025 minute 3.2",
  termStart: "2026-05-15",
  ...over,
});

beforeEach(() => {
  withSchoolSpy.mockClear();
  vi.mocked(assertAnyRole).mockReset();
  vi.mocked(assertAnyRole).mockResolvedValue(undefined);
});

describe("write gate re-checked server-side in every officer action (R427)", () => {
  it("assign/edit/end each throw + never touch the DB when the role gate fails", async () => {
    for (const call of [
      () => assignPtaOfficer(validAssign()),
      () => editPtaOfficer({ officerId: OFFICER, assignmentBasis: "ELECTED", electionRef: "x", termStart: "2026-05-15" }),
      () => endPtaOfficer({ officerId: OFFICER, endReason: "resigned" }),
    ]) {
      vi.mocked(assertAnyRole).mockRejectedValueOnce(new Error("FORBIDDEN"));
      await expect(call()).rejects.toThrow();
    }
    expect(withSchoolSpy).not.toHaveBeenCalled();
  });

  it("the gate uses PTA_CONFIG_WRITE_ROLES = [ADMIN, HEADMASTER] (no new officer role — OC3)", async () => {
    await assignPtaOfficer(validAssign()); // accepted → reaches (mocked) DB
    const arg = vi.mocked(assertAnyRole).mock.calls[0]?.[0];
    expect([...(arg as readonly string[])]).toEqual(["ADMIN", "HEADMASTER"]);
  });
});

describe("election_ref is mandatory (R423)", () => {
  it("an EMPTY / whitespace election_ref is rejected — no DB write", async () => {
    for (const ref of ["", "   "]) {
      const res = await assignPtaOfficer(validAssign({ electionRef: ref }));
      expect(res.ok).toBe(false);
    }
    expect(withSchoolSpy).not.toHaveBeenCalled();
  });
  it("a non-empty election_ref is accepted (reaches the DB write)", async () => {
    await assignPtaOfficer(validAssign());
    expect(withSchoolSpy).toHaveBeenCalledTimes(1);
  });
});

describe("exactly-one holder (R419)", () => {
  it("NEITHER a person nor an external name is rejected — no DB write", async () => {
    const res = await assignPtaOfficer(validAssign({ personUserId: undefined }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/exactly one/i);
    expect(withSchoolSpy).not.toHaveBeenCalled();
  });
  it("BOTH a person AND an external name is rejected — no DB write", async () => {
    const res = await assignPtaOfficer(validAssign({ externalName: "Mr BOG Member" }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/exactly one/i);
    expect(withSchoolSpy).not.toHaveBeenCalled();
  });
  it("an external-only holder is accepted (reaches the DB write)", async () => {
    await assignPtaOfficer(validAssign({ personUserId: undefined, externalName: "Mr BOG Member" }));
    expect(withSchoolSpy).toHaveBeenCalledTimes(1);
  });
});
