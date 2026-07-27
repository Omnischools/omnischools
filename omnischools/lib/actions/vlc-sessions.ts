"use server";
/**
 * VLC Session register mutations (SHS module 4.5 / INCR-42a · the Wednesday live-session register).
 *
 * Owner-locked (d): the writer is the session's-class **Form Master, own-class** (Dean/Admin as a
 * school-wide fallback) — enforced server-side via `canWriteSession` (lib/vlc/authz) on EVERY action, so
 * a student, a Peer Guide, a Headmaster (read-only), or the Form Master of a DIFFERENT class is refused
 * before a single row is touched, including a hand-crafted POST that never rendered the UI. "PG-first" is
 * a UI capture-ORDER convention, NOT a write grant. Each write records one audit row (entityType
 * vlc_session / vlc_session_attendance — both SHOWN, no pastoral PII, R316).
 *
 * DERIVED, never stored (R312/R315): "held" = the row exists (no status column); the R312 auto-lock is an
 * app-layer late-edit guard — once the session's derived programme window has elapsed (session_date +
 * the F0 close < now) the register is read-only. There is NO stored `locked`/`started_at`. No triggers
 * (portability) — this authorization + lock lives here in lib/.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool, isUniqueViolation } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { canWriteSession } from "@/lib/vlc/authz";
import { coalesceVlcProgramme, type VlcProgrammeRow } from "@/lib/vlc/defaults";
import { isSessionWriteLocked } from "@/lib/vlc/session-clock";
import {
  classes,
  students,
  vlcProgramme,
  vlcSession,
  vlcSessionAttendance,
  vlcSessionTemplate,
} from "@/db/schema";
import type { Tx } from "@/lib/db";

type Result = { ok: boolean; error?: string };
const BASE = "/senior/vlc/sessions";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const registerPath = (classId: string, date: string) => `${BASE}/${classId}/${date}`;

const PROGRAMME_COLS = {
  sessionDay: vlcProgramme.sessionDay,
  sessionStart: vlcProgramme.sessionStart,
  openerMin: vlcProgramme.openerMin,
  smallGroupMin: vlcProgramme.smallGroupMin,
  plenaryMin: vlcProgramme.plenaryMin,
  reflectionMin: vlcProgramme.reflectionMin,
  closeMin: vlcProgramme.closeMin,
  configuredAt: vlcProgramme.configuredAt,
} as const;

/** The own-class Form Master (∥ Dean ∥ Admin) write check, re-run inside the tenant scope on every write. */
async function mayWrite(
  tx: Tx,
  schoolId: string,
  classId: string,
  roles: readonly string[],
  actorId: string | null,
): Promise<boolean> {
  const [cls] = await tx
    .select({ classTeacherUserId: classes.classTeacherUserId })
    .from(classes)
    .where(and(eq(classes.schoolId, schoolId), eq(classes.id, classId)))
    .limit(1);
  if (!cls) return false;
  return canWriteSession({ roles, userId: actorId, classTeacherUserId: cls.classTeacherUserId });
}

// ---- 1) Open (hold) the session — upsert one vlc_session per (class × date) ----

const OpenSchema = z.object({
  classId: z.string().uuid(),
  date: z.string().regex(DATE, "Pick a session date."),
  sessionTemplateId: z.string().uuid("Pick the value/session to run."),
});

/**
 * Record that this class's Wednesday session was HELD on `date`, running `sessionTemplateId` (the value +
 * slot A|B). Upserts the single `vlc_session` on the `(school_id, class_id, session_date)` conflict — one
 * row per (class × date). The value/slot DERIVE through the template FK; nothing else is stored.
 */
export async function openSession(input: unknown): Promise<Result> {
  const parsed = OpenSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the session details." };
  }
  const { classId, date, sessionTemplateId } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      if (!(await mayWrite(tx, school.id, classId, user.roles, actor.id))) {
        return { ok: false, error: "Only the class's Form Master can open this session." };
      }
      const [tpl] = await tx
        .select({ id: vlcSessionTemplate.id })
        .from(vlcSessionTemplate)
        .where(and(eq(vlcSessionTemplate.schoolId, school.id), eq(vlcSessionTemplate.id, sessionTemplateId)))
        .limit(1);
      if (!tpl) return { ok: false, error: "Pick a value/session to run." };
      const [existing] = await tx
        .select({ id: vlcSession.id })
        .from(vlcSession)
        .where(
          and(
            eq(vlcSession.schoolId, school.id),
            eq(vlcSession.classId, classId),
            eq(vlcSession.sessionDate, date),
          ),
        )
        .limit(1);
      const [row] = await tx
        .insert(vlcSession)
        .values({
          schoolId: school.id,
          classId,
          sessionTemplateId,
          sessionDate: date,
          heldByUserId: actor.id ?? undefined,
        })
        .onConflictDoUpdate({
          target: [vlcSession.schoolId, vlcSession.classId, vlcSession.sessionDate],
          set: { sessionTemplateId, updatedAt: new Date() },
        })
        .returning({ id: vlcSession.id });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: existing ? "updated" : "created",
        entityType: "vlc_session",
        entityId: row.id,
        after: { classId, sessionDate: date, sessionTemplateId },
        reason: existing ? "VLC session value updated" : "VLC session opened",
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(registerPath(classId, date));
    safeRevalidate(BASE);
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { ok: false, error: "A session already exists for this class and date." };
    }
    return { ok: false, error: "Could not open the session." };
  }
}

