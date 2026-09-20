import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComingSoon, TrendPill } from "@/components/board/board-tiles";

/**
 * GOV-4 · treatment C ("coming soon") + the trend pill — the two pieces of the board's honest-absence
 * / state-encoding system that must be proven, not asserted by eye. renderToStaticMarkup runs in node
 * (no jsdom). VISIBLE text = markup with tags stripped, so className digits (e.g. `border-border-2`)
 * can't false-trip a "no number" check.
 */
const visible = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("ComingSoon · treatment C renders no fabricated number", () => {
  it("shows the italic label + honest reason and NO metric (no digit in the visible text)", () => {
    const reason = "Facilities details are not yet captured — the termly facilities form is coming soon.";
    const html = renderToStaticMarkup(
      createElement(ComingSoon, { label: "Not yet captured", body: reason }),
    );
    const text = visible(html);
    expect(text).toContain("Not yet captured");
    expect(text).toContain(reason);
    // The reason carries no digit — so a treatment-C tile with no milestone tag renders NO number.
    expect(text).not.toMatch(/\d/);
    // And never a fabricated currency / percentage metric.
    expect(text).not.toMatch(/GHS|%/);
  });

  it("a milestone tag (GOV-6/7) is a label, not a metric — no GHS/% ever leaks in", () => {
    const html = renderToStaticMarkup(
      createElement(ComingSoon, {
        eyebrow: "Terminal results",
        label: "BECE & WASSCE results — coming soon",
        body: "coming in a later release",
        tag: "GOV-6",
      }),
    );
    const text = visible(html);
    expect(text).toContain("BECE & WASSCE results — coming soon");
    expect(text).toContain("GOV-6");
    expect(text).not.toMatch(/GHS|%/);
  });
});

describe("TrendPill · direction from an exposed delta (glyph + sign + text)", () => {
  it("null delta renders nothing (caller shows a plain caption instead)", () => {
    expect(renderToStaticMarkup(createElement(TrendPill, { delta: null }))).toBe("");
  });

  it("positive → ▲ with a + sign; negative → ▼ with a − sign; zero → the flat label", () => {
    expect(visible(renderToStaticMarkup(createElement(TrendPill, { delta: 12, context: "this term" })))).toBe(
      "▲ +12 this term",
    );
    expect(
      visible(renderToStaticMarkup(createElement(TrendPill, { delta: -1.8, unit: "pts", context: "vs last term" }))),
    ).toBe("▼ −1.8 pts vs last term");
    expect(
      visible(renderToStaticMarkup(createElement(TrendPill, { delta: 0, flatLabel: "no change" }))),
    ).toBe("— no change");
  });
});
