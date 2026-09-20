/**
 * SERVER-ONLY read API for the sickbay REFERRAL surfaces (SHS module 4.4 / INCR-25b) — referral-log
 * §01 (active) + §02 (case detail) + today §04 (active referrals out). Imports the DB driver via
 * `withSchool`, so it must NEVER be imported by a client component: pages fetch through here, pre-shape
 * every string a client table needs, and pass serialisable props down (repo memory
 * `reports-data-is-server-only` — only `pnpm build` catches the leak).
 *
 * 🔴 R195 — the PROJECTIONS live here. The MATRON/HEADMASTER clinical reader (`getActiveReferrals` /
 * `getReferralDetail`) returns full detail INCLUDING the visit's LIVE `working_impression` (the
 * "Diagnosis" line, R190 — never stored on the referral). The BURSAR reader (`getReferralCostLines`)
 * is STRUCTURALLY diagnosis-free: `sickbay_referral_cost_line` has no clinical column, so there is
 * nothing to trim. The HOUSEMASTER projection is off-campus EXISTENCE only — the fact
 * (`referredOutStudentIds`, medical-hold.ts) plus the fixed non-disclosure copy, no clinical field.
 *
 * The referral pages gate on SICKBAY_CLINICAL_READ_ROLES ([HEADMASTER, MATRON]); ADMIN gets module
 * access but NO clinical read (R166), HOUSEMASTER is not on these surfaces. So a foreign or non-
 * clinical caller never reaches these readers — the page refuses first, and the no-IDOR re-resolve
 * (RLS + explicit school predicate + a re-resolved id) means a bad id returns null → notFound().
 */
import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import {
  classes,
  houses,
  roleAssignments,
  roles,
  sickbayHospital,
  sickbayReferral,
  sickbayReferralCostLine,
  sickbayReferralUpdate,
  sickbayVisit,
  studentGuardians,
  students,
  users,
} from "@/db/schema";
import { formLabel, initials } from "./defaults";
import {
  HISTORY_RANGES,
  NHIS_TRISTATE_LABEL,
  historyWindowStart,
  nhisTriState,
  type HistoryRange,
  type NhisTriState,
} from "./referrals";
import {
  SURVEILLANCE_CATEGORY_META,
  SURVEILLANCE_CATEGORY_VALUES,
  type SurveillanceCategory,
} from "./surveillance";
// `A. Bediako` — the one-name abbreviation IS the A2/R73 disclosure tier; reuse the canonical board-copy
// rule (aliased to dodge the collision with defaults.initials, the avatar-glyph form imported above).
import { abbreviateName as shortName } from "./board-copy";
import {
  formatReferralRef,
  referralDayLabel,
  type ReferralStatus,
} from "./referrals";

const REL_LABEL: Record<string, string> = {
  MOTHER: "Mother",
  FATHER: "Father",
  GUARDIAN: "Guardian",
  GRANDPARENT: "Grandparent",
  SIBLING: "Sibling",
  AUNT_UNCLE: "Aunt / Uncle",
  OTHER: "Contact",
};

// ============================================================================
// The New-referral form's options (W1)
// ============================================================================

/** A REFER-disposition visit with no referral yet — the New-referral picker (W1 hangs off it). */
export interface ReferableVisit {
  visitId: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  formLabel: string;
  houseName: string | null;
  /** 🔴 the LIVE working_impression — the "Diagnosis" line, clinical-read only (R190). */
  workingImpression: string | null;
  disposedAt: Date | null;
}

/**
 * REFER-disposition visits of THIS school not yet turned into a referral row. The referral is an
 * escalation EVENT off a CLOSED REFER visit (R187 resolves Lucy W1 — the visit's disposition is
 * immutable), so the picker offers exactly those visits and nothing else.
 */
export async function getReferableVisits(schoolId: string): Promise<ReferableVisit[]> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        visitId: sickbayVisit.id,
        studentId: sickbayVisit.studentId,
        firstName: students.firstName,
        lastName: students.lastName,
        studentCode: students.studentCode,
        programme: students.programme,
        className: classes.name,
        classLevel: classes.level,
        houseName: houses.name,
        workingImpression: sickbayVisit.workingImpression,
        disposedAt: sickbayVisit.dispositionAt,
        referralId: sickbayReferral.id,
      })
      .from(sickbayVisit)
      .innerJoin(students, and(eq(students.schoolId, schoolId), eq(students.id, sickbayVisit.studentId)))
      .leftJoin(classes, and(eq(classes.schoolId, schoolId), eq(classes.id, students.classId)))
      .leftJoin(houses, and(eq(houses.schoolId, schoolId), eq(houses.id, students.houseId)))
      .leftJoin(
        // R205 — join only a LIVE referral. A voided referral frees the visit for re-referral, so a
        // visit whose only referral rows are voided still yields ONE row with a null referralId here
        // (the predicate sits in the JOIN, not a post-filter, so several voided rows can't multiply it).
        sickbayReferral,
        and(
          eq(sickbayReferral.schoolId, schoolId),
          eq(sickbayReferral.visitId, sickbayVisit.id),
          isNull(sickbayReferral.voidedAt),
        ),
      )
      .where(
        and(
          eq(sickbayVisit.schoolId, schoolId),
          eq(sickbayVisit.disposition, "REFER"),
          isNull(sickbayVisit.voidedAt),
        ),
      )
      .orderBy(desc(sickbayVisit.dispositionAt));
    return rows
      .filter((r) => r.referralId === null)
      .map((r) => ({
        visitId: r.visitId,
        studentId: r.studentId,
        studentName: `${r.firstName} ${r.lastName}`,
        studentCode: r.studentCode,
        formLabel: formLabel(r.classLevel, r.className, r.programme),
        houseName: r.houseName,
        workingImpression: r.workingImpression,
        disposedAt: r.disposedAt,
      }));
  });
}

