import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { isFinanceOnly } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { students } from "@/db/schema";
import { StudentsBrowser } from "@/components/students/students-browser";
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
        dateOfBirth: students.dateOfBirth,
      })
      .from(students)
      .where(eq(students.schoolId, school.id))
      .orderBy(desc(students.createdAt))
      .limit(500),
  );

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-page">
        <StudentsEmpty />
      </div>
    );
  }

  const classOptions = Array.from(
    new Set(rows.map((r) => r.currentClassLabel).filter((c): c is string => !!c)),
  ).sort();

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
            Omnischools · Students
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
            Every learner, <em className="text-gold">in focus</em>
          </h1>
          <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
          <p className="max-w-2xl text-sm text-navy-3">
            The whole roll at a glance — totals, gender balance and age. Filter by class,
            gender or status, then open any student for their full record.
          </p>
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

      <StudentsBrowser rows={rows} classOptions={classOptions} readOnly={readOnly} />
    </div>
  );
}
