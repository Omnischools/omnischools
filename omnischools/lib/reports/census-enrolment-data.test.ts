import { describe, it, expect, vi } from "vitest";

/**
 * GOV-8 · the census enrolment disaggregation (AC GOV8-02/03/04/05/06). The pure `aggregateCensusEnrolment`
 * is exercised with no DB: sex×level×class split, the per-level age histogram, the "approved age"
 * classification against the GES official-age constant, and — the honesty invariant — a NULL DOB that is
 * NEVER coerced to a real age (it lands in `dobUnknown` + the level's `unknown` bucket). Point-in-time is
 * proven by feeding the same students two `censusDate`s → different ages (GOV8-02).
 */

const withSchoolMock = vi.fn();
vi.mock("@/lib/db/rls", () => ({ withSchool: (...a: unknown[]) => withSchoolMock(...a) }));

const { aggregateCensusEnrolment, officialAgeForLevel, ageAsOf, getCensusEnrolment } = await import(
  "./census-enrolment-data"
);

const cls = (classId: string, name: string, level: string | null) => ({ classId, name, level });
const stu = (sex: "MALE" | "FEMALE", dateOfBirth: string | null, classId: string | null) => ({
  sex,
  dateOfBirth,
  classId,
});

describe("officialAgeForLevel · GES official starting age (KG1=4 … SHS3=17)", () => {
  it("maps each stage from its label", () => {
    expect(officialAgeForLevel("KG 1")).toBe(4);
    expect(officialAgeForLevel("KG 2")).toBe(5);
    expect(officialAgeForLevel("Primary 1")).toBe(6);
    expect(officialAgeForLevel("Basic 3")).toBe(8); // Basic n == Primary n
    expect(officialAgeForLevel("Primary 6")).toBe(11);
    expect(officialAgeForLevel("JHS 1")).toBe(12);
    expect(officialAgeForLevel("JHS 3")).toBe(14);
    expect(officialAgeForLevel("SHS 1")).toBe(15);
    expect(officialAgeForLevel("Form 3")).toBe(17);
  });
  it("returns null for pre-primary or an unparseable label (no approved-age reference)", () => {
    expect(officialAgeForLevel("Nursery 1")).toBeNull();
    expect(officialAgeForLevel("Creche")).toBeNull();
    expect(officialAgeForLevel(null)).toBeNull();
    expect(officialAgeForLevel("Unspecified")).toBeNull();
  });
});

describe("ageAsOf · whole years, null-safe (GOV8-05)", () => {
  it("returns null for a null DOB — never a fabricated age", () => {
    expect(ageAsOf(null, new Date("2026-01-01T00:00:00Z"))).toBeNull();
  });
  it("counts whole years, honouring the birthday boundary", () => {
    expect(ageAsOf("2014-06-15", new Date("2026-06-14T00:00:00Z"))).toBe(11); // day before → still 11
    expect(ageAsOf("2014-06-15", new Date("2026-06-15T00:00:00Z"))).toBe(12); // birthday → 12
  });
});

describe("aggregateCensusEnrolment · sex/level/class (GOV8-03/04)", () => {
  const classes = [cls("c1", "JHS 1A", "JHS 1"), cls("c2", "JHS 2A", "JHS 2")];
  const students = [
    stu("FEMALE", "2014-01-01", "c1"),
    stu("FEMALE", "2014-05-01", "c1"),
    stu("MALE", "2014-03-01", "c1"),
    stu("FEMALE", "2013-01-01", "c2"),
    stu("MALE", "2013-02-01", "c2"),
  ];
  const out = aggregateCensusEnrolment(students, classes, new Date("2026-02-01T00:00:00Z"));

  it("rolls up school-wide gender + roll", () => {
    expect(out.roll).toBe(5);
    expect(out.gender).toEqual({ female: 3, male: 2, total: 5 });
  });
  it("splits each class by sex", () => {
    const c1 = out.byClass.find((c) => c.classId === "c1")!;
    expect(c1).toMatchObject({ name: "JHS 1A", level: "JHS 1", female: 2, male: 1, total: 3 });
    const c2 = out.byClass.find((c) => c.classId === "c2")!;
    expect(c2).toMatchObject({ female: 1, male: 1, total: 2 });
  });
  it("aggregates by level", () => {
    expect(out.byLevel).toEqual([
      { level: "JHS 1", female: 2, male: 1, total: 3 },
      { level: "JHS 2", female: 1, male: 1, total: 2 },
    ]);
  });
});

