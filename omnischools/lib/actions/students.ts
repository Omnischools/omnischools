"use server";
import { z } from "zod";
import { safeRevalidate } from "@/lib/revalidate";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { normalizeGhanaPhone } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { nextStudentCode } from "@/lib/students-helpers";
import { students, studentGuardians, classes } from "@/db/schema";

const CreateStudentSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(120),
  lastName: z.string().min(1, "Last name is required").max(120),
  otherNames: z.string().max(120).optional().or(z.literal("")),
  sex: z.enum(["MALE", "FEMALE"]),
  dateOfBirth: z.string().optional().or(z.literal("")),
  classId: z.string().uuid().optional().or(z.literal("")),
  guardianName: z.string().max(160).optional().or(z.literal("")),
  guardianPhone: z.string().max(40).optional().or(z.literal("")),
  guardianRelation: z.enum(["MOTHER", "FATHER", "GUARDIAN", "OTHER"]).default("GUARDIAN"),
});

export type CreateStudentResult =
  | { ok: true; studentId: string; studentCode: string }
  | { ok: false; error: string };

export async function createStudent(input: unknown): Promise<CreateStudentResult> {
  const { school } = await requireSchool();
  const parsed = CreateStudentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid student" };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const out = await withSchool(school.id, async (tx) => {
      const studentCode = await nextStudentCode(tx, school.id);
      let className: string | null = null;
      if (d.classId) {
        const [cls] = await tx
          .select({ name: classes.name })
          .from(classes)
          .where(and(eq(classes.id, d.classId), eq(classes.schoolId, school.id)));
        className = cls?.name ?? null;
      }
      const [student] = await tx
        .insert(students)
        .values({
          schoolId: school.id,
          studentCode,
          firstName: d.firstName,
          lastName: d.lastName,
          otherNames: d.otherNames || null,
          sex: d.sex,
          dateOfBirth: d.dateOfBirth || null,
          classId: d.classId || null,
          currentClassLabel: className,
          enrolledOn: new Date().toISOString().slice(0, 10),
        })
        .returning();

      if (d.guardianName && d.guardianPhone) {
        await tx.insert(studentGuardians).values({
          schoolId: school.id,
          studentId: student.id,
          name: d.guardianName,
          relationship: d.guardianRelation,
          phone: normalizeGhanaPhone(d.guardianPhone),
          isPrimary: true,
        });
      }

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "student",
        entityId: student.id,
        after: { studentCode, name: `${d.firstName} ${d.lastName}` },
        reason: "Manual student creation",
      });

      return { studentId: student.id, studentCode };
    });

    safeRevalidate("/students");
    return { ok: true, ...out };
  } catch {
    return { ok: false, error: "Could not create the student. Please try again." };
  }
}

// ------------------------------------------------------------- update student
const UpdateStudentSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().min(1, "First name is required").max(120),
  lastName: z.string().min(1, "Last name is required").max(120),
  otherNames: z.string().max(120).optional().or(z.literal("")),
  sex: z.enum(["MALE", "FEMALE"]),
  dateOfBirth: z.string().optional().or(z.literal("")),
  classId: z.string().uuid().optional().or(z.literal("")),
  status: z.enum(["ACTIVE", "INACTIVE", "GRADUATED", "WITHDRAWN", "TRANSFERRED"]),
  guardianName: z.string().max(160).optional().or(z.literal("")),
  guardianPhone: z.string().max(40).optional().or(z.literal("")),
  guardianRelation: z.enum(["MOTHER", "FATHER", "GUARDIAN", "OTHER"]).default("GUARDIAN"),
});

export async function updateStudent(input: unknown): Promise<CreateStudentResult> {
  const { school } = await requireSchool();
  const parsed = UpdateStudentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid student" };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const out = await withSchool(school.id, async (tx) => {
      const [existing] = await tx
        .select({ code: students.studentCode })
        .from(students)
        .where(and(eq(students.id, d.id), eq(students.schoolId, school.id)));
      if (!existing) return { ok: false as const, error: "Student not found." };

      let className: string | null = null;
      if (d.classId) {
        const [cls] = await tx
          .select({ name: classes.name })
          .from(classes)
          .where(and(eq(classes.id, d.classId), eq(classes.schoolId, school.id)));
        className = cls?.name ?? null;
      }

      await tx
        .update(students)
        .set({
          firstName: d.firstName,
          lastName: d.lastName,
          otherNames: d.otherNames || null,
          sex: d.sex,
          dateOfBirth: d.dateOfBirth || null,
          classId: d.classId || null,
          currentClassLabel: className,
          status: d.status,
        })
        .where(and(eq(students.id, d.id), eq(students.schoolId, school.id)));

      // Update (or create) the primary guardian when provided.
      if (d.guardianName && d.guardianPhone) {
        const [primary] = await tx
          .select({ id: studentGuardians.id })
          .from(studentGuardians)
          .where(
            and(
              eq(studentGuardians.studentId, d.id),
              eq(studentGuardians.isPrimary, true),
            ),
          );
        const phone = normalizeGhanaPhone(d.guardianPhone);
        if (primary) {
          await tx
            .update(studentGuardians)
            .set({ name: d.guardianName, phone, relationship: d.guardianRelation })
            .where(eq(studentGuardians.id, primary.id));
        } else {
          await tx.insert(studentGuardians).values({
            schoolId: school.id,
            studentId: d.id,
            name: d.guardianName,
            relationship: d.guardianRelation,
            phone,
            isPrimary: true,
          });
        }
      }

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "student",
        entityId: d.id,
        after: { name: `${d.firstName} ${d.lastName}`, status: d.status },
        reason: "Student record edited",
      });

      return { ok: true as const, studentId: d.id, studentCode: existing.code };
    });

    if (!out.ok) return out;
    safeRevalidate("/students");
    safeRevalidate(`/students/${d.id}`);
    return out;
  } catch {
    return { ok: false, error: "Could not update the student. Please try again." };
  }
}
