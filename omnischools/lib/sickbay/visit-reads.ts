/**
 * SERVER-ONLY read API for the sickbay VISIT surfaces (SHS module 4.4 / INCR-22a). Imports the DB
 * driver via withSchool — must NEVER be imported by a client component. Pages fetch through these,
 * pre-format everything a client table needs into plain strings, and pass serialisable props down.
 *
 * The pure shaping (state, trend, severity) lives in ./visits + ./vitals and is unit-tested without
 * the DB; this file only fetches rows and hands them to those.
 */
import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  classes,
  houses,
  sickbayAdmission,
  sickbayBed,
  sickbayDoctorConsult,
  sickbayVisit,
  sickbayVitalReading,
  staffProfiles,
  studentGuardians,
  students,
  users,
} from "@/db/schema";
import { formLabel, initials } from "./defaults";

/** One open admission's bed — what R56 (mode guard) and R59 (capacity reconcile) both read. */
export interface OpenAdmissionBed {
  admissionId: string;
  bedId: string;
  bedNumber: number;
}

/**
 * The beds with a patient in them right now (discharged_at IS NULL). This is what stops
 * `planBedReconcile`'s `occupiedBedIds` being `[]` (R59) and what `referralOnlyGuard` counts (R56):
 * open VISITS never block a mode switch — only an occupied BED does, because Mode C asserts the
 * school has none and there is a patient lying in one.
 */
export async function openAdmissionBeds(schoolId: string): Promise<OpenAdmissionBed[]> {
  return withSchool(schoolId, async (tx) =>
    tx
      .select({
        admissionId: sickbayAdmission.id,
        bedId: sickbayAdmission.bedId,
        bedNumber: sickbayBed.bedNumber,
      })
      .from(sickbayAdmission)
      .innerJoin(
        sickbayBed,
        and(eq(sickbayBed.schoolId, schoolId), eq(sickbayBed.id, sickbayAdmission.bedId)),
      )
      .where(and(eq(sickbayAdmission.schoolId, schoolId), isNull(sickbayAdmission.dischargedAt))),
  );
}

/** `A. Bediako` — the render form; the FK is what is stored. */
const shortName = (full: string | null): string | null => {
  if (!full) return null;
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  return parts.length > 1 ? `${parts[0].charAt(0)}. ${last}` : last;
};

/** A pickable student for the New-visit form — non-clinical identity only (name · form · house). */
export interface StudentPick {
  id: string;
  name: string;
  studentCode: string;
  formLabel: string;
  houseName: string | null;
}

/**
 * Active students matching a name/code fragment — the New-visit picker (22a's write-path entry; the
 * live queue that normally seeds a visit is 22c). Capped so a large roster never ships wholesale;
 * empty query returns the first page. No clinical field here — this is intake identity only.
 */
export async function searchActiveStudents(schoolId: string, query: string): Promise<StudentPick[]> {
  const q = query.trim().toLowerCase();
  const rows = await withSchool(schoolId, async (tx) =>
    tx
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
      .where(and(eq(students.schoolId, schoolId), eq(students.status, "ACTIVE"))),
  );
  return rows
    .map((r) => ({
      id: r.id,
      name: `${r.firstName} ${r.lastName}`,
      studentCode: r.studentCode,
      formLabel: formLabel(r.classLevel, r.className, r.programme),
      houseName: r.houseName,
    }))
    .filter(
      (r) => !q || r.name.toLowerCase().includes(q) || r.studentCode.toLowerCase().includes(q),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 25);
}

// ============================================================================
// The full visit record — visit-record §01/§02/§04. CLINICAL: only a clinical reader
// (SICKBAY_CLINICAL_READ_ROLES) ever receives this; the page fetches it for no one else (Z2).
// ============================================================================

export interface VisitRecordVital {
  id: string;
  takenAt: Date;
  tempC: number | null;
  systolic: number | null;
  diastolic: number | null;
  pulseBpm: number | null;
  spo2Pct: number | null;
  painScore: number | null;
  context: string | null;
  takenByName: string | null;
}

export interface VisitRecordConsultRow {
  id: string;
  occurredAt: Date;
  mode: "PHONE" | "IN_PERSON";
  clinicianName: string;
  clinicianAffiliation: string | null;
  note: string;
  recordedByName: string | null;
}

export interface VisitRecordAdmission {
  id: string;
  bedId: string;
  bedNumber: number;
  isIsolation: boolean;
  admittedAt: Date;
  admittedByName: string | null;
  expectedDischargeAt: Date | null;
  dischargeCriteria: string | null;
  overnightPlan: string | null;
  dischargedAt: Date | null;
  dischargedByName: string | null;
  dischargeNote: string | null;
}

