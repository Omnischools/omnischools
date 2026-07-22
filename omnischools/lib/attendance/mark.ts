import "server-only";
import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { academicPeriod, attendanceRecords, students } from "@/db/schema";
import { SICKBAY_REASON_CODE } from "@/lib/attendance-reasons";
import type { AttendanceStatus } from "@/lib/attendance-status";
import { medicalHoldStudentIds } from "@/lib/sickbay/medical-hold";
import {
  civilDate,
  insertColumns,
  sickbayMarkDate,
  updateColumns,
  type MarkEntry,
  type MarkSkipReason,
} from "./mark-rules";

/**
 * The ONE shared attendance writer (SHS module 4.4 / INCR-22b · owner decision D4 · Kofi R46–R54).
 * Both the teacher's register save (`lib/actions/attendance.ts::saveAttendance`) and the sickbay's
 * disposition hook route through `writeMarks`, so every rule below is enforced once, for everyone.
 *
 * 🔴 `server-only`, and emphatically NOT `"use server"`. Every export of a `"use server"` module is a
 * remotely callable endpoint, so this writer CANNOT live in `lib/actions/attendance.ts` — a
 * `markSickbayMedical` reachable by POST is a forgeable clinical assertion (AC H16 greps for it).
 *
 * What lives here and what does not:
 *   • the DOWNGRADE GUARD (R49a) — a DB `setWhere` on the existing upsert, so it is caller-agnostic
 *     by construction. A teacher's save over a MEDICAL/SICKBAY row is a no-op; the sickbay's push
 *     over a teacher's ABSENT proceeds. ONE rule, no per-caller branch.
 *   • the EFFECTIVE-STATUS return (R49b) — every upsert `.returning()`s, and the absent list, the
 *     SMS and the audit payload are computed from what the DB actually stored, never from input.
 *   • the CLOSED-TERM check (R52) — MOVED here from `saveAttendance`, else the sickbay path skips it.
 *   • the EDIT-WINDOW lock STAYS in `saveAttendance`. It is a teacher-register concept: a matron
 *     admitting at 14:00 into a register marked 30 hours ago must not be blocked by it. That
 *     exemption is only safe because of R47 — the sickbay writes today and only today.
 */

export type { MarkEntry, MarkSkipReason } from "./mark-rules";

/** What the DB actually stored for one student — the only thing callers may reason about (R49b). */
export interface MarkedRow {
  studentId: string;
  status: AttendanceStatus;
  reasonCode: string | null;
}

export interface WriteMarksResult {
  /** Set ⇒ NOTHING was written: attendance inside a closed term is final (R52). */
  closedTerm: string | null;
  /** The rows the DB actually holds after this write. */
  marked: MarkedRow[];
  /** Students whose existing MEDICAL/SICKBAY row refused the write. Report them; never hide them. */
  held: string[];
}

/**
 * R52 — a closed term is finalised. Returns the period label, or null when the date is writable.
 * Exported because `saveAttendance` checks it BEFORE its edit-window lock (the shipped error
 * precedence: "the term is closed" is better advice than "the window has closed", which would send a
 * teacher down a correction path that must not apply either). `writeMarks` checks it again because
 * the writer never trusts its caller — the sickbay path has no pre-check at all.
 */
export async function closedTermLabel(
  tx: Tx,
  schoolId: string,
  date: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ label: academicPeriod.periodLabel })
    .from(academicPeriod)
    .where(
      and(
        eq(academicPeriod.schoolId, schoolId),
        lte(academicPeriod.startsOn, date),
        gte(academicPeriod.endsOn, date),
        isNotNull(academicPeriod.closedAt),
      ),
    )
    .limit(1);
  return row?.label ?? null;
}

/**
 * 🔴 THE DOWNGRADE GUARD (owner D4 / R49a). Evaluated by Postgres against the EXISTING row inside the
 * upsert's UPDATE branch, so no caller can forget it and no caller can be exempted from it.
 *
 *   teacher saves over M/SICKBAY  → the WHERE is false → no row updated, no row returned → a no-op.
 *   sickbay pushes over ABSENT    → the WHERE is true  → the mark is upgraded to Medical.
 *   sickbay pushes over M/SICKBAY → the WHERE is false → a harmless no-op (R51: never reverted).
 *
 * The only legal way out of a MEDICAL/SICKBAY mark is the shipped co-signed `attendance_correction`
 * flow, which updates the row directly and clears the reason code.
 */
