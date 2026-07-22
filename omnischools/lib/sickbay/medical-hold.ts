import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { union } from "drizzle-orm/pg-core";
import type { Tx } from "@/lib/db";
import { sickbayAdmission, sickbayVisit } from "@/db/schema";

/**
 * R48 · the PULL arm of the attendance-M hook (SHS module 4.4 / INCR-22b) — "who is the sickbay
 * holding on this day?"
 *
 * There is NO SCHEDULER in this module and none is worth building. The hook has two halves:
 *   PUSH — at ADMIT/REFER the sickbay writes TODAY's mark (upgrading a register already taken).
 *   PULL — this predicate, consulted by the shared writer on INSERT only, so day 2, 3 and 4 of an
 *          admission are marked at the instant the class teacher takes the register.
 *
 * TWO ARMS, ONE QUERY:
 *   • an ADMISSION covering the date — `admitted_at::date ≤ date AND (discharged_at IS NULL OR
 *     discharged_at::date ≥ date)`. The open case is the multi-day stay; the discharged case still
 *     holds the days the student actually spent on the ward.
 *   • an OPEN VISIT presented on the date (`disposition IS NULL AND voided_at IS NULL`). This is the
 *     07:30 clinic visit still open when the 08:00 register is taken — she is in the sickbay right
 *     now, and nobody has decided anything yet.
 *
 * INCR-25 extends this same function with the open-referral arm; no caller changes.
 *
 * ⚠️ DEPENDENCY DIRECTION (deliberate, flagged for Dex): `lib/attendance/mark.ts` → here, i.e. a
 * shipped Basic-tier path reaches into a Senior-tier module. The alternative — attendance deriving
 * itself from sickbay — was rejected in owner decision D4 because it pushes the derivation into ~8
 * shipped consumers. A Basic-tier school has zero rows in both tables, so this costs one indexed
 * query returning nothing.
 */
export async function medicalHoldStudentIds(
  tx: Tx,
  schoolId: string,
  date: string,
  studentIds: readonly string[],
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const ids = [...studentIds];

  const admitted = tx
    .select({ studentId: sickbayAdmission.studentId })
    .from(sickbayAdmission)
    .where(
      and(
        eq(sickbayAdmission.schoolId, schoolId),
        inArray(sickbayAdmission.studentId, ids),
        sql`${sickbayAdmission.admittedAt}::date <= ${date}::date`,
        sql`(${sickbayAdmission.dischargedAt} IS NULL OR ${sickbayAdmission.dischargedAt}::date >= ${date}::date)`,
      ),
    );

  const inClinic = tx
    .select({ studentId: sickbayVisit.studentId })
    .from(sickbayVisit)
    .where(
      and(
        eq(sickbayVisit.schoolId, schoolId),
        inArray(sickbayVisit.studentId, ids),
        isNull(sickbayVisit.disposition),
        isNull(sickbayVisit.voidedAt),
        sql`${sickbayVisit.presentedAt}::date = ${date}::date`,
      ),
    );

  return new Set((await union(admitted, inClinic)).map((r) => r.studentId));
}
