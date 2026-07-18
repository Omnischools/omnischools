import { describe, it, expect } from "vitest";
import {
  MAX_APPROVED_VISITORS,
  VISITOR_ZONES,
  ZONE_CAP_TOTAL,
  getVisitorZones,
  isValidZoneKey,
  maskPhone,
  formInScope,
  formScopeLabel,
  verifyAgainstList,
  canAuthorise,
  canDepart,
  departAfterArrive,
  overstayState,
  isOverstaying,
  deriveRsvpByHouse,
  deriveZoneOccupancy,
  deriveVisitStats,
  listMatchOf,
  isCohortKind,
  cohortSms,
  recordVisitInputSchema,
  approvedVisitorInputSchema,
} from "./visiting";

describe("constants", () => {
  it("max approved visitors is 6", () => {
    expect(MAX_APPROVED_VISITORS).toBe(6);
  });
  it("three zones totalling ~1,200", () => {
    expect(VISITOR_ZONES.map((z) => z.key)).toEqual(["main_lawn", "dining_annex", "library_quad"]);
    expect(VISITOR_ZONES.map((z) => z.capacity)).toEqual([700, 300, 200]);
    expect(ZONE_CAP_TOTAL).toBe(1200);
    expect(getVisitorZones("any").length).toBe(3);
  });
  it("validates zone keys (null allowed)", () => {
    expect(isValidZoneKey("main_lawn")).toBe(true);
    expect(isValidZoneKey(null)).toBe(true);
    expect(isValidZoneKey("dungeon")).toBe(false);
  });
});

describe("maskPhone (PII discipline · AC J4)", () => {
  it("masks a Ghana E.164 number to the surface form", () => {
    expect(maskPhone("+233244000091")).toBe("+233 24 *** *** 91");
    expect(maskPhone("233244000091")).toBe("+233 24 *** *** 91");
  });
  it("never leaks the middle digits", () => {
    const masked = maskPhone("+233201234567");
    expect(masked).not.toContain("1234");
    expect(masked).toContain("***");
  });
  it("handles blank / too-short", () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("")).toBeNull();
    expect(maskPhone("123")).toBe("***");
  });
});

describe("formScope cohort (AC E2/E3)", () => {
  it("FORMS_1_2 excludes Form 3", () => {
    expect(formInScope(1, "FORMS_1_2")).toBe(true);
    expect(formInScope(2, "FORMS_1_2")).toBe(true);
    expect(formInScope(3, "FORMS_1_2")).toBe(false);
  });
  it("null / ALL scope is whole-school", () => {
    expect(formInScope(3, null)).toBe(true);
    expect(formInScope(3, "ALL")).toBe(true);
  });
  it("labels the scope", () => {
    expect(formScopeLabel("FORMS_1_2")).toBe("Forms 1 & 2 only");
    expect(formScopeLabel(null)).toBeNull();
  });
});

describe("gate list-check (AC C · list-CHECK not list-RECORD)", () => {
  it("APPROVED match → VERIFIED (C1)", () => {
    expect(verifyAgainstList({ status: "APPROVED" })).toBe("VERIFIED");
  });
  it("not-on-list → FLAGGED (C2)", () => {
    expect(verifyAgainstList(null)).toBe("FLAGGED");
  });
  it("PENDING_REVIEW at the gate → FLAGGED (C3)", () => {
    expect(verifyAgainstList({ status: "PENDING_REVIEW" })).toBe("FLAGGED");
  });
  it("only a FLAGGED visit can be HM-overridden (C4)", () => {
    expect(canAuthorise("FLAGGED")).toBe(true);
    expect(canAuthorise("VERIFIED")).toBe(false);
    expect(canAuthorise("HM_AUTHORISED")).toBe(false);
  });
});

