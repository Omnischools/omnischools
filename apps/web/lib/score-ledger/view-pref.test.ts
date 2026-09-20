import { describe, it, expect } from "vitest";
import { resolveView, viewPrefKey } from "./view-pref";

const ctx = { teacherId: "t1", subjectId: "s1", classId: "c1", periodId: "p1" };

describe("view-pref resolver (Q5 — Card default, Grid sticks)", () => {
  it("first use (no stored value) → Card (V3)", () => {
    expect(resolveView(null)).toBe("card");
    expect(resolveView(undefined)).toBe("card");
  });

  it("stored 'grid' → Grid (V4)", () => {
    expect(resolveView("grid")).toBe("grid");
  });

  it("stored 'card' → Card", () => {
    expect(resolveView("card")).toBe("card");
  });

  it("garbage / cleared storage → Card, never throws (V5)", () => {
    expect(resolveView("")).toBe("card");
    expect(resolveView("GRID")).toBe("card"); // exact match only
    expect(resolveView("table")).toBe("card");
  });

  it("key is stable and scoped to teacher × subject × class × semester", () => {
    expect(viewPrefKey(ctx)).toBe("omnischools:ledger-view:t1:s1:c1:p1");
    expect(viewPrefKey({ ...ctx, classId: "c2" })).not.toBe(viewPrefKey(ctx));
    expect(viewPrefKey({ ...ctx, teacherId: "t2" })).not.toBe(viewPrefKey(ctx));
  });
});