export interface StaffOption {
  id: string;
  name: string;
}

/** ref_users holding `roleCode` in this school — the co-sign (HEADMASTER) / accompanied-by (MATRON) pickers. */
async function staffWithRole(schoolId: string, roleCode: string): Promise<StaffOption[]> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .selectDistinct({ id: users.id, name: users.fullName })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .innerJoin(users, eq(users.id, roleAssignments.userId))
      .where(and(eq(roleAssignments.schoolId, schoolId), eq(roles.code, roleCode)));
    return rows
      .map((r) => ({ id: r.id, name: r.name ?? "Staff member" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

export const getHeadmasterOptions = (schoolId: string) => staffWithRole(schoolId, "HEADMASTER");
export const getMatronOptions = (schoolId: string) => staffWithRole(schoolId, "MATRON");

// ============================================================================
// §01 active list + today §04 — the clinical projection (MATRON/HEADMASTER)
// ============================================================================

export interface ActiveReferralRow {
  id: string;
  ref: string;
  studentId: string;
  firstName: string;
  lastName: string;
  /** `Y. Aidoo` — the ONE abbreviation, pre-formatted server-side (A2/R73: never inline in a page). */
  shortName: string;
  initials: string;
  studentCode: string;
  formLabel: string;
  houseName: string | null;
  status: ReferralStatus;
  dayLabel: string;
  hospitalName: string;
  hospitalWard: string | null;
  hospitalBed: string | null;
  transportMode: string | null;
  attendingClinicianName: string | null;
  /** 🔴 LIVE from the visit — the "Diagnosis" line (R190). Clinical-read only. */
  workingImpression: string | null;
  nhisCardNumber: string | null;
  nhisValid: boolean | null;
  expectedReturnAt: string | null;
  returnNote: string | null;
  accompaniedByName: string | null;
  primaryGuardian: { name: string; relationship: string } | null;
  latestUpdate: string | null;
}

export interface ReferralStats {
  activeCount: number;
  /** A2 — short names, rendered only to a clinical reader and only at low n (the "no names above one" ladder). */
  activeNames: string[];
  weekTotal: number;
  weekReturned: number;
  weekOpen: number;
  semesterTotal: number;
}

export interface ActiveReferrals {
  rows: ActiveReferralRow[];
  stats: ReferralStats;
}

/** ISO week start (Monday 00:00 UTC — Ghana is UTC+0). */
function weekStart(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

/**
 * The active referral list (§01) + the stats strip, and the source the today §04 block projects.
 * "Active" = not RETURNED and not voided. `now` is threaded so every derived day label belongs to one
 * request instant. Every clinical string (working_impression, updates) is here because only a clinical
 * reader ever calls this — the page gate refuses everyone else BEFORE this runs.
 */
export async function getActiveReferrals(schoolId: string, now: Date): Promise<ActiveReferrals> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        id: sickbayReferral.id,
        studentId: sickbayReferral.studentId,
        status: sickbayReferral.status,
        departedAt: sickbayReferral.departedAt,
        returnedAt: sickbayReferral.returnedAt,
        expectedReturnAt: sickbayReferral.expectedReturnAt,
        returnNote: sickbayReferral.returnNote,
        transportMode: sickbayReferral.transportMode,
        hospitalWard: sickbayReferral.hospitalWard,
        hospitalBed: sickbayReferral.hospitalBed,
        attendingClinicianName: sickbayReferral.attendingClinicianName,
        nhisCardNumber: sickbayReferral.nhisCardNumber,
        nhisValid: sickbayReferral.nhisValid,
        accompaniedByUserId: sickbayReferral.accompaniedByUserId,
        createdAt: sickbayReferral.createdAt,
        firstName: students.firstName,
        lastName: students.lastName,
        studentCode: students.studentCode,
        programme: students.programme,
        className: classes.name,
        classLevel: classes.level,
        houseName: houses.name,
        hospitalName: sickbayHospital.name,
        workingImpression: sickbayVisit.workingImpression,
      })
      .from(sickbayReferral)
      .innerJoin(students, and(eq(students.schoolId, schoolId), eq(students.id, sickbayReferral.studentId)))
      .innerJoin(
        sickbayHospital,
        and(eq(sickbayHospital.schoolId, schoolId), eq(sickbayHospital.id, sickbayReferral.hospitalId)),
      )
      .innerJoin(
        sickbayVisit,
        and(eq(sickbayVisit.schoolId, schoolId), eq(sickbayVisit.id, sickbayReferral.visitId)),
      )
      .leftJoin(classes, and(eq(classes.schoolId, schoolId), eq(classes.id, students.classId)))
      .leftJoin(houses, and(eq(houses.schoolId, schoolId), eq(houses.id, students.houseId)))
      .where(
        and(
          eq(sickbayReferral.schoolId, schoolId),
          isNull(sickbayReferral.voidedAt),
          ne(sickbayReferral.status, "RETURNED"),
        ),
      )
      .orderBy(desc(sickbayReferral.departedAt));

    const ids = rows.map((r) => r.id);
    const [updates, guardians, actors] = await Promise.all([
      ids.length
        ? tx
            .select({
              referralId: sickbayReferralUpdate.referralId,
              body: sickbayReferralUpdate.body,
              clinicianName: sickbayReferralUpdate.clinicianName,
              occurredAt: sickbayReferralUpdate.occurredAt,
            })
            .from(sickbayReferralUpdate)
            .where(
              and(
                eq(sickbayReferralUpdate.schoolId, schoolId),
                inArray(sickbayReferralUpdate.referralId, ids),
              ),
            )
            .orderBy(desc(sickbayReferralUpdate.occurredAt))
        : Promise.resolve([]),
      rows.length
        ? tx
            .select({
              studentId: studentGuardians.studentId,
              name: studentGuardians.name,
              relationship: studentGuardians.relationship,
            })
            .from(studentGuardians)
            .where(
              and(
                eq(studentGuardians.schoolId, schoolId),
                inArray(studentGuardians.studentId, [...new Set(rows.map((r) => r.studentId))]),
                eq(studentGuardians.isPrimary, true),
              ),
            )
        : Promise.resolve([]),
      (() => {
        const actorIds = [...new Set(rows.map((r) => r.accompaniedByUserId).filter((x): x is string => !!x))];
        return actorIds.length
          ? tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, actorIds))
          : Promise.resolve([]);
      })(),
    ]);

    const latestByRef = new Map<string, string>();
    for (const u of updates) {
      if (!latestByRef.has(u.referralId) && u.body) {
        latestByRef.set(u.referralId, u.clinicianName ? `${u.clinicianName}: ${u.body}` : u.body);
      }
    }
    const guardianByStudent = new Map(guardians.map((g) => [g.studentId, g]));
    const actorName = (id: string | null) => shortName(actors.find((a) => a.id === id)?.name ?? null);

    const shaped: ActiveReferralRow[] = rows.map((r) => {
      const g = guardianByStudent.get(r.studentId) ?? null;
      return {
        id: r.id,
        ref: formatReferralRef(r.departedAt, r.studentCode, r.createdAt),
        studentId: r.studentId,
        firstName: r.firstName,
        lastName: r.lastName,
        shortName: shortName(`${r.firstName} ${r.lastName}`) ?? `${r.firstName} ${r.lastName}`,
        initials: initials(`${r.firstName} ${r.lastName}`),
        studentCode: r.studentCode,
        formLabel: formLabel(r.classLevel, r.className, r.programme),
        houseName: r.houseName,
        status: r.status,
        dayLabel: referralDayLabel({ status: r.status, departedAt: r.departedAt, returnedAt: r.returnedAt }, now),
        hospitalName: r.hospitalName,
        hospitalWard: r.hospitalWard,
        hospitalBed: r.hospitalBed,
        transportMode: r.transportMode,
        attendingClinicianName: r.attendingClinicianName,
        workingImpression: r.workingImpression,
        nhisCardNumber: r.nhisCardNumber,
        nhisValid: r.nhisValid,
        expectedReturnAt: r.expectedReturnAt ? r.expectedReturnAt.toISOString() : null,
        returnNote: r.returnNote,
        accompaniedByName: actorName(r.accompaniedByUserId),
        primaryGuardian: g ? { name: g.name, relationship: REL_LABEL[g.relationship] ?? "Contact" } : null,
        latestUpdate: latestByRef.get(r.id) ?? null,
      };
    });

    // Stats — counts derived, never a fabricated 27. Week/semester count DEPARTURES within the window.
    const ws = weekStart(now).getTime();
    const semStart = Date.UTC(now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1, 8, 1);
    const windowRows = await tx
      .select({
        status: sickbayReferral.status,
        departedAt: sickbayReferral.departedAt,
        returnedAt: sickbayReferral.returnedAt,
      })
      .from(sickbayReferral)
      .where(and(eq(sickbayReferral.schoolId, schoolId), isNull(sickbayReferral.voidedAt)));
    let weekTotal = 0;
    let weekReturned = 0;
    let semesterTotal = 0;
    for (const w of windowRows) {
      const dep = w.departedAt?.getTime() ?? null;
      if (dep === null) continue;
      if (dep >= semStart) semesterTotal += 1;
      if (dep >= ws) {
        weekTotal += 1;
        if (w.status === "RETURNED") weekReturned += 1;
      }
    }

    return {
      rows: shaped,
      stats: {
        activeCount: shaped.length,
        activeNames: shaped.map((r) => `${r.firstName.charAt(0)}. ${r.lastName}`),
        weekTotal,
        weekReturned,
        weekOpen: weekTotal - weekReturned,
        semesterTotal,
      },
    };
  });
}

