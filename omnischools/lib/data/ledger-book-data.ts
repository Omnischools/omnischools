import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schools, subjects, classes, students, academicPeriod } from "@/db/schema";
import { assembleBookRows, semLabel, yearLabel } from "@/lib/score-ledger/ledger-book";
import type { Tx } from "@/lib/db";
import type { LedgerBookData } from "@/lib/pdf/ledger-book-document";

/**
 * Server-only blank-ledger-book data builder (INCR-5 · Item 6) — cloned from
 * lib/data/stpshs-sheet-data, MINUS the senior_score_ledger join and ALL de-scale / cap / gate
 * math. The book is blank (AC B5), so the builder NEVER touches senior_score_ledger and selects
 * ZERO score columns. It keeps the exact roster + period read: ACTIVE students of the class,
 * ordered lastName / firstName / id (byte-identical across regenerations — reprint parity, A2),
 * plus the class / subject / school / GES-code / period labels (all pre-existing columns).
 *
 * Imports the DB driver, so the client "Print ledger book" button must hit the route, never this
 * module (only `pnpm build` catches the leak). Tenant-scoped: every query filters school_id and
 * runs inside `withSchool` (the caller sets app.current_school); a cross-tenant class → null.
 */

/** "27 June 2026" — day month year, no ordinal (the component does no date work). */
const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export async function buildLedgerBookData(
  tx: Tx,
  schoolId: string,
  ctx: { classId: string; subjectId: string; periodId: string },
  now: Date = new Date(),
): Promise<LedgerBookData | null> {
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
  // Any missing piece (or a cross-tenant read filtered out by RLS) → not found (F1).
  if (!sc || !cls || !sub || !period) return null;

  // One row per ACTIVE student; stable, byte-identical order across regenerations (A2). NO score
  // columns are read — the book is blank (B5), so senior_score_ledger is never queried.
  const roster = await tx
    .select({ firstName: students.firstName, lastName: students.lastName })
    .from(students)
    .where(
      and(
        eq(students.schoolId, schoolId),
        eq(students.classId, ctx.classId),
        eq(students.status, "ACTIVE"),
      ),
    )
    .orderBy(asc(students.lastName), asc(students.firstName), asc(students.id));

  return {
    school: { name: sc.name, code: sc.code },
    generatedDate: fmtDate(now),
    subject: sub.name,
    className: cls.name,
    yearLabel: yearLabel(cls.name),
    semLabel: semLabel(period.label),
    rows: assembleBookRows(roster),
  };
}
