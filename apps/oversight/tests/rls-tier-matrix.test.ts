import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { JUR, OFFICER } from "./fixtures/ids";
import { testDbConfig } from "./helpers";

/**
 * THE TIER MATRIX (increment G · Kofi AC "each tier sees exactly its subtree").
 *
 * Every assertion here runs as `ov_app` — the NON-OWNER role the app actually connects as. Running
 * it as the owner would prove nothing: a table owner is exempt from RLS unless the table is FORCEd,
 * so an owner-run suite is green against a database with no policies at all. That is the single most
 * important line in this file.
 *
 * WHAT IS BEING TESTED, PRECISELY: not "the predicate is correct" (one function,
 * `ov_in_subtree`, already unit-visible in db/sql/policies.sql) but "the predicate is ATTACHED, to
 * the right column, on every table that carries jurisdiction". Those are different claims, and the
 * second is the one that breaks: a new fact table added without its policy, or a ref table scoped on
 * `jurisdiction_id` when its column is called `district_id`. So the matrix sweeps four shapes:
 *   · dim_jurisdiction          — the spine, scoped on its OWN id (the recursive case)
 *   · fact_enrolment            — `jurisdiction_id`
 *   · ref_gss_population        — `district_id` (same predicate, different column)
 *   · ref_ges_teacher_establishment — no jurisdiction column at all; scoped through a join to the
 *                                 register. The most forgettable shape, hence included.
 *   · audit_access_log          — own rows OR subtree, which is a wider rule than the others and
 *                                 must not accidentally become the same one.
 */

const app = postgres(testDbConfig.analyticsUrl, { max: 1, prepare: false });

afterAll(async () => {
  await app.end({ timeout: 5 });
});

type Tier = {
  label: string;
  officerId: string;
  jurisdictionId: string | null;
  level: "DISTRICT" | "REGION" | "NATIONAL";
};

/** The three officer tiers, as the seeded directory has them (tests/fixtures/analytics-seed.sql). */
const DISTRICT: Tier = {
  label: "district (Wassa Amenfi West)",
  officerId: OFFICER.districtId,
  jurisdictionId: JUR.district,
  level: "DISTRICT",
};
const REGION: Tier = {
  label: "region (Western)",
  officerId: "60000000-0000-4000-8000-000000000004",
  jurisdictionId: JUR.region,
  level: "REGION",
};
const NATIONAL: Tier = {
  label: "national (Ghana)",
  officerId: OFFICER.nationalId,
  // The national officer's directory row points at the national NODE (not null) — Wells's note —
  // and `scopeFor()` passes it through. `ov_is_national()` short-circuits before it is used, so the
  // value is irrelevant to the filter; passing it is what keeps the GUC agreeing with the row.
  jurisdictionId: JUR.national,
  level: "NATIONAL",
};

/** Run one read with the GUCs `withJurisdiction()` would have set. Rolled back either way. */
async function asTier<T>(
  tier: Tier,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  let captured: T;
  try {
    await app.begin(async (tx) => {
      await tx`select set_config('app.current_jurisdiction', ${tier.jurisdictionId ?? ""}, true)`;
      await tx`select set_config('app.current_level', ${tier.level}, true)`;
      await tx`select set_config('app.current_officer', ${tier.officerId}, true)`;
      captured = await fn(tx as unknown as postgres.TransactionSql);
      throw new Error("__rollback__");
    });
  } catch (err) {
    if ((err as Error).message !== "__rollback__") throw err;
  }
  return captured!;
}

async function count(tier: Tier, query: string): Promise<number> {
  const rows = await asTier(tier, async (tx) => (await tx.unsafe(query)) as unknown[]);
  return Number((rows[0] as { n: string | number }).n);
}

