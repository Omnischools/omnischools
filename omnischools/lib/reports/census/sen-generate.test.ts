import { describe, it, expect, vi, beforeEach } from "vitest";
import { emptySenByCategory, type SenCategory, type SenSexCount } from "./sen-data";

/**
 * GOV-10 · the §5 arm of the census generator — AC GOV10-08/09/10/13/14. Drives the REAL
 * `generateCensusSnapshot` with every reader mocked (mirrors generate.test.ts). It pins the R413 honesty
 * narrowing:
 *   - not-adopted           → NONE + a hand-fill reason, NO `data`   (never a fabricated zeros payload)
 *   - adopted, genuine zero → FULL with all 12 cells 0                (a captured zero is a truth)
 *   - adopted, counts       → FULL carrying the de-id 12-cell grid
 *   - MID_YEAR              → a NONE cadence stub, and getCensusSpecialNeeds is NEVER read (the DB is not
 *                             touched at mid-year, R413/R418)
 * The §5 arm is TIER-AGNOSTIC — it is never NOT_APPLICABLE on tier grounds (GOV10-14).
 */

const getSchoolRollup = vi.fn();
const getCensusEnrolment = vi.fn();
const getCensusStaff = vi.fn();
const getFacilitiesSnapshot = vi.fn();
const getCensusSpecialNeeds = vi.fn();
const withSchoolMock = vi.fn();

vi.mock("@/lib/rollup/school-rollup", () => ({ getSchoolRollup: (...a: unknown[]) => getSchoolRollup(...a) }));
vi.mock("@/lib/reports/census-enrolment-data", () => ({
  getCensusEnrolment: (...a: unknown[]) => getCensusEnrolment(...a),
}));
vi.mock("@/lib/reports/census/census-staff-data", () => ({
  getCensusStaff: (...a: unknown[]) => getCensusStaff(...a),
}));
vi.mock("@/lib/reports/facilities-data", () => ({
  getFacilitiesSnapshot: (...a: unknown[]) => getFacilitiesSnapshot(...a),
}));
vi.mock("@/lib/reports/census/sen-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sen-data")>();
  return { ...actual, getCensusSpecialNeeds: (...a: unknown[]) => getCensusSpecialNeeds(...a) };
});
vi.mock("@/lib/db/rls", () => ({ withSchool: (...a: unknown[]) => withSchoolMock(...a) }));

const { generateCensusSnapshot } = await import("./generate");

const CAPTURED = <T>(data: T) => ({ status: "CAPTURED" as const, data });
const NC = (reason: string) => ({ status: "NOT_CAPTURED" as const, reason });
const NA = (reason: string) => ({ status: "NOT_APPLICABLE" as const, reason });

const makeRollup = () => ({
  period: { periodId: "p1", label: "Term 3", academicYear: "2025/26" },
  enrolment: CAPTURED({ roll: 100, teachingStaff: 14, admissionsThisTerm: 18, intakeFemale: 8, intakeMale: 10 }),
  attendance: CAPTURED({ schoolRate: 94, totalMarked: 1200 }),
  performance: { basic: NA("Not a basic school."), senior: NC("No readiness data.") },
  terminalResults: { bece: NA("Not a basic school."), wassce: NA("Not a senior school.") },
});
const makeEnrolment = () => ({
  censusDate: "2026-06-15",
  roll: 100,
  gender: { female: 48, male: 52, total: 100 },
  byClass: [],
  byLevel: [],
  ageByLevel: [],
  approvedAge: [],
  dobUnknown: 0,
});
const makeStaff = () => ({
  teaching: { female: 6, male: 8, unknown: 0, total: 14 },
  nonTeaching: { female: 1, male: 2, unknown: 0, total: 3 },
  salaryStatus: { schoolPaid: 10, gesPaid: 3, allowance: 1, total: 14 },
});

const withCounts = (over: Partial<Record<SenCategory, SenSexCount>>) => {
  const byCategory = emptySenByCategory();
  for (const [k, v] of Object.entries(over)) byCategory[k as SenCategory] = v as SenSexCount;
  return byCategory;
};

beforeEach(() => {
  vi.clearAllMocks();
  getSchoolRollup.mockResolvedValue(makeRollup());
  getCensusEnrolment.mockResolvedValue(makeEnrolment());
  getCensusStaff.mockResolvedValue(makeStaff());
  getFacilitiesSnapshot.mockResolvedValue(null);
  getCensusSpecialNeeds.mockResolvedValue({ adopted: true, byCategory: emptySenByCategory(), total: 0 });
  withSchoolMock.mockResolvedValue([
    { schoolName: "Demo SHS", gesCode: "WR-WAW-014", schoolType: "SENIOR", ownership: "PUBLIC", yearFounded: "1991", district: "Wassa Amenfi", region: "Western" },
  ]);
});

