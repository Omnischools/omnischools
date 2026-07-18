import { describe, it, expect } from "vitest";
import {
  canTransition,
  quotaExceeded,
  decideExeatCreation,
  isQueuedRowClean,
  isReturnedLate,
  isOverdue,
  canSignSpecial,
  addMinutesToTime,
  overdueStageLabels,
  dueOverdueStages,
  buildExeatSms,
  nextExeatSequence,
  formatRefCode,
  type CreateExeatInput,
} from "./exeat-decision";

const baseCreate: CreateExeatInput = {
  requestedType: "SCHEDULED",
  isBoarder: true,
  feeOwing: 0,
  feeOwingMustCollect: true,
  quotaUsed: 0,
  cap: 3,
  isStandardWindow: true,
  disciplineFlag: false,
};

// A · 5-stage lifecycle + transition guard -----------------------------------
describe("A · transition guard (state machine)", () => {
  it("A1 scheduled-clean: REQUESTED→HM_APPROVED→DEPARTED→RETURNED, skipping SR_HM_SIGNED", () => {
    expect(canTransition("SCHEDULED", "REQUESTED", "HM_APPROVED")).toBe(true);
    expect(canTransition("SCHEDULED", "HM_APPROVED", "DEPARTED")).toBe(true);
    expect(canTransition("SCHEDULED", "DEPARTED", "RETURNED")).toBe(true);
    // A scheduled exeat has no SR_HM_SIGNED stage.
    expect(canTransition("SCHEDULED", "HM_APPROVED", "SR_HM_SIGNED")).toBe(false);
  });

  it("A2 special passes SR_HM_SIGNED before departing", () => {
    expect(canTransition("SPECIAL", "HM_APPROVED", "SR_HM_SIGNED")).toBe(true);
    expect(canTransition("SPECIAL", "SR_HM_SIGNED", "DEPARTED")).toBe(true);
    // A special may NOT depart straight from HM_APPROVED (skips the signature).
    expect(canTransition("SPECIAL", "HM_APPROVED", "DEPARTED")).toBe(false);
  });

  it("A3 no illegal skips (REQUESTED→DEPARTED rejected)", () => {
    expect(canTransition("SCHEDULED", "REQUESTED", "DEPARTED")).toBe(false);
    expect(canTransition("SCHEDULED", "REQUESTED", "RETURNED")).toBe(false);
    expect(canTransition("FEE_COLLECTION", "REQUESTED", "DEPARTED")).toBe(false);
  });

  it("A5 DECLINED is terminal, allowed only before departure; RETURNED terminal", () => {
    expect(canTransition("SCHEDULED", "REQUESTED", "DECLINED")).toBe(true);
    expect(canTransition("SCHEDULED", "HM_APPROVED", "DECLINED")).toBe(true);
    expect(canTransition("SPECIAL", "SR_HM_SIGNED", "DECLINED")).toBe(true);
    // A departed exeat can no longer be declined (its departure is immutable — T4).
    expect(canTransition("SCHEDULED", "DEPARTED", "DECLINED")).toBe(false);
    // Terminal states can transition nowhere.
    expect(canTransition("SCHEDULED", "DECLINED", "HM_APPROVED")).toBe(false);
    expect(canTransition("SCHEDULED", "RETURNED", "DEPARTED")).toBe(false);
  });
});

// B · Quota ------------------------------------------------------------------
describe("B · quota + GES override", () => {
  it("B1 4th scheduled over the cap cannot be created as scheduled", () => {
    const d = decideExeatCreation({ ...baseCreate, quotaUsed: 3, cap: 3 });
    expect(d).toEqual({ ok: false, reason: "quota_exceeded" });
    expect(quotaExceeded(3, 3)).toBe(true);
    expect(quotaExceeded(2, 3)).toBe(false);
  });

  it("B2 specials are never quota-blocked", () => {
    const d = decideExeatCreation({
      ...baseCreate,
      requestedType: "SPECIAL",
      quotaUsed: 9,
      cap: 3,
    });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.type).toBe("SPECIAL");
  });

  it("B4 GES override: a fee-owing student over quota still gets a fee-collection trip", () => {
    const d = decideExeatCreation({
      ...baseCreate,
      quotaUsed: 5,
      cap: 3,
      feeOwing: 340,
    });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.type).toBe("FEE_COLLECTION"); // never detained
      expect(d.feeSnapshot).toBe(340);
      expect(d.feeRouted).toBe(true);
    }
  });
});

