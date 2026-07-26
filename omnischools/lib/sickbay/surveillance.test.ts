import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import {
  OUTBREAK_AMBER_THRESHOLD,
  OUTBREAK_CATEGORY_ORDER,
  OUTBREAK_MONITOR_THRESHOLD,
  OUTBREAK_WINDOW_DAYS,
  OUTBREAK_WOW_RISE_PCT,
  SURVEILLANCE_CATEGORY_META,
  SURVEILLANCE_CATEGORY_VALUES,
  outbreakLede,
  outbreakStatus,
  outbreakTrend,
  topOutbreakStatus,
} from "./surveillance";

/**
 * INCR-27 · Quinn AC (Q1–Q7) — the PURE surveillance derivations. The outbreak reader reaches the DB
 * driver, so these pin the derivations it delegates to: the enum vocabulary, the counts-only status
 * ladder, the blank-until-a-prior-window trend, and the `diagnos`-clean rule.
 */

// ── Q2 · the enum is exact + `diagnos`-clean ────────────────────────────────
describe("🔴 Q2 · the surveillance vocabulary is the 7-value enum and is `diagnos`-clean", () => {
  it("SURVEILLANCE_CATEGORY_VALUES mirrors db/schema/_enums.ts exactly", () => {
    expect([...SURVEILLANCE_CATEGORY_VALUES]).toEqual([
      "MALARIA",
      "RESPIRATORY",
      "DIARRHOEA",
      "SKIN",
      "EYE",
      "INJURY",
      "OTHER",
    ]);
  });

  it("no enum value, meta key or identifier carries the reserved condition token", () => {
    for (const v of SURVEILLANCE_CATEGORY_VALUES) expect(v.toLowerCase()).not.toContain("diagnos");
    for (const k of Object.keys(SURVEILLANCE_CATEGORY_META)) expect(k.toLowerCase()).not.toContain("diagnos");
    // A surveillance bucket AGGREGATES; it must not name a condition anywhere in the module's code.
    expect(readCode("lib/sickbay/surveillance.ts").toLowerCase().includes("diagnos")).toBe(false);
    expect(readCode("lib/sickbay/surveillance-reads.ts").toLowerCase().includes("diagnos")).toBe(false);
  });

  it("the monitor tracks the 6 district-aligned syndromes, OTHER excluded (a catch-all, not a syndrome)", () => {
    expect([...OUTBREAK_CATEGORY_ORDER]).toEqual([
      "RESPIRATORY",
      "MALARIA",
      "DIARRHOEA",
      "SKIN",
      "EYE",
      "INJURY",
    ]);
    expect(OUTBREAK_CATEGORY_ORDER).not.toContain("OTHER");
  });
});

// ── Q4/Q5 · thresholds are lib CONSTANTS, not config ────────────────────────
describe("🔴 Q4/Q5 · thresholds are lib constants (4 / 8 / 50% / 7-day window)", () => {
  it("the four constants are the fixed policy", () => {
    expect(OUTBREAK_MONITOR_THRESHOLD).toBe(4);
    expect(OUTBREAK_AMBER_THRESHOLD).toBe(8);
    expect(OUTBREAK_WOW_RISE_PCT).toBe(50);
    expect(OUTBREAK_WINDOW_DAYS).toBe(7);
  });
});

// ── Q3/Q6 · the status ladder ───────────────────────────────────────────────
describe("🔴 outbreakStatus · Normal < 4 ≤ Monitor < 8 ≤ Amber, plus the WoW-rise escalation", () => {
  it("count alone drives the floor", () => {
    expect(outbreakStatus(0, null)).toBe("NORMAL");
    expect(outbreakStatus(3, null)).toBe("NORMAL");
    expect(outbreakStatus(4, null)).toBe("MONITOR");
    expect(outbreakStatus(7, null)).toBe("MONITOR");
    expect(outbreakStatus(8, null)).toBe("AMBER");
    expect(outbreakStatus(20, null)).toBe("AMBER");
  });

  it("a ≥50% WoW rise escalates Monitor → Amber, but only once already at the Monitor floor", () => {
    // 6 vs 3 is +100% and already at Monitor → Amber.
    expect(outbreakStatus(6, 3)).toBe("AMBER");
    // 6 vs 4 is exactly +50% → Amber.
    expect(outbreakStatus(6, 4)).toBe("AMBER");
    // 6 vs 5 is +20% → stays Monitor.
    expect(outbreakStatus(6, 5)).toBe("MONITOR");
    // 🔴 below the Monitor floor the WoW rise NEVER fires (2→3 is +50% but not an outbreak).
    expect(outbreakStatus(3, 2)).toBe("NORMAL");
    // prior 0 cannot compute a rise → no divide-by-zero amber.
    expect(outbreakStatus(5, 0)).toBe("MONITOR");
  });

  it("topOutbreakStatus picks the sharpest present", () => {
    expect(topOutbreakStatus(["NORMAL", "MONITOR", "NORMAL"])).toBe("MONITOR");
    expect(topOutbreakStatus(["NORMAL", "MONITOR", "AMBER"])).toBe("AMBER");
    expect(topOutbreakStatus(["NORMAL", "NORMAL"])).toBe("NORMAL");
  });
});

// ── Q6 · the trend is blank until a prior window exists ─────────────────────
describe("🔴 outbreakTrend · blank until a prior window exists, never a fake ↔ steady", () => {
  it("no prior window → null (the first 14 days of operation)", () => {
    expect(outbreakTrend(6, 2, false)).toBeNull();
    expect(outbreakTrend(0, 0, false)).toBeNull();
  });

  it("with a prior window, up/down/flat are derived", () => {
    expect(outbreakTrend(6, 2, true)).toEqual({ direction: "up", label: "↑ from 2" });
    expect(outbreakTrend(3, 4, true)).toEqual({ direction: "down", label: "↓ from 4" });
    expect(outbreakTrend(4, 4, true)).toEqual({ direction: "flat", label: "↔ steady" });
    expect(outbreakTrend(0, 0, true)).toEqual({ direction: "flat", label: "↔ baseline" });
  });
});

// ── Q7 · the lede is derived (and the empty state is the good week) ─────────
describe("outbreakLede · derived, counts-only, honest empty state", () => {
  it("a clean week is the calm empty state", () => {
    expect(
      outbreakLede([
        { label: "Malaria suspected", count: 1, status: "NORMAL" },
        { label: "Upper respiratory tract", count: 0, status: "NORMAL" },
      ]),
    ).toBe("No clusters this week — all categories at baseline.");
  });

  it("names the highest-status category and its count (never a hardcoded URTI/6)", () => {
    expect(
      outbreakLede([
        { label: "Upper respiratory tract", count: 6, status: "MONITOR" },
        { label: "Malaria suspected", count: 1, status: "NORMAL" },
      ]),
    ).toContain("Upper respiratory tract cluster at **6 cases**");
    expect(
      outbreakLede([{ label: "Diarrhoea / vomiting", count: 9, status: "AMBER" }]),
    ).toContain("amber alert");
  });
});
