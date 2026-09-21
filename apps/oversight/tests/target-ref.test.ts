import { describe, expect, it } from "vitest";
import {
  TargetRefError,
  assertTargetRefMatchesBasis,
  buildRosterTargetRef,
  buildTargetRef,
  isRosterTargetRef,
  isValidTargetRefForBasis,
} from "@/lib/oversight/target-ref";

const EMIS = "EMIS-PUB-001";
const UUID = "50000000-0000-4000-8000-000000000001";

describe("target_ref format and the basis it must match", () => {
  it("STATUTORY refs the subject by GES establishment id", () => {
    expect(
      buildTargetRef("STATUTORY", { emisSchoolId: EMIS, gesStaffId: "GES/WR/08841" }),
    ).toBe("GES:GES/WR/08841");
  });

  it("CONSENT refs the subject by school + operational uuid", () => {
    expect(
      buildTargetRef("CONSENT", { emisSchoolId: EMIS, operationalStaffId: UUID }),
    ).toBe(`OPS:${EMIS}:${UUID}`);
  });

  it("refuses to build a STATUTORY ref without a GES id", () => {
    expect(() =>
      buildTargetRef("STATUTORY", { emisSchoolId: EMIS, operationalStaffId: UUID }),
    ).toThrowError(TargetRefError);
  });

  it("refuses to build a CONSENT ref without an operational uuid", () => {
    expect(() =>
      buildTargetRef("CONSENT", { emisSchoolId: EMIS, gesStaffId: "GES/WR/08841" }),
    ).toThrowError(TargetRefError);
  });

  it("refuses a name in either slot", () => {
    expect(() =>
      buildTargetRef("STATUTORY", { emisSchoolId: EMIS, gesStaffId: "Ama Boateng" }),
    ).toThrowError(TargetRefError);
    expect(() =>
      buildTargetRef("CONSENT", {
        emisSchoolId: EMIS,
        operationalStaffId: "Ama Boateng",
      }),
    ).toThrowError(TargetRefError);
  });

  it("rejects a prefix that contradicts the basis", () => {
    expect(isValidTargetRefForBasis("GES:GES/WR/08841", "CONSENT")).toBe(false);
    expect(isValidTargetRefForBasis(`OPS:${EMIS}:${UUID}`, "STATUTORY")).toBe(false);
    expect(() => assertTargetRefMatchesBasis("GES:GES/WR/08841", "CONSENT")).toThrowError(
      TargetRefError,
    );
  });

  it("rejects an OPS ref whose person slot is not a uuid", () => {
    expect(isValidTargetRefForBasis(`OPS:${EMIS}:not-a-uuid`, "CONSENT")).toBe(false);
  });

  it("marks a roster ref distinctly from an individual one", () => {
    const roster = buildRosterTargetRef(EMIS);
    expect(roster).toBe(`OPS:${EMIS}:ROSTER`);
    expect(isRosterTargetRef(roster)).toBe(true);
    expect(isRosterTargetRef(`OPS:${EMIS}:${UUID}`)).toBe(false);
    // A roster ref is deliberately NOT a valid individual ref — it must never be mistaken for one.
    expect(isValidTargetRefForBasis(roster, "CONSENT")).toBe(false);
  });
});
