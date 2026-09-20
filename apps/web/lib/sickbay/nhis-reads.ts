/**
 * SERVER-ONLY read API for the NHIS card identity surface (SHS module 4.4 / INCR-25a). Imports the DB
 * driver via `withSchool` — must NEVER be imported by a client component: the page fetches through
 * here and hands the client `nhis-card-console` the PRE-SHAPED `NhisCardView` + plain student identity
 * (never a `*-reads` import; repo memory `reports-data-is-server-only`).
 *
 * 🔴 R195 — the card is clinical-adjacent identity: the page gates its READ with
 * SICKBAY_CLINICAL_READ_ROLES ([HEADMASTER, MATRON]), so a non-clinical ADMIN never receives this
 * payload. The three-layer no-IDOR pattern (RLS + explicit school predicate + a re-resolved id): a
 * foreign studentId cannot resolve, so the context returns null.
 *
 * 🚫 There is NO school-wide reader here (the forbidden STPSHS roll-up, R182): every read is scoped to
 * ONE studentId. No COUNT/rate over `student_nhis_card` exists anywhere.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { classes, houses, students, studentGuardians, studentNhisCard } from "@/db/schema";
import { formLabel, initials } from "./defaults";
import { formatNhisHolderLine, nhisCardStatus, type NhisCardView } from "./nhis";

export interface NhisGuardianOption {
  id: string;
  name: string;
  relationship: string;
}

export interface NhisCardContext {
  student: {
    id: string;
    name: string;
    studentCode: string;
    initials: string;
    formLabel: string;
    houseName: string | null;
  };
  /** null when the student has no card on file (the singleton is absent, not empty). */
  card: NhisCardView | null;
  /** Best-effort holder link options — the student's guardians. `holder_name` stays authoritative. */
  guardians: NhisGuardianOption[];
}

/**
 * The one student's NHIS card context — identity + the singleton card (status derived) + guardian
 * options. Returns null when the studentId is not an ACTIVE student of THIS school (the re-resolve is
 * the no-IDOR layer). `asOf` is passed so the derived status is computed against a single request clock.
 */
export async function getNhisCardContext(
  schoolId: string,
  studentId: string,
  asOf: Date = new Date(),
): Promise<NhisCardContext | null> {
  return withSchool(schoolId, async (tx) => {
    const [student] = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        studentCode: students.studentCode,
        programme: students.programme,
        className: classes.name,
        classLevel: classes.level,
        houseName: houses.name,
      })
      .from(students)
      .leftJoin(classes, and(eq(classes.schoolId, schoolId), eq(classes.id, students.classId)))
      .leftJoin(houses, and(eq(houses.schoolId, schoolId), eq(houses.id, students.houseId)))
      .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
      .limit(1);
    if (!student) return null;

    const [row] = await tx
      .select({
        id: studentNhisCard.id,
        cardNumber: studentNhisCard.cardNumber,
        holderName: studentNhisCard.holderName,
        holderKind: studentNhisCard.holderKind,
        validFrom: studentNhisCard.validFrom,
        validTo: studentNhisCard.validTo,
        studentGuardianId: studentNhisCard.studentGuardianId,
      })
      .from(studentNhisCard)
      .where(and(eq(studentNhisCard.schoolId, schoolId), eq(studentNhisCard.studentId, studentId)))
      .limit(1);

    const guardianRows = await tx
      .select({
        id: studentGuardians.id,
        name: studentGuardians.name,
        relationship: studentGuardians.relationship,
      })
      .from(studentGuardians)
      .where(
        and(eq(studentGuardians.schoolId, schoolId), eq(studentGuardians.studentId, studentId)),
      );

    const name = `${student.firstName} ${student.lastName}`;
    const card: NhisCardView | null = row
      ? {
          id: row.id,
          cardNumber: row.cardNumber,
          holderName: row.holderName,
          holderKind: row.holderKind,
          validFrom: row.validFrom,
          validTo: row.validTo,
          studentGuardianId: row.studentGuardianId,
          status: nhisCardStatus(row.validTo, asOf),
          holderLine: formatNhisHolderLine(
            { cardNumber: row.cardNumber, holderName: row.holderName, holderKind: row.holderKind },
            name,
          ),
        }
      : null;

    return {
      student: {
        id: student.id,
        name,
        studentCode: student.studentCode,
        initials: initials(name),
        formLabel: formLabel(student.classLevel, student.className, student.programme),
        houseName: student.houseName,
      },
      card,
      guardians: guardianRows,
    };
  });
}
