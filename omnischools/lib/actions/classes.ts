"use server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { classes, students, subjects, timetableSlots } from "@/db/schema";

type Result = { ok: boolean; error?: string; id?: string };

const nz = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : v;
  return s ? (s as string) : null;
};

// ------------------------------------------------------------------ classes
const CreateClassSchema = z.object({
  name: z.string().min(1, "Enter a class name").max(60),
  level: z.string().max(40).optional().nullable(),
});

export async function createClass(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = CreateClassSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const actor = await resolveActor(school.id);
  try {
    const id = await withSchool(school.id, async (tx) => {
      const [c] = await tx
        .insert(classes)
        .values({
          schoolId: school.id,
          name: parsed.data.name.trim(),
          level: nz(parsed.data.level),
        })
        .returning({ id: classes.id });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "class",
        entityId: c.id,
        after: { name: parsed.data.name },
        reason: "Class created",
      });
      return c.id;
    });
    safeRevalidate("/classes");
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Could not create class — that name may already exist." };
  }
}

const SetTeacherSchema = z.object({
  classId: z.string().uuid(),
  userId: z.string().optional().nullable(),
});

export async function setClassTeacher(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = SetTeacherSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const teacher = nz(parsed.data.userId);
  try {
    await withSchool(school.id, (tx) =>
      tx
        .update(classes)
        .set({ classTeacherUserId: teacher })
        .where(and(eq(classes.id, parsed.data.classId), eq(classes.schoolId, school.id))),
    );
    safeRevalidate("/classes");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not assign class teacher." };
  }
}

// -------------------------------------------------------------- class roster
const AssignStudentsSchema = z.object({
  classId: z.string().uuid(),
  studentIds: z.array(z.string().uuid()).min(1),
});

export async function assignStudentsToClass(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = AssignStudentsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Select at least one student" };
  try {
    await withSchool(school.id, async (tx) => {
      const [cls] = await tx
        .select({ name: classes.name })
        .from(classes)
        .where(and(eq(classes.id, parsed.data.classId), eq(classes.schoolId, school.id)));
      if (!cls) throw new Error("class not found");
      await tx
        .update(students)
        .set({ classId: parsed.data.classId, currentClassLabel: cls.name })
        .where(
          and(
            eq(students.schoolId, school.id),
            inArray(students.id, parsed.data.studentIds),
          ),
        );
    });
    safeRevalidate(`/classes/${parsed.data.classId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not add students." };
  }
}

const RemoveStudentSchema = z.object({ studentId: z.string().uuid() });

export async function removeStudentFromClass(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = RemoveStudentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try {
    await withSchool(school.id, (tx) =>
      tx
        .update(students)
        .set({ classId: null, currentClassLabel: null })
        .where(
          and(eq(students.id, parsed.data.studentId), eq(students.schoolId, school.id)),
        ),
    );
    safeRevalidate("/classes");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not remove student." };
  }
}

// ------------------------------------------------------------------ subjects
const AddSubjectSchema = z.object({
  name: z.string().min(1, "Enter a subject name").max(60),
});

export async function addSubject(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = AddSubjectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    await withSchool(school.id, (tx) =>
      tx
        .insert(subjects)
        .values({ schoolId: school.id, name: parsed.data.name.trim() })
        .onConflictDoNothing({ target: [subjects.schoolId, subjects.name] }),
    );
    safeRevalidate("/classes");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not add subject." };
  }
}

// ----------------------------------------------------------------- timetable
const AddSlotSchema = z.object({
  classId: z.string().uuid(),
  dayOfWeek: z.coerce.number().int().min(1).max(7),
  periodIndex: z.coerce.number().int().min(1).max(15),
  subjectId: z.string().optional().nullable(),
  teacherUserId: z.string().optional().nullable(),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
});

export async function addTimetableSlot(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = AddSlotSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const d = parsed.data;
  const teacherUserId = nz(d.teacherUserId);
  try {
    const outcome = await withSchool(school.id, async (tx) => {
      if (teacherUserId) {
        const clash = await tx
          .select({ id: timetableSlots.id })
          .from(timetableSlots)
          .where(
            and(
              eq(timetableSlots.schoolId, school.id),
              eq(timetableSlots.teacherUserId, teacherUserId),
              eq(timetableSlots.dayOfWeek, d.dayOfWeek),
              eq(timetableSlots.periodIndex, d.periodIndex),
            ),
          );
        if (clash.length > 0) {
          return { error: "That teacher is already booked for this period." };
        }
      }
      await tx.insert(timetableSlots).values({
        schoolId: school.id,
        classId: d.classId,
        dayOfWeek: d.dayOfWeek,
        periodIndex: d.periodIndex,
        subjectId: nz(d.subjectId),
        teacherUserId,
        startTime: nz(d.startTime),
        endTime: nz(d.endTime),
      });
      return { ok: true as const };
    });
    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate(`/classes/${d.classId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "This class already has a lesson in that slot." };
  }
}

const RemoveSlotSchema = z.object({ slotId: z.string().uuid() });

export async function removeTimetableSlot(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = RemoveSlotSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try {
    await withSchool(school.id, (tx) =>
      tx
        .delete(timetableSlots)
        .where(
          and(
            eq(timetableSlots.id, parsed.data.slotId),
            eq(timetableSlots.schoolId, school.id),
          ),
        ),
    );
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not remove slot." };
  }
}
