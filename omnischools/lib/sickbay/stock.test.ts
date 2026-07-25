import { describe, it, expect } from "vitest";
import {
  controlledMovementWitnessError,
  deriveControlledBalance,
  reorderCount,
  stockStatus,
  type StockItemView,
} from "./stock";

// 🔴 R152/D5.3 — the controlled-movement witness rule, the accountability that justifies the whole
// controlled layer. Quinn (24a MINOR-2) proved a `&& false` mutation disabling the WASTAGE-needs-a-
// witness refusal passed the source-shape authz suite. This pins the pure decision the action calls.
describe("R152/D5.3 · controlledMovementWitnessError — the diversion-control decision", () => {
  it("WASTAGE without a witness → MISSING_WITNESS (the require rule — the mutation target)", () => {
    expect(controlledMovementWitnessError("WASTAGE", null, "actor")).toBe("MISSING_WITNESS");
  });
  it("RECEIPT / ADJUSTMENT without a witness → null (only wastage requires one)", () => {
    expect(controlledMovementWitnessError("RECEIPT", null, "actor")).toBeNull();
    expect(controlledMovementWitnessError("ADJUSTMENT", null, "actor")).toBeNull();
  });
  it("witness === actor → SELF_WITNESS, for any movement (no self-witness)", () => {
    expect(controlledMovementWitnessError("WASTAGE", "x", "x")).toBe("SELF_WITNESS");
    expect(controlledMovementWitnessError("RECEIPT", "x", "x")).toBe("SELF_WITNESS");
  });
  it("WASTAGE with a DISTINCT witness → null (the happy path; N&MC/tenancy is the action's DB check)", () => {
    expect(controlledMovementWitnessError("WASTAGE", "witness", "actor")).toBeNull();
  });
});

describe("R161 · stockStatus — DERIVED from qty vs reorder point, reproducing the surface's 12 pills", () => {
  it("REORDER when strictly below the reorder point (terra)", () => {
    expect(stockStatus(8, 14)).toBe("REORDER"); // Hydroxyurea 8/14
    expect(stockStatus(2, 3)).toBe("REORDER"); // Calamine 2/3
  });

  it("LOW within the 1.25 margin above the reorder point (warn)", () => {
    expect(stockStatus(14, 12)).toBe("LOW"); // AL 14/12 (≤ 15)
    expect(stockStatus(22, 20)).toBe("LOW"); // RDT 22/20 (≤ 25)
    expect(stockStatus(12, 12)).toBe("LOW"); // exactly at the point is LOW, not REORDER
  });

  it("OK comfortably above the margin, and when no reorder point is set", () => {
    expect(stockStatus(412, 200)).toBe("OK"); // Paracetamol
    expect(stockStatus(3, 2)).toBe("OK"); // Salbutamol 3/2 (> 2.5)
    expect(stockStatus(4, 2)).toBe("OK"); // Povidone 4/2 (> 2.5)
    expect(stockStatus(0, null)).toBe("OK"); // nothing to be below
  });
});

describe("N-DIV-1 · reorderCount is DERIVED — the surface's fabricated '3' is not stored", () => {
  const items = [
    { qtyOnHand: 8, reorderPoint: 14 }, // REORDER
    { qtyOnHand: 2, reorderPoint: 3 }, // REORDER
    { qtyOnHand: 14, reorderPoint: 12 }, // LOW
    { qtyOnHand: 412, reorderPoint: 200 }, // OK
    { qtyOnHand: 5, reorderPoint: null }, // OK (no point)
  ];
  it("counts exactly the rows below their reorder point — 2, not the surface's 3", () => {
    expect(reorderCount(items)).toBe(2);
  });
  it("is 0 when nothing is below its point", () => {
    expect(reorderCount([{ qtyOnHand: 100, reorderPoint: 10 }])).toBe(0);
  });
});

describe("R152 · deriveControlledBalance — receipts + adjustments(±) − wastage − administered", () => {
  it("a receipt then a wastage, MAR term 0 at 24a", () => {
    // 50 received, 3 wasted, no MAR administrations yet → 47.
    expect(
      deriveControlledBalance({ receipt: 50, wastage: 3, adjustment: 0, administered: 0 }),
    ).toBe(47);
  });

  it("a negative ADJUSTMENT lowers the balance; a positive one raises it (the ±)", () => {
    expect(deriveControlledBalance({ receipt: 50, wastage: 0, adjustment: -4, administered: 0 })).toBe(46);
    expect(deriveControlledBalance({ receipt: 50, wastage: 0, adjustment: 6, administered: 0 })).toBe(56);
  });

  it("🔴 the MAR term deducts controlled GIVEN administrations (the 24b contribution, live now)", () => {
    // Proves the JOINed MAR term is real: 100 received − 12 administered − 2 wasted = 86.
    expect(
      deriveControlledBalance({ receipt: 100, wastage: 2, adjustment: 0, administered: 12 }),
    ).toBe(86);
  });

  it("a balance can go negative — a reconciliation error the register renders in terra", () => {
    expect(
      deriveControlledBalance({ receipt: 5, wastage: 8, adjustment: 0, administered: 0 }),
    ).toBe(-3);
  });
});

describe("Risk-4 · the StockItemView type carries no student field (compile-pinned)", () => {
  it("a stock row is form + quantity + flags — never a patient", () => {
    const row: StockItemView = {
      id: "x",
      drugName: "Hydroxyurea",
      formLabel: "500mg tablet",
      unit: "tablets",
      qtyOnHand: 8,
      reorderPoint: 14,
      lastRestockedAt: null,
      isControlled: true,
      active: true,
      status: "REORDER",
    };
    // The keys are exhaustive and student-free — a `studentId`/`studentName` addition is a type error.
    expect(Object.keys(row).sort()).toEqual(
      [
        "active",
        "drugName",
        "formLabel",
        "id",
        "isControlled",
        "lastRestockedAt",
        "qtyOnHand",
        "reorderPoint",
        "status",
        "unit",
      ].sort(),
    );
  });
});