// ============================================================================
// §02 case detail — the full clinical projection (MATRON/HEADMASTER)
// ============================================================================

export interface ReferralUpdateRow {
  id: string;
  occurredAt: Date;
  clinicianName: string | null;
  clinicianAffiliation: string | null;
  body: string | null;
  recordedByName: string | null;
}

/** 🔴 Diagnosis-free by construction — the table has NO clinical column (R185). Bursar + Matron read this same shape. */
export interface ReferralCostLine {
  id: string;
  itemLabel: string | null;
  provider: string | null;
  nhisCovered: boolean;
  outOfPocketAmount: number | null;
}

export interface ReferralDetail {
  id: string;
  ref: string;
  status: ReferralStatus;
  dayLabel: string;
  student: {
    studentId: string;
    name: string;
    firstName: string;
    lastName: string;
    initials: string;
    studentCode: string;
    dateOfBirth: string | null;
    formLabel: string;
    houseName: string | null;
    hmName: string | null;
    primaryGuardian: { name: string; relationship: string } | null;
  };
  hospital: { id: string; name: string; acceptsNhis: boolean };
  hospitalWard: string | null;
  hospitalBed: string | null;
  transportMode: string | null;
  attendingClinicianName: string | null;
  accompaniedByName: string | null;
  hmAuthorisedByName: string | null;
  hmAuthorisedAt: Date | null;
  departedAt: Date | null;
  expectedReturnAt: Date | null;
  returnedAt: Date | null;
  returnNote: string | null;
  /** 🔴 LIVE from the append-only visit — the "Diagnosis" line (R190). */
  workingImpression: string | null;
  presentingComplaint: string;
  // FROZEN write-once ER handoff (R187)
  reasonReferredOut: string;
  preReferralCare: string | null;
  handoffLabs: string | null;
  lastMeal: string | null;
  /** 🔴 Class-4 reproductive PII (F5) — clinical-read gated. */
  mensesNote: string | null;
  travelNote: string | null;
  nhisCardNumber: string | null;
  nhisValid: boolean | null;
  // R205 — a voided referral renders read-only and takes no write; the page mirrors the visit page's
  // `voided: record.voidedAt !== null` treatment and names the reason on the banner.
  voidedAt: Date | null;
  voidReason: string | null;
  updates: ReferralUpdateRow[];
  costLines: ReferralCostLine[];
}

