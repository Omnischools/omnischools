import Link from "next/link";
import { and, eq, asc, desc, gte, lte, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  classes,
  students,
  attendanceRecords,
  attendanceCorrections,
  academicPeriod,
  attendanceSettings,
  schoolHolidays,
  users,
} from "@/db/schema";
import { NewClassForm, AssignStudent } from "@/components/attendance/class-controls";
import { CorrectionActions } from "@/components/attendance/correction-actions";
import { computeAttendanceFlags, FLAG_THRESHOLDS } from "@/lib/attendance-flags";
import { NeedsAttention } from "@/components/attendance/needs-attention";
import { TermTrend } from "@/components/attendance/term-trend";
import { ExportCsv } from "@/components/reports/export-csv";
import { termDayProgress } from "@/lib/school-calendar";
import { schoolFile } from "@/lib/filename";

export const dynamic = "force-dynamic";

const fmtTime = (d: Date) =>
  d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });
const fmtShort = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const STATUS_PILL: Record<string, string> = {
  PRESENT: "bg-green-bg text-green",
  LATE: "bg-warn-bg text-warn",
  EXCUSED: "bg-bg text-navy-2",
  MEDICAL: "bg-gold-bg text-navy",
  ABSENT: "bg-terra-bg text-terra",
};
const capWord = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// today's segments, in display order
const SEG: { key: string; label: string; tone: string }[] = [
  { key: "PRESENT", label: "Present", tone: "bg-green" },
  { key: "LATE", label: "Late", tone: "bg-warn" },
  { key: "EXCUSED", label: "Excused", tone: "bg-navy-2" },
  { key: "MEDICAL", label: "Medical", tone: "bg-gold" },
  { key: "ABSENT", label: "Absent", tone: "bg-terra" },
];

