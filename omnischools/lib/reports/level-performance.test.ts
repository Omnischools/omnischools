import { describe, it, expect, vi } from "vitest";
import type { GradeBand } from "@/lib/gradebook/grade-scale";

/**
 * INS-12 / INS-30 · the performance-BY-YEAR-GROUP assembler. The per-score `AVG(total)` honesty lives
 * in the `GROUP BY classes.level` SQL of `getLevelPerformance`; this proves the PURE assembly over that
 * SQL aggregate: `classes.level IS NULL` → an `"Unspecified"` bucket, a level with active classes but no
 * graded scores renders a NULL average (never 0), pass-rate/grade/tone/delta, and the year-group ladder
 * sort. Mocks `@/lib/db/rls` (mirrors census-enrolment-data.test.ts) so the reader module loads with no DB.
 */
vi.mock("@/lib/db/rls", () => ({ withSchool: vi.fn() }));

const { assembleLevelPerformance, compareLevelLabel, UNSPECIFIED_LEVEL } = await import(
  "./class-performance-data"
);

const bands: GradeBand[] = [
  { grade: "A", label: null, minScore: 80 },
  { grade: "B", label: null, minScore: 70 },
  { grade: "C", label: null, minScore: 50 },
  { grade: "F", label: null, minScore: 0 },
];

describe("assembleLevelPerformance · GROUP BY level → aggregate rows", () => {
  // JHS 3 has active classes but NO graded scores (absent from `cur`) → null average, never 0.
  const classCounts = [
    { level: "JHS 1", classes: 2 },
    { level: "JHS 2", classes: 1 },
    { level: "JHS 3", classes: 1 },
    { level: null, classes: 1 }, // a null-level active class → the "Unspecified" bucket
  ];
  const cur = [
    { level: "JHS 1", avg: 55.04, passed: 6, graded: 12, students: 6, classesGraded: 2 },
    { level: "JHS 2", avg: 72.4, passed: 8, graded: 10, students: 5, classesGraded: 1 },
    { level: null, avg: 40.0, passed: 1, graded: 4, students: 2, classesGraded: 1 },
  ];
  const prior = [{ level: "JHS 1", avg: 50.0, passed: 4, graded: 12, students: 6, classesGraded: 2 }];

  const rows = assembleLevelPerformance(cur, prior, classCounts, bands);
  const byLevel = Object.fromEntries(rows.map((r) => [r.level, r]));

  it("emits one row per level in the ladder, Unspecified last", () => {
    expect(rows.map((r) => r.level)).toEqual(["JHS 1", "JHS 2", "JHS 3", UNSPECIFIED_LEVEL]);
  });

  it("null classes.level buckets under 'Unspecified' with its own aggregate", () => {
    const u = byLevel[UNSPECIFIED_LEVEL];
    expect(u.average).toBe(40);
    expect(u.passRate).toBe(25); // 1/4
    expect(u.grade).toBe("F");
    expect(u.classes).toBe(1);
  });

  it("a level with active classes but no graded scores is NULL, never 0 (INS-30)", () => {
    const j3 = byLevel["JHS 3"];
    expect(j3.average).toBeNull();
    expect(j3.passRate).toBeNull();
    expect(j3.grade).toBeNull();
    expect(j3.tone).toBe("none");
    expect(j3.studentsGraded).toBe(0);
    expect(j3.classesGraded).toBe(0);
    expect(j3.classes).toBe(1);
  });

  it("per-score average is rounded to 1dp; pass rate + grade + delta come from the aggregate", () => {
    const j1 = byLevel["JHS 1"];
    expect(j1.average).toBe(55); // round1(55.04)
    expect(j1.passRate).toBe(50); // 6/12
    expect(j1.grade).toBe("C");
    expect(j1.tone).toBe("gold");
    expect(j1.classesGraded).toBe(2);
    expect(j1.classes).toBe(2);
    expect(j1.delta).toBe(5); // 55 − 50 (prior)

    const j2 = byLevel["JHS 2"];
    expect(j2.average).toBe(72.4);
    expect(j2.grade).toBe("B");
    expect(j2.passRate).toBe(80); // 8/10
    expect(j2.delta).toBeNull(); // no prior term for JHS 2
  });
});

describe("compareLevelLabel · year-group ladder", () => {
  it("orders by the numeric year within the tier, Unspecified last", () => {
    const sorted = ["JHS 3", UNSPECIFIED_LEVEL, "JHS 1", "JHS 2"].sort(compareLevelLabel);
    expect(sorted).toEqual(["JHS 1", "JHS 2", "JHS 3", UNSPECIFIED_LEVEL]);
    expect(compareLevelLabel("Form 1", "Form 2")).toBeLessThan(0);
    expect(compareLevelLabel("Form 2", UNSPECIFIED_LEVEL)).toBeLessThan(0);
  });
});
