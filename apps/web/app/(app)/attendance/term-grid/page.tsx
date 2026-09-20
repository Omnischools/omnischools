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
  users,
} from "@/db/schema";
import { isHoliday, schoolDaysInRange, type HolidayRange } from "@/lib/school-calendar";
import { PrintButton } from "@/components/reports/print-button";
import { ATTENDANCE_STATUS_META, type AttendanceStatus } from "@/lib/attendance-status";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

const WINDOW = 21; // calendar days shown at once (≈ 3 weeks)
const DOW_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const HATCH =
  "repeating-linear-gradient(45deg,#FAF7F2,#FAF7F2 3px,#D4CCBA 3px,#D4CCBA 4px)";

const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
};
const dowOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const dayNum = (iso: string) => Number(iso.slice(8, 10));
const monthShort = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short" });
const longDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const pctClass = (p: number | null) =>
  p === null ? "text-navy-3" : p >= 90 ? "text-green" : p >= 70 ? "text-gold" : "text-terra";

const BREAKDOWN: { k: AttendanceStatus; letter: string; tone: string }[] = [
  { k: "PRESENT", letter: "P", tone: "text-green" },
  { k: "LATE", letter: "L", tone: "text-gold" },
  { k: "EXCUSED", letter: "E", tone: "text-warn" },
  { k: "MEDICAL", letter: "M", tone: "text-navy-2" },
  { k: "ABSENT", letter: "A", tone: "text-terra" },
];

