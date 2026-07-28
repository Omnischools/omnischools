"use server";
/**
 * 🔴 INCR-43a — VLC CONFIDENTIAL casework mutations (SHS module 4.5). The ONLY writers of the four
 * `vlc_pastoral_*` casework tables. STAFF-FACING: the Form Master (or a Dean) records everything — the
 * reflection journal, the FM/Dean note, the PG observation (the PG is a free-text `observed_by`
 * attribution, NEVER a principal), and the running case summary. There is NO student and NO Peer-Guide
 * writer anywhere.
 *
 * WRITE = READ (owner-locked, reused VERBATIM from 42b): the flagged/observed student's OWN-CLASS Form
 * Master OR a Dean of Students — enforced server-side on EVERY action by the role gate
 * (VLC_PASTORAL_WRITE_ROLES) AND `canWritePastoralFlag` (Dean-role OR own-class identity on the target
 * student's class, loaded server-side). An ADMIN, a HEADMASTER, an other-class FM, a Peer Guide, a
 * student, and a parent are all refused BEFORE a row is touched — including a hand-crafted POST.
 *
 * APPEND-ONLY (HARD): journal / note / observation are insert-only. There is deliberately NO update and
 * NO delete action for them anywhere — a correction is a NEW row (the "a journal that cannot be edited is
 * a journal that can be trusted" contract). `vlc_pastoral_case` is the SOLE editable table: `createCase`
 * opens the 1:1 summary on a flag, `editCase` revises it in place (bumps last_revised_*). No delete.
 *
 * REDACTED audit (R332) — each write records exactly ONE audit row: actionType + entityType
 * `vlc_pastoral_*` + entityId + actor. NO body / summary / observed_by / student is passed into the reason
 * or payload (metadata only); the `vlc_pastoral_` prefix branch in isRedactedAuditEntity suppresses the
 * diff + reason at both feed sites regardless. NO TRIGGERS (portability) — authorization lives here.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { canWritePastoralFlag } from "@/lib/vlc/authz";
import { VLC_PASTORAL_WRITE_ROLES, hasAnyRole } from "@/lib/access";
import {
  classes,
  students,
  vlcPastoralCase,
  vlcPastoralFlag,
  vlcPastoralJournal,
  vlcPastoralNote,
  vlcPastoralObservation,
  vlcSession,
} from "@/db/schema";
import type { Tx } from "@/lib/db";

type Result = { ok: boolean; error?: string };
const journalPath = (studentId: string) => `/senior/vlc/journal/${studentId}`;
const REFUSED = "Only the student's own Form Master or a Dean can record casework.";

/**
 * The casework WRITE check, re-run inside the tenant scope on every write — REUSES `canWritePastoralFlag`
 * verbatim (never re-implemented, never widened). Loads the target student's class teacher server-side
 * (un-spoofable) and returns the class id (for the class-match assertion on a session-linked entry).
 */
async function mayWriteFor(
  tx: Tx,
  schoolId: string,
  studentId: string,
  roles: readonly string[],
  actorId: string | null,
): Promise<{ ok: boolean; classId: string | null }> {
  if (!hasAnyRole(roles, VLC_PASTORAL_WRITE_ROLES)) return { ok: false, classId: null };
  const [row] = await tx
    .select({ classId: students.classId, classTeacherUserId: classes.classTeacherUserId })
    .from(students)
    .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
    .limit(1);
  if (!row) return { ok: false, classId: null };
  const ok = canWritePastoralFlag({ roles, userId: actorId, classTeacherUserId: row.classTeacherUserId });
  return { ok, classId: row.classId };
}

/** Resolve a flag → its flagged student (the gate anchor for the case actions). */
async function studentOfFlag(tx: Tx, schoolId: string, flagId: string): Promise<string | null> {
  const [row] = await tx
    .select({ studentId: vlcPastoralFlag.studentId })
    .from(vlcPastoralFlag)
    .where(and(eq(vlcPastoralFlag.schoolId, schoolId), eq(vlcPastoralFlag.id, flagId)))
    .limit(1);
  return row?.studentId ?? null;
}

