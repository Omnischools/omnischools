import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import type { AttendanceClassRow } from "@/lib/rollup/school-rollup";

/**
 * INS-14 / INS-22 / INS-23 · the Directors' Insights composition seam.
 *
 *  • the by-year-group attendance fold is a LOSSLESS integer sum (P/L/E/M/A + marked) with the rate
 *    RECOMPUTED as (ΣP+ΣL)/Σmarked — never a mean of class rates; Medical stays first-class;
 *  • the folded rows carry ONLY aggregate keys — no student name / id / code / DOB (the aggregate-only
 *    invariant, structurally);
 *  • the seam SOURCE never reaches `getAttendanceSummary` / its `needsAttention[]` PII, and never
 *    projects a student-identifying field — the one hard reuse trap (INS-22/23).
 *
 * Mocks `@/lib/db/rls` (mirrors census-enrolment-data.test.ts) so the server-only seam loads with no DB.
 */
vi.mock("@/lib/db/rls", () => ({ withSchool: vi.fn() }));

const { foldAttendanceByLevel, censusNudge } = await import("./insights-data");

const z = () => ({ present: 0, late: 0, excused: 0, medical: 0, absent: 0 });
const clsRow = (
  classId: string,
  name: string,
  counts: Partial<ReturnType<typeof z>>,
): AttendanceClassRow => {
  const c = { ...z(), ...counts };
  const marked = c.present + c.late + c.excused + c.medical + c.absent;
  return { classId, name, rate: null, marked, counts: c };
};

describe("foldAttendanceByLevel · lossless integer fold to year-group (INS-14)", () => {
  const byClass: AttendanceClassRow[] = [
    clsRow("c1", "JHS 1 A", { present: 80, late: 5, excused: 2, medical: 1, absent: 12 }),
    clsRow("c2", "JHS 1 B", { present: 40, late: 5, excused: 0, medical: 3, absent: 12 }),
    clsRow("c3", "JHS 2 A", { present: 90, late: 0, excused: 0, medical: 0, absent: 10 }),
    clsRow("c4", "No-level room", { present: 10, late: 0, excused: 0, medical: 0, absent: 10 }),
  ];
  const levelByClassId = new Map([
    ["c1", "JHS 1"],
    ["c2", "JHS 1"],
    ["c3", "JHS 2"],
    // c4 intentionally absent → folds under "Unspecified"
  ]);
  const rows = foldAttendanceByLevel(byClass, levelByClassId);
  const byLevel = Object.fromEntries(rows.map((r) => [r.level, r]));

  it("sums the five P/L/E/M/A counts per level (Medical never merged into Absent)", () => {
    const j1 = byLevel["JHS 1"];
    expect(j1.counts).toEqual({ present: 120, late: 10, excused: 2, medical: 4, absent: 24 });
    expect(j1.marked).toBe(160); // 100 + 60
  });

  it("recomputes rate = round((ΣP+ΣL)/Σmarked·100), NOT a mean of class rates", () => {
    // JHS 1 fold: (120 + 10) / 160 = 81.25 → 81. A mean of the two class rates (85, 75) would give
    // 80 — the fold's 81 proves it re-derives from summed counts, not by averaging rates.
    expect(byLevel["JHS 1"].rate).toBe(81);
    expect(byLevel["JHS 2"].rate).toBe(90); // 90/100
    expect(byLevel["Unspecified"].rate).toBe(50); // 10/20 → an unmapped class folds honestly
  });

  it("a class with no matching level folds under 'Unspecified'", () => {
    expect(byLevel["Unspecified"]).toBeTruthy();
    expect(byLevel["Unspecified"].marked).toBe(20);
  });

  it("empty marks → rate null (never 0)", () => {
    const [only] = foldAttendanceByLevel([clsRow("c9", "Empty", {})], new Map([["c9", "JHS 3"]]));
    expect(only.rate).toBeNull();
    expect(only.marked).toBe(0);
  });

  it("folded rows expose ONLY aggregate keys — no student name/id/code/DOB", () => {
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["counts", "level", "marked", "rate"]);
    }
  });
});

/* ── §17-D: the "GES annual census" attention row (Kofi's ruling) ── */

