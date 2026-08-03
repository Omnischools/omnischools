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
import { getBooksFinanceLine } from "@/lib/reports/books-finance-data";
import { getPayrollLine } from "@/lib/reports/payroll-line-data";
import { boardTile } from "@/lib/board/tiles";
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
vi.mock("@/lib/reports/books-finance-data", () => ({ getBooksFinanceLine: vi.fn() }));
vi.mock("@/lib/reports/payroll-line-data", () => ({ getPayrollLine: vi.fn() }));

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

const booksStub = (over: Partial<Awaited<ReturnType<typeof getBooksFinanceLine>>> = {}) => ({
  income: 30000,
  expense: 18000,
  rowCount: 12,
  ...over,
});

const payrollStub = (over: Partial<Awaited<ReturnType<typeof getPayrollLine>>> = {}) => ({
  schoolPaidMonthlyTotal: 24000,
  schoolPaidStaffCount: 6,
  gesPaidMonthlyMemo: 9000,
  gesPaidStaffCount: 3,
  allowanceMonthlyMemo: 1500,
  allowanceStaffCount: 2,
  rowCount: 11,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks(); // reset call history + implementations between cases
  vi.mocked(listAcademicTerms).mockResolvedValue([term()]);
  vi.mocked(getSchoolStats).mockResolvedValue(statsStub());
  vi.mocked(getEnrolmentRoll).mockResolvedValue(rollStub());
  vi.mocked(getAttendanceSummary).mockResolvedValue(attendanceStub());
  vi.mocked(getFinanceReport).mockResolvedValue(financeStub());
  vi.mocked(getBooksFinanceLine).mockResolvedValue(booksStub());
  vi.mocked(getPayrollLine).mockResolvedValue(payrollStub());
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

  // GOV1-ENR-3 — withdrew/transferred/graduated + lifetimeExits come from stats.enrolmentFlow
  // (cumulative, period-independent), NOT enrolment-roll. Sources DIVERGE so the wrong one reds.
  it("GOV1-ENR-3 · lifetime exits + lifetimeExits re-sum come from school-stats, not enrolment-roll", async () => {
    vi.mocked(getSchoolStats).mockResolvedValue(
      statsStub({
        enrolmentFlow: { newAdmissions: 5, withdrew: 3, transferred: 2, graduated: 1, netChange: 999 },
      }),
    );
    vi.mocked(getEnrolmentRoll).mockResolvedValue(
      rollStub({ withdrew: 99, transferred: 99, graduated: 99, lifetimeExits: 297 }),
    );
    const r = await getSchoolRollup("school-1");
    if (r.enrolment.status !== "CAPTURED") throw new Error("expected CAPTURED");
    const d = r.enrolment.data;
    expect(d.withdrew).toBe(3);
    expect(d.transferred).toBe(2);
    expect(d.graduated).toBe(1);
    // Faithful re-sum of stats' OWN three exit fields (6), never enrolment-roll's 297.
    expect(d.lifetimeExits).toBe(6);
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

  // invoiceCount is a Postgres count(*) (bigint) — the pg driver returns it as a STRING. The seam
  // MUST coerce with Number(): a bare '0' === 0 is false and would fabricate a CAPTURED empty tile.
  it("invoiceCount arrives as a bigint STRING — '0' → NOT_CAPTURED, '5' → CAPTURED", async () => {
    vi.mocked(getFinanceReport).mockResolvedValue(
      financeStub({ totals: { invoiceCount: "0" }, billed: 0, collected: 0, outstanding: 0, rate: 0 }),
    );
    expect((await getSchoolRollup("school-1")).feeCollections).toEqual({
      status: "NOT_CAPTURED",
      reason: "No fees billed for Term 1 · 2025/26.",
    });

    vi.mocked(getFinanceReport).mockResolvedValue(
      financeStub({ totals: { invoiceCount: "5" }, billed: 3000, collected: 0, outstanding: 3000, rate: 0 }),
    );
    expect((await getSchoolRollup("school-1")).feeCollections.status).toBe("CAPTURED");
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

  // The honesty crux for lifetime exits: the REAL getEnrolmentRoll early-returns 0 for exits when
  // period == null. A school with withdrawals but no configured term must NOT report withdrew: 0 —
  // so the seam reads exits from stats. Here enrolment-roll mimics that fabricated-zero shape.
  it("GOV1-HON · no term + lifetime exits → withdrew from stats, never enrolment-roll's fabricated 0", async () => {
    vi.mocked(listAcademicTerms).mockResolvedValue([]);
    vi.mocked(getSchoolStats).mockResolvedValue(
      statsStub({
        enrolmentFlow: { newAdmissions: 0, withdrew: 3, transferred: 2, graduated: 1, netChange: 0 },
      }),
    );
    vi.mocked(getEnrolmentRoll).mockResolvedValue(
      rollStub({
        withdrew: 0, transferred: 0, graduated: 0, lifetimeExits: 0,
        netChange: 0, admissionsThisTerm: 0, intakeFemale: 0, intakeMale: 0,
      }),
    );
    const r = await getSchoolRollup("school-1");
    expect(r.period).toBeNull();
    if (r.enrolment.status !== "CAPTURED") throw new Error("expected CAPTURED (students exist)");
    const d = r.enrolment.data;
    expect(d.withdrew).toBe(3); // from stats, not enrolment-roll's no-term 0
    expect(d.lifetimeExits).toBe(6);
    expect(d.netChange).toBeNull(); // term-windowed → null when no period
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

// ── GOV3 · net-position finance arm (AC GOV3-01..12) ──────────────────────────────────────────────
// THE HONESTY INVARIANT: three DISTINCT labelled streams (fees · books · payroll), never one summed
// "net position"/"profit". The ONLY composite is books.net = income − expense (within the books
// ledger). fees is the feeCollections arm reused verbatim; books absence is drawn at row-count == 0
// (NEVER net === 0); payroll is NOT_APPLICABLE at zero comp rows, and is a point-in-time monthly
// figure (period-INDEPENDENT).
describe("GOV3 · net-position finance arm", () => {
  const captured = async (opts?: { periodId?: string }) => {
    const r = await getSchoolRollup("school-1", opts);
    if (r.netPositionFinance.status !== "CAPTURED") throw new Error("expected CAPTURED arm");
    return { r, np: r.netPositionFinance.data };
  };

  // GOV3-01/R347 — arm availability: CAPTURED with a period, NOT_CAPTURED only when period == null.
  it("GOV3-01 · CAPTURED when a period exists; NOT_CAPTURED (no period) reason otherwise", async () => {
    const { np } = await captured();
    expect(Object.keys(np).sort()).toEqual(["books", "fees", "payroll"]);

    // No-period branch: clear the call history first (captured() above already invoked the mocks).
    vi.mocked(getBooksFinanceLine).mockClear();
    vi.mocked(getPayrollLine).mockClear();
    vi.mocked(listAcademicTerms).mockResolvedValue([]);
    const r = await getSchoolRollup("school-1");
    expect(r.netPositionFinance).toEqual({
      status: "NOT_CAPTURED",
      reason: "No academic period configured.",
    });
    // No period → neither books nor payroll is queried.
    expect(getBooksFinanceLine).not.toHaveBeenCalled();
    expect(getPayrollLine).not.toHaveBeenCalled();
  });

  // GOV3-02 — fees is the feeCollections arm reused VERBATIM (deep-equal), never a re-query/"fee net".
  it("GOV3-02 · fees === feeCollections (verbatim, deep-equal)", async () => {
    const { r, np } = await captured();
    expect(np.fees).toEqual(r.feeCollections);
    // getFinanceReport is called ONCE (the feeCollections arm) — the net-position arm does not re-query.
    expect(getFinanceReport).toHaveBeenCalledTimes(1);
  });

  // GOV3-03 — NO summed scalar anywhere. The CAPTURED arm has EXACTLY the three stream keys; adding a
  // `netPosition`/`total`/`profit` field (a mutation) would break this exact-key assertion (reds).
  it("GOV3-03 · exposes exactly {fees,books,payroll} — no summed 'net position' scalar", async () => {
    const { np } = await captured();
    expect(Object.keys(np).sort()).toEqual(["books", "fees", "payroll"]);
    // Every top-level value is a tagged RollupArm (a status object), never a bare number.
    for (const v of Object.values(np)) {
      expect(typeof v).toBe("object");
      expect(["CAPTURED", "NOT_CAPTURED", "NOT_APPLICABLE"]).toContain(
        (v as { status: string }).status,
      );
    }
  });

  // GOV3-04 — no cross-ledger composite: no field equals a sum across ≥2 of {fees,books,payroll}. The
  // ONLY composite is books.net = income − expense (within books). Sources chosen so any accidental
  // cross-sum would surface as a recognisable value.
  it("GOV3-04 · the only composite is books.net = income − expense; no cross-ledger folded field", async () => {
    const { r, np } = await captured();
    if (np.books.status !== "CAPTURED") throw new Error("expected books CAPTURED");
    if (np.payroll.status !== "CAPTURED") throw new Error("expected payroll CAPTURED");
    // books.net is the within-ledger subtraction ONLY, and books carries no folded fees/payroll figure.
    expect(np.books.data.net).toBe(np.books.data.income - np.books.data.expense);
    expect(Object.keys(np.books.data).sort()).toEqual(["expense", "income", "net"]);
    // payroll exposes exactly its own gross/memo fields + cadence — nothing from fees or books folded in.
    expect(Object.keys(np.payroll.data).sort()).toEqual([
      "allowanceMonthlyMemo",
      "allowanceStaffCount",
      "cadence",
      "gesPaidMonthlyMemo",
      "gesPaidStaffCount",
      "schoolPaidMonthlyTotal",
      "schoolPaidStaffCount",
    ]);
    // school-paid gross is NOT the sum of the three pay statuses (GES + allowance stay out).
    expect(np.payroll.data.schoolPaidMonthlyTotal).not.toBe(
      np.payroll.data.schoolPaidMonthlyTotal +
        np.payroll.data.gesPaidMonthlyMemo +
        np.payroll.data.allowanceMonthlyMemo,
    );
    // fees is the feeCollections arm verbatim — no extra "fee net" field bolted on.
    expect(np.fees).toEqual(r.feeCollections);
  });

  // GOV3-05 — books is term-windowed, and a real-zero net (income == expense, ≥1 entry) is CAPTURED.
  it("GOV3-05 · books queried on the [startsOn,endsOn] term window; real-zero net is CAPTURED", async () => {
    await captured();
    expect(getBooksFinanceLine).toHaveBeenCalledWith("school-1", {
      startsOn: "2025-09-01",
      endsOn: "2025-12-19",
    });

    vi.mocked(getBooksFinanceLine).mockResolvedValue(booksStub({ income: 5000, expense: 5000, rowCount: 4 }));
    const { np } = await captured();
    if (np.books.status !== "CAPTURED") throw new Error("expected books CAPTURED (entries exist)");
    expect(np.books.data).toEqual({ income: 5000, expense: 5000, net: 0 });
  });

  // GOV3-06 — books absence is drawn at ROW-COUNT == 0, never at net === 0.
  it("GOV3-06 · books NOT_CAPTURED (term-named) only when row-count is 0", async () => {
    vi.mocked(getBooksFinanceLine).mockResolvedValue(booksStub({ income: 0, expense: 0, rowCount: 0 }));
    const { np } = await captured();
    expect(np.books).toEqual({
      status: "NOT_CAPTURED",
      reason: "No books entries recorded for Term 1 · 2025/26.",
    });
  });

  // GOV3-07 — payroll school-paid is the GROSS Σ, period-INDEPENDENT (queried with schoolId only, no
  // window; the figure is never multiplied over the term).
  it("GOV3-07 · payroll school-paid gross is verbatim + period-independent (no window arg)", async () => {
    const { np } = await captured();
    if (np.payroll.status !== "CAPTURED") throw new Error("expected payroll CAPTURED");
    expect(np.payroll.data.schoolPaidMonthlyTotal).toBe(24000);
    expect(np.payroll.data.cadence).toBe("MONTHLY");
    // Called with the schoolId ONLY — no term/window is threaded in, so it cannot be term-scaled.
    expect(getPayrollLine).toHaveBeenCalledWith("school-1");
    expect(vi.mocked(getPayrollLine).mock.calls[0]).toHaveLength(1);
  });

  // GOV3-08 — the GES memo is separate; an all-GES school is a real-zero school-paid, still CAPTURED.
  it("GOV3-08 · GES memo is separate; all-GES → school-paid 0, CAPTURED, GES memo > 0", async () => {
    vi.mocked(getPayrollLine).mockResolvedValue(
      payrollStub({
        schoolPaidMonthlyTotal: 0,
        schoolPaidStaffCount: 0,
        gesPaidMonthlyMemo: 15000,
        gesPaidStaffCount: 5,
        allowanceMonthlyMemo: 0,
        allowanceStaffCount: 0,
        rowCount: 5,
      }),
    );
    const { np } = await captured();
    if (np.payroll.status !== "CAPTURED") throw new Error("expected payroll CAPTURED (rows exist)");
    expect(np.payroll.data.schoolPaidMonthlyTotal).toBe(0); // real zero, not NOT_APPLICABLE
    expect(np.payroll.data.gesPaidMonthlyMemo).toBe(15000);
  });

  // GOV3-09 — payroll NOT_APPLICABLE when the school runs no payroll (zero comp rows).
  it("GOV3-09 · payroll NOT_APPLICABLE when zero staff_compensation rows", async () => {
    vi.mocked(getPayrollLine).mockResolvedValue(
      payrollStub({
        schoolPaidMonthlyTotal: 0,
        schoolPaidStaffCount: 0,
        gesPaidMonthlyMemo: 0,
        gesPaidStaffCount: 0,
        allowanceMonthlyMemo: 0,
        allowanceStaffCount: 0,
        rowCount: 0,
      }),
    );
    const { np } = await captured();
    expect(np.payroll).toEqual({
      status: "NOT_APPLICABLE",
      reason: "This school does not run payroll in Omnischools.",
    });
  });

  // GOV3-10 — allowance is its OWN memo, never folded into the school-paid total.
  it("GOV3-10 · allowance memo is separate and not folded into school-paid", async () => {
    vi.mocked(getPayrollLine).mockResolvedValue(
      payrollStub({ schoolPaidMonthlyTotal: 24000, allowanceMonthlyMemo: 1500, allowanceStaffCount: 2 }),
    );
    const { np } = await captured();
    if (np.payroll.status !== "CAPTURED") throw new Error("expected payroll CAPTURED");
    expect(np.payroll.data.schoolPaidMonthlyTotal).toBe(24000); // excludes the 1500 allowance
    expect(np.payroll.data.allowanceMonthlyMemo).toBe(1500);
    expect(np.payroll.data.schoolPaidMonthlyTotal).not.toBe(24000 + 1500);
  });

  // GOV3-11 — the arm is CAPTURED even when all three inner streams are absent, each keeping its OWN
  // distinct reason (fees NOT_CAPTURED, books NOT_CAPTURED, payroll NOT_APPLICABLE — not collapsed).
  it("GOV3-11 · CAPTURED with three DISTINCT absent inner arms (reasons not collapsed)", async () => {
    vi.mocked(getFinanceReport).mockResolvedValue(financeStub({ totals: { invoiceCount: 0 } }));
    vi.mocked(getBooksFinanceLine).mockResolvedValue(booksStub({ income: 0, expense: 0, rowCount: 0 }));
    vi.mocked(getPayrollLine).mockResolvedValue(payrollStub({ rowCount: 0 }));
    const { np } = await captured();
    expect(np.fees).toEqual({
      status: "NOT_CAPTURED",
      reason: "No fees billed for Term 1 · 2025/26.",
    });
    expect(np.books).toEqual({
      status: "NOT_CAPTURED",
      reason: "No books entries recorded for Term 1 · 2025/26.",
    });
    expect(np.payroll).toEqual({
      status: "NOT_APPLICABLE",
      reason: "This school does not run payroll in Omnischools.",
    });
    // Three DIFFERENT reasons — never one shared string.
    const reasons = [np.fees, np.books, np.payroll].map((a) =>
      a.status === "CAPTURED" ? "" : a.reason,
    );
    expect(new Set(reasons).size).toBe(3);
  });

  // GOV3-12 — tile honesty: the pure boardTile collapses a non-CAPTURED stream to its reason with NO
  // number (fabricating a zero is impossible); a CAPTURED real zero renders "GHS 0".
  it("GOV3-12 · boardTile renders reason (no number) for absent streams, real 0 for a captured zero", async () => {
    // payroll NOT_APPLICABLE → reason, value fn never called.
    const naTile = boardTile(
      { status: "NOT_APPLICABLE", reason: "This school does not run payroll in Omnischools." },
      () => "GHS 999",
    );
    expect(naTile).toEqual({
      status: "NOT_CAPTURED",
      reason: "This school does not run payroll in Omnischools.",
    });
    // fees NOT_CAPTURED → reason.
    const ncTile = boardTile({ status: "NOT_CAPTURED", reason: "No fees billed for Term 1 · 2025/26." }, () => "GHS 1");
    expect(ncTile.status).toBe("NOT_CAPTURED");
    // CAPTURED real zero (all-GES school-paid 0) → "GHS 0", a true zero not an absence tile.
    const zeroTile = boardTile(
      { status: "CAPTURED", data: { schoolPaidMonthlyTotal: 0 } },
      (d) => `GHS ${d.schoolPaidMonthlyTotal.toLocaleString("en-GH")}`,
    );
    expect(zeroTile).toEqual({ status: "CAPTURED", value: "GHS 0" });
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
