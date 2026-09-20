import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import {
  hasAnyRole,
  SICKBAY_CLINICAL_READ_ROLES,
  SICKBAY_RECON_READ_ROLES,
} from "@/lib/access";

/**
 * INCR-27 · Quinn AC (Q7–Q18) — the source-shape guards the runtime cannot pin without a DB + a
 * session per role. Each `expect` reds the day a leak the increment exists to prevent is smuggled in:
 * a student named in the counts-only outbreak monitor, a clinical field joined into the finance recon,
 * the forbidden card-health matrix, an invoice write, or a broken read gate.
 */
const SURV_READS = "lib/sickbay/surveillance-reads.ts";
const REF_READS = "lib/sickbay/referral-reads.ts";
const VISIT_ACTION = "lib/actions/sickbay-visit.ts";
const OUTBREAK_PAGE = "app/(app)/senior/sickbay/today/outbreak/page.tsx";
const HISTORY_PAGE = "app/(app)/senior/sickbay/referrals/history/page.tsx";
const RECON_PAGE = "app/(app)/senior/sickbay/referrals/reconciliation/page.tsx";

// The forbidden STPSHS card-health matrix cells (R182/R220) — none may appear on the recon surface.
const CARD_HEALTH_CELLS = ["1,108", "1,200", "92.3", "card health", "card-health", "SMS campaign", "No card on file"];

// ============================================================================
// Q7 · the outbreak monitor is COUNTS-ONLY — no student anywhere in the reader or the page.
// ============================================================================
describe("🔴 Q7 · the outbreak monitor names no student", () => {
  it("the reader carries no student column (counts-only by construction)", () => {
    const s = readCode(SURV_READS);
    for (const t of ["students", "studentId", "studentName", "firstName", "lastName", "studentCode", "presentingComplaint"]) {
      expect(s.includes(t), `outbreak reader leaks student token "${t}"`).toBe(false);
    }
    // It selects only the surveillance category + the timestamp.
    expect(s).toContain("surveillanceCategory");
    expect(s).toContain("presentedAt");
  });

  it("the page renders no student field", () => {
    const s = readCode(OUTBREAK_PAGE);
    for (const t of ["studentName", "firstName", ".student", "studentCode"]) {
      expect(s.includes(t), `outbreak page renders student token "${t}"`).toBe(false);
    }
  });
});

// ============================================================================
// Q9 · the history "Diagnosis" column = the visit's LIVE working_impression (R190).
// ============================================================================
describe("🔴 Q9 · the 30-day history Diagnosis column is the live working_impression", () => {
  it("the history reader selects the visit's working_impression + surveillance_category via the join", () => {
    const s = readCode(REF_READS);
    const region = s.slice(
      s.indexOf("export async function getReferralHistory"),
      s.indexOf("async function costLinesFor"),
    );
    expect(region, "history region must exist before costLinesFor").not.toBe("");
    expect(region).toContain("sickbayVisit.workingImpression");
    expect(region).toContain("sickbayVisit.surveillanceCategory");
  });

  it("the history page prints the working_impression under the Diagnosis header, not the category", () => {
    const s = readCode(HISTORY_PAGE);
    expect(s).toContain('"Diagnosis"');
    expect(s).toContain("r.workingImpression");
    // The surveillance category is a counts-only mix input on this page — never printed as the row's condition.
    expect(s.includes("SURVEILLANCE_CATEGORY_META")).toBe(false);
  });
});

