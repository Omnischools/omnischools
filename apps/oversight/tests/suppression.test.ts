import { describe, expect, it } from "vitest";
import {
  SMALL_CELL_THRESHOLD,
  applySexedStaffSuppression,
  sexedStaffDisclosureDecision,
  suppressionCaveat,
} from "@/lib/oversight/suppression";

describe("small-cell suppression for sexed school-grain staff facts", () => {
  it("publishes both sexes when both denominators are at or above the threshold", () => {
    const d = sexedStaffDisclosureDecision({ MALE: 12, FEMALE: 9, ALL: 21 });
    expect([...d.publish].sort()).toEqual(["ALL", "FEMALE", "MALE"]);
    expect(d.suppressed.size).toBe(0);
    expect(suppressionCaveat(d)).toBeNull();
  });

  it("suppresses BOTH sexes when either is below the threshold — complementary suppression", () => {
    const d = sexedStaffDisclosureDecision({ MALE: 22, FEMALE: 2, ALL: 24 });
    expect([...d.publish]).toEqual(["ALL"]);
    expect([...d.suppressed].sort()).toEqual(["FEMALE", "MALE"]);
    // The male cell is large; it is suppressed anyway, because ALL − MALE discloses FEMALE.
    expect(d.cause.MALE).toBe("COMPLEMENT_BELOW_THRESHOLD");
    expect(d.cause.FEMALE).toBe("BELOW_THRESHOLD");
  });

  it("treats exactly the threshold as publishable and one below as not", () => {
    expect(
      sexedStaffDisclosureDecision({
        MALE: SMALL_CELL_THRESHOLD,
        FEMALE: SMALL_CELL_THRESHOLD,
        ALL: 10,
      }).suppressed.size,
    ).toBe(0);
    expect(
      sexedStaffDisclosureDecision({
        MALE: SMALL_CELL_THRESHOLD,
        FEMALE: SMALL_CELL_THRESHOLD - 1,
        ALL: 9,
      }).suppressed.size,
    ).toBe(2);
  });

  it("treats a NULL denominator as below the threshold (fail closed)", () => {
    const d = sexedStaffDisclosureDecision({ MALE: 40, FEMALE: null, ALL: 40 });
    expect([...d.publish]).toEqual(["ALL"]);
    expect(d.cause.FEMALE).toBe("DENOMINATOR_UNKNOWN");
  });

  it("reports allBelowThreshold without acting on it (the ALL rule is an open owner question)", () => {
    const d = sexedStaffDisclosureDecision({ MALE: 2, FEMALE: 1, ALL: 3 });
    expect(d.allBelowThreshold).toBe(true);
    expect(d.publish.has("ALL")).toBe(true);
  });
});

describe("the two staff-fact tables are ONE disclosure surface", () => {
  const denominators = { MALE: 30, FEMALE: 3, ALL: 33 };
  const decision = sexedStaffDisclosureDecision(denominators);

  const attendanceRows = [
    { sex: "ALL" as const, absentTeacherDays: 40, expectedTeacherDays: 900 },
    { sex: "MALE" as const, absentTeacherDays: 36, expectedTeacherDays: 820 },
    { sex: "FEMALE" as const, absentTeacherDays: 4, expectedTeacherDays: 80 },
  ];
  const plcRows = [
    { sex: "ALL" as const, teachersInPlc: 28, teacherHeadcount: 33 },
    { sex: "MALE" as const, teachersInPlc: 26, teacherHeadcount: 30 },
    { sex: "FEMALE" as const, teachersInPlc: 2, teacherHeadcount: 3 },
  ];

  it("suppresses the same cells on fact_teacher_attendance and fact_plc_participation", () => {
    const a = applySexedStaffSuppression(attendanceRows, decision);
    const p = applySexedStaffSuppression(plcRows, decision);
    const suppressedIn = (rows: { sex: string; suppressed: boolean }[]) =>
      rows
        .filter((r) => r.suppressed)
        .map((r) => r.sex)
        .sort();
    expect(suppressedIn(a)).toEqual(["FEMALE", "MALE"]);
    expect(suppressedIn(p)).toEqual(suppressedIn(a));
  });

  it("keeps the row (so the UI cannot read absence as zero) and nulls every measure", () => {
    const [all, male, female] = applySexedStaffSuppression(attendanceRows, decision);
    expect(all!.suppressed).toBe(false);
    expect(all!.absentTeacherDays).toBe(40);
    expect(male!.sex).toBe("MALE");
    expect(male!.absentTeacherDays).toBeNull();
    expect(male!.expectedTeacherDays).toBeNull();
    expect(female!.absentTeacherDays).toBeNull();
  });

  it("suppresses a measure added later, because the default is suppress-everything", () => {
    const rows = [{ sex: "FEMALE" as const, aNewMeasureNobodyRemembered: 3 }];
    const [row] = applySexedStaffSuppression(rows, decision);
    expect(row!.aNewMeasureNobodyRemembered).toBeNull();
  });

  it("offers caveat copy that explains the complement rule rather than apologising", () => {
    expect(suppressionCaveat(decision)).toMatch(/fewer than 5/);
    expect(suppressionCaveat(decision)).toMatch(/disclose the other/);
  });
});
