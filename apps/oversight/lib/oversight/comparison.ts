import { RANK_CARD_MIN_CANDIDATES, type BreakdownRow } from "./breakdown";
import type { Exam } from "./performance";

/**
 * THE ENTITY CAP (Kofi R6.1) — a domain rule, so it lives in the engine beside the other R-rules, not
 * in the picker component (Dex M2). The pinned benchmark does not count toward it (R6.2).
 */
export const MAX_ENTITIES = 8;

/**
 * THE ATTENDANCE MARKING FLOOR (Kofi R9.4) — owner-movable, like RANK_CARD_MIN_CANDIDATES=30 for
 * WASSCE, and materially larger because `enrolled_days = pupils × school-days`: one term of a small
 * cohort is already in the thousands. It governs the SUPERLATIVE only — a school below the floor is
 * LISTED with its rate and its enrolled-days visible, but is not crowned best/worst (its rate rests on
 * too little marking to rank honestly). 2,000 ≈ a ~35-pupil cohort across a single term; the exact
 * integer is an owner/ops call (escalated), not a data fact.
 */
export const ATT_MIN_ENROLLED_DAYS = 2000;

/**
 * THE COMPARISON WORKSPACE ENGINE — pure, no db, no JSX (increment I).
 *
 * The surface itself (app/(oversight)/comparison) reuses `getChildBreakdown` UNCHANGED for its data
 * (COMPARISON-WORKSPACE-DATA-PLAN §1): the children it returns ARE the comparable entities one level
 * below the officer, already RLS-bounded and already rolled up per child. What this module adds is the
 * three decisions the comparison makes ON TOP of that row set, and nothing else:
 *
 *   1. THE BENCHMARK — the pinned "District/Region average" column. The LIKE-FOR-LIKE weighted roll-up
 *      over ALL children of the compared type (every SHS in the district), never the selected subset.
 *   2. BEST / WORST MARKING — per metric row, across the SELECTED REAL entities only (never the
 *      benchmark), direction-aware, behind a denominator floor, ≥2 eligible, ties mark-all-or-none.
 *   3. (left to the catalogue in the component) WHICH measure each row reads and how it formats.
 *
 * EVERYTHING HERE IS A FOLD OVER `BreakdownRow`s. It computes no SQL, holds no session, and reaches no
 * `scope.*` field — the same discipline the breakdown table's home-row tint follows (presentation is a
 * fact about ids already in the payload, not a second scoped read). So every property below is provable
 * from a literal array of rows, which is how `tests/oversight-comparison.test.ts` proves them.
 *
 * ═══ WHY THE BENCHMARK IS OVER *ALL* LIKE-FOR-LIKE CHILDREN, NOT THE SELECTION ═══════════════════════
 * A benchmark that moved as you tick a checkbox is not a reference line — deselecting a weak school would
 * "improve the district average", which is a lie about the district (Kofi R3.2). And it must equal the
 * figure the officer already sees on the district dashboard's own roll-up, or two surfaces disagree. So
 * the benchmark population is fixed by the LEVEL, not by the selection. It is NOT `breakdown.total`
 * either: that total is the whole subtree across ALL school levels (Wells §2A), so for a senior-high
 * comparison its enrolment and PTR would blend in basic schools. The honest benchmark is the roll-up over
 * the SHS subpopulation — computed here by summing the fact COMPONENTS already carried on each row
 * (`candidates`/`qualified`, `staffEnrolment`/`teachers`), the identical Σ÷Σ-over-rows fold the breakdown
 * module uses for its own reconciliation. No new query, no new DB object.
 */

/** Which end of a measure is "good" — decides the mark, and whether a row is marked at all. */
export type MetricDirection = "higher-better" | "lower-better" | "none";

/** The two superlative marks. `none`-direction and unresolved rows carry neither. */
export type Mark = "best" | "worst";

/** `Σnum ÷ Σden` over the population, pairing the two components per row. Null, never a laundered 0/0. */
export function weightedBenchmark(
  population: readonly BreakdownRow[],
  num: (row: BreakdownRow) => number | null,
  den: (row: BreakdownRow) => number | null,
): number | null {
  let sumNum = 0;
  let sumDen = 0;
  let any = false;
  for (const row of population) {
    // ONE skip rule, shared with `meanBenchmark` and with the contributor COUNT, so the figure and the
    // "over N schools" claim beside it can never describe different row sets.
    if (!contributes({ kind: "weighted", num, den }, row)) continue;
    sumNum += num(row)!;
    sumDen += den(row)!;
    any = true;
  }
  if (!any || sumDen === 0) return null;
  return sumNum / sumDen;
}

