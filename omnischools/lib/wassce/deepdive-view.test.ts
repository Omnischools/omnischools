import { describe, it, expect } from "vitest";
import {
  attendanceRatePct,
  buildLedgerGridView,
  buildScheduleView,
  deriveScheduleStatus,
  daysUntil,
  fmtDuration,
  type LedgerPeriodInput,
  type LedgerRowInput,
  type ScheduleRowInput,
} from "./deepdive-view";

/**
 * INCR-20 capstone pure-logic proofs (the things that would silently break). No DB, no framework
 * scaffolding — plain objects into the db-free builders.
 */

const PERIODS: LedgerPeriodInput[] = [
  { periodId: "p1", label: "Sem 1 · 2025/26", periodSub: "Sep 2025 – Dec 2025" },
  { periodId: "p2", label: "Sem 2 · 2025/26", periodSub: "Jan 2026 – Jun 2026" },
];

const rowFor = (over: Partial<LedgerRowInput> & { periodId: string }): LedgerRowInput => ({
  asgnScore: 60,
  midSemScore: 58,
  endSemScore: 62,
  projectScore: 65,
  portfolioScore: null, // portfolio is entered at semester end — a real NULL, not a 0
  weightedTotal: 61.5,
  asgnWeightUsed: 15,
  midSemWeightUsed: 15,
  endSemWeightUsed: 40,
  projectWeightUsed: 15,
  portfolioWeightUsed: 15,
  ...over,
});

describe("buildLedgerGridView — frozen, contextual read", () => {
  it("renders a null category as em-dash '—', never 0", () => {
    const grid = buildLedgerGridView({
      subjectId: "s1",
      subjectName: "Mathematics (Core)",
      resolved: true,
      teacherLabel: "Mr K. Owusu",
      periods: PERIODS,
      rows: [rowFor({ periodId: "p1" })],
    });
    const portfolio = grid.categories.find((c) => c.label === "Portfolio")!;
    expect(portfolio.cells[0]).toBe("—");
    expect(portfolio.cells[0]).not.toBe("0");
    // A present score renders as-is.
    const asgn = grid.categories.find((c) => c.label === "Assignments")!;
    expect(asgn.cells[0]).toBe("60");
  });

  it("takes the weight LABEL from the row's FROZEN *_weight_used, unchanged when a live weight would differ", () => {
    // The row was compiled with a frozen end-sem weight of 40. A LATER school re-weight to (say) 60 is a
    // live-config change we NEVER pass in — the builder only sees the frozen snapshot on the row, so the
    // label must stay 40%.
    const grid = buildLedgerGridView({
      subjectId: "s1",
      subjectName: "Mathematics (Core)",
      resolved: true,
      teacherLabel: null,
      periods: PERIODS,
      rows: [rowFor({ periodId: "p1", endSemWeightUsed: 40 })],
    });
    const endSem = grid.categories.find((c) => c.label === "End-of-semester exam")!;
    expect(endSem.weightLabel).toBe("40%");
    expect(grid.weightsLabel).toBe("15/15/40/15/15");
  });

  it("uses the LATEST period's frozen snapshot as the representative weight when semesters differ", () => {
    // p1 was compiled at 40; p2 at 45. The label is the latest (p2) snapshot; each period's own total
    // stays honest in its own column.
    const grid = buildLedgerGridView({
      subjectId: "s1",
      subjectName: "Mathematics (Core)",
      resolved: true,
      teacherLabel: null,
      periods: PERIODS,
      rows: [
        rowFor({ periodId: "p1", endSemWeightUsed: 40, weightedTotal: 61.5 }),
        rowFor({ periodId: "p2", endSemWeightUsed: 45, weightedTotal: 64.8 }),
      ],
    });
    const endSem = grid.categories.find((c) => c.label === "End-of-semester exam")!;
    expect(endSem.weightLabel).toBe("45%");
    expect(grid.totals).toEqual(["61.5", "64.8"]); // stored totals displayed AS-IS, one per period
  });

  it("renders a missing-period column as em-dash without throwing (sparse seed, no backfill)", () => {
    const grid = buildLedgerGridView({
      subjectId: "s1",
      subjectName: "Mathematics (Core)",
      resolved: true,
      teacherLabel: null,
      periods: PERIODS,
      rows: [rowFor({ periodId: "p2" })], // only the 2nd semester has a ledger row
    });
    const asgn = grid.categories.find((c) => c.label === "Assignments")!;
    expect(asgn.cells).toEqual(["—", "60"]); // p1 empty, p2 present
    expect(grid.totals).toEqual(["—", "61.5"]);
    expect(grid.hasLedger).toBe(true);
  });

  it("has no ledger → empty grid, no weight label, no throw", () => {
    const grid = buildLedgerGridView({
      subjectId: "s1",
      subjectName: "Biology",
      resolved: false,
      teacherLabel: null,
      periods: PERIODS,
      rows: [],
    });
    expect(grid.hasLedger).toBe(false);
    expect(grid.weightsLabel).toBeNull();
    expect(grid.categories.every((c) => c.cells.every((cell) => cell === "—"))).toBe(true);
    expect(grid.categories.every((c) => c.weightLabel === "—")).toBe(true);
  });
});

