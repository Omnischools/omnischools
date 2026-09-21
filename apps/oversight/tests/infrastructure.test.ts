import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORBIDDEN_CENSUS_FIELDS,
  ForbiddenCensusFieldError,
  assertNoForbiddenCensusFields,
  getSchoolFacilitiesCensus,
} from "@/lib/oversight/infrastructure";
import { JUR } from "./fixtures/ids";
import { adminOperational, auditRowCount, districtOfficer } from "./helpers";

const scope = {
  jurisdictionId: districtOfficer.jurisdictionId,
  level: districtOfficer.level,
  officerId: districtOfficer.officerId,
};

describe("Lucy C5 — the infrastructure drill is NOT gated", () => {
  it("returns the school's census row", async () => {
    const census = await getSchoolFacilitiesCensus(scope, JUR.schoolPublicConsented);
    expect(census).not.toBeNull();
    expect(census!.schoolName).toBe("Asankrangwa SHS");
    expect(census!.classroomsTotal).toBe(24);
    expect(census!.latrinesGirls).toBe(8);
    expect(census!.hasWater).toBe(true);
    expect(census!.source).toBe("OPERATIONAL_AGG");
  });

  it("writes NO audit_access_log row", async () => {
    const before = await auditRowCount();
    await getSchoolFacilitiesCensus(scope, JUR.schoolPublicConsented);
    await getSchoolFacilitiesCensus(scope, JUR.schoolPublicConsented);
    expect(await auditRowCount()).toBe(before);
  });

  it("respects the jurisdiction ceiling like every other aggregate read", async () => {
    const outside = { ...scope, jurisdictionId: JUR.otherDistrict };
    expect(
      await getSchoolFacilitiesCensus(outside, JUR.schoolPublicConsented),
    ).toBeNull();
  });
});

describe("Lucy C5 — captured_by and caterer_name are EXCLUDED, not withheld", () => {
  it("the returned object has no forbidden key", async () => {
    const census = await getSchoolFacilitiesCensus(scope, JUR.schoolPublicConsented);
    for (const forbidden of FORBIDDEN_CENSUS_FIELDS) {
      expect(Object.keys(census!)).not.toContain(forbidden);
    }
  });

  it("no value in the returned object is the caterer's name", async () => {
    // The operational census row DOES hold "Auntie Adwoa Catering Services" (fixture). If the
    // analytics boundary ever started carrying it, this would catch it even under a renamed key.
    const sql = adminOperational();
    let catererName: string;
    try {
      const rows = (await sql`
        select caterer_name from facilities_snapshot limit 1
      `) as unknown as { caterer_name: string }[];
      catererName = rows[0]!.caterer_name;
    } finally {
      await sql.end({ timeout: 5 });
    }
    expect(catererName).toBe("Auntie Adwoa Catering Services");

    const census = await getSchoolFacilitiesCensus(scope, JUR.schoolPublicConsented);
    expect(JSON.stringify(census)).not.toContain(catererName);
  });

  it("the query text names neither column", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/oversight/infrastructure.ts"),
      "utf8",
    );
    const sqlBlock = source.slice(
      source.indexOf("tx.execute(sql`"),
      source.indexOf("`);"),
    );
    expect(sqlBlock).not.toMatch(/captured_by/);
    expect(sqlBlock).not.toMatch(/caterer_name/);
    expect(sqlBlock).not.toMatch(/select\s+\*/i);
  });

  it("the runtime guard throws rather than shipping a forbidden key", () => {
    expect(() => assertNoForbiddenCensusFields({ classrooms_total: 24 })).not.toThrow();
    expect(() =>
      assertNoForbiddenCensusFields({ classrooms_total: 24, caterer_name: "X" }),
    ).toThrowError(ForbiddenCensusFieldError);
    expect(() => assertNoForbiddenCensusFields({ captured_by: "u" })).toThrowError(
      ForbiddenCensusFieldError,
    );
  });
});
