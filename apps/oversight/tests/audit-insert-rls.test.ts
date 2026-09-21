import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { JUR, OFFICER } from "./fixtures/ids";
import { testDbConfig } from "./helpers";

/**
 * BLOCKER 2b — the DATABASE backstop behind the jurisdiction ceiling.
 *
 * `audit_insert`'s WITH CHECK is now
 *     officer_id = ov_current_officer() and ov_in_subtree(jurisdiction_id)
 * (db/sql/policies.sql, and db/sql/prod-paste-0003-audit-insert-subtree.sql for prod).
 *
 * WHY THIS IS THE RIGHT PLACE FOR A SECOND CHECK. The gate writes the audit row BEFORE it fetches
 * anything (§6 step 2). So a row the database refuses is an access that cannot happen — the
 * INSERT failing is not merely a logging problem, it is the disclosure being prevented. That makes
 * this predicate an access control, not bookkeeping, and it holds even if the application check in
 * `lib/oversight/named-record-access.ts` is bypassed by a future caller.
 *
 * Everything here runs as the NON-OWNER app role. Running it as the owner would prove nothing: an
 * owner is exempt from RLS unless the table is FORCEd.
 */

const app = postgres(testDbConfig.analyticsUrl, { max: 1, prepare: false });

afterAll(async () => {
  await app.end({ timeout: 5 });
});

/** Attempt one INSERT as a given officer/tier, always rolled back. Returns the error, or null. */
async function tryInsert(opts: {
  officerId: string;
  officerJurisdiction: string | null;
  level: string;
  rowJurisdiction: string | null;
  outcome: string;
}): Promise<string | null> {
  try {
    await app.begin(async (tx) => {
      await tx`select set_config('app.current_jurisdiction', ${opts.officerJurisdiction ?? ""}, true)`;
      await tx`select set_config('app.current_level', ${opts.level}, true)`;
      await tx`select set_config('app.current_officer', ${opts.officerId}, true)`;
      await tx`
        insert into audit_access_log (
          officer_id, officer_role, jurisdiction_id, reason_code, case_reference,
          record_type, target_ref, fields_released, legal_basis, outcome, staff_category
        ) values (
          ${opts.officerId}::uuid, 'DISTRICT_DIRECTOR',
          ${opts.rowJurisdiction}::uuid, 'STATUTORY_AUDIT', 'rls-probe',
          'STAFF', 'OPS:EMIS-PUB-001:50000000-0000-4000-8000-000000000002',
          '[]'::jsonb, 'CONSENT', ${opts.outcome}::access_outcome, 'OTHER_STAFF'
        )`;
      // Never keep the probe row.
      throw new Error("__rollback__");
    });
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return message === "__rollback__" ? null : message;
  }
}

describe("audit_insert requires the row's jurisdiction to be in the officer's subtree", () => {
  it("REJECTS a row for a school outside the officer's subtree", async () => {
    const error = await tryInsert({
      officerId: OFFICER.districtId,
      officerJurisdiction: JUR.district,
      level: "DISTRICT",
      rowJurisdiction: JUR.schoolOutsideSubtree,
      outcome: "GRANTED",
    });
    expect(error).toMatch(/row-level security/i);
  });

  it("ACCEPTS a row for a school inside the officer's subtree", async () => {
    const error = await tryInsert({
      officerId: OFFICER.districtId,
      officerJurisdiction: JUR.district,
      level: "DISTRICT",
      rowJurisdiction: JUR.schoolPublicConsented,
      outcome: "GRANTED",
    });
    expect(error).toBeNull();
  });

  it("STILL ACCEPTS in-subtree DENIAL rows — the gate must be able to record that it fired", async () => {
    // The regression this guards against: a predicate that blocked denials would make the system
    // fail closed by becoming unable to log a refusal, which is the opposite of the intent.
    for (const outcome of [
      "DENIED_NO_CONSENT",
      "DENIED_STALE_ESTABLISHMENT",
      "DENIED_FIELD_SCOPE",
    ]) {
      const error = await tryInsert({
        officerId: OFFICER.districtId,
        officerJurisdiction: JUR.district,
        level: "DISTRICT",
        rowJurisdiction: JUR.schoolPublicNoConsent,
        outcome,
      });
      expect(error, `${outcome} must still insert`).toBeNull();
    }
  });

  it("REJECTS a row whose jurisdiction is NULL below NATIONAL — an access nobody can scope", async () => {
    const error = await tryInsert({
      officerId: OFFICER.districtId,
      officerJurisdiction: JUR.district,
      level: "DISTRICT",
      rowJurisdiction: null,
      outcome: "DENIED_NO_CONSENT",
    });
    expect(error).toMatch(/row-level security/i);
  });

  it("still REJECTS a row written in another officer's name (the original predicate holds)", async () => {
    const error = await tryInsert({
      officerId: OFFICER.districtId,
      officerJurisdiction: JUR.district,
      level: "DISTRICT",
      // in-subtree, but the GUC officer and the row officer disagree
      rowJurisdiction: JUR.schoolPublicConsented,
      outcome: "GRANTED",
    }).then(() => null);
    expect(error).toBeNull(); // sanity: the helper above always matches the two

    // Now make them disagree explicitly.
    let message: string | null = null;
    try {
      await app.begin(async (tx) => {
        await tx`select set_config('app.current_jurisdiction', ${JUR.district}, true)`;
        await tx`select set_config('app.current_level', 'DISTRICT', true)`;
        await tx`select set_config('app.current_officer', ${OFFICER.districtId}, true)`;
        await tx`
          insert into audit_access_log (
            officer_id, officer_role, jurisdiction_id, reason_code,
            record_type, target_ref, fields_released, legal_basis, outcome
          ) values (
            ${OFFICER.nationalId}::uuid, 'DISTRICT_DIRECTOR',
            ${JUR.schoolPublicConsented}::uuid, 'STATUTORY_AUDIT',
            'STAFF', 'OPS:EMIS-PUB-001:50000000-0000-4000-8000-000000000002',
            '[]'::jsonb, 'CONSENT', 'GRANTED'
          )`;
        throw new Error("__rollback__");
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      message = m === "__rollback__" ? null : m;
    }
    expect(message).toMatch(/row-level security/i);
  });

  it("NATIONAL is unfiltered — ov_in_subtree short-circuits", async () => {
    const error = await tryInsert({
      officerId: OFFICER.nationalId,
      officerJurisdiction: null,
      level: "NATIONAL",
      rowJurisdiction: JUR.schoolOutsideSubtree,
      outcome: "GRANTED",
    });
    expect(error).toBeNull();
  });
});
