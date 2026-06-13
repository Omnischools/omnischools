import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { students } from "@/db/schema";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-green-bg text-green",
  INACTIVE: "bg-bg text-navy-3",
  GRADUATED: "bg-gold-bg text-navy",
  WITHDRAWN: "bg-terra-bg text-terra",
  TRANSFERRED: "bg-warn-bg text-warn",
};

export default async function StudentsPage() {
  const { school } = await requireSchool();
  const rows = await withSchool(school.id, (tx) =>
    tx
      .select()
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
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Code</th>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Sex</th>
                <th className="px-4 py-3 font-semibold">Class</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((s) => (
                <tr key={s.id} className="transition-colors hover:bg-bg">
                  <td className="px-4 py-3 font-mono text-xs text-navy-2">
                    <Link href={`/students/${s.id}`} className="hover:text-gold">
                      {s.studentCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-navy">
                    <Link href={`/students/${s.id}`} className="hover:text-gold">
                      {s.lastName}, {s.firstName} {s.otherNames ?? ""}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-navy-2">
                    {s.sex.charAt(0) + s.sex.slice(1).toLowerCase()}
                  </td>
                  <td className="px-4 py-3 text-navy-2">{s.currentClassLabel ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-pill px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[s.status]}`}
                    >
                      {s.status.charAt(0) + s.status.slice(1).toLowerCase()}
                    </span>
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
