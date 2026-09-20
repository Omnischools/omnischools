"use server";
/**
 * VLC Peer Guides mutations (SHS module 4.5 / INCR-41 · the roster + training log).
 *
 * Every mutation is gated server-side to VLC_CONFIG_WRITE_ROLES (DEAN_OF_STUDENTS / ADMIN) — a
 * HEADMASTER or FORM_MASTER READS the surface and every write here refuses them, including a
 * hand-crafted POST that never touched the UI. Each writes one audit_log row (entityType
 * vlc_peer_guide / vlc_training / vlc_training_absence — all SHOWN, no pastoral PII, R308). Cross-row
 * validation (F2/F3 eligibility, the hard cap of 2 active per class×period, one-active-per-student-per-
 * period) lives HERE, never a DB trigger (portability); the partial unique is the last-line guard.
 *
 * OWNER-LOCKED (OC2): the class vote is OFFLINE — the Dean records only the OUTCOME. There is
 * deliberately NO candidate/ballot/vote action: a vacancy is DERIVED (< 2 active), fill-vacancy is just
 * a subsequent appointPeerGuide in the same period, and vacate is endPeerGuide (never DELETE).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withSchool, isUniqueViolation } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { assertAnyRole, requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentPeriod } from "@/lib/boarding/period";
import { VLC_CONFIG_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import { classFormNumber, isPeerGuideEligibleForm } from "@/lib/vlc/eligibility";
import { classes, students, vlcPeerGuide, vlcTraining, vlcTrainingAbsence } from "@/db/schema";

type Result = { ok: boolean; error?: string };
const PG_PATH = "/senior/vlc/peer-guides";

/**
 * The shared write gate — re-checked on EVERY action, so a Headmaster / Form Master (who read the
 * surface) or any other role is refused before a single row is touched. `assertAnyRole` throws on a
 * failed check; the UI hides the controls too, but this server refusal is the real boundary. A small
 * local copy of the F0 gate: it cannot be imported out of lib/actions/vlc.ts without moving the
 * `assertAnyRole(VLC_CONFIG_WRITE_ROLES)` literal the F0 grep-test asserts lives there.
 * ponytail: an 8-line duplicated gate vs restructuring a shipped, tested "use server" module.
 */
async function authorizeVlcWrite(): Promise<{
  schoolId: string;
  actor: { id: string | null; role: string };
}> {
  const { school } = await requireSchool();
  await assertAnyRole(VLC_CONFIG_WRITE_ROLES);
  const actor = await resolveActor(school.id);
  return { schoolId: school.id, actor };
}

// ---- 1) Appoint a Peer Guide (fill a slot) — the vote is offline; this records the outcome ----

const AppointSchema = z.object({
  studentId: z.string().uuid(),
  classId: z.string().uuid(),
});

/**
 * Appoint `studentId` as a Peer Guide of their class. Validates: the class form is F2/F3 (R301); the
 * class has < 2 active PGs this period (hard cap of 2 — the 3rd is refused, OC1); the student is not
 * already serving this period (also guarded by the partial unique — a raw PK/unique violation is caught
 * and surfaced gracefully). Gender is ADVISORY — two same-sex PGs are NOT refused (R301/AC19). The row is
 * scoped to the CURRENT academic_period (tenure = one semester, R303).
 */