describe("two-stamp in/out (AC D)", () => {
  it("depart requires a prior arrival (D3)", () => {
    expect(canDepart({ status: "RSVP", arrivedAt: null })).toBe(false);
    expect(canDepart({ status: "ARRIVED", arrivedAt: null })).toBe(false);
    expect(canDepart({ status: "ARRIVED", arrivedAt: new Date() })).toBe(true);
    expect(canDepart({ status: "DEPARTED", arrivedAt: new Date() })).toBe(false);
  });
  it("departed_at must be ≥ arrived_at (D4)", () => {
    const arr = new Date("2026-05-17T13:00:00Z");
    expect(departAfterArrive(arr, new Date("2026-05-17T14:00:00Z"))).toBe(true);
    expect(departAfterArrive(arr, new Date("2026-05-17T12:59:00Z"))).toBe(false);
  });
});

describe("overstay on-read (AC G)", () => {
  const date = "2026-05-17";
  const hoursEnd = "16:00";
  const arrived = { status: "ARRIVED" as const, departedAt: null };
  it("not overstaying before hoursEnd+grace (G1/G5)", () => {
    expect(overstayState(arrived, date, hoursEnd, new Date("2026-05-17T16:10:00Z"))).toBe("none");
  });
  it("overstay past 4:15 (G1)", () => {
    expect(overstayState(arrived, date, hoursEnd, new Date("2026-05-17T16:16:00Z"))).toBe("overstay");
    expect(isOverstaying(arrived, date, hoursEnd, new Date("2026-05-17T16:16:00Z"))).toBe(true);
  });
  it("senior-HM tier past 4:30 (G4)", () => {
    expect(overstayState(arrived, date, hoursEnd, new Date("2026-05-17T16:31:00Z"))).toBe("senior");
  });
  it("departed visitor is never overstaying (G5)", () => {
    const departed = { status: "DEPARTED" as const, departedAt: new Date("2026-05-17T16:05:00Z") };
    expect(overstayState(departed, date, hoursEnd, new Date("2026-05-17T17:00:00Z"))).toBe("none");
  });
  it("a still-RSVP (never arrived) visit is never overstaying", () => {
    expect(overstayState({ status: "RSVP", departedAt: null }, date, hoursEnd, new Date("2026-05-17T18:00:00Z"))).toBe("none");
  });
});

describe("RSVP-by-House (AC E · derived, formScope-aware)", () => {
  const boarders = [
    { studentId: "a1", houseId: "H1", form: 1 },
    { studentId: "a2", houseId: "H1", form: 2 },
    { studentId: "a3", houseId: "H1", form: 3 },
    { studentId: "b1", houseId: "H2", form: 1 },
  ];
  it("counts distinct RSVP'd / arrived per House, whole-school scope", () => {
    const visits = [
      { studentId: "a1", arrived: true },
      { studentId: "a1", arrived: false }, // second visitor for same student — counts once
      { studentId: "a3", arrived: false },
    ];
    const m = deriveRsvpByHouse(boarders, visits, null);
    expect(m.get("H1")).toMatchObject({ expected: 3, rsvpd: 2, arrived: 1 });
    expect(m.get("H2")).toMatchObject({ expected: 1, rsvpd: 0, arrived: 0 });
  });
  it("FORMS_1_2 excludes Form 3 from expected and cohort (E2)", () => {
    const visits = [{ studentId: "a3", arrived: true }]; // F3 arrival ignored under FORMS_1_2
    const m = deriveRsvpByHouse(boarders, visits, "FORMS_1_2");
    expect(m.get("H1")!.expected).toBe(2); // F1 + F2 only
    expect(m.get("H1")!.arrived).toBe(0); // F3 arrival not counted
    expect(m.get("H1")!.byForm.some((f) => f.form === 3)).toBe(false);
  });
});

describe("zone occupancy (AC F3 · derived)", () => {
  it("counts on-campus visits per zone, ignores departed", () => {
    const visits = [
      { zoneKey: "main_lawn", onCampus: true },
      { zoneKey: "main_lawn", onCampus: true },
      { zoneKey: "main_lawn", onCampus: false }, // departed
      { zoneKey: "library_quad", onCampus: true },
      { zoneKey: null, onCampus: true }, // unzoned
    ];
    const occ = deriveZoneOccupancy(VISITOR_ZONES, visits);
    expect(occ.find((z) => z.key === "main_lawn")!.occupancy).toBe(2);
    expect(occ.find((z) => z.key === "library_quad")!.occupancy).toBe(1);
    expect(occ.find((z) => z.key === "dining_annex")!.occupancy).toBe(0);
  });
});

