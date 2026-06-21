import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, gte, lte, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  classes,
  students,
  attendanceRecords,
  academicPeriod,
  attendanceSettings,
} from "@/db/schema";
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
        reasonCode: attendanceRecords.reasonCode,
        note: attendanceRecords.note,
        markedAt: attendanceRecords.markedAt,
      })
      .from(attendanceRecords)
      .where(
        and(eq(attendanceRecords.classId, cls.id), eq(attendanceRecords.date, date)),
      );
    const [cfg] = await tx
      .select({ editWindowHours: attendanceSettings.editWindowHours })
      .from(attendanceSettings)
      .where(eq(attendanceSettings.schoolId, school.id))
      .limit(1);

    // Per-student term attendance %, scoped to the current term when one is active.
    const ids = roster.map((s) => s.id);
    const [term] = await tx
      .select({ startsOn: academicPeriod.startsOn, endsOn: academicPeriod.endsOn })
      .from(academicPeriod)
      .where(
        and(
          eq(academicPeriod.schoolId, school.id),
          lte(academicPeriod.startsOn, date),
          gte(academicPeriod.endsOn, date),
        ),
      )
      .limit(1);
    const termAgg =
      ids.length === 0
        ? []
        : await tx
            .select({
              studentId: attendanceRecords.studentId,
              attended: sql<number>`sum(case when ${attendanceRecords.status} in ('PRESENT','LATE') then 1 else 0 end)::int`,
              total: sql<number>`count(*)::int`,
            })
            .from(attendanceRecords)
            .where(
              and(
                eq(attendanceRecords.schoolId, school.id),
                inArray(attendanceRecords.studentId, ids),
                term ? gte(attendanceRecords.date, term.startsOn) : undefined,
                term ? lte(attendanceRecords.date, term.endsOn) : undefined,
              ),
            )
            .groupBy(attendanceRecords.studentId);
    return { cls, roster, recs, termAgg, editWindowHours: cfg?.editWindowHours ?? 24 };
  });

  if (!data) notFound();
  // The register locks once its earliest mark is older than the edit window.
  const windowH = data.editWindowHours;
  const oldestMark = data.recs.reduce<number>((min, r) => {
    const t = (
      r.markedAt instanceof Date ? r.markedAt : new Date(r.markedAt as string)
    ).getTime();
    return t < min ? t : min;
  }, Infinity);
  const locked =
    data.recs.length > 0 &&
    windowH > 0 &&
    Date.now() - oldestMark > windowH * 3_600_000;
  const recByStudent = new Map(data.recs.map((r) => [r.studentId, r]));
  const aggByStudent = new Map(data.termAgg.map((a) => [a.studentId, a]));
  const roster = data.roster.map((s) => {
    const rec = recByStudent.get(s.id);
    const agg = aggByStudent.get(s.id);
    const termPct =
      agg && agg.total > 0 ? Math.round((agg.attended / agg.total) * 100) : null;
    return {
      id: s.id,
      name: `${s.lastName}, ${s.firstName}`,
      code: s.code,
      status: rec?.status ?? null,
      recordId: rec?.id ?? null,
      reasonCode: rec?.reasonCode ?? null,
      note: rec?.note ?? null,
      termPct,
      termDays: agg ? `${agg.attended}/${agg.total}` : null,
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
        <TakeRegister
          classId={data.cls.id}
          date={date}
          roster={roster}
          locked={locked}
        />
      )}
    </div>
  );
}
