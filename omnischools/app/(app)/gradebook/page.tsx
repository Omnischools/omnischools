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
  gradebookScores,
} from "@/db/schema";
import { GradebookSelectors } from "@/components/gradebook/selectors";
import { NewSubjectForm } from "@/components/gradebook/new-subject-form";
import { ScoreGrid } from "@/components/gradebook/score-grid";

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
          roster: [],
          scores: [] as {
            studentId: string;
            classScore: string | null;
            examScore: string | null;
          }[],
        };
      const scores = await tx
        .select({
          studentId: gradebookScores.studentId,
          classScore: gradebookScores.classScore,
          examScore: gradebookScores.examScore,
        })
        .from(gradebookScores)
        .where(
          and(
            eq(gradebookScores.schoolId, school.id),
            eq(gradebookScores.subjectId, subjectId),
            eq(gradebookScores.periodId, periodId),
            inArray(
              gradebookScores.studentId,
              roster.map((r) => r.id),
            ),
          ),
        );
      return { roster, scores };
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
      const byStudent = new Map(data.scores.map((s) => [s.studentId, s]));
      const roster = data.roster.map((r) => {
        const s = byStudent.get(r.id);
        return {
          id: r.id,
          name: `${r.lastName}, ${r.firstName}`,
          code: r.code,
          classScore: s?.classScore ?? "",
          examScore: s?.examScore ?? "",
        };
      });
      grid = (
        <ScoreGrid
          classId={classId}
          subjectId={subjectId}
          periodId={periodId}
          weights={base.weights}
          roster={roster}
        />
      );
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
