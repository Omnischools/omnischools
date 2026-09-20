/**
 * The attendance writer's RULES — PURE, DB-free, import-free (bar one constant), unit-tested in
 * mark-rules.test.ts. SHS module 4.4 / INCR-22b, the R24 precedent applied to a shipped Basic-tier
 * path: every decision the writer makes lives here as a function of plain values, and
 * `lib/attendance/mark.ts` is the server shell that reads rows, calls these, and writes.
 *
 * Nothing here touches the DB, so the two rules that decide whether a real family gets a false
 * "your child was absent" SMS are provable without a database.
 */
import { SICKBAY_REASON_CODE } from "@/lib/attendance-reasons";
import type { AttendanceStatus } from "@/lib/attendance-status";

/** Why a sickbay attendance mark was not written. Never an exception — the visit always survives (R54). */
export type MarkSkipReason = "CLOSED_TERM" | "NO_CLASS" | "NOT_TODAY" | "FAILED";

/** One student's mark, as either caller supplies it. */
export interface MarkEntry {
  studentId: string;
  classId: string;
  status: AttendanceStatus;
  reasonCode: string | null;
  note: string | null;
}

/** The three columns that differ between the INSERT branch and the UPDATE branch of the upsert. */
export interface MarkColumns {
  status: AttendanceStatus;
  reasonCode: string | null;
  note: string | null;
}

/**
 * The UPDATE branch — always the caller's own values. A reason or a note only makes sense on a
 * non-present mark, so PRESENT clears both (shipped behaviour, moved into the writer so the sickbay
 * path inherits it).
 *
 * 🔴 The MEDICAL/SICKBAY row is protected here by the DB `setWhere` on the upsert, NOT by this
 * function — caller-agnostic by construction (D4/R49a). Do not add a per-caller branch.
 */
export function updateColumns(entry: MarkEntry): MarkColumns {
  const present = entry.status === "PRESENT";
  return {
    status: entry.status,
    reasonCode: present ? null : entry.reasonCode,
    note: present ? null : entry.note,
  };
}

/**
 * The INSERT branch — where R48's PULL arm lives. A student under an open medical hold whose row for
 * the day does not exist yet is marked MEDICAL/SICKBAY instead of whatever the teacher pressed. That
 * is what marks days 2, 3 and 4 of an admission the moment the register is taken, with NO SCHEDULER
 * running anywhere.
 *
 * 🔴 COERCION IS INSERT-ONLY, and that is exactly what makes an approved co-signed correction FINAL
 * (H14): once a row exists, the upsert takes the UPDATE branch and this function is not consulted
 * again, so a corrected PRESENT is never quietly pushed back to MEDICAL by the next register save.
 *
 * 🔒 A7 — `note` is null on a coerced row. `attendance_record.note` is the sickbay module's ONLY
 * outbound leak path into the Basic tier (it is read by every class teacher), so it never carries the
 * presenting complaint, the working impression, or anything else clinical.
 */
export function insertColumns(entry: MarkEntry, underMedicalHold: boolean): MarkColumns {
  if (!underMedicalHold) return updateColumns(entry);
  return { status: "MEDICAL", reasonCode: SICKBAY_REASON_CODE, note: null };
}

/** The civil date in Africa/Accra. Ghana keeps UTC+0 all year with no DST, so the UTC date IS it. */
export function civilDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** One effective row as the DB returned it (R49b) — the only thing the save may reason about. */
export interface EffectiveMark {
  studentId: string;
  status: AttendanceStatus;
  reasonCode: string | null;
}

/**
 * #265 / owner OC-MED-NOTIFY = NO — the post-write summary `saveAttendance` records and messages
 * from, derived from the EFFECTIVE rows the DB stored (R49b), NEVER from teacher input.
 *
 * `absentStudentIds` is the ONLY set that gets an SMS. A MEDICAL row is never in it, so no parent is
 * told "…was marked absent" about a child the school itself sent to the sickbay (AC-265-1). The two
 * MEDICAL counts put that (correct) suppression on the audit record instead of leaving it a silent
 * fall-out of the absent filter:
 *   • medicalTeacherMarked   — a teacher pressed Medical (any non-sickbay reason). Suppressed by
 *                              policy: NO SMS (owner OC-MED-NOTIFY = NO).
 *   • medicalSickbayDeferred — reasonCode === SICKBAY (an R48-coerced hold). Any notification is the
 *                              sickbay comms module's job (#280), never this register-save path's.
 *
 * 🔒 A7 — COUNTS only: no reason code, note, or clinical string ever leaves here. A sickbay-owned
 * row is distinguished by `reasonCode === SICKBAY_REASON_CODE` and collapsed to a tally on the spot.
 */
export function summariseMarks(marked: readonly EffectiveMark[]): {
  absentStudentIds: string[];
  medicalTeacherMarked: number;
  medicalSickbayDeferred: number;
} {
  const absentStudentIds: string[] = [];
  let medicalTeacherMarked = 0;
  let medicalSickbayDeferred = 0;
  for (const m of marked) {
    if (m.status === "ABSENT") absentStudentIds.push(m.studentId);
    else if (m.status === "MEDICAL") {
      if (m.reasonCode === SICKBAY_REASON_CODE) medicalSickbayDeferred++;
      else medicalTeacherMarked++;
    }
  }
  return { absentStudentIds, medicalTeacherMarked, medicalSickbayDeferred };
}

/**
 * R47 — ONE mark per student per day, civil date Africa/Accra, **TODAY ONLY, never backdated**.
 * Returns the date to write, or null when the clinical event is not today (the writer then skips with
 * `NOT_TODAY` rather than reaching into a past register).
 *
 * This is what makes the edit-window exemption safe: the teacher-register edit-window lock stays in
 * `saveAttendance` and the sickbay path skips it, which is only defensible because the sickbay can
 * physically only write today.
 */
export function sickbayMarkDate(at: Date, now: Date): string | null {
  const date = civilDate(at);
  return date === civilDate(now) ? date : null;
}
