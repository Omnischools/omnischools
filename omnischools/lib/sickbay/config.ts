/**
 * SERVER-ONLY sickbay config read API (SHS module 4.4 / INCR-21) — THE FROZEN CONTRACT.
 * Every downstream sickbay increment (22–28) reads config through these getters and NEVER
 * re-derives it, so the shape is load-bearing: a field rename later is a cross-increment break.
 * Imports the DB driver via withSchool — must NEVER be imported by a client component (the page
 * passes plain serializable props down). All reads are tenant-scoped; RLS is the boundary.
 *
 * The pure shaping (capabilities, coalesce, day-type labels, bed reconcile) lives in ./defaults and
 * is unit-tested without the DB. This file only fetches rows and delegates.
 */
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  boardingBunk,
  boardingDormitory,
  classes,
  houses,
  roleAssignments,
  roles,
  sickbayBed,
  sickbayScheduleSlot,
  sickbaySettings,
  staffProfiles,
  students,
  users,
} from "@/db/schema";
import {
  coalesceSickbayConfig,
  formLabel,
  roundSchedule,
  sortSlots,
  staffDesignation,
  type SickbayBed,
  type SickbayConfig,
  type SickbayMode,
  type SickbaySlot,
  type SickbayStaffPost,
} from "./defaults";

// Re-export the contract so consumers import everything from one place.
export type {
  PolicyAnchor,
  SickbayBed,
  SickbayBedCounts,
  SickbayCapabilities,
  SickbayConfig,
  SickbayMode,
  SickbaySlot,
  SickbaySlotKind,
  SickbayStaffPost,
} from "./defaults";

/** One clinical-staff row. The visiting doctor is the ONLY post with a null userId (R21 · AC D4). */
export interface SickbayStaffMember {
  post: SickbayStaffPost;
  userId: string | null;
  name: string;
  designation: string;
  nmcLicenceNumber: string | null;
  affiliation: string | null;
}

/** A health prefect — DERIVED from boarding_bunk.prefect_role = 'SICKBAY' (R23). Zero storage. */
export interface SickbayHealthPrefect {
  studentId: string;
  /** "F. Tetteh" — initial + surname, abbreviated at render, never stored abbreviated. */
  shortName: string;
  initials: string;
  formLabel: string; // "F3 BUS"
  houseName: string;
}

/** A user who holds MATRON in THIS school — the only eligible pointer target (R20 · AC D2/D3). */
export interface MatronCandidate {
  id: string;
  name: string;
}

/** Every bed row, active and retired, ordered by the stable bed number. Internal. */
async function readBeds(schoolId: string): Promise<SickbayBed[]> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        id: sickbayBed.id,
        bedNumber: sickbayBed.bedNumber,
        isIsolation: sickbayBed.isIsolation,
        active: sickbayBed.active,
      })
      .from(sickbayBed)
      .where(eq(sickbayBed.schoolId, schoolId));
    return rows.sort((a, b) => a.bedNumber - b.bedNumber);
  });
}

/**
 * getSickbayConfig → every sickbay surface. A school with NO sickbay_settings row is legal and
 * meaningful: it coalesces to mode REFERRAL_ONLY + configured:false + zero counts (R25 · AC A5) —
 * never null, never a throw, never a fabricated capacity. `bedCounts` derives by counting the
 * ACTIVE bed rows (AC B1); there is deliberately no stored scalar to disagree with them.
 */
export async function getSickbayConfig(schoolId: string): Promise<SickbayConfig> {
  const [row, beds] = await Promise.all([
    withSchool(schoolId, async (tx) => {
      const [r] = await tx
        .select({
          mode: sickbaySettings.mode,
          matronUserId: sickbaySettings.matronUserId,
          assistantMatronUserId: sickbaySettings.assistantMatronUserId,
          visitingDoctorName: sickbaySettings.visitingDoctorName,
          visitingDoctorAffiliation: sickbaySettings.visitingDoctorAffiliation,
          configuredAt: sickbaySettings.configuredAt,
        })
        .from(sickbaySettings)
        .where(eq(sickbaySettings.schoolId, schoolId))
        .limit(1);
      return r ?? null;
    }),
    readBeds(schoolId),
  ]);
  return coalesceSickbayConfig(schoolId, row, beds);
}

