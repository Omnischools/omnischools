import { describe, it, expect } from "vitest";
import {
  hasAnyRole,
  isFinanceOnly,
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
