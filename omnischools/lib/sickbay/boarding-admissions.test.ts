import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * R225.2 (INCR-28a) — the boarding housemaster's sick-bay tile reader. It imports the DB driver
 * (server-only), so — exactly like medical-hold.test.ts — these are SOURCE-SHAPE assertions: the
 * disclosure boundary is a structural property of the projection, not something a superuser DB can
 * prove. Two things must hold:
 *   1. THE FROZEN KEY-SET — the projector `boardingSickbayRow` returns EXACTLY
 *      {studentId, studentName, admittedAt}. Mutation-killable: a clinical field spread onto the
 *      return object reds the key-set assertion below, not production.
 *   2. R41/R88 — the reader is NARROW: no `board-reads.ts` import, no clinical column token anywhere.
 */
const SRC = "lib/sickbay/boarding-admissions.ts";
const src = () => readCode(SRC);

/** The keys of the `return { ... }` object literal inside boardingSickbayRow. */
const projectorKeys = (): string[] => {
  const s = src();
  const from = s.indexOf("export function boardingSickbayRow");
  const rstart = s.indexOf("return {", from);
  const block = s.slice(rstart, s.indexOf("}", rstart)); // object literal has no nested braces
  return [...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
};

describe("🔴 R225.2 · boardingSickbayRow — the FROZEN key-set (mutation-killable)", () => {
  // AC-R225-6 — exactly the three keys, forever. Add a clinical field and this reds.
  it("AC-R225-6 · projects EXACTLY {studentId, studentName, admittedAt} — no clinical field", () => {
    expect(projectorKeys()).toEqual(["admittedAt", "studentId", "studentName"]);
  });

  it("abbreviates the name at the disclosure tier (`X. Last`), never the raw first name", () => {
    // The `A. Mensa` tier — same one-liner as every boarding reader (shortName).
    expect(src()).toMatch(/shortName = \(first: string, last: string\) => `\$\{first\.charAt\(0\)\}\. \$\{last\}`/);
    expect(src()).toMatch(/studentName: shortName\(raw\.firstName, raw\.lastName\)/);
  });

  // AC-R225-5 — >1 admissions: the reader maps EVERY row (name-all), never a slice/truncation.
  it("AC-R225-5 · maps every row (name-all), never truncates", () => {
    const s = src();
    expect(s).toMatch(/rows\.map\(boardingSickbayRow\)/);
    expect(s, "no A2-style truncation of the HM's own boarders").not.toMatch(/\.slice\(/);
  });
});

describe("🔴 R41/R88 · the reader is narrow — no board-reads import, no clinical token", () => {
  it("imports NOTHING from board-reads.ts (the wide clinical projection)", () => {
    expect(src()).not.toMatch(/board-reads/);
  });

  it("carries no clinical column anywhere in the file", () => {
    const s = src();
    for (const token of [
      "presentingComplaint",
      "workingImpression",
      "hydrationStatus",
      "sickbayBed",
      "sickbayVitalReading",
      "isIsolation",
      "diagnosis",
      "complaint",
    ]) {
      expect(s, `${token} must not appear`).not.toContain(token);
    }
  });

  it("reads sickbay_admission scoped by school and OPEN (discharged_at IS NULL), ∩ this house's boarders", () => {
    const s = src();
    expect(s).toContain("sickbayAdmission");
    expect(s).toMatch(/isNull\(sickbayAdmission\.dischargedAt\)/);
    expect(s).toMatch(/inArray\(sickbayAdmission\.studentId/);
  });
});
