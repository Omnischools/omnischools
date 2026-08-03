import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import type { AcademicTerm } from "@/lib/reports/academic-term";
import { listAcademicTerms } from "@/lib/reports/academic-term";
import { getSchoolStats } from "@/lib/reports/school-stats-data";
import { getEnrolmentRoll } from "@/lib/reports/enrolment-roll-data";
import { getAttendanceSummary } from "@/lib/reports/attendance-summary-data";
import { getFinanceReport } from "@/lib/reports/finance-data";
import { getSchoolRollup } from "./school-rollup";

/**
 * GOV-1 · shared school-rollup aggregate seam — AC GOV1-*. This is a PURE COMPOSITION seam, so the
 * right test is to mock the four shipped source functions and assert the mapping/tagging: faithful
 * re-exposure (ENR/ATT/FEE), the netChange-from-enrolment-roll choice (ENR-2), the honesty
 * convention (HON-1 real-zero CAPTURED, HON-2..4 not-captured reasons, HON-5 no `.data` on
 * non-captured, HON-6 never NOT_APPLICABLE), period selection (PER), no PII leak onto the
 * attendance arm (ATT-2), and the structural purity guards (SRV-1, TEN-2/PUR-1).
 *
 * `resolveSelectedTerm` is kept REAL (importOriginal) so PER exercises the true selection logic;
 * only `listAcademicTerms` and the four data functions are mocked.
 */

vi.mock("@/lib/reports/academic-term", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reports/academic-term")>();
  return { ...actual, listAcademicTerms: vi.fn() };
});
vi.mock("@/lib/reports/school-stats-data", () => ({ getSchoolStats: vi.fn() }));
vi.mock("@/lib/reports/enrolment-roll-data", () => ({ getEnrolmentRoll: vi.fn() }));
vi.mock("@/lib/reports/attendance-summary-data", () => ({ getAttendanceSummary: vi.fn() }));
vi.mock("@/lib/reports/finance-data", () => ({ getFinanceReport: vi.fn() }));

const term = (over: Partial<AcademicTerm> = {}): AcademicTerm => ({
  periodId: "p1",
  academicYear: "2025/26",
  periodNumber: 1,
  label: "Term 1",
  startsOn: "2025-09-01",
  endsOn: "2025-12-19",
  closed: false,
  ...over,
});

// Source-shaped stubs — only the fields the seam reads, cast loosely (the real shapes are wider).
const statsStub = (over: Record<string, unknown> = {}) =>
  ({
    totalStudents: 100,
    gender: { female: 48, male: 52, total: 100, femalePct: 48, malePct: 52 },
    activeClasses: 6,
    avgClassSize: 17,
    teachingStaff: 8,
    studentTeacherRatio: 13,
    levelSummary: "JHS 1 · JHS 2 · JHS 3",
    byClass: [{ classId: "c1", name: "JHS 1", enrolled: 20, femaleCount: 9, maleCount: 11 }],
    enrolmentFlow: { newAdmissions: 5, withdrew: 3, transferred: 2, graduated: 1, netChange: 999 },
    ...over,
  }) as unknown as Awaited<ReturnType<typeof getSchoolStats>>;

const rollStub = (over: Record<string, unknown> = {}) =>
  ({
    admissionsThisTerm: 12,
    intakeFemale: 7,
    intakeMale: 5,
    netChange: 12,
    withdrew: 3,
    transferred: 2,
    graduated: 1,
    lifetimeExits: 6,
    ...over,
  }) as unknown as Awaited<ReturnType<typeof getEnrolmentRoll>>;

const attendanceStub = (over: Record<string, unknown> = {}) =>
  ({
    schoolRate: 93,
    schoolDelta: 2,
    totalMarked: 400,
    statusTotals: { present: 360, late: 10, excused: 15, medical: 5, absent: 10 },
    byClass: [
      {
        classId: "c1",
        name: "JHS 1",
        teacherName: "Ama Owusu", // PII — must be stripped
        rate: 93,
        tone: "good",
        priorRate: 91,
        delta: 2,
        marked: 200,
        counts: { present: 180, late: 5, excused: 8, medical: 2, absent: 5 },
      },
    ],
    needsAttention: [{ studentId: "s1", name: "Kojo" }], // PII — must be stripped
    criticalCount: 1,
    watchCount: 2,
    perfectCount: 3,
    thresholds: { pctWatch: 90, pctCritical: 80, absWatch: 3, absCritical: 5 },
    ...over,
  }) as unknown as Awaited<ReturnType<typeof getAttendanceSummary>>;

