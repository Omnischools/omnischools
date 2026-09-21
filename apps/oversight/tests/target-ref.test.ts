import { describe, expect, it } from "vitest";
import {
  TargetRefError,
  assertTargetRefMatchesBasis,
  buildRosterTargetRef,
  buildTargetRef,
  isRosterTargetRef,
  isValidTargetRefForBasis,
} from "@/lib/oversight/target-ref";
import { assertTargetRefMatchesBasisUnlessRoster } from "@/lib/oversight/named-record-access";

const EMIS = "EMIS-PUB-001";
const UUID = "50000000-0000-4000-8000-000000000001";

const NTC = "NTC-2019-004417";

describe("target_ref format and the basis it must match", () => {
  it("STATUTORY refs the subject by NTC licence number", () => {
    expect(
      buildTargetRef("STATUTORY", { emisSchoolId: EMIS, ntcLicenceNumber: NTC }),
    ).toBe(`NTC:${NTC}`);
  });

  it("CONSENT refs the subject by school + operational uuid", () => {
    expect(
      buildTargetRef("CONSENT", { emisSchoolId: EMIS, operationalStaffId: UUID }),
    ).toBe(`OPS:${EMIS}:${UUID}`);
  });

  it("refuses to build a STATUTORY ref without an NTC licence", () => {
    expect(() =>
      buildTargetRef("STATUTORY", { emisSchoolId: EMIS, operationalStaffId: UUID }),
    ).toThrowError(TargetRefError);
  });

  it("refuses to build a CONSENT ref without an operational uuid", () => {
    expect(() =>
      buildTargetRef("CONSENT", { emisSchoolId: EMIS, ntcLicenceNumber: NTC }),
    ).toThrowError(TargetRefError);
  });

  it("refuses a name in either slot", () => {
    expect(() =>
      buildTargetRef("STATUTORY", { emisSchoolId: EMIS, ntcLicenceNumber: "Ama Boateng" }),
    ).toThrowError(TargetRefError);
    expect(() =>
      buildTargetRef("CONSENT", {
        emisSchoolId: EMIS,
        operationalStaffId: "Ama Boateng",
      }),
    ).toThrowError(TargetRefError);
  });

  it("rejects a prefix that contradicts the basis (AC-3.9)", () => {
    // An NTC: ref on a CONSENT row, and an OPS: ref on a STATUTORY row, are BOTH refused.
    expect(isValidTargetRefForBasis(`NTC:${NTC}`, "CONSENT")).toBe(false);
    expect(isValidTargetRefForBasis(`OPS:${EMIS}:${UUID}`, "STATUTORY")).toBe(false);
    expect(() => assertTargetRefMatchesBasis(`NTC:${NTC}`, "CONSENT")).toThrowError(
      TargetRefError,
    );
    expect(() =>
      assertTargetRefMatchesBasis(`OPS:${EMIS}:${UUID}`, "STATUTORY"),
    ).toThrowError(TargetRefError);
  });

  it("rejects an OPS ref whose person slot is not a uuid", () => {
    expect(isValidTargetRefForBasis(`OPS:${EMIS}:not-a-uuid`, "CONSENT")).toBe(false);
  });

  it("does NOT treat a bare `:ROSTER` suffix as a roster ref", () => {
    // The gate exempts roster refs from the basis assertion. That exemption used to key on
    // `ref.endsWith(":ROSTER")`, which `NTC:ROSTER` satisfies — so a STATUTORY row whose ref was
    // `NTC:ROSTER` would have been waved through unchecked. `isRosterTargetRef` requires the full
    // OPS:<emis>:ROSTER shape, so it does not.
    expect("NTC:ROSTER".endsWith(":ROSTER")).toBe(true);
    expect(isRosterTargetRef("NTC:ROSTER")).toBe(false);
    expect(isRosterTargetRef("ROSTER")).toBe(false);
    expect(isRosterTargetRef("OPS:EMIS-PUB-001:ROSTER")).toBe(true);
  });

  it("the recogniser is no laxer than the constructor about the school slot", () => {
    // `buildRosterTargetRef` validates the school id, so `isRosterTargetRef` must too: it is the
    // predicate that EXEMPTS a ref from the basis assertion, and an exemption that accepts strings
    // its own producer would refuse is a hole shaped like the check it excepts.
    for (const bad of [
      "OPS::ROSTER",
      "OPS:bad id:ROSTER",
      "OPS: :ROSTER",
      "OPS:-x:ROSTER",
    ]) {
      expect(isRosterTargetRef(bad), bad).toBe(false);
      expect(() => buildRosterTargetRef(bad.slice(4, -8))).toThrowError(TargetRefError);
    }
    // …and everything the constructor CAN produce is still recognised.
    for (const emis of ["EMIS-PUB-001", "EMIS_UNK.006", "A1"]) {
      expect(isRosterTargetRef(buildRosterTargetRef(emis)), emis).toBe(true);
    }
  });

  it("a ref the recogniser rejects is NOT exempt from the basis assertion", () => {
    expect(() =>
      assertTargetRefMatchesBasisUnlessRoster("OPS::ROSTER", "CONSENT"),
    ).toThrowError(TargetRefError);
    expect(() =>
      assertTargetRefMatchesBasisUnlessRoster("OPS:bad id:ROSTER", "CONSENT"),
    ).toThrowError(TargetRefError);
  });

  it("the gate's roster exemption cannot be reached by a non-OPS ref", () => {
    // `NTC:ROSTER` is valid FOR STATUTORY, so it passes …
    expect(() =>
      assertTargetRefMatchesBasisUnlessRoster("NTC:ROSTER", "STATUTORY"),
    ).not.toThrow();
    // … and is correctly REFUSED for CONSENT, where the old suffix test let it through silently.
    expect(() =>
      assertTargetRefMatchesBasisUnlessRoster("NTC:ROSTER", "CONSENT"),
    ).toThrowError(TargetRefError);
    // A genuine roster ref is still exempt.
    expect(() =>
      assertTargetRefMatchesBasisUnlessRoster("OPS:EMIS-PUB-001:ROSTER", "CONSENT"),
    ).not.toThrow();
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