/**
 * getReferralDetail → §02. Returns null when the id is not a referral of THIS school (the no-IDOR
 * re-resolve). Every actor name is joined and abbreviated; the client console receives pre-formatted
 * strings, never a DB row.
 */
export async function getReferralDetail(
  schoolId: string,
  referralId: string,
  now: Date,
): Promise<ReferralDetail | null> {
  return withSchool(schoolId, async (tx) => {
    const [r] = await tx
      .select()
      .from(sickbayReferral)
      .where(and(eq(sickbayReferral.schoolId, schoolId), eq(sickbayReferral.id, referralId)))
      .limit(1);
    if (!r) return null;

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
        hmUserId: houses.hmUserId,
      })
      .from(students)
      .leftJoin(classes, and(eq(classes.schoolId, schoolId), eq(classes.id, students.classId)))
      .leftJoin(houses, and(eq(houses.schoolId, schoolId), eq(houses.id, students.houseId)))
      .where(and(eq(students.schoolId, schoolId), eq(students.id, r.studentId)))
      .limit(1);
    if (!student) return null;

    const [visit] = await tx
      .select({
        workingImpression: sickbayVisit.workingImpression,
        presentingComplaint: sickbayVisit.presentingComplaint,
      })
      .from(sickbayVisit)
      .where(and(eq(sickbayVisit.schoolId, schoolId), eq(sickbayVisit.id, r.visitId)))
      .limit(1);

    const [hospital] = await tx
      .select({ id: sickbayHospital.id, name: sickbayHospital.name, acceptsNhis: sickbayHospital.acceptsNhis })
      .from(sickbayHospital)
      .where(and(eq(sickbayHospital.schoolId, schoolId), eq(sickbayHospital.id, r.hospitalId)))
      .limit(1);

    const [guardian] = await tx
      .select({ name: studentGuardians.name, relationship: studentGuardians.relationship })
      .from(studentGuardians)
      .where(
        and(
          eq(studentGuardians.schoolId, schoolId),
          eq(studentGuardians.studentId, r.studentId),
          eq(studentGuardians.isPrimary, true),
        ),
      )
      .limit(1);

    const updateRows = await tx
      .select({
        id: sickbayReferralUpdate.id,
        occurredAt: sickbayReferralUpdate.occurredAt,
        clinicianName: sickbayReferralUpdate.clinicianName,
        clinicianAffiliation: sickbayReferralUpdate.clinicianAffiliation,
        body: sickbayReferralUpdate.body,
        recordedByName: users.fullName,
      })
      .from(sickbayReferralUpdate)
      .leftJoin(users, eq(users.id, sickbayReferralUpdate.recordedByUserId))
      .where(and(eq(sickbayReferralUpdate.schoolId, schoolId), eq(sickbayReferralUpdate.referralId, r.id)))
      .orderBy(asc(sickbayReferralUpdate.occurredAt));

    const costLines = await costLinesFor(tx, schoolId, r.id);

    // Actor names — accompanied-by, HM co-signer, and the house's HM.
    const actorIds = [
      ...new Set(
        [r.accompaniedByUserId, r.hmAuthorisedByUserId, student.hmUserId].filter((x): x is string => !!x),
      ),
    ];
    const actorRows = actorIds.length
      ? await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, actorIds))
      : [];
    const nameOf = (id: string | null) => shortName(actorRows.find((a) => a.id === id)?.name ?? null);

    const fullName = `${student.firstName} ${student.lastName}`;
    return {
      id: r.id,
      ref: formatReferralRef(r.departedAt, student.studentCode, r.createdAt),
      status: r.status,
      dayLabel: referralDayLabel({ status: r.status, departedAt: r.departedAt, returnedAt: r.returnedAt }, now),
      student: {
        studentId: r.studentId,
        name: fullName,
        firstName: student.firstName,
        lastName: student.lastName,
        initials: initials(fullName),
        studentCode: student.studentCode,
        dateOfBirth: student.dateOfBirth,
        formLabel: formLabel(student.classLevel, student.className, student.programme),
        houseName: student.houseName,
        hmName: nameOf(student.hmUserId),
        primaryGuardian: guardian
          ? { name: guardian.name, relationship: REL_LABEL[guardian.relationship] ?? "Contact" }
          : null,
      },
      hospital: hospital ?? { id: r.hospitalId, name: "—", acceptsNhis: false },
      hospitalWard: r.hospitalWard,
      hospitalBed: r.hospitalBed,
      transportMode: r.transportMode,
      attendingClinicianName: r.attendingClinicianName,
      accompaniedByName: nameOf(r.accompaniedByUserId),
      hmAuthorisedByName: nameOf(r.hmAuthorisedByUserId),
      hmAuthorisedAt: r.hmAuthorisedAt,
      departedAt: r.departedAt,
      expectedReturnAt: r.expectedReturnAt,
      returnedAt: r.returnedAt,
      returnNote: r.returnNote,
      workingImpression: visit?.workingImpression ?? null,
      presentingComplaint: visit?.presentingComplaint ?? "",
      reasonReferredOut: r.reasonReferredOut,
      preReferralCare: r.preReferralCare,
      handoffLabs: r.handoffLabs,
      lastMeal: r.lastMeal,
      mensesNote: r.mensesNote,
      travelNote: r.travelNote,
      nhisCardNumber: r.nhisCardNumber,
      nhisValid: r.nhisValid,
      voidedAt: r.voidedAt,
      voidReason: r.voidReason,
      updates: updateRows.map((u) => ({ ...u, recordedByName: shortName(u.recordedByName) })),
      costLines,
    };
  });
}

