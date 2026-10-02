import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { JUR, OFFICER } from "./fixtures/ids";
import { testDbConfig } from "./helpers";

/**
 * THE BOOTSTRAP READ, AS THE APP ROLE SEES IT (increment G · docs/PROVISIONING.md §4b).
 *
 * `ov_resolve_officer(uid)` is the only read path from the Oversight runtime into the officer
 * directory, and the directory's security is made of absences — no select policy the app role can
 * match, no write grant at all. Absences are exactly what a test suite forgets to check, because
 * nothing fails when one quietly becomes a presence. So this file asserts the absences directly, as
 * `ov_app` (the NON-OWNER role the app connects as; an owner would be RLS-exempt and prove nothing).
 */

const app = postgres(testDbConfig.analyticsUrl, { max: 1, prepare: false });
const provisioner = postgres(testDbConfig.provisionerAnalyticsUrl, {
  max: 1,
  prepare: false,
});

afterAll(async () => {
  await Promise.all([app.end({ timeout: 5 }), provisioner.end({ timeout: 5 })]);
});

interface ResolvedRow {
  officer_id: string;
  jurisdiction_id: string;
  level: string;
  officer_role: string;
}

async function resolve(uid: string | null): Promise<ResolvedRow[]> {
  return (await app`
    select officer_id::text, jurisdiction_id::text, level::text, officer_role::text
      from ov_resolve_officer(${uid}::uuid)
  `) as unknown as ResolvedRow[];
}

describe("ov_resolve_officer — the tier matrix, resolved by uid alone", () => {
  it("a DISTRICT officer resolves to their own node with the tier DERIVED from it", async () => {
    const rows = await resolve(OFFICER.districtId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      officer_id: OFFICER.districtId,
      jurisdiction_id: JUR.district,
      level: "DISTRICT",
      officer_role: "DISTRICT_OVERSIGHT",
    });
  });

  it("a REGION officer resolves to REGION, a NATIONAL officer to NATIONAL", async () => {
    const region = await resolve("60000000-0000-4000-8000-000000000004");
    expect(region[0]).toMatchObject({ level: "REGION", jurisdiction_id: JUR.region });

    const national = await resolve(OFFICER.nationalId);
    // Wells's note: a NATIONAL officer has a NON-NULL node id (the national node itself). The tier
    // is what removes the filter, not a null jurisdiction.
    expect(national[0]).toMatchObject({
      level: "NATIONAL",
      jurisdiction_id: JUR.national,
    });
    expect(national[0]!.jurisdiction_id).not.toBeNull();
  });

  it("resolves EXACTLY ONE row per uid, even though two national officers exist", async () => {
    // The fixture seeds two NATIONAL officers on purpose: "one row for a uid" must be a property of
    // the function's shape (`where officer_id = uid ... limit 1`), not an artefact of there being
    // only one candidate row to find.
    for (const uid of [OFFICER.nationalId, "60000000-0000-4000-8000-000000000003"]) {
      const rows = await resolve(uid);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.officer_id).toBe(uid);
    }
  });

  it("a DEACTIVATED officer resolves to ZERO rows — deactivation takes effect in the DATABASE", async () => {
    expect(await resolve("60000000-0000-4000-8000-000000000005")).toHaveLength(0);
  });

  it("an UNPROVISIONED uid resolves to ZERO rows — indistinguishable from deactivated", async () => {
    // Deliberately the same answer: the function is not an account-state oracle. The app's G4 copy
    // is therefore true for both cases, which is why there is no G5 variant (see the note in
    // app/(oversight)/layout.tsx).
    expect(await resolve("6fffffff-0000-4000-8000-0000000000ff")).toHaveLength(0);
  });

  it("a NULL uid resolves to ZERO rows rather than relying on `= null`", async () => {
    expect(await resolve(null)).toHaveLength(0);
  });

  it("returns NO PII — no name and no email column exists on the result", async () => {
    const rows = (await app`
      select * from ov_resolve_officer(${OFFICER.districtId}::uuid)
    `) as unknown as Record<string, unknown>[];
    expect(Object.keys(rows[0]!).sort()).toEqual([
      "jurisdiction_id",
      "level",
      "officer_id",
      "officer_role",
    ]);
  });
});

describe("the officer directory itself is unreachable from the app credential", () => {
  it("`select * from ref_oversight_officer` returns ZERO rows (RLS-enabled, no matching policy)", async () => {
    const rows = (await app`select * from ref_oversight_officer`) as unknown as unknown[];
    expect(rows).toHaveLength(0);
  });

  it("…including by count, by join and inside someone else's subquery", async () => {
    // Three shapes, because "no enumeration" has to hold for the clever version too.
    const [{ n }] = (await app`
      select count(*)::int as n from ref_oversight_officer
    `) as unknown as { n: number }[];
    expect(Number(n)).toBe(0);

    const joined = (await app`
      select o.officer_id from ref_oversight_officer o
        join dim_jurisdiction j on j.jurisdiction_id = o.jurisdiction_id
    `) as unknown as unknown[];
    expect(joined).toHaveLength(0);

    const sub = (await app`
      select j.name from dim_jurisdiction j
       where exists (select 1 from ref_oversight_officer o where o.jurisdiction_id = j.jurisdiction_id)
    `) as unknown as unknown[];
    expect(sub).toHaveLength(0);
  });

  it("SELF-PROMOTION IS A MISSING GRANT, not a policy decision", async () => {
    // The canonical attack: make myself national. It must fail with `permission denied` — i.e.
    // BEFORE any policy or trigger is consulted — because the app role was never granted UPDATE.
    // A policy could be mis-edited into permitting this; a privilege that does not exist cannot.
    let message = "";
    try {
      await app`
        update ref_oversight_officer
           set officer_role = 'NATIONAL_OVERSIGHT',
               jurisdiction_id = ${JUR.national}::uuid
         where officer_id = ${OFFICER.districtId}::uuid
      `;
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/permission denied/i);
  });

  it("the app role cannot INSERT a new officer either", async () => {
    let message = "";
    try {
      await app`
        insert into ref_oversight_officer (officer_id, jurisdiction_id, officer_role, as_of_date)
        values ('6fffffff-0000-4000-8000-0000000000aa', ${JUR.national}::uuid,
                'NATIONAL_OVERSIGHT', current_date)
      `;
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/permission denied/i);
  });
});

describe("the provisioning log is the provisioner's, and nobody else's", () => {
  it("the app role has NO grant on audit_officer_provisioning at all", async () => {
    let message = "";
    try {
      await app`select count(*) from audit_officer_provisioning`;
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/permission denied/i);
  });

  it("the provisioner role CAN read it — so the refusal above is posture, not a broken table", async () => {
    const [{ n }] = (await provisioner`
      select count(*)::int as n from audit_officer_provisioning
    `) as unknown as { n: number }[];
    expect(Number(n)).toBeGreaterThan(0);
  });

  it("…and cannot rewrite history: the log is append-only by trigger AND by absent grant", async () => {
    let message = "";
    try {
      await provisioner`update audit_officer_provisioning set reason = 'rewritten'`;
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/permission denied|append-only/i);
  });
});
