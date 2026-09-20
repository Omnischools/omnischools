import { describe, it, expect } from "vitest";
import { frozenLedgerRows } from "./ledger";
import type { PlcMemberSessionInput, PlcPointsRates } from "./points";

const HOUR = 3_600_000;

// The default CPD contract (R371), window-close = the SETTLE instant. A reflection earns iff it was
// submitted AND (caller-gated) confirmed at/before this instant.
const SETTLE_MS = 1_700_000_000_000;
const RATES: PlcPointsRates = {
  ptsPerAttendedSession: 0.5,
  ptsPerReflection: 0.5,
  reflectionWindowCloseMs: SETTLE_MS,
};

/** The surface mock: facilitator EA, absent CK, 1 late (== present), the rest present — 8 attended, 1 absent. */
function mockMembers(): PlcMemberSessionInput[] {
  const present = ["AM", "SK", "DT", "JM", "RA", "FY"];
  return [
    { userId: "EA", isFacilitator: true, attendance: "present", reflectionSubmittedAtMs: null, reflectionConfirmed: false },
    { userId: "PB", isFacilitator: false, attendance: "late", reflectionSubmittedAtMs: null, reflectionConfirmed: false },
    { userId: "CK", isFacilitator: false, attendance: "absent", reflectionSubmittedAtMs: null, reflectionConfirmed: false },
    ...present.map((u) => ({
      userId: u,
      isFacilitator: false,
      attendance: "present" as const,
      reflectionSubmittedAtMs: null,
      reflectionConfirmed: false,
    })),
  ];
}

const sum = (rows: { attendedPts: number; reflectionPts: number }[], k: "attendedPts" | "reflectionPts") =>
  Math.round(rows.reduce((a, r) => a + r[k], 0) * 100) / 100;

describe("PLC CPD ledger accrual (R398–R401) — frozenLedgerRows via points.ts UNCHANGED", () => {
  it("a settled session freezes one row per ATTENDED member (8), 4.0 attended pts; the absent member gets NO row", () => {
    const rows = frozenLedgerRows(mockMembers(), RATES);
    expect(rows).toHaveLength(8); // 7 attended non-fac + the facilitator; CK (absent) omitted
    expect(rows.some((r) => r.userId === "CK")).toBe(false); // present-by-default: absent → total 0 → no row
    expect(sum(rows, "attendedPts")).toBe(4.0); // 8 × 0.5
    expect(sum(rows, "reflectionPts")).toBe(0); // none confirmed yet
  });

  it("the facilitator freezes 0.5 attended + 0 reflection (ordinary attendee, no reflection arm — R392)", () => {
    const fac = frozenLedgerRows(mockMembers(), RATES).find((r) => r.userId === "EA");
    expect(fac).toEqual({ userId: "EA", attendedPts: 0.5, reflectionPts: 0 });
  });

  it("a confirmed in-window reflection adds 0.5 → that member freezes the full 1.0 (0.5 + 0.5)", () => {
    const members = mockMembers();
    members[3] = { ...members[3], reflectionSubmittedAtMs: SETTLE_MS - 1, reflectionConfirmed: true };
    const rows = frozenLedgerRows(members, RATES);
    const lifted = rows.find((r) => r.userId === members[3].userId)!;
    expect(lifted).toEqual({ userId: members[3].userId, attendedPts: 0.5, reflectionPts: 0.5 });
    expect(sum(rows, "reflectionPts")).toBe(0.5);
  });

  it("CONFIRM-CUTOFF (R399): a confirm stamped AFTER settle does NOT retro-add — the caller gates reflectionConfirmed", () => {
    // Mirror the caller's cutoff: reflectionConfirmed = confirmedAt != null && confirmedAt <= settle.
    const confirmedAtMs = SETTLE_MS + HOUR; // stamped an hour after settle
    const reflectionConfirmed = confirmedAtMs <= SETTLE_MS; // false
    const members = mockMembers();
    members[3] = {
      ...members[3],
      reflectionSubmittedAtMs: SETTLE_MS - 1, // submitted in-window
      reflectionConfirmed, // but confirmed too late
    };
    const row = frozenLedgerRows(members, RATES).find((r) => r.userId === members[3].userId)!;
    expect(row.reflectionPts).toBe(0); // attended only
    expect(row.attendedPts).toBe(0.5);
  });

  it("a reflection SUBMITTED after settle earns nothing (points.ts applies submitted ≤ settle)", () => {
    const members = mockMembers();
    members[3] = { ...members[3], reflectionSubmittedAtMs: SETTLE_MS + 1, reflectionConfirmed: true };
    const row = frozenLedgerRows(members, RATES).find((r) => r.userId === members[3].userId)!;
    expect(row.reflectionPts).toBe(0);
  });

  it("IDEMPOTENT: re-deriving a frozen (settled) session yields BYTE-IDENTICAL rows → the upsert writes nothing new", () => {
    const members = mockMembers();
    members[3] = { ...members[3], reflectionSubmittedAtMs: SETTLE_MS - 1, reflectionConfirmed: true };
    expect(frozenLedgerRows(members, RATES)).toEqual(frozenLedgerRows(members, RATES));
  });
});
