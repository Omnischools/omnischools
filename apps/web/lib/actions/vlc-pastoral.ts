"use server";
/**
 * 🔴 INCR-42b — VLC CONFIDENTIAL pastoral-flag mutations (SHS module 4.5). raise + resolve, the ONLY writers
 * of `vlc_pastoral_flag`. Owner-locked (b+c): the writer is the flagged student's OWN-CLASS Form Master OR a
 * Dean of Students — enforced server-side on EVERY action by the role gate (VLC_PASTORAL_WRITE_ROLES =
 * [FORM_MASTER, DEAN]) AND `canWritePastoralFlag` (Dean-role OR own-class identity on the flagged student's
 * class, loaded server-side). An ADMIN, a HEADMASTER, an other-class FM, a Peer Guide, a student, and a
 * parent are all refused BEFORE a row is touched — including a hand-crafted POST that never rendered the UI.
 *
 * `surfaced_by` is set BY the writer (the FM/Dean) as a DISPLAY attribution — the PG NEVER writes (owner c).
 *
 * REDACTED audit (R320) — a DIFFERENT class from 42a's SHOWN register. Each write records exactly ONE audit
 * row: actionType (raised | resolved) + entityType `vlc_pastoral_flag` + entityId + actor. NO
 * context / severity / surfaced_by / student is passed into the reason or payload (metadata only); the
 * `vlc_pastoral_` prefix branch in isRedactedAuditEntity suppresses the diff + reason at both feed sites
 * regardless, but we do not even record the content. NO TRIGGERS (portability) — this authorization lives
 * here in lib/. Flags are NOT clock-locked (a Dean may follow up after the session's window).
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { canWritePastoralFlag } from "@/lib/vlc/authz";
import { VLC_PASTORAL_WRITE_ROLES, hasAnyRole } from "@/lib/access";
import { VLC_PASTORAL_SEVERITY } from "@/lib/vlc/defaults";
import { classes, students, vlcPastoralFlag, vlcSession } from "@/db/schema";
import type { Tx } from "@/lib/db";

type Result = { ok: boolean; error?: string };
const BASE = "/senior/vlc/sessions";
const registerPath = (classId: string, date: string) => `${BASE}/${classId}/${date}`;

/**
 * The pastoral WRITE check, re-run inside the tenant scope on every write: the caller must hold a
 * VLC_PASTORAL_WRITE_ROLES role AND be the flagged student's OWN-CLASS Form Master (or a Dean). Loads the
 * flagged student's class teacher server-side (un-spoofable); returns the class id/date for revalidation.
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

/** Best-effort revalidation of the class's register (when the flag hangs off a held session). */
async function revalidateFor(tx: Tx, schoolId: string, sessionId: string | null): Promise<void> {
  if (sessionId) {
    const [s] = await tx
      .select({ classId: vlcSession.classId, sessionDate: vlcSession.sessionDate })
      .from(vlcSession)
      .where(and(eq(vlcSession.schoolId, schoolId), eq(vlcSession.id, sessionId)))
      .limit(1);
    if (s) safeRevalidate(registerPath(s.classId, s.sessionDate));
  }
  safeRevalidate(BASE);
}

// ---- 1) Raise a flag ----------------------------------------------------------------------------

const RaiseSchema = z.object({
  studentId: z.string().uuid(),
  sessionId: z.string().uuid().nullish(),
  severity: z.enum(VLC_PASTORAL_SEVERITY),
  context: z.string().trim().max(280, "Keep the context to a short locator (≤280).").nullish(),
  surfacedBy: z.string().trim().max(80, "Keep the Peer Guide attribution short (≤80).").nullish(),
});

/**
 * Raise ONE confidential pastoral flag on a student. The own-class FM / Dean records it; `surfacedBy` is the
 * PG the FM/Dean names (data, never a PG write). Multiple concurrent active flags per student are allowed
 * (no unique-on-active) — two staff may raise independently. Audit metadata-only.
 */
