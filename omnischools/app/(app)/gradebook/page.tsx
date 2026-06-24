import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  classes,
  subjects,
  students,
  academicPeriod,
  gradebookConfig,
  gradebookColumns,
  gradebookColumnScores,
} from "@/db/schema";
import { GradebookSelectors } from "@/components/gradebook/selectors";
import { NewSubjectForm } from "@/components/gradebook/new-subject-form";
import { ColumnScoreGrid } from "@/components/gradebook/column-score-grid";
import { GradebookEmptyColumns } from "@/components/gradebook/empty-columns";

export const dynamic = "force-dynamic";

export default async function GradebookPage({
  searchParams,
}: {
  searchParams: { classId?: string; subjectId?: string; periodId?: string };
}) {
  const { school } = await requireSchool();
  const { classId, subjectId, periodId } = searchParams;

  const base = await withSchool(school.id, async (tx) => {
    const cls = await tx.select().from(classes).where(eq(classes.schoolId, school.id));
    const subs = await tx.select().from(subjects).where(eq(subjects.schoolId, school.id));
    const periods = await tx
      .select()
      .from(academicPeriod)
      .where(eq(academicPeriod.schoolId, school.id));
    const [cfg] = await tx
      .select()
      .from(gradebookConfig)
      .where(eq(gradebookConfig.schoolId, school.id));
    return {
      cls,
      subs,
      periods,
      weights: { cw: cfg?.classWeight ?? 50, ew: cfg?.examWeight ?? 50 },
    };
  });

  let grid: React.ReactNode = (
    <div className="border-border-2 bg-surface rounded-xl border border-dashed p-12 text-center text-sm text-navy-3">
      Choose a class, subject and period to enter scores.
    </div>
  );

  if (classId && subjectId && periodId) {
    const data = await withSchool(school.id, async (tx) => {
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
            eq(students.classId, classId),
            eq(students.status, "ACTIVE"),
          ),
        )
        .orderBy(asc(students.lastName));
      if (roster.length === 0)
        return {
          roster,
          columns: [] as {
            id: string;
            name: string;
            category: string;
            maxScore: string;
          }[],
          colScores: [] as {
            columnId: string;
            studentId: string;
            rawScore: string | null;
          }[],
        };

      const columns = await tx
        .select({
          id: gradebookColumns.id,
          name: gradebookColumns.name,
          category: gradebookColumns.category,
          maxScore: gradebookColumns.maxScore,
        })
        .from(gradebookColumns)
        .where(
          and(
            eq(gradebookColumns.schoolId, school.id),
            eq(gradebookColumns.classId, classId),
            eq(gradebookColumns.subjectId, subjectId),
            eq(gradebookColumns.periodId, periodId),
          ),
        )
        .orderBy(asc(gradebookColumns.position));

      const colScores = columns.length
        ? await tx
            .select({
              columnId: gradebookColumnScores.columnId,
              studentId: gradebookColumnScores.studentId,
              rawScore: gradebookColumnScores.rawScore,
            })
            .from(gradebookColumnScores)
            .where(
              and(
                eq(gradebookColumnScores.schoolId, school.id),
                inArray(
                  gradebookColumnScores.columnId,
                  columns.map((c) => c.id),
                ),
                inArray(
                  gradebookColumnScores.studentId,
                  roster.map((r) => r.id),
                ),
              ),
            )
        : [];

      return { roster, columns, colScores };
    });

    if (data.roster.length === 0) {
      grid = (
        <div className="border-border-2 bg-surface rounded-xl border border-dashed p-12 text-center text-sm text-navy-3">
          No students in this class. Assign students from{" "}
          <Link href="/attendance" className="text-gold underline">
            Attendance
          </Link>
          .
        </div>
      );
    } else {
      const subjectName = base.subs.find((s) => s.id === subjectId)?.name ?? "Subject";
      const className = base.cls.find((c) => c.id === classId)?.name ?? "Class";
      const period = base.periods.find((p) => p.periodId === periodId);
      const termLabel = period?.periodLabel ?? "this term";

      const rosterRows = data.roster.map((r) => ({
        id: r.id,
        name: `${r.lastName}, ${r.firstName}`,
        code: r.code,
      }));

      if (data.columns.length === 0) {
        grid = (
          <GradebookEmptyColumns
            className={className}
            subjectName={subjectName}
            termLabel={termLabel}
            students={rosterRows}
            classId={classId}
            subjectId={subjectId}
            periodId={periodId}
          />
        );
      } else {
        grid = (
          <ColumnScoreGrid
            columns={data.columns.map((c) => ({
              id: c.id,
              name: c.name,
              category: c.category === "EXAM" ? "EXAM" : "CA",
              maxScore: Number(c.maxScore),
            }))}
            roster={rosterRows}
            scores={data.colScores.map((s) => ({
              columnId: s.columnId,
              studentId: s.studentId,
              raw: s.rawScore ?? "",
            }))}
            weights={base.weights}
            classId={classId}
            subjectId={subjectId}
            periodId={periodId}
          />
        );
      }
    }
  }

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-navy">Gradebook</h1>
          <p className="text-sm text-navy-3">
            Enter class &amp; exam scores; totals are weighted.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/gradebook/reports"
            className="border-border-2 bg-surface rounded-md border px-4 py-2.5 text-sm font-semibold text-navy hover:bg-gold-bg"
          >
            Report cards
          </Link>
          <NewSubjectForm />
        </div>
      </div>

      <div className="mb-5">
        <GradebookSelectors
          classes={base.cls.map((c) => ({ id: c.id, label: c.name }))}
          subjects={base.subs.map((s) => ({ id: s.id, label: s.name }))}
          periods={base.periods.map((p) => ({
            id: p.periodId,
            label: `${p.academicYear} · ${p.periodLabel}`,
          }))}
          classId={classId}
          subjectId={subjectId}
          periodId={periodId}
        />
      </div>

      {grid}
    </div>
  );
}
