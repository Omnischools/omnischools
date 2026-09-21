import { afterAll, describe, expect, it } from "vitest";
import {
  requestNamedStaffRecord,
  requestStaffListBrowse,
} from "@/lib/oversight/named-record-access";
import { closeReadback } from "@/lib/db/readback";
import { OPS_STAFF } from "./fixtures/ids";
import { SCHOOL } from "./fixtures/schools";
import { adminOperational, auditRowsFor, caseRef, districtOfficer } from "./helpers";

/**
 * BLOCKER 1 — an UNREADABLE consent table must DENY, not crash.
 *
 * This is the day-one state, not an edge case: `school_staff_oversight_consent` does not exist yet
 * (it is being built in apps/web), so the first non-GES staff drill-down against a real operational
 * database hits `relation ... does not exist`. Postgres aborts the whole transaction on a failed
 * statement, so before the savepoint fix the gate computed the right refusal, wrote its audit row —
 * and then had the refusal thrown away when the enclosing `sql.begin()` failed to commit, handing
 * the officer a raw driver error instead of Lucy's C2 "individual record not available" state.
 *
 * Both failure shapes are exercised against the real database:
 *   · the table is MISSING (renamed away for the duration of the test);
 *   · the table exists but SELECT on it is REVOKED from the read-back role.
 * Each restores what it changed in `finally`, so the rest of the suite is unaffected.
 */

afterAll(async () => {
  await closeReadback();
});

/** Run `body` with the consent table temporarily invisible to the read-back, then restore. */
async function withConsentTableMissing<T>(body: () => Promise<T>): Promise<T> {
  const sql = adminOperational();
  try {
    await sql.unsafe(
      `alter table school_staff_oversight_consent rename to school_staff_oversight_consent__hidden`,
    );
    return await body();
  } finally {
    await sql.unsafe(
      `alter table school_staff_oversight_consent__hidden rename to school_staff_oversight_consent`,
    );
    await sql.end({ timeout: 5 });
  }
}

async function withConsentSelectRevoked<T>(body: () => Promise<T>): Promise<T> {
  const sql = adminOperational();
  try {
    await sql.unsafe(`revoke select on school_staff_oversight_consent from ov_readback`);
    return await body();
  } finally {
    await sql.unsafe(`grant select on school_staff_oversight_consent to ov_readback`);
    await sql.end({ timeout: 5 });
  }
}

describe("the consent table is MISSING (the day-one state)", () => {
  it("returns a DENIED result instead of throwing, and logs it with no fields released", async () => {
    const reference = caseRef("consent-table-missing");
    const result = await withConsentTableMissing(() =>
      requestNamedStaffRecord({
        officer: districtOfficer,
        // A school that HAS consent — so a refusal here can only be the unreadable table.
        school: SCHOOL.publicConsented,
        reasonCode: "SAFEGUARDING_MISCONDUCT",
        caseReference: reference,
        subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister, gesStaffId: null },
      }),
    );

    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    if (result.outcome === "GRANTED")
      throw new Error("must not grant without a consent read");
    expect(result.denialReason).toBe("CONSENT_UNREADABLE");
    expect(result.fieldsReleased).toEqual([]);
    expect(result.trace).toContain("consent:TABLE_UNREACHABLE");

    // Nothing was fetched: the trace never reaches the projection.
    expect(result.trace).not.toContain("fetched");

    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: "DENIED_NO_CONSENT",
      legal_basis: "CONSENT",
      consent_ref: null,
    });
    expect(rows[0]!.fields_released).toEqual([]);
  });

  it("refuses a staff-LIST browse the same way", async () => {
    const reference = caseRef("browse-consent-missing");
    const result = await withConsentTableMissing(() =>
      requestStaffListBrowse({
        officer: districtOfficer,
        school: SCHOOL.publicConsented,
        reasonCode: "ESTABLISHMENT_PAYROLL_VERIFICATION",
        caseReference: reference,
      }),
    );
    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    expect(result.denialReason).toBe("CONSENT_UNREADABLE");
    expect(result.rows).toEqual([]);
    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fields_released).toEqual([]);
  });

  it("the read-back client is still usable afterwards — the savepoint did not poison the pool", async () => {
    await withConsentTableMissing(() =>
      requestNamedStaffRecord({
        officer: districtOfficer,
        school: SCHOOL.publicConsented,
        reasonCode: "STATUTORY_AUDIT",
        caseReference: caseRef("poison-check"),
        subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister, gesStaffId: null },
      }),
    );
    // Same pooled client, table restored: a normal grant must go straight through.
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "STATUTORY_AUDIT",
      caseReference: caseRef("poison-check-after"),
      subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister, gesStaffId: null },
    });
    expect(result.outcome).toBe("GRANTED");
  });
});

describe("SELECT on the consent table is REVOKED", () => {
  it("returns a DENIED result rather than surfacing a permission error", async () => {
    const reference = caseRef("consent-select-revoked");
    const result = await withConsentSelectRevoked(() =>
      requestNamedStaffRecord({
        officer: districtOfficer,
        school: SCHOOL.publicConsented,
        reasonCode: "LICENSURE_QUALIFICATION_VERIFICATION",
        caseReference: reference,
        subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister, gesStaffId: null },
      }),
    );
    expect(result.outcome).toBe("DENIED_NO_CONSENT");
    if (result.outcome === "GRANTED")
      throw new Error("must not grant without a consent read");
    expect(result.denialReason).toBe("CONSENT_UNREADABLE");
    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fields_released).toEqual([]);
  });

  it("the STATUTORY branch is unaffected — it never reads consent", async () => {
    const reference = caseRef("statutory-during-revoke");
    const result = await withConsentSelectRevoked(() =>
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
    );
    expect(result.outcome).toBe("GRANTED");
    if (result.outcome !== "GRANTED") return;
    expect(result.legalBasis).toBe("STATUTORY");
  });
});