/**
 * The MEAN PER FILER — `Σvalue ÷ n` over the rows that actually filed the measure (Kofi R3.4).
 *
 * `n` counts FILERS, not the whole population: a school that filed nothing is null-not-zero everywhere
 * else on this surface, so it must not drag the mean down as if it enrolled zero pupils. Null when no
 * child filed (0 filers), never 0.
 */
export function meanBenchmark(
  population: readonly BreakdownRow[],
  value: (row: BreakdownRow) => number | null,
): number | null {
  let sum = 0;
  let filers = 0;
  for (const row of population) {
    if (!contributes({ kind: "mean", value }, row)) continue;
    sum += value(row)!;
    filers += 1;
  }
  if (filers === 0) return null;
  return sum / filers;
}

/**
 * DOES THIS ROW CONTRIBUTE TO THIS BENCHMARK? The ONE statement of the per-row skip rule the two
 * helpers above apply — `weighted` needs BOTH components (a half-filed row is not a measured zero on
 * either side), `mean` needs the value (a school that filed nothing must not drag the mean down as if
 * it enrolled zero pupils), and a `none`-kind benchmark has no contributors at all because there is no
 * benchmark to contribute to.
 *
 * Internal on purpose: what callers outside this module need is the COUNT (`benchmarkContributorsOf`),
 * and the figure a cell shows must come from the helper that applied the rule rather than from a
 * re-implementation of it beside the number.
 */
function contributes(spec: BenchmarkSpec, row: BreakdownRow): boolean {
  switch (spec.kind) {
    case "none":
      return false;
    case "mean":
      return spec.value(row) !== null;
    case "weighted":
      return spec.num(row) !== null && spec.den(row) !== null;
  }
}

/**
 * HOW MANY of the like-for-like population actually stand behind this metric's benchmark.
 *
 * THE OVER-CLAIM THIS EXISTS TO END. The surface used to compute "N schools" ONCE from
 * `benchmarkPopulation.length` and print it on EVERY row — but the benchmark SKIPS non-contributing
 * rows, and which rows those are is per-METRIC, not per-surface: vacancies is PUBLIC-only (GES sets no
 * establishment for private/mission schools — R3.5), attendance exists only for gradebook adopters
 * (R9.5b), qualification only for schools that sat the exam, girls' share only for enrolment filers.
 * So on most rows the honest contributor count is STRICTLY BELOW the population, and a single
 * population-wide numeral printed beside every figure asserts a base the figure does not have.
 *
 * Counted over the SAME predicate the benchmark itself folds over, so the two cannot drift. Zero means
 * no row filed the measure, and the benchmark is then null and the cell shows `—`. (The converse is
 * ALMOST exact: `weightedBenchmark` also returns null on a degenerate Σden = 0, where contributors
 * exist but divide to nothing. Rare enough to be an absence either way, and the cell still shows `—`.)
 */
export function benchmarkContributorsOf(
  population: readonly BreakdownRow[],
  spec: BenchmarkSpec,
): number {
  let n = 0;
  for (const row of population) if (contributes(spec, row)) n += 1;
  return n;
}

/**
 * BEST / WORST MARKS aligned to `values`, honouring every Kofi §R4 rule in one place so no cell ever
 * re-decides:
 *   · a `none`-direction row is never marked (size/price carries no valence — enrolment, fees);
 *   · only ELIGIBLE entities are candidates (the denominator floor, and the thin-coverage gate, are
 *     folded into `eligible[]` by the caller — an entity below the WASSCE candidate floor, or whose
 *     coverage is too thin to read a rate honestly, is listed with its value but cannot be crowned);
 *   · a null value is never eligible (no mark on an absent cell);
 *   · fewer than TWO eligible entities ⇒ NO marks at all (a one-entity row is a profile, not a ranking —
 *     the `rankEnds < 2` precedent);
 *   · a full tie (every eligible value equal, so max === min) ⇒ NO marks (there is no spread to mark);
 *   · otherwise EVERY entity sharing the best extreme is marked `best`, every one sharing the worst
 *     extreme `worst` — ties mark all, never an arbitrary one.
 *
 * `values` and `eligible` are aligned to the selected entity columns, in column order; the returned
 * array is aligned the same way. The benchmark is NOT in these arrays — it is never ranked (R4.1).
 */
