import { describe, it, expect } from "vitest";
import { getDeboardinizationLadder, DEBOARDINIZATION_LADDER } from "./deboardinization-ladder";
import { isPastorallyFlagged } from "./pastoral-stub";
import {
  DEBOARD_SLOT_ROLE,
  roleSatisfiesSlot,
  signedCount,
  deboardReadyToEffect,
  coSignStatusLabel,
  bondFullySigned,
  bondStatusLabel,
  computePenaltyDisplay,
  penaltyCalcLine,
  deriveEscalation,
  severityNotifiesParent,
  disciplineParentSms,
  PENALTY_MULTIPLIER,
} from "./discipline";

describe("A · corrected ladder (Suspension co-sign 0 → 2)", () => {
  it("Suspension now enforces 2 co-signs (HM + Headmaster) — the sanctioned correction", () => {
    const suspension = getDeboardinizationLadder("any").find((r) => r.severity === "SUSPENSION")!;
    expect(suspension.coSignCount).toBe(2);
    expect(suspension.coSignRoles).toEqual(["HM", "Headmaster"]);
  });
  it("the other rungs are untouched (Bond=2, Deboard=3, Note/Warning=0)", () => {
    const by = (s: string) => DEBOARDINIZATION_LADDER.find((r) => r.severity === s)!;
    expect(by("NOTE").coSignCount).toBe(0);
    expect(by("WARNING").coSignCount).toBe(0);
    expect(by("BOND").coSignCount).toBe(2);
    expect(by("BOND").coSignRoles).toEqual(["HM", "Senior HM"]);
    expect(by("DEBOARDINIZATION").coSignCount).toBe(3);
  });
});

describe("B · 3-co-sign gate + role map", () => {
  it("the slot→role map is HM=HOUSEMASTER / Senior-HM=DEAN_OF_BOARDING / Headmaster=HEADMASTER", () => {
    expect(DEBOARD_SLOT_ROLE).toEqual({ hm: "HOUSEMASTER", seniorHm: "DEAN_OF_BOARDING", headmaster: "HEADMASTER" });
  });
  it("roleSatisfiesSlot accepts the exact role and rejects a wrong-role signer (B3)", () => {
    expect(roleSatisfiesSlot(["HOUSEMASTER"], "hm")).toBe(true);
    expect(roleSatisfiesSlot(["DEAN_OF_BOARDING"], "seniorHm")).toBe(true);
    expect(roleSatisfiesSlot(["HEADMASTER"], "headmaster")).toBe(true);
    // wrong role rejected
    expect(roleSatisfiesSlot(["HEADMASTER"], "hm")).toBe(false);
    expect(roleSatisfiesSlot(["HOUSEMASTER"], "headmaster")).toBe(false);
    // ADMIN is the super-role
    expect(roleSatisfiesSlot(["ADMIN"], "hm")).toBe(true);
    expect(roleSatisfiesSlot(["ADMIN"], "headmaster")).toBe(true);
  });
  it("deboardReadyToEffect is true only at 3-of-3 (B1); a 2-of-3 draft is false (B2)", () => {
    expect(signedCount({ hmAt: 1, seniorHmAt: null, headmasterAt: null })).toBe(1);
    expect(deboardReadyToEffect({ hmAt: 1, seniorHmAt: 1, headmasterAt: null })).toBe(false);
    expect(deboardReadyToEffect({ hmAt: 1, seniorHmAt: 1, headmasterAt: 1 })).toBe(true);
    expect(coSignStatusLabel({ hmAt: 1, seniorHmAt: 1, headmasterAt: null })).toBe("Awaiting co-signs (2 of 3)");
  });
  it("bond = student sig + 2 witnesses (B5)", () => {
    expect(bondFullySigned({ studentAt: 1, hmAt: 1, seniorHmAt: null })).toBe(false);
    expect(bondFullySigned({ studentAt: 1, hmAt: 1, seniorHmAt: 1 })).toBe(true);
    expect(bondStatusLabel({ studentAt: 1, hmAt: null, seniorHmAt: null })).toBe("Awaiting 2 signatures");
  });
});

describe("G · pastoral bypass (STUB) — flagged → zero infraction, manual AND auto", () => {
  it("the seeded flagged student is bypassed; others are not", () => {
    // Both the manual log and every auto-sweep route through insertInfraction, which consults this
    // SAME pure decision at the shared insert site — so the bypass holds for manual AND auto.
    expect(isPastorallyFlagged("ASK-24-0118")).toBe(true);
    expect(isPastorallyFlagged("ASK-BRD-AGG-01")).toBe(false);
    expect(isPastorallyFlagged(null)).toBe(false);
    expect(isPastorallyFlagged(undefined)).toBe(false);
  });
});

describe("H · penalty DISPLAY func (no billing read, no invoice write)", () => {
  it("computes days × per-day × 3 from stored snapshots (H1)", () => {
    const d = computePenaltyDisplay({ days: 1, perDayAmount: 136, adjustedAmount: null });
    expect(PENALTY_MULTIPLIER).toBe(3);
    expect(d?.computed).toBe(408);
    expect(d?.finalAmount).toBe(408);
    expect(d?.adjusted).toBe(false);
  });
  it("applies the Head-discretion override to finalAmount (surface PEN-2026-009: 1,500 → 510)", () => {
    const d = computePenaltyDisplay({ days: 4, perDayAmount: 125, adjustedAmount: 510, adjustmentReason: "partial" });
    expect(d?.computed).toBe(1500);
    expect(d?.finalAmount).toBe(510);
    expect(d?.adjusted).toBe(true);
    expect(penaltyCalcLine(d!)).toContain("4 days × GHS 125.00 boarding/day × 3 = GHS 1,500.00");
    expect(penaltyCalcLine(d!)).toContain("adjusted GHS 510.00 (Head's discretion, partial)");
  });
  it("returns null when the snapshot is incomplete (nothing to display)", () => {
    expect(computePenaltyDisplay({ days: null, perDayAmount: 100 })).toBeNull();
    expect(computePenaltyDisplay({ days: 3, perDayAmount: null })).toBeNull();
  });
});

describe("K · auto-escalation is a PROMPT (never an auto rung-write)", () => {
  it("3 open notes → Warning eligible; 2 open warnings → Bond eligible; else null", () => {
    expect(deriveEscalation(0, 0).eligible).toBeNull();
    expect(deriveEscalation(3, 0).eligible).toBe("WARNING");
    expect(deriveEscalation(5, 2).eligible).toBe("BOND"); // bond eligibility outranks warning
    expect(deriveEscalation(2, 0).eligible).toBeNull(); // 2 notes is not yet eligible
  });
  it("the prompt only suggests — it returns a message and mutates nothing", () => {
    const before = deriveEscalation(3, 0);
    const after = deriveEscalation(3, 0);
    expect(before).toEqual(after); // pure, referentially stable — no side effect
    expect(before.message).toMatch(/HM decides/i);
  });
});

describe("I · parent-notify severity gate (Warning+)", () => {
  it("only Warning+ notifies the parent", () => {
    expect(severityNotifiesParent("NOTE")).toBe(false);
    expect(severityNotifiesParent("WARNING")).toBe(true);
    expect(severityNotifiesParent("BOND")).toBe(true);
    expect(severityNotifiesParent("DEBOARDINIZATION")).toBe(true);
    expect(disciplineParentSms("A. Mensah", "WARNING", "Asankrangwa SHS")).toContain("A. Mensah");
  });
});