const financeStub = (over: Record<string, unknown> = {}) =>
  ({
    totals: { invoiceCount: 50 },
    billed: 50000,
    collected: 42000,
    outstanding: 8000,
    rate: 84,
    ...over,
  }) as unknown as Awaited<ReturnType<typeof getFinanceReport>>;

beforeEach(() => {
  vi.clearAllMocks(); // reset call history + implementations between cases
  vi.mocked(listAcademicTerms).mockResolvedValue([term()]);
  vi.mocked(getSchoolStats).mockResolvedValue(statsStub());
  vi.mocked(getEnrolmentRoll).mockResolvedValue(rollStub());
  vi.mocked(getAttendanceSummary).mockResolvedValue(attendanceStub());
  vi.mocked(getFinanceReport).mockResolvedValue(financeStub());
});

// ── GOV1-ENR · enrolment arm faithful re-exposure ─────────────────────────────────────────────────
describe("GOV1-ENR · enrolment arm", () => {
  it("CAPTURED; re-exposes point-in-time from stats + term-windowed from enrolment-roll", async () => {
    const r = await getSchoolRollup("school-1");
    expect(r.enrolment.status).toBe("CAPTURED");
    if (r.enrolment.status !== "CAPTURED") throw new Error("unreachable");
    const d = r.enrolment.data;
    expect(d.roll).toBe(100);
    expect(d.gender).toEqual({ female: 48, male: 52, total: 100, femalePct: 48, malePct: 52 });
    expect(d.activeClasses).toBe(6);
    expect(d.avgClassSize).toBe(17);
    expect(d.teachingStaff).toBe(8);
    expect(d.studentTeacherRatio).toBe(13);
    expect(d.levelSummary).toBe("JHS 1 · JHS 2 · JHS 3");
    expect(d.byClass).toEqual([
      { classId: "c1", name: "JHS 1", enrolled: 20, femaleCount: 9, maleCount: 11 },
    ]);
    expect(d.admissionsThisTerm).toBe(12);
    expect(d.intakeFemale).toBe(7);
    expect(d.intakeMale).toBe(5);
    // Lifetime exits (cumulative) come from stats; lifetimeExits = sum of the three.
    expect(d.withdrew).toBe(3);
    expect(d.transferred).toBe(2);
    expect(d.graduated).toBe(1);
    expect(d.lifetimeExits).toBe(6);
  });

  // GOV1-ENR-2 — netChange MUST be the enrolment-roll value, NOT stats.enrolmentFlow.netChange.
  it("GOV1-ENR-2 · netChange is enrolment-roll's, not stats' mixed-scope value", async () => {
    vi.mocked(getEnrolmentRoll).mockResolvedValue(rollStub({ netChange: 7 }));
    vi.mocked(getSchoolStats).mockResolvedValue(
      statsStub({ enrolmentFlow: { withdrew: 3, transferred: 2, graduated: 1, netChange: 999 } }),
    );
    const r = await getSchoolRollup("school-1");
    if (r.enrolment.status !== "CAPTURED") throw new Error("expected CAPTURED");
    expect(r.enrolment.data.netChange).toBe(7);
    expect(r.enrolment.data.netChange).not.toBe(999);
  });
});

// ── GOV1-ATT · attendance arm + PII fence ─────────────────────────────────────────────────────────
describe("GOV1-ATT · attendance arm", () => {
  it("CAPTURED; re-exposes aggregates (schoolRate/delta/statusTotals/byClass)", async () => {
    const r = await getSchoolRollup("school-1");
    expect(r.attendance.status).toBe("CAPTURED");
    if (r.attendance.status !== "CAPTURED") throw new Error("unreachable");
    const d = r.attendance.data;
    expect(d.schoolRate).toBe(93);
    expect(d.schoolDelta).toBe(2);
    expect(d.totalMarked).toBe(400);
    expect(d.statusTotals).toEqual({ present: 360, late: 10, excused: 15, medical: 5, absent: 10 });
    expect(d.byClass).toEqual([
      {
        classId: "c1",
        name: "JHS 1",
        rate: 93,
        marked: 200,
        counts: { present: 180, late: 5, excused: 8, medical: 2, absent: 5 },
      },
    ]);
  });

  // GOV1-ATT-2 — no per-student / operational field leaks onto the arm.
  it("GOV1-ATT-2 · strips needsAttention/criticalCount/thresholds + row teacherName/tone/delta", async () => {
    const r = await getSchoolRollup("school-1");
    if (r.attendance.status !== "CAPTURED") throw new Error("expected CAPTURED");
    const d = r.attendance.data as Record<string, unknown>;
    for (const k of ["needsAttention", "criticalCount", "watchCount", "perfectCount", "thresholds"]) {
      expect(d).not.toHaveProperty(k);
    }
    const row = r.attendance.data.byClass[0] as Record<string, unknown>;
    for (const k of ["teacherName", "tone", "priorRate", "delta"]) {
      expect(row).not.toHaveProperty(k);
    }
  });
});

