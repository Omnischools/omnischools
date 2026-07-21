import { notFound, redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import {
  hasAnyRole,
  SICKBAY_CLINICAL_READ_ROLES,
  SICKBAY_CLINICAL_WRITE_ROLES,
  SICKBAY_ROLES,
} from "@/lib/access";
import { getSickbayConfig } from "@/lib/sickbay/config";
import { getVisitRecord, openAdmissionBeds } from "@/lib/sickbay/visit-reads";
import { formatElapsed } from "@/lib/sickbay/visits";
import { ClinicalRestricted } from "@/components/sickbay/clinical-restricted";
import { VisitRecordConsole, type VisitView } from "@/components/sickbay/visit-record-console";

// B15 — wall-clock derivations (`05h 31m`) are computed SERVER-SIDE at request time and rendered as
// static strings. A stale minute is honest; a ticking client clock on a clinical page is not.
export const dynamic = "force-dynamic";

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const LONG = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC", // Accra is UTC+0 all year
});
const hhmm = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

/**
 * `/senior/sickbay/visits/[visitId]` — the visit record: §01 (identity + vitals timeline), §02
 * (assessment + consult), §04 (disposition + criteria). §03 and §05 are ABSENT ENTIRELY.
 *
 * 🔴 TWO gates, and the split is the point (owner D2 · R39/R40 · Lucy Q2):
 *   • MODULE access is `SICKBAY_ROLES` — ADMIN reaches the route and is NOT 404'd.
 *   • CLINICAL read is `SICKBAY_CLINICAL_READ_ROLES` = [HEADMASTER, MATRON]. ADMIN is not a member,
 *     so this page NEVER FETCHES the record for them: no complaint, no impression, no vital, no
 *     consult enters the flight payload at all (AC Z2 — trimmed server-side, not hidden in CSS).
 *   • CLINICAL write is `SICKBAY_CLINICAL_WRITE_ROLES` = [MATRON]. A HEADMASTER reads every value
 *     and gets no control; every action re-checks, so a hand-crafted POST is refused too.
 */
export default async function VisitRecordPage({
  params,
}: {
  params: Promise<{ visitId: string }>;
}) {
  const { visitId } = await params;
  const { school, user } = await requireSchoolRole(SICKBAY_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;

  // The whole clinical fetch sits INSIDE this branch. Nothing below runs for a non-clinical reader.
  if (!hasAnyRole(roles, SICKBAY_CLINICAL_READ_ROLES)) {
    return <ClinicalRestricted />;
  }

  const record = await getVisitRecord(school.id, visitId);
  if (!record) notFound();

  const config = await getSickbayConfig(school.id);
  const canWrite = hasAnyRole(roles, SICKBAY_CLINICAL_WRITE_ROLES);

  // Free beds for the admit picker — active rows minus every bed with an open admission (R59's
  // occupancy read, reused). In Mode C `capabilities.admissions` is false, so the picker is never
  // rendered and this list is never even sent (R55: no bed reference in a Mode-C DOM).
  let availableBeds: { id: string; bedNumber: number; isIsolation: boolean }[] | undefined;
  if (config.capabilities.admissions) {
    const occupiedIds = new Set((await openAdmissionBeds(school.id)).map((o) => o.bedId));
    availableBeds = config.beds
      .filter((b) => b.active && !occupiedIds.has(b.id))
      .map((b) => ({ id: b.id, bedNumber: b.bedNumber, isIsolation: b.isIsolation }));
  }

  const now = new Date();
  const adm = record.admission;
  const dob = record.student.dateOfBirth ? new Date(record.student.dateOfBirth) : null;
  const ageYears = dob
    ? Math.floor((now.getTime() - dob.getTime()) / (365.25 * 24 * 3600_000))
    : null;

  const visit: VisitView = {
    id: record.id,
    student: {
      name: record.student.name,
      firstName: record.student.firstName,
      lastName: record.student.lastName,
      initials: record.student.initials,
      studentCode: record.student.studentCode,
      // `age 15` renders ONLY when a DOB is present — never a fabricated age (omit-not-fake).
      ageYears,
      formLabel: record.student.formLabel,
      houseName: record.student.houseName,
      primaryGuardian: record.student.primaryGuardian,
    },
    presentedAtHHMM: hhmm(record.presentedAt),
    presentedAtLong: LONG.format(record.presentedAt),
    presentingComplaint: record.presentingComplaint,
    intakeReportedBy: record.intakeReportedBy,
    recordedByName: record.recordedByName,
    started: record.startedAt !== null,
    attendingName: record.attendingName,
    attendingNmcLicence: record.attendingNmcLicence,
    assessment: {
      workingImpression: record.workingImpression,
      redFlagsScreened: record.redFlagsScreened,
      hydrationStatus: record.hydrationStatus,
      plan: record.plan,
      escalationTriggers: record.escalationTriggers,
      recordedAtHHMM: record.assessedAt ? hhmm(record.assessedAt) : null,
    },
    disposition: record.disposition,
    voided: record.voidedAt !== null,
    voidReason: record.voidReason,
    vitals: record.vitals.map((v) => ({ ...v, takenAt: v.takenAt.toISOString() })),
    consults: record.consults.map((c) => ({ ...c, occurredAt: c.occurredAt.toISOString() })),
    admission: adm
      ? {
          id: adm.id,
          bedNumber: adm.bedNumber,
          isIsolation: adm.isIsolation,
          admittedAt: adm.admittedAt.toISOString(),
          admittedByName: adm.admittedByName,
          expectedDischargeAt: iso(adm.expectedDischargeAt),
          dischargeCriteria: adm.dischargeCriteria,
          overnightPlan: adm.overnightPlan,
          dischargedAt: iso(adm.dischargedAt),
        }
      : null,
    timeOnWard:
      adm && !adm.dischargedAt
        ? formatElapsed(now.getTime() - adm.admittedAt.getTime())
        : null,
  };

  return (
    <VisitRecordConsole
      visit={visit}
      canWrite={canWrite}
      capabilities={{
        admissions: config.capabilities.admissions,
        visitingDoctor: config.capabilities.visitingDoctor,
      }}
      {...(availableBeds && { availableBeds })}
    />
  );
}
