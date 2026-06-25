"use server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor, assertWriteAccess } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import type { Tx } from "@/lib/db";
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
  await assertWriteAccess();
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

// edit a class (name + level) after creation
const UpdateClassSchema = z.object({
  classId: z.string().uuid(),
  name: z.string().min(1, "Enter a class name").max(60),
  level: z.string().max(40).optional().nullable(),
});

export async function updateClass(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = UpdateClassSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const name = parsed.data.name.trim();
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await tx
        .update(classes)
        .set({ name, level: nz(parsed.data.level) })
        .where(
          and(eq(classes.id, parsed.data.classId), eq(classes.schoolId, school.id)),
        );
      // keep students' display label in sync with the renamed class
      await tx
        .update(students)
        .set({ currentClassLabel: name })
        .where(
          and(
            eq(students.schoolId, school.id),
            eq(students.classId, parsed.data.classId),
          ),
        );
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "class",
        entityId: parsed.data.classId,
        after: { name },
        reason: "Class edited",
      });
    });
    safeRevalidate("/classes");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update class — that name may already exist." };
  }
}

// delete one or more classes. Students in them are unassigned (kept); the
// timetable and attendance for those classes cascade away at the DB level.
async function removeClasses(
  tx: Tx,
  schoolId: string,
  ids: string[],
): Promise<void> {
  await tx
    .update(students)
    .set({ classId: null, currentClassLabel: null })
    .where(and(eq(students.schoolId, schoolId), inArray(students.classId, ids)));
  await tx
    .delete(classes)
    .where(and(eq(classes.schoolId, schoolId), inArray(classes.id, ids)));
}

const DeleteClassSchema = z.object({ classId: z.string().uuid() });

export async function deleteClass(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = DeleteClassSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await removeClasses(tx, school.id, [parsed.data.classId]);
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "deleted",
        entityType: "class",
        entityId: parsed.data.classId,
        reason: "Class deleted",
      });
    });
    safeRevalidate("/classes");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not delete class." };
  }
}

const DeleteClassesSchema = z.object({
  classIds: z.array(z.string().uuid()).min(1).max(200),
});

export async function deleteClasses(
  input: unknown,
): Promise<Result & { deleted?: number }> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = DeleteClassesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Select at least one class" };
  const ids = Array.from(new Set(parsed.data.classIds));
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await removeClasses(tx, school.id, ids);
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "deleted",
        entityType: "class_batch",
        after: { count: ids.length },
        reason: "Classes deleted (bulk)",
      });
    });
    safeRevalidate("/classes");
    return { ok: true, deleted: ids.length };
  } catch {
    return { ok: false, error: "Could not delete the selected classes." };
  }
}

const SetTeacherSchema = z.object({
  classId: z.string().uuid(),
  userId: z.string().optional().nullable(),
});

export async function setClassTeacher(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
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
  await assertWriteAccess();
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
  await assertWriteAccess();
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
  await assertWriteAccess();
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

const RenameSubjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Enter a subject name").max(60),
});

export async function renameSubject(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = RenameSubjectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    await withSchool(school.id, (tx) =>
      tx
        .update(subjects)
        .set({ name: parsed.data.name.trim() })
        .where(and(eq(subjects.id, parsed.data.id), eq(subjects.schoolId, school.id))),
    );
    safeRevalidate("/classes");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not rename — that name may already exist." };
  }
}

const SubjectActiveSchema = z.object({ id: z.string().uuid(), active: z.boolean() });