// ============================================================================
// Q15/Q16 · the recon read joins NO clinical field; the card-health matrix is ABSENT (every cell).
// ============================================================================
describe("🔴 Q15/Q16 · the NHIS reconciliation is structurally clinical-free + the matrix is absent", () => {
  const reconRegion = () => {
    const s = readCode(REF_READS);
    return s.slice(s.indexOf("export async function getNhisReconciliation"));
  };

  it("the recon reader joins no visit and no clinical column", () => {
    const region = reconRegion();
    expect(region, "recon region must exist").not.toBe("");
    for (const t of ["sickbayVisit", "workingImpression", "surveillanceCategory", "presentingComplaint", "mensesNote"]) {
      expect(region.includes(t), `recon reader leaks clinical token "${t}"`).toBe(false);
    }
    // It reads only the diagnosis-free cost lines + the referral/student rows.
    expect(region).toContain("sickbayReferralCostLine");
  });

  it("R182 · the recon reader runs no roll-up over student_nhis_card", () => {
    const region = reconRegion();
    expect(region.includes("studentNhisCard"), "recon reader must not touch the card table").toBe(false);
    expect(/\bcount\w*\s*\(/i.test(region), "a card-health aggregate crept into the recon reader").toBe(false);
  });

  it("the recon page renders none of the forbidden card-health matrix cells", () => {
    const s = readCode(RECON_PAGE);
    for (const cell of CARD_HEALTH_CELLS) {
      expect(s.includes(cell), `the forbidden card-health cell "${cell}" is on the recon surface`).toBe(false);
    }
  });
});

// ============================================================================
// Q14 · no invoice write, no SMS — on the recon reader or the recon page.
// ============================================================================
describe("🔴 Q14 · the reconciliation writes no invoice and dispatches no SMS", () => {
  it("neither the recon reader nor the page sets billing_line_item_id (D6 — stays NULL)", () => {
    const region = readCode(REF_READS).slice(readCode(REF_READS).indexOf("export async function getNhisReconciliation"));
    expect(region.includes("billingLineItemId"), "recon reader must not set the billing FK").toBe(false);
    expect(readCode(RECON_PAGE).includes("billingLineItemId"), "recon page must not set the billing FK").toBe(false);
  });

  it("the recon reader dispatches no notification / SMS", () => {
    const region = readCode(REF_READS).slice(readCode(REF_READS).indexOf("export async function getNhisReconciliation"));
    for (const t of ["sickbayNotification", "notificationLog", "hubtel", "sendSms"]) {
      expect(region.toLowerCase().includes(t.toLowerCase()), `recon reader touches "${t}"`).toBe(false);
    }
  });
});

// ============================================================================
// Q1/F-27A · the surveillance category is required at assessment, nullable in the DB.
// ============================================================================
describe("🔴 F-27A · category required at assessment, nullable in the DB", () => {
  it("assessVisit requires the category (z.enum, not nullish) and writes it", () => {
    const s = readCode(VISIT_ACTION);
    expect(s).toMatch(/surveillanceCategory:\s*z\.enum\(SURVEILLANCE_CATEGORY_VALUES\)/);
    expect(s).toContain("surveillanceCategory: d.surveillanceCategory");
  });

  it("the DB column stays nullable — no .notNull() on surveillance_category (app-layer requiredness only)", () => {
    const schema = readCode("db/schema/sickbay.ts");
    const m = /surveillanceCategory:\s*sickbaySurveillanceCategoryEnum\("surveillance_category"\)([^,]*)/.exec(schema);
    expect(m, "the surveillance_category column must exist on sickbay_visit").not.toBeNull();
    expect(m![1].includes("notNull"), "surveillance_category must be nullable in the DB (F-27A)").toBe(false);
  });
});

// ============================================================================
// Q13/Q17/Q18 · the read gates — outbreak/history clinical, recon finance, gate before fetch.
// ============================================================================
describe("🔴 the read gates: outbreak/history clinical, recon finance, gate precedes fetch", () => {
  it("the gate role sets are what the increment specifies", () => {
    // Outbreak + history are clinical (HEADMASTER + MATRON, NOT ADMIN).
    expect([...SICKBAY_CLINICAL_READ_ROLES]).toEqual(["HEADMASTER", "MATRON"]);
    expect(hasAnyRole(["ADMIN"], SICKBAY_CLINICAL_READ_ROLES)).toBe(false);
    // Recon is finance + matron, and a BURSAR reads it clinical-free.
    expect([...SICKBAY_RECON_READ_ROLES]).toEqual(["ACCOUNTANT", "BURSAR", "MATRON"]);
    expect(hasAnyRole(["BURSAR"], SICKBAY_RECON_READ_ROLES)).toBe(true);
    // The BURSAR is NOT a clinical reader — the history's condition column is not finance-readable.
    expect(hasAnyRole(["BURSAR"], SICKBAY_CLINICAL_READ_ROLES)).toBe(false);
    // …and the HEADMASTER (clinical) is NOT on the money view.
    expect(hasAnyRole(["HEADMASTER"], SICKBAY_RECON_READ_ROLES)).toBe(false);
  });

  it("outbreak + history gate the clinical fetch behind SICKBAY_CLINICAL_READ_ROLES, before the reader", () => {
    for (const [page, fetch] of [
      [OUTBREAK_PAGE, "getOutbreakMonitor("],
      [HISTORY_PAGE, "getReferralHistory("],
    ] as const) {
      const s = readCode(page);
      const gate = s.search(/SICKBAY_CLINICAL_READ_ROLES\)\)\s*return\s*<ClinicalRestricted/);
      expect(gate, `${page}: clinical gate must exist`).toBeGreaterThan(-1);
      expect(gate, `${page}: gate must precede the reader`).toBeLessThan(s.indexOf(fetch));
    }
  });

  it("the recon page gates on the finance set before the reader, and gives no History/case link to a non-clinical reader", () => {
    const s = readCode(RECON_PAGE);
    const gate = s.indexOf("requireSchoolRole(SICKBAY_RECON_READ_ROLES)");
    expect(gate, "recon page must gate on the recon set").toBeGreaterThan(-1);
    expect(gate, "gate must precede the reader").toBeLessThan(s.indexOf("getNhisReconciliation("));
    // The "View case" drill-in and the History tab are clinical-gated by canViewCase.
    expect(s).toContain("canViewCase");
    expect(s).toMatch(/showHistory=\{canViewCase\}/);
  });
});