// ── GOV1-FEE · fee-collections arm + finance window ───────────────────────────────────────────────
describe("GOV1-FEE · fee-collections arm", () => {
  it("CAPTURED; re-exposes billed/collected/outstanding/rate only", async () => {
    const r = await getSchoolRollup("school-1");
    expect(r.feeCollections.status).toBe("CAPTURED");
    if (r.feeCollections.status !== "CAPTURED") throw new Error("unreachable");
    expect(r.feeCollections.data).toEqual({
      billed: 50000,
      collected: 42000,
      outstanding: 8000,
      collectionRate: 84,
    });
  });

  it("calls getFinanceReport with (schoolId, null, half-open [startsOn, endsOn+1day) UTC window)", async () => {
    await getSchoolRollup("school-1");
    expect(getFinanceReport).toHaveBeenCalledTimes(1);
    const [sid, year, window] = vi.mocked(getFinanceReport).mock.calls[0];
    expect(sid).toBe("school-1");
    expect(year).toBeNull();
    expect(window?.start.toISOString()).toBe("2025-09-01T00:00:00.000Z");
    expect(window?.end.toISOString()).toBe("2025-12-20T00:00:00.000Z");
  });
});

// ── GOV1-HON · honesty convention ─────────────────────────────────────────────────────────────────
describe("GOV1-HON · honesty convention", () => {
  // HON-1 — a true zero (fees billed, nothing collected) is CAPTURED, not hidden.
  it("GOV1-HON-1 · zero collected with invoices billed is CAPTURED", async () => {
    vi.mocked(getFinanceReport).mockResolvedValue(
      financeStub({ totals: { invoiceCount: 5 }, billed: 3000, collected: 0, outstanding: 3000, rate: 0 }),
    );
    const r = await getSchoolRollup("school-1");
    expect(r.feeCollections.status).toBe("CAPTURED");
    if (r.feeCollections.status !== "CAPTURED") throw new Error("unreachable");
    expect(r.feeCollections.data.collected).toBe(0);
    expect(r.feeCollections.data.collectionRate).toBe(0);
  });

  it("GOV1-HON-2 · enrolment NOT_CAPTURED when no students enrolled", async () => {
    vi.mocked(getSchoolStats).mockResolvedValue(statsStub({ totalStudents: 0 }));
    const r = await getSchoolRollup("school-1");
    expect(r.enrolment).toEqual({
      status: "NOT_CAPTURED",
      reason: "No students currently enrolled.",
    });
  });

  it("GOV1-HON-3 · attendance NOT_CAPTURED reasons (no period / nothing marked)", async () => {
    vi.mocked(listAcademicTerms).mockResolvedValue([]);
    expect((await getSchoolRollup("school-1")).attendance).toEqual({
      status: "NOT_CAPTURED",
      reason: "No academic period configured.",
    });

    vi.mocked(listAcademicTerms).mockResolvedValue([term()]);
    vi.mocked(getAttendanceSummary).mockResolvedValue(attendanceStub({ totalMarked: 0 }));
    expect((await getSchoolRollup("school-1")).attendance).toEqual({
      status: "NOT_CAPTURED",
      reason: "No attendance marked for Term 1 · 2025/26.",
    });
  });

  it("GOV1-HON-4 · fees NOT_CAPTURED reasons (no period / nothing billed)", async () => {
    vi.mocked(listAcademicTerms).mockResolvedValue([]);
    expect((await getSchoolRollup("school-1")).feeCollections).toEqual({
      status: "NOT_CAPTURED",
      reason: "No academic period configured.",
    });
    // No period → finance is never queried.
    expect(getFinanceReport).not.toHaveBeenCalled();

    vi.mocked(listAcademicTerms).mockResolvedValue([term()]);
    vi.mocked(getFinanceReport).mockResolvedValue(financeStub({ totals: { invoiceCount: 0 } }));
    expect((await getSchoolRollup("school-1")).feeCollections).toEqual({
      status: "NOT_CAPTURED",
      reason: "No fees billed for Term 1 · 2025/26.",
    });
  });

  it("GOV1-HON-5 · non-captured arms carry a reason and no `.data`", async () => {
    vi.mocked(listAcademicTerms).mockResolvedValue([]);
    vi.mocked(getSchoolStats).mockResolvedValue(statsStub({ totalStudents: 0 }));
    const r = await getSchoolRollup("school-1");
    for (const arm of [r.enrolment, r.attendance, r.feeCollections]) {
      expect(arm.status).toBe("NOT_CAPTURED");
      expect(arm).not.toHaveProperty("data");
      if (arm.status !== "CAPTURED") expect(typeof arm.reason).toBe("string");
    }
  });

  it("GOV1-HON-6 · GOV-1 never emits NOT_APPLICABLE (any scenario)", async () => {
    // Empty-everything scenario.
    vi.mocked(listAcademicTerms).mockResolvedValue([]);
    vi.mocked(getSchoolStats).mockResolvedValue(statsStub({ totalStudents: 0 }));
    const empty = await getSchoolRollup("school-1");
    // Fully-populated scenario (defaults).
    vi.mocked(listAcademicTerms).mockResolvedValue([term()]);
    vi.mocked(getSchoolStats).mockResolvedValue(statsStub());
    const full = await getSchoolRollup("school-1");
    for (const r of [empty, full]) {
      for (const arm of [r.enrolment, r.attendance, r.feeCollections]) {
        expect(arm.status).not.toBe("NOT_APPLICABLE");
      }
    }
  });
});

