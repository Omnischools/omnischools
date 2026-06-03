import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { classes, students, attendanceRecords } from "@/db/schema";
import { TakeRegister } from "@/components/attendance/take-register";

export const dynamic = "force-dynamic";

export default async function TakeAttendancePage({
  params,
  searchParams,
}: {
  params: { classId: string };
  searchParams: { date?: string };
}) {
  const { school } = await requireSchool();
  const date =
    searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)
      ? searchParams.date
      : new Date().toISOString().slice(0, 10);

  const data = await withSchool(school.id, async (tx) => {
    const [cls] = await tx
      .select()
      .from(classes)
      .where(and(eq(classes.id, params.classId), eq(classes.schoolId, school.id)));
    if (!cls) return null;
    const roster = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        code: students.studentCode,
      })
      .from(students)
      .where(
        and(
          eq(students.schoolId, school.id),
          eq(students.classId, cls.id),
          eq(students.status, "ACTIVE"),
        ),
      )
      .orderBy(asc(students.lastName));
    const recs = await tx
      .select({
        id: attendanceRecords.id,
        studentId: attendanceRecords.studentId,
        status: attendanceRecords.status,
      })
      .from(attendanceRecords)
      .where(
        and(eq(attendanceRecords.classId, cls.id), eq(attendanceRecords.date, date)),
      );
    return { cls, roster, recs };
  });

  if (!data) notFound();
  const recByStudent = new Map(data.recs.map((r) => [r.studentId, r]));
  const roster = data.roster.map((s) => {
    const rec = recByStudent.get(s.id);
    return {
      id: s.id,
      name: `${s.lastName}, ${s.firstName}`,
      code: s.code,
      status: rec?.status ?? null,
      recordId: rec?.id ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/attendance" className="text-sm text-navy-3 hover:text-gold">
        ← Attendance
      </Link>
      <h1 className="mb-1 mt-2 font-display text-3xl font-semibold text-navy">
        {data.cls.name}
      </h1>
      <p className="mb-6 text-sm text-navy-3">
        {roster.length} student{roster.length === 1 ? "" : "s"}
      </p>

      {roster.length === 0 ? (
        <div className="border-border-2 bg-surface rounded-xl border border-dashed p-12 text-center">
          <p className="font-display text-lg text-navy">No students in this class.</p>
          <p className="mt-1 text-sm text-navy-3">
            Assign students from the{" "}
            <Link href="/attendance" className="text-gold underline">
              Attendance
            </Link>{" "}
            dashboard.
          </p>
        </div>
      ) : (
        <TakeRegister classId={data.cls.id} date={date} roster={roster} />
      )}
    </div>
  );
}