export function rankMarks(
  values: readonly (number | null)[],
  eligible: readonly boolean[],
  direction: MetricDirection,
): (Mark | null)[] {
  const marks: (Mark | null)[] = values.map(() => null);
  if (direction === "none") return marks;

  const pool: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v !== null && eligible[i]) pool.push(v);
  }
  if (pool.length < 2) return marks;

  const max = Math.max(...pool);
  const min = Math.min(...pool);
  if (max === min) return marks; // no spread → nothing to mark

  const bestValue = direction === "higher-better" ? max : min;
  const worstValue = direction === "higher-better" ? min : max;

  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v === null || !eligible[i]) continue;
    if (v === bestValue) marks[i] = "best";
    else if (v === worstValue) marks[i] = "worst";
  }
  return marks;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * THE METRIC CATALOGUE AND THE MODEL ASSEMBLY — still pure, still a fold over rows.
 *
 * The catalogue is DATA: one entry per row of the comparison, each naming the measure it reads off a
 * `BreakdownRow`, how its benchmark is formed, and how it ranks. Keeping it as a table (not a switch at
 * each cell) is what makes "enrolment is never ranked", "WASSCE needs 30 candidates", "PTR is lower-
 * better" single facts rather than rules re-decided per cell. The component turns the model into JSX and
 * owns FORMATTING only (pupils vs percent vs `:1`); no decision lives there.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * How a cell's number is written. The component maps this to a formatter; the engine decides no format.
 *
 * `rate` is UNSIGNED — a plain "84%" under a header that names the measure. A measure whose rate can go
 * NEGATIVE needs `signedRate` instead, which carries a WORD for the same reason `signedCount` does: a
 * bare "−6%" in a vacancy column is unreadable, and under a "District average" header it misreads as
 * "6% below average" rather than "6% over establishment".
 */
export type MetricKind =
  | "pupils"
  | "count"
  | "rate"
  | "ratio"
  | "signedCount"
  | "signedRate";

/** The benchmark column's derivation for a metric (Kofi R3.4). `none` ⇒ no benchmark cell (coverage). */
export type BenchmarkSpec =
  | { kind: "none" }
  | { kind: "mean"; value: (row: BreakdownRow) => number | null }
  | {
      kind: "weighted";
      num: (row: BreakdownRow) => number | null;
      den: (row: BreakdownRow) => number | null;
    };

export interface ComparisonMetricSpec {
  key: string;
  section: string;
  label: string;
  subLabel: string;
  kind: MetricKind;
  /**
   * How the BENCHMARK cell is written, when it is a different shape from the cells.
   *
   * Absent ⇒ the benchmark is written like the cells, which is true of every metric but one. Teacher
   * vacancies is the exception by ruling: its cells are signed COUNTS while its benchmark is the weighted
   * vacancy RATE (Σvacancies ÷ Σestablished, V10) — two different units in one row, so the row has to be
   * able to say so rather than format a rate as if it were a count of posts. That benchmark is `signedRate`
   * and not `rate`: it crosses zero, and a signed figure carries a WORD here exactly as a signed count does.
   */
  benchmarkKind?: MetricKind;
  direction: MetricDirection;
  /** The value a cell shows, off one entity's row. Null ⇒ the muted `—`. */
  valueOf: (row: BreakdownRow) => number | null;
  benchmark: BenchmarkSpec;
  /**
   * The words on the rank dot. Present ONLY on a ranked (direction ≠ "none") metric — a `none`-direction
   * row is never marked, so it carries no label (Dex N1: no dead config inviting "does this rank?").
   */
  markLabel?: { best: string; worst: string };
  /**
   * An extra per-entity gate ON TOP of non-null before an entity can be crowned — the WASSCE candidate
   * floor (Kofi R4.3). Absent ⇒ any non-null, eligible entity may be marked.
   */
  floorOf?: (row: BreakdownRow) => boolean;
  /** When true, a thin-coverage column is excluded from THIS row's marking (Kofi R4.7). */
  coverageGated?: boolean;
  /** Rate rows draw a proportional bar; counts and ratios do not. */
  bar?: boolean;
}

