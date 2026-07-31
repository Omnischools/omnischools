"use server";
/**
 * PLC session-register mutations (SHS module 4.6 / INCR-48 · the Friday live register). The module's ONE
 * IDOR fence (R384): every FACILITATOR write re-checks `canFacilitatePlcSession(roles, actorId,
 * facilitatorUserId)` with the facilitator id **SERVER-LOADED via the session→plc join** — NEVER a
 * facilitator id taken from the request — on a **session-derived school_id**, plus a member-in-PLC check
 * for attendance marks and a refuse-after-write-lock. A bare role alone (TEACHER / FORM_MASTER / VHA /
 * ADMIN without the identity match) does NOT satisfy it; only the assigned facilitator or a break-glass
 * role (PD_COORDINATOR / HEADMASTER) may author — the [[builds-widen-ratified-authz-and-self-bless]] trap.
 * A hand-crafted POST that never rendered the UI is refused here, before a row is touched.
 *
 * The member REFLECTION submit (`submitReflection`) is the ONE non-facilitator write: the author is the
 * SESSION-DERIVED actor (never a request-supplied user id), window-bound [scheduled close, close +
 * reflection_window_hours] (R388), and append-only-hard (a duplicate is refused, never an UPDATE). The
 * facilitator `confirmReflection` is a one-way stamp, NOT window-bound (R389).
 *
 * DERIVED, never stored (R381/R390): "held" = the row exists; the write-lock is an app-layer late-edit
 * guard (session_date + the derived reflection-window close < now). Each write records ONE audit row with
 * a verbatim SHOWN entityType (plc_session / plc_session_attendance / plc_session_reflection) — metadata
 * ONLY, NEVER a reflection answer body (R395). No triggers (portability) — this all lives here in lib/.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withSchool, isUniqueViolation } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { canFacilitatePlcSession } from "@/lib/access";
import { coalescePlcProgramme } from "@/lib/plc/defaults";
import { isPlcReflectionWindowOpen, isPlcSessionWriteLocked } from "@/lib/plc/session-clock";
import {
  academicPeriod,
  plc,
  plcMembership,
  plcProgramme,
  plcSession,
  plcSessionAttendance,
  plcSessionReflection,
} from "@/db/schema";
import type { Tx } from "@/lib/db";

type Result = { ok: boolean; error?: string };
const BASE = "/senior/plc/sessions";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const registerPath = (plcId: string, date: string) => `${BASE}/${plcId}/${date}`;

const PROGRAMME_COLS = {
  sessionDay: plcProgramme.sessionDay,
  sessionStart: plcProgramme.sessionStart,
  sessionLengthMin: plcProgramme.sessionLengthMin,
  weeksPerSemester: plcProgramme.weeksPerSemester,
  ptsPerAttendedSession: plcProgramme.ptsPerAttendedSession,
  ptsPerReflection: plcProgramme.ptsPerReflection,
  reflectionWindowHours: plcProgramme.reflectionWindowHours,
  annualPlcTarget: plcProgramme.annualPlcTarget,
  configuredAt: plcProgramme.configuredAt,
} as const;

async function loadProgramme(tx: Tx, schoolId: string) {
  const [row] = await tx
    .select(PROGRAMME_COLS)
    .from(plcProgramme)
    .where(eq(plcProgramme.schoolId, schoolId))
    .limit(1);
  return coalescePlcProgramme(row ?? null);
}

interface SessionForWrite {
  sessionId: string;
  plcId: string;
  sessionDate: string;
  facilitatorUserId: string | null;
}

/**
 * The R384 facilitator write-gate — load the session THROUGH the plc join so `facilitator_user_id` is
 * SERVER-loaded (never request-supplied), then re-check `canFacilitatePlcSession`. Returns the session on
 * success. Used by every facilitator write (mark / agenda / confirm). Refused for a bare role.
 */
