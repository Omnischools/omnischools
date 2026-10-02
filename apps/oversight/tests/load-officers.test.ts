import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  OfficerFileError,
  loadOfficerFile,
  parseOfficerFile,
} from "@/scripts/load-officers";
import {
  ProvisioningError,
  deactivateOfficer,
  listJurisdictionOptions,
  listOfficers,
  listProvisioningAudit,
  provisionOfficer,
} from "@/lib/provisioning/officers";
import { JUR } from "./fixtures/ids";
import { testDbConfig } from "./helpers";

/**
 * THE PROVISIONING WRITE PATH (increment G · Kofi R7).
 *
 * Everything here runs as `ov_provisioner` — the non-owner role with exactly the grants
 * db/sql/prod-paste-0005-officer-directory.sql installs, plus the role-targeted write policies
 * db/sql/policies.sql creates for it. That matters more than usual: RLS gates WRITES as well as
 * reads, so a provisioning path that works as the owner proves nothing about whether it works (or
 * is correctly refused) in production. Wells's note — "the provisioner write grants exist in harness
 * + prod-paste but no code uses them yet" — is what these tests retire.
 */

const ADMIN_A = "90000000-0000-4000-8000-000000000001";
const ADMIN_B = "90000000-0000-4000-8000-000000000002";

const sql = postgres(testDbConfig.provisionerAnalyticsUrl, { max: 2, prepare: false });

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

/** A fresh uid per case, so an append-only log shared with every other test stays readable. */
let counter = 0;
function newUid(): string {
  counter += 1;
  return `6fffffff-0000-4000-8000-0000000b${String(counter).padStart(4, "0")}`;
}

function file(
  rows: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    as_of_date: "2026-10-01",
    actor_id: ADMIN_A,
    rows,
    ...extra,
  });
}

describe("parseOfficerFile — what the file may and may not say", () => {
  it("accepts a minimal, well-formed row", () => {
    const parsed = parseOfficerFile(
      file([
        {
          officer_id: "6fffffff-0000-4000-8000-00000000c001",
          jurisdiction_id: JUR.district,
          reason: "GES posting letter WAW/2026/011",
        },
      ]),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ actorId: ADMIN_A, asOfDate: "2026-10-01" });
  });

  it("REFUSES a file that names a tier, a level or a role", () => {
    // The central architectural commitment: scope cannot be widened by typing a level. A file that
    // could name one is a file where a typo grants a region. Rejected, not ignored — ignoring it
    // would let an operator believe they had set something.
    for (const forbidden of ["level", "tier", "officer_role"]) {
      expect(() =>
        parseOfficerFile(
          file([
            {
              officer_id: "6fffffff-0000-4000-8000-00000000c002",
              jurisdiction_id: JUR.district,
              reason: "x",
              [forbidden]: "NATIONAL",
            },
          ]),
        ),
      ).toThrowError(new RegExp(`"${forbidden}" is not a field`));
    }
  });

  it("REFUSES a row with no reason", () => {
    expect(() =>
      parseOfficerFile(
        file([
          {
            officer_id: "6fffffff-0000-4000-8000-00000000c003",
            jurisdiction_id: JUR.district,
          },
        ]),
      ),
    ).toThrowError(/"reason" is required/);
  });

  it("REFUSES a file with no actor_id — authority granted by nobody", () => {
    expect(() =>
      parseOfficerFile(
        JSON.stringify({
          as_of_date: "2026-10-01",
          rows: [
            {
              officer_id: "6fffffff-0000-4000-8000-00000000c004",
              jurisdiction_id: JUR.district,
              reason: "x",
            },
          ],
        }),
      ),
    ).toThrowError(/actor_id/);
  });

  it("REFUSES an approver who is the actor, and a non-uuid officer id", () => {
    expect(() =>
      parseOfficerFile(
        file([
          {
            officer_id: "6fffffff-0000-4000-8000-00000000c005",
            jurisdiction_id: JUR.region,
            reason: "x",
            approver_id: ADMIN_A,
          },
        ]),
      ),
    ).toThrowError(/same person as the actor/);

    expect(() =>
      parseOfficerFile(
        file([{ officer_id: "not-a-uuid", jurisdiction_id: JUR.district, reason: "x" }]),
      ),
    ).toThrowError(/Supabase auth uid/);
  });

  it("REFUSES the same uid twice in one file", () => {
    const uid = "6fffffff-0000-4000-8000-00000000c006";
    expect(() =>
      parseOfficerFile(
        file([
          { officer_id: uid, jurisdiction_id: JUR.district, reason: "first" },
          {
            officer_id: uid,
            jurisdiction_id: JUR.region,
            reason: "second",
            approver_id: ADMIN_B,
          },
        ]),
      ),
    ).toThrowError(/appears twice/);
  });
});

