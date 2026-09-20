import { cn } from "@/lib/utils";
import type { PerfTone } from "@/lib/reports/grade-band";

const CHIP_TONE: Record<PerfTone, string> = {
  green: "bg-green-bg text-green",
  gold: "bg-gold-bg text-gold",
  terra: "bg-terra-bg text-terra",
  none: "bg-bg text-navy-3",
};

/** Grade band pill, tone by performance. `—` (navy-3) when there's no grade. */
export function GradeChip({ grade, tone }: { grade: string | null; tone: PerfTone }) {
  if (!grade) return <span className="font-mono text-navy-3">—</span>;
  return (
    <span
      className={cn(
        "inline-flex rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]",
        CHIP_TONE[tone],
      )}
    >
      {grade}
    </span>
  );
}

/**
 * Term-on-term change chip. `new` when there's no comparable prior term; `— flat` for a
 * negligible move (|Δ| < 0.5); otherwise ↑/↓ with the signed value. Unit defaults to "pts".
 */
export function PointsDelta({
  delta,
  hasPrior,
  unit = "pts",
}: {
  delta: number | null;
  hasPrior: boolean;
  unit?: string;
}) {
  if (!hasPrior) return <span className="text-[11px] font-semibold text-navy-3">new</span>;
  if (delta == null) return <span className="font-mono text-navy-3">—</span>;
  if (Math.abs(delta) < 0.5)
    return <span className="text-[11px] font-semibold text-navy-3">— flat</span>;
  const up = delta > 0;
  return (
    <span className={cn("font-mono text-xs font-semibold", up ? "text-green" : "text-terra")}>
      {up ? "↑ +" : "↓ −"}
      {Math.abs(delta)} {unit}
    </span>
  );
}
