"use server";
import { z } from "zod";
import { safeRevalidate } from "@/lib/revalidate";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { normalizeGhanaPhone } from "@/lib/auth";
import { nextStudentCode } from "@/lib/students-helpers";
import { students, studentGuardians } from "@/db/schema";

const CreateStudentSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(120),
  lastName: z.string().min(1, "Last name is required").max(120),
  otherNames: z.string().max(120).optional().or(z.literal("")),
  sex: z.enum(["MALE", "FEMALE"]),
  dateOfBirth: z.string().optional().or(z.literal("")),
  classLabel: z.string().max(60).optional().or(z.literal("")),
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
          currentClassLabel: d.classLabel || null,
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
