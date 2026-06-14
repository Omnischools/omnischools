import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { students } from "@/db/schema";
import { StudentsTable } from "@/components/students/students-table";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  const { school } = await requireSchool();
  const rows = await withSchool(school.id, (tx) =>
    tx
      .select({
        id: students.id,
        studentCode: students.studentCode,
        firstName: students.firstName,
        lastName: students.lastName,
        otherNames: students.otherNames,
        sex: students.sex,
        currentClassLabel: students.currentClassLabel,
        status: students.status,
      })
      .from(students)
      .where(eq(students.schoolId, school.id))
      .orderBy(desc(students.createdAt))
      .limit(200),
  );

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold text-navy">Students</h1>
          <p className="text-sm text-navy-3">{rows.length} on roll</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/students/import"
            className="rounded-md border border-border-2 px-4 py-2.5 text-sm font-semibold text-navy-2 transition-colors hover:bg-bg"
          >
            Import
          </Link>
          <Link
            href="/students/new"
            className="rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
          >
            + Add student
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center">
          <p className="font-display text-lg text-navy">No students yet.</p>
          <p className="mt-1 text-sm text-navy-3">
            Add one directly, or accept an application from{" "}
            <Link href="/admissions" className="text-gold underline">
              Admissions
            </Link>
            .
          </p>
        </div>
      ) : (
        <StudentsTable rows={rows} />
      )}
    </div>
  );
}
