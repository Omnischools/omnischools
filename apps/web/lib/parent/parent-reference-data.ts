import "server-only";
/**
 * 🔴 INCR-46 · the PARENT-facing VLC leaver character-reference reader (SHS module 4.5 × parent portal
 * 4.3 · Kofi R358–R365). The FIRST & ONLY VLC content a parent ever sees — a deliberate, owner-authorised
 * EXCEPTION to owner-#4 ("parents see NOTHING VLC-wide").
 *
 * Wells's `parent_scope` (prod-paste-0073 / policies.sql) opens EXACTLY ONE row to a parent: their OWN
 * child's FINALISED `vlc_pastoral_paragraph` (`locked_at IS NOT NULL AND student_id IN parent_student_ids`).
 * RLS is ROW-level and CANNOT mask a column, so THIS PROJECTION is the ONLY guard keeping everything but the
 * FM's finalised body off the wire. The reader therefore:
 *   • projects the FROZEN key-set below and NOTHING confidential — `body` is the ONLY column read off
 *     `vlc_pastoral_paragraph` (no severity / context / surfaced_by / draft-state / lock stamp / provenance
 *     actor beyond the FM author name);
 *   • touches ONLY `vlc_pastoral_paragraph` (+ `students` for the child's name, `ref_school` for the school
 *     name, `ref_user` for the FM author's name) — it JOINS NONE of the five confidential VLC tables
 *     (flag / journal / note / observation / case) and imports NONE of the confidential VLC readers
 *     (`getStudentCasework` / `getCharacterParagraph` / `getPastoralFlags`);
 *   • re-filters `locked_at IS NOT NULL` (belt-and-suspenders — draft-invisibility is a PRIVACY boundary,
 *     not display logic; a reader bug alone must not leak a draft even though RLS also bakes the gate in);
 *   • runs under `withParentScope` ONLY (the D10 parent-loader rule — NEVER withSchool/withoutTenantScope).
 *
 * `studentId` is an INPUT filter, resolved server-side from the guardian link (the parent-portal
 * `children[…].studentId`), NEVER a URL param, and NEVER returned. The `parent_scope` predicate
 * independently guarantees the id can only be one of THIS parent's own children AND is finalised — a
 * forged / other-child id, or a draft, yields zero rows (fail-closed). No parent write path exists.
 *
 * FM-AUTHORED, NO machine derivation (owner #6): `body` is free text; there is NO AI / summary / regenerate
 * construct here. `authorName` is the paragraph's own FM author (a school-leaver reference is attributed to
 * its author — the student's known Form Master, NOT a confidential pastoral-chain actor).
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { withParentScope } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { schools, students, users, vlcPastoralParagraph } from "@/db/schema";

/**
 * FROZEN KEY-SET (Kofi R360 + the Lucy attribution divergence). `parentLeaverReferenceTx()` returns EXACTLY
 * these five keys — a confidential field (severity / context / surfaced_by / any casework body / summary /
 * observed_by) spread onto it changes the key-set and reds parent-reference.test.ts (AC-5), not production.
 * NO studentId / ids / draft-state / lock stamp ever in the returned shape.
 */
export interface ParentLeaverReference {
  studentFirstName: string;
  studentFullName: string;
  schoolName: string;
  body: string; // the FINALISED paragraph, verbatim
  authorName: string; // the FM author's name, or "the Form Master"
}

/**
 * ONE child's FINALISED leaver paragraph, projected to the frozen key-set — or `null` (no finalised
 * paragraph, or a draft, or a non-own / forged id). MUST run on a tx already scoped by `withParentScope`.
 */
export async function parentLeaverReferenceTx(
  tx: Tx,
  schoolId: string,
  studentId: string,
): Promise<ParentLeaverReference | null> {
  const [row] = await tx
    .select({
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
      schoolName: schools.name,
      body: vlcPastoralParagraph.body,
      authorName: users.fullName,
    })
    .from(vlcPastoralParagraph)
    .innerJoin(
      students,
      and(
        eq(students.schoolId, vlcPastoralParagraph.schoolId),
        eq(students.id, vlcPastoralParagraph.studentId),
      ),
    )
    .innerJoin(schools, eq(schools.id, vlcPastoralParagraph.schoolId))
    .leftJoin(users, eq(users.id, vlcPastoralParagraph.authorUserId))
    .where(
      and(
        eq(vlcPastoralParagraph.schoolId, schoolId),
        eq(vlcPastoralParagraph.studentId, studentId),
        isNotNull(vlcPastoralParagraph.lockedAt), // 🔴 finalised-only (belt; RLS is the braces)
      ),
    )
    .limit(1);

  if (!row) return null;
  const studentFullName = `${row.studentFirstName} ${row.studentLastName}`.trim();
  const authorName = row.authorName ?? "the Form Master";
  return {
    studentFirstName: row.studentFirstName,
    studentFullName,
    schoolName: row.schoolName,
    body: row.body,
    authorName,
  };
}

/** Entry point — ONE child's finalised leaver reference under `withParentScope` (never `withSchool`). */
export async function loadParentLeaverReference(
  schoolId: string,
  userId: string,
  studentId: string,
): Promise<ParentLeaverReference | null> {
  return withParentScope(schoolId, userId, (tx) => parentLeaverReferenceTx(tx, schoolId, studentId));
}
