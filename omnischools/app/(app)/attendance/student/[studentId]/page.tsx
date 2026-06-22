import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, lte, ne } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  students,
  studentGuardians,
  attendanceRecords,
  academicPeriod,
  schoolHolidays,
  classes,
  users,
} from "@/db/schema";
import { reasonLabel } from "@/lib/attendance-reasons";
import { computeAttendanceFlags } from "@/lib/attendance-flags";
import { isHoliday, type HolidayRange } from "@/lib/school-calendar";
import { ATTENDANCE_STATUS_META, type AttendanceStatus } from "@/lib/attendance-status";
import { PrintButton } from "@/components/reports/print-button";

export const dynamic = "force-dynamic";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const fmtDay = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const fmtDob = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const fmtTime = (d: Date | string) =>
  (d instanceof Date ? d : new Date(d))
    .toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());

const ageFrom = (dob: string, today: string) => {
  const b = new Date(dob + "T00:00:00Z");
  const t = new Date(today + "T00:00:00Z");
  let a = t.getUTCFullYear() - b.getUTCFullYear();
  if (
    t.getUTCMonth() < b.getUTCMonth() ||
    (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate())
  )
    a--;
  return a;
};

type Rec = {
  date: string;
  status: string;
  reasonCode: string | null;
  note: string | null;
  markedAt: Date | string;
  markedBy: string | null;
};
type DayCell = { iso: string; dayNum: number; status: string; rec?: Rec };

/** School weekdays (Mon–Fri) start→end, grouped into Monday-anchored weeks. */
function buildWeeks(start: string, end: string, today: string, byDate: Map<string, Rec>) {
  const e = new Date(end + "T00:00:00Z");
  const t = new Date(today + "T00:00:00Z");
  const weeks: { label: string; days: DayCell[] }[] = [];
  let cur: DayCell[] = [];
  const flush = () => {
    if (!cur.length) return;
    weeks.push({
      label: `${fmtDay(cur[0].iso)} – ${fmtDay(cur[cur.length - 1].iso)}`,
      days: cur,
    });
    cur = [];
  };
  for (const d = new Date(start + "T00:00:00Z"); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (dow === 1) flush();
    const iso = d.toISOString().slice(0, 10);
    const rec = byDate.get(iso);
    cur.push({ iso, dayNum: d.getUTCDate(), status: d > t ? "FUTURE" : (rec?.status ?? "NONE"), rec });
  }
  flush();
  return weeks;
}