// ---- 2) Mark P / L / A — present-by-default (PRESENT deletes the row) ----

const MarkSchema = z.object({
  sessionId: z.string().uuid(),
  studentId: z.string().uuid(),
  status: z.enum(["PRESENT", "LATE", "ABSENT"]),
  minutesLate: z.coerce.number().int().min(0).max(600).optional(),
  note: z.string().trim().max(240).nullish(),
});

/**
 * Mark one student P / L / A for a held session. PRESENT is the ABSENCE of a row (the prep_attendance
 * idiom): marking LATE/ABSENT upserts the one row (the UNIQUE(school_id, session_id, student_id) conflict
 * target); marking PRESENT DELETES it. present/rate/counts all DERIVE from these rows — nothing is stored.
 * FM-only own-class (owner d) + the R312 auto-lock guard (a write after the derived window is refused).
 * Only a REAL state change is audited.
 */
export async function markAttendance(input: unknown): Promise<Result> {
  const parsed = MarkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the attendance details." };
  const { sessionId, studentId, status } = parsed.data;
  const note = parsed.data.note?.trim() || null;
  const minutesLate = status === "LATE" ? (parsed.data.minutesLate ?? null) : null;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  let revalidate: string | null = null;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const [session] = await tx
        .select({ classId: vlcSession.classId, sessionDate: vlcSession.sessionDate })
        .from(vlcSession)
        .where(and(eq(vlcSession.schoolId, school.id), eq(vlcSession.id, sessionId)))
        .limit(1);
      if (!session) return { ok: false, error: "That session no longer exists." };
      if (!(await mayWrite(tx, school.id, session.classId, user.roles, actor.id))) {
        return { ok: false, error: "Only the class's Form Master can mark this register." };
      }
      // R312 auto-lock — a write after the derived programme window has elapsed is refused (no stored flag).
      const [pr] = await tx
        .select(PROGRAMME_COLS)
        .from(vlcProgramme)
        .where(eq(vlcProgramme.schoolId, school.id))
        .limit(1);
      const programme = coalesceVlcProgramme((pr as VlcProgrammeRow | undefined) ?? null);
      if (isSessionWriteLocked(programme, session.sessionDate)) {
        return { ok: false, error: "This session has auto-locked — attendance can no longer be edited." };
      }
      const [stu] = await tx
        .select({ classId: students.classId })
        .from(students)
        .where(and(eq(students.schoolId, school.id), eq(students.id, studentId)))
        .limit(1);
      if (!stu || stu.classId !== session.classId) {
        return { ok: false, error: "That student is not a member of this class." };
      }
      revalidate = registerPath(session.classId, session.sessionDate);

      const [before] = await tx
        .select({ status: vlcSessionAttendance.status })
        .from(vlcSessionAttendance)
        .where(
          and(
            eq(vlcSessionAttendance.schoolId, school.id),
            eq(vlcSessionAttendance.sessionId, sessionId),
            eq(vlcSessionAttendance.studentId, studentId),
          ),
        )
        .limit(1);

      if (status === "PRESENT") {
        // Present = remove the not-present row. No row → already present → a no-op (nothing audited).
        if (!before) return { ok: true };
        await tx
          .delete(vlcSessionAttendance)
          .where(
            and(
              eq(vlcSessionAttendance.schoolId, school.id),
              eq(vlcSessionAttendance.sessionId, sessionId),
              eq(vlcSessionAttendance.studentId, studentId),
            ),
          );
        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "deleted",
          entityType: "vlc_session_attendance",
          entityId: sessionId,
          before: { studentId, status: before.status },
          after: { studentId, status: "PRESENT" },
          reason: "VLC session attendance · marked present",
        });
        return { ok: true };
      }

      // Same status re-marked → no real state change → skip the upsert + audit.
      if (before?.status === status) return { ok: true };
      await tx
        .insert(vlcSessionAttendance)
        .values({
          schoolId: school.id,
          sessionId,
          studentId,
          status,
          minutesLate: minutesLate ?? undefined,
          note,
          recordedByUserId: actor.id ?? undefined,
        })
        .onConflictDoUpdate({
          target: [
            vlcSessionAttendance.schoolId,
            vlcSessionAttendance.sessionId,
            vlcSessionAttendance.studentId,
          ],
          set: { status, minutesLate, note, recordedByUserId: actor.id ?? undefined },
        });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: before ? "updated" : "created",
        entityType: "vlc_session_attendance",
        entityId: sessionId,
        before: before ? { studentId, status: before.status } : undefined,
        after: { studentId, status, minutesLate },
        reason: `VLC session attendance · ${status === "LATE" ? "late" : "absent"}`,
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    if (revalidate) safeRevalidate(revalidate);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update the attendance." };
  }
}