/**
 * getScheduleSlots → the §2 hours table, INCR-23's med grid, INCR-24's rounds. Chronological.
 * Rows are returned in EVERY mode — a mode change is an affordance filter, never a data filter, so
 * a REFERRAL_ONLY school's stored slots come back intact and a switch back renders them identically
 * (R6 · AC A6). The caller decides whether to render them.
 */
export async function getScheduleSlots(schoolId: string): Promise<SickbaySlot[]> {
  const rows = await withSchool(schoolId, async (tx) =>
    tx
      .select({
        id: sickbayScheduleSlot.id,
        kind: sickbayScheduleSlot.kind,
        label: sickbayScheduleSlot.label,
        description: sickbayScheduleSlot.description,
        startsAt: sickbayScheduleSlot.startsAt,
        endsAt: sickbayScheduleSlot.endsAt,
        staffing: sickbayScheduleSlot.staffing,
        daysOfWeek: sickbayScheduleSlot.daysOfWeek,
        runsOnHolidays: sickbayScheduleSlot.runsOnHolidays,
        isAnchor: sickbayScheduleSlot.isAnchor,
        active: sickbayScheduleSlot.active,
      })
      .from(sickbayScheduleSlot)
      .where(eq(sickbayScheduleSlot.schoolId, schoolId)),
  );
  return sortSlots(rows);
}

/**
 * getRoundSchedule → INCR-24 fires exactly these. The ACTIVE MEDICATION_ROUND subset, ANCHOR FIRST,
 * then chronological (R24) — so "morning round" can never sort after the evening one, and a round
 * the headmaster switched off never fires.
 */
export async function getRoundSchedule(schoolId: string): Promise<SickbaySlot[]> {
  return roundSchedule(await getScheduleSlots(schoolId));
}

/**
 * The clinical-staff card. Senior vs Assistant Matron is the SAME MATRON role distinguished only by
 * WHICH pointer holds them (R20) — no seniority column, no sickbay_staff table, no new role. The
 * visiting doctor is text only: no ref_user, no role_assignment, no invite, no login (R21 · AC D4).
 *
 * Takes the config ALONE — it already carries `schoolId`, and a separate id argument could be
 * mismatched with it, rendering school A's doctor under school B with nothing to catch it.
 */
export async function getClinicalStaff(config: SickbayConfig): Promise<SickbayStaffMember[]> {
  const schoolId = config.schoolId;
  const posts: { post: SickbayStaffPost; userId: string }[] = [];
  if (config.matronUserId) posts.push({ post: "SENIOR_MATRON", userId: config.matronUserId });
  if (config.assistantMatronUserId) {
    posts.push({ post: "ASSISTANT_MATRON", userId: config.assistantMatronUserId });
  }

  const people = posts.length
    ? await withSchool(schoolId, async (tx) =>
        tx
          .select({
            id: users.id,
            name: users.fullName,
            nmcLicenceNumber: staffProfiles.nmcLicenceNumber,
          })
          .from(users)
          .leftJoin(
            staffProfiles,
            and(eq(staffProfiles.userId, users.id), eq(staffProfiles.schoolId, schoolId)),
          )
          .where(
            inArray(
              users.id,
              posts.map((p) => p.userId),
            ),
          ),
      )
    : [];

  const staff: SickbayStaffMember[] = posts.flatMap((p) => {
    const person = people.find((u) => u.id === p.userId);
    if (!person) return []; // pointer dangling (user removed) → omit the row, never a blank card
    return [
      {
        post: p.post,
        userId: p.userId,
        name: person.name ?? "Unnamed staff",
        designation: staffDesignation(p.post, config.mode),
        nmcLicenceNumber: person.nmcLicenceNumber ?? null,
        affiliation: null,
      },
    ];
  });

  // R4 — REFERRAL_ONLY disables the visiting doctor. The row is HIDDEN, never deleted: the name and
  // affiliation stay on the settings row and reappear untouched on a switch back (AC A6). Rendering
  // a weekly doctor beside "no on-site clinical capacity" would contradict the declared mode.
  if (config.visitingDoctorName && config.capabilities.visitingDoctor) {
    staff.push({
      post: "VISITING_DOCTOR",
      userId: null, // AC D4 — an external clinician is never a tenant identity
      name: config.visitingDoctorName,
      designation: staffDesignation("VISITING_DOCTOR", config.mode),
      nmcLicenceNumber: null,
      affiliation: config.visitingDoctorAffiliation,
    });
  }
  return staff;
}

