import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { union } from "drizzle-orm/pg-core";
import { withSchool } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { sickbayAdmission, sickbayReferral, sickbayVisit } from "@/db/schema";
import { OPEN_REFERRAL_STATUSES } from "./referrals";

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
 * 🔴 R193 — INCR-25b adds the OPEN-REFERRAL arm as a THIRD arm of this ONE derivation (root-cause,
 * not a per-caller patch): the attendance register treats an admitted patient AND a referred-out
 * student both as MEDICAL. A referral covers the date while `departed_at < date+1day AND (returned_at
 * IS NULL OR returned_at >= date)` and not voided — the SAME half-open, sargable shape as the
 * admission arm (a discharged/returned case still holds the days it actually spanned; `Mark returned`
 * therefore drops the student the NEXT civil day). Rides `sickbay_referral_departed_idx`.
 *
 * ⚠️ DEPENDENCY DIRECTION (deliberate, flagged for Dex): `lib/attendance/mark.ts` → here, i.e. a
 * shipped Basic-tier path reaches into a Senior-tier module. The alternative — attendance deriving
 * itself from sickbay — was rejected in owner decision D4 because it pushes the derivation into ~8
 * shipped consumers. A Basic-tier school has zero rows in all three tables, so this costs one indexed
 * query returning nothing. This module imports NOTHING from `lib/attendance/*` — the edge is one-way
 * (a shipped guard test asserts it); `./referrals` it depends on is pure and attendance-free.
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

  const referred = tx
    .select({ studentId: sickbayReferral.studentId })
    .from(sickbayReferral)
    .where(
      and(
        eq(sickbayReferral.schoolId, schoolId),
        inArray(sickbayReferral.studentId, ids),
        isNull(sickbayReferral.voidedAt),
        sql`${sickbayReferral.departedAt} < ${date}::date + interval '1 day'`,
        sql`(${sickbayReferral.returnedAt} IS NULL OR ${sickbayReferral.returnedAt} >= ${date}::date)`,
      ),
    );

  return new Set((await union(admitted, inClinic, referred)).map((r) => r.studentId));
}

/**
 * 🔴 R192 — the BOARDING in-House arm (consumed by INCR-28's headcount, shaped like
 * `medicalHoldStudentIds` above). A referred-out student IS off-campus and IS subtracted from the
 * boarding in-House count — UNLIKE a sickbay ADMISSION, which is on-site and stays counted (the R192
 * asymmetry: attendance treats both as MEDICAL, the boarding headcount subtracts ONLY referred-out).
 * So this reads the referral table ONLY; it never touches admissions.
 *
 * "Off-campus at `asOf`" = departed on or before asOf, not yet returned as of asOf, not voided — the
 * timestamp truth (R32 derive-from-timestamps; agrees with the stored `status ∈ OPEN` at asOf=now).
 * Returns the FULL set for the school (no student-id subset — a headcount is school-wide).
 */
export async function referredOutStudentIds(schoolId: string, asOf: Date = new Date()): Promise<Set<string>> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({ studentId: sickbayReferral.studentId })
      .from(sickbayReferral)
      .where(
        and(
          eq(sickbayReferral.schoolId, schoolId),
          isNull(sickbayReferral.voidedAt),
          sql`${sickbayReferral.departedAt} <= ${asOf}`,
          sql`(${sickbayReferral.returnedAt} IS NULL OR ${sickbayReferral.returnedAt} > ${asOf})`,
        ),
      );
    return new Set(rows.map((r) => r.studentId));
  });
}

/** The open-referral statuses, re-exported so a boarding consumer imports the ONE definition (R192). */
export { OPEN_REFERRAL_STATUSES };
