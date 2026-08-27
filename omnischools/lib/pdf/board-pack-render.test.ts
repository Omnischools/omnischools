import { describe, it, expect } from "vitest";
import { renderBoardPackPdf } from "./render-board-pack";
import type { BoardPackData } from "./board-pack-document";

/**
 * #309 render smoke — the four director drill-down sections (attention, year-group performance,
 * attendance-by-level, census age/gender/approved-age) must actually RENDER, not just typecheck. A
 * tsc-clean @react-pdf tree can still throw at renderToBuffer (a bad style value, an undefined access),
 * so this feeds a realistic pack through the real renderer and asserts a valid PDF comes out. The rollup
 * arms are all NOT_CAPTURED (reason panels) — the point is to exercise the NEW sections end to end.
 */

const uncaptured = { status: "NOT_CAPTURED", reason: "Nothing captured yet." } as const;
const notApplicable = { status: "NOT_APPLICABLE", reason: "Not applicable." } as const;

const data: BoardPackData = {
  rollup: {
    schoolId: "s1",
    period: null,
    generatedAt: new Date(0),
    enrolment: uncaptured,
    attendance: uncaptured,
    feeCollections: uncaptured,
    netPositionFinance: uncaptured,
    performance: { basic: uncaptured, senior: notApplicable },
    terminalResults: { bece: uncaptured, wassce: notApplicable },
    infrastructure: uncaptured,
    terms: [],
  },
  attention: [
    { key: "fees", href: "/billing", dot: "terra", label: "Outstanding fees", value: "GHS 5,000 outstanding · 40% collected" },
    { key: "census", href: "/reports/census", dot: "navy-2", label: "GES annual census", value: "Not started for 2025/26." },
  ],
  levelPerf: {
    terms: [],
    term: null,
    priorTerm: null,
    hasAnyScores: true,
    rows: [
      {
        level: "JHS 1",
        average: 72.5,
        grade: "B",
        tone: "green",
        passRate: 80,
        studentsGraded: 120,
        classesGraded: 2,
        classes: 2,
        priorAverage: null,
        delta: null,
      },
    ],
  },
  attendanceByLevel: [
    { level: "JHS 1", rate: 81, marked: 160, counts: { present: 120, late: 10, excused: 2, medical: 4, absent: 24 } },
    { level: "JHS 2", rate: null, marked: 0, counts: { present: 0, late: 0, excused: 0, medical: 0, absent: 0 } },
  ],
  census: {
    censusDate: "2026-01-15",
    roll: 250,
    gender: { female: 130, male: 120, total: 250 },
    byClass: [],
    byLevel: [],
    ageByLevel: [],
    approvedAge: [{ level: "JHS 1", officialAge: 12, under: 5, on: 100, over: 15, unknown: 0 }],
    dobUnknown: 3,
  },
  meta: {
    schoolName: "Test Memorial SHS",
    schoolInitials: "TM",
    termLabel: "Term 2 · 2025/26",
    generatedAtLabel: "15 Jan 2026 · 09:00",
  },
};

describe("#309 · the enriched board pack renders to a valid PDF", () => {
  it("produces a non-trivial %PDF buffer with the director sections included", async () => {
    const pdf = await renderBoardPackPdf(data);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500); // a real multi-section document, not an empty page
  });
});