/** One selected column: the entity's matched row (null ⇒ selected but filed no facts) + the coverage gate. */
export interface ComparisonColumnInput {
  id: string;
  /** Null when the selected entity is absent from the fact-driven breakdown (render a named `—` column). */
  row: BreakdownRow | null;
  /** True only at district/region depth when this entity's coverage is too thin to read a rate honestly. */
  coverageAmbiguous: boolean;
}

export interface ComparisonCell {
  value: number | null;
  mark: Mark | null;
}

export interface ComparisonMetricRow {
  metric: ComparisonMetricSpec;
  /** Aligned to the columns passed in, in order. */
  cells: ComparisonCell[];
  /** The pinned benchmark value, or null (absent cell, or `none`-kind benchmark). */
  benchmark: number | null;
  /**
   * HOW MANY like-for-like children stand behind THIS row's benchmark — per metric, because the skip
   * rule is per metric (see `benchmarkContributorsOf`). Carried on the row so the surface can state the
   * figure's real base beside it instead of re-printing the whole population's size on every row.
   * 0 ⇒ `benchmark` is null and the cell shows `—`.
   */
  benchmarkContributors: number;
}

export interface ComparisonSection {
  title: string;
  rows: ComparisonMetricRow[];
}

export interface ComparisonModel {
  sections: ComparisonSection[];
}

/**
 * THE CATALOGUE. Every measure reads off `BreakdownRow` — the fast-follow added the attendance components
 * to that row (one additive UNION arm; COMPARISON-FASTFOLLOW-DATA-PLAN). The 4-year trend stays ABSENT
 * rather than rendered as a `—` row claiming a measure exists; FEES is DEFERRED — it is
 * billed-not-collected distributional data with no pupil denominator (Kofi R11) that cannot be honestly
 * ranked or benchmarked on this surface. TEACHER VACANCIES is now BUILT: `fact_staffing` carries a signed
 * `vacancies` and a public-only `teaching_posts_established`, so the row reads a real signed net against
 * a real weighted vacancy-rate benchmark — UNRANKED, because neither a shortage nor a surplus is the
 * "good" end (VACANCY-SURFACING-RULING V10). GIRLS' SHARE is now BUILT: the enrolment grain is settled as
 * ANNUAL (enrolment-grain ruling), and the share reads femaleEnrolment ÷ enrolment off the same ANNUAL
 * fact as a real Σ÷Σ benchmark.
 *
 * ENROLMENT IS NOT RANKED (`direction: "none"`): a bigger school is not a "better" school — shown with
 * value and benchmark, never crowned good/bad, the mock's green/red overridden. The candidates row is the
 * WASSCE ranking weight made visible (R4.3), likewise unranked. GIRLS' SHARE is unranked too — a PARITY
 * measure, where neither more nor fewer girls is "better". Attendance (R9) IS ranked, higher-better.
 */