async function authorizeFacilitatorWrite(
  tx: Tx,
  schoolId: string,
  sessionId: string,
  roles: readonly string[],
  actorId: string | null,
): Promise<{ ok: true; session: SessionForWrite } | { ok: false; error: string }> {
  const [row] = await tx
    .select({
      sessionId: plcSession.id,
      plcId: plcSession.plcId,
      sessionDate: plcSession.sessionDate,
      facilitatorUserId: plc.facilitatorUserId,
    })
    .from(plcSession)
    .innerJoin(plc, and(eq(plc.schoolId, plcSession.schoolId), eq(plc.id, plcSession.plcId)))
    .where(and(eq(plcSession.schoolId, schoolId), eq(plcSession.id, sessionId)))
    .limit(1);
  if (!row) return { ok: false, error: "That session no longer exists." };
  if (!canFacilitatePlcSession(roles, actorId, row.facilitatorUserId)) {
    return { ok: false, error: "Only the PLC's facilitator can run this session." };
  }
  return { ok: true, session: row };
}

/** Resolve the SENIOR academic period covering `date` (else the latest that has begun, else the last). */
async function resolvePeriodForDate(tx: Tx, schoolId: string, date: string): Promise<string | null> {
  const rows = await tx
    .select({
      periodId: academicPeriod.periodId,
      startsOn: academicPeriod.startsOn,
      endsOn: academicPeriod.endsOn,
    })
    .from(academicPeriod)
    .where(and(eq(academicPeriod.schoolId, schoolId), eq(academicPeriod.productLine, "SENIOR")))
    .orderBy(desc(academicPeriod.startsOn));
  if (rows.length === 0) return null;
  const cur =
    rows.find((r) => r.startsOn <= date && r.endsOn >= date) ??
    rows.find((r) => r.startsOn <= date) ??
    rows[rows.length - 1];
  return cur?.periodId ?? null;
}

// ---- 1) Open (hold) the session — upsert one plc_session per (PLC × date) ----

const OpenSchema = z.object({
  plcId: z.string().uuid(),
  date: z.string().regex(DATE, "Pick a session date."),
});

/**
 * Record that this PLC's Friday session was HELD on `date` (R381 manual-open; one row per PLC × date). The
 * facilitator gate loads `plc.facilitator_user_id` server-side (there is no session row yet) and checks
 * `canFacilitatePlcSession`. `academic_period_id` resolves from the date. Idempotent on the
 * (school, plc, date) conflict.
 */
export async function openSession(input: unknown): Promise<Result> {
  const parsed = OpenSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the session details." };
  }
  const { plcId, date } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const [plcRow] = await tx
        .select({ id: plc.id, facilitatorUserId: plc.facilitatorUserId })
        .from(plc)
        .where(and(eq(plc.schoolId, school.id), eq(plc.id, plcId), isNull(plc.archivedAt)))
        .limit(1);
      if (!plcRow) return { ok: false, error: "That PLC no longer exists." };
      if (!canFacilitatePlcSession(user.roles, actor.id, plcRow.facilitatorUserId)) {
        return { ok: false, error: "Only the PLC's facilitator can open this session." };
      }
      const periodId = await resolvePeriodForDate(tx, school.id, date);
      if (!periodId) {
        return { ok: false, error: "Configure the academic calendar before opening a session." };
      }
      const [existing] = await tx
        .select({ id: plcSession.id })
        .from(plcSession)
        .where(
          and(
            eq(plcSession.schoolId, school.id),
            eq(plcSession.plcId, plcId),
            eq(plcSession.sessionDate, date),
          ),
        )
        .limit(1);
      const [row] = await tx
        .insert(plcSession)
        .values({
          schoolId: school.id,
          plcId,
          academicPeriodId: periodId,
          sessionDate: date,
          openedByUserId: actor.id ?? undefined,
        })
        .onConflictDoUpdate({
          target: [plcSession.schoolId, plcSession.plcId, plcSession.sessionDate],
          set: { updatedAt: new Date() },
        })
        .returning({ id: plcSession.id });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: existing ? "updated" : "created",
        entityType: "plc_session",
        entityId: row.id,
        after: { plcId, sessionDate: date, academicPeriodId: periodId },
        reason: existing ? "PLC session re-opened" : "PLC session opened",
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(registerPath(plcId, date));
    safeRevalidate(BASE);
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { ok: false, error: "A session already exists for this PLC and date." };
    }
    return { ok: false, error: "Could not open the session." };
  }
}