export async function appointPeerGuide(input: unknown): Promise<Result> {
  const gate = await authorizeVlcWrite();
  const parsed = AppointSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the appointment details." };
  const { studentId, classId } = parsed.data;
  try {
    const res = await withSchool(gate.schoolId, async (tx): Promise<Result> => {
      const period = await getCurrentPeriod(tx, gate.schoolId);
      if (!period) {
        return { ok: false, error: "No active semester — configure the academic period first." };
      }
      const [cls] = await tx
        .select({ name: classes.name, level: classes.level })
        .from(classes)
        .where(and(eq(classes.schoolId, gate.schoolId), eq(classes.id, classId)))
        .limit(1);
      if (!cls) return { ok: false, error: "That class no longer exists." };
      const form = classFormNumber(cls.level, cls.name);
      if (!isPeerGuideEligibleForm(form)) {
        return { ok: false, error: "Peer Guides are appointed only in Form 2 and Form 3 classes." };
      }
      const [stu] = await tx
        .select({
          classId: students.classId,
          first: students.firstName,
          last: students.lastName,
        })
        .from(students)
        .where(and(eq(students.schoolId, gate.schoolId), eq(students.id, studentId)))
        .limit(1);
      if (!stu) return { ok: false, error: "That student no longer exists." };
      if (stu.classId !== classId) {
        return { ok: false, error: "That student is not a member of this class." };
      }
      // Hard cap of 2 ACTIVE PGs per (class × period) — the 3rd is refused (OC1).
      const [capRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(vlcPeerGuide)
        .where(
          and(
            eq(vlcPeerGuide.schoolId, gate.schoolId),
            eq(vlcPeerGuide.classId, classId),
            eq(vlcPeerGuide.academicPeriodId, period.periodId),
            isNull(vlcPeerGuide.endedAt),
          ),
        );
      if ((capRow?.n ?? 0) >= 2) {
        return { ok: false, error: "This class already has two active Peer Guides." };
      }
      // One active appointment per student per period (surface a friendly error; the partial unique is
      // the DB backstop against a race).
      const [dupRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(vlcPeerGuide)
        .where(
          and(
            eq(vlcPeerGuide.schoolId, gate.schoolId),
            eq(vlcPeerGuide.studentId, studentId),
            eq(vlcPeerGuide.academicPeriodId, period.periodId),
            isNull(vlcPeerGuide.endedAt),
          ),
        );
      if ((dupRow?.n ?? 0) > 0) {
        return { ok: false, error: "This student is already serving as a Peer Guide this semester." };
      }
      const [inserted] = await tx
        .insert(vlcPeerGuide)
        .values({
          schoolId: gate.schoolId,
          studentId,
          classId,
          academicPeriodId: period.periodId,
          appointedByUserId: gate.actor.id ?? undefined,
        })
        .returning({ id: vlcPeerGuide.id });
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: "created",
        entityType: "vlc_peer_guide",
        entityId: inserted.id,
        after: { studentId, classId, academicPeriodId: period.periodId, form },
        reason: `Peer Guide appointed · ${stu.first} ${stu.last}`,
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(PG_PATH);
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { ok: false, error: "This student is already serving as a Peer Guide this semester." };
    }
    return { ok: false, error: "Could not appoint the Peer Guide." };
  }
}

// ---- 2) End an appointment (step aside / vacate) — set ended_at, NEVER delete (R302/R307) ----

const EndSchema = z.object({
  peerGuideId: z.string().uuid(),
  reason: z.string().trim().max(240).nullish(),
});

/**
 * Vacate a Peer Guide slot: stamp `ended_at` (+ an optional operational `ended_reason`) on the ACTIVE
 * appointment. The row is NEVER deleted — the roster is append-only (R302/R307), so the appointment stays
 * as history and the class flips to a derived vacancy (< 2 active). Fill-vacancy is a subsequent
 * appointPeerGuide in the same period.
 */
export async function endPeerGuide(input: unknown): Promise<Result> {
  const gate = await authorizeVlcWrite();
  const parsed = EndSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the details." };
  const { peerGuideId } = parsed.data;
  const reason = parsed.data.reason?.trim() || null;
  try {
    const res = await withSchool(gate.schoolId, async (tx): Promise<Result> => {
      const [before] = await tx
        .select({ endedAt: vlcPeerGuide.endedAt })
        .from(vlcPeerGuide)
        .where(and(eq(vlcPeerGuide.schoolId, gate.schoolId), eq(vlcPeerGuide.id, peerGuideId)))
        .limit(1);
      if (!before) return { ok: false, error: "That appointment no longer exists." };
      if (before.endedAt) return { ok: false, error: "That Peer Guide has already stepped aside." };
      await tx
        .update(vlcPeerGuide)
        .set({ endedAt: new Date(), endedReason: reason })
        .where(and(eq(vlcPeerGuide.schoolId, gate.schoolId), eq(vlcPeerGuide.id, peerGuideId)));
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: "updated",
        entityType: "vlc_peer_guide",
        entityId: peerGuideId,
        before: { endedAt: null },
        after: { endedAt: "set", endedReason: reason },
        reason: reason ? `Peer Guide stepped aside · ${reason}` : "Peer Guide stepped aside",
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(PG_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update the appointment." };
  }
}

// ---- 3) Schedule a training event (Dean-authored) ----

const TrainingSchema = z.object({
  title: z.string().trim().min(1, "The training needs a title.").max(120),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a training date."),
  durationMin: z.coerce.number().int().min(1).max(600),
  description: z.string().trim().max(500).nullish(),
});

/**
 * Schedule a monthly PG training event for the current academic year. NO stored attendance/status — the
 * % DERIVES from the absence rows below. `academic_year` is taken from the current SENIOR period (text).
 */
export async function scheduleTraining(input: unknown): Promise<Result> {
  const gate = await authorizeVlcWrite();
  const parsed = TrainingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the training details." };
  }
  const { title, scheduledDate, durationMin } = parsed.data;
  const description = parsed.data.description?.trim() || null;
  try {
    const res = await withSchool(gate.schoolId, async (tx): Promise<Result> => {
      const period = await getCurrentPeriod(tx, gate.schoolId);
      if (!period) {
        return { ok: false, error: "No active semester — configure the academic period first." };
      }
      const [inserted] = await tx
        .insert(vlcTraining)
        .values({
          schoolId: gate.schoolId,
          academicYear: period.academicYear,
          scheduledDate,
          title,
          description,
          durationMin,
        })
        .returning({ id: vlcTraining.id });
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: "created",
        entityType: "vlc_training",
        entityId: inserted.id,
        after: { title, scheduledDate, durationMin, academicYear: period.academicYear },
        reason: `VLC training scheduled · ${title}`,
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(PG_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not schedule the training." };
  }
}

// ---- 4) Training attendance — present-by-default (a row ONLY for a non-present PG) ----

const AbsenceSchema = z.object({
  trainingId: z.string().uuid(),
  peerGuideId: z.string().uuid(),
  /** true = mark PRESENT (delete any absence row — present is the absence of a row). */
  present: z.boolean().optional(),
  excused: z.boolean().optional(),
  note: z.string().trim().max(240).nullish(),
});

/**
 * Record training attendance for one PG at one training. PRESENT is the ABSENCE of a row (the
 * prep_attendance idiom): marking a PG ABSENT upserts one row (the UNIQUE(school_id, training_id,
 * peer_guide_id) conflict target → re-logging updates the one row, never a second); marking a PG PRESENT
 * DELETES the row. The training-attendance % DERIVES from these rows — nothing is stored on the training.
 */
export async function recordTrainingAbsence(input: unknown): Promise<Result> {
  const gate = await authorizeVlcWrite();
  const parsed = AbsenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the attendance details." };
  const { trainingId, peerGuideId, present, excused } = parsed.data;
  const note = parsed.data.note?.trim() || null;
  try {
    await withSchool(gate.schoolId, async (tx) => {
      if (present) {
        // Mark present = remove the absence row (present is the absence of a row). Only audit when a
        // row actually existed — re-marking an already-present PG is a no-op, not a state change.
        const removed = await tx
          .delete(vlcTrainingAbsence)
          .where(
            and(
              eq(vlcTrainingAbsence.schoolId, gate.schoolId),
              eq(vlcTrainingAbsence.trainingId, trainingId),
              eq(vlcTrainingAbsence.peerGuideId, peerGuideId),
            ),
          )
          .returning({ id: vlcTrainingAbsence.id });
        if (removed.length > 0) {
          await recordAudit(tx, {
            schoolId: gate.schoolId,
            actorUserId: gate.actor.id ?? undefined,
            actorRole: gate.actor.role,
            actionType: "deleted",
            entityType: "vlc_training_absence",
            entityId: trainingId,
            after: { peerGuideId, present: true },
            reason: "Peer Guide marked present at training",
          });
        }
        return;
      }
      await tx
        .insert(vlcTrainingAbsence)
        .values({
          schoolId: gate.schoolId,
          trainingId,
          peerGuideId,
          excused: excused ?? false,
          note,
          recordedByUserId: gate.actor.id ?? undefined,
        })
        .onConflictDoUpdate({
          target: [
            vlcTrainingAbsence.schoolId,
            vlcTrainingAbsence.trainingId,
            vlcTrainingAbsence.peerGuideId,
          ],
          set: { excused: excused ?? false, note, recordedByUserId: gate.actor.id ?? undefined },
        });
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: "created",
        entityType: "vlc_training_absence",
        entityId: trainingId,
        after: { peerGuideId, excused: excused ?? false, note },
        reason: "Peer Guide training absence recorded",
      });
    });
    safeRevalidate(PG_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not record training attendance." };
  }
}
