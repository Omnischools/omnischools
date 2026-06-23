"use server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { sendSms } from "@/lib/sms";
import { safeRevalidate } from "@/lib/revalidate";
import { ATTENDANCE_REASON_CODES } from "@/lib/attendance-reasons";
import {
  classes,
  students,
  studentGuardians,
  attendanceRecords,
  attendanceCorrections,
  attendanceSettings,
} from "@/db/schema";

const STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED", "MEDICAL"] as const;

// ------------------------------------------------------------------- classes
export type CreateClassResult =
  | { ok: true; classId: string }
  | { ok: false; error: string };

export async function createClass(input: unknown): Promise<CreateClassResult> {
  const { school } = await requireSchool();
  const parsed = z
    .object({
      name: z.string().min(1).max(60),
      level: z.string().max(40).optional().or(z.literal("")),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid class name." };
  const actor = await resolveActor(school.id);
  try {
    const out = await withSchool(school.id, async (tx) => {
      const [cls] = await tx
        .insert(classes)
        .values({
          schoolId: school.id,
          name: parsed.data.name,
          level: parsed.data.level || null,
        })
        .returning();
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "class",
        entityId: cls.id,
        after: { name: cls.name },
      });
      return cls.id;
    });
    safeRevalidate("/attendance");
    return { ok: true, classId: out };
  } catch {
    return { ok: false, error: "Could not create the class (name may already exist)." };
  }
}

export async function setStudentClass(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const { school } = await requireSchool();
  const parsed = z
    .object({ studentId: z.string().uuid(), classId: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  try {
    await withSchool(school.id, async (tx) => {
      const [cls] = await tx
        .select({ name: classes.name })
        .from(classes)
        .where(and(eq(classes.id, parsed.data.classId), eq(classes.schoolId, school.id)));
      await tx
        .update(students)
        .set({ classId: parsed.data.classId, currentClassLabel: cls?.name ?? null })
        .where(
          and(eq(students.id, parsed.data.studentId), eq(students.schoolId, school.id)),
        );
    });
    safeRevalidate("/attendance");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not assign the student." };
  }
}

// ---------------------------------------------------------------- attendance
const SaveSchema = z.object({
  classId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  entries: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        status: z.enum(STATUSES),
        reasonCode: z.enum(ATTENDANCE_REASON_CODES).nullable().optional(),
        note: z.string().max(300).nullable().optional(),
      }),
    )
    .min(1, "No students to mark"),
});

export type SaveAttendanceResult =
  | { ok: true; marked: number; absent: number; alertsSent: number }
  | { ok: false; error: string };

