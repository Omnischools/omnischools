import "server-only";
import { and, eq, isNull, asc } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { senRegister, senModuleAdoption, students, classes } from "@/db/schema";
import { ageAsOf } from "@/lib/reports/census-enrolment-data";
import {
  SEN_CATEGORIES,
  type SenCategory,
  type CensusSpecialNeeds,
  aggregateCensusSpecialNeeds,
} from "@/lib/reports/census/sen-data";

/**
 * GOV-10 · the ADMIN SEN register reader — **THE SOLE CONTENT-PATH** (R409). This is the ONLY lib file that
 * projects the CONFIDENTIAL `sen_register` DETAIL columns (severity / the diagnosis cluster / support_notes /
 * accommodations) into identifiable rows. Any OTHER file selecting those columns turns the SEN
 * sole-content-path sweep RED (mirrors `lib/vlc/pastoral-flags.ts`). It is read ONLY from the
 * `SEN_REGISTER_ROLES`-gated surface; the de-identified census reader (`sen-data.ts`) reads category+sex only
 * and NEVER a detail column.
 *
 * A PENDING-consent row (R410) is NEVER shaped into `records` — it has no detail and does not appear in the
 * admin detail table; it contributes ONLY to the aggregate counts (and to the census, via `sen-data.ts`).
 */

export type SenDiagnosisSource = "CLINICAL_DIAGNOSIS" | "SCHOOL_OBSERVED";
export type SenSeverity = "MILD" | "MODERATE" | "SEVERE";

export type SenRecord = {
  id: string;
  studentName: string;
  className: string | null;
  level: string | null;
  sex: string;
  age: number | null;
  category: SenCategory;
  severity: SenSeverity | null;
  supportNotes: string | null;
  accommodations: string[];
  diagnosisSource: SenDiagnosisSource | null;
  diagnosingClinician: string | null;
  diagnosingInstitution: string | null;
  diagnosisYear: number | null;
  consentOnFileAt: string | null;
};

export type SenRegisterView = {
  adopted: boolean;
  records: SenRecord[]; // GRANTED only — the detail table
  census: CensusSpecialNeeds; // the 12-cell preview (GRANTED + PENDING)
  totalWithNeeds: number; // GRANTED + PENDING, ACTIVE
  totalEnrolment: number; // ACTIVE roll
  gender: { male: number; female: number }; // across GRANTED + PENDING
  byCategory: Record<SenCategory, number>; // per-category count (GRANTED + PENDING) → filter pills
  byLevel: { level: string; count: number }[]; // year-group split (GRANTED + PENDING)
  largestCategory: { category: SenCategory; count: number } | null;
  pendingCount: number; // PENDING rows (counted in census, no detail shown)
  formalCount: number; // GRANTED with a CLINICAL_DIAGNOSIS
  observedCount: number; // everything else (observed / diagnosis-pending / consent-pending)
};

const emptyPerCategory = (): Record<SenCategory, number> =>
  Object.fromEntries(SEN_CATEGORIES.map((c) => [c, 0])) as Record<SenCategory, number>;

