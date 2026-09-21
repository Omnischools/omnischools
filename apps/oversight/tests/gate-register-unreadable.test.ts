import { afterAll, describe, expect, it } from "vitest";
import { requestNamedStaffRecord } from "@/lib/oversight/named-record-access";
import { closeReadback } from "@/lib/db/readback";
import { OPS_STAFF } from "./fixtures/ids";
import { SCHOOL } from "./fixtures/schools";
import { adminAnalytics, auditRowsFor, caseRef, districtOfficer, testDbConfig } from "./helpers";

/**
 * AC-3.12 — an UNREADABLE establishment register must FAIL CLOSED (INDETERMINATE), never fall
 * through to a grant.
 *
 * The statutory branch depends on reading `ref_ges_teacher_establishment` in the analytics database
 * under the officer's own RLS (classify.ts). If that read cannot be made — a query error, an RLS
 * refusal, a connection loss — the classifier returns INDETERMINATE: "we do not know", which is NOT
 * the same as OTHER_STAFF ("known not to be established"). The gate must treat "we do not know"
 * as a refusal, not silently offer the consent branch and certainly not grant statute.
 *
 * The unreadability is real, not mocked: SELECT on the establishment register is revoked from the
 * app role for the duration of the test (the app connects to analytics as a NON-owner, so the
 * revoke bites), and restored in `finally`. The subject chosen (teacherOnRegister) is one who WOULD
 * be STATUTORY if the register could be read, so a grant here would be the exact failure this AC
 * forbids.
 */

/** The role the app connects to analytics as — a non-owner, so grants/revokes actually apply. */
const APP_ROLE = new URL(testDbConfig.analyticsUrl).username;

afterAll(async () => {
  await closeReadback();
});

async function withEstablishmentRegisterUnreadable<T>(body: () => Promise<T>): Promise<T> {
  const sql = adminAnalytics();
  try {
    await sql.unsafe(`revoke select on ref_ges_teacher_establishment from ${APP_ROLE}`);
    return await body();
  } finally {
    await sql.unsafe(`grant select on ref_ges_teacher_establishment to ${APP_ROLE}`);
    await sql.end({ timeout: 5 });
  }
}

describe("AC-3.12 — an unreadable establishment register denies (INDETERMINATE), never grants", () => {
  it("denies a would-be STATUTORY teacher when the register cannot be read, and logs it with no fields", async () => {
    const reference = caseRef("register-unreadable");
    const result = await withEstablishmentRegisterUnreadable(() =>
      requestNamedStaffRecord({
        officer: districtOfficer,
        // A school with consent, and a subject who is genuinely on the register — so the ONLY thing
        // that can refuse this access is the unreadable register itself.
        school: SCHOOL.publicConsented,
        reasonCode: "STATUTORY_AUDIT",
        caseReference: reference,
        subject: { operationalStaffId: OPS_STAFF.teacherOnRegister },
      }),
    );

    expect(result.outcome).toBe("DENIED_STALE_ESTABLISHMENT");
    if (result.outcome === "GRANTED")
      throw new Error("an unreadable register must never grant");
    expect(result.denialReason).toBe("CLASSIFICATION_INDETERMINATE");
    // A denial is written under the pessimistic CONSENT basis — it never asserts a membership the
    // gate could not verify.
    expect(result.legalBasis).toBe("CONSENT");
    expect(result.fieldsReleased).toEqual([]);
    // The classifier reported INDETERMINATE, and nothing was fetched.
    expect(result.trace).toContain("classified:INDETERMINATE");
    expect(result.trace).not.toContain("fetched");

    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: "DENIED_STALE_ESTABLISHMENT",
      legal_basis: "CONSENT",
      consent_ref: null,
    });
    expect(rows[0]!.fields_released).toEqual([]);
  });

  it("the same subject grants STATUTORY again once the register is readable — the denial was the register, not the person", async () => {
    const reference = caseRef("register-readable-again");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "STATUTORY_AUDIT",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.teacherOnRegister },
    });
    expect(result.outcome).toBe("GRANTED");
    if (result.outcome !== "GRANTED") return;
    expect(result.legalBasis).toBe("STATUTORY");
    // The analytics connection pool was not poisoned by the aborted classify transaction.
    expect(result.trace).toContain("fetched");
  });
});
