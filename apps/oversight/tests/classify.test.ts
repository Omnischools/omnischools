import { describe, expect, it } from "vitest";
import {
  ESTABLISHMENT_STALENESS_CEILING_MONTHS,
  classifyStaffSubject,
} from "@/lib/oversight/classify";
import { EMIS, GES_STAFF_ID, JUR } from "./fixtures/ids";
import { adminOperational, districtOfficer, nationalOfficer } from "./helpers";

const scope = {
  jurisdictionId: districtOfficer.jurisdictionId,
  level: districtOfficer.level,
  officerId: districtOfficer.officerId,
};

describe("Kofi group B — classification comes from the GES establishment register", () => {
  it("classifies a staff id on the school's fresh register row as GES_TEACHER", async () => {
    const result = await classifyStaffSubject(scope, {
      emisSchoolId: EMIS.publicConsented,
      gesStaffId: GES_STAFF_ID.onRegister,
    });
    expect(result.category).toBe("GES_TEACHER");
  });

  it("classifies a staff id absent from the register as OTHER_STAFF", async () => {
    const result = await classifyStaffSubject(scope, {
      emisSchoolId: EMIS.publicConsented,
      gesStaffId: GES_STAFF_ID.notOnAnyRegister,
    });
    expect(result).toMatchObject({ category: "OTHER_STAFF", reason: "NOT_ON_REGISTER" });
  });

  it("classifies a subject with no GES staff id as OTHER_STAFF (cannot claim statute)", async () => {
    const result = await classifyStaffSubject(scope, {
      emisSchoolId: EMIS.publicConsented,
      gesStaffId: null,
    });
    expect(result).toMatchObject({
      category: "OTHER_STAFF",
      reason: "NO_STAFF_IDENTIFIER",
    });
  });

  it("does NOT use ref_role.code — a school-authored 'TEACHER' role confers nothing", async () => {
    // The fixture's non-register clerk and the register teacher are at the SAME school; the clerk's
    // role row is a non-teaching one and the register teacher's is 'TEACHER'. Flip the clerk's role
    // to 'TEACHER' in the operational DB and the classification must not move.
    const sql = adminOperational();
    try {
      await sql`
        update role_assignment
           set role_id = '41000000-0000-4000-8000-000000000001'
         where id = '42000000-0000-4000-8000-000000000002'
      `;
      const result = await classifyStaffSubject(scope, {
        emisSchoolId: EMIS.publicConsented,
        gesStaffId: GES_STAFF_ID.notOnAnyRegister,
      });
      expect(result.category).toBe("OTHER_STAFF");
    } finally {
      await sql`
        update role_assignment
           set role_id = '41000000-0000-4000-8000-000000000002'
         where id = '42000000-0000-4000-8000-000000000002'
      `;
      await sql.end({ timeout: 5 });
    }
  });

  it("does NOT use salary_status — every fixture staff row is GES_PAID and most are OTHER_STAFF", async () => {
    const sql = adminOperational();
    try {
      const rows = (await sql`
        select count(*)::int as n from staff_compensation where salary_status = 'GES_PAID'
      `) as unknown as { n: number }[];
      expect(rows[0]!.n).toBeGreaterThan(1);
    } finally {
      await sql.end({ timeout: 5 });
    }
    // ... and yet:
    const result = await classifyStaffSubject(scope, {
      emisSchoolId: EMIS.publicConsented,
      gesStaffId: GES_STAFF_ID.notOnAnyRegister,
    });
    expect(result.category).toBe("OTHER_STAFF");
  });

  it("returns OTHER_STAFF/NO_ESTABLISHMENT_ROW when the school has no register row", async () => {
    const result = await classifyStaffSubject(scope, {
      emisSchoolId: "EMIS-DOES-NOT-EXIST",
      gesStaffId: GES_STAFF_ID.onRegister,
    });
    expect(result).toMatchObject({
      category: "OTHER_STAFF",
      reason: "NO_ESTABLISHMENT_ROW",
    });
  });
});

describe("Kofi group C — the six-month staleness ceiling fails closed", () => {
  it("refuses the statutory branch for a staff id on a 400-day-old extract", async () => {
    const result = await classifyStaffSubject(scope, {
      emisSchoolId: EMIS.publicStale,
      gesStaffId: GES_STAFF_ID.onStaleRegister,
    });
    expect(result).toMatchObject({
      category: "OTHER_STAFF",
      reason: "STALE_ESTABLISHMENT",
    });
  });

  it("is a ceiling, not a cliff at an arbitrary date: fresh data classifies, the same data six months later does not", async () => {
    const fresh = await classifyStaffSubject(scope, {
      emisSchoolId: EMIS.publicConsented,
      gesStaffId: GES_STAFF_ID.onRegister,
    });
    expect(fresh.category).toBe("GES_TEACHER");

    // Same row, clock moved past the ceiling.
    const later = new Date();
    later.setUTCMonth(later.getUTCMonth() + ESTABLISHMENT_STALENESS_CEILING_MONTHS + 1);
    const stale = await classifyStaffSubject(scope, {
      emisSchoolId: EMIS.publicConsented,
      gesStaffId: GES_STAFF_ID.onRegister,
      now: later,
    });
    expect(stale).toMatchObject({
      category: "OTHER_STAFF",
      reason: "STALE_ESTABLISHMENT",
    });
  });

  it("reports staleness rather than absence — the two lead an auditor to different places", async () => {
    const result = await classifyStaffSubject(scope, {
      emisSchoolId: EMIS.publicStale,
      // A subject NOT named on the stale row: staleness is still checked first, because a stale
      // file cannot be trusted to say who is absent from it either.
      gesStaffId: GES_STAFF_ID.notOnAnyRegister,
    });
    expect(result).toMatchObject({
      category: "OTHER_STAFF",
      reason: "STALE_ESTABLISHMENT",
    });
  });
});

describe("the jurisdiction ceiling holds during classification", () => {
  it("a district officer cannot classify against a school outside the subtree", async () => {
    const outside = {
      jurisdictionId: JUR.otherDistrict,
      level: "DISTRICT" as const,
      officerId: districtOfficer.officerId,
    };
    const result = await classifyStaffSubject(outside, {
      emisSchoolId: EMIS.publicConsented,
      gesStaffId: GES_STAFF_ID.onRegister,
    });
    // RLS filters the register row away, so the register simply has nothing to say.
    expect(result).toMatchObject({
      category: "OTHER_STAFF",
      reason: "NO_ESTABLISHMENT_ROW",
    });
  });

  it("the national tier sees every school's register", async () => {
    const result = await classifyStaffSubject(
      {
        jurisdictionId: nationalOfficer.jurisdictionId,
        level: nationalOfficer.level,
        officerId: nationalOfficer.officerId,
      },
      { emisSchoolId: EMIS.publicConsented, gesStaffId: GES_STAFF_ID.onRegister },
    );
    expect(result.category).toBe("GES_TEACHER");
  });
});
