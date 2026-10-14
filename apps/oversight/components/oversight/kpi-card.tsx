import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * THE KPI CARD (Lucy §3.3 `.kpi-card`), ported to tokens — no literal hex anywhere, alphas via the
 * `/opacity` utilities (§7).
 *
 * `lead` is the mock's `.kpi-card.lead`: the gold-gradient card the enrolment figure sits in, with
 * the decorative top-right circle rebuilt as an absolutely-positioned div at `bg-gold/10` (the
 * nearest Tailwind step to the mock's 0.08 alpha, which §7 rules acceptable).
 *
 * `delta` IS NOW RENDERED, for the measures whose source can honestly carry a year-over-year change
 * (MULTI-YEAR-TREND-RULING, increment M). The `KDelta` pill below is Lucy's three-tone `.k-delta`:
 * `up`/`down` for a real re-derived change, `flat` for a MEASURED no-change ("no change") OR — with an
 * em-dash — for "no prior-year comparator yet" (§3.5's "never a fake ▲ 0%"). The slot is still a plain
 * `ReactNode`, so the PTR card keeps passing its target-conformance `Chip` here (that is NOT a YoY —
 * ruling M9), and a card whose source cannot carry a trend (enrolment, until history accrues forward)
 * passes a `flat` em-dash `KDelta`.
 */
export function KpiCard({
  label,
  value,
  unit,
  sub,
  delta,
  lead = false,
  state = false,
}: {
  label: string;
  /** The figure, already formatted — or the honest "Unavailable" / "No successful run yet" string. */
  value: ReactNode;
  /** `%`, `pupils`, … Rendered in body font, never italic (§3.3). */
  unit?: string;
  sub?: ReactNode;
  /** Lucy's `.k-delta` pill. Unrendered on this surface — see the note above. */
  delta?: ReactNode;
  lead?: boolean;
  /**
   * `value` is an ABSENCE STATEMENT ("Unavailable", "No successful run yet"), not a figure.
   *
   * It gets a smaller, non-italic, muted treatment instead of the 33px gold-italic display face,
   * because at display size an absence reads like a measurement — the lead card would have rendered
   * "No successful run yet" in the same confident gold as "2.41M" (Dex M6). The honesty rule is about
   * what the officer SEES, so it has to reach the typography and not stop at the string.
   */
  state?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border px-5 py-[18px]",
        lead
          ? "border-gold-soft bg-gradient-to-br from-gold-bg to-surface"
          : "border-border-1 bg-surface",
      )}
    >
      {lead ? (
        <div
          aria-hidden
          className="bg-gold/10 pointer-events-none absolute -right-[30px] -top-[30px] h-[120px] w-[120px] rounded-full"
        />
      ) : null}
      <div className="relative">
        <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.15em] text-navy-3">
          {label}
        </div>
        <div className="font-display text-[33px] font-medium leading-none -tracking-[0.02em] text-navy">
          {state ? (
            <span className="font-body text-[15px] font-medium not-italic text-navy-3">
              {value}
            </span>
          ) : lead ? (
            <em className="accent-italic font-normal">{value}</em>
          ) : (
            value
          )}
          {unit ? (
            <span className="ml-1 font-body text-[13px] font-medium text-navy-3">
              {unit}
            </span>
          ) : null}
        </div>
        {sub ? (
          <div className="mt-2 text-[11px] font-medium text-navy-3">{sub}</div>
        ) : null}
        {delta ?? null}
      </div>
    </div>
  );
}

/**
 * THE `.k-delta` YEAR-OVER-YEAR PILL (Lucy §3.3 / §3.5), ported to tokens.
 *
 * Three tones, exactly the mock's:
 *   `up`   → `bg-green-bg text-green`, leading `▲` — a real, re-derived improvement.
 *   `down` → `bg-terra-bg text-terra`, leading `▼` — a real decline.
 *   `flat` → `bg-bg text-navy-3`, NO glyph — either a MEASURED no-change ("no change vs 2024",
 *            MULTI-YEAR-TREND-RULING M10) or, with an em-dash label, "no prior-year comparator yet"
 *            (M9). The two flat uses are distinguished by their LABEL, never by a fake `▲ 0%`.
 *
 * The glyph is `aria-hidden`: the direction is already in the label's words ("▲ 2 pts" is read as
 * "2 pts" + the tone's meaning carried by the text), so the triangle is decoration, not content.
 */
export type KDeltaTone = "up" | "down" | "flat";

export function KDelta({ tone, children }: { tone: KDeltaTone; children: ReactNode }) {
  const glyph = tone === "up" ? "▲" : tone === "down" ? "▼" : null;
  return (
    <span
      className={cn(
        "mt-2 inline-flex items-center gap-1 rounded-pill px-[7px] py-0.5 text-[10px] font-bold",
        tone === "up"
          ? "bg-green-bg text-green"
          : tone === "down"
            ? "bg-terra-bg text-terra"
            : "bg-bg text-navy-3",
      )}
    >
      {glyph ? <span aria-hidden>{glyph}</span> : null}
      {children}
    </span>
  );
}

/**
 * FORMATTERS — presentation only, and deliberately NOT a source of rounded truth: every figure they
 * take is computed from the demo DB at request time (the mock's 2.41M / 75.6% / 64% are layout
 * placeholders, never values).
 */

/** `2,410,000` → `2.41M`; smaller figures keep their digits, because "0.41M" reads worse than 412,600. */
export function formatPupilCount(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(2)}M`;
  return total.toLocaleString("en-GB");
}

/** A 0..1 ratio as a percentage NUMBER (the `%` is the card's separate unit span). */
export function formatRatioPercent(ratio: number, decimals: number): string {
  return (ratio * 100).toFixed(decimals);
}

/**
 * A pupil–teacher ratio as its own number — NOT a percentage, so no ×100 (that would render "2833"
 * for a 28.33 ratio). Returns only the figure; the ":1" / ": 1" is the card's or cell's own unit, the
 * same way `%` is coverage's unit and never part of the value. Kofi's precision ruling is ONE decimal
 * for the tier (Σ÷Σ) figure, so callers pass `1`; the stored per-school `numeric(5,2)` scale is a
 * different, single-school concern.
 */
export function formatRatio(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-GB");
}

/**
 * A GHS fee amount with the locked two-decimal currency format from the mock (`GHS 340.00`,
 * `GHS 1,120.00`). `fact_fees.mean_amount/median_amount` are `numeric(10,2)` literals already in GHS
 * (lib/etl/fees.ts), so the number is the amount itself — no ×100 and no pesewa conversion here.
 *
 * Always carries the `GHS` unit: a bare "0.00" in a fee cell is unreadable and, worse, a bare "0" would
 * blur the billed-zero "charges nothing" state the fees surface exists to keep distinct (ruling F11).
 */
export function formatGhs(amount: number): string {
  return `GHS ${amount.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
