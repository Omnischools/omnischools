import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireSchoolRole } from "@/lib/auth/server";
import { SENIOR_LEDGER_ROLES } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import {
  classes,
  subjects,
  students,
  academicPeriod,
  seniorLedgerPath,
  seniorScoreLedger,
  assessmentWeights,
} from "@/db/schema";
import {
  resolveWeights,
  type CategoryScores,
  type CategoryWeights,
} from "@/lib/score-ledger/compute";
import { ScanWorkspace, type RosterEntry } from "@/components/senior/scan-workspace";

export const dynamic = "force-dynamic";

const numOrNull = (v: string | null) => (v == null ? null : Number(v));

export default async function ScanPage({
  searchParams,
}: {
  searchParams: { classId?: string; subjectId?: string; periodId?: string };
}) {
  const { school } = await requireSchoolRole(SENIOR_LEDGER_ROLES);
  if (school.schoolType === "BASIC") redirect("/gradebook");

  const { classId, subjectId, periodId } = searchParams;
  const backHref = "/senior/score-ledger";
  const ctxHref =
    classId && subjectId && periodId
      ? `${backHref}?classId=${classId}&subjectId=${subjectId}&periodId=${periodId}`
      : backHref;

  if (!classId || !subjectId || !periodId) {
    return (
      <div className="mx-auto max-w-page">
        <BackLink href={backHref} />
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center text-sm text-navy-3">
          Choose a class, subject and semester on the score ledger first.
        </div>
      </div>
    );
  }

  const data = await withSchool(school.id, async (tx) => {
    const [cls] = await tx
      .select({ name: classes.name })
      .from(classes)
      .where(and(eq(classes.schoolId, school.id), eq(classes.id, classId)));
    const [sub] = await tx
      .select({ name: subjects.name })
      .from(subjects)
      .where(and(eq(subjects.schoolId, school.id), eq(subjects.id, subjectId)));
    const [period] = await tx
      .select({ label: academicPeriod.periodLabel, closedAt: academicPeriod.closedAt })
      .from(academicPeriod)
      .where(and(eq(academicPeriod.schoolId, school.id), eq(academicPeriod.periodId, periodId)));
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
    const weightRows = await tx
      .select()
      .from(assessmentWeights)
      .where(eq(assessmentWeights.schoolId, school.id));
    const ids = roster.map((r) => r.id);
    const ledger = ids.length
      ? await tx
          .select()
          .from(seniorScoreLedger)
          .where(
            and(
              eq(seniorScoreLedger.schoolId, school.id),
              eq(seniorScoreLedger.subjectId, subjectId),
              eq(seniorScoreLedger.periodId, periodId),
              inArray(seniorScoreLedger.studentId, ids),
            ),
          )
      : [];
    return {
      cls,
      sub,
      period,
      path: pathRow?.path ?? "AUTO_COMPILE",
      roster,
      weightRows,
      ledger,
    };
  });

  const subjectName = data.sub?.name ?? "this subject";
  const className = data.cls?.name ?? "this class";
  const termLabel = data.period?.label ?? "this semester";
  const isClosed = !!data.period?.closedAt;

  if (data.path !== "SCAN_EXTRACT") {
    return (
      <div className="mx-auto max-w-page">
        <BackLink href={ctxHref} />
        <Head className={className} subject={subjectName} />
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center text-sm text-navy-3">
          This class isn&apos;t on the scan path. Choose{" "}
          <span className="font-semibold text-navy">Scan my paper ledger (Path B)</span> on the score
          ledger to photograph and verify a paper page.
        </div>
      </div>
    );
  }

  const toW = (r: (typeof data.weightRows)[number]): CategoryWeights => ({
    asgn: r.asgnWeight,
    midSem: r.midSemWeight,
    endSem: r.endSemWeight,
    project: r.projectWeight,
    portfolio: r.portfolioWeight,
  });
  const subjectWeightRow = data.weightRows.find((r) => r.subjectId === subjectId);
  const defaultWeightRow = data.weightRows.find((r) => r.subjectId === null);
  const weights = resolveWeights(
    subjectWeightRow ? toW(subjectWeightRow) : null,
    defaultWeightRow ? toW(defaultWeightRow) : null,
  );

  const roster: RosterEntry[] = data.roster.map((r) => ({
    id: r.id,
    name: `${r.firstName} ${r.lastName}`,
    code: r.code,
  }));
  const committed: Record<string, CategoryScores> = {};
  for (const l of data.ledger) {
    committed[l.studentId] = {
      asgn: numOrNull(l.asgnScore),
      midSem: numOrNull(l.midSemScore),
      endSem: numOrNull(l.endSemScore),
      project: numOrNull(l.projectScore),
      portfolio: numOrNull(l.portfolioScore),
    };
  }

  return (
    <div className="mx-auto max-w-page">
      <BackLink href={ctxHref} />
      <Head className={className} subject={subjectName} term={termLabel} />

      {/* Verify-first contract (spec §4.2) + transient-image note — non-negotiable. */}
      <div className="mb-5 grid grid-cols-[auto_1fr] gap-3 rounded-xl border border-gold-soft bg-gold-bg px-[22px] py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold font-display text-lg italic text-navy">
          i
        </span>
        <p className="text-[12.5px] leading-relaxed text-navy-2">
          <strong className="text-navy">We save you the typing; you confirm the read.</strong>{" "}
          Omnischools reads your ledger photo and fills in what it can. Cells it is unsure of are{" "}
          <span className="rounded bg-warn-bg px-1 font-semibold text-warn">shaded and marked ?</span>{" "}
          — check those first. The photo stays in your browser, is read once, and is discarded when you
          commit — it is never saved.
        </p>
      </div>

      {isClosed && (
        <div className="mb-5 rounded-xl border border-terra bg-terra-bg px-4 py-3 text-sm text-terra">
          {termLabel} is closed — its scores are final. Reopen the semester in Settings → Academic to
          scan a new page.
        </div>
      )}

      {roster.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center text-sm text-navy-3">
          No students in this class yet.
        </div>
      ) : (
        <ScanWorkspace
          classId={classId}
          subjectId={subjectId}
          periodId={periodId}
          roster={roster}
          committed={committed}
          weights={weights}
          isClosed={isClosed}
          ledgerHref={ctxHref}
        />
      )}
    </div>
  );
}

function BackLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="mb-4 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-gold"
    >
      ← Back to score ledger
    </Link>
  );
}

function Head({
  className,
  subject,
  term,
}: {
  className: string;
  subject: string;
  term?: string;
}) {
  return (
    <div className="mb-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
        Senior · {subject} · {className}
        {term ? ` · ${term}` : ""} · Scan &amp; extract
      </div>
      <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
        End-of-semester upload · <em className="italic text-gold">verify the read.</em>
      </h1>
      <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
    </div>
  );
}
