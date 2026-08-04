import { describe, it, expect } from "vitest";
import { computeCensusView, CENSUS_ROWS } from "./view";
import type { CensusSnapshot, CensusSections, CensusArm } from "./schema";

/**
 * GOV-8 · the PURE census view (AC GOV8-07/08/10/11/15/17). The whole point: the Auto/Partial/Manual tags and
 * the "% auto-filled" are COMPUTED from live section coverage, never the surface's static demo literals
 * (GOV8-17). Cadence gates above coverage (GOV8-15). A NONE section is `Manual` carrying its reason, never a
 * fabricated 0 (GOV8-07).
 */

const NONE = (reason: string): CensusArm<never> => ({ coverage: "NONE", reason });
const FULL = <T>(data: T): CensusArm<T> => ({ coverage: "FULL", data });

// Minimal typed data for the MID-YEAR in-scope sections (only these have their meta computed in a mid-year run).
const baseSections = (): CensusSections => ({
  enrolment: FULL({
    censusDate: "2026-01-01",
    roll: 100,
    gender: { female: 48, male: 52, total: 100 },
    byClass: [{ classId: "c1", name: "JHS 1A", level: "JHS 1", female: 48, male: 52, total: 100 }],
    byLevel: [],
    ageByLevel: [],
    approvedAge: [],
    dobUnknown: 0,
  }),
  ageDistribution: FULL({ roll: 100, dobUnknown: 0, levelsWithAge: 3 }),
  ownership: FULL({ ownership: "Public" }),
  specialNeeds: NONE("SEN is hand-filled (annual)."),
  movement: FULL({ hasPeriod: true, admissionsThisPeriod: 18, intakeFemale: 8, intakeMale: 10 }),
  repetition: NONE("Repeaters are hand-filled (annual)."),
  teachingStaff: FULL({ female: 6, male: 8, unknown: 0, total: 14 }),
  ptr: FULL({ ratio: 7, teachingStaff: 14, roll: 100 }),
  qualifications: NONE("Trained/untrained hand-filled (annual)."),
  nonTeachingStaff: FULL({ female: 1, male: 2, unknown: 0, total: 3 }),
  salaryStatus: { coverage: "NOT_APPLICABLE", reason: "No payroll in Omnischools." },
  attendance: FULL({ schoolRate: 94, totalMarked: 1200 }),
  terminalResults: FULL({
    bece: { year: 2025, totalCandidates: 33, passedCount: 30, passRate: 91, female: { candidates: 16, passed: 15 }, male: { candidates: 17, passed: 15 } },
  }),
  academicPerformance: NONE("No performance recorded."),
  infrastructure: FULL({
    classroomsTotal: 20,
    classroomsGood: 18,
    classroomsRepair: 2,
    waterSource: "BOREHOLE",
    electricitySource: "GRID",
    latrinesBoys: 4,
    latrinesGirls: 6,
    latrinesStaff: 2,
    hasLibrary: true,
    hasIctLab: true,
    hasKitchen: true,
  } as never),
  feeding: NONE("GSFP hand-filled (annual)."),
  textbooks: NONE("Textbooks hand-filled (annual)."),
});

const snapshot = (sections: CensusSections, cadence: "MID_YEAR" | "ANNUAL" = "MID_YEAR"): CensusSnapshot => ({
  version: 1,
  cadence,
  academicYear: "2025/26",
  censusDate: "2026-01-01",
  generatedAt: "2026-01-01T00:00:00.000Z",
  period: { periodId: "p1", label: "Term 1", academicYear: "2025/26" },
  identification: {
    schoolName: "Demo JHS",
    gesCode: "4-2305-018",
    schoolType: "BASIC",
    district: "Accra",
    region: "Greater Accra",
    circuit: null,
    ownership: "Public",
    yearFounded: "1962",
  },
  sections,
});

const rowById = (view: ReturnType<typeof computeCensusView>, id: string) =>
  view.groups.flatMap((g) => g.rows).find((r) => r.id === id)!;

