import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  schools,
  subjects,
  classes,
  students,
  academicPeriod,
  seniorScoreLedger,
  assessmentWeights,
} from "@/db/schema";
import { resolveDenominators, type CategoryDenominators } from "@/lib/score-ledger/compute";
import {
  categoryExport,
  type LedgerStatus,
  type StpshsCats,
} from "@/lib/score-ledger/stpshs-sheet";
import type { Tx } from "@/lib/db";
import type { StpshsSheetData } from "@/lib/pdf/stpshs-score-sheet-document";

/**
 * Server-only STPSHS-sheet data builder (INCR-3 · Item 8) — mirrors lib/data/receipt-data.
 * Imports the DB driver, so the client Download button must hit the route, never this module
 * (only `pnpm build` catches the leak). Tenant-scoped: every query filters school_id and runs
 * inside `withSchool` (the caller sets app.current_school). Returns pre-formatted rows so the
 * PDF component does zero data/locale/clamp work, PLUS the raw per-student status + stored
 * category values the download route's server-side gates (Q3 completeness, Q5 over-100) read.
 */

const numOrNull = (v: string | null) => (v == null ? null : Number(v));

/** "27 June 2026" — day month year, no ordinal (the component does no date work). */
const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** "Form 2 Science" → "Y2"; falls back to the class name when it carries no form digit. */
const yearLabel = (className: string) => {
  const m = className.match(/(\d)/);
  return m ? `Y${m[1]}` : className;
};

/** "Semester 2" → "S2" (Kofi Q4 — always "S", never "T"/"Term", even if the label read Term). */
const semLabel = (periodLabel: string) => {
  const m = periodLabel.match(/(\d)/);
  return m ? `S${m[1]}` : periodLabel;
};

export type StpshsGateRow = {
  studentId: string;
  name: string;
  status: LedgerStatus | null;
  /** Stored 0–100 (or bonus >100) per category, BEFORE the export cap — the gates read these. */
  cats: StpshsCats;
};

export type StpshsBuild = {
  data: StpshsSheetData;
  gateRows: StpshsGateRow[];
};

export async function buildStpshsSheetData(
  tx: Tx,
  schoolId: string,
  ctx: { classId: string; subjectId: string; periodId: string },
  now: Date = new Date(),
): Promise<StpshsBuild | null> {
  const [sc] = await tx
    .select({ name: schools.name, code: schools.gesCode })
    .from(schools)
    .where(eq(schools.id, schoolId));
  const [cls] = await tx
    .select({ name: classes.name })
    .from(classes)
    .where(and(eq(classes.schoolId, schoolId), eq(classes.id, ctx.classId)));
  const [sub] = await tx
    .select({ name: subjects.name })
    .from(subjects)
    .where(and(eq(subjects.schoolId, schoolId), eq(subjects.id, ctx.subjectId)));
  const [period] = await tx
    .select({ label: academicPeriod.periodLabel })
    .from(academicPeriod)
    .where(and(eq(academicPeriod.schoolId, schoolId), eq(academicPeriod.periodId, ctx.periodId)));
  // Any missing piece (or a cross-tenant read filtered out by RLS) → not found.
  if (!sc || !cls || !sub || !period) return null;

  // One row per ACTIVE student; stable, fully-deterministic order across regenerations (F3).
  const roster = await tx
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      ref: students.stpshsRef,
    })
    .from(students)
    .where(
      and(
        eq(students.schoolId, schoolId),
        eq(students.classId, ctx.classId),
        eq(students.status, "ACTIVE"),
      ),
    )
    .orderBy(asc(students.lastName), asc(students.firstName), asc(students.id));

  const ids = roster.map((r) => r.id);
  const ledger = ids.length
    ? await tx
        .select({
          studentId: seniorScoreLedger.studentId,
          asgn: seniorScoreLedger.asgnScore,
          midSem: seniorScoreLedger.midSemScore,
          endSem: seniorScoreLedger.endSemScore,
          project: seniorScoreLedger.projectScore,
          portfolio: seniorScoreLedger.portfolioScore,
          status: seniorScoreLedger.status,
        })
        .from(seniorScoreLedger)
        .where(
          and(
            eq(seniorScoreLedger.schoolId, schoolId),
            eq(seniorScoreLedger.subjectId, ctx.subjectId),
            eq(seniorScoreLedger.periodId, ctx.periodId),
            inArray(seniorScoreLedger.studentId, ids),
          ),
        )
    : [];
  const ledgerByStudent = new Map(ledger.map((l) => [l.studentId, l]));

  // Resolve the five denominators (subject → school default → system 100) — the denominators
  // are columns on the SAME ref_assessment_weights rows the weight resolver reads (INCR-2 Q1b).
  const weightRows = await tx
    .select()
    .from(assessmentWeights)
    .where(eq(assessmentWeights.schoolId, schoolId));
  const toD = (r: (typeof weightRows)[number]): CategoryDenominators => ({
    asgn: r.asgnDenominator,
    midSem: r.midSemDenominator,
    endSem: r.endSemDenominator,
    project: r.projectDenominator,
    portfolio: r.portfolioDenominator,
  });
  const subjectRow = weightRows.find((r) => r.subjectId === ctx.subjectId);
  const defaultRow = weightRows.find((r) => r.subjectId === null);
  const denom = resolveDenominators(
    subjectRow ? toD(subjectRow) : null,
    defaultRow ? toD(defaultRow) : null,
  );

  const gateRows: StpshsGateRow[] = [];
  const rows: StpshsSheetData["rows"] = [];
  for (const r of roster) {
    const l = ledgerByStudent.get(r.id);
    const cats: StpshsCats = {
      asgn: l ? numOrNull(l.asgn) : null,
      midSem: l ? numOrNull(l.midSem) : null,
      endSem: l ? numOrNull(l.endSem) : null,
      project: l ? numOrNull(l.project) : null,
      portfolio: l ? numOrNull(l.portfolio) : null,
    };
    const name = `${r.firstName} ${r.lastName}`;
    gateRows.push({
      studentId: r.id,
      name,
      status: (l?.status ?? null) as LedgerStatus | null,
      cats,
    });
    rows.push({
      ref: r.ref ?? "pending",
      refPending: r.ref == null,
      name,
      // Cap-to-100 then de-scale per category — the export never shows >100 (Q5 §5.4).
      asg: categoryExport(cats.asgn, denom.asgn),
      ms: categoryExport(cats.midSem, denom.midSem),
      es: categoryExport(cats.endSem, denom.endSem),
      proj: categoryExport(cats.project, denom.project),
      port: categoryExport(cats.portfolio, denom.portfolio),
    });
  }

  const data: StpshsSheetData = {
    school: { name: sc.name, code: sc.code },
    generatedDate: fmtDate(now),
    subject: sub.name,
    yearLabel: yearLabel(cls.name),
    semLabel: semLabel(period.label),
    rows,
  };
  return { data, gateRows };
}