export interface VisitRecord {
  id: string;
  student: {
    name: string;
    firstName: string;
    lastName: string;
    initials: string;
    studentCode: string;
    dateOfBirth: string | null;
    formLabel: string;
    houseName: string | null;
    primaryGuardian: { name: string; relationship: string } | null;
  };
  presentedAt: Date;
  presentingComplaint: string;
  intakeReportedBy: string | null;
  recordedByName: string | null;
  startedAt: Date | null;
  attendingName: string | null;
  attendingNmcLicence: string | null;
  workingImpression: string | null;
  redFlagsScreened: string | null;
  hydrationStatus: string | null;
  plan: string | null;
  escalationTriggers: string | null;
  assessedAt: Date | null;
  disposition: "DISCHARGE" | "ADMIT" | "REFER" | null;
  dispositionAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  vitals: VisitRecordVital[];
  admission: VisitRecordAdmission | null;
  consults: VisitRecordConsultRow[];
}

const REL_LABEL: Record<string, string> = {
  MOTHER: "Mother",
  FATHER: "Father",
  GUARDIAN: "Guardian",
  GRANDPARENT: "Grandparent",
  SIBLING: "Sibling",
  AUNT_UNCLE: "Aunt / Uncle",
  OTHER: "Contact",
};

/**
 * getVisitRecord → the visit-record detail page. Returns null when the id is not a visit of THIS
 * school (RLS + the explicit school predicate + a re-resolved id — the INCR-21 three-layer pattern;
 * a foreign uuid cannot resolve). Every actor name is joined here and abbreviated to `A. Bediako`;
 * the client table receives pre-formatted strings and never a DB row.
 */