export async function saveAttendance(input: unknown): Promise<SaveAttendanceResult> {
  const { school } = await requireSchool();
  const parsed = SaveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid attendance" };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const out = await withSchool(school.id, async (tx) => {
      // Edit-window lock — a register marked longer ago than the window can only
      // be changed through the correction flow, not re-saved directly.
      const existing = await tx
        .select({ markedAt: attendanceRecords.markedAt })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.schoolId, school.id),
            eq(attendanceRecords.classId, d.classId),
            eq(attendanceRecords.date, d.date),
          ),
        );
      if (existing.length > 0) {
        const [cfg] = await tx
          .select({ editWindowHours: attendanceSettings.editWindowHours })
          .from(attendanceSettings)
          .where(eq(attendanceSettings.schoolId, school.id))
          .limit(1);
        const windowH = cfg?.editWindowHours ?? 24;
        const oldest = existing.reduce<number>((min, r) => {
          const t = (
            r.markedAt instanceof Date ? r.markedAt : new Date(r.markedAt as string)
          ).getTime();
          return t < min ? t : min;
        }, Infinity);
        if (windowH > 0 && Date.now() - oldest > windowH * 3_600_000) {
          return { locked: true as const };
        }
      }

      for (const e of d.entries) {
        // Reason/note only make sense for non-present marks; clear them otherwise.
        const reasonCode = e.status === "PRESENT" ? null : (e.reasonCode ?? null);
        const note = e.status === "PRESENT" ? null : (e.note?.trim() || null);
        await tx
          .insert(attendanceRecords)
          .values({
            schoolId: school.id,
            studentId: e.studentId,
            classId: d.classId,
            date: d.date,
            status: e.status,
            reasonCode,
            note,
            markedByUserId: actor.id ?? undefined,
            markedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              attendanceRecords.schoolId,
              attendanceRecords.studentId,
              attendanceRecords.date,
            ],
            set: {
              status: e.status,
              reasonCode,
              note,
              markedByUserId: actor.id ?? undefined,
              markedAt: new Date(),
            },
          });
      }
      const absent = d.entries
        .filter((e) => e.status === "ABSENT")
        .map((e) => e.studentId);
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "marked",
        entityType: "attendance",
        entityId: d.classId,
        after: { date: d.date, marked: d.entries.length, absent: absent.length },
        reason: "Attendance taken",
      });
      return { locked: false as const, absent };
    });

    if (out.locked) {
      return {
        ok: false,
        error:
          "This register is locked — the edit window has closed. Submit a correction request to change it.",
      };
    }
    const absentStudentIds = out.absent;

    // absence alerts to primary guardians — only when the school keeps them on
    let alertsSent = 0;
    const [cfg] = await withSchool(school.id, (tx) =>
      tx
        .select({ absenceSms: attendanceSettings.absenceSms })
        .from(attendanceSettings)
        .where(eq(attendanceSettings.schoolId, school.id))
        .limit(1),
    );
    const smsOn = cfg?.absenceSms ?? true; // default on when unconfigured
    if (smsOn && absentStudentIds.length > 0) {
      const guardians = await withSchool(school.id, (tx) =>
        tx
          .select({
            studentId: studentGuardians.studentId,
            phone: studentGuardians.phone,
            first: students.firstName,
          })
          .from(studentGuardians)
          .innerJoin(students, eq(students.id, studentGuardians.studentId))
          .where(
            and(
              inArray(studentGuardians.studentId, absentStudentIds),
              eq(studentGuardians.isPrimary, true),
            ),
          ),
      );
      for (const g of guardians) {
        await sendSms(
          g.phone,
          `${school.shortName ?? "Omnischools"}: ${g.first} was marked absent on ${d.date}. Please contact the school if this is unexpected.`,
        );
        alertsSent++;
      }
    }

    safeRevalidate("/attendance");
    safeRevalidate(`/attendance/${d.classId}`);
    return {
      ok: true,
      marked: d.entries.length,
      absent: absentStudentIds.length,
      alertsSent,
    };
  } catch {
    return { ok: false, error: "Could not save attendance. Please try again." };
  }
}

// ---------------------------------------------------------------- corrections
export async function requestCorrection(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const { school } = await requireSchool();
  const parsed = z
    .object({
      attendanceRecordId: z.string().uuid(),
      requestedStatus: z.enum(STATUSES),
      reason: z.string().min(3, "A reason is required").max(500),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, (tx) =>
      tx.insert(attendanceCorrections).values({
        schoolId: school.id,
        attendanceRecordId: parsed.data.attendanceRecordId,
        requestedStatus: parsed.data.requestedStatus,
        reason: parsed.data.reason,
        requestedByUserId: actor.id ?? undefined,
      }),
    );
    safeRevalidate("/attendance/corrections");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not submit the correction request." };
  }
}

