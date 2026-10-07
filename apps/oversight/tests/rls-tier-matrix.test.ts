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
      // The two mandatory enrolment filters (sex='ALL', class_form is null) keep this probe about RLS
      // ISOLATION — its actual subject — rather than about fixture cardinality: the shared seed now
      // carries the MALE/FEMALE split beside the ALL stage total, so a raw `headcount` read would return
      // [190, 220, 410]. The stage total is the one figure, and it is 410.
      return (await tx`
        select headcount from fact_enrolment
         where sex = 'ALL' and class_form is null
         order by headcount`) as unknown as {
        headcount: number;
      }[];
    });
    // 410 is the in-district school; 720 is the Sekondi one. The VALUE is asserted, not just the
    // count: a leak that returned the wrong row would otherwise still pass a count assertion.
    expect(rows.map((r) => r.headcount)).toEqual([410]);
  });

  it("…and NO row of any SHAPE leaks to the district officer — the sexed rows are scoped too", async () => {
    // The filtered probe above proves the ALL stage total is isolated, but it would also pass if the
    // other district's MALE/FEMALE rows were visible. The girls'-share numerator is read off exactly
    // those rows (sex='FEMALE'), so assert the UNFILTERED shape as well: 3 = this district's one school
    // × (ALL 410 + MALE 190 + FEMALE 220), and not the 6 that exist in the table.
    expect(await count(DISTRICT, "select count(*)::int as n from fact_enrolment")).toBe(3);
    const female = await asTier(DISTRICT, async (tx) => {
      return (await tx`
        select headcount from fact_enrolment
         where sex = 'FEMALE' and class_form is null
         order by headcount`) as unknown as { headcount: number }[];
    });
    // 220 is the in-district school's girls; 320 is the Sekondi one and must be absent BY VALUE.
    expect(female.map((r) => r.headcount)).toEqual([220]);
  });

  it("the regional officer sees both, the national officer sees both", async () => {
    // Raw, UNFILTERED count, deliberately: this assertion's job is "no row of any shape leaks", so it
    // must not narrow by sex/class_form. 6 = 2 schools × (ALL + MALE + FEMALE) on the ANNUAL period.
    expect(await count(REGION, "select count(*)::int as n from fact_enrolment")).toBe(6);
    expect(await count(NATIONAL, "select count(*)::int as n from fact_enrolment")).toBe(
      6,
    );
  });

  /**
   * `fact_staffing` — the SIXTH fact arm, and the newest table in this sweep. It is already inside
   * `policies.sql`'s fact loop, so the deliverable here is that the matrix now runs against a
   * NON-EMPTY `fact_staffing` (see the fixture): a policy test over an empty table proves nothing, and
   * "the table was in the loop" is not the same claim as "the predicate is attached to this column".
   */
  it("the district officer sees their school's staffing row ONLY, with its measures", async () => {
    const rows = await asTier(DISTRICT, async (tx) => {
      return (await tx`
        select teachers_on_roll, enrolment_total, ptr::text as ptr,
               teaching_posts_established, vacancies
          from fact_staffing order by teachers_on_roll`) as unknown as {
        teachers_on_roll: number;
        enrolment_total: number;
        ptr: string;
        teaching_posts_established: number | null;
        vacancies: number | null;
      }[];
    });
    // The VALUES, not just the count: a leak returning the other district's row would still pass a
    // count assertion. 41/410 is the in-district school; 18/720 is the Sekondi one.
    expect(rows).toHaveLength(1);
    expect(rows[0].teachers_on_roll).toBe(41);
    expect(rows[0].enrolment_total).toBe(410);
    // And the SIGNED vacancy survives the policy intact — a surplus school reads as a surplus school.
    expect(rows[0].vacancies).toBe(-3);
  });

  it("a sibling district's staffing rows are INVISIBLE — and so is the Σ÷Σ roll-up over them", async () => {
    const leaked = await asTier(DISTRICT, async (tx) => {
      return (await tx`
        select count(*)::int as n,
               sum(enrolment_total)::text   as e,
               sum(teachers_on_roll)::text  as t
          from fact_staffing
         where jurisdiction_id = '10000000-0000-4000-8000-000000000018'::uuid`) as unknown as {
        n: number;
        e: string | null;
        t: string | null;
      }[];
    });
    // Zero rows, not an error, and the ROLL-UP's two inputs come back NULL rather than a number: the
    // leak a reporting bug would actually write here is the correct Σ÷Σ formula aimed at the wrong
    // subtree, so that exact shape is the one asserted.
    expect(leaked[0].n).toBe(0);
    expect(leaked[0].e).toBeNull();
    expect(leaked[0].t).toBeNull();
  });

  it("the region and the nation see both staffing rows", async () => {
    expect(await count(REGION, "select count(*)::int as n from fact_staffing")).toBe(2);
    expect(await count(NATIONAL, "select count(*)::int as n from fact_staffing")).toBe(2);
  });

  it("an UNSET jurisdiction GUC sees NO staffing row — fail closed, not fail open", async () => {
    const blind = await count(
      { label: "unset", officerId: OFFICER.districtId, jurisdictionId: null, level: "DISTRICT" },
      "select count(*)::int as n from fact_staffing",
    );
    expect(blind).toBe(0);
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
    // 6 = 2 schools × (ALL + MALE + FEMALE) on the ANNUAL period — the whole unfiltered table.
    expect(leaked).toBe(6);
    // ⇒ A raw SQL channel holding the app credential is unfiltered. The boundary that matters is
    // therefore "nothing but withJurisdiction writes these GUCs, and its input is unforgeable",
    // which tests/scope-brand.test.ts and tests/officer-session-mint.test.ts hold in place.
  });
});

