import Link from "next/link";
import { asc, count, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { classes, students } from "@/db/schema";
import { loadStaffOptions } from "@/lib/data/staff-options";
import { CreateClassForm } from "@/components/classes/create-class-form";
import { ClassTeacherSelect } from "@/components/classes/class-teacher-select";

export const dynamic = "force-dynamic";

export default async function ClassesPage() {
  const { school } = await requireSchool();

  const [classRows, staff, countRows] = await Promise.all([
    withSchool(school.id, (tx) =>
      tx
        .select({
          id: classes.id,
          name: classes.name,
          level: classes.level,
          teacherId: classes.classTeacherUserId,
          active: classes.active,
        })
        .from(classes)
        .where(eq(classes.schoolId, school.id))
        .orderBy(asc(classes.name)),
    ),
    loadStaffOptions(school.id),
    withSchool(school.id, (tx) =>
      tx
        .select({ classId: students.classId, n: count() })
        .from(students)
        .where(eq(students.schoolId, school.id))
        .groupBy(students.classId),
    ),
  ]);

  const sizeOf = new Map(countRows.map((r) => [r.classId, Number(r.n)]));

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-navy">Classes</h1>
          <p className="text-sm text-navy-3">
            {classRows.length} {classRows.length === 1 ? "class" : "classes"} · assign a
            class teacher and build the timetable.
          </p>
        </div>
        <CreateClassForm />
      </div>

      {classRows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center">
          <p className="font-display text-lg text-navy">No classes yet.</p>
          <p className="mt-1 text-sm text-navy-3">
            Create your forms/classes (e.g. JHS 1A) — students, attendance and the
            timetable all hang off them.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Class</th>
                <th className="px-4 py-3 font-semibold">Level</th>
                <th className="px-4 py-3 font-semibold">Class teacher</th>
                <th className="px-4 py-3 font-semibold">Students</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {classRows.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-bg">
                  <td className="px-4 py-3 font-medium text-navy">
                    <Link href={`/classes/${c.id}`} className="hover:text-gold">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-navy-2">{c.level ?? "—"}</td>
                  <td className="px-4 py-3">
                    <ClassTeacherSelect
                      classId={c.id}
                      current={c.teacherId}
                      staff={staff}
                    />
                  </td>
                  <td className="px-4 py-3 text-navy-2">{sizeOf.get(c.id) ?? 0}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/classes/${c.id}`}
                      className="text-sm font-semibold text-gold hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