// ============================================================================
// §R4 — the 30-day referral HISTORY (INCR-27 · R217/R218). CLINICAL-read gated (the page refuses a
// non-clinical reader BEFORE this runs): every row pairs a name with the visit's LIVE
// `working_impression` (the "Diagnosis" column, R190 — never re-stored). The mix aggregates are
// COUNTS-ONLY — the category walks the 7 canonical surveillance buckets via the referral→visit join
// (R218 — no separate referral-category column; SCD/asthma collapse to their assigned acute bucket).
// ============================================================================

export interface HistoryRow {
  id: string;
  departedAt: Date | null;
  studentName: string;
  initials: string;
  studentCode: string;
  formLabel: string;
  houseName: string | null;
  /** 🔴 the visit's LIVE `working_impression` — the "Diagnosis" column (R190). Clinical-read only. */
  workingImpression: string | null;
  hospitalName: string;
  hospitalDistanceKm: number | null;
  hospitalIsPrimary: boolean;
  status: ReferralStatus;
  dayLabel: string;
  nhis: NhisTriState;
  nhisLabel: string;
  outOfPocket: number;
  /** For the counts-only mix (never rendered beside a name). Null = uncategorised (pre-0063 / queued). */
  category: SurveillanceCategory | null;
}

export interface HistoryMixBar {
  key: string;
  label: string;
  count: number;
}

export interface ReferralHistory {
  range: HistoryRange;
  category: SurveillanceCategory | null;
  rows: HistoryRow[];
  total: number;
  closed: number;
  open: number;
  topCategory: { label: string; count: number } | null;
  rangeCounts: Record<HistoryRange, number>;
  categoryFacets: { key: SurveillanceCategory; label: string; count: number }[];
  categoryMix: HistoryMixBar[];
  hospitalMix: HistoryMixBar[];
  asOf: Date;
}

