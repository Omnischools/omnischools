import "server-only";
import { and, eq, isNull, asc, desc, inArray } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  senRegister,
  senModuleAdoption,
  senSupportGrant,
  students,
  classes,
  users,
  roleAssignments,
  roles,
} from "@/db/schema";
import { liveSenGrantStudentIds } from "@/lib/sen/grants";
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

/**
 * GOV-10b (R436) · the GRANTEE accommodation record — a granted teacher's ACCOMMODATION-ONLY view. The type
 * structurally has NO diagnosis field (`diagnosisSource`/`diagnosingClinician`/`diagnosingInstitution`/
 * `diagnosisYear`) and NO consent metadata — a teacher plans classroom support, not the clinical dossier
 * (the de-identification-at-the-type-level idiom). Adding a diagnosis key here is a compile/test failure.
 */
export type SenAccommodationRecord = {
  studentName: string;
  className: string | null;
  level: string | null;
  category: SenCategory;
  severity: SenSeverity | null;
  supportNotes: string | null;
  accommodations: string[];
};

/**
 * The grantee reader (R437) — lives INSIDE this sole-content-path file because it projects
 * `accommodations`/`supportNotes`/`severity` (a new file would turn the GOV10-18 sweep RED). GRANTED rows
 * ONLY (PENDING has no detail, R410), filtered to the teacher's LIVE-granted student set — never the rest of
 * the register, never the diagnosis cluster.
 */
