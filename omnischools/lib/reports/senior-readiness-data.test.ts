import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VhmProgressRow } from "@/lib/score-ledger/vhm-progress";

/**
 * GOV-4 · getSeniorReadiness — the Senior-tier readiness SUMMARY the board rollup composes (R354/R356).
 *
 * It opens `withSchool`, loads the per-assignment progress, reduces it with the REAL (pure)
 * `rollupBySubject`, and returns FOUR completion counts and nothing else (§6.2 — no score, no blocker,
 * no name). `withSchool` is mocked to run its callback with a dummy tx (no DB) and `loadVhmProgress` is
 * mocked to feed canned rows; `rollupBySubject` stays real so the bucket→count mapping is exercised.
 */
vi.mock("@/lib/db/rls", () => ({
  withSchool: vi.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn({})),
}));
vi.mock("@/lib/score-ledger/vhm-progress", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/score-ledger/vhm-progress")>();
  return { ...actual, loadVhmProgress: vi.fn() };
});

import { loadVhmProgress } from "@/lib/score-ledger/vhm-progress";
import { getSeniorReadiness } from "./senior-readiness-data";

const row = (over: Partial<VhmProgressRow>): VhmProgressRow => ({
  classId: "c1",
  className: "Form 1",
  classLevel: "Form 1",
  classProgramme: null,
  subjectId: "s1",
  subjectName: "Subject",
  path: "AUTO_COMPILE",
  teacherUserId: "t1",
  teacherName: "T One",
  rosterSize: 10,
  filled: { asgn: 0, midSem: 0, endSem: 0, project: 0, portfolio: 0 },
  categoriesDone: 0,
  lastActivityAt: null,
  daysInactive: 3,
  status: "at_risk",
  flags: [],
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("getSeniorReadiness · completion counts only", () => {
  it("counts fully_ready / partial / at_risk subjects across the roll-up", async () => {
    vi.mocked(loadVhmProgress).mockResolvedValue([
      // Subject A — one teacher, all ready → fully_ready.
      row({ subjectId: "sA", subjectName: "Maths", teacherUserId: "tA", status: "ready" }),
      // Subject B — two teachers, one ready + one behind → partial.
      row({ subjectId: "sB", subjectName: "English", teacherUserId: "tB1", status: "ready" }),
      row({ subjectId: "sB", subjectName: "English", teacherUserId: "tB2", status: "behind" }),
      // Subject C — one teacher, at risk → at_risk.
      row({ subjectId: "sC", subjectName: "Science", teacherUserId: "tC", status: "at_risk" }),
    ]);
    const r = await getSeniorReadiness("school-1", { periodId: "p1" });
    expect(r).toEqual({
      subjectsTotal: 3,
      subjectsReady: 1,
      subjectsPartial: 1,
      subjectsAtRisk: 1,
    });
  });

  it("no assignments → all-zero counts (honest empty, never a fabricated readiness)", async () => {
    vi.mocked(loadVhmProgress).mockResolvedValue([]);
    expect(await getSeniorReadiness("school-1", { periodId: "p1" })).toEqual({
      subjectsTotal: 0,
      subjectsReady: 0,
      subjectsPartial: 0,
      subjectsAtRisk: 0,
    });
  });

  it("§6.2 · returns ONLY the four counts — no score, no blocker, no teacher name", async () => {
    vi.mocked(loadVhmProgress).mockResolvedValue([
      row({ subjectId: "sA", teacherUserId: "tA", status: "ready" }),
    ]);
    const r = await getSeniorReadiness("school-1", { periodId: "p1" });
    expect(Object.keys(r).sort()).toEqual([
      "subjectsAtRisk",
      "subjectsPartial",
      "subjectsReady",
      "subjectsTotal",
    ]);
    const asRecord = r as Record<string, unknown>;
    for (const k of ["blockers", "teacherName", "score", "subjects"]) {
      expect(asRecord).not.toHaveProperty(k);
    }
  });

  it("threads the given periodId through to loadVhmProgress", async () => {
    vi.mocked(loadVhmProgress).mockResolvedValue([]);
    await getSeniorReadiness("school-1", { periodId: "period-xyz" });
    expect(loadVhmProgress).toHaveBeenCalledTimes(1);
    const [, schoolId, periodId] = vi.mocked(loadVhmProgress).mock.calls[0];
    expect(schoolId).toBe("school-1");
    expect(periodId).toBe("period-xyz");
  });
});