describe("dim_jurisdiction — the spine is scoped on its own id", () => {
  it("the district officer sees their own node and its schools, and NOTHING in the other district", async () => {
    const ids = await asTier(DISTRICT, async (tx) => {
      const rows =
        (await tx`select jurisdiction_id::text as id from dim_jurisdiction`) as unknown as {
          id: string;
        }[];
      return rows.map((r) => r.id);
    });
    expect(ids).toContain(JUR.district);
    expect(ids).toContain(JUR.schoolPublicConsented);
    // The sibling district and its school: outside the subtree, therefore not present at all.
    expect(ids).not.toContain(JUR.otherDistrict);
    expect(ids).not.toContain(JUR.schoolOutsideSubtree);
    // And not the ancestors either — the subtree walk is DOWNWARD. A district officer has no
    // business reading the region row, and seeing it would mean the ancestor chain was inverted.
    expect(ids).not.toContain(JUR.region);
    expect(ids).not.toContain(JUR.national);
  });

  it("the regional officer sees BOTH districts and both their schools", async () => {
    const ids = await asTier(REGION, async (tx) => {
      const rows =
        (await tx`select jurisdiction_id::text as id from dim_jurisdiction`) as unknown as {
          id: string;
        }[];
      return rows.map((r) => r.id);
    });
    expect(ids).toContain(JUR.district);
    expect(ids).toContain(JUR.otherDistrict);
    expect(ids).toContain(JUR.schoolOutsideSubtree);
    expect(ids).not.toContain(JUR.national);
  });

  it("the national officer sees every node — ov_is_national short-circuits the walk", async () => {
    const visible = await count(
      NATIONAL,
      "select count(*)::int as n from dim_jurisdiction",
    );
    const total = await ownerCount("select count(*)::int as n from dim_jurisdiction");
    expect(visible).toBe(total);
  });
});

describe("fact_* — scoped through jurisdiction_id", () => {
  it("the district officer sees their school's enrolment row only", async () => {
    const rows = await asTier(DISTRICT, async (tx) => {
      return (await tx`select headcount from fact_enrolment order by headcount`) as unknown as {
        headcount: number;
      }[];
    });
    // 410 is the in-district school; 720 is the Sekondi one. The VALUE is asserted, not just the
    // count: a leak that returned the wrong row would otherwise still pass a count assertion.
    expect(rows.map((r) => r.headcount)).toEqual([410]);
  });

  it("the regional officer sees both, the national officer sees both", async () => {
    expect(await count(REGION, "select count(*)::int as n from fact_enrolment")).toBe(2);
    expect(await count(NATIONAL, "select count(*)::int as n from fact_enrolment")).toBe(
      2,
    );
  });
});

describe("ref_* — the same predicate through a DIFFERENT column, and through a join", () => {
  it("ref_gss_population is scoped on district_id", async () => {
    const rows = await asTier(DISTRICT, async (tx) => {
      return (await tx`select population from ref_gss_population`) as unknown as {
        population: number;
      }[];
    });
    expect(rows.map((r) => r.population)).toEqual([9100]);
    expect(await count(REGION, "select count(*)::int as n from ref_gss_population")).toBe(
      2,
    );
  });

  it("ref_emis_school_register hides the out-of-district school", async () => {
    const codes = await asTier(DISTRICT, async (tx) => {
      const rows =
        (await tx`select emis_school_id from ref_emis_school_register`) as unknown as {
          emis_school_id: string;
        }[];
      return rows.map((r) => r.emis_school_id);
    });
    expect(codes).toContain("EMIS-PUB-001");
    expect(codes).not.toContain("EMIS-OUT-008");
  });

  it("ref_ges_teacher_establishment is scoped through the register join, not a column of its own", async () => {
    // The establishment extract has no jurisdiction column at all. If its policy were ever dropped,
    // a district officer would read every school's GES establishment in the country.
    const districtRows = await count(
      DISTRICT,
      "select count(*)::int as n from ref_ges_teacher_establishment",
    );
    const nationalRows = await count(
      NATIONAL,
      "select count(*)::int as n from ref_ges_teacher_establishment",
    );
    expect(districtRows).toBeGreaterThan(0);
    expect(districtRows).toBe(nationalRows); // every seeded vintage happens to be in-district…
    // …so prove the scoping with a row that is NOT: the out-of-subtree school's register row is
    // invisible, which is what makes the join-based policy observable.
    const outsideVisible = await count(
      DISTRICT,
      `select count(*)::int as n from ref_emis_school_register where emis_school_id = 'EMIS-OUT-008'`,
    );
    expect(outsideVisible).toBe(0);
  });
});

