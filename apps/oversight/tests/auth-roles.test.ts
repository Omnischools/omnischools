import { describe, expect, it } from "vitest";
import {
  OFFICER_ROLES,
  OFFICER_TIERS,
  ROLE_FOR_TIER,
  canOpenNamedRecord,
  institutionLabel,
  isOfficerRole,
  isOfficerTier,
  roleLabel,
  tierLabel,
  withinTierCeiling,
} from "@/lib/auth/roles";

/**
 * PURE AUTHZ HELPERS (increment G · Kofi R1).
 *
 * The one claim worth stating about these tests: they are about CAPABILITY, not about data. No
 * assertion here touches a row. What an officer can SEE is the database's answer (RLS); what a
 * surface will OFFER is this file's, and the two are tested separately on purpose — a passing
 * predicate must never be mistaken for a scoped read.
 */

describe("the role vocabulary matches the ov_officer_role enum", () => {
  it("has exactly the three posts the directory can hold", () => {
    expect([...OFFICER_ROLES]).toEqual([
      "DISTRICT_OVERSIGHT",
      "REGIONAL_OVERSIGHT",
      "NATIONAL_OVERSIGHT",
    ]);
  });

  it("recognises directory values and rejects invented ones", () => {
    expect(isOfficerRole("DISTRICT_OVERSIGHT")).toBe(true);
    // The legacy fixture string from the §6 tests: NOT a member of the live vocabulary. It stays
    // readable on old audit rows (the column is text) but cannot be treated as a current post.
    expect(isOfficerRole("DISTRICT_DIRECTOR")).toBe(false);
    expect(isOfficerRole("SCHOOL_OVERSIGHT")).toBe(false);
  });

  it("maps each tier to the role the directory's write guard requires", () => {
    expect(ROLE_FOR_TIER).toEqual({
      DISTRICT: "DISTRICT_OVERSIGHT",
      REGION: "REGIONAL_OVERSIGHT",
      NATIONAL: "NATIONAL_OVERSIGHT",
    });
  });
});

describe("there is no SCHOOL-tier officer (Kofi R1)", () => {
  it("SCHOOL is not an officer tier", () => {
    expect([...OFFICER_TIERS]).toEqual(["DISTRICT", "REGION", "NATIONAL"]);
    expect(isOfficerTier("SCHOOL")).toBe(false);
  });

  it("canOpenNamedRecord is true for the three officer tiers and false for SCHOOL", () => {
    expect(canOpenNamedRecord("DISTRICT")).toBe(true);
    expect(canOpenNamedRecord("REGION")).toBe(true);
    expect(canOpenNamedRecord("NATIONAL")).toBe(true);
    expect(canOpenNamedRecord("SCHOOL")).toBe(false);
  });

  it("refuses an UNKNOWN tier rather than ranking it", () => {
    // Fail closed on a value the jurisdiction_level enum has grown and this module has not.
    expect(canOpenNamedRecord("CIRCUIT")).toBe(false);
    expect(canOpenNamedRecord("")).toBe(false);
  });
});

describe("withinTierCeiling — the comparison picker's ceiling", () => {
  it("a district officer may compare at district level and no higher", () => {
    expect(withinTierCeiling("DISTRICT", "DISTRICT")).toBe(true);
    expect(withinTierCeiling("DISTRICT", "SCHOOL")).toBe(true);
    expect(withinTierCeiling("DISTRICT", "REGION")).toBe(false);
    expect(withinTierCeiling("DISTRICT", "NATIONAL")).toBe(false);
  });

  it("a regional officer may compare districts and regions", () => {
    expect(withinTierCeiling("REGION", "DISTRICT")).toBe(true);
    expect(withinTierCeiling("REGION", "REGION")).toBe(true);
    expect(withinTierCeiling("REGION", "NATIONAL")).toBe(false);
  });

  it("a national officer may compare anything", () => {
    for (const target of ["SCHOOL", "DISTRICT", "REGION", "NATIONAL"]) {
      expect(withinTierCeiling("NATIONAL", target)).toBe(true);
    }
  });

  it("a SCHOOL-tier 'officer' may compare NOTHING — they are not an officer", () => {
    for (const target of ["SCHOOL", "DISTRICT", "REGION", "NATIONAL"]) {
      expect(withinTierCeiling("SCHOOL", target)).toBe(false);
    }
  });

  it("an unknown tier on either side refuses", () => {
    expect(withinTierCeiling("CIRCUIT", "DISTRICT")).toBe(false);
    expect(withinTierCeiling("REGION", "CIRCUIT")).toBe(false);
  });
});

describe("chrome labels (Lucy G2 · R6 owner-ratify)", () => {
  it("renders the tier noun, with the Ministry at national", () => {
    expect(tierLabel("DISTRICT")).toBe("District");
    expect(tierLabel("REGION")).toBe("Region");
    expect(tierLabel("NATIONAL")).toBe("National · Ministry of Education");
  });

  it("renders a human role label and passes through anything unrecognised", () => {
    expect(roleLabel("REGIONAL_OVERSIGHT")).toBe("Regional Director");
    // An old/retired post code must still render as itself rather than as an empty slot.
    expect(roleLabel("DISTRICT_DIRECTOR")).toBe("DISTRICT_DIRECTOR");
  });

  it("names the Ministry at national tier and the Service below it", () => {
    expect(institutionLabel("NATIONAL")).toBe("Ministry of Education");
    expect(institutionLabel("REGION")).toBe("Ghana Education Service");
    expect(institutionLabel("DISTRICT")).toBe("Ghana Education Service");
  });
});