export async function decideCorrection(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const { school } = await requireSchool();
  const parsed = z
    .object({
      correctionId: z.string().uuid(),
      approve: z.boolean(),
      note: z.string().max(1000).optional(),
      sendCorrectionSms: z.boolean().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid decision." };
  const note = parsed.data.note?.trim() || null;
  const actor = await resolveActor(school.id);
  try {
    // The guardian to message on approve (resolved in-tx, sent after commit).
    let correctionSms: { phone: string; first: string; status: string; date: string } | null =
      null;

    await withSchool(school.id, async (tx) => {
      const [c] = await tx
        .select()
        .from(attendanceCorrections)
        .where(
          and(
            eq(attendanceCorrections.id, parsed.data.correctionId),
            eq(attendanceCorrections.schoolId, school.id),
          ),
        );
      if (!c || c.status !== "PENDING") return;

      if (parsed.data.approve) {
        await tx
          .update(attendanceRecords)
          .set({
            status: c.requestedStatus,
            markedByUserId: actor.id ?? undefined,
            markedAt: new Date(),
          })
          .where(eq(attendanceRecords.id, c.attendanceRecordId));
      }
      await tx
        .update(attendanceCorrections)
        .set({
          status: parsed.data.approve ? "APPROVED" : "REJECTED",
          decidedByUserId: actor.id ?? undefined,
          decidedAt: new Date(),
          decisionNote: note,
        })
        .where(eq(attendanceCorrections.id, c.id));

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: parsed.data.approve ? "correction_approved" : "correction_rejected",
        entityType: "attendance_record",
        entityId: c.attendanceRecordId,
        after: { requestedStatus: c.requestedStatus, note },
        reason: note ?? "Attendance correction decision",
      });

      if (parsed.data.approve && parsed.data.sendCorrectionSms) {
        const [g] = await tx
          .select({
            phone: studentGuardians.phone,
            first: students.firstName,
            date: attendanceRecords.date,
          })
          .from(attendanceRecords)
          .innerJoin(students, eq(students.id, attendanceRecords.studentId))
          .innerJoin(
            studentGuardians,
            and(
              eq(studentGuardians.studentId, students.id),
              eq(studentGuardians.isPrimary, true),
            ),
          )
          .where(eq(attendanceRecords.id, c.attendanceRecordId))
          .limit(1);
        if (g) correctionSms = { phone: g.phone, first: g.first, status: c.requestedStatus, date: g.date };
      }
    });

    if (correctionSms) {
      const c = correctionSms as { phone: string; first: string; status: string; date: string };
      const label = c.status.charAt(0) + c.status.slice(1).toLowerCase();
      await sendSms(
        c.phone,
        `${school.shortName ?? "Omnischools"}: ${c.first}'s attendance on ${c.date} has been corrected to ${label}.`,
      );
    }

    safeRevalidate("/attendance/corrections");
    safeRevalidate("/attendance");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not record the decision." };
  }
}

// ------------------------------------------------------------------- settings
const SettingsSchema = z.object({
  dayStart: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  lateThreshold: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  dayEnd: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  editWindowHours: z.coerce.number().int().min(0).max(336),
  absenceSms: z.coerce.boolean(),
  absWatchDays: z.coerce.number().int().min(1).max(30),
  absCriticalDays: z.coerce.number().int().min(1).max(60),
  pctWatch: z.coerce.number().int().min(1).max(100),
  pctCritical: z.coerce.number().int().min(1).max(100),
});

export async function updateAttendanceSettings(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const { school } = await requireSchool();
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings." };
  }
  const d = parsed.data;
  if (d.absCriticalDays < d.absWatchDays) {
    return { ok: false, error: "Critical absence days must be ≥ the watch threshold." };
  }
  if (d.pctCritical > d.pctWatch) {
    return { ok: false, error: "Critical % must be ≤ the watch %." };
  }
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await tx
        .insert(attendanceSettings)
        .values({ schoolId: school.id, ...d, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: attendanceSettings.schoolId,
          set: { ...d, updatedAt: new Date() },
        });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "attendance_settings",
        entityId: school.id,
        reason: "Attendance settings updated",
      });
    });
    safeRevalidate("/settings/attendance");
    safeRevalidate("/attendance");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the settings." };
  }
}