// ---- 2) Mark P / L / A — present-by-default (PRESENT deletes the row) ----

const MarkSchema = z.object({
  sessionId: z.string().uuid(),
  userId: z.string().uuid(),
  status: z.enum(["PRESENT", "LATE", "ABSENT"]),
  minutesLate: z.coerce.number().int().min(0).max(600).optional(),
  note: z.string().trim().max(240).nullish(),
});

/**
 * Mark one member P / L / A for a held session. PRESENT is the ABSENCE of a row (mark-present DELETES the
 * not-present row); LATE/ABSENT upsert the one row (the UNIQUE(school_id, session_id, user_id) target).
 * Facilitator-gated (server-loaded id) + member-in-PLC + the refuse-after-lock guard. Only a real state
 * change is audited.
 */
export async function markAttendance(input: unknown): Promise<Result> {
  const parsed = MarkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the attendance details." };
  const { sessionId, userId, status } = parsed.data;
  const note = parsed.data.note?.trim() || null;
  const minutesLate = status === "LATE" ? (parsed.data.minutesLate ?? null) : null;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  let revalidate: string | null = null;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const gate = await authorizeFacilitatorWrite(tx, school.id, sessionId, user.roles, actor.id);
      if (!gate.ok) return gate;
      const { session } = gate;

      // Refuse-after-lock (R381) — the register is read-only once the reflection window has elapsed.
      const programme = await loadProgramme(tx, school.id);
      if (isPlcSessionWriteLocked(programme, session.sessionDate)) {
        return { ok: false, error: "This session has locked — attendance can no longer be edited." };
      }

      // Member-in-PLC — the marked user must be an ACTIVE member of the session's PLC.
      const [member] = await tx
        .select({ id: plcMembership.id })
        .from(plcMembership)
        .where(
          and(
            eq(plcMembership.schoolId, school.id),
            eq(plcMembership.plcId, session.plcId),
            eq(plcMembership.userId, userId),
            isNull(plcMembership.leftAt),
          ),
        )
        .limit(1);
      if (!member) return { ok: false, error: "That teacher is not a member of this PLC." };
      revalidate = registerPath(session.plcId, session.sessionDate);

      const [before] = await tx
        .select({ status: plcSessionAttendance.status })
        .from(plcSessionAttendance)
        .where(
          and(
            eq(plcSessionAttendance.schoolId, school.id),
            eq(plcSessionAttendance.sessionId, sessionId),
            eq(plcSessionAttendance.userId, userId),
          ),
        )
        .limit(1);

      if (status === "PRESENT") {
        if (!before) return { ok: true }; // already present (no row) → no-op
        await tx
          .delete(plcSessionAttendance)
          .where(
            and(
              eq(plcSessionAttendance.schoolId, school.id),
              eq(plcSessionAttendance.sessionId, sessionId),
              eq(plcSessionAttendance.userId, userId),
            ),
          );
        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "deleted",
          entityType: "plc_session_attendance",
          entityId: sessionId,
          before: { userId, status: before.status },
          after: { userId, status: "PRESENT" },
          reason: "PLC attendance · marked present",
        });
        return { ok: true };
      }

      if (before?.status === status) return { ok: true }; // no real change
      await tx
        .insert(plcSessionAttendance)
        .values({
          schoolId: school.id,
          sessionId,
          userId,
          status,
          minutesLate: minutesLate ?? undefined,
          note,
          recordedByUserId: actor.id ?? undefined,
        })
        .onConflictDoUpdate({
          target: [plcSessionAttendance.schoolId, plcSessionAttendance.sessionId, plcSessionAttendance.userId],
          set: { status, minutesLate, note, recordedByUserId: actor.id ?? undefined },
        });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: before ? "updated" : "created",
        entityType: "plc_session_attendance",
        entityId: sessionId,
        before: before ? { userId, status: before.status } : undefined,
        after: { userId, status, minutesLate },
        reason: `PLC attendance · ${status === "LATE" ? "late" : "absent"}`,
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