export async function setSubjectActive(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = SubjectActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try {
    await withSchool(school.id, (tx) =>
      tx
        .update(subjects)
        .set({ active: parsed.data.active })
        .where(and(eq(subjects.id, parsed.data.id), eq(subjects.schoolId, school.id))),
    );
    safeRevalidate("/classes");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update subject." };
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
  await assertWriteAccess();
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

// Multi-day: lay the same lesson (subject·teacher·time·period) across several days.
const AddSlotsSchema = z.object({
  classId: z.string().uuid(),
  days: z.array(z.coerce.number().int().min(1).max(7)).min(1, "Pick at least one day"),
  periodIndex: z.coerce.number().int().min(1).max(15),
  subjectName: z.string().max(60).optional().nullable(),
  teacherUserId: z.string().optional().nullable(),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
});

export async function addTimetableSlots(
  input: unknown,
): Promise<Result & { created?: number; skipped?: number }> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = AddSlotsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const teacherUserId = nz(d.teacherUserId);
  const days = Array.from(new Set(d.days));
  try {
    const out = await withSchool(school.id, async (tx) => {
      // find-or-create the subject by name (allows custom subjects e.g. Twi, Ga)
      let subjectId: string | null = null;
      const subjName = nz(d.subjectName);
      if (subjName) {
        await tx
          .insert(subjects)
          .values({ schoolId: school.id, name: subjName })
          .onConflictDoNothing({ target: [subjects.schoolId, subjects.name] });
        const [s] = await tx
          .select({ id: subjects.id })
          .from(subjects)
          .where(and(eq(subjects.schoolId, school.id), eq(subjects.name, subjName)));
        subjectId = s?.id ?? null;
      }

      let created = 0;
      let skipped = 0;
      for (const day of days) {
        if (teacherUserId) {
          const clash = await tx
            .select({ id: timetableSlots.id })
            .from(timetableSlots)
            .where(
              and(
                eq(timetableSlots.schoolId, school.id),
                eq(timetableSlots.teacherUserId, teacherUserId),
                eq(timetableSlots.dayOfWeek, day),
                eq(timetableSlots.periodIndex, d.periodIndex),
              ),
            );
          if (clash.length > 0) {
            skipped++;
            continue;
          }
        }
        const ins = await tx
          .insert(timetableSlots)
          .values({
            schoolId: school.id,
            classId: d.classId,
            dayOfWeek: day,
            periodIndex: d.periodIndex,
            subjectId,
            teacherUserId,
            startTime: nz(d.startTime),
            endTime: nz(d.endTime),
          })
          .onConflictDoNothing({
            target: [
              timetableSlots.schoolId,
              timetableSlots.classId,
              timetableSlots.dayOfWeek,
              timetableSlots.periodIndex,
            ],
          })
          .returning({ id: timetableSlots.id });
        if (ins.length > 0) created++;
        else skipped++;
      }
      return { created, skipped };
    });
    safeRevalidate(`/classes/${d.classId}`);
    return { ok: true, ...out };
  } catch {
    return { ok: false, error: "Could not add the lessons. Please try again." };
  }
}

// Edit an existing lesson (single slot) after creation.
const UpdateSlotSchema = z.object({
  slotId: z.string().uuid(),
  classId: z.string().uuid(),
  dayOfWeek: z.coerce.number().int().min(1).max(7),
  periodIndex: z.coerce.number().int().min(1).max(15),
  subjectName: z.string().max(60).optional().nullable(),
  teacherUserId: z.string().optional().nullable(),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
});

export async function updateTimetableSlot(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = UpdateSlotSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const d = parsed.data;
  const teacherUserId = nz(d.teacherUserId);
  try {
    const outcome = await withSchool(school.id, async (tx) => {
      // class double-book (excluding this slot)
      const clazz = await tx
        .select({ id: timetableSlots.id })
        .from(timetableSlots)
        .where(
          and(
            eq(timetableSlots.schoolId, school.id),
            eq(timetableSlots.classId, d.classId),
            eq(timetableSlots.dayOfWeek, d.dayOfWeek),
            eq(timetableSlots.periodIndex, d.periodIndex),
            ne(timetableSlots.id, d.slotId),
          ),
        );
      if (clazz.length > 0) {
        return { error: "This class already has a lesson in that slot." };
      }
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
              ne(timetableSlots.id, d.slotId),
            ),
          );
        if (clash.length > 0) {
          return { error: "That teacher is already booked for this period." };
        }
      }

      // find-or-create subject by name
      let subjectId: string | null = null;
      const subjName = nz(d.subjectName);
      if (subjName) {
        await tx
          .insert(subjects)
          .values({ schoolId: school.id, name: subjName })
          .onConflictDoNothing({ target: [subjects.schoolId, subjects.name] });
        const [s] = await tx
          .select({ id: subjects.id })
          .from(subjects)
          .where(and(eq(subjects.schoolId, school.id), eq(subjects.name, subjName)));
        subjectId = s?.id ?? null;
      }

      await tx
        .update(timetableSlots)
        .set({
          dayOfWeek: d.dayOfWeek,
          periodIndex: d.periodIndex,
          subjectId,
          teacherUserId,
          startTime: nz(d.startTime),
          endTime: nz(d.endTime),
        })
        .where(
          and(eq(timetableSlots.id, d.slotId), eq(timetableSlots.schoolId, school.id)),
        );
      return { ok: true as const };
    });
    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate(`/classes/${d.classId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update the lesson." };
  }
}

const RemoveSlotSchema = z.object({ slotId: z.string().uuid() });

export async function removeTimetableSlot(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
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