export async function getSenAccommodationsForGrantee(
  schoolId: string,
  granteeUserId: string,
): Promise<SenAccommodationRecord[]> {
  return withSchool(schoolId, async (tx) => {
    const studentIds = await liveSenGrantStudentIds(tx, schoolId, granteeUserId);
    if (studentIds.size === 0) return [];
    const rows = await tx
      .select({
        firstName: students.firstName,
        lastName: students.lastName,
        className: classes.name,
        level: classes.level,
        category: senRegister.category,
        severity: senRegister.severity,
        supportNotes: senRegister.supportNotes,
        accommodations: senRegister.accommodations,
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
      .where(
        and(
          eq(senRegister.schoolId, schoolId),
          eq(students.status, "ACTIVE"),
          eq(senRegister.consentState, "GRANTED"),
          inArray(senRegister.studentId, [...studentIds]),
        ),
      );
    return rows.map((r) => ({
      studentName: `${r.firstName} ${r.lastName}`.trim(),
      className: r.className,
      level: r.level,
      category: r.category,
      severity: r.severity,
      supportNotes: r.supportNotes,
      accommodations: r.accommodations ?? [],
    }));
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

// ── GOV-10b · admin grant-management + pending-consent readers ─────────────────────────────────────────

export type SenGrantRow = {
  grantId: string;
  studentName: string;
  granteeName: string;
  reason: string;
  grantedAt: string;
  expiresAt: string | null;
  revoked: boolean;
  live: boolean;
};
export type SenGrantStaff = { id: string; name: string; roleLabel: string };
export type SenGrantableStudent = { id: string; name: string; className: string | null };
export type SenGrantsAdmin = {
  grants: SenGrantRow[];
  granteeOptions: SenGrantStaff[];
  grantableStudents: SenGrantableStudent[];
};

/**
 * GOV-10b (R438) · the admin's Access-grants view: every grant (live + revoked — append-only) + the staff the
 * admin may grant + the students with a GRANTED record (the grantable set). `live` is computed vs `now()`.
 * Projects NO `sen_register` DETAIL column → NOT a sole-content-path concern.
 */
export async function getSenGrantsAdmin(schoolId: string): Promise<SenGrantsAdmin> {
  return withSchool(schoolId, async (tx) => {
    const now = new Date();
    const grantRows = await tx
      .select({
        id: senSupportGrant.id,
        firstName: students.firstName,
        lastName: students.lastName,
        granteeName: users.fullName,
        reason: senSupportGrant.reason,
        grantedAt: senSupportGrant.grantedAt,
        expiresAt: senSupportGrant.expiresAt,
        revokedAt: senSupportGrant.revokedAt,
      })
      .from(senSupportGrant)
      .innerJoin(
        students,
        and(eq(students.schoolId, senSupportGrant.schoolId), eq(students.id, senSupportGrant.studentId)),
      )
      .leftJoin(users, eq(users.id, senSupportGrant.granteeUserId))
      .where(eq(senSupportGrant.schoolId, schoolId))
      .orderBy(desc(senSupportGrant.grantedAt));

    const grants: SenGrantRow[] = grantRows.map((g) => {
      const revoked = g.revokedAt != null;
      const live = !revoked && (g.expiresAt == null || g.expiresAt > now);
      return {
        grantId: g.id,
        studentName: `${g.firstName} ${g.lastName}`.trim(),
        granteeName: g.granteeName ?? "Unnamed staff",
        reason: g.reason,
        grantedAt: g.grantedAt.toISOString().slice(0, 10),
        expiresAt: g.expiresAt ? g.expiresAt.toISOString().slice(0, 10) : null,
        revoked,
        live,
      };
    });

    const staffRows = await tx
      .select({ id: users.id, name: users.fullName, roleLabel: roles.label, code: roles.code })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .innerJoin(users, eq(users.id, roleAssignments.userId))
      .where(eq(roleAssignments.schoolId, schoolId));
    const staffById = new Map<string, SenGrantStaff>();
    for (const r of staffRows) {
      if (r.code === "STUDENT" || r.code === "PARENT") continue;
      if (!staffById.has(r.id)) {
        staffById.set(r.id, { id: r.id, name: r.name ?? "Unnamed staff", roleLabel: r.roleLabel });
      }
    }

    const studentRows = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        className: classes.name,
      })
      .from(senRegister)
      .innerJoin(
        students,
        and(eq(students.schoolId, senRegister.schoolId), eq(students.id, senRegister.studentId)),
      )
      .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
      .where(
        and(
          eq(senRegister.schoolId, schoolId),
          eq(students.status, "ACTIVE"),
          eq(senRegister.consentState, "GRANTED"),
        ),
      )
      .orderBy(asc(students.firstName), asc(students.lastName));

    return {
      grants,
      granteeOptions: [...staffById.values()].sort((a, b) => a.name.localeCompare(b.name)),
      grantableStudents: studentRows.map((s) => ({
        id: s.id,
        name: `${s.firstName} ${s.lastName}`.trim(),
        className: s.className,
      })),
    };
  });
}

export type SenPendingRecord = {
  recordId: string;
  studentName: string;
  className: string | null;
  category: SenCategory;
};

/**
 * GOV-10b (R440) · pending-consent records — student + category ONLY (a PENDING row has no detail, R410). The
 * admin records consent on these (PENDING→GRANTED). In this sole-content-path file, though it projects no
 * confidential DETAIL column.
 */
export async function getSenPendingRecords(schoolId: string): Promise<SenPendingRecord[]> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        recordId: senRegister.id,
        firstName: students.firstName,
        lastName: students.lastName,
        className: classes.name,
        category: senRegister.category,
      })
      .from(senRegister)
      .innerJoin(
        students,
        and(eq(students.schoolId, senRegister.schoolId), eq(students.id, senRegister.studentId)),
      )
      .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
      .where(
        and(
          eq(senRegister.schoolId, schoolId),
          eq(students.status, "ACTIVE"),
          eq(senRegister.consentState, "PENDING"),
        ),
      )
      .orderBy(asc(students.firstName), asc(students.lastName));
    return rows.map((r) => ({
      recordId: r.recordId,
      studentName: `${r.firstName} ${r.lastName}`.trim(),
      className: r.className,
      category: r.category,
    }));
  });
}