// C · Fee-owing routing ------------------------------------------------------
describe("C · fee-owing routes, never blocks", () => {
  it("C2 fee-owing scheduled → FEE_COLLECTION with snapshot, auto-approves when clean", () => {
    const d = decideExeatCreation({ ...baseCreate, feeOwing: 340 });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.type).toBe("FEE_COLLECTION");
      expect(d.feeSnapshot).toBe(340);
      expect(d.feeRouted).toBe(true);
      expect(d.autoApprove).toBe(true);
    }
  });

  it("C4 fee-owing special stays SPECIAL, soft-warn (snapshot kept, not rerouted)", () => {
    const d = decideExeatCreation({ ...baseCreate, requestedType: "SPECIAL", feeOwing: 215 });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.type).toBe("SPECIAL");
      expect(d.feeRouted).toBe(false);
      expect(d.feeSnapshot).toBe(215);
      expect(d.autoApprove).toBe(false); // still needs the Senior HM
    }
  });

  it("C5 fees clear → snapshot null, type SCHEDULED", () => {
    const d = decideExeatCreation({ ...baseCreate, feeOwing: 0 });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.type).toBe("SCHEDULED");
      expect(d.feeSnapshot).toBeNull();
    }
  });

  it("respects feeOwingMustCollect=false — owing scheduled stays SCHEDULED (no routing)", () => {
    const d = decideExeatCreation({ ...baseCreate, feeOwing: 100, feeOwingMustCollect: false });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.type).toBe("SCHEDULED");
  });
});

// D · Auto-approve fail-safe + special role gate -----------------------------
describe("D · approval gating (fail-safe)", () => {
  it("D1 auto-approve ONLY if clean; a discipline flag drops to manual", () => {
    expect(decideExeatCreation({ ...baseCreate }).ok && decideExeatCreation({ ...baseCreate }));
    const clean = decideExeatCreation({ ...baseCreate });
    expect(clean.ok && clean.autoApprove).toBe(true);
    const flagged = decideExeatCreation({ ...baseCreate, disciplineFlag: true });
    expect(flagged.ok && flagged.autoApprove).toBe(false);
  });

  it("D2 off-window scheduled → manual review, not auto", () => {
    const d = decideExeatCreation({ ...baseCreate, isStandardWindow: false });
    expect(d.ok && d.autoApprove).toBe(false);
  });

  it("D3 SPECIAL sign-off: Dean/Headmaster/Admin yes, plain HOUSEMASTER no", () => {
    expect(canSignSpecial(["DEAN_OF_BOARDING"])).toBe(true);
    expect(canSignSpecial(["HEADMASTER"])).toBe(true);
    expect(canSignSpecial(["ADMIN"])).toBe(true);
    expect(canSignSpecial(["HOUSEMASTER"])).toBe(false);
    expect(canSignSpecial(["TEACHER", "HOUSEMASTER"])).toBe(false);
  });

  it("D5 bulk-approve clean-check skips special / off-window rows", () => {
    expect(
      isQueuedRowClean({
        type: "SCHEDULED",
        feesClearOrRouted: true,
        disciplineFlag: false,
        standardWindow: true,
      }),
    ).toBe(true);
    expect(
      isQueuedRowClean({
        type: "FEE_COLLECTION",
        feesClearOrRouted: true,
        disciplineFlag: false,
        standardWindow: true,
      }),
    ).toBe(true);
    // Special never clean.
    expect(
      isQueuedRowClean({
        type: "SPECIAL",
        feesClearOrRouted: true,
        disciplineFlag: false,
        standardWindow: true,
      }),
    ).toBe(false);
    // Off-window drops to manual.
    expect(
      isQueuedRowClean({
        type: "SCHEDULED",
        feesClearOrRouted: true,
        disciplineFlag: false,
        standardWindow: false,
      }),
    ).toBe(false);
  });
});

