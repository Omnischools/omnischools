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
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
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
