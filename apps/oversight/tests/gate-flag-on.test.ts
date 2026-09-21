import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CONSENT_ID, OPS_STAFF } from "./fixtures/ids";
import { SCHOOL } from "./fixtures/schools";
import { auditRowsFor, caseRef, districtOfficer } from "./helpers";

/**
 * Kofi group I — the OTHER side of the non-public flag.
 *
 * A flag test that only proves the OFF state proves very little: a gate that refuses everything
 * would pass it. This file flips `E3_NON_PUBLIC_STAFF_DRILLDOWN` on and shows that the private
 * school's consented staff member then resolves — which is what makes the off-state denial
 * attributable to the flag rather than to some other refusal upstream.
 *
 * It lives in its own file because `lib/env.ts` parses `process.env` at import time: the whole
 * module graph has to be re-imported after the stub, and doing that mid-suite would leave other
 * files holding a stale `env`.
 */

let requestNamedStaffRecord: typeof import("@/lib/oversight/named-record-access").requestNamedStaffRecord;
let closeReadback: typeof import("@/lib/db/readback").closeReadback;

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv("E3_NON_PUBLIC_STAFF_DRILLDOWN", "true");
  ({ requestNamedStaffRecord } = await import("@/lib/oversight/named-record-access"));
  ({ closeReadback } = await import("@/lib/db/readback"));
});

afterAll(async () => {
  await closeReadback();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("with E3_NON_PUBLIC_STAFF_DRILLDOWN on", () => {
  it("a PRIVATE school's consented staff member resolves under CONSENT", async () => {
    const reference = caseRef("flag-on");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.privateConsented,
      reasonCode: "LICENSURE_QUALIFICATION_VERIFICATION",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.staffPrivateSchool },
    });

    expect(result.outcome).toBe("GRANTED");
    if (result.outcome !== "GRANTED") return;
    expect(result.legalBasis).toBe("CONSENT");
    expect(result.consentRef).toBe(CONSENT_ID.privateConsented);
    expect(result.record.full_name).toBe("Yaw Owusu");

    const rows = await auditRowsFor(reference);
    expect(rows[0]).toMatchObject({ outcome: "GRANTED", legal_basis: "CONSENT" });
  });

  it("still refuses a PRIVATE school that has NOT granted consent — the flag is not a bypass", async () => {
    // A genuinely private fixture school with no consent row (EMIS-PRI-007), rather than a public
    // school the caller describes as private — the gate reads ownership from the register now, so
    // the old shape could not have tested this at all.
    const reference = caseRef("flag-on-no-consent");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.privateNoConsent,
      reasonCode: "STATUTORY_AUDIT",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.staffPrivateNoConsent },
    });
    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    if (result.outcome === "GRANTED") return;
    expect(result.denialReason).toBe("NO_CONSENT_ON_RECORD");
  });

  it("still refuses an UNKNOWN-ownership school even though it HAS consent", async () => {
    const reference = caseRef("flag-on-unknown-ownership");
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
  });

  it("a name-mismatch teacher demotes to CONSENT — and with the flag on, consent then grants", async () => {
    // teacherPrivateNameMismatch's NTC IS on EMIS-PRI-003's establishment, so classification is
    // GES_TEACHER — but GES named that licence "Kwabena Otchere" while the operational row is "Efo
    // Nyaku", so OC-NTC-RESIDUAL demotes it. With the flag ON at this consenting private school the
    // consent branch then GRANTS — proving the demotion lands on CONSENT, not STATUTORY.
    const reference = caseRef("flag-on-name-mismatch");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.privateConsented,
      reasonCode: "LICENSURE_QUALIFICATION_VERIFICATION",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.teacherPrivateNameMismatch },
    });
    expect(result.outcome).toBe("GRANTED");
    if (result.outcome !== "GRANTED") return;
    expect(result.legalBasis).toBe("CONSENT");
    expect(result.staffCategory).toBe("OTHER_STAFF");
    expect(result.record.full_name).toBe("Efo Nyaku");
    // The identity cross-check fired, and the record reports it was NOT treated as established.
    expect(result.trace).toContain("establishment:name-mismatch");
    expect(result.record.is_on_ges_establishment).toBe(false);
    const rows = await auditRowsFor(reference);
    expect(rows[0]).toMatchObject({ legal_basis: "CONSENT", record_type: "STAFF" });
    expect(rows[0]!.target_ref.startsWith("OPS:")).toBe(true);
  });

  it("a matching-name establishment teacher is STATUTORY even at a private school", async () => {
    // The mirror of the demotion: the same private school, but the GES name MATCHES — statute holds,
    // and consent is not even consulted.
    const reference = caseRef("flag-on-private-statutory");
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
    expect(result.record.full_name).toBe("Kofi Adomako");
    expect(result.trace).not.toContain("establishment:name-mismatch");
  });
});