/**
 * getReferralHistory → §R4. Fetches non-voided referrals across the widest range (year) ONCE, joined
 * to the visit for the LIVE working_impression + surveillance_category, then derives every count in
 * JS: the range facets (30/90/term/year), the active-range table rows (optionally category-filtered),
 * and the two counts-only mix bars. Every count is derived from one query — never a copied `12`.
 */
export async function getReferralHistory(
  schoolId: string,
  now: Date,
  opts: { range: HistoryRange; category: SurveillanceCategory | null },
): Promise<ReferralHistory> {
  return withSchool(schoolId, async (tx) => {
    const yearStart = historyWindowStart("year", now);
    const rows = await tx
      .select({
        id: sickbayReferral.id,
        studentId: sickbayReferral.studentId,
        status: sickbayReferral.status,
        departedAt: sickbayReferral.departedAt,
        returnedAt: sickbayReferral.returnedAt,
        createdAt: sickbayReferral.createdAt,
        nhisValid: sickbayReferral.nhisValid,
        firstName: students.firstName,
        lastName: students.lastName,
        studentCode: students.studentCode,
        programme: students.programme,
        className: classes.name,
        classLevel: classes.level,
        houseName: houses.name,
        hospitalName: sickbayHospital.name,
        hospitalDistanceKm: sickbayHospital.distanceKm,
        hospitalIsPrimary: sickbayHospital.isPrimary,
        workingImpression: sickbayVisit.workingImpression,
        category: sickbayVisit.surveillanceCategory,
      })
      .from(sickbayReferral)
      .innerJoin(students, and(eq(students.schoolId, schoolId), eq(students.id, sickbayReferral.studentId)))
      .innerJoin(
        sickbayHospital,
        and(eq(sickbayHospital.schoolId, schoolId), eq(sickbayHospital.id, sickbayReferral.hospitalId)),
      )
      .innerJoin(
        sickbayVisit,
        and(eq(sickbayVisit.schoolId, schoolId), eq(sickbayVisit.id, sickbayReferral.visitId)),
      )
      .leftJoin(classes, and(eq(classes.schoolId, schoolId), eq(classes.id, students.classId)))
      .leftJoin(houses, and(eq(houses.schoolId, schoolId), eq(houses.id, students.houseId)))
      .where(
        and(
          eq(sickbayReferral.schoolId, schoolId),
          isNull(sickbayReferral.voidedAt),
          gte(sickbayReferral.departedAt, yearStart),
        ),
      )
      .orderBy(desc(sickbayReferral.departedAt));

    // Σ out-of-pocket per referral — the diagnosis-free cost lines, fetched once for the whole set.
    const ids = rows.map((r) => r.id);
    const costRows = ids.length
      ? await tx
          .select({
            referralId: sickbayReferralCostLine.referralId,
            outOfPocket: sickbayReferralCostLine.outOfPocketAmount,
          })
          .from(sickbayReferralCostLine)
          .where(
            and(
              eq(sickbayReferralCostLine.schoolId, schoolId),
              inArray(sickbayReferralCostLine.referralId, ids),
            ),
          )
      : [];
    const oopByRef = new Map<string, number>();
    for (const c of costRows) {
      oopByRef.set(c.referralId, (oopByRef.get(c.referralId) ?? 0) + Number(c.outOfPocket ?? 0));
    }

    const refDate = (r: (typeof rows)[number]) => (r.departedAt ?? r.createdAt).getTime();
    const inWindow = (r: (typeof rows)[number], range: HistoryRange) =>
      refDate(r) >= historyWindowStart(range, now).getTime();

    const rangeCounts = Object.fromEntries(
      HISTORY_RANGES.map((rg) => [rg, rows.filter((r) => inWindow(r, rg)).length]),
    ) as Record<HistoryRange, number>;

    const windowRows = rows.filter((r) => inWindow(r, opts.range));

    // Counts-only mixes over the active range (NOT category-filtered — they analyse the whole window).
    const categoryMix: HistoryMixBar[] = SURVEILLANCE_CATEGORY_VALUES.map((key) => ({
      key,
      label: SURVEILLANCE_CATEGORY_META[key].short,
      count: windowRows.filter((r) => r.category === key).length,
    })).filter((b) => b.count > 0);
    categoryMix.sort((a, b) => b.count - a.count);

    const hospitalMixMap = new Map<string, number>();
    for (const r of windowRows) hospitalMixMap.set(r.hospitalName, (hospitalMixMap.get(r.hospitalName) ?? 0) + 1);
    const hospitalMix: HistoryMixBar[] = [...hospitalMixMap.entries()]
      .map(([label, count]) => ({ key: label, label, count }))
      .sort((a, b) => b.count - a.count);

    const categoryFacets = SURVEILLANCE_CATEGORY_VALUES.map((key) => ({
      key,
      label: SURVEILLANCE_CATEGORY_META[key].short,
      count: windowRows.filter((r) => r.category === key).length,
    })).filter((f) => f.count > 0);

    const tableRows = opts.category
      ? windowRows.filter((r) => r.category === opts.category)
      : windowRows;

    const shaped: HistoryRow[] = tableRows.map((r) => {
      const oop = oopByRef.get(r.id) ?? 0;
      const nhis = nhisTriState(r.nhisValid, oop);
      const fullName = `${r.firstName} ${r.lastName}`;
      return {
        id: r.id,
        departedAt: r.departedAt,
        studentName: fullName,
        initials: initials(fullName),
        studentCode: r.studentCode,
        formLabel: formLabel(r.classLevel, r.className, r.programme),
        houseName: r.houseName,
        workingImpression: r.workingImpression,
        hospitalName: r.hospitalName,
        hospitalDistanceKm: r.hospitalDistanceKm === null ? null : Number(r.hospitalDistanceKm),
        hospitalIsPrimary: r.hospitalIsPrimary,
        status: r.status,
        dayLabel: referralDayLabel(
          { status: r.status, departedAt: r.departedAt, returnedAt: r.returnedAt },
          now,
        ),
        nhis,
        nhisLabel: NHIS_TRISTATE_LABEL[nhis],
        outOfPocket: oop,
        category: r.category,
      };
    });

    return {
      range: opts.range,
      category: opts.category,
      rows: shaped,
      total: windowRows.length,
      closed: windowRows.filter((r) => r.status === "RETURNED").length,
      open: windowRows.filter((r) => r.status !== "RETURNED").length,
      topCategory: categoryMix[0] ? { label: categoryMix[0].label, count: categoryMix[0].count } : null,
      rangeCounts,
      categoryFacets,
      categoryMix,
      hospitalMix,
      asOf: now,
    };
  });
}