export default async function AttendancePage() {
  const { school } = await requireSchool();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  const data = await withSchool(school.id, async (tx) => {
    const cls = await tx
      .select({
        id: classes.id,
        name: classes.name,
        level: classes.level,
        teacher: users.fullName,
      })
      .from(classes)
      .leftJoin(users, eq(classes.classTeacherUserId, users.id))
      .where(eq(classes.schoolId, school.id))
      .orderBy(asc(classes.name));
    const studs = await tx
      .select({
        id: students.id,
        classId: students.classId,
        firstName: students.firstName,
        lastName: students.lastName,
        code: students.studentCode,
        sex: students.sex,
      })
      .from(students)
      .where(and(eq(students.schoolId, school.id), eq(students.status, "ACTIVE")));
    const todayRecs = await tx
      .select({
        classId: attendanceRecords.classId,
        status: attendanceRecords.status,
        markedAt: attendanceRecords.markedAt,
      })
      .from(attendanceRecords)
      .where(
        and(eq(attendanceRecords.schoolId, school.id), eq(attendanceRecords.date, today)),
      );
    const [yAgg] = await tx
      .select({
        attended: sql<number>`sum(case when ${attendanceRecords.status} in ('PRESENT','LATE') then 1 else 0 end)::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.schoolId, school.id),
          eq(attendanceRecords.date, yesterday),
        ),
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
    // Current term's records, to compute who needs attention.
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
          lte(academicPeriod.startsOn, today),
          gte(academicPeriod.endsOn, today),
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
    const termRecs = term
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
              gte(attendanceRecords.date, term.startsOn),
              lte(attendanceRecords.date, term.endsOn),
            ),
          )
      : [];
    const [cfg] = await tx
      .select({
        absWatchDays: attendanceSettings.absWatchDays,
        absCriticalDays: attendanceSettings.absCriticalDays,
        pctWatch: attendanceSettings.pctWatch,
        pctCritical: attendanceSettings.pctCritical,
      })
      .from(attendanceSettings)
      .where(eq(attendanceSettings.schoolId, school.id))
      .limit(1);
    // Previous term's average, for the trend headline's "vs previous term".
    let prevAvg: number | null = null;
    if (term) {
      const [prev] = await tx
        .select({ startsOn: academicPeriod.startsOn, endsOn: academicPeriod.endsOn })
        .from(academicPeriod)
        .where(
          and(
            eq(academicPeriod.schoolId, school.id),
            lte(academicPeriod.endsOn, term.startsOn),
          ),
        )
        .orderBy(desc(academicPeriod.endsOn))
        .limit(1);
      if (prev) {
        const [agg] = await tx
          .select({
            attended: sql<number>`sum(case when ${attendanceRecords.status} in ('PRESENT','LATE') then 1 else 0 end)::int`,
            total: sql<number>`count(*)::int`,
          })
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.schoolId, school.id),
              gte(attendanceRecords.date, prev.startsOn),
              lte(attendanceRecords.date, prev.endsOn),
            ),
          );
        prevAvg = agg && agg.total > 0 ? Math.round((agg.attended / agg.total) * 100) : null;
      }
    }
    // §05 — pending register edit requests awaiting the head's co-sign.
    const editRequests = await tx
      .select({
        id: attendanceCorrections.id,
        requestedStatus: attendanceCorrections.requestedStatus,
        reason: attendanceCorrections.reason,
        date: attendanceRecords.date,
        currentStatus: attendanceRecords.status,
        firstName: students.firstName,
        lastName: students.lastName,
        requestedBy: users.fullName,
      })
      .from(attendanceCorrections)
      .innerJoin(
        attendanceRecords,
        eq(attendanceCorrections.attendanceRecordId, attendanceRecords.id),
      )
      .innerJoin(students, eq(attendanceRecords.studentId, students.id))
      .leftJoin(users, eq(attendanceCorrections.requestedByUserId, users.id))
      .where(
        and(
          eq(attendanceCorrections.schoolId, school.id),
          eq(attendanceCorrections.status, "PENDING"),
        ),
      )
      .orderBy(desc(attendanceCorrections.createdAt))
      .limit(6);
    return {
      cls,
      studs,
      todayRecs,
      yAgg,
      pendingCorrections,
      termRecs,
      cfg,
      term,
      holidays,
      prevAvg,
      editRequests,
    };
  });

  const unassigned = data.studs.filter((s) => !s.classId);
  const classOptions = data.cls.map((c) => ({ id: c.id, name: c.name }));

  const fullDate = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const progress = data.term
    ? termDayProgress(data.term.startsOn, data.term.endsOn, today, data.holidays)
    : null;

  // §03 trend — daily attendance % over the term: school / by-gender / by-class.
  type Bucket = { att: number; tot: number };
  const bump = (m: Map<string, Bucket>, k: string, present: boolean) => {
    const b = m.get(k) ?? { att: 0, tot: 0 };
    b.tot++;
    if (present) b.att++;
    m.set(k, b);
  };
  const trendMeta = new Map(data.studs.map((s) => [s.id, s]));
  const dayAll = new Map<string, Bucket>();
  const dayMale = new Map<string, Bucket>();
  const dayFemale = new Map<string, Bucket>();
  const dayByClass = new Map<string, Map<string, Bucket>>();
  for (const r of data.termRecs) {
    const present = r.status === "PRESENT" || r.status === "LATE";
    bump(dayAll, r.date, present);
    const m = trendMeta.get(r.studentId);
    if (m?.sex === "MALE") bump(dayMale, r.date, present);
    else if (m?.sex === "FEMALE") bump(dayFemale, r.date, present);
    if (m?.classId) {
      const cm = dayByClass.get(m.classId) ?? new Map<string, Bucket>();
      bump(cm, r.date, present);
      dayByClass.set(m.classId, cm);
    }
  }
  const toPoints = (m: Map<string, Bucket>) =>
    Array.from(m.entries())
      .filter(([, b]) => b.tot > 0)
      .map(([date, b]) => ({ date, pct: Math.round((b.att / b.tot) * 100) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  const schoolPts = toPoints(dayAll);
  const trend =
    data.term && schoolPts.length > 0
      ? {
          school: schoolPts,
          male: toPoints(dayMale),
          female: toPoints(dayFemale),
          byClass: data.cls
            .map((c) => ({ name: c.name, points: toPoints(dayByClass.get(c.id) ?? new Map()) }))
            .filter((c) => c.points.length > 0),
          holidays: data.holidays,
          termStart: data.term.startsOn,
          termEnd: data.term.endsOn,
          today,
        }
      : null;
  const termAvg =
    data.termRecs.length > 0
      ? Math.round(
          (data.termRecs.filter((r) => r.status === "PRESENT" || r.status === "LATE")
            .length /
            data.termRecs.length) *
            100,
        )
      : null;
  const trendDelta =
    termAvg !== null && data.prevAvg !== null ? termAvg - data.prevAvg : null;
  const dowOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
  const avgOf = (pts: { pct: number }[]) =>
    pts.length ? Math.round(pts.reduce((s, p) => s + p.pct, 0) / pts.length) : null;
  const bestDay = schoolPts.reduce<{ date: string; pct: number } | null>(
    (m, p) => (!m || p.pct > m.pct ? p : m),
    null,
  );
  const lowestDay = schoolPts.reduce<{ date: string; pct: number } | null>(
    (m, p) => (!m || p.pct < m.pct ? p : m),
    null,
  );
  const monAvg = avgOf(schoolPts.filter((p) => dowOf(p.date) === 1));
  const friAvg = avgOf(schoolPts.filter((p) => dowOf(p.date) === 5));

  // Threshold-based "needs attention" list over the current term (configurable).
  const flagMap = computeAttendanceFlags(data.termRecs, {
    ...FLAG_THRESHOLDS,
    absWatch: data.cfg?.absWatchDays ?? FLAG_THRESHOLDS.absWatch,
    absCritical: data.cfg?.absCriticalDays ?? FLAG_THRESHOLDS.absCritical,
    pctWatch: data.cfg?.pctWatch ?? FLAG_THRESHOLDS.pctWatch,
    pctCritical: data.cfg?.pctCritical ?? FLAG_THRESHOLDS.pctCritical,
  });
  const classNameById = new Map(data.cls.map((c) => [c.id, c.name]));

  // Per-student term summary, for the "Export term report" CSV.
  const summaryByStudent = new Map<string, Record<string, number>>();
  for (const r of data.termRecs) {
    const m = summaryByStudent.get(r.studentId) ?? {};
    m[r.status] = (m[r.status] ?? 0) + 1;
    summaryByStudent.set(r.studentId, m);
  }
  const reportRows = data.studs.map((s) => {
    const m = summaryByStudent.get(s.id) ?? {};
    const present = m.PRESENT ?? 0;
    const late = m.LATE ?? 0;
    const excused = (m.EXCUSED ?? 0) + (m.MEDICAL ?? 0);
    const absent = m.ABSENT ?? 0;
    const total = present + late + excused + absent;
    const pct = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
    return [
      s.code,
      `${s.lastName}, ${s.firstName}`,
      s.classId ? (classNameById.get(s.classId) ?? "") : "",
      String(present),
      String(late),
      String(excused),
      String(absent),
      String(total),
      String(pct),
    ];
  });

  // Last-14-school-days status series per student, for the attention sparkline.
  const last14ByStudent = new Map<string, { date: string; status: string }[]>();
  for (const r of data.termRecs) {
    const arr = last14ByStudent.get(r.studentId) ?? [];
    arr.push({ date: r.date, status: r.status });
    last14ByStudent.set(r.studentId, arr);
  }
  for (const [id, arr] of Array.from(last14ByStudent)) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
    last14ByStudent.set(id, arr.slice(-14));
  }
  const sevRank = (w: string | null) =>
    w === "CRITICAL" ? 0 : w === "WATCHING" ? 1 : 2;
  const needsAttention = data.studs
    .map((s) => ({ s, f: flagMap.get(s.id) }))
    .filter((x) => x.f && x.f.flags.length > 0)
    .map((x) => ({
      id: x.s.id,
      name: `${x.s.lastName}, ${x.s.firstName}`,
      code: x.s.code,
      className: x.s.classId ? (classNameById.get(x.s.classId) ?? null) : null,
      last14: last14ByStudent.get(x.s.id) ?? [],
      ...x.f!,
    }))
    .sort(
      (a, b) =>
        sevRank(a.worst) - sevRank(b.worst) || (a.termPct ?? 100) - (b.termPct ?? 100),
    )
    .slice(0, 50);

  // Per-class roll-up of today.
  type ClassView = {
    id: string;
    name: string;
    level: string | null;
    teacher: string | null;
    count: number;
    counts: Record<string, number>;
    total: number;
    markedAt: Date | null;
    marked: boolean;
  };
  const classViews: ClassView[] = data.cls.map((c) => {
    const recs = data.todayRecs.filter((r) => r.classId === c.id);
    const counts: Record<string, number> = {};
    let latest: Date | null = null;
    for (const r of recs) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
      const at = r.markedAt instanceof Date ? r.markedAt : new Date(r.markedAt as string);
      if (!latest || at > latest) latest = at;
    }
    return {
      id: c.id,
      name: c.name,
      level: c.level,
      teacher: c.teacher,
      count: data.studs.filter((s) => s.classId === c.id).length,
      counts,
      total: recs.length,
      markedAt: latest,
      marked: recs.length > 0,
    };
  });

  // School-wide pulse (over students marked so far today).
  const totalMarked = data.todayRecs.length;
  const presentish = data.todayRecs.filter(
    (r) => r.status === "PRESENT" || r.status === "LATE",
  ).length;
  const schoolRate = totalMarked > 0 ? Math.round((presentish / totalMarked) * 100) : null;
  const tally = (st: string) => data.todayRecs.filter((r) => r.status === st).length;
  const registersMarked = classViews.filter((c) => c.marked).length;
  const yRate =
    data.yAgg && data.yAgg.total > 0
      ? Math.round((data.yAgg.attended / data.yAgg.total) * 100)
      : null;
  const delta = schoolRate !== null && yRate !== null ? schoolRate - yRate : null;

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
            Attendance
          </div>
          <h1 className="font-display text-3xl font-semibold text-navy">
            Attendance{" "}
            <em className="not-italic text-gold [font-style:italic]">· today.</em>
          </h1>
          <p className="mt-1 text-sm text-navy-3">
            {fullDate}
            {data.term ? ` · ${data.term.label}` : ""}
            {progress && progress.total > 0
              ? ` · Day ${progress.dayOf} of ${progress.total}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/attendance/term-grid"
            className="border-border-2 bg-surface rounded-md border px-3.5 py-2.5 text-sm font-semibold text-navy hover:border-gold"
          >
            View term grid
          </Link>
          <ExportCsv
            filename={schoolFile(school.name, "term-attendance.csv")}
            headers={[
              "Code",
              "Student",
              "Class",
              "Present",
              "Late",
              "Excused",
              "Absent",
              "Marked days",
              "Rate %",
            ]}
            rows={reportRows}
            label="Export term report"
          />
          <Link
            href="/attendance/corrections"
            className="border-border-2 bg-surface rounded-md border px-3.5 py-2.5 text-sm font-semibold text-navy hover:bg-gold-bg"
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
        <>
          {/* Today's pulse */}
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-navy bg-navy p-5 text-bg">
              <div className="font-display text-4xl font-semibold">
                {schoolRate === null ? "—" : `${schoolRate}%`}
              </div>
              <div className="mt-1 text-sm text-gold-soft">School attendance · today</div>
              <div className="mt-0.5 text-[11px] text-bg/60">
                {presentish} of {totalMarked} marked present
              </div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="font-display text-4xl font-semibold text-navy">
                {registersMarked}
                <span className="text-xl text-navy-3">/{data.cls.length}</span>
              </div>
              <div className="mt-1 text-sm text-navy-3">Registers marked</div>
              <div className="mt-0.5 text-[11px] text-navy-3">
                {data.cls.length - registersMarked} pending
              </div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="font-display text-4xl font-semibold text-navy">
                {tally("ABSENT")}
              </div>
              <div className="mt-1 text-sm text-navy-3">Absent today</div>
              <div className="mt-0.5 text-[11px] text-navy-3">
                {tally("LATE")} late · {tally("EXCUSED") + tally("MEDICAL")} excused
              </div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-5">
              <div
                className={`font-display text-4xl font-semibold ${
                  delta === null ? "text-navy-3" : delta >= 0 ? "text-green" : "text-terra"
                }`}
              >
                {delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta}%`}
              </div>
              <div className="mt-1 text-sm text-navy-3">vs yesterday</div>
              <div className="mt-0.5 text-[11px] text-navy-3">
                {yRate === null ? "no data" : `yesterday ${yRate}%`}
              </div>
            </div>
          </div>

          {/* By class */}
          <h2 className="mb-3 font-display text-lg font-semibold text-navy">By class</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classViews.map((c) => (
              <Link
                key={c.id}
                href={`/attendance/${c.id}`}
                className={`rounded-xl border bg-surface p-4 transition-colors hover:border-gold-soft ${
                  c.marked ? "border-border" : "border-terra/40 bg-terra-bg/30"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-display text-base font-semibold text-navy">
                      {c.name}
                      {c.level && (
                        <span className="ml-1.5 text-xs font-normal text-navy-3">
                          {c.level}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-navy-3">
                      {c.count} student{c.count === 1 ? "" : "s"}
                      {c.teacher ? ` · ${c.teacher}` : " · no class teacher"}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-medium ${
                      c.marked ? "bg-green-bg text-green" : "bg-terra-bg text-terra"
                    }`}
                  >
                    {c.marked ? "Done" : "Pending"}
                  </span>
                </div>

                {c.marked ? (
                  <>
                    <div className="mt-3 flex h-2.5 overflow-hidden rounded-pill bg-bg">
                      {SEG.map((s) => {
                        const n = c.counts[s.key] ?? 0;
                        if (n === 0) return null;
                        return (
                          <div
                            key={s.key}
                            className={s.tone}
                            style={{ width: `${(n / c.total) * 100}%` }}
                          />
                        );
                      })}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-navy-3">
                      <span>
                        {(c.counts.PRESENT ?? 0) + (c.counts.LATE ?? 0)} present ·{" "}
                        {c.counts.ABSENT ?? 0} absent
                      </span>
                      {c.markedAt && <span>marked {fmtTime(c.markedAt)}</span>}
                    </div>
                  </>
                ) : (
                  <div className="mt-3 flex h-2.5 overflow-hidden rounded-pill bg-bg">
                    <div className="h-full w-full bg-border-2" />
                  </div>
                )}
                {!c.marked && (
                  <div className="mt-2 text-[11px] font-medium text-terra">
                    Register not yet marked — take attendance →
                  </div>
                )}
              </Link>
            ))}
          </div>

          {/* 03 · This term's trend */}
          {trend && (
            <section className="mt-8">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <h2 className="font-display text-lg font-semibold text-navy">
                  This term&apos;s trend
                </h2>
                <div className="text-sm text-navy-3">
                  <b className="text-navy">{termAvg}%</b> term average
                  {trendDelta !== null && (
                    <span
                      className={
                        trendDelta >= 0 ? "text-green" : "text-terra"
                      }
                    >
                      {" · "}
                      {trendDelta >= 0 ? "↑" : "↓"} {Math.abs(trendDelta)}% vs previous term
                    </span>
                  )}
                </div>
              </div>
              <TermTrend data={trend} />
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(
                  [
                    ["Best day", bestDay ? `${bestDay.pct}%` : "—", bestDay ? fmtShort(bestDay.date) : ""],
                    ["Lowest day", lowestDay ? `${lowestDay.pct}%` : "—", lowestDay ? fmtShort(lowestDay.date) : ""],
                    ["Mondays avg", monAvg !== null ? `${monAvg}%` : "—", ""],
                    ["Fridays avg", friAvg !== null ? `${friAvg}%` : "—", ""],
                  ] as const
                ).map(([label, val, sub]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-border bg-surface px-3 py-2"
                  >
                    <div className="text-[11px] uppercase tracking-wide text-navy-3">
                      {label}
                    </div>
                    <div className="font-display text-lg font-semibold text-navy">
                      {val}
                    </div>
                    {sub && <div className="text-[11px] text-navy-3">{sub}</div>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 04 · Students needing attention */}
          {needsAttention.length > 0 && <NeedsAttention students={needsAttention} />}

          {/* 05 · Register edit requests */}
          {data.editRequests.length > 0 && (
            <section className="mt-8">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-lg font-semibold text-navy">
                  Register edit requests{" "}
                  <span className="text-sm font-normal text-navy-3">
                    ({data.pendingCorrections})
                  </span>
                </h2>
                <Link
                  href="/attendance/corrections"
                  className="text-xs font-semibold text-gold hover:underline"
                >
                  View all →
                </Link>
              </div>
              <div className="space-y-2">
                {data.editRequests.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-navy">
                        {r.lastName}, {r.firstName}{" "}
                        <span className="text-xs text-navy-3">· {r.date}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${STATUS_PILL[r.currentStatus] ?? "bg-bg text-navy-3"}`}
                        >
                          {capWord(r.currentStatus)}
                        </span>
                        <span className="text-navy-3">→</span>
                        <span
                          className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${STATUS_PILL[r.requestedStatus] ?? "bg-bg text-navy-3"}`}
                        >
                          {capWord(r.requestedStatus)}
                        </span>
                      </div>
                      <p className="mt-1.5 border-l-2 border-gold-soft pl-2 text-xs italic text-navy-2">
                        “{r.reason}”
                      </p>
                      <div className="mt-0.5 text-[11px] text-navy-3">
                        Requested by{" "}
                        <span className="font-medium text-navy-2">
                          {r.requestedBy ?? "a teacher"}
                        </span>
                      </div>
                    </div>
                    <CorrectionActions correctionId={r.id} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
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
