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
 * ⚠ `delta` IS AN UNRENDERED SLOT ON PURPOSE, and this comment is the reason it is not deleted.
 * Lucy specifies three `.k-delta` tones, but the demo carries a SINGLE academic year (2025/26), so
 * there is no prior-year comparator to compute a delta FROM. A `▲ 0%` or an em-dash pill would both
 * be claims about change that nothing in the data supports — Lucy §3.5's "never a fake ▲ 0%". So the
 * prop exists, is typed, and no caller on this surface passes it; the day a second year lands, the
 * pill is a one-line change rather than a redesign.
 */
export function KpiCard({
  label,
  value,
  unit,
  sub,
  delta,
  lead = false,
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
          {lead ? <em className="accent-italic font-normal">{value}</em> : value}
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

export function formatCount(n: number): string {
  return n.toLocaleString("en-GB");
}
