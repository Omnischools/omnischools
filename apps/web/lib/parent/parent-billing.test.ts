import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import { billStatus, ghs } from "./parent-billing-data";

/**
 * INCR-BILL · parent-portal Billing ("Fees") tab. Under narrow parent_scope grants (option a) the reader
 * PROJECTION is the sole column guard, so source-shape locks the deny-list hardest. Plus the pure status +
 * money derivations.
 */

describe("billStatus · pure derivation (AC-BILL-08)", () => {
  it("EXEMPT → Covered (a real zero balance, never a fabricated bill)", () => {
    expect(billStatus("EXEMPT", 0, 0, false)).toBe("Covered");
  });
  it("outstanding ≤ 0 → Paid (paid-up beats an overdue flag)", () => {
    expect(billStatus("PAID", 300, 0, true)).toBe("Paid");
  });
  it("outstanding > 0 and overdue (full day past due) → Overdue", () => {
    expect(billStatus("ISSUED", 0, 100, true)).toBe("Overdue");
  });
  it("outstanding > 0, some paid, not overdue → Partly paid", () => {
    expect(billStatus("PARTIAL", 200, 100, false)).toBe("Partly paid");
  });
  it("outstanding > 0, nothing paid, not overdue → Unpaid", () => {
    expect(billStatus("ISSUED", 0, 300, false)).toBe("Unpaid");
  });
});

describe("ghs · money format", () => {
  it("groups thousands and pads 2dp", () => {
    expect(ghs(1234.5)).toBe("GHS 1,234.50");
    expect(ghs(0)).toBe("GHS 0.00");
  });
});

describe("parent-billing-data · column guard under narrow grants (AC-BILL-04/05/22)", () => {
  const reader = () => readCode("lib/parent/parent-billing-data.ts");

  it("runs under withParentScope only — never withSchool / withoutTenantScope", () => {
    const s = reader();
    expect(s).toMatch(/withParentScope/);
    expect(s).not.toMatch(/withSchool|withoutTenantScope/);
  });

  it("excludes DRAFT + VOIDED invoices (issued reality only)", () => {
    const s = reader();
    expect(s).toMatch(/ne\(invoices\.status, "DRAFT"\)/);
    expect(s).toMatch(/ne\(invoices\.status, "VOIDED"\)/);
    expect(s).toMatch(/isNull\(invoices\.voidedAt\)/);
  });

  it("never selects the confidential payment/invoice/receipt columns (target real Drizzle refs)", () => {
    const s = reader();
    for (const col of [
      /payments\.netAmount/,
      /payments\.feeAmount/,
      /payments\.aggregator/,
      /payments\.settlementStatus/,
      /payments\.methodReference/,
      /payments\.recordedByUserId/,
      /payments\.voidedByUserId/,
      /payments\.voidReason/,
      /invoices\.subtotalAmount/,
      /receipts\.pdfUrl/,
    ]) {
      expect(s).not.toMatch(col);
    }
  });

  it("never touches the never-widen mechanic/config/audit tables", () => {
    const s = reader();
    // these Drizzle table symbols are never imported/used (comments name them only in snake_case)
    expect(s).not.toMatch(/paymentAllocations/);
    expect(s).not.toMatch(/invoiceDiscountApplications/);
    expect(s).not.toMatch(/\bdiscounts\b/); // the discount SCHEME table (plural) — the scalar is invoices.discountAmount
    expect(s).not.toMatch(/discountTiers/);
    expect(s).not.toMatch(/paymentAuditLog/);
    expect(s).not.toMatch(/feeStructures|feeStructureItems/);
    expect(s).not.toMatch(/feeCategories/);
  });
});

describe("parent-chrome / page · Fees is the 7th live tab, read-only (AC-BILL-23)", () => {
  const nav = () => readCode("app/(parent)/parent-chrome.tsx");
  const page = () => readCode("app/(parent)/statement/page.tsx");

  it("Fees is a live tab at /statement, still no inert span", () => {
    const s = nav();
    expect(s).toMatch(/"Fees"/); // present in TABS + the ParentTab union
    expect(s).toMatch(/Fees: "\/statement"/);
    expect(s).not.toMatch(/Partial<Record/);
    expect((s.match(/<span/g) ?? []).length).toBe(1);
  });

  it("the statement route is a read-only server component with an active nav + child gate", () => {
    const s = page();
    expect(s).toMatch(/ParentNav active="Fees"/);
    expect(s).toMatch(/NoChild/);
    expect(s).not.toMatch(/^"use client"/m); // read-only server component
    expect(s).not.toMatch(/Pay now|sendSms|gateway|checkout/i); // no payment gateway / write path
  });
});
