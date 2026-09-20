import { describe, it, expect } from "vitest";
import { primariesToClear, formatDistanceKm, type HospitalView } from "./hospitals";

// 🔴 R186 — the at-most-one-primary rule is APP-LAYER, and this is the decision a mutation must red.
// If `primariesToClear` ever returns [] where it should clear (the classic `&& false` sabotage), a
// school ends up with two primaries and the referral picker has no single default — this pins it.
describe("R186 · primariesToClear — the at-most-one-primary decision", () => {
  const set = [
    { id: "a", isPrimary: true },
    { id: "b", isPrimary: false },
    { id: "c", isPrimary: true }, // a corrupt double-primary state to reconcile
  ];

  it("setting a NEW hospital primary (create, sentinel id) clears every existing primary", () => {
    expect(primariesToClear(set, "", true).sort()).toEqual(["a", "c"]);
  });

  it("setting an EXISTING hospital primary clears the OTHER primaries, never itself", () => {
    expect(primariesToClear(set, "a", true)).toEqual(["c"]);
  });

  it("saving a hospital NOT as primary clears nothing (the target keeps whatever the others are)", () => {
    expect(primariesToClear(set, "b", false)).toEqual([]);
  });

  it("nothing to clear when the target is the only primary already", () => {
    expect(primariesToClear([{ id: "a", isPrimary: true }, { id: "b", isPrimary: false }], "a", true)).toEqual(
      [],
    );
  });
});

describe("formatDistanceKm — the surface distance chip, verbatim number", () => {
  it("renders `{n} km`, and nothing when unset", () => {
    expect(formatDistanceKm(4.2)).toBe("4.2 km");
    expect(formatDistanceKm(198)).toBe("198 km");
    expect(formatDistanceKm(null)).toBeNull();
  });
});

describe("Risk-4 · HospitalView carries no student field (compile-pinned)", () => {
  it("a hospital row is config — name · distance · flags · tags, never a patient", () => {
    const row: HospitalView = {
      id: "x",
      name: "Asankrangwa Government Hospital",
      distanceKm: 4.2,
      services: "OPD · in-patient · X-ray",
      notes: "24h emergency",
      isPrimary: true,
      acceptsNhis: true,
      tags: ["After-hours"],
      active: true,
    };
    expect(Object.keys(row).sort()).toEqual(
      ["active", "acceptsNhis", "distanceKm", "id", "isPrimary", "name", "notes", "services", "tags"].sort(),
    );
  });
});
