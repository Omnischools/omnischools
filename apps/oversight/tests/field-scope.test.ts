import { describe, expect, it } from "vitest";
import {
  ALL_SCOPEABLE_FIELDS,
  IDENTITY_SPINE_FIELDS,
  NEVER_RELEASE_FIELDS,
  STAFF_REASON_CODES,
  allowedFields,
  assertScopeIntegrity,
  FieldScopeError,
  isNeverReleased,
  reasonsReleasing,
  withheldFields,
} from "@/lib/oversight/field-scope";
import { unlockingReasonFor } from "@/lib/oversight/copy";
import { buildStaffProjection } from "@/lib/oversight/staff-projection";

const RECORD_TYPES = ["TEACHER", "STAFF"] as const;
const OWNERSHIP_TYPES = ["PUBLIC", "PRIVATE", "MISSION"] as const;

describe("Kofi group D/E — field scoping is a pure, exhaustive map", () => {
  it("gives every staff reason the full identity spine", () => {
    for (const reason of STAFF_REASON_CODES) {
      for (const recordType of RECORD_TYPES) {
        const fields = allowedFields(reason, recordType);
        for (const spine of IDENTITY_SPINE_FIELDS) {
          expect(fields, `${reason}/${recordType} is missing ${spine}`).toContain(spine);
        }
      }
    }
  });

  it("gives TEACHER and STAFF identical scope for the same reason", () => {
    // The lawful basis decides WHETHER the record opens; the reason decides WHAT is in it.
    for (const reason of STAFF_REASON_CODES) {
      expect(allowedFields(reason, "TEACHER")).toEqual(allowedFields(reason, "STAFF"));
    }
  });

  it("ESTABLISHMENT_PAYROLL_VERIFICATION releases appointment + establishment, not DOB/address/licence", () => {
    const f = allowedFields("ESTABLISHMENT_PAYROLL_VERIFICATION", "TEACHER");
    expect(f).toContain("appointment_start_date");
    expect(f).toContain("appointment_end_date");
    expect(f).toContain("establishment_post_count");
    expect(f).not.toContain("date_of_birth");
    expect(f).not.toContain("address");
    expect(f).not.toContain("emergency_contact");
    expect(f).not.toContain("ntc_licence_number");
  });

  it("TEACHER_ABSENCE_INVESTIGATION releases attendance + assignment scope, not licence/DOB/address", () => {
    const f = allowedFields("TEACHER_ABSENCE_INVESTIGATION", "TEACHER");
    expect(f).toContain("staff_attendance_facts");
    expect(f).toContain("assignment_scope");
    expect(f).toContain("appointment_start_date");
    expect(f).not.toContain("ntc_licence_number");
    expect(f).not.toContain("date_of_birth");
    expect(f).not.toContain("address");
    expect(f).not.toContain("emergency_contact");
  });

  it("LICENSURE_QUALIFICATION_VERIFICATION releases NTC + N&MC + qualifications, not DOB/address", () => {
    const f = allowedFields("LICENSURE_QUALIFICATION_VERIFICATION", "STAFF");
    for (const field of [
      "ntc_licence_number",
      "ntc_licence_expiry",
      "nmc_licence_number",
      "nmc_licence_expiry",
      "qualification_level",
      "highest_qualification",
      "specialisations",
    ]) {
      expect(f).toContain(field);
    }
    expect(f).not.toContain("date_of_birth");
    expect(f).not.toContain("address");
    expect(f).not.toContain("emergency_contact");
  });

  it("STATUTORY_AUDIT is establishment ∪ licensure ∪ DOB ∪ address — and stops there", () => {
    const audit = allowedFields("STATUTORY_AUDIT", "TEACHER");
    const establishment = allowedFields("ESTABLISHMENT_PAYROLL_VERIFICATION", "TEACHER");
    const licensure = allowedFields("LICENSURE_QUALIFICATION_VERIFICATION", "TEACHER");
    for (const f of [...establishment, ...licensure]) expect(audit).toContain(f);
    expect(audit).toContain("date_of_birth");
    expect(audit).toContain("address");
    // The broadest reason still does not reach next of kin.
    expect(audit).not.toContain("emergency_contact");
    expect(audit).not.toContain("phone");
  });

  it("SAFEGUARDING_MISCONDUCT is the ONLY reason unlocking emergency_contact or phone", () => {
    for (const reason of STAFF_REASON_CODES) {
      const f = allowedFields(reason, "STAFF");
      const unlocksWelfare = f.includes("emergency_contact") || f.includes("phone");
      expect(unlocksWelfare, `${reason} must not unlock welfare contact`).toBe(
        reason === "SAFEGUARDING_MISCONDUCT",
      );
    }
    const safeguarding = allowedFields("SAFEGUARDING_MISCONDUCT", "STAFF");
    expect(safeguarding).toContain("emergency_contact");
    expect(safeguarding).toContain("phone");
    expect(safeguarding).toContain("date_of_birth");
    expect(safeguarding).toContain("address");
  });
});

