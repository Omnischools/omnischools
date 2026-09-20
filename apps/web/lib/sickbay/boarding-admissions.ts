/**
 * SERVER-ONLY · R225.2 (INCR-28a) — the boarding housemaster's sick-bay tile reader. ONE job: "which
 * of THIS House's boarders is currently admitted to the sick bay?" Returns a FROZEN key-set
 * `{ studentId, studentName, admittedAt }` and NOTHING else — never a condition, complaint, bed,
 * vital, impression or plan. The HM is entitled to his own boarders' NAMES (attendance-M already
 * discloses the "in sickbay" LOCATION to the class teacher — R50 location-not-condition); the
 * clinical record stays behind the sickbay module's own gate.
 *
 * 🔴 R41/R88 — this is a NARROW, house-scoped, condition-free reader, NOT a reusable `getAdmissions()`.
 * It must NOT import `board-reads.ts`: `SickbayBedTile`/`SickbayWardPatient` there are wide clinical
 * projections (bed, vitals, isolation) and reusing one would drag a clinical field onto a boarding
 * surface. The projection here (`boardingSickbayRow`) is the disclosure boundary — the key-set pin in
 * boarding-admissions.test.ts asserts it carries EXACTLY the three keys, so a clinical field added to
 * it reds a test rather than shipping.
 *
 * Takes the caller's `tx` (mirrors `medicalHoldStudentIds`) so it runs INSIDE `getDailyLife`'s outer
 * `withSchool` — no nested connection (the e08c042 exhaustion shape). Tenant scope is the caller's tx
 * plus the explicit `school_id` predicate; the open-admission set is intersected with `boarderIds`.
 */
import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { sickbayAdmission, students } from "@/db/schema";

const shortName = (first: string, last: string) => `${first.charAt(0)}. ${last}`;

/** The FROZEN key-set (R41/R88) — studentId, studentName, admittedAt. NEVER a condition/bed/complaint. */
export interface BoardingSickbayAdmission {
  studentId: string;
  studentName: string; // ALREADY ABBREVIATED (`A. Mensa`) — the disclosure tier is applied here.
  admittedAt: Date;
}

/**
 * Project one raw admission+student row to the frozen boarding key-set. Exported for the key-set pin:
 * a clinical field added here changes `Object.keys(...)` and reds boarding-admissions.test.ts.
 */
export function boardingSickbayRow(raw: {
  studentId: string;
  firstName: string;
  lastName: string;
  admittedAt: Date;
}): BoardingSickbayAdmission {
  return {
    studentId: raw.studentId,
    studentName: shortName(raw.firstName, raw.lastName),
    admittedAt: raw.admittedAt,
  };
}

/**
 * The OPEN sick-bay admissions (`discharged_at IS NULL`) of THIS House's boarders, oldest first.
 * Empty `boarderIds` (a Basic-tier / zero-boarder House) short-circuits with no query. A
 * no-sickbay school simply has zero admission rows — an honest empty list, never a throw.
 */
export async function boardingSickbayAdmissions(
  tx: Tx,
  schoolId: string,
  boarderIds: readonly string[],
): Promise<BoardingSickbayAdmission[]> {
  if (boarderIds.length === 0) return [];
  const rows = await tx
    .select({
      studentId: sickbayAdmission.studentId,
      firstName: students.firstName,
      lastName: students.lastName,
      admittedAt: sickbayAdmission.admittedAt,
    })
    .from(sickbayAdmission)
    .innerJoin(students, and(eq(students.schoolId, schoolId), eq(students.id, sickbayAdmission.studentId)))
    .where(
      and(
        eq(sickbayAdmission.schoolId, schoolId),
        isNull(sickbayAdmission.dischargedAt),
        inArray(sickbayAdmission.studentId, [...boarderIds]),
      ),
    )
    .orderBy(asc(sickbayAdmission.admittedAt));
  return rows.map(boardingSickbayRow);
}
