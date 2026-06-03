import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { classes, students, attendanceRecords, attendanceCorrections } from "@/db/schema";
import { NewClassForm, AssignStudent } from "@/components/attendance/class-controls";

export const dynamic = "force-dynamic";

export default async function AttendancePage() {
  const { school } = await requireSchool();
  const today = new Date().toISOString().slice(0, 10);

  const data = await withSchool(school.id, async (tx) => {
    const cls = await tx.select().from(classes).where(eq(classes.schoolId, school.id));
    const studs = await tx
      .select({
        id: students.id,
        classId: students.classId,
        firstName: students.firstName,
        lastName: students.lastName,
        code: students.studentCode,
      })
      .from(students)
      .where(and(eq(students.schoolId, school.id), eq(students.status, "ACTIVE")));
    const todayRecs = await tx
      .select({ classId: attendanceRecords.classId, status: attendanceRecords.status })
      .from(attendanceRecords)
      .where(
        and(eq(attendanceRecords.schoolId, school.id), eq(attendanceRecords.date, today)),
      );
    const pendingCorrections = (
      await tx
        .select({ id: attendanceCorrections.id })
        .from(attendanceCorrections)
        .where(
          and(
            eq(attendanceCorrections.schoolId, school.id),
            eq(attendanceCorrections.status, "PENDING"),
          ),
        )
    ).length;
    return { cls, studs, todayRecs, pendingCorrections };
  });

  const unassigned = data.studs.filter((s) => !s.classId);
  const classOptions = data.cls.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-navy">Attendance</h1>
          <p className="text-sm text-navy-3">Today · {today}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/attendance/corrections"
            className="border-border-2 bg-surface rounded-md border px-4 py-2.5 text-sm font-semibold text-navy hover:bg-gold-bg"
          >
            Corrections
            {data.pendingCorrections > 0 ? ` (${data.pendingCorrections})` : ""}
          </Link>
          <NewClassForm />
        </div>
      </div>

      {data.cls.length === 0 ? (
        <div className="border-border-2 bg-surface rounded-xl border border-dashed p-12 text-center">
          <p className="font-display text-lg text-navy">No classes yet.</p>
          <p className="mt-1 text-sm text-navy-3">
            Create a class to start taking attendance.
          </p>
        </div>
      ) : (
        <div className="bg-surface overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-border text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Class</th>
                <th className="px-4 py-3 text-right font-semibold">Students</th>
                <th className="px-4 py-3 text-right font-semibold">Present today</th>
                <th className="px-4 py-3 text-right font-semibold">Absent</th>
                <th className="px-4 py-3 text-right font-semibold">Rate</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.cls.map((c) => {
                const count = data.studs.filter((s) => s.classId === c.id).length;
                const recs = data.todayRecs.filter((r) => r.classId === c.id);
                const present = recs.filter(
                  (r) => r.status === "PRESENT" || r.status === "LATE",
                ).length;
                const absent = recs.filter((r) => r.status === "ABSENT").length;
                const rate = recs.length
                  ? Math.round((present / recs.length) * 100)
                  : null;
                return (
                  <tr key={c.id} className="hover:bg-bg">
                    <td className="px-4 py-3 font-medium text-navy">
                      <Link href={`/attendance/${c.id}`} className="hover:text-gold">
                        {c.name}
                      </Link>
                      {c.level && (
                        <span className="ml-2 text-xs text-navy-3">{c.level}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-navy-2">{count}</td>
                    <td className="px-4 py-3 text-right text-green">{present || "—"}</td>
                    <td className="px-4 py-3 text-right text-terra">{absent || "—"}</td>
                    <td className="px-4 py-3 text-right font-medium text-navy">
                      {rate === null ? "—" : `${rate}%`}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/attendance/${c.id}`}
                        className="text-bg rounded-md bg-navy px-3 py-1.5 text-xs font-semibold hover:bg-navy-deep"
                      >
                        Take attendance
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {unassigned.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 font-display text-xl font-semibold text-navy">
            Unassigned students ({unassigned.length})
          </h2>
          <div className="space-y-2">
            {unassigned.map((s) => (
              <div
                key={s.id}
                className="bg-surface flex items-center justify-between rounded-lg border border-border px-4 py-2.5"
              >
                <span className="text-sm text-navy">
                  {s.lastName}, {s.firstName}{" "}
                  <span className="font-mono text-xs text-navy-3">{s.code}</span>
                </span>
                {classOptions.length > 0 ? (
                  <AssignStudent studentId={s.id} classOptions={classOptions} />
                ) : (
                  <span className="text-xs text-navy-3">Create a class first</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
