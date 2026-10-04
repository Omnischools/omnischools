import { describe, expect, it } from "vitest";
import { classFormOf, stageOf } from "@/lib/etl/stage";

/**
 * THE STAGE MAPPING TABLE, as a pure unit test (Kofi H9 criteria 1–2).
 *
 * `lib/etl/stage.ts` is the whole of `fact_enrolment`'s correctness that can be checked without a
 * database: every headcount in the table is filed under the stage this module returns, and the
 * enrolment-vs-population rate divides it by the GSS band that stage names. A Basic 8 class read as
 * PRIMARY divides 13-year-olds by the 6–11 population — a wrong number with no visible defect — so the
 * table below is written out case by case rather than summarised.
 *
 * The end-to-end half (these labels really do reach these rows in `fact_enrolment`, from real demo
 * data) is in `tests/etl-enrolment.test.ts`.
 */

describe("stageOf / classFormOf — the mapping table (criteria 1–2)", () => {
  /** [level, name, stage, class_form] — the table, one row per case. */
  const CASES: [string | null, string | null, string, string | null][] = [
    // ── KG ────────────────────────────────────────────────────────────────────────────────────
    ["KG 1", "KG 1", "KG", "KG1"],
    ["KG 2", "KG 2 B", "KG", "KG2"],
    ["Kindergarten 1", "Kindergarten 1", "KG", "KG1"],
    ["Kinder 2", "Kinder 2", "KG", "KG2"],
    // NO SPACE. "KG2" / "JHS2" are everyday real labels, and the naive `\bKG\b` does not match them —
    // see the lookahead note in lib/etl/stage.ts.
    ["kg2", "kg2", "KG", "KG2"],
    ["KG1A", "KG1A", "KG", "KG1"],
    // KG only goes to 2. A "KG 3" is not a KG year group, and inventing one would put children in a
    // band `dim_stage` does not describe.
    ["KG 3", "KG 3", "UNMAPPED", null],

    // ── PRIMARY ───────────────────────────────────────────────────────────────────────────────
    ["Primary 1", "Primary 1", "PRIMARY", "P1"],
    ["Primary 6", "Primary 6 A", "PRIMARY", "P6"],
    ["Pri 3", "Pri 3", "PRIMARY", "P3"],
    // "Class 4" is how a great many Ghanaian basic schools write Primary 4 (criterion 2).
    ["Class 4", "Class 4", "PRIMARY", "P4"],
    ["Class 1 B", "Class 1 B", "PRIMARY", "P1"],
    ["P4", "P4", "PRIMARY", "P4"],
    ["p 5", "p 5", "PRIMARY", "P5"],
    ["Primary 7", "Primary 7", "UNMAPPED", null],

    // ── BASIC 1–6 → PRIMARY, BASIC 7–9 → JHS (the correction; criteria 1–2) ───────────────────
    ["Basic 1", "Basic 1", "PRIMARY", "P1"],
    ["Basic 6", "Basic 6", "PRIMARY", "P6"],
    ["Basic 7", "Basic 7", "JHS", "JHS1"],
    ["Basic 8", "Basic 8 A", "JHS", "JHS2"],
    ["Basic 9", "Basic 9", "JHS", "JHS3"],
    // Basic stops at 9 (JHS 3). Basic 10 is not a GES designation.
    ["Basic 10", "Basic 10", "UNMAPPED", null],

    // ── JHS ───────────────────────────────────────────────────────────────────────────────────
    ["JHS 1", "JHS 1 A", "JHS", "JHS1"],
    ["JHS 3", "JHS 3", "JHS", "JHS3"],
    ["JSS 2", "JSS 2", "JHS", "JHS2"],
    ["J.H.S 1", "J.H.S 1", "JHS", "JHS1"],
    ["jhs2", "jhs2", "JHS", "JHS2"],
    ["JHS 4", "JHS 4", "UNMAPPED", null],

    // ── SHS — "Form" is ALWAYS senior, never a junior form (criterion 2) ───────────────────────
    ["Form 1", "Form 1 General Arts", "SHS", "Form 1"],
    ["Form 2", "Form 2 Science A", "SHS", "Form 2"],
    ["Form 3", "Form 3 Business", "SHS", "Form 3"],
    ["SHS 1", "SHS 1", "SHS", "Form 1"],
    ["SSS 3", "SSS 3", "SHS", "Form 3"],
    ["S.H.S 2", "S.H.S 2", "SHS", "Form 2"],
    ["Form 4", "Form 4", "UNMAPPED", null],

    // ── OUT_OF_SCOPE — below KG. Real children, no stage, no population band. ──────────────────
    ["Nursery 1", "Nursery 1", "OUT_OF_SCOPE", null],
    ["Nursery", "Nursery", "OUT_OF_SCOPE", null],
    ["Creche", "Creche", "OUT_OF_SCOPE", null],
    ["Crèche 2", "Crèche 2", "OUT_OF_SCOPE", null],
    ["Pre-K", "Pre-K", "OUT_OF_SCOPE", null],
    ["Pre School 2", "Pre School 2", "OUT_OF_SCOPE", null],
    ["Pre-Primary 1", "Pre-Primary 1", "OUT_OF_SCOPE", null],

    // ── UNMAPPED — no tier keyword, or no usable year number ───────────────────────────────────
    [null, "Transition Stream", "UNMAPPED", null],
    [null, "Special Unit", "UNMAPPED", null],
    ["Remedial", "Remedial", "UNMAPPED", null],
    ["JHS", "JHS", "UNMAPPED", null], // a tier with no year number is not a year group
    [null, null, "UNMAPPED", null],
    ["", "", "UNMAPPED", null],
  ];

  for (const [level, name, stage, classForm] of CASES) {
    it(`level=${JSON.stringify(level)} name=${JSON.stringify(name)} → ${stage} / ${String(classForm)}`, () => {
      expect(stageOf(level, name)).toBe(stage);
      expect(classFormOf(level, name)).toBe(classForm);
    });
  }
});

