import { describe, it, expect } from "vitest";
import { semLabel, yearLabel, assembleBookRows, SPARE_ROWS } from "./ledger-book";

// ---------------------------------------------------- C2 · semester label (Trap 1 must-fix)
describe("semLabel — SHS renders 'S2', never 'T2'/'Term'", () => {
  it("'Semester 2' → 'S2'", () => expect(semLabel("Semester 2")).toBe("S2"));
  it("a stray 'Term 2' label is still corrected to 'S2' (SHS is semesters, logic wins)", () =>
    expect(semLabel("Term 2")).toBe("S2"));
  it("no digit → passthrough (never fabricates a number)", () =>
    expect(semLabel("Semester")).toBe("Semester"));
});

describe("yearLabel — form digit → Y-label", () => {
  it("'Form 2 Science' → 'Y2'", () => expect(yearLabel("Form 2 Science")).toBe("Y2"));
  it("no digit → passthrough", () => expect(yearLabel("Gold class")).toBe("Gold class"));
});

// ---------------------------------------------------- B5 · blank book carries NO score fields
describe("assembleBookRows — pre-printed roster, name only, zero score fields", () => {
  const roster = [
    { firstName: "Abena", lastName: "Aardvark" },
    { firstName: "Kojo", lastName: "Boateng" },
  ];
  it("one row per roster student, `First Last` name only", () => {
    expect(assembleBookRows(roster)).toEqual([
      { name: "Abena Aardvark" },
      { name: "Kojo Boateng" },
    ]);
  });
  it("no score field ever leaks onto a row (the only key is `name`)", () => {
    for (const row of assembleBookRows(roster)) {
      expect(Object.keys(row)).toEqual(["name"]);
    }
  });
  it("empty roster → zero rows (never throws; A5 renders a header-only book)", () => {
    expect(assembleBookRows([])).toEqual([]);
  });
});

// ---------------------------------------------------- §I · spare rows
describe("SPARE_ROWS — ~4 blank unlabeled handwriting rows (owner-adopted)", () => {
  it("is 4", () => expect(SPARE_ROWS).toBe(4));
});