export default async function TermGridPage(
  props: {
    searchParams: Promise<{ classId?: string; end?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const { school } = await requireSchool();
  const today = new Date().toISOString().slice(0, 10);

  const data = await withSchool(school.id, async (tx) => {
    const cls = await tx
      .select({ id: classes.id, name: classes.name, teacher: users.fullName })
      .from(classes)
      .leftJoin(users, eq(classes.classTeacherUserId, users.id))
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
          })
          .from(students)
          .where(
            and(
              eq(students.schoolId, school.id),
              eq(students.classId, selectedId),
              eq(students.status, "ACTIVE"),
            ),
          )
          .orderBy(asc(students.firstName), asc(students.lastName))
      : [];
    const recs =
      selectedId && roster.length > 0 && term
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
                gte(attendanceRecords.date, term.startsOn),
                lte(attendanceRecords.date, term.endsOn),
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
  const holidays: HolidayRange[] = data.holidays;
  const term = data.term;

  // ── Visible window (clamped to the term) ────────────────────────────
  const reqEnd =
    searchParams.end && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.end)
      ? searchParams.end
      : today;
  let end = term ? (reqEnd < term.endsOn ? reqEnd : term.endsOn) : reqEnd;
  if (term && end < term.startsOn) end = term.startsOn;
  let start = addDays(end, -(WINDOW - 1));
  if (term && start < term.startsOn) {
    start = term.startsOn;
    end = addDays(start, WINDOW - 1);
    if (term && end > term.endsOn) end = term.endsOn;
  }
  const columns: string[] = [];
  if (term) for (let d = start; d <= end; d = addDays(d, 1)) columns.push(d);

  const hasPrev = !!term && start > term.startsOn;
  const hasNext = !!term && end < term.endsOn;
  const prevHref = `/attendance/term-grid?classId=${data.selectedId}&end=${addDays(start, -1)}`;
  const nextHref = `/attendance/term-grid?classId=${data.selectedId}&end=${addDays(end, WINDOW)}`;
  const monthLabel = term
    ? monthShort(start) === monthShort(end)
      ? `${monthShort(start)} ${end.slice(0, 4)}`
      : `${monthShort(start)} – ${monthShort(end)} ${end.slice(0, 4)}`
    : "";

  const kindOf = (iso: string): "weekend" | "holiday" | "future" | "school" => {
    const w = dowOf(iso);
    if (w === 0 || w === 6) return "weekend";
    if (isHoliday(iso, holidays)) return "holiday";
    if (iso > today) return "future";
    return "school";
  };

  // ── Per-student term aggregates ─────────────────────────────────────
  const byKey = new Map(data.recs.map((r) => [`${r.studentId}|${r.date}`, r.status]));
  type Agg = { counts: Record<string, number>; attended: number; marked: number };
  const aggOf = (id: string): Agg => {
    const counts: Record<string, number> = {};
    let attended = 0;
    let marked = 0;
    for (const r of data.recs) {
      if (r.studentId !== id) continue;
      counts[r.status] = (counts[r.status] ?? 0) + 1;
      marked++;
      if (r.status === "PRESENT" || r.status === "LATE") attended++;
    }
    return { counts, attended, marked };
  };
  const rows = data.roster.map((s) => {
    const agg = aggOf(s.id);
    const pct = agg.marked > 0 ? Math.round((agg.attended / agg.marked) * 100) : null;
    return { s, agg, pct };
  });

  const termMarkedDays = term
    ? new Set(data.recs.map((r) => r.date)).size
    : 0;
  const termTotalDays = term
    ? schoolDaysInRange(term.startsOn, term.endsOn, holidays)
    : 0;
  const totalAttended = rows.reduce((a, r) => a + r.agg.attended, 0);
  const totalMarked = rows.reduce((a, r) => a + r.agg.marked, 0);
  const termAvg = totalMarked > 0 ? (totalAttended / totalMarked) * 100 : null;

  return (
    <div className="mx-auto max-w-page">
      {/* ── Head ─────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-navy-3 print:hidden">
            <Link href="/attendance" className="text-gold hover:underline">
              Attendance
            </Link>{" "}
            / {cls?.name ?? "—"} / Term grid
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
            {cls ? <ClassTitle name={cls.name} /> : "Term grid"}
            {term ? <> · {term.label} register</> : ""}
          </h1>
          {cls && term && (
            <p className="mt-1 text-sm text-navy-3">
              {data.roster.length} student{data.roster.length === 1 ? "" : "s"}
              {cls.teacher ? (
                <>
                  {" · "}class teacher{" "}
                  <b className="font-semibold text-navy-2">{cls.teacher}</b>
                </>
              ) : null}
              {" · "}
              <b className="font-semibold text-navy-2">{termMarkedDays}</b> school days marked
              of <b className="font-semibold text-navy-2">{termTotalDays} in term</b>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {data.cls.length > 1 && (
            <form>
              <input type="hidden" name="end" value={end} />
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
          <PrintButton label="Export PDF" />
          {cls && (
            <Link
              href={`/attendance/${cls.id}`}
              className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-bg hover:bg-navy-deep"
            >
              Today&apos;s register →
            </Link>
          )}
        </div>
      </div>

      {!cls ? (
        <EmptyState tone="muted" className="p-10">No classes yet.</EmptyState>
      ) : !term ? (
        <EmptyState tone="muted" className="p-10">No active term — set term dates in Settings to see the grid.</EmptyState>
      ) : data.roster.length === 0 ? (
        <EmptyState tone="muted" className="p-10">No students in this class.</EmptyState>
      ) : (
        <>
          {/* ── Controls: month nav + legend ─────────────────── */}
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-border bg-surface px-4 py-3 print:hidden">
            <div className="flex items-center gap-3">
              <NavBtn href={prevHref} disabled={!hasPrev}>
                ‹
              </NavBtn>
              <span className="min-w-[140px] text-center font-display text-base font-semibold text-navy">
                {monthLabel.split(" ").slice(0, -1).join(" ")}{" "}
                <em className="not-italic text-gold">{end.slice(0, 4)}</em>
              </span>
              <NavBtn href={nextHref} disabled={!hasNext}>
                ›
              </NavBtn>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-navy-3">
              <Legend swatch="bg-green border-green">Present</Legend>
              <Legend swatch="bg-gold border-gold">Late</Legend>
              <Legend swatch="bg-warn border-warn">Excused</Legend>
              <Legend swatch="bg-navy-2 border-navy-2">Medical</Legend>
              <Legend swatch="bg-terra border-terra">Absent</Legend>
              <Legend swatchStyle={{ backgroundImage: HATCH }}>Holiday</Legend>
              <Legend swatch="bg-bg border-border-2">Weekend</Legend>
              <Legend swatch="bg-surface border-dashed border-border-2">Future</Legend>
            </div>
          </div>

          {/* ── Grid ─────────────────────────────────────────── */}
          <div className="overflow-auto rounded-[10px] border border-border bg-surface">
            <table className="border-separate border-spacing-0">
              <thead>
                <tr>
                  <th
                    rowSpan={2}
                    style={{ borderRight: "1.5px solid var(--navy-3)" }}
                    className="sticky left-0 z-30 w-[220px] min-w-[220px] border-b border-border bg-bg px-4 text-left text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3"
                  >
                    Student · {data.roster.length} in roster
                  </th>
                  {columns.map((d) => {
                    const k = kindOf(d);
                    const isToday = d === today;
                    return (
                      <th
                        key={d}
                        className={cellHeadCls(
                          "h-[18px] border-b-0 px-0 pt-0.5 text-[9px] font-bold uppercase tracking-[0.06em]",
                          k,
                          isToday,
                        )}
                      >
                        {DOW_LETTER[dowOf(d)]}
                      </th>
                    );
                  })}
                  <th
                    rowSpan={2}
                    style={{ borderLeft: "1.5px solid var(--navy-3)" }}
                    className="sticky right-0 z-30 w-[100px] min-w-[100px] border-b border-border bg-bg px-3 text-[9px] font-bold uppercase tracking-[0.14em] text-navy-3"
                  >
                    Summary
                  </th>
                </tr>
                <tr>
                  {columns.map((d) => {
                    const k = kindOf(d);
                    const isToday = d === today;
                    return (
                      <th
                        key={d}
                        className={cellHeadCls(
                          "h-[18px] w-[30px] border-b border-border px-0 font-mono text-[11px] font-semibold",
                          k,
                          isToday,
                        )}
                      >
                        {dayNum(d)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ s, agg, pct }) => (
                  <tr key={s.id} className="group">
                    <td
                      style={{ borderRight: "1.5px solid var(--navy-3)" }}
                      className="sticky left-0 z-10 flex w-[220px] items-center gap-2.5 border-b border-border bg-surface px-4 py-2 group-hover:bg-bg"
                    >
                      <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-gold-bg font-display text-[10px] font-semibold text-navy">
                        {(s.firstName[0] ?? "") + (s.lastName[0] ?? "")}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-navy">
                          {s.firstName} {s.lastName}
                        </span>
                        <span className={`block font-mono text-[10px] font-semibold ${pctClass(pct)}`}>
                          {pct === null ? "— · 0/0" : `${pct}% · ${agg.attended}/${agg.marked}`}
                        </span>
                      </span>
                    </td>
                    {columns.map((d) => {
                      const k = kindOf(d);
                      const isToday = d === today;
                      const st = byKey.get(`${s.id}|${d}`) as AttendanceStatus | undefined;
                      const base =
                        "h-[32px] w-[30px] border-b border-r border-border text-center font-display text-xs font-bold";
                      const ring = isToday ? "outline outline-2 -outline-offset-2 outline-gold" : "";
                      if (k === "weekend")
                        return <td key={d} className={`${base} bg-bg ${ring}`} />;
                      if (k === "holiday")
                        return (
                          <td key={d} className={`${base} ${ring}`} style={{ backgroundImage: HATCH }} />
                        );
                      if (k === "future")
                        return (
                          <td key={d} className={`${base} bg-surface text-border-2 ${ring}`}>
                            ·
                          </td>
                        );
                      // school day
                      if (!st)
                        return <td key={d} className={`${base} bg-surface ${ring}`} />;
                      const m = ATTENDANCE_STATUS_META[st];
                      return (
                        <td key={d} className={`${base} ${m.seg} ${ring} relative`}>
                          {m.letter}
                          <span className="pointer-events-none absolute bottom-full left-1/2 z-20 -translate-x-1/2 -translate-y-1 whitespace-nowrap rounded-md bg-navy px-2.5 py-1.5 text-[10px] font-medium text-white opacity-0 group-hover:opacity-100">
                            {longDay(d)} · {m.label}
                          </span>
                        </td>
                      );
                    })}
                    <td
                      style={{ borderLeft: "1.5px solid var(--navy-3)" }}
                      className="sticky right-0 z-10 w-[100px] border-b border-border bg-bg px-3 py-2 text-center font-mono text-[11px] font-semibold group-hover:bg-gold-bg"
                    >
                      <span className="flex justify-center gap-1.5">
                        {BREAKDOWN.filter((b) => (agg.counts[b.k] ?? 0) > 0).map((b) => (
                          <span key={b.k} className={`text-[10px] font-bold ${b.tone}`}>
                            {b.letter} {agg.counts[b.k]}
                          </span>
                        ))}
                        {agg.marked === 0 && <span className="text-navy-3">—</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="sticky left-0 z-10 border-t-[1.5px] border-navy bg-bg px-4 py-1.5 text-left font-display text-[11px] font-bold uppercase tracking-[0.06em] text-navy">
                    Class total
                  </td>
                  {columns.map((d) => {
                    const k = kindOf(d);
                    let label = "";
                    if (k === "school") {
                      const present = data.roster.filter((s) => {
                        const st = byKey.get(`${s.id}|${d}`);
                        return st && st !== "ABSENT";
                      }).length;
                      label = `${present}/${data.roster.length}`;
                    } else if (k === "future") {
                      label = "—";
                    }
                    return (
                      <td
                        key={d}
                        className="border-t-[1.5px] border-navy bg-bg px-0 py-1.5 text-center font-mono text-[10px] font-bold text-navy"
                      >
                        {label}
                      </td>
                    );
                  })}
                  <td className="sticky right-0 z-10 border-t-[1.5px] border-navy bg-navy px-3 py-1.5 text-center font-mono text-[10px] font-bold text-white">
                    {termAvg === null ? "—" : `${termAvg.toFixed(1)}% avg`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="mt-3 text-[11px] italic leading-relaxed text-navy-3">
            Showing {data.roster.length} student{data.roster.length === 1 ? "" : "s"} · scroll the
            table or use ‹ › to change the date range · weekends are tinted, holidays hatched,
            future days dashed.
          </p>
        </>
      )}
    </div>
  );
}

/** Italic-gold form suffix, e.g. JHS <em>2A</em>. */
function ClassTitle({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (parts.length > 1 && /^[A-Za-z]?\d+[A-Za-z]?$/.test(last))
    return (
      <>
        {parts.slice(0, -1).join(" ")} <em className="not-italic text-gold">{last}</em>
      </>
    );
  return <>{name}</>;
}

function NavBtn({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const cls =
    "flex h-7 w-7 items-center justify-center rounded-md border border-border bg-bg text-sm font-bold text-navy-2";
  if (disabled)
    return <span className={`${cls} cursor-default opacity-40`}>{children}</span>;
  return (
    <Link href={href} className={`${cls} hover:border-gold`}>
      {children}
    </Link>
  );
}

function Legend({
  swatch,
  swatchStyle,
  children,
}: {
  swatch?: string;
  swatchStyle?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`h-3.5 w-3.5 rounded-[3px] border ${swatch ?? "border-border"}`}
        style={swatchStyle}
      />
      {children}
    </span>
  );
}

/** Shared header-cell classes for weekend/holiday/future/today tinting. */
function cellHeadCls(
  base: string,
  kind: "weekend" | "holiday" | "future" | "school",
  isToday: boolean,
): string {
  let bg = "bg-bg text-navy";
  if (isToday) bg = "bg-gold-bg text-gold";
  else if (kind === "weekend" || kind === "holiday") bg = "bg-bg text-navy-3";
  const underline = isToday ? "border-b-2 border-gold" : "";
  return `${base} border-r border-border ${bg} ${underline}`;
}