export async function getVisitRecord(
  schoolId: string,
  visitId: string,
): Promise<VisitRecord | null> {
  return withSchool(schoolId, async (tx) => {
    const [v] = await tx
      .select()
      .from(sickbayVisit)
      .where(and(eq(sickbayVisit.schoolId, schoolId), eq(sickbayVisit.id, visitId)))
      .limit(1);
    if (!v) return null;

    const [student] = await tx
      .select({
        firstName: students.firstName,
        lastName: students.lastName,
        studentCode: students.studentCode,
        dateOfBirth: students.dateOfBirth,
        programme: students.programme,
        className: classes.name,
        classLevel: classes.level,
        houseName: houses.name,
      })
      .from(students)
      .leftJoin(classes, and(eq(classes.schoolId, schoolId), eq(classes.id, students.classId)))
      .leftJoin(houses, and(eq(houses.schoolId, schoolId), eq(houses.id, students.houseId)))
      .where(and(eq(students.schoolId, schoolId), eq(students.id, v.studentId)))
      .limit(1);
    if (!student) return null;

    const [guardian] = await tx
      .select({ name: studentGuardians.name, relationship: studentGuardians.relationship })
      .from(studentGuardians)
      .where(
        and(
          eq(studentGuardians.schoolId, schoolId),
          eq(studentGuardians.studentId, v.studentId),
          eq(studentGuardians.isPrimary, true),
        ),
      )
      .limit(1);

    const vitalRows = await tx
      .select({
        id: sickbayVitalReading.id,
        takenAt: sickbayVitalReading.takenAt,
        tempC: sickbayVitalReading.tempC,
        systolic: sickbayVitalReading.systolic,
        diastolic: sickbayVitalReading.diastolic,
        pulseBpm: sickbayVitalReading.pulseBpm,
        spo2Pct: sickbayVitalReading.spo2Pct,
        painScore: sickbayVitalReading.painScore,
        context: sickbayVitalReading.context,
        takenByName: users.fullName,
      })
      .from(sickbayVitalReading)
      .leftJoin(users, eq(users.id, sickbayVitalReading.takenByUserId))
      .where(and(eq(sickbayVitalReading.schoolId, schoolId), eq(sickbayVitalReading.visitId, v.id)))
      .orderBy(asc(sickbayVitalReading.takenAt));

    const [adm] = await tx
      .select({
        id: sickbayAdmission.id,
        bedId: sickbayAdmission.bedId,
        bedNumber: sickbayBed.bedNumber,
        isIsolation: sickbayAdmission.isIsolation,
        admittedAt: sickbayAdmission.admittedAt,
        admittedByName: users.fullName,
        expectedDischargeAt: sickbayAdmission.expectedDischargeAt,
        dischargeCriteria: sickbayAdmission.dischargeCriteria,
        overnightPlan: sickbayAdmission.overnightPlan,
        dischargedAt: sickbayAdmission.dischargedAt,
        dischargeNote: sickbayAdmission.dischargeNote,
      })
      .from(sickbayAdmission)
      .innerJoin(
        sickbayBed,
        and(eq(sickbayBed.schoolId, schoolId), eq(sickbayBed.id, sickbayAdmission.bedId)),
      )
      .leftJoin(users, eq(users.id, sickbayAdmission.admittedByUserId))
      .where(and(eq(sickbayAdmission.schoolId, schoolId), eq(sickbayAdmission.visitId, v.id)))
      .limit(1);

    const consultRows = await tx
      .select({
        id: sickbayDoctorConsult.id,
        occurredAt: sickbayDoctorConsult.occurredAt,
        mode: sickbayDoctorConsult.mode,
        clinicianName: sickbayDoctorConsult.clinicianName,
        clinicianAffiliation: sickbayDoctorConsult.clinicianAffiliation,
        note: sickbayDoctorConsult.note,
        recordedByName: users.fullName,
      })
      .from(sickbayDoctorConsult)
      .leftJoin(users, eq(users.id, sickbayDoctorConsult.recordedByUserId))
      .where(
        and(eq(sickbayDoctorConsult.schoolId, schoolId), eq(sickbayDoctorConsult.visitId, v.id)),
      )
      .orderBy(asc(sickbayDoctorConsult.occurredAt));

    // Actor names for the visit row itself (recorded_by / attending), plus the attending's N&MC
    // number from staff_profile — a PUBLIC statutory-register credential, not medical PII (R22).
    const actorIds = [...new Set([v.recordedByUserId, v.attendingUserId].filter((x): x is string => !!x))];
    const actorRows = actorIds.length
      ? await tx
          .select({ id: users.id, name: users.fullName, nmc: staffProfiles.nmcLicenceNumber })
          .from(users)
          .leftJoin(
            staffProfiles,
            and(eq(staffProfiles.userId, users.id), eq(staffProfiles.schoolId, schoolId)),
          )
          .where(inArray(users.id, actorIds))
      : [];
    const nameOf = (id: string | null) => actorRows.find((a) => a.id === id)?.name ?? null;
    const nmcOf = (id: string | null) => actorRows.find((a) => a.id === id)?.nmc ?? null;

    const fullName = `${student.firstName} ${student.lastName}`;
    return {
      id: v.id,
      student: {
        name: fullName,
        firstName: student.firstName,
        lastName: student.lastName,
        initials: initials(fullName),
        studentCode: student.studentCode,
        dateOfBirth: student.dateOfBirth,
        formLabel: formLabel(student.classLevel, student.className, student.programme),
        houseName: student.houseName,
        primaryGuardian: guardian
          ? { name: guardian.name, relationship: REL_LABEL[guardian.relationship] ?? "Contact" }
          : null,
      },
      presentedAt: v.presentedAt,
      presentingComplaint: v.presentingComplaint,
      intakeReportedBy: v.intakeReportedBy,
      recordedByName: shortName(nameOf(v.recordedByUserId)),
      startedAt: v.startedAt,
      attendingName: shortName(nameOf(v.attendingUserId)),
      attendingNmcLicence: nmcOf(v.attendingUserId),
      workingImpression: v.workingImpression,
      redFlagsScreened: v.redFlagsScreened,
      hydrationStatus: v.hydrationStatus,
      plan: v.plan,
      escalationTriggers: v.escalationTriggers,
      assessedAt: v.assessedAt,
      disposition: v.disposition,
      dispositionAt: v.dispositionAt,
      voidedAt: v.voidedAt,
      voidReason: v.voidReason,
      vitals: vitalRows.map((r) => ({
        ...r,
        tempC: r.tempC === null ? null : Number(r.tempC),
        takenByName: shortName(r.takenByName),
      })),
      admission: adm
        ? {
            id: adm.id,
            bedId: adm.bedId,
            bedNumber: adm.bedNumber,
            isIsolation: adm.isIsolation,
            admittedAt: adm.admittedAt,
            admittedByName: shortName(adm.admittedByName),
            expectedDischargeAt: adm.expectedDischargeAt,
            dischargeCriteria: adm.dischargeCriteria,
            overnightPlan: adm.overnightPlan,
            dischargedAt: adm.dischargedAt,
            dischargedByName: null,
            dischargeNote: adm.dischargeNote,
          }
        : null,
      consults: consultRows.map((c) => ({ ...c, recordedByName: shortName(c.recordedByName) })),
    };
  });
}