describe("computeCensusView · MID-YEAR cadence gating (GOV8-15)", () => {
  const view = computeCensusView(snapshot(baseSections()), "MID_YEAR");

  it("only the mid-year subset is in-scope; annual-only rows are greyed + excluded from %", () => {
    const midRows = CENSUS_ROWS.filter((d) => d.cadences.includes("MID_YEAR")).map((d) => d.id);
    for (const r of view.groups.flatMap((g) => g.rows)) {
      const isMid = midRows.includes(r.id);
      if (!isMid) {
        expect(r.cadenceGated, `${r.id} should be annual-gated in mid-year`).toBe(true);
        expect(r.tag).toBe("Annual");
        expect(r.inScope).toBe(false);
      }
    }
  });

  it("GOV8-08 · infrastructure is Annual (greyed) in mid-year even though its coverage is FULL", () => {
    const infra = rowById(view, "infrastructureClassrooms");
    expect(infra.tag).toBe("Annual");
    expect(infra.inScope).toBe(false);
  });
});

describe("computeCensusView · computed tags + %, not the surface demo literals (GOV8-17)", () => {
  it("every mid-year FULL section is Auto and 100% when all captured", () => {
    const view = computeCensusView(snapshot(baseSections()), "MID_YEAR");
    // The 8 mid-year rows are all FULL here → 100%. NOT the surface's static 71%.
    expect(view.fillPct).toBe(100);
    expect(view.needHand).toBe(0);
    expect(rowById(view, "enrolmentByClassGender").tag).toBe("Auto");
  });

  it("GOV8-07 · a NONE mid-year section drops the % and shows the reason, never a fabricated 0", () => {
    const s = baseSections();
    s.attendance = NONE("No attendance marked for Term 1.");
    const view = computeCensusView(snapshot(s), "MID_YEAR");
    const att = rowById(view, "attendanceRate");
    expect(att.tag).toBe("Manual");
    expect(att.meta).toBe("No attendance marked for Term 1.");
    expect(att.meta).not.toContain("0%");
    // 7 of 8 in-scope FULL → 88% (computed, not hard-coded).
    expect(view.fillPct).toBe(88);
    expect(view.needHand).toBe(1);
  });

  it("PARTIAL counts as needs-hand (not fractional) and tags Partial", () => {
    const s = baseSections();
    s.teachingStaff = {
      coverage: "PARTIAL",
      data: { female: 6, male: 6, unknown: 2, total: 14 },
      reason: "2 of 14 staff have no sex recorded.",
    };
    const view = computeCensusView(snapshot(s), "MID_YEAR");
    expect(rowById(view, "teachingStaff").tag).toBe("Partial");
    expect(view.needHand).toBe(1);
    expect(view.fillPct).toBe(88);
  });
});

describe("computeCensusView · ANNUAL activates the fuller set (GOV8-08/09/10)", () => {
  const view = computeCensusView(snapshot(baseSections(), "ANNUAL"), "ANNUAL");

  it("GOV8-08 · infrastructure is Auto when captured (supersedes the surface's static Manual)", () => {
    const infra = rowById(view, "infrastructureClassrooms");
    expect(infra.cadenceGated).toBe(false);
    expect(infra.tag).toBe("Auto");
    expect(infra.meta).toContain("18/20");
  });

  it("GOV8-09 · salary status is N/A (excluded from %), never a fabricated 0, when no payroll", () => {
    const salary = rowById(view, "salaryStatus");
    expect(salary.tag).toBe("N/A");
    expect(salary.inScope).toBe(false);
  });

  it("GOV8-10 · repetition stays Manual (hand) in an annual run", () => {
    const rep = rowById(view, "repetition");
    expect(rep.cadenceGated).toBe(false);
    expect(rep.tag).toBe("Manual");
  });

  it("GOV8-11 · movement is admissions-only for the period (Auto)", () => {
    const mv = rowById(view, "movementAdmissions");
    expect(mv.tag).toBe("Auto");
    expect(mv.meta).toContain("admissions");
    expect(mv.meta).not.toContain("withdrawals"); // mid-year/annual GOV-8 movement is admissions-only
  });
});
