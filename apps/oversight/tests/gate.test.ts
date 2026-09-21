import { afterAll, describe, expect, it } from "vitest";
import {
  requestNamedStaffRecord,
  requestStaffListBrowse,
  assertStudentsNotIndividuallyReachable,
  GateInputError,
} from "@/lib/oversight/named-record-access";
import { NEVER_RELEASE_FIELDS, STAFF_REASON_CODES } from "@/lib/oversight/field-scope";
import { closeReadback } from "@/lib/db/readback";
import { CONSENT_ID, EMIS, GES_STAFF_ID, OPS_SCHOOL, OPS_STAFF } from "./fixtures/ids";
import { SCHOOL } from "./fixtures/schools";
import { auditRowsFor, caseRef, districtOfficer, nationalOfficer } from "./helpers";

afterAll(async () => {
  await closeReadback();
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Kofi group F — the STATUTORY branch (GES-establishment teacher)", () => {
  it("grants without any consent, records STATUTORY, and refs the subject by GES id", async () => {
    const reference = caseRef("statutory-grant");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "ESTABLISHMENT_PAYROLL_VERIFICATION",
      caseReference: reference,
      subject: {
        operationalStaffId: OPS_STAFF.teacherOnRegister,
        gesStaffId: GES_STAFF_ID.onRegister,
      },
    });

    expect(result.outcome).toBe("GRANTED");
    if (result.outcome !== "GRANTED") return;
    expect(result.legalBasis).toBe("STATUTORY");
    expect(result.consentRef).toBeNull();
    expect(result.staffCategory).toBe("GES_TEACHER");
    expect(result.recordType).toBe("TEACHER");
    expect(result.targetRef).toBe(`GES:${GES_STAFF_ID.onRegister}`);
    expect(result.record.full_name).toBe("Ama Boateng");
    expect(result.record.is_on_ges_establishment).toBe(true);
    expect(result.record.appointment_start_date).toBeTruthy();

    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: "GRANTED",
      legal_basis: "STATUTORY",
      consent_ref: null,
      record_type: "TEACHER",
      staff_category: "GES_TEACHER",
      reason_code: "ESTABLISHMENT_PAYROLL_VERIFICATION",
      case_reference: reference,
      officer_role: districtOfficer.officerRole,
      exported: false,
    });
    expect(rows[0]!.fields_released).toEqual([...result.fieldsReleased]);
  });

  it("works at a school that has NOT granted consent — statute does not ask", async () => {
    const reference = caseRef("statutory-no-consent-school");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicNoConsent,
      reasonCode: "LICENSURE_QUALIFICATION_VERIFICATION",
      caseReference: reference,
      subject: {
        operationalStaffId: OPS_STAFF.staffNoConsentSchool,
        gesStaffId: "GES/WR/00002",
      },
    });
    expect(result.outcome).toBe("GRANTED");
    if (result.outcome !== "GRANTED") return;
    expect(result.legalBasis).toBe("STATUTORY");
    expect(result.record.ntc_licence_number).toBe("NTC-2018-002210");
  });

  it("writes the audit row BEFORE the record is fetched", async () => {
    const reference = caseRef("order");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "STATUTORY_AUDIT",
      caseReference: reference,
      subject: {
        operationalStaffId: OPS_STAFF.teacherOnRegister,
        gesStaffId: GES_STAFF_ID.onRegister,
      },
    });
    expect(result.trace.indexOf("audit:GRANTED")).toBeGreaterThan(-1);
    expect(result.trace.indexOf("fetched")).toBeGreaterThan(
      result.trace.indexOf("audit:GRANTED"),
    );
    // Classification happens before any operational connection is opened.
    expect(result.trace.indexOf("classified:GES_TEACHER")).toBeLessThan(
      result.trace.indexOf("school:confirmed"),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Kofi group G — the CONSENT branch (non-GES / non-teaching staff)", () => {
  it("grants at a consenting PUBLIC school and records the consent artefact relied on", async () => {
    const reference = caseRef("consent-grant");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "ESTABLISHMENT_PAYROLL_VERIFICATION",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister, gesStaffId: null },
    });

    expect(result.outcome).toBe("GRANTED");
    if (result.outcome !== "GRANTED") return;
    expect(result.legalBasis).toBe("CONSENT");
    expect(result.consentRef).toBe(CONSENT_ID.publicConsented);
    expect(result.recordType).toBe("STAFF");
    expect(result.staffCategory).toBe("OTHER_STAFF");
    expect(result.targetRef).toBe(
      `OPS:${EMIS.publicConsented}:${OPS_STAFF.clerkNotOnRegister}`,
    );
    expect(result.record.full_name).toBe("Kojo Mensah");
    expect(result.record.is_on_ges_establishment).toBe(false);

    const rows = await auditRowsFor(reference);
    expect(rows[0]).toMatchObject({
      legal_basis: "CONSENT",
      consent_ref: CONSENT_ID.publicConsented,
      record_type: "STAFF",
      staff_category: "OTHER_STAFF",
    });
  });

  it("DENIES at a public school with no consent row, and logs the denial with no fields", async () => {
    const reference = caseRef("no-consent");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicNoConsent,
      reasonCode: "SAFEGUARDING_MISCONDUCT",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.staffNoConsentSchool, gesStaffId: null },
    });

    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    if (result.outcome === "GRANTED") return;
    expect(result.denialReason).toBe("NO_CONSENT_ON_RECORD");
    expect(result.fieldsReleased).toEqual([]);

    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: "DENIED_NO_CONSENT",
      legal_basis: "CONSENT",
      consent_ref: null,
      staff_category: "OTHER_STAFF",
      case_reference: reference,
    });
    expect(rows[0]!.fields_released).toEqual([]);
  });

  it("DENIES on REVOKED consent exactly as on no consent at all", async () => {
    const reference = caseRef("revoked");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicRevoked,
      reasonCode: "TEACHER_ABSENCE_INVESTIGATION",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.staffRevokedSchool, gesStaffId: null },
    });
    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    if (result.outcome === "GRANTED") return;
    expect(result.denialReason).toBe("CONSENT_REVOKED");
    const rows = await auditRowsFor(reference);
    expect(rows[0]!.fields_released).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Kofi group H — staleness falls through to consent, and then closes", () => {
  it("a teacher on a 400-day-old extract at a school with no consent is DENIED_STALE_ESTABLISHMENT", async () => {
    const reference = caseRef("stale");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicStale,
      reasonCode: "ESTABLISHMENT_PAYROLL_VERIFICATION",
      caseReference: reference,
      subject: {
        operationalStaffId: OPS_STAFF.teacherStaleRegister,
        gesStaffId: GES_STAFF_ID.onStaleRegister,
      },
    });
    expect(result.outcome).toBe("DENIED_STALE_ESTABLISHMENT");
    if (result.outcome === "GRANTED") return;
    expect(result.denialReason).toBe("ESTABLISHMENT_STALE");
    // It fell through to the consent branch, so the row records CONSENT and an OPS ref — the basis
    // it was actually judged on, not the one the officer hoped for.
    expect(result.legalBasis).toBe("CONSENT");
    expect(result.recordType).toBe("STAFF");
    const rows = await auditRowsFor(reference);
    expect(rows[0]).toMatchObject({
      outcome: "DENIED_STALE_ESTABLISHMENT",
      legal_basis: "CONSENT",
      staff_category: "OTHER_STAFF",
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Kofi group I — the non-public feature flag", () => {
  it("DENIES a PRIVATE school's staff even though that school HAS granted consent", async () => {
    const reference = caseRef("flag-off");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.privateConsented,
      reasonCode: "LICENSURE_QUALIFICATION_VERIFICATION",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.staffPrivateSchool, gesStaffId: null },
    });
    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    if (result.outcome === "GRANTED") return;
    expect(result.denialReason).toBe("NON_PUBLIC_FLAG_OFF");
    // Refused BEFORE any operational connection: the trace never reaches the school confirmation.
    expect(result.trace).not.toContain("school:confirmed");
    expect(result.trace).toContain("preflight:FLAG_OFF_NON_PUBLIC");
    const rows = await auditRowsFor(reference);
    expect(rows[0]!.fields_released).toEqual([]);
  });

  it("an UNKNOWN ownership type is refused too — a data gap is not a grant", async () => {
    // EMIS-UNK-006 is in the register with ownership_type NULL and HAS live DPO consent, so the
    // only thing that can refuse it is the missing ownership. Its operational row claims PUBLIC —
    // which the gate ignores, because ownership comes from the GES register, not from the school.
    const reference = caseRef("unknown-ownership");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.unknownOwnership,
      reasonCode: "STATUTORY_AUDIT",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.staffUnknownOwnership, gesStaffId: null },
    });
    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    if (result.outcome === "GRANTED") return;
    expect(result.denialReason).toBe("UNKNOWN_OWNERSHIP");
    expect(result.trace).not.toContain("school:confirmed");
  });

  it("a GES teacher at a PRIVATE school is unaffected by the flag (statute holds everywhere)", async () => {
    const reference = caseRef("private-statutory");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.privateConsented,
      reasonCode: "ESTABLISHMENT_PAYROLL_VERIFICATION",
      caseReference: reference,
      subject: {
        operationalStaffId: OPS_STAFF.staffPrivateSchool,
        gesStaffId: "GES/WR/00003",
      },
    });
    expect(result.outcome).toBe("GRANTED");
    if (result.outcome !== "GRANTED") return;
    expect(result.legalBasis).toBe("STATUTORY");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Kofi group E (runtime) — nothing released is ever a compensation field", () => {
  it("across every reason code, a granted record carries no never-released key", async () => {
    for (const reason of STAFF_REASON_CODES) {
      const reference = caseRef(`matrix-${reason}`);
      const result = await requestNamedStaffRecord({
        officer: districtOfficer,
        school: SCHOOL.publicConsented,
        reasonCode: reason,
        caseReference: reference,
        subject: {
          operationalStaffId: OPS_STAFF.teacherOnRegister,
          gesStaffId: GES_STAFF_ID.onRegister,
        },
      });
      expect(result.outcome, reason).toBe("GRANTED");
      if (result.outcome !== "GRANTED") continue;
      for (const forbidden of NEVER_RELEASE_FIELDS) {
        expect(Object.keys(result.record), `${reason} leaked ${forbidden}`).not.toContain(
          forbidden,
        );
      }
      const rows = await auditRowsFor(reference);
      for (const forbidden of NEVER_RELEASE_FIELDS) {
        expect(rows[0]!.fields_released).not.toContain(forbidden);
      }
    }
  });

  it("the target_ref is never a name", async () => {
    const reference = caseRef("no-name-in-ref");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "SAFEGUARDING_MISCONDUCT",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister, gesStaffId: null },
    });
    if (result.outcome !== "GRANTED") throw new Error("expected a grant");
    expect(result.targetRef).not.toMatch(/Kojo|Mensah/i);
    const rows = await auditRowsFor(reference);
    expect(rows[0]!.target_ref).not.toMatch(/Kojo|Mensah/i);
    expect(rows[0]!.target_ref.startsWith("OPS:")).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Kofi group J — export is the same logged event", () => {
  it("records exported = true and the format on the SAME row shape", async () => {
    const reference = caseRef("export");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "STATUTORY_AUDIT",
      caseReference: reference,
      subject: {
        operationalStaffId: OPS_STAFF.teacherOnRegister,
        gesStaffId: GES_STAFF_ID.onRegister,
      },
      exportFormat: "CSV",
    });
    expect(result.outcome).toBe("GRANTED");
    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      exported: true,
      export_format: "CSV",
      outcome: "GRANTED",
      legal_basis: "STATUTORY",
    });
    expect((rows[0]!.fields_released ?? []).length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Lucy C4 — the staff-list browse is logged as a browse", () => {
  it("logs roster_browsed = true with no fields released, then returns the list", async () => {
    const reference = caseRef("browse");
    const result = await requestStaffListBrowse({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "ESTABLISHMENT_PAYROLL_VERIFICATION",
      caseReference: reference,
    });
    expect(result.outcome).toBe("GRANTED");
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every((r) => r.register_status === "NOT_LINKED")).toBe(true);

    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      roster_browsed: true,
      record_type: "STAFF",
      outcome: "GRANTED",
    });
    expect(rows[0]!.fields_released).toEqual([]);
    expect(rows[0]!.target_ref).toBe(`OPS:${EMIS.publicConsented}:ROSTER`);
  });

  it("a browse at a non-consenting school is DENIED and logged, and returns no names", async () => {
    const reference = caseRef("browse-denied");
    const result = await requestStaffListBrowse({
      officer: districtOfficer,
      school: SCHOOL.publicNoConsent,
      reasonCode: "ESTABLISHMENT_PAYROLL_VERIFICATION",
      caseReference: reference,
    });
    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    expect(result.rows).toEqual([]);
    const rows = await auditRowsFor(reference);
    expect(rows[0]).toMatchObject({ roster_browsed: true, outcome: "DENIED_NO_CONSENT" });
  });

  it("browse then open writes TWO append-only rows under one case reference", async () => {
    const reference = caseRef("browse-then-open");
    await requestStaffListBrowse({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "ESTABLISHMENT_PAYROLL_VERIFICATION",
      caseReference: reference,
    });
    await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "ESTABLISHMENT_PAYROLL_VERIFICATION",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister, gesStaffId: null },
      rosterBrowsed: true,
    });
    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.roster_browsed)).toBe(true);
    expect(rows.map((r) => r.target_ref)).toEqual([
      `OPS:${EMIS.publicConsented}:ROSTER`,
      `OPS:${EMIS.publicConsented}:${OPS_STAFF.clerkNotOnRegister}`,
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("input integrity", () => {
  it("refuses a tenant uuid that does not belong to the EMIS school picked", async () => {
    await expect(
      requestNamedStaffRecord({
        officer: districtOfficer,
        school: {
          ...SCHOOL.publicConsented,
          operationalSchoolId: OPS_SCHOOL.publicNoConsent, // someone else's tenant
        },
        reasonCode: "STATUTORY_AUDIT",
        caseReference: caseRef("mismatch"),
        subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister, gesStaffId: null },
      }),
    ).rejects.toBeInstanceOf(GateInputError);
  });

  it("requires a case reference", async () => {
    await expect(
      requestNamedStaffRecord({
        officer: districtOfficer,
        school: SCHOOL.publicConsented,
        reasonCode: "STATUTORY_AUDIT",
        caseReference: "   ",
        subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister, gesStaffId: null },
      }),
    ).rejects.toBeInstanceOf(GateInputError);
  });

  it("an unknown reason code releases nothing and is logged as DENIED_FIELD_SCOPE", async () => {
    const reference = caseRef("bad-reason");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "FSHS_CLAIM_VERIFICATION", // a STUDENT reason on a staff subject
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister, gesStaffId: null },
    });
    expect(result.outcome).toBe("DENIED_FIELD_SCOPE");
    const rows = await auditRowsFor(reference);
    expect(rows[0]!.fields_released).toEqual([]);
  });

  it("students are not individually reachable through this subsystem", () => {
    expect(() => assertStudentsNotIndividuallyReachable()).not.toThrow();
  });

  it("a subject that does not exist is DENIED, and the audit row says no fields were released", async () => {
    const reference = caseRef("subject-absent");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      // SAFEGUARDING is the widest welfare scope — if the audit row were written optimistically it
      // would permanently claim that a DOB, an address and a next-of-kin phone were released.
      reasonCode: "SAFEGUARDING_MISCONDUCT",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.absent, gesStaffId: null },
    });

    expect(result.outcome).toBe("DENIED_FIELD_SCOPE");
    if (result.outcome === "GRANTED") return;
    expect(result.denialReason).toBe("SUBJECT_NOT_FOUND");
    expect(result.trace).toContain("subject:absent");
    // The existence probe runs BEFORE the audit write, so there is exactly ONE row and it is a
    // denial — never a GRANTED row listing fields that were never fetched.
    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("DENIED_FIELD_SCOPE");
    expect(rows[0]!.fields_released).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("the jurisdiction ceiling is enforced by the choke point itself", () => {
  // EMIS-OUT-008 is in the OTHER district and HAS live DPO consent, so the only thing that can
  // refuse it is the ceiling. Previously this returned a full record: the check lived only in the
  // server action, and a direct call bypassed it.
  it("refuses a record request for a school outside the officer's subtree", async () => {
    const reference = caseRef("out-of-subtree");
    await expect(
      requestNamedStaffRecord({
        officer: districtOfficer,
        school: SCHOOL.outsideSubtree,
        reasonCode: "SAFEGUARDING_MISCONDUCT",
        caseReference: reference,
        subject: { operationalStaffId: OPS_STAFF.staffOutsideSubtree, gesStaffId: null },
      }),
    ).rejects.toMatchObject({ name: "GateInputError", code: "OUT_OF_JURISDICTION" });
    // Nothing was disclosed and nothing was logged — the officer had no standing to name the school.
    expect(await auditRowsFor(reference)).toHaveLength(0);
  });

  it("refuses a staff-LIST browse for a school outside the officer's subtree", async () => {
    const reference = caseRef("out-of-subtree-browse");
    await expect(
      requestStaffListBrowse({
        officer: districtOfficer,
        school: SCHOOL.outsideSubtree,
        reasonCode: "ESTABLISHMENT_PAYROLL_VERIFICATION",
        caseReference: reference,
      }),
    ).rejects.toMatchObject({ name: "GateInputError", code: "OUT_OF_JURISDICTION" });
    expect(await auditRowsFor(reference)).toHaveLength(0);
  });

  it("does NOT downgrade an out-of-subtree school to the consent branch", async () => {
    // The subtle failure this replaces: RLS hides the establishment row, classification reads that
    // as NO_ESTABLISHMENT_ROW, and the request quietly becomes an OTHER_STAFF consent request
    // against a school in another region — which then SUCCEEDS, because that school consented.
    await expect(
      requestNamedStaffRecord({
        officer: districtOfficer,
        school: SCHOOL.outsideSubtree,
        reasonCode: "STATUTORY_AUDIT",
        caseReference: caseRef("no-downgrade"),
        subject: {
          operationalStaffId: OPS_STAFF.staffOutsideSubtree,
          gesStaffId: GES_STAFF_ID.onRegister,
        },
      }),
    ).rejects.toMatchObject({ code: "OUT_OF_JURISDICTION" });
  });

  it("the NATIONAL tier reaches the same school (the ceiling is a ceiling, not a wall)", async () => {
    const reference = caseRef("national-reaches");
    const result = await requestNamedStaffRecord({
      officer: nationalOfficer,
      school: SCHOOL.outsideSubtree,
      reasonCode: "LICENSURE_QUALIFICATION_VERIFICATION",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.staffOutsideSubtree, gesStaffId: null },
    });
    expect(result.outcome).toBe("GRANTED");
    if (result.outcome !== "GRANTED") return;
    expect(result.legalBasis).toBe("CONSENT");
    expect(result.record.full_name).toBe("Selorm Appiah");
  });
});
