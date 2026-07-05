import { redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  classes,
  subjects,
  students,
  academicPeriod,
  seniorAssessments,
  seniorAssessmentScores,
  seniorScoreLedger,
  seniorLedgerPath,
  assessmentWeights,
} from "@/db/schema";
import { GradebookSelectors } from "@/components/gradebook/selectors";
import { PathChooser, type CapturePath } from "@/components/senior/path-chooser";
import {
  SeniorAssessmentGrid,
  type AssessmentCategory,
} from "@/components/senior/senior-assessment-grid";
import { SeniorLedgerGrid, type LedgerRow } from "@/components/senior/senior-ledger-grid";
import { resolveWeights, type CategoryWeights } from "@/lib/score-ledger/compute";

export const dynamic = "force-dynamic";

const numOrNull = (v: string | null) => (v == null ? null : Number(v));

export default async function ScoreLedgerPage({
  searchParams,
}: {
  searchParams: { classId?: string; subjectId?: string; periodId?: string };
}) {
  const { school } = await requireSchool();
  // Senior-only surface — a Basic (KG · Primary · JHS) school has no score ledger.
  if (school.schoolType === "BASIC") redirect("/gradebook");

  const { classId, subjectId, periodId } = searchParams;

  const base = await withSchool(school.id, async (tx) => {
    const cls = await tx.select().from(classes).where(eq(classes.schoolId, school.id));
    const subs = await tx.select().from(subjects).where(eq(subjects.schoolId, school.id));
    const periods = await tx
      .select()
      .from(academicPeriod)
      .where(eq(academicPeriod.schoolId, school.id))
      .orderBy(asc(academicPeriod.periodNumber));
    const weightRows = await tx
      .select()
      .from(assessmentWeights)
      .where(eq(assessmentWeights.schoolId, school.id));
    return { cls, subs, periods, weightRows };
  });

  // Resolve the five weights for the selected subject (subject → school default → system).
  const toW = (r: (typeof base.weightRows)[number]): CategoryWeights => ({
    asgn: r.asgnWeight,
    midSem: r.midSemWeight,
    endSem: r.endSemWeight,
    project: r.projectWeight,
    portfolio: r.portfolioWeight,
  });
  const subjectWeightRow = subjectId
    ? base.weightRows.find((r) => r.subjectId === subjectId)
    : null;
  const defaultWeightRow = base.weightRows.find((r) => r.subjectId === null);
  const weights = resolveWeights(
    subjectWeightRow ? toW(subjectWeightRow) : null,
    defaultWeightRow ? toW(defaultWeightRow) : null,
  );

  const subjectName = base.subs.find((s) => s.id === subjectId)?.name ?? "Mathematics";
  const className = base.cls.find((c) => c.id === classId)?.name ?? "class";
  const period = base.periods.find((p) => p.periodId === periodId);
  const termLabel = period?.periodLabel ?? "this semester";

  let workspace: React.ReactNode = (
    <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center text-sm text-navy-3">
      Choose a class, subject and semester to open the ledger.
    </div>
  );

  let activePath: CapturePath = "AUTO_COMPILE";

  if (classId && subjectId && periodId) {
    const data = await withSchool(school.id, async (tx) => {
      const [pathRow] = await tx
        .select({ path: seniorLedgerPath.path })
        .from(seniorLedgerPath)
        .where(
          and(
            eq(seniorLedgerPath.schoolId, school.id),
            eq(seniorLedgerPath.classId, classId),
            eq(seniorLedgerPath.subjectId, subjectId),
            eq(seniorLedgerPath.periodId, periodId),
          ),
        );
      const path = (pathRow?.path ?? "AUTO_COMPILE") as CapturePath;
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
        return { path, roster, assessments: [], marks: [], ledger: [] };

      const ids = roster.map((r) => r.id);
      const assessments = await tx
        .select({
          id: seniorAssessments.id,
          category: seniorAssessments.category,
          title: seniorAssessments.title,
          maxMark: seniorAssessments.maxMark,
        })
        .from(seniorAssessments)
        .where(
          and(
            eq(seniorAssessments.schoolId, school.id),
            eq(seniorAssessments.classId, classId),
            eq(seniorAssessments.subjectId, subjectId),
            eq(seniorAssessments.periodId, periodId),
          ),
        )
        .orderBy(asc(seniorAssessments.createdAt));

      const marks = assessments.length
        ? await tx
            .select({
              assessmentId: seniorAssessmentScores.assessmentId,
              studentId: seniorAssessmentScores.studentId,
              rawMark: seniorAssessmentScores.rawMark,
            })
            .from(seniorAssessmentScores)
            .where(
              and(
                eq(seniorAssessmentScores.schoolId, school.id),
                inArray(
                  seniorAssessmentScores.assessmentId,
                  assessments.map((a) => a.id),
                ),
                inArray(seniorAssessmentScores.studentId, ids),
              ),
            )
        : [];

      const ledger = await tx
        .select()
        .from(seniorScoreLedger)
        .where(
          and(
            eq(seniorScoreLedger.schoolId, school.id),
            eq(seniorScoreLedger.subjectId, subjectId),
            eq(seniorScoreLedger.periodId, periodId),
            inArray(seniorScoreLedger.studentId, ids),
          ),
        );

      return { path, roster, assessments, marks, ledger };
    });
    activePath = data.path;

    if (data.roster.length === 0) {
      workspace = (
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center text-sm text-navy-3">
          No students in this class yet.
        </div>
      );
    } else {
      const rosterRows = data.roster.map((r) => ({
        id: r.id,
        name: `${r.lastName}, ${r.firstName}`,
        code: r.code,
      }));
      const ledgerByStudent = new Map(data.ledger.map((l) => [l.studentId, l]));
      const ledgerRows: LedgerRow[] = data.roster.map((r) => {
        const l = ledgerByStudent.get(r.id);
        return {
          id: r.id,
          name: `${r.lastName}, ${r.firstName}`,
          code: r.code,
          asgn: l ? numOrNull(l.asgnScore) : null,
          midSem: l ? numOrNull(l.midSemScore) : null,
          endSem: l ? numOrNull(l.endSemScore) : null,
          project: l ? numOrNull(l.projectScore) : null,
          portfolio: l ? numOrNull(l.portfolioScore) : null,
          status: (l?.status ?? "DRAFT") as LedgerRow["status"],
        };
      });

      // Completion summary (§3.6 / §3.7).
      const n = data.roster.length;
      const count = (k: "asgnScore" | "midSemScore" | "endSemScore" | "projectScore" | "portfolioScore") =>
        data.ledger.filter((l) => l[k] != null).length;
      const cats = [
        { label: "Assignments / class exercises", done: count("asgnScore") },
        { label: "Mid-semester examination", done: count("midSemScore") },
        { label: "End-of-semester examination", done: count("endSemScore") },
        { label: "Individual project work", done: count("projectScore") },
      ];
      const portfolioDone = count("portfolioScore");
      const complete = data.ledger.filter(
        (l) => l.status === "COMPLETE" || l.status === "STPSHS_READY",
      ).length;
      const ready = complete === n && n > 0;

      workspace = (
        <div className="space-y-6">
          <section className="rounded-[14px] border border-border bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-semibold text-navy">
                {termLabel} <em className="italic text-gold">ledger</em>
              </h2>
              <span className="text-xs text-navy-3">
                {n} of {n} students · {cats.filter((c) => c.done === n).length} of 5
                categories filled · portfolio{" "}
                {portfolioDone === n && n > 0 ? "complete" : "pending"}
              </span>
            </div>
            <SeniorLedgerGrid
              key={`${classId}-${subjectId}-${periodId}-${data.path}`}
              rows={ledgerRows}
              weights={weights}
              classId={classId}
              subjectId={subjectId}
              periodId={periodId}
              mode={data.path === "DIRECT_ENTRY" ? "direct" : "compiled"}
            />
          </section>

          {/* Progress + STPSHS-ready (§3.6 / §3.7). */}
          <div className="grid gap-3.5 md:grid-cols-2">
            <div className="rounded-[14px] border border-border bg-surface p-4">
              <h3 className="mb-3 font-display text-sm font-semibold text-navy">
                {termLabel} progress · this class-subject
              </h3>
              <ul className="space-y-2">
                {cats.map((c) => (
                  <li key={c.label} className="flex items-center justify-between gap-3">
                    <span className="text-[11.5px] text-navy-2">{c.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                        c.done === n
                          ? "bg-green-bg text-green"
                          : c.done > 0
                            ? "bg-gold-bg text-gold"
                            : "bg-bg text-navy-3"
                      }`}
                    >
                      {c.done} of {n} · {c.done === n ? "done" : "in progress"}
                    </span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3">
                  <span className="text-[11.5px] text-navy-2">Portfolio</span>
                  <span className="rounded-full bg-bg px-2 py-0.5 font-mono text-[10px] text-navy-3">
                    {portfolioDone === n && n > 0
                      ? `${portfolioDone} of ${n} · done`
                      : `${portfolioDone} of ${n} · enter at semester end`}
                  </span>
                </li>
              </ul>
            </div>

            <div
              className={`rounded-[14px] border p-4 ${
                ready ? "border-green bg-green-bg" : "border-gold bg-gold-bg"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-bold ${
                    ready ? "bg-green text-bg" : "bg-gold text-navy"
                  }`}
                >
                  {ready ? "✓" : "!"}
                </span>
                <div>
                  {ready ? (
                    <p className="text-sm text-navy-2">
                      <strong className="text-navy">
                        Ledger is complete and STPSHS-ready.
                      </strong>{" "}
                      All {n} students have all five categories filled. Generate the printable
                      STPSHS score sheet from this ledger.
                    </p>
                  ) : (
                    <p className="text-sm text-navy-2">
                      STPSHS export is <em className="italic text-gold">one step away</em>.
                      Enter the portfolio scores for the {n} students, then the printable
                      STPSHS-ready score sheet generates from this ledger.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Path A only — record assessments; the ledger above recompiles on save.
              Path C enters the five categories directly in the grid above (no events). */}
          {data.path === "AUTO_COMPILE" && (
            <section className="rounded-[14px] border border-border bg-surface p-4">
              <h2 className="mb-3 font-display text-lg font-semibold text-navy">
                Record assessments · <em className="italic text-gold">Path A</em>
              </h2>
              <SeniorAssessmentGrid
                key={`${classId}-${subjectId}-${periodId}`}
                assessments={data.assessments.map((a) => ({
                  id: a.id,
                  category: a.category as AssessmentCategory,
                  title: a.title,
                  maxMark: Number(a.maxMark),
                }))}
                roster={rosterRows}
                scores={data.marks.map((m) => ({
                  assessmentId: m.assessmentId,
                  studentId: m.studentId,
                  raw: m.rawMark ?? "",
                }))}
                classId={classId}
                subjectId={subjectId}
                periodId={periodId}
              />
            </section>
          )}
        </div>
      );
    }
  }

  const weightSummary = `${weights.asgn}/${weights.midSem}/${weights.endSem}/${weights.project}/${weights.portfolio}`;

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Omnischools Senior · Score ledger
        </div>
        <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
          {classId && subjectId ? (
            <>
              {className} · <em className="italic text-gold">{subjectName}.</em>
            </>
          ) : (
            <>
              One record, <em className="italic text-gold">five categories.</em>
            </>
          )}
        </h1>
        <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
        <p className="max-w-2xl text-sm text-navy-3">
          The SHS score ledger — assignments, mid-sem, end-of-sem, project and portfolio,
          weighted by the {school.shortName ?? school.name} configuration
          {subjectId ? ` for ${subjectName}` : ""} ({weightSummary}).
        </p>
      </div>

      <div className="mb-5">
        <PathChooser
          activePath={activePath}
          context={
            classId && subjectId && periodId
              ? { classId, subjectId, periodId }
              : null
          }
        />
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
          basePath="/senior/score-ledger"
        />
      </div>

      {workspace}
    </div>
  );
}