// Ref-code generation --------------------------------------------------------
describe("ref-code generation", () => {
  it("nextExeatSequence takes max trailing number + 1", () => {
    expect(nextExeatSequence([])).toBe(1);
    expect(nextExeatSequence(["ASA-EX-2026-0341", "ASA-EX-2026-0007"])).toBe(342);
    expect(nextExeatSequence(["ASA-EX-2025-0999"])).toBe(1000);
  });
  it("formatRefCode zero-pads to 4 digits", () => {
    expect(formatRefCode("ASA", 2026, 1)).toBe("ASA-EX-2026-0001");
    expect(formatRefCode("ASA", 2026, 342)).toBe("ASA-EX-2026-0342");
  });
});

// T4 · residency gate --------------------------------------------------------
describe("T4 · residency", () => {
  it("a non-BOARDER request is rejected", () => {
    expect(decideExeatCreation({ ...baseCreate, isBoarder: false })).toEqual({
      ok: false,
      reason: "not_boarder",
    });
  });
});

// E · Return timing + overdue + SMS chain ------------------------------------
describe("E · return timing + overdue chain", () => {
  const returnBy = new Date("2026-05-16T16:00:00Z");

  it("E1 on-time vs late", () => {
    expect(isReturnedLate(new Date("2026-05-16T15:58:00Z"), returnBy)).toBe(false);
    expect(isReturnedLate(new Date("2026-05-16T16:05:00Z"), returnBy)).toBe(true);
    expect(isReturnedLate(new Date("2026-05-16T16:00:00Z"), returnBy)).toBe(false); // exactly on time
    expect(isReturnedLate(new Date(), null)).toBe(false); // no deadline set
  });

  it("E2 overdue predicate: DEPARTED ∧ now>return_by ∧ not returned", () => {
    const now = new Date("2026-05-16T17:30:00Z");
    expect(isOverdue("DEPARTED", returnBy, null, now)).toBe(true);
    expect(isOverdue("DEPARTED", returnBy, new Date("2026-05-16T15:50:00Z"), now)).toBe(false); // returned
    expect(isOverdue("HM_APPROVED", returnBy, null, now)).toBe(false); // not out yet
    expect(isOverdue("DEPARTED", returnBy, null, new Date("2026-05-16T15:00:00Z"))).toBe(false); // not past due
  });

  it("chain offsets are computed from returnByTime, not hard-coded", () => {
    expect(addMinutesToTime("16:00", 5)).toBe("16:05");
    expect(addMinutesToTime("16:00", 30)).toBe("16:30");
    expect(addMinutesToTime("16:00", 60)).toBe("17:00");
    expect(addMinutesToTime("15:45", 30)).toBe("16:15");
    const labels = overdueStageLabels("16:00").map((s) => s.label);
    expect(labels).toEqual(["16:05", "16:30", "17:00"]);
    // A non-16:00 policy shifts every label (proves nothing is hard-coded).
    expect(overdueStageLabels("17:30").map((s) => s.label)).toEqual(["17:35", "18:00", "18:30"]);
  });

  it("E3/E4 dueOverdueStages returns exactly the stages past due", () => {
    expect(dueOverdueStages(returnBy, new Date("2026-05-16T16:03:00Z"))).toEqual([]);
    expect(dueOverdueStages(returnBy, new Date("2026-05-16T16:06:00Z"))).toEqual(["OVERDUE_STAGE_1"]);
    expect(dueOverdueStages(returnBy, new Date("2026-05-16T16:31:00Z"))).toEqual([
      "OVERDUE_STAGE_1",
      "OVERDUE_STAGE_2",
    ]);
    expect(dueOverdueStages(returnBy, new Date("2026-05-16T17:01:00Z"))).toEqual([
      "OVERDUE_STAGE_1",
      "OVERDUE_STAGE_2",
      "OVERDUE_STAGE_3",
    ]);
  });

  it("E5 stage-3 copy is conditional (no working discipline record implied)", () => {
    const body = buildExeatSms("OVERDUE_STAGE_3", {
      studentName: "B. Acheampong",
      returnByLabel: "Fri 16 May · 16:00",
    });
    expect(body).toMatch(/may be raised/i); // future/conditional, not "has been logged"
    expect(body).not.toMatch(/logged|infraction/i);
  });

  it("fee-collection SMS body includes the amount (C3)", () => {
    const body = buildExeatSms("DEPARTURE", {
      studentName: "E. Asare",
      returnByLabel: "Sun 31 May · 16:00",
      amountLabel: "GHS 340.00",
    });
    expect(body).toContain("GHS 340.00");
  });
});