const gen = (cadence: "MID_YEAR" | "ANNUAL") =>
  generateCensusSnapshot("s1", { cadence, censusDate: new Date("2026-06-15T00:00:00Z") });

type Arm = { coverage: string; reason?: string; data?: { adopted: boolean; byCategory: Record<SenCategory, SenSexCount>; total: number } };

describe("GOV10-08/10 · honest opt-in — not-adopted → NONE hand-fill, never a zeros payload", () => {
  it("ANNUAL + not adopted → coverage NONE with a hand-fill reason and NO data", async () => {
    getCensusSpecialNeeds.mockResolvedValue({ adopted: false, byCategory: emptySenByCategory(), total: 0 });
    const arm = (await gen("ANNUAL")).sections.specialNeeds as Arm;
    expect(arm.coverage).toBe("NONE");
    expect(arm.data).toBeUndefined();
    expect(arm.reason).toMatch(/hand-fill|not adopted|Enable the SEN register/i);
  });
});

describe("GOV10-09 · adopted + genuine zero → FULL with all 12 cells 0 (a captured zero is a truth)", () => {
  it("ANNUAL + adopted, zero records → coverage FULL, data present, every cell 0, total 0", async () => {
    const arm = (await gen("ANNUAL")).sections.specialNeeds as Arm;
    expect(arm.coverage).toBe("FULL");
    expect(arm.data).toBeDefined();
    expect(arm.data!.total).toBe(0);
    const cells = Object.values(arm.data!.byCategory).flatMap((c) => [c.male, c.female]);
    expect(cells).toHaveLength(12);
    expect(cells.every((n) => n === 0)).toBe(true);
  });
});

describe("GOV10-10 · adopted with counts → FULL carrying the de-id 12-cell grid", () => {
  it("ANNUAL + adopted, real counts → FULL with the category×sex splits and matching total", async () => {
    getCensusSpecialNeeds.mockResolvedValue({
      adopted: true,
      byCategory: withCounts({ VISUAL: { male: 2, female: 1 }, HEARING: { male: 0, female: 1 } }),
      total: 4,
    });
    const arm = (await gen("ANNUAL")).sections.specialNeeds as Arm;
    expect(arm.coverage).toBe("FULL");
    expect(arm.data!.byCategory.VISUAL).toEqual({ male: 2, female: 1 });
    expect(arm.data!.byCategory.HEARING).toEqual({ male: 0, female: 1 });
    expect(arm.data!.total).toBe(4);
  });
});

describe("GOV10-13 · cadence gate — MID_YEAR never reads the SEN DB, arm is a NONE stub", () => {
  it("MID_YEAR → coverage NONE (annual-field reason) AND getCensusSpecialNeeds is NOT called", async () => {
    const arm = (await gen("MID_YEAR")).sections.specialNeeds as Arm;
    expect(arm.coverage).toBe("NONE");
    expect(arm.reason).toMatch(/annual/i);
    expect(arm.data).toBeUndefined();
    expect(getCensusSpecialNeeds).not.toHaveBeenCalled();
  });
  it("ANNUAL DOES read the SEN aggregate exactly once", async () => {
    await gen("ANNUAL");
    expect(getCensusSpecialNeeds).toHaveBeenCalledTimes(1);
    expect(getCensusSpecialNeeds).toHaveBeenCalledWith("s1");
  });
});

describe("GOV10-14 · tier-agnostic — the §5 arm is NEVER NOT_APPLICABLE on tier grounds", () => {
  it("across not-adopted / adopted-zero / adopted-counts / mid-year, coverage is never NOT_APPLICABLE", async () => {
    const outcomes: string[] = [];
    getCensusSpecialNeeds.mockResolvedValue({ adopted: false, byCategory: emptySenByCategory(), total: 0 });
    outcomes.push(((await gen("ANNUAL")).sections.specialNeeds as Arm).coverage);
    getCensusSpecialNeeds.mockResolvedValue({ adopted: true, byCategory: emptySenByCategory(), total: 0 });
    outcomes.push(((await gen("ANNUAL")).sections.specialNeeds as Arm).coverage);
    getCensusSpecialNeeds.mockResolvedValue({ adopted: true, byCategory: withCounts({ SPEECH: { male: 1, female: 0 } }), total: 1 });
    outcomes.push(((await gen("ANNUAL")).sections.specialNeeds as Arm).coverage);
    outcomes.push(((await gen("MID_YEAR")).sections.specialNeeds as Arm).coverage);
    expect(outcomes).not.toContain("NOT_APPLICABLE");
    expect(new Set(outcomes)).toEqual(new Set(["NONE", "FULL"]));
  });
});
