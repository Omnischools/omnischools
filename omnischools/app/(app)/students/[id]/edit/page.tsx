import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { students, studentGuardians, studentHealthRecords, classes } from "@/db/schema";
import { EditStudentForm } from "@/components/students/edit-student-form";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit student" };

export default async function EditStudentPage({ params }: { params: { id: string } }) {
  const { school } = await requireSchool();

  const data = await withSchool(school.id, async (tx) => {
    const [student] = await tx
      .select()
      .from(students)
      .where(and(eq(students.id, params.id), eq(students.schoolId, school.id)));
    if (!student) return null;
    const [guardian] = await tx
      .select()
      .from(studentGuardians)
      .where(
        and(
          eq(studentGuardians.studentId, student.id),
          eq(studentGuardians.isPrimary, true),
        ),
      );
    const classRows = await tx
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .where(and(eq(classes.schoolId, school.id), eq(classes.active, true)))
      .orderBy(asc(classes.name));
    const [health] = await tx
      .select()
      .from(studentHealthRecords)
      .where(eq(studentHealthRecords.studentId, student.id));
    return { student, guardian, classRows, health };
  });

  if (!data) notFound();
  const { student, guardian, classRows, health } = data;

  return (
    <div className="mx-auto max-w-3xl">
      <BackLink href={`/students/${student.id}`} label="Back to student" />
      <h1 className="mb-6 mt-2 font-display text-3xl font-semibold text-navy">
        Edit {student.firstName} {student.lastName}
      </h1>
      <EditStudentForm
        student={{
          id: student.id,
          firstName: student.firstName,
          lastName: student.lastName,
          otherNames: student.otherNames,
          sex: student.sex,
          dateOfBirth: student.dateOfBirth,
          classId: student.classId,
          status: student.status,
        }}
        classes={classRows}
        guardian={
          guardian
            ? {
                name: guardian.name,
                phone: guardian.phone,
                relationship: guardian.relationship,
              }
            : null
        }
        health={
          health
            ? {
                bloodGroup: health.bloodGroup,
                allergies: health.allergies,
                conditions: health.conditions,
                medications: health.medications,
                emergencyContactName: health.emergencyContactName,
                emergencyContactPhone: health.emergencyContactPhone,
                emergencyContactRelation: health.emergencyContactRelation,
                notes: health.notes,
              }
            : null
        }
      />
    </div>
  );
}
