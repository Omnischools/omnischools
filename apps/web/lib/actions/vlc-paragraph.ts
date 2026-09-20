"use server";
/**
 * 🔴 INCR-43b — VLC CHARACTER PARAGRAPH mutations (SHS module 4.5). The ONLY writers of
 * `vlc_pastoral_paragraph`: `saveCharacterParagraph` (author / edit the draft, upsert on the one-per-student
 * UNIQUE) and `lockCharacterParagraph` (freeze it for the year-end reference letter).
 *
 * WRITE = own-class FM + Dean of Students, reused VERBATIM from 42b/43a via `canWritePastoralFlag`
 * (Dean-role OR own-class identity on the student's class, loaded server-side). The HEADMASTER can READ the
 * paragraph but NEVER writes it — HM is absent from the write gate, and every write re-checks server-side, so
 * an HM (or an ADMIN / other-class FM / PG / student / parent) is refused BEFORE a row is touched, including a
 * hand-crafted POST.
 *
 * FM-AUTHORED, NO machine derivation (owner #6): `body` is free text — there is NO AI / keyword / summary /
 * regenerate construct here, and the writer never reads any 43a casework body.
 *
 * ONE-WAY LOCK (R338): once `locked_at IS NOT NULL` the paragraph is frozen for the year — `saveCharacterParagraph`
 * REFUSES the edit and there is deliberately NO unlock action anywhere. EDITABLE-IN-PLACE while unlocked (unlike
 * the 43a append-only tables), so a revision bumps `body` + `updated_at` + `updated_by_user_id` on the one row.
 *
 * REDACTED audit (R339) — each write records exactly ONE metadata-only row: actionType + entityType
 * `vlc_pastoral_paragraph` + entityId + actor. NO body is passed into the reason or payload; the
 * `vlc_pastoral_` prefix branch in isRedactedAuditEntity suppresses the diff + reason regardless. Redaction ≠
 * read-gate. NO TRIGGERS (portability) — authorization lives here.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { canWritePastoralFlag } from "@/lib/vlc/authz";
import { VLC_PASTORAL_WRITE_ROLES, hasAnyRole } from "@/lib/access";
import { classes, students, vlcPastoralParagraph } from "@/db/schema";
import type { Tx } from "@/lib/db";

type Result = { ok: boolean; error?: string };
const referencePath = (studentId: string) => `/senior/vlc/reference/${studentId}`;
const REFUSED = "Only the student's own Form Master or a Dean can write the character paragraph.";
const LOCKED = "This paragraph is locked for the year-end reference and can no longer be edited.";

/**
 * The write check, re-run inside the tenant scope on every write — REUSES `canWritePastoralFlag` verbatim
 * (never re-implemented, never widened; the HEADMASTER is not in the WRITE_ROLES role gate). Loads the
 * target student's class teacher server-side (un-spoofable).
 */
async function mayWriteFor(
  tx: Tx,
  schoolId: string,
  studentId: string,
  roles: readonly string[],
  actorId: string | null,
): Promise<boolean> {
  if (!hasAnyRole(roles, VLC_PASTORAL_WRITE_ROLES)) return false;
  const [row] = await tx
    .select({ classTeacherUserId: classes.classTeacherUserId })
    .from(students)
    .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
    .limit(1);
  if (!row) return false;
  return canWritePastoralFlag({ roles, userId: actorId, classTeacherUserId: row.classTeacherUserId });
}

// ---- 1) Save (author / edit the draft) — upsert on UNIQUE(school_id, student_id), refused once locked ----

const SaveSchema = z.object({
  studentId: z.string().uuid(),
  body: z
    .string()
    .trim()
    .min(1, "Enter the character paragraph.")
    .max(3000, "Keep the paragraph to ≤3000 characters."),
});

/**
 * Author the paragraph (first draft) or revise it in place. Upsert on the one-per-student UNIQUE; on insert
 * stamps `author_user_id`, always stamps `updated_by_user_id` + `updated_at`. REFUSED once locked (R338).
 */
export async function saveCharacterParagraph(input: unknown): Promise<Result> {
  const parsed = SaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the paragraph." };
  const { studentId, body } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  try {
    return await withSchool(school.id, async (tx): Promise<Result> => {
      if (!(await mayWriteFor(tx, school.id, studentId, user.roles, actor.id))) {
        return { ok: false, error: REFUSED };
      }
      // R338 — a locked paragraph is frozen for the year (one-way; there is NO unlock action). Reject the edit.
      const [existing] = await tx
        .select({ lockedAt: vlcPastoralParagraph.lockedAt })
        .from(vlcPastoralParagraph)
        .where(and(eq(vlcPastoralParagraph.schoolId, school.id), eq(vlcPastoralParagraph.studentId, studentId)))
        .limit(1);
      if (existing?.lockedAt) return { ok: false, error: LOCKED };
      const [row] = await tx
        .insert(vlcPastoralParagraph)
        .values({
          schoolId: school.id,
          studentId,
          body,
          authorUserId: actor.id ?? undefined,
          updatedByUserId: actor.id ?? undefined,
        })
        .onConflictDoUpdate({
          target: [vlcPastoralParagraph.schoolId, vlcPastoralParagraph.studentId],
          set: { body, updatedAt: new Date(), updatedByUserId: actor.id ?? undefined },
          // Race-safe defense-in-depth of the R338 lock: never overwrite a paragraph locked between the
          // check above and this upsert.
          setWhere: isNull(vlcPastoralParagraph.lockedAt),
        })
        .returning({ id: vlcPastoralParagraph.id });
      if (!row) return { ok: false, error: LOCKED };
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "vlc_pastoral_paragraph",
        entityId: row.id,
        reason: "Character paragraph saved", // REDACTED — metadata only, never the body
      });
      safeRevalidate(referencePath(studentId));
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "Could not save the paragraph." };
  }
}

// ---- 2) Lock (freeze for the year-end reference) — one-way, NO unlock ---------------------------------

const LockSchema = z.object({ studentId: z.string().uuid() });

/**
 * Freeze the paragraph for the year-end reference letter: sets `locked_at` + `locked_by_user_id`. ONE-WAY —
 * only a DRAFT (`locked_at IS NULL`) transitions; an already-locked (or missing) paragraph is a no-op refusal.
 * There is deliberately NO unlock action in 43b.
 */
export async function lockCharacterParagraph(input: unknown): Promise<Result> {
  const parsed = LockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the request." };
  const { studentId } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  try {
    return await withSchool(school.id, async (tx): Promise<Result> => {
      if (!(await mayWriteFor(tx, school.id, studentId, user.roles, actor.id))) {
        return { ok: false, error: REFUSED };
      }
      const [row] = await tx
        .update(vlcPastoralParagraph)
        .set({ lockedAt: new Date(), lockedByUserId: actor.id ?? undefined })
        .where(
          and(
            eq(vlcPastoralParagraph.schoolId, school.id),
            eq(vlcPastoralParagraph.studentId, studentId),
            isNull(vlcPastoralParagraph.lockedAt), // one-way: only a draft transitions (never re-locks/unlocks)
          ),
        )
        .returning({ id: vlcPastoralParagraph.id });
      if (!row) return { ok: false, error: "There is no draft paragraph to lock (it may already be locked)." };
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "vlc_pastoral_paragraph",
        entityId: row.id,
        reason: "Character paragraph locked for year-end", // REDACTED — metadata only
      });
      safeRevalidate(referencePath(studentId));
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "Could not lock the paragraph." };
  }
}
