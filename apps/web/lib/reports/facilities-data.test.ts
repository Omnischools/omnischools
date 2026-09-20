import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GOV-7 · facilities reader + pure derive (AC GOV7-06/07/08/12/15). `withSchool` is mocked to return canned
 * joined rows so the flatten + latest-term selection and the derived pctGood / latrinesTotal math are
 * exercised without a DB. Tenant isolation (GOV7 · RLS) is proven at the app-layer: the reader opens
 * `withSchool` scoped to the passed schoolId (the FORCE-RLS `tenant_isolation` policy is the real boundary,
 * applied on dev + prod-paste-0086).
 */

import type { FacilitiesSnapshotRow } from "./facilities-data";

const withSchoolMock = vi.fn();
vi.mock("@/lib/db/rls", () => ({ withSchool: (...a: unknown[]) => withSchoolMock(...a) }));

const { getFacilitiesSnapshot, deriveInfrastructureSummary, listFacilitiesSnapshots } = await import(
  "./facilities-data"
);

beforeEach(() => withSchoolMock.mockReset());

// A raw snapshot row (all columns), plus a joined-row wrapper matching the reader's select shape.
const rawRow = (over: Partial<FacilitiesSnapshotRow> = {}): FacilitiesSnapshotRow =>
  ({
    id: "f1",
    schoolId: "s1",
    periodId: "p1",
    classroomsTotal: 20,
    classroomsGood: 15,
    classroomsRepair: 5,
    waterSource: "BOREHOLE",
    electricitySource: "GRID",
    latrinesBoys: 4,
    latrinesGirls: 6,
    latrinesStaff: 2,
    latrineType: "KVIP",
    handwashing: true,
    hasLibrary: true,
    hasIctLab: true,
    internet: true,
    hasKitchen: true,
    gsfpParticipating: true,
    libraryBookCount: 1200,
    libraryStaffFte: "1.5",
    computersTotal: 30,
    computersWorking: 24,
    internetType: "Fibre",
    mealsServedLastTerm: 5000,
    pupilsFedDailyAvg: 300,
    catererName: "Auntie Akos",
    textbookAvailability: "ADEQUATE",
    studentDesksUsable: 200,
    studentDesksBroken: 10,
    teacherDesks: 20,
    chalkboards: 20,
    whiteboards: 5,
    projectors: 2,
    note: null,
    capturedAt: new Date("2026-01-15T10:00:00.000Z"),
    capturedBy: "u1",
    periodLabel: "Term 1",
    academicYear: "2025/26",
    ...over,
  }) as FacilitiesSnapshotRow;

// The reader selects `{ snapshot, periodLabel, academicYear }`, then flattens.
const joined = (over: Partial<FacilitiesSnapshotRow> = {}) => {
  const { periodLabel, academicYear, ...snapshot } = rawRow(over);
  return { snapshot, periodLabel, academicYear };
};

describe("deriveInfrastructureSummary · pure board projection (GOV7-06/07/08)", () => {
  it("GOV7-07 · derives pctGood (good ÷ total) and latrinesTotal (boys+girls+staff)", () => {
    const d = deriveInfrastructureSummary(rawRow());
    expect(d.classrooms).toEqual({ total: 20, good: 15, needingRepair: 5, pctGood: 75 });
    expect(d.utilities.latrinesTotal).toBe(12);
  });

  it("GOV7-07 · pctGood is null (never 0) when there are no classrooms", () => {
    const d = deriveInfrastructureSummary(rawRow({ classroomsTotal: 0, classroomsGood: 0, classroomsRepair: 0 }));
    expect(d.classrooms.pctGood).toBeNull();
  });

  // GOV7-06/08 · THE COMPILE-FENCE. The census-only fields are STRUCTURALLY absent from the projection: each
  // read below is a type error today, so `@ts-expect-error` is required. Spreading one onto InfrastructureSummary
  // (the mutation) would make the type grow the field → the directive becomes UNUSED → `tsc` REDS the build.
  it("GOV7-06/08 · census-only fields are compile-fenced off InfrastructureSummary (+ runtime absence)", () => {
    const d = deriveInfrastructureSummary(rawRow());
    // @ts-expect-error catererName is census-only — not on InfrastructureSummary
    void d.catererName;
    // @ts-expect-error libraryStaffFte is census-only — not on the library projection
    void d.library.staffFte;
    // @ts-expect-error furniture (desks/boards/projectors) is census-only — no such field
    void d.furniture;
    // @ts-expect-error the per-sex latrine split is census-only — the board carries only the total
    void d.utilities.latrinesBoys;
    // Runtime backstop (vitest doesn't typecheck): the projection really carries none of them.
    const flat = JSON.stringify(d);
    for (const banned of ["catererName", "staffFte", "latrinesBoys", "teacherDesks", "chalkboards"]) {
      expect(flat).not.toContain(banned);
    }
  });

  it("carries the term label/year + capturedAt inside the summary (not the live clock)", () => {
    const d = deriveInfrastructureSummary(rawRow());
    expect(d.capturedFor).toEqual({ periodLabel: "Term 1", academicYear: "2025/26" });
    expect(d.capturedAt).toEqual(new Date("2026-01-15T10:00:00.000Z"));
  });
});

describe("getFacilitiesSnapshot · latest vs specific term", () => {
  it("no periodId → returns the flattened LATEST snapshot (label/year joined onto the row)", async () => {
    withSchoolMock.mockResolvedValue([joined()]);
    const row = await getFacilitiesSnapshot("s1");
    expect(row?.periodLabel).toBe("Term 1");
    expect(row?.academicYear).toBe("2025/26");
    expect(row?.classroomsTotal).toBe(20);
  });

  it("returns null when the school has captured no snapshot", async () => {
    withSchoolMock.mockResolvedValue([]);
    expect(await getFacilitiesSnapshot("s1")).toBeNull();
  });

  // GOV7-15 — the census feed (a periodId) returns THAT term's RAW row, all columns incl. census-only detail.
  it("GOV7-15 · a periodId returns that term's RAW row (catererName + furniture present, for the census)", async () => {
    withSchoolMock.mockResolvedValue([joined({ periodId: "p2" })]);
    const row = await getFacilitiesSnapshot("s1", { periodId: "p2" });
    expect(row?.catererName).toBe("Auntie Akos");
    expect(row?.teacherDesks).toBe(20);
    expect(row?.libraryStaffFte).toBe("1.5");
  });

  it("reads under withSchool scoped to the passed schoolId (tenant isolation seam)", async () => {
    withSchoolMock.mockResolvedValue([]);
    await getFacilitiesSnapshot("school-xyz");
    expect(withSchoolMock).toHaveBeenCalledTimes(1);
    expect(withSchoolMock.mock.calls[0][0]).toBe("school-xyz");
  });
});

describe("listFacilitiesSnapshots · management list", () => {
  it("derives each row's summary and carries its periodId", async () => {
    withSchoolMock.mockResolvedValue([joined({ periodId: "p1" }), joined({ periodId: "p2" })]);
    const out = await listFacilitiesSnapshots("s1");
    expect(out).toHaveLength(2);
    expect(out[0].periodId).toBe("p1");
    expect(out[0].classrooms.pctGood).toBe(75);
    // The list uses the SAME board projection — census-only fields never leak onto it either.
    expect(JSON.stringify(out)).not.toContain("catererName");
  });
});
