import { notFound } from "next/navigation";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  students,
  academicPeriod,
  subjects,
  gradebookScores,
  reportCards,
  gradeScale,
  attendanceRecords,
} from "@/db/schema";
import {
  averageOfTotals,
  gradeForScore,
  gradeLegend,
  type GradeBand,
} from "@/lib/gradebook/grade-scale";
import { PrintButton } from "@/components/gradebook/print-button";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";

export default async function ReportCardPage({
  params,
  searchParams,
}: {
  params: { studentId: string };
  searchParams: { periodId?: string };
}) {
  const periodId = searchParams.periodId;
  if (!periodId) notFound();
  const { school } = await requireSchool();

  const data = await withSchool(school.id, async (tx) => {
    const [student] = await tx
      .select()
      .from(students)
      .where(and(eq(students.id, params.studentId), eq(students.schoolId, school.id)));
    if (!student) return null;
    const [period] = await tx
      .select()
      .from(academicPeriod)
      .where(
        and(eq(academicPeriod.periodId, periodId), eq(academicPeriod.schoolId, school.id)),
      );
    const lines = await tx
      .select({
        subject: subjects.name,
        classScore: gradebookScores.classScore,
        examScore: gradebookScores.examScore,
        total: gradebookScores.total,
        grade: gradebookScores.grade,
      })
      .from(gradebookScores)
      .innerJoin(subjects, eq(gradebookScores.subjectId, subjects.id))
      .where(
        and(
          eq(gradebookScores.schoolId, school.id),
          eq(gradebookScores.studentId, student.id),
          eq(gradebookScores.periodId, periodId),
        ),
      )
      .orderBy(asc(subjects.name));
    const [card] = await tx
      .select()
      .from(reportCards)
      .where(
        and(
          eq(reportCards.studentId, student.id),
          eq(reportCards.periodId, periodId),
          eq(reportCards.schoolId, school.id),
        ),
      );
    const scaleRows = await tx
      .select({
        grade: gradeScale.grade,
        label: gradeScale.label,
        minScore: gradeScale.minScore,
      })
      .from(gradeScale)
      .where(eq(gradeScale.schoolId, school.id))
      .orderBy(asc(gradeScale.ordinal));

    let attendance: { present: number; absent: number; excused: number } | null = null;
    if (period?.startsOn && period?.endsOn) {
      const attRows = await tx
        .select({ status: attendanceRecords.status, n: sql<number>`count(*)::int` })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.schoolId, school.id),
            eq(attendanceRecords.studentId, student.id),
            gte(attendanceRecords.date, period.startsOn),
            lte(attendanceRecords.date, period.endsOn),
          ),
        )
        .groupBy(attendanceRecords.status);
      const by = (st: string) => attRows.find((r) => r.status === st)?.n ?? 0;
      attendance = {
        present: by("PRESENT") + by("LATE"),
        absent: by("ABSENT"),
        excused: by("EXCUSED") + by("MEDICAL"),
      };
    }

    return { student, period, lines, card, scaleRows, attendance };
  });

  if (!data || !data.student) notFound();
  const { student, period, lines, card, scaleRows, attendance } = data;

  const bands: GradeBand[] = scaleRows.map((g) => ({
    grade: g.grade,
    label: g.label,
    minScore: Number(g.minScore),
  }));
  const average = averageOfTotals(
    lines.map((l) => (l.total != null ? Number(l.total) : null)),
  );
  const overallGrade = average != null ? gradeForScore(bands, average) : null;
  const legend = gradeLegend(bands);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <BackLink href="/gradebook/reports" label="Report cards" />
        <div className="flex items-center gap-2">
          <a
            href={`/api/report-cards/${student.id}?periodId=${periodId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-navy bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
          >
            Download PDF
          </a>
          <PrintButton />
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-border p-8">
        <div className="mb-6 border-b border-border pb-4 text-center">
          <div className="font-display text-2xl font-semibold text-navy">{school.name}</div>
          <div className="mt-1 text-sm text-navy-3">
            Terminal Report ·{" "}
            {period ? `${period.academicYear} · ${period.periodLabel}` : "—"}
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-navy-3">Student: </span>
            <span className="font-medium text-navy">
              {student.firstName} {student.otherNames ?? ""} {student.lastName}
            </span>
          </div>
          <div className="text-right">
            <span className="text-navy-3">Code: </span>
            <span className="font-mono text-navy">{student.studentCode}</span>
          </div>
          <div>
            <span className="text-navy-3">Class: </span>
            <span className="text-navy">{student.currentClassLabel ?? "—"}</span>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead className="border-y border-border text-left text-xs uppercase tracking-wide text-navy-3">
            <tr>
              <th className="py-2 font-semibold">Subject</th>
              <th className="py-2 text-right font-semibold">Class</th>
              <th className="py-2 text-right font-semibold">Exam</th>
              <th className="py-2 text-right font-semibold">Total</th>
              <th className="py-2 text-right font-semibold">Grade</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-navy-3">
                  No scores entered for this period.
                </td>
              </tr>
            ) : (
              lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-2 text-navy">{l.subject}</td>
                  <td className="py-2 text-right text-navy-2">
                    {l.classScore != null ? Number(l.classScore).toFixed(0) : "—"}
                  </td>
                  <td className="py-2 text-right text-navy-2">
                    {l.examScore != null ? Number(l.examScore).toFixed(0) : "—"}
                  </td>
                  <td className="py-2 text-right font-medium text-navy">
                    {l.total != null ? Number(l.total).toFixed(2) : "—"}
                  </td>
                  <td className="py-2 text-right font-semibold text-navy">
                    {l.grade ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Attendance summary */}
        {attendance && (
          <div className="mt-6 grid grid-cols-3 gap-3">
            {[
              { label: "Present", n: attendance.present, tone: "text-green" },
              { label: "Absent", n: attendance.absent, tone: "text-terra" },
              { label: "Excused", n: attendance.excused, tone: "text-navy-2" },
            ].map((a) => (
              <div key={a.label} className="rounded-lg border border-border bg-bg p-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-navy-3">
                  {a.label}
                </div>
                <div className="mt-0.5">
                  <span className={`font-display text-2xl font-semibold ${a.tone}`}>
                    {a.n}
                  </span>
                  <span className="ml-1 text-xs text-navy-3">
                    {a.n === 1 ? "day" : "days"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Remark + term average */}
        <div className="mt-6 flex items-end justify-between border-t border-border pt-4">
          <div className="text-sm text-navy-2">
            {card?.remark && (
              <p>
                <span className="text-navy-3">Remark: </span>
                {card.remark}
              </p>
            )}
            <p className="text-xs text-navy-3">
              {card
                ? `Generated ${new Date(card.generatedAt).toLocaleDateString()}`
                : "Not yet generated"}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-navy-3">Term average</div>
            <div className="font-display text-3xl font-semibold text-navy">
              {average != null ? average.toFixed(2) : "—"}
              <span className="ml-1 align-middle text-sm text-navy-3">/ 100</span>
              {overallGrade && <span className="ml-2 text-xl text-gold">{overallGrade}</span>}
            </div>
          </div>
        </div>

        {/* Grade key */}
        {legend.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
              Grade key
            </div>
            <div className="flex flex-wrap gap-2">
              {legend.map((g) => (
                <span
                  key={g.grade}
                  className="inline-flex items-baseline gap-1.5 rounded border border-border px-2 py-1 text-xs"
                >
                  <span className="font-display font-semibold text-navy">{g.grade}</span>
                  <span className="text-navy-3">
                    {g.min}–{g.max}
                    {g.label ? ` · ${g.label}` : ""}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