export default async function StudentAttendancePage({
  params,
}: {
  params: { studentId: string };
}) {
  const { school } = await requireSchool();
  const today = new Date().toISOString().slice(0, 10);

  const data = await withSchool(school.id, async (tx) => {
    const [student] = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        code: students.studentCode,
        classLabel: students.currentClassLabel,
        classId: students.classId,
        dob: students.dateOfBirth,
        teacher: users.fullName,
        className: classes.name,
      })
      .from(students)
      .leftJoin(classes, eq(students.classId, classes.id))
      .leftJoin(users, eq(classes.classTeacherUserId, users.id))
      .where(and(eq(students.id, params.studentId), eq(students.schoolId, school.id)));
    if (!student) return null;

    const [guardian] = await tx
      .select({ name: studentGuardians.name, relationship: studentGuardians.relationship })
      .from(studentGuardians)
      .where(eq(studentGuardians.studentId, student.id))
      .orderBy(desc(studentGuardians.isPrimary))
      .limit(1);

    const [term] = await tx
      .select({
        startsOn: academicPeriod.startsOn,
        endsOn: academicPeriod.endsOn,
        label: academicPeriod.periodLabel,
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

    const [priorTerm] = term
      ? await tx
          .select({
            startsOn: academicPeriod.startsOn,
            endsOn: academicPeriod.endsOn,
            label: academicPeriod.periodLabel,
          })
          .from(academicPeriod)
          .where(
            and(eq(academicPeriod.schoolId, school.id), lte(academicPeriod.endsOn, term.startsOn)),
          )
          .orderBy(desc(academicPeriod.endsOn))
          .limit(1)
      : [];

    const recs = term
      ? await tx
          .select({
            date: attendanceRecords.date,
            status: attendanceRecords.status,
            reasonCode: attendanceRecords.reasonCode,
            note: attendanceRecords.note,
            markedAt: attendanceRecords.markedAt,
            markedBy: users.fullName,
          })
          .from(attendanceRecords)
          .leftJoin(users, eq(attendanceRecords.markedByUserId, users.id))
          .where(
            and(
              eq(attendanceRecords.schoolId, school.id),
              eq(attendanceRecords.studentId, student.id),
              gte(attendanceRecords.date, term.startsOn),
              lte(attendanceRecords.date, term.endsOn),
            ),
          )
          .orderBy(asc(attendanceRecords.date))
      : [];

    const priorRecs = priorTerm
      ? await tx
          .select({ status: attendanceRecords.status })
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.schoolId, school.id),
              eq(attendanceRecords.studentId, student.id),
              gte(attendanceRecords.date, priorTerm.startsOn),
              lte(attendanceRecords.date, priorTerm.endsOn),
            ),
          )
      : [];

    const holidays = await tx
      .select({
        name: schoolHolidays.name,
        startsOn: schoolHolidays.startsOn,
        endsOn: schoolHolidays.endsOn,
        kind: schoolHolidays.kind,
      })
      .from(schoolHolidays)
      .where(eq(schoolHolidays.schoolId, school.id));

    // Classmates' term attendance → class rank + class average.
    const classmateRecs =
      student.classId && term
        ? await tx
            .select({
              studentId: attendanceRecords.studentId,
              status: attendanceRecords.status,
            })
            .from(attendanceRecords)
            .innerJoin(students, eq(attendanceRecords.studentId, students.id))
            .where(
              and(
                eq(attendanceRecords.schoolId, school.id),
                eq(students.classId, student.classId),
                ne(attendanceRecords.studentId, student.id),
                gte(attendanceRecords.date, term.startsOn),
                lte(attendanceRecords.date, term.endsOn),
              ),
            )
        : [];

    return { student, guardian, term, priorTerm, recs, priorRecs, holidays, classmateRecs };
  });

  if (!data) notFound();
  const { student, guardian, term, priorTerm, recs, priorRecs, holidays, classmateRecs } = data;
  const hol: HolidayRange[] = holidays;

  const pctOf = (rs: { status: string }[]) => {
    if (rs.length === 0) return null;
    const att = rs.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
    return Math.round((att / rs.length) * 100);
  };

  const byDate = new Map(recs.map((r) => [r.date, r as Rec]));
  const counts: Record<string, number> = {};
  for (const r of recs) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const total = recs.length;
  const attended = (counts.PRESENT ?? 0) + (counts.LATE ?? 0);
  const termPct = pctOf(recs);
  const priorPct = pctOf(priorRecs);
  const lastAttended =
    [...recs].reverse().find((r) => r.status === "PRESENT" || r.status === "LATE")?.date ?? null;

  let consecutiveAbsent = 0;
  for (let i = recs.length - 1; i >= 0; i--) {
    if (recs[i].status === "ABSENT") consecutiveAbsent++;
    else break;
  }

  const flags = computeAttendanceFlags(
    recs.map((r) => ({ studentId: student.id, date: r.date, status: r.status })),
  ).get(student.id);
  const belowFlag = flags?.flags.find((f) => f.type === "BELOW_THRESHOLD") ?? null;
  const flagCount = flags?.flags.length ?? 0;

  // Class rank + average.
  const classAgg = new Map<string, { att: number; tot: number }>();
  for (const r of classmateRecs) {
    const a = classAgg.get(r.studentId) ?? { att: 0, tot: 0 };
    a.tot++;
    if (r.status === "PRESENT" || r.status === "LATE") a.att++;
    classAgg.set(r.studentId, a);
  }
  const classPcts = Array.from(classAgg.values())
    .filter((a) => a.tot > 0)
    .map((a) => (a.att / a.tot) * 100);
  if (termPct !== null) classPcts.push(termPct);
  classPcts.sort((a, b) => b - a);
  const classSize = classPcts.length;
  const rank =
    termPct !== null && classSize > 0 ? classPcts.findIndex((p) => p <= termPct) + 1 : null;
  const classAvg =
    classPcts.length > 0
      ? Math.round(classPcts.reduce((s, p) => s + p, 0) / classPcts.length)
      : null;

  const weeks = term ? buildWeeks(term.startsOn, term.endsOn, today, byDate) : [];

  // ── Region 03 derivations ───────────────────────────────────────────
  // (a) day-of-week absence tally (Mon–Fri)
  const dow = [1, 2, 3, 4, 5].map((d) => {
    const list = recs.filter((r) => new Date(r.date + "T00:00:00Z").getUTCDay() === d);
    const absent = list.filter((r) => r.status === "ABSENT").length;
    return { d, label: WEEKDAY[d][0], absent, total: list.length };
  });
  const dowMax = Math.max(1, ...dow.map((x) => x.total));
  const patternFlag = flags?.flags.find((f) => f.type === "PATTERN_SHIFT") ?? null;

  // (b) weekly attendance series (for the decline chart)
  const series = weeks
    .map((w) => {
      const marked = w.days.filter((d) => d.status in ATTENDANCE_STATUS_META);
      const att = marked.filter((d) => d.status === "PRESENT" || d.status === "LATE").length;
      const holidayWeek = w.days.some((d) => isHoliday(d.iso, hol));
      return {
        label: w.label,
        pct: marked.length ? Math.round((att / marked.length) * 100) : null,
        holidayWeek,
      };
    })
    .filter((s) => s.pct !== null) as { label: string; pct: number; holidayWeek: boolean }[];

  // (c) absence streaks (≥3 consecutive ABSENT)
  const streaks: { start: string; end: string; len: number; note: string; active: boolean }[] = [];
  {
    let run: Rec[] = [];
    const closeRun = (trailing: boolean) => {
      if (run.length >= 3) {
        const note =
          run.map((r) => r.note).find(Boolean) ?? reasonLabel(run[0].reasonCode) ?? "no contact from home";
        streaks.push({
          start: run[0].date,
          end: run[run.length - 1].date,
          len: run.length,
          note,
          active: trailing,
        });
      }
      run = [];
    };
    recs.forEach((r) => {
      if (r.status === "ABSENT") run.push(r as Rec);
      else closeRun(false);
    });
    closeRun(true);
    streaks.reverse();
  }

  const hero = belowFlag ? "terra" : null;

  return (
    <div className="mx-auto max-w-page">
      {/* ── Profile head ───────────────────────────────────────── */}
      <div className="text-xs text-navy-3 print:hidden">
        <Link href="/students" className="text-gold hover:underline">
          Students
        </Link>{" "}
        / {student.className ?? "—"} / {student.firstName} {student.lastName}
      </div>
      <div className="mb-6 mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full bg-gold-bg font-display text-2xl font-semibold text-navy">
            {(student.firstName[0] ?? "") + (student.lastName[0] ?? "")}
          </span>
          <div>
            <h1 className="font-display text-3xl font-semibold text-navy">
              {student.firstName} <em className="not-italic text-gold">{student.lastName}</em>
            </h1>
            <p className="mt-0.5 text-sm text-navy-3">
              {student.className ?? student.classLabel ?? "—"}
              {student.teacher ? (
                <>
                  {" · "}class teacher{" "}
                  <b className="font-semibold text-navy-2">{student.teacher}</b>
                </>
              ) : null}
              {term ? ` · ${term.label}` : ""}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Chip glyph="ID">
                <b className="font-semibold text-navy-2">{student.code}</b>
              </Chip>
              {guardian && (
                <Chip glyph="G">
                  Guardian <b className="font-semibold text-navy-2">{guardian.name}</b>
                </Chip>
              )}
              {student.dob && (
                <Chip glyph="◷">
                  {fmtDob(student.dob)} · age {ageFrom(student.dob, today)}
                </Chip>
              )}
              {flagCount > 0 && (
                <Chip glyph="!" tone="terra">
                  {flagCount} active flag{flagCount === 1 ? "" : "s"}
                </Chip>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {consecutiveAbsent > 0 && (
            <Link
              href="/attendance/corrections"
              className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-bg hover:bg-navy-deep"
            >
              Open follow-up →
            </Link>
          )}
          <PrintButton label="Print attendance" />
        </div>
      </div>

      {/* ── Region 01 — At a glance ─────────────────────────────── */}
      <SectionHead num="01" title="At a glance" />
      <div
        className={`mb-8 grid grid-cols-1 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-4 ${
          hero ? "border-terra/40" : "border-border"
        }`}
      >
        <Glance
          tinted={!!hero}
          value={termPct === null ? "—" : `${termPct}%`}
          valueTone={termPct === null ? "text-navy-3" : pctToneOf(termPct)}
          hero
          label="Term attendance"
          sub={total > 0 ? `${attended} of ${total} days` : "no records yet"}
          pill={belowFlag ? belowFlag.label : null}
        />
        <Glance
          tinted={!!hero}
          value={String(consecutiveAbsent)}
          valueTone={consecutiveAbsent > 0 ? "text-terra" : "text-navy"}
          label="Currently"
          sub={
            consecutiveAbsent > 0
              ? `consecutive absent · last attended ${lastAttended ? fmtDay(lastAttended) : "—"}`
              : lastAttended
                ? `last attended ${fmtDay(lastAttended)}`
                : "no records"
          }
        />
        <Glance
          tinted={!!hero}
          value={
            priorPct === null || termPct === null
              ? "—"
              : `${termPct - priorPct >= 0 ? "+" : "−"}${Math.abs(termPct - priorPct)}%`
          }
          valueTone={
            priorPct === null || termPct === null
              ? "text-navy-3"
              : termPct - priorPct >= 0
                ? "text-green"
                : "text-terra"
          }
          label="vs last term"
          sub={priorTerm && priorPct !== null ? `${priorTerm.label} ended at ${priorPct}%` : "no prior term"}
        />
        <Glance
          tinted={!!hero}
          value={rank && classSize ? `${rank} / ${classSize}` : "—"}
          valueTone={rank && classSize && rank > classSize * 0.66 ? "text-terra" : "text-navy"}
          label="Class rank"
          sub={
            classAvg !== null
              ? `${student.className ?? "class"} average ${classAvg}%`
              : "class average —"
          }
        />
      </div>

      {/* ── Region 02 — Term register ───────────────────────────── */}
      <SectionHead num="02" title="Term register" />
      <div className="mb-2 flex flex-wrap items-center justify-end gap-3 text-[11px] text-navy-3">
        {(["PRESENT", "LATE", "EXCUSED", "MEDICAL", "ABSENT"] as AttendanceStatus[]).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <b className={ATTENDANCE_STATUS_META[k].num}>{counts[k] ?? 0}</b>{" "}
            {ATTENDANCE_STATUS_META[k].label}
          </span>
        ))}
        <span>
          <b className="text-navy">{total}</b> total
        </span>
      </div>
      {!term ? (
        <Empty>No active term — set term dates in Settings to see the register grid.</Empty>
      ) : weeks.length === 0 ? (
        <Empty>No school days in this term yet.</Empty>
      ) : (
        <div className="space-y-2">
          {weeks.map((w) => (
            <div
              key={w.label}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
            >
              <span className="w-44 shrink-0 text-xs text-navy-3">{w.label}</span>
              <div className="flex flex-wrap gap-1.5">
                {w.days.map((d) => {
                  const meta = ATTENDANCE_STATUS_META[d.status as AttendanceStatus];
                  const title = d.rec
                    ? `${fmtDay(d.iso)} · ${cap(d.status)}${
                        reasonLabel(d.rec.reasonCode) ? ` · ${reasonLabel(d.rec.reasonCode)}` : ""
                      }${d.rec.note ? ` · ${d.rec.note}` : ""}${
                        d.rec.markedBy
                          ? ` · marked ${fmtTime(d.rec.markedAt)} by ${d.rec.markedBy}`
                          : ""
                      }`
                    : `${fmtDay(d.iso)} · ${d.status === "FUTURE" ? "upcoming" : "not marked"}`;
                  return (
                    <span
                      key={d.iso}
                      title={title}
                      className={`flex h-9 w-9 items-center justify-center rounded-md text-xs font-semibold ${
                        meta
                          ? meta.seg
                          : d.status === "FUTURE"
                            ? "border border-dashed border-border-2 text-navy-3"
                            : "bg-bg text-navy-3"
                      }`}
                    >
                      {d.dayNum}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Region 03 — What the system noticed ─────────────────── */}
      {total >= 8 && (
        <div className="mt-8">
          <SectionHead
            num="03"
            title="What the system noticed"
            meta="auto-detected over the term"
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* (a) day-of-week */}
            <PatternCard
              label="Day of week"
              tinted={!!patternFlag}
              heading={
                patternFlag ? patternFlag.label.replace("Pattern · ", "Most absences on ") : "No weekday pattern"
              }
              detail={
                patternFlag
                  ? patternFlag.detail
                  : "Absences are spread fairly evenly across the week."
              }
            >
              <div className="flex items-end justify-between gap-2 pt-2">
                {dow.map((x) => {
                  const rate = x.total ? x.absent / x.total : 0;
                  const high = rate >= 0.5 && x.absent > 0;
                  return (
                    <div key={x.d} className="flex flex-1 flex-col items-center gap-1">
                      <div className="flex h-16 w-full items-end justify-center">
                        <div
                          className={`w-5 rounded-t ${high ? "bg-terra" : "bg-green"}`}
                          style={{ height: `${Math.max(6, (x.total / dowMax) * 100 * rate + (rate ? 8 : 0))}%` }}
                        />
                      </div>
                      <div className="font-mono text-[9px] text-navy-3">
                        {x.absent}/{x.total}
                      </div>
                      <div className="text-[10px] font-bold text-navy-2">{x.label}</div>
                    </div>
                  );
                })}
              </div>
            </PatternCard>

            {/* (b) term decline */}
            <PatternCard
              label="Term trend"
              tinted={series.length > 1 && series[series.length - 1].pct < series[0].pct - 20}
              heading={
                series.length > 1 && series[series.length - 1].pct < series[0].pct - 20
                  ? "Attendance is falling this term"
                  : "Attendance is holding steady"
              }
              detail={
                series.length > 1
                  ? `Week 1 was ${series[0].pct}%; the latest week is ${series[series.length - 1].pct}%.`
                  : "Not enough weeks yet to show a trend."
              }
            >
              <DeclineChart series={series} />
            </PatternCard>

            {/* (c) streaks */}
            <PatternCard
              label="Notable streaks"
              heading={
                streaks.length ? `${streaks.length} multi-day absence${streaks.length === 1 ? "" : "s"}` : "No long absences"
              }
              detail={
                streaks.length
                  ? "Each streak is 3+ consecutive school days absent."
                  : "No runs of 3+ consecutive absences this term."
              }
            >
              <div className="flex flex-col gap-2 pt-1">
                {streaks.slice(0, 3).map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <span
                      className={`shrink-0 rounded-pill px-2 py-0.5 text-[9px] font-bold uppercase ${
                        s.active ? "bg-terra-bg text-terra" : "bg-warn-bg text-warn"
                      }`}
                    >
                      {s.active ? "Active" : "Past"} · {s.len}d
                    </span>
                    <span className="text-navy-3">
                      <b className="font-semibold text-navy">
                        {fmtDay(s.start)} — {fmtDay(s.end)}
                      </b>
                      <br />
                      {s.note}
                    </span>
                  </div>
                ))}
                {streaks.length === 0 && (
                  <span className="text-[11px] text-navy-3">None this term.</span>
                )}
              </div>
            </PatternCard>
          </div>
        </div>
      )}
    </div>
  );
}

// helpers (server components / pure) ───────────────────────────────────
const pctToneOf = (p: number) =>
  p >= 90 ? "text-green" : p >= 70 ? "text-gold" : "text-terra";

function Chip({
  glyph,
  tone,
  children,
}: {
  glyph: string;
  tone?: "terra";
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill border bg-bg px-2.5 py-1 text-[11px] ${
        tone === "terra" ? "border-terra/40 text-terra" : "border-border text-navy-3"
      }`}
    >
      <span className={`font-display text-[10px] font-bold ${tone === "terra" ? "text-terra" : "text-gold"}`}>
        {glyph}
      </span>
      {children}
    </span>
  );
}

function SectionHead({ num, title, meta }: { num: string; title: string; meta?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-3">
      <span className="font-display text-xl font-semibold italic text-gold">{num}</span>
      <h2 className="font-display text-lg font-semibold text-navy">{title}</h2>
      {meta && <span className="text-[11px] uppercase tracking-wide text-navy-3">{meta}</span>}
    </div>
  );
}

function Glance({
  value,
  valueTone,
  label,
  sub,
  pill,
  hero,
  tinted,
}: {
  value: string;
  valueTone: string;
  label: string;
  sub: string;
  pill?: string | null;
  hero?: boolean;
  tinted?: boolean;
}) {
  return (
    <div className={`p-5 ${tinted ? "bg-terra-bg/40" : "bg-surface"}`}>
      <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">{label}</div>
      <div className={`mt-1 font-display font-semibold ${hero ? "text-5xl" : "text-3xl"} ${valueTone}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px] text-navy-3">{sub}</div>
      {pill && (
        <div className="mt-2 inline-block rounded-pill bg-terra px-2 py-0.5 text-[9px] font-bold uppercase text-white">
          {pill}
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
      {children}
    </p>
  );
}

function PatternCard({
  label,
  heading,
  detail,
  tinted,
  children,
}: {
  label: string;
  heading: string;
  detail: string;
  tinted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${tinted ? "border-terra/30 bg-terra-bg/30" : "border-border bg-surface"}`}
    >
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3">{label}</div>
      <h3 className="mt-1 font-display text-sm font-semibold text-navy">{heading}</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-navy-3">{detail}</p>
      {children}
    </div>
  );
}

/** Weekly-attendance decline line/area chart (static SVG). */
function DeclineChart({ series }: { series: { label: string; pct: number; holidayWeek: boolean }[] }) {
  if (series.length < 2)
    return <div className="pt-3 text-[11px] text-navy-3">Not enough weeks yet.</div>;
  const W = 240;
  const H = 60;
  const n = series.length;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (p: number) => H - (p / 100) * H;
  const pts = series.map((s, i) => `${x(i)},${y(s.pct)}`);
  const holidayIdx = series.findIndex((s) => s.holidayWeek);
  return (
    <div className="pt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        {/* reference lines at 90% and 70% */}
        <line x1="0" y1={y(90)} x2={W} y2={y(90)} stroke="var(--border-2)" strokeWidth="0.5" strokeDasharray="3 3" />
        <line x1="0" y1={y(70)} x2={W} y2={y(70)} stroke="var(--border-2)" strokeWidth="0.5" strokeDasharray="3 3" />
        {holidayIdx >= 0 && (
          <line
            x1={x(holidayIdx)}
            y1="0"
            x2={x(holidayIdx)}
            y2={H}
            stroke="var(--gold)"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
        )}
        <polyline
          points={`0,${H} ${pts.join(" ")} ${W},${H}`}
          fill="var(--terra-bg)"
          stroke="none"
          opacity="0.5"
        />
        <polyline points={pts.join(" ")} fill="none" stroke="var(--terra)" strokeWidth="1.5" />
        <circle cx={x(0)} cy={y(series[0].pct)} r="2.5" fill="var(--green)" />
        <circle cx={x(n - 1)} cy={y(series[n - 1].pct)} r="2.5" fill="var(--terra)" />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-navy-3">
        <span className="text-green">Wk 1: {series[0].pct}%</span>
        <span className="text-terra">
          Latest: {series[n - 1].pct}%
        </span>
      </div>
    </div>
  );
}
