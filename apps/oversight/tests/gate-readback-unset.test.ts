import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OPS_STAFF } from "./fixtures/ids";
import { SCHOOL } from "./fixtures/schools";
import { auditRowsFor, caseRef, districtOfficer } from "./helpers";

/**
 * `OPERATIONAL_READBACK_URL` UNSET — every gate request is a LOGGED DENIAL.
 *
 * Without the read-back neither of the two things a basis can rest on is obtainable: the consent
 * row cannot be read, and a claimed establishment number cannot be bound to the row it claims to
 * describe (S1). So there is no branch that proceeds, and "could not establish a basis" is a
 * refusal of a well-formed request — exactly the kind of event the audit log exists to hold. The
 * officer sees Lucy's C2 state.
 *
 * PROVISIONING §4a-4's "individual drill-down unavailable" closed door is a SURFACE state, driven
 * by `isIndividualDrilldownAvailable()` without any request at all — asserted below, so the two are
 * not confused.
 *
 * Its own file because `lib/env.ts` parses `process.env` at import time, so the whole module graph
 * has to be re-imported after the stub.
 */

let requestNamedStaffRecord: typeof import("@/lib/oversight/named-record-access").requestNamedStaffRecord;
let requestStaffListBrowse: typeof import("@/lib/oversight/named-record-access").requestStaffListBrowse;
let ReadbackUnavailableError: typeof import("@/lib/db/readback").ReadbackUnavailableError;

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv("OPERATIONAL_READBACK_URL", "");
  ({ requestNamedStaffRecord, requestStaffListBrowse } =
    await import("@/lib/oversight/named-record-access"));
  ({ ReadbackUnavailableError } = await import("@/lib/db/readback"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("with OPERATIONAL_READBACK_URL unset", () => {
  it("the CONSENT branch logs a denial with no fields released", async () => {
    const reference = caseRef("unset-consent");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "SAFEGUARDING_MISCONDUCT",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister, gesStaffId: null },
    });

    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    if (result.outcome === "GRANTED") return;
    expect(result.denialReason).toBe("CONSENT_UNREADABLE");
    expect(result.trace).toContain("readback:unconfigured");
    // The ceiling check still ran first — it is an analytics read and needs no read-back.
    expect(result.trace).toContain("school:in-jurisdiction");

    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("DENIED_NO_CONSENT");
    expect(rows[0]!.fields_released).toEqual([]);
  });

  it("a staff-LIST browse also logs a denial", async () => {
    const reference = caseRef("unset-browse");
    const result = await requestStaffListBrowse({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "ESTABLISHMENT_PAYROLL_VERIFICATION",
      caseReference: reference,
    });
    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    expect(result.rows).toEqual([]);
    expect(await auditRowsFor(reference)).toHaveLength(1);
  });

  it("a request CLAIMING an establishment number is refused too, and logged", async () => {
    // The claim cannot be bound without the read-back either, so there is no branch that proceeds.
    const reference = caseRef("unset-with-claim");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "ESTABLISHMENT_PAYROLL_VERIFICATION",
      caseReference: reference,
      subject: {
        operationalStaffId: OPS_STAFF.teacherOnRegister,
        gesStaffId: "GES/WR/00001",
      },
    });
    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    if (result.outcome === "GRANTED") return;
    expect(result.denialReason).toBe("CONSENT_UNREADABLE");
    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.legal_basis).toBe("CONSENT");
    expect(rows[0]!.fields_released).toEqual([]);
  });

  it("the page-level 'individual drill-down unavailable' state is still driven by the probe", async () => {
    // PROVISIONING §4a-4's closed door is a SURFACE state, not a per-request exception: the gate
    // logs a denial (above), and the page renders the unavailable banner from this probe, which
    // needs no request at all. `ReadbackUnavailableError` remains the client's own failure mode.
    const { isIndividualDrilldownAvailable } =
      await import("@/lib/oversight/named-record-access");
    expect(isIndividualDrilldownAvailable()).toBe(false);
    const { getReadbackClient } = await import("@/lib/db/readback");
    expect(() => getReadbackClient()).toThrowError(ReadbackUnavailableError);
  });

  it("the jurisdiction ceiling still refuses first — it does not need the read-back", async () => {
    const reference = caseRef("unset-out-of-subtree");
    await expect(
      requestNamedStaffRecord({
        officer: districtOfficer,
        school: SCHOOL.outsideSubtree,
        reasonCode: "SAFEGUARDING_MISCONDUCT",
        caseReference: reference,
        subject: { operationalStaffId: OPS_STAFF.staffOutsideSubtree, gesStaffId: null },
      }),
    ).rejects.toMatchObject({ code: "OUT_OF_JURISDICTION" });
    expect(await auditRowsFor(reference)).toHaveLength(0);
  });
});