// ── GOV1-PER · period selection + period-null nulling ─────────────────────────────────────────────
describe("GOV1-PER · period resolution", () => {
  const t1 = term({ periodId: "p1", academicYear: "2024/25", periodNumber: 1, startsOn: "2024-09-01", endsOn: "2024-12-19" });
  const t2 = term({ periodId: "p2", academicYear: "2025/26", periodNumber: 1, label: "Term 1", startsOn: "2025-09-01", endsOn: "2025-12-19" });

  it("omitted periodId → resolves the current/latest term", async () => {
    vi.mocked(listAcademicTerms).mockResolvedValue([t2, t1]); // newest-first, both already started
    const r = await getSchoolRollup("school-1");
    expect(r.period?.periodId).toBe("p2");
  });

  it("explicit periodId → resolves that term", async () => {
    vi.mocked(listAcademicTerms).mockResolvedValue([t2, t1]);
    const r = await getSchoolRollup("school-1", { periodId: "p1" });
    expect(r.period?.periodId).toBe("p1");
  });

  it("no terms → period null; point-in-time populated, term-windowed null (never 0)", async () => {
    vi.mocked(listAcademicTerms).mockResolvedValue([]);
    const r = await getSchoolRollup("school-1");
    expect(r.period).toBeNull();
    if (r.enrolment.status !== "CAPTURED") throw new Error("expected CAPTURED (students exist)");
    const d = r.enrolment.data;
    // Point-in-time + lifetime still populated.
    expect(d.roll).toBe(100);
    expect(d.withdrew).toBe(3);
    expect(d.lifetimeExits).toBe(6);
    // Term-windowed nulled — not 0.
    expect(d.admissionsThisTerm).toBeNull();
    expect(d.intakeFemale).toBeNull();
    expect(d.intakeMale).toBeNull();
    expect(d.netChange).toBeNull();
  });
});

// ── Structural purity guards (read the source text, no import graph needed) ───────────────────────
describe("GOV1 · structural purity", () => {
  const source = readFileSync(resolve(cwd(), "lib/rollup/school-rollup.ts"), "utf8");
  // Strip comments so prose mentioning "withSchool" / "sql" in the docstring can't false-trip the guards.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("GOV1-SRV-1 · imports 'server-only'", () => {
    expect(code).toMatch(/^import\s+"server-only";/m);
  });

  it("GOV1-TEN-2/PUR-1 · owns zero SQL — no db driver / drizzle / withSchool / raw sql", () => {
    expect(code).not.toMatch(/from\s+"drizzle-orm"/);
    expect(code).not.toMatch(/@\/db\b/);
    expect(code).not.toMatch(/@\/lib\/db\/rls/);
    expect(code).not.toMatch(/withSchool/);
    expect(code).not.toMatch(/\bsql`/);
  });
});