/**
 * THE COMPARISON WORKSPACE'S PICKER READ (increment I · Wells test #5, Kofi AC3/AC4).
 *
 * `lib/oversight/comparison-entities.ts` offers the officer the entities they may compare with ONE
 * query: `select … from dim_jurisdiction where level = $childLevel` and NOTHING else on the ceiling —
 * no `parent_id` filter. That is only safe if `ov_in_subtree()` is the boundary, so the property has
 * to be asserted here, as `ov_app`, against the real policy: a district officer asking for schools
 * gets their OWN schools, and the same shape aimed at any OTHER level returns ZERO ROWS.
 *
 * Why this test exists at all: the sibling tier is DEFERRED behind a disabled toggle, which means the
 * only evidence that it is deferred for a REASON is that the query comes back empty. Pinned here, a
 * later "fix" to an empty sibling table fails a test instead of widening a query.
 */
const PICKER_QUERY = (level: string) =>
  `select dj.jurisdiction_id::text as id, dj.name as name, dj.school_type::text as school_type
     from dim_jurisdiction dj
    where dj.level = '${level}'::jurisdiction_level
    order by dj.name asc`;

async function pickerNames(tier: Tier, level: string): Promise<string[]> {
  const rows = await asTier(tier, async (tx) => {
    return (await tx.unsafe(PICKER_QUERY(level))) as unknown as { name: string }[];
  });
  return rows.map((r) => r.name);
}

describe("the comparison picker's entity read is bounded by ov_in_subtree, not by a parent_id filter", () => {
  it("a DISTRICT officer asking for SCHOOLS gets their own schools and NOT the sibling district's", async () => {
    const names = await pickerNames(DISTRICT, "SCHOOL");
    expect(names).toContain("Asankrangwa SHS");
    expect(names).toContain("Amenfiman SHS");
    expect(names).toContain("Wassa Akropong JHS");
    // The sibling district's SHS is the one a leak would surface — it is the same school_type as the
    // officer's own, so a level-only filter without RLS would offer it as "like-for-like".
    expect(names).not.toContain("Takoradi SHS");
    const owner = await ownerCount(
      "select count(*)::int as n from dim_jurisdiction where level = 'SCHOOL'",
    );
    expect(names.length).toBeLessThan(owner); // 8 of 9 — the boundary is observable, not vacuous
  });

  it("WELLS #5 — aimed at the SIBLING tier the read yields the officer's OWN node and no peer", async () => {
    // The deferred sibling comparison, probed at the data layer: not "the toggle is disabled" (a UI
    // fact) but "there is nothing to serve" (the RLS fact that makes the deferral honest).
    //
    // `ov_in_subtree()` admits the officer's own node, so this is ONE row — themselves — and never a
    // peer. A sibling comparison is therefore not merely unimplemented, it is unservable: the only
    // district a district officer can put in a district-vs-district table is their own. The ancestor
    // tiers return nothing at all, because the subtree walk is DOWNWARD.
    expect(await pickerNames(DISTRICT, "DISTRICT")).toEqual(["Wassa Amenfi West"]);
    expect(await pickerNames(DISTRICT, "DISTRICT")).not.toContain("Sekondi-Takoradi Metro");
    expect(await pickerNames(DISTRICT, "REGION")).toEqual([]);
    expect(await pickerNames(DISTRICT, "NATIONAL")).toEqual([]);
    // And not a single row of the parent region's subtree leaks in through any of them.
    const anyOther = await count(
      DISTRICT,
      `select count(*)::int as n from dim_jurisdiction
        where jurisdiction_id in ('${JUR.otherDistrict}'::uuid, '${JUR.region}'::uuid,
                                  '${JUR.national}'::uuid, '${JUR.schoolOutsideSubtree}'::uuid)`,
    );
    expect(anyOther).toBe(0);
  });

  it("a REGIONAL officer asking for DISTRICTS gets both of their districts (in-subtree, servable)", async () => {
    const names = await pickerNames(REGION, "DISTRICT");
    expect(names).toEqual(["Sekondi-Takoradi Metro", "Wassa Amenfi West"]);
    // …while the region's own tier yields only ITSELF (no sibling region to compare against) and the
    // nation above it is out of reach entirely.
    expect(await pickerNames(REGION, "REGION")).toEqual(["Western Region"]);
    expect(await pickerNames(REGION, "NATIONAL")).toEqual([]);
  });

  it("a NATIONAL officer asking for REGIONS gets the region; the walk short-circuits, it does not widen", async () => {
    expect(await pickerNames(NATIONAL, "REGION")).toEqual(["Western Region"]);
  });

  it("an UNSET jurisdiction GUC offers NOTHING to compare — the picker fails closed", async () => {
    const blind = await pickerNames(
      { label: "unset", officerId: OFFICER.districtId, jurisdictionId: null, level: "DISTRICT" },
      "SCHOOL",
    );
    expect(blind).toEqual([]);
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