export function comparisonMetrics(args: {
  /** Null when the compared level sits no national exam (KG/PRIMARY/COMBINED) — the performance section
   * is then OMITTED, never rendered as `—`-filled rows claiming a measure that does not apply. */
  exam: Exam | null;
  hasCoverage: boolean;
}): ComparisonMetricSpec[] {
  const { exam, hasCoverage } = args;
  const metrics: ComparisonMetricSpec[] = [
    {
      key: "enrolment",
      section: "Enrolment",
      label: "Total enrolment",
      subLabel: "students on roll",
      kind: "pupils",
      direction: "none",
      valueOf: (r) => r.enrolment,
      benchmark: { kind: "mean", value: (r) => r.enrolment },
    },
    {
      key: "girlsShare",
      section: "Enrolment",
      label: "Girls' share",
      subLabel: "female ÷ total on roll",
      kind: "rate",
      // PARITY, NOT A MAXIMUM. `higher-better` would crown a 71%-female school over a 50/50 one, which is
      // not a finding; `lower-better` is worse. A parity-distance direction is a new ranking primitive and
      // is NOT in this change. So the row is shown with value and benchmark and is NEVER crowned — the same
      // posture `enrolment` and `candidates` already take.
      direction: "none",
      valueOf: (r) => r.girlsShare,
      // The REAL Σfemale ÷ Σtotal over the like-for-like population — never the mean of per-entity shares.
      benchmark: { kind: "weighted", num: (r) => r.femaleEnrolment, den: (r) => r.enrolment },
      bar: true,
    },
  ];
  if (exam !== null) {
    metrics.push(
      {
        key: "qualification",
        section: `Performance · ${exam}`,
        label: `${exam} qualification`,
        subLabel: "credit or above (A1–C6)",
        kind: "rate",
        direction: "higher-better",
        valueOf: (r) => r.wassceRate,
        benchmark: { kind: "weighted", num: (r) => r.qualified, den: (r) => r.candidates },
        markLabel: { best: "highest", worst: "lowest" },
        // The candidate floor governs the SUPERLATIVE only — a 7-candidate 100% is not "the strongest".
        floorOf: (r) => r.candidates !== null && r.candidates >= RANK_CARD_MIN_CANDIDATES,
        coverageGated: true,
        bar: true,
      },
      {
        key: "candidates",
        section: `Performance · ${exam}`,
        label: "Candidates",
        subLabel: "cohort size · the ranking weight",
        kind: "count",
        direction: "none",
        valueOf: (r) => r.candidates,
        benchmark: { kind: "mean", value: (r) => r.candidates },
      },
    );
  }
  metrics.push({
    // ATTENDANCE — HIGHER-is-better (Kofi R9), ranked green/red. The weighted Σpresent ÷ Σenrolled, over
    // the like-for-like population for the benchmark. A school is crowned only above ATT_MIN_ENROLLED_DAYS
    // (R9.4) — a near-empty or part-term gradebook roll-out is listed with its rate but not ranked. The
    // sub-label carries the gradebook/internal-data provenance (R9.5a); a school not on the gradebook
    // files nothing → "—", never 0%, and is unranked (R9.5b). `coverageGated` keeps a thin-EMIS-coverage
    // district/region from being crowned worst (R9.5c / AC28); at school depth coverage is never thin.
    key: "attendance",
    section: "Attendance",
    label: "Attendance rate",
    subLabel: "present ÷ enrolled days · gradebook schools only",
    kind: "rate",
    direction: "higher-better",
    valueOf: (r) => r.attendanceRate,
    benchmark: { kind: "weighted", num: (r) => r.presentDays, den: (r) => r.enrolledDays },
    markLabel: { best: "highest", worst: "lowest" },
    floorOf: (r) => r.enrolledDays !== null && r.enrolledDays >= ATT_MIN_ENROLLED_DAYS,
    coverageGated: true,
    bar: true,
  });
  metrics.push(
    {
      key: "ptr",
      section: "Staffing",
      label: "Pupil-teacher ratio",
      subLabel: "students per teacher · lower is better",
      kind: "ratio",
      direction: "lower-better",
      valueOf: (r) => r.ptr,
      benchmark: { kind: "weighted", num: (r) => r.staffEnrolment, den: (r) => r.teachers },
      markLabel: { best: "best", worst: "worst" },
    },
    {
      /**
       * TEACHER VACANCIES — the mock's one attested vacancy surface (comparison workspace, "Attendance &
       * staffing", directly under Pupil-teacher ratio), ruled by VACANCY-SURFACING-RULING V10.
       *
       * UNRANKED (`direction: "none"`), and that is the ruling's core posture, not a deferral: BOTH signs
       * are adverse in different ways — a shortage understaffs a school, a surplus misallocates teachers
       * away from the schools that are short — so there is no single "better" end to crown. Marking the
       * largest surplus "best" would assert that over-establishment is a good outcome, which is the exact
       * category error `girlsShare` (a parity measure) and `enrolment` (a size) already refuse. So the row
       * is shown with its value and its benchmark and is never crowned; it carries no `markLabel`, so the
       * mock's `most` dot does not render (Dex N1: no dead config).
       *
       * THE VALUE IS THE SIGNED NET WITH A WORD (V6) — `signedCount`, so no cell can print a bare signed
       * integer: positive renders "+n unfilled" in terra, negative "n over" in neutral navy (never green),
       * a real 0 "balanced". A per-entity signed net is honest at this grain for the same reason the
       * breakdown's per-child column is (V9): the columns ARE the split a tier net would cancel.
       *
       * THE BENCHMARK IS THE WEIGHTED VACANCY RATE — Σvacancies ÷ Σestablished over the LIKE-FOR-LIKE
       * population, never the mean of per-entity nets, and over PUBLIC children only by construction:
       * `weightedBenchmark` skips any row where either component is null, and establishment/vacancies are
       * NULL together for every private/mission entity (STAFFING-PTR-DOMAIN-RULING §4). So a private
       * school is a named `—` cell AND contributes nothing to the reference line (V10, AC-15). It is a
       * RATE while the cells are counts, which is why it carries its own `benchmarkKind` — and a SIGNED
       * one (`signedRate`), so the reference cell reads "6% short" / "6% over" and never a bare "−6%"
       * that, under the "District average" header, would misread as "6% below average".
       */
      key: "teacherVacancies",
      section: "Staffing",
      // Verbatim from the mock (`Surfaces/schoolup-oversight-comparison-workspace.html` line 571).
      label: "Teacher vacancies",
      subLabel: "vs GES establishment",
      kind: "signedCount",
      direction: "none",
      valueOf: (r) => r.vacancyNet,
      benchmark: {
        kind: "weighted",
        num: (r) => r.vacancyNet,
        den: (r) => r.postsEstablished,
      },
      benchmarkKind: "signedRate",
    },
  );
  if (hasCoverage) {
    metrics.push({
      key: "coverage",
      section: "Coverage",
      label: "School coverage",
      subLabel: "on Omnischools / EMIS register",
      kind: "rate",
      direction: "higher-better",
      valueOf: (r) => r.coverageRatio,
      // Coverage is a property of the officer's register, not an entity figure to average (Kofi R3.6).
      benchmark: { kind: "none" },
      markLabel: { best: "fullest", worst: "thinnest" },
      bar: true,
    });
  }
  return metrics;
}

