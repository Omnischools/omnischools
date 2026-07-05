"use server";
import { z } from "zod";
import { safeRevalidate } from "@/lib/revalidate";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor, assertWriteAccess } from "@/lib/auth/server";
import { normalizeGhanaPhone } from "@/lib/auth";
import { and, count, eq, inArray } from "drizzle-orm";
import { nextStudentCode } from "@/lib/students-helpers";
import type { Tx } from "@/lib/db";
import {
  students,
  studentGuardians,
  studentHealthRecords,
  classes,
  invoices,
  payments,
  gradebookScores,
  reportCards,
  attendanceRecords,
  admissionApplications,
} from "@/db/schema";

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
  await assertWriteAccess();
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
  // Health & emergency record (all optional)
  bloodGroup: z.string().max(8).optional().or(z.literal("")),
  allergies: z.string().max(1000).optional().or(z.literal("")),
  conditions: z.string().max(1000).optional().or(z.literal("")),
  medications: z.string().max(1000).optional().or(z.literal("")),
  emergencyContactName: z.string().max(160).optional().or(z.literal("")),
  emergencyContactPhone: z.string().max(40).optional().or(z.literal("")),
  emergencyContactRelation: z.string().max(60).optional().or(z.literal("")),
  healthNotes: z.string().max(2000).optional().or(z.literal("")),
});

export async function updateStudent(input: unknown): Promise<CreateStudentResult> {
  const { school } = await requireSchool();
  await assertWriteAccess();
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

      // Health & emergency record (1:1 upsert). All fields optional; blanks → null.
      const nz = (v?: string) => (v && v.trim() ? v.trim() : null);
      const health = {
        bloodGroup: nz(d.bloodGroup),
        allergies: nz(d.allergies),
        conditions: nz(d.conditions),
        medications: nz(d.medications),
        emergencyContactName: nz(d.emergencyContactName),
        emergencyContactPhone: d.emergencyContactPhone?.trim()
          ? normalizeGhanaPhone(d.emergencyContactPhone)
          : null,
        emergencyContactRelation: nz(d.emergencyContactRelation),
        notes: nz(d.healthNotes),
      };
      await tx
        .insert(studentHealthRecords)
        .values({
          schoolId: school.id,
          studentId: d.id,
          ...health,
          updatedByUserId: actor.id ?? undefined,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: studentHealthRecords.studentId,
          set: { ...health, updatedByUserId: actor.id ?? undefined, updatedAt: new Date() },
        });

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

// ------------------------------------------------------------- bulk import
const ImportRowSchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  otherNames: z.string().max(120).optional().or(z.literal("")),
  sex: z.enum(["MALE", "FEMALE"]),
  dateOfBirth: z.string().optional().or(z.literal("")),
  classId: z.string().uuid().optional().or(z.literal("")),
  guardianName: z.string().max(160).optional().or(z.literal("")),
  guardianPhone: z.string().max(40).optional().or(z.literal("")),
  guardianRelation: z.enum(["MOTHER", "FATHER", "GUARDIAN", "OTHER"]).default("GUARDIAN"),
});
const ImportStudentsSchema = z.object({
  rows: z.array(ImportRowSchema).min(1, "No rows to import").max(1000),
});

export type ImportStudentsResult =
  | { ok: true; created: number }
  | { ok: false; error: string };

export async function importStudents(input: unknown): Promise<ImportStudentsResult> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = ImportStudentsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid import" };
  }
  const actor = await resolveActor(school.id);

  try {
    const created = await withSchool(school.id, async (tx) => {
      const classRows = await tx
        .select({ id: classes.id, name: classes.name })
        .from(classes)
        .where(eq(classes.schoolId, school.id));
      const classNameById = new Map(classRows.map((c) => [c.id, c.name]));

      let n = 0;
      for (const r of parsed.data.rows) {
        const studentCode = await nextStudentCode(tx, school.id);
        const [student] = await tx
          .insert(students)
          .values({
            schoolId: school.id,
            studentCode,
            firstName: r.firstName,
            lastName: r.lastName,
            otherNames: r.otherNames || null,
            sex: r.sex,
            dateOfBirth: r.dateOfBirth || null,
            classId: r.classId || null,
            currentClassLabel: r.classId ? (classNameById.get(r.classId) ?? null) : null,
            enrolledOn: new Date().toISOString().slice(0, 10),
          })
          .returning({ id: students.id });

        if (r.guardianName && r.guardianPhone) {
          await tx.insert(studentGuardians).values({
            schoolId: school.id,
            studentId: student.id,
            name: r.guardianName,
            relationship: r.guardianRelation,
            phone: normalizeGhanaPhone(r.guardianPhone),
            isPrimary: true,
          });
        }
        n++;
      }

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "student_batch",
        after: { count: n },
        reason: "Bulk student import",
      });
      return n;
    });

    safeRevalidate("/students");
    return { ok: true, created };
  } catch {
    return { ok: false, error: "Could not import students. Please try again." };
  }
}