// ---- 3) Edit the agenda (facilitator-authored agenda_json, editable-until-lock, NOT append-only) ----

const AgendaItemSchema = z.object({
  text: z.string().trim().min(1).max(200),
  durationMin: z.coerce.number().int().min(0).max(600).nullish(),
  done: z.boolean().optional().default(false),
});
const EditAgendaSchema = z.object({
  sessionId: z.string().uuid(),
  items: z.array(AgendaItemSchema).max(30),
});

export async function editAgenda(input: unknown): Promise<Result> {
  const parsed = EditAgendaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the agenda." };
  const { sessionId, items } = parsed.data;
  const normalized = {
    items: items.map((it) => ({ text: it.text, durationMin: it.durationMin ?? null, done: it.done ?? false })),
  };
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  let revalidate: string | null = null;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const gate = await authorizeFacilitatorWrite(tx, school.id, sessionId, user.roles, actor.id);
      if (!gate.ok) return gate;
      const { session } = gate;
      const programme = await loadProgramme(tx, school.id);
      if (isPlcSessionWriteLocked(programme, session.sessionDate)) {
        return { ok: false, error: "This session has locked — the agenda can no longer be edited." };
      }
      revalidate = registerPath(session.plcId, session.sessionDate);
      await tx
        .update(plcSession)
        .set({ agendaJson: normalized, updatedAt: new Date() })
        .where(and(eq(plcSession.schoolId, school.id), eq(plcSession.id, sessionId)));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "plc_session",
        entityId: sessionId,
        after: { itemCount: normalized.items.length, doneCount: normalized.items.filter((i) => i.done).length },
        reason: "PLC session agenda updated",
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    if (revalidate) safeRevalidate(revalidate);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the agenda." };
  }
}

// ---- 4) Submit the reflection (member OWN-identity, window-bound, append-only-hard) ----

const ReflectionSchema = z.object({
  sessionId: z.string().uuid(),
  q1: z.string().trim().min(1, "Answer all three questions.").max(2000),
  q2: z.string().trim().min(1, "Answer all three questions.").max(2000),
  q3: z.string().trim().min(1, "Answer all three questions.").max(2000),
});

/**
 * A member submits their OWN post-session reflection. The author is the SESSION-DERIVED actor (never a
 * request-supplied user id — the R388 identity discipline), so a hand-crafted POST cannot reflect AS
 * someone else. Window-bound [scheduled close, close + reflection_window_hours] and append-only-hard: a
 * second submit for the same (session, member) is REFUSED, never an UPDATE. Audit records metadata ONLY —
 * NEVER the answer body (R395).
 */
