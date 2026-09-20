import { effectiveGrade, gradeOrdinal, type WassceGrade } from "./mock-grades";

/**
 * The WASSCE best-3 projection engine (SHS module 4.3 / INCR-17) — the analytical spine's CROWN JEWEL.
 * A PURE, DB-free function: safe on client or server, and the single source of truth for the projected
 * aggregate every downstream surface (§5 visualizer, the trajectory strip, the frozen readiness
 * statement) reads. NO trigger, NO stored live aggregate — the live number is DERIVED-on-read via this
 * lib; the only persisted copy is the immutable snapshot the generation action freezes.
 *
 * THE RULE (Kofi INCR-17, deterministic best-3 · Decision 12):
 *   • Partition subjects by type: CORE → core pool; ELECTIVE or OPTIONAL → elective pool (an OPTIONAL
 *     "Alt" competes for a best-3-elective slot).
 *   • Per-subject grade = the predictor mock's effective grade (COALESCE(moderated, teacher)); points =
 *     gradeOrdinal + 1 (A1=1 … F9=9).
 *   • If ≥3 GRADED cores AND ≥3 GRADED electives: sort each pool by (points asc, name asc) — a fully
 *     deterministic tie-break — count the first 3, drop the rest (dropped rows stay in the payload so the
 *     visualizer can render them greyed, never filtered). aggregate = Σ points of the 6 counted, D7–F9
 *     included (min 6 = six A1, max 54 = six F9).
 *   • If <3 in either pool → { computable: false, reason } — NEVER a partial 5-subject number (it would
 *     misread against cut-offs). A credit pass (isCredit, A1–C6) is a SEPARATE per-subject flag, never a
 *     filter on the aggregate sum (six F9 → 54, zero credits).
 *
 * DECISION 11 MEDICAL HOLD = STRUCTURAL: this function reads ONLY the predictor-mock grades handed to it.
 * It has NO papers/sittings parameter, so a missed or exempted live WASSCE paper (an SC-12 disruption)
 * cannot change the number — there is no `if (medical)` branch to get wrong. Mock 2 was sat in March,
 * before any exam-window disruption; the held Mock-2 grade IS the projection input. If Mock 2 itself is
 * incomplete for a candidate, that is the ordinary "<3 in a pool" not-computable case, not a hold.
 */

export type WassceSubjectType = "CORE" | "ELECTIVE" | "OPTIONAL";

/** One registered subject fed to the engine — the predictor-mock grade (null = ungraded, excluded). */
export type ProjectionSubjectInput = {
  name: string;
  type: WassceSubjectType;
  grade: WassceGrade | null; // teacher grade on the predictor mock; null = no result yet
  moderatedGrade?: WassceGrade | null; // COALESCEs over `grade` (the R3 moderation trail)
};

/** A subject after ranking — grade resolved, points assigned, counted/dropped decided. */
export type ProjectedSubject = {
  name: string;
  type: WassceSubjectType;
  grade: WassceGrade;
  points: number; // gradeOrdinal + 1 (A1=1 … F9=9)
  counted: boolean; // true = one of the best 3 in its pool; false = dropped (still rendered)
};

export type ProjectionReason = "INSUFFICIENT_CORES" | "INSUFFICIENT_ELECTIVES";

export type ProjectionResult =
  | {
      computable: true;
      aggregate: number; // 6..54
      band: string; // bandForAggregate(aggregate)
      cores: ProjectedSubject[]; // sorted (points asc, name asc); first 3 counted
      electives: ProjectedSubject[];
      subjects: ProjectedSubject[]; // [...cores, ...electives] — the frozen snapshot order
    }
  | { computable: false; reason: ProjectionReason };

/** The WAEC aggregate bands (6 best … 54 worst) — reused by the trajectory strip + §5 legend. */
export const AGGREGATE_BANDS = [
  { label: "Top tier", min: 6, max: 12 },
  { label: "Very good", min: 13, max: 18 },
  { label: "Fair", min: 19, max: 24 },
  { label: "Weak", min: 25, max: 36 },
  { label: "No clear path", min: 37, max: 54 },
] as const;

/** The frozen text band label for an aggregate (lib source of `readiness_statements.projected_band`). */
export function bandForAggregate(aggregate: number): string {
  const band = AGGREGATE_BANDS.find((b) => aggregate >= b.min && aggregate <= b.max);
  return band ? band.label : "—";
}

/** "Top tier · 6–12" — the band label with its range, for the trajectory/legend display. */
export function bandRangeLabel(aggregate: number): string {
  const band = AGGREGATE_BANDS.find((b) => aggregate >= b.min && aggregate <= b.max);
  return band ? `${band.label} · ${band.min}–${band.max}` : "—";
}

/**
 * Rank one pool: resolve each subject's effective grade, drop the ungraded, and — if 3+ remain — sort
 * (points asc, name asc) and flag the first 3 as counted. Returns null when fewer than 3 are graded (the
 * not-computable trigger). The name comparison is a plain codepoint compare (deterministic, no locale).
 */
function rankPool(pool: ProjectionSubjectInput[]): ProjectedSubject[] | null {
  const graded = pool
    .filter((s): s is ProjectionSubjectInput & { grade: WassceGrade } => s.grade != null)
    .map((s) => {
      const grade = effectiveGrade({ grade: s.grade, moderatedGrade: s.moderatedGrade });
      return { name: s.name, type: s.type, grade, points: gradeOrdinal(grade) + 1 };
    });
  if (graded.length < 3) return null;
  graded.sort((a, b) => a.points - b.points || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return graded.map((s, i) => ({ ...s, counted: i < 3 }));
}

/**
 * Compute the best-3 projected aggregate from a candidate's predictor-mock subject grades. Pure and
 * deterministic — the same input always yields the same number, and there is no papers/sittings input
 * that a live-exam disruption could perturb (Decision 11 is structural, not a branch).
 */
export function projectAggregate(subjects: ProjectionSubjectInput[]): ProjectionResult {
  const cores = rankPool(subjects.filter((s) => s.type === "CORE"));
  if (!cores) return { computable: false, reason: "INSUFFICIENT_CORES" };
  const electives = rankPool(
    subjects.filter((s) => s.type === "ELECTIVE" || s.type === "OPTIONAL"),
  );
  if (!electives) return { computable: false, reason: "INSUFFICIENT_ELECTIVES" };

  const subjectsOut = [...cores, ...electives];
  const aggregate = subjectsOut
    .filter((s) => s.counted)
    .reduce((sum, s) => sum + s.points, 0);

  return {
    computable: true,
    aggregate,
    band: bandForAggregate(aggregate),
    cores,
    electives,
    subjects: subjectsOut,
  };
}

/** The frozen snapshot subject shape — {name, type, grade, points, counted} (Ruling 4 jsonb). */
export type SnapshotSubject = {
  name: string;
  type: WassceSubjectType;
  grade: WassceGrade;
  points: number;
  counted: boolean;
};

/** The `projection_snapshot_json` shape frozen onto a readiness statement (Ruling 4). */
export type ProjectionSnapshot = {
  mock1Aggregate: number | null; // Mock-1 best-3 (trajectory); null when Mock-1 not computable
  mock2Aggregate: number; // predictor best-3 = projectedAggregate in INCR-17
  projectedAggregate: number; // == mock2Aggregate (no trajectory numeric adjust — Decision 12)
  band: string;
  subjects: SnapshotSubject[];
};
