import Link from "next/link";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  classes,
  students,
  attendanceRecords,
  academicPeriod,
  schoolHolidays,
} from "@/db/schema";
import { isHoliday, type HolidayRange } from "@/lib/school-calendar";
import { PrintButton } from "@/components/reports/print-button";

export const dynamic = "force-dynamic";

const CELL: Record<string, string> = {
  PRESENT: "bg-green text-white",
  LATE: "bg-warn text-white",
  EXCUSED: "bg-navy-2 text-white",
  MEDICAL: "bg-gold text-navy",
  ABSENT: "bg-terra text-white",
};
const LETTER: Record<string, string> = {
  PRESENT: "P",
  LATE: "L",
  EXCUSED: "E",
  MEDICAL: "M",
  ABSENT: "A",
};

/** Weekday (Mon–Fri) ISO dates in [start, end], excluding holidays. */
function schoolDayList(start: string, end: string, holidays: HolidayRange[]) {
  const out: string[] = [];
  if (!start || !end || start > end) return out;
  const last = new Date(`${end}T00:00:00Z`);
  for (const d = new Date(`${start}T00:00:00Z`); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    if (isHoliday(iso, holidays)) continue;
    out.push(iso);
  }
  return out;
}

export default async function TermGridPage({
  searchParams,
}: {
  searchParams: { classId?: string };
}) {
  const { school } = await requireSchool();
  const today = new Date().toISOString().slice(0, 10);

  const data = await withSchool(school.id, async (tx) => {
    const cls = await tx
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .where(and(eq(classes.schoolId, school.id), eq(classes.active, true)))
      .orderBy(asc(classes.name));
    const selectedId =
      searchParams.classId && cls.some((c) => c.id === searchParams.classId)
        ? searchParams.classId
        : (cls[0]?.id ?? null);
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
    const roster = selectedId
      ? await tx
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
              eq(students.classId, selectedId),
              eq(students.status, "ACTIVE"),
            ),
          )
          .orderBy(asc(students.lastName))
      : [];
    const recs =
      selectedId && roster.length > 0
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
                eq(attendanceRecords.classId, selectedId),
                inArray(
                  attendanceRecords.studentId,
                  roster.map((r) => r.id),
                ),
              ),
            )
        : [];
    return { cls, selectedId, term, holidays, roster, recs };
  });

  const cls = data.cls.find((c) => c.id === data.selectedId) ?? null;
  // Columns: school days from term start to today (elapsed), bounded to the last 40.
  const allDays = data.term
    ? schoolDayList(
        data.term.startsOn,
        data.term.endsOn < today ? data.term.endsOn : today,
        data.holidays,
      )
    : [];
  const days = allDays.slice(-40);
  const byKey = new Map(data.recs.map((r) => [`${r.studentId}|${r.date}`, r.status]));

  return (
    <div className="mx-auto max-w-page">
      <Link href="/attendance" className="text-sm text-navy-3 hover:text-gold print:hidden">
        ← Attendance
      </Link>
      <div className="mb-5 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-navy">
            Term <em className="not-italic text-gold [font-style:italic]">grid.</em>
          </h1>
          <p className="text-sm text-navy-3">
            {cls ? cls.name : "No class"}
            {data.term ? ` · ${data.term.label}` : ""}
            {days.length ? ` · last ${days.length} school days` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {data.cls.length > 1 && (
            <form>
              <select
                name="classId"
                defaultValue={data.selectedId ?? ""}
                className="rounded-md border border-border-2 bg-bg px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold"
              >
                {data.cls.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button className="ml-1.5 rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-sm font-semibold text-navy hover:border-gold">
                Go
              </button>
            </form>
          )}
          <PrintButton />
        </div>
      </div>

      {!cls ? (
        <p className="rounded-xl border border-dashed border-border-2 bg-surface p-10 text-center text-sm text-navy-3">
          No classes yet.
        </p>
      ) : !data.term ? (
        <p className="rounded-xl border border-dashed border-border-2 bg-surface p-10 text-center text-sm text-navy-3">
          No active term — set term dates in Settings to see the grid.
        </p>
      ) : data.roster.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-2 bg-surface p-10 text-center text-sm text-navy-3">
          No students in this class.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="text-xs">
              <thead className="border-b border-border bg-bg text-navy-3">
                <tr>
                  <th className="sticky left-0 z-10 bg-bg px-3 py-2 text-left font-semibold">
                    Student
                  </th>
                  <th className="px-2 py-2 text-right font-semibold">%</th>
                  {days.map((d) => (
                    <th key={d} className="px-1 py-2 text-center font-medium" title={d}>
                      {Number(d.slice(8, 10))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.roster.map((s) => {
                  let att = 0;
                  let tot = 0;
                  const cells = days.map((d) => {
                    const st = byKey.get(`${s.id}|${d}`);
                    if (st) {
                      tot++;
                      if (st === "PRESENT" || st === "LATE") att++;
                    }
                    return { d, st };
                  });
                  const pct = tot > 0 ? Math.round((att / tot) * 100) : null;
                  return (
                    <tr key={s.id}>
                      <td className="sticky left-0 z-10 bg-surface px-3 py-1.5 font-medium text-navy">
                        {s.lastName}, {s.firstName}
                      </td>
                      <td
                        className={`px-2 py-1.5 text-right font-semibold ${
                          pct === null
                            ? "text-navy-3"
                            : pct >= 90
                              ? "text-green"
                              : pct >= 70
                                ? "text-navy-2"
                                : "text-terra"
                        }`}
                      >
                        {pct === null ? "—" : `${pct}%`}
                      </td>
                      {cells.map(({ d, st }) => (
                        <td key={d} className="px-1 py-1.5 text-center">
                          {st ? (
                            <span
                              title={`${d} · ${st.charAt(0) + st.slice(1).toLowerCase()}`}
                              className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${CELL[st]}`}
                            >
                              {LETTER[st]}
                            </span>
                          ) : (
                            <span className="text-border-2">·</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-navy-3">
            P present · L late · E excused · M medical · A absent · · not marked. Weekends
            and holidays are omitted.
          </p>
        </>
      )}
    </div>
  );
}
