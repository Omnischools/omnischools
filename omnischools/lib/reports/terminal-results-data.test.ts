import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GOV-6 · terminal-results reader + pure derive (AC GOV6-02/03/04/11/13/18). `withSchool` is mocked to
 * return canned rows so the in-memory LATEST-year-per-exam selection and the derived-from-leaves math are
 * exercised without a DB. GOV6-18 (tenant isolation) is proven at the app-layer: the reader opens
 * `withSchool` scoped to the passed schoolId (the FORCE-RLS `tenant_isolation` policy is the real
 * boundary, applied on dev + prod-paste-0085).
 */

const withSchoolMock = vi.fn();
vi.mock("@/lib/db/rls", () => ({ withSchool: (...a: unknown[]) => withSchoolMock(...a) }));

const { getTerminalResults, listTerminalResults, deriveTerminalSummary } = await import(
  "./terminal-results-data"
);

beforeEach(() => withSchoolMock.mockReset());

describe("deriveTerminalSummary · derived-from-leaves (never stored)", () => {
  it("GOV6-02/04 · sums the sex-split leaves and rounds the pass rate", () => {
    expect(
      deriveTerminalSummary({
        year: 2025,
        femaleCandidates: 58,
        maleCandidates: 62,
        femalePassed: 51,
        malePassed: 49,
      }),
    ).toEqual({
      year: 2025,
      totalCandidates: 120,
      passedCount: 100,
      passRate: 83, // round(100 / 120 * 100)
      female: { candidates: 58, passed: 51 },
      male: { candidates: 62, passed: 49 },
    });
  });

  it("GOV6-11 · an all-fail sitting is 0% (never NaN)", () => {
    const d = deriveTerminalSummary({
      year: 2024,
      femaleCandidates: 10,
      maleCandidates: 10,
      femalePassed: 0,
      malePassed: 0,
    });
    expect(d.passedCount).toBe(0);
    expect(d.passRate).toBe(0);
  });

  it("GOV6-03 · passed is ENTERED, never thresholded (all pass → 100%)", () => {
    const d = deriveTerminalSummary({
      year: 2024,
      femaleCandidates: 5,
      maleCandidates: 5,
      femalePassed: 5,
      malePassed: 5,
    });
    expect(d.passRate).toBe(100);
  });
});

describe("getTerminalResults · latest-year per exam type", () => {
  const row = (over: Record<string, unknown>) => ({
    examType: "BECE",
    year: 2025,
    femaleCandidates: 1,
    maleCandidates: 1,
    femalePassed: 1,
    malePassed: 1,
    ...over,
  });

  it("GOV6-13 · picks the LATEST year per exam type (order-independent)", async () => {
    withSchoolMock.mockResolvedValue([
      row({ examType: "BECE", year: 2023 }),
      row({ examType: "BECE", year: 2025 }), // latest BECE
      row({ examType: "BECE", year: 2024 }),
      row({ examType: "WASSCE", year: 2022 }),
      row({ examType: "WASSCE", year: 2024 }), // latest WASSCE
    ]);
    const out = await getTerminalResults("s1");
    expect(out.bece?.year).toBe(2025);
    expect(out.wassce?.year).toBe(2024);
  });

  it("returns an absent key when an exam type has no rows", async () => {
    withSchoolMock.mockResolvedValue([row({ examType: "BECE", year: 2025 })]);
    const out = await getTerminalResults("s1");
    expect(out.bece?.year).toBe(2025);
    expect(out.wassce).toBeUndefined();
  });

  it("GOV6-18 · reads under withSchool scoped to the passed schoolId (tenant isolation seam)", async () => {
    withSchoolMock.mockResolvedValue([]);
    await getTerminalResults("school-xyz");
    expect(withSchoolMock).toHaveBeenCalledTimes(1);
    expect(withSchoolMock.mock.calls[0][0]).toBe("school-xyz");
  });
});

describe("listTerminalResults · management list", () => {
  it("derives each row, sorts newest-first, drops unknown exam types", async () => {
    withSchoolMock.mockResolvedValue([
      {
        examType: "WASSCE",
        year: 2024,
        femaleCandidates: 44,
        maleCandidates: 40,
        femalePassed: 39,
        malePassed: 35,
        note: null,
      },
      {
        examType: "BECE",
        year: 2025,
        femaleCandidates: 58,
        maleCandidates: 62,
        femalePassed: 51,
        malePassed: 49,
        note: "Main sitting",
      },
      { examType: "JUNK", year: 2099, femaleCandidates: 1, maleCandidates: 1, femalePassed: 1, malePassed: 1, note: null },
    ]);
    const out = await listTerminalResults("s1");
    expect(out.map((r) => [r.examType, r.year])).toEqual([
      ["BECE", 2025],
      ["WASSCE", 2024],
    ]);
    expect(out[0].passRate).toBe(83);
    expect(out[0].note).toBe("Main sitting");
  });
});
