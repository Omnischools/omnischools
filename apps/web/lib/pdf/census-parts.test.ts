import { describe, it, expect } from "vitest";
import { armView, handView, num, dash, pct, type ArmView, type HandView } from "./census-parts";
import type { CensusArm } from "@/lib/reports/census/schema";

/**
 * GOV-9 · the annual census PDF's PURE honesty seam (AC GOV9-10 / GOV9-06). `census-document.tsx` branches
 * on each section through `armView`/`handView` at its single per-section branch point, so:
 *   - a FULL/PARTIAL arm's `.data` is the ONLY way a figure reaches the paper (a captured real 0 survives);
 *   - a NONE / NOT_APPLICABLE arm yields a reason and NO data → the document prints a hatched blank;
 *   - a numeric render for a NONE/NA section is a COMPILE error (the `@ts-expect-error` fences below).
 * Mirrors the GOV-5 `board-pack-parts` precedent.
 */

describe("GOV9-10 · armView — the coverage → cell contract", () => {
  it("FULL → shown + the frozen data (a captured real 0 is a truth, not an absence)", () => {
    const arm: CensusArm<{ roll: number }> = { coverage: "FULL", data: { roll: 0 } };
    const v = armView(arm);
    expect(v.shown).toBe(true);
    if (!v.shown) throw new Error("unreachable");
    expect(v.data.roll).toBe(0);
    expect(num(v.data.roll)).toBe("0");
  });

  it("PARTIAL → shown + the captured data (the empty cells hatch in the doc)", () => {
    const arm: CensusArm<{ captured: number }> = {
      coverage: "PARTIAL",
      data: { captured: 3 },
      reason: "12 of 15 have a DOB",
    };
    const v = armView(arm);
    expect(v.shown).toBe(true);
    if (!v.shown) throw new Error("unreachable");
    expect(v.data.captured).toBe(3);
  });

  it("NONE → reason + NO data (a hatched hand-fill blank, never a fabricated number)", () => {
    const arm: CensusArm<{ n: number }> = {
      coverage: "NONE",
      reason: "Promotion history is not tracked in Omnischools — repeaters are hand-filled (annual).",
    };
    const v = armView(arm);
    expect(v.shown).toBe(false);
    expect(v).toEqual({
      shown: false,
      reason: "Promotion history is not tracked in Omnischools — repeaters are hand-filled (annual).",
    });
    expect(v).not.toHaveProperty("data");
  });

  it("NOT_APPLICABLE → reason + NO data (omit-not-fake; e.g. no payroll)", () => {
    const arm: CensusArm<{ n: number }> = {
      coverage: "NOT_APPLICABLE",
      reason: "This school does not run payroll in Omnischools.",
    };
    const v = armView(arm);
    expect(v).toEqual({ shown: false, reason: "This school does not run payroll in Omnischools." });
    expect(v).not.toHaveProperty("data");
  });
});

describe("GOV9-10 · the compile-fence — a not-shown arm's `.data` is UNREACHABLE (tsc enforces)", () => {
  it("`.data` off the union is a type error; it is reachable only after narrowing `shown`", () => {
    const arm: CensusArm<{ secret: number }> = { coverage: "NONE", reason: "not tracked" };
    const v: ArmView<{ secret: number }> = armView(arm);
    // tsc --noEmit FAILS if the next line ever stops erroring (i.e. if the honesty seam were widened to
    // expose data unconditionally) — GOV9-10: `.data` cannot be read without narrowing `shown` first.
    // @ts-expect-error — `.data` is unreachable on the union without narrowing `shown`
    void v.data;
    expect(v.shown).toBe(false);
    if (v.shown) {
      // positive control: inside the `shown` narrowing, `.data` IS reachable.
      expect(typeof v.data.secret).toBe("number");
    }
  });
});

describe("GOV9-06 · handView — an un-entered HAND section is a blank (never a fabricated 0)", () => {
  it("null → filled:false (the doc renders a hatched 'complete by hand' block)", () => {
    const w = handView<{ male: number; female: number }>(null);
    expect(w).toEqual({ filled: false });
    expect(w).not.toHaveProperty("data");
  });

  it("undefined → filled:false", () => {
    expect(handView(undefined)).toEqual({ filled: false });
  });

  it("an ENTERED value (even all-zero counts) → filled:true + data (a stated zero, not a blank)", () => {
    const w = handView({ male: 0, female: 0 });
    expect(w.filled).toBe(true);
    if (!w.filled) throw new Error("unreachable");
    expect(w.data).toEqual({ male: 0, female: 0 });
  });

  it("compile-fence: a not-filled handView's `.data` is unreachable without narrowing", () => {
    const w: HandView<{ x: number }> = handView<{ x: number }>(null);
    // @ts-expect-error — GOV9-06: no `.data` on the unfilled branch (an un-entered section can't print a value)
    void w.data;
    expect(w.filled).toBe(false);
  });
});

describe("GOV9-06 · in-doc formatters — a real 0 vs an absent value", () => {
  it("num groups en-GH; a captured 0 prints '0', never blank", () => {
    expect(num(0)).toBe("0");
    expect(num(1234)).toBe("1,234");
  });

  it("dash prints '—' for null/undefined but a real 0 as '0' (never fabricates, never hides a true zero)", () => {
    expect(dash(null)).toBe("—");
    expect(dash(undefined)).toBe("—");
    expect(dash(0)).toBe("0");
    expect(dash(312)).toBe("312");
  });

  it("pct prints a captured 0% but a null rate as '—', never '0%'", () => {
    expect(pct(0)).toBe("0%");
    expect(pct(93)).toBe("93%");
    expect(pct(null)).toBe("—");
    expect(pct(undefined)).toBe("—");
  });
});