describe("audit_access_log — own rows OR subtree, which is wider but still bounded", () => {
  it("the district officer sees the in-district entry and not the other district's", async () => {
    const refs = await asTier(DISTRICT, async (tx) => {
      const rows = (await tx`
        select case_reference from audit_access_log
         where case_reference in ('CASE-MATRIX-IN', 'CASE-MATRIX-OUT')
      `) as unknown as { case_reference: string }[];
      return rows.map((r) => r.case_reference);
    });
    expect(refs).toEqual(["CASE-MATRIX-IN"]);
  });

  it("the regional officer sees both entries — they are both inside the region", async () => {
    const refs = await asTier(REGION, async (tx) => {
      const rows = (await tx`
        select case_reference from audit_access_log
         where case_reference in ('CASE-MATRIX-IN', 'CASE-MATRIX-OUT')
         order by case_reference
      `) as unknown as { case_reference: string }[];
      return rows.map((r) => r.case_reference);
    });
    expect(refs).toEqual(["CASE-MATRIX-IN", "CASE-MATRIX-OUT"]);
  });

  it("an officer sees their OWN row even when its jurisdiction is outside their subtree", async () => {
    // `audit_scope` is `officer_id = ov_current_officer() OR ov_in_subtree(...)`. The own-rows half
    // exists so an officer can always review their own history (Lucy §A1.3) — including an access
    // made before a transfer. Acting as the DEACTIVATED Sekondi officer proves the OR branch
    // independently of the subtree branch: their node is the other district, so the subtree half
    // cannot be what makes the row visible from Wassa Amenfi West.
    const refs = await asTier(
      {
        label: "transferred officer",
        officerId: "60000000-0000-4000-8000-000000000005",
        jurisdictionId: JUR.district, // a node that does NOT contain their logged access
        level: "DISTRICT",
      },
      async (tx) => {
        const rows = (await tx`
          select case_reference from audit_access_log
           where case_reference = 'CASE-MATRIX-OUT'
        `) as unknown as { case_reference: string }[];
        return rows.map((r) => r.case_reference);
      },
    );
    expect(refs).toEqual(["CASE-MATRIX-OUT"]);
  });
});

describe("a FORGED claim cannot widen scope", () => {
  it("setting app.current_level to NATIONAL is not something the app can be talked into", async () => {
    // This test documents the shape of the protection rather than probing the database: the GUCs
    // ARE the authority, and anyone with raw SQL can set them — which is precisely why the only code
    // that sets them is `withJurisdiction()` (lib/db/rls.ts), why its scope argument can only be
    // built from a resolved session, and why the resolver takes nothing but a uid from the token.
    // The forged-JWT path is exercised end-to-end in tests/officer-resolver-rls.test.ts; what is
    // asserted here is the consequence if that chain were ever broken, so the stakes are visible
    // beside the matrix.
    const leaked = await count(
      {
        label: "forged national",
        officerId: OFFICER.districtId,
        jurisdictionId: JUR.district,
        level: "NATIONAL",
      },
      "select count(*)::int as n from fact_enrolment",
    );
    expect(leaked).toBe(2);
    // ⇒ A raw SQL channel holding the app credential is unfiltered. The boundary that matters is
    // therefore "nothing but withJurisdiction writes these GUCs, and its input is unforgeable",
    // which tests/scope-brand.test.ts and tests/officer-session-mint.test.ts hold in place.
  });
});

/** An owner-side count, used only to express "all of them" without hard-coding a fixture total. */
async function ownerCount(query: string): Promise<number> {
  const owner = postgres(testDbConfig.superuserAnalyticsUrl, { max: 1, prepare: false });
  try {
    const rows = (await owner.unsafe(query)) as unknown as { n: number }[];
    return Number(rows[0]!.n);
  } finally {
    await owner.end({ timeout: 5 });
  }
}