// ============================================================================
// 🔴 The BURSAR projection (R195) — diagnosis-free cost lines. Same shape the MATRON reads at §02.
// ============================================================================

async function costLinesFor(tx: Tx, schoolId: string, referralId: string): Promise<ReferralCostLine[]> {
  const rows = await tx
    .select({
      id: sickbayReferralCostLine.id,
      itemLabel: sickbayReferralCostLine.itemLabel,
      provider: sickbayReferralCostLine.provider,
      nhisCovered: sickbayReferralCostLine.nhisCovered,
      outOfPocketAmount: sickbayReferralCostLine.outOfPocketAmount,
    })
    .from(sickbayReferralCostLine)
    .where(and(eq(sickbayReferralCostLine.schoolId, schoolId), eq(sickbayReferralCostLine.referralId, referralId)))
    .orderBy(asc(sickbayReferralCostLine.id));
  return rows.map((c) => ({
    id: c.id,
    itemLabel: c.itemLabel,
    provider: c.provider,
    nhisCovered: c.nhisCovered,
    outOfPocketAmount: c.outOfPocketAmount === null ? null : Number(c.outOfPocketAmount),
  }));
}

/**
 * 🔴 R195 — the diagnosis-free cost-line reader the BURSAR consumes at INCR-27's reconciliation. It
 * selects ONLY item · provider · nhis_covered · out_of_pocket — the table has NO clinical column, so
 * re-identifying a condition through it is impossible BY CONSTRUCTION (structural Risk-4), not by a
 * render-time trim. Total out-of-pocket is DERIVED here, never stored.
 */
export async function getReferralCostLines(
  schoolId: string,
  referralId: string,
): Promise<{ lines: ReferralCostLine[]; totalOutOfPocket: number }> {
  return withSchool(schoolId, async (tx) => {
    const lines = await costLinesFor(tx, schoolId, referralId);
    return { lines, totalOutOfPocket: lines.reduce((s, l) => s + (l.outOfPocketAmount ?? 0), 0) };
  });
}

// ============================================================================
// 🔴 §R5 — the NHIS RECONCILIATION (INCR-27 · R219/R220). FINANCE-gated, STRUCTURALLY clinical-free:
// this reader joins ONLY sickbay_referral + sickbay_referral_cost_line + students, NEVER the visit —
// the cost line has no clinical column, and a BURSAR reading this must be incapable of seeing a
// condition (Risk-4, A12). It renders the cost reason (the item label — "cast materials", "IV
// artesunate course"), the age and the payment-relevant NHIS fact, and drops the surface's condition
// fragments (demo drift). NO invoice write (billing_line_item_id stays NULL, D6); NO SMS. The whole
// region below is swept by referral-projection.test.ts's RF3 for a smuggled clinical field/join.
// ============================================================================

export interface ReconOutstandingRow {
  referralId: string;
  studentName: string;
  initials: string;
  studentCode: string;
  formLabel: string;
  houseName: string | null;
  departedAt: Date | null;
  /** The cost REASON from the cost-line item (never a condition) + a generic tag when unlabelled. */
  itemLabel: string;
  outOfPocket: number;
  nhis: NhisTriState;
  nhisLabel: string;
  ageDays: number | null;
  overThirty: boolean;
}

export interface NhisReconciliation {
  totalOutstanding: number;
  familyCount: number;
  overThirtyCount: number;
  withinWindowCount: number;
  /** N of M referrals fully covered (30-day window) — the COUNT that replaces the omitted cedi tile. */
  coveredCount: number;
  referralCount: number;
  averageParentCost: number | null;
  rows: ReconOutstandingRow[];
  asOf: Date;
}

