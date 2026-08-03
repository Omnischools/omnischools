import { describe, it, expect } from "vitest";
import {
  validateTerminalRows,
  examTypesFor,
  TERMINAL_IMPORT_HEADERS,
} from "./terminal-results-import";

/**
 * GOV-6 · CSV import validator (AC GOV6-15/16/17). Pure — no DB, no mocks. Proves the exact header (no
 * candidate column), the REJECT-NOT-FABRICATE contract (bad rows flagged, good rows still importable),
 * per-sex bounds, zero-candidate/year sanity, and the tier gate.
 */

const NOW = new Date("2026-08-03T00:00:00Z"); // pin so the year window is deterministic

describe("GOV6-15 · template header", () => {
  it("is exactly the leaf columns + optional note — NO candidate-identifying column", () => {
    expect(TERMINAL_IMPORT_HEADERS).toEqual([
      "exam_type",
      "year",
      "female_candidates",
      "male_candidates",
      "female_passed",
      "male_passed",
      "note",
    ]);
  });
});

describe("examTypesFor · tier → offered exams (R367)", () => {
  it("BASIC → BECE only; SENIOR → WASSCE only; COMBINED → both", () => {
    expect(examTypesFor("BASIC")).toEqual(["BECE"]);
    expect(examTypesFor("SENIOR")).toEqual(["WASSCE"]);
    expect(examTypesFor("COMBINED")).toEqual(["BECE", "WASSCE"]);
  });
});

describe("validateTerminalRows", () => {
  it("GOV6-16 · rejects invalid rows but keeps the valid ones importable", () => {
    const { rows, summary } = validateTerminalRows(
      [
        ["BECE", "2025", "58", "62", "51", "49", "ok"], // valid
        ["JHS", "2025", "10", "10", "5", "5", ""], // bad exam_type
        ["WASSCE", "2025", "5", "5", "9", "1", ""], // female_passed > female_candidates
      ],
      "COMBINED",
      NOW,
    );
    expect(summary).toEqual({ total: 3, ready: 1, error: 2 });
    expect(rows[0].errors).toEqual([]);
    expect(rows[1].errors[0]).toMatch(/exam_type/);
    expect(rows[2].errors.join(" ")).toMatch(/female_passed/);
  });

  it("GOV6-17 · a WASSCE row is rejected for a BASIC school (wrong tier); BECE is accepted", () => {
    const wrong = validateTerminalRows([["WASSCE", "2025", "5", "5", "4", "4", ""]], "BASIC", NOW);
    expect(wrong.rows[0].errors.join(" ")).toMatch(/wrong tier/i);

    const ok = validateTerminalRows([["BECE", "2025", "5", "5", "4", "4", ""]], "BASIC", NOW);
    expect(ok.rows[0].errors).toEqual([]);
  });

  it("rejects negatives, non-integers, zero-candidate sittings and out-of-range years", () => {
    const { rows } = validateTerminalRows(
      [
        ["BECE", "2025", "-1", "5", "0", "0", ""], // negative
        ["BECE", "2025", "5.5", "5", "0", "0", ""], // non-integer
        ["BECE", "2025", "0", "0", "0", "0", ""], // zero candidates
        ["BECE", "1980", "5", "5", "4", "4", ""], // year out of range
      ],
      "COMBINED",
      NOW,
    );
    expect(rows.every((r) => r.errors.length > 0)).toBe(true);
    expect(rows[2].errors.join(" ")).toMatch(/at least one candidate/i);
    expect(rows[3].errors.join(" ")).toMatch(/year/i);
  });
});
