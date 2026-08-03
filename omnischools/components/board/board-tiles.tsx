import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * GOV-4 · shared, PURE presentational primitives for the board/director dashboard. No `server-only`,
 * no DB — so the honest-absence look (treatment C) is render-testable off the server-only page
 * (`lib/board/board-tiles-render.test.ts`). The page owns the data; these own the pixels.
 */

/**
 * Trend pill — the ONLY sanctioned state colour on the board (§10 honesty boundary). It encodes the
 * SIGN of an EXPOSED delta (attendance `schoolDelta`, enrolment `netChange`), never an absolute
 * health verdict (that would need a threshold the aggregate rollup deliberately strips). Direction
 * survives without hue: glyph (▲/▼/—) + sign (+/−) + text. `delta == null` → no pill (the caller
 * shows a plain caption instead).
 */
export function TrendPill({
  delta,
  unit = "",
  context = "",
  flatLabel = "level",
}: {
  delta: number | null;
  /** e.g. "pts" for attendance; "" for a raw count (enrolment). */
  unit?: string;
  /** e.g. "this term" / "vs last term". */
  context?: string;
  /** the zero-delta label ("no change" / "level"). */
  flatLabel?: string;
}) {
  if (delta == null) return null;
  const n = Math.round(delta * 10) / 10;
  const suffix = [unit, context].filter(Boolean).join(" ");
  const withSuffix = (core: string) => (suffix ? `${core} ${suffix}` : core);

  if (n === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-pill bg-bg px-2 py-0.5 font-mono text-[10px] font-bold text-navy-3">
        {`— ${flatLabel}`}
      </span>
    );
  }
  const up = n > 0;
  const magnitude = up ? `+${n}` : `−${Math.abs(n)}`; // U+2212 minus for the down case
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 font-mono text-[10px] font-bold",
        up ? "bg-green-bg text-green" : "bg-terra-bg text-terra",
      )}
    >
      {withSuffix(`${up ? "▲" : "▼"} ${magnitude}`)}
    </span>
  );
}

/**
 * Treatment C — the "coming soon" placeholder (§9.C) for a capability NOT YET BUILT (a `PendingArm`,
 * or the Performance terminal sub-section). DASHED, uncoloured, italic — deliberately distinct from a
 * real captured zero (treatment B) and from a solid NOT_CAPTURED reason (treatment A). It takes NO
 * numeric/data input, so it is STRUCTURALLY incapable of rendering a fabricated number or a health
 * colour — only the strings passed in (a label, an honest reason, an optional milestone tag).
 */
export function ComingSoon({
  eyebrow,
  label = "Not yet captured",
  body,
  tag,
}: {
  eyebrow?: string;
  label?: string;
  body?: string;
  tag?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border-2 bg-bg px-[22px] py-[18px]">
      {eyebrow && (
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">{eyebrow}</div>
      )}
      <div className="mt-1 font-display text-lg italic text-navy-3">{label}</div>
      {body && <p className="mt-1 max-w-md text-[13px] leading-relaxed text-navy-3">{body}</p>}
      {tag && (
        <div className="mt-2 inline-flex rounded-pill border border-border-2 px-2 py-0.5 font-mono text-[10px] font-semibold text-navy-3">
          {tag}
        </div>
      )}
    </div>
  );
}

/**
 * Treatment A — a solid-border NOT_CAPTURED / NOT_APPLICABLE reason. "This exists, there's just
 * nothing to show yet / here." No number. Distinct from treatment C by its SOLID border + surface bg.
 */
export function AbsencePanel({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-border bg-surface px-[22px] py-[18px] text-[13px] leading-relaxed text-navy-3">
      {children}
    </p>
  );
}
