import { afterAll, describe, expect, it } from "vitest";
import {
  requestNamedStaffRecord,
  requestStaffListBrowse,
  assertStudentsNotIndividuallyReachable,
  GateInputError,
} from "@/lib/oversight/named-record-access";
import { NEVER_RELEASE_FIELDS, STAFF_REASON_CODES } from "@/lib/oversight/field-scope";
import { closeReadback } from "@/lib/db/readback";
import { CONSENT_ID, EMIS, NTC_LICENCE, OPS_STAFF } from "./fixtures/ids";
import { SCHOOL } from "./fixtures/schools";
import {
  adminAnalytics,
  auditRowsFor,
  caseRef,
  districtOfficer,
  nationalOfficer,
} from "./helpers";

afterAll(async () => {
  await closeReadback();
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("S1 — the statutory basis is the fetched row's NTC licence; there is nothing to forge", () => {
  // The officer supplies NO establishment identifier. The NTC licence is read off the operational
  // row itself, so the basis follows the ROW, not any fact a request could carry (AC-3.5/3.7/3.8).

  it("(a) a row with NO establishment licence is CONSENT — a colleague's membership cannot be borrowed", async () => {
    // clerkNotOnRegister and teacherOnRegister are at the SAME school, and that school HAS a GES
    // teacher on the register. The clerk still resolves to CONSENT: there is no request field to
    // point at the teacher's licence, and the clerk's own row carries none.
    const reference = caseRef("row-decides-consent");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "SAFEGUARDING_MISCONDUCT",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister },
    });
    expect(result.outcome).toBe("GRANTED");
    if (result.outcome !== "GRANTED") return;
    expect(result.legalBasis).toBe("CONSENT");
    expect(result.staffCategory).toBe("OTHER_STAFF");
    expect(result.recordType).toBe("STAFF");
    expect(result.targetRef).toBe(
      `OPS:${EMIS.publicConsented}:${OPS_STAFF.clerkNotOnRegister}`,
    );
    expect(result.record.is_on_ges_establishment).toBe(false);
  });

  it("(b) the SAME request shape on the establishment row IS statutory — the basis follows the row (AC-3.5)", async () => {
    const reference = caseRef("row-decides-statutory");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "SAFEGUARDING_MISCONDUCT",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.teacherOnRegister },
    });
    expect(result.outcome).toBe("GRANTED");
    if (result.outcome !== "GRANTED") return;
    expect(result.legalBasis).toBe("STATUTORY");
    expect(result.staffCategory).toBe("GES_TEACHER");
    expect(result.recordType).toBe("TEACHER");
    // The ref names the licence READ OFF the row — no consent was consulted.
    expect(result.targetRef).toBe(`NTC:${NTC_LICENCE.onRegister}`);
    expect(result.consentRef).toBeNull();
    expect(result.record.is_on_ges_establishment).toBe(true);

    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      legal_basis: "STATUTORY",
      record_type: "TEACHER",
      staff_category: "GES_TEACHER",
      consent_ref: null,
    });
    expect(rows[0]!.target_ref).toBe(`NTC:${NTC_LICENCE.onRegister}`);
  });

  it("(c) an absent/unregistered licence is a clean CONSENT branch — never a MISMATCH/forgery denial (AC-3.8)", async () => {
    // The old footgun turned an empty binding column into an ESTABLISHMENT_ID_MISMATCH *denial*.
    // That reason is gone, and a subject not on the register simply flows to consent and (here)
    // grants — the DenialReason union no longer even contains a mismatch value.
    const reference = caseRef("no-mismatch-footgun");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "ESTABLISHMENT_PAYROLL_VERIFICATION",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister },
    });
    expect(result.outcome).toBe("GRANTED");
    if (result.outcome !== "GRANTED") return;
    expect(result.legalBasis).toBe("CONSENT");
    // No mismatch/forgery trace token exists any more.
    expect(result.trace.some((t) => /mismatch|binding|MISMATCH/i.test(t))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Kofi group F — ordering, on the path a record actually takes", () => {
  it("classifies BEFORE the audit row, and writes the audit row BEFORE the record is fetched", async () => {
    const reference = caseRef("order");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "STATUTORY_AUDIT",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.teacherOnRegister },
    });
    expect(result.outcome).toBe("GRANTED");
    // Classification (keyed on the licence read off the row) precedes the audit write …
    expect(result.trace.indexOf("classified:GES_TEACHER")).toBeGreaterThan(-1);
    expect(result.trace.indexOf("classified:GES_TEACHER")).toBeLessThan(
      result.trace.indexOf("audit:GRANTED"),
    );
    // … and the audit write precedes the fetch.
    expect(result.trace.indexOf("fetched")).toBeGreaterThan(
      result.trace.indexOf("audit:GRANTED"),
    );
    // A statutory access consults no consent row at all.
    expect(result.trace.some((t) => t.startsWith("consent:"))).toBe(false);
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
      subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister },
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
    // Not on the register, so the honest field value is a plain false — the gate did not treat this
    // person as an establishment teacher, and says so.
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
      subject: { operationalStaffId: OPS_STAFF.staffNoConsentSchool },
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
      subject: { operationalStaffId: OPS_STAFF.staffRevokedSchool },
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
      subject: { operationalStaffId: OPS_STAFF.teacherStaleRegister },
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
describe("Kofi group I — the non-public feature flag (and where statute overrides it)", () => {
  it("DENIES a PRIVATE school's non-establishment staff even though that school HAS granted consent", async () => {
    const reference = caseRef("flag-off");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.privateConsented,
      reasonCode: "LICENSURE_QUALIFICATION_VERIFICATION",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.staffPrivateSchool },
    });
    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    if (result.outcome === "GRANTED") return;
    expect(result.denialReason).toBe("NON_PUBLIC_FLAG_OFF");
    // The subject was classified OTHER_STAFF, so the flag applies; the preflight refused before any
    // scoped field was fetched.
    expect(result.trace).toContain("classified:OTHER_STAFF");
    expect(result.trace).toContain("preflight:FLAG_OFF_NON_PUBLIC");
    expect(result.trace).not.toContain("fetched");
    const rows = await auditRowsFor(reference);
    expect(rows[0]!.fields_released).toEqual([]);
  });

  it("STATUTE overrides the flag: a GES-establishment teacher at a PRIVATE school is GRANTED with the flag OFF (AC-3.10)", async () => {
    // teacherPrivateOnRegister's NTC is on EMIS-PRI-003's establishment and the GES name matches, so
    // the subject is a verified establishment teacher. The non-public flag is off (suite default),
    // and it must NOT touch statute — the record opens under STATUTORY at a private school.
    const reference = caseRef("statute-at-private-flag-off");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.privateConsented,
      reasonCode: "STATUTORY_AUDIT",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.teacherPrivateOnRegister },
    });
    expect(result.outcome).toBe("GRANTED");
    if (result.outcome !== "GRANTED") return;
    expect(result.legalBasis).toBe("STATUTORY");
    expect(result.staffCategory).toBe("GES_TEACHER");
    expect(result.record.full_name).toBe("Kofi Adomako");
    // The flag preflight never ran — statute skips it entirely.
    expect(result.trace).not.toContain("preflight:FLAG_OFF_NON_PUBLIC");
    const rows = await auditRowsFor(reference);
    expect(rows[0]).toMatchObject({ legal_basis: "STATUTORY", record_type: "TEACHER" });
  });

  it("a name-mismatch teacher at a PRIVATE school (flag off) is DENIED — the mismatch strips statute, the flag then refuses", async () => {
    // teacherPrivateNameMismatch's NTC IS on the register, but GES named it differently from the
    // operational row → OC-NTC-RESIDUAL demotes to CONSENT. With the flag off, the consent branch
    // refuses. If the mismatch had NOT stripped statute, this would have been granted.
    const reference = caseRef("name-mismatch-flag-off");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.privateConsented,
      reasonCode: "STATUTORY_AUDIT",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.teacherPrivateNameMismatch },
    });
    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    if (result.outcome === "GRANTED") return;
    expect(result.denialReason).toBe("NON_PUBLIC_FLAG_OFF");
    expect(result.legalBasis).toBe("CONSENT");
    expect(result.trace).toContain("establishment:name-mismatch");
    expect(result.trace).toContain("preflight:FLAG_OFF_NON_PUBLIC");
    expect(result.trace).not.toContain("fetched");
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
      subject: { operationalStaffId: OPS_STAFF.staffUnknownOwnership },
    });
    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    if (result.outcome === "GRANTED") return;
    expect(result.denialReason).toBe("UNKNOWN_OWNERSHIP");
    expect(result.trace).not.toContain("fetched");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("AC-1.6 — a school with no operational tenant mapping is refused, never guessed", () => {
  it("DENIES a record request for a registered-but-unmapped school, and logs it with no fields", async () => {
    // EMIS-UNM-009 is in the officer's subtree, PUBLIC, but its register operational_school_id is
    // NULL. There is no tenant to read a record from, and the gate must NOT fall back to any
    // request-supplied uuid (there no longer is one). Fail-closed, logged.
    const reference = caseRef("unmapped");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.unmappedOperational,
      reasonCode: "STATUTORY_AUDIT",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.teacherOnRegister },
    });
    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    if (result.outcome === "GRANTED") return;
    expect(result.denialReason).toBe("OPERATIONAL_UNMAPPED");
    expect(result.trace).toContain("school:unmapped");
    expect(result.trace).not.toContain("fetched");
    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fields_released).toEqual([]);

    // The register row really does carry a NULL mapping — the fixture is the scenario, not a mock.
    const sql = adminAnalytics();
    try {
      const reg = (await sql`
        select operational_school_id from ref_emis_school_register
        where emis_school_id = ${EMIS.unmappedOperational}
      `) as unknown as { operational_school_id: string | null }[];
      expect(reg[0]!.operational_school_id).toBeNull();
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("DENIES a staff-LIST browse for an unmapped school too", async () => {
    const reference = caseRef("unmapped-browse");
    const result = await requestStaffListBrowse({
      officer: districtOfficer,
      school: SCHOOL.unmappedOperational,
      reasonCode: "ESTABLISHMENT_PAYROLL_VERIFICATION",
      caseReference: reference,
    });
    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    expect(result.denialReason).toBe("OPERATIONAL_UNMAPPED");
    expect(result.rows).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("Kofi group E (runtime) — nothing released is ever a compensation field", () => {
  it("across every reason code, a granted STATUTORY record carries no never-released key", async () => {
    for (const reason of STAFF_REASON_CODES) {
      const reference = caseRef(`matrix-${reason}`);
      const result = await requestNamedStaffRecord({
        officer: districtOfficer,
        school: SCHOOL.publicConsented,
        reasonCode: reason,
        caseReference: reference,
        subject: { operationalStaffId: OPS_STAFF.teacherOnRegister },
      });
      expect(result.outcome, reason).toBe("GRANTED");
      if (result.outcome !== "GRANTED") continue;
      expect(result.legalBasis, reason).toBe("STATUTORY");
      expect(result.recordType, reason).toBe("TEACHER");
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
      subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister },
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
      subject: { operationalStaffId: OPS_STAFF.teacherOnRegister },
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

  it("a browse with an UNRECOGNISED reason code is DENIED and returns no names", async () => {
    const reference = caseRef("browse-bad-reason");
    const result = await requestStaffListBrowse({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "banana",
      caseReference: reference,
    });

    expect(result.outcome).toBe("DENIED_FIELD_SCOPE");
    expect(result.denialReason).toBe("REASON_UNLOCKS_NOTHING");
    expect(result.rows).toEqual([]);

    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: "DENIED_FIELD_SCOPE",
      roster_browsed: true,
      reason_code: "banana", // stored verbatim, as every stated ground is
    });
    expect(rows[0]!.fields_released).toEqual([]);
  });

  it("refuses a STUDENT reason code on the staff-list browse too", async () => {
    const reference = caseRef("browse-student-reason");
    const result = await requestStaffListBrowse({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "FSHS_CLAIM_VERIFICATION",
      caseReference: reference,
    });
    expect(result.outcome).toBe("DENIED_FIELD_SCOPE");
    expect(result.rows).toEqual([]);
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
      subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister },
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
  it("requires a case reference", async () => {
    await expect(
      requestNamedStaffRecord({
        officer: districtOfficer,
        school: SCHOOL.publicConsented,
        reasonCode: "STATUTORY_AUDIT",
        caseReference: "   ",
        subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister },
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
      subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister },
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
      subject: { operationalStaffId: OPS_STAFF.absent },
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
  it("refuses a record request for a school outside the officer's subtree", async () => {
    const reference = caseRef("out-of-subtree");
    await expect(
      requestNamedStaffRecord({
        officer: districtOfficer,
        school: SCHOOL.outsideSubtree,
        reasonCode: "SAFEGUARDING_MISCONDUCT",
        caseReference: reference,
        subject: { operationalStaffId: OPS_STAFF.staffOutsideSubtree },
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

  it("the NATIONAL tier reaches the same school (the ceiling is a ceiling, not a wall)", async () => {
    const reference = caseRef("national-reaches");
    const result = await requestNamedStaffRecord({
      officer: nationalOfficer,
      school: SCHOOL.outsideSubtree,
      reasonCode: "LICENSURE_QUALIFICATION_VERIFICATION",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.staffOutsideSubtree },
    });
    expect(result.outcome).toBe("GRANTED");
    if (result.outcome !== "GRANTED") return;
    expect(result.legalBasis).toBe("CONSENT");
    expect(result.record.full_name).toBe("Selorm Appiah");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("whole-log invariant — the basis prefix always matches the ref shape (AC-3.9)", () => {
  it("every STATUTORY row is NTC:/TEACHER and every CONSENT row is OPS:", async () => {
    // STATUTORY is REACHABLE now (this file writes several such rows above), the inverse of the old
    // 'no STATUTORY anywhere' invariant. Whatever the interleaving of the parallel suite, the shape
    // must hold for every committed row.
    const sql = adminAnalytics();
    try {
      const statutory = (await sql`
        select target_ref, record_type::text as record_type
        from audit_access_log where legal_basis = 'STATUTORY'
      `) as unknown as { target_ref: string; record_type: string }[];
      expect(statutory.length).toBeGreaterThan(0);
      for (const r of statutory) {
        expect(r.target_ref.startsWith("NTC:"), r.target_ref).toBe(true);
        expect(r.record_type).toBe("TEACHER");
      }
      const consent = (await sql`
        select target_ref from audit_access_log where legal_basis = 'CONSENT'
      `) as unknown as { target_ref: string }[];
      for (const r of consent) {
        expect(r.target_ref.startsWith("NTC:"), r.target_ref).toBe(false);
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
