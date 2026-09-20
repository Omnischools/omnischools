import "server-only";
/**
 * 🔴 INCR-45 — the ONE existence seam boarding may use to read the VLC pastoral graph. Boarding (module
 * 4.2) NEVER SELECTs `vlc_pastoral_flag` directly; it asks this VLC-owned helper only "is this boarder
 * flagged?" and gets back a boolean / a Set of ids — never a row, never a reason. Replaces the retired
 * INCR-13 hardcoded boarding stub with the real `vlc_pastoral_flag` existence read.
 *
 * HARD INVARIANT (INCR-30 non-disclosure): the ONLY column ever projected here is `id` / `student_id`.
 * NEVER `severity` / `context` / `surfaced_by` / any body — boarding learns THAT a case exists, never why.
 * The VLC sole-content-path sweep (lib/vlc/vlc-pastoral.test.ts VLC42b-7) walks lib/ and asserts no file
 * but pastoral-data.ts projects flag content, so a `severity`/`context`/`surfacedBy` projection added here
 * turns that sweep RED — the guard-rail for this new seam.
 *
 * ACTIVE = `resolved_at IS NULL` (the open-row idiom; the partial `vlc_pastoral_flag_active_idx` serves
 * both queries). Tenant scoping rides the caller's `tx` (every boarding call site is already inside a
 * `withSchool` block) plus the explicit `school_id` predicate.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { vlcPastoralFlag } from "@/db/schema";

/**
 * True iff `studentId` has ≥1 ACTIVE pastoral flag in this school. EXISTS semantics (LIMIT 1). Existence
 * only — projects `id`, never confidential content. For single-student sites (the discipline bypass, the
 * per-visit arrival note).
 */
export async function hasActivePastoralFlag(
  tx: Tx,
  schoolId: string,
  studentId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: vlcPastoralFlag.id })
    .from(vlcPastoralFlag)
    .where(
      and(
        eq(vlcPastoralFlag.schoolId, schoolId),
        eq(vlcPastoralFlag.studentId, studentId),
        isNull(vlcPastoralFlag.resolvedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * The set of student ids with ≥1 ACTIVE pastoral flag in this school — ONE indexed query, membership-checked
 * across a roster/list (`.has(id)`). Existence only — projects `student_id`, never confidential content. For
 * the roster / discipline-card / visiting-list sites.
 */
export async function activePastoralFlagStudentIds(tx: Tx, schoolId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ studentId: vlcPastoralFlag.studentId })
    .from(vlcPastoralFlag)
    .where(and(eq(vlcPastoralFlag.schoolId, schoolId), isNull(vlcPastoralFlag.resolvedAt)));
  return new Set(rows.map((r) => r.studentId));
}
