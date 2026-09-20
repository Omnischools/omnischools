import { describe, it, expect } from "vitest";
import { decideReassign, genderAdmits, type ReassignInput } from "./reassign-decision";

const HOUSE = "house-aggrey";
const base: ReassignInput = {
  reason: "End-of-term promotion to senior dorm",
  student: { houseId: HOUSE, sex: "MALE", currentBunkId: "bunk-old" },
  target: {
    bunkId: "bunk-new",
    houseId: HOUSE,
    houseGender: "BOYS",
    occupiedByOther: false,
  },
};

describe("genderAdmits (J3)", () => {
  it("BOYS admits MALE only, GIRLS admits FEMALE only", () => {
    expect(genderAdmits("BOYS", "MALE")).toBe(true);
    expect(genderAdmits("BOYS", "FEMALE")).toBe(false);
    expect(genderAdmits("GIRLS", "FEMALE")).toBe(true);
    expect(genderAdmits("GIRLS", "MALE")).toBe(false);
  });
  it("COED admits either sex; a null (unconfigured) gender never blocks (AC I3)", () => {
    expect(genderAdmits("COED", "MALE")).toBe(true);
    expect(genderAdmits("COED", "FEMALE")).toBe(true);
    expect(genderAdmits(null, "MALE")).toBe(true);
    expect(genderAdmits(null, "FEMALE")).toBe(true);
  });
});

describe("decideReassign", () => {
  it("accepts a valid within-House move to a vacant, gender-matching bunk", () => {
    expect(decideReassign(base)).toEqual({ ok: true });
  });

  it("rejects a missing/blank reason FIRST, before any other check (AC C4)", () => {
    // reason is checked before the (here also invalid) occupied target.
    const bad: ReassignInput = {
      ...base,
      reason: "   ",
      target: { ...base.target!, occupiedByOther: true },
    };
    expect(decideReassign(bad)).toEqual({ ok: false, reason: "missing_reason" });
    expect(decideReassign({ ...base, reason: null })).toEqual({
      ok: false,
      reason: "missing_reason",
    });
  });

  it("treats a re-point to the same bunk as a no-op (AC D4 — no duplicate open row)", () => {
    const same: ReassignInput = {
      ...base,
      target: { ...base.target!, bunkId: "bunk-old" },
    };
    expect(decideReassign(same)).toEqual({ ok: false, reason: "no_change" });
  });

  it("refuses a target bunk in another House (within-House only)", () => {
    const cross: ReassignInput = {
      ...base,
      target: { ...base.target!, houseId: "house-guggisberg" },
    };
    expect(decideReassign(cross)).toEqual({ ok: false, reason: "not_within_house" });
  });

  it("refuses a cross-gender same-House target (J3 — the incoherent-data guard)", () => {
    const female: ReassignInput = {
      ...base,
      student: { ...base.student, sex: "FEMALE" },
      // same House, but the House is BOYS and the student is FEMALE.
    };
    expect(decideReassign(female)).toEqual({ ok: false, reason: "gender_mismatch" });
  });

  it("refuses a bunk already held by another student (AC C3/D2 pre-check)", () => {
    const taken: ReassignInput = {
      ...base,
      target: { ...base.target!, occupiedByOther: true },
    };
    expect(decideReassign(taken)).toEqual({ ok: false, reason: "bunk_occupied" });
  });

  it("places an unallocated boarder (no current bunk, J1) when the target is valid", () => {
    const unallocated: ReassignInput = {
      ...base,
      student: { ...base.student, currentBunkId: null },
    };
    expect(decideReassign(unallocated)).toEqual({ ok: true });
  });
});
