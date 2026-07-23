/**
 * SERVER-ONLY read API for the CHRONIC REGISTER (SHS module 4.4 / INCR-23a) — the third RLS boundary,
 * from the application side. Imports the DB driver via `withStaffScope`, so it must NEVER be imported
 * by a client component: the pages fetch through these readers, pre-format into plain strings/scalars,
 * and pass a PINNED VIEW TYPE down (R120 / MEDIUM-3 — never a chronic-entry row).
 *
 * 🔴 R115 — THE GATE IS THE FIRST STATEMENT, before any query. `isStaff(actor.roles)` false ⇒ `null`
 * and ZERO SQL (the today-board ADMIN property). A staffer with no resolvable identity reads nothing.
 *
 * 🔴 R113 — THE ROW FILTER IS `id IN (SELECT chronic_entry_ids(school, su))`, the SAME
 * SECURITY-DEFINER function the `staff_grant_scope` policy calls. NEVER a hand-written
 * `EXISTS (SELECT 1 FROM sickbay_chronic_grant …)` in the reader — RLS applies to that subquery and
 * it fails CLOSED for a grantee. Two enforcement points, one predicate:
 *   • on DEV the app connects as a superuser, so RLS is bypassed and THIS explicit filter is what
 *     scopes the read (plus `eq(school_id)` for tenancy);
 *   • on PROD the app is `omnischools_app` (non-superuser) and the RESTRICTIVE policy enforces the
 *     same set — the verifier (scripts/verify-sickbay-grant-boundary.ts) proves that half.
 *
 * 🔴 R116 — a HEADMASTER's `chronic_entry_ids` excludes MENTAL_HEALTH inside the function, so his SQL
 * cannot return the row whatever this reader does. Counts are therefore READER-DEPENDENT (a Headmaster
 * sees 5 of 6, R74 evaluated per reader).
 *
 * 🔴 MEDIUM-3 — RLS is row-level and cannot mask COLUMNS, so a 23b DIRECTIVE grantee's row carries the
 * whole entry at the DB. 23a's readers are the DEFAULT clinical roles only (MATRON all; HEADMASTER
 * all-but-MENTAL_HEALTH), which legitimately see everything — but the return shape is a PINNED view
 * type so 23b adds a per-scope projection by returning a NARROWER key-set, not by trimming a
 * `select *` that already leaked.
 */
import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { withStaffScope } from "@/lib/db/rls";
import {
  classes,
  houses,
  sickbayAdmission,
  sickbayChronicEntry,
  sickbayChronicGrant,
  sickbayChronicMed,
  sickbayChronicRead,
  sickbaySettings,
  sickbayVisit,
  students,
  studentGuardians,
  users,
} from "@/db/schema";
import { isStaff } from "@/lib/access";
import { civilDate } from "./visits";
import { formLabel, initials as avatarInitials } from "./defaults";
import { getRoundSchedule } from "./config";
import { medicationLine, roundColumns, conditionLabel as conditionWords } from "./chronic-copy";
import type {
  ChronicChip,
  ChronicCondition,
  ChronicMedView,
  ChronicPlanEntryView,
  ChronicPlanView,
  ChronicRegisterRow,
  ChronicStatus,
} from "./chronic-copy";

