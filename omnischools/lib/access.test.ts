import { describe, it, expect } from "vitest";
import {
  hasAnyRole,
  isFinanceOnly,
  canAccessHouse,
  BOARDING_ROLES,
  SENIOR_LEDGER_ROLES,
  SENIOR_MANAGEMENT_ROLES,
} from "./access";

describe("hasAnyRole", () => {
  it("is true when any held role is allowed", () => {
    expect(hasAnyRole(["TEACHER", "FORM_MASTER"], SENIOR_LEDGER_ROLES)).toBe(true);
  });
  it("is false when no held role is allowed", () => {
    expect(hasAnyRole(["STUDENT"], SENIOR_LEDGER_ROLES)).toBe(false);
  });
  it("is false for an empty role set", () => {
    expect(hasAnyRole([], SENIOR_MANAGEMENT_ROLES)).toBe(false);
  });
});

describe("Senior role groups — the security boundary", () => {
  it("STUDENT and PARENT reach NEITHER senior surface", () => {
    for (const role of ["STUDENT", "PARENT"]) {
      expect(hasAnyRole([role], SENIOR_LEDGER_ROLES)).toBe(false);
      expect(hasAnyRole([role], SENIOR_MANAGEMENT_ROLES)).toBe(false);
    }
  });
  it("a TEACHER uses the ledger but NOT the management progress view", () => {
    expect(hasAnyRole(["TEACHER"], SENIOR_LEDGER_ROLES)).toBe(true);
    expect(hasAnyRole(["TEACHER"], SENIOR_MANAGEMENT_ROLES)).toBe(false);
  });
  it("the Vice Headmaster / Headmaster / Admin reach the management view", () => {
    for (const role of ["VICE_HEADMASTER_ACADEMIC", "HEADMASTER", "ADMIN"]) {
      expect(hasAnyRole([role], SENIOR_MANAGEMENT_ROLES)).toBe(true);
      expect(hasAnyRole([role], SENIOR_LEDGER_ROLES)).toBe(true);
    }
  });
  it("a finance-only user is unaffected by the senior groups (separate concern)", () => {
    expect(isFinanceOnly(["BURSAR"])).toBe(true);
    expect(hasAnyRole(["BURSAR"], SENIOR_LEDGER_ROLES)).toBe(false);
  });
});

describe("Boarding role gate + house-scope (G1/G2/G4)", () => {
  const MINE = "u-hm-1";
  it("BOARDING_ROLES admits the four allowed roles and no others (G1/G2)", () => {
    for (const r of ["ADMIN", "HEADMASTER", "DEAN_OF_BOARDING", "HOUSEMASTER"]) {
      expect(hasAnyRole([r], BOARDING_ROLES)).toBe(true);
    }
    for (const r of ["STUDENT", "PARENT", "TEACHER", "FORM_MASTER", "BURSAR", "MATRON"]) {
      expect(hasAnyRole([r], BOARDING_ROLES)).toBe(false);
    }
  });
  it("school-scoped roles reach any House (G4)", () => {
    for (const r of ["ADMIN", "HEADMASTER", "DEAN_OF_BOARDING"]) {
      expect(canAccessHouse([r], MINE, "someone-else")).toBe(true);
      expect(canAccessHouse([r], MINE, null)).toBe(true);
    }
  });
  it("a plain HOUSEMASTER reaches ONLY the House they master (G4)", () => {
    expect(canAccessHouse(["HOUSEMASTER"], MINE, MINE)).toBe(true);
    expect(canAccessHouse(["HOUSEMASTER"], MINE, "other-house-hm")).toBe(false);
    expect(canAccessHouse(["HOUSEMASTER"], MINE, null)).toBe(false);
  });
  it("a HOUSEMASTER who is ALSO Dean is school-scoped (broadest role wins)", () => {
    expect(canAccessHouse(["HOUSEMASTER", "DEAN_OF_BOARDING"], MINE, "other")).toBe(true);
  });
  it("a role outside the boarding set reaches no House", () => {
    expect(canAccessHouse(["TEACHER"], MINE, MINE)).toBe(false);
  });
});
