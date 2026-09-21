import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OPS_STAFF } from "./fixtures/ids";
import { SCHOOL } from "./fixtures/schools";
import { auditRowsFor, caseRef, districtOfficer } from "./helpers";

/**
 * BLOCKER 1, second arm — `OPERATIONAL_READBACK_URL` UNSET.
 *
 * The two branches part company here, and deliberately:
 *
 *   CONSENT branch  → a LOGGED DENIAL. Consent could not be established, and "could not establish
 *                     consent" is a refusal of a well-formed request, which is exactly the kind of
 *                     event the audit log exists to hold. The officer sees Lucy's C2 state.
 *   STATUTORY branch → `ReadbackUnavailableError`, and NO audit row. Nothing was refused: the
 *                     capability is simply absent, which PROVISIONING §4a-4 requires to present as
 *                     "individual drill-down unavailable" beside the aggregate view. Logging a
 *                     denial here would record an access attempt against a subject the gate never
 *                     evaluated.
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

  it("the STATUTORY branch throws ReadbackUnavailableError and logs NOTHING", async () => {
    const reference = caseRef("unset-statutory");
    await expect(
      requestNamedStaffRecord({
        officer: districtOfficer,
        school: SCHOOL.publicConsented,
        reasonCode: "ESTABLISHMENT_PAYROLL_VERIFICATION",
        caseReference: reference,
        subject: {
          operationalStaffId: OPS_STAFF.teacherOnRegister,
          gesStaffId: "GES/WR/00001",
        },
      }),
    ).rejects.toBeInstanceOf(ReadbackUnavailableError);
    expect(await auditRowsFor(reference)).toHaveLength(0);
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
