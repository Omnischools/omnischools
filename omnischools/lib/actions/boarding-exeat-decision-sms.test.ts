import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Exeat Phase 3-C — SOURCE-SHAPE guard on transition()'s post-commit SMS wiring. The on-decision
 * SMS-to-parent must fire ONLY for a parent-portal request (via_parent_portal), on the correct
 * terminal state: DECISION_APPROVED at SR_HM_SIGNED (all portal exeats are SPECIAL, so that is their
 * approval gate — NOT HM_APPROVED) and DECISION_DECLINED at DECLINED. A future edit that drops the
 * viaParentPortal gate, or moves APPROVED to the wrong state, reds this. Quinn's db:rls-test proves
 * the behaviour (a portal-approve writes a DECISION_APPROVED row, a non-portal transition writes none).
 */
const SRC = readFileSync(fileURLToPath(new URL("./boarding-exeat.ts", import.meta.url)), "utf8");

/** The ~180 chars of guard preceding a kind literal in the post-commit ternary. */
function guardBefore(kind: string): string {
  const idx = SRC.indexOf(`"${kind}"`);
  expect(idx, `${kind} is not wired in boarding-exeat.ts`).toBeGreaterThan(-1);
  // Exactly one occurrence — the ternary. A second would mean an un-audited send path.
  expect(SRC.indexOf(`"${kind}"`, idx + 1), `${kind} appears more than once`).toBe(-1);
  return SRC.slice(Math.max(0, idx - 180), idx);
}

describe("Exeat 3-C · decision SMS fires only for portal exeats on the right state", () => {
  it("DECISION_APPROVED is gated by SR_HM_SIGNED && viaParentPortal", () => {
    const g = guardBefore("DECISION_APPROVED");
    expect(g).toContain(`to === "SR_HM_SIGNED"`);
    expect(g).toContain("viaParentPortal");
    // NOT the ordinary HM approval gate (portal exeats are SPECIAL).
    expect(g).not.toContain(`to === "HM_APPROVED"`);
  });

  it("DECISION_DECLINED is gated by DECLINED && viaParentPortal", () => {
    const g = guardBefore("DECISION_DECLINED");
    expect(g).toContain(`to === "DECLINED"`);
    expect(g).toContain("viaParentPortal");
  });

  it("the decline reason never reaches the SMS send (no staff free-text leak)", () => {
    // sendExeatStage is called with the KIND only; the declined body takes no reason argument.
    // Guard: no send call passes declineReason / a reason variable into the SMS path.
    expect(SRC).not.toMatch(/sendExeatStage\([^)]*reason/i);
  });
});
