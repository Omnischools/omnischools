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
import { recordAudit } from "@/lib/db/audit";
import {
  auditLog,
  classes,
  houses,
  roleAssignments,
  roles,
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
import { hasAnyRole, isStaff, SICKBAY_CLINICAL_READ_ROLES } from "@/lib/access";
import { civilDate } from "./visits";
import { formLabel, initials as avatarInitials } from "./defaults";
import { getRoundSchedule } from "./config";
import {
  buildDirectiveView,
  buildDormCardView,
  buildFloorView,
  dormMedNote,
  formatChronicAuditEvent,
  medicationLine,
  resolveWinningScope,
  roundColumns,
  conditionLabel as conditionWords,
} from "./chronic-copy";
import type {
  ChronicAuditEvent,
  ChronicAuditKind,
  ChronicChip,
  ChronicCondition,
  ChronicDormCardView,
  ChronicEntryProjection,
  ChronicMedView,
  ChronicPlanView,
  ChronicRegisterRow,
  ChronicScope,
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

/**
 * R107 — the HOUSE-TIE liveness half, evaluated in SQL per request (never a session claim). A house-tied
 * grant (`house_id` set) is live only while the grantee is still that House's HM AND the student is
 * still in that House. A plain grant (`house_id` null) is unaffected. `studentHouseId` is the entry's
 * student's current House; a null-House student can satisfy no house tie.
 */
const houseTieLive = (studentHouseId: string | null, granteeUserId: string) =>
  sql`(${sickbayChronicGrant.houseId} is null or (${sickbayChronicGrant.houseId} = ${studentHouseId}::uuid and exists (select 1 from ${houses} where ${houses.schoolId} = ${sickbayChronicGrant.schoolId} and ${houses.id} = ${sickbayChronicGrant.houseId} and ${houses.hmUserId} = ${granteeUserId}::uuid)))`;

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
 * 🔴 R132/R133 — EACH readable entry is projected to the reader's WINNING scope (widest-wins), and the
 * projection is the winner's WHOLE key-set, never a union. A DEFAULT clinical role (MATRON any entry;
 * HEADMASTER any non-MH entry) outranks every grant → FULL_PLAN. A grantee gets FULL_PLAN / the dorm
 * card (PARTIAL) / one directive sentence (DIRECTIVE). 🔴 R132.1 — the projection is picked AFTER
 * reading `hm_restricted`: a PARTIAL grant on an `hm_restricted` entry degrades to the name-only FLOOR,
 * never the dorm card. The reader FETCHES the whole entry row but RETURNS a narrow per-scope object
 * (MEDIUM-3 — a `select *` masked at render is a disclosure; a narrow projection is the control).
 *
 * 🔴 R138 — writes one `sickbay_chronic_read` row per (actor × entry × civil day), ON CONFLICT DO
 * NOTHING, no read-before-write, NO `.returning()` (a grantee has INSERT but not SELECT — MEDIUM-1).
 * The matron's own opens ARE audited. `scope` = the winning scope for a grantee; `null` for a default
 * clinical role. Recorded at the FIRST audited open of the day; it is NOT an upsert (a wider scope
 * later the same day does not rewrite the morning's row — R131.3).
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

  // R133.2 — a default clinical reader (MATRON any; HEADMASTER any non-MH, already carved out of his
  // readable set at the DB) outranks every grant. Any entry that survives into `rows` for such a reader
  // is one he legitimately sees IN FULL.
  const isDefaultClinical = hasAnyRole(actor.roles, SICKBAY_CLINICAL_READ_ROLES);

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
        houseId: students.houseId,
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

    // 🔴 R133 — a grantee's LIVE grant scopes per entry (revoked/expiry/house-tie all evaluated in SQL
    // against the DB's own now(), R114). A default clinical reader skips this entirely: he outranks
    // every grant, so his projection is FULL_PLAN whatever a grant row says. `directiveNote` is read
    // OFF THE GRANT ROW here — never a clinical column — so the DIRECTIVE projection cannot leak.
    const grantsByEntry = new Map<
      string,
      { scope: ChronicScope; directiveNote: string | null; grantedAt: Date }[]
    >();
    if (!isDefaultClinical) {
      const liveGrants = await tx
        .select({
          entryId: sickbayChronicGrant.entryId,
          scope: sickbayChronicGrant.scope,
          directiveNote: sickbayChronicGrant.directiveNote,
          grantedAt: sickbayChronicGrant.grantedAt,
        })
        .from(sickbayChronicGrant)
        .where(
          and(
            eq(sickbayChronicGrant.schoolId, schoolId),
            eq(sickbayChronicGrant.granteeUserId, userId),
            inArray(sickbayChronicGrant.entryId, entryIds),
            grantIsLive,
            houseTieLive(student.houseId, userId),
          ),
        );
      for (const g of liveGrants) {
        const list = grantsByEntry.get(g.entryId) ?? [];
        list.push({ scope: g.scope as ChronicScope, directiveNote: g.directiveNote, grantedAt: g.grantedAt });
        grantsByEntry.set(g.entryId, list);
      }
    }

    // 🔴 Exactly ONE projection per (reader × entry), picked AFTER reading hm_restricted (R132.1).
    const projections: ChronicEntryProjection[] = [];
    const auditScopeByEntry = new Map<string, ChronicScope | null>();
    for (const r of rows) {
      const entryGrants = grantsByEntry.get(r.id) ?? [];
      const winning = resolveWinningScope(
        entryGrants.map((g) => g.scope),
        isDefaultClinical,
      );
      if (winning === null) continue; // race: a grant expired since the readable-set filter — skip
      auditScopeByEntry.set(r.id, isDefaultClinical ? null : winning);

      if (winning === "FULL_PLAN") {
        const meds: ChronicMedView[] = medRows
          .filter((m) => m.entryId === r.id)
          .map((m) => ({
            drugName: m.drugName,
            doseLabel: m.doseLabel,
            isPrn: m.isPrn,
            slotId: m.slotId,
            note: m.note,
          }));
        projections.push({
          kind: "FULL_PLAN",
          entry: {
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
          },
        });
      } else if (winning === "PARTIAL") {
        // 🔴 R132.1 — a PARTIAL grant on an hm_restricted entry (a survived reclassification) degrades
        // to the name-only FLOOR: no condition, no label, no pill, no dorm card.
        if (r.hmRestricted) {
          projections.push({ kind: "FLOOR", floor: buildFloorView(r.id) });
        } else {
          const hasRoundMed = medRows.some((m) => m.entryId === r.id && !m.isPrn && m.slotId !== null);
          projections.push({
            kind: "PARTIAL",
            card: buildDormCardView({
              entryId: r.id,
              condition: r.condition as ChronicCondition,
              conditionLabel: r.conditionLabel,
              triggers: r.triggers,
              redFlags: r.redFlags,
              firstAction: r.firstAction,
              dormMedNote: dormMedNote(anchor?.startsAt ?? null, hasRoundMed),
            }),
          });
        }
      } else {
        // DIRECTIVE — one sentence off the newest live DIRECTIVE grant row (CHECK-forced non-null).
        const note = entryGrants
          .filter((g) => g.scope === "DIRECTIVE")
          .sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime())[0]?.directiveNote;
        if (!note) continue; // defensive — the DB CHECK guarantees a note
        projections.push({ kind: "DIRECTIVE", directive: buildDirectiveView(r.id, note) });
      }
    }
    if (projections.length === 0) return null; // R118 — no readable projection == no such student

    // R132.2 — the wrapper is scope-aware. guardian/matron phones only for a real dorm card or FULL;
    // round columns only for FULL. A DIRECTIVE-only / floor-only reader gets identity alone.
    const hasFull = projections.some((p) => p.kind === "FULL_PLAN");
    const hasCard = projections.some((p) => p.kind === "PARTIAL");
    const atLeastPartial = hasFull || hasCard;

    // 🔴 R138 — one read row per (actor × entry × civil day), per-entry scope, NO `.returning()`.
    await tx
      .insert(sickbayChronicRead)
      .values(
        [...auditScopeByEntry.entries()].map(([entryId, scope]) => ({
          schoolId,
          entryId,
          actorUserId: userId,
          readOn: civilDate(now),
          scope,
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
      guardian:
        atLeastPartial && guardian
          ? { name: guardian.name, relationship: REL_LABEL[guardian.relationship] ?? "Contact" }
          : null,
      matronName: atLeastPartial ? matronName : null,
      matronPhone: atLeastPartial ? matronPhone : null,
      roundColumns: hasFull ? roundColumns(rounds) : [],
      anchorDescription: hasFull ? anchor?.description ?? null : null,
      entries: projections,
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

// ============================================================================
// INCR-23b · §04 — access grants & the audit trail (R134). CLINICAL-READER-ONLY (a grantee never
// reaches it — the page notFound()s him). Lists EVERY live grant + per-row effective scope (R131.4);
// revoked rows stay (append-only). The audit trail = union of `sickbay_chronic_read` + `audit_log`,
// rendered by the PURE `formatChronicAuditEvent` (never a stored sentence, never a condition — R122).
// ============================================================================

/** One §04 grant row — its OWN effective scope, not the winner (R131.4). A client-safe scalar shape. */
export interface AccessGrantRow {
  grantId: string;
  studentId: string;
  studentName: string;
  granteeName: string;
  /** Derived: `HM · {House} House` for a house-tied grant, else the grantee's role label. */
  granteeRoleLine: string | null;
  scope: ChronicScope;
  scopeLabel: string | null;
  /** Matron's justification — shown to the MATRON only (§7.4); null for a HEADMASTER. */
  reason: string | null;
  expiresAt: Date | null;
  revoked: boolean;
  /** Live now — not revoked, not expired, and (if house-tied) the tie still holds. */
  live: boolean;
}

export interface AccessAuditRow {
  at: Date;
  kind: ChronicAuditKind;
  sentence: string;
}

export interface AccessGrantsView {
  isMatron: boolean;
  grants: AccessGrantRow[];
  audit: AccessAuditRow[];
  liveGrantCount: number;
  studentCount: number;
}

export async function getAccessGrants(
  schoolId: string,
  actor: ChronicActor,
  now: Date,
): Promise<AccessGrantsView | null> {
  // §04 is CLINICAL-READER-ONLY (R134/R137). A grantee — or any other staffer — never reaches it.
  if (!hasAnyRole(actor.roles, SICKBAY_CLINICAL_READ_ROLES)) return null;
  const userId = actor.userId;
  if (!userId) return null;
  const isMatron = actor.roles.includes("MATRON");

  return withStaffScope(schoolId, userId, async (tx) => {
    // The readable entry set + each entry's student (R130's INNER JOIN, as the readable-id filter). A
    // HEADMASTER's set excludes MENTAL_HEALTH, so he can enumerate no MH grant/read row (E18/M9).
    const readable = await tx
      .select({
        entryId: sickbayChronicEntry.id,
        studentId: sickbayChronicEntry.studentId,
        studentHouseId: students.houseId,
        firstName: students.firstName,
        lastName: students.lastName,
      })
      .from(sickbayChronicEntry)
      .innerJoin(
        students,
        and(eq(students.schoolId, schoolId), eq(students.id, sickbayChronicEntry.studentId)),
      )
      .where(
        and(eq(sickbayChronicEntry.schoolId, schoolId), readableEntryFilter(schoolId, userId)),
      );
    const studentByEntry = new Map(
      readable.map((r) => [
        r.entryId,
        { studentId: r.studentId, houseId: r.studentHouseId, name: `${r.firstName} ${r.lastName}` },
      ]),
    );
    const readableEntryIds = readable.map((r) => r.entryId);
    if (readableEntryIds.length === 0) {
      return { isMatron, grants: [], audit: [], liveGrantCount: 0, studentCount: 0 };
    }

    const grantRows = await tx
      .select({
        id: sickbayChronicGrant.id,
        entryId: sickbayChronicGrant.entryId,
        granteeUserId: sickbayChronicGrant.granteeUserId,
        granteeName: users.fullName,
        scope: sickbayChronicGrant.scope,
        scopeLabel: sickbayChronicGrant.scopeLabel,
        reason: sickbayChronicGrant.reason,
        houseId: sickbayChronicGrant.houseId,
        tiedHouseName: houses.name,
        tiedHouseHm: houses.hmUserId,
        expiresAt: sickbayChronicGrant.expiresAt,
        revokedAt: sickbayChronicGrant.revokedAt,
        grantedAt: sickbayChronicGrant.grantedAt,
      })
      .from(sickbayChronicGrant)
      .innerJoin(users, eq(users.id, sickbayChronicGrant.granteeUserId))
      .leftJoin(
        houses,
        and(eq(houses.schoolId, schoolId), eq(houses.id, sickbayChronicGrant.houseId)),
      )
      .where(
        and(
          eq(sickbayChronicGrant.schoolId, schoolId),
          inArray(sickbayChronicGrant.entryId, readableEntryIds),
        ),
      )
      .orderBy(desc(sickbayChronicGrant.grantedAt));

    // The grantee's role label, for the non-house-tied sub-line (§7.4). One bounded lookup.
    const granteeIds = [...new Set(grantRows.map((g) => g.granteeUserId))];
    const roleByUser = new Map<string, string>();
    if (granteeIds.length > 0) {
      const raRows = await tx
        .select({ userId: roleAssignments.userId, label: roles.label })
        .from(roleAssignments)
        .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
        .where(
          and(
            eq(roleAssignments.schoolId, schoolId),
            inArray(roleAssignments.userId, granteeIds),
          ),
        );
      for (const r of raRows) if (!roleByUser.has(r.userId)) roleByUser.set(r.userId, r.label);
    }

    const nowMs = now.getTime();
    const grants: AccessGrantRow[] = grantRows.map((g) => {
      const student = studentByEntry.get(g.entryId);
      const houseTieHolds =
        g.houseId === null ||
        (g.tiedHouseHm === g.granteeUserId && student?.houseId === g.houseId);
      const revoked = g.revokedAt !== null;
      const live =
        !revoked && (g.expiresAt === null || g.expiresAt.getTime() > nowMs) && houseTieHolds;
      const roleLine = g.houseId
        ? `HM · ${g.tiedHouseName ?? "House"} House`
        : roleByUser.get(g.granteeUserId) ?? null;
      return {
        grantId: g.id,
        studentId: student?.studentId ?? "",
        studentName: student?.name ?? "—",
        granteeName: g.granteeName ?? "Unnamed staff",
        granteeRoleLine: roleLine,
        scope: g.scope as ChronicScope,
        scopeLabel: g.scopeLabel,
        reason: isMatron ? g.reason : null, // §7.4 — the reason is the matron's; a HM sees the row without it
        expiresAt: g.expiresAt,
        revoked,
        live,
      };
    });

    const liveGrants = grants.filter((g) => g.live);
    const liveGrantCount = liveGrants.length;
    const studentCount = new Set(liveGrants.map((g) => g.studentId)).size;

    const audit = await buildAuditTrail(tx, schoolId, readableEntryIds, studentByEntry, grantRows);

    return { isMatron, grants, audit, liveGrantCount, studentCount };
  });
}

/**
 * The §04 audit trail — the union of every read (`sickbay_chronic_read`) and every write (`audit_log`
 * grant/revoke/print/entry) against a READABLE entry, normalised to `ChronicAuditEvent` and rendered by
 * the pure formatter. Rows about an MH entry never appear to a reader barred from it (M9 — the readable
 * filter already excludes them). No condition is ever passed to the formatter, so none can leak.
 */
async function buildAuditTrail(
  tx: Tx,
  schoolId: string,
  readableEntryIds: string[],
  studentByEntry: Map<string, { studentId: string; houseId: string | null; name: string }>,
  grantRows: {
    id: string;
    entryId: string;
    granteeName: string | null;
    scope: string;
  }[],
): Promise<AccessAuditRow[]> {
  const grantById = new Map(grantRows.map((g) => [g.id, g]));

  const reads = await tx
    .select({
      entryId: sickbayChronicRead.entryId,
      actorUserId: sickbayChronicRead.actorUserId,
      scope: sickbayChronicRead.scope,
      readAt: sickbayChronicRead.readAt,
    })
    .from(sickbayChronicRead)
    .where(
      and(
        eq(sickbayChronicRead.schoolId, schoolId),
        inArray(sickbayChronicRead.entryId, readableEntryIds),
      ),
    )
    .orderBy(desc(sickbayChronicRead.readAt))
    .limit(80);

  const logs = await tx
    .select({
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      actionType: auditLog.actionType,
      actorUserId: auditLog.actorUserId,
      occurredAt: auditLog.occurredAt,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.schoolId, schoolId),
        inArray(auditLog.entityType, ["sickbay_chronic_grant", "sickbay_chronic_entry"]),
      ),
    )
    .orderBy(desc(auditLog.occurredAt))
    .limit(80);

  const actorIds = [
    ...new Set(
      [...reads.map((r) => r.actorUserId), ...logs.map((l) => l.actorUserId)].filter(
        (x): x is string => !!x,
      ),
    ),
  ];
  const actorName = new Map<string, string>();
  if (actorIds.length > 0) {
    const rows = await tx
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(inArray(users.id, actorIds));
    for (const u of rows) actorName.set(u.id, u.name ?? "A member of staff");
  }
  const who = (id: string | null) => (id ? actorName.get(id) ?? "A member of staff" : "The system");

  const events: (ChronicAuditEvent & { _kind: ChronicAuditEvent["kind"] })[] = [];

  for (const r of reads) {
    const student = studentByEntry.get(r.entryId);
    if (!student) continue;
    const kind = r.scope ? ("viewed" as const) : ("opened" as const);
    events.push({
      _kind: kind,
      kind,
      at: r.readAt,
      actorName: who(r.actorUserId),
      studentName: student.name,
      granteeName: null,
      scope: (r.scope as ChronicScope | null) ?? null,
    });
  }

  for (const l of logs) {
    if (l.entityType === "sickbay_chronic_grant") {
      const g = l.entityId ? grantById.get(l.entityId) : undefined;
      if (!g) continue; // a grant on a non-readable entry — never surfaced (M9)
      const student = studentByEntry.get(g.entryId);
      if (!student) continue;
      const kind = l.actionType === "revoked" ? ("revoked" as const) : ("granted" as const);
      events.push({
        _kind: kind,
        kind,
        at: l.occurredAt,
        actorName: who(l.actorUserId),
        studentName: student.name,
        granteeName: g.granteeName ?? null,
        scope: g.scope as ChronicScope,
      });
    } else {
      // sickbay_chronic_entry — created / updated / exported (print). Only readable entries appear.
      const student = l.entityId ? studentByEntry.get(l.entityId) : undefined;
      if (!student) continue;
      const kind =
        l.actionType === "updated"
          ? ("updated" as const)
          : l.actionType === "exported"
            ? ("exported" as const)
            : ("created" as const);
      events.push({
        _kind: kind,
        kind,
        at: l.occurredAt,
        actorName: who(l.actorUserId),
        studentName: student.name,
        granteeName: null,
        scope: null,
      });
    }
  }

  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  return events.slice(0, 60).map((e) => ({
    at: e.at,
    kind: e._kind,
    sentence: formatChronicAuditEvent(e),
  }));
}

// ============================================================================
// INCR-23b · R136 — `Print dorm copy`. A print-stylesheet route's data: the dorm-card (PARTIAL)
// projection, printable IFF the reader's winning scope ≥ PARTIAL AND the entry is not hm_restricted
// (MATRON / HEADMASTER-on-non-MH / FULL & PARTIAL grantees). ABSENT for a MENTAL_HEALTH plan (C13) and
// for a DIRECTIVE reader. Writes ONE `audit_log` `exported` row — intent-to-print (no web app observes
// a physical print), distinct from the `_read` dedupe.
// ============================================================================

export interface DormPrintView {
  studentName: string;
  houseName: string | null;
  card: ChronicDormCardView;
  guardianName: string | null;
  matronName: string | null;
  matronPhone: string | null;
}

export async function getDormCardForPrint(
  schoolId: string,
  studentId: string,
  entryId: string,
  actor: ChronicActor,
  _now: Date,
): Promise<DormPrintView | null> {
  if (!isStaff(actor.roles)) return null;
  const userId = actor.userId;
  if (!userId) return null;
  const isDefaultClinical = hasAnyRole(actor.roles, SICKBAY_CLINICAL_READ_ROLES);

  const rounds = await getRoundSchedule(schoolId);
  const anchor = rounds.find((r) => r.isAnchor) ?? null;

  return withStaffScope(schoolId, userId, async (tx) => {
    const [entry] = await tx
      .select({
        id: sickbayChronicEntry.id,
        condition: sickbayChronicEntry.condition,
        conditionLabel: sickbayChronicEntry.conditionLabel,
        hmRestricted: sickbayChronicEntry.hmRestricted,
        triggers: sickbayChronicEntry.triggers,
        redFlags: sickbayChronicEntry.redFlags,
        firstAction: sickbayChronicEntry.firstAction,
      })
      .from(sickbayChronicEntry)
      .where(
        and(
          eq(sickbayChronicEntry.schoolId, schoolId),
          eq(sickbayChronicEntry.id, entryId),
          eq(sickbayChronicEntry.studentId, studentId),
          eq(sickbayChronicEntry.active, true),
          readableEntryFilter(schoolId, userId),
        ),
      )
      .limit(1);
    if (!entry) return null;

    // Resolve the winning scope; PRINTABLE only when it is ≥ PARTIAL and the plan is not MH (C13).
    let winning: ChronicScope | null;
    if (isDefaultClinical) {
      winning = "FULL_PLAN";
    } else {
      const shId = await studentHouseId(tx, schoolId, studentId);
      const liveGrants = await tx
        .select({ scope: sickbayChronicGrant.scope })
        .from(sickbayChronicGrant)
        .where(
          and(
            eq(sickbayChronicGrant.schoolId, schoolId),
            eq(sickbayChronicGrant.granteeUserId, userId),
            eq(sickbayChronicGrant.entryId, entryId),
            grantIsLive,
            houseTieLive(shId, userId),
          ),
        );
      winning = resolveWinningScope(
        liveGrants.map((g) => g.scope as ChronicScope),
        false,
      );
    }
    // DIRECTIVE (or no access) → no card; MENTAL_HEALTH → no card, ever (C13).
    if (winning === null || winning === "DIRECTIVE" || entry.hmRestricted) return null;

    const hasRoundMed = await tx
      .select({ id: sickbayChronicMed.id })
      .from(sickbayChronicMed)
      .where(
        and(
          eq(sickbayChronicMed.schoolId, schoolId),
          eq(sickbayChronicMed.entryId, entryId),
          eq(sickbayChronicMed.isPrn, false),
        ),
      )
      .limit(1);

    const [student] = await tx
      .select({
        firstName: students.firstName,
        lastName: students.lastName,
        houseName: houses.name,
      })
      .from(students)
      .leftJoin(houses, and(eq(houses.schoolId, schoolId), eq(houses.id, students.houseId)))
      .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
      .limit(1);
    if (!student) return null;

    const [guardian] = await tx
      .select({ name: studentGuardians.name })
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

    // R136 — INTENT-TO-PRINT. One `audit_log` `exported` row, in the same tx, before returning.
    await recordAudit(tx, {
      schoolId,
      actorUserId: userId,
      actorRole: actor.roles[0] ?? "MATRON",
      actionType: "exported",
      entityType: "sickbay_chronic_entry",
      entityId: entryId,
      reason: "Dorm-side card printed",
    });

    return {
      studentName: `${student.firstName} ${student.lastName}`,
      houseName: student.houseName,
      card: buildDormCardView({
        entryId: entry.id,
        condition: entry.condition as ChronicCondition,
        conditionLabel: entry.conditionLabel,
        triggers: entry.triggers,
        redFlags: entry.redFlags,
        firstAction: entry.firstAction,
        dormMedNote: dormMedNote(anchor?.startsAt ?? null, hasRoundMed.length > 0),
      }),
      guardianName: guardian?.name ?? null,
      matronName,
      matronPhone,
    };
  });
}

/** The student's current House id — for the print route's house-tie liveness check. */
async function studentHouseId(tx: Tx, schoolId: string, studentId: string): Promise<string | null> {
  const [s] = await tx
    .select({ houseId: students.houseId })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
    .limit(1);
  return s?.houseId ?? null;
}

/** The `+ Grant access` form's option lists (R139 fields). MATRON-only — the sole grant writer. */
export interface GrantFormOptions {
  staff: { id: string; name: string; roleLabel: string }[];
  entries: { entryId: string; studentName: string; conditionLabel: string; hmRestricted: boolean }[];
  houses: { id: string; name: string }[];
}

export async function getGrantFormOptions(
  schoolId: string,
  actor: ChronicActor,
): Promise<GrantFormOptions | null> {
  if (!actor.roles.includes("MATRON")) return null; // only the grant writer needs the pickers
  const userId = actor.userId;
  if (!userId) return null;

  return withStaffScope(schoolId, userId, async (tx) => {
    const staffRows = await tx
      .select({ id: users.id, name: users.fullName, roleLabel: roles.label, code: roles.code })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .innerJoin(users, eq(users.id, roleAssignments.userId))
      .where(eq(roleAssignments.schoolId, schoolId));
    const staffById = new Map<string, { id: string; name: string; roleLabel: string }>();
    for (const r of staffRows) {
      if (r.code === "STUDENT" || r.code === "PARENT") continue; // R106 — staff only
      if (!staffById.has(r.id)) {
        staffById.set(r.id, { id: r.id, name: r.name ?? "Unnamed staff", roleLabel: r.roleLabel });
      }
    }

    const entryRows = await tx
      .select({
        entryId: sickbayChronicEntry.id,
        condition: sickbayChronicEntry.condition,
        conditionLabel: sickbayChronicEntry.conditionLabel,
        hmRestricted: sickbayChronicEntry.hmRestricted,
        firstName: students.firstName,
        lastName: students.lastName,
      })
      .from(sickbayChronicEntry)
      .innerJoin(
        students,
        and(eq(students.schoolId, schoolId), eq(students.id, sickbayChronicEntry.studentId)),
      )
      .where(
        and(
          eq(sickbayChronicEntry.schoolId, schoolId),
          eq(sickbayChronicEntry.active, true),
          readableEntryFilter(schoolId, userId),
        ),
      );

    const houseRows = await tx
      .select({ id: houses.id, name: houses.name })
      .from(houses)
      .where(eq(houses.schoolId, schoolId));

    return {
      staff: [...staffById.values()].sort((a, b) => a.name.localeCompare(b.name)),
      entries: entryRows
        .map((e) => ({
          entryId: e.entryId,
          studentName: `${e.firstName} ${e.lastName}`,
          conditionLabel: conditionWords(e.condition as ChronicCondition, e.conditionLabel),
          hmRestricted: e.hmRestricted,
        }))
        .sort((a, b) => a.studentName.localeCompare(b.studentName)),
      houses: houseRows.sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}
