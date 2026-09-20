"use server";
/**
 * PTA meeting-register mutations (SHS module 4.7 / INCR-52 · the dual teacher/parent register). This is the
 * module's ONE live IDOR fence and the FIRST live use of `canActAsPtaOfficer` (R439): every write re-checks
 * `authorizePtaMeetingWrite`, which loads the meeting THROUGH the meeting→ptas join so `pta_id` / tier /
 * `school_id` are SERVER-loaded (NEVER request-supplied), server-loads the caller's held + ex-officio
 * offices, and allows the write iff the caller holds the PTA's Secretary office BY IDENTITY ∥ a break-glass
 * role. NO bare role satisfies the officer arm; a Secretary of PTA-A can NOT write PTA-B's register (the
 * pta_id is server-loaded off the meeting). A hand-crafted POST that never rendered the UI is refused here.
 *
 * DERIVED, never stored (R432/R435): the write-lock is an app-layer late-edit guard (refuse after end +
 * grace); TEACHER present-by-default (mark-present DELETES the row); PARENT absent-by-default (mark-absent
 * DELETES the row, mark-present/late UPSERTS) — so there are NO bulk absent rows and the unmarked→absent
 * flip is a pure read-time derivation. Each write records ONE audit row with a verbatim SHOWN entityType
 * (pta_meeting / pta_meeting_attendance) — METADATA ONLY. No triggers (portability) — this all lives here.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withSchool, isUniqueViolation } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { canActAsPtaOfficer, hasAnyRole, PTA_MEETING_BREAKGLASS_ROLES } from "@/lib/access";
import {
  loadMeetingScope,
  loadMeetingNotifyPhones,
  resolvePtaWriteAccess,
  type PtaMeetingScope,
} from "@/lib/pta/meeting-data";
import { coalesceGraceHours, isPtaMeetingWriteLocked } from "@/lib/pta/meeting-clock";
import { ptaMeetingInviteSms } from "@/lib/pta/meeting-invite-sms";
import { flushSms, type SmsIntent } from "@/lib/sms";
import { type PtaTierType } from "@/lib/pta/defaults";
import {
  academicPeriod,
  classes,
  houses,
  ptas,
  ptaMeeting,
  ptaMeetingAttendance,
  ptaOfficer,
  ptaTiersConfig,
  roleAssignments,
  roles,
  students,
  studentGuardians,
} from "@/db/schema";
import type { Tx } from "@/lib/db";

type Result = { ok: boolean; error?: string; meetingId?: string };
const LIST_PATH = "/senior/pta/meetings";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;
const registerPath = (meetingId: string) => `${LIST_PATH}/${meetingId}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-05-14" → "14 May 2026" — ASCII/GSM-7-safe (no Intl locale surprises) for the invite SMS body. */
function asciiMeetingDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? "?"} ${m[1]}`;
}

/** The PTA display label for the invite SMS body (FORM→class, HOUSE→house, EMERGENCY, else General). */
function convenedPtaLabel(tierType: PtaTierType, className: string | null, houseName: string | null): string {
  return tierType === "FORM"
    ? `${className ?? "Class"} PTA`
    : tierType === "HOUSE"
      ? `${houseName ?? "House"} PTA`
      : tierType === "EMERGENCY"
        ? "Emergency PTA"
        : "General PTA";
}

interface ConveneDetails {
  meetingType: string;
  meetingDate: string;
  startTime: string;
  endTime: string;
  location?: string | null;
}

/**
 * #297 · State-1 console-notify (SHARED by both convene paths). Load the scope's PRIMARY-guardian phone
 * roster (the SAME derivation the register renders — dedupe by phone, non-null only), pair each with the
 * PURE invite body, and PUSH the intents onto the caller's post-commit array (delivered by `flushSms`
 * AFTER the tx resolves; a rollback rejects before the flush line, so nothing is sent). Writes ONE SHOWN
 * audit row — recipient COUNT + meeting id ONLY, never a phone or a body. A no-phone scope queues nothing
 * and never throws. Staff invitees are NOT SMS'd in State-1.
 */
async function collectParentNotify(
  sms: SmsIntent[],
  tx: Tx,
  args: {
    schoolId: string;
    actor: { id: string | null; role: string };
    meetingId: string;
    schoolName: string;
    ptaLabel: string;
    tierType: PtaTierType;
    classId: string | null;
    houseId: string | null;
    d: ConveneDetails;
  },
): Promise<void> {
  const phones = await loadMeetingNotifyPhones(tx, args.schoolId, {
    tierType: args.tierType,
    classId: args.classId,
    houseId: args.houseId,
  });
  const body = ptaMeetingInviteSms({
    schoolName: args.schoolName,
    ptaLabel: args.ptaLabel,
    meetingType: args.d.meetingType,
    dateLabel: asciiMeetingDate(args.d.meetingDate),
    startTime: args.d.startTime,
    endTime: args.d.endTime,
    location: args.d.location?.trim() || null,
  });
  for (const to of phones) sms.push({ to, body });
  await recordAudit(tx, {
    schoolId: args.schoolId,
    actorUserId: args.actor.id ?? undefined,
    actorRole: args.actor.role,
    actionType: "updated",
    entityType: "pta_meeting",
    entityId: args.meetingId,
    after: { parentsNotified: phones.length },
    reason: `PTA meeting invite SMS queued to ${phones.length} parent${phones.length === 1 ? "" : "s"}`,
  });
}

// ── shared: resolve the SENIOR academic period covering `date` (else latest begun, else last) ────────

async function resolvePeriodForDate(tx: Tx, schoolId: string, date: string): Promise<string | null> {
  const rows = await tx
    .select({ periodId: academicPeriod.periodId, startsOn: academicPeriod.startsOn, endsOn: academicPeriod.endsOn })
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

// ── the R439 write-gate — server-loaded pta_id/tier + officer identity + refuse-after-lock ──────────

async function authorizePtaMeetingWrite(
  tx: Tx,
  schoolId: string,
  meetingId: string,
  viewer: { userId: string | null; roles: readonly string[] },
): Promise<{ ok: true; scope: PtaMeetingScope } | { ok: false; error: string }> {
  const scope = await loadMeetingScope(tx, schoolId, meetingId);
  if (!scope) return { ok: false, error: "That meeting no longer exists." };
  const { canWrite } = await resolvePtaWriteAccess(tx, schoolId, scope, viewer);
  if (!canWrite) return { ok: false, error: "Only the PTA's Secretary can update this register." };
  const grace = coalesceGraceHours(scope.tierSettings);
  if (isPtaMeetingWriteLocked(scope.meetingDate, scope.endTime, grace)) {
    return { ok: false, error: "This meeting has locked — the register can no longer be edited." };
  }
  return { ok: true, scope };
}

// ── member-in-register checks (R436 — the marked person must belong to the derived roster) ──────────

async function isActiveStaff(tx: Tx, schoolId: string, userId: string, today: string): Promise<boolean> {
  // Fetch this user's roles at the school; a marked teacher must hold an ACTIVE, non-student/parent role
  // (a bare PARENT/STUDENT — even one hand-crafting the POST — can never be marked into the teacher register).
  const rows = await tx
    .select({ code: roles.code, startDate: roleAssignments.startDate, endDate: roleAssignments.endDate })
    .from(roleAssignments)
    .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
    .where(and(eq(roleAssignments.schoolId, schoolId), eq(roleAssignments.userId, userId)));
  return rows.some(
    (r) =>
      r.code !== "STUDENT" &&
      r.code !== "PARENT" &&
      r.startDate <= today &&
      (r.endDate == null || r.endDate >= today),
  );
}

async function isScopeGuardian(
  tx: Tx,
  schoolId: string,
  scope: { tierType: PtaTierType; classId: string | null; houseId: string | null },
  guardianId: string,
): Promise<boolean> {
  const conds = [
    eq(studentGuardians.schoolId, schoolId),
    eq(studentGuardians.id, guardianId),
    eq(studentGuardians.isPrimary, true),
    eq(students.status, "ACTIVE"),
  ];
  if (scope.tierType === "FORM" && scope.classId) conds.push(eq(students.classId, scope.classId));
  else if (scope.tierType === "HOUSE" && scope.houseId) conds.push(eq(students.houseId, scope.houseId));
  const [row] = await tx
    .select({ id: studentGuardians.id })
    .from(studentGuardians)
    .innerJoin(students, and(eq(students.schoolId, studentGuardians.schoolId), eq(students.id, studentGuardians.studentId)))
    .where(and(...conds))
    .limit(1);
  return !!row;
}

// ── agenda normaliser (the INCR-48 plc_session shape) ────────────────────────────────────────────────

const AgendaItemSchema = z.object({
  text: z.string().trim().min(1).max(200),
  durationMin: z.coerce.number().int().min(0).max(600).nullish(),
  done: z.boolean().optional().default(false),
});
const normaliseAgenda = (items: { text: string; durationMin?: number | null; done?: boolean }[]) => ({
  items: items.map((it) => ({ text: it.text, durationMin: it.durationMin ?? null, done: it.done ?? false })),
});

// ── 1) Convene a REGULAR meeting on a standing PTA ───────────────────────────────────────────────────

const ConveneSchema = z.object({
  ptaId: z.string().uuid(),
  meetingType: z.string().trim().min(1, "Give the meeting a type.").max(120),
  meetingDate: z.string().regex(DATE, "Pick a meeting date."),
  startTime: z.string().regex(HHMM, "Pick a start time."),
  endTime: z.string().regex(HHMM, "Pick an end time."),
  location: z.string().trim().max(200).nullish(),
  agendaItems: z.array(z.string().trim().min(1).max(200)).max(30).optional().default([]),
  invitedTeacherUserIds: z.array(z.string().uuid()).max(50).optional().default([]),
  // #297 · State-1 console-notify. Default TRUE (owner-ratified): SMS the scope's parent roster on
  // convene. The writer gate is UNCHANGED — this only toggles the post-commit notify, not who may convene.
  notifyParents: z.boolean().optional().default(true),
});

/** Keep only the ids that are active staff of the school (drop any injected non-staff id). */
async function filterActiveStaff(tx: Tx, schoolId: string, ids: string[], today: string): Promise<string[]> {
  const out: string[] = [];
  for (const id of [...new Set(ids)]) if (await isActiveStaff(tx, schoolId, id, today)) out.push(id);
  return out;
}

export async function conveneMeeting(input: unknown): Promise<Result> {
  const parsed = ConveneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the meeting details." };
  const d = parsed.data;
  if (d.endTime <= d.startTime) return { ok: false, error: "The end time must be after the start time." };
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  const today = new Date().toISOString().slice(0, 10);
  const notifiedAt = new Date(); // the convene instant — the parents_notified_at stamp when notifyParents
  let newId: string | null = null;
  // #253 post-commit fence: intents collected INSIDE the tx, flushed AFTER it resolves (rollback → the tx
  // rejects before the flush line, so nothing is ever sent).
  const sms: SmsIntent[] = [];
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const [p] = await tx
        .select({
          id: ptas.id,
          tierType: ptas.tierType,
          status: ptas.status,
          classId: ptas.classId,
          houseId: ptas.houseId,
          className: classes.name,
          houseName: houses.name,
          classTeacherUserId: classes.classTeacherUserId,
          hmUserId: houses.hmUserId,
          tierSettings: ptaTiersConfig.tierSettings,
        })
        .from(ptas)
        .leftJoin(classes, and(eq(classes.schoolId, ptas.schoolId), eq(classes.id, ptas.classId)))
        .leftJoin(houses, and(eq(houses.schoolId, ptas.schoolId), eq(houses.id, ptas.houseId)))
        .leftJoin(ptaTiersConfig, and(eq(ptaTiersConfig.schoolId, ptas.schoolId), eq(ptaTiersConfig.tierType, ptas.tierType)))
        .where(and(eq(ptas.schoolId, school.id), eq(ptas.id, d.ptaId)))
        .limit(1);
      if (!p || p.status !== "ACTIVE") return { ok: false, error: "That PTA is not available." };
      const scope = {
        ptaId: p.id,
        tierType: p.tierType as PtaTierType,
        classTeacherUserId: p.classTeacherUserId,
        hmUserId: p.hmUserId,
        tierSettings: (p.tierSettings as Record<string, string>) ?? {},
      };
      const { canWrite } = await resolvePtaWriteAccess(tx, school.id, scope, { userId: user.id, roles: user.roles });
      if (!canWrite) return { ok: false, error: "Only the PTA's Secretary can convene this meeting." };

      const periodId = await resolvePeriodForDate(tx, school.id, d.meetingDate);
      if (!periodId) return { ok: false, error: "Configure the academic calendar before convening a meeting." };

      const invited = await filterActiveStaff(tx, school.id, d.invitedTeacherUserIds, today);
      const [row] = await tx
        .insert(ptaMeeting)
        .values({
          schoolId: school.id,
          ptaId: d.ptaId,
          academicPeriodId: periodId,
          meetingType: d.meetingType,
          meetingDate: d.meetingDate,
          startTime: d.startTime,
          endTime: d.endTime,
          location: d.location?.trim() || null,
          agendaJson: normaliseAgenda(d.agendaItems.map((text) => ({ text }))),
          invitedTeacherUserIds: invited,
          convenedByUserId: actor.id ?? undefined,
          parentsNotifiedAt: d.notifyParents ? notifiedAt : null,
        })
        .returning({ id: ptaMeeting.id });
      newId = row.id;
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "pta_meeting",
        entityId: row.id,
        after: { ptaId: d.ptaId, meetingType: d.meetingType, meetingDate: d.meetingDate, academicPeriodId: periodId },
        reason: "PTA meeting convened",
      });
      // #297 · State-1 console-notify: collect the parent-roster invite intents INSIDE the tx (flushed
      // post-commit). Staff invitees are NOT SMS'd in State-1. Audience = the scope's PRIMARY guardians.
      if (d.notifyParents) {
        await collectParentNotify(sms, tx, {
          schoolId: school.id,
          actor,
          meetingId: row.id,
          schoolName: school.name,
          ptaLabel: convenedPtaLabel(scope.tierType, p.className, p.houseName),
          tierType: scope.tierType,
          classId: p.classId,
          houseId: p.houseId,
          d,
        });
      }
      return { ok: true };
    });
    if (!res.ok) return res;
    await flushSms(sms); // #253 — delivered ONLY after the tx committed (rollback rejects before here)
    safeRevalidate(LIST_PATH);
    if (newId) safeRevalidate(registerPath(newId));
    return { ok: true, meetingId: newId ?? undefined };
  } catch {
    return { ok: false, error: "Could not convene the meeting." };
  }
}

// ── 2) Convene an EMERGENCY meeting — a NEW ptas EMERGENCY instance + the meeting, in ONE tx (R440) ──

const EmergencySchema = ConveneSchema.omit({ ptaId: true });

export async function conveneEmergencyMeeting(input: unknown): Promise<Result> {
  const parsed = EmergencySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the meeting details." };
  const d = parsed.data;
  if (d.endTime <= d.startTime) return { ok: false, error: "The end time must be after the start time." };
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  const today = new Date().toISOString().slice(0, 10);
  const notifiedAt = new Date(); // the convene instant — the parents_notified_at stamp when notifyParents
  let newId: string | null = null;
  const sms: SmsIntent[] = []; // #253 post-commit fence — collected in-tx, flushed after commit
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      // Convener gate (R440): break-glass ∥ the GENERAL PTA "Chair" BY IDENTITY (a stored office).
      let allowed = hasAnyRole(user.roles, PTA_MEETING_BREAKGLASS_ROLES);
      if (!allowed && user.id) {
        const [general] = await tx
          .select({ id: ptas.id })
          .from(ptas)
          .where(and(eq(ptas.schoolId, school.id), eq(ptas.tierType, "GENERAL"), eq(ptas.status, "ACTIVE")))
          .limit(1);
        if (general) {
          const held = await tx
            .select({ office: ptaOfficer.office })
            .from(ptaOfficer)
            .where(
              and(
                eq(ptaOfficer.schoolId, school.id),
                eq(ptaOfficer.ptaId, general.id),
                eq(ptaOfficer.personUserId, user.id),
                isNull(ptaOfficer.endedAt),
              ),
            );
          allowed = canActAsPtaOfficer({
            userId: user.id,
            heldOffices: held.map((h) => h.office),
            exOfficioOffices: [],
            office: "Chair",
          });
        }
      }
      if (!allowed) {
        return { ok: false, error: "Only an admin, the Headmaster, or the General PTA Chair can convene an emergency meeting." };
      }

      const periodId = await resolvePeriodForDate(tx, school.id, d.meetingDate);
      if (!periodId) return { ok: false, error: "Configure the academic calendar before convening a meeting." };

      // The NEW on-demand Emergency PTA instance (ACTIVE, class/house NULL — R414/R440).
      const [ptaRow] = await tx
        .insert(ptas)
        .values({ schoolId: school.id, tierType: "EMERGENCY", classId: null, houseId: null, status: "ACTIVE" })
        .returning({ id: ptas.id });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "ptas",
        entityId: ptaRow.id,
        after: { tierType: "EMERGENCY", status: "ACTIVE", onDemand: true },
        reason: "Emergency PTA convened on-demand",
      });

      const invited = await filterActiveStaff(tx, school.id, d.invitedTeacherUserIds, today);
      const [row] = await tx
        .insert(ptaMeeting)
        .values({
          schoolId: school.id,
          ptaId: ptaRow.id,
          academicPeriodId: periodId,
          meetingType: d.meetingType,
          meetingDate: d.meetingDate,
          startTime: d.startTime,
          endTime: d.endTime,
          location: d.location?.trim() || null,
          agendaJson: normaliseAgenda(d.agendaItems.map((text) => ({ text }))),
          invitedTeacherUserIds: invited,
          convenedByUserId: actor.id ?? undefined,
          parentsNotifiedAt: d.notifyParents ? notifiedAt : null,
        })
        .returning({ id: ptaMeeting.id });
      newId = row.id;
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "pta_meeting",
        entityId: row.id,
        after: { ptaId: ptaRow.id, meetingType: d.meetingType, meetingDate: d.meetingDate, emergency: true },
        reason: "Emergency PTA meeting convened",
      });
      // #297 · State-1 console-notify. EMERGENCY scope → all active students' primary guardians.
      if (d.notifyParents) {
        await collectParentNotify(sms, tx, {
          schoolId: school.id,
          actor,
          meetingId: row.id,
          schoolName: school.name,
          ptaLabel: convenedPtaLabel("EMERGENCY", null, null),
          tierType: "EMERGENCY",
          classId: null,
          houseId: null,
          d,
        });
      }
      return { ok: true };
    });
    if (!res.ok) return res;
    await flushSms(sms); // #253 — delivered ONLY after the tx committed (rollback rejects before here)
    safeRevalidate(LIST_PATH);
    if (newId) safeRevalidate(registerPath(newId));
    return { ok: true, meetingId: newId ?? undefined };
  } catch {
    return { ok: false, error: "Could not convene the emergency meeting." };
  }
}

// ── 3) Mark attendance — dual polarity (teacher present-by-default, parent absent-by-default) ────────

const MarkSchema = z
  .object({
    meetingId: z.string().uuid(),
    register: z.enum(["TEACHER", "PARENT"]),
    userId: z.string().uuid().optional(),
    studentGuardianId: z.string().uuid().optional(),
    status: z.enum(["PRESENT", "LATE", "ABSENT"]),
    minutesLate: z.coerce.number().int().min(0).max(600).optional(),
    note: z.string().trim().max(240).nullish(),
  })
  .refine((d) => (d.register === "TEACHER" ? !!d.userId : !!d.studentGuardianId), {
    message: "Missing the register identity.",
  });

export async function markAttendance(input: unknown): Promise<Result> {
  const parsed = MarkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the attendance details." };
  const d = parsed.data;
  const note = d.note?.trim() || null;
  const minutesLate = d.status === "LATE" ? (d.minutesLate ?? null) : null;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  const today = new Date().toISOString().slice(0, 10);
  let revalidate: string | null = null;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const gate = await authorizePtaMeetingWrite(tx, school.id, d.meetingId, { userId: user.id, roles: user.roles });
      if (!gate.ok) return gate;
      const { scope } = gate;
      revalidate = registerPath(scope.meetingId);

      // member-in-register + the identity column for this register.
      const idCol = d.register === "TEACHER" ? ptaMeetingAttendance.userId : ptaMeetingAttendance.studentGuardianId;
      const idVal = (d.register === "TEACHER" ? d.userId : d.studentGuardianId) as string;
      if (d.register === "TEACHER") {
        if (!(await isActiveStaff(tx, school.id, idVal, today))) {
          return { ok: false, error: "That person is not a member of staff." };
        }
      } else {
        if (!(await isScopeGuardian(tx, school.id, scope, idVal))) {
          return { ok: false, error: "That parent is not in this meeting's register." };
        }
      }

      // The register's default state: TEACHER = present (no row); PARENT = absent (no row). The action
      // WRITES a row only for the non-default state; the default state DELETES any row.
      const isDefaultDelete = d.register === "TEACHER" ? d.status === "PRESENT" : d.status === "ABSENT";

      const [before] = await tx
        .select({ status: ptaMeetingAttendance.status })
        .from(ptaMeetingAttendance)
        .where(
          and(
            eq(ptaMeetingAttendance.schoolId, school.id),
            eq(ptaMeetingAttendance.meetingId, d.meetingId),
            eq(ptaMeetingAttendance.register, d.register),
            eq(idCol, idVal),
          ),
        )
        .limit(1);

      if (isDefaultDelete) {
        if (!before) return { ok: true }; // already the default (no row) → no-op
        await tx
          .delete(ptaMeetingAttendance)
          .where(
            and(
              eq(ptaMeetingAttendance.schoolId, school.id),
              eq(ptaMeetingAttendance.meetingId, d.meetingId),
              eq(ptaMeetingAttendance.register, d.register),
              eq(idCol, idVal),
            ),
          );
        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "deleted",
          entityType: "pta_meeting_attendance",
          entityId: d.meetingId,
          before: { register: d.register, identity: idVal, status: before.status },
          after: { register: d.register, identity: idVal, status: d.status },
          reason: `PTA ${d.register.toLowerCase()} register · ${d.register === "TEACHER" ? "present" : "cleared to absent"}`,
        });
        return { ok: true };
      }

      if (before?.status === d.status) return { ok: true }; // no real change
      if (before) {
        await tx
          .update(ptaMeetingAttendance)
          .set({ status: d.status, minutesLate, note, recordedByUserId: actor.id ?? undefined })
          .where(
            and(
              eq(ptaMeetingAttendance.schoolId, school.id),
              eq(ptaMeetingAttendance.meetingId, d.meetingId),
              eq(ptaMeetingAttendance.register, d.register),
              eq(idCol, idVal),
            ),
          );
      } else {
        await tx.insert(ptaMeetingAttendance).values({
          schoolId: school.id,
          meetingId: d.meetingId,
          register: d.register,
          userId: d.register === "TEACHER" ? idVal : null,
          studentGuardianId: d.register === "PARENT" ? idVal : null,
          status: d.status,
          minutesLate: minutesLate ?? undefined,
          note,
          recordedByUserId: actor.id ?? undefined,
        });
      }
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: before ? "updated" : "created",
        entityType: "pta_meeting_attendance",
        entityId: d.meetingId,
        before: before ? { register: d.register, identity: idVal, status: before.status } : undefined,
        after: { register: d.register, identity: idVal, status: d.status, minutesLate },
        reason: `PTA ${d.register.toLowerCase()} register · ${d.status.toLowerCase()}`,
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    if (revalidate) safeRevalidate(revalidate);
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "That person is already marked in this register." };
    return { ok: false, error: "Could not update the attendance." };
  }
}

// ── 4) Stamp the quorum judgment (Secretary's nullable bool — NOT auto-derived, R438) ────────────────

const QuorumSchema = z.object({ meetingId: z.string().uuid(), quorumMet: z.boolean().nullable() });

export async function stampQuorum(input: unknown): Promise<Result> {
  const parsed = QuorumSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the quorum judgment." };
  const { meetingId, quorumMet } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  let revalidate: string | null = null;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const gate = await authorizePtaMeetingWrite(tx, school.id, meetingId, { userId: user.id, roles: user.roles });
      if (!gate.ok) return gate;
      revalidate = registerPath(gate.scope.meetingId);
      await tx
        .update(ptaMeeting)
        .set({ quorumMet, updatedAt: new Date() })
        .where(and(eq(ptaMeeting.schoolId, school.id), eq(ptaMeeting.id, meetingId)));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "pta_meeting",
        entityId: meetingId,
        after: { quorumMet },
        reason: `PTA quorum ${quorumMet === true ? "met" : quorumMet === false ? "not met" : "cleared"} (Secretary's judgment)`,
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    if (revalidate) safeRevalidate(revalidate);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not record the quorum judgment." };
  }
}

// ── 5) Edit the agenda (convener-authored, editable-until-lock, NOT append-only) ─────────────────────

const EditAgendaSchema = z.object({ meetingId: z.string().uuid(), items: z.array(AgendaItemSchema).max(30) });

export async function editAgenda(input: unknown): Promise<Result> {
  const parsed = EditAgendaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the agenda." };
  const { meetingId, items } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  let revalidate: string | null = null;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const gate = await authorizePtaMeetingWrite(tx, school.id, meetingId, { userId: user.id, roles: user.roles });
      if (!gate.ok) return gate;
      revalidate = registerPath(gate.scope.meetingId);
      const normalized = normaliseAgenda(items);
      await tx
        .update(ptaMeeting)
        .set({ agendaJson: normalized, updatedAt: new Date() })
        .where(and(eq(ptaMeeting.schoolId, school.id), eq(ptaMeeting.id, meetingId)));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "pta_meeting",
        entityId: meetingId,
        after: { itemCount: normalized.items.length, doneCount: normalized.items.filter((i) => i.done).length },
        reason: "PTA meeting agenda updated",
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