// ---- 1) Journal entry — APPEND-ONLY -------------------------------------------------------------

const JournalSchema = z.object({
  studentId: z.string().uuid(),
  sessionId: z.string().uuid().nullish(),
  body: z.string().trim().min(1, "Enter the reflection.").max(4000, "Keep the reflection to ≤4000 characters."),
});

/** Record ONE reflection entry the FM captures for the student. Insert-only — no edit, no delete. */
export async function createJournalEntry(input: unknown): Promise<Result> {
  const parsed = JournalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the entry." };
  const { studentId, body } = parsed.data;
  const sessionId = parsed.data.sessionId ?? null;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  try {
    return await withSchool(school.id, async (tx): Promise<Result> => {
      const gate = await mayWriteFor(tx, school.id, studentId, user.roles, actor.id);
      if (!gate.ok) return { ok: false, error: REFUSED };
      // Class-match: a session-linked entry's session MUST belong to the student's class (defense against
      // a hand-crafted cross-class sessionId; a NULL sessionId is legal and skips the check).
      if (sessionId) {
        const [sess] = await tx
          .select({ classId: vlcSession.classId })
          .from(vlcSession)
          .where(and(eq(vlcSession.schoolId, school.id), eq(vlcSession.id, sessionId)))
          .limit(1);
        if (!sess || sess.classId !== gate.classId) {
          return { ok: false, error: "That session belongs to a different class than the student." };
        }
      }
      const [row] = await tx
        .insert(vlcPastoralJournal)
        .values({ schoolId: school.id, studentId, sessionId: sessionId ?? undefined, body, recordedByUserId: actor.id ?? undefined })
        .returning({ id: vlcPastoralJournal.id });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "vlc_pastoral_journal",
        entityId: row.id,
        reason: "Journal entry recorded", // REDACTED — metadata only, no body/student
      });
      safeRevalidate(journalPath(studentId));
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "Could not record the entry." };
  }
}

// ---- 2) FM/Dean note — APPEND-ONLY --------------------------------------------------------------

const NoteSchema = z.object({
  studentId: z.string().uuid(),
  body: z.string().trim().min(1, "Enter the note.").max(4000, "Keep the note to ≤4000 characters."),
});

/** Append ONE FM/Dean pastoral note. Insert-only — no edit, no delete (the accreting `N of N`). */
export async function createPastoralNote(input: unknown): Promise<Result> {
  const parsed = NoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the note." };
  const { studentId, body } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  try {
    return await withSchool(school.id, async (tx): Promise<Result> => {
      const gate = await mayWriteFor(tx, school.id, studentId, user.roles, actor.id);
      if (!gate.ok) return { ok: false, error: REFUSED };
      const [row] = await tx
        .insert(vlcPastoralNote)
        .values({ schoolId: school.id, studentId, body, authorUserId: actor.id ?? undefined })
        .returning({ id: vlcPastoralNote.id });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "vlc_pastoral_note",
        entityId: row.id,
        reason: "Pastoral note added",
      });
      safeRevalidate(journalPath(studentId));
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "Could not add the note." };
  }
}

// ---- 3) PG observation — APPEND-ONLY (PG = free-text DATA) --------------------------------------

const ObservationSchema = z.object({
  studentId: z.string().uuid(),
  observedBy: z.string().trim().min(1, "Name the Peer Guide.").max(80, "Keep the Peer Guide attribution short (≤80)."),
  body: z.string().trim().min(1, "Enter the observation.").max(4000, "Keep the observation to ≤4000 characters."),
});

/** Record ONE Peer-Guide observation the FM captures; `observed_by` is the PG named as DATA (no PG login,
 *  no PG write). Insert-only — no edit, no delete. */