describe("the loader writes the directory row and the audit row in ONE transaction", () => {
  it("provisions a district officer and logs it, with the tier DERIVED from the node", async () => {
    const uid = newUid();
    const results = await loadOfficerFile(
      sql,
      file([
        {
          officer_id: uid,
          jurisdiction_id: JUR.district,
          full_name: "Kojo Appiah",
          work_email: `kojo.${counter}@ges.gov.gh`,
          reason: "GES posting letter WAW/2026/022",
        },
      ]),
    );
    expect(results[0]).toMatchObject({
      tier: "DISTRICT",
      officerRole: "DISTRICT_OVERSIGHT",
      action: "PROVISION",
    });

    const directory = (await listOfficers(sql)).find((o) => o.officerId === uid);
    expect(directory).toMatchObject({
      isActive: true,
      officerRole: "DISTRICT_OVERSIGHT",
    });

    const audit = (await listProvisioningAudit(sql, 200)).filter(
      (r) => r.targetOfficerId === uid,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "PROVISION",
      actorId: ADMIN_A,
      targetTier: "DISTRICT",
      roleBefore: null,
      roleAfter: "DISTRICT_OVERSIGHT",
      activeAfter: true,
    });
  });

  it("a failed directory write leaves NO audit row (the pair is atomic)", async () => {
    // Two ACTIVE officers cannot share a work email (the partial unique index). The directory INSERT
    // therefore fails AFTER the transaction has begun — and the audit row must not survive it. The
    // log is append-only: a row describing a grant that did not happen could never be corrected.
    const email = `collision.${Date.now()}@ges.gov.gh`;
    const first = newUid();
    await provisionOfficer(sql, {
      officerId: first,
      jurisdictionId: JUR.district,
      actorId: ADMIN_A,
      workEmail: email,
      reason: "first holder of this address",
    });

    const second = newUid();
    const before = await listProvisioningAudit(sql, 500);
    await expect(
      provisionOfficer(sql, {
        officerId: second,
        jurisdictionId: JUR.district,
        actorId: ADMIN_A,
        workEmail: email,
        reason: "second holder — must fail",
      }),
    ).rejects.toThrow();

    const after = await listProvisioningAudit(sql, 500);
    expect(after.length).toBe(before.length);
    expect(after.some((r) => r.targetOfficerId === second)).toBe(false);
    // …and no half-made officer either.
    expect((await listOfficers(sql)).some((o) => o.officerId === second)).toBe(false);
  });
});

describe("Kofi R1 — a SCHOOL-tier officer cannot be created", () => {
  it("refuses a SCHOOL node by name, before any write", async () => {
    const uid = newUid();
    await expect(
      loadOfficerFile(
        sql,
        file([
          {
            officer_id: uid,
            jurisdiction_id: JUR.schoolPublicConsented,
            reason: "head teacher — must be refused",
          },
        ]),
      ),
    ).rejects.toThrowError(/SCHOOL node|SCHOOL-tier/);

    expect((await listOfficers(sql)).some((o) => o.officerId === uid)).toBe(false);
  });

  it("the node picker does not offer SCHOOL nodes at all", async () => {
    const options = await listJurisdictionOptions(sql);
    expect(options.length).toBeGreaterThan(0);
    // Compared as a STRING: the TypeScript type already excludes SCHOOL, which is exactly why the
    // runtime check matters — the query is what enforces it, and a type cannot filter a row.
    expect(options.every((o) => String(o.level) !== "SCHOOL")).toBe(true);
    // Lucy G8.b: the tier and the role are derived and read-only beside the picker.
    const district = options.find((o) => o.jurisdictionId === JUR.district);
    expect(district).toMatchObject({
      level: "DISTRICT",
      derivedRole: "DISTRICT_OVERSIGHT",
    });
  });

  it("refuses a node that is not in dim_jurisdiction", async () => {
    await expect(
      provisionOfficer(sql, {
        officerId: newUid(),
        jurisdictionId: "10000000-0000-4000-8000-0000000000ff",
        actorId: ADMIN_A,
        reason: "nonexistent node",
      }),
    ).rejects.toBeInstanceOf(ProvisioningError);
  });
});

describe("Kofi R7 — two people for REGION and NATIONAL", () => {
  it("refuses a REGION grant with no approver", async () => {
    await expect(
      provisionOfficer(sql, {
        officerId: newUid(),
        jurisdictionId: JUR.region,
        actorId: ADMIN_A,
        reason: "regional director — no approver",
      }),
    ).rejects.toThrowError(/second administrator/);
  });

  it("refuses a NATIONAL grant whose approver IS the proposer", async () => {
    await expect(
      provisionOfficer(sql, {
        officerId: newUid(),
        jurisdictionId: JUR.national,
        actorId: ADMIN_A,
        approverId: ADMIN_A,
        reason: "self-approved national grant",
      }),
    ).rejects.toThrowError(/DIFFERENT administrator/);
  });

  it("accepts a NATIONAL grant with a distinct approver, and NAMES BOTH in the log", async () => {
    const uid = newUid();
    const result = await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.national,
      actorId: ADMIN_A,
      approverId: ADMIN_B,
      reason: "MoE directive 2026/09 — national oversight desk",
    });
    expect(result).toMatchObject({ tier: "NATIONAL", officerRole: "NATIONAL_OVERSIGHT" });

    const audit = (await listProvisioningAudit(sql, 500)).find(
      (r) => r.targetOfficerId === uid,
    );
    expect(audit).toMatchObject({
      actorId: ADMIN_A,
      approverId: ADMIN_B,
      targetTier: "NATIONAL",
    });
  });

  it("a DISTRICT grant is single-signature", async () => {
    const uid = newUid();
    const result = await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.district,
      actorId: ADMIN_A,
      reason: "district director — single signature by design",
    });
    expect(result.tier).toBe("DISTRICT");
  });
});