const NOT_SICKBAY_HOLD = sql`NOT (${attendanceRecords.status} = 'MEDICAL' AND ${attendanceRecords.reasonCode} = ${SICKBAY_REASON_CODE})`;

/**
 * Write one register's worth of marks inside the CALLER's transaction, and report what the DB
 * actually stored.
 *
 * 🔴 R49b — the defect this function exists to kill. `saveAttendance` used to derive its absent list
 * (→ the parent SMS → the audit `after.absent`) from the teacher's INPUT. With the guard in place the
 * row write is correctly blocked and the mother of an admitted student still receives "Adwoa was
 * marked absent on 14 May" while Adwoa is on bed 3 in the school's own sickbay. Entries that return
 * no row were HELD; entries that were coerced come back MEDICAL. Callers must read `marked`.
 */
export async function writeMarks(
  tx: Tx,
  args: {
    schoolId: string;
    date: string;
    actorUserId: string | null;
    entries: readonly MarkEntry[];
  },
): Promise<WriteMarksResult> {
  const closedTerm = await closedTermLabel(tx, args.schoolId, args.date);
  if (closedTerm) return { closedTerm, marked: [], held: [] };

  const hold = await medicalHoldStudentIds(
    tx,
    args.schoolId,
    args.date,
    args.entries.map((e) => e.studentId),
  );

  const marked: MarkedRow[] = [];
  const held: string[] = [];
  for (const entry of args.entries) {
    const now = new Date();
    const [row] = await tx
      .insert(attendanceRecords)
      .values({
        schoolId: args.schoolId,
        studentId: entry.studentId,
        classId: entry.classId,
        date: args.date,
        ...insertColumns(entry, hold.has(entry.studentId)),
        markedByUserId: args.actorUserId ?? undefined,
        markedAt: now,
      })
      .onConflictDoUpdate({
        target: [attendanceRecords.schoolId, attendanceRecords.studentId, attendanceRecords.date],
        set: {
          ...updateColumns(entry),
          markedByUserId: args.actorUserId ?? undefined,
          markedAt: now,
        },
        setWhere: NOT_SICKBAY_HOLD,
      })
      .returning({
        studentId: attendanceRecords.studentId,
        status: attendanceRecords.status,
        reasonCode: attendanceRecords.reasonCode,
      });
    // No row back ⇒ the guard refused the UPDATE. The stored row is untouched, byte for byte.
    if (row) marked.push(row);
    else held.push(entry.studentId);
  }
  return { closedTerm: null, marked, held };
}

// ============================================================================
// R46 — the sickbay PUSH. Fires on ADMIT and REFER, NEVER on DISCHARGE.
// ============================================================================

export interface SickbayMarkResult {
  marked: boolean;
  skipped: MarkSkipReason | null;
  /** The civil date the mark was written for (or would have been). */
  date: string;
}

/**
 * Write TODAY's MEDICAL mark for a student the sickbay has just admitted or referred.
 *
 * 🔴 R54 — BEST-EFFORT and OUTSIDE the clinical transaction. This function CANNOT throw: every
 * failure is a named skip. The visit is the medico-legal record and must survive an attendance
 * subsystem having a bad day; the one place atomicity is deliberately rejected.
 *
 * The three named skips, each with an `attendance_mark_skipped` audit row so the silence is on the
 * record (R52/R53):
 *   CLOSED_TERM — the clinical write COMMITS, the mark is skipped. A clinical fact is not contingent
 *                 on an academic-calendar state.
 *   NO_CLASS    — `attendance_record.class_id` is NOT NULL and stays that way (relaxing a shipped
 *                 Basic-tier constraint for a seed defect is backwards). A sick child is treated
 *                 first: never block the visit, and never go silent about it.
 *   NOT_TODAY   — R47. The sickbay never reaches into a past register.
 *
 * R51 — there is NO revert path here, and none anywhere else in the module. Not on discharge, not on
 * error, not on void (void is legal only while `disposition IS NULL`, and only ADMIT/REFER write, so
 * voiding cannot touch attendance BY CONSTRUCTION).
 */
