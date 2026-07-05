import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  students,
  academicPeriod,
  subjects,
  gradebookScores,
  reportCards,
} from "@/db/schema";
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
      .where(eq(academicPeriod.periodId, periodId));
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
    return { student, period, lines, card };
  });

  if (!data || !data.student) notFound();
  const { student, period, lines, card } = data;

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
          <div className="font-display text-2xl font-semibold text-navy">
            {school.name}
          </div>
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
            <div className="text-xs uppercase tracking-wide text-navy-3">Overall</div>
            <div className="font-display text-3xl font-semibold text-navy">
              {card?.overallTotal != null ? Number(card.overallTotal).toFixed(2) : "—"}
              {card?.overallGrade && (
                <span className="ml-2 text-xl text-gold">{card.overallGrade}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