describe("deriveScheduleStatus / buildScheduleView — stored-field derivation", () => {
  const now = new Date("2026-05-01T00:00:00Z");

  it("Sat from sat_at, Missed from exempted_at, Upcoming from neither", () => {
    expect(deriveScheduleStatus({ satAt: new Date(), exemptedAt: null })).toBe("SAT");
    expect(deriveScheduleStatus({ satAt: null, exemptedAt: new Date() })).toBe("MISSED");
    expect(deriveScheduleStatus({ satAt: null, exemptedAt: null })).toBe("UPCOMING");
    // sat_at wins if (impossibly) both were set — a written paper is sat.
    expect(deriveScheduleStatus({ satAt: new Date(), exemptedAt: new Date() })).toBe("SAT");
  });

  it("builds the row labels + summary tallies and orders by date", () => {
    const papers: ScheduleRowInput[] = [
      { paperId: "b", name: "English Language 1", paperType: "OBJECTIVE", scheduledDate: new Date("2026-05-14T00:00:00Z"), scheduledTime: "14:00", durationMinutes: 60, satAt: null, exemptedAt: new Date() },
      { paperId: "a", name: "Social Studies 1", paperType: "OBJECTIVE", scheduledDate: new Date("2026-04-21T00:00:00Z"), scheduledTime: "09:00", durationMinutes: 60, satAt: new Date(), exemptedAt: null },
      { paperId: "c", name: "Mathematics (Core) 2", paperType: "ESSAY", scheduledDate: new Date("2026-06-03T00:00:00Z"), scheduledTime: "11:00", durationMinutes: 150, satAt: null, exemptedAt: null },
    ];
    const view = buildScheduleView(papers, now);
    expect(view.rows.map((r) => r.paperId)).toEqual(["a", "b", "c"]); // date order
    expect(view.total).toBe(3);
    expect(view.sat).toBe(1);
    expect(view.missed).toBe(1);
    expect(view.upcoming).toBe(1);

    const [sat, missed, upcoming] = view.rows;
    expect(sat.statusLabel).toBe("Sat");
    expect(sat.dateLabel).toBe("Tue 21 Apr");
    expect(sat.typeLabel).toBe("Objective");
    expect(missed.statusLabel).toBe("Missed · medical");
    expect(upcoming.statusLabel).toBe("Upcoming · 33 days");
    expect(upcoming.durationLabel).toBe("2h 30m");
  });
});

describe("helpers", () => {
  it("daysUntil ceils to whole days", () => {
    expect(daysUntil(new Date("2026-05-20T00:00:00Z"), new Date("2026-05-01T00:00:00Z"))).toBe(19);
  });
  it("fmtDuration formats hours + minutes", () => {
    expect(fmtDuration(90)).toBe("1h 30m");
    expect(fmtDuration(45)).toBe("45m");
    expect(fmtDuration(180)).toBe("3h 00m");
    expect(fmtDuration(null)).toBeNull();
  });
});

describe("attendanceRatePct — EXCUSED/MEDICAL never lower the rate (5-status intent, AC11)", () => {
  it("rates present+late over culpable days only (late counts as attended)", () => {
    expect(attendanceRatePct(90, 0, 10)).toBe(90); // 90 / (90+0+10)
    expect(attendanceRatePct(80, 10, 10)).toBe(90); // (80+10) / 100
  });
  it("a hospitalised candidate is NOT penalised — no 'X% · 0 absences' contradiction", () => {
    // 90 present, 0 ABSENT (10 MEDICAL days aren't in present/late/absent at all) → 100%, and the
    // sibling meta reads "0 absences". The old (present+late)/marked gave the contradictory 90%.
    expect(attendanceRatePct(90, 0, 0)).toBe(100);
  });
  it("no culpable day → null (empty state; no div-by-zero, no hollow 100% from an excused-only term)", () => {
    expect(attendanceRatePct(0, 0, 0)).toBeNull();
  });
});