describe("Kofi group E — NEVER-RELEASE, across the full reason × record-type × ownership matrix", () => {
  it("no reason releases any compensation field, salary_status or staff notes", () => {
    for (const reason of STAFF_REASON_CODES) {
      for (const recordType of RECORD_TYPES) {
        for (const ownership of OWNERSHIP_TYPES) {
          // Ownership does not enter the field map at all — which IS the property under test:
          // a private school's staff do not get a narrower or wider record, they get the same one
          // or none at all. Iterating it here documents that and fails if that ever changes.
          const fields = allowedFields(reason, recordType);
          for (const forbidden of NEVER_RELEASE_FIELDS) {
            expect(
              fields.includes(forbidden),
              `${reason}/${recordType}/${ownership} released ${forbidden}`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it("never-released fields are not even in the scopeable domain", () => {
    for (const forbidden of NEVER_RELEASE_FIELDS) {
      expect(ALL_SCOPEABLE_FIELDS).not.toContain(forbidden);
      expect(isNeverReleased(forbidden)).toBe(true);
    }
  });

  it("the generated SQL projection names no never-released column, for any reason", () => {
    for (const reason of STAFF_REASON_CODES) {
      const { text } = buildStaffProjection(allowedFields(reason, "TEACHER"));
      expect(text).not.toMatch(/staff_compensation/i);
      for (const forbidden of NEVER_RELEASE_FIELDS) {
        expect(text, `${reason} projection names ${forbidden}`).not.toMatch(
          new RegExp(`\\b${forbidden}\\b`, "i"),
        );
      }
    }
  });

  it("refuses to build a projection that names a never-released field", () => {
    expect(() => buildStaffProjection(["full_name", "monthly_amount"])).toThrowError(
      /never-released/i,
    );
  });

  it("module-load integrity check is executable and passes", () => {
    expect(() => assertScopeIntegrity()).not.toThrow();
  });
});

describe("Kofi group K — students are not reachable, and unknown reasons release nothing", () => {
  it("throws STUDENT_NOT_REACHABLE for a student record type", () => {
    try {
      allowedFields("STATUTORY_AUDIT", "STUDENT");
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FieldScopeError);
      expect((err as FieldScopeError).code).toBe("STUDENT_NOT_REACHABLE");
    }
  });

  it("throws on a student reason code borrowed from the §6 student set", () => {
    for (const studentReason of [
      "FSHS_CLAIM_VERIFICATION",
      "WITHDRAWAL_ANOMALY_INVESTIGATION",
      "SAFEGUARDING_CASEWORK",
    ]) {
      expect(() => allowedFields(studentReason, "STAFF")).toThrowError(FieldScopeError);
    }
  });
});

describe("reasonsReleasing — the ONE derivation of 'which reason would unlock this'", () => {
  it("agrees with allowedFields for every field × reason pair (it IS the matrix, transposed)", () => {
    for (const field of ALL_SCOPEABLE_FIELDS) {
      const derived = reasonsReleasing(field);
      for (const reason of STAFF_REASON_CODES) {
        expect(derived.includes(reason), `${reason} / ${field}`).toBe(
          allowedFields(reason, "STAFF").includes(field),
        );
      }
    }
  });

  it("covers the qualification fields the old hand-written copy silently missed", () => {
    // `unlockingReasonFor` used to be a second copy of the matrix written as string-prefix
    // heuristics. These three are in LICENSURE_FIELDS but began with neither "ntc_" nor "nmc_", so
    // they matched no branch and the record screen's scope line said nothing about them at all.
    for (const field of [
      "qualification_level",
      "highest_qualification",
      "undergraduate",
    ]) {
      expect(reasonsReleasing(field), field).toEqual([
        "LICENSURE_QUALIFICATION_VERIFICATION",
        "STATUTORY_AUDIT",
      ]);
      expect(unlockingReasonFor(field), field).toBe(
        "Licensure & qualification verification, or Statutory audit",
      );
    }
  });

  it("names exactly one reason for the welfare-contact fields", () => {
    for (const field of ["emergency_contact", "phone"]) {
      expect(reasonsReleasing(field)).toEqual(["SAFEGUARDING_MISCONDUCT"]);
      expect(unlockingReasonFor(field)).toBe("Safeguarding / misconduct casework");
    }
  });

  it("returns nothing for a never-released field — which is not the same as 'some other reason'", () => {
    for (const forbidden of NEVER_RELEASE_FIELDS) {
      expect(reasonsReleasing(forbidden), forbidden).toEqual([]);
      expect(unlockingReasonFor(forbidden), forbidden).toBeNull();
    }
    expect(reasonsReleasing("a_field_that_does_not_exist")).toEqual([]);
  });

  it("every scopeable field has at least one unlocking reason to name", () => {
    // The property the drifted copy broke: a withheld field the officer is told nothing about.
    for (const field of ALL_SCOPEABLE_FIELDS) {
      expect(unlockingReasonFor(field), field).not.toBeNull();
    }
  });
});

describe("Lucy C7 — withheld is the complement of released, and is never empty by accident", () => {
  it("withheld ∪ released = the whole scopeable domain, with no overlap", () => {
    for (const reason of STAFF_REASON_CODES) {
      const released = allowedFields(reason, "STAFF");
      const withheld = withheldFields(reason, "STAFF");
      expect([...released, ...withheld].sort()).toEqual([...ALL_SCOPEABLE_FIELDS].sort());
      for (const f of withheld) expect(released).not.toContain(f);
    }
  });
});
