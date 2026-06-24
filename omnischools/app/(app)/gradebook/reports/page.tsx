import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { classes, students, academicPeriod, reportCards } from "@/db/schema";
import { GradebookSelectors } from "@/components/gradebook/selectors";
import { GenerateReports } from "@/components/gradebook/generate-reports";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { classId?: string; periodId?: string };
}) {
  const { school } = await requireSchool();
  const { classId, periodId } = searchParams;

  const base = await withSchool(school.id, async (tx) => {
    const cls = await tx.select().from(classes).where(eq(classes.schoolId, school.id));
    const periods = await tx
      .select()
      .from(academicPeriod)
      .where(eq(academicPeriod.schoolId, school.id));
    return { cls, periods };
  });

  let body: React.ReactNode = (
    <div className="border-border-2 bg-surface rounded-xl border border-dashed p-12 text-center text-sm text-navy-3">
      Choose a class and period.
    </div>
  );

  if (classId && periodId) {
    const roster = await withSchool(school.id, (tx) =>
      tx
        .select({
          id: students.id,
          firstName: students.firstName,
          lastName: students.lastName,
          code: students.studentCode,
          overall: reportCards.overallTotal,
          grade: reportCards.overallGrade,
        })
        .from(students)
        .leftJoin(
          reportCards,
          and(eq(reportCards.studentId, students.id), eq(reportCards.periodId, periodId)),
        )
        .where(
          and(
            eq(students.schoolId, school.id),
            eq(students.classId, classId),
            eq(students.status, "ACTIVE"),
          ),
        )
        .orderBy(asc(students.lastName)),
    );

    body = (
      <div>
        <div className="bg-surface mb-5 rounded-xl border border-border p-5">
          <GenerateReports classId={classId} periodId={periodId} />
        </div>
        {roster.length === 0 ? (
          <p className="text-sm text-navy-3">No students in this class.</p>
        ) : (
          <div className="bg-surface overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-bg border-b border-border text-left text-xs uppercase tracking-wide text-navy-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">Student</th>
                  <th className="px-4 py-3 text-right font-semibold">Overall</th>
                  <th className="px-4 py-3 font-semibold">Grade</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {roster.map((r) => (
                  <tr key={r.id} className="hover:bg-bg">
                    <td className="px-4 py-3 font-medium text-navy">
                      {r.lastName}, {r.firstName}
                    </td>
                    <td className="px-4 py-3 text-right text-navy">
                      {r.overall ? Number(r.overall).toFixed(2) : "—"}
                    </td>
                    <td className="px-4 py-3 font-semibold text-navy-2">
                      {r.grade ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/gradebook/report/${r.id}?periodId=${periodId}`}
                        className="text-sm font-semibold text-gold hover:underline"
                      >
                        View report
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page">
      <BackLink href="/gradebook" label="Gradebook" />
      <h1 className="mb-1 mt-2 font-display text-3xl font-semibold text-navy">
        Report cards
      </h1>
      <p className="mb-5 text-sm text-navy-3">
        Generate term report cards for a class, then open each student&apos;s card.
      </p>
      <div className="mb-5">
        <GradebookSelectors
          classes={base.cls.map((c) => ({ id: c.id, label: c.name }))}
          subjects={[]}
          periods={base.periods.map((p) => ({
            id: p.periodId,
            label: `${p.academicYear} · ${p.periodLabel}`,
          }))}
          classId={classId}
          periodId={periodId}
          basePath="/gradebook/reports"
          showSubject={false}
        />
      </div>
      {body}
    </div>
  );
}
