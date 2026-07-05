import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  academicPeriodConfig,
  academicPeriod,
  gradeScale,
  gradebookConfig,
} from "@/db/schema";
import { currentAcademicYearLabel } from "@/lib/onboarding";
import { TermDatesForm } from "@/components/settings/term-dates-form";
import { TermLifecycle } from "@/components/settings/term-lifecycle";
import { GradeScaleEditor } from "@/components/settings/grade-scale-editor";
import { WeightsForm } from "@/components/settings/weights-form";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Academic structure" };

/** Coerce a DB date (string 'YYYY-MM-DD[…]' or a Date) to the strict YYYY-MM-DD that
 *  <input type="date"> requires — otherwise the field renders empty and won't edit. */
function ymd(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}

export default async function AcademicSettingsPage() {
  const { school } = await requireSchool();

  const data = await withSchool(school.id, async (tx) => {
    const [cfg] = await tx
      .select()
      .from(academicPeriodConfig)
      .where(eq(academicPeriodConfig.schoolId, school.id));
    const periods = await tx
      .select()
      .from(academicPeriod)
      .where(eq(academicPeriod.schoolId, school.id))
      .orderBy(asc(academicPeriod.periodNumber));
    const grades = await tx
      .select()
      .from(gradeScale)
      .where(eq(gradeScale.schoolId, school.id))
      .orderBy(asc(gradeScale.ordinal));
    const [gb] = await tx
      .select()
      .from(gradebookConfig)
      .where(eq(gradebookConfig.schoolId, school.id));
    return { cfg, periods, grades, classWeight: gb?.classWeight ?? 50 };
  });

  return (
    <div className="mx-auto max-w-page">
      <BackLink href="/settings" label="Settings" />
      <div className="mb-6 mt-2">
        <h1 className="font-display text-3xl font-semibold text-navy">
          Academic <em className="not-italic text-gold [font-style:italic]">structure.</em>
        </h1>
        <p className="text-sm text-navy-3">
          Term dates, the grade scale and how scores are weighted — used across attendance,
          the gradebook and report cards.
        </p>
      </div>

      <div className="space-y-5">
        <TermDatesForm
          academicYear={data.cfg?.academicYear ?? currentAcademicYearLabel()}
          initial={data.periods.map((p) => ({
            periodId: p.periodId,
            label: p.periodLabel,
            startsOn: ymd(p.startsOn),
            endsOn: ymd(p.endsOn),
          }))}
        />

        <TermLifecycle
          terms={data.periods.map((p) => ({
            periodId: p.periodId,
            label: p.periodLabel,
            startsOn: ymd(p.startsOn),
            endsOn: ymd(p.endsOn),
            closed: p.closedAt != null,
            periodNumber: p.periodNumber,
          }))}
        />

        <GradeScaleEditor
          initial={data.grades.map((g) => ({
            grade: g.grade,
            label: g.label ?? "",
            minScore: Number(g.minScore),
          }))}
        />

        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="font-display text-lg font-semibold text-navy">Grading weights</h2>
          <p className="mb-4 mt-0.5 text-sm text-navy-3">
            How class (continuous assessment) and exam scores combine into the term total.
          </p>
          <WeightsForm initialClassWeight={data.classWeight} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-6">
          <div>
            <h2 className="font-display text-lg font-semibold text-navy">
              Year-end promotion
            </h2>
            <p className="mt-0.5 max-w-xl text-sm text-navy-3">
              At the end of the year, move every student up a class and graduate the exit
              year — with a preview you confirm before anything changes.
            </p>
          </div>
          <Link
            href="/settings/academic/promotion"
            className="shrink-0 rounded-md border border-navy bg-navy px-4 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
          >
            Start promotion →
          </Link>
        </div>
      </div>
    </div>
  );
}