describe("censusNudge · GES annual census attention row (§17-D)", () => {
  // 2025/26 opens 2025-09-01; with a 42-day grace the NONE nudge starts on 2025-10-13.
  const started = [
    { academicYear: "2025/26", startsOn: "2025-09-01" },
    { academicYear: "2025/26", startsOn: "2026-01-06" },
  ];
  const WELL_AFTER = "2026-01-15"; // long past the grace window

  it("COMPLETED → no row (omit-not-fake; never a 'filed' row) [AC-1]", () => {
    expect(censusNudge({ academicYear: "2025/26", status: "COMPLETED" }, started, WELL_AFTER)).toBeNull();
  });

  it("NONE past the grace window → navy-2 'not started' row [AC-2]", () => {
    const n = censusNudge({ academicYear: "2025/26", status: "NONE" }, started, WELL_AFTER);
    expect(n).toEqual({
      dot: "navy-2",
      value: "Not started for 2025/26 — this year's return is not yet filed.",
    });
  });

  it("DRAFT once the year is underway → warn 'complete it' row [AC-3]", () => {
    const n = censusNudge({ academicYear: "2025/26", status: "DRAFT" }, started, WELL_AFTER);
    expect(n).toEqual({
      dot: "warn",
      value: "Draft saved for 2025/26 — review and complete it to file the return.",
    });
  });

  it("not-started year (all its terms start after today) → no premature row [AC-5]", () => {
    const future = [{ academicYear: "2026/27", startsOn: "2026-09-01" }];
    expect(censusNudge({ academicYear: "2026/27", status: "NONE" }, future, WELL_AFTER)).toBeNull();
    // …even a DRAFT waits until the year is underway.
    expect(censusNudge({ academicYear: "2026/27", status: "DRAFT" }, future, WELL_AFTER)).toBeNull();
  });

  it("no filing state (no academic year configured) → no row [AC-6]", () => {
    expect(censusNudge(null, started, WELL_AFTER)).toBeNull();
  });

  it("keys only on ANNUAL status + year — the value carries no PII, only the year string [AC-8]", () => {
    const n = censusNudge({ academicYear: "2025/26", status: "NONE" }, started, WELL_AFTER);
    expect(n?.value).toContain("2025/26");
    expect(n?.value).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no raw dates/DOB leaked
  });

  // ── the early-year grace window (OC-CENSUS-NUDGE-WINDOW: 6 weeks / 42 days from opening) ──
  it("NONE inside the grace window (day 41) → silent — a new year isn't yet late [grace]", () => {
    expect(censusNudge({ academicYear: "2025/26", status: "NONE" }, started, "2025-10-12")).toBeNull();
  });

  it("NONE on the day the grace elapses (day 42, 2025-10-13) → navy-2 fires [grace boundary]", () => {
    const n = censusNudge({ academicYear: "2025/26", status: "NONE" }, started, "2025-10-13");
    expect(n?.dot).toBe("navy-2");
  });

  it("DRAFT is grace-EXEMPT — fires from the moment the year is underway, inside the window [grace]", () => {
    const n = censusNudge({ academicYear: "2025/26", status: "DRAFT" }, started, "2025-09-15");
    expect(n?.dot).toBe("warn");
  });
});

/* ── INS-22/23: the seam source never touches student PII or getAttendanceSummary ── */

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const seam = stripComments(readFileSync(resolve(cwd(), "lib/insights/insights-data.ts"), "utf8"));
const page = stripComments(readFileSync(resolve(cwd(), "app/(app)/insights/page.tsx"), "utf8"));

describe("Directors' Insights source · aggregate-only, no PII trap (INS-22/23)", () => {
  it("the seam never imports/calls getAttendanceSummary or its needsAttention[] PII", () => {
    expect(seam).not.toMatch(/getAttendanceSummary/);
    expect(seam).not.toMatch(/needsAttention/);
  });

  it("neither the seam nor the page projects a student-identifying field", () => {
    for (const [name, src] of [
      ["seam", seam],
      ["page", page],
    ] as const) {
      expect(src, name).not.toMatch(/getAttendanceSummary/);
      expect(src, name).not.toMatch(/dateOfBirth/);
      expect(src, name).not.toMatch(/studentCode/);
      expect(src, name).not.toMatch(/\bstudentId\b/);
    }
  });
});
