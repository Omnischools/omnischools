import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { students, attendanceRecords, academicPeriod, users } from "@/db/schema";
import { reasonLabel } from "@/lib/attendance-reasons";
import { PrintButton } from "@/components/reports/print-button";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  PRESENT: "bg-green text-white",
  LATE: "bg-warn text-white",
  EXCUSED: "bg-navy-2 text-white",
  MEDICAL: "bg-gold text-navy",
  ABSENT: "bg-terra text-white",
};
const SUMMARY: { key: string; label: string; tone: string }[] = [
  { key: "PRESENT", label: "Present", tone: "text-green" },
  { key: "LATE", label: "Late", tone: "text-warn" },
  { key: "EXCUSED", label: "Excused", tone: "text-navy-2" },
  { key: "MEDICAL", label: "Medical", tone: "text-gold" },
  { key: "ABSENT", label: "Absent", tone: "text-terra" },
];

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const fmtDay = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const fmtTime = (d: Date) =>
  d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });

type Rec = {
  date: string;
  status: string;
  reasonCode: string | null;
  note: string | null;
  markedAt: Date | string;
  markedBy: string | null;
};
type DayCell = { iso: string; dayNum: number; status: string; rec?: Rec };

/** School weekdays (Mon–Fri) from start→end, grouped into Monday-anchored weeks. */
function buildWeeks(start: string, end: string, today: string, byDate: Map<string, Rec>) {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  const t = new Date(today + "T00:00:00Z");
  const weeks: { label: string; days: DayCell[] }[] = [];
  let cur: DayCell[] = [];
  const flush = () => {
    if (!cur.length) return;
    const a = cur[0].iso;
    const b = cur[cur.length - 1].iso;
    weeks.push({ label: `${fmtDay(a)} – ${fmtDay(b)}`, days: cur });
    cur = [];
  };
  for (const d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (dow === 1) flush();
    const iso = d.toISOString().slice(0, 10);
    const rec = byDate.get(iso);
    const status = d > t ? "FUTURE" : (rec?.status ?? "NONE");
    cur.push({ iso, dayNum: d.getUTCDate(), status, rec });
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
      })
      .from(students)
      .where(and(eq(students.id, params.studentId), eq(students.schoolId, school.id)));
    if (!student) return null;
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
    const recs = await tx
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
          term ? gte(attendanceRecords.date, term.startsOn) : undefined,
          term ? lte(attendanceRecords.date, term.endsOn) : undefined,
        ),
      )
      .orderBy(asc(attendanceRecords.date));
    return { student, term, recs };
  });

  if (!data) notFound();
  const { student, term, recs } = data;

  const byDate = new Map(recs.map((r) => [r.date, r as Rec]));
  const counts: Record<string, number> = {};
  for (const r of recs) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const total = recs.length;
  const attended = (counts.PRESENT ?? 0) + (counts.LATE ?? 0);
  const termPct = total > 0 ? Math.round((attended / total) * 100) : null;
  const lastAttended =
    [...recs].reverse().find((r) => r.status === "PRESENT" || r.status === "LATE")?.date ??
    null;
  // trailing run of absent days at the most recent end of the record
  let consecutiveAbsent = 0;
  for (let i = recs.length - 1; i >= 0; i--) {
    if (recs[i].status === "ABSENT") consecutiveAbsent++;
    else break;
  }
  const weeks =
    term && total >= 0 ? buildWeeks(term.startsOn, term.endsOn, today, byDate) : [];

  const pctTone =
    termPct === null
      ? "text-navy-3"
      : termPct >= 90
        ? "text-green"
        : termPct >= 70
          ? "text-navy"
          : "text-terra";

  return (
    <div className="mx-auto max-w-page">
      <Link
        href={`/students/${student.id}`}
        className="text-sm text-navy-3 hover:text-gold print:hidden"
      >
        ← {student.firstName} {student.lastName}
      </Link>
      <div className="mb-6 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-navy">
            {student.lastName}, {student.firstName}
          </h1>
          <p className="text-sm text-navy-3">
            <span className="font-mono text-xs">{student.code}</span>
            {student.classLabel ? ` · ${student.classLabel}` : ""}
            {term ? ` · ${term.label}` : ""}
          </p>
        </div>
        <PrintButton />
      </div>

      {/* At a glance */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className={`font-display text-3xl font-semibold ${pctTone}`}>
            {termPct === null ? "—" : `${termPct}%`}
          </div>
          <div className="mt-1 text-sm text-navy-3">Term attendance</div>
          <div className="mt-0.5 text-[11px] text-navy-3">
            {total > 0 ? `${attended} of ${total} days` : "no records yet"}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div
            className={`font-display text-3xl font-semibold ${consecutiveAbsent > 0 ? "text-terra" : "text-navy"}`}
          >
            {consecutiveAbsent}
          </div>
          <div className="mt-1 text-sm text-navy-3">Consecutive absent</div>
          <div className="mt-0.5 text-[11px] text-navy-3">
            {consecutiveAbsent > 0 ? "needs follow-up" : "none"}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="font-display text-xl font-semibold text-navy">
            {lastAttended ? fmtDay(lastAttended) : "—"}
          </div>
          <div className="mt-1 text-sm text-navy-3">Last attended</div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="font-display text-3xl font-semibold text-navy">
            {counts.ABSENT ?? 0}
          </div>
          <div className="mt-1 text-sm text-navy-3">Absences this term</div>
          <div className="mt-0.5 text-[11px] text-navy-3">
            {(counts.EXCUSED ?? 0) + (counts.MEDICAL ?? 0)} excused
          </div>
        </div>
      </div>

      {/* Term register */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-navy">Term register</h2>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-navy-3">
          {SUMMARY.map((s) => (
            <span key={s.key} className="flex items-center gap-1">
              <b className={s.tone}>{counts[s.key] ?? 0}</b> {s.label}
            </span>
          ))}
          <span>
            <b className="text-navy">{total}</b> total
          </span>
        </div>
      </div>

      {!term ? (
        <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
          No active term — set term dates in Settings to see the register grid.
        </p>
      ) : weeks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
          No school days in this term yet.
        </p>
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
                  const marked = d.status in STATUS_TONE;
                  const title = d.rec
                    ? `${fmtDay(d.iso)} · ${cap(d.status)}${
                        reasonLabel(d.rec.reasonCode)
                          ? ` · ${reasonLabel(d.rec.reasonCode)}`
                          : ""
                      }${d.rec.note ? ` · ${d.rec.note}` : ""}${
                        d.rec.markedBy
                          ? ` · marked ${fmtTime(d.rec.markedAt instanceof Date ? d.rec.markedAt : new Date(d.rec.markedAt))} by ${d.rec.markedBy}`
                          : ""
                      }`
                    : `${fmtDay(d.iso)} · ${d.status === "FUTURE" ? "upcoming" : "not marked"}`;
                  return (
                    <span
                      key={d.iso}
                      title={title}
                      className={`flex h-9 w-9 items-center justify-center rounded-md text-xs font-semibold ${
                        marked
                          ? STATUS_TONE[d.status]
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
    </div>
  );
}
