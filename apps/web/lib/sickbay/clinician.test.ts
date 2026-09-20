import { describe, it, expect } from "vitest";
import { hasAnyRole, SICKBAY_STOCK_WRITE_ROLES } from "@/lib/access";
import { readCode, TENANT_READ } from "@/lib/test-utils/source-shape";

/**
 * `assertSchoolClinician` (R158) is app-layer tenancy on a GLOBAL ref_user pointer — the DB cannot
 * check it. There is no DB in this suite (local dev connects as a superuser, so RLS through the app
 * proves nothing), so this pins the ASSERTION EXPRESSION, not the name (ADV-3): the two facts the
 * function must test — MATRON in THIS school, and (under requireNmc) a non-null in-school N&MC licence —
 * are what a gate has to see, and a rename of the query columns would flip a false pass here.
 */
const CLINICIAN = "lib/sickbay/clinician.ts";

describe("assertSchoolClinician asserts the EXPRESSION — MATRON in this school, N&MC on requireNmc", () => {
  const src = () => readCode(CLINICIAN);

  it("is server-only and reaches the DB only through the tenant-scoped withSchool seam", () => {
    const s = src();
    expect(s, "must be server-only — it imports the db driver").toContain('import "server-only"');
    expect(s.search(TENANT_READ), "must reach the DB through a tenant helper").toBeGreaterThan(-1);
    expect(s, "the tenant seam is withSchool").toMatch(/withSchool\(/);
  });

  it("gates on the MATRON role in THIS school (school_id + user_id + roles.code = MATRON)", () => {
    const s = src();
    expect(s).toMatch(/eq\(roles\.code,\s*"MATRON"\)/);
    expect(s).toMatch(/eq\(roleAssignments\.schoolId,\s*schoolId\)/);
    expect(s).toMatch(/eq\(roleAssignments\.userId,\s*userId\)/);
  });

  it("requireNmc adds a REAL tenant join to staff_profile on (school_id, user_id) + NMC not null", () => {
    const s = src();
    // The join is on BOTH tenant columns — a global-only join would re-open the cross-tenant hole.
    expect(s).toMatch(/eq\(\s*staffProfiles\.schoolId,\s*roleAssignments\.schoolId\s*\)/);
    expect(s).toMatch(/eq\(\s*staffProfiles\.userId,\s*roleAssignments\.userId\s*\)/);
    // …and the licence must be PRESENT, never merely joined.
    expect(s).toMatch(/isNotNull\(staffProfiles\.nmcLicenceNumber\)/);
    // The NMC clause is CONDITIONAL on requireNmc — a non-witness pointer must not demand a licence.
    expect(s).toMatch(/requireNmc/);
  });

  it("returns a boolean from row presence — no row is a refusal, never a throw", () => {
    expect(src()).toMatch(/return rows\.length > 0/);
  });
});

describe("SICKBAY_STOCK_WRITE_ROLES — the §3 inversion (MATRON gains, HEADMASTER loses)", () => {
  it("admits the ADMIN and the MATRON", () => {
    expect(hasAnyRole(["ADMIN"], SICKBAY_STOCK_WRITE_ROLES)).toBe(true);
    expect(hasAnyRole(["MATRON"], SICKBAY_STOCK_WRITE_ROLES)).toBe(true);
  });

  it("🔴 REFUSES the HEADMASTER — §3 write is the ONE gate he does not hold (R165)", () => {
    expect(hasAnyRole(["HEADMASTER"], SICKBAY_STOCK_WRITE_ROLES)).toBe(false);
  });

  it("refuses a HOUSEMASTER, a plain teacher and an empty session", () => {
    expect(hasAnyRole(["HOUSEMASTER"], SICKBAY_STOCK_WRITE_ROLES)).toBe(false);
    expect(hasAnyRole(["TEACHER"], SICKBAY_STOCK_WRITE_ROLES)).toBe(false);
    expect(hasAnyRole([], SICKBAY_STOCK_WRITE_ROLES)).toBe(false);
  });

  it("grep-pin: the set stays EXACTLY [ADMIN, MATRON] — widening it is a decision, not a tweak", () => {
    expect([...SICKBAY_STOCK_WRITE_ROLES]).toEqual(["ADMIN", "MATRON"]);
  });
});
