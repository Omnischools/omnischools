import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";

/**
 * WASSCE setup-page honesty sweep (Kofi's AC-SETUP-*). The page showed every teacher a mix of fabricated
 * data as this cohort's own: fake personas (Mr S. Asiedu, A. Quartey, P. Donkor), hardcoded amounts
 * (GHS 1,400 / GHS 240), a hardcoded "11 cross-module integrations active" count, a static mock tile
 * (2 / Nov 2025 / Mar 2026), a hardcoded 98.8%/Feb-2026, and an unperformed cut-off "re-verified" claim.
 * Fixed: real personas/counts genericised or derived from the reader (medicalFlags/nhisFlags/confirmedPct,
 * formatGhs(WAEC_FEE_PER_CANDIDATE)); unsourced specifics omitted. This locks it.
 */
const page = readFileSync(resolve(cwd(), "app/(app)/senior/wassce/setup/page.tsx"), "utf8");
const reader = readFileSync(resolve(cwd(), "lib/wassce/setup-data.ts"), "utf8");

describe("WASSCE setup · fabrications gone (AC-SETUP-*)", () => {
  it("no fabricated persona / amount / count / date is rendered as this cohort's fact", () => {
    for (const fake of [
      "Asiedu",
      "Quartey",
      "Donkor",
      "GHS 1,400",
      "GHS 240",
      "11 cross-module",
      "Mock 2 results posted",
      "98.8",
      "Feb 2026",
      "Nov 2025",
      "Mar 2026",
      "F3 SCI 1",
      "0 outstanding",
      "fee flags",
    ]) {
      expect(page, `fabricated "${fake}" must be gone`).not.toContain(fake);
    }
    // the cut-off note no longer asserts an unperformed portal re-verification.
    expect(page).not.toMatch(/re-verified from\s*\n?\s*every university/);
  });

  it("counts/amounts DERIVE from the reader or a policy constant (AC-SETUP-04/13)", () => {
    expect(page).toMatch(/formatGhs\(WAEC_FEE_PER_CANDIDATE\)/); // WAEC fee from the single constant
    expect(page).toMatch(/const confirmedPct =/); // confirmed % derived, not "98.8"
    expect(page).toMatch(/\{confirmedPct\}%/);
    expect(page).toMatch(/\{counts\.medicalFlags\}/); // flag split derived, not "1 medical · 2 NHIS"
    expect(page).toMatch(/\{counts\.nhisFlags\}/);
  });

  it("the reader exposes the derived flag split (AC-SETUP-13a)", () => {
    expect(reader).toMatch(/medicalFlags = candRows\.filter\(\(c\) => c\.regFlag === "ON_MEDICAL"\)/);
    expect(reader).toMatch(/nhisFlags = candRows\.filter\(\(c\) => c\.regFlag === "NHIS_ISSUE"\)/);
    expect(reader).toMatch(/medicalFlags: number/);
  });

  it("the generic explainers survive (regression — don't over-delete; AC-SETUP-03/07)", () => {
    expect(page).toContain("subject-view surface keys off this"); // §1.6 teachers generic copy
    expect(page).toContain("DRAFT WAEC SC-12"); // §4.6 Sickbay card generic explainer kept
    expect(page).toContain("no candidate can be denied WASSCE for fee reasons"); // §4.6 billing generic
  });
});