export async function markSickbayMedical(args: {
  schoolId: string;
  studentId: string;
  visitId: string;
  /** The clinical event's timestamp — the disposition stamp, not "now" at some later moment. */
  at: Date;
  actor: { id: string | null; role: string };
}): Promise<SickbayMarkResult> {
  const date = sickbayMarkDate(args.at, new Date());
  if (!date) {
    await auditSkip(args, civilDate(args.at), "NOT_TODAY");
    return { marked: false, skipped: "NOT_TODAY", date: civilDate(args.at) };
  }

  try {
    return await withSchool(args.schoolId, async (tx) => {
      const [student] = await tx
        .select({ classId: students.classId })
        .from(students)
        .where(and(eq(students.schoolId, args.schoolId), eq(students.id, args.studentId)))
        .limit(1);
      if (!student?.classId) {
        // R54 — audited on its OWN connection, not `tx`. Nothing is written in this branch, and if
        // the audit insert failed inside `tx` it would abort the transaction and the named reason
        // would come back out as the generic `FAILED`, losing "this student has no class".
        await auditSkip(args, date, "NO_CLASS");
        return { marked: false, skipped: "NO_CLASS" as const, date };
      }

      const res = await writeMarks(tx, {
        schoolId: args.schoolId,
        date,
        actorUserId: args.actor.id,
        entries: [
          {
            studentId: args.studentId,
            classId: student.classId,
            status: "MEDICAL",
            reasonCode: SICKBAY_REASON_CODE,
            // 🔒 A7 — never the complaint, never the impression. Location, never condition.
            note: null,
          },
        ],
      });
      if (res.closedTerm) {
        // Same as NO_CLASS above: `writeMarks` short-circuits before it writes anything, so this
        // branch has no transaction to preserve — and keeping the audit out of `tx` keeps the
        // NAMED reason (R52) even when the audit write itself is what fails.
        await auditSkip(args, date, "CLOSED_TERM", res.closedTerm);
        return { marked: false, skipped: "CLOSED_TERM" as const, date };
      }

      await recordAudit(tx, {
        schoolId: args.schoolId,
        actorUserId: args.actor.id ?? undefined,
        actorRole: args.actor.role,
        actionType: "attendance_marked",
        entityType: "attendance_record",
        entityId: args.visitId,
        after: { studentId: args.studentId, date, status: "MEDICAL", reasonCode: SICKBAY_REASON_CODE },
        reason: "Sickbay marked the day Medical",
      });
      // `held` here means the row was ALREADY MEDICAL/SICKBAY — the mark stands either way (R51).
      return { marked: true, skipped: null, date };
    });
  } catch {
    // R54 — an attendance failure is never a clinical rollback and never an exception to the caller.
    await auditSkip(args, date, "FAILED");
    return { marked: false, skipped: "FAILED", date };
  }
}

/** The `attendance_mark_skipped` row — R52/R53's "never go silent" half. Best-effort like the mark. */
async function auditSkipTx(
  tx: Tx,
  args: { schoolId: string; studentId: string; visitId: string; actor: { id: string | null; role: string } },
  date: string,
  reason: MarkSkipReason,
  detail?: string,
): Promise<void> {
  await recordAudit(tx, {
    schoolId: args.schoolId,
    actorUserId: args.actor.id ?? undefined,
    actorRole: args.actor.role,
    actionType: "attendance_mark_skipped",
    entityType: "attendance_record",
    entityId: args.visitId,
    after: { studentId: args.studentId, date, reason, detail: detail ?? null },
    reason: `Sickbay attendance mark skipped — ${reason}`,
  });
}

async function auditSkip(
  args: { schoolId: string; studentId: string; visitId: string; actor: { id: string | null; role: string } },
  date: string,
  reason: MarkSkipReason,
  detail?: string,
): Promise<void> {
  try {
    await withSchool(args.schoolId, (tx) => auditSkipTx(tx, args, date, reason, detail));
  } catch {
    // The DB is the thing that just failed; there is nowhere honest left to write. Never throw.
  }
}
