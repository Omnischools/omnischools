import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GOV-8 · the census generator composition (AC GOV8-02/07/08/09/12/13). Every reader is mocked, so this pins
 * the COMPOSITION contract: how each reader's status narrows into a frozen section arm. Honesty is frozen in —
 * a NOT_CAPTURED reader becomes a NONE section carrying its reason (never a fabricated 0); NO payroll rows →
 * salary NOT_APPLICABLE; the captured facilities row supersedes the surface's static "Manual"; a tier-N/A
 * terminal exam is dropped from the data while the sat exam's aggregate + sex split are carried.
 */

const getSchoolRollup = vi.fn();
const getCensusEnrolment = vi.fn();
const getCensusStaff = vi.fn();
const getFacilitiesSnapshot = vi.fn();
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
vi.mock("@/lib/db/rls", () => ({ withSchool: (...a: unknown[]) => withSchoolMock(...a) }));

const { generateCensusSnapshot } = await import("./generate");

const CAPTURED = <T>(data: T) => ({ status: "CAPTURED" as const, data });
const NC = (reason: string) => ({ status: "NOT_CAPTURED" as const, reason });
const NA = (reason: string) => ({ status: "NOT_APPLICABLE" as const, reason });

const makeRollup = (over: Record<string, unknown> = {}) => ({
  period: { periodId: "p1", label: "Term 1", academicYear: "2025/26" },
  enrolment: CAPTURED({
    roll: 100,
    teachingStaff: 14,
    studentTeacherRatio: 7,
    admissionsThisTerm: 18,
    intakeFemale: 8,
    intakeMale: 10,
  }),
  attendance: CAPTURED({ schoolRate: 94, totalMarked: 1200 }),
  performance: { basic: NA("Not a basic school."), senior: NC("No readiness data.") },
  terminalResults: { bece: CAPTURED({ year: 2025, totalCandidates: 33, passedCount: 30, passRate: 91, female: { candidates: 16, passed: 15 }, male: { candidates: 17, passed: 15 } }), wassce: NA("Not a senior school.") },
  ...over,
});

const makeEnrolment = (over: Record<string, unknown> = {}) => ({
  censusDate: "2026-03-15",
  roll: 100,
  gender: { female: 48, male: 52, total: 100 },
  byClass: [],
  byLevel: [],
  ageByLevel: [],
  approvedAge: [{ level: "JHS 1", officialAge: 12, under: 1, on: 1, over: 1, unknown: 0 }],
  dobUnknown: 0,
  ...over,
});

const makeStaff = (over: Record<string, unknown> = {}) => ({
  teaching: { female: 6, male: 8, unknown: 0, total: 14 },
  nonTeaching: { female: 1, male: 2, unknown: 0, total: 3 },
  salaryStatus: { schoolPaid: 10, gesPaid: 3, allowance: 1, total: 14 },
  ...over,
});

beforeEach(() => {
  getSchoolRollup.mockResolvedValue(makeRollup());
  getCensusEnrolment.mockResolvedValue(makeEnrolment());
  getCensusStaff.mockResolvedValue(makeStaff());
  getFacilitiesSnapshot.mockResolvedValue(null);
  withSchoolMock.mockResolvedValue([
    { schoolName: "Demo JHS", gesCode: "4-2305-018", schoolType: "BASIC", ownership: "PUBLIC", yearFounded: "1962", district: "Accra", region: "Greater Accra" },
  ]);
});

const gen = (over: Partial<{ cadence: "MID_YEAR" | "ANNUAL"; censusDate: Date }> = {}) =>
  generateCensusSnapshot("s1", { cadence: "MID_YEAR", censusDate: new Date("2026-03-15T00:00:00Z"), ...over });

describe("GOV8-02 · point-in-time freeze", () => {
  it("threads the frozen censusDate into getCensusEnrolment and stamps it on the snapshot", async () => {
    const snap = await gen();
    expect(getCensusEnrolment).toHaveBeenCalledWith("s1", { censusDate: new Date("2026-03-15T00:00:00Z") });
    expect(snap.censusDate).toBe("2026-03-15");
    expect(snap.academicYear).toBe("2025/26");
  });
});

describe("GOV8-07 · honest absence — NOT_CAPTURED → NONE, never a fabricated 0", () => {
  it("attendance carries the reader's reason, no number", async () => {
    getSchoolRollup.mockResolvedValue(makeRollup({ attendance: NC("No attendance marked for Term 1.") }));
    const snap = await gen();
    expect(snap.sections.attendance).toEqual({ coverage: "NONE", reason: "No attendance marked for Term 1." });
  });
  it("enrolment is NONE when the roll is 0 (not a captured zero)", async () => {
    getCensusEnrolment.mockResolvedValue(makeEnrolment({ roll: 0, gender: { female: 0, male: 0, total: 0 } }));
    const snap = await gen();
    expect(snap.sections.enrolment.coverage).toBe("NONE");
  });
});

describe("GOV8-08 · infrastructure AUTO-when-captured supersedes the surface's static Manual", () => {
  it("NONE with no snapshot; FULL carrying the raw row when captured", async () => {
    expect((await gen()).sections.infrastructure.coverage).toBe("NONE");
    getFacilitiesSnapshot.mockResolvedValue({ classroomsTotal: 20, classroomsGood: 18, catererName: "Akos" });
    const snap = await gen();
    expect(snap.sections.infrastructure.coverage).toBe("FULL");
    expect((snap.sections.infrastructure as { data: { catererName: string } }).data.catererName).toBe("Akos");
  });
});

describe("GOV8-09 · salary status NOT_APPLICABLE when no payroll rows", () => {
  it("total 0 comp rows → NOT_APPLICABLE (never a fabricated 0 split)", async () => {
    getCensusStaff.mockResolvedValue(makeStaff({ salaryStatus: { schoolPaid: 0, gesPaid: 0, allowance: 0, total: 0 } }));
    expect((await gen()).sections.salaryStatus.coverage).toBe("NOT_APPLICABLE");
  });
  it("≥1 comp row → FULL", async () => {
    expect((await gen()).sections.salaryStatus.coverage).toBe("FULL");
  });
});

describe("GOV8-12/13 · terminal results tier-gated, aggregate + sex split", () => {
  it("a basic school carries BECE (with the sex split) and drops the tier-N/A WASSCE", async () => {
    const snap = await gen();
    expect(snap.sections.terminalResults.coverage).toBe("FULL");
    const data = (snap.sections.terminalResults as { data: { bece?: unknown; wassce?: unknown } }).data;
    expect(data.wassce).toBeUndefined();
    expect(data.bece).toMatchObject({ passRate: 91, female: { candidates: 16, passed: 15 }, male: { candidates: 17 } });
  });
  it("no captured sitting but the exam is applicable → NONE (never blind Auto)", async () => {
    getSchoolRollup.mockResolvedValue(
      makeRollup({ terminalResults: { bece: NC("No BECE results captured yet."), wassce: NA("Not a senior school.") } }),
    );
    expect((await gen()).sections.terminalResults.coverage).toBe("NONE");
  });
});
