import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EMIS, GES_STAFF_ID, JUR, OPS_SCHOOL, OPS_STAFF } from "./fixtures/ids";
import { auditRowsFor, caseRef, districtOfficer } from "./helpers";

/**
 * Kofi group F/J — AUDIT BEFORE FETCH, proved two ways.
 *
 * 1. The record fetch is intercepted, and at the moment it is called it asserts that the audit row
 *    for this access ALREADY EXISTS in the analytics DB. That is a direct observation of the
 *    ordering, not an inference from a trace array the implementation itself produced.
 * 2. The audit INSERT is made to fail (a jurisdiction_id that violates the foreign key), and the
 *    fetch must then never be called at all. An access that cannot be logged does not happen.
 */

const fetchCalls: { caseReference: string; auditRowsAtCallTime: number }[] = [];
let currentCaseReference = "";

vi.mock("@/lib/oversight/staff-projection", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/oversight/staff-projection")>();
  return {
    ...actual,
    fetchScopedStaffRecord: async (
      ...args: Parameters<typeof actual.fetchScopedStaffRecord>
    ) => {
      const { auditRowsFor: read } = await import("./helpers");
      const rows = await read(currentCaseReference);
      fetchCalls.push({
        caseReference: currentCaseReference,
        auditRowsAtCallTime: rows.length,
      });
      return actual.fetchScopedStaffRecord(...args);
    },
  };
});

const { requestNamedStaffRecord } = await import("@/lib/oversight/named-record-access");
const { closeReadback } = await import("@/lib/db/readback");

afterAll(async () => {
  await closeReadback();
});

beforeEach(() => {
  fetchCalls.length = 0;
});

const school = {
  emisSchoolId: EMIS.publicConsented,
  operationalSchoolId: OPS_SCHOOL.publicConsented,
  jurisdictionId: JUR.schoolPublicConsented,
  ownershipType: "PUBLIC" as const,
};

describe("the audit row exists before the record is fetched", () => {
  it("sees exactly one audit row at the moment the projection runs", async () => {
    currentCaseReference = caseRef("audit-first");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school,
      reasonCode: "STATUTORY_AUDIT",
      caseReference: currentCaseReference,
      subject: {
        operationalStaffId: OPS_STAFF.teacherOnRegister,
        gesStaffId: GES_STAFF_ID.onRegister,
      },
    });
    expect(result.outcome).toBe("GRANTED");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.auditRowsAtCallTime).toBe(1);
  });
});

describe("a failed audit INSERT means no fetch at all", () => {
  it("propagates the error and never reaches the projection", async () => {
    currentCaseReference = caseRef("audit-fails");
    await expect(
      requestNamedStaffRecord({
        officer: districtOfficer,
        school: {
          ...school,
          // A well-formed uuid that is not in dim_jurisdiction: the audit row's FK rejects it.
          jurisdictionId: "19999999-0000-4000-8000-000000000999",
        },
        reasonCode: "STATUTORY_AUDIT",
        caseReference: currentCaseReference,
        subject: {
          operationalStaffId: OPS_STAFF.teacherOnRegister,
          gesStaffId: GES_STAFF_ID.onRegister,
        },
      }),
    ).rejects.toThrowError();

    expect(fetchCalls).toHaveLength(0);
    expect(await auditRowsFor(currentCaseReference)).toHaveLength(0);
  });

  it("an officer cannot write an audit row in another officer's name (RLS)", async () => {
    // `audit_insert` checks officer_id = ov_current_officer(); withJurisdiction sets the GUC from
    // the session, so the two can only disagree if someone forges one of them. Simulate by handing
    // the writer a session whose officerId is not a uuid the policy will accept.
    currentCaseReference = caseRef("rls-officer");
    await expect(
      requestNamedStaffRecord({
        officer: { ...districtOfficer, officerId: "not-a-uuid" },
        school,
        reasonCode: "STATUTORY_AUDIT",
        caseReference: currentCaseReference,
        subject: {
          operationalStaffId: OPS_STAFF.teacherOnRegister,
          gesStaffId: GES_STAFF_ID.onRegister,
        },
      }),
    ).rejects.toThrowError();
    expect(fetchCalls).toHaveLength(0);
  });
});
