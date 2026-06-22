import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, gte, lt, lte, sql } from "drizzle-orm";
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
import {
  RegisterSwitcher,
  type SwitcherClass,
  type SwitcherSeg,
  type EarlierReg,
} from "@/components/attendance/register-switcher";
import type { AttendanceStatus } from "@/lib/attendance-status";

export const dynamic = "force-dynamic";

const fmtLongDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

const fmtShortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const fmtTime = (d: Date) =>
  upperMeridiem(
    d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }),
  );

const STATUS_KINDS = ["PRESENT", "LATE", "EXCUSED", "MEDICAL", "ABSENT"] as const;

/** Sparkline segments + marked total from a status→count tally. */
function buildSegs(
  counts: Record<string, number>,
  studentCount: number,
): { segs: SwitcherSeg[]; marked: number } {
  const segs: SwitcherSeg[] = STATUS_KINDS.filter((k) => (counts[k] ?? 0) > 0).map((k) => ({
    kind: k,
    n: counts[k],
  }));
  const marked = STATUS_KINDS.reduce((s, k) => s + (counts[k] ?? 0), 0);
  const unmarked = Math.max(studentCount - marked, 0);
  if (unmarked > 0 || segs.length === 0)
    segs.push({ kind: "UNMARKED", n: unmarked || studentCount || 1 });
  return { segs, marked };
}

const toMs = (d: unknown) =>
  (d instanceof Date ? d : new Date(d as string)).getTime();

const upperMeridiem = (s: string) => s.replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());

const fmtCloseAt = (ms: number) =>
  upperMeridiem(
    new Date(ms).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }),
  );

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

    // Switcher rail: every active class + its register state today.
    const allClasses = await tx
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .where(and(eq(classes.schoolId, school.id), eq(classes.active, true)))
      .orderBy(asc(classes.name));
    const studentCounts = await tx
      .select({ classId: students.classId, n: sql<number>`count(*)::int` })
      .from(students)
      .where(and(eq(students.schoolId, school.id), eq(students.status, "ACTIVE")))
      .groupBy(students.classId);
    const todayRecs = await tx
      .select({
        classId: attendanceRecords.classId,
        status: attendanceRecords.status,
        markedAt: attendanceRecords.markedAt,
      })
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.schoolId, school.id), eq(attendanceRecords.date, date)));

    // The active class's earlier registers → "Earlier this week" + Copy from yesterday.
    const earlierRecs = await tx
      .select({
        date: attendanceRecords.date,
        studentId: attendanceRecords.studentId,
        status: attendanceRecords.status,
        reasonCode: attendanceRecords.reasonCode,
        note: attendanceRecords.note,
        markedAt: attendanceRecords.markedAt,
      })
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.classId, cls.id), lt(attendanceRecords.date, date)))
      .orderBy(desc(attendanceRecords.date));

    return {
      cls,
      roster,
      recs,
      termRecs,
      term,
      holidays,
      allClasses,
      studentCounts,
      todayRecs,
      earlierRecs,
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

  // ── Switcher rail: today's register state per class ──────────────────
  const countMap = new Map(data.studentCounts.map((s) => [s.classId, s.n]));
  type Today = { counts: Record<string, number>; oldest: number };
  const todayByClass = new Map<string, Today>();
  for (const r of data.todayRecs) {
    const t = todayByClass.get(r.classId) ?? { counts: {}, oldest: Infinity };
    t.counts[r.status] = (t.counts[r.status] ?? 0) + 1;
    t.oldest = Math.min(t.oldest, toMs(r.markedAt));
    todayByClass.set(r.classId, t);
  }
  const switcherClasses: SwitcherClass[] = data.allClasses.map((c) => {
    const studentCount = countMap.get(c.id) ?? 0;
    const t = todayByClass.get(c.id);
    const { segs, marked } = buildSegs(t?.counts ?? {}, studentCount);
    let state: SwitcherClass["state"];
    let metaLine: string;
    if (marked === 0) {
      state = "PENDING";
      metaLine = "Not yet marked";
    } else {
      const isLocked =
        windowH > 0 && t!.oldest !== Infinity && Date.now() - t!.oldest > windowH * 3_600_000;
      const markedAtLabel = t!.oldest !== Infinity ? fmtTime(new Date(t!.oldest)) : null;
      if (isLocked) {
        state = "LOCKED";
        metaLine = `marked ${markedAtLabel}`;
      } else if (marked < studentCount) {
        state = "PARTIAL";
        metaLine = `${marked}/${studentCount} marked`;
      } else {
        state = "DONE";
        metaLine = `marked ${markedAtLabel}`;
      }
    }
    return { id: c.id, name: c.name, studentCount, state, metaLine, segs };
  });

  // ── Earlier registers for the active class (grouped by date, newest first) ──
  const earlierByDate = new Map<
    string,
    { studentId: string; status: string; reasonCode: string | null; note: string | null; markedAt: unknown }[]
  >();
  for (const r of data.earlierRecs) {
    const arr = earlierByDate.get(r.date) ?? [];
    arr.push(r);
    earlierByDate.set(r.date, arr);
  }
  const earlierDates = Array.from(earlierByDate.keys()); // already desc from the query
  const earlier: EarlierReg[] = earlierDates.slice(0, 3).map((iso) => {
    const recs = earlierByDate.get(iso)!;
    const counts: Record<string, number> = {};
    let oldest = Infinity;
    for (const r of recs) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
      oldest = Math.min(oldest, toMs(r.markedAt));
    }
    const { segs } = buildSegs(counts, roster.length);
    return {
      iso,
      dateLabel: fmtShortDate(iso),
      markedAtLabel: oldest !== Infinity ? fmtTime(new Date(oldest)) : null,
      segs,
    };
  });

  const yesterday = earlierDates.length
    ? {
        date: fmtLongDate(earlierDates[0]),
        entries: Object.fromEntries(
          earlierByDate.get(earlierDates[0])!.map((r) => [
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
    <div className="flex gap-6">
      <RegisterSwitcher
        dateLabel={fmtShortDate(date)}
        classes={switcherClasses}
        earlier={earlier}
        activeId={data.cls.id}
      />
      <div className="min-w-0 flex-1">
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
    </div>
  );
}