/**
 * getNhisReconciliation → §R5. Aggregates the diagnosis-free cost lines over unbilled out-of-pocket:
 * the outstanding total (Σ OOP > 0, aged by referral date), the covered count, and the average parent
 * cost. Two flat statements (referrals + their cost lines), everything else derived in JS.
 */
export async function getNhisReconciliation(
  schoolId: string,
  now: Date,
): Promise<NhisReconciliation> {
  return withSchool(schoolId, async (tx) => {
    const yearStart = historyWindowStart("year", now);
    const refs = await tx
      .select({
        id: sickbayReferral.id,
        departedAt: sickbayReferral.departedAt,
        createdAt: sickbayReferral.createdAt,
        nhisValid: sickbayReferral.nhisValid,
        firstName: students.firstName,
        lastName: students.lastName,
        studentId: sickbayReferral.studentId,
        studentCode: students.studentCode,
        programme: students.programme,
        className: classes.name,
        classLevel: classes.level,
        houseName: houses.name,
      })
      .from(sickbayReferral)
      .innerJoin(students, and(eq(students.schoolId, schoolId), eq(students.id, sickbayReferral.studentId)))
      .leftJoin(classes, and(eq(classes.schoolId, schoolId), eq(classes.id, students.classId)))
      .leftJoin(houses, and(eq(houses.schoolId, schoolId), eq(houses.id, students.houseId)))
      .where(
        and(
          eq(sickbayReferral.schoolId, schoolId),
          isNull(sickbayReferral.voidedAt),
          gte(sickbayReferral.departedAt, yearStart),
        ),
      );

    const ids = refs.map((r) => r.id);
    const costRows = ids.length
      ? await tx
          .select({
            referralId: sickbayReferralCostLine.referralId,
            itemLabel: sickbayReferralCostLine.itemLabel,
            outOfPocket: sickbayReferralCostLine.outOfPocketAmount,
          })
          .from(sickbayReferralCostLine)
          .where(
            and(
              eq(sickbayReferralCostLine.schoolId, schoolId),
              inArray(sickbayReferralCostLine.referralId, ids),
            ),
          )
      : [];
    const oopByRef = new Map<string, number>();
    const reasonByRef = new Map<string, string[]>();
    for (const c of costRows) {
      const oop = Number(c.outOfPocket ?? 0);
      oopByRef.set(c.referralId, (oopByRef.get(c.referralId) ?? 0) + oop);
      if (oop > 0 && c.itemLabel) {
        const parts = reasonByRef.get(c.referralId) ?? [];
        if (!parts.includes(c.itemLabel)) parts.push(c.itemLabel);
        reasonByRef.set(c.referralId, parts);
      }
    }

    const DAY = 86_400_000;
    const refDate = (r: (typeof refs)[number]) => (r.departedAt ?? r.createdAt).getTime();
    const in30d = (r: (typeof refs)[number]) => refDate(r) >= historyWindowStart("30d", now).getTime();

    // 30-day window: the covered count + the average parent cost.
    const window = refs.filter(in30d);
    const referralCount = window.length;
    const coveredCount = window.filter((r) => (oopByRef.get(r.id) ?? 0) === 0).length;
    const windowOop = window.reduce((s, r) => s + (oopByRef.get(r.id) ?? 0), 0);
    const averageParentCost = referralCount > 0 ? windowOop / referralCount : null;

    // Outstanding: every referral carrying an out-of-pocket gap (all dates), aged by referral date.
    const outstanding = refs.filter((r) => (oopByRef.get(r.id) ?? 0) > 0);
    const rows: ReconOutstandingRow[] = outstanding
      .map((r) => {
        const oop = oopByRef.get(r.id) ?? 0;
        const ageDays = r.departedAt ? Math.floor((now.getTime() - r.departedAt.getTime()) / DAY) : null;
        const nhis = nhisTriState(r.nhisValid, oop);
        const fullName = `${r.firstName} ${r.lastName}`;
        return {
          referralId: r.id,
          studentName: fullName,
          initials: initials(fullName),
          studentCode: r.studentCode,
          formLabel: formLabel(r.classLevel, r.className, r.programme),
          houseName: r.houseName,
          departedAt: r.departedAt,
          itemLabel: (reasonByRef.get(r.id) ?? []).join(" · ") || "Sickbay referral",
          outOfPocket: oop,
          nhis,
          nhisLabel: NHIS_TRISTATE_LABEL[nhis],
          ageDays,
          overThirty: ageDays !== null && ageDays > 30,
        };
      })
      .sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));

    const families = new Set(outstanding.map((r) => r.studentId));
    const overThirtyFamilies = new Set(
      rows.filter((r) => r.overThirty).map((r) => refs.find((x) => x.id === r.referralId)?.studentId),
    );

    return {
      totalOutstanding: rows.reduce((s, r) => s + r.outOfPocket, 0),
      familyCount: families.size,
      overThirtyCount: overThirtyFamilies.size,
      withinWindowCount: families.size - overThirtyFamilies.size,
      coveredCount,
      referralCount,
      averageParentCost,
      rows,
      asOf: now,
    };
  });
}