export async function raisePastoralFlag(input: unknown): Promise<Result> {
  const parsed = RaiseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the flag details." };
  }
  const { studentId, severity } = parsed.data;
  const sessionId = parsed.data.sessionId ?? null;
  const context = parsed.data.context?.trim() || null;
  const surfacedBy = parsed.data.surfacedBy?.trim() || null;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const gate = await mayWriteFor(tx, school.id, studentId, user.roles, actor.id);
      if (!gate.ok) {
        return { ok: false, error: "Only the student's own Form Master or a Dean can raise a flag." };
      }
      // 🔴 R330 (INCR-43a) — retire the 42b class-match deferral at the single choke-point: a
      // session-linked flag's session MUST belong to the flagged student's class. A matching session
      // commits; a NULL sessionId commits (a session-less flag is legal); a mismatch is REJECTED (the
      // case inherits this fence via flag → session). Defends a hand-crafted cross-class sessionId.
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
        .insert(vlcPastoralFlag)
        .values({
          schoolId: school.id,
          studentId,
          sessionId: sessionId ?? undefined,
          severity,
          context,
          surfacedBy,
          raisedByUserId: actor.id ?? undefined,
        })
        .returning({ id: vlcPastoralFlag.id });
      // REDACTED audit — metadata ONLY (no context / severity / surfaced_by / student in reason or payload).
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "raised",
        entityType: "vlc_pastoral_flag",
        entityId: row.id,
        reason: "Pastoral flag raised",
      });
      await revalidateFor(tx, school.id, sessionId);
      return { ok: true };
    });
    return res;
  } catch {
    return { ok: false, error: "Could not raise the flag." };
  }
}

// ---- 2) Resolve a flag --------------------------------------------------------------------------

const ResolveSchema = z.object({ flagId: z.string().uuid() });

/**
 * Mark a flag resolved (`resolved_at` + `resolved_by_user_id`). Own-class FM / Dean only; re-checked
 * server-side against the flagged student's class. Idempotent — an already-resolved flag is a no-op success.
 */
export async function resolvePastoralFlag(input: unknown): Promise<Result> {
  const parsed = ResolveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the flag." };
  const { flagId } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const [flag] = await tx
        .select({
          studentId: vlcPastoralFlag.studentId,
          sessionId: vlcPastoralFlag.sessionId,
          resolvedAt: vlcPastoralFlag.resolvedAt,
        })
        .from(vlcPastoralFlag)
        .where(and(eq(vlcPastoralFlag.schoolId, school.id), eq(vlcPastoralFlag.id, flagId)))
        .limit(1);
      if (!flag) return { ok: false, error: "That flag no longer exists." };
      // Gate BEFORE the mutation (the real boundary), on the flagged student's class.
      const gate = await mayWriteFor(tx, school.id, flag.studentId, user.roles, actor.id);
      if (!gate.ok) {
        return { ok: false, error: "Only the student's own Form Master or a Dean can resolve a flag." };
      }
      if (flag.resolvedAt) {
        await revalidateFor(tx, school.id, flag.sessionId);
        return { ok: true }; // idempotent — already resolved
      }
      await tx
        .update(vlcPastoralFlag)
        .set({ resolvedAt: new Date(), resolvedByUserId: actor.id ?? undefined })
        .where(
          and(
            eq(vlcPastoralFlag.schoolId, school.id),
            eq(vlcPastoralFlag.id, flagId),
            isNull(vlcPastoralFlag.resolvedAt), // race-safe: only an active flag transitions
          ),
        );
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "resolved",
        entityType: "vlc_pastoral_flag",
        entityId: flagId,
        reason: "Pastoral flag resolved",
      });
      await revalidateFor(tx, school.id, flag.sessionId);
      return { ok: true };
    });
    return res;
  } catch {
    return { ok: false, error: "Could not resolve the flag." };
  }
}
