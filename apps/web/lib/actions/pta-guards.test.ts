import { describe, it, expect, vi, beforeEach } from "vitest";
import { assertAnyRole } from "@/lib/auth/server";

/**
 * INCR-50 (Quinn) — behavioural proof of the PTA config-write guards that have NO DB backstop and are
 * therefore ONLY enforceable app-side (verified live: an empty-string `reason` passes the history table's
 * NOT NULL, and backdating has no DB constraint at all). The DB CHECK / partial-unique / RLS layers are
 * proven by the live probe; THIS pins the app-layer guards the DB can't.
 *
 *   • PTA50-24 — every write action re-checks PTA_CONFIG_WRITE_ROLES BEFORE any DB work (a hand-crafted
 *     POST that never touched the admin-only UI is still refused).
 *   • PTA50-15 — a dues change with effective_from < today is rejected (forward-only); today/future pass.
 *   • PTA50-16 — reason is mandatory; empty AND whitespace-only are rejected.
 *   • PTA50-20 — the Emergency tier collects no standing dues and carries no standing officers (app guard,
 *     matched by the DB CHECK proven live).
 *
 * The db client is lazy, so importing the action never connects; every rejection path returns BEFORE
 * withSchool, and `withSchoolSpy` (which throws if reached) is asserted un-called on every rejection and
 * called on every accepted input — separating "refused at validation" from "passed to the DB".
 */

vi.mock("@/lib/auth/server", () => ({
  requireSchool: vi.fn(async () => ({ school: { id: "s1" }, user: { roles: ["ADMIN"] } })),
  assertAnyRole: vi.fn(async () => {}),
  resolveActor: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
}));

