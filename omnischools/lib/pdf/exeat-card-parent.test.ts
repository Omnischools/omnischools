import { describe, it, expect } from "vitest";
import { renderExeatCardPdf } from "./render-exeat-card";
import type { ExeatCardPdfData } from "./exeat-card-document";

/**
 * EXEAT PHASE 3-A · A1 non-leak at the RENDERED-card boundary. The parent route builds the card WITHOUT
 * feeLine and WITHOUT signerActor (parent_exeat_card omits the fee snapshot + the signer staff name), so the
 * document must render NEITHER the Fee row NOR a "signed · <name>" line — the staff card still passes both
 * and renders them (A2). @react-pdf text is flate-compressed, so it isn't greppable; we prove omit-not-fake
 * the board-pack-render.test.ts way — the parent PDF (rows DROPPED) is strictly SMALLER than a card that
 * carries the same field. A future edit that renders Fees/signer unconditionally makes the parent card grow
 * to match, and the `<` assertions bite. The null-vs-undefined split on signerActor is exercised explicitly:
 * `null` (staff, pending) STILL renders "signed · pending"; absent (parent) renders no signer line at all.
 */

const base: Omit<ExeatCardPdfData, "feeLine" | "signerActor"> = {
  school: { name: "Test Memorial SHS", code: "WR-WAW-014" },
  refCode: "WAW-EX-2026-0001",
  studentName: "Ama Mensah",
  formHouseBunk: "SHS 2 Science · Unity", // no bunk on the parent card (fn omits it)
  typeLabel: "Special",
  dateOut: "05 Sep 2026 · 14:00",
  dateIn: "07 Sep 2026 · 18:00",
  dressCode: "Full school uniform",
  signerLabel: "Senior Housemaster",
  houseName: "Unity",
  academicYear: "2025/26",
};

const parentCard: ExeatCardPdfData = { ...base }; // feeLine + signerActor deliberately ABSENT
const feeOnly: ExeatCardPdfData = { ...base, feeLine: "GHS 340.00 outstanding — settle before return" };
const signerNull: ExeatCardPdfData = { ...base, signerActor: null }; // staff pending → "signed · pending"

describe("A1 · the parent card renders neither the Fee row nor the signer name", () => {
  it("every variant renders to a valid %PDF buffer (a tsc-clean tree can still throw at render)", async () => {
    for (const d of [parentCard, feeOnly, signerNull]) {
      const pdf = await renderExeatCardPdf(d);
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    }
  });

  it("A1 — the Fee row is DROPPED when feeLine is absent (parent card strictly smaller than a fee-bearing card)", async () => {
    const [parent, withFee] = await Promise.all([
      renderExeatCardPdf(parentCard),
      renderExeatCardPdf(feeOnly),
    ]);
    expect(parent.length).toBeLessThan(withFee.length);
  });

  it("A1/A2 — the signer line is DROPPED when signerActor is absent, but RENDERED when null (staff pending)", async () => {
    const [parent, pending] = await Promise.all([
      renderExeatCardPdf(parentCard),
      renderExeatCardPdf(signerNull),
    ]);
    // absent (undefined) ⇒ no signer line; null ⇒ "signed · pending" still renders ⇒ larger.
    expect(parent.length).toBeLessThan(pending.length);
  });
});
