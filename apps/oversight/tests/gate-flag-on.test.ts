import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CONSENT_ID, EMIS, JUR, OPS_SCHOOL, OPS_STAFF } from "./fixtures/ids";
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
      school: {
        emisSchoolId: EMIS.privateConsented,
        operationalSchoolId: OPS_SCHOOL.privateConsented,
        jurisdictionId: JUR.schoolPrivateConsented,
        ownershipType: "PRIVATE",
      },
      reasonCode: "LICENSURE_QUALIFICATION_VERIFICATION",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.staffPrivateSchool, gesStaffId: null },
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
    const reference = caseRef("flag-on-no-consent");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: {
        emisSchoolId: EMIS.publicNoConsent,
        operationalSchoolId: OPS_SCHOOL.publicNoConsent,
        jurisdictionId: JUR.schoolPublicNoConsent,
        // Treat it as private for this test: consent is still absent, so it must still refuse.
        ownershipType: "PRIVATE",
      },
      reasonCode: "STATUTORY_AUDIT",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.staffNoConsentSchool, gesStaffId: null },
    });
    expect(result.outcome).toBe("DENIED_NO_CONSENT");
  });
});