export async function submitReflection(input: unknown): Promise<Result> {
  const parsed = ReflectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Answer all three questions." };
  }
  const { sessionId, q1, q2, q3 } = parsed.data;
  const { school } = await requireSchool();
  const actor = await resolveActor(school.id);
  if (!actor.id) return { ok: false, error: "We could not identify you — sign in again." };
  const authorId = actor.id; // 🔴 server-derived identity — NEVER from the request
  let revalidate: string | null = null;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const [session] = await tx
        .select({ id: plcSession.id, plcId: plcSession.plcId, sessionDate: plcSession.sessionDate })
        .from(plcSession)
        .where(and(eq(plcSession.schoolId, school.id), eq(plcSession.id, sessionId)))
        .limit(1);
      if (!session) return { ok: false, error: "That session no longer exists." };

      // Must be an ACTIVE member of this PLC to reflect (server-side).
      const [member] = await tx
        .select({ id: plcMembership.id })
        .from(plcMembership)
        .where(
          and(
            eq(plcMembership.schoolId, school.id),
            eq(plcMembership.plcId, session.plcId),
            eq(plcMembership.userId, authorId),
            isNull(plcMembership.leftAt),
          ),
        )
        .limit(1);
      if (!member) return { ok: false, error: "Only a member of this PLC can submit a reflection." };

      // Window-bound (R388) — opens at the scheduled close, closes after reflection_window_hours.
      const programme = await loadProgramme(tx, school.id);
      if (!isPlcReflectionWindowOpen(programme, session.sessionDate)) {
        return { ok: false, error: "The reflection window for this session is not open." };
      }

      // Append-only-hard — a reflection already exists → refuse (never overwrite an answer, R388).
      const [existing] = await tx
        .select({ id: plcSessionReflection.id })
        .from(plcSessionReflection)
        .where(
          and(
            eq(plcSessionReflection.schoolId, school.id),
            eq(plcSessionReflection.sessionId, sessionId),
            eq(plcSessionReflection.userId, authorId),
          ),
        )
        .limit(1);
      if (existing) return { ok: false, error: "You have already submitted a reflection for this session." };

      const [row] = await tx
        .insert(plcSessionReflection)
        .values({ schoolId: school.id, sessionId, userId: authorId, q1, q2, q3 })
        .returning({ id: plcSessionReflection.id });
      revalidate = registerPath(session.plcId, session.sessionDate);
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: authorId,
        actorRole: actor.role,
        actionType: "created",
        entityType: "plc_session_reflection",
        entityId: row.id,
        // metadata ONLY — the q1/q2/q3 answer bodies are NEVER written to the audit trail (R395).
        after: { sessionId, submitted: true },
        reason: "PLC reflection submitted",
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    if (revalidate) safeRevalidate(revalidate);
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { ok: false, error: "You have already submitted a reflection for this session." };
    }
    return { ok: false, error: "Could not submit the reflection." };
  }
}

// ---- 5) Confirm a reflection (facilitator one-way stamp, NOT window-bound) ----

const ConfirmSchema = z.object({ sessionId: z.string().uuid(), userId: z.string().uuid() });

/**
 * The facilitator confirms a member's reflection (R389) — a one-way stamp of `confirmed_at` +
 * `confirmed_by_user_id`, the ONLY mutation this row ever takes. Facilitator-gated (server-loaded id) but
 * DELIBERATELY NOT window-bound (the facilitator confirms in the NEXT session, days after the window). The
 * answer body is never touched. Idempotent — a re-confirm is a no-op.
 */
export async function confirmReflection(input: unknown): Promise<Result> {
  const parsed = ConfirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the reflection." };
  const { sessionId, userId } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  let revalidate: string | null = null;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const gate = await authorizeFacilitatorWrite(tx, school.id, sessionId, user.roles, actor.id);
      if (!gate.ok) return gate;
      const { session } = gate;
      const [refl] = await tx
        .select({ id: plcSessionReflection.id, confirmedAt: plcSessionReflection.confirmedAt })
        .from(plcSessionReflection)
        .where(
          and(
            eq(plcSessionReflection.schoolId, school.id),
            eq(plcSessionReflection.sessionId, sessionId),
            eq(plcSessionReflection.userId, userId),
          ),
        )
        .limit(1);
      if (!refl) return { ok: false, error: "That teacher has not submitted a reflection." };
      if (refl.confirmedAt) return { ok: true }; // already confirmed — one-way, no-op
      await tx
        .update(plcSessionReflection)
        .set({ confirmedAt: new Date(), confirmedByUserId: actor.id ?? undefined })
        .where(and(eq(plcSessionReflection.schoolId, school.id), eq(plcSessionReflection.id, refl.id)));
      revalidate = registerPath(session.plcId, session.sessionDate);
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "plc_session_reflection",
        entityId: refl.id,
        after: { userId, confirmed: true },
        reason: "PLC reflection confirmed",
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    if (revalidate) safeRevalidate(revalidate);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not confirm the reflection." };
  }
}