describe("aggregateCensusEnrolment · approved age + null-DOB honesty (GOV8-05/06)", () => {
  const classes = [cls("c1", "JHS 1A", "JHS 1")]; // official age 12
  const students = [
    stu("MALE", "2014-01-01", "c1"), // age 12 at 2026-06 → ON
    stu("FEMALE", "2015-01-01", "c1"), // age 11 → UNDER
    stu("MALE", "2012-01-01", "c1"), // age 14 → OVER
    stu("FEMALE", null, "c1"), // no DOB → unknown, NEVER aged
  ];
  const out = aggregateCensusEnrolment(students, classes, new Date("2026-06-01T00:00:00Z"));

  it("classifies under/on/over vs the GES official age; null DOB → unknown", () => {
    const a = out.approvedAge.find((r) => r.level === "JHS 1")!;
    expect(a).toEqual({ level: "JHS 1", officialAge: 12, under: 1, on: 1, over: 1, unknown: 1 });
  });
  it("counts null DOB into dobUnknown and NEVER into an age bucket", () => {
    expect(out.dobUnknown).toBe(1);
    const age = out.ageByLevel.find((l) => l.level === "JHS 1")!;
    // Three known ages (11/12/14), the null-DOB student sits in dobUnknown, not a bucket.
    expect(age.byAge.reduce((n, b) => n + b.total, 0)).toBe(3);
    expect(age.dobUnknown).toBe(1);
    // No bucket was fabricated for the missing DOB (e.g. no age-0 row).
    expect(age.byAge.some((b) => b.age === 0)).toBe(false);
  });
});

describe("aggregateCensusEnrolment · point-in-time freeze (GOV8-02)", () => {
  const classes = [cls("c1", "JHS 1A", "JHS 1")];
  const students = [stu("MALE", "2014-06-15", "c1")];
  it("the same roll ages differently as-of different census dates", () => {
    const before = aggregateCensusEnrolment(students, classes, new Date("2026-06-14T00:00:00Z"));
    const after = aggregateCensusEnrolment(students, classes, new Date("2026-06-15T00:00:00Z"));
    expect(before.ageByLevel[0].byAge[0].age).toBe(11);
    expect(after.ageByLevel[0].byAge[0].age).toBe(12);
    expect(before.censusDate).toBe("2026-06-14");
    expect(after.censusDate).toBe("2026-06-15");
  });
});

describe("aggregateCensusEnrolment · honest totals for unassigned students", () => {
  it("an ACTIVE student with no matching class still counts in roll/gender + an Unassigned row", () => {
    const out = aggregateCensusEnrolment(
      [stu("MALE", "2014-01-01", "ghost"), stu("FEMALE", "2014-01-01", null)],
      [cls("c1", "JHS 1A", "JHS 1")],
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(out.roll).toBe(2); // neither is dropped
    const unassigned = out.byClass.find((c) => c.classId === "__unassigned__");
    expect(unassigned).toMatchObject({ name: "Unassigned", total: 2 });
    expect(out.byLevel.some((l) => l.level === "Unspecified")).toBe(true);
  });
});

describe("getCensusEnrolment · tenant seam (GOV8-16)", () => {
  it("reads under withSchool scoped to the passed schoolId", async () => {
    const thenable = () => Object.assign(Promise.resolve([]), { orderBy: () => Promise.resolve([]) });
    const tx = { select: () => ({ from: () => ({ where: thenable }) }) };
    withSchoolMock.mockImplementation((_id: string, fn: (t: unknown) => unknown) => fn(tx));
    await getCensusEnrolment("school-xyz", { censusDate: new Date("2026-01-01T00:00:00Z") });
    expect(withSchoolMock.mock.calls[0][0]).toBe("school-xyz");
  });
});
