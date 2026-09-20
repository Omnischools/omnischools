import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ATTENDANCE_STATUS_ORDER, ATTENDANCE_STATUS_META } from "@/lib/attendance-status";
// Type-only import — fully erased at compile time, so this pure module never pulls in the
// `server-only` rollup at runtime (the render test can still import it in node).
import type { AttendanceStatusTotals } from "@/lib/rollup/school-rollup";

/**
 * GOV-4 · shared, PURE presentational primitives for the board/director dashboard. No `server-only`,
 * no DB — so the honest-absence look (treatment C) is render-testable off the server-only page
 * (`lib/board/board-tiles-render.test.ts`). The page owns the data; these own the pixels.
 *
 * INS (Directors' Insights) — the summary/tile atoms (`SummaryCell`, `Tile`, `StatusSplit`, `Line`,
 * `StreamCard`, `FEMALE_HEX`/`MALE_HEX`) were LIFTED here verbatim from `app/(board)/board/page.tsx`
 * so both the board and `/insights` import them 1:1 (no duplication, board renders identically). Pure
 * move, no behaviour change.
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

/* ───────── Lifted board primitives (shared by board + /insights) ───────── */

/** School-stats pink/blue — the ONE sanctioned non-token inline hex (gender mini-bar). Never take
 *  slash-opacity on these (memory `no-alpha-token-opacity`); use solid hex + `flexGrow`. */
export const FEMALE_HEX = "#C77B9E";
export const MALE_HEX = "#6B86B0";

/** The scan-strip cell: a label + a big display value + an optional sub. `lead` → gold-bg accent. */
export function SummaryCell({
  label,
  value,
  sub,
  lead,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  lead?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3.5",
        lead ? "border-gold-soft bg-gold-bg" : "border-border bg-surface",
      )}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">{label}</div>
      <div className="mt-1 font-display text-3xl font-medium leading-none text-navy">{value}</div>
      {sub && <div className="mt-1.5 text-xs leading-relaxed text-navy-3">{sub}</div>}
    </div>
  );
}

/** The tile shell: a titled `<section>` with a gold accent word and an optional right-aligned meta. */
export function Tile({
  title,
  accent,
  meta,
  className,
  children,
}: {
  title: string;
  accent: string;
  meta?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-surface px-[22px] py-5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-medium text-navy">
          {title} <em className="not-italic text-gold">{accent}</em>.
        </h2>
        {meta && <div className="text-[11px] text-navy-3">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

/** A label : value definition line (mono value, or a display-strong one). */
export function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-navy-3">{label}</dt>
      <dd className={strong ? "font-display font-medium text-navy" : "font-mono text-navy-2"}>
        {value}
      </dd>
    </div>
  );
}

/** A titled sub-card inside a tile (finance streams). */
export function StreamCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface px-[22px] py-[18px]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-navy-3">{title}</div>
      {children}
    </section>
  );
}

/**
 * The five-status segmented bar + a P·L·E·M·A readout — aggregate, no PII. Medical (M) is its own
 * status (navy-2), the sickbay→attendance readout, never folded into Absent
 * ([[attendance-five-statuses]]). `className` lets a caller tighten the top margin inside a drill-in row.
 */
export function StatusSplit({
  totals,
  className,
}: {
  totals: AttendanceStatusTotals;
  className?: string;
}) {
  const total =
    totals.present + totals.late + totals.excused + totals.medical + totals.absent;
  return (
    <div className={cn("mt-4", className)}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-pill border border-border bg-bg">
        {total > 0 &&
          ATTENDANCE_STATUS_ORDER.map((s) => {
            const count = totals[s.toLowerCase() as keyof AttendanceStatusTotals];
            if (count === 0) return null;
            return (
              <div
                key={s}
                className={ATTENDANCE_STATUS_META[s].seg}
                style={{ flexGrow: count }}
                aria-hidden
              />
            );
          })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px]">
        {ATTENDANCE_STATUS_ORDER.map((s) => {
          const meta = ATTENDANCE_STATUS_META[s];
          const count = totals[s.toLowerCase() as keyof AttendanceStatusTotals];
          return (
            <span key={s} className={meta.num}>
              {meta.letter} {count.toLocaleString("en-GH")}
            </span>
          );
        })}
      </div>
    </div>
  );
}
