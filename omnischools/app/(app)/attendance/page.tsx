import Link from "next/link";
import { and, eq, asc, gte, lte, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  classes,
  students,
  attendanceRecords,
  attendanceCorrections,
  academicPeriod,
  attendanceSettings,
  users,
} from "@/db/schema";
import { NewClassForm, AssignStudent } from "@/components/attendance/class-controls";
import { computeAttendanceFlags } from "@/lib/attendance-flags";
import { ATTENDANCE_SETTINGS_DEFAULTS } from "@/lib/attendance-settings";

export const dynamic = "force-dynamic";

const fmtTime = (d: Date) =>
  d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });

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
      .select({ startsOn: academicPeriod.startsOn, endsOn: academicPeriod.endsOn })
      .from(academicPeriod)
      .where(
        and(
          eq(academicPeriod.schoolId, school.id),
          lte(academicPeriod.startsOn, today),
          gte(academicPeriod.endsOn, today),
        ),
      )
      .limit(1);
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
    return { cls, studs, todayRecs, yAgg, pendingCorrections, termRecs, cfg };
  });

  const unassigned = data.studs.filter((s) => !s.classId);
  const classOptions = data.cls.map((c) => ({ id: c.id, name: c.name }));

  // Threshold-based "needs attention" list over the current term (configurable).
  const flagMap = computeAttendanceFlags(data.termRecs, {
    absWatch: data.cfg?.absWatchDays ?? ATTENDANCE_SETTINGS_DEFAULTS.absWatchDays,
    absCritical: data.cfg?.absCriticalDays ?? ATTENDANCE_SETTINGS_DEFAULTS.absCriticalDays,
    pctWatch: data.cfg?.pctWatch ?? ATTENDANCE_SETTINGS_DEFAULTS.pctWatch,
    pctCritical: data.cfg?.pctCritical ?? ATTENDANCE_SETTINGS_DEFAULTS.pctCritical,
  });
  const classNameById = new Map(data.cls.map((c) => [c.id, c.name]));
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

          {/* Students needing attention */}
          {needsAttention.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 font-display text-lg font-semibold text-navy">
                Students needing attention{" "}
                <span className="text-sm font-normal text-navy-3">
                  ({needsAttention.length})
                </span>
              </h2>
              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Student</th>
                      <th className="px-4 py-3 font-semibold">Flag</th>
                      <th className="px-4 py-3 text-right font-semibold">Term</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {needsAttention.map((s) => (
                      <tr key={s.id} className="hover:bg-bg">
                        <td className="px-4 py-3">
                          <div className="font-medium text-navy">{s.name}</div>
                          <div className="font-mono text-xs text-navy-3">
                            {s.code}
                            {s.className ? ` · ${s.className}` : ""}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {s.flags.map((f) => (
                              <span
                                key={f.type}
                                title={f.detail}
                                className={`rounded-pill px-2 py-0.5 text-xs font-medium ${
                                  f.severity === "CRITICAL"
                                    ? "bg-terra-bg text-terra"
                                    : "bg-warn-bg text-warn"
                                }`}
                              >
                                {f.label}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={`text-sm font-semibold ${
                              s.termPct === null
                                ? "text-navy-3"
                                : s.termPct < 60
                                  ? "text-terra"
                                  : s.termPct < 70
                                    ? "text-warn"
                                    : "text-navy-2"
                            }`}
                          >
                            {s.termPct === null ? "—" : `${s.termPct}%`}
                          </span>
                          <span className="ml-1 text-[11px] text-navy-3">
                            {s.attended}/{s.total}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/students/${s.id}`}
                            className="text-xs font-semibold text-gold hover:underline"
                          >
                            View →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
