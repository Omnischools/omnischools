import { describe, it, expect } from "vitest";
import { chevronSuppressed, classCountLabel, switcherPill } from "./pwa-switcher";

describe("class-switcher predicates (S1–S4 / Q6)", () => {
  it("single-class (or none) → chevron + pill suppressed (S2)", () => {
    expect(chevronSuppressed(0)).toBe(true);
    expect(chevronSuppressed(1)).toBe(true);
  });

  it("two or more classes → chevron shown (S1)", () => {
    expect(chevronSuppressed(2)).toBe(false);
    expect(chevronSuppressed(6)).toBe(false);
  });

  it("'1 of N' label is 1-based on the active index", () => {
    expect(classCountLabel(0, 2)).toBe("1 of 2");
    expect(classCountLabel(1, 2)).toBe("2 of 2");
    expect(classCountLabel(4, 5)).toBe("5 of 5");
  });

  it("active class always reads 'current', even when incomplete (S4)", () => {
    expect(switcherPill(true, 4)).toBe("current");
    expect(switcherPill(true, 5)).toBe("current");
    expect(switcherPill(true, 0)).toBe("current");
  });

  it("non-active class: all 5 categories → 'ready', else 'behind' (S4)", () => {
    expect(switcherPill(false, 5)).toBe("ready");
    expect(switcherPill(false, 4)).toBe("behind");
    expect(switcherPill(false, 0)).toBe("behind");
  });
});
