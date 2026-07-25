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
 *   • an ADMISSION covering the date — `admitted_at < date+1day AND (discharged_at IS NULL OR
 *     discharged_at ≥ date)`. The open case is the multi-day stay; the discharged case still holds the
 *     days the student actually spent on the ward.
 *   • an OPEN VISIT presented on the date (`disposition IS NULL AND voided_at IS NULL`). This is the
 *     07:30 clinic visit still open when the 08:00 register is taken — she is in the sickbay right
 *     now, and nobody has decided anything yet.
 *
 * 🔴 R167(e) — HALF-OPEN TIMESTAMP RANGES, NOT `column::date`. This runs on EVERY register save at
 * every Senior school, forever. The old form cast the COLUMN (`admitted_at::date <= date`), which is
 * NON-SARGABLE — Postgres cannot use an index on a value it has to recompute per row, so it seq-scanned
 * every admission in the school. The cast now sits on the DATE PARAMETER only (`${date}::date`, and
 * `+ interval '1 day'`) and every column is compared BARE, so the scan rides the indexes 0060 ships:
 * `sickbay_admission_student_admitted_idx (school_id, student_id, admitted_at)` and
 * `sickbay_visit_presented_idx (school_id, presented_at)`.
 *
 * The result is UNCHANGED (Ghana is UTC+0 year-round, so a timestamptz's civil date IS its UTC date,
 * and `date::date` is that day's 00:00): `admitted_at::date <= date  ⟺  admitted_at < date+1day`;
 * `discharged_at::date >= date  ⟺  discharged_at >= date` (both midnight-of-`date`); and
 * `presented_at::date = date  ⟺  presented_at >= date AND presented_at < date+1day`.
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
        sql`${sickbayAdmission.admittedAt} < ${date}::date + interval '1 day'`,
        sql`(${sickbayAdmission.dischargedAt} IS NULL OR ${sickbayAdmission.dischargedAt} >= ${date}::date)`,
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
        sql`${sickbayVisit.presentedAt} >= ${date}::date`,
        sql`${sickbayVisit.presentedAt} < ${date}::date + interval '1 day'`,
      ),
    );

  return new Set((await union(admitted, inClinic)).map((r) => r.studentId));
}
