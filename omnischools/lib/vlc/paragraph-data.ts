import "server-only";
/**
 * 🔴 INCR-43b — the SOLE read path for the VLC CHARACTER PARAGRAPH (SHS module 4.5): the FM-authored
 * school-leaver reference paragraph, and the module's ONE wider-than-FM+Dean read (owner #2, +HEADMASTER).
 *
 * A DISTINCT reader from `getStudentCasework` (lib/vlc/pastoral-data.ts) BY DESIGN — it is the structural
 * guarantee that the Headmaster sees the paragraph and NOTHING ELSE confidential. Its projection is ONLY the
 * `vlc_pastoral_paragraph` row (body / locked_at / provenance) + the student's name/class. It does NOT join,
 * cannot return, and never imports the four 43a casework bodies (journal / note / observation / case). The
 * HM never reaches `getStudentCasework` (VLC_PASTORAL_READ_ROLES stays HM-free) and the 43a journal page
 * `notFound()`s him; this reader is his only VLC content path.
 *
 * TWO-LAYER access (owner #2 + surface L606). RLS (FORCE + tenant_isolation + parent_deny) is the tenant +
 * parent boundary; this reader is the INTRA-tenant app scoping:
 *   • ROLE gate — the caller must hold FORM_MASTER / DEAN_OF_STUDENTS / HEADMASTER (VLC_PARAGRAPH_READ_ROLES);
 *     ADMIN / PG / student / parent get `null`, never a row.
 *   • READ narrowing — an own-class FM or a Dean (the AUTHORS, `canAccessPastoralFlag`) reads the paragraph
 *     in ANY state (empty / draft / locked). The HEADMASTER's read is FINALISED-ONLY: he sees the paragraph
 *     ONLY once `locked_at IS NOT NULL`; a draft or an empty slot returns `null` (he never learns an
 *     unfinished paragraph exists). An other-class FM fails the identity clause and gets `null`.
 *
 * FM-AUTHORED, NO machine derivation (owner #6): `body` is free text; there is NO AI / keyword / sentiment /
 * auto-summary / regenerate construct anywhere in this file. The route turns a `null` return into
 * `notFound()` — no "a paragraph exists" existence leak.
 */
import { and, eq } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { classes, students, users, vlcPastoralParagraph } from "@/db/schema";
import { VLC_PARAGRAPH_READ_ROLES, hasAnyRole } from "@/lib/access";
import { canAccessPastoralFlag, canReadPastoralParagraph } from "@/lib/vlc/authz";
import { classFormNumber } from "@/lib/senior/form";

export interface ParagraphCaller {
  roles: readonly string[];
  userId: string | null | undefined;
}

export interface CharacterParagraphView {
  studentId: string;
  classTeacherUserId: string | null; // returned so the page computes the (identical) write gate
  student: {
    fullName: string;
    formLabel: string | null; // "F3"
    className: string | null;
  };
  // null = the empty state (no paragraph row yet) — reachable ONLY by an author (own-class FM / Dean); the
  // Headmaster's finalised-only fence returns `null` from the reader for an empty or draft paragraph.
  paragraph: {
    body: string;
    locked: boolean;
    provenanceLabel: string; // "Draft · written by X · last edited …" / "Locked for year-end · written by X · locked …"
  } | null;
}

// Ghana is UTC+0 (Africa/Accra), so the civil date is UTC — pin it so a raw timestamp never ships.
const dateLabelOf = (d: Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);

/**
 * The character paragraph for ONE student — or `null` for a caller who may not see it (the route `notFound`s
 * on null). The reader IS the gate AND the sole content path: it projects only the paragraph row, so no bug
 * can surface casework here. `classTeacherUserId` is loaded server-side / un-spoofable (the own-class fence).
 */
export async function getCharacterParagraph(
  schoolId: string,
  caller: ParagraphCaller,
  studentId: string,
): Promise<CharacterParagraphView | null> {
  // ROLE gate — ADMIN / PG / student / parent never reach the content (HM is admitted; the state fence is below).
  if (!hasAnyRole(caller.roles, VLC_PARAGRAPH_READ_ROLES)) return null;

  return withSchool(schoolId, async (tx) => {
    // 1) student → class → class teacher (the fence anchor, server-loaded / un-spoofable).
    const [stu] = await tx
      .select({
        firstName: students.firstName,
        lastName: students.lastName,
        className: classes.name,
        classLevel: classes.level,
        classTeacherUserId: classes.classTeacherUserId,
      })
      .from(students)
      .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
      .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
      .limit(1);
    if (!stu) return null;

    const gateInput = {
      roles: caller.roles,
      userId: caller.userId,
      classTeacherUserId: stu.classTeacherUserId,
    };
    // Read admission: own-class FM OR Dean OR Headmaster. An other-class FM fails here → null (no leak).
    if (!canReadPastoralParagraph(gateInput)) return null;
    // The AUTHORS (own-class FM / Dean) read ANY state; the Headmaster is admitted by the role arm but is
    // FINALISED-ONLY below.
    const canAccess = canAccessPastoralFlag(gateInput);

    // 2) the paragraph row — the SOLE projection. Joins ONLY ref_user (the last editor's name); it never
    // touches the four casework tables.
    const [row] = await tx
      .select({
        body: vlcPastoralParagraph.body,
        lockedAt: vlcPastoralParagraph.lockedAt,
        updatedAt: vlcPastoralParagraph.updatedAt,
        editorName: users.fullName,
      })
      .from(vlcPastoralParagraph)
      .leftJoin(users, eq(users.id, vlcPastoralParagraph.updatedByUserId))
      .where(
        and(
          eq(vlcPastoralParagraph.schoolId, schoolId),
          eq(vlcPastoralParagraph.studentId, studentId),
        ),
      )
      .limit(1);

    const finalised = !!row?.lockedAt;
    // 🔴 THE FINALISED-ONLY FENCE (owner #2 / surface L606) — a non-author (i.e. the Headmaster) sees the
    // paragraph ONLY once it is locked; a draft or an empty slot is invisible to him (null → notFound).
    if (!canAccess && !finalised) return null;

    const formLabel = (() => {
      const f = classFormNumber(stu.classLevel, stu.className ?? "");
      return f ? `F${f}` : null;
    })();
    const author = row?.editorName ?? "the Form Master";

    const paragraph = row
      ? {
          body: row.body,
          locked: finalised,
          provenanceLabel: finalised
            ? `Locked for year-end · written by ${author} · locked ${dateLabelOf(row.lockedAt!)}`
            : `Draft · written by ${author} · last edited ${dateLabelOf(row.updatedAt)}`,
        }
      : null; // empty state — only an author reaches here (the HM fence returned null above)

    return {
      studentId,
      classTeacherUserId: stu.classTeacherUserId ?? null,
      student: {
        fullName: `${stu.firstName} ${stu.lastName}`,
        formLabel,
        className: stu.className ?? null,
      },
      paragraph,
    } satisfies CharacterParagraphView;
  });
}
