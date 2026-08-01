import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * 🔴 R472 (INCR-54a) — the ONE non-additive money-critical edit, proven at the SOURCE-SHAPE layer (a
 * behavioural proof needs two committed invoice sets + a DB the pure suite can't stage; the live preview
 * carries that, see the PR notes). PTA dues sit on a DEDICATED invoice bridged 1:1 by `pta_dues_charge`;
 * the tuition skip-existence check in BOTH callers must EXCLUDE those dues invoices, or generating dues
 * makes tuition issuance skip the student (UNDER-BILL). Removing the `notADuesInvoice` predicate from
 * either caller reds this test — the mutation the guard exists to catch.
 */

/** Slice a named `export async function` body out to the next top-level export. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  if (start === -1) throw new Error(`fn ${name} not found`);
  const rest = src.slice(start + 1);
  const nextExport = rest.search(/\nexport (?:async function|const|default|type)/);
  return rest.slice(0, nextExport === -1 ? undefined : nextExport);
}

describe("R472 · a PTA-dues invoice must NOT suppress tuition issuance", () => {
  const src = () => readCode("lib/actions/billing.ts");

  it("the shared exclusion predicate references the dues bridge (the dues marker)", () => {
    const s = src();
    const at = s.indexOf("const notADuesInvoice");
    expect(at, "notADuesInvoice predicate is defined").toBeGreaterThan(-1);
    expect(s.slice(at, at + 400)).toContain("ptaDuesCharge");
    expect(s.slice(at, at + 400).toLowerCase()).toContain("not exists");
  });

  for (const fn of ["generateInvoicesForClass", "issueAllInvoices"] as const) {
    it(`${fn} applies the dues exclusion to its tuition skip-existence check`, () => {
      const body = fnBody(src(), fn);
      // the skip query must carry the exclusion predicate…
      expect(body, `${fn} references notADuesInvoice`).toContain("notADuesInvoice");
      // …and the exclusion must sit inside the existence check, before the skip decision.
      const pred = body.indexOf("notADuesInvoice");
      const skip = body.indexOf("skipped++");
      expect(pred, "predicate present").toBeGreaterThan(-1);
      expect(skip, "skip decision present").toBeGreaterThan(-1);
      expect(pred).toBeLessThan(skip);
    });
  }
});

describe("R468 · cross-category is EXISTENCE-ONLY (never the other-category amount)", () => {
  const src = () => readCode("lib/pta/dues-data.ts");

  it("the aged queue exposes a hasOtherArrears BOOLEAN via EXISTS, not an amount", () => {
    const s = src();
    expect(s).toContain("hasOtherArrears");
    // the cross-category detection is an EXISTS existence check…
    expect(s.toLowerCase()).toContain("exists (");
    // …and NO other-category amount is ever selected or surfaced.
    expect(s).not.toContain("otherArrearsAmount");
    expect(s).not.toContain("otherBalance");
    expect(s).not.toContain("otherCategoryAmount");
  });
});