/**
 * The School Health Prefect roster — a DERIVED READ of boarding_bunk.prefect_role = 'SICKBAY'
 * (R23), joined to the student occupying that bunk. Zero new storage and real referential
 * integrity: BUILD_STACK's `school_health_prefect_student_ids JSONB` was rejected because an id
 * array is un-FK-able, so it could not carry the composite (school_id, id) tenant FK — a foreign
 * school's student id could be written in with nothing to stop it.
 *
 * Zero marked bunks (or marked-but-vacant bunks) returns an EMPTY array; the caller renders an
 * honest empty state pointing at Boarding, never a fabricated roster or a count of 6 (AC D6/D7).
 */
export async function getHealthPrefects(schoolId: string): Promise<SickbayHealthPrefect[]> {
  const rows = await withSchool(schoolId, async (tx) =>
    tx
      .select({
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        programme: students.programme,
        className: classes.name,
        classLevel: classes.level,
        houseName: houses.name,
      })
      .from(boardingBunk)
      .innerJoin(students, eq(students.currentBunkId, boardingBunk.id))
      .innerJoin(boardingDormitory, eq(boardingDormitory.id, boardingBunk.dormitoryId))
      .innerJoin(houses, eq(houses.id, boardingDormitory.houseId))
      .leftJoin(classes, eq(classes.id, students.classId))
      .where(
        and(
          eq(boardingBunk.schoolId, schoolId),
          eq(boardingBunk.prefectRole, "SICKBAY"),
          eq(students.status, "ACTIVE"),
        ),
      ),
  );
  return rows
    .map((r) => ({
      studentId: r.studentId,
      shortName: `${r.firstName.charAt(0)}. ${r.lastName}`,
      initials: `${r.firstName.charAt(0)}${r.lastName.charAt(0)}`.toUpperCase(),
      formLabel: formLabel(r.classLevel, r.className, r.programme),
      houseName: r.houseName,
    }))
    .sort((a, b) => a.houseName.localeCompare(b.houseName));
}

/**
 * Users holding MATRON in THIS school — the only legal targets for either matron pointer (R20).
 * Validated at the APP layer, never a cross-table DB trigger (the boarding "Kofi trap J3"
 * precedent): business logic lives in lib/, so it stays portable and testable.
 */
export async function getMatronCandidates(schoolId: string): Promise<MatronCandidate[]> {
  const rows = await withSchool(schoolId, async (tx) =>
    tx
      .selectDistinct({ id: users.id, name: users.fullName })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .innerJoin(users, eq(users.id, roleAssignments.userId))
      .where(and(eq(roleAssignments.schoolId, schoolId), eq(roles.code, "MATRON"))),
  );
  return rows
    .map((r) => ({ id: r.id, name: r.name ?? "Unnamed staff" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True when `userId` holds MATRON in this school. The write-path guard behind the picker. */
export async function holdsMatronRole(schoolId: string, userId: string): Promise<boolean> {
  const candidates = await getMatronCandidates(schoolId);
  return candidates.some((c) => c.id === userId);
}

/** Narrowing helper for action input — keeps the enum in one place. */
export const SICKBAY_MODES: readonly SickbayMode[] = ["FULL", "FIRST_AID", "REFERRAL_ONLY"];
