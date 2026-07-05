import { describe, it, expect } from "vitest";
import { computeVhmTier } from "./vhm-progress";

const filled = (
  asgn: number,
  midSem: number,
  endSem: number,
  project: number,
  portfolio: number,
) => ({ asgn, midSem, endSem, project, portfolio });

describe("computeVhmTier — the STPSHS n/5 tier (completion, never scores)", () => {
  const roster = 37;

  it("all five categories entered by every student → Ready 5/5", () => {
    expect(computeVhmTier(filled(37, 37, 37, 37, 37), roster)).toEqual({
      categoriesDone: 5,
      status: "ready",
    });
  });

  it("no category fully entered → At risk 0/5 (the never-started case)", () => {
    expect(computeVhmTier(filled(0, 0, 0, 0, 0), roster)).toEqual({
      categoriesDone: 0,
      status: "at_risk",
    });
  });

  it("four of five categories fully entered → Behind 4/5 (portfolio pending)", () => {
    expect(computeVhmTier(filled(37, 37, 37, 37, 0), roster)).toEqual({
      categoriesDone: 4,
      status: "behind",
    });
  });

  it("a partially-entered category does NOT count toward n (§1.11)", () => {
    // asgn fully in (37), mid-sem only 30 of 37 → mid-sem is 'partial', not done.
    expect(computeVhmTier(filled(37, 30, 0, 0, 0), roster)).toEqual({
      categoriesDone: 1,
      status: "behind",
    });
  });

  it("a category counts only when EVERY student has it, not just some", () => {
    // Every category has 36 of 37 — none is fully done → 0/5, at risk.
    expect(computeVhmTier(filled(36, 36, 36, 36, 36), roster)).toEqual({
      categoriesDone: 0,
      status: "at_risk",
    });
  });

  it("an empty roster is at_risk 0/5, never divides or reads a phantom 'all done'", () => {
    expect(computeVhmTier(filled(0, 0, 0, 0, 0), 0)).toEqual({
      categoriesDone: 0,
      status: "at_risk",
    });
  });
});
