import { and, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { seniorSubjectTeacher, subjects, classes, wassceSubjects } from "@/db/schema";

/**
 * The R5 subject-correspondence seam (SHS module 4.3 / INCR-16) — the modelling join Sarah/Quinn attack.
 *
 * TWO subject vocabularies meet here:
 *   • `senior_subject_teacher.subject_id` → score-ledger `subject` (name + code) — a teacher's assignment.
 *   • `mock_results.subject_id`           → `wassce_subjects` (name only)         — the mock's subject.
 * There is no FK between them, so the correspondence is resolved by matching **(school_id, subject name)**
 * for the teacher's F3 assignments. A teacher may read/write `mock_results` ONLY for a `wassce_subject`
 * that maps to one of their `senior_subject_teacher` assignments — no cross-subject, no cross-cohort
 * (the composite tenant FKs + RLS already make cross-tenant/cross-cohort structurally impossible; this
 * function closes the cross-SUBJECT gap for a teacher acting outside their assignment — AC4).
 *
 * F3-scoped: WASSCE is the F3 cohort, so only Form-3 assignments authorise. A teacher who teaches
 * Chemistry to Form 2 only does NOT gain the F3 WASSCE Chemistry (matches the surface's F3 scope).
 */

/**
 * PURE matcher (unit-tested): given the DISTINCT names a teacher is assigned in F3 and the school's
 * wassce_subjects, return the ids of the wassce_subjects whose name the teacher is authorised for.
 * Case/space-insensitive name equality (the two vocabularies are hand-seeded — guard trivial drift).
 */
export function matchWassceSubjectIds(
  assignedF3SubjectNames: readonly string[],
  wassceSubjectRows: readonly { id: string; name: string }[],
): string[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const allowed = new Set(assignedF3SubjectNames.map(norm));
  return wassceSubjectRows.filter((w) => allowed.has(norm(w.name))).map((w) => w.id);
}

/**
 * Resolve the set of `wassce_subjects.id` a user may read/write mock results for, via their F3
 * `senior_subject_teacher` assignments. Empty set = no correspondence (a plain teacher → 0 rows / a
 * rejected write). Call inside `withSchool(...)`. wassce_subjects is school-level reference (shared
 * across cohorts), so the authorised set is cohort-independent — the write action pairs it with the
 * target mock's cohort + its marking lock.
 */
export async function resolveAuthorizedWassceSubjectIds(
  tx: Tx,
  schoolId: string,
  userId: string | null | undefined,
): Promise<Set<string>> {
  if (!userId) return new Set();

  // The teacher's F3 assignment subject names (score-ledger `subject`, joined via composite tenant FKs).
  const assigned = await tx
    .select({ name: subjects.name })
    .from(seniorSubjectTeacher)
    .innerJoin(
      subjects,
      and(
        eq(subjects.schoolId, seniorSubjectTeacher.schoolId),
        eq(subjects.id, seniorSubjectTeacher.subjectId),
      ),
    )
    .innerJoin(
      classes,
      and(
        eq(classes.schoolId, seniorSubjectTeacher.schoolId),
        eq(classes.id, seniorSubjectTeacher.classId),
      ),
    )
    .where(
      and(
        eq(seniorSubjectTeacher.schoolId, schoolId),
        eq(seniorSubjectTeacher.teacherUserId, userId),
        eq(classes.level, "Form 3"),
      ),
    );
  if (assigned.length === 0) return new Set();

  const wassceRows = await tx
    .select({ id: wassceSubjects.id, name: wassceSubjects.name })
    .from(wassceSubjects)
    .where(and(eq(wassceSubjects.schoolId, schoolId), eq(wassceSubjects.activeFlag, true)));

  return new Set(matchWassceSubjectIds(assigned.map((a) => a.name), wassceRows));
}