describe("level first, then name (the precedence apps/web already uses)", () => {
  it("reads `level` when it says anything, and ignores the name", () => {
    // The name carries a DIFFERENT year group on purpose: if the name won, a class whose level is
    // right and whose name is stale would be filed under the stale one.
    expect(stageOf("Basic 8", "Primary 4 Stream")).toBe("JHS");
    expect(classFormOf("Basic 8", "Primary 4 Stream")).toBe("JHS2");
  });

  it("falls back to `name` when the level is NULL or blank — not only when it is NULL", () => {
    expect(stageOf(null, "Form 2 Science")).toBe("SHS");
    expect(classFormOf(null, "Form 2 Science")).toBe("Form 2");
    // A whitespace-only level is operationally the same thing as an absent one. A reader that only
    // checked `=== null` would return UNMAPPED for a class whose NAME was perfectly readable.
    expect(stageOf("   ", "JHS 3 B")).toBe("JHS");
    expect(classFormOf("", "KG 1")).toBe("KG1");
  });

  it("tolerates a section suffix and any casing, as the class labels really are written", () => {
    for (const label of ["JHS 1 A", "jhs 1 b", "JHS 1-C", "JHS 1 (Blue)"])
      expect(classFormOf(label, label)).toBe("JHS1");
  });

  it("is a PURE function of its two arguments — same label, same answer, every time", () => {
    const a = Array.from({ length: 50 }, () => stageOf("Class 4", "Class 4 A"));
    expect(new Set(a)).toEqual(new Set(["PRIMARY"]));
  });
});

describe("the two non-stages are never a stage, and never a class_form", () => {
  it("neither OUT_OF_SCOPE nor UNMAPPED ever yields a class_form token", () => {
    // A token here would be written as a fact row — into some stage — which is exactly the coercion
    // the two tallies exist to avoid. And `class_form IS NULL` already means STAGE TOTAL on a written
    // row, so a non-stage leaking a null token would duplicate a total.
    for (const label of ["Nursery 2", "Transition Stream", "Form 9", "KG 5"])
      expect(classFormOf(label, label)).toBeNull();
  });
});
