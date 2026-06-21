import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { students, studentGuardians } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function StudentDetailPage({ params }: { params: { id: string } }) {
  const { school } = await requireSchool();
  const data = await withSchool(school.id, async (tx) => {
    const [student] = await tx
      .select()
      .from(students)
      .where(and(eq(students.id, params.id), eq(students.schoolId, school.id)));
    if (!student) return null;
    const guardians = await tx
      .select()
      .from(studentGuardians)
      .where(eq(studentGuardians.studentId, student.id));
    return { student, guardians };
  });

  if (!data) notFound();
  const { student, guardians } = data;

  const facts: [string, string][] = [
    ["Student code", student.studentCode],
    ["Sex", student.sex.charAt(0) + student.sex.slice(1).toLowerCase()],
    ["Date of birth", student.dateOfBirth ?? "—"],
    ["Class", student.currentClassLabel ?? "—"],
    ["Status", student.status.charAt(0) + student.status.slice(1).toLowerCase()],
    ["Enrolled", student.enrolledOn ?? "—"],
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/students" className="text-sm text-navy-3 hover:text-gold">
        ← Students
      </Link>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 font-display text-3xl font-semibold text-navy">
            {student.firstName} {student.otherNames ?? ""} {student.lastName}
          </h1>
          <p className="font-mono text-xs text-navy-3">{student.studentCode}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/attendance/student/${student.id}`}
            className="rounded-md border border-border-2 px-4 py-2 text-sm font-semibold text-navy-2 transition-colors hover:bg-bg"
          >
            Attendance
          </Link>
          <Link
            href={`/students/${student.id}/edit`}
            className="rounded-md border border-border-2 px-4 py-2 text-sm font-semibold text-navy-2 transition-colors hover:bg-bg"
          >
            Edit
          </Link>
        </div>
      </div>
      <div className="mt-6" />

      <div className="rounded-xl border border-border bg-surface p-6">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between border-b border-border py-2 text-sm"
            >
              <dt className="font-semibold text-navy-3">{k}</dt>
              <dd className="text-navy">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <h2 className="mb-3 mt-8 font-display text-xl font-semibold text-navy">
        Guardians
      </h2>
      {guardians.length === 0 ? (
        <p className="text-sm text-navy-3">No guardian recorded.</p>
      ) : (
        <div className="space-y-2">
          {guardians.map((g) => (
            <div
              key={g.id}
              className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium text-navy">
                  {g.name}{" "}
                  <span className="text-navy-3">
                    · {g.relationship.charAt(0) + g.relationship.slice(1).toLowerCase()}
                  </span>
                </div>
                <div className="font-mono text-xs text-navy-3">{g.phone}</div>
              </div>
              {g.isPrimary && (
                <span className="rounded-pill bg-gold-bg px-2 py-0.5 text-xs font-medium text-navy">
                  Primary
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