export async function createObservation(input: unknown): Promise<Result> {
  const parsed = ObservationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the observation." };
  const { studentId, observedBy, body } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  try {
    return await withSchool(school.id, async (tx): Promise<Result> => {
      const gate = await mayWriteFor(tx, school.id, studentId, user.roles, actor.id);
      if (!gate.ok) return { ok: false, error: REFUSED };
      const [row] = await tx
        .insert(vlcPastoralObservation)
        .values({ schoolId: school.id, studentId, observedBy, body, recordedByUserId: actor.id ?? undefined })
        .returning({ id: vlcPastoralObservation.id });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "vlc_pastoral_observation",
        entityId: row.id,
        reason: "Peer Guide observation recorded",
      });
      safeRevalidate(journalPath(studentId));
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "Could not record the observation." };
  }
}

// ---- 4) Case summary — the SOLE editable table (open once per flag, then revise in place) --------

const CreateCaseSchema = z.object({
  flagId: z.string().uuid(),
  summary: z.string().trim().min(1, "Enter the case summary.").max(8000, "Keep the summary to ≤8000 characters."),
});

/** Open the 1:1 running case summary on a flag. `UNIQUE(school_id, flag_id)` makes a second case on the
 *  same flag a conflict (rejected). Gate on the flagged student's class. */
export async function createCase(input: unknown): Promise<Result> {
  const parsed = CreateCaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the case." };
  const { flagId, summary } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  try {
    return await withSchool(school.id, async (tx): Promise<Result> => {
      const studentId = await studentOfFlag(tx, school.id, flagId);
      if (!studentId) return { ok: false, error: "That flag no longer exists." };
      const gate = await mayWriteFor(tx, school.id, studentId, user.roles, actor.id);
      if (!gate.ok) return { ok: false, error: REFUSED };
      const inserted = await tx
        .insert(vlcPastoralCase)
        .values({ schoolId: school.id, flagId, summary, lastRevisedByUserId: actor.id ?? undefined })
        .onConflictDoNothing({ target: [vlcPastoralCase.schoolId, vlcPastoralCase.flagId] })
        .returning({ id: vlcPastoralCase.id });
      if (inserted.length === 0) return { ok: false, error: "A case is already open on this flag." };
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "vlc_pastoral_case",
        entityId: inserted[0].id,
        reason: "Case opened",
      });
      safeRevalidate(journalPath(studentId));
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "Could not open the case." };
  }
}

const EditCaseSchema = z.object({
  flagId: z.string().uuid(),
  summary: z.string().trim().min(1, "Enter the case summary.").max(8000, "Keep the summary to ≤8000 characters."),
});

/** Revise the case summary IN PLACE (the one mutable surface): bumps summary + last_revised_at +
 *  last_revised_by. NO delete. Gate on the flagged student's class. */
export async function editCase(input: unknown): Promise<Result> {
  const parsed = EditCaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the case." };
  const { flagId, summary } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  try {
    return await withSchool(school.id, async (tx): Promise<Result> => {
      const studentId = await studentOfFlag(tx, school.id, flagId);
      if (!studentId) return { ok: false, error: "That flag no longer exists." };
      const gate = await mayWriteFor(tx, school.id, studentId, user.roles, actor.id);
      if (!gate.ok) return { ok: false, error: REFUSED };
      const updated = await tx
        .update(vlcPastoralCase)
        .set({ summary, lastRevisedAt: new Date(), lastRevisedByUserId: actor.id ?? undefined })
        .where(and(eq(vlcPastoralCase.schoolId, school.id), eq(vlcPastoralCase.flagId, flagId)))
        .returning({ id: vlcPastoralCase.id });
      if (updated.length === 0) return { ok: false, error: "No case is open on this flag yet." };
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "vlc_pastoral_case",
        entityId: updated[0].id,
        reason: "Case revised", // REDACTED — metadata only, never the summary text
      });
      safeRevalidate(journalPath(studentId));
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "Could not revise the case." };
  }
}
