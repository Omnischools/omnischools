import "server-only";
import { withSchool } from "@/lib/db/rls";
import { loadVhmProgress, rollupBySubject } from "@/lib/score-ledger/vhm-progress";

/**
 * GOV-4 · Senior-tier STPSHS readiness summary (R354 / R356) for the board dashboard.
 *
 * COMPLETION COUNTS ONLY — how many subjects are ready / partial / at-risk for STPSHS export, and
 * NOTHING ELSE. Never a score value, never a blocker name, never a teacher (§6.2 — the same
 * discipline the Vice-Headmaster and Headmaster roll-ups already enforce). It opens `withSchool`,
 * loads the same per-assignment progress the management views use (`loadVhmProgress`), reduces it to
 * per-subject buckets (`rollupBySubject`, pure), and returns four counts. The rollup composes this so
 * `school-rollup.ts` stays zero-SQL (R360).
 */
export type SeniorReadinessSummary = {
  subjectsTotal: number;
  subjectsReady: number;
  subjectsPartial: number;
  subjectsAtRisk: number;
};

export async function getSeniorReadiness(
  schoolId: string,
  opts: { periodId: string },
): Promise<SeniorReadinessSummary> {
  const rows = await withSchool(schoolId, (tx) =>
    loadVhmProgress(tx, schoolId, opts.periodId, new Date()),
  );
  const rollups = rollupBySubject(rows);
  // Bucket vocabulary mirrors the management roll-up: fully_ready → ready, partial, at_risk.
  return {
    subjectsTotal: rollups.length,
    subjectsReady: rollups.filter((s) => s.bucket === "fully_ready").length,
    subjectsPartial: rollups.filter((s) => s.bucket === "partial").length,
    subjectsAtRisk: rollups.filter((s) => s.bucket === "at_risk").length,
  };
}