describe("visit stats / arrival counter (AC K · derived)", () => {
  it("tallies rsvp / expecting / arrived / on-campus / departed", () => {
    const visits = [
      { studentId: "s1", arrivedAt: new Date(), departedAt: null }, // on campus
      { studentId: "s1", arrivedAt: null, departedAt: null }, // second RSVP, same student
      { studentId: "s2", arrivedAt: new Date(), departedAt: new Date() }, // departed
      { studentId: "s3", arrivedAt: null, departedAt: null }, // RSVP only
    ];
    expect(deriveVisitStats(visits)).toEqual({
      rsvpVisits: 4,
      expectingStudents: 3,
      arrivedVisits: 2,
      onCampus: 1,
      departed: 1,
    });
  });
});

describe("list-match display (two-flag-vocab · AC C / Lucy)", () => {
  it("VERIFIED is green", () => {
    expect(listMatchOf("VERIFIED", "ARRIVED", 0)).toEqual({ kind: "verified", label: "VERIFIED" });
  });
  it("HM_AUTHORISED is its own tag (distinct from security FLAGGED)", () => {
    expect(listMatchOf("HM_AUTHORISED", "ARRIVED", 0).kind).toBe("hm");
  });
  it("pre-arrival FLAGGED with pending entries → gold +N NEEDS REVIEW", () => {
    expect(listMatchOf("FLAGGED", "RSVP", 1)).toEqual({ kind: "review", label: "+1 NEEDS REVIEW" });
  });
  it("FLAGGED at the gate → red security FLAGGED (distinct from review)", () => {
    expect(listMatchOf("FLAGGED", "ARRIVED", 0).kind).toBe("flagged");
    expect(listMatchOf("FLAGGED", "RSVP", 0).kind).toBe("flagged");
  });
});

describe("SMS scoping (AC I1)", () => {
  it("invitation/reminders are cohort-scoped; arrival/overstay are per-visit", () => {
    expect(isCohortKind("INVITATION")).toBe(true);
    expect(isCohortKind("REMINDER_T3")).toBe(true);
    expect(isCohortKind("REMINDER_T1")).toBe(true);
    expect(isCohortKind("ARRIVAL_CONFIRM")).toBe(false);
    expect(isCohortKind("OVERSTAY")).toBe(false);
  });
  it("cohort copy has no parent-self-serve implication and names the window", () => {
    const body = cohortSms("REMINDER_T3", "Asankrangwa SHS", "Sun 17 May", "12:00", "16:00");
    expect(body).toContain("12:00–16:00");
    expect(body).toContain("3 days");
  });
});

describe("input schemas (Zod-in-lib)", () => {
  it("rejects a visit with neither approved visitor nor walk-in name", () => {
    const r = recordVisitInputSchema.safeParse({ studentId: crypto.randomUUID(), action: "RSVP" });
    expect(r.success).toBe(false);
  });
  it("accepts a walk-in arrival with name + relationship", () => {
    const r = recordVisitInputSchema.safeParse({
      studentId: crypto.randomUUID(),
      visitorName: "Jane Doe",
      relationship: "Aunt",
      action: "ARRIVE",
    });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown zone key", () => {
    const r = recordVisitInputSchema.safeParse({
      studentId: crypto.randomUUID(),
      approvedVisitorId: crypto.randomUUID(),
      action: "ARRIVE",
      zoneKey: "dungeon",
    });
    expect(r.success).toBe(false);
  });
  it("validates approved-visitor add", () => {
    const ok = approvedVisitorInputSchema.safeParse({
      studentId: crypto.randomUUID(),
      name: "Mrs Esi Manu",
      relationship: "Mother",
      phone: "+233244000091",
    });
    expect(ok.success).toBe(true);
  });
});