describe("withdrawal is deactivation, never deletion (Lucy G8.c)", () => {
  it("flips is_active and writes a DEACTIVATE row, keeping the directory row", async () => {
    const uid = newUid();
    await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.district,
      actorId: ADMIN_A,
      reason: "to be withdrawn",
    });

    await deactivateOfficer(sql, {
      officerId: uid,
      actorId: ADMIN_A,
      reason: "transferred out of GES oversight",
    });

    const row = (await listOfficers(sql)).find((o) => o.officerId === uid);
    // The row STAYS: a deleted directory row orphans every audit entry naming that uid.
    expect(row).toBeDefined();
    expect(row!.isActive).toBe(false);

    const audit = (await listProvisioningAudit(sql, 500)).filter(
      (r) => r.targetOfficerId === uid,
    );
    expect(audit.map((r) => r.action)).toContain("DEACTIVATE");
    const deactivation = audit.find((r) => r.action === "DEACTIVATE")!;
    expect(deactivation).toMatchObject({ activeBefore: true, activeAfter: false });
  });

  it("withdrawing a REGION/NATIONAL officer ALSO needs two people (Lucy R11 — applied)", async () => {
    const uid = newUid();
    await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.region,
      actorId: ADMIN_A,
      approverId: ADMIN_B,
      reason: "regional director",
    });

    await expect(
      deactivateOfficer(sql, { officerId: uid, actorId: ADMIN_A, reason: "no approver" }),
    ).rejects.toThrowError(/second administrator/);

    // Still active: the refusal happened before the update.
    expect((await listOfficers(sql)).find((o) => o.officerId === uid)!.isActive).toBe(
      true,
    );

    await deactivateOfficer(sql, {
      officerId: uid,
      actorId: ADMIN_A,
      approverId: ADMIN_B,
      reason: "post abolished — approved by second administrator",
    });
    expect((await listOfficers(sql)).find((o) => o.officerId === uid)!.isActive).toBe(
      false,
    );
  });

  it("re-provisioning a withdrawn officer is a REACTIVATE row, not an edit", async () => {
    const uid = newUid();
    await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.district,
      actorId: ADMIN_A,
      reason: "initial posting",
    });
    await deactivateOfficer(sql, {
      officerId: uid,
      actorId: ADMIN_A,
      reason: "seconded elsewhere",
    });
    const again = await provisionOfficer(sql, {
      officerId: uid,
      jurisdictionId: JUR.district,
      actorId: ADMIN_B,
      reason: "returned to post",
    });
    expect(again.action).toBe("REACTIVATE");

    const actions = (await listProvisioningAudit(sql, 500))
      .filter((r) => r.targetOfficerId === uid)
      .map((r) => r.action);
    // Three facts, in the log, none of them overwritten.
    expect(actions.sort()).toEqual(["DEACTIVATE", "PROVISION", "REACTIVATE"]);
  });

  it("refuses to withdraw a uid that was never provisioned", async () => {
    await expect(
      deactivateOfficer(sql, { officerId: newUid(), actorId: ADMIN_A, reason: "x" }),
    ).rejects.toThrowError(/No directory row/);
  });
});

describe("the loader's error names the row and what already committed", () => {
  it("reports the index, the uid and the number of rows already provisioned", async () => {
    const good = newUid();
    const bad = newUid();
    let message = "";
    try {
      await loadOfficerFile(
        sql,
        file([
          { officer_id: good, jurisdiction_id: JUR.district, reason: "fine" },
          {
            officer_id: bad,
            jurisdiction_id: JUR.schoolPublicConsented,
            reason: "a school node",
          },
        ]),
      );
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
      expect(err).toBeInstanceOf(OfficerFileError);
    }
    expect(message).toMatch(/Row 1/);
    expect(message).toMatch(bad);
    expect(message).toMatch(/1 officer\(s\) were provisioned before this row/);
    // The earlier row IS committed — a 40-row posting list must not roll back eleven correct,
    // individually-reasoned grants because row 12 was wrong.
    expect((await listOfficers(sql)).some((o) => o.officerId === good)).toBe(true);
  });
});