export async function getSenRegister(schoolId: string): Promise<SenRegisterView> {
  return withSchool(schoolId, async (tx) => {
    const [marker, enrolmentRows, rows] = await Promise.all([
      tx
        .select({ schoolId: senModuleAdoption.schoolId })
        .from(senModuleAdoption)
        .where(eq(senModuleAdoption.schoolId, schoolId))
        .limit(1),
      tx
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.schoolId, schoolId), eq(students.status, "ACTIVE"))),
      tx
        .select({
          id: senRegister.id,
          firstName: students.firstName,
          lastName: students.lastName,
          sex: students.sex,
          dateOfBirth: students.dateOfBirth,
          className: classes.name,
          level: classes.level,
          category: senRegister.category,
          severity: senRegister.severity,
          supportNotes: senRegister.supportNotes,
          accommodations: senRegister.accommodations,
          diagnosisSource: senRegister.diagnosisSource,
          diagnosingClinician: senRegister.diagnosingClinician,
          diagnosingInstitution: senRegister.diagnosingInstitution,
          diagnosisYear: senRegister.diagnosisYear,
          consentState: senRegister.consentState,
          consentOnFileAt: senRegister.consentOnFileAt,
        })
        .from(senRegister)
        .innerJoin(
          students,
          and(eq(students.schoolId, senRegister.schoolId), eq(students.id, senRegister.studentId)),
        )
        .leftJoin(
          classes,
          and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)),
        )
        .where(and(eq(senRegister.schoolId, schoolId), eq(students.status, "ACTIVE"))),
    ]);

    const adopted = marker.length > 0;
    const now = new Date();

    // Aggregate over ALL rows (GRANTED + PENDING) — the census counts both (R410).
    const { byCategory: censusByCategory, total } = aggregateCensusSpecialNeeds(
      rows.map((r) => ({ category: r.category, sex: r.sex })),
    );
    const census: CensusSpecialNeeds = { adopted, byCategory: censusByCategory, total };

    const perCategory = emptyPerCategory();
    const gender = { male: 0, female: 0 };
    const levelCounts = new Map<string, number>();
    let pendingCount = 0;
    let formalCount = 0;

    const records: SenRecord[] = [];
    for (const r of rows) {
      perCategory[r.category] = (perCategory[r.category] ?? 0) + 1;
      if (r.sex === "MALE") gender.male++;
      else if (r.sex === "FEMALE") gender.female++;
      const lvl = r.level ?? "Unspecified";
      levelCounts.set(lvl, (levelCounts.get(lvl) ?? 0) + 1);
      if (r.consentState === "PENDING") {
        pendingCount++;
        continue; // a PENDING row is never shaped into a detail record (R410)
      }
      if (r.diagnosisSource === "CLINICAL_DIAGNOSIS") formalCount++;
      records.push({
        id: r.id,
        studentName: `${r.firstName} ${r.lastName}`.trim(),
        className: r.className,
        level: r.level,
        sex: r.sex,
        age: ageAsOf(r.dateOfBirth, now),
        category: r.category,
        severity: r.severity,
        supportNotes: r.supportNotes,
        accommodations: r.accommodations ?? [],
        diagnosisSource: r.diagnosisSource,
        diagnosingClinician: r.diagnosingClinician,
        diagnosingInstitution: r.diagnosingInstitution,
        diagnosisYear: r.diagnosisYear,
        consentOnFileAt: r.consentOnFileAt,
      });
    }

    const byLevel = [...levelCounts.entries()]
      .map(([level, count]) => ({ level, count }))
      .sort((a, b) => a.level.localeCompare(b.level));

    let largestCategory: { category: SenCategory; count: number } | null = null;
    for (const c of SEN_CATEGORIES) {
      const count = perCategory[c];
      if (count > 0 && (largestCategory === null || count > largestCategory.count)) {
        largestCategory = { category: c, count };
      }
    }

    return {
      adopted,
      records,
      census,
      totalWithNeeds: total,
      totalEnrolment: enrolmentRows.length,
      gender,
      byCategory: perCategory,
      byLevel,
      largestCategory,
      pendingCount,
      formalCount,
      observedCount: total - formalCount,
    };
  });
}

export type SenCandidateStudent = { id: string; name: string; className: string | null };

/**
 * ACTIVE students who do NOT yet have a `sen_register` row — the create-form's picker (one row per student,
 * R415, so a student already recorded is not offerable). Not confidential (a plain roster), but read only
 * behind the SEN_REGISTER_ROLES gate alongside the register itself.
 */
export async function getSenCandidateStudents(schoolId: string): Promise<SenCandidateStudent[]> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        className: classes.name,
      })
      .from(students)
      .leftJoin(
        senRegister,
        and(eq(senRegister.schoolId, students.schoolId), eq(senRegister.studentId, students.id)),
      )
      .leftJoin(
        classes,
        and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)),
      )
      .where(
        and(eq(students.schoolId, schoolId), eq(students.status, "ACTIVE"), isNull(senRegister.id)),
      )
      .orderBy(asc(students.firstName), asc(students.lastName));
    return rows.map((r) => ({
      id: r.id,
      name: `${r.firstName} ${r.lastName}`.trim(),
      className: r.className,
    }));
  });
}