/** The actor shape (R119) — the field is `userId`, never an ambiguous `id`, so a tier cannot collapse. */
export interface ChronicActor {
  userId: string | null;
  roles: readonly string[];
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
 * The ONE row filter, as a drizzle SQL fragment: the readable-entry-id set for (school, staff user).
 * Passing the ids as bound constants keeps the sub-select UNCORRELATED (Wells OQ1 #3) — evaluated
 * once per query as an InitPlan, not re-run per row.
 */
const readableEntryFilter = (schoolId: string, userId: string) =>
  sql`${sickbayChronicEntry.id} in (select chronic_entry_ids(${schoolId}::uuid, ${userId}::uuid))`;

/** Live = not revoked and not expired against the DB's own now() in THIS transaction (R114). */
const grantIsLive = sql`${sickbayChronicGrant.revokedAt} is null and (${sickbayChronicGrant.expiresAt} is null or ${sickbayChronicGrant.expiresAt} > now())`;

/** Sort key: Active crisis → Monitor → Referral-managed → Stable (§3.3), then surname. */
function orderRank(status: ChronicStatus, referralManaged: boolean): number {
  if (status === "ACTIVE_CRISIS") return 0;
  if (status === "MONITOR") return 1;
  if (referralManaged) return 2;
  return 3;
}

/**
 * §01 — the register list, or `null` for a non-staff reader (zero SQL). Rows are the reader's VISIBLE
 * SET: `id IN (SELECT chronic_entry_ids(...))`. One `withStaffScope` transaction, a small fixed number
 * of bounded queries, flat as the register grows (R68). The clinical NARRATIVE columns
 * (condition_detail, emergency_protocol, triggers…) are NOT SELECTED here — the list is board-shaped
 * (C-ladder), so a list projection is structurally incapable of carrying tier-4 prose.
 */
export async function getChronicRegister(
  schoolId: string,
  actor: ChronicActor,
  _now: Date,
): Promise<ChronicRegisterRow[] | null> {
  if (!isStaff(actor.roles)) return null; // R115 — literal first statement, zero SQL
  const userId = actor.userId;
  if (!userId) return [];

  return withStaffScope(schoolId, userId, async (tx) => {
    const entries = await tx
      .select({
        id: sickbayChronicEntry.id,
        studentId: sickbayChronicEntry.studentId,
        condition: sickbayChronicEntry.condition,
        conditionLabel: sickbayChronicEntry.conditionLabel,
        status: sickbayChronicEntry.status,
        referralManaged: sickbayChronicEntry.referralManaged,
        reviewedAt: sickbayChronicEntry.reviewedAt,
        firstName: students.firstName,
        lastName: students.lastName,
        studentCode: students.studentCode,
        programme: students.programme,
        className: classes.name,
        classLevel: classes.level,
        houseName: houses.name,
      })
      .from(sickbayChronicEntry)
      .innerJoin(
        students,
        and(eq(students.schoolId, schoolId), eq(students.id, sickbayChronicEntry.studentId)),
      )
      .leftJoin(classes, and(eq(classes.schoolId, schoolId), eq(classes.id, students.classId)))
      .leftJoin(houses, and(eq(houses.schoolId, schoolId), eq(houses.id, students.houseId)))
      .where(
        and(
          eq(sickbayChronicEntry.schoolId, schoolId),
          eq(sickbayChronicEntry.active, true),
          readableEntryFilter(schoolId, userId),
        ),
      );
    if (entries.length === 0) return [];

    const entryIds = entries.map((e) => e.id);
    const studentIds = [...new Set(entries.map((e) => e.studentId))];

    const [meds, grants, visits, openAdms] = await Promise.all([
      tx
        .select({
          entryId: sickbayChronicMed.entryId,
          drugName: sickbayChronicMed.drugName,
          doseLabel: sickbayChronicMed.doseLabel,
          isPrn: sickbayChronicMed.isPrn,
        })
        .from(sickbayChronicMed)
        .where(
          and(
            eq(sickbayChronicMed.schoolId, schoolId),
            inArray(sickbayChronicMed.entryId, entryIds),
          ),
        ),
      // Live grants the reader may see — access metadata, 0 until 23b issues any. ponytail: a
      // house-tied grant's House liveness (R107) refines this in 23b; with no grants issued it is 0.
      tx
        .select({ entryId: sickbayChronicGrant.entryId })
        .from(sickbayChronicGrant)
        .where(
          and(
            eq(sickbayChronicGrant.schoolId, schoolId),
            inArray(sickbayChronicGrant.entryId, entryIds),
            grantIsLive,
          ),
        ),
      tx
        .select({ studentId: sickbayVisit.studentId, presentedAt: sickbayVisit.presentedAt })
        .from(sickbayVisit)
        .where(
          and(
            eq(sickbayVisit.schoolId, schoolId),
            inArray(sickbayVisit.studentId, studentIds),
            isNull(sickbayVisit.voidedAt),
          ),
        ),
      tx
        .select({ studentId: sickbayAdmission.studentId })
        .from(sickbayAdmission)
        .where(
          and(
            eq(sickbayAdmission.schoolId, schoolId),
            inArray(sickbayAdmission.studentId, studentIds),
            isNull(sickbayAdmission.dischargedAt),
          ),
        ),
    ]);

    const grantCountByEntry = new Map<string, number>();
    for (const g of grants) grantCountByEntry.set(g.entryId, (grantCountByEntry.get(g.entryId) ?? 0) + 1);
    const lastVisitByStudent = new Map<string, Date>();
    for (const v of visits) {
      const cur = lastVisitByStudent.get(v.studentId);
      if (!cur || v.presentedAt > cur) lastVisitByStudent.set(v.studentId, v.presentedAt);
    }
    const admittedStudents = new Set(openAdms.map((a) => a.studentId));

    const rows: ChronicRegisterRow[] = entries.map((e) => {
      const entryMeds = meds.filter((m) => m.entryId === e.id);
      return {
        studentId: e.studentId,
        studentName: `${e.firstName} ${e.lastName}`,
        initials: avatarInitials(`${e.firstName} ${e.lastName}`),
        formLabel: formLabel(e.classLevel, e.className, e.programme),
        houseName: e.houseName,
        studentCode: e.studentCode,
        condition: e.condition as ChronicCondition,
        conditionLabel: e.conditionLabel,
        status: e.status as ChronicStatus,
        referralManaged: e.referralManaged,
        medicationLine: medicationLine(entryMeds),
        lastVisitAt: lastVisitByStudent.get(e.studentId) ?? null,
        admittedNow: admittedStudents.has(e.studentId),
        grantCount: grantCountByEntry.get(e.id) ?? 0,
        reviewedAt: e.reviewedAt,
      };
    });

    rows.sort(
      (a, b) =>
        orderRank(a.status, a.referralManaged) - orderRank(b.status, b.referralManaged) ||
        a.studentName.localeCompare(b.studentName),
    );
    return rows;
  });
}

/**
 * §02 / §03 — the care-plan detail for ONE student, or `null` when the student has NO entry this reader
 * may see. 🔴 R118 — `null` is INDISTINGUISHABLE from "no such student": the caller `notFound()`s both,
 * because membership of the register is itself medical information.
 *
 * 🔴 R121 — writes exactly one `sickbay_chronic_read` row per (actor × entry × civil day), ON CONFLICT
 * DO NOTHING, no read-before-write, NO `.returning()` (a grantee has INSERT but not SELECT — MEDIUM-1).
 * The matron's own opens ARE audited. Scope is `null` at 23a (read under the default clinical role).
 */
export async function getChronicPlan(
  schoolId: string,
  studentId: string,
  actor: ChronicActor,
  now: Date,
): Promise<ChronicPlanView | null> {
  if (!isStaff(actor.roles)) return null; // R115
  const userId = actor.userId;
  if (!userId) return null;

  const rounds = await getRoundSchedule(schoolId);
  const anchor = rounds.find((r) => r.isAnchor) ?? null;

  return withStaffScope(schoolId, userId, async (tx) => {
    const rows = await tx
      .select({
        id: sickbayChronicEntry.id,
        condition: sickbayChronicEntry.condition,
        conditionLabel: sickbayChronicEntry.conditionLabel,
        status: sickbayChronicEntry.status,
        referralManaged: sickbayChronicEntry.referralManaged,
        onSiteTreatable: sickbayChronicEntry.onSiteTreatable,
        hmRestricted: sickbayChronicEntry.hmRestricted,
        version: sickbayChronicEntry.version,
        reviewedAt: sickbayChronicEntry.reviewedAt,
        reviewedByName: users.fullName,
        coReviewerNote: sickbayChronicEntry.coReviewerNote,
        conditionDetail: sickbayChronicEntry.conditionDetail,
        baselineStatus: sickbayChronicEntry.baselineStatus,
        careGoals: sickbayChronicEntry.careGoals,
        emergencyProtocol: sickbayChronicEntry.emergencyProtocol,
        dischargeCriteria: sickbayChronicEntry.dischargeCriteria,
        triggers: sickbayChronicEntry.triggers,
        redFlags: sickbayChronicEntry.redFlags,
        firstAction: sickbayChronicEntry.firstAction,
        externalClinicalHome: sickbayChronicEntry.externalClinicalHome,
        externalPastoralHome: sickbayChronicEntry.externalPastoralHome,
        externalCareCadence: sickbayChronicEntry.externalCareCadence,
        externalNextVisitAt: sickbayChronicEntry.externalNextVisitAt,
      })
      .from(sickbayChronicEntry)
      .leftJoin(
        users,
        eq(users.id, sickbayChronicEntry.reviewedByUserId),
      )
      .where(
        and(
          eq(sickbayChronicEntry.schoolId, schoolId),
          eq(sickbayChronicEntry.studentId, studentId),
          eq(sickbayChronicEntry.active, true),
          readableEntryFilter(schoolId, userId),
        ),
      )
      .orderBy(desc(sickbayChronicEntry.updatedAt));
    if (rows.length === 0) return null; // R118 — same as "no such student"

    const entryIds = rows.map((r) => r.id);
    const medRows = await tx
      .select({
        entryId: sickbayChronicMed.entryId,
        drugName: sickbayChronicMed.drugName,
        doseLabel: sickbayChronicMed.doseLabel,
        isPrn: sickbayChronicMed.isPrn,
        slotId: sickbayChronicMed.slotId,
        note: sickbayChronicMed.note,
      })
      .from(sickbayChronicMed)
      .where(
        and(eq(sickbayChronicMed.schoolId, schoolId), inArray(sickbayChronicMed.entryId, entryIds)),
      );

    // Patient identity + guardian + the matron's contact (dorm card rows). These are non-chronic
    // tables; tenant_isolation (the school GUC withStaffScope also sets) scopes them.
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
      .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
      .limit(1);
    if (!student) return null;

    const [guardian] = await tx
      .select({ name: studentGuardians.name, relationship: studentGuardians.relationship })
      .from(studentGuardians)
      .where(and(eq(studentGuardians.schoolId, schoolId), eq(studentGuardians.studentId, studentId)))
      .orderBy(studentGuardians.createdAt)
      .limit(1);

    const [settings] = await tx
      .select({ matronUserId: sickbaySettings.matronUserId })
      .from(sickbaySettings)
      .where(eq(sickbaySettings.schoolId, schoolId))
      .limit(1);
    let matronName: string | null = null;
    let matronPhone: string | null = null;
    if (settings?.matronUserId) {
      const [m] = await tx
        .select({ name: users.fullName, phone: users.phone })
        .from(users)
        .where(eq(users.id, settings.matronUserId))
        .limit(1);
      matronName = m?.name ?? null;
      matronPhone = m?.phone ?? null;
    }

    // 🔴 R121 — one audit row per (actor × entry × civil day). ON CONFLICT DO NOTHING, NO `.returning()`.
    await tx
      .insert(sickbayChronicRead)
      .values(
        entryIds.map((entryId) => ({
          schoolId,
          entryId,
          actorUserId: userId,
          readOn: civilDate(now),
          scope: null,
        })),
      )
      .onConflictDoNothing({
        target: [
          sickbayChronicRead.schoolId,
          sickbayChronicRead.entryId,
          sickbayChronicRead.actorUserId,
          sickbayChronicRead.readOn,
        ],
      });

    const dob = student.dateOfBirth ? new Date(student.dateOfBirth) : null;
    const ageYears = dob
      ? Math.floor((now.getTime() - dob.getTime()) / (365.25 * 24 * 3600_000))
      : null;

    const entries: ChronicPlanEntryView[] = rows.map((r) => {
      const meds: ChronicMedView[] = medRows
        .filter((m) => m.entryId === r.id)
        .map((m) => ({
          drugName: m.drugName,
          doseLabel: m.doseLabel,
          isPrn: m.isPrn,
          slotId: m.slotId,
          note: m.note,
        }));
      return {
        entryId: r.id,
        condition: r.condition as ChronicCondition,
        conditionLabel: r.conditionLabel,
        status: r.status as ChronicStatus,
        referralManaged: r.referralManaged,
        onSiteTreatable: r.onSiteTreatable,
        hmRestricted: r.hmRestricted,
        version: r.version,
        reviewedAt: r.reviewedAt,
        reviewedByName: r.reviewedByName,
        coReviewerNote: r.coReviewerNote,
        conditionDetail: r.conditionDetail,
        baselineStatus: r.baselineStatus,
        careGoals: r.careGoals,
        emergencyProtocol: r.emergencyProtocol,
        dischargeCriteria: r.dischargeCriteria,
        triggers: r.triggers,
        redFlags: r.redFlags,
        firstAction: r.firstAction,
        externalClinicalHome: r.externalClinicalHome,
        externalPastoralHome: r.externalPastoralHome,
        externalCareCadence: r.externalCareCadence,
        externalNextVisitAt: r.externalNextVisitAt,
        meds,
      };
    });

    return {
      studentId,
      studentName: `${student.firstName} ${student.lastName}`,
      firstName: student.firstName,
      lastName: student.lastName,
      initials: avatarInitials(`${student.firstName} ${student.lastName}`),
      formLabel: formLabel(student.classLevel, student.className, student.programme),
      houseName: student.houseName,
      studentCode: student.studentCode,
      ageYears,
      guardian: guardian
        ? { name: guardian.name, relationship: REL_LABEL[guardian.relationship] ?? "Contact" }
        : null,
      matronName,
      matronPhone,
      roundColumns: roundColumns(rounds),
      anchorDescription: anchor?.description ?? null,
      entries,
    };
  });
}

/**
 * R124 — the visit-record header's readable condition chip(s). The READER-VISIBLE set only, so a
 * HEADMASTER never gets a MENTAL_HEALTH chip; a non-staff reader gets none. Condition FAMILY only
 * (tier 3), never the detail — and this is NOT a detail open, so it writes NO audit row (R121).
 */
export async function getStudentChronicChips(
  schoolId: string,
  studentId: string,
  actor: ChronicActor,
  _now: Date,
): Promise<ChronicChip[]> {
  if (!isStaff(actor.roles)) return [];
  const userId = actor.userId;
  if (!userId) return [];

  return withStaffScope(schoolId, userId, async (tx) => {
    const rows = await tx
      .select({
        condition: sickbayChronicEntry.condition,
        conditionLabel: sickbayChronicEntry.conditionLabel,
      })
      .from(sickbayChronicEntry)
      .where(
        and(
          eq(sickbayChronicEntry.schoolId, schoolId),
          eq(sickbayChronicEntry.studentId, studentId),
          eq(sickbayChronicEntry.active, true),
          readableEntryFilter(schoolId, userId),
        ),
      );
    return rows.map((r) => ({
      condition: r.condition as ChronicCondition,
      label: conditionWords(r.condition as ChronicCondition, r.conditionLabel),
    }));
  });
}

/**
 * R123 — the today queue's neutral `Care plan on file` marker: the set of the given students who have
 * ≥1 active care plan THIS reader may see (positive only, never its negation, never the condition).
 * A HEADMASTER gets none for a mental-health-only student. Fails closed for a null identity.
 */
export async function studentsWithCarePlan(
  schoolId: string,
  userId: string | null,
  studentIds: readonly string[],
): Promise<Set<string>> {
  if (!userId || studentIds.length === 0) return new Set();
  return withStaffScope(schoolId, userId, async (tx: Tx) => {
    const rows = await tx
      .selectDistinct({ studentId: sickbayChronicEntry.studentId })
      .from(sickbayChronicEntry)
      .where(
        and(
          eq(sickbayChronicEntry.schoolId, schoolId),
          eq(sickbayChronicEntry.active, true),
          inArray(sickbayChronicEntry.studentId, [...studentIds]),
          readableEntryFilter(schoolId, userId),
        ),
      );
    return new Set(rows.map((r) => r.studentId));
  });
}
