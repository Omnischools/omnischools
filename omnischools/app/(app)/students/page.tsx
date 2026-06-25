import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { isFinanceOnly } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { students } from "@/db/schema";
import { StudentsTable } from "@/components/students/students-table";
import { StudentsEmpty } from "@/components/students/students-empty";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  const { school, user } = await requireSchool();
  // Finance-only staff (Accountant/Bursar) get a read-only view — no write controls.
  const readOnly = isFinanceOnly(user.roles);
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

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-page">
        <StudentsEmpty />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold text-navy">Students</h1>
          <p className="text-sm text-navy-3">{rows.length} on roll</p>
        </div>
        {!readOnly && (
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
        )}
      </div>

      <StudentsTable rows={rows} readOnly={readOnly} />
    </div>
  );
}