// ------------------------------------------------------------- delete student
type DeleteResult = { ok: boolean; error?: string };

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Linked records that make a hard delete unsafe (would destroy financial /
 * academic history). When any exist, deletion is blocked and the user is told to
 * set a status (Withdrawn / Transferred) instead. Guardians don't block — they
 * cascade away with the student.
 */
async function studentBlockers(
  tx: Tx,
  schoolId: string,
  id: string,
): Promise<string[]> {
  const reasons: string[] = [];
  const [p] = await tx
    .select({ n: count() })
    .from(payments)
    .where(and(eq(payments.schoolId, schoolId), eq(payments.studentId, id)));
  if (Number(p?.n ?? 0) > 0) reasons.push("payments");
  const [iv] = await tx
    .select({ n: count() })
    .from(invoices)
    .where(and(eq(invoices.schoolId, schoolId), eq(invoices.studentId, id)));
  if (Number(iv?.n ?? 0) > 0) reasons.push("invoices");
  const [g] = await tx
    .select({ n: count() })
    .from(gradebookScores)
    .where(
      and(eq(gradebookScores.schoolId, schoolId), eq(gradebookScores.studentId, id)),
    );
  if (Number(g?.n ?? 0) > 0) reasons.push("grades");
  const [rc] = await tx
    .select({ n: count() })
    .from(reportCards)
    .where(and(eq(reportCards.schoolId, schoolId), eq(reportCards.studentId, id)));
  if (Number(rc?.n ?? 0) > 0) reasons.push("report cards");
  const [at] = await tx
    .select({ n: count() })
    .from(attendanceRecords)
    .where(
      and(eq(attendanceRecords.schoolId, schoolId), eq(attendanceRecords.studentId, id)),
    );
  if (Number(at?.n ?? 0) > 0) reasons.push("attendance");
  return reasons;
}

const DeleteStudentSchema = z.object({ id: z.string().uuid() });

export async function deleteStudent(input: unknown): Promise<DeleteResult> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = DeleteStudentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const actor = await resolveActor(school.id);
  try {
    const outcome = await withSchool(school.id, async (tx) => {
      const [s] = await tx
        .select({ first: students.firstName, last: students.lastName })
        .from(students)
        .where(and(eq(students.id, parsed.data.id), eq(students.schoolId, school.id)));
      if (!s) return { error: "Student not found." };
      const blockers = await studentBlockers(tx, school.id, parsed.data.id);
      if (blockers.length) {
        return {
          error: `Can't delete — ${s.first} ${s.last} has ${listJoin(blockers)} on record. Set their status to Withdrawn or Transferred instead.`,
        };
      }
      // detach any admission link first (its FK would otherwise block the delete)
      await tx
        .update(admissionApplications)
        .set({ studentId: null })
        .where(
          and(
            eq(admissionApplications.schoolId, school.id),
            eq(admissionApplications.studentId, parsed.data.id),
          ),
        );
      await tx
        .delete(students)
        .where(and(eq(students.id, parsed.data.id), eq(students.schoolId, school.id)));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "deleted",
        entityType: "student",
        entityId: parsed.data.id,
        before: { name: `${s.first} ${s.last}` },
        reason: "Student deleted",
      });
      return { ok: true as const };
    });
    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate("/students");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not delete the student." };
  }
}

const DeleteStudentsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

export type DeleteStudentsResult = {
  ok: boolean;
  error?: string;
  deleted?: number;
  blocked?: { name: string; reasons: string[] }[];
};

export async function deleteStudents(input: unknown): Promise<DeleteStudentsResult> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = DeleteStudentsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Select at least one student" };
  const ids = Array.from(new Set(parsed.data.ids));
  const actor = await resolveActor(school.id);
  try {
    const result = await withSchool(school.id, async (tx) => {
      const rows = await tx
        .select({ id: students.id, first: students.firstName, last: students.lastName })
        .from(students)
        .where(and(eq(students.schoolId, school.id), inArray(students.id, ids)));
      const blocked: { name: string; reasons: string[] }[] = [];
      const deletable: string[] = [];
      for (const r of rows) {
        const reasons = await studentBlockers(tx, school.id, r.id);
        if (reasons.length) blocked.push({ name: `${r.first} ${r.last}`, reasons });
        else deletable.push(r.id);
      }
      if (deletable.length) {
        await tx
          .update(admissionApplications)
          .set({ studentId: null })
          .where(
            and(
              eq(admissionApplications.schoolId, school.id),
              inArray(admissionApplications.studentId, deletable),
            ),
          );
        await tx
          .delete(students)
          .where(and(eq(students.schoolId, school.id), inArray(students.id, deletable)));
        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "deleted",
          entityType: "student_batch",
          after: { count: deletable.length },
          reason: "Students deleted (bulk)",
        });
      }
      return { deleted: deletable.length, blocked };
    });
    safeRevalidate("/students");
    return { ok: true, ...result };
  } catch {
    return { ok: false, error: "Could not delete the selected students." };
  }
}
