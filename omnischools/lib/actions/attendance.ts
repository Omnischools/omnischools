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
    const absentStudentIds = await withSchool(school.id, async (tx) => {
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
      return absent;
    });

    // absence alerts to primary guardians (stub)
    let alertsSent = 0;
    if (absentStudentIds.length > 0) {
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
    .object({ correctionId: z.string().uuid(), approve: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid decision." };
  const actor = await resolveActor(school.id);
  try {
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
        })
        .where(eq(attendanceCorrections.id, c.id));

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: parsed.data.approve ? "correction_approved" : "correction_rejected",
        entityType: "attendance_record",
        entityId: c.attendanceRecordId,
        after: { requestedStatus: c.requestedStatus },
        reason: "Attendance correction decision",
      });
    });
    safeRevalidate("/attendance/corrections");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not record the decision." };
  }
}