/**
 * ASSEMBLE THE RENDER MODEL. `benchmarkPopulation` is the LIKE-FOR-LIKE child set (all SHS in the
 * district, fixed by level — never the selection); `columns` are the selected entities, in order.
 *
 * The benchmark is computed ONCE per metric over the population and never touches the selection, so
 * deselecting a column cannot move it (Kofi R3.2 / AC11). Marks are computed over the columns only, with
 * the benchmark excluded by construction (it is not in `columns`).
 */
export function buildComparison(args: {
  metrics: readonly ComparisonMetricSpec[];
  benchmarkPopulation: readonly BreakdownRow[];
  columns: readonly ComparisonColumnInput[];
}): ComparisonModel {
  const { metrics, benchmarkPopulation, columns } = args;
  const sections: ComparisonSection[] = [];

  for (const metric of metrics) {
    const cells: ComparisonCell[] = columns.map((col) => ({
      value: col.row === null ? null : metric.valueOf(col.row),
      mark: null,
    }));

    const eligible = columns.map((col, i) => {
      if (col.row === null || cells[i]!.value === null) return false;
      if (metric.floorOf && !metric.floorOf(col.row)) return false;
      if (metric.coverageGated && col.coverageAmbiguous) return false;
      return true;
    });

    const marks = rankMarks(
      cells.map((c) => c.value),
      eligible,
      metric.direction,
    );
    marks.forEach((mark, i) => {
      cells[i]!.mark = mark;
    });

    const benchmark =
      metric.benchmark.kind === "none"
        ? null
        : metric.benchmark.kind === "mean"
          ? meanBenchmark(benchmarkPopulation, metric.benchmark.value)
          : weightedBenchmark(
              benchmarkPopulation,
              metric.benchmark.num,
              metric.benchmark.den,
            );

    // The honest base of the figure just computed, over the same predicate the fold used — so the row
    // carries its own contributor count rather than inheriting the surface's population size.
    const benchmarkContributors = benchmarkContributorsOf(
      benchmarkPopulation,
      metric.benchmark,
    );

    const section = sections.find((s) => s.title === metric.section);
    const row: ComparisonMetricRow = { metric, cells, benchmark, benchmarkContributors };
    if (section) section.rows.push(row);
    else sections.push({ title: metric.section, rows: [row] });
  }

  return { sections };
}
