import { GRADE_COLORS, GRADE_CHIP_TEXT } from "@/lib/wassce/grade-colors";
import { AGGREGATE_BANDS } from "@/lib/wassce/projection";
import type { ProjectionRowView, ProjectionView } from "@/lib/wassce/readiness-view";

/**
 * §5 aggregate-construction visualizer (SHS module 4.3 / INCR-17) — the CROWN JEWEL. Deterministic
 * best-3 display: of the 4 cores keep the 3 lowest-point, of the 4 electives keep the 3 lowest-point,
 * aggregate = Σ of the 6 counted. The DROPPED subject stays rendered at `opacity-45` (never filtered) —
 * the Decision-12 "greyed-but-visible" mechanic that makes the calculation auditable. Presentational
 * only: it takes the pre-formatted `ProjectionView` and imports NO db (safe on client or server).
 * No-alpha discipline: opacity-45 on a solid row (never slash-opacity on a raw hex token); grade chips
 * are inline solid hex.
 */

function GradeChip({ grade }: { grade: string }) {
  return (
    <span
      className="inline-flex h-6 min-w-[26px] items-center justify-center rounded-sm px-1 font-display text-[11px] font-semibold"
      style={{ background: GRADE_COLORS[grade as keyof typeof GRADE_COLORS] ?? "#5C6675", color: GRADE_CHIP_TEXT }}
    >
      {grade}
    </span>
  );
}

function AggRow({ row }: { row: ProjectionRowView }) {
  return (
    <div
      className={`flex items-center gap-3 border-b border-border py-2.5 last:border-b-0 ${row.counted ? "" : "opacity-45"}`}
    >
      <span className="flex-1 text-[13px] text-navy-2">
        <b className="text-navy">{row.name}</b> · <GradeChip grade={row.grade} />
        {row.projected ? <span className="ml-1 text-[11px] italic text-navy-3">(projected)</span> : null}
      </span>
      <span className="min-w-[50px] text-right font-mono text-[12px] font-semibold text-navy-2">
        {row.pointsLabel}
      </span>
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${
          row.counted ? "bg-green-bg text-green" : "border border-border bg-bg text-navy-3"
        }`}
      >
        {row.statusLabel}
      </span>
    </div>
  );
}

export function WassceAggregateVisualizer({ projection }: { projection: ProjectionView }) {
  if (!projection.computable) {
    return (
      <div className="rounded-lg border border-dashed border-border-2 bg-surface p-8 text-center text-[13px] text-navy-3">
        The projected aggregate is <b className="text-navy-2">not yet computable</b> —{" "}
        {projection.reason === "INSUFFICIENT_CORES"
          ? "the candidate needs at least 3 graded core subjects in the predictor mock."
          : "the candidate needs at least 3 graded elective subjects in the predictor mock."}{" "}
        No partial number is shown (it would misread against university cut-offs).
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      {/* the builder */}
      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
          Cores · {projection.cores.length} subjects · best 3 count
        </div>
        <div className="mb-5">
          {projection.cores.map((r) => (
            <AggRow key={r.name} row={r} />
          ))}
        </div>

        <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
          Electives · {projection.electives.length} subjects · best 3 count
        </div>
        <div className="mb-5">
          {projection.electives.map((r) => (
            <AggRow key={r.name} row={r} />
          ))}
        </div>

        <div className="flex items-center justify-between border-t-2 border-navy pt-3.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-navy-3">
            Aggregate · best 3 cores + best 3 electives
          </span>
          <span className="font-display text-4xl font-medium text-green">{projection.aggregate}</span>
        </div>
      </div>

      {/* right rail — explainer + (conditional) medical-hold caveat */}
      <div className="space-y-3.5">
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">
            How aggregate works
          </div>
          <div className="space-y-2 text-[12px] leading-relaxed text-navy-2">
            <p>
              WASSCE grades convert to points on a 1–9 scale:{" "}
              <b className="text-navy">A1=1, B2=2, B3=3, C4=4, C5=5, C6=6, D7=7, E8=8, F9=9</b>. A1–C6
              are credit passes (count for university); D7–F9 do not.
            </p>
            <p>
              The <b className="text-navy">aggregate</b> is the sum of points from the best 3 cores plus
              the best 3 electives. The minimum possible is 6 (six A1s); the maximum is 54.
            </p>
            <p>
              Lower aggregate = better. Universities publish a <b className="text-navy">cut-off</b> — the
              worst aggregate they admit for a programme.
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {["A1", "B2", "B3", "C4", "C5", "C6", "D7", "F9"].map((g) => (
              <GradeChip key={g} grade={g} />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5 text-[10px] text-navy-3">
            {AGGREGATE_BANDS.slice(0, 3).map((b) => (
              <span key={b.label}>
                <b className="text-navy-2">{b.min}–{b.max}</b> {b.label.toLowerCase()}
              </span>
            ))}
          </div>
        </div>

        {projection.holding ? (
          <div className="rounded-lg border border-gold-soft bg-gold-bg p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-gold">
              Projection caveat
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-navy-2">
              A counted subject is <b className="text-navy">projected</b> from Mock 2 — its live paper was
              missed under an active special consideration. If the SC make-up sitting yields a different
              grade, the aggregate recomputes automatically. The current projection{" "}
              <b className="text-navy">holds at {projection.aggregate}</b> until WAEC releases scores in
              mid-August.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
