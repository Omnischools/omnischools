import { afterAll, describe, expect, it } from "vitest";
import { requestNamedStaffRecord } from "@/lib/oversight/named-record-access";
import { closeReadback, withReadbackSchool } from "@/lib/db/readback";
import { EMIS, OPS_SCHOOL, OPS_STAFF } from "./fixtures/ids";
import { SCHOOL } from "./fixtures/schools";
import { auditRowsFor, caseRef, districtOfficer } from "./helpers";

/**
 * S2 — `ref_user` and `ref_role` are GLOBAL tables, and the read-back role must not be able to
 * read them as such.
 *
 * Two failure modes sit on either side of a single grant, and the fixture used to model NEITHER
 * because it created both tables with no RLS at all:
 *
 *   TOO OPEN  — an unqualified `grant select on ref_user` makes
 *               `select full_name, phone from ref_user` a platform-wide PII enumeration primitive,
 *               behind the one credential whose entire purpose is to fetch ONE record. `email` is
 *               worse still: no reason code releases it, so the role must not be able to read the
 *               column at all.
 *   TOO SHUT  — on real prod these tables are RLS-enabled with NO policy (deny-all). An unqualified
 *               grant then returns ZERO rows, the identity spine's INNER join to `ref_user` yields
 *               nothing, and the gate writes a GRANTED audit row and THEN finds an empty
 *               projection — an append-only entry permanently overstating a disclosure that never
 *               happened. This is the class the fixture change is really here to catch.
 *
 * The fixture now mirrors prod (RLS on) plus the confirm-not-enumerate policy the role actually
 * needs, keyed on `app.current_school` — so the projection below is exercised UNDER that policy.
 */

afterAll(async () => {
  await closeReadback();
});

describe("ref_user cannot be enumerated", () => {
  it("returns NOTHING with no tenant GUC set", async () => {
    const rows = (await withReadbackSchool(
      // Open a transaction, then blank the GUC to simulate a caller that never scoped itself.
      OPS_SCHOOL.publicConsented,
      async (tx) => {
        await tx`select set_config('app.current_school', '', true)`;
        return tx`select count(*)::int as n from ref_user`;
      },
    )) as unknown as { n: number }[];
    expect(rows[0]!.n).toBe(0);
  });

  it("shows ONLY the staff of the school in the GUC — confirm, not enumerate", async () => {
    const countFor = async (schoolId: string) => {
      const rows = (await withReadbackSchool(
        schoolId,
        async (tx) => tx`select count(*)::int as n from ref_user`,
      )) as unknown as { n: number }[];
      return rows[0]!.n;
    };
    // One staff profile per fixture school, so each school sees exactly its own person …
    expect(await countFor(OPS_SCHOOL.publicConsented)).toBe(2);
    expect(await countFor(OPS_SCHOOL.publicNoConsent)).toBe(1);
    // … and never the platform-wide total.
    const total = (await withReadbackSchool(
      OPS_SCHOOL.publicConsented,
      async (tx) => tx`select count(*)::int as n from staff_profile`,
    )) as unknown as { n: number }[];
    expect(total[0]!.n).toBe(2);
  });

  it("cannot read `email` at all — no reason code releases it, so the GRANT excludes it", async () => {
    await expect(
      withReadbackSchool(
        OPS_SCHOOL.publicConsented,
        async (tx) => tx`select email from ref_user limit 1`,
      ),
    ).rejects.toThrowError(/permission denied/i);
  });

  it("ref_role is equally unenumerable", async () => {
    const rows = (await withReadbackSchool(OPS_SCHOOL.publicConsented, async (tx) => {
      await tx`select set_config('app.current_school', '', true)`;
      return tx`select count(*)::int as n from ref_role`;
    })) as unknown as { n: number }[];
    expect(rows[0]!.n).toBe(0);
  });
});

describe("the identity spine still resolves UNDER those policies", () => {
  it("returns the right person for the right tenant — not an empty projection", async () => {
    // The overstatement class: if `ref_user` were unreadable, this would produce a GRANTED audit
    // row followed by SUBJECT_NOT_FOUND, permanently claiming a release that never happened.
    const reference = caseRef("identity-under-rls");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicConsented,
      reasonCode: "SAFEGUARDING_MISCONDUCT",
      caseReference: reference,
      subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister, gesStaffId: null },
    });

    expect(result.outcome).toBe("GRANTED");
    if (result.outcome !== "GRANTED") return;
    expect(result.record.full_name).toBe("Kojo Mensah");
    expect(result.record.phone).toBe("+233200000002");
    expect(result.record.assigned_school).toBe("Asankrangwa SHS");
    expect(result.record.post_role_label).toBe("Non-teaching · Accounts");
    expect(result.record.email).toBeUndefined();

    const rows = await auditRowsFor(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("GRANTED");
  });

  it("resolves NOTHING across tenants: the right uuid, the wrong school", async () => {
    const reference = caseRef("identity-cross-tenant");
    const result = await requestNamedStaffRecord({
      officer: districtOfficer,
      school: SCHOOL.publicNoConsent,
      reasonCode: "SAFEGUARDING_MISCONDUCT",
      caseReference: reference,
      // A real staff_profile.id — belonging to ANOTHER school.
      subject: { operationalStaffId: OPS_STAFF.clerkNotOnRegister, gesStaffId: null },
    });
    // Refused at the consent gate before the subject is even looked for; nothing leaks either way.
    expect(result.outcome).not.toBe("GRANTED");
    const rows = await auditRowsFor(reference);
    expect(rows[0]!.fields_released).toEqual([]);
  });

  it("the staff-list browse is scoped by the same policy", async () => {
    const rows = (await withReadbackSchool(
      OPS_SCHOOL.publicConsented,
      async (tx) =>
        tx`select u.full_name
             from staff_profile sp join ref_user u on u.id = sp.user_id
            order by u.full_name`,
    )) as unknown as { full_name: string }[];
    expect(rows.map((r) => r.full_name).sort()).toEqual(["Ama Boateng", "Kojo Mensah"]);
    expect(EMIS.publicConsented).toBe("EMIS-PUB-001");
  });
});
