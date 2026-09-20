import { describe, it, expect } from "vitest";
import {
  billingUnits,
  duesChargeKey,
  filterNewUnits,
  representativeSibling,
  resolveDuesReportAccess,
  resolveInForceRate,
  type DuesHistoryRow,
  type ScopeStudent,
} from "./dues";

/**
 * INCR-54a pure core — the money decisions that must hold WITHOUT a database (the officers.ts / points.ts
 * discipline). Covers the forward-only rate (R463), PER_FAMILY rank-1 billing (R461), the idempotency keys
 * (R462) and the report read-gate no-role-alone (R469).
 */

const student = (id: string, over: Partial<ScopeStudent> = {}): ScopeStudent => ({
  id,
  householdId: null,
  enrolledOn: null,
  createdAtISO: "2025-09-01T00:00:00.000Z",
  ...over,
});

// ─────────────────────────────────────────────────────── forward-only rate (R463)

describe("resolveInForceRate · forward-only (R463)", () => {
  const rows: DuesHistoryRow[] = [
    { effectiveFrom: "2025-01-01", duesEnabled: true, duesAmount: 50, duesBasis: "PER_STUDENT", duesCadence: "PER_TERM" },
    { effectiveFrom: "2025-05-01", duesEnabled: true, duesAmount: 75, duesBasis: "PER_STUDENT", duesCadence: "PER_TERM" },
  ];

  it("snapshots the row with the GREATEST effective_from ≤ the period start", () => {
    expect(resolveInForceRate(rows, "2025-06-01")?.amount).toBe(75);
    expect(resolveInForceRate(rows, "2025-03-01")?.amount).toBe(50);
  });

  it("a LATER change never re-rates an EARLIER period (forward-only)", () => {
    // Billing the Jan–Apr term after the May rise still reads the OLD 50, never 75.
    expect(resolveInForceRate(rows, "2025-02-15")?.amount).toBe(50);
  });

  it("no row in force before the first effective_from → null (generate nothing)", () => {
    expect(resolveInForceRate(rows, "2024-12-31")).toBeNull();
  });

  it("the in-force row being DISABLED → null (honest empty)", () => {
    const off: DuesHistoryRow[] = [
      { effectiveFrom: "2025-01-01", duesEnabled: true, duesAmount: 50, duesBasis: "PER_STUDENT", duesCadence: "PER_TERM" },
      { effectiveFrom: "2025-05-01", duesEnabled: false, duesAmount: null, duesBasis: null, duesCadence: null },
    ];
    expect(resolveInForceRate(off, "2025-06-01")).toBeNull();
    expect(resolveInForceRate(off, "2025-03-01")?.amount).toBe(50); // still enabled before the toggle
  });

  it("a zero / missing amount or basis → null", () => {
    expect(resolveInForceRate([{ effectiveFrom: "2025-01-01", duesEnabled: true, duesAmount: 0, duesBasis: "PER_STUDENT", duesCadence: "PER_TERM" }], "2025-06-01")).toBeNull();
    expect(resolveInForceRate([{ effectiveFrom: "2025-01-01", duesEnabled: true, duesAmount: 50, duesBasis: null, duesCadence: "PER_TERM" }], "2025-06-01")).toBeNull();
  });

  it("carries basis + cadence from the in-force snapshot", () => {
    const r = resolveInForceRate(
      [{ effectiveFrom: "2025-01-01", duesEnabled: true, duesAmount: 200, duesBasis: "PER_FAMILY", duesCadence: "PER_YEAR" }],
      "2025-10-01",
    );
    expect(r).toEqual({ amount: 200, basis: "PER_FAMILY", cadence: "PER_YEAR" });
  });
});

// ─────────────────────────────────────────────── PER_FAMILY rank-1 billing (R461)

