import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, gte, lt, lte } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  classes,
  students,
  attendanceRecords,
  academicPeriod,
  attendanceSettings,
  schoolHolidays,
  users,
} from "@/db/schema";
import { computeAttendanceFlags } from "@/lib/attendance-flags";
import { termDayProgress } from "@/lib/school-calendar";
import { TakeRegister, type RegisterRow } from "@/components/attendance/take-register";
import type { AttendanceStatus } from "@/lib/attendance-status";

export const dynamic = "force-dynamic";

const fmtLongDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

const fmtCloseAt = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

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
      .select({
        id: classes.id,
        name: classes.name,
        teacher: users.fullName,
      })
      .from(classes)
      .leftJoin(users, eq(classes.classTeacherUserId, users.id))
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
      .orderBy(asc(students.firstName), asc(students.lastName));

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

    const [term] = await tx
      .select({
        label: academicPeriod.periodLabel,
        startsOn: academicPeriod.startsOn,
        endsOn: academicPeriod.endsOn,
      })
      .from(academicPeriod)
      .where(
        and(
          eq(academicPeriod.schoolId, school.id),
          lte(academicPeriod.startsOn, date),
          gte(academicPeriod.endsOn, date),
        ),
      )
      .limit(1);

    const holidays = await tx
      .select({
        name: schoolHolidays.name,
        startsOn: schoolHolidays.startsOn,
        endsOn: schoolHolidays.endsOn,
        kind: schoolHolidays.kind,
      })
      .from(schoolHolidays)
      .where(eq(schoolHolidays.schoolId, school.id));

    // Whole-term records for this class's roster → term %, flags, patterns.
    const ids = roster.map((s) => s.id);
    const termRecs =
      term && ids.length
        ? await tx
            .select({
              studentId: attendanceRecords.studentId,
              date: attendanceRecords.date,
              status: attendanceRecords.status,
            })
            .from(attendanceRecords)
            .where(
              and(
                eq(attendanceRecords.schoolId, school.id),
                inArray(attendanceRecords.studentId, ids),
                gte(attendanceRecords.date, term.startsOn),
                lte(attendanceRecords.date, term.endsOn),
              ),
            )
        : [];

    // The most recent earlier register for this class → "Copy from yesterday".
    const [prev] = await tx
      .select({ date: attendanceRecords.date })
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.classId, cls.id), lt(attendanceRecords.date, date)))
      .orderBy(desc(attendanceRecords.date))
      .limit(1);
    const prevRecs = prev
      ? await tx
          .select({
            studentId: attendanceRecords.studentId,
            status: attendanceRecords.status,
            reasonCode: attendanceRecords.reasonCode,
            note: attendanceRecords.note,
          })
          .from(attendanceRecords)
          .where(
            and(eq(attendanceRecords.classId, cls.id), eq(attendanceRecords.date, prev.date)),
          )
      : [];

    return {
      cls,
      roster,
      recs,
      termRecs,
      term,
      holidays,
      prev: prev ? { date: prev.date, recs: prevRecs } : null,
      editWindowHours: cfg?.editWindowHours ?? 24,
    };
  });

  if (!data) notFound();

  const windowH = data.editWindowHours;
  const oldestMark = data.recs.reduce<number>((min, r) => {
    const t = (
      r.markedAt instanceof Date ? r.markedAt : new Date(r.markedAt as string)
    ).getTime();
    return t < min ? t : min;
  }, Infinity);
  const locked =
    data.recs.length > 0 && windowH > 0 && Date.now() - oldestMark > windowH * 3_600_000;
  const windowCloseLabel =
    data.recs.length > 0 && windowH > 0 ? fmtCloseAt(oldestMark + windowH * 3_600_000) : null;

  const flags = computeAttendanceFlags(data.termRecs);
  const recByStudent = new Map(data.recs.map((r) => [r.studentId, r]));

  const roster: RegisterRow[] = data.roster.map((s) => {
    const rec = recByStudent.get(s.id);
    const f = flags.get(s.id);
    const tags = (f?.flags ?? [])
      .filter((fl) => fl.type === "BELOW_THRESHOLD" || fl.type === "PATTERN_SHIFT")
      .map((fl) => ({
        label: fl.label,
        tone: (fl.type === "BELOW_THRESHOLD" ? "terra" : "warn") as "terra" | "warn",
      }));
    return {
      id: s.id,
      first: s.firstName,
      last: s.lastName,
      initials: `${s.firstName[0] ?? ""}${s.lastName[0] ?? ""}`.toUpperCase(),
      code: s.code,
      status: (rec?.status as AttendanceStatus | undefined) ?? null,
      recordId: rec?.id ?? null,
      reasonCode: rec?.reasonCode ?? null,
      note: rec?.note ?? null,
      termPct: f?.termPct ?? null,
      termDays: f ? `${f.attended}/${f.total} days` : null,
      consecutiveAbsent: f?.consecutiveAbsent ?? 0,
      tags,
    };
  });

  const progress = data.term
    ? termDayProgress(data.term.startsOn, data.term.endsOn, date, data.holidays)
    : null;

  const yesterday = data.prev
    ? {
        date: fmtLongDate(data.prev.date),
        entries: Object.fromEntries(
          data.prev.recs.map((r) => [
            r.studentId,
            {
              status: r.status as AttendanceStatus,
              reasonCode: r.reasonCode,
              note: r.note,
            },
          ]),
        ),
      }
    : null;

  if (roster.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link href="/attendance" className="text-sm text-navy-3 hover:text-gold">
          ← Attendance
        </Link>
        <h1 className="mb-1 mt-2 font-display text-3xl font-semibold text-navy">
          {data.cls.name}
        </h1>
        <p className="mb-6 text-sm text-navy-3">0 students</p>
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center">
          <p className="font-display text-lg text-navy">No students in this class.</p>
          <p className="mt-1 text-sm text-navy-3">
            Assign students from the{" "}
            <Link href="/attendance" className="text-gold underline">
              Attendance
            </Link>{" "}
            dashboard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <TakeRegister
        classId={data.cls.id}
        date={date}
        roster={roster}
        locked={locked}
        className={data.cls.name}
        dateLabel={fmtLongDate(date)}
        teacher={data.cls.teacher ?? null}
        termLabel={data.term?.label ?? null}
        dayOf={progress?.dayOf ?? null}
        editWindowHours={windowH}
        windowCloseLabel={windowCloseLabel}
        yesterday={yesterday}
      />
    </div>
  );
}
