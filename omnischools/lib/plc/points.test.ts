import { describe, it, expect } from "vitest";
import {
  isAttended,
  memberSessionPoints,
  sessionPointsSummary,
  type PlcMemberSessionInput,
  type PlcPointsRates,
} from "./points";

// The default CPD contract (R371). The window-close is far in the future so a submitted reflection is
// "in window" unless a test overrides its ms; the mock never sets a reflection submitted, so it's pending.
const RATES: PlcPointsRates = {
  ptsPerAttendedSession: 0.5,
  ptsPerReflection: 0.5,
  reflectionWindowCloseMs: Number.MAX_SAFE_INTEGER,
};

/** The surface mock (schoolup-plc-session-register): 9 members, facilitator EA, absent CK, the rest present. */
function mockMembers(): PlcMemberSessionInput[] {
  const present = ["AM", "SK", "DT", "JM", "RA", "FY"]; // 6 present non-facilitators
  const members: PlcMemberSessionInput[] = [
    { userId: "EA", isFacilitator: true, attendance: "present", reflectionSubmittedAtMs: null, reflectionConfirmed: false },
    { userId: "PB", isFacilitator: false, attendance: "late", reflectionSubmittedAtMs: null, reflectionConfirmed: false }, // late == present
    { userId: "CK", isFacilitator: false, attendance: "absent", reflectionSubmittedAtMs: null, reflectionConfirmed: false },
    ...present.map((u) => ({
      userId: u,
      isFacilitator: false,
      attendance: "present" as const,
      reflectionSubmittedAtMs: null,
      reflectionConfirmed: false,
    })),
  ];
  return members; // 8 attended (7 non-fac + facilitator), 1 absent
}

describe("PLC points derivation (R392/R393) — the crux of the 48/49 boundary", () => {
  it("isAttended: Present + Late count; Absent / Excused / Medical do not", () => {
    expect(isAttended("present")).toBe(true);
    expect(isAttended("late")).toBe(true);
    expect(isAttended("absent")).toBe(false);
    expect(isAttended("excused")).toBe(false);
    expect(isAttended("medical")).toBe(false);
  });

  it("🔴 the surface mock: 8 attendees → 4.0 attended NOW, ceiling 7.5 (NOT 5.0 — no facilitator bonus, R392)", () => {
    const s = sessionPointsSummary(mockMembers(), RATES);
    expect(s.awardedPts).toBe(4.0); // 8 × 0.5 attended
    expect(s.ceilingPts).toBe(7.5); // 7 non-fac × 1.0 + facilitator × 0.5
    expect(s.ceilingPts).not.toBe(5.0); // the surface's double-counted "+1.0 fixed facilitator · 5.0 total"
    expect(s.attendedCount).toBe(8);
    expect(s.absentCount).toBe(1);
    expect(s.reflectionsPending).toBe(7); // every attending non-facilitator, awaiting reflection
    expect(s.reflectionsConfirmed).toBe(0);
  });

  it("a facilitator earns the attended point ONLY — no reflection arm even if (impossibly) confirmed", () => {
    const p = memberSessionPoints(
      { userId: "EA", isFacilitator: true, attendance: "present", reflectionSubmittedAtMs: 1, reflectionConfirmed: true },
      RATES,
    );
    expect(p.attendedPts).toBe(0.5);
    expect(p.reflectionPts).toBe(0); // R392 — facilitator has NO reflection arm
    expect(p.total).toBe(0.5);
    expect(p.possiblePts).toBe(0.5); // facilitator cap = the attended point
    expect(p.reflectionState).toBe("na");
  });

  it("a confirmed in-window reflection lifts a member to the full 1.0 (0.5 attended + 0.5 reflection)", () => {
    const p = memberSessionPoints(
      { userId: "AM", isFacilitator: false, attendance: "present", reflectionSubmittedAtMs: 100, reflectionConfirmed: true },
      RATES,
    );
    expect(p.reflectionPts).toBe(0.5);
    expect(p.total).toBe(1.0);
    expect(p.reflectionState).toBe("confirmed");
  });

  it("a reflection submitted AFTER the window close earns nothing (R393 submitted ≤ window_close)", () => {
    const rates: PlcPointsRates = { ...RATES, reflectionWindowCloseMs: 1000 };
    const p = memberSessionPoints(
      { userId: "AM", isFacilitator: false, attendance: "present", reflectionSubmittedAtMs: 5000, reflectionConfirmed: true },
      rates,
    );
    expect(p.reflectionPts).toBe(0);
    expect(p.total).toBe(0.5);
  });

  it("submitted-but-unconfirmed → 'submitted' state, still 0 reflection points (needs the facilitator stamp)", () => {
    const p = memberSessionPoints(
      { userId: "AM", isFacilitator: false, attendance: "present", reflectionSubmittedAtMs: 100, reflectionConfirmed: false },
      RATES,
    );
    expect(p.reflectionPts).toBe(0);
    expect(p.reflectionState).toBe("submitted");
  });

  it("an absent member earns nothing and cannot reflect (state N/A, 0 ceiling contribution)", () => {
    const p = memberSessionPoints(
      { userId: "CK", isFacilitator: false, attendance: "absent", reflectionSubmittedAtMs: 100, reflectionConfirmed: true },
      RATES,
    );
    expect(p.attendedPts).toBe(0);
    expect(p.reflectionPts).toBe(0);
    expect(p.possiblePts).toBe(0);
    expect(p.reflectionState).toBe("na");
  });

  it("confirming ONE reflection in the mock lifts the awarded preview 4.0 → 4.5", () => {
    const members = mockMembers();
    members[3] = { ...members[3], reflectionSubmittedAtMs: 100, reflectionConfirmed: true };
    const s = sessionPointsSummary(members, RATES);
    expect(s.awardedPts).toBe(4.5);
    expect(s.ceilingPts).toBe(7.5); // ceiling unchanged
    expect(s.reflectionsConfirmed).toBe(1);
    expect(s.reflectionsPending).toBe(6);
  });
});
