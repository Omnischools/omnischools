import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { armView, tierView, pendingReason, ghs, num, dash, pct } from "./board-pack-parts";
import type { RollupArm, PendingArm } from "@/lib/rollup/school-rollup";

/**
 * GOV-5 · the board-pack PDF's honest-absence spine. The document (`board-pack-document.tsx`) branches
 * on these seams at its single per-arm branch point, so a NOT_CAPTURED / NOT_APPLICABLE arm can never
 * print a fabricated number, a captured real zero prints as-is, and a PendingArm reads its coming-soon
 * reason. Plus a source-level gate check on the route (requireBoard + session-scoped, never a URL id).
 */

describe("GOV-5 · armView (treatment A/B seam)", () => {
  it("a NOT_CAPTURED arm yields its reason and NO data (no number can be fabricated)", () => {
    const arm: RollupArm<{ collected: number }> = {
      status: "NOT_CAPTURED",
      reason: "No fees billed for Term 1 · 2025/26.",
    };
    const v = armView(arm);
    expect(v.shown).toBe(false);
    if (v.shown) throw new Error("unreachable");
    expect(v.reason).toBe("No fees billed for Term 1 · 2025/26.");
    expect(v).not.toHaveProperty("data");
  });

  it("a NOT_APPLICABLE arm also collapses to a reason with no data (payroll school runs none)", () => {
    const arm: RollupArm<{ x: number }> = {
      status: "NOT_APPLICABLE",
      reason: "This school does not run payroll in Omnischools.",
    };
    const v = armView(arm);
    expect(v).toEqual({ shown: false, reason: "This school does not run payroll in Omnischools." });
  });

  it("a CAPTURED arm with a real zero exposes the zero (treatment B — a true 0, not an absence)", () => {
    const arm: RollupArm<{ collected: number; collectionRate: number }> = {
      status: "CAPTURED",
      data: { collected: 0, collectionRate: 0 },
    };
    const v = armView(arm);
    expect(v.shown).toBe(true);
    if (!v.shown) throw new Error("unreachable");
    expect(v.data.collected).toBe(0);
    expect(ghs(v.data.collected)).toBe("GHS 0");
    expect(pct(v.data.collectionRate)).toBe("0%");
  });
});

describe("GOV-5 · tierView (cross-tier performance, no blend)", () => {
  it("a NOT_APPLICABLE tier is OMITTED (omit-not-fake), not a reason row", () => {
    expect(tierView({ status: "NOT_APPLICABLE", reason: "Not a senior school." })).toEqual({
      kind: "omit",
    });
  });

  it("a NOT_CAPTURED tier shows a reason (no number)", () => {
    const v = tierView({ status: "NOT_CAPTURED", reason: "No gradebook scores recorded for Term 1." });
    expect(v).toEqual({ kind: "reason", reason: "No gradebook scores recorded for Term 1." });
  });

  it("a CAPTURED tier exposes its data", () => {
    const v = tierView({ status: "CAPTURED", data: { overallAverage: 72 } });
    expect(v.kind).toBe("captured");
    if (v.kind !== "captured") throw new Error("unreachable");
    expect(v.data.overallAverage).toBe(72);
  });
});

describe("GOV-5 · pendingReason (treatment C coming-soon)", () => {
  it("reads a PendingArm's forward-looking reason (never a number)", () => {
    const arm: PendingArm = {
      status: "NOT_CAPTURED",
      reason: "Facilities details are not yet captured — the termly facilities form is coming soon.",
    };
    expect(pendingReason(arm)).toBe(
      "Facilities details are not yet captured — the termly facilities form is coming soon.",
    );
  });
});

describe("GOV-5 · board-grain formatters", () => {
  it("ghs groups en-GH with no forced decimals", () => {
    expect(ghs(0)).toBe("GHS 0");
    expect(ghs(41200)).toBe("GHS 41,200");
  });
  it("pct prints a captured 0% but a null rate as an em dash, never '0%'", () => {
    expect(pct(0)).toBe("0%");
    expect(pct(87)).toBe("87%");
    expect(pct(null)).toBe("—");
  });
  it("dash renders a term-windowed null as an em dash, a real 0 as 0", () => {
    expect(dash(null)).toBe("—");
    expect(dash(0)).toBe("0");
    expect(num(1234)).toBe("1,234");
  });
});

// ── route gates + shared builder (source-level, airtight) ────────────────────────────────────────
// #309 de-cloned the two board-pack routes: both now GATE and delegate to the shared
// `buildBoardPackResponse`, which holds the (session-scoped) data assembly + the pdf response.
const src = (p: string) => readFileSync(resolve(cwd(), p), "utf8");

describe("GOV-5/§17-F · board-pack routes are gated, session-scoped, and share ONE builder (#309)", () => {
  const boardRoute = src("app/(board)/board/board-pack/route.ts");
  const insightsRoute = src("app/api/insights/board-pack/route.ts");
  const shared = src("lib/pdf/board-pack-response.ts");

  it("the /board route gates on requireBoard() and runs on the node runtime", () => {
    expect(boardRoute).toMatch(/requireBoard\s*\(\s*\)/);
    expect(boardRoute).toMatch(/runtime\s*=\s*["'`]nodejs["'`]/);
  });

  it("the /api/insights route gates on INSIGHTS_READ_ROLES and runs on the node runtime", () => {
    expect(insightsRoute).toMatch(/requireSchoolRole\s*\(\s*INSIGHTS_READ_ROLES/);
    expect(insightsRoute).toMatch(/runtime\s*=\s*["'`]nodejs["'`]/);
  });

  it("both routes delegate to the SHARED buildBoardPackResponse — the clone is gone", () => {
    expect(boardRoute).toMatch(/buildBoardPackResponse\s*\(\s*school/);
    expect(insightsRoute).toMatch(/buildBoardPackResponse\s*\(\s*school/);
  });

  it("neither route trusts a URL school id — only periodId is read (R339)", () => {
    expect(boardRoute).not.toMatch(/searchParams\.get\(\s*["'`]schoolId/);
    expect(insightsRoute).not.toMatch(/searchParams\.get\(\s*["'`]schoolId/);
  });

  it("the shared builder is session-scoped (getDirectorsInsights on school.id) and streams pdf inline", () => {
    expect(shared).toMatch(/getDirectorsInsights\s*\(\s*school\.id/);
    expect(shared).toMatch(/application\/pdf/);
    expect(shared).toMatch(/inline; filename=/);
  });
});