describe("representativeSibling + billingUnits · PER_FAMILY rank-1 (R461)", () => {
  it("PER_STUDENT → one unit per active student (no household on the charge)", () => {
    const units = billingUnits([student("a"), student("b")], "PER_STUDENT");
    expect(units).toEqual([
      { subjectStudentId: "a", householdId: null },
      { subjectStudentId: "b", householdId: null },
    ]);
  });

  it("PER_FAMILY → ONE unit per household, keyed to the rank-1 sibling (earliest enrolment)", () => {
    const members = [
      student("younger", { householdId: "H1", enrolledOn: "2024-09-01" }),
      student("older", { householdId: "H1", enrolledOn: "2022-09-01" }),
    ];
    expect(representativeSibling(members)).toBe("older");
    const units = billingUnits(members, "PER_FAMILY");
    expect(units).toEqual([{ subjectStudentId: "older", householdId: "H1" }]);
  });

  it("PER_FAMILY → a household-less student is a FAMILY-OF-ONE keyed on itself", () => {
    const units = billingUnits(
      [student("solo"), student("s1", { householdId: "H1" }), student("s2", { householdId: "H1" })],
      "PER_FAMILY",
    );
    expect(units).toContainEqual({ subjectStudentId: "solo", householdId: null });
    expect(units.filter((u) => u.householdId === "H1")).toHaveLength(1);
    expect(units).toHaveLength(2);
  });

  it("rank tie on enrolment falls back to the student id", () => {
    const members = [
      student("zeta", { householdId: "H", enrolledOn: "2023-09-01" }),
      student("alpha", { householdId: "H", enrolledOn: "2023-09-01" }),
    ];
    expect(representativeSibling(members)).toBe("alpha");
  });
});

// ──────────────────────────────────────────────────── idempotency keys (R462)

describe("duesChargeKey + filterNewUnits · idempotent generation (R462)", () => {
  const perStudent = { ptaId: "P", basis: "PER_STUDENT" as const, academicPeriodId: "T1", academicYear: "2025/26" };
  const perFamily = { ptaId: "P", basis: "PER_FAMILY" as const, academicPeriodId: null, academicYear: "2025/26" };

  it("PER_STUDENT keys on (pta, period, student); PER_FAMILY on (pta, year, household)", () => {
    expect(duesChargeKey({ ...perStudent, subjectStudentId: "s1", householdId: null })).toBe("P|PER_STUDENT|T1|s1");
    expect(duesChargeKey({ ...perFamily, subjectStudentId: "rep", householdId: "H1" })).toBe("P|PER_FAMILY|2025/26|H:H1");
    expect(duesChargeKey({ ...perFamily, subjectStudentId: "solo", householdId: null })).toBe("P|PER_FAMILY|2025/26|S:solo");
  });

  it("a re-run over ALREADY-billed units yields ZERO new (0 new on re-generate)", () => {
    const units = [
      { ...perStudent, subjectStudentId: "s1", householdId: null },
      { ...perStudent, subjectStudentId: "s2", householdId: null },
    ];
    const existing = new Set(units.map(duesChargeKey));
    expect(filterNewUnits(units, existing)).toEqual([]);
  });

  it("only the NEW units survive a partial re-run", () => {
    const units = [
      { ...perStudent, subjectStudentId: "s1", householdId: null },
      { ...perStudent, subjectStudentId: "s2", householdId: null },
    ];
    const existing = new Set([duesChargeKey(units[0])]);
    expect(filterNewUnits(units, existing)).toEqual([units[1]]);
  });
});

// ──────────────────────────────────────────── report read gate (R469 — no bare role)

describe("resolveDuesReportAccess · read gate (R469)", () => {
  it("management (ADMIN / HEADMASTER) reads school-wide", () => {
    expect(resolveDuesReportAccess({ roles: ["ADMIN"], treasurerPtaIds: [] })).toEqual({ canView: true, schoolWide: true, ptaIds: [] });
    expect(resolveDuesReportAccess({ roles: ["HEADMASTER"], treasurerPtaIds: [] }).schoolWide).toBe(true);
  });

  it("a Treasurer reads ONLY their own PTAs (scoped, not school-wide)", () => {
    expect(resolveDuesReportAccess({ roles: ["FORM_MASTER"], treasurerPtaIds: ["p1", "p2"] })).toEqual({
      canView: true,
      schoolWide: false,
      ptaIds: ["p1", "p2"],
    });
  });

  it("NO bare role alone — a TEACHER/PARENT with NO held Treasurer office sees nothing", () => {
    expect(resolveDuesReportAccess({ roles: ["TEACHER"], treasurerPtaIds: [] }).canView).toBe(false);
    expect(resolveDuesReportAccess({ roles: ["PARENT"], treasurerPtaIds: [] }).canView).toBe(false);
    expect(resolveDuesReportAccess({ roles: [], treasurerPtaIds: [] }).canView).toBe(false);
  });
});