const withSchoolSpy = vi.fn(async (..._a: unknown[]) => {
  // If a rejection path ever reaches here the test fails loudly; accepted inputs are asserted via the
  // call-count, and the generic catch turns this throw into the action's {ok:false} DB-error result.
  throw new Error("DB_REACHED");
});
vi.mock("@/lib/db/rls", () => ({ withSchool: (...a: unknown[]) => withSchoolSpy(...a) }));
vi.mock("@/lib/db/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ safeRevalidate: vi.fn() }));

const { savePtaTier, changePtaDues, generatePtas } = await import("./pta");

const isoDaysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const TODAY = isoDaysFromNow(0);
const TOMORROW = isoDaysFromNow(1);
const YESTERDAY = isoDaysFromNow(-1);

const validDues = (over: Record<string, unknown> = {}) => ({
  tierType: "FORM" as const,
  duesEnabled: true,
  duesAmount: 60,
  duesBasis: "PER_STUDENT" as const,
  duesCadence: "PER_TERM" as const,
  effectiveFrom: TOMORROW,
  reason: "Approved at AGM",
  ...over,
});

beforeEach(() => {
  withSchoolSpy.mockClear();
  vi.mocked(assertAnyRole).mockReset();
  vi.mocked(assertAnyRole).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// PTA50-24 — the write gate is enforced in EVERY action, before any DB access.
// ---------------------------------------------------------------------------
describe("PTA50-24 · write gate re-checked server-side in every action", () => {
  it("savePtaTier throws + never touches the DB when the role gate fails", async () => {
    vi.mocked(assertAnyRole).mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(
      savePtaTier({ tierType: "FORM", active: true }),
    ).rejects.toThrow();
    expect(withSchoolSpy).not.toHaveBeenCalled();
  });

  it("changePtaDues throws + never touches the DB when the role gate fails", async () => {
    vi.mocked(assertAnyRole).mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(changePtaDues(validDues())).rejects.toThrow();
    expect(withSchoolSpy).not.toHaveBeenCalled();
  });

  it("generatePtas throws + never touches the DB when the role gate fails", async () => {
    vi.mocked(assertAnyRole).mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(generatePtas()).rejects.toThrow();
    expect(withSchoolSpy).not.toHaveBeenCalled();
  });

  it("the gate uses PTA_CONFIG_WRITE_ROLES = [ADMIN, HEADMASTER] (no PROPRIETOR, no new role)", async () => {
    await changePtaDues(validDues()); // accepted → reaches (mocked) DB
    const arg = vi.mocked(assertAnyRole).mock.calls[0]?.[0];
    expect([...(arg as readonly string[])]).toEqual(["ADMIN", "HEADMASTER"]);
  });
});

// ---------------------------------------------------------------------------
// PTA50-15 — forward-only: backdating rejected, today/future accepted.
// ---------------------------------------------------------------------------
describe("PTA50-15 · dues effective_from is forward-only", () => {
  it("a PAST effective_from is rejected — no DB write", async () => {
    const res = await changePtaDues(validDues({ effectiveFrom: YESTERDAY }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/backdated/i);
    expect(withSchoolSpy).not.toHaveBeenCalled();
  });

  it("TODAY is accepted (reaches the DB write)", async () => {
    await changePtaDues(validDues({ effectiveFrom: TODAY }));
    expect(withSchoolSpy).toHaveBeenCalledTimes(1);
  });

  it("a FUTURE effective_from is accepted (reaches the DB write)", async () => {
    await changePtaDues(validDues({ effectiveFrom: TOMORROW }));
    expect(withSchoolSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// PTA50-16 — reason mandatory: empty and whitespace-only rejected.
// ---------------------------------------------------------------------------
describe("PTA50-16 · dues reason is mandatory", () => {
  it("an EMPTY reason is rejected — no DB write", async () => {
    const res = await changePtaDues(validDues({ reason: "" }));
    expect(res.ok).toBe(false);
    expect(withSchoolSpy).not.toHaveBeenCalled();
  });

  it("a WHITESPACE-only reason is rejected — no DB write (the empty-string DB gap)", async () => {
    const res = await changePtaDues(validDues({ reason: "   " }));
    expect(res.ok).toBe(false);
    expect(withSchoolSpy).not.toHaveBeenCalled();
  });

  it("a non-empty reason is accepted (reaches the DB write)", async () => {
    await changePtaDues(validDues({ reason: "Approved at General PTA AGM" }));
    expect(withSchoolSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// PTA50-20 — Emergency: no standing dues, no standing officers.
// ---------------------------------------------------------------------------
describe("PTA50-20 · Emergency has no standing dues / officers", () => {
  it("changePtaDues rejects the EMERGENCY tier — no DB write", async () => {
    const res = await changePtaDues(validDues({ tierType: "EMERGENCY" }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/emergency/i);
    expect(withSchoolSpy).not.toHaveBeenCalled();
  });

  it("savePtaTier rejects a non-empty officer list on the EMERGENCY tier — no DB write", async () => {
    const res = await savePtaTier({
      tierType: "EMERGENCY",
      active: true,
      officerRoles: ["Chair"],
    });
    expect(res.ok).toBe(false);
    expect(withSchoolSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Dues amount/basis/cadence completeness when enabled (money-path validation).
// ---------------------------------------------------------------------------
describe("dues amount/basis/cadence completeness when enabled", () => {
  it("enabled with a zero amount is rejected — no DB write", async () => {
    const res = await changePtaDues(validDues({ duesAmount: 0 }));
    expect(res.ok).toBe(false);
    expect(withSchoolSpy).not.toHaveBeenCalled();
  });

  it("enabled with no basis/cadence is rejected — no DB write", async () => {
    const res = await changePtaDues(validDues({ duesBasis: null, duesCadence: null }));
    expect(res.ok).toBe(false);
    expect(withSchoolSpy).not.toHaveBeenCalled();
  });

  it("disabling dues needs neither amount nor basis (reaches the DB write)", async () => {
    await changePtaDues({
      tierType: "FORM",
      duesEnabled: false,
      effectiveFrom: TOMORROW,
      reason: "Dues suspended for the term",
    });
    expect(withSchoolSpy).toHaveBeenCalledTimes(1);
  });
});
